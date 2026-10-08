import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { z } from "zod";
import type { Contract } from "../domain/schema.js";
import { getPath } from "../domain/workflow.js";

/**
 * Stamps contract data onto the OFFICIAL tenancy form once legal supplies it, without
 * redrawing the form. A map file says where each field goes (PDF points, origin bottom-left):
 *   { "fields": { "landlord.name": {"page": 0, "x": 120, "y": 700, "size": 10}, ... } }
 * The official template and its map are configuration, not code, so a form revision needs no release.
 */
export const OverlayMapSchema = z.object({
  fields: z.record(
    z.string(),
    z.object({ page: z.number().int().min(0), x: z.number(), y: z.number(), size: z.number().positive().default(10) }),
  ),
});
export type OverlayMap = z.infer<typeof OverlayMapSchema>;

/** Fields that have a value and a map entry, i.e. exactly what will be printed. */
export function stampPlan(c: Contract, map: OverlayMap) {
  return Object.entries(map.fields).flatMap(([path, pos]) => {
    const v = getPath(c, path);
    return v === undefined || v === "" ? [] : [{ path, text: String(v), ...pos }];
  });
}

export async function renderOnTemplate(c: Contract, template: Uint8Array, map: OverlayMap): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(template);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = pdf.getPages();
  for (const f of stampPlan(c, map)) {
    const page = pages[f.page];
    if (!page) throw new Error(`Overlay map: page ${f.page} does not exist (field ${f.path})`);
    page.drawText(f.text, { x: f.x, y: f.y, size: f.size, font, color: rgb(0, 0, 0) });
  }
  return pdf.save();
}
