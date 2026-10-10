import type { PartyRole } from "../domain/schema.js";

/**
 * Provider contracts. These shapes are OUR design. The real UAE PASS, Trustin, DLD/Ejari,
 * title deed and clearance APIs have their own schemas; each live adapter maps them onto
 * these interfaces once API documentation and credentials are available.
 */

export class NotConfiguredError extends Error {
  constructor(provider: string) {
    super(`Integration '${provider}' is set to live mode but no live adapter is implemented/configured`);
  }
}

export interface IdentityProvider {
  readonly name: string;
  /** true: this step is done by staff and recorded through an attestation endpoint, not by an API */
  readonly manual?: boolean;
  /** Start a signing request for one party over a frozen document hash. */
  startSigning(a: { contractId: string; role: PartyRole; documentHash: string; emiratesId?: string }): Promise<{ requestId: string; authUrl?: string }>;
  /** Poll the result of a signing request. */
  getSigningResult(requestId: string): Promise<{ status: "pending" | "signed"; signatureId?: string; signedAt?: string }>;
}

export interface TitleDeedVerifier {
  readonly name: string;
  /** true: this step is done by staff and recorded through an attestation endpoint, not by an API */
  readonly manual?: boolean;
  verify(a: { titleDeedNumber: string; ownerName?: string }): Promise<{ valid: boolean; notes: string[] }>;
}

export interface ClearanceIssue {
  type: "rental_dispute" | "service_charges_overdue" | "mortgage_restriction" | "other";
  detail: string;
}

export interface ClearanceChecker {
  readonly name: string;
  /** true: this step is done by staff and recorded through an attestation endpoint, not by an API */
  readonly manual?: boolean;
  check(a: { titleDeedNumber: string; propertyNumber?: string; buildingName?: string }): Promise<{ clear: boolean; issues: ClearanceIssue[] }>;
}

export interface EscrowProvider {
  readonly name: string;
  /** true: this step is done by staff and recorded through an attestation endpoint, not by an API */
  readonly manual?: boolean;
  openAccount(a: { contractId: string; amount: string; payerRole: PartyRole }): Promise<{ accountRef: string }>;
  getFundingStatus(accountRef: string): Promise<{ status: "pending" | "funded" }>;
}

export interface EjariProvider {
  readonly name: string;
  /** true: this step is done by staff and recorded through an attestation endpoint, not by an API */
  readonly manual?: boolean;
  register(a: { contractId: string; documentHash: string; titleDeedNumber: string; landlordId: string; tenantId: string }): Promise<{ ejariNumber: string; registeredAt: string }>;
}

export interface Integrations {
  identity: IdentityProvider;
  titleDeed: TitleDeedVerifier;
  clearance: ClearanceChecker;
  escrow: EscrowProvider;
  ejari: EjariProvider;
}
