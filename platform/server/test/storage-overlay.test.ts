import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import { afterAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { renderOnTemplate, stampPlan } from "../src/contract/overlay.js";
import { MockExtractor } from "../src/extraction/index.js";
import { createIntegrations } from "../src/integrations/registry.js";
import { SqliteRepo } from "../src/store/sqlite.js";
import { TOKEN, call } from "./helpers.js";

const dir = mkdtempSync(join(tmpdir(), "dh-test-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("SqliteRepo", () => {
  it("persists contracts and the audit log across reopen", async () => {
    const file = join(dir, "a.db");
    const mk = (r: SqliteRepo) =>
      buildApp({ repo: r, extractor: new MockExtractor(), integrations: createIntegrations({} as NodeJS.ProcessEnv), apiToken: TOKEN });
    const r1 = new SqliteRepo(file);
    const a1 = mk(r1);
    const { body: c } = await call(a1, "POST", "/contracts");
    await call(a1, "PATCH", `/contracts/${c.id}`, { terms: { annualRent: "90000" } });
    r1.close();

    const r2 = new SqliteRepo(file);
    const a2 = mk(r2);
    const got = await call(a2, "GET", `/contracts/${c.id}`);
    expect(got.body.terms.annualRent).toBe("90000");
    const audit = await call(a2, "GET", `/contracts/${c.id}/audit`);
    expect(audit.body.map((e: { action: string }) => e.action)).toEqual(["contract.created", "contract.edited"]);
    r2.close();
  });
});

describe("official template overlay", () => {
  async function blank() {
    const d = await PDFDocument.create();
    d.addPage([595, 842]);
    return d.save();
  }
  const contract = { id: "x", landlord: { name: "Test Landlord" }, tenant: {}, property: {}, terms: {} } as never;

  it("stamps mapped fields onto the template and keeps the page count", async () => {
    const out = await renderOnTemplate(contract, await blank(), { fields: { "landlord.name": { page: 0, x: 50, y: 700, size: 10 }, "tenant.name": { page: 0, x: 50, y: 680, size: 10 } } });
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(1);
    const map = { fields: { "landlord.name": { page: 0, x: 50, y: 700, size: 10 }, "tenant.name": { page: 0, x: 50, y: 680, size: 10 } } };
    expect(stampPlan(contract, map).texts.map((f) => [f.path, f.text])).toEqual([["landlord.name", "Test Landlord"]]); // empty tenant skipped
  });

  it("fails clearly when the map points at a missing page", async () => {
    await expect(renderOnTemplate(contract, await blank(), { fields: { "landlord.name": { page: 3, x: 1, y: 1, size: 10 } } })).rejects.toThrow(/page 4/);
  });

  it("is used by the API when configured", async () => {
    const app = buildApp({
      repo: new SqliteRepo(join(dir, "b.db")),
      extractor: new MockExtractor(),
      integrations: createIntegrations({} as NodeJS.ProcessEnv),
      apiToken: TOKEN,
      officialTemplate: { pdf: await blank(), map: { fields: {} }, sha256: "x" },
    });
    const { body: c } = await call(app, "POST", "/contracts");
    const pdf = await call(app, "GET", `/contracts/${c.id}/pdf`);
    expect(Buffer.from(pdf.body).subarray(0, 5).toString()).toBe("%PDF-");
    // draft-layout text must be absent when the official template is used
    expect(Buffer.from(pdf.body).toString("latin1")).not.toContain("DRAFT LAYOUT");
  });
});
