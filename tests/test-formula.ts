/**
 * Test script for the memory formula: M = R · ln(f + 1) · e^(−t / τD)
 *
 * Tests each variable's effect piece by piece.
 * No API keys needed — pure math.
 *
 * Run: npm test
 */

import { calculateM, shouldPromote, shouldForget } from '../src/formula.js';
import { cosineSimilarity, calculateDensity } from '../src/embedding.js';
import { parseMemoryConfig } from '../src/rpp-parser.js';

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

function approx(a: number, b: number, epsilon = 0.001): boolean {
  return Math.abs(a - b) < epsilon;
}

// ═══════════════════════════════════════════════════════════════
console.log('\n═══ TEST 1: Base formula calculation ═══');
{
  // Fresh node: R=0.8, f=1, t=0, tau=30, D=0.7
  // M = 0.8 * ln(2) * e^(0) = 0.8 * 0.693 * 1 = 0.5545
  const M = calculateM({ R: 0.8, f: 1, t: 0, tau: 30, D: 0.7 });
  assert(approx(M, 0.5545, 0.01), 'Fresh node M ≈ 0.55', `got ${M.toFixed(4)}`);
}

// ═══════════════════════════════════════════════════════════════
console.log('\n═══ TEST 2: R (Relevance) scales linearly ═══');
{
  const base = { f: 1, t: 0, tau: 30, D: 0.7 };

  const M_low = calculateM({ ...base, R: 0.2 });
  const M_mid = calculateM({ ...base, R: 0.5 });
  const M_high = calculateM({ ...base, R: 1.0 });

  assert(M_low < M_mid, 'R=0.2 < R=0.5', `${M_low.toFixed(4)} < ${M_mid.toFixed(4)}`);
  assert(M_mid < M_high, 'R=0.5 < R=1.0', `${M_mid.toFixed(4)} < ${M_high.toFixed(4)}`);
  assert(approx(M_high / M_low, 5, 0.01), 'R=1.0 is 5x R=0.2 (linear)', `ratio = ${(M_high / M_low).toFixed(4)}`);

  const M_zero = calculateM({ ...base, R: 0 });
  assert(M_zero === 0, 'R=0 → M=0 (irrelevant memory has no value)');
}

// ═══════════════════════════════════════════════════════════════
console.log('\n═══ TEST 3: f (Frequency) — logarithmic boost ═══');
{
  const base = { R: 0.8, t: 0, tau: 30, D: 0.7 };

  const M_f1 = calculateM({ ...base, f: 1 });   // ln(2) = 0.693
  const M_f5 = calculateM({ ...base, f: 5 });   // ln(6) = 1.791
  const M_f20 = calculateM({ ...base, f: 20 });  // ln(21) = 3.045
  const M_f100 = calculateM({ ...base, f: 100 }); // ln(101) = 4.615

  assert(M_f1 < M_f5, 'f=1 < f=5 (reinforcement helps)');
  assert(M_f5 < M_f20, 'f=5 < f=20');
  assert(M_f20 < M_f100, 'f=20 < f=100');

  // Logarithmic: going from 1→5 is a bigger jump than 20→100
  const jump1to5 = M_f5 / M_f1;
  const jump20to100 = M_f100 / M_f20;
  assert(jump1to5 > jump20to100, 'Diminishing returns: 1→5 boost > 20→100 boost',
    `${jump1to5.toFixed(2)}x vs ${jump20to100.toFixed(2)}x`);
}

// ═══════════════════════════════════════════════════════════════
console.log('\n═══ TEST 4: t (Time decay) — exponential ═══');
{
  const base = { R: 0.8, f: 3, tau: 30, D: 0.7 };

  const M_t0 = calculateM({ ...base, t: 0 });
  const M_t10 = calculateM({ ...base, t: 10 });
  const M_t30 = calculateM({ ...base, t: 30 });
  const M_t60 = calculateM({ ...base, t: 60 });
  const M_t100 = calculateM({ ...base, t: 100 });

  assert(M_t0 > M_t10, 't=0 > t=10 (decay over time)');
  assert(M_t10 > M_t30, 't=10 > t=30');
  assert(M_t30 > M_t60, 't=30 > t=60');
  assert(M_t60 > M_t100, 't=60 > t=100');

  // After many cycles, M should be very small
  assert(M_t100 < 0.01, 't=100 → M ≈ 0 (forgotten)', `got ${M_t100.toFixed(6)}`);

  // Decay rate: at t=tau*D, M should be ~37% of original (e^-1)
  const tauD = base.tau * base.D; // 21
  const M_at_tauD = calculateM({ ...base, t: tauD });
  const ratio = M_at_tauD / M_t0;
  assert(approx(ratio, 1 / Math.E, 0.01), `At t=τD (${tauD}), M is ~37% of original`,
    `ratio = ${(ratio * 100).toFixed(1)}%`);
}

// ═══════════════════════════════════════════════════════════════
console.log('\n═══ TEST 5: τ (Tau) — half-life control ═══');
{
  const base = { R: 0.8, f: 3, t: 20, D: 0.7 };

  // Short tau = aggressive decay (daily runner)
  const M_tau5 = calculateM({ ...base, tau: 5 });
  // Medium tau (bank manager)
  const M_tau30 = calculateM({ ...base, tau: 30 });
  // Long tau (lawyer)
  const M_tau90 = calculateM({ ...base, tau: 90 });

  assert(M_tau5 < M_tau30, 'tau=5 < tau=30 (short memory forgets faster)');
  assert(M_tau30 < M_tau90, 'tau=30 < tau=90 (lawyer remembers longer)');
  assert(M_tau5 < 0.1, 'tau=5 at t=20: nearly forgotten', `M = ${M_tau5.toFixed(4)}`);
  assert(M_tau90 > 0.5, 'tau=90 at t=20: still strong', `M = ${M_tau90.toFixed(4)}`);
}

// ═══════════════════════════════════════════════════════════════
console.log('\n═══ TEST 6: D (Density/Uniqueness) — decay modulation ═══');
{
  const base = { R: 0.8, f: 3, t: 20, tau: 30 };

  // Unique info (D close to 1) decays slower
  const M_unique = calculateM({ ...base, D: 0.9 });
  // Common info (D close to 0) decays faster
  const M_common = calculateM({ ...base, D: 0.1 });
  // Very unique
  const M_veryUnique = calculateM({ ...base, D: 1.0 });

  assert(M_common < M_unique, 'Common info (D=0.1) decays faster than unique (D=0.9)');
  assert(M_unique <= M_veryUnique, 'More unique → slower decay');

  // D=0.01 (clamped minimum) should still work without error
  const M_min = calculateM({ ...base, D: 0.0 }); // should clamp to 0.01
  assert(isFinite(M_min), 'D=0 (clamped to 0.01) produces finite result');
}

// ═══════════════════════════════════════════════════════════════
console.log('\n═══ TEST 7: Threshold decisions ═══');
{
  const promoteThreshold = 1.5;
  const forgetThreshold = 0.05;

  // High value memory → promote
  const M_high = calculateM({ R: 1.0, f: 10, t: 0, tau: 30, D: 0.9 });
  assert(shouldPromote(M_high, promoteThreshold), `M=${M_high.toFixed(3)} should be promoted (>${promoteThreshold})`);

  // Old, unreinforced, low relevance → forget
  const M_low = calculateM({ R: 0.3, f: 1, t: 50, tau: 30, D: 0.5 });
  assert(shouldForget(M_low, forgetThreshold), `M=${M_low.toFixed(6)} should be forgotten (<${forgetThreshold})`);

  // Middle ground → neither
  const M_mid = calculateM({ R: 0.6, f: 2, t: 5, tau: 30, D: 0.7 });
  assert(!shouldPromote(M_mid, promoteThreshold), `M=${M_mid.toFixed(3)} should NOT be promoted`);
  assert(!shouldForget(M_mid, forgetThreshold), `M=${M_mid.toFixed(3)} should NOT be forgotten`);
}

// ═══════════════════════════════════════════════════════════════
console.log('\n═══ TEST 8: Cosine similarity ═══');
{
  // Identical vectors
  assert(approx(cosineSimilarity([1, 0, 0], [1, 0, 0]), 1), 'Identical vectors → 1');

  // Orthogonal vectors
  assert(approx(cosineSimilarity([1, 0, 0], [0, 1, 0]), 0), 'Orthogonal vectors → 0');

  // Opposite vectors
  assert(approx(cosineSimilarity([1, 0, 0], [-1, 0, 0]), -1), 'Opposite vectors → -1');

  // Similar vectors
  const sim = cosineSimilarity([1, 2, 3], [1, 2, 4]);
  assert(sim > 0.99, 'Near-identical vectors → >0.99', `got ${sim.toFixed(4)}`);

  // Zero vector
  assert(cosineSimilarity([0, 0, 0], [1, 2, 3]) === 0, 'Zero vector → 0');
}

// ═══════════════════════════════════════════════════════════════
console.log('\n═══ TEST 9: Density calculation ═══');
{
  const target = [1, 0, 0];

  // No neighbors → fully unique
  assert(calculateDensity(target, []) === 1, 'No neighbors → D=1');

  // Identical neighbor → D≈0
  const d1 = calculateDensity(target, [[1, 0, 0]]);
  assert(approx(d1, 0, 0.01), 'Identical neighbor → D≈0', `got ${d1.toFixed(4)}`);

  // Orthogonal neighbor → D=1
  const d2 = calculateDensity(target, [[0, 1, 0]]);
  assert(approx(d2, 1, 0.01), 'Orthogonal neighbor → D≈1', `got ${d2.toFixed(4)}`);

  // Mixed: one close, one far
  const d3 = calculateDensity(target, [[0.9, 0.1, 0], [0, 1, 0]]);
  assert(d3 > 0 && d3 < 1, 'Mixed neighbors → 0 < D < 1', `got ${d3.toFixed(4)}`);
}

// ═══════════════════════════════════════════════════════════════
console.log('\n═══ TEST 10: r++ @memory parser ═══');
{
  const rppSpec = `
@role {
  name: "Bank Manager"
  responsibilities: ["lending", "risk"]
}

@memory {
  tau: 30
  durability: 5
  promote_threshold: 1.5
  forget_threshold: 0.05

  @compression {
    preserve: [
      "exact monetary amounts",
      "counterparty names",
      "credit risk signals"
    ]
    discard: [
      "routine daily greetings",
      "intermediate reasoning steps"
    ]
    precis_style: "financial summary — lead with risk assessment, include numbers"
  }

  @plan_template {
    categories: ["lending", "risk_assessment", "regulatory", "reporting"]
    max_items: 10
    review_frequency: 1
  }
}
`;

  const config = parseMemoryConfig(rppSpec);
  assert(config.tau === 30, 'tau = 30');
  assert(config.durability === 5, 'durability = 5');
  assert(config.promoteThreshold === 1.5, 'promoteThreshold = 1.5');
  assert(config.forgetThreshold === 0.05, 'forgetThreshold = 0.05');
  assert(config.compression!.preserve.length === 3, '3 preserve rules');
  assert(config.compression!.preserve[0] === 'exact monetary amounts', 'First preserve rule');
  assert(config.compression!.discard.length === 2, '2 discard rules');
  assert(config.compression!.precisStyle.includes('financial summary'), 'precis_style parsed');
  assert(config.planTemplate!.categories.length === 4, '4 plan categories');
  assert(config.planTemplate!.maxItems === 10, 'max_items = 10');
  assert(config.planTemplate!.reviewFrequency === 1, 'review_frequency = 1');

  // No @memory block → empty partial
  const defaults = parseMemoryConfig('just some text without memory config');
  assert(defaults.tau === undefined, 'Missing @memory → no tau (empty partial)');
  assert(defaults.compression === undefined, 'Missing @memory → no compression');
}

// ═══════════════════════════════════════════════════════════════
console.log('\n═══ TEST 11: Simulate 50-cycle decay ═══');
{
  // Simulate a memory node decaying over 50 cycles
  const R = 0.7;
  const f = 2;
  const tau = 30;
  const D = 0.6;

  console.log('  Cycle | M value  | Status');
  console.log('  ------+----------+--------');

  let lastM = 0;
  let monotonic = true;
  for (let t = 0; t <= 50; t += 5) {
    const M = calculateM({ R, f, t, tau, D });
    const status = shouldForget(M, 0.05) ? 'FORGET' :
                   shouldPromote(M, 1.5) ? 'PROMOTE' : '-';
    console.log(`  ${String(t).padStart(5)} | ${M.toFixed(6)} | ${status}`);
    if (t > 0 && M >= lastM) monotonic = false;
    lastM = M;
  }
  assert(monotonic, 'M decreases monotonically when t increases and nothing else changes');
}

// ═══════════════════════════════════════════════════════════════
console.log('\n═══ TEST 12: Reinforcement saves a decaying memory ═══');
{
  const tau = 30;
  const D = 0.6;
  const R = 0.7;

  // After 20 cycles without access
  const M_decayed = calculateM({ R, f: 1, t: 20, tau, D });

  // Same memory but reinforced 5 times and just accessed (t=0)
  const M_reinforced = calculateM({ R, f: 5, t: 0, tau, D });

  assert(M_reinforced > M_decayed * 3, 'Reinforced+accessed memory is much stronger than decayed',
    `${M_reinforced.toFixed(4)} vs ${M_decayed.toFixed(4)}`);
}

// ═══════════════════════════════════════════════════════════════
console.log('\n═══ RESULTS ═══');
console.log(`\n  ${passed} passed, ${failed} failed, ${passed + failed} total\n`);
process.exit(failed > 0 ? 1 : 0);
