import { createHmac, timingSafeEqual } from "node:crypto";
import Fastify, { type FastifyInstance } from "fastify";
import { z } from "zod";
import { renderContractPdf } from "./contract/pdf.js";
import { DocKindSchema, PartyRole, PartySchema, PropertySchema, TermsSchema } from "./domain/schema.js";
import { WorkflowError } from "./domain/workflow.js";
import type { DocumentExtractor } from "./extraction/index.js";
import { integrationModes } from "./integrations/registry.js";
import { NotConfiguredError, type Integrations } from "./integrations/types.js";
import { ContractService } from "./service.js";
import type { Repo } from "./store/repo.js";

export interface AppDeps {
  repo: Repo;
  extractor: DocumentExtractor;
  integrations: Integrations;
  /** Bearer token for the pilot. Replace with per-user auth (UAE PASS login) before wider rollout. */
  apiToken: string;
}

const PatchBody = z.object({
  landlord: PartySchema.optional(),
  tenant: PartySchema.optional(),
  property: PropertySchema.optional(),
  terms: TermsSchema.optional(),
});

const DocBody = z.object({
  kind: DocKindSchema,
  party: PartyRole.optional(),
  filename: z.string().min(1),
  mimeType: z.string().min(1),
  dataBase64: z.string().min(1),
});

const ConfirmBody = z.object({ fields: z.union([z.literal("all"), z.array(z.string()).min(1)]) });
const RoleBody = z.object({ role: PartyRole });

const LINK_TTL_MS = 5 * 60 * 1000;

function signLink(id: string, exp: number, secret: string): string {
  return createHmac("sha256", secret).update(`pdf:${id}:${exp}`).digest("hex");
}

function tokenOk(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function buildApp(deps: AppDeps): FastifyInstance {
  if (!deps.apiToken) throw new Error("apiToken is required");
  const app = Fastify({ logger: false, bodyLimit: 20 * 1024 * 1024 });
  const svc = new ContractService(deps.repo, deps.extractor, deps.integrations);

  app.addHook("onRequest", async (req, reply) => {
    const path = req.url.split("?")[0] ?? "";
    if (path === "/health" || path.endsWith("/pdf-signed")) return; // signed links carry their own proof
    const auth = req.headers.authorization?.replace(/^Bearer /, "");
    if (!tokenOk(auth, deps.apiToken)) return reply.code(401).send({ error: "unauthorized" });
  });

  app.setErrorHandler((err: unknown, _req, reply) => {
    if (err instanceof WorkflowError) return reply.code(err.statusCode).send({ error: err.message, details: err.details });
    if (err instanceof z.ZodError) return reply.code(400).send({ error: "invalid request", details: err.issues });
    if (err instanceof NotConfiguredError) return reply.code(501).send({ error: err.message });
    // Framework errors (malformed JSON, payload too large, unknown route) carry their own 4xx status.
    const status = (err as { statusCode?: number }).statusCode;
    if (typeof status === "number" && status >= 400 && status < 500) {
      return reply.code(status).send({ error: err instanceof Error ? err.message : "bad request" });
    }
    // Anything else is unexpected: never leak internals to the client.
    console.error("unhandled error", err instanceof Error ? err.stack : err);
    return reply.code(500).send({ error: "internal error" });
  });

  const actor = "pilot-operator";
  type Params = { Params: { id: string } };

  app.get("/health", async () => ({ ok: true }));
  app.get("/integrations", async () => integrationModes(deps.integrations));

  app.post("/contracts", async (_req, reply) => reply.code(201).send(await svc.create(actor)));
  app.get<Params>("/contracts/:id", async (req) => svc.get(req.params.id));
  app.patch<Params>("/contracts/:id", async (req) => svc.patch(req.params.id, PatchBody.parse(req.body), actor));

  app.post<Params>("/contracts/:id/documents", async (req, reply) => {
    const b = DocBody.parse(req.body);
    const data = Buffer.from(b.dataBase64, "base64");
    if (data.length === 0) throw new WorkflowError("empty document", 400);
    let result;
    try {
      result = await svc.addDocument(req.params.id, { kind: b.kind, party: b.party, filename: b.filename, mimeType: b.mimeType, data }, actor);
    } catch (e) {
      if (e instanceof WorkflowError) throw e;
      throw new WorkflowError(`Could not read document: ${e instanceof Error ? e.message : "unknown error"}`, 422);
    }
    return reply.code(201).send(result);
  });

  app.post<Params>("/contracts/:id/confirm", async (req) => svc.confirm(req.params.id, ConfirmBody.parse(req.body).fields, actor));
  app.get<Params>("/contracts/:id/readiness", async (req) => svc.readiness(req.params.id));
  app.post<Params>("/contracts/:id/verify", async (req) => svc.verify(req.params.id, actor));

  app.post<Params>("/contracts/:id/signatures", async (req) => svc.startSigning(req.params.id, RoleBody.parse(req.body).role, actor));
  app.post<Params>("/contracts/:id/signatures/complete", async (req) => svc.completeSigning(req.params.id, RoleBody.parse(req.body).role, actor));

  app.post<Params>("/contracts/:id/escrow", async (req) => svc.openEscrow(req.params.id, actor));
  app.post<Params>("/contracts/:id/escrow/refresh", async (req) => svc.refreshEscrow(req.params.id, actor));
  app.post<Params>("/contracts/:id/ejari", async (req) => svc.registerEjari(req.params.id, actor));

  app.get<Params>("/contracts/:id/audit", async (req) => svc.auditTrail(req.params.id));
  app.get<Params>("/contracts/:id/pdf", async (req, reply) => {
    const pdf = await renderContractPdf(await svc.get(req.params.id));
    return reply.header("content-type", "application/pdf").send(Buffer.from(pdf));
  });

  // Short-lived signed link so a phone can open the PDF in the system viewer without sending the API token.
  app.post<Params>("/contracts/:id/pdf-link", async (req) => {
    await svc.get(req.params.id);
    const exp = Date.now() + LINK_TTL_MS;
    return { url: `/contracts/${req.params.id}/pdf-signed?exp=${exp}&sig=${signLink(req.params.id, exp, deps.apiToken)}`, expiresAt: new Date(exp).toISOString() };
  });
  app.get<Params & { Querystring: { exp?: string; sig?: string } }>("/contracts/:id/pdf-signed", async (req, reply) => {
    const exp = Number(req.query.exp);
    const sig = req.query.sig ?? "";
    const expected = signLink(req.params.id, exp, deps.apiToken);
    const valid = Number.isFinite(exp) && exp > Date.now() && sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    if (!valid) return reply.code(401).send({ error: "invalid or expired link" });
    const pdf = await renderContractPdf(await svc.get(req.params.id));
    return reply.header("content-type", "application/pdf").send(Buffer.from(pdf));
  });

  return app;
}
