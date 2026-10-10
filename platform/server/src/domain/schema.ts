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
}

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
  };
  consent?: { at: string; by: string; noticeVersion: string };
  contractHash?: string;
  signatures: Partial<Record<PartyRole, Signature>>;
  escrow?: { accountRef: string; status: "pending" | "funded" };
  ejari?: { ejariNumber: string; registeredAt: string };
  createdAt: string;
  updatedAt: string;
}
