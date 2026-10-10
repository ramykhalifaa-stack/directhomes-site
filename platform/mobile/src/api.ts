export type Role = "landlord" | "tenant";
export type DocKind = "emirates_id" | "title_deed" | "trade_license";

export interface Contract {
  id: string;
  status: "draft" | "verified" | "signing" | "signed" | "registered";
  landlord: Record<string, string>;
  tenant: Record<string, string>;
  property: Record<string, string>;
  terms: Record<string, string | boolean>;
  provenance: Record<string, { source: string; confidence?: number; confirmed: boolean }>;
  verification?: { titleDeed: { valid: boolean; notes: string[] }; clearance: { clear: boolean; issues: { type: string; detail: string }[] } };
  signatures: Partial<Record<Role, { status: "pending" | "signed"; method?: "uaepass" | "manual"; signedOn?: string }>>;
  escrow?: { accountRef: string; status: "pending" | "funded"; manual?: boolean };
  attestations?: { titleDeed?: { valid: boolean }; clearance?: { clear: boolean } };
  ejari?: { ejariNumber: string; manual?: boolean };
  consent?: { at: string; noticeVersion: string };
}

/** Which provider handles each step: "manual" means staff do it and record the result. */
export type Modes = Partial<Record<"identity" | "titleDeed" | "clearance" | "escrow" | "ejari", string>>;

export interface Readiness {
  ready: boolean;
  missing: string[];
  unconfirmed: string[];
  issues: { code: string; message: string }[];
}

export class Api {
  constructor(private baseUrl: string, private token: string) {}

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(this.baseUrl + path, {
      method,
      headers: body === undefined ? { authorization: `Bearer ${this.token}` } : { authorization: `Bearer ${this.token}`, "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((json as { error?: string }).error ?? `HTTP ${res.status}`);
    return json as T;
  }

  integrations = () => this.req<Modes>("GET", "/integrations");
  addEvidence = (id: string, label: string, mimeType: "image/jpeg" | "image/png", dataBase64: string) =>
    this.req<{ evidence: { id: string } }>("POST", `/contracts/${id}/evidence`, { label, filename: `${label}.jpg`, mimeType, dataBase64 });
  attestTitleDeed = (id: string, valid: boolean, notes: string[], evidenceIds: string[]) =>
    this.req<Contract>("POST", `/contracts/${id}/attest/title-deed`, { valid, notes, evidenceIds });
  attestClearance = (id: string, clear: boolean, source: string, issues: { type: string; detail: string }[], evidenceIds: string[]) =>
    this.req<Contract>("POST", `/contracts/${id}/attest/clearance`, { clear, source, issues, evidenceIds });
  attestSignature = (id: string, role: Role, signedOn: string, evidenceIds: string[]) =>
    this.req<Contract>("POST", `/contracts/${id}/attest/signature`, { role, signedOn, evidenceIds });
  attestDeposit = (id: string, b: { method: string; reference: string; amount: string; receivedOn: string; evidenceIds: string[] }) =>
    this.req<Contract>("POST", `/contracts/${id}/attest/deposit`, b);
  attestEjari = (id: string, b: { ejariNumber: string; channel: string; registeredOn: string; evidenceIds: string[] }) =>
    this.req<Contract>("POST", `/contracts/${id}/attest/ejari`, b);
  create = () => this.req<Contract>("POST", "/contracts");
  get = (id: string) => this.req<Contract>("GET", `/contracts/${id}`);
  patch = (id: string, p: object) => this.req<Contract>("PATCH", `/contracts/${id}`, p);
  readiness = (id: string) => this.req<Readiness>("GET", `/contracts/${id}/readiness`);
  recordConsent = (id: string, noticeVersion: string) => this.req<Contract>("POST", `/contracts/${id}/consent`, { noticeVersion });
  confirmAll = (id: string) => this.req<Contract>("POST", `/contracts/${id}/confirm`, { fields: "all" });
  verify = (id: string) => this.req<Contract>("POST", `/contracts/${id}/verify`);
  upload = (id: string, kind: DocKind, party: Role | undefined, mimeType: string, dataBase64: string) =>
    this.req<{ contract: Contract; applied: string[] }>("POST", `/contracts/${id}/documents`, {
      kind, party, filename: `${kind}.jpg`, mimeType, dataBase64,
    });
  startSigning = (id: string, role: Role) => this.req<{ contract: Contract; authUrl?: string }>("POST", `/contracts/${id}/signatures`, { role });
  completeSigning = (id: string, role: Role) => this.req<Contract>("POST", `/contracts/${id}/signatures/complete`, { role });
  openEscrow = (id: string) => this.req<Contract>("POST", `/contracts/${id}/escrow`);
  refreshEscrow = (id: string) => this.req<Contract>("POST", `/contracts/${id}/escrow/refresh`);
  registerEjari = (id: string) => this.req<Contract>("POST", `/contracts/${id}/ejari`);
  pdfUrl = async (id: string) => this.baseUrl + (await this.req<{ url: string }>("POST", `/contracts/${id}/pdf-link`)).url;
}
