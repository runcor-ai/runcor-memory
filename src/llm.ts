import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import type { MemoryConfig, MemoryNode } from './types.js';

// ── Types ────────────────────────────────────────────────────

/**
 * Minimal model interface — matches runcor's ModelInterface.
 * The memory system accepts this so it works with any runcor engine.
 */
export interface ModelComplete {
  complete(request: {
    prompt?: string;
    systemPrompt?: string;
    responseFormat?: 'text' | 'json';
    temperature?: number;
    maxTokens?: number;
  }): Promise<{ text: string }>;
}

export interface RelevanceResult {
  score: number;
  band: string;
  justification: string;
  matched_preserve: string[];
  matched_discard: string[];
}

export interface PrecisResult {
  precis: string;
  mode: 'initial' | 'promotion';
  preserved: string[];
  discarded: string[];
}

export interface PlanItem {
  id: string;
  text: string;
  status: 'pending' | 'active' | 'done' | 'blocked';
  priority: number;
  category?: string;
  added_cycle: number;
  completed_cycle: number | null;
}

export interface Plan {
  cycle: number;
  items: PlanItem[];
  strategy: string;
  changes: string[];
}

// ── Spec loader ──────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const SPECS_DIR = resolve(__dirname, '..', 'specs');

function loadSpec(name: string): string {
  return readFileSync(resolve(SPECS_DIR, name), 'utf-8');
}

// ── Score Relevance ──────────────────────────────────────────

export async function scoreRelevance(
  model: ModelComplete,
  memoryContent: string,
  config: MemoryConfig,
  agentRole: string = 'general autonomous agent',
): Promise<RelevanceResult> {
  const spec = loadSpec('score-relevance.rpp');

  const prompt = `${spec}

INPUT:
memory_content: "${memoryContent}"
preserve_rules: ${JSON.stringify(config.compression.preserve)}
discard_rules: ${JSON.stringify(config.compression.discard)}
agent_role: "${agentRole}"

Return ONLY the JSON object. No other text.`;

  const response = await model.complete({
    systemPrompt: 'You are a memory scoring system. Follow the R++ specification exactly. Return only valid JSON.',
    prompt,
    responseFormat: 'json',
    temperature: 0,
    maxTokens: 300,
  });

  const result = JSON.parse(response.text) as RelevanceResult;

  // Clamp score to valid range
  result.score = Math.max(0, Math.min(1, result.score));

  return result;
}

// ── Write Précis ─────────────────────────────────────────────

export async function writePrecis(
  model: ModelComplete,
  rawContent: string,
  mode: 'initial' | 'promotion',
  config: MemoryConfig,
  relatedMemories: string[] = [],
): Promise<PrecisResult> {
  const spec = loadSpec('write-precis.rpp');

  const prompt = `${spec}

INPUT:
raw_content: "${rawContent}"
mode: "${mode}"
preserve_rules: ${JSON.stringify(config.compression.preserve)}
discard_rules: ${JSON.stringify(config.compression.discard)}
precis_style: "${config.compression.precisStyle}"
related_memories: ${JSON.stringify(relatedMemories)}

Return ONLY the JSON object. No other text.`;

  const response = await model.complete({
    systemPrompt: 'You are a memory compression system. Follow the R++ specification exactly. Return only valid JSON.',
    prompt,
    responseFormat: 'json',
    temperature: 0,
    maxTokens: 500,
  });

  return JSON.parse(response.text) as PrecisResult;
}

// ── Rewrite Plan ─────────────────────────────────────────────

export async function rewritePlan(
  model: ModelComplete,
  previousPlan: Plan | null,
  cycleEvents: string[],
  relevantMemories: string[],
  currentCycle: number,
  config: MemoryConfig,
): Promise<Plan> {
  const spec = loadSpec('rewrite-plan.rpp');

  const prompt = `${spec}

INPUT:
previous_plan: ${JSON.stringify(previousPlan)}
cycle_events: ${JSON.stringify(cycleEvents)}
relevant_memories: ${JSON.stringify(relevantMemories)}
plan_categories: ${JSON.stringify(config.planTemplate.categories)}
current_cycle: ${currentCycle}

Return ONLY the JSON object. No other text.`;

  const response = await model.complete({
    systemPrompt: 'You are a planning system for an autonomous agent. Follow the R++ specification exactly. Return only valid JSON.',
    prompt,
    responseFormat: 'json',
    temperature: 0.2,
    maxTokens: 2000,
  });

  const raw = JSON.parse(response.text);

  // Normalize — LLMs sometimes use variant field names
  const plan: Plan = {
    cycle: raw.cycle ?? currentCycle,
    strategy: raw.strategy ?? '',
    changes: raw.changes ?? [],
    items: (raw.items ?? []).map((item: any) => ({
      id: item.id ?? randomUUID(),
      text: item.text ?? item.description ?? item.title ?? item.task ?? '',
      status: item.status ?? 'pending',
      priority: item.priority ?? 3,
      category: item.category,
      added_cycle: item.added_cycle ?? currentCycle,
      completed_cycle: item.completed_cycle ?? null,
    })),
  };

  // Drop items with empty text
  plan.items = plan.items.filter((item: PlanItem) => item.text.length > 0);

  return plan;
}

// ── Identify Edges ──────────────────────────────────────────

export interface EdgeResult {
  to_id: string;
  type: 'caused' | 'contradicts' | 'preceded' | 'reinforced' | 'related';
  weight: number;
  reason: string;
}

export async function identifyEdges(
  model: ModelComplete,
  newMemory: string,
  existingMemories: { id: string; content: string }[],
): Promise<EdgeResult[]> {
  if (existingMemories.length === 0) return [];

  const spec = loadSpec('identify-edges.rpp');

  const prompt = `${spec}

INPUT:
new_memory: "${newMemory}"
existing_memories: ${JSON.stringify(existingMemories.map(m => ({ id: m.id, content: m.content })))}

Return ONLY the JSON object. No other text.`;

  const response = await model.complete({
    systemPrompt: 'You identify typed relationships between memories. Return only valid JSON.',
    prompt,
    responseFormat: 'json',
    temperature: 0,
    maxTokens: 1000,
  });

  const raw = JSON.parse(response.text);
  const edges: EdgeResult[] = (raw.edges ?? [])
    .filter((e: any) => e.to_id && e.type && e.weight >= 0.6)
    .map((e: any) => ({
      to_id: e.to_id,
      type: e.type,
      weight: Math.min(1, Math.max(0, e.weight)),
      reason: e.reason ?? '',
    }));

  return edges;
}
