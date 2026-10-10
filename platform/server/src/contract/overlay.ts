import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { z } from "zod";
import type { Contract, PartyRole } from "../domain/schema.js";
import { getPath } from "../domain/workflow.js";
import { arabicWordParts, arabicWordWidth, drawArabicWord, hasArabic } from "./arabic.js";

/**
 * Stamps contract data onto the OFFICIAL Dubai tenancy form without redrawing it.
 * A map file says where each value goes (PDF points, origin bottom-left):
 *   { "fields": { "landlord.name": {"page": 0, "x": 95, "y": 642, "size": 9.5, "maxWidth": 420} },
 *     "marks":  { "property.usage": { "residential": {"page": 0, "x": 372, "y": 346, "r": 3.4} } } }
 * A path may map to one placement or a list (the same value printed on several pages).
 * Paths are "section.field" on the contract, or "derived.*" computed values (see derivedValue).
 * The template and map are configuration, so a form revision needs no code change.
 */
const Placement = z.object({
  page: z.number().int().min(0),
  x: z.number(),
  y: z.number(),
  size: z.number().positive().default(10),
  /** Shrink the text to fit this width (down to MIN_SIZE); fail rather than truncate legal data. */
  maxWidth: z.number().positive().optional(),
  format: z.enum(["text", "date"]).default("text"),
});
const Mark = z.object({ page: z.number().int().min(0), x: z.number(), y: z.number(), r: z.number().positive().default(3.4) });

export const OverlayMapSchema = z.object({
  fields: z.record(z.string(), z.union([Placement, z.array(Placement)])),
  marks: z.record(z.string(), z.record(z.string(), Mark)).optional(),
});
export type OverlayMap = z.input<typeof OverlayMapSchema>;

const MIN_SIZE = 6;

/** The value cannot be printed on the form as-is (too long, or characters the printer cannot draw). */
export class OverlayError extends Error {}

const fmtDate = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
};

const dubaiToday = (now: Date) => new Date(now.getTime() + 4 * 3600_000).toISOString().slice(0, 10);

function signatureValue(c: Contract, role: PartyRole, part: "Date" | "Line1" | "Line2"): string {
  const s = c.signatures[role];
  if (s?.status !== "signed") return "";
  if (part === "Date") return (s.signedAt ?? "").slice(0, 10);
  if (part === "Line1") return "Electronically signed (UAE PASS)";
  return `Ref ${s.signatureId ?? "-"}  ${(s.signedAt ?? "").slice(0, 16).replace("T", " ")} UTC`;
}

/** Values the form needs that are not stored verbatim on the contract. */
export function derivedValue(c: Contract, key: string, now = new Date()): string {
  switch (key) {
    case "date": {
      // Contract date: the later signature date once signed, otherwise today in Dubai.
      const signed = Object.values(c.signatures).flatMap((s) => (s?.signedAt ? [s.signedAt.slice(0, 10)] : []));
      return signed.length === 2 ? signed.sort().at(-1)! : dubaiToday(now);
    }
    case "paymentMode": {
      const v = (c.terms.paymentCheques ?? "").trim();
      return /^\d+$/.test(v) ? `${v} ${Number(v) === 1 ? "cheque" : "cheques"}` : v;
    }
    case "tenantSignedDate": return signatureValue(c, "tenant", "Date");
    case "landlordSignedDate": return signatureValue(c, "landlord", "Date");
    case "tenantSignatureLine1": return signatureValue(c, "tenant", "Line1");
    case "tenantSignatureLine2": return signatureValue(c, "tenant", "Line2");
    case "landlordSignatureLine1": return signatureValue(c, "landlord", "Line1");
    case "landlordSignatureLine2": return signatureValue(c, "landlord", "Line2");
    default: throw new OverlayError(`Unknown derived field '${key}' in the form map`);
  }
}

export function valueFor(c: Contract, path: string, now = new Date()): string {
  if (path.startsWith("derived.")) return derivedValue(c, path.slice("derived.".length), now);
  const v = getPath(c, path);
  return v === undefined || v === null ? "" : String(v);
}

/** Everything that will be printed (empty values skipped), before font fitting. Pure, for tests. */
export function stampPlan(c: Contract, mapIn: OverlayMap, now = new Date()) {
  const map = OverlayMapSchema.parse(mapIn);
  const texts = Object.entries(map.fields).flatMap(([path, spec]) => {
    const text = valueFor(c, path, now);
    if (!text) return [];
    return (Array.isArray(spec) ? spec : [spec]).map((p) => ({ path, text: p.format === "date" ? fmtDate(text) : text, ...p }));
  });
  const marks = Object.entries(map.marks ?? {}).flatMap(([path, options]) => {
    const chosen = valueFor(c, path, now).trim().toLowerCase();
    const m = options[chosen];
    return m ? [{ path, option: chosen, ...m }] : [];
  });
  return { texts, marks };
}

export async function renderOnTemplate(c: Contract, template: Uint8Array, mapIn: OverlayMap, now = new Date()): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(template);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = pdf.getPages();
  const { texts, marks } = stampPlan(c, mapIn, now);

  for (const t of texts) {
    const page = pages[t.page];
    if (!page) throw new OverlayError(`Form map points at page ${t.page + 1}, which does not exist (field ${t.path})`);
    const unprintable = (why: string) => new OverlayError(`'${t.path}' ${why}; only Latin and Arabic text are supported`);
    const latinWidth = (txt: string, s: number) => {
      try {
        return font.widthOfTextAtSize(txt, s);
      } catch {
        throw unprintable("contains characters the form printer cannot draw");
      }
    };

    if (hasArabic(t.text)) {
      // Mixed-direction line, ordered at word level like Unicode bidi: the first word's script sets the line
      // direction; consecutive Arabic words form a right-to-left run, other words a left-to-right run.
      const logical = t.text.split(/\s+/).filter(Boolean);
      const baseRtl = hasArabic(logical[0]!);
      if (baseRtl && !t.maxWidth) throw new OverlayError(`'${t.path}' has right-to-left text but its form-map entry has no maxWidth to align against`);
      const runs: { ar: boolean; words: string[] }[] = [];
      for (const w of logical) {
        const ar = hasArabic(w);
        if (runs.at(-1)?.ar === ar) runs.at(-1)!.words.push(w);
        else runs.push({ ar, words: [w] });
      }
      const visual = (baseRtl ? [...runs].reverse() : runs).flatMap((r) => (r.ar ? [...r.words].reverse() : r.words));
      const partsOf = (w: string) => {
        if (!hasArabic(w)) return [{ text: w, ar: false }];
        try {
          return arabicWordParts(w);
        } catch (e) {
          throw unprintable(`has a word that cannot be printed (${e instanceof Error ? e.message : "unknown"})`);
        }
      };
      const partWidth = (p: { text: string; ar: boolean }, s: number) => {
        if (!p.ar) return latinWidth(p.text, s);
        try {
          return arabicWordWidth(p.text, s);
        } catch (e) {
          throw unprintable(`has a word that cannot be printed (${e instanceof Error ? e.message : "unknown"})`);
        }
      };
      const wordWidth = (w: string, s: number) => partsOf(w).reduce((sum, p) => sum + partWidth(p, s), 0);
      const total = (s: number) => visual.reduce((sum, w) => sum + wordWidth(w, s), 0) + latinWidth(" ", s) * (visual.length - 1);
      let size = t.size;
      if (t.maxWidth) {
        while (total(size) > t.maxWidth && size > MIN_SIZE) size -= 0.5;
        if (total(size) > t.maxWidth) throw new OverlayError(`'${t.path}' is too long to fit its box on the official form`);
      }
      let x = baseRtl ? t.x + t.maxWidth! - total(size) : t.x; // right edge for RTL lines, left edge otherwise
      for (const w of visual) {
        for (const p of partsOf(w)) {
          if (p.ar) drawArabicWord(page, p.text, x, t.y, size);
          else page.drawText(p.text, { x, y: t.y, size, font, color: rgb(0, 0, 0) });
          x += partWidth(p, size);
        }
        x += latinWidth(" ", size);
      }
      continue;
    }

    const width = (s: number) => latinWidth(t.text, s);
    let size = t.size;
    if (t.maxWidth) {
      while (width(size) > t.maxWidth && size > MIN_SIZE) size -= 0.5;
      if (width(size) > t.maxWidth) throw new OverlayError(`'${t.path}' is too long to fit its box on the official form`);
    } else width(size); // still validates the characters
    page.drawText(t.text, { x: t.x, y: t.y, size, font, color: rgb(0, 0, 0) });
  }
  for (const m of marks) {
    const page = pages[m.page];
    if (!page) throw new OverlayError(`Form map points at page ${m.page + 1}, which does not exist (mark ${m.path})`);
    page.drawCircle({ x: m.x, y: m.y, size: m.r, color: rgb(0, 0, 0) });
  }
  return pdf.save();
}
