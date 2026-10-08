import type { Contract } from "../domain/schema.js";

export interface AuditEvent {
  at: string;
  contractId: string;
  actor: string;
  action: string;
  detail?: Record<string, unknown>;
}

/** Storage boundary. In-memory for the pilot scaffold; swap for Postgres behind this interface. */
export interface Repo {
  get(id: string): Promise<Contract | undefined>;
  save(c: Contract): Promise<void>;
  list(): Promise<Contract[]>;
  audit(e: Omit<AuditEvent, "at">): Promise<void>;
  auditFor(contractId: string): Promise<AuditEvent[]>;
}

export class MemoryRepo implements Repo {
  private contracts = new Map<string, Contract>();
  private events: AuditEvent[] = [];
  async get(id: string) {
    const c = this.contracts.get(id);
    return c ? structuredClone(c) : undefined;
  }
  async save(c: Contract) {
    c.updatedAt = new Date().toISOString();
    this.contracts.set(c.id, structuredClone(c));
  }
  async list() {
    return [...this.contracts.values()].map((c) => structuredClone(c));
  }
  async audit(e: Omit<AuditEvent, "at">) {
    this.events.push({ at: new Date().toISOString(), ...e });
  }
  async auditFor(contractId: string) {
    return this.events.filter((e) => e.contractId === contractId);
  }
}
