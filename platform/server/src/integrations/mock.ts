import { randomUUID } from "node:crypto";
import type { ClearanceChecker, EjariProvider, EscrowProvider, IdentityProvider, TitleDeedVerifier } from "./types.js";

/**
 * Deterministic mocks for development and tests. Triggers:
 *  - title deed number starting with "BAD"  -> invalid deed
 *  - property number ending with "99"       -> overdue service charges
 *  - property number ending with "98"       -> rental dispute
 */

export class MockIdentity implements IdentityProvider {
  readonly name = "mock";
  private requests = new Map<string, boolean>();
  async startSigning() {
    const requestId = randomUUID();
    this.requests.set(requestId, false);
    return { requestId, authUrl: `mock://uaepass/sign/${requestId}` };
  }
  async getSigningResult(requestId: string) {
    if (!this.requests.has(requestId)) throw new Error("Unknown signing request");
    this.requests.set(requestId, true);
    return { status: "signed" as const, signatureId: `SIG-${requestId.slice(0, 8)}`, signedAt: new Date().toISOString() };
  }
}

export class MockTitleDeed implements TitleDeedVerifier {
  readonly name = "mock";
  async verify({ titleDeedNumber }: { titleDeedNumber: string }) {
    if (titleDeedNumber.toUpperCase().startsWith("BAD")) return { valid: false, notes: ["Title deed not found in registry"] };
    return { valid: true, notes: [] };
  }
}

export class MockClearance implements ClearanceChecker {
  readonly name = "mock";
  async check({ propertyNumber = "" }: { propertyNumber?: string }) {
    const issues: { type: "rental_dispute" | "service_charges_overdue"; detail: string }[] = [];
    if (propertyNumber.endsWith("99")) issues.push({ type: "service_charges_overdue", detail: "Outstanding service charges" });
    if (propertyNumber.endsWith("98")) issues.push({ type: "rental_dispute", detail: "Open rental dispute case" });
    return { clear: issues.length === 0, issues };
  }
}

export class MockEscrow implements EscrowProvider {
  readonly name = "mock";
  private accounts = new Map<string, number>();
  async openAccount({ contractId }: { contractId: string }) {
    const accountRef = `ESC-${contractId.slice(0, 8)}`;
    this.accounts.set(accountRef, 0);
    return { accountRef };
  }
  /** First poll reports pending, later polls funded, to exercise both states. */
  async getFundingStatus(accountRef: string) {
    const n = this.accounts.get(accountRef);
    if (n === undefined) throw new Error("Unknown escrow account");
    this.accounts.set(accountRef, n + 1);
    return { status: n >= 1 ? ("funded" as const) : ("pending" as const) };
  }
}

export class MockEjari implements EjariProvider {
  readonly name = "mock";
  private seq = 0;
  async register() {
    this.seq += 1;
    return { ejariNumber: `MOCK-EJARI-${String(this.seq).padStart(6, "0")}`, registeredAt: new Date().toISOString() };
  }
}
