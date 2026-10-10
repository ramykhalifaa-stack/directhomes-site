import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { arabicWordParts, arabicWordWidth, hasArabic } from "../src/contract/arabic.js";
import { loadOfficialTemplate } from "../src/contract/officialTemplate.js";
import { OverlayError, renderOnTemplate } from "../src/contract/overlay.js";
import type { Contract } from "../src/domain/schema.js";
import { computeReadiness, normalizeName } from "../src/domain/workflow.js";
import { call, makeApp, readyContract } from "./helpers.js";

const tpl = loadOfficialTemplate({} as NodeJS.ProcessEnv)!;
const withNames = (landlord: string, tenant = "A Tenant", location = "Dubai"): Contract =>
  ({
    id: "c",
    status: "draft",
    landlord: { name: landlord },
    tenant: { name: tenant },
    property: { ownerName: landlord, location },
    terms: {},
    provenance: {},
    documents: [],
    signatures: {},
  }) as unknown as Contract;
const pages = async (c: Contract) => (await PDFDocument.load(await renderOnTemplate(c, tpl.pdf, tpl.map))).getPageCount();

describe("Arabic names on the official form", () => {
  it("detects Arabic and measures shaped words", () => {
    expect(hasArabic("محمد")).toBe(true);
    expect(hasArabic("Mohammed 123")).toBe(false);
    const w = arabicWordWidth("محمد", 10);
    expect(w).toBeGreaterThan(10);
    expect(arabicWordWidth("محمد", 20)).toBeCloseTo(w * 2, 5);
  });

  it("splits punctuation inside Arabic words, mirrors brackets, and refuses glued Latin or digits", () => {
    expect(arabicWordParts("ذ.م.م").map((p) => p.text)).toEqual(["م", ".", "م", ".", "ذ"]);
    expect(arabicWordParts("(مبنى)").map((p) => [p.text, p.ar])).toEqual([["(", false], ["مبنى", true], [")", false]]);
    expect(() => arabicWordParts("محمد5")).toThrow(/mixes/);
    expect(() => arabicWordParts("Aمحمد")).toThrow(/mixes/);
  });

  it("renders Arabic, mixed and company names", async () => {
    expect(await pages(withNames("محمد عبدالله المنصوري"))).toBe(3);
    expect(await pages(withNames("A Landlord", "شركة الأمل للتجارة ذ.م.م"))).toBe(3);
    expect(await pages(withNames("برج Example Tower", "A Tenant", "Villa 12 - مبنى"))).toBe(3); // Arabic-first and Latin-first lines
  });

  it("shrinks long Arabic to fit, and refuses what cannot fit or print", async () => {
    expect(await pages(withNames("محمد عبدالله علي حسن سعيد راشد المنصوري الهاشمي"))).toBe(3);
    await expect(renderOnTemplate(withNames("محمد ".repeat(120)), tpl.pdf, tpl.map)).rejects.toThrow(/(landlord\.name|property\.ownerName).*too long/);
    await expect(renderOnTemplate(withNames("محمد abc١"), tpl.pdf, tpl.map)).rejects.toBeInstanceOf(OverlayError); // Latin letters glued to Arabic in one word
    await expect(renderOnTemplate(withNames("محمد 王"), tpl.pdf, tpl.map)).rejects.toThrow(/Latin and Arabic/);
  });
});

describe("name comparison for the owner check", () => {
  it("treats the same Arabic name as equal regardless of order, diacritics and alef/ya spelling", () => {
    expect(normalizeName("محمد عبدالله")).toBe(normalizeName("عبدالله  محمد"));
    expect(normalizeName("مُحَمَّد")).toBe(normalizeName("محمد"));
    expect(normalizeName("إبراهيم")).toBe(normalizeName("ابراهيم"));
    expect(normalizeName("مصطفى")).toBe(normalizeName("مصطفي"));
  });

  it("never collapses different names to the same key (previously all non-Latin names became empty)", () => {
    expect(normalizeName("محمد المنصوري")).not.toBe("");
    expect(normalizeName("محمد المنصوري")).not.toBe(normalizeName("خالد الهاشمي"));
    expect(normalizeName("José  O'Brien-Smith")).toBe(normalizeName("o brien smith josé"));
  });

  it("flags a landlord whose Arabic name differs from the title-deed owner", () => {
    const c = withNames("محمد المنصوري");
    c.property.ownerName = "خالد الهاشمي";
    expect(computeReadiness(c).issues.map((i) => i.code)).toContain("owner_mismatch");
    c.property.ownerName = "المنصوري محمد";
    expect(computeReadiness(c).issues.map((i) => i.code)).not.toContain("owner_mismatch");
  });
});

describe("Arabic through the API", () => {
  it("serves a PDF for a contract with Arabic party names, and 422 for an unsupported script", async () => {
    const app = makeApp({}, { officialTemplate: tpl });
    const id = await readyContract(app);
    await call(app, "PATCH", `/contracts/${id}`, { landlord: { name: "محمد عبدالله المنصوري" }, property: { ownerName: "محمد عبدالله المنصوري" } });
    expect((await call(app, "GET", `/contracts/${id}/pdf`)).status).toBe(200);
    await call(app, "PATCH", `/contracts/${id}`, { tenant: { name: "王小明" } });
    const bad = await call(app, "GET", `/contracts/${id}/pdf`);
    expect(bad.status).toBe(422);
    expect(bad.body.error).toMatch(/tenant\.name/);
  });
});
