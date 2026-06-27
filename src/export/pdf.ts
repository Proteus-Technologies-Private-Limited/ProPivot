// Minimal, dependency-free PDF writer (docs/Architecture.md).
// Renders the export table as a paginated monospaced grid using the standard
// Courier font (no embedding needed), producing a real, openable .pdf. To match
// the HTML preview it also draws per-cell background fills, data/progress bars,
// colored & bold text, and left/right/center alignment from the computed
// SheetCell.style / SheetCell.bar descriptors (see src/core/cellStyle.ts).

import type { SheetCell } from './xlsx';
import { parseRgb } from '../core/cellStyle';

export interface PdfOptions {
  title?: string;
  orientation?: 'portrait' | 'landscape';
  fontSize?: number;
}

const enc = new TextEncoder();

function pdfEscape(s: string): string {
  // Keep WinAnsi-ish printable range; escape the PDF string delimiters.
  let out = '';
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (ch === '\\') out += '\\\\';
    else if (ch === '(') out += '\\(';
    else if (ch === ')') out += '\\)';
    else if (code >= 32 && code <= 255) out += ch;
    else out += '?';
  }
  return out;
}

/** PDF fill-color operand (0..1, deterministic) for an [r,g,b] triple. */
function rgbOp(rgb: [number, number, number]): string {
  return `${(rgb[0] / 255).toFixed(3)} ${(rgb[1] / 255).toFixed(3)} ${(rgb[2] / 255).toFixed(3)}`;
}

/**
 * Build a PDF document as bytes from a header row + styled data rows.
 */
export function buildPdf(header: string[], rows: SheetCell[][], opts: PdfOptions = {}): Uint8Array {
  const fontSize = opts.fontSize ?? 8;
  const landscape = opts.orientation === 'landscape';
  const pageW = landscape ? 842 : 595;
  const pageH = landscape ? 595 : 842;
  const margin = 30;
  const lineHeight = fontSize + 3;
  const charW = fontSize * 0.6; // Courier advance width
  const titleH = opts.title ? lineHeight + 6 : 0;

  const avail = pageW - margin * 2;
  const ncol = header.length;

  // Column widths (in chars), fitted to the page.
  const desired: number[] = header.map((h, i) => {
    let max = h.length;
    for (const r of rows) max = Math.max(max, (r[i]?.text ?? '').length);
    return Math.min(Math.max(max, 3) + 1, 60);
  });
  const maxChars = Math.floor(avail / charW);
  let totalChars = desired.reduce((s, c) => s + c, 0);
  const widths = desired.slice();
  if (totalChars > maxChars && totalChars > 0) {
    const scale = maxChars / totalChars;
    for (let i = 0; i < ncol; i++) widths[i] = Math.max(3, Math.floor(widths[i] * scale));
    totalChars = widths.reduce((s, c) => s + c, 0);
  }
  const xOf: number[] = [];
  let acc = margin;
  for (let i = 0; i < ncol; i++) { xOf.push(acc); acc += widths[i] * charW; }
  const colPx = (i: number) => widths[i] * charW;

  const fit = (s: string, w: number): string => {
    if (s.length <= w) return s;
    return w > 2 ? s.slice(0, w - 2) + '..' : s.slice(0, w);
  };

  const topY = pageH - margin - titleH;
  const bottomY = margin;
  const rowsPerPage = Math.max(1, Math.floor((topY - bottomY) / lineHeight) - 1); // minus header

  // Build per-page content streams.
  const pages: string[] = [];
  let i = 0;
  do {
    const slice = rows.slice(i, i + rowsPerPage);
    let content = '';
    let y = pageH - margin;

    if (opts.title) {
      content += `BT /F2 ${fontSize + 2} Tf 1 0 0 1 ${margin} ${y - fontSize} Tm (${pdfEscape(opts.title)}) Tj ET\n`;
      y -= titleH;
    }

    const drawRow = (cells: SheetCell[], header: boolean) => {
      // 1) Backgrounds + bars (skip for the header band).
      if (!header) {
        for (let c = 0; c < ncol; c++) {
          const cell = cells[c];
          if (!cell) continue;
          const w = colPx(c);
          const bg = parseRgb(cell.style?.bg);
          if (bg) content += `${rgbOp(bg)} rg ${xOf[c].toFixed(2)} ${(y - lineHeight).toFixed(2)} ${w.toFixed(2)} ${lineHeight.toFixed(2)} re f\n`;
          if (cell.bar) {
            const barRgb = parseRgb(cell.bar.color);
            if (barRgb) content += `${rgbOp(barRgb)} rg ${xOf[c].toFixed(2)} ${(y - lineHeight).toFixed(2)} ${(w * Math.max(0, Math.min(1, cell.bar.pct))).toFixed(2)} ${lineHeight.toFixed(2)} re f\n`;
          }
        }
        content += '0 0 0 rg\n';
      }
      // 2) Text (per cell, so color / font / alignment can vary).
      for (let c = 0; c < ncol; c++) {
        const cell = cells[c] ?? { text: '' };
        const txt = fit(cell.text ?? '', widths[c]);
        if (!txt) continue;
        const font = header || cell.style?.bold ? 'F2' : 'F1';
        const w = colPx(c);
        const align = cell.style?.align ?? (cell.num !== undefined ? 'right' : 'left');
        const textW = txt.length * charW;
        const x = align === 'right' ? xOf[c] + w - textW : align === 'center' ? xOf[c] + (w - textW) / 2 : xOf[c];
        const color = header ? null : parseRgb(cell.style?.color);
        if (color) content += `${rgbOp(color)} rg\n`;
        content += `BT /${font} ${fontSize} Tf 1 0 0 1 ${x.toFixed(2)} ${(y - fontSize).toFixed(2)} Tm (${pdfEscape(txt)}) Tj ET\n`;
        if (color) content += '0 0 0 rg\n';
      }
      y -= lineHeight;
    };

    drawRow(header.map((text) => ({ text })), true);
    for (const r of slice) drawRow(r, false);

    pages.push(content);
    i += rowsPerPage;
  } while (i < rows.length);

  return assemble(pages, pageW, pageH);
}

function assemble(pageContents: string[], pageW: number, pageH: number): Uint8Array {
  const objects: string[] = [];
  // Reserve: 1 catalog, 2 pages, 3 font Courier, 4 font Courier-Bold.
  const pageObjStart = 5;
  const contentObjStart = pageObjStart + pageContents.length;

  const kids = pageContents.map((_, idx) => `${pageObjStart + idx} 0 R`).join(' ');

  objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
  objects[2] = `<< /Type /Pages /Kids [${kids}] /Count ${pageContents.length} >>`;
  objects[3] = `<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>`;
  objects[4] = `<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold >>`;

  pageContents.forEach((content, idx) => {
    const contentObj = contentObjStart + idx;
    objects[pageObjStart + idx] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] ` +
      `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObj} 0 R >>`;
    objects[contentObj] = `<< /Length ${enc.encode(content).length} >>\nstream\n${content}\nendstream`;
  });

  // Serialize with an xref table.
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  const total = contentObjStart + pageContents.length - 1;
  for (let n = 1; n <= total; n++) {
    offsets[n] = enc.encode(body).length;
    body += `${n} 0 obj\n${objects[n]}\nendobj\n`;
  }
  const xrefStart = enc.encode(body).length;
  body += `xref\n0 ${total + 1}\n`;
  body += `0000000000 65535 f \n`;
  for (let n = 1; n <= total; n++) {
    body += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  }
  body += `trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;

  return enc.encode(body);
}
