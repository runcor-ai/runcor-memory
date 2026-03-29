import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { MemoryConfig } from './types.js';
import { DEFAULT_CONFIG } from './types.js';
import { parseMemoryConfig } from './rpp-parser.js';

/**
 * Load memory config from multiple sources (in priority order):
 *
 *   1. Explicit config object passed in code
 *   2. YAML file (memory.yaml / memory.yml)
 *   3. r++ spec file (.rpp) with @memory block
 *   4. Defaults
 *
 * Sources are merged — later sources fill in missing values,
 * but explicit values always win.
 */

export interface LoadConfigOptions {
  /** Explicit config values — highest priority */
  config?: Partial<MemoryConfig>;
  /** Path to memory.yaml file */
  yamlPath?: string;
  /** Path to .rpp spec file with @memory block */
  rppPath?: string;
  /** Working directory to search for config files (default: cwd) */
  cwd?: string;
}

/**
 * Load and merge config from all available sources.
 */
export function loadConfig(options: LoadConfigOptions = {}): MemoryConfig {
  const cwd = options.cwd ?? process.cwd();

  // Start with defaults
  let merged: MemoryConfig = structuredClone(DEFAULT_CONFIG);

  // Layer 1: Auto-detect and load YAML if no explicit path given
  const yamlPath = options.yamlPath ?? findYamlConfig(cwd);
  if (yamlPath && existsSync(yamlPath)) {
    const yamlConfig = parseYaml(readFileSync(yamlPath, 'utf-8'));
    merged = mergeConfig(merged, yamlConfig);
  }

  // Layer 2: Load r++ spec if provided
  if (options.rppPath && existsSync(options.rppPath)) {
    const rppText = readFileSync(options.rppPath, 'utf-8');
    const rppConfig = parseMemoryConfig(rppText);
    merged = mergeConfig(merged, rppConfig);
  }

  // Layer 3: Explicit config — highest priority
  if (options.config) {
    merged = mergeConfig(merged, options.config);
  }

  return merged;
}

// ── YAML Parser (minimal, no dependency) ─────────────────────
// Parses a flat/nested YAML structure into MemoryConfig.
// We keep this simple — no need for a full YAML library for config.

function parseYaml(text: string): Partial<MemoryConfig> {
  const config: Partial<MemoryConfig> = {};
  const lines = text.split('\n');

  let currentSection: string | null = null;
  let currentArrayKey: string | null = null;
  const arrays: Record<string, string[]> = {};

  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, '').trimEnd(); // strip comments
    if (line.trim() === '') continue;

    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();

    // Top-level section headers (no colon value)
    if (indent === 0 && trimmed.endsWith(':') && !trimmed.includes(': ')) {
      currentSection = trimmed.slice(0, -1);
      currentArrayKey = null;
      continue;
    }

    // Array items: "  - value"
    if (trimmed.startsWith('- ')) {
      const value = trimmed.slice(2).trim().replace(/^["']|["']$/g, '');
      if (currentArrayKey) {
        if (!arrays[currentArrayKey]) arrays[currentArrayKey] = [];
        arrays[currentArrayKey].push(value);
      }
      continue;
    }

    // Key-value pairs
    const kvMatch = trimmed.match(/^(\w+)\s*:\s*(.+)?$/);
    if (kvMatch) {
      const key = kvMatch[1];
      const rawValue = kvMatch[2]?.trim();

      // If no value, this might be an array key
      if (!rawValue || rawValue === '') {
        currentArrayKey = currentSection ? `${currentSection}.${key}` : key;
        continue;
      }

      // Inline array: [a, b, c]
      if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
        const items = rawValue.slice(1, -1).split(',')
          .map(s => s.trim().replace(/^["']|["']$/g, ''))
          .filter(s => s.length > 0);
        const fullKey = currentSection ? `${currentSection}.${key}` : key;
        arrays[fullKey] = items;
        continue;
      }

      const value = rawValue.replace(/^["']|["']$/g, '');
      const fullKey = currentSection ? `${currentSection}.${key}` : key;
      applyValue(config, fullKey, value, arrays);
      currentArrayKey = null;
    }
  }

  // Apply collected arrays
  applyArrays(config, arrays);

  return config;
}

function applyValue(
  config: Partial<MemoryConfig>,
  key: string,
  value: string,
  _arrays: Record<string, string[]>,
): void {
  const num = parseFloat(value);
  const isNum = !isNaN(num) && value.trim() !== '';

  switch (key) {
    case 'tau':              config.tau = isNum ? num : undefined; break;
    case 'durability':       config.durability = isNum ? num : undefined; break;
    case 'promote_threshold':
    case 'promoteThreshold': config.promoteThreshold = isNum ? num : undefined; break;
    case 'forget_threshold':
    case 'forgetThreshold':  config.forgetThreshold = isNum ? num : undefined; break;
    case 'compression.precis_style':
    case 'compression.precisStyle':
      if (!config.compression) config.compression = { preserve: [], discard: [], precisStyle: '' };
      config.compression.precisStyle = value;
      break;
    case 'plan_template.max_items':
    case 'planTemplate.maxItems':
      if (!config.planTemplate) config.planTemplate = { categories: [], maxItems: 10, reviewFrequency: 1 };
      config.planTemplate.maxItems = isNum ? num : 10;
      break;
    case 'plan_template.review_frequency':
    case 'planTemplate.reviewFrequency':
      if (!config.planTemplate) config.planTemplate = { categories: [], maxItems: 10, reviewFrequency: 1 };
      config.planTemplate.reviewFrequency = isNum ? num : 1;
      break;
  }
}

function applyArrays(config: Partial<MemoryConfig>, arrays: Record<string, string[]>): void {
  if (arrays['compression.preserve']) {
    if (!config.compression) config.compression = { preserve: [], discard: [], precisStyle: '' };
    config.compression.preserve = arrays['compression.preserve'];
  }
  if (arrays['compression.discard']) {
    if (!config.compression) config.compression = { preserve: [], discard: [], precisStyle: '' };
    config.compression.discard = arrays['compression.discard'];
  }
  if (arrays['plan_template.categories'] || arrays['planTemplate.categories']) {
    if (!config.planTemplate) config.planTemplate = { categories: [], maxItems: 10, reviewFrequency: 1 };
    config.planTemplate.categories = arrays['plan_template.categories'] ?? arrays['planTemplate.categories'] ?? [];
  }
}

function findYamlConfig(cwd: string): string | null {
  const candidates = ['memory.yaml', 'memory.yml'];
  for (const name of candidates) {
    const p = resolve(cwd, name);
    if (existsSync(p)) return p;
  }
  return null;
}

function mergeConfig(base: MemoryConfig, override: Partial<MemoryConfig>): MemoryConfig {
  return {
    tau: override.tau ?? base.tau,
    durability: override.durability ?? base.durability,
    promoteThreshold: override.promoteThreshold ?? base.promoteThreshold,
    forgetThreshold: override.forgetThreshold ?? base.forgetThreshold,
    compression: {
      preserve: override.compression?.preserve?.length ? override.compression.preserve : base.compression.preserve,
      discard: override.compression?.discard?.length ? override.compression.discard : base.compression.discard,
      precisStyle: override.compression?.precisStyle || base.compression.precisStyle,
    },
    planTemplate: {
      categories: override.planTemplate?.categories?.length ? override.planTemplate.categories : base.planTemplate.categories,
      maxItems: override.planTemplate?.maxItems ?? base.planTemplate.maxItems,
      reviewFrequency: override.planTemplate?.reviewFrequency ?? base.planTemplate.reviewFrequency,
    },
  };
}
