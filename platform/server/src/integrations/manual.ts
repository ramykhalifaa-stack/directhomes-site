import type { ClearanceChecker, EjariProvider, EscrowProvider, IdentityProvider, TitleDeedVerifier } from "./types.js";

/**
 * Assisted mode. For a step with no usable API (title deed check, clearance, Ejari registration) or
 * no approval yet (UAE PASS, Trustin), staff do the step through the official channel and record the
 * result with evidence. These providers are never called; the service sees `manual` and reads the
 * recorded attestation instead.
 */
const never = (step: string): never => {
  throw new Error(`${step} is a manual step: record the result through the attestation endpoint`);
};

export class ManualIdentity implements IdentityProvider {
  readonly name = "manual";
  readonly manual = true;
  startSigning(): never { return never("Signing"); }
  getSigningResult(): never { return never("Signing"); }
}
export class ManualTitleDeed implements TitleDeedVerifier {
  readonly name = "manual";
  readonly manual = true;
  verify(): never { return never("Title deed verification"); }
}
export class ManualClearance implements ClearanceChecker {
  readonly name = "manual";
  readonly manual = true;
  check(): never { return never("Clearance check"); }
}
export class ManualEscrow implements EscrowProvider {
  readonly name = "manual";
  readonly manual = true;
  openAccount(): never { return never("Deposit handling"); }
  getFundingStatus(): never { return never("Deposit handling"); }
}
export class ManualEjari implements EjariProvider {
  readonly name = "manual";
  readonly manual = true;
  register(): never { return never("Ejari registration"); }
}
