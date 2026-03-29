/**
 * PROMOTION THRESHOLD COMPARISON
 *
 * Same events, same tau=20, same durability=5.
 * Only the promote_threshold changes:
 *
 *   0.4  → Aggressive — promote early, even single high-R events
 *   0.6  → Moderate — needs some reinforcement or very high R
 *   0.8  → Selective — needs reinforcement + relevance
 *   1.2  → Strict — only heavily reinforced patterns make it
 *
 * Shows: how many memories get promoted, what survives, and
 * how the short/long split changes the agent's knowledge at cycle 100.
 */

import OpenAI from 'openai';
import { MemoryDatabase } from '../src/database.js';
import { MemorySystem } from '../src/memory-system.js';
import type { ModelComplete } from '../src/llm.js';
import { scoreRelevance } from '../src/llm.js';
import type { MemoryConfig, MemoryNode } from '../src/types.js';
import { DEFAULT_CONFIG } from '../src/types.js';
import { unlinkSync, existsSync } from 'node:fs';

function createModel(apiKey: string): ModelComplete {
  const client = new OpenAI({ apiKey });
  return {
    async complete(request) {
      const response = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: request.maxTokens ?? 1000,
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

const baseConfig: Partial<MemoryConfig> = {
  tau: 20,
  durability: 5,
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
};

type Event = [number, string, string[]];

const events: Event[] = [
  [1,  'Company founded with $50,000 seed capital',                ['founding']],
  [2,  'Checked email, nothing important',                         ['routine']],
  [3,  'Blog post about AI trends published, 200 views',          ['marketing']],
  [5,  'Marketplace partner missed first payment of $2,400',       ['risk']],
  [7,  'Updated the company website favicon',                      ['routine']],
  [8,  'New product launched: Premium Widget at $49.99',           ['product']],
  [10, 'Monthly revenue: $5,000 — growth trend continuing',       ['revenue']],
  [10, 'Slack channel reorganized',                                ['routine']],
  [12, 'Hired a new marketing runner',                             ['team']],
  [15, 'Marketplace partner missed second payment, $4,800 overdue',['risk']],
  [20, 'Blog post about productivity tips, 450 views',            ['marketing']],
  [22, 'Monthly revenue: $8,200 — growth trend continuing',       ['revenue']],
  [25, 'Office wifi was slow this morning',                        ['routine']],
  [30, 'Marketplace partner declared bankruptcy, $4,800 written off',['loss']],
  [35, 'Premium Widget sales: 120 units this month',              ['revenue']],
  [38, 'Monthly revenue: $12,500 — growth trend continuing',      ['revenue']],
  [40, 'Ran standard monthly backup',                              ['routine']],
  [45, 'Updated pricing strategy: 15% increase on widgets',       ['strategy']],
  [50, 'New enterprise client signed: $10,000/month contract',    ['revenue']],
  [52, 'Monthly revenue: $18,000 — growth trend continuing',      ['revenue']],
  [55, 'Calendar reminder: dentist appointment',                   ['personal']],
  [60, 'Blog post about company culture, 180 views',              ['marketing']],
  [65, 'Updated password for admin panel',                         ['routine']],
  [68, 'Monthly revenue: $28,000 — growth trend continuing',      ['revenue']],
  [70, 'Server outage lasted 4 hours, lost $3,200 in orders',    ['incident']],
  [75, 'Q3 revenue report: $42,000 total',                        ['revenue']],
  [80, 'Cleaned up old git branches',                              ['routine']],
  [85, 'Customer satisfaction survey: 4.2/5 average',             ['feedback']],
  [90, 'Spam email about cloud migration',                         ['noise']],
];

events.sort((a, b) => a[0] - b[0]);

const queries: [number, string][] = [
  [16, 'payment defaults and credit risk'],
  [31, 'marketplace losses and write-offs'],
  [51, 'enterprise client revenue'],
  [71, 'server incidents and downtime'],
  [76, 'total revenue and financial performance'],
];

const THRESHOLDS = [0.4, 0.6, 0.8, 1.2];

// Score once, reuse
async function scoreAll(model: ModelComplete): Promise<Map<string, number>> {
  const scores = new Map<string, number>();
  const unique = [...new Set(events.map(e => e[1]))];
  for (const text of unique) {
    const result = await scoreRelevance(model, text, { ...DEFAULT_CONFIG, ...baseConfig } as MemoryConfig, 'CEO of an autonomous company');
    scores.set(text, result.score);
  }
  return scores;
}

interface RunResult {
  threshold: number;
  promotions: { cycle: number; original: string; precis: string; R: number; f: number }[];
  finalShort: MemoryNode[];
  finalLong: MemoryNode[];
  totalCreated: number;
  // Track when promotions happened
  promotionCycles: number[];
  // Snapshots at checkpoints
  snapshots: { cycle: number; short: number; long: number }[];
}

async function runWithThreshold(
  threshold: number,
  scores: Map<string, number>,
  model: ModelComplete,
  apiKey: string,
): Promise<RunResult> {
  const dbPath = `./sim-thresh-${threshold}.db`;
  if (existsSync(dbPath)) unlinkSync(dbPath);

  const db = new MemoryDatabase(dbPath);
  const mem = new MemorySystem({
    db,
    config: { ...baseConfig, promoteThreshold: threshold },
    openaiApiKey: apiKey,
    model,
    agentRole: 'CEO of an autonomous company',
  });

  const eventsByCycle = new Map<number, Event[]>();
  for (const e of events) {
    const list = eventsByCycle.get(e[0]) ?? [];
    list.push(e);
    eventsByCycle.set(e[0], list);
  }
  const queriesByCycle = new Map<number, string>();
  for (const [c, q] of queries) queriesByCycle.set(c, q);

  const result: RunResult = {
    threshold,
    promotions: [],
    finalShort: [],
    finalLong: [],
    totalCreated: 0,
    promotionCycles: [],
    snapshots: [],
  };

  const checkpoints = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

  for (let cycle = 1; cycle <= 100; cycle++) {
    mem.setCycle(cycle);

    const cycleEvents = eventsByCycle.get(cycle) ?? [];
    for (const [, content, tags] of cycleEvents) {
      const R = scores.get(content) ?? 0.5;
      const r = await mem.record(content, { source: 'ceo', tags, R });
      if (r.action === 'created') result.totalCreated++;
    }

    const queryText = queriesByCycle.get(cycle);
    if (queryText) await mem.query(queryText, 3);

    const report = await mem.cycle();

    for (const p of report.promoted) {
      const node = mem.getNode(p.id);
      result.promotions.push({
        cycle: report.cycle,
        original: p.originalContent,
        precis: p.precis,
        R: node?.R ?? 0,
        f: node?.f ?? 1,
      });
      result.promotionCycles.push(report.cycle);
    }

    if (checkpoints.includes(cycle)) {
      result.snapshots.push({
        cycle,
        short: mem.getShortTerm().length,
        long: mem.getLongTerm().length,
      });
    }
  }

  result.finalShort = mem.getShortTerm().sort((a, b) => b.M - a.M);
  result.finalLong = mem.getLongTerm().sort((a, b) => b.M - a.M);

  db.close();
  if (existsSync(dbPath)) unlinkSync(dbPath);
  return result;
}

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) { console.error('Set OPENAI_API_KEY'); process.exit(1); }

  const model = createModel(apiKey);

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log(' PROMOTION THRESHOLD COMPARISON');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log(' Same events, tau=20, durability=5. Only promote_threshold changes.');
  console.log(' Lower threshold = more promotions = more long-term memory.');
  console.log(' Higher threshold = fewer promotions = more forgetting.');
  console.log('');

  // Score once
  process.stdout.write(' Scoring events with LLM...');
  const scores = await scoreAll(model);
  console.log(' done\n');

  console.log(' R    | Event');
  console.log(' -----+------------------------------------------------------');
  for (const [text, R] of scores) {
    console.log(` ${R.toFixed(2)} | ${text.slice(0, 54)}`);
  }

  // Run all thresholds
  const results: RunResult[] = [];
  for (const t of THRESHOLDS) {
    process.stdout.write(` Running threshold=${t}...`);
    const r = await runWithThreshold(t, scores, model, apiKey);
    results.push(r);
    console.log(` done (${r.promotions.length} promoted, ${r.finalShort.length}S + ${r.finalLong.length}L surviving)`);
  }

  // ── TABLE 1: Cube sizes over time ──
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════');
  console.log(' TABLE 1: SHORT-TERM / LONG-TERM SPLIT OVER TIME');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════');
  console.log('');

  let hdr = ' Cycle |';
  for (const r of results) hdr += `  t=${r.threshold.toFixed(1)} S/L  |`;
  console.log(hdr);
  console.log(' ------+' + results.map(() => '-------------+').join(''));

  const checkpoints = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  for (const cp of checkpoints) {
    let row = ` ${String(cp).padStart(5)} |`;
    for (const r of results) {
      const snap = r.snapshots.find(s => s.cycle === cp);
      if (snap) {
        row += `   ${String(snap.short).padStart(2)}S / ${String(snap.long).padStart(2)}L  |`;
      } else {
        row += '      ?      |';
      }
    }
    console.log(row);
  }

  // ── TABLE 2: What got promoted per threshold ──
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════');
  console.log(' TABLE 2: PROMOTIONS PER THRESHOLD');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════');

  for (const r of results) {
    console.log('');
    console.log(` ── threshold=${r.threshold} (${r.promotions.length} promotions) ──`);
    if (r.promotions.length === 0) {
      console.log('   (nothing was promoted)');
    } else {
      console.log('   Cycle | R    | f  | Original → Précis');
      console.log('   ------+------+----+------------------------------------------------------');
      for (const p of r.promotions) {
        const orig = p.original.length > 42 ? p.original.slice(0, 39) + '...' : p.original;
        const prec = p.precis.length > 42 ? p.precis.slice(0, 39) + '...' : p.precis;
        console.log(`   ${String(p.cycle).padStart(5)} | ${p.R.toFixed(2)} | ${String(p.f).padStart(2)} | "${orig}"`);
        console.log(`         |      |    |   → "${prec}"`);
      }
    }
  }

  // ── TABLE 3: Final state per threshold ──
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════');
  console.log(' TABLE 3: WHAT THE AGENT REMEMBERS AT CYCLE 100');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════');

  for (const r of results) {
    console.log('');
    console.log(` ── threshold=${r.threshold} ──`);

    if (r.finalLong.length > 0) {
      console.log(`   LONG-TERM (${r.finalLong.length}):`);
      for (const n of r.finalLong) {
        const label = n.content.length > 50 ? n.content.slice(0, 47) + '...' : n.content;
        console.log(`     M=${n.M.toFixed(2).padStart(5)} R=${n.R.toFixed(2)} f=${n.f} | "${label}"`);
      }
    }

    if (r.finalShort.length > 0) {
      console.log(`   SHORT-TERM (${r.finalShort.length}):`);
      for (const n of r.finalShort) {
        const label = n.content.length > 50 ? n.content.slice(0, 47) + '...' : n.content;
        console.log(`     M=${n.M.toFixed(2).padStart(5)} R=${n.R.toFixed(2)} f=${n.f} | "${label}"`);
      }
    }

    if (r.finalLong.length === 0 && r.finalShort.length === 0) {
      console.log('   (nothing survived)');
    }
  }

  // ── TABLE 4: Summary comparison ──
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════');
  console.log(' TABLE 4: SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════');
  console.log('');

  let hdr4 = ' Metric                          |';
  for (const r of results) hdr4 += ` t=${r.threshold.toFixed(1).padStart(3)} |`;
  console.log(hdr4);
  console.log(' --------------------------------+' + results.map(() => '-------+').join(''));

  const metrics: [string, (r: RunResult) => string][] = [
    ['Total events recorded',     r => String(r.totalCreated)],
    ['Promotions',                r => String(r.promotions.length)],
    ['Final short-term',          r => String(r.finalShort.length)],
    ['Final long-term',           r => String(r.finalLong.length)],
    ['Total surviving',           r => String(r.finalShort.length + r.finalLong.length)],
    ['Total forgotten',           r => String(r.totalCreated - r.finalShort.length - r.finalLong.length)],
    ['Forgotten %',               r => ((r.totalCreated - r.finalShort.length - r.finalLong.length) / r.totalCreated * 100).toFixed(0) + '%'],
    ['Avg M (long-term)',         r => r.finalLong.length > 0 ? (r.finalLong.reduce((a, n) => a + n.M, 0) / r.finalLong.length).toFixed(2) : 'n/a'],
    ['Avg M (short-term)',        r => r.finalShort.length > 0 ? (r.finalShort.reduce((a, n) => a + n.M, 0) / r.finalShort.length).toFixed(2) : 'n/a'],
    ['First promotion cycle',     r => r.promotionCycles.length > 0 ? String(Math.min(...r.promotionCycles)) : 'n/a'],
    ['Last promotion cycle',      r => r.promotionCycles.length > 0 ? String(Math.max(...r.promotionCycles)) : 'n/a'],
  ];

  for (const [name, fn] of metrics) {
    let row = ` ${name.padEnd(32)}|`;
    for (const r of results) {
      row += ` ${fn(r).padStart(5)} |`;
    }
    console.log(row);
  }

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════');
  console.log(' INTERPRETATION');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log(' threshold=0.4 (Aggressive)');
  console.log('   Promotes early. Even a single high-R event can make it to long-term.');
  console.log('   More durable memory, but includes unproven one-off events.');
  console.log('   Good for: lawyers, compliance — where forgetting is dangerous.');
  console.log('');
  console.log(' threshold=0.6 (Moderate)');
  console.log('   Needs some evidence — either high R + access, or moderate R + reinforcement.');
  console.log('   Balanced between preservation and selectivity.');
  console.log('   Good for: CEOs, project managers — remembers what matters.');
  console.log('');
  console.log(' threshold=0.8 (Selective)');
  console.log('   Requires reinforcement. One-off events stay short-term and may decay.');
  console.log('   Only proven patterns earn long-term status.');
  console.log('   Good for: analysts, strategists — pattern-focused memory.');
  console.log('');
  console.log(' threshold=1.2 (Strict)');
  console.log('   Very hard to promote. Needs heavy reinforcement + high relevance.');
  console.log('   Long-term memory stays lean. Most knowledge is ephemeral.');
  console.log('   Good for: high-frequency runners where only the strongest signals matter.');
  console.log('');
}

main().catch((err) => {
  console.error('Simulation failed:', err);
  process.exit(1);
});
