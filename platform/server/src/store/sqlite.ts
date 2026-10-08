import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import type { Contract } from "../domain/schema.js";
import type { AuditEvent, Repo } from "./repo.js";

// Loaded via require: bundlers (vitest) do not recognise the newer node:sqlite built-in.
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

/**
 * Durable single-node store for the pilot, using Node's built-in SQLite (experimental in
 * Node 22, so pin the Node version). Contracts are stored as JSON documents; the audit log
 * is append-only. Move to Postgres behind the same Repo interface before multi-instance use.
 * Documents themselves are NOT stored here (only their hashes); add encrypted object storage first.
 */
export class SqliteRepo implements Repo {
  private db: DatabaseSyncType;

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS contracts (id TEXT PRIMARY KEY, body TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, contract_id TEXT NOT NULL,
        actor TEXT NOT NULL, action TEXT NOT NULL, detail TEXT
      );
      CREATE INDEX IF NOT EXISTS audit_contract ON audit(contract_id);
    `);
  }

  async get(id: string) {
    const row = this.db.prepare("SELECT body FROM contracts WHERE id = ?").get(id) as { body: string } | undefined;
    return row ? (JSON.parse(row.body) as Contract) : undefined;
  }

  async save(c: Contract) {
    c.updatedAt = new Date().toISOString();
    this.db
      .prepare("INSERT INTO contracts (id, body, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at")
      .run(c.id, JSON.stringify(c), c.updatedAt);
  }

  async list() {
    const rows = this.db.prepare("SELECT body FROM contracts ORDER BY updated_at DESC").all() as { body: string }[];
    return rows.map((r) => JSON.parse(r.body) as Contract);
  }

  async audit(e: Omit<AuditEvent, "at">) {
    this.db
      .prepare("INSERT INTO audit (at, contract_id, actor, action, detail) VALUES (?, ?, ?, ?, ?)")
      .run(new Date().toISOString(), e.contractId, e.actor, e.action, e.detail ? JSON.stringify(e.detail) : null);
  }

  async auditFor(contractId: string) {
    const rows = this.db
      .prepare("SELECT at, contract_id, actor, action, detail FROM audit WHERE contract_id = ? ORDER BY seq")
      .all(contractId) as { at: string; contract_id: string; actor: string; action: string; detail: string | null }[];
    return rows.map((r) => ({
      at: r.at,
      contractId: r.contract_id,
      actor: r.actor,
      action: r.action,
      detail: r.detail ? (JSON.parse(r.detail) as Record<string, unknown>) : undefined,
    }));
  }

  close() {
    this.db.close();
  }
}
