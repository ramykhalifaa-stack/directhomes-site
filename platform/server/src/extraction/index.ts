import type { DocKind, DocumentRecord, PartyRole } from "../domain/schema.js";

export const DOC_FIELDS: Record<DocKind, string[]> = {
  emirates_id: ["fullName", "idNumber", "nationality", "dateOfBirth", "expiryDate"],
  title_deed: [
    "titleDeedNumber",
    "ownerName",
    "ownerIdNumber",
    "plotNumber",
    "makaniNumber",
    "buildingName",
    "propertyNumber",
    "propertyType",
    "areaSqm",
    "location",
    "issueDate",
  ],
  trade_license: ["licenseNumber", "companyName", "licensingAuthority", "legalForm", "expiryDate"],
};

export type Extracted = DocumentRecord["extracted"];

export interface DocumentInput {
  kind: DocKind;
  filename: string;
  mimeType: string;
  data: Buffer;
}

export interface DocumentExtractor {
  readonly name: string;
  extract(input: DocumentInput): Promise<Extracted>;
}

/**
 * Test and demo extractor. It reads a JSON fixture of the shape
 * {"fields": {"fullName": "A B", ...}} or {"fields": {"fullName": {"value": "A B", "confidence": 0.8}}}
 * so that the whole flow can be exercised without an OCR provider or real documents.
 */
export class MockExtractor implements DocumentExtractor {
  readonly name = "mock";
  async extract(input: DocumentInput): Promise<Extracted> {
    let parsed: { fields?: Record<string, unknown> };
    try {
      parsed = JSON.parse(input.data.toString("utf8"));
    } catch {
      throw new Error("MockExtractor only accepts JSON fixtures; set EXTRACTOR=claude for real documents");
    }
    const out: Extracted = {};
    for (const key of DOC_FIELDS[input.kind]) {
      const raw = parsed.fields?.[key];
      if (raw === undefined || raw === null) continue;
      if (typeof raw === "object") {
        const r = raw as { value?: unknown; confidence?: unknown };
        out[key] = { value: String(r.value ?? ""), confidence: Number(r.confidence ?? 0.95) };
      } else {
        out[key] = { value: String(raw), confidence: 0.95 };
      }
    }
    return out;
  }
}

/**
 * Extractor backed by the Anthropic Messages API (vision / PDF input).
 * Not exercised by automated tests (needs a key and network). Documents are sent to a third
 * party: settle consent and data-residency terms before using it with real customer documents.
 */
export class ClaudeExtractor implements DocumentExtractor {
  readonly name = "claude";
  constructor(
    private apiKey: string,
    private model = process.env.EXTRACTION_MODEL ?? "claude-sonnet-5-5",
    private fetchImpl: typeof fetch = fetch,
  ) {}

  async extract(input: DocumentInput): Promise<Extracted> {
    const fields = DOC_FIELDS[input.kind];
    const b64 = input.data.toString("base64");
    const block =
      input.mimeType === "application/pdf"
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
        : { type: "image", source: { type: "base64", media_type: input.mimeType, data: b64 } };
    const prompt =
      `This is a UAE ${input.kind.replace("_", " ")}. Extract these fields exactly as printed (Latin script; ` +
      `dates as YYYY-MM-DD): ${fields.join(", ")}.\n` +
      `Return ONLY JSON: {"fields": {"<name>": {"value": "<text>", "confidence": <0..1>}}}. ` +
      `Omit a field you cannot read. Never guess or infer a value that is not visible.`;
    const res = await this.fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 1024,
        messages: [{ role: "user", content: [block, { type: "text", text: prompt }] }],
      }),
    });
    if (!res.ok) throw new Error(`Extraction API error ${res.status}`);
    const body = (await res.json()) as { content?: { type: string; text?: string }[] };
    const text = body.content?.find((b) => b.type === "text")?.text ?? "";
    const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    const parsed = JSON.parse(json) as { fields?: Record<string, { value?: unknown; confidence?: unknown }> };
    const out: Extracted = {};
    for (const key of fields) {
      const f = parsed.fields?.[key];
      if (!f || f.value === undefined || f.value === null || f.value === "") continue;
      const conf = Number(f.confidence);
      out[key] = { value: String(f.value), confidence: Number.isFinite(conf) ? Math.min(1, Math.max(0, conf)) : 0.5 };
    }
    return out;
  }
}

/**
 * Assisted mode: the document is kept (encrypted) but nothing is read from it, and nothing is sent to
 * a third party. Staff type the values in while looking at the document, then confirm them.
 */
export class ManualExtractor implements DocumentExtractor {
  readonly name = "manual";
  async extract(): Promise<Extracted> {
    return {};
  }
}

/**
 * EXTRACTOR = manual | mock | claude. With NODE_ENV=production the default is manual, and mock is refused
 * unless ALLOW_MOCK_INTEGRATIONS=1. claude sends documents to an outside AI service: only enable it once
 * counsel has approved that for personal data.
 */
export function createExtractor(env = process.env): DocumentExtractor {
  const production = env.NODE_ENV === "production";
  const mode = env.EXTRACTOR ?? (production ? "manual" : "mock");
  if (mode === "claude") {
    if (!env.ANTHROPIC_API_KEY) throw new Error("EXTRACTOR=claude requires ANTHROPIC_API_KEY");
    return new ClaudeExtractor(env.ANTHROPIC_API_KEY);
  }
  if (mode === "manual") return new ManualExtractor();
  if (mode === "mock") {
    if (production && env.ALLOW_MOCK_INTEGRATIONS !== "1") throw new Error("EXTRACTOR=mock in production needs ALLOW_MOCK_INTEGRATIONS=1");
    return new MockExtractor();
  }
  throw new Error(`Unknown EXTRACTOR '${mode}' (use manual, mock or claude)`);
}

export type { PartyRole };
