import Database from 'better-sqlite3';
import type { MemoryNode, MemoryEdge } from './types.js';
import type { Plan } from './llm.js';

export class MemoryDatabase {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memory_nodes (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        embedding BLOB NOT NULL,
        R REAL NOT NULL,
        f INTEGER NOT NULL DEFAULT 1,
        t INTEGER NOT NULL DEFAULT 0,
        D REAL NOT NULL DEFAULT 1,
        M REAL NOT NULL DEFAULT 0,
        cube TEXT NOT NULL DEFAULT 'short',
        created_at INTEGER NOT NULL,
        last_accessed INTEGER NOT NULL,
        source TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS memory_edges (
        "from" TEXT NOT NULL,
        "to" TEXT NOT NULL,
        weight REAL NOT NULL DEFAULT 0.5,
        type TEXT NOT NULL DEFAULT 'related',
        PRIMARY KEY ("from", "to"),
        FOREIGN KEY ("from") REFERENCES memory_nodes(id) ON DELETE CASCADE,
        FOREIGN KEY ("to") REFERENCES memory_nodes(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_nodes_cube ON memory_nodes(cube);
      CREATE INDEX IF NOT EXISTS idx_nodes_M ON memory_nodes(M);
      CREATE INDEX IF NOT EXISTS idx_edges_from ON memory_edges("from");
      CREATE INDEX IF NOT EXISTS idx_edges_to ON memory_edges("to");

      CREATE TABLE IF NOT EXISTS memory_plans (
        cycle INTEGER PRIMARY KEY,
        items TEXT NOT NULL,
        strategy TEXT NOT NULL DEFAULT '',
        changes TEXT NOT NULL DEFAULT '[]',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  // ── Node Operations ──────────────────────────────────────

  insertNode(node: MemoryNode): void {
    this.db.prepare(`
      INSERT INTO memory_nodes (id, content, embedding, R, f, t, D, M, cube, created_at, last_accessed, source, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      node.id,
      node.content,
      Buffer.from(new Float64Array(node.embedding).buffer),
      node.R,
      node.f,
      node.t,
      node.D,
      node.M,
      node.cube,
      node.createdAt,
      node.lastAccessed,
      node.source,
      JSON.stringify(node.tags),
    );
  }

  getNode(id: string): MemoryNode | null {
    const row = this.db.prepare('SELECT * FROM memory_nodes WHERE id = ?').get(id) as any;
    return row ? this.rowToNode(row) : null;
  }

  getNodesByCube(cube: 'short' | 'long'): MemoryNode[] {
    const rows = this.db.prepare('SELECT * FROM memory_nodes WHERE cube = ?').all(cube) as any[];
    return rows.map((r) => this.rowToNode(r));
  }

  getAllNodes(): MemoryNode[] {
    const rows = this.db.prepare('SELECT * FROM memory_nodes').all() as any[];
    return rows.map((r) => this.rowToNode(r));
  }

  updateNode(id: string, updates: Partial<Pick<MemoryNode, 'f' | 't' | 'D' | 'M' | 'R' | 'lastAccessed' | 'cube' | 'content'>>): void {
    const sets: string[] = [];
    const values: any[] = [];

    if (updates.f !== undefined) { sets.push('f = ?'); values.push(updates.f); }
    if (updates.t !== undefined) { sets.push('t = ?'); values.push(updates.t); }
    if (updates.D !== undefined) { sets.push('D = ?'); values.push(updates.D); }
    if (updates.M !== undefined) { sets.push('M = ?'); values.push(updates.M); }
    if (updates.R !== undefined) { sets.push('R = ?'); values.push(updates.R); }
    if (updates.lastAccessed !== undefined) { sets.push('last_accessed = ?'); values.push(updates.lastAccessed); }
    if (updates.cube !== undefined) { sets.push('cube = ?'); values.push(updates.cube); }
    if (updates.content !== undefined) { sets.push('content = ?'); values.push(updates.content); }

    if (sets.length === 0) return;
    values.push(id);
    this.db.prepare(`UPDATE memory_nodes SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  }

  deleteNode(id: string): void {
    this.db.prepare('DELETE FROM memory_nodes WHERE id = ?').run(id);
  }

  // ── Edge Operations ──────────────────────────────────────

  insertEdge(edge: MemoryEdge): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO memory_edges ("from", "to", weight, type)
      VALUES (?, ?, ?, ?)
    `).run(edge.from, edge.to, edge.weight, edge.type);
  }

  getEdgesFrom(nodeId: string): MemoryEdge[] {
    return this.db.prepare('SELECT * FROM memory_edges WHERE "from" = ?').all(nodeId) as MemoryEdge[];
  }

  getEdgesTo(nodeId: string): MemoryEdge[] {
    return this.db.prepare('SELECT * FROM memory_edges WHERE "to" = ?').all(nodeId) as MemoryEdge[];
  }

  deleteEdgesFor(nodeId: string): void {
    this.db.prepare('DELETE FROM memory_edges WHERE "from" = ? OR "to" = ?').run(nodeId, nodeId);
  }

  // ── Plan Operations ──────────────────────────────────────

  savePlan(plan: Plan): void {
    this.db.prepare(`
      INSERT OR REPLACE INTO memory_plans (cycle, items, strategy, changes)
      VALUES (?, ?, ?, ?)
    `).run(
      plan.cycle,
      JSON.stringify(plan.items),
      plan.strategy,
      JSON.stringify(plan.changes),
    );
  }

  getPlan(cycle: number): Plan | null {
    const row = this.db.prepare('SELECT * FROM memory_plans WHERE cycle = ?').get(cycle) as any;
    if (!row) return null;
    return {
      cycle: row.cycle,
      items: JSON.parse(row.items),
      strategy: row.strategy,
      changes: JSON.parse(row.changes),
    };
  }

  getLatestPlan(): Plan | null {
    const row = this.db.prepare('SELECT * FROM memory_plans ORDER BY cycle DESC LIMIT 1').get() as any;
    if (!row) return null;
    return {
      cycle: row.cycle,
      items: JSON.parse(row.items),
      strategy: row.strategy,
      changes: JSON.parse(row.changes),
    };
  }

  getAllPlans(): Plan[] {
    const rows = this.db.prepare('SELECT * FROM memory_plans ORDER BY cycle ASC').all() as any[];
    return rows.map(row => ({
      cycle: row.cycle,
      items: JSON.parse(row.items),
      strategy: row.strategy,
      changes: JSON.parse(row.changes),
    }));
  }

  // ── Helpers ──────────────────────────────────────────────

  private rowToNode(row: any): MemoryNode {
    const buf = row.embedding as Buffer;
    const float64 = new Float64Array(buf.buffer, buf.byteOffset, buf.byteLength / 8);
    return {
      id: row.id,
      content: row.content,
      embedding: Array.from(float64),
      R: row.R,
      f: row.f,
      t: row.t,
      D: row.D,
      M: row.M,
      cube: row.cube,
      createdAt: row.created_at,
      lastAccessed: row.last_accessed,
      source: row.source,
      tags: JSON.parse(row.tags),
    };
  }

  close(): void {
    this.db.close();
  }
}
