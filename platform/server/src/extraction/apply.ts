import type { Contract, DocKind, DocumentRecord, PartyRole, Section } from "../domain/schema.js";

type Mapping = [docField: string, section: Section | "party", field: string];

const MAPPINGS: Record<DocKind, Mapping[]> = {
  emirates_id: [
    ["fullName", "party", "name"],
    ["idNumber", "party", "emiratesId"],
    ["nationality", "party", "nationality"],
    ["expiryDate", "party", "emiratesIdExpiry"],
  ],
  title_deed: [
    ["titleDeedNumber", "property", "titleDeedNumber"],
    ["ownerName", "property", "ownerName"],
    ["plotNumber", "property", "plotNumber"],
    ["makaniNumber", "property", "makaniNumber"],
    ["buildingName", "property", "buildingName"],
    ["propertyNumber", "property", "propertyNumber"],
    ["propertyType", "property", "propertyType"],
    ["areaSqm", "property", "areaSqm"],
    ["location", "property", "location"],
  ],
  trade_license: [
    ["licenseNumber", "party", "tradeLicenseNo"],
    ["companyName", "party", "name"],
    ["licensingAuthority", "party", "licensingAuthority"],
    ["expiryDate", "party", "tradeLicenseExpiry"],
  ],
};

/**
 * Writes extracted values into the contract and marks each as unconfirmed, so a person
 * must review them. Never overwrites a value the user already confirmed manually.
 */
export function applyExtraction(c: Contract, doc: DocumentRecord): string[] {
  const touched: string[] = [];
  for (const [docField, target, field] of MAPPINGS[doc.kind]) {
    const hit = doc.extracted[docField];
    if (!hit) continue;
    let section: Section;
    if (target === "party") {
      if (!doc.party) throw new Error(`${doc.kind} upload requires a party (landlord or tenant)`);
      section = doc.party as PartyRole;
    } else {
      section = target;
    }
    const path = `${section}.${field}`;
    const existing = c.provenance[path];
    if (existing?.source === "manual" && existing.confirmed) continue;
    (c[section] as Record<string, unknown>)[field] = hit.value;
    c.provenance[path] = { source: "extracted", documentId: doc.id, confidence: hit.confidence, confirmed: false };
    touched.push(path);
  }
  if (doc.kind === "trade_license" && doc.party) c[doc.party].kind = "company";
  if (doc.kind === "emirates_id" && doc.party && !c[doc.party].kind) c[doc.party].kind = "individual";
  return touched;
}
