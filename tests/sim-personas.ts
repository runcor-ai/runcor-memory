/**
 * PERSONA COMPARISON — Same events, different roles, different r++ configs.
 *
 * Proves the "lens" concept: same memory infrastructure, same formula,
 * but each role scores and remembers differently because their r++ spec
 * has different preserve/discard rules.
 *
 * 4 personas:
 *   CEO        — strategic decisions, revenue, risk
 *   Marketing  — content performance, engagement, audience
 *   Lawyer     — contracts, obligations, disputes, compliance
 *   Sales      — client pipeline, conversions, outreach
 *
 * All use tau=30 (same decay rate) so the ONLY variable is the r++ config.
 */

import OpenAI from 'openai';
import { MemoryDatabase } from '../src/database.js';
import { ShortTermCube } from '../src/cube.js';
import { scoreRelevance } from '../src/llm.js';
import type { ModelComplete } from '../src/llm.js';
import type { MemoryConfig } from '../src/types.js';
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

// ── Persona configs ──────────────────────────────────────────

interface Persona {
  name: string;
  role: string;
  config: MemoryConfig;
}

const personas: Persona[] = [
  {
    name: 'CEO',
    role: 'CEO of an autonomous company making strategic decisions about products, revenue, and growth',
    config: {
      ...DEFAULT_CONFIG,
      tau: 30,
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
          'content performance metrics like blog views',
          'infrastructure maintenance with no business impact',
        ],
        precisStyle: 'executive summary — lead with strategic impact',
      },
    },
  },
  {
    name: 'Marketing',
    role: 'Marketing runner responsible for content creation, audience growth, social media, and brand engagement',
    config: {
      ...DEFAULT_CONFIG,
      tau: 30,
      compression: {
        preserve: [
          'content performance: view counts, engagement rates, shares',
          'audience size and growth metrics',
          'blog post topics and their performance',
          'social media platform performance comparisons',
          'successful content formats and topics',
        ],
        discard: [
          'financial details: exact revenue, debt, contract values',
          'infrastructure incidents and server issues',
          'legal and compliance matters',
          'routine admin tasks: passwords, backups, configs',
          'personal reminders and spam',
          'credit risk and payment defaults',
        ],
        precisStyle: 'content brief — lead with engagement metrics',
      },
    },
  },
  {
    name: 'Lawyer',
    role: 'Legal counsel responsible for contracts, compliance, disputes, obligations, and regulatory matters',
    config: {
      ...DEFAULT_CONFIG,
      tau: 30,
      compression: {
        preserve: [
          'exact contractual language and terms',
          'commitments, obligations, and deadlines',
          'dispute details and counterparty names',
          'payment defaults and breach of contract signals',
          'regulatory citations and compliance requirements',
          'monetary amounts in contracts, losses, and penalties',
        ],
        discard: [
          'marketing content and blog performance',
          'social media metrics and engagement',
          'routine operational tasks with no legal implications',
          'personal reminders and spam',
          'infrastructure details with no liability impact',
          'product feature details unrelated to contracts',
        ],
        precisStyle: 'legal brief — precise language, cite specific facts and dates',
      },
    },
  },
  {
    name: 'Sales',
    role: 'Sales representative responsible for client outreach, pipeline management, deal closing, and revenue generation',
    config: {
      ...DEFAULT_CONFIG,
      tau: 30,
      compression: {
        preserve: [
          'client names and company names',
          'deal values and contract amounts',
          'product names, prices, and availability',
          'client feedback and objections',
          'competitive pricing and positioning',
        ],
        discard: [
          'internal team changes and hiring',
          'infrastructure incidents and server issues',
          'legal and compliance details',
          'routine admin tasks: passwords, backups, configs',
          'personal reminders and spam',
          'marketing content creation process',
        ],
        precisStyle: 'sales note — lead with client impact and deal value',
      },
    },
  },
];

// ── Events (same 25 as before) ───────────────────────────────

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
  // Recurring revenue
  [10, 'Monthly revenue: $5,000 — growth trend continuing',       ['revenue']],
  [22, 'Monthly revenue: $8,200 — growth trend continuing',       ['revenue']],
  [38, 'Monthly revenue: $12,500 — growth trend continuing',      ['revenue']],
  [52, 'Monthly revenue: $18,000 — growth trend continuing',      ['revenue']],
  [68, 'Monthly revenue: $28,000 — growth trend continuing',      ['revenue']],
];

events.sort((a, b) => a[0] - b[0]);

const queries: [number, string][] = [
  [16, 'payment defaults and credit risk'],
  [31, 'marketplace losses and write-offs'],
  [51, 'enterprise client revenue'],
  [71, 'server incidents and downtime'],
  [76, 'total revenue and financial performance'],
];

// ── Score events per persona ─────────────────────────────────

async function scoreForPersona(
  model: ModelComplete,
  persona: Persona,
): Promise<Map<string, number>> {
  const scores = new Map<string, number>();
  const unique = [...new Set(events.map(e => e[1]))];

  for (const text of unique) {
    const result = await scoreRelevance(model, text, persona.config, persona.role);
    scores.set(text, result.score);
  }

  return scores;
}

// ── Run simulation ───────────────────────────────────────────

interface RunResult {
  persona: string;
  scores: Map<string, number>;
  survived: { label: string; R: number; f: number; M: number }[];
  forgotten: { label: string; R: number; diedAtCycle: number }[];
}

async function runForPersona(
  persona: Persona,
  scores: Map<string, number>,
): Promise<RunResult> {
  const dbPath = `./sim-persona-${persona.name.toLowerCase()}.db`;
  if (existsSync(dbPath)) unlinkSync(dbPath);

  const db = new MemoryDatabase(dbPath);
  const cube = new ShortTermCube(db, {
    tau: 30,
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

  for (let cycle = 1; cycle <= 100; cycle++) {
    cube.setCycle(cycle);

    const cycleEvents = eventsByCycle.get(cycle) ?? [];
    for (const [, content, tags] of cycleEvents) {
      const R = scores.get(content) ?? 0.5;
      const result = await cube.record(content, { source: persona.name.toLowerCase(), tags, R });
      if (result.action === 'created') {
        nodeInfo.set(result.nodeId, {
          label: content.length > 52 ? content.slice(0, 49) + '...' : content,
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

  return { persona: persona.name, scores, survived, forgotten };
}

// ── Main ─────────────────────────────────────────────────────

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) { console.error('Set OPENAI_API_KEY'); process.exit(1); }

  const model = createModel(apiKey);

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log(' PERSONA COMPARISON — Same events, different roles, different r++ configs');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log(' All personas use tau=30. The ONLY variable is the r++ config:');
  console.log(' different preserve/discard rules per role.');
  console.log('');
  console.log(' This proves: same infrastructure, same formula, different memory behavior');
  console.log(' based on what each role considers important.');
  console.log('');

  // Score all events per persona
  const allScores = new Map<string, Map<string, number>>();
  for (const p of personas) {
    process.stdout.write(` Scoring for ${p.name}...`);
    const scores = await scoreForPersona(model, p);
    allScores.set(p.name, scores);
    console.log(' done');
  }

  // ── TABLE 1: How each persona scored each event ──
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════');
  console.log(' TABLE 1: RELEVANCE SCORES (R) — HOW EACH ROLE SEES THE SAME EVENT');
  console.log('');
  console.log(' Same event, scored by 4 different roles. This is the "lens" in action.');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════');
  console.log('');

  const uniqueEvents = [...new Set(events.map(e => e[1]))];

  let hdr = ' Event'.padEnd(55) + '|  CEO  |  Mkt  |  Law  | Sales |';
  console.log(hdr);
  console.log('-'.repeat(hdr.length));

  for (const text of uniqueEvents) {
    const label = text.length > 52 ? text.slice(0, 49) + '...' : text;
    let row = ` ${label.padEnd(54)}|`;
    for (const p of personas) {
      const score = allScores.get(p.name)?.get(text) ?? 0;
      row += ` ${score.toFixed(2)} |`;
    }
    console.log(row);
  }

  // Run all personas
  console.log('');
  const results: RunResult[] = [];
  for (const p of personas) {
    process.stdout.write(` Running ${p.name}...`);
    const r = await runForPersona(p, allScores.get(p.name)!);
    results.push(r);
    console.log(` done (${r.survived.length} survived)`);
  }

  // ── TABLE 2: What survived per persona ──
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════');
  console.log(' TABLE 2: WHAT EACH ROLE REMEMBERS AFTER 100 CYCLES');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════');

  for (const r of results) {
    console.log('');
    console.log(` ── ${r.persona} (${r.survived.length} memories) ──`);
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

  // ── TABLE 3: Side-by-side survival grid ──
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════');
  console.log(' TABLE 3: SURVIVAL GRID — WHO REMEMBERS WHAT');
  console.log('');
  console.log(' ✓ = survived to cycle 100, — = forgotten');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════');
  console.log('');

  let hdr3 = ' Event'.padEnd(55) + '|  CEO  |  Mkt  |  Law  | Sales |';
  console.log(hdr3);
  console.log('-'.repeat(hdr3.length));

  for (const text of uniqueEvents) {
    const label = text.length > 52 ? text.slice(0, 49) + '...' : text;
    let row = ` ${label.padEnd(54)}|`;
    for (const r of results) {
      const alive = r.survived.some(s => s.label === label);
      row += alive ? '   ✓   |' : '   —   |';
    }
    console.log(row);
  }

  // ── TABLE 4: Summary ──
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════');
  console.log(' TABLE 4: SUMMARY');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log(' Metric                    |  CEO  |  Mkt  |  Law  | Sales |');
  console.log(' --------------------------+-------+-------+-------+-------+');

  const metrics: [string, (r: RunResult) => string][] = [
    ['Total survived',     r => String(r.survived.length)],
    ['Total forgotten',    r => String(r.forgotten.length)],
    ['Survival rate',      r => ((r.survived.length / uniqueEvents.length) * 100).toFixed(0) + '%'],
    ['Avg R of survivors', r => r.survived.length > 0 ? (r.survived.reduce((a, s) => a + s.R, 0) / r.survived.length).toFixed(2) : 'n/a'],
    ['Reinforced (f>1)',   r => String(r.survived.filter(s => s.f > 1).length)],
  ];

  for (const [name, fn] of metrics) {
    let row = ` ${name.padEnd(26)}|`;
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
  console.log(' Same 29 events. Same formula. Same tau. Same decay.');
  console.log(' The ONLY difference is the preserve/discard rules in each role\'s r++ config.');
  console.log('');
  console.log(' Each role builds a different picture of reality from the same stream of events.');
  console.log(' That is the lens.');
  console.log('');
}

main().catch((err) => {
  console.error('Simulation failed:', err);
  process.exit(1);
});
