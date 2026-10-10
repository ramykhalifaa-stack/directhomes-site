import { readFileSync } from "node:fs";
import { buildApp } from "../src/app.js";
import { MockExtractor } from "../src/extraction/index.js";
import { createIntegrations } from "../src/integrations/registry.js";
import { MemoryRepo } from "../src/store/repo.js";

export const TOKEN = "test-token-0123456789";
export const auth = { authorization: `Bearer ${TOKEN}` };

export function makeApp(env: Record<string, string> = {}, extra: Partial<Parameters<typeof buildApp>[0]> = {}) {
  return buildApp({
    repo: new MemoryRepo(),
    extractor: new MockExtractor(),
    integrations: createIntegrations(env as NodeJS.ProcessEnv),
    apiToken: TOKEN,
    ...extra, // overrides win
  });
}

export const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url));
export const b64 = (buf: Buffer | string) => Buffer.from(buf).toString("base64");

export type App = ReturnType<typeof makeApp>;

export async function call(app: App, method: "GET" | "POST" | "PATCH", url: string, payload?: unknown) {
  const res = await app.inject({ method, url, headers: auth, payload: payload as object | undefined });
  return { status: res.statusCode, body: res.headers["content-type"]?.toString().includes("json") ? res.json() : res.rawPayload };
}

/** Creates a contract and records consent, the precondition for entering personal data. */
export async function newConsentedContract(app: App): Promise<string> {
  const { body: c } = await call(app, "POST", "/contracts");
  await call(app, "POST", `/contracts/${c.id}/consent`, { noticeVersion: "test-v1" });
  return c.id as string;
}

export async function upload(app: App, id: string, kind: string, name: string, party?: string) {
  return call(app, "POST", `/contracts/${id}/documents`, {
    kind,
    party,
    filename: `${name}.json`,
    mimeType: "application/json",
    dataBase64: b64(fixture(name)),
  });
}

/** Builds a contract that is ready to verify (documents uploaded, contact + terms entered, all confirmed). */
export async function readyContract(app: App, termsOverride: Record<string, unknown> = {}) {
  const { body: c } = await call(app, "POST", "/contracts");
  const id = c.id as string;
  await call(app, "POST", `/contracts/${id}/consent`, { noticeVersion: "test-v1" });
  await upload(app, id, "emirates_id", "landlord_emirates_id", "landlord");
  await upload(app, id, "emirates_id", "tenant_emirates_id", "tenant");
  await upload(app, id, "title_deed", "title_deed");
  await call(app, "PATCH", `/contracts/${id}`, {
    landlord: { email: "landlord@example.test", phone: "+971500000001" },
    tenant: { email: "tenant@example.test", phone: "+971500000002" },
    property: { usage: "Residential", premisesNo: "123456789" },
    terms: { startDate: "2030-03-01", endDate: "2031-02-28", annualRent: "100000", contractValue: "100000", securityDeposit: "5000", paymentCheques: "4", ...termsOverride },
  });
  await call(app, "POST", `/contracts/${id}/confirm`, { fields: "all" });
  return id;
}
