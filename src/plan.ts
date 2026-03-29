import { randomUUID } from 'node:crypto';
import type { MemoryConfig } from './types.js';
import type { ModelComplete, Plan, PlanItem } from './llm.js';
import { cosineSimilarity, embed } from './embedding.js';

const STALE_AFTER = 3;

// ── Coded logic — no LLM needed ─────────────────────────────

/**
 * Carry forward all non-done items from previous plan.
 * Done items older than staleAfter cycles are dropped.
 */
export function carryForward(
  previousPlan: Plan | null,
  currentCycle: number,
  staleAfter: number = 5,
): PlanItem[] {
  if (!previousPlan) return [];

  return previousPlan.items.filter(item => {
    // Keep non-done items
    if (item.status !== 'done') return true;
    // Keep recently-done items for visibility
    if (item.completed_cycle !== null && currentCycle - item.completed_cycle < staleAfter) return true;
    // Drop stale done items
    return false;
  });
}

/**
 * Mark items as done by matching cycle events against task text.
 * Uses embedding similarity — if an event is >0.75 similar to a task,
 * and the event describes completion, mark it done.
 */
export async function markDoneByEvents(
  items: PlanItem[],
  cycleEvents: string[],
  currentCycle: number,
  openaiApiKey?: string,
): Promise<{ items: PlanItem[]; changes: string[] }> {
  if (cycleEvents.length === 0 || items.length === 0) {
    return { items, changes: [] };
  }

  const changes: string[] = [];
  const eventEmbeddings = await Promise.all(
    cycleEvents.map(e => embed(e, openaiApiKey)),
  );

  for (const item of items) {
    if (item.status === 'done') continue;

    const taskEmbedding = await embed(item.text, openaiApiKey);

    for (let i = 0; i < cycleEvents.length; i++) {
      const sim = cosineSimilarity(taskEmbedding, eventEmbeddings[i]);
      if (sim > 0.75) {
        item.status = 'done';
        item.completed_cycle = currentCycle;
        changes.push(`Marked done: "${item.text.slice(0, 50)}" (matched event: "${cycleEvents[i].slice(0, 50)}")`);
        break;
      }
    }
  }

  return { items, changes };
}

/**
 * Remove stale active/pending items — no related events for N cycles.
 */
export function removeStale(
  items: PlanItem[],
  currentCycle: number,
  staleActiveAfter: number = STALE_AFTER,
): { items: PlanItem[]; changes: string[] } {
  const changes: string[] = [];

  const kept = items.filter(item => {
    if (item.status === 'done') return true; // done items managed by carryForward
    const age = currentCycle - item.added_cycle;
    if (age > staleActiveAfter && item.status === 'pending') {
      changes.push(`Removed stale: "${item.text.slice(0, 50)}" (pending for ${age} cycles)`);
      return false;
    }
    return true;
  });

  return { items: kept, changes };
}

/**
 * Enforce max items — drop lowest priority items.
 */
export function enforceMaxItems(
  items: PlanItem[],
  maxItems: number,
): { items: PlanItem[]; changes: string[] } {
  if (items.length <= maxItems) return { items, changes: [] };

  const changes: string[] = [];
  // Sort: done first (to drop), then by priority desc (lowest priority = highest number)
  const sorted = [...items].sort((a, b) => {
    if (a.status === 'done' && b.status !== 'done') return 1;
    if (a.status !== 'done' && b.status === 'done') return -1;
    return b.priority - a.priority; // higher number = lower priority = drop first
  });

  while (sorted.length > maxItems) {
    const dropped = sorted.pop()!;
    changes.push(`Dropped to fit limit: "${dropped.text.slice(0, 50)}"`);
  }

  return { items: sorted, changes };
}

// ── LLM-assisted — only for parts that need understanding ───

/**
 * Ask the LLM to generate new tasks from cycle events.
 * Only called when there are events that don't match existing tasks.
 */
export async function generateNewTasks(
  model: ModelComplete,
  cycleEvents: string[],
  existingItems: PlanItem[],
  relevantMemories: string[],
  currentCycle: number,
  config: MemoryConfig,
): Promise<{ items: PlanItem[]; strategy: string; changes: string[] }> {
  const existingTexts = existingItems
    .filter(i => i.status !== 'done')
    .map(i => i.text);

  const prompt = `You are a task planner for an autonomous agent.

EXISTING TASKS (do NOT duplicate these):
${existingTexts.map(t => `- ${t}`).join('\n') || '(none)'}

NEW EVENTS THIS CYCLE:
${cycleEvents.map(e => `- ${e}`).join('\n')}

AGENT'S MEMORIES (context):
${relevantMemories.slice(0, 5).map(m => `- ${m}`).join('\n') || '(none)'}

RULES:
- Only create tasks for NEW work that is NOT already covered by existing tasks
- Every task MUST be a specific executable action
- Use concrete verbs: send, write, call, review, create, set, check, draft, prepare, update, publish
- Include WHO or WHAT: a name, product, amount, or deliverable
- Do NOT create tasks for events that already happened
- Do NOT create vague tasks like "focus on growth" or "implement strategy"

ALSO write a one-sentence strategy summary:
- Reference a specific number, name, or situation
- Under 200 characters

Return JSON:
{
  "new_tasks": [{"text": "...", "priority": 1|2|3}],
  "strategy": "one sentence with specifics"
}

Return ONLY JSON. No other text.`;

  const response = await model.complete({
    systemPrompt: 'You generate specific, actionable tasks. Return only valid JSON.',
    prompt,
    responseFormat: 'json',
    temperature: 0.1,
    maxTokens: 1000,
  });

  const raw = JSON.parse(response.text);
  const changes: string[] = [];

  const newItems: PlanItem[] = (raw.new_tasks ?? []).map((t: any) => {
    const text = t.text ?? t.description ?? t.title ?? t.task ?? '';
    if (!text) return null;
    changes.push(`Added: "${text.slice(0, 50)}"`);
    return {
      id: randomUUID(),
      text,
      status: 'pending' as const,
      priority: t.priority ?? 2,
      added_cycle: currentCycle,
      completed_cycle: null,
    };
  }).filter(Boolean) as PlanItem[];

  return {
    items: newItems,
    strategy: raw.strategy ?? '',
    changes,
  };
}

// ── Orchestrator — combines code + LLM ──────────────────────

export async function rewritePlanHybrid(options: {
  model: ModelComplete;
  previousPlan: Plan | null;
  cycleEvents: string[];
  relevantMemories: string[];
  currentCycle: number;
  config: MemoryConfig;
  openaiApiKey?: string;
}): Promise<Plan> {
  const { model, previousPlan, cycleEvents, relevantMemories, currentCycle, config, openaiApiKey } = options;
  const maxItems = config.planTemplate?.maxItems ?? 10;
  const allChanges: string[] = [];

  // Step 1 (code): carry forward
  let items = carryForward(previousPlan, currentCycle);

  // Step 2 (code + embeddings): mark done
  if (cycleEvents.length > 0) {
    const doneResult = await markDoneByEvents(items, cycleEvents, currentCycle, openaiApiKey);
    items = doneResult.items;
    allChanges.push(...doneResult.changes);
  }

  // Step 3 (code): remove stale
  const staleResult = removeStale(items, currentCycle);
  items = staleResult.items;
  allChanges.push(...staleResult.changes);

  // Step 4 (LLM): generate new tasks + strategy from events
  let strategy = previousPlan?.strategy ?? '';
  if (cycleEvents.length > 0) {
    const newResult = await generateNewTasks(
      model, cycleEvents, items, relevantMemories, currentCycle, config,
    );
    items = [...items, ...newResult.items];
    strategy = newResult.strategy || strategy;
    allChanges.push(...newResult.changes);
  }

  // Step 5 (code): enforce max items
  const limitResult = enforceMaxItems(items, maxItems);
  items = limitResult.items;
  allChanges.push(...limitResult.changes);

  return {
    cycle: currentCycle,
    items,
    strategy,
    changes: allChanges,
  };
}
