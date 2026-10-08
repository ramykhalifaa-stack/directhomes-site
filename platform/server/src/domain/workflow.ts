import { createHash } from "node:crypto";
import { EMIRATES_ID_RE, type Contract, type PartyRole } from "./schema.js";

export interface Issue {
  code: string;
  field?: string;
  message: string;
}

export interface Readiness {
  ready: boolean;
  missing: string[];
  unconfirmed: string[];
  issues: Issue[];
}

/** Fields needed per party; companies need a trade license instead of an Emirates ID. */
export function requiredPartyFields(kind: string | undefined): string[] {
  const base = ["name", "email", "phone"];
  return kind === "company"
    ? [...base, "tradeLicenseNo", "licensingAuthority"]
    : [...base, "emiratesId"];
}

export const REQUIRED_PROPERTY = [
  "titleDeedNumber",
  "ownerName",
  "plotNumber",
  "makaniNumber",
  "buildingName",
  "propertyNumber",
  "propertyType",
  "areaSqm",
  "usage",
  "premisesNo",
];
export const REQUIRED_TERMS = ["startDate", "endDate", "annualRent", "securityDeposit", "paymentCheques"];

export function requiredPaths(c: Contract): string[] {
  const paths: string[] = [];
  for (const role of ["landlord", "tenant"] as const) {
    for (const f of requiredPartyFields(c[role].kind)) paths.push(`${role}.${f}`);
  }
  for (const f of REQUIRED_PROPERTY) paths.push(`property.${f}`);
  for (const f of REQUIRED_TERMS) paths.push(`terms.${f}`);
  return paths;
}

export function getPath(c: Contract, path: string): unknown {
  const [section, field] = path.split(".") as [string, string];
  return (c as unknown as Record<string, Record<string, unknown>>)[section]?.[field];
}

export function normalizeName(s: string | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");
}

function isExpired(date: string | undefined, today: Date): boolean {
  if (!date) return false;
  const d = new Date(date);
  return !Number.isNaN(d.getTime()) && d < today;
}

export function computeReadiness(c: Contract, today = new Date()): Readiness {
  const missing: string[] = [];
  const unconfirmed: string[] = [];
  const issues: Issue[] = [];

  for (const path of requiredPaths(c)) {
    const v = getPath(c, path);
    if (v === undefined || v === "") {
      missing.push(path);
      continue;
    }
    const prov = c.provenance[path];
    if (prov && !prov.confirmed) unconfirmed.push(path);
  }

  for (const role of ["landlord", "tenant"] as const) {
    const p = c[role];
    if (p.emiratesId && !EMIRATES_ID_RE.test(p.emiratesId)) {
      issues.push({ code: "invalid_emirates_id", field: `${role}.emiratesId`, message: "Emirates ID format is invalid" });
    }
    if (isExpired(p.emiratesIdExpiry, today)) {
      issues.push({ code: "emirates_id_expired", field: `${role}.emiratesIdExpiry`, message: `${role} Emirates ID is expired` });
    }
    if (isExpired(p.tradeLicenseExpiry, today)) {
      issues.push({ code: "trade_license_expired", field: `${role}.tradeLicenseExpiry`, message: `${role} trade license is expired` });
    }
  }

  const { startDate, endDate } = c.terms;
  if (startDate && endDate && new Date(endDate) <= new Date(startDate)) {
    issues.push({ code: "invalid_period", field: "terms.endDate", message: "End date must be after start date" });
  }

  if (c.landlord.name && c.property.ownerName && normalizeName(c.landlord.name) !== normalizeName(c.property.ownerName)) {
    issues.push({
      code: "owner_mismatch",
      field: "landlord.name",
      message: "Landlord name does not match the title deed owner (a power of attorney flow is not supported yet)",
    });
  }

  return { ready: missing.length + unconfirmed.length + issues.length === 0, missing, unconfirmed, issues };
}

/** Canonical content hash used to freeze the contract before signing. */
export function contractHash(c: Contract): string {
  const canonical = JSON.stringify({
    landlord: sortKeys(c.landlord),
    tenant: sortKeys(c.tenant),
    property: sortKeys(c.property),
    terms: sortKeys(c.terms),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

function sortKeys(o: object): object {
  return Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
}

export class WorkflowError extends Error {
  constructor(
    message: string,
    public statusCode = 409,
    public details?: unknown,
  ) {
    super(message);
  }
}

export function assertStatus(c: Contract, allowed: Contract["status"][], action: string): void {
  if (!allowed.includes(c.status)) {
    throw new WorkflowError(`Cannot ${action} while contract is '${c.status}' (allowed: ${allowed.join(", ")})`);
  }
}

export function otherRole(role: PartyRole): PartyRole {
  return role === "landlord" ? "tenant" : "landlord";
}
