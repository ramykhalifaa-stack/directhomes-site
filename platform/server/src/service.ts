import { createHash, randomUUID } from "node:crypto";
import { applyExtraction } from "./extraction/apply.js";
import type { DocumentExtractor } from "./extraction/index.js";
import type { Contract, DocKind, DocumentRecord, Party, PartyRole, Property, Section, Terms } from "./domain/schema.js";
import { assertStatus, computeReadiness, contractHash, WorkflowError } from "./domain/workflow.js";
import type { Integrations } from "./integrations/types.js";
import type { DocumentStore } from "./store/documents.js";
import type { Repo } from "./store/repo.js";

export interface Patch {
  landlord?: Party;
  tenant?: Party;
  property?: Property;
  terms?: Terms;
}

export class ContractService {
  constructor(
    private repo: Repo,
    private extractor: DocumentExtractor,
    private integ: Integrations,
    private docs: DocumentStore,
  ) {}

  private async load(id: string): Promise<Contract> {
    const c = await this.repo.get(id);
    if (!c) throw new WorkflowError("Contract not found", 404);
    return c;
  }

  async create(actor: string): Promise<Contract> {
    const now = new Date().toISOString();
    const c: Contract = {
      id: randomUUID(),
      status: "draft",
      landlord: {},
      tenant: {},
      property: {},
      terms: {},
      provenance: {},
      documents: [],
      signatures: {},
      createdAt: now,
      updatedAt: now,
    };
    await this.repo.save(c);
    await this.repo.audit({ contractId: c.id, actor, action: "contract.created" });
    return c;
  }

  get(id: string) {
    return this.load(id);
  }

  /** Records that the data-processing notice was shown and accepted. Required before any personal data is entered. */
  async recordConsent(id: string, noticeVersion: string, actor: string): Promise<Contract> {
    const c = await this.load(id);
    assertStatus(c, ["draft", "verified"], "record consent");
    c.consent = { at: new Date().toISOString(), by: actor, noticeVersion };
    await this.repo.save(c);
    await this.repo.audit({ contractId: id, actor, action: "consent.recorded", detail: { noticeVersion } });
    return c;
  }

  private requireConsent(c: Contract) {
    if (!c.consent) throw new WorkflowError("Data-processing consent must be recorded before personal data is entered", 409);
  }

  /** Editing is only allowed before signing. Editing a verified contract sends it back to draft. */
  async patch(id: string, patch: Patch, actor: string): Promise<Contract> {
    const c = await this.load(id);
    assertStatus(c, ["draft", "verified"], "edit");
    if (patch.landlord || patch.tenant) this.requireConsent(c);
    const changed: string[] = [];
    for (const section of ["landlord", "tenant", "property", "terms"] as Section[]) {
      const incoming = patch[section] as Record<string, unknown> | undefined;
      if (!incoming) continue;
      for (const [field, v] of Object.entries(incoming)) {
        if (v === undefined) continue;
        (c[section] as Record<string, unknown>)[field] = v;
        c.provenance[`${section}.${field}`] = { source: "manual", confirmed: true };
        changed.push(`${section}.${field}`);
      }
    }
    if (changed.length) this.invalidate(c);
    await this.repo.save(c);
    await this.repo.audit({ contractId: id, actor, action: "contract.edited", detail: { fields: changed } });
    return c;
  }

  async addDocument(
    id: string,
    a: { kind: DocKind; party?: PartyRole; filename: string; mimeType: string; data: Buffer },
    actor: string,
  ): Promise<{ contract: Contract; document: DocumentRecord; applied: string[] }> {
    const c = await this.load(id);
    assertStatus(c, ["draft", "verified"], "add documents");
    this.requireConsent(c);
    if (a.kind !== "title_deed" && !a.party) throw new WorkflowError("party is required for this document kind", 400);
    const extracted = await this.extractor.extract({ kind: a.kind, filename: a.filename, mimeType: a.mimeType, data: a.data });
    const document: DocumentRecord = {
      id: randomUUID(),
      kind: a.kind,
      party: a.party,
      filename: a.filename,
      mimeType: a.mimeType,
      sha256: createHash("sha256").update(a.data).digest("hex"),
      extracted,
      uploadedAt: new Date().toISOString(),
    };
    await this.docs.put(`${id}/${document.id}`, a.data);
    c.documents.push(document);
    const applied = applyExtraction(c, document);
    if (applied.length) this.invalidate(c);
    await this.repo.save(c);
    await this.repo.audit({
      contractId: id,
      actor,
      action: "document.extracted",
      detail: { kind: a.kind, documentId: document.id, sha256: document.sha256, applied },
    });
    return { contract: c, document, applied };
  }

  async getDocument(id: string, docId: string, actor: string): Promise<{ record: DocumentRecord; bytes: Buffer }> {
    const c = await this.load(id);
    const record = c.documents.find((d) => d.id === docId);
    if (!record) throw new WorkflowError("Document not found", 404);
    const bytes = await this.docs.get(`${id}/${docId}`);
    if (!bytes) throw new WorkflowError("Document content not found", 404);
    await this.repo.audit({ contractId: id, actor, action: "document.downloaded", detail: { documentId: docId } });
    return { record, bytes };
  }

  /** A person reviews extracted values and confirms them (all, or a list of paths). */
  async confirm(id: string, paths: string[] | "all", actor: string): Promise<Contract> {
    const c = await this.load(id);
    assertStatus(c, ["draft", "verified"], "confirm fields");
    const targets = paths === "all" ? Object.keys(c.provenance) : paths;
    for (const p of targets) {
      const prov = c.provenance[p];
      if (!prov) throw new WorkflowError(`No data to confirm for '${p}'`, 400);
      prov.confirmed = true;
    }
    await this.repo.save(c);
    await this.repo.audit({ contractId: id, actor, action: "fields.confirmed", detail: { paths: targets } });
    return c;
  }

  async readiness(id: string) {
    return computeReadiness(await this.load(id));
  }

  async verify(id: string, actor: string): Promise<Contract> {
    const c = await this.load(id);
    assertStatus(c, ["draft", "verified"], "verify");
    const r = computeReadiness(c);
    if (!r.ready) throw new WorkflowError("Contract data is not ready for verification", 422, r);
    const [titleDeed, clearance] = await Promise.all([
      this.integ.titleDeed.verify({ titleDeedNumber: c.property.titleDeedNumber!, ownerName: c.property.ownerName }),
      this.integ.clearance.check({
        titleDeedNumber: c.property.titleDeedNumber!,
        propertyNumber: c.property.propertyNumber,
        buildingName: c.property.buildingName,
      }),
    ]);
    c.verification = { at: new Date().toISOString(), titleDeed, clearance };
    c.status = titleDeed.valid && clearance.clear ? "verified" : "draft";
    await this.repo.save(c);
    await this.repo.audit({
      contractId: id,
      actor,
      action: "contract.verified",
      detail: { titleDeedValid: titleDeed.valid, clear: clearance.clear, issues: clearance.issues, provider: this.integ.titleDeed.name },
    });
    return c;
  }

  async startSigning(id: string, role: PartyRole, actor: string): Promise<{ contract: Contract; authUrl?: string }> {
    const c = await this.load(id);
    assertStatus(c, ["verified", "signing"], "start signing");
    if (c.signatures[role]) throw new WorkflowError(`${role} already has a signing request`);
    if (!c.contractHash) c.contractHash = contractHash(c);
    c.status = "signing";
    const res = await this.integ.identity.startSigning({
      contractId: id,
      role,
      documentHash: c.contractHash,
      emiratesId: c[role].emiratesId,
    });
    c.signatures[role] = { requestId: res.requestId, status: "pending" };
    await this.repo.save(c);
    await this.repo.audit({ contractId: id, actor, action: "signing.started", detail: { role, requestId: res.requestId } });
    return { contract: c, authUrl: res.authUrl };
  }

  async completeSigning(id: string, role: PartyRole, actor: string): Promise<Contract> {
    const c = await this.load(id);
    assertStatus(c, ["signing"], "complete signing");
    const sig = c.signatures[role];
    if (!sig) throw new WorkflowError(`No signing request for ${role}`, 404);
    if (sig.status !== "signed") {
      const r = await this.integ.identity.getSigningResult(sig.requestId);
      if (r.status === "signed") {
        c.signatures[role] = { ...sig, status: "signed", signatureId: r.signatureId, signedAt: r.signedAt };
        await this.repo.audit({ contractId: id, actor, action: "signing.completed", detail: { role, signatureId: r.signatureId } });
      }
    }
    if (c.signatures.landlord?.status === "signed" && c.signatures.tenant?.status === "signed") c.status = "signed";
    await this.repo.save(c);
    return c;
  }

  async openEscrow(id: string, actor: string): Promise<Contract> {
    const c = await this.load(id);
    assertStatus(c, ["signed"], "open escrow");
    if (c.escrow) throw new WorkflowError("Escrow already opened");
    const { accountRef } = await this.integ.escrow.openAccount({
      contractId: id,
      amount: c.terms.securityDeposit!,
      payerRole: "tenant",
    });
    c.escrow = { accountRef, status: "pending" };
    await this.repo.save(c);
    await this.repo.audit({ contractId: id, actor, action: "escrow.opened", detail: { accountRef } });
    return c;
  }

  async refreshEscrow(id: string, actor: string): Promise<Contract> {
    const c = await this.load(id);
    if (!c.escrow) throw new WorkflowError("Escrow not opened", 404);
    const r = await this.integ.escrow.getFundingStatus(c.escrow.accountRef);
    if (r.status !== c.escrow.status) {
      c.escrow.status = r.status;
      await this.repo.audit({ contractId: id, actor, action: "escrow.status", detail: { status: r.status } });
    }
    await this.repo.save(c);
    return c;
  }

  async registerEjari(id: string, actor: string): Promise<Contract> {
    const c = await this.load(id);
    assertStatus(c, ["signed"], "register with Ejari");
    if (c.terms.useEscrow && c.escrow?.status !== "funded") {
      throw new WorkflowError("Escrow must be funded before Ejari registration");
    }
    const r = await this.integ.ejari.register({
      contractId: id,
      documentHash: c.contractHash!,
      titleDeedNumber: c.property.titleDeedNumber!,
      landlordId: c.landlord.emiratesId ?? c.landlord.tradeLicenseNo ?? "",
      tenantId: c.tenant.emiratesId ?? c.tenant.tradeLicenseNo ?? "",
    });
    c.ejari = r;
    c.status = "registered";
    await this.repo.save(c);
    await this.repo.audit({ contractId: id, actor, action: "ejari.registered", detail: { ejariNumber: r.ejariNumber } });
    return c;
  }

  auditTrail(id: string) {
    return this.repo.auditFor(id);
  }

  /** Any content change drops verification and any frozen hash (only reachable before signing). */
  private invalidate(c: Contract) {
    c.status = "draft";
    c.verification = undefined;
    c.contractHash = undefined;
  }
}
