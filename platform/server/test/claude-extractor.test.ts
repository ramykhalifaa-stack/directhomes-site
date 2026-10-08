import { describe, expect, it } from "vitest";
import { ClaudeExtractor } from "../src/extraction/index.js";

describe("ClaudeExtractor (stubbed network)", () => {
  const input = { kind: "emirates_id" as const, filename: "a.png", mimeType: "image/png", data: Buffer.from("img") };

  it("sends the document and parses fields, dropping unknown and empty ones", async () => {
    let sent: any;
    const fetchImpl = (async (_url: string, init: any) => {
      sent = JSON.parse(init.body);
      return new Response(
        JSON.stringify({ content: [{ type: "text", text: 'Here: {"fields": {"fullName": {"value": "A B", "confidence": 0.9}, "idNumber": {"value": "", "confidence": 1}, "bogus": {"value": "x"}}}' }] }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;
    const out = await new ClaudeExtractor("k", "m", fetchImpl).extract(input);
    expect(sent.messages[0].content[0].type).toBe("image");
    expect(out).toEqual({ fullName: { value: "A B", confidence: 0.9 } });
  });

  it("uses a document block for PDFs and throws on API errors", async () => {
    let sent: any;
    const ok = (async (_u: string, init: any) => {
      sent = JSON.parse(init.body);
      return new Response(JSON.stringify({ content: [{ type: "text", text: '{"fields": {}}' }] }), { status: 200 });
    }) as unknown as typeof fetch;
    await new ClaudeExtractor("k", "m", ok).extract({ ...input, mimeType: "application/pdf" });
    expect(sent.messages[0].content[0].type).toBe("document");

    const fail = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    await expect(new ClaudeExtractor("k", "m", fail).extract(input)).rejects.toThrow(/500/);
  });
});
