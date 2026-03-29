import { randomUUID } from 'node:crypto';
import type { MemoryNode, MemoryConfig } from './types.js';
import { DEFAULT_CONFIG } from './types.js';
import { MemoryDatabase } from './database.js';
import { calculateM, calculateMLongTerm, shouldForget, shouldPromote } from './formula.js';
import { embed, cosineSimilarity, calculateDensity } from './embedding.js';
import { scoreRelevance, writePrecis, identifyEdges } from './llm.js';
import type { ModelComplete, Plan } from './llm.js';
import { rewritePlanHybrid } from './plan.js';
import type { RecordOptions, QueryResult, CycleReport } from './cube.js';

export interface FullCycleReport {
  cycle: number;
  shortTerm: {
    count: number;
    decayed: number;
    forgotten: string[];
  };
  longTerm: {
    count: number;
    decayed: number;
    forgotten: string[];
  };
  promoted: {
    id: string;
    originalContent: string;
    precis: string;
  }[];
  scored: {
    id: string;
    content: string;
    R: number;
    band: string;
  }[];
  plan: Plan | null;
}

export class MemorySystem {
  private db: MemoryDatabase;
  private config: MemoryConfig;
  private currentCycle: number;
  private openaiApiKey?: string;
  private model: ModelComplete | null;
  private agentRole: string;
  private cycleEvents: string[];

  constructor(options: {
    db: MemoryDatabase;
    config?: Partial<MemoryConfig>;
    openaiApiKey?: string;
    model?: ModelComplete;
    agentRole?: string;
  }) {
    this.db = options.db;
    this.config = { ...DEFAULT_CONFIG, ...options.config };
    this.currentCycle = 0;
    this.openaiApiKey = options.openaiApiKey;
    this.model = options.model ?? null;
    this.agentRole = options.agentRole ?? 'autonomous agent';
    this.cycleEvents = [];
  }

  getCycle(): number {
    return this.currentCycle;
  }

  setCycle(cycle: number): void {
    this.currentCycle = cycle;
  }

  // ── Record ─────────────────────────────────────────────────

  /**
   * Record a new event. Goes to short-term cube.
   * If a model is available, LLM scores R via the r++ spec.
   * Otherwise uses the provided R or defaults to 0.5.
   */
  async record(
    content: string,
    options: RecordOptions = {},
  ): Promise<{ action: 'created' | 'reinforced'; nodeId: string; R?: number }> {
    const newEmbedding = await embed(content, this.openaiApiKey);
    const shortNodes = this.db.getNodesByCube('short');

    // Pass 1: dedup check against short-term
    let bestMatch: { node: MemoryNode; similarity: number } | null = null;
    for (const node of shortNodes) {
      const sim = cosineSimilarity(newEmbedding, node.embedding);
      if (!bestMatch || sim > bestMatch.similarity) {
        bestMatch = { node, similarity: sim };
      }
    }

    // Also check long-term for reinforcement
    const longNodes = this.db.getNodesByCube('long');
    for (const node of longNodes) {
      const sim = cosineSimilarity(newEmbedding, node.embedding);
      if (!bestMatch || sim > bestMatch.similarity) {
        bestMatch = { node, similarity: sim };
      }
    }

    if (bestMatch && bestMatch.similarity > 0.90) {
      const node = bestMatch.node;
      const tau = node.cube === 'long'
        ? this.config.tau * this.config.durability
        : this.config.tau;
      this.db.updateNode(node.id, {
        f: node.f + 1,
        t: 0,
        lastAccessed: this.currentCycle,
      });
      const updatedM = calculateM({
        R: node.R, f: node.f + 1, t: 0, tau, D: node.D,
      });
      this.db.updateNode(node.id, { M: updatedM });
      return { action: 'reinforced', nodeId: node.id };
    }

    // Score R with LLM if available
    let R = options.R ?? 0.5;
    if (this.model && options.R === undefined) {
      try {
        const result = await scoreRelevance(this.model, content, this.config, this.agentRole);
        R = result.score;
      } catch {
        // fall back to default
      }
    }

    const id = randomUUID();
    const allEmbeddings = [...shortNodes, ...longNodes].map(n => n.embedding);
    const D = calculateDensity(newEmbedding, allEmbeddings);
    const M = calculateM({ R, f: 1, t: 0, tau: this.config.tau, D });

    const node: MemoryNode = {
      id, content, embedding: newEmbedding,
      R, f: 1, t: 0, D, M,
      cube: 'short',
      createdAt: this.currentCycle,
      lastAccessed: this.currentCycle,
      source: options.source ?? '',
      tags: options.tags ?? [],
    };

    this.db.insertNode(node);
    this.cycleEvents.push(content);

    // Identify typed edges with nearby memories (LLM-powered)
    if (this.model) {
      const allNodes = [...shortNodes, ...longNodes];
      // Only check nodes with embedding similarity > 0.3 (pre-filter to reduce LLM calls)
      const nearby = allNodes
        .map(n => ({ id: n.id, content: n.content, sim: cosineSimilarity(newEmbedding, n.embedding) }))
        .filter(n => n.sim > 0.3)
        .sort((a, b) => b.sim - a.sim)
        .slice(0, 5);

      if (nearby.length > 0) {
        try {
          const edges = await identifyEdges(
            this.model,
            content,
            nearby.map(n => ({ id: n.id, content: n.content })),
          );
          for (const edge of edges) {
            // Verify the target node exists
            if (allNodes.some(n => n.id === edge.to_id)) {
              this.db.insertEdge({
                from: id,
                to: edge.to_id,
                weight: edge.weight,
                type: edge.type,
              });
            }
          }
        } catch {
          // Edge identification failed — not critical, skip
        }
      }
    }

    return { action: 'created', nodeId: id, R };
  }

  // ── Query ──────────────────────────────────────────────────

  /**
   * Query BOTH cubes by semantic similarity.
   * Returns combined results sorted by similarity.
   * Marks accessed nodes (resets t).
   */
  async query(text: string, topK = 5): Promise<QueryResult[]> {
    const queryEmbedding = await embed(text, this.openaiApiKey);
    const allNodes = this.db.getAllNodes();

    const scored = allNodes.map(node => ({
      node,
      similarity: cosineSimilarity(queryEmbedding, node.embedding),
    }));

    scored.sort((a, b) => b.similarity - a.similarity);
    const results = scored.slice(0, topK);

    for (const r of results) {
      this.db.updateNode(r.node.id, { t: 0, lastAccessed: this.currentCycle });
    }

    return results;
  }

  // ── Cycle ──────────────────────────────────────────────────

  /**
   * Run one full cycle on both cubes:
   *
   * SHORT-TERM:
   *   1. Increment t, recalculate D and M
   *   2. Forget below threshold
   *   3. Promote above threshold → LLM writes précis → move to long-term
   *
   * LONG-TERM:
   *   4. Increment t, recalculate D and M (using tau * durability)
   *   5. Forget below threshold (very rare — long-term is durable)
   */
  async cycle(): Promise<FullCycleReport> {
    this.currentCycle++;

    const report: FullCycleReport = {
      cycle: this.currentCycle,
      shortTerm: { count: 0, decayed: 0, forgotten: [] },
      longTerm: { count: 0, decayed: 0, forgotten: [] },
      promoted: [],
      scored: [],
      plan: null,
    };

    // ── Short-term maintenance ──
    const shortNodes = this.db.getNodesByCube('short');
    report.shortTerm.count = shortNodes.length;

    if (shortNodes.length > 0) {
      // Increment t
      for (const node of shortNodes) {
        this.db.updateNode(node.id, { t: node.t + 1 });
        node.t += 1;
      }
      report.shortTerm.decayed = shortNodes.length;

      // Recalculate D
      const shortEmbeddings = shortNodes.map(n => n.embedding);
      for (let i = 0; i < shortNodes.length; i++) {
        const others = shortEmbeddings.filter((_, j) => j !== i);
        const newD = calculateDensity(shortNodes[i].embedding, others);
        if (Math.abs(newD - shortNodes[i].D) > 0.001) {
          this.db.updateNode(shortNodes[i].id, { D: newD });
          shortNodes[i].D = newD;
        }
      }

      // Recalculate M
      for (const node of shortNodes) {
        const newM = calculateM({
          R: node.R, f: node.f, t: node.t,
          tau: this.config.tau, D: node.D,
        });
        this.db.updateNode(node.id, { M: newM });
        node.M = newM;
      }

      // Forget
      for (const node of shortNodes) {
        if (shouldForget(node.M, this.config.forgetThreshold)) {
          this.db.deleteEdgesFor(node.id);
          this.db.deleteNode(node.id);
          report.shortTerm.forgotten.push(node.id);
        }
      }

      // Promote — nodes above threshold get compressed and moved to long-term
      for (const node of shortNodes) {
        if (report.shortTerm.forgotten.includes(node.id)) continue;
        if (!shouldPromote(node.M, this.config.promoteThreshold)) continue;

        let precisText = node.content;

        // LLM writes promotion précis if model available
        if (this.model) {
          try {
            // Gather related memories for context
            const related = shortNodes
              .filter(n => n.id !== node.id)
              .map(n => ({ n, sim: cosineSimilarity(node.embedding, n.embedding) }))
              .filter(x => x.sim > 0.5)
              .sort((a, b) => b.sim - a.sim)
              .slice(0, 3)
              .map(x => x.n.content);

            const result = await writePrecis(
              this.model, node.content, 'promotion', this.config, related,
            );
            precisText = result.precis;
          } catch {
            // fall back to original content
          }
        }

        // Re-embed the précis (it's different text now)
        const newEmbedding = precisText !== node.content
          ? await embed(precisText, this.openaiApiKey)
          : node.embedding;

        // Move to long-term: update cube, content, embedding
        this.db.updateNode(node.id, {
          cube: 'long',
          content: precisText,
          t: 0, // reset decay timer on promotion
        });

        // Update embedding if content changed
        if (precisText !== node.content) {
          // Need to delete and re-insert to update embedding
          const updatedNode = this.db.getNode(node.id)!;
          this.db.deleteNode(node.id);
          this.db.insertNode({
            ...updatedNode,
            content: precisText,
            embedding: newEmbedding,
            cube: 'long',
            t: 0,
          });
        }

        // Recalculate M with long-term tau
        const longM = calculateMLongTerm(
          { R: node.R, f: node.f, t: 0, tau: this.config.tau, D: node.D },
          this.config.durability,
        );
        this.db.updateNode(node.id, { M: longM });

        report.promoted.push({
          id: node.id,
          originalContent: node.content,
          precis: precisText,
        });
      }
    }

    // ── Long-term maintenance ──
    const longNodes = this.db.getNodesByCube('long');
    report.longTerm.count = longNodes.length;

    if (longNodes.length > 0) {
      const longTau = this.config.tau * this.config.durability;

      // Increment t
      for (const node of longNodes) {
        // Skip nodes just promoted this cycle (t is already 0)
        if (report.promoted.some(p => p.id === node.id)) continue;
        this.db.updateNode(node.id, { t: node.t + 1 });
        node.t += 1;
      }
      report.longTerm.decayed = longNodes.length;

      // Recalculate D across long-term nodes
      const longEmbeddings = longNodes.map(n => n.embedding);
      for (let i = 0; i < longNodes.length; i++) {
        const others = longEmbeddings.filter((_, j) => j !== i);
        const newD = calculateDensity(longNodes[i].embedding, others);
        if (Math.abs(newD - longNodes[i].D) > 0.001) {
          this.db.updateNode(longNodes[i].id, { D: newD });
          longNodes[i].D = newD;
        }
      }

      // Recalculate M with durability
      for (const node of longNodes) {
        const newM = calculateMLongTerm(
          { R: node.R, f: node.f, t: node.t, tau: this.config.tau, D: node.D },
          this.config.durability,
        );
        this.db.updateNode(node.id, { M: newM });
        node.M = newM;
      }

      // Forget (rare for long-term)
      for (const node of longNodes) {
        if (shouldForget(node.M, this.config.forgetThreshold)) {
          this.db.deleteEdgesFor(node.id);
          this.db.deleteNode(node.id);
          report.longTerm.forgotten.push(node.id);
        }
      }
    }

    // ── Plan rewriting (hybrid: code + LLM) ──
    if (this.model && this.cycleEvents.length > 0) {
      try {
        const previousPlan = this.db.getLatestPlan();
        const allNodes = this.db.getAllNodes();
        const relevantMemories = allNodes
          .sort((a, b) => b.M - a.M)
          .slice(0, 10)
          .map(n => n.content);

        const newPlan = await rewritePlanHybrid({
          model: this.model,
          previousPlan,
          cycleEvents: this.cycleEvents,
          relevantMemories,
          currentCycle: this.currentCycle,
          config: this.config,
          openaiApiKey: this.openaiApiKey,
        });

        this.db.savePlan(newPlan);
        report.plan = newPlan;
      } catch {
        // plan rewrite failed — not critical, continue
      }
    }

    // Reset cycle events buffer
    this.cycleEvents = [];

    return report;
  }

  // ── Getters ────────────────────────────────────────────────

  getShortTerm(): MemoryNode[] {
    return this.db.getNodesByCube('short');
  }

  getLongTerm(): MemoryNode[] {
    return this.db.getNodesByCube('long');
  }

  getAll(): MemoryNode[] {
    return this.db.getAllNodes();
  }

  getNode(id: string): MemoryNode | null {
    return this.db.getNode(id);
  }

  getPlan(): Plan | null {
    return this.db.getLatestPlan();
  }

  getPlanHistory(): Plan[] {
    return this.db.getAllPlans();
  }
}
