import { MockClearance, MockEjari, MockEscrow, MockIdentity, MockTitleDeed } from "./mock.js";
import { NotConfiguredError, type Integrations } from "./types.js";

/**
 * Chooses an adapter per provider from env (IDENTITY_MODE, TITLE_DEED_MODE, CLEARANCE_MODE,
 * ESCROW_MODE, EJARI_MODE = "mock" | "live"). Live adapters are added in ./live/*.ts when
 * partner documentation and credentials exist. Until then "live" fails loudly rather than
 * falling back to a mock, so a misconfigured production can never fake a registration.
 */
function pick<T>(name: string, mode: string | undefined, mock: T): T {
  if ((mode ?? "mock") === "mock") return mock;
  throw new NotConfiguredError(name);
}

export function createIntegrations(env = process.env): Integrations {
  return {
    identity: pick("identity (UAE PASS)", env.IDENTITY_MODE, new MockIdentity()),
    titleDeed: pick("title deed verification", env.TITLE_DEED_MODE, new MockTitleDeed()),
    clearance: pick("clearance check", env.CLEARANCE_MODE, new MockClearance()),
    escrow: pick("escrow (Trustin)", env.ESCROW_MODE, new MockEscrow()),
    ejari: pick("Ejari (DLD)", env.EJARI_MODE, new MockEjari()),
  };
}

export function integrationModes(i: Integrations): Record<string, string> {
  return Object.fromEntries(Object.entries(i).map(([k, v]) => [k, v.name]));
}
