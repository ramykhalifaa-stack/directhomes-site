// Renders a sample contract (fictitious fixture data, mock integrations) on the official form.
// Usage: npx tsx scripts/sample.ts out.pdf [unsigned] [arabic]
import { writeFileSync } from "node:fs";
import { buildApp } from "../src/app.js";
import { loadOfficialTemplate } from "../src/contract/officialTemplate.js";
import { MockExtractor } from "../src/extraction/index.js";
import { createIntegrations } from "../src/integrations/registry.js";
import { MemoryRepo } from "../src/store/repo.js";
import { call, readyContract, TOKEN } from "../test/helpers.js";

const out = process.argv[2] ?? "sample.pdf";
const unsigned = process.argv.includes("unsigned");
const arabic = process.argv.includes("arabic");
const app = buildApp({
  repo: new MemoryRepo(),
  extractor: new MockExtractor(),
  integrations: createIntegrations({} as NodeJS.ProcessEnv),
  apiToken: TOKEN,
  officialTemplate: loadOfficialTemplate(),
});
const id = await readyContract(app, { startDate: "2026-11-01", endDate: "2027-10-31", annualRent: "95,000", contractValue: "95,000", securityDeposit: "4,750" });
await call(app, "PATCH", `/contracts/${id}`, {
  landlord: { tradeLicenseNo: "", name: "Landlord Example Test" },
  property: { usage: "Residential" },
  terms: { paymentCheques: "4" },
});
await call(app, "POST", `/contracts/${id}/confirm`, { fields: "all" });
if (arabic) {
  // Arabic names (as on an Emirates ID / title deed) and a mixed Arabic + Latin value.
  await call(app, "PATCH", `/contracts/${id}`, {
    landlord: { name: "محمد عبدالله المنصوري" },
    property: { ownerName: "محمد عبدالله المنصوري", buildingName: "برج Example", location: "Villa 12 - مبنى" },
    tenant: { name: "شركة الأمل للتجارة (ذ.م.م)" },
  });
  await call(app, "POST", `/contracts/${id}/confirm`, { fields: "all" });
}
if (!unsigned) {
  await call(app, "POST", `/contracts/${id}/verify`);
  for (const role of ["landlord", "tenant"]) {
    await call(app, "POST", `/contracts/${id}/signatures`, { role });
    await call(app, "POST", `/contracts/${id}/signatures/complete`, { role });
  }
}
const pdf = await call(app, "GET", `/contracts/${id}/pdf`);
if (pdf.status !== 200) throw new Error(`PDF failed: ${pdf.status} ${JSON.stringify(Buffer.from(pdf.body).toString())}`);
writeFileSync(out, pdf.body as Buffer);
console.log("wrote", out);
