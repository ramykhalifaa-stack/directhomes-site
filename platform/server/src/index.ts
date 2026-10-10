import { buildApp } from "./app.js";
import { createExtractor } from "./extraction/index.js";
import { createIntegrations } from "./integrations/registry.js";
import { loadOfficialTemplate } from "./contract/officialTemplate.js";
import { createAuthProvider } from "./auth.js";
import { EncryptedFileDocumentStore, MemoryDocumentStore } from "./store/documents.js";
import { MemoryRepo } from "./store/repo.js";
import { SqliteRepo } from "./store/sqlite.js";

const apiToken = process.env.PILOT_API_TOKEN;
if (!apiToken) {
  console.error("PILOT_API_TOKEN is required (any long random string for local dev)");
  process.exit(1);
}

// Official Dubai form is stamped by default (TEMPLATE_MODE=draft for the generated layout; see officialTemplate.ts).
const officialTemplate = loadOfficialTemplate();
console.log(officialTemplate ? `PDF template: official form sha256 ${officialTemplate.sha256}` : "PDF template: DRAFT layout (not the official form)");

// Original documents hold personal data: with DOCUMENT_DIR they are encrypted on disk (DOCUMENT_KEY = 64 hex chars).
if (process.env.DOCUMENT_DIR && !process.env.DOCUMENT_KEY) {
  console.error("DOCUMENT_DIR requires DOCUMENT_KEY (64 hex characters, from a secret manager)");
  process.exit(1);
}
const documents = process.env.DOCUMENT_DIR
  ? new EncryptedFileDocumentStore(process.env.DOCUMENT_DIR, process.env.DOCUMENT_KEY!)
  : new MemoryDocumentStore();

// Per-user login: AUTH_MODE=disabled (default) | mock (dev only) | live (not implemented). Only STAFF_EMIRATES_IDS may log in.
const authProvider = createAuthProvider();

const app = buildApp({
  documents,
  auth: authProvider
    ? { provider: authProvider, staffEmiratesIds: (process.env.STAFF_EMIRATES_IDS ?? "").split(",").map((s) => s.trim()).filter(Boolean) }
    : undefined,
  // DATABASE_FILE makes data survive restarts; without it everything is in memory and lost on exit.
  repo: process.env.DATABASE_FILE ? new SqliteRepo(process.env.DATABASE_FILE) : new MemoryRepo(),
  officialTemplate,
  extractor: createExtractor(),
  integrations: createIntegrations(),
  apiToken,
});

const port = Number(process.env.PORT ?? 3000);
app.listen({ port, host: process.env.HOST ?? "127.0.0.1" }).then(() => {
  console.log(`Direct Homes platform API listening on :${port}`);
});
