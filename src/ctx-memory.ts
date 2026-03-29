/**
 * ctx.memory API for runcor engine integration.
 *
 * Extends the existing MemoryAccessor interface with cognitive memory:
 *
 *   // Existing API (backward-compatible)
 *   ctx.memory.tool.get('key')
 *   ctx.memory.tool.set('key', value)
 *   ctx.memory.user.get('key')
 *   ctx.memory.session.get('key')
 *
 *   // New cognitive memory API
 *   ctx.memory.record('event text', { tags: ['risk'] })
 *   ctx.memory.query('credit risk concerns')
 *   ctx.memory.getPlan()
 *   ctx.memory.getShortTerm()
 *   ctx.memory.getLongTerm()
 *   ctx.memory.cycle()
 *
 * Usage in runcor:
 *
 *   import { createCognitiveMemory } from 'runcor-memory';
 *
 *   const cognitiveMemory = createCognitiveMemory({
 *     dbPath: './memory.db',
 *     openaiApiKey: process.env.OPENAI_API_KEY,
 *     model: ctx.model,  // runcor's model interface
 *     agentRole: 'CEO of an autonomous company',
 *     config: { tau: 20, durability: 5 },
 *   });
 *
 *   // Attach to existing memory accessor
 *   const memory = cognitiveMemory.extend(ctx.memory);
 *   // Now memory.tool/user/session still work
 *   // Plus memory.record/query/getPlan/cycle are available
 */

import { MemoryDatabase } from './database.js';
import { MemorySystem } from './memory-system.js';
import type { FullCycleReport } from './memory-system.js';
import type { RecordOptions, QueryResult } from './cube.js';
import type { ModelComplete, Plan } from './llm.js';
import type { MemoryConfig, MemoryNode } from './types.js';
import { loadConfig } from './config-loader.js';
import type { LoadConfigOptions } from './config-loader.js';

// ── Types matching runcor's interfaces ───────────────────────

/** Matches runcor's ScopedMemory interface */
export interface ScopedMemory {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown, ttl?: number): Promise<void>;
  delete(key: string): Promise<void>;
  list(): Promise<string[]>;
}

/** Matches runcor's MemoryAccessor interface */
export interface MemoryAccessor {
  tool: ScopedMemory;
  user: ScopedMemory;
  session: ScopedMemory;
}

/** Extended memory accessor with cognitive memory */
export interface CognitiveMemoryAccessor extends MemoryAccessor {
  /** Record a new event into short-term memory */
  record(content: string, options?: RecordOptions): Promise<{ action: 'created' | 'reinforced'; nodeId: string; R?: number }>;

  /** Query both cubes by semantic similarity */
  query(text: string, topK?: number): Promise<QueryResult[]>;

  /** Get the current plan (to-do list) */
  getPlan(): Plan | null;

  /** Get plan history across all cycles */
  getPlanHistory(): Plan[];

  /** Get all short-term memories */
  getShortTerm(): MemoryNode[];

  /** Get all long-term memories */
  getLongTerm(): MemoryNode[];

  /** Get all memories from both cubes */
  getAll(): MemoryNode[];

  /** Run one cycle of maintenance (decay, promote, forget, rewrite plan) */
  cycle(): Promise<FullCycleReport>;

  /** Set the current cycle number */
  setCycle(cycle: number): void;

  /** Get the current cycle number */
  getCycle(): number;
}

// ── Factory ──────────────────────────────────────────────────

export interface CreateCognitiveMemoryOptions {
  /** Path to SQLite database file */
  dbPath: string;

  /** OpenAI API key for embeddings */
  openaiApiKey?: string;

  /** Model interface for LLM calls (R scoring, précis, plan).
   *  Matches runcor's ModelInterface.complete() signature. */
  model?: ModelComplete;

  /** Agent role description — used for R scoring context */
  agentRole?: string;

  /** Memory config — can also be loaded from YAML/r++ */
  config?: Partial<MemoryConfig>;

  /** Config loading options (YAML path, r++ path, etc.) */
  configOptions?: LoadConfigOptions;
}

export interface CognitiveMemory {
  /** The underlying MemorySystem */
  system: MemorySystem;

  /**
   * Extend an existing runcor MemoryAccessor with cognitive memory.
   * The returned object has all original scopes (tool/user/session)
   * plus the new cognitive memory methods.
   */
  extend(existing: MemoryAccessor): CognitiveMemoryAccessor;

  /**
   * Create a standalone CognitiveMemoryAccessor without an existing
   * MemoryAccessor. Uses no-op implementations for tool/user/session.
   */
  standalone(): CognitiveMemoryAccessor;

  /** Close the database connection */
  close(): void;
}

/**
 * Create a cognitive memory instance.
 *
 * Call .extend(ctx.memory) to augment runcor's existing memory,
 * or .standalone() for use outside of runcor.
 */
export function createCognitiveMemory(options: CreateCognitiveMemoryOptions): CognitiveMemory {
  // Load config from all sources
  const config = options.configOptions
    ? loadConfig({ ...options.configOptions, config: options.config })
    : loadConfig({ config: options.config });

  const db = new MemoryDatabase(options.dbPath);
  const system = new MemorySystem({
    db,
    config,
    openaiApiKey: options.openaiApiKey,
    model: options.model,
    agentRole: options.agentRole,
  });

  function buildAccessor(base: MemoryAccessor): CognitiveMemoryAccessor {
    return {
      // Preserve existing scopes
      tool: base.tool,
      user: base.user,
      session: base.session,

      // Cognitive memory methods
      record: (content, opts) => system.record(content, opts),
      query: (text, topK) => system.query(text, topK),
      getPlan: () => system.getPlan(),
      getPlanHistory: () => system.getPlanHistory(),
      getShortTerm: () => system.getShortTerm(),
      getLongTerm: () => system.getLongTerm(),
      getAll: () => system.getAll(),
      cycle: () => system.cycle(),
      setCycle: (cycle) => system.setCycle(cycle),
      getCycle: () => system.getCycle(),
    };
  }

  // No-op scoped memory for standalone use
  const noopScope: ScopedMemory = {
    get: async () => null,
    set: async () => {},
    delete: async () => {},
    list: async () => [],
  };

  return {
    system,

    extend(existing: MemoryAccessor): CognitiveMemoryAccessor {
      return buildAccessor(existing);
    },

    standalone(): CognitiveMemoryAccessor {
      return buildAccessor({
        tool: noopScope,
        user: noopScope,
        session: noopScope,
      });
    },

    close() {
      db.close();
    },
  };
}
