import fontkit from "@pdf-lib/fontkit";
import { readFileSync } from "node:fs";
import { rgb, type PDFPage } from "pdf-lib";

/**
 * Arabic text for the bilingual official form.
 *
 * pdf-lib cannot shape Arabic or place marks correctly, so each glyph is drawn as a vector outline
 * using the shaper's output (contextual joining forms, mark offsets, right-to-left order) from the
 * bundled Noto Sans Arabic font (SIL OFL 1.1, see templates/fonts/OFL.txt). Trade-off: Arabic text
 * on the PDF is not selectable or searchable; Latin text stays real text.
 */
interface Glyph {
  id: number;
  path: { commands: { command: string; args: number[] }[] };
}
interface Run {
  glyphs: Glyph[];
  positions: { xAdvance: number; xOffset: number; yOffset: number }[];
}
interface FkFont {
  unitsPerEm: number;
  layout(text: string): Run;
}

let cached: FkFont | undefined;
function font(): FkFont {
  cached ??= (fontkit as unknown as { create(b: Buffer): FkFont }).create(
    readFileSync(new URL("../../templates/fonts/NotoSansArabic-Regular.ttf", import.meta.url)),
  );
  return cached;
}

export const ARABIC_RE = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
export const hasArabic = (s: string) => ARABIC_RE.test(s);

const ARABIC_RUN_RE = /([\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]+)/;
const NEUTRAL_RE = /^[.,\-/()[\]&'":;]+$/;
const MIRROR: Record<string, string> = { "(": ")", ")": "(", "[": "]", "]": "[" };

export interface WordPart {
  text: string;
  /** true: draw with the Arabic font; false: ordinary text (punctuation) */
  ar: boolean;
}

/**
 * Splits a word that contains Arabic into drawable parts in VISUAL (left-to-right) order.
 * Punctuation inside the word (for example the dots in "ذ.م.م", an LLC suffix) is plain text and
 * brackets are mirrored, as in right-to-left typesetting. Latin letters or digits glued to Arabic
 * letters in one word are refused, because their order would be ambiguous.
 */
export function arabicWordParts(word: string): WordPart[] {
  const parts = word
    .split(ARABIC_RUN_RE)
    .filter(Boolean)
    .map((text) => {
      if (hasArabic(text)) return { text, ar: true };
      if (!NEUTRAL_RE.test(text)) throw new Error("mixes Arabic and Latin letters or digits inside one word");
      return { text: [...text].map((ch) => MIRROR[ch] ?? ch).join(""), ar: false };
    });
  return parts.reverse().map((p) => (p.ar ? p : { ...p, text: [...p.text].reverse().join("") }));
}

/** Shapes one run of Arabic letters. Throws if the font lacks a character. */
function shape(word: string): Run {
  const run = font().layout(word);
  if (run.glyphs.some((g) => g.id === 0)) throw new Error("contains a character the Arabic font does not have");
  return run;
}

export function arabicWordWidth(word: string, size: number): number {
  const f = font();
  return (shape(word).positions.reduce((sum, p) => sum + p.xAdvance, 0) * size) / f.unitsPerEm;
}

function svgOf(g: Glyph): string {
  // Font outlines are y-up; drawSvgPath is y-down, so negate y.
  return g.path.commands
    .map(({ command, args }) => {
      const a = args.map((v, i) => (i % 2 === 1 ? -v : v)).join(" ");
      switch (command) {
        case "moveTo": return `M${a}`;
        case "lineTo": return `L${a}`;
        case "quadraticCurveTo": return `Q${a}`;
        case "bezierCurveTo": return `C${a}`;
        case "closePath": return "Z";
        default: return "";
      }
    })
    .join("");
}

/** Draws one shaped word with its left edge at x and baseline at y. */
export function drawArabicWord(page: PDFPage, word: string, x: number, y: number, size: number): void {
  const f = font();
  const run = shape(word);
  const s = size / f.unitsPerEm;
  let cx = x;
  run.glyphs.forEach((g, i) => {
    const p = run.positions[i]!;
    const svg = svgOf(g);
    if (svg) page.drawSvgPath(svg, { x: cx + p.xOffset * s, y: y + p.yOffset * s, scale: s, color: rgb(0, 0, 0), borderWidth: 0 });
    cx += p.xAdvance * s;
  });
}
