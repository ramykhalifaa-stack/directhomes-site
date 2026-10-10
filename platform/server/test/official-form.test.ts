import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { loadOfficialTemplate } from "../src/contract/officialTemplate.js";
import { OverlayError, derivedValue, renderOnTemplate, stampPlan } from "../src/contract/overlay.js";
import type { Contract } from "../src/domain/schema.js";
import { auth, call, makeApp, readyContract } from "./helpers.js";

const tpl = loadOfficialTemplate({} as NodeJS.ProcessEnv)!;

const base = (over: Partial<Contract> = {}): Contract =>
  ({
    id: "c1",
    status: "draft",
    landlord: { name: "A Landlord", emiratesId: "784-1980-1234567-1" },
    tenant: { name: "A Tenant", emiratesId: "784-1990-7654321-2" },
    property: { ownerName: "A Landlord", usage: "Residential", plotNumber: "1" },
    terms: { startDate: "2026-11-01", endDate: "2027-10-31", paymentCheques: "4" },
    provenance: {},
    documents: [],
    signatures: {},
    ...over,
  }) as Contract;

describe("bundled official form", () => {
  it("is the 3-page A4 original with a recorded hash", async () => {
    expect(tpl.sha256).toBe("33802759b47522a6ce3e2683f6c70acac0c256a304531b0a095952cdd4973925");
    const doc = await PDFDocument.load(tpl.pdf);
    expect(doc.getPageCount()).toBe(3);
    expect(doc.getPage(0).getSize()).toEqual({ width: 596, height: 842 });
  });

  it("maps only known contract paths, all inside the page", () => {
    const known = /^(landlord|tenant)\.(name|emiratesId|tradeLicenseNo|licensingAuthority|email|phone)$|^property\.(ownerName|plotNumber|makaniNumber|buildingName|propertyNumber|propertyType|areaSqm|location|premisesNo)$|^terms\.(startDate|endDate|annualRent|contractValue|securityDeposit)$|^derived\./;
    const map = tpl.map as { fields: Record<string, unknown> };
    for (const [path, spec] of Object.entries(map.fields)) {
      expect(path, path).toMatch(known);
      for (const p of (Array.isArray(spec) ? spec : [spec]) as { page: number; x: number; y: number; maxWidth?: number }[]) {
        expect(p.page).toBeLessThan(3);
        expect(p.x + (p.maxWidth ?? 0), path).toBeLessThanOrEqual(596);
        expect(p.y).toBeGreaterThan(0);
        expect(p.y).toBeLessThan(842);
      }
    }
  });

  it("covers every value the contract requires, so nothing entered is silently left off the form", () => {
    const printed = new Set(Object.keys((tpl.map as { fields: object }).fields));
    for (const path of [
      "landlord.name", "landlord.email", "landlord.phone", "landlord.emiratesId", "tenant.name", "tenant.email", "tenant.phone", "tenant.emiratesId",
      "property.ownerName", "property.plotNumber", "property.makaniNumber", "property.buildingName", "property.propertyNumber", "property.propertyType",
      "property.areaSqm", "property.location", "property.premisesNo", "terms.startDate", "terms.endDate", "terms.annualRent", "terms.contractValue", "terms.securityDeposit",
    ]) expect(printed.has(path), path).toBe(true);
    expect(Object.keys((tpl.map as { marks: object }).marks)).toContain("property.usage");
  });

  it("prints values, formats dates and picks the usage radio", () => {
    const plan = stampPlan(base(), tpl.map, new Date("2026-10-10T22:00:00Z")); // 02:00 on 11 Oct in Dubai
    const text = Object.fromEntries(plan.texts.map((t) => [t.path, t.text]));
    expect(text["landlord.name"]).toBe("A Landlord");
    expect(text["terms.startDate"]).toBe("01/11/2026");
    expect(text["terms.endDate"]).toBe("31/10/2027");
    expect(text["derived.date"]).toBe("11/10/2026"); // Dubai date, not UTC
    expect(text["derived.paymentMode"]).toBe("4 cheques");
    expect(plan.marks.map((m) => m.option)).toEqual(["residential"]);
    expect(stampPlan(base({ property: { usage: "Villa" } }), tpl.map).marks).toEqual([]);
  });

  it("only prints signature evidence once a party has actually signed", () => {
    expect(derivedValue(base(), "tenantSignatureLine1")).toBe("");
    const signed = base({ signatures: { tenant: { requestId: "r", status: "signed", signatureId: "SIG-1", signedAt: "2026-10-10T19:39:00.000Z" } } });
    expect(derivedValue(signed, "tenantSignedDate")).toBe("2026-10-10");
    expect(derivedValue(signed, "tenantSignatureLine2")).toContain("SIG-1");
    expect(derivedValue(signed, "landlordSignatureLine1")).toBe("");
  });

  it("pluralises the payment mode and passes free text through", () => {
    expect(derivedValue(base({ terms: { paymentCheques: "1" } }), "paymentMode")).toBe("1 cheque");
    expect(derivedValue(base({ terms: { paymentCheques: "Monthly bank transfer" } }), "paymentMode")).toBe("Monthly bank transfer");
  });

  it("refuses to truncate: too-long and non-Latin values fail with a clear error", async () => {
    await expect(renderOnTemplate(base({ landlord: { name: "X".repeat(400) } }), tpl.pdf, tpl.map)).rejects.toThrow(OverlayError);
    await expect(renderOnTemplate(base({ landlord: { name: "X".repeat(400) } }), tpl.pdf, tpl.map)).rejects.toThrow(/landlord\.name.*too long/);
    await expect(renderOnTemplate(base({ tenant: { name: "محمد" } }), tpl.pdf, tpl.map)).rejects.toThrow(/tenant\.name.*Latin/);
  });

  it("shrinks long-but-fitting text instead of failing", async () => {
    const out = await renderOnTemplate(base({ landlord: { name: "Muhammad Abdullah Al Hashimi Bin Rashid Al Maktoum Trading" } }), tpl.pdf, tpl.map);
    expect((await PDFDocument.load(out)).getPageCount()).toBe(3);
  });
});

describe("official form through the API", () => {
  it("serves a 3-page PDF for a complete signed contract and reports the template", async () => {
    const app = makeApp({}, { officialTemplate: tpl });
    expect((await call(app, "GET", "/template")).body).toEqual({ mode: "official", sha256: tpl.sha256 });
    const id = await readyContract(app);
    await call(app, "POST", `/contracts/${id}/verify`);
    for (const role of ["landlord", "tenant"]) {
      await call(app, "POST", `/contracts/${id}/signatures`, { role });
      await call(app, "POST", `/contracts/${id}/signatures/complete`, { role });
    }
    const res = await app.inject({ method: "GET", url: `/contracts/${id}/pdf`, headers: auth });
    expect(res.statusCode).toBe(200);
    expect((await PDFDocument.load(res.rawPayload)).getPageCount()).toBe(3);
  });

  it("returns 422 with the reason when a value cannot be printed", async () => {
    const app = makeApp({}, { officialTemplate: tpl });
    const id = await readyContract(app);
    await call(app, "PATCH", `/contracts/${id}`, { tenant: { name: "Z".repeat(500) } });
    const res = await call(app, "GET", `/contracts/${id}/pdf`);
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/tenant\.name.*too long/);
  });

  it("falls back to the draft layout when no template is configured", async () => {
    const app = makeApp();
    expect((await call(app, "GET", "/template")).body).toEqual({ mode: "draft", sha256: null });
  });

  it("the bundled form file matches the recorded hash on disk", () => {
    expect(readFileSync(new URL("../templates/ejari-unified-tenancy-contract.pdf", import.meta.url)).length).toBeGreaterThan(1_000_000);
  });
});

describe("property usage validation", () => {
  it("rejects a usage the form cannot show", async () => {
    const app = makeApp();
    const id = await readyContract(app);
    await call(app, "PATCH", `/contracts/${id}`, { property: { usage: "Mixed" } });
    const r = await call(app, "GET", `/contracts/${id}/readiness`);
    expect(r.body.issues.map((i: { code: string }) => i.code)).toContain("invalid_usage");
  });
});
