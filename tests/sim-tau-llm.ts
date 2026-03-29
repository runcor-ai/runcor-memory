/**
 * 100-CYCLE TAU COMPARISON — WITH LLM-SCORED RELEVANCE
 *
 * Same scenario as before, but now R is scored by the LLM using
 * the r++ score-relevance spec instead of being hardcoded.
 *
 * This proves the full pipeline:
 *   Event → LLM scores R via r++ spec → stored in short-term cube →
 *   formula calculates M → cycle decays → forget/survive
 */

import OpenAI from 'openai';
import { MemoryDatabase } from '../src/database.js';
import { ShortTermCube } from '../src/cube.js';
import { scoreRelevance } from '../src/llm.js';
import type { ModelComplete } from '../src/llm.js';
import type { MemoryConfig } from '../src/types.js';
import { DEFAULT_CONFIG } from '../src/types.js';
import { unlinkSync, existsSync } from 'node:fs';

// ── Model adapter ────────────────────────────────────────────

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

// ── Config ───────────────────────────────────────────────────

const config: MemoryConfig = {
  ...DEFAULT_CONFIG,
  compression: {
    preserve: [
      'monetary amounts above $100 representing revenue, loss, or debt',
      'client and partner names involved in contracts or disputes',
      'credit risk signals such as missed payments, defaults, bankruptcy',
      'revenue figures and financial performance metrics',
      'commitments, deadlines, and contractual obligations',
    ],
    discard: [
      'routine daily greetings and small talk',
      'intermediate reasoning steps and thought process',
      'process descriptions that have not changed',
      'routine admin tasks: password changes, backups, config updates, branch cleanup',
      'personal reminders and appointments unrelated to business',
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

// ── Events ───────────────────────────────────────────────────
// Same 25 events. R is NO LONGER hardcoded — the LLM will score each one.

type Event = [number, string, string[]];

const events: Event[] = [
  [1,  'Company founded with $50,000 seed capital',                ['founding']],
  [5,  'Marketplace partner missed first payment of $2,400',       ['risk']],
  [15, 'Marketplace partner missed second payment, $4,800 overdue',['risk']],
  [30, 'Marketplace partner declared bankruptcy, $4,800 written off',['loss']],
  [50, 'New enterprise client signed: $10,000/month contract',     ['revenue']],
  [70, 'Server outage lasted 4 hours, lost $3,200 in orders',     ['incident']],
  [3,  'Blog post about AI trends published, 200 views',          ['marketing']],
  [8,  'New product launched: Premium Widget at $49.99',           ['product']],
  [12, 'Hired a new marketing runner',                             ['team']],
  [20, 'Blog post about productivity tips, 450 views',            ['marketing']],
  [35, 'Premium Widget sales: 120 units this month',              ['revenue']],
  [45, 'Updated pricing strategy: 15% increase on widgets',       ['strategy']],
  [60, 'Blog post about company culture, 180 views',              ['marketing']],
  [75, 'Q3 revenue report: $42,000 total',                        ['revenue']],
  [85, 'Customer satisfaction survey: 4.2/5 average',             ['feedback']],
  [2,  'Checked email, nothing important',                         ['routine']],
  [7,  'Updated the company website favicon',                      ['routine']],
  [10, 'Slack channel reorganized',                                ['routine']],
  [25, 'Office wifi was slow this morning',                        ['routine']],
  [40, 'Ran standard monthly backup',                              ['routine']],
  [55, 'Calendar reminder: dentist appointment',                   ['personal']],
  [65, 'Updated password for admin panel',                         ['routine']],
  [80, 'Cleaned up old git branches',                              ['routine']],
  [90, 'Spam email about cloud migration',                         ['noise']],
  // Recurring revenue pattern — 5 events
  [10, 'Monthly revenue: $5,000 — growth trend continuing',       ['revenue']],
  [22, 'Monthly revenue: $8,200 — growth trend continuing',       ['revenue']],
  [38, 'Monthly revenue: $12,500 — growth trend continuing',      ['revenue']],
  [52, 'Monthly revenue: $18,000 — growth trend continuing',      ['revenue']],
  [68, 'Monthly revenue: $28,000 — growth trend continuing',      ['revenue']],
];

const queries: [number, string][] = [
  [16, 'payment defaults and credit risk'],
  [31, 'marketplace losses and write-offs'],
  [51, 'enterprise client revenue'],
  [71, 'server incidents and downtime'],
  [76, 'total revenue and financial performance'],
];

events.sort((a, b) => a[0] - b[0]);

const TAU_VALUES = [10, 20, 40, 80];

// ── Score all events with LLM first (one pass, reuse across all tau runs) ──

async function scoreAllEvents(model: ModelComplete): Promise<Map<string, number>> {
  const scores = new Map<string, number>();
  const unique = [...new Set(events.map(e => e[1]))];

  console.log(` Scoring ${unique.length} unique events with LLM...\n`);
  console.log(' R     | Event');
  console.log(' ------+------------------------------------------------------');

  for (const text of unique) {
    const result = await scoreRelevance(model, text, config, 'CEO of an autonomous company');
    scores.set(text, result.score);
    console.log(` ${result.score.toFixed(2).padStart(5)}| ${text.slice(0, 54)}`);
  }

  return scores;
}

// ── Run simulation for one tau value ─────────────────────────

interface RunResult {
  tau: number;
  survived: { label: string; R: number; f: number; M: number }[];
  forgotten: { label: string; R: number; diedAtCycle: number }[];
  alivePerCheckpoint: Map<number, number>;
}

async function runWithTau(tau: number, scores: Map<string, number>): Promise<RunResult> {
  const dbPath = `./sim-llm-tau-${tau}.db`;
  if (existsSync(dbPath)) unlinkSync(dbPath);

  const db = new MemoryDatabase(dbPath);
  const cube = new ShortTermCube(db, {
    tau,
    forgetThreshold: 0.05,
    promoteThreshold: 2.0,
  }, process.env.OPENAI_API_KEY);

  const eventsByCycle = new Map<number, Event[]>();
  for (const e of events) {
    const list = eventsByCycle.get(e[0]) ?? [];
    list.push(e);
    eventsByCycle.set(e[0], list);
  }
  const queriesByCycle = new Map<number, string>();
  for (const [c, q] of queries) queriesByCycle.set(c, q);

  const nodeInfo = new Map<string, { label: string; R: number; diedAtCycle: number | null }>();
  const alivePerCheckpoint = new Map<number, number>();

  for (let cycle = 1; cycle <= 100; cycle++) {
    cube.setCycle(cycle);

    const cycleEvents = eventsByCycle.get(cycle) ?? [];
    for (const [, content, tags] of cycleEvents) {
      const R = scores.get(content) ?? 0.5;
      const result = await cube.record(content, { source: 'ceo', tags, R });
      if (result.action === 'created') {
        nodeInfo.set(result.nodeId, {
          label: content.length > 55 ? content.slice(0, 52) + '...' : content,
          R,
          diedAtCycle: null,
        });
      }
    }

    const queryText = queriesByCycle.get(cycle);
    if (queryText) await cube.query(queryText, 3);

    const report = cube.cycle();

    for (const fid of report.forgotten) {
      const info = nodeInfo.get(fid);
      if (info) info.diedAtCycle = cycle;
    }

    if (cycle % 5 === 0) {
      alivePerCheckpoint.set(cycle, cube.getAll().length);
    }
  }

  const finalNodes = cube.getAll();
  const finalIds = new Set(finalNodes.map(n => n.id));

  const survived = finalNodes.map(n => {
    const info = nodeInfo.get(n.id)!;
    return { label: info.label, R: info.R, f: n.f, M: n.M };
  }).sort((a, b) => b.M - a.M);

  const forgotten = [...nodeInfo.entries()]
    .filter(([id]) => !finalIds.has(id))
    .map(([, info]) => ({ label: info.label, R: info.R, diedAtCycle: info.diedAtCycle! }))
    .sort((a, b) => a.diedAtCycle - b.diedAtCycle);

  db.close();
  if (existsSync(dbPath)) unlinkSync(dbPath);

  return { tau, survived, forgotten, alivePerCheckpoint };
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) { console.error('Set OPENAI_API_KEY'); process.exit(1); }

  const model = createModel(apiKey);

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log(' TAU COMPARISON — LLM-SCORED RELEVANCE (R)');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log(' Same 25 events, but R is scored by the LLM using the r++ spec.');
  console.log(' Previously R was hardcoded. Now the full pipeline runs end-to-end:');
  console.log(' Event → r++ spec → LLM scores R → formula → decay → forget/survive');
  console.log('');

  // Score all events once
  const scores = await scoreAllEvents(model);

  console.log('');

  // Run all tau values
  const results: RunResult[] = [];
  for (const tau of TAU_VALUES) {
    process.stdout.write(` Running tau=${tau}...`);
    const r = await runWithTau(tau, scores);
    results.push(r);
    console.log(` done (${r.survived.length} survived, ${r.forgotten.length} forgotten)`);
  }

  const checkpoints = Array.from({ length: 20 }, (_, i) => (i + 1) * 5);

  // ── TABLE 1: Alive count ──
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log(' TABLE 1: MEMORIES ALIVE AT EACH CHECKPOINT');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('');

  let hdr = ' Cycle |';
  for (const r of results) hdr += ` tau=${String(r.tau).padStart(2)} |`;
  console.log(hdr);
  console.log(' ------+' + results.map(() => '-------+').join(''));

  for (const cp of checkpoints) {
    let row = ` ${String(cp).padStart(5)} |`;
    for (const r of results) {
      const count = r.alivePerCheckpoint.get(cp) ?? 0;
      row += ` ${String(count).padStart(5)} |`;
    }
    console.log(row);
  }

  // ── TABLE 2: What survived ──
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log(' TABLE 2: WHAT SURVIVED TO CYCLE 100');
  console.log('═══════════════════════════════════════════════════════════════════════════');

  for (const r of results) {
    console.log('');
    console.log(` ── tau=${r.tau} (${r.survived.length} memories survived) ──`);
    if (r.survived.length === 0) {
      console.log('   (nothing survived)');
    } else {
      console.log('   M     | R    | f  | Event');
      console.log('   ------+------+----+--------------------------------------------------');
      for (const s of r.survived) {
        console.log(`   ${s.M.toFixed(2).padStart(5)} | ${s.R.toFixed(2)} | ${String(s.f).padStart(2)} | ${s.label}`);
      }
    }
  }

  // ── TABLE 3: When each memory died ──
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log(' TABLE 3: WHEN EACH MEMORY WAS FORGOTTEN (cycle number)');
  console.log(' "—" = still alive at cycle 100');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('');

  const allLabels: string[] = [];
  const labelSet = new Set<string>();
  for (const r of results) {
    for (const s of r.survived) { if (!labelSet.has(s.label)) { allLabels.push(s.label); labelSet.add(s.label); } }
    for (const f of r.forgotten) { if (!labelSet.has(f.label)) { allLabels.push(f.label); labelSet.add(f.label); } }
  }

  const deathMap = new Map<number, Map<string, number | null>>();
  for (const r of results) {
    const m = new Map<string, number | null>();
    for (const s of r.survived) m.set(s.label, null);
    for (const f of r.forgotten) m.set(f.label, f.diedAtCycle);
    deathMap.set(r.tau, m);
  }

  const labelRMap = new Map<string, number>();
  for (const r of results) {
    for (const s of r.survived) labelRMap.set(s.label, s.R);
    for (const f of r.forgotten) labelRMap.set(f.label, f.R);
  }

  allLabels.sort((a, b) => {
    const rDiff = (labelRMap.get(b) ?? 0) - (labelRMap.get(a) ?? 0);
    if (rDiff !== 0) return rDiff;
    const aMin = Math.min(...results.map(r => deathMap.get(r.tau)?.get(a) ?? 999));
    const bMin = Math.min(...results.map(r => deathMap.get(r.tau)?.get(b) ?? 999));
    return aMin - bMin;
  });

  let hdr3 = ' R    | Event'.padEnd(62) + '|';
  for (const r of results) hdr3 += ` tau=${String(r.tau).padStart(2)} |`;
  console.log(hdr3);
  console.log('-'.repeat(hdr3.length));

  for (const label of allLabels) {
    const R = labelRMap.get(label) ?? 0;
    let row = ` ${R.toFixed(2)} | ${label.padEnd(55)}|`;
    for (const r of results) {
      const death = deathMap.get(r.tau)?.get(label);
      if (death === null || death === undefined) {
        row += '    — |';
      } else {
        row += ` ${String(death).padStart(4)} |`;
      }
    }
    console.log(row);
  }

  // ── TABLE 4: Summary ──
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log(' TABLE 4: SUMMARY COMPARISON');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log(' Metric                          | tau=10 | tau=20 | tau=40 | tau=80 |');
  console.log(' --------------------------------+--------+--------+--------+--------+');

  const metrics: [string, (r: RunResult) => string][] = [
    ['Total survived',            r => String(r.survived.length)],
    ['Total forgotten',           r => String(r.forgotten.length)],
    ['Survival rate',             r => ((r.survived.length / allLabels.length) * 100).toFixed(0) + '%'],
    ['Noise survived (R≤0.3)',    r => String(r.survived.filter(s => s.R <= 0.3).length)],
    ['Critical survived (R≥0.8)', r => String(r.survived.filter(s => s.R >= 0.8).length)],
    ['Reinforced survived (f>1)', r => String(r.survived.filter(s => s.f > 1).length)],
    ['Peak alive count',          r => String(Math.max(...r.alivePerCheckpoint.values()))],
    ['Final alive count',         r => String(r.alivePerCheckpoint.get(100) ?? 0)],
  ];

  for (const [name, fn] of metrics) {
    let row = ` ${name.padEnd(32)}|`;
    for (const r of results) {
      row += ` ${fn(r).padStart(6)} |`;
    }
    console.log(row);
  }

  // ── Comparison note ──
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log(' NOTE: R VALUES ARE NOW LLM-SCORED');
  console.log('');
  console.log(' Previously, R was hardcoded (e.g., payment=0.9, noise=0.2).');
  console.log(' Now the LLM reads the r++ spec and scores each event based on');
  console.log(' the CEO role and the preserve/discard rules in the config.');
  console.log(' This means the formula behaviour may differ from the earlier run');
  console.log(' — the LLM might score some events higher or lower than we assumed.');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('');
}

main().catch((err) => {
  console.error('Simulation failed:', err);
  process.exit(1);
});
