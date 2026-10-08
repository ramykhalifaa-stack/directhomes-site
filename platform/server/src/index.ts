import { buildApp } from "./app.js";
import { createExtractor } from "./extraction/index.js";
import { createIntegrations } from "./integrations/registry.js";
import { MemoryRepo } from "./store/repo.js";

const apiToken = process.env.PILOT_API_TOKEN;
if (!apiToken) {
  console.error("PILOT_API_TOKEN is required (any long random string for local dev)");
  process.exit(1);
}

const app = buildApp({
  repo: new MemoryRepo(),
  extractor: createExtractor(),
  integrations: createIntegrations(),
  apiToken,
});

const port = Number(process.env.PORT ?? 3000);
app.listen({ port, host: process.env.HOST ?? "127.0.0.1" }).then(() => {
  console.log(`Direct Homes platform API listening on :${port}`);
});
