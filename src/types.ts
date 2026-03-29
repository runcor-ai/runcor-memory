// ── Memory Node ──────────────────────────────────────────────
export interface MemoryNode {
  id: string;
  content: string;
  embedding: number[];
  /** Relevance score (0-1), scored by LLM using r++ spec */
  R: number;
  /** Frequency — times reinforced (starts at 1) */
  f: number;
  /** Time since last access (in cycles, resets on access) */
  t: number;
  /** Density / uniqueness (1 - max cosine similarity to any other node) */
  D: number;
  /** Memory value — calculated from formula */
  M: number;
  /** Which cube this node lives in */
  cube: 'short' | 'long';
  /** Cycle number when created */
  createdAt: number;
  /** Cycle number when last retrieved or reinforced */
  lastAccessed: number;
  /** Which runner/cycle created this */
  source: string;
  /** Optional categorization */
  tags: string[];
}

// ── Memory Edge ──────────────────────────────────────────────
export interface MemoryEdge {
  from: string;
  to: string;
  /** Connection strength (0-1) */
  weight: number;
  /** Relationship type */
  type: 'caused' | 'related' | 'contradicts' | 'preceded' | 'reinforced';
}

// ── r++ Memory Config ────────────────────────────────────────
export interface MemoryConfig {
  /** Base half-life in cycles */
  tau: number;
  /** Long-term memories decay this factor slower */
  durability: number;
  /** M above this → promote to long-term */
  promoteThreshold: number;
  /** M below this → forget (delete from short-term) */
  forgetThreshold: number;
  /** Compression rules parsed from r++ @compression block */
  compression: CompressionConfig;
  /** Plan template parsed from r++ @plan_template block */
  planTemplate: PlanTemplateConfig;
}

export interface CompressionConfig {
  preserve: string[];
  discard: string[];
  precisStyle: string;
}

export interface PlanTemplateConfig {
  categories: string[];
  maxItems: number;
  reviewFrequency: number;
}

// ── Defaults ─────────────────────────────────────────────────
export const DEFAULT_CONFIG: MemoryConfig = {
  tau: 30,
  durability: 5,
  promoteThreshold: 1.5,
  forgetThreshold: 0.05,
  compression: {
    preserve: [],
    discard: [],
    precisStyle: 'concise summary',
  },
  planTemplate: {
    categories: [],
    maxItems: 10,
    reviewFrequency: 1,
  },
};
