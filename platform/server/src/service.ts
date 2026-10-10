import { createHash, randomUUID } from "node:crypto";
import { applyExtraction } from "./extraction/apply.js";
import type { DocumentExtractor } from "./extraction/index.js";
import type { Contract, DocKind, DocumentRecord, Evidence, Party, PartyRole, Property, Section, Terms } from "./domain/schema.js";
import { assertStatus, computeReadiness, contractHash, propertyBasis, WorkflowError } from "./domain/workflow.js";
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
      this.integ.titleDeed.manual
        ? this.attestedTitleDeed(c)
        : this.integ.titleDeed.verify({ titleDeedNumber: c.property.titleDeedNumber!, ownerName: c.property.ownerName }),
      this.integ.clearance.manual
        ? this.attestedClearance(c)
        : this.integ.clearance.check({
            titleDeedNumber: c.property.titleDeedNumber!,
            propertyNumber: c.property.propertyNumber,
            buildingName: c.property.buildingName,
          }),
    ]);
    const manual = Boolean(this.integ.titleDeed.manual || this.integ.clearance.manual);
    c.verification = { at: new Date().toISOString(), titleDeed, clearance, source: manual ? "manual" : "api" };
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
    if (this.integ.identity.manual) {
      c.signatures[role] = { requestId: `manual-${role}`, status: "pending", method: "manual" };
      await this.repo.save(c);
      await this.repo.audit({ contractId: id, actor, action: "signing.started", detail: { role, method: "manual" } });
      return { contract: c };
    }
    const res = await this.integ.identity.startSigning({
      contractId: id,
      role,
      documentHash: c.contractHash,
      emiratesId: c[role].emiratesId,
    });
    c.signatures[role] = { requestId: res.requestId, status: "pending", method: "uaepass" };
    await this.repo.save(c);
    await this.repo.audit({ contractId: id, actor, action: "signing.started", detail: { role, requestId: res.requestId } });
    return { contract: c, authUrl: res.authUrl };
  }

  async completeSigning(id: string, role: PartyRole, actor: string): Promise<Contract> {
    const c = await this.load(id);
    if (this.integ.identity.manual) throw new WorkflowError("Signatures are recorded by staff in this deployment: use the signature attestation", 409);
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
    if (this.integ.escrow.manual) throw new WorkflowError("Deposits are recorded by staff in this deployment: use the deposit attestation", 409);
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
    if (this.integ.escrow.manual) throw new WorkflowError("Deposits are recorded by staff in this deployment: use the deposit attestation", 409);
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
    if (this.integ.ejari.manual) throw new WorkflowError("Ejari registration is recorded by staff in this deployment: use the Ejari attestation", 409);
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

  // ---- Assisted mode: steps done by staff through the official channel and recorded with evidence ----

  private evidenceOf(c: Contract): Evidence[] {
    return (c.evidence ??= []);
  }

  /** Every attestation must point at evidence already uploaded to this contract. */
  private requireEvidence(c: Contract, ids: string[]) {
    if (ids.length === 0) throw new WorkflowError("Attach at least one photo or scan as evidence", 422);
    const known = new Set(this.evidenceOf(c).map((e) => e.id));
    const missing = ids.filter((i) => !known.has(i));
    if (missing.length) throw new WorkflowError(`Unknown evidence: ${missing.join(", ")}`, 400);
  }

  private requireManual(step: string, manual: boolean | undefined) {
    if (!manual) throw new WorkflowError(`${step} is automatic in this deployment, so it cannot be recorded by hand`, 409);
  }

  private requireDay(label: string, day: string) {
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(new Date(day).getTime());
    if (!valid) throw new WorkflowError(`${label} must be a date in YYYY-MM-DD form`, 400);
    const dubaiToday = new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 10);
    if (day > dubaiToday) throw new WorkflowError(`${label} cannot be in the future`, 422);
  }

  async addEvidence(
    id: string,
    a: { label: string; filename: string; mimeType: string; data: Buffer },
    actor: string,
  ): Promise<{ contract: Contract; evidence: Evidence }> {
    const c = await this.load(id);
    this.requireConsent(c);
    const evidence: Evidence = {
      id: randomUUID(),
      label: a.label,
      filename: a.filename,
      mimeType: a.mimeType,
      sha256: createHash("sha256").update(a.data).digest("hex"),
      uploadedAt: new Date().toISOString(),
      uploadedBy: actor,
    };
    await this.docs.put(`${id}/${evidence.id}`, a.data);
    this.evidenceOf(c).push(evidence);
    await this.repo.save(c);
    await this.repo.audit({ contractId: id, actor, action: "evidence.added", detail: { evidenceId: evidence.id, label: a.label, sha256: evidence.sha256 } });
    return { contract: c, evidence };
  }

  async getEvidence(id: string, evidenceId: string, actor: string): Promise<{ record: Evidence; bytes: Buffer }> {
    const c = await this.load(id);
    const record = this.evidenceOf(c).find((e) => e.id === evidenceId);
    if (!record) throw new WorkflowError("Evidence not found", 404);
    const bytes = await this.docs.get(`${id}/${evidenceId}`);
    if (!bytes) throw new WorkflowError("Evidence content not found", 404);
    await this.repo.audit({ contractId: id, actor, action: "evidence.downloaded", detail: { evidenceId } });
    return { record, bytes };
  }

  private async attestedTitleDeed(c: Contract) {
    const a = c.attestations?.titleDeed;
    if (!a) throw new WorkflowError("The title deed check has not been recorded yet", 422);
    if (a.basis !== propertyBasis(c)) throw new WorkflowError("The recorded title deed check was made for different property details. Record it again.", 422);
    return { valid: a.valid, notes: a.notes };
  }

  private async attestedClearance(c: Contract) {
    const a = c.attestations?.clearance;
    if (!a) throw new WorkflowError("The clearance check has not been recorded yet", 422);
    if (a.basis !== propertyBasis(c)) throw new WorkflowError("The recorded clearance check was made for different property details. Record it again.", 422);
    return { clear: a.clear, issues: a.issues };
  }

  async attestTitleDeed(id: string, a: { valid: boolean; notes: string[]; evidenceIds: string[] }, actor: string): Promise<Contract> {
    this.requireManual("The title deed check", this.integ.titleDeed.manual);
    const c = await this.load(id);
    assertStatus(c, ["draft", "verified"], "record the title deed check");
    if (!c.property.titleDeedNumber) throw new WorkflowError("Enter the title deed number before recording the check", 422);
    this.requireEvidence(c, a.evidenceIds);
    c.attestations = { ...c.attestations, titleDeed: { valid: a.valid, notes: a.notes, by: actor, at: new Date().toISOString(), evidenceIds: a.evidenceIds, basis: propertyBasis(c) } };
    this.invalidate(c); // verification must be run again against the new record
    await this.repo.save(c);
    await this.repo.audit({ contractId: id, actor, action: "attestation.title_deed", detail: { valid: a.valid, evidenceIds: a.evidenceIds } });
    return c;
  }

  async attestClearance(
    id: string,
    a: { clear: boolean; source: string; issues: { type: string; detail: string }[]; evidenceIds: string[] },
    actor: string,
  ): Promise<Contract> {
    this.requireManual("The clearance check", this.integ.clearance.manual);
    const c = await this.load(id);
    assertStatus(c, ["draft", "verified"], "record the clearance check");
    if (!c.property.titleDeedNumber) throw new WorkflowError("Enter the property details before recording the check", 422);
    this.requireEvidence(c, a.evidenceIds);
    c.attestations = {
      ...c.attestations,
      clearance: { clear: a.clear, source: a.source, issues: a.issues, by: actor, at: new Date().toISOString(), evidenceIds: a.evidenceIds, basis: propertyBasis(c) },
    };
    this.invalidate(c);
    await this.repo.save(c);
    await this.repo.audit({ contractId: id, actor, action: "attestation.clearance", detail: { clear: a.clear, source: a.source, issues: a.issues, evidenceIds: a.evidenceIds } });
    return c;
  }

  /** Staff record that a party signed a paper copy of the frozen contract. */
  async attestSignature(
    id: string,
    a: { role: PartyRole; signedOn: string; evidenceIds: string[] },
    actor: string,
  ): Promise<Contract> {
    this.requireManual("Signing", this.integ.identity.manual);
    const c = await this.load(id);
    assertStatus(c, ["signing"], "record a signature");
    const sig = c.signatures[a.role];
    if (!sig) throw new WorkflowError(`Start signing for the ${a.role} first`, 404);
    if (sig.status === "signed") throw new WorkflowError(`The ${a.role} signature is already recorded`);
    this.requireDay("The signing date", a.signedOn);
    this.requireEvidence(c, a.evidenceIds);
    c.signatures[a.role] = {
      ...sig,
      status: "signed",
      method: "manual",
      signedOn: a.signedOn,
      signedAt: new Date().toISOString(),
      signatureId: `MANUAL-${a.role}-${a.evidenceIds[0]!.slice(0, 8)}`,
      evidenceIds: a.evidenceIds,
    };
    if (c.signatures.landlord?.status === "signed" && c.signatures.tenant?.status === "signed") c.status = "signed";
    await this.repo.save(c);
    await this.repo.audit({ contractId: id, actor, action: "signing.attested", detail: { role: a.role, signedOn: a.signedOn, evidenceIds: a.evidenceIds } });
    return c;
  }

  /** Staff record that the security deposit was received outside an escrow provider. */
  async attestDeposit(
    id: string,
    a: { method: string; reference: string; amount: string; receivedOn: string; evidenceIds: string[] },
    actor: string,
  ): Promise<Contract> {
    this.requireManual("Deposit handling", this.integ.escrow.manual);
    const c = await this.load(id);
    assertStatus(c, ["signed"], "record the deposit");
    if (c.escrow) throw new WorkflowError("A deposit is already recorded");
    this.requireDay("The receipt date", a.receivedOn);
    this.requireEvidence(c, a.evidenceIds);
    c.escrow = {
      accountRef: `MANUAL-${a.reference}`,
      status: "funded",
      manual: true,
      deposit: { method: a.method, reference: a.reference, amount: a.amount, receivedOn: a.receivedOn, by: actor, at: new Date().toISOString(), evidenceIds: a.evidenceIds },
    };
    await this.repo.save(c);
    await this.repo.audit({ contractId: id, actor, action: "deposit.recorded", detail: { method: a.method, amount: a.amount, receivedOn: a.receivedOn, evidenceIds: a.evidenceIds } });
    return c;
  }

  /** Staff record an Ejari registration they completed through the Dubai REST app or a trustee centre. */
  async attestEjari(
    id: string,
    a: { ejariNumber: string; channel: string; registeredOn: string; evidenceIds: string[] },
    actor: string,
  ): Promise<Contract> {
    this.requireManual("Ejari registration", this.integ.ejari.manual);
    const c = await this.load(id);
    assertStatus(c, ["signed"], "record the Ejari registration");
    if (c.terms.useEscrow && c.escrow?.status !== "funded") throw new WorkflowError("The deposit must be recorded before Ejari registration");
    this.requireDay("The registration date", a.registeredOn);
    this.requireEvidence(c, a.evidenceIds);
    c.ejari = { ejariNumber: a.ejariNumber, registeredAt: new Date().toISOString(), manual: true, channel: a.channel, registeredOn: a.registeredOn, evidenceIds: a.evidenceIds };
    c.status = "registered";
    await this.repo.save(c);
    await this.repo.audit({ contractId: id, actor, action: "ejari.attested", detail: { ejariNumber: a.ejariNumber, channel: a.channel, registeredOn: a.registeredOn, evidenceIds: a.evidenceIds } });
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
