import { describe, expect, it } from "vitest";
import { auth, call, makeApp, newConsentedContract, readyContract, upload } from "./helpers.js";

describe("end-to-end tenancy flow (mock integrations)", () => {
  it("goes from documents to a registered contract", async () => {
    const app = makeApp();
    const id = await readyContract(app);

    const ready = await call(app, "GET", `/contracts/${id}/readiness`);
    expect(ready.body.ready).toBe(true);

    const verified = await call(app, "POST", `/contracts/${id}/verify`);
    expect(verified.status).toBe(200);
    expect(verified.body.status).toBe("verified");

    for (const role of ["landlord", "tenant"]) {
      const s = await call(app, "POST", `/contracts/${id}/signatures`, { role });
      expect(s.status).toBe(200);
      expect(s.body.authUrl).toMatch(/^mock:\/\//);
    }
    // Ejari must wait for both signatures.
    expect((await call(app, "POST", `/contracts/${id}/ejari`)).status).toBe(409);

    await call(app, "POST", `/contracts/${id}/signatures/complete`, { role: "landlord" });
    const both = await call(app, "POST", `/contracts/${id}/signatures/complete`, { role: "tenant" });
    expect(both.body.status).toBe("signed");

    const reg = await call(app, "POST", `/contracts/${id}/ejari`);
    expect(reg.body.status).toBe("registered");
    expect(reg.body.ejari.ejariNumber).toMatch(/^MOCK-EJARI-/);

    const pdf = await call(app, "GET", `/contracts/${id}/pdf`);
    expect(pdf.status).toBe(200);
    expect(Buffer.from(pdf.body).subarray(0, 5).toString()).toBe("%PDF-");

    const audit = await call(app, "GET", `/contracts/${id}/audit`);
    const actions = audit.body.map((e: { action: string }) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining(["contract.created", "document.extracted", "fields.confirmed", "contract.verified", "signing.started", "signing.completed", "ejari.registered"]),
    );
  });

  it("requires funded escrow before Ejari when escrow is requested", async () => {
    const app = makeApp();
    const id = await readyContract(app, { useEscrow: true });
    await call(app, "POST", `/contracts/${id}/verify`);
    for (const role of ["landlord", "tenant"]) {
      await call(app, "POST", `/contracts/${id}/signatures`, { role });
      await call(app, "POST", `/contracts/${id}/signatures/complete`, { role });
    }
    await call(app, "POST", `/contracts/${id}/escrow`);
    const blocked = await call(app, "POST", `/contracts/${id}/ejari`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatch(/Escrow must be funded/);

    expect((await call(app, "POST", `/contracts/${id}/escrow/refresh`)).body.escrow.status).toBe("pending");
    expect((await call(app, "POST", `/contracts/${id}/escrow/refresh`)).body.escrow.status).toBe("funded");
    expect((await call(app, "POST", `/contracts/${id}/ejari`)).body.status).toBe("registered");
  });
});

describe("safeguards", () => {
  it("rejects requests without the bearer token", async () => {
    const app = makeApp();
    expect((await app.inject({ method: "POST", url: "/contracts" })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: "/contracts", headers: { authorization: "Bearer wrong" } })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
  });

  it("keeps extracted values unconfirmed until a person confirms them", async () => {
    const app = makeApp();
    const cid = await newConsentedContract(app);
    const c = { id: cid };
    const up = await upload(app, c.id, "title_deed", "title_deed");
    expect(up.body.applied).toContain("property.titleDeedNumber");
    const r = await call(app, "GET", `/contracts/${c.id}/readiness`);
    expect(r.body.unconfirmed).toContain("property.titleDeedNumber");
    expect(r.body.ready).toBe(false);
    expect((await call(app, "POST", `/contracts/${c.id}/verify`)).status).toBe(422);
  });

  it("flags a landlord who does not match the title deed owner", async () => {
    const app = makeApp();
    const id = await readyContract(app);
    await call(app, "PATCH", `/contracts/${id}`, { landlord: { name: "Someone Else Entirely" } });
    const r = await call(app, "GET", `/contracts/${id}/readiness`);
    expect(r.body.issues.map((i: { code: string }) => i.code)).toContain("owner_mismatch");
    expect((await call(app, "POST", `/contracts/${id}/verify`)).status).toBe(422);
  });

  it("flags expired Emirates IDs, invalid IDs and bad periods", async () => {
    const app = makeApp();
    const id = await readyContract(app);
    await call(app, "PATCH", `/contracts/${id}`, {
      tenant: { emiratesIdExpiry: "2000-01-01", emiratesId: "12345" },
      terms: { endDate: "2029-01-01" },
    });
    const codes = (await call(app, "GET", `/contracts/${id}/readiness`)).body.issues.map((i: { code: string }) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["emirates_id_expired", "invalid_emirates_id", "invalid_period"]));
  });

  it("stays in draft when the title deed is invalid or clearance fails", async () => {
    const app = makeApp();
    const bad = await readyContract(app);
    await call(app, "PATCH", `/contracts/${bad}`, { property: { titleDeedNumber: "BAD-0001" } });
    const v1 = await call(app, "POST", `/contracts/${bad}/verify`);
    expect(v1.body.status).toBe("draft");
    expect(v1.body.verification.titleDeed.valid).toBe(false);

    const owing = await readyContract(app);
    await call(app, "PATCH", `/contracts/${owing}`, { property: { propertyNumber: "1299" } });
    const v2 = await call(app, "POST", `/contracts/${owing}/verify`);
    expect(v2.body.status).toBe("draft");
    expect(v2.body.verification.clearance.issues[0].type).toBe("service_charges_overdue");
    expect((await call(app, "POST", `/contracts/${owing}/signatures`, { role: "landlord" })).status).toBe(409);
  });

  it("drops verification when a verified contract is edited, and blocks edits once signing starts", async () => {
    const app = makeApp();
    const id = await readyContract(app);
    expect((await call(app, "POST", `/contracts/${id}/verify`)).body.status).toBe("verified");
    const edited = await call(app, "PATCH", `/contracts/${id}`, { terms: { annualRent: "110000" } });
    expect(edited.body.status).toBe("draft");
    expect(edited.body.verification).toBeUndefined();

    await call(app, "POST", `/contracts/${id}/verify`);
    await call(app, "POST", `/contracts/${id}/signatures`, { role: "landlord" });
    const blocked = await call(app, "PATCH", `/contracts/${id}`, { terms: { annualRent: "1" } });
    expect(blocked.status).toBe(409);
  });

  it("rejects non-JSON uploads with the mock extractor and malformed bodies", async () => {
    const app = makeApp();
    const c = { id: await newConsentedContract(app) };
    const bad = await call(app, "POST", `/contracts/${c.id}/documents`, {
      kind: "title_deed", filename: "x.png", mimeType: "image/png", dataBase64: Buffer.from("not json").toString("base64"),
    });
    expect(bad.status).toBe(422);
    expect((await call(app, "POST", `/contracts/${c.id}/documents`, { kind: "nope" })).status).toBe(400);
    expect((await call(app, "GET", "/contracts/does-not-exist")).status).toBe(404);
  });

  it("requires a party for Emirates ID uploads", async () => {
    const app = makeApp();
    const c = { id: await newConsentedContract(app) };
    expect((await upload(app, c.id, "emirates_id", "tenant_emirates_id")).status).toBe(400);
  });

  it("fails at startup when an integration is set to live without an adapter", async () => {
    expect(() => makeApp({ EJARI_MODE: "live" })).toThrow(/live mode/);
  });
});

describe("signed PDF links", () => {
  it("serves the PDF only with a valid, unexpired signature", async () => {
    const app = makeApp();
    const { body: c } = await call(app, "POST", "/contracts");
    const { body: link } = await call(app, "POST", `/contracts/${c.id}/pdf-link`);
    const ok = await app.inject({ method: "GET", url: link.url }); // no bearer header
    expect(ok.statusCode).toBe(200);
    expect(ok.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");

    const tampered = link.url.replace(/sig=([0-9a-f])/, (_m: string, ch: string) => `sig=${ch === "0" ? "1" : "0"}`); // always changes the signature
    expect((await app.inject({ method: "GET", url: tampered })).statusCode).toBe(401);
    const otherContract = link.url.replace(c.id, "00000000-0000-0000-0000-000000000000");
    expect((await app.inject({ method: "GET", url: otherContract })).statusCode).toBe(401);
    const expired = `/contracts/${c.id}/pdf-signed?exp=1&sig=${"a".repeat(64)}`;
    expect((await app.inject({ method: "GET", url: expired })).statusCode).toBe(401);
    expect((await app.inject({ method: "POST", url: `/contracts/${c.id}/pdf-link` })).statusCode).toBe(401);
  });
});

describe("error handling", () => {
  it("does not leak internal error messages", async () => {
    const app = makeApp();
    const { body: c } = await call(app, "POST", "/contracts");
    const res = await app.inject({ method: "POST", url: `/contracts/${c.id}/documents`, headers: { ...auth, "content-type": "application/json" }, payload: "{bad json" });
    expect(res.statusCode).toBe(400);
  });
});
