import { ManualClearance, ManualEjari, ManualEscrow, ManualIdentity, ManualTitleDeed } from "./manual.js";
import { MockClearance, MockEjari, MockEscrow, MockIdentity, MockTitleDeed } from "./mock.js";
import {
  NotConfiguredError,
  type ClearanceChecker,
  type EjariProvider,
  type EscrowProvider,
  type IdentityProvider,
  type Integrations,
  type TitleDeedVerifier,
} from "./types.js";

/**
 * Chooses an adapter per provider from env (IDENTITY_MODE, TITLE_DEED_MODE, CLEARANCE_MODE,
 * ESCROW_MODE, EJARI_MODE = "mock" | "manual" | "live").
 *  - mock: deterministic fakes for development and tests.
 *  - manual: assisted mode. Staff do the step through the official channel and record the result.
 *  - live: a real API adapter. None exists yet, so this fails at startup rather than faking anything.
 * With NODE_ENV=production the default is "manual", and "mock" is refused unless ALLOW_MOCK_INTEGRATIONS=1,
 * so a deployed server can never stamp a fake Ejari number by forgetting a setting.
 */
function pick<T>(name: string, mode: string | undefined, mock: () => T, manual: () => T, env: NodeJS.ProcessEnv): T {
  const production = env.NODE_ENV === "production";
  const m = mode ?? (production ? "manual" : "mock");
  if (m === "mock") {
    if (production && env.ALLOW_MOCK_INTEGRATIONS !== "1") {
      throw new Error(`Integration '${name}' is set to mock in production. Use manual, or set ALLOW_MOCK_INTEGRATIONS=1 for a demo.`);
    }
    return mock();
  }
  if (m === "manual") return manual();
  throw new NotConfiguredError(name);
}

export function createIntegrations(env = process.env): Integrations {
  return {
    identity: pick<IdentityProvider>("identity (UAE PASS)", env.IDENTITY_MODE, () => new MockIdentity(), () => new ManualIdentity(), env),
    titleDeed: pick<TitleDeedVerifier>("title deed verification", env.TITLE_DEED_MODE, () => new MockTitleDeed(), () => new ManualTitleDeed(), env),
    clearance: pick<ClearanceChecker>("clearance check", env.CLEARANCE_MODE, () => new MockClearance(), () => new ManualClearance(), env),
    escrow: pick<EscrowProvider>("escrow (Trustin)", env.ESCROW_MODE, () => new MockEscrow(), () => new ManualEscrow(), env),
    ejari: pick<EjariProvider>("Ejari (DLD)", env.EJARI_MODE, () => new MockEjari(), () => new ManualEjari(), env),
  };
}

export function integrationModes(i: Integrations): Record<string, string> {
  return Object.fromEntries(Object.entries(i).map(([k, v]) => [k, v.name]));
}
