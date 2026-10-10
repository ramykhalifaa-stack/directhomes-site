import { z } from "zod";

export const EMIRATES_ID_RE = /^784-?\d{4}-?\d{7}-?\d$/;

export const PartyRole = z.enum(["landlord", "tenant"]);
export type PartyRole = z.infer<typeof PartyRole>;

export const PartySchema = z
  .object({
    kind: z.enum(["individual", "company"]),
    name: z.string(),
    emiratesId: z.string(),
    nationality: z.string(),
    emiratesIdExpiry: z.string(),
    tradeLicenseNo: z.string(),
    licensingAuthority: z.string(),
    tradeLicenseExpiry: z.string(),
    email: z.string(),
    phone: z.string(),
  })
  .partial();
export type Party = z.infer<typeof PartySchema>;

export const PropertySchema = z
  .object({
    titleDeedNumber: z.string(),
    ownerName: z.string(),
    plotNumber: z.string(),
    makaniNumber: z.string(),
    buildingName: z.string(),
    propertyNumber: z.string(),
    propertyType: z.string(),
    areaSqm: z.string(),
    location: z.string(),
    usage: z.string(),
    premisesNo: z.string(),
  })
  .partial();
export type Property = z.infer<typeof PropertySchema>;

export const TermsSchema = z
  .object({
    startDate: z.string(),
    endDate: z.string(),
    annualRent: z.string(),
    contractValue: z.string(),
    securityDeposit: z.string(),
    paymentCheques: z.string(),
    useEscrow: z.boolean(),
  })
  .partial();
export type Terms = z.infer<typeof TermsSchema>;

export type Section = "landlord" | "tenant" | "property" | "terms";

export interface Provenance {
  source: "extracted" | "manual";
  documentId?: string;
  confidence?: number;
  confirmed: boolean;
}

export type DocKind = "emirates_id" | "title_deed" | "trade_license";
export const DocKindSchema = z.enum(["emirates_id", "title_deed", "trade_license"]);

export interface DocumentRecord {
  id: string;
  kind: DocKind;
  party?: PartyRole;
  filename: string;
  mimeType: string;
  sha256: string;
  extracted: Record<string, { value: string; confidence: number }>;
  uploadedAt: string;
}

export type Status = "draft" | "verified" | "signing" | "signed" | "registered";

export interface Signature {
  requestId: string;
  status: "pending" | "signed";
  signatureId?: string;
  signedAt?: string;
  /** uaepass: signed through the identity provider. manual: staff recorded a signed paper copy. */
  method?: "uaepass" | "manual";
  /** manual only: the date written on the signed copy, and the scan that proves it */
  signedOn?: string;
  evidenceIds?: string[];
}

/** A photo or scan kept as proof of a manual step (title deed check, signed copy, Ejari certificate). */
export interface Evidence {
  id: string;
  label: string;
  filename: string;
  mimeType: string;
  sha256: string;
  uploadedAt: string;
  uploadedBy: string;
}

interface AttestationBase {
  by: string;
  at: string;
  evidenceIds: string[];
  /** hash of the property details the check was made against; a changed property makes the check stale */
  basis: string;
}
export type TitleDeedAttestation = AttestationBase & { valid: boolean; notes: string[] };
export type ClearanceAttestation = AttestationBase & {
  clear: boolean;
  source: string;
  issues: { type: string; detail: string }[];
};

export interface Contract {
  id: string;
  status: Status;
  landlord: Party;
  tenant: Party;
  property: Property;
  terms: Terms;
  provenance: Record<string, Provenance>;
  documents: DocumentRecord[];
  verification?: {
    at: string;
    titleDeed: { valid: boolean; notes: string[] };
    clearance: { clear: boolean; issues: { type: string; detail: string }[] };
    source?: "api" | "manual";
  };
  evidence?: Evidence[];
  attestations?: { titleDeed?: TitleDeedAttestation; clearance?: ClearanceAttestation };
  consent?: { at: string; by: string; noticeVersion: string };
  contractHash?: string;
  signatures: Partial<Record<PartyRole, Signature>>;
  escrow?: {
    accountRef: string;
    status: "pending" | "funded";
    /** manual: staff recorded a deposit received outside an escrow provider */
    manual?: boolean;
    deposit?: { method: string; reference: string; amount: string; receivedOn: string; by: string; at: string; evidenceIds: string[] };
  };
  ejari?: { ejariNumber: string; registeredAt: string; manual?: boolean; channel?: string; registeredOn?: string; evidenceIds?: string[] };
  createdAt: string;
  updatedAt: string;
}
