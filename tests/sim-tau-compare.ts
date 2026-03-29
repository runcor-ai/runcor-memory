/**
 * TAU COMPARISON — Same 100-cycle scenario, 4 different tau values.
 *
 * tau = how many cycles before a memory naturally fades to ~37% strength.
 * Think of it as the agent's "attention span."
 *
 *   tau=10  → Goldfish. Forgets fast. Only the constantly-reinforced survives.
 *   tau=20  → Standard. Remembers recent weeks, forgets last month.
 *   tau=40  → Elephant. Holds onto things for over a month.
 *   tau=80  → Archivist. Almost nothing is forgotten within 100 cycles.
 *
 * Same events, same queries, same thresholds. Only tau changes.
 */

import { MemoryDatabase } from '../src/database.js';
import { ShortTermCube } from '../src/cube.js';
import { unlinkSync, existsSync } from 'node:fs';

type Event = [number, string, number, string[]];

const events: Event[] = [
  // HIGH RELEVANCE
  [1,  'Company founded with $50,000 seed capital',                1.0, ['founding']],
  [5,  'Marketplace partner missed first payment of $2,400',       0.9, ['risk']],
  [15, 'Marketplace partner missed second payment, $4,800 overdue',0.9, ['risk']],
  [30, 'Marketplace partner declared bankruptcy, $4,800 written off',1.0, ['loss']],
  [50, 'New enterprise client signed: $10,000/month contract',     1.0, ['revenue']],
  [70, 'Server outage lasted 4 hours, lost $3,200 in orders',     0.9, ['incident']],
  // MEDIUM RELEVANCE
  [3,  'Blog post about AI trends published, 200 views',          0.5, ['marketing']],
  [8,  'New product launched: Premium Widget at $49.99',           0.7, ['product']],
  [12, 'Hired a new marketing runner',                             0.6, ['team']],
  [20, 'Blog post about productivity tips, 450 views',            0.5, ['marketing']],
  [35, 'Premium Widget sales: 120 units this month',              0.7, ['revenue']],
  [45, 'Updated pricing strategy: 15% increase on widgets',       0.7, ['strategy']],
  [60, 'Blog post about company culture, 180 views',              0.5, ['marketing']],
  [75, 'Q3 revenue report: $42,000 total',                        0.7, ['revenue']],
  [85, 'Customer satisfaction survey: 4.2/5 average',             0.6, ['feedback']],
  // LOW RELEVANCE (NOISE)
  [2,  'Checked email, nothing important',                         0.2, ['routine']],
  [7,  'Updated the company website favicon',                      0.2, ['routine']],
  [10, 'Slack channel reorganized',                                0.2, ['routine']],
  [25, 'Office wifi was slow this morning',                        0.2, ['routine']],
  [40, 'Ran standard monthly backup',                              0.3, ['routine']],
  [55, 'Calendar reminder: dentist appointment',                   0.1, ['personal']],
  [65, 'Updated password for admin panel',                         0.2, ['routine']],
  [80, 'Cleaned up old git branches',                              0.2, ['routine']],
  [90, 'Spam email about cloud migration',                         0.1, ['noise']],
  // RECURRING PATTERN (reinforced 5 times)
  [10, 'Monthly revenue: $5,000 — growth trend continuing',       0.6, ['revenue']],
  [22, 'Monthly revenue: $8,200 — growth trend continuing',       0.6, ['revenue']],
  [38, 'Monthly revenue: $12,500 — growth trend continuing',      0.6, ['revenue']],
  [52, 'Monthly revenue: $18,000 — growth trend continuing',      0.6, ['revenue']],
  [68, 'Monthly revenue: $28,000 — growth trend continuing',      0.6, ['revenue']],
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

interface RunResult {
  tau: number;
  survived: { label: string; R: number; f: number; M: number }[];
  forgotten: { label: string; R: number; diedAtCycle: number }[];
  alivePerCheckpoint: Map<number, number>;
}

async function runWithTau(tau: number): Promise<RunResult> {
  const dbPath = `./sim-tau-${tau}.db`;
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

  // Track nodes
  const nodeInfo = new Map<string, { label: string; R: number; diedAtCycle: number | null }>();
  const alivePerCheckpoint = new Map<number, number>();

  for (let cycle = 1; cycle <= 100; cycle++) {
    cube.setCycle(cycle);

    const cycleEvents = eventsByCycle.get(cycle) ?? [];
    for (const [, content, R, tags] of cycleEvents) {
      const result = await cube.record(content, { source: 'ceo', tags, R });
      if (result.action === 'created') {
        const node = cube.getNode(result.nodeId)!;
        nodeInfo.set(node.id, {
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

async function main() {
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log(' TAU COMPARISON — 100 cycles, same events, different memory spans');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log(' 25 events fed to a CEO agent over 100 cycles.');
  console.log(' 5 queries at key moments (payment crisis, new client, outage, Q3 review).');
  console.log(' Forget threshold: M < 0.05. Same for all runs.');
  console.log('');

  const results: RunResult[] = [];
  for (const tau of TAU_VALUES) {
    process.stdout.write(` Running tau=${tau}...`);
    const r = await runWithTau(tau);
    results.push(r);
    console.log(` done (${r.survived.length} survived, ${r.forgotten.length} forgotten)`);
  }

  // ── TABLE 1: Alive node count over time ──
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log(' TABLE 1: MEMORIES ALIVE AT EACH CHECKPOINT');
  console.log('');
  console.log(' How many memories the agent is holding at each point in time.');
  console.log(' More alive = more context to work with, but also more cost/noise.');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('');

  const checkpoints = Array.from({ length: 20 }, (_, i) => (i + 1) * 5);
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

  // ── TABLE 2: What survived in each run ──
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log(' TABLE 2: WHAT SURVIVED TO CYCLE 100');
  console.log('');
  console.log(' For each tau, what the agent still remembers after 100 days.');
  console.log('═══════════════════════════════════════════════════════════════════════════');

  for (const r of results) {
    console.log('');
    console.log(` ── tau=${r.tau} (${r.survived.length} memories survived) ──`);
    if (r.survived.length === 0) {
      console.log('   (nothing survived)');
    } else {
      console.log('   M     | R   | f  | Event');
      console.log('   ------+-----+----+--------------------------------------------------');
      for (const s of r.survived) {
        console.log(`   ${s.M.toFixed(2).padStart(5)} | ${s.R.toFixed(1)} | ${String(s.f).padStart(2)} | ${s.label}`);
      }
    }
  }

  // ── TABLE 3: When things died ──
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log(' TABLE 3: WHEN EACH MEMORY WAS FORGOTTEN (cycle number)');
  console.log('');
  console.log(' "—" = still alive at cycle 100');
  console.log(' Lower number = forgotten earlier');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('');

  // Collect all unique labels in event order
  const allLabels: string[] = [];
  const labelSet = new Set<string>();
  for (const r of results) {
    for (const s of r.survived) {
      if (!labelSet.has(s.label)) { allLabels.push(s.label); labelSet.add(s.label); }
    }
    for (const f of r.forgotten) {
      if (!labelSet.has(f.label)) { allLabels.push(f.label); labelSet.add(f.label); }
    }
  }

  // Build death-cycle lookup per tau
  const deathMap = new Map<number, Map<string, number | null>>();
  for (const r of results) {
    const m = new Map<string, number | null>();
    for (const s of r.survived) m.set(s.label, null); // alive
    for (const f of r.forgotten) m.set(f.label, f.diedAtCycle);
    deathMap.set(r.tau, m);
  }

  let hdr3 = ' R   | Event'.padEnd(62) + '|';
  for (const r of results) hdr3 += ` tau=${String(r.tau).padStart(2)} |`;
  console.log(hdr3);
  console.log('-'.repeat(hdr3.length));

  // Sort labels by the event's R value (high first), then by earliest death
  const labelRMap = new Map<string, number>();
  for (const r of results) {
    for (const s of r.survived) labelRMap.set(s.label, s.R);
    for (const f of r.forgotten) labelRMap.set(f.label, f.R);
  }

  allLabels.sort((a, b) => {
    const rDiff = (labelRMap.get(b) ?? 0) - (labelRMap.get(a) ?? 0);
    if (rDiff !== 0) return rDiff;
    // secondary sort: earliest death across all taus
    const aMin = Math.min(...results.map(r => deathMap.get(r.tau)?.get(a) ?? 999));
    const bMin = Math.min(...results.map(r => deathMap.get(r.tau)?.get(b) ?? 999));
    return aMin - bMin;
  });

  for (const label of allLabels) {
    const R = labelRMap.get(label) ?? 0;
    let row = ` ${R.toFixed(1)} | ${label.padEnd(56)}|`;
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

  // ── TABLE 4: Summary comparison ──
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log(' TABLE 4: SUMMARY COMPARISON');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log(' Metric                          | tau=10 | tau=20 | tau=40 | tau=80 |');
  console.log(' --------------------------------+--------+--------+--------+--------+');

  const metrics: [string, (r: RunResult) => string][] = [
    ['Total survived',        r => String(r.survived.length)],
    ['Total forgotten',       r => String(r.forgotten.length)],
    ['Survival rate',         r => ((r.survived.length / 25) * 100).toFixed(0) + '%'],
    ['Noise survived (R≤0.3)',r => String(r.survived.filter(s => s.R <= 0.3).length)],
    ['Critical survived (R≥0.9)', r => String(r.survived.filter(s => s.R >= 0.9).length)],
    ['Reinforced survived (f>1)', r => String(r.survived.filter(s => s.f > 1).length)],
    ['Peak alive count',      r => String(Math.max(...r.alivePerCheckpoint.values()))],
    ['Final alive count',     r => String(r.alivePerCheckpoint.get(100) ?? 0)],
  ];

  for (const [name, fn] of metrics) {
    let row = ` ${name.padEnd(32)}|`;
    for (const r of results) {
      row += ` ${fn(r).padStart(6)} |`;
    }
    console.log(row);
  }

  // ── Interpretation ──
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log(' INTERPRETATION');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('');
  console.log(' tau=10 (Goldfish)');
  console.log('   Aggressive forgetting. Only constantly-reinforced patterns survive.');
  console.log('   Good for: high-frequency runners where yesterday\'s news is stale.');
  console.log('');
  console.log(' tau=20 (Standard)');
  console.log('   Balanced. Keeps recent important events + reinforced patterns.');
  console.log('   Good for: daily operational roles (CEO, marketing).');
  console.log('');
  console.log(' tau=40 (Elephant)');
  console.log('   Holds context for weeks. More memories available but more noise risk.');
  console.log('   Good for: strategic roles, project managers, analysts.');
  console.log('');
  console.log(' tau=80 (Archivist)');
  console.log('   Remembers almost everything within 100 cycles.');
  console.log('   Good for: lawyers, compliance, auditors — roles where forgetting is dangerous.');
  console.log('');
  console.log(' KEY INSIGHT: tau controls the trade-off between context richness and noise.');
  console.log(' The r++ spec sets tau per role, so a lawyer (tau=90) and a social media');
  console.log(' manager (tau=10) running on the same engine behave completely differently.');
  console.log('');
}

main().catch((err) => {
  console.error('Simulation failed:', err);
  process.exit(1);
});
