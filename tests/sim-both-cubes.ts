/**
 * BOTH CUBES IN ACTION — Full memory system simulation
 *
 * 100 cycles with both short-term and long-term memory working together:
 *   - New events land in short-term
 *   - LLM scores R via r++ spec
 *   - Formula calculates M each cycle
 *   - Weak memories decay and get forgotten
 *   - Strong memories get promoted to long-term WITH LLM précis compression
 *   - Long-term memories decay much slower (tau * durability)
 *   - Queries hit both cubes
 *
 * This proves the full pipeline end-to-end.
 */

import OpenAI from 'openai';
import { MemoryDatabase } from '../src/database.js';
import { MemorySystem } from '../src/memory-system.js';
import type { ModelComplete } from '../src/llm.js';
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

// Lower promote threshold so we actually see promotions in 100 cycles
const config: Partial<MemoryConfig> = {
  tau: 20,
  durability: 5,               // long-term uses tau*5 = 100
  promoteThreshold: 0.8,       // lowered so reinforced memories can promote
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

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) { console.error('Set OPENAI_API_KEY'); process.exit(1); }

  const model = createModel(apiKey);
  const dbPath = './sim-both-cubes.db';
  if (existsSync(dbPath)) unlinkSync(dbPath);

  const db = new MemoryDatabase(dbPath);
  const mem = new MemorySystem({
    db, config, openaiApiKey: apiKey, model,
    agentRole: 'CEO of an autonomous company',
  });

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log(' BOTH CUBES IN ACTION — Full Memory System');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log(' tau=20, durability=5 (long-term uses tau=100)');
  console.log(' promote > 0.8, forget < 0.05');
  console.log(' LLM scores R and writes promotion précis via r++ specs');
  console.log('');

  const eventsByCycle = new Map<number, Event[]>();
  for (const e of events) {
    const list = eventsByCycle.get(e[0]) ?? [];
    list.push(e);
    eventsByCycle.set(e[0], list);
  }
  const queriesByCycle = new Map<number, string>();
  for (const [c, q] of queries) queriesByCycle.set(c, q);

  // Track for tables
  const promotionLog: { cycle: number; original: string; precis: string; R: number; f: number }[] = [];
  const scoreLog: { content: string; R: number }[] = [];

  // Checkpoint data
  const checkpoints = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
  const snapshots: { cycle: number; short: number; long: number; shortMs: string; longMs: string }[] = [];

  console.log(' Running 100 cycles...\n');

  for (let cycle = 1; cycle <= 100; cycle++) {
    mem.setCycle(cycle);

    // Record events
    const cycleEvents = eventsByCycle.get(cycle) ?? [];
    for (const [, content, tags] of cycleEvents) {
      const result = await mem.record(content, { source: 'ceo', tags });
      if (result.action === 'created' && result.R !== undefined) {
        scoreLog.push({ content, R: result.R });
      }
    }

    // Queries
    const queryText = queriesByCycle.get(cycle);
    if (queryText) await mem.query(queryText, 3);

    // Cycle maintenance
    const report = await mem.cycle();

    // Log promotions
    for (const p of report.promoted) {
      const node = mem.getNode(p.id);
      promotionLog.push({
        cycle: report.cycle,
        original: p.originalContent,
        precis: p.precis,
        R: node?.R ?? 0,
        f: node?.f ?? 1,
      });
      console.log(`   Cycle ${String(report.cycle).padStart(3)}: PROMOTED → "${p.precis.slice(0, 60)}..."`);
    }

    // Snapshots
    if (checkpoints.includes(cycle)) {
      const short = mem.getShortTerm();
      const long = mem.getLongTerm();
      const shortMs = short.map(n => n.M);
      const longMs = long.map(n => n.M);
      snapshots.push({
        cycle,
        short: short.length,
        long: long.length,
        shortMs: shortMs.length > 0 ? `${Math.min(...shortMs).toFixed(3)}-${Math.max(...shortMs).toFixed(3)}` : 'empty',
        longMs: longMs.length > 0 ? `${Math.min(...longMs).toFixed(3)}-${Math.max(...longMs).toFixed(3)}` : 'empty',
      });
    }
  }

  // ── TABLE 1: LLM R Scores ──
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log(' TABLE 1: LLM-SCORED RELEVANCE FOR EACH EVENT');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log('  R    | Event');
  console.log(' ------+------------------------------------------------------');
  for (const s of scoreLog) {
    console.log(` ${s.R.toFixed(2).padStart(5)}| ${s.content.slice(0, 54)}`);
  }

  // ── TABLE 2: Cube sizes over time ──
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log(' TABLE 2: MEMORY CUBE SIZES OVER TIME');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log(' Cycle | Short | Long  | Short M range | Long M range');
  console.log(' ------+-------+-------+---------------+---------------');
  for (const s of snapshots) {
    console.log(` ${String(s.cycle).padStart(5)} | ${String(s.short).padStart(5)} | ${String(s.long).padStart(5)} | ${s.shortMs.padStart(13)} | ${s.longMs.padStart(13)}`);
  }

  // ── TABLE 3: Promotions ──
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log(' TABLE 3: PROMOTIONS — SHORT-TERM → LONG-TERM');
  console.log('');
  console.log(' When a memory\'s M exceeds 0.8, the LLM compresses it');
  console.log(' from episodic (what happened) to semantic (what we know).');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('');

  if (promotionLog.length === 0) {
    console.log(' (no promotions occurred — try lowering promote_threshold)');
  } else {
    console.log(' Cycle | R    | f  | Original → Précis');
    console.log(' ------+------+----+------------------------------------------------------');
    for (const p of promotionLog) {
      const orig = p.original.length > 45 ? p.original.slice(0, 42) + '...' : p.original;
      const prec = p.precis.length > 45 ? p.precis.slice(0, 42) + '...' : p.precis;
      console.log(` ${String(p.cycle).padStart(5)} | ${p.R.toFixed(2)} | ${String(p.f).padStart(2)} | "${orig}"`);
      console.log(`       |      |    |   → "${prec}"`);
    }
  }

  // ── TABLE 4: Final state ──
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log(' TABLE 4: FINAL STATE AT CYCLE 100');
  console.log('═══════════════════════════════════════════════════════════════════════════');

  const finalShort = mem.getShortTerm().sort((a, b) => b.M - a.M);
  const finalLong = mem.getLongTerm().sort((a, b) => b.M - a.M);

  console.log('');
  console.log(` ── SHORT-TERM (${finalShort.length} memories) ──`);
  if (finalShort.length === 0) {
    console.log('   (empty)');
  } else {
    console.log('   M     | R    | f  | t   | D    | Event');
    console.log('   ------+------+----+-----+------+------------------------------------------');
    for (const n of finalShort) {
      const label = n.content.length > 40 ? n.content.slice(0, 37) + '...' : n.content;
      console.log(`   ${n.M.toFixed(2).padStart(5)} | ${n.R.toFixed(2)} | ${String(n.f).padStart(2)} | ${String(n.t).padStart(3)} | ${n.D.toFixed(2)} | ${label}`);
    }
  }

  console.log('');
  console.log(` ── LONG-TERM (${finalLong.length} memories) ──`);
  if (finalLong.length === 0) {
    console.log('   (empty)');
  } else {
    console.log('   M     | R    | f  | t   | D    | Content (compressed précis)');
    console.log('   ------+------+----+-----+------+------------------------------------------');
    for (const n of finalLong) {
      const label = n.content.length > 40 ? n.content.slice(0, 37) + '...' : n.content;
      console.log(`   ${n.M.toFixed(2).padStart(5)} | ${n.R.toFixed(2)} | ${String(n.f).padStart(2)} | ${String(n.t).padStart(3)} | ${n.D.toFixed(2)} | ${label}`);
    }
  }

  // ── TABLE 5: Query test — hit both cubes ──
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log(' TABLE 5: QUERY TEST — SEARCHING BOTH CUBES');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('');

  const testQueries = [
    'revenue growth and financial performance',
    'credit risk and payment defaults',
    'what products do we sell',
  ];

  for (const q of testQueries) {
    const results = await mem.query(q, 3);
    console.log(` Query: "${q}"`);
    for (const r of results) {
      const cube = r.node.cube === 'long' ? 'LONG ' : 'SHORT';
      const label = r.node.content.length > 45 ? r.node.content.slice(0, 42) + '...' : r.node.content;
      console.log(`   ${cube} | sim=${r.similarity.toFixed(3)} | M=${r.node.M.toFixed(3)} | "${label}"`);
    }
    console.log('');
  }

  // ── Summary ──
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log(' SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log(` Events recorded:          ${scoreLog.length}`);
  console.log(` Promoted to long-term:    ${promotionLog.length}`);
  console.log(` Final short-term count:   ${finalShort.length}`);
  console.log(` Final long-term count:    ${finalLong.length}`);
  console.log(` Total surviving memories: ${finalShort.length + finalLong.length}`);
  console.log(` Total forgotten:          ${scoreLog.length - finalShort.length - finalLong.length}`);
  console.log('');

  db.close();
  if (existsSync(dbPath)) unlinkSync(dbPath);
}

main().catch((err) => {
  console.error('Simulation failed:', err);
  process.exit(1);
});
