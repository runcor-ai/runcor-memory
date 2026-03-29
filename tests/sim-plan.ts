/**
 * PLAN EVOLUTION — Watch the agent's plan change over 20 cycles
 *
 * Events happen, memories form, and the plan adapts.
 * Shows the full pipeline: events → memories → plan rewrite.
 */

import OpenAI from 'openai';
import { MemoryDatabase } from '../src/database.js';
import { MemorySystem } from '../src/memory-system.js';
import type { ModelComplete, Plan } from '../src/llm.js';
import type { MemoryConfig } from '../src/types.js';
import { DEFAULT_CONFIG } from '../src/types.js';
import { unlinkSync, existsSync } from 'node:fs';

function createModel(apiKey: string): ModelComplete {
  const client = new OpenAI({ apiKey });
  return {
    async complete(request) {
      const response = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: request.maxTokens ?? 2000,
        temperature: request.temperature ?? 0,
        messages: [
          { role: 'system', content: request.systemPrompt ?? '' },
          { role: 'user', content: request.prompt ?? '' },
        ],
        response_format: request.responseFormat === 'json' ? { type: 'json_object' } : undefined,
      });
      return { text: response.choices[0].message.content ?? '' };
    },
  };
}

const config: Partial<MemoryConfig> = {
  tau: 20,
  durability: 5,
  promoteThreshold: 0.6,
  forgetThreshold: 0.05,
  compression: {
    preserve: [
      'monetary amounts above $100 representing revenue, loss, or debt',
      'client and partner names involved in contracts or disputes',
      'credit risk signals such as missed payments, defaults, bankruptcy',
      'revenue figures and financial performance metrics',
      'strategic decisions and pivots',
    ],
    discard: [
      'routine daily greetings and small talk',
      'routine admin tasks: password changes, backups, config updates',
      'personal reminders unrelated to business',
      'spam and unsolicited communications',
      'infrastructure maintenance with no business impact',
    ],
    precisStyle: 'business summary — lead with impact, include numbers',
  },
  planTemplate: {
    categories: ['strategy', 'operations', 'risk', 'growth'],
    maxItems: 10,
    reviewFrequency: 1,
  },
};

// 20 cycles of CEO events — a realistic first month
type Event = [number, string];

const events: Event[] = [
  [1,  'Company founded with $50,000 seed capital'],
  [1,  'Set up Stripe payment processing'],
  [2,  'Researched competitor landscape: 3 similar products at $29-$79 price range'],
  [3,  'Decided to target mid-market with Premium Widget at $49.99'],
  [4,  'Launched Premium Widget on Stripe store'],
  [5,  'First sale: Premium Widget sold to individual customer for $49.99'],
  [6,  'Hired marketing runner to handle content and social media'],
  [7,  'Marketing runner published first blog post, 85 views'],
  [8,  'Second Premium Widget sale, $49.99'],
  [9,  'Marketplace partner proposed distribution deal: 30% commission'],
  [10, 'Signed Marketplace Corp as distribution partner, 30% commission on sales'],
  [11, 'Marketplace Corp placed first order: 50 units at $35/unit wholesale = $1,750'],
  [12, 'Blog post about product benefits, 220 views — best performing yet'],
  [13, 'Third direct sale + Marketplace order shipped'],
  [14, 'Customer email: "Widget quality is excellent, will recommend to team"'],
  [15, 'Monthly revenue: $2,100 (direct $150, Marketplace $1,750, blog leads $200)'],
  [16, 'Marketplace Corp payment due today — not received'],
  [17, 'Followed up with Marketplace Corp — "payment processing, will send tomorrow"'],
  [18, 'Still no payment from Marketplace Corp. $1,750 overdue.'],
  [19, 'New lead from blog: enterprise company interested in bulk pricing'],
  [20, 'Enterprise lead wants quote for 500 units/month at volume discount'],
];

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) { console.error('Set OPENAI_API_KEY'); process.exit(1); }

  const model = createModel(apiKey);
  const dbPath = './sim-plan.db';
  if (existsSync(dbPath)) unlinkSync(dbPath);

  const db = new MemoryDatabase(dbPath);
  const mem = new MemorySystem({
    db, config, openaiApiKey: apiKey, model,
    agentRole: 'CEO of a newly founded autonomous company selling Premium Widgets',
  });

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log(' PLAN EVOLUTION — 20 Cycles of a CEO\'s First Month');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('');

  const planSnapshots: { cycle: number; plan: Plan }[] = [];

  for (let cycle = 1; cycle <= 20; cycle++) {
    mem.setCycle(cycle);

    // Record events for this cycle
    const cycleEvents = events.filter(e => e[0] === cycle);
    for (const [, content] of cycleEvents) {
      await mem.record(content, { source: 'ceo' });
    }

    // Run cycle
    const report = await mem.cycle();

    if (report.plan) {
      planSnapshots.push({ cycle, plan: report.plan });
      console.log(` Cycle ${String(cycle).padStart(2)}: plan updated (${report.plan.items.length} items)`);
    } else {
      console.log(` Cycle ${String(cycle).padStart(2)}: no events, no plan update`);
    }

    // Log promotions
    for (const p of report.promoted) {
      console.log(`           PROMOTED → "${p.precis.slice(0, 55)}..."`);
    }
  }

  // ── TABLE 1: Plan evolution ──
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log(' TABLE 1: PLAN AT KEY MOMENTS');
  console.log('═══════════════════════════════════════════════════════════════════════════');

  // Show plan at cycles 1, 5, 10, 15, 20
  const showCycles = [1, 5, 10, 15, 20];
  for (const targetCycle of showCycles) {
    // Find the latest plan at or before this cycle
    const snap = [...planSnapshots].reverse().find(s => s.cycle <= targetCycle);
    if (!snap) continue;

    console.log('');
    console.log(` ── CYCLE ${snap.cycle} ──`);
    console.log(` Strategy: "${snap.plan.strategy}"`);
    console.log('');
    console.log(' Pri | Status  | Task');
    console.log(' ----+---------+------------------------------------------------------');
    for (const item of snap.plan.items.sort((a, b) => a.priority - b.priority)) {
      const status = item.status.padEnd(7);
      console.log(` ${String(item.priority).padStart(3)} | ${status} | ${(item.text ?? '(no text)').slice(0, 54)}`);
    }
    if (snap.plan.changes.length > 0) {
      console.log('');
      console.log(' Changes:');
      for (const c of snap.plan.changes) {
        console.log(`   • ${c}`);
      }
    }
  }

  // ── TABLE 2: Strategy evolution ──
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log(' TABLE 2: STRATEGY EVOLUTION');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('');

  for (const snap of planSnapshots) {
    const short = snap.plan.strategy.length > 80
      ? snap.plan.strategy.slice(0, 77) + '...'
      : snap.plan.strategy;
    console.log(` Cycle ${String(snap.cycle).padStart(2)}: "${short}"`);
  }

  // ── TABLE 3: Task tracking ──
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log(' TABLE 3: TASK STATUS OVER TIME');
  console.log('');
  console.log(' Tracks how tasks appear, progress, and complete across plans.');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('');

  // Collect all unique tasks across all plans
  const taskHistory = new Map<string, { text: string; statuses: Map<number, string> }>();
  for (const snap of planSnapshots) {
    for (const item of snap.plan.items) {
      const key = item.id;
      if (!taskHistory.has(key)) {
        taskHistory.set(key, { text: item.text, statuses: new Map() });
      }
      taskHistory.get(key)!.statuses.set(snap.cycle, item.status);
    }
  }

  // Print task lifecycle
  const planCycles = planSnapshots.map(s => s.cycle);
  let hdr = ' Task'.padEnd(45) + '|';
  for (const c of planCycles) hdr += ` ${String(c).padStart(2)} |`;
  console.log(hdr);
  console.log('-'.repeat(hdr.length));

  for (const [, info] of taskHistory) {
    const text = info.text ?? '(no text)';
    const label = text.length > 42 ? text.slice(0, 39) + '...' : text;
    let row = ` ${label.padEnd(44)}|`;
    for (const c of planCycles) {
      const s = info.statuses.get(c);
      if (!s) {
        row += '    |';
      } else if (s === 'done') {
        row += '  ✓ |';
      } else if (s === 'active') {
        row += '  ● |';
      } else if (s === 'blocked') {
        row += '  ✗ |';
      } else {
        row += '  ○ |';
      }
    }
    console.log(row);
  }
  console.log('');
  console.log(' ○ = pending, ● = active, ✓ = done, ✗ = blocked');

  // ── TABLE 4: Final memory state ──
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log(' TABLE 4: MEMORY STATE AT CYCLE 20');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('');

  const short = mem.getShortTerm().sort((a, b) => b.M - a.M);
  const long = mem.getLongTerm().sort((a, b) => b.M - a.M);

  console.log(` Short-term: ${short.length} memories`);
  for (const n of short) {
    const label = n.content.length > 55 ? n.content.slice(0, 52) + '...' : n.content;
    console.log(`   M=${n.M.toFixed(2).padStart(5)} R=${n.R.toFixed(2)} f=${n.f} | ${label}`);
  }
  console.log('');
  console.log(` Long-term: ${long.length} memories`);
  for (const n of long) {
    const label = n.content.length > 55 ? n.content.slice(0, 52) + '...' : n.content;
    console.log(`   M=${n.M.toFixed(2).padStart(5)} R=${n.R.toFixed(2)} f=${n.f} | ${label}`);
  }

  console.log('');
  db.close();
  if (existsSync(dbPath)) unlinkSync(dbPath);
}

main().catch((err) => {
  console.error('Simulation failed:', err);
  process.exit(1);
});
