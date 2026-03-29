/**
 * Test script for the ShortTermCube — full integration test.
 *
 * Requires: OPENAI_API_KEY env var (for embeddings)
 *
 * Run: npm run test:cube
 */

import { MemoryDatabase } from '../src/database.js';
import { ShortTermCube } from '../src/cube.js';
import { unlinkSync, existsSync } from 'node:fs';

const DB_PATH = './test-memory.db';

// Clean up from previous runs
if (existsSync(DB_PATH)) unlinkSync(DB_PATH);

const db = new MemoryDatabase(DB_PATH);
const cube = new ShortTermCube(db, {
  tau: 10,              // short half-life for testing
  forgetThreshold: 0.05,
  promoteThreshold: 1.5,
}, process.env.OPENAI_API_KEY);

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string, detail?: string): void {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

async function run() {
  console.log('\n═══ CUBE TEST 1: Record memories ═══');
  {
    const r1 = await cube.record('Marketplace missed payment on Day 12', {
      source: 'ceo', tags: ['risk', 'payment'], R: 0.8,
    });
    assert(r1.action === 'created', 'First memory created');

    const r2 = await cube.record('New product launched: Premium Widget at $49.99', {
      source: 'product', tags: ['product', 'launch'], R: 0.7,
    });
    assert(r2.action === 'created', 'Second memory created');

    const r3 = await cube.record('Blog post about AI trends got 500 views', {
      source: 'marketing', tags: ['content', 'engagement'], R: 0.5,
    });
    assert(r3.action === 'created', 'Third memory created');

    const all = cube.getAll();
    assert(all.length === 3, `3 nodes in cube (got ${all.length})`);
  }

  console.log('\n═══ CUBE TEST 2: Near-duplicate → reinforce ═══');
  {
    const r4 = await cube.record('Marketplace missed their payment again on Day 12', {
      source: 'ceo', tags: ['risk'], R: 0.8,
    });
    // Should reinforce the first memory (very similar text)
    assert(r4.action === 'reinforced', 'Near-duplicate reinforced existing node');

    const all = cube.getAll();
    assert(all.length === 3, `Still 3 nodes (not 4) — got ${all.length}`);

    // Check that f was incremented
    const reinforced = cube.getNode(r4.nodeId);
    assert(reinforced !== null && reinforced.f === 2, `Frequency incremented to ${reinforced?.f}`);
  }

  console.log('\n═══ CUBE TEST 3: Semantic query ═══');
  {
    const results = await cube.query('credit risk and payment defaults', 3);
    assert(results.length > 0, `Got ${results.length} results`);
    assert(
      results[0].node.content.includes('payment'),
      'Top result is about payment',
      `got: "${results[0].node.content.slice(0, 50)}..."`,
    );
    assert(results[0].similarity > 0.3, `Similarity > 0.3 (got ${results[0].similarity.toFixed(3)})`);
  }

  console.log('\n═══ CUBE TEST 4: Cycle maintenance — decay ═══');
  {
    const before = cube.getAll();
    const beforeMs = before.map((n) => ({ id: n.id.slice(0, 8), M: n.M, t: n.t }));
    console.log('  Before cycle:', JSON.stringify(beforeMs));

    const report = cube.cycle();
    console.log(`  Cycle ${report.cycle}: decayed=${report.decayed}, forgotten=${report.forgotten.length}, promoted=${report.promoted.length}`);

    const after = cube.getAll();
    const afterMs = after.map((n) => ({ id: n.id.slice(0, 8), M: n.M, t: n.t }));
    console.log('  After cycle:', JSON.stringify(afterMs));

    assert(report.decayed === 3, `All 3 nodes decayed (got ${report.decayed})`);

    // t should have incremented for all
    for (const node of after) {
      assert(node.t >= 1, `Node t >= 1 (got ${node.t})`);
    }
  }

  console.log('\n═══ CUBE TEST 5: Multiple cycles — watch decay ═══');
  {
    console.log('  Cycle |  Nodes  | Forgotten | M range');
    console.log('  ------+---------+-----------+---------');

    for (let i = 0; i < 15; i++) {
      const report = cube.cycle();
      const nodes = cube.getAll();
      const Ms = nodes.map((n) => n.M);
      const minM = Ms.length > 0 ? Math.min(...Ms).toFixed(4) : 'n/a';
      const maxM = Ms.length > 0 ? Math.max(...Ms).toFixed(4) : 'n/a';
      console.log(`  ${String(report.cycle).padStart(5)} | ${String(nodes.length).padStart(7)} | ${String(report.forgotten.length).padStart(9)} | ${minM} - ${maxM}`);
    }

    // After 16 cycles with tau=10, some nodes should have been forgotten
    const remaining = cube.getAll();
    assert(remaining.length < 3, `Some nodes forgotten after 16 cycles (${remaining.length} remain)`);
  }

  console.log('\n═══ CUBE TEST 6: Record during late cycle — new memory survives ═══');
  {
    const r5 = await cube.record('Urgent: server outage detected in production', {
      source: 'ceo', tags: ['incident', 'urgent'], R: 1.0,
    });
    assert(r5.action === 'created', 'Urgent memory created');

    const node = cube.getNode(r5.nodeId);
    assert(node !== null && node.M > 0.5, `Urgent memory has high M (${node?.M.toFixed(4)})`);

    // Run 2 more cycles — urgent memory should survive
    cube.cycle();
    cube.cycle();
    const afterNode = cube.getNode(r5.nodeId);
    assert(afterNode !== null, 'Urgent memory survived 2 more cycles');
  }

  // ── Cleanup ──
  db.close();
  if (existsSync(DB_PATH)) unlinkSync(DB_PATH);

  console.log('\n═══ RESULTS ═══');
  console.log(`\n  ${passed} passed, ${failed} failed, ${passed + failed} total\n`);
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Test failed:', err);
  db.close();
  if (existsSync(DB_PATH)) unlinkSync(DB_PATH);
  process.exit(1);
});
