import { describe, expect, it } from "vitest";
import { derivedValue } from "../src/contract/overlay.js";
import type { Contract } from "../src/domain/schema.js";
import { createIntegrations, integrationModes } from "../src/integrations/registry.js";
import { auth, b64, call, makeApp, readyContract } from "./helpers.js";

const MANUAL = {
  IDENTITY_MODE: "manual",
  TITLE_DEED_MODE: "manual",
  CLEARANCE_MODE: "manual",
  ESCROW_MODE: "manual",
  EJARI_MODE: "manual",
};
type App = ReturnType<typeof makeApp>;

const ev = async (app: App, id: string, label = "scan") =>
  (await call(app, "POST", `/contracts/${id}/evidence`, { label, filename: "x.jpg", mimeType: "image/jpeg", dataBase64: b64("fake-image-bytes") })).body.evidence.id as string;

const attestChecks = async (app: App, id: string, over: { valid?: boolean; clear?: boolean } = {}) => {
  const e = await ev(app, id, "REST app screenshot");
  const td = await call(app, "POST", `/contracts/${id}/attest/title-deed`, { valid: over.valid ?? true, evidenceIds: [e] });
  const cl = await call(app, "POST", `/contracts/${id}/attest/clearance`, {
    clear: over.clear ?? true,
    source: "management company statement",
    issues: over.clear === false ? [{ type: "service_charges_overdue", detail: "AED 4,000 outstanding" }] : [],
    evidenceIds: [e],
  });
  return { td, cl };
};

const signBoth = async (app: App, id: string) => {
  for (const role of ["landlord", "tenant"]) {
    await call(app, "POST", `/contracts/${id}/signatures`, { role });
    await call(app, "POST", `/contracts/${id}/attest/signature`, { role, signedOn: "2026-10-09", evidenceIds: [await ev(app, id, `signed copy ${role}`)] });
  }
};

describe("assisted mode: full flow recorded by staff", () => {
  it("goes from documents to a registered contract with evidence at every step", async () => {
    const app = makeApp(MANUAL);
    expect((await call(app, "GET", "/integrations")).body).toEqual({ identity: "manual", titleDeed: "manual", clearance: "manual", escrow: "manual", ejari: "manual" });
    const id = await readyContract(app);

    // verification cannot pass until both checks are recorded
    expect((await call(app, "POST", `/contracts/${id}/verify`)).body.error).toMatch(/title deed check has not been recorded/);
    const e = await ev(app, id);
    expect((await call(app, "POST", `/contracts/${id}/attest/title-deed`, { valid: true, evidenceIds: [] })).status).toBe(400);
    expect((await call(app, "POST", `/contracts/${id}/attest/title-deed`, { valid: true, evidenceIds: ["nope"] })).status).toBe(400);
    expect((await call(app, "POST", `/contracts/${id}/attest/title-deed`, { valid: true, evidenceIds: [e] })).status).toBe(200);
    expect((await call(app, "POST", `/contracts/${id}/verify`)).body.error).toMatch(/clearance check has not been recorded/);

    await call(app, "POST", `/contracts/${id}/attest/clearance`, { clear: true, source: "DLD statement", evidenceIds: [e] });
    const v = await call(app, "POST", `/contracts/${id}/verify`);
    expect(v.body.status).toBe("verified");
    expect(v.body.verification.source).toBe("manual");

    // signing: no provider call, and the API completion route is closed
    const started = await call(app, "POST", `/contracts/${id}/signatures`, { role: "landlord" });
    expect(started.status).toBe(200);
    expect(started.body.authUrl).toBeUndefined();
    expect((await call(app, "POST", `/contracts/${id}/signatures/complete`, { role: "landlord" })).status).toBe(409);
    await call(app, "POST", `/contracts/${id}/signatures`, { role: "tenant" });
    expect((await call(app, "POST", `/contracts/${id}/attest/signature`, { role: "landlord", signedOn: "2999-01-01", evidenceIds: [e] })).status).toBe(422);
    await call(app, "POST", `/contracts/${id}/attest/signature`, { role: "landlord", signedOn: "2026-10-09", evidenceIds: [e] });
    expect((await call(app, "POST", `/contracts/${id}/attest/signature`, { role: "landlord", signedOn: "2026-10-09", evidenceIds: [e] })).status).toBe(409);
    const signed = await call(app, "POST", `/contracts/${id}/attest/signature`, { role: "tenant", signedOn: "2026-10-10", evidenceIds: [e] });
    expect(signed.body.status).toBe("signed");
    expect(signed.body.signatures.landlord.method).toBe("manual");

    // Ejari: the API route is closed, the attestation works
    expect((await call(app, "POST", `/contracts/${id}/ejari`)).status).toBe(409);
    expect((await call(app, "POST", `/contracts/${id}/attest/ejari`, { ejariNumber: "x", channel: "dubai_rest_app", registeredOn: "2026-10-10", evidenceIds: [e] })).status).toBe(400);
    const reg = await call(app, "POST", `/contracts/${id}/attest/ejari`, { ejariNumber: "EJ-2026-123456", channel: "dubai_rest_app", registeredOn: "2026-10-10", evidenceIds: [e] });
    expect(reg.body.status).toBe("registered");
    expect(reg.body.ejari).toMatchObject({ ejariNumber: "EJ-2026-123456", manual: true, channel: "dubai_rest_app" });

    const actions = (await call(app, "GET", `/contracts/${id}/audit`)).body.map((a: { action: string }) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["evidence.added", "attestation.title_deed", "attestation.clearance", "contract.verified", "signing.attested", "ejari.attested"]));
  });

  it("serves evidence back byte for byte and audits the download", async () => {
    const app = makeApp(MANUAL);
    const id = await readyContract(app);
    const e = await ev(app, id);
    const res = await app.inject({ method: "GET", url: `/contracts/${id}/evidence/${e}`, headers: auth });
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload.toString()).toBe("fake-image-bytes");
    expect(res.headers["cache-control"]).toBe("no-store");
    expect((await call(app, "GET", `/contracts/${id}/evidence/missing`)).status).toBe(404);
    expect((await call(app, "GET", `/contracts/${id}/audit`)).body.map((a: { action: string }) => a.action)).toContain("evidence.downloaded");
  });

  it("only accepts photos and PDFs, and only after consent", async () => {
    const app = makeApp(MANUAL);
    const id = await readyContract(app);
    expect((await call(app, "POST", `/contracts/${id}/evidence`, { label: "x", filename: "x.txt", mimeType: "text/plain", dataBase64: b64("hi") })).status).toBe(400);
    const { body: fresh } = await call(app, "POST", "/contracts");
    expect((await call(app, "POST", `/contracts/${fresh.id}/evidence`, { label: "x", filename: "x.jpg", mimeType: "image/jpeg", dataBase64: b64("hi") })).status).toBe(409);
  });
});

describe("assisted mode: problems found and stale records", () => {
  it("keeps the contract in draft when staff record an invalid deed or an unclear property", async () => {
    const app = makeApp(MANUAL);
    const a = await readyContract(app);
    await attestChecks(app, a, { valid: false });
    const bad = await call(app, "POST", `/contracts/${a}/verify`);
    expect(bad.body.status).toBe("draft");
    expect(bad.body.verification.titleDeed.valid).toBe(false);

    const b = await readyContract(app);
    await attestChecks(app, b, { clear: false });
    const owing = await call(app, "POST", `/contracts/${b}/verify`);
    expect(owing.body.status).toBe("draft");
    expect(owing.body.verification.clearance.issues[0].type).toBe("service_charges_overdue");
    expect((await call(app, "POST", `/contracts/${b}/signatures`, { role: "landlord" })).status).toBe(409);
  });

  it("requires an issue to be described when the property is not clear", async () => {
    const app = makeApp(MANUAL);
    const id = await readyContract(app);
    const e = await ev(app, id);
    const r = await call(app, "POST", `/contracts/${id}/attest/clearance`, { clear: false, source: "x", issues: [], evidenceIds: [e] });
    expect(r.status).toBe(400);
  });

  it("rejects a recorded check once the property details it was made for have changed", async () => {
    const app = makeApp(MANUAL);
    const id = await readyContract(app);
    await attestChecks(app, id);
    expect((await call(app, "POST", `/contracts/${id}/verify`)).body.status).toBe("verified");
    await call(app, "PATCH", `/contracts/${id}`, { property: { titleDeedNumber: "TD-OTHER-0002" } });
    const r = await call(app, "POST", `/contracts/${id}/verify`);
    expect(r.status).toBe(422);
    expect(r.body.error).toMatch(/different property details/);
  });

  it("makes a new attestation drop an existing verification", async () => {
    const app = makeApp(MANUAL);
    const id = await readyContract(app);
    await attestChecks(app, id);
    await call(app, "POST", `/contracts/${id}/verify`);
    const again = await call(app, "POST", `/contracts/${id}/attest/title-deed`, { valid: true, evidenceIds: [await ev(app, id)] });
    expect(again.body.status).toBe("draft");
    expect(again.body.verification).toBeUndefined();
  });
});

describe("assisted mode: deposit and Ejari preconditions", () => {
  it("requires a recorded deposit before Ejari when escrow is requested", async () => {
    const app = makeApp(MANUAL);
    const id = await readyContract(app, { useEscrow: true });
    await attestChecks(app, id);
    await call(app, "POST", `/contracts/${id}/verify`);
    await signBoth(app, id);
    const e = await ev(app, id, "ejari certificate");

    const blocked = await call(app, "POST", `/contracts/${id}/attest/ejari`, { ejariNumber: "EJ-1234", channel: "trustee_centre", registeredOn: "2026-10-10", evidenceIds: [e] });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatch(/deposit must be recorded/);

    expect((await call(app, "POST", `/contracts/${id}/escrow`)).status).toBe(409); // provider route is closed
    const dep = { method: "bank_transfer", reference: "TRF-889", amount: "5000", receivedOn: "2026-10-09", evidenceIds: [e] };
    expect((await call(app, "POST", `/contracts/${id}/attest/deposit`, { ...dep, receivedOn: "09/10/2026" })).status).toBe(400);
    expect((await call(app, "POST", `/contracts/${id}/attest/deposit`, { ...dep, receivedOn: "2999-01-01" })).status).toBe(422);
    const ok = await call(app, "POST", `/contracts/${id}/attest/deposit`, dep);
    expect(ok.body.escrow).toMatchObject({ status: "funded", manual: true, accountRef: "MANUAL-TRF-889" });
    expect((await call(app, "POST", `/contracts/${id}/attest/deposit`, dep)).status).toBe(409);

    const reg = await call(app, "POST", `/contracts/${id}/attest/ejari`, { ejariNumber: "EJ-1234", channel: "trustee_centre", registeredOn: "2026-10-10", evidenceIds: [e] });
    expect(reg.body.status).toBe("registered");
  });

  it("cannot record Ejari or signatures before the contract reaches those stages", async () => {
    const app = makeApp(MANUAL);
    const id = await readyContract(app);
    const e = await ev(app, id);
    expect((await call(app, "POST", `/contracts/${id}/attest/ejari`, { ejariNumber: "EJ-1234", channel: "other", registeredOn: "2026-10-10", evidenceIds: [e] })).status).toBe(409);
    expect((await call(app, "POST", `/contracts/${id}/attest/signature`, { role: "tenant", signedOn: "2026-10-10", evidenceIds: [e] })).status).toBe(409);
    expect((await call(app, "POST", `/contracts/${id}/attest/deposit`, { method: "cash", reference: "R1", amount: "1", receivedOn: "2026-10-10", evidenceIds: [e] })).status).toBe(409);
  });
});

describe("guards between manual and automatic modes", () => {
  it("refuses hand-recorded results where an integration is automatic", async () => {
    const app = makeApp(); // all mocks
    const id = await readyContract(app);
    const e = await ev(app, id);
    for (const [path, body] of [
      ["title-deed", { valid: true, evidenceIds: [e] }],
      ["clearance", { clear: true, source: "x", evidenceIds: [e] }],
      ["signature", { role: "tenant", signedOn: "2026-10-10", evidenceIds: [e] }],
      ["deposit", { method: "cash", reference: "R", amount: "1", receivedOn: "2026-10-10", evidenceIds: [e] }],
      ["ejari", { ejariNumber: "EJ-1234", channel: "other", registeredOn: "2026-10-10", evidenceIds: [e] }],
    ] as const) {
      const r = await call(app, "POST", `/contracts/${id}/attest/${path}`, body);
      expect(r.status, path).toBe(409);
      expect(r.body.error, path).toMatch(/automatic/);
    }
  });

  it("mixes modes per step, for example manual checks with mock signing", async () => {
    const app = makeApp({ TITLE_DEED_MODE: "manual", CLEARANCE_MODE: "manual" });
    const id = await readyContract(app);
    await attestChecks(app, id);
    expect((await call(app, "POST", `/contracts/${id}/verify`)).body.status).toBe("verified");
    expect((await call(app, "POST", `/contracts/${id}/signatures`, { role: "landlord" })).body.authUrl).toMatch(/^mock:/);
  });
});

describe("safe defaults for deployed servers", () => {
  it("defaults to manual in production and refuses mock unless explicitly allowed", () => {
    const prod = createIntegrations({ NODE_ENV: "production" } as NodeJS.ProcessEnv);
    expect(Object.values(integrationModes(prod))).toEqual(["manual", "manual", "manual", "manual", "manual"]);
    expect(() => createIntegrations({ NODE_ENV: "production", EJARI_MODE: "mock" } as NodeJS.ProcessEnv)).toThrow(/mock in production/);
    expect(integrationModes(createIntegrations({ NODE_ENV: "production", EJARI_MODE: "mock", ALLOW_MOCK_INTEGRATIONS: "1" } as NodeJS.ProcessEnv)).ejari).toBe("mock");
    expect(() => createIntegrations({ NODE_ENV: "production", EJARI_MODE: "live" } as NodeJS.ProcessEnv)).toThrow(/live mode/);
    expect(integrationModes(createIntegrations({} as NodeJS.ProcessEnv)).ejari).toBe("mock"); // development default
  });
});

describe("paper signatures on the printed form", () => {
  const base = (sig: Contract["signatures"]) => ({ id: "c", landlord: {}, tenant: {}, property: {}, terms: {}, signatures: sig }) as unknown as Contract;
  it("prints no e-signature evidence for a paper signature, and dates the contract by the signing date", () => {
    const c = base({
      landlord: { requestId: "m", status: "signed", method: "manual", signedOn: "2026-10-09", signedAt: "2026-10-12T08:00:00.000Z" },
      tenant: { requestId: "m", status: "signed", method: "manual", signedOn: "2026-10-10", signedAt: "2026-10-12T08:01:00.000Z" },
    });
    expect(derivedValue(c, "tenantSignatureLine1")).toBe("");
    expect(derivedValue(c, "landlordSignedDate")).toBe("");
    expect(derivedValue(c, "date")).toBe("2026-10-10");
  });
});

describe("document reading in assisted mode", () => {
  it("stores a document without reading it or sending it anywhere, so staff type the values", async () => {
    const { createExtractor, ManualExtractor } = await import("../src/extraction/index.js");
    expect(createExtractor({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBeInstanceOf(ManualExtractor);
    expect(() => createExtractor({ NODE_ENV: "production", EXTRACTOR: "mock" } as NodeJS.ProcessEnv)).toThrow(/ALLOW_MOCK/);
    expect(() => createExtractor({ EXTRACTOR: "claude" } as NodeJS.ProcessEnv)).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => createExtractor({ EXTRACTOR: "nope" } as NodeJS.ProcessEnv)).toThrow(/Unknown EXTRACTOR/);

    const app = makeApp(MANUAL, { extractor: new ManualExtractor() });
    const { body: c } = await call(app, "POST", "/contracts");
    await call(app, "POST", `/contracts/${c.id}/consent`, { noticeVersion: "v1" });
    const up = await call(app, "POST", `/contracts/${c.id}/documents`, { kind: "title_deed", filename: "deed.jpg", mimeType: "image/jpeg", dataBase64: b64("not json at all") });
    expect(up.status).toBe(201);
    expect(up.body.applied).toEqual([]);
    expect(up.body.document.extracted).toEqual({});
    const dl = await app.inject({ method: "GET", url: `/contracts/${c.id}/documents/${up.body.document.id}`, headers: auth });
    expect(dl.rawPayload.toString()).toBe("not json at all");
  });
});

describe("request bodies", () => {
  it("accepts a JSON POST with no body, and still rejects malformed JSON", async () => {
    const app = makeApp();
    const empty = await app.inject({ method: "POST", url: "/contracts", headers: { ...auth, "content-type": "application/json" } });
    expect(empty.statusCode).toBe(201);
    const bad = await app.inject({ method: "POST", url: "/contracts/x/consent", headers: { ...auth, "content-type": "application/json" }, payload: "{nope" });
    expect(bad.statusCode).toBe(400);
  });
});

describe("document upload body", () => {
  it("treats a null party like an omitted one", async () => {
    const app = makeApp();
    const id = await readyContract(app);
    const r = await call(app, "POST", `/contracts/${id}/documents`, { kind: "title_deed", party: null, filename: "t.json", mimeType: "application/json", dataBase64: b64(JSON.stringify({ fields: { plotNumber: "9" } })) });
    expect(r.status).toBe(201);
  });
});
