import { createHash, randomBytes } from "node:crypto";
import { EMIRATES_ID_RE } from "./domain/schema.js";
import { NotConfiguredError } from "./integrations/types.js";

export interface AuthUser {
  userId: string;
  name: string;
  emiratesId: string;
}

/** Login through the UAE national digital identity. Shapes are our own; map the real API here. */
export interface AuthProvider {
  readonly name: string;
  startLogin(hint?: string): Promise<{ state: string; authUrl?: string }>;
  completeLogin(state: string): Promise<AuthUser>;
}

/**
 * Development/test login. It trusts whatever Emirates ID the caller claims, so it is NEVER safe on a
 * reachable server: it is only enabled when AUTH_MODE=mock is set explicitly.
 */
export class MockAuth implements AuthProvider {
  readonly name = "mock";
  private pending = new Map<string, string>();
  async startLogin(hint?: string) {
    if (!hint || !EMIRATES_ID_RE.test(hint)) throw new Error("mock login needs an Emirates ID as hint");
    const state = randomBytes(16).toString("hex");
    this.pending.set(state, hint);
    return { state, authUrl: `mock://uaepass/login/${state}` };
  }
  async completeLogin(state: string) {
    const eid = this.pending.get(state);
    if (!eid) throw new Error("Unknown or already used login state");
    this.pending.delete(state);
    return { userId: `uaepass:${eid}`, name: "Mock User", emiratesId: eid };
  }
}

export function createAuthProvider(env = process.env): AuthProvider | undefined {
  const mode = env.AUTH_MODE ?? "disabled";
  if (mode === "disabled") return undefined;
  if (mode === "mock") return new MockAuth();
  throw new NotConfiguredError("login (UAE PASS)");
}

/** Opaque bearer sessions. Only a hash of each token is kept, so a memory dump does not leak live tokens. */
export class SessionStore {
  private sessions = new Map<string, { user: AuthUser; expires: number }>();
  constructor(private ttlMs = 8 * 60 * 60 * 1000, private now: () => number = Date.now) {}

  private h(token: string) {
    return createHash("sha256").update(token).digest("hex");
  }
  create(user: AuthUser): string {
    const token = randomBytes(32).toString("base64url");
    this.sessions.set(this.h(token), { user, expires: this.now() + this.ttlMs });
    return token;
  }
  resolve(token: string): AuthUser | undefined {
    const s = this.sessions.get(this.h(token));
    if (!s) return undefined;
    if (s.expires <= this.now()) {
      this.sessions.delete(this.h(token));
      return undefined;
    }
    return s.user;
  }
  revoke(token: string) {
    this.sessions.delete(this.h(token));
  }
}
