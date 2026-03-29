/**
 * Test config loading from YAML, r++ spec, and explicit overrides.
 */

import { loadConfig } from '../src/config-loader.js';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

let passed = 0;
let failed = 0;

function assert(condition: boolean, name: string, detail?: string): void {
  if (condition) { console.log(`  ✓ ${name}`); passed++; }
  else { console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`); failed++; }
}

const tmpDir = resolve(process.cwd(), 'test-config-tmp');

// ═══════════════════════════════════════════════════════════════
console.log('\n═══ TEST 1: Load from YAML file ═══');
{
  const yaml = `
tau: 45
durability: 8
promote_threshold: 2.0
forget_threshold: 0.03

compression:
  preserve:
    - "client names"
    - "dollar amounts"
  discard:
    - "small talk"
  precis_style: "executive brief"

plan_template:
  categories: [ops, sales, legal]
  max_items: 15
  review_frequency: 2
`;

  const yamlPath = resolve(process.cwd(), 'test-memory.yaml');
  writeFileSync(yamlPath, yaml);

  const config = loadConfig({ yamlPath });

  assert(config.tau === 45, 'tau=45 from YAML');
  assert(config.durability === 8, 'durability=8 from YAML');
  assert(config.promoteThreshold === 2.0, 'promoteThreshold=2.0 from YAML');
  assert(config.forgetThreshold === 0.03, 'forgetThreshold=0.03 from YAML');
  assert(config.compression.preserve.length === 2, '2 preserve rules');
  assert(config.compression.preserve[0] === 'client names', 'First preserve rule');
  assert(config.compression.discard[0] === 'small talk', 'Discard rule');
  assert(config.compression.precisStyle === 'executive brief', 'precis_style');
  assert(config.planTemplate.categories.length === 3, '3 categories');
  assert(config.planTemplate.maxItems === 15, 'max_items=15');
  assert(config.planTemplate.reviewFrequency === 2, 'review_frequency=2');

  unlinkSync(yamlPath);
}

// ═══════════════════════════════════════════════════════════════
console.log('\n═══ TEST 2: Load from r++ spec ═══');
{
  const rpp = `
@role { name: "Lawyer" }

@memory {
  tau: 90
  durability: 10
  promote_threshold: 1.2
  forget_threshold: 0.03

  @compression {
    preserve: ["exact contractual language", "obligations"]
    discard: ["research dead ends"]
    precis_style: "legal brief — cite clauses"
  }
}
`;

  const rppPath = resolve(process.cwd(), 'test-spec.rpp');
  writeFileSync(rppPath, rpp);

  const config = loadConfig({ rppPath });

  assert(config.tau === 90, 'tau=90 from r++ spec');
  assert(config.durability === 10, 'durability=10 from r++ spec');
  assert(config.compression.preserve[0] === 'exact contractual language', 'Preserve from r++');

  unlinkSync(rppPath);
}

// ═══════════════════════════════════════════════════════════════
console.log('\n═══ TEST 3: Explicit config overrides everything ═══');
{
  const yaml = `
tau: 45
forget_threshold: 0.03
`;
  const yamlPath = resolve(process.cwd(), 'test-memory.yaml');
  writeFileSync(yamlPath, yaml);

  const config = loadConfig({
    yamlPath,
    config: { tau: 100, forgetThreshold: 0.01 },
  });

  assert(config.tau === 100, 'Explicit tau=100 overrides YAML tau=45');
  assert(config.forgetThreshold === 0.01, 'Explicit forget=0.01 overrides YAML 0.03');
  assert(config.durability === 5, 'durability falls back to default (not in YAML or explicit)');

  unlinkSync(yamlPath);
}

// ═══════════════════════════════════════════════════════════════
console.log('\n═══ TEST 4: No config files → defaults ═══');
{
  const config = loadConfig({ cwd: '/nonexistent/path' });

  assert(config.tau === 30, 'Default tau=30');
  assert(config.durability === 5, 'Default durability=5');
  assert(config.promoteThreshold === 1.5, 'Default promote=1.5');
  assert(config.forgetThreshold === 0.05, 'Default forget=0.05');
}

// ═══════════════════════════════════════════════════════════════
console.log('\n═══ TEST 5: YAML + r++ merge (r++ overrides YAML) ═══');
{
  const yaml = `
tau: 20
durability: 3
forget_threshold: 0.1
`;
  const rpp = `
@memory {
  tau: 60
  forget_threshold: 0.02
}
`;
  const yamlPath = resolve(process.cwd(), 'test-memory.yaml');
  const rppPath = resolve(process.cwd(), 'test-spec.rpp');
  writeFileSync(yamlPath, yaml);
  writeFileSync(rppPath, rpp);

  const config = loadConfig({ yamlPath, rppPath });

  assert(config.tau === 60, 'r++ tau=60 overrides YAML tau=20');
  assert(config.forgetThreshold === 0.02, 'r++ forget=0.02 overrides YAML 0.1');
  assert(config.durability === 3, 'YAML durability=3 preserved (not in r++)');

  unlinkSync(yamlPath);
  unlinkSync(rppPath);
}

// ═══════════════════════════════════════════════════════════════
console.log('\n═══ TEST 6: Auto-detect memory.yaml in cwd ═══');
{
  const yaml = `tau: 77\n`;
  const yamlPath = resolve(process.cwd(), 'memory.yaml');
  const hadExisting = existsSync(yamlPath);
  let existingContent = '';
  if (hadExisting) {
    existingContent = (await import('node:fs')).readFileSync(yamlPath, 'utf-8');
  }

  writeFileSync(yamlPath, yaml);

  const config = loadConfig({ cwd: process.cwd() });
  assert(config.tau === 77, 'Auto-detected memory.yaml, tau=77');

  // Restore
  if (hadExisting) writeFileSync(yamlPath, existingContent);
  else unlinkSync(yamlPath);
}

// ═══════════════════════════════════════════════════════════════
console.log('\n═══ RESULTS ═══');
console.log(`\n  ${passed} passed, ${failed} failed, ${passed + failed} total\n`);
process.exit(failed > 0 ? 1 : 0);
