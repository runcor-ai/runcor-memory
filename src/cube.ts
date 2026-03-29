import { randomUUID } from 'node:crypto';
import type { MemoryNode, MemoryConfig } from './types.js';
import { DEFAULT_CONFIG } from './types.js';
import { MemoryDatabase } from './database.js';
import { calculateM, shouldForget, shouldPromote } from './formula.js';
import { embed, cosineSimilarity, calculateDensity } from './embedding.js';

export interface RecordOptions {
  source?: string;
  tags?: string[];
  /** Override R (relevance) — if not set, defaults to 0.5 until LLM scores it */
  R?: number;
}

export interface QueryResult {
  node: MemoryNode;
  similarity: number;
}

export interface CycleReport {
  cycle: number;
  decayed: number;
  forgotten: string[];
  reinforced: string[];
  promoted: string[];
  densityUpdated: number;
}

export class ShortTermCube {
  private db: MemoryDatabase;
  private config: MemoryConfig;
  private currentCycle: number;
  private openaiApiKey?: string;

  constructor(
    db: MemoryDatabase,
    config?: Partial<MemoryConfig>,
    openaiApiKey?: string,
  ) {
    this.db = db;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.currentCycle = 0;
    this.openaiApiKey = openaiApiKey;
  }

  getCycle(): number {
    return this.currentCycle;
  }

  setCycle(cycle: number): void {
    this.currentCycle = cycle;
  }

  /**
   * Record a new event into short-term memory.
   * Pass 1 compression: checks cosine similarity against existing nodes.
   * - >0.90 similarity → reinforce existing node (increment f, reset t)
   * - >0.70 similarity → still creates new node but flags it (future: merge)
   * - <0.70 similarity → new unique node
   */
  async record(
    content: string,
    options: RecordOptions = {},
  ): Promise<{ action: 'created' | 'reinforced'; nodeId: string }> {
    const newEmbedding = await embed(content, this.openaiApiKey);
    const existingNodes = this.db.getNodesByCube('short');

    // Pass 1: check for near-duplicates
    let bestMatch: { node: MemoryNode; similarity: number } | null = null;
    for (const node of existingNodes) {
      const sim = cosineSimilarity(newEmbedding, node.embedding);
      if (!bestMatch || sim > bestMatch.similarity) {
        bestMatch = { node, similarity: sim };
      }
    }

    // >0.90 = reinforce existing
    if (bestMatch && bestMatch.similarity > 0.90) {
      const node = bestMatch.node;
      this.db.updateNode(node.id, {
        f: node.f + 1,
        t: 0,
        lastAccessed: this.currentCycle,
      });
      // Recalculate M for the reinforced node
      const updatedM = calculateM({
        R: node.R,
        f: node.f + 1,
        t: 0,
        tau: this.config.tau,
        D: node.D,
      });
      this.db.updateNode(node.id, { M: updatedM });
      return { action: 'reinforced', nodeId: node.id };
    }

    // Create new node
    const id = randomUUID();
    const otherEmbeddings = existingNodes.map((n) => n.embedding);
    const D = calculateDensity(newEmbedding, otherEmbeddings);
    const R = options.R ?? 0.5; // default until LLM scores it
    const M = calculateM({ R, f: 1, t: 0, tau: this.config.tau, D });

    const node: MemoryNode = {
      id,
      content,
      embedding: newEmbedding,
      R,
      f: 1,
      t: 0,
      D,
      M,
      cube: 'short',
      createdAt: this.currentCycle,
      lastAccessed: this.currentCycle,
      source: options.source ?? '',
      tags: options.tags ?? [],
    };

    this.db.insertNode(node);

    // Create 'related' edges to nodes with similarity > 0.5
    for (const existing of existingNodes) {
      const sim = cosineSimilarity(newEmbedding, existing.embedding);
      if (sim > 0.5) {
        this.db.insertEdge({
          from: id,
          to: existing.id,
          weight: sim,
          type: 'related',
        });
      }
    }

    return { action: 'created', nodeId: id };
  }

  /**
   * Query short-term memory by semantic similarity.
   * Returns top-k results sorted by similarity, also marks accessed nodes (resets t).
   */
  async query(text: string, topK = 5): Promise<QueryResult[]> {
    const queryEmbedding = await embed(text, this.openaiApiKey);
    const nodes = this.db.getNodesByCube('short');

    const scored = nodes.map((node) => ({
      node,
      similarity: cosineSimilarity(queryEmbedding, node.embedding),
    }));

    scored.sort((a, b) => b.similarity - a.similarity);
    const results = scored.slice(0, topK);

    // Mark accessed nodes: reset t, update lastAccessed
    for (const r of results) {
      this.db.updateNode(r.node.id, { t: 0, lastAccessed: this.currentCycle });
    }

    return results;
  }

  /**
   * Run one cycle of maintenance on the short-term cube.
   * This is the "coded logic" part of the memory agent.
   *
   * 1. Increment t for all nodes
   * 2. Recalculate D (density) for all nodes
   * 3. Recalculate M for all nodes
   * 4. Forget nodes where M < forgetThreshold
   * 5. Flag nodes where M > promoteThreshold (returned for future LLM processing)
   */
  cycle(): CycleReport {
    this.currentCycle++;
    const nodes = this.db.getNodesByCube('short');
    const report: CycleReport = {
      cycle: this.currentCycle,
      decayed: 0,
      forgotten: [],
      reinforced: [],
      promoted: [],
      densityUpdated: 0,
    };

    if (nodes.length === 0) return report;

    // Step 1: Increment t for all nodes
    for (const node of nodes) {
      this.db.updateNode(node.id, { t: node.t + 1 });
      node.t += 1; // update local copy too
    }
    report.decayed = nodes.length;

    // Step 2: Recalculate D for all nodes
    const allEmbeddings = nodes.map((n) => n.embedding);
    for (let i = 0; i < nodes.length; i++) {
      const others = allEmbeddings.filter((_, j) => j !== i);
      const newD = calculateDensity(nodes[i].embedding, others);
      if (Math.abs(newD - nodes[i].D) > 0.001) {
        this.db.updateNode(nodes[i].id, { D: newD });
        nodes[i].D = newD;
        report.densityUpdated++;
      }
    }

    // Step 3: Recalculate M for all nodes
    for (const node of nodes) {
      const newM = calculateM({
        R: node.R,
        f: node.f,
        t: node.t,
        tau: this.config.tau,
        D: node.D,
      });
      this.db.updateNode(node.id, { M: newM });
      node.M = newM;
    }

    // Step 4: Forget nodes below threshold
    for (const node of nodes) {
      if (shouldForget(node.M, this.config.forgetThreshold)) {
        this.db.deleteEdgesFor(node.id);
        this.db.deleteNode(node.id);
        report.forgotten.push(node.id);
      }
    }

    // Step 5: Flag nodes above promote threshold
    for (const node of nodes) {
      if (!report.forgotten.includes(node.id) && shouldPromote(node.M, this.config.promoteThreshold)) {
        report.promoted.push(node.id);
      }
    }

    return report;
  }

  /**
   * Get all nodes in the short-term cube.
   */
  getAll(): MemoryNode[] {
    return this.db.getNodesByCube('short');
  }

  /**
   * Get a single node by ID.
   */
  getNode(id: string): MemoryNode | null {
    return this.db.getNode(id);
  }
}
