/**
 * 100-CYCLE MEMORY SIMULATION
 * ═══════════════════════════════════════════════════════════════
 *
 * Scenario: A CEO agent runs daily cycles for 100 days.
 * We feed it a realistic mix of events and watch how the memory
 * formula handles them over time.
 *
 * WHAT WE'RE TESTING:
 *
 *   1. DECAY — Memories lose value over time if nobody accesses them.
 *      An event from Day 5 that's never referenced again should fade
 *      and eventually be forgotten. This is the e^(−t/τD) term.
 *
 *   2. REINFORCEMENT — When the same information comes up repeatedly,
 *      the memory gets stronger. If "revenue is growing" appears on
 *      Day 10, 20, and 30, it should survive longer than a one-off event.
 *      This is the ln(f+1) term.
 *
 *   3. RELEVANCE — High-R memories (critical business events) should
 *      outlast low-R memories (routine noise) even if both are equally
 *      old. This is the R multiplier.
 *
 *   4. ACCESS — When a memory is retrieved (queried), its decay timer
 *      resets to 0. A memory that keeps being useful stays alive.
 *      This is the t-reset mechanic.
 *
 *   5. FORGETTING — The system should naturally shed noise. After 100
 *      cycles, only genuinely important or frequently-reinforced
 *      memories should remain.
 *
 *   6. UNIQUENESS — Unique information (D close to 1) decays slower
 *      than redundant information (D close to 0). A one-of-a-kind
 *      insight is worth preserving; the 5th "sales are up" is not.
 *
 * WHY THIS MATTERS:
 *   Without this, an agent running for 100 days either:
 *   - Remembers everything (context window explodes, costs skyrocket)
 *   - Remembers nothing (every day starts from scratch)
 *   The formula gives it a human-like memory curve: important things
 *   stick, noise fades, patterns emerge.
 *
 * ═══════════════════════════════════════════════════════════════
 */

import { MemoryDatabase } from '../src/database.js';
import { ShortTermCube } from '../src/cube.js';
import type { MemoryNode } from '../src/types.js';
import { unlinkSync, existsSync } from 'node:fs';

const DB_PATH = './sim-100.db';
if (existsSync(DB_PATH)) unlinkSync(DB_PATH);

const db = new MemoryDatabase(DB_PATH);
const cube = new ShortTermCube(db, {
  tau: 20,                // CEO remembers ~20 days naturally
  forgetThreshold: 0.05,  // below this = forgotten
  promoteThreshold: 2.0,  // above this = ready for long-term
}, process.env.OPENAI_API_KEY);

// ── Event schedule ──────────────────────────────────────────
// Each event has: [cycle, content, R (relevance), tags]
// These simulate what a CEO agent would encounter over 100 days.

type Event = [number, string, number, string[]];

const events: Event[] = [
  // ── HIGH RELEVANCE (R=0.9-1.0) — Critical business events ──
  [1,  'Company founded with $50,000 seed capital',                1.0, ['founding']],
  [5,  'Marketplace partner missed their first payment of $2,400', 0.9, ['risk', 'payment']],
  [15, 'Marketplace partner missed second payment, now $4,800 overdue', 0.9, ['risk', 'payment']],
  [30, 'Marketplace partner declared bankruptcy, $4,800 written off', 1.0, ['risk', 'loss']],
  [50, 'New enterprise client signed: $10,000/month contract',     1.0, ['revenue', 'client']],
  [70, 'Server outage lasted 4 hours, lost $3,200 in orders',     0.9, ['incident', 'loss']],

  // ── MEDIUM RELEVANCE (R=0.5-0.7) — Useful operational info ──
  [3,  'Blog post about AI trends published, 200 views',          0.5, ['marketing']],
  [8,  'New product launched: Premium Widget at $49.99',           0.7, ['product']],
  [12, 'Hired a new marketing runner',                             0.6, ['team']],
  [20, 'Blog post about productivity tips, 450 views',            0.5, ['marketing']],
  [35, 'Premium Widget sales: 120 units this month',              0.7, ['product', 'revenue']],
  [45, 'Updated pricing strategy: 15% increase on widgets',       0.7, ['strategy']],
  [60, 'Blog post about company culture, 180 views',              0.5, ['marketing']],
  [75, 'Q3 revenue report: $42,000 total',                        0.7, ['revenue', 'reporting']],
  [85, 'Customer satisfaction survey: 4.2/5 average',             0.6, ['feedback']],

  // ── LOW RELEVANCE (R=0.2-0.3) — Noise that should fade ──
  [2,  'Checked email, nothing important',                         0.2, ['routine']],
  [7,  'Updated the company website favicon',                      0.2, ['routine']],
  [10, 'Slack channel reorganized',                                0.2, ['routine']],
  [25, 'Office wifi was slow this morning',                        0.2, ['routine']],
  [40, 'Ran standard monthly backup',                              0.3, ['routine']],
  [55, 'Calendar reminder: dentist appointment',                   0.1, ['personal']],
  [65, 'Updated password for admin panel',                         0.2, ['routine']],
  [80, 'Cleaned up old git branches',                              0.2, ['routine']],
  [90, 'Spam email about cloud migration',                         0.1, ['noise']],

  // ── RECURRING PATTERN (R=0.6) — Same theme, repeated ──
  // "Revenue growing" appears 5 times — should get reinforced
  [10, 'Monthly revenue: $5,000 — growth trend continuing',       0.6, ['revenue']],
  [22, 'Monthly revenue: $8,200 — growth trend continuing',       0.6, ['revenue']],
  [38, 'Monthly revenue: $12,500 — growth trend continuing',      0.6, ['revenue']],
  [52, 'Monthly revenue: $18,000 — growth trend continuing',      0.6, ['revenue']],
  [68, 'Monthly revenue: $28,000 — growth trend continuing',      0.6, ['revenue']],
];

// Cycles where the CEO queries (accesses) specific topics.
// This simulates the agent actively thinking about something.
const queries: [number, string][] = [
  [16, 'payment defaults and credit risk'],      // after 2nd missed payment
  [31, 'marketplace losses and write-offs'],      // after bankruptcy
  [51, 'enterprise client revenue'],              // after new client
  [71, 'server incidents and downtime'],          // after outage
  [76, 'total revenue and financial performance'], // Q3 review
];

// ── Run simulation ──────────────────────────────────────────
async function run() {
  // Sort events by cycle
  events.sort((a, b) => a[0] - b[0]);

  // Pre-group for fast lookup
  const eventsByCycle = new Map<number, Event[]>();
  for (const e of events) {
    const list = eventsByCycle.get(e[0]) ?? [];
    list.push(e);
    eventsByCycle.set(e[0], list);
  }
  const queriesByCycle = new Map<number, string>();
  for (const [c, q] of queries) queriesByCycle.set(c, q);

  // Track node history for the final table
  const nodeHistory: Map<string, { label: string; R: number; snapshots: Map<number, { M: number; f: number; t: number; alive: boolean }> }> = new Map();

  // Table checkpoints — every 5 cycles
  const checkpoints = Array.from({ length: 20 }, (_, i) => (i + 1) * 5);

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(' 100-CYCLE CEO MEMORY SIMULATION');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('');
  console.log(' Config: tau=20 (CEO remembers ~20 days), forget<0.05, promote>2.0');
  console.log('');

  // ── Cycle loop ──
  for (let cycle = 1; cycle <= 100; cycle++) {
    cube.setCycle(cycle);

    // Record events for this cycle
    const cycleEvents = eventsByCycle.get(cycle) ?? [];
    for (const [, content, R, tags] of cycleEvents) {
      const result = await cube.record(content, { source: 'ceo', tags, R });
      const node = cube.getNode(result.nodeId)!;

      // Track this node
      if (result.action === 'created') {
        nodeHistory.set(node.id, {
          label: content.length > 55 ? content.slice(0, 52) + '...' : content,
          R,
          snapshots: new Map(),
        });
      }
    }

    // Run query if scheduled
    const queryText = queriesByCycle.get(cycle);
    if (queryText) {
      await cube.query(queryText, 3);
    }

    // Run cycle maintenance (decay, forget, etc.)
    const report = cube.cycle();

    // Mark forgotten nodes
    for (const forgottenId of report.forgotten) {
      const tracked = nodeHistory.get(forgottenId);
      if (tracked) {
        tracked.snapshots.set(cycle, { M: 0, f: 0, t: 0, alive: false });
      }
    }

    // Snapshot all living nodes at checkpoints
    if (checkpoints.includes(cycle)) {
      const allNodes = cube.getAll();
      for (const node of allNodes) {
        const tracked = nodeHistory.get(node.id);
        if (tracked) {
          tracked.snapshots.set(cycle, { M: node.M, f: node.f, t: node.t, alive: true });
        }
      }
      // Mark dead nodes
      for (const [id, tracked] of nodeHistory) {
        if (!tracked.snapshots.has(cycle)) {
          tracked.snapshots.set(cycle, { M: 0, f: 0, t: 0, alive: false });
        }
      }
    }
  }

  // ── Print results ──────────────────────────────────────────

  // Sort nodes by creation order (based on when they first appeared)
  const sortedNodes = [...nodeHistory.entries()].sort((a, b) => {
    const aFirst = Math.min(...[...a[1].snapshots.keys()]);
    const bFirst = Math.min(...[...b[1].snapshots.keys()]);
    return aFirst - bFirst;
  });

  // ── TABLE 1: Memory Value (M) over time ──
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log(' TABLE 1: MEMORY VALUE (M) AT EACH CHECKPOINT');
  console.log(' Shows how each memory\'s value changes over 100 cycles.');
  console.log(' "—" = forgotten (M dropped below 0.05 threshold)');
  console.log(' "." = not yet created');
  console.log('═══════════════════════════════════════════════════════════════════════════════════════════════════════════════');
  console.log('');

  // Header
  const colW = 6;
  let header = ' R   | Event'.padEnd(60) + '|';
  for (const cp of checkpoints) header += ` C${String(cp).padStart(2)}`.padEnd(colW) + '|';
  console.log(header);
  console.log('-'.repeat(header.length));

  for (const [, info] of sortedNodes) {
    let row = ` ${info.R.toFixed(1)} | ${info.label.padEnd(54)}|`;
    for (const cp of checkpoints) {
      const snap = info.snapshots.get(cp);
      if (!snap) {
        row += '  .  |';
      } else if (!snap.alive) {
        row += '  —  |';
      } else {
        const mStr = snap.M < 0.001 ? '~0' : snap.M.toFixed(2);
        row += mStr.padStart(5) + '|';
      }
    }
    console.log(row);
  }

  // ── TABLE 2: Summary statistics ──
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(' TABLE 2: SUMMARY — WHAT SURVIVED AND WHAT DIDN\'T');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('');

  const finalNodes = cube.getAll();
  const finalIds = new Set(finalNodes.map((n) => n.id));

  console.log(' Status    | R    | f  | Event');
  console.log(' ----------+------+----+----------------------------------------------');

  for (const [id, info] of sortedNodes) {
    const node = finalNodes.find((n) => n.id === id);
    if (node) {
      console.log(` ALIVE     | ${info.R.toFixed(1)}  | ${String(node.f).padStart(2)} | ${info.label}`);
    } else {
      console.log(` FORGOTTEN | ${info.R.toFixed(1)}  |  - | ${info.label}`);
    }
  }

  // ── TABLE 3: Cycle-by-cycle event log ──
  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(' TABLE 3: AGGREGATE STATS PER CHECKPOINT');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('');
  console.log(' Cycle | Alive | Avg M  | Max M  | Min M  ');
  console.log(' ------+-------+--------+--------+--------');

  for (const cp of checkpoints) {
    const aliveAtCp: number[] = [];
    for (const [, info] of sortedNodes) {
      const snap = info.snapshots.get(cp);
      if (snap?.alive) aliveAtCp.push(snap.M);
    }
    const avg = aliveAtCp.length > 0 ? (aliveAtCp.reduce((a, b) => a + b, 0) / aliveAtCp.length) : 0;
    const max = aliveAtCp.length > 0 ? Math.max(...aliveAtCp) : 0;
    const min = aliveAtCp.length > 0 ? Math.min(...aliveAtCp) : 0;
    console.log(` ${String(cp).padStart(5)} | ${String(aliveAtCp.length).padStart(5)} | ${avg.toFixed(4)} | ${max.toFixed(4)} | ${min.toFixed(4)}`);
  }

  // ── Conclusions ──
  const totalCreated = sortedNodes.length;
  const totalSurvived = finalNodes.length;
  const totalForgotten = totalCreated - totalSurvived;

  const survivedHigh = finalNodes.filter((n) => {
    const info = nodeHistory.get(n.id);
    return info && info.R >= 0.7;
  }).length;
  const survivedLow = finalNodes.filter((n) => {
    const info = nodeHistory.get(n.id);
    return info && info.R <= 0.3;
  }).length;
  const survivedReinforced = finalNodes.filter((n) => n.f > 1).length;

  console.log('');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(' CONCLUSIONS');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('');
  console.log(` Total memories created:          ${totalCreated}`);
  console.log(` Survived to cycle 100:           ${totalSurvived}`);
  console.log(` Forgotten:                       ${totalForgotten}`);
  console.log(` Survival rate:                   ${((totalSurvived / totalCreated) * 100).toFixed(0)}%`);
  console.log('');
  console.log(` High-relevance survived (R≥0.7): ${survivedHigh}`);
  console.log(` Low-relevance survived (R≤0.3):  ${survivedLow}`);
  console.log(` Reinforced survived (f>1):        ${survivedReinforced}`);
  console.log('');

  // Verify expected behaviors
  let pass = 0;
  let fail = 0;
  function check(ok: boolean, msg: string) {
    if (ok) { console.log(`  ✓ ${msg}`); pass++; }
    else { console.log(`  ✗ ${msg}`); fail++; }
  }

  check(survivedLow === 0, 'All low-relevance noise was forgotten');
  check(survivedHigh >= 2, 'At least 2 high-relevance events survived');
  check(totalForgotten >= 10, 'At least 10 memories were naturally forgotten');
  check(survivedReinforced >= 1, 'At least 1 reinforced memory survived');
  check(totalSurvived < totalCreated, 'Memory count was naturally reduced');

  console.log('');
  console.log(`  ${pass} checks passed, ${fail} failed`);
  console.log('');

  db.close();
  if (existsSync(DB_PATH)) unlinkSync(DB_PATH);
  process.exit(fail > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Simulation failed:', err);
  db.close();
  if (existsSync(DB_PATH)) unlinkSync(DB_PATH);
  process.exit(1);
});
