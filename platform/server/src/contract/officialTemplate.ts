import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { OverlayMapSchema, type OverlayMap } from "./overlay.js";

export interface OfficialTemplate {
  pdf: Uint8Array;
  map: OverlayMap;
  /** SHA-256 of the form PDF, so the exact form version used can be shown and audited. */
  sha256: string;
}

const dir = new URL("../../templates/", import.meta.url);

/**
 * The bundled official form (Dubai Land Department / Ejari unified tenancy contract) is used by default.
 * TEMPLATE_MODE=draft switches to the generated draft layout; OFFICIAL_TEMPLATE_PDF and
 * OFFICIAL_TEMPLATE_MAP point to a replacement form revision.
 */
export function loadOfficialTemplate(env = process.env): OfficialTemplate | undefined {
  if (env.TEMPLATE_MODE === "draft") return undefined;
  const pdf = readFileSync(env.OFFICIAL_TEMPLATE_PDF ?? new URL("ejari-unified-tenancy-contract.pdf", dir));
  const raw = JSON.parse(readFileSync(env.OFFICIAL_TEMPLATE_MAP ?? new URL("ejari-unified-tenancy-contract.map.json", dir), "utf8"));
  return { pdf, map: OverlayMapSchema.parse(raw), sha256: createHash("sha256").update(pdf).digest("hex") };
}
