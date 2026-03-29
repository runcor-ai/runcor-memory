import type { MemoryConfig, CompressionConfig, PlanTemplateConfig } from './types.js';
import { DEFAULT_CONFIG } from './types.js';

/**
 * Parse @memory config block from r++ spec text.
 *
 * Expected format:
 *
 * @memory {
 *   tau: 30
 *   durability: 5
 *   promote_threshold: 1.5
 *   forget_threshold: 0.05
 *
 *   @compression {
 *     preserve: [
 *       "exact monetary amounts",
 *       "counterparty names"
 *     ]
 *     discard: [
 *       "routine daily greetings"
 *     ]
 *     precis_style: "financial summary — lead with risk assessment"
 *   }
 *
 *   @plan_template {
 *     categories: ["lending", "risk_assessment"]
 *     max_items: 10
 *     review_frequency: 1
 *   }
 * }
 */
export function parseMemoryConfig(rppText: string): Partial<MemoryConfig> {
  const memoryBlock = extractBlock(rppText, '@memory');
  if (!memoryBlock) return {};

  const config: Partial<MemoryConfig> = {};

  // Parse top-level numeric values — only set if present
  const tau = parseNumber(memoryBlock, 'tau');
  if (tau !== null) config.tau = tau;

  const durability = parseNumber(memoryBlock, 'durability');
  if (durability !== null) config.durability = durability;

  const promote = parseNumber(memoryBlock, 'promote_threshold');
  if (promote !== null) config.promoteThreshold = promote;

  const forget = parseNumber(memoryBlock, 'forget_threshold');
  if (forget !== null) config.forgetThreshold = forget;

  // Parse @compression sub-block
  const compressionBlock = extractBlock(memoryBlock, '@compression');
  if (compressionBlock) {
    config.compression = parseCompression(compressionBlock);
  }

  // Parse @plan_template sub-block
  const planBlock = extractBlock(memoryBlock, '@plan_template');
  if (planBlock) {
    config.planTemplate = parsePlanTemplate(planBlock);
  }

  return config;
}

// ── Internal helpers ─────────────────────────────────────────

/**
 * Extract a named block: @name { ... }
 * Handles nested braces correctly.
 */
function extractBlock(text: string, blockName: string): string | null {
  const pattern = new RegExp(`${blockName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{`);
  const match = pattern.exec(text);
  if (!match) return null;

  let depth = 1;
  let i = match.index + match[0].length;
  const start = i;

  while (i < text.length && depth > 0) {
    if (text[i] === '{') depth++;
    if (text[i] === '}') depth--;
    i++;
  }

  if (depth !== 0) return null;
  return text.slice(start, i - 1);
}

/**
 * Parse a number value: "key: 30" → 30
 */
function parseNumber(text: string, key: string): number | null {
  const match = new RegExp(`${key}\\s*:\\s*([\\d.]+)`).exec(text);
  if (!match) return null;
  const val = parseFloat(match[1]);
  return isNaN(val) ? null : val;
}

/**
 * Parse a string array: key: ["a", "b", "c"] or multiline with [ ... ]
 */
function parseStringArray(text: string, key: string): string[] {
  // Match key: [ ... ] (potentially multiline)
  const pattern = new RegExp(`${key}\\s*:\\s*\\[([^\\]]*?)\\]`, 's');
  const match = pattern.exec(text);
  if (!match) return [];

  const inner = match[1];
  const items: string[] = [];
  const stringPattern = /"([^"]*?)"/g;
  let m: RegExpExecArray | null;
  while ((m = stringPattern.exec(inner)) !== null) {
    items.push(m[1]);
  }
  return items;
}

/**
 * Parse a quoted string value: key: "value"
 */
function parseString(text: string, key: string): string | null {
  const match = new RegExp(`${key}\\s*:\\s*"([^"]*?)"`).exec(text);
  return match ? match[1] : null;
}

function parseCompression(block: string): CompressionConfig {
  return {
    preserve: parseStringArray(block, 'preserve'),
    discard: parseStringArray(block, 'discard'),
    precisStyle: parseString(block, 'precis_style') ?? DEFAULT_CONFIG.compression.precisStyle,
  };
}

function parsePlanTemplate(block: string): PlanTemplateConfig {
  return {
    categories: parseStringArray(block, 'categories'),
    maxItems: parseNumber(block, 'max_items') ?? DEFAULT_CONFIG.planTemplate.maxItems,
    reviewFrequency: parseNumber(block, 'review_frequency') ?? DEFAULT_CONFIG.planTemplate.reviewFrequency,
  };
}
