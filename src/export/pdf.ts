// Minimal, dependency-free PDF writer (docs/Architecture.md).
// Renders the export table as a paginated monospaced grid using the standard
// Courier font (no embedding needed), producing a real, openable .pdf.

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

/**
 * Build a PDF document as bytes from a header row + data rows (text).
 */
export function buildPdf(header: string[], rows: string[][], opts: PdfOptions = {}): Uint8Array {
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
    for (const r of rows) max = Math.max(max, (r[i] ?? '').length);
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
    // header (bold)
    const drawRow = (cells: string[], font: string) => {
      content += `BT /${font} ${fontSize} Tf\n`;
      for (let c = 0; c < ncol; c++) {
        const txt = fit(cells[c] ?? '', widths[c]);
        content += `1 0 0 1 ${xOf[c].toFixed(2)} ${(y - fontSize).toFixed(2)} Tm (${pdfEscape(txt)}) Tj\n`;
      }
      content += 'ET\n';
      y -= lineHeight;
    };

    drawRow(header, 'F2');
    for (const r of slice) drawRow(r, 'F1');

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
