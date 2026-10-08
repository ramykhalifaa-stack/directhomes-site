import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { Contract } from "../domain/schema.js";
import { contractHash } from "../domain/workflow.js";

/**
 * Generates a field-complete tenancy contract PDF.
 *
 * IMPORTANT: this is NOT the official Dubai unified tenancy contract. It carries every field
 * we believe the official form needs, in a clearly marked draft layout. Before real use,
 * legal must approve the official form and the data should be overlaid onto it. FIELD_LAYOUT
 * below is the single place that maps contract data to printed labels.
 */
export const FIELD_LAYOUT: { title: string; rows: [label: string, path: string][] }[] = [
  {
    title: "Lessor (Landlord)",
    rows: [
      ["Name", "landlord.name"],
      ["Emirates ID", "landlord.emiratesId"],
      ["Trade license no.", "landlord.tradeLicenseNo"],
      ["Licensing authority", "landlord.licensingAuthority"],
      ["Email", "landlord.email"],
      ["Phone", "landlord.phone"],
    ],
  },
  {
    title: "Tenant",
    rows: [
      ["Name", "tenant.name"],
      ["Emirates ID", "tenant.emiratesId"],
      ["Trade license no.", "tenant.tradeLicenseNo"],
      ["Licensing authority", "tenant.licensingAuthority"],
      ["Email", "tenant.email"],
      ["Phone", "tenant.phone"],
    ],
  },
  {
    title: "Property",
    rows: [
      ["Title deed no.", "property.titleDeedNumber"],
      ["Owner name (title deed)", "property.ownerName"],
      ["Plot no.", "property.plotNumber"],
      ["Makani no.", "property.makaniNumber"],
      ["Building name", "property.buildingName"],
      ["Property no.", "property.propertyNumber"],
      ["Property type", "property.propertyType"],
      ["Area (sqm)", "property.areaSqm"],
      ["Location", "property.location"],
      ["Usage", "property.usage"],
      ["Premises no. (DEWA)", "property.premisesNo"],
    ],
  },
  {
    title: "Contract terms",
    rows: [
      ["Start date", "terms.startDate"],
      ["End date", "terms.endDate"],
      ["Annual rent (AED)", "terms.annualRent"],
      ["Security deposit (AED)", "terms.securityDeposit"],
      ["Number of cheques", "terms.paymentCheques"],
    ],
  },
];

function value(c: Contract, path: string): string {
  const [section, field] = path.split(".") as [string, string];
  const v = (c as unknown as Record<string, Record<string, unknown>>)[section]?.[field];
  return v === undefined || v === "" ? "-" : String(v);
}

export async function renderContractPdf(c: Contract): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const margin = 50;
  let page: PDFPage = pdf.addPage([595, 842]);
  let y = 842 - margin;

  const ensure = (needed: number) => {
    if (y - needed < margin + 40) {
      page = pdf.addPage([595, 842]);
      y = 842 - margin;
    }
  };
  const text = (s: string, x: number, f: PDFFont, size: number, color = rgb(0, 0, 0)) =>
    page.drawText(s, { x, y, size, font: f, color });

  text("TENANCY CONTRACT (DRAFT LAYOUT)", margin, bold, 16);
  y -= 16;
  text("Not the official form. For review until the official Dubai unified contract is approved.", margin, font, 9, rgb(0.7, 0.1, 0.1));
  y -= 14;
  text(`Contract ID: ${c.id}    Status: ${c.status}`, margin, font, 9);
  y -= 24;

  for (const section of FIELD_LAYOUT) {
    ensure(24 + section.rows.length * 16);
    text(section.title, margin, bold, 12);
    y -= 6;
    page.drawLine({ start: { x: margin, y }, end: { x: 545, y }, thickness: 0.5, color: rgb(0.6, 0.6, 0.6) });
    y -= 16;
    for (const [label, path] of section.rows) {
      ensure(16);
      text(label, margin, font, 10, rgb(0.35, 0.35, 0.35));
      text(value(c, path), 230, font, 10);
      y -= 16;
    }
    y -= 10;
  }

  ensure(80);
  text("Signatures", margin, bold, 12);
  y -= 18;
  for (const role of ["landlord", "tenant"] as const) {
    const s = c.signatures[role];
    text(
      `${role}: ${s?.status === "signed" ? `signed ${s.signedAt} (ref ${s.signatureId})` : "not signed"}`,
      margin,
      font,
      10,
    );
    y -= 16;
  }
  if (c.ejari) {
    text(`Ejari no.: ${c.ejari.ejariNumber} (${c.ejari.registeredAt})`, margin, font, 10);
    y -= 16;
  }

  const hash = c.contractHash ?? contractHash(c);
  for (const p of pdf.getPages()) {
    p.drawText(`Content hash (SHA-256): ${hash}`, { x: margin, y: 28, size: 7, font, color: rgb(0.4, 0.4, 0.4) });
  }
  return pdf.save();
}
