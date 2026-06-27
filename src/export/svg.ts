// Dependency-free SVG image of the export table (docs/Architecture.md).
// The design calls for a raster PNG via canvas/html-to-image; that needs a browser
// canvas + font rasterizer, so the portable, deterministic core is an SVG (a real,
// browser-renderable image). A browser can rasterize this SVG to PNG on demand
// (see `exportTo('image', { imageFormat: 'png' })`); the SVG itself is what we test.
//
// Layout uses a monospace metric (like ./pdf) so column widths are exact and the
// output is byte-stable run to run.

import type { SheetCell } from './xlsx';

export interface SvgOptions {
  title?: string;
  fontSize?: number;
  /** Max column width in characters before truncation. */
  maxColChars?: number;
}

const HEADER_FILL = '#f0f0f0';
const GRID = '#d0d0d0';
const TEXT = '#222222';

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Build an SVG document (as a string) for a header row + data rows. Numeric cells
 * (those carrying `num`) are right-aligned; text cells are left-aligned.
 */
export function buildSvg(header: string[], rows: SheetCell[][], opts: SvgOptions = {}): string {
  const fontSize = opts.fontSize ?? 13;
  const maxColChars = opts.maxColChars ?? 40;
  const charW = fontSize * 0.62; // monospace advance
  const padH = 8;
  const padV = 6;
  const rowH = fontSize + padV * 2;
  const titleH = opts.title ? rowH + 4 : 0;
  const ncol = header.length;

  const fit = (s: string): string =>
    s.length <= maxColChars ? s : maxColChars > 2 ? s.slice(0, maxColChars - 2) + '..' : s.slice(0, maxColChars);

  // Column widths from the widest (fitted) cell in each column.
  const widths: number[] = header.map((h, i) => {
    let max = fit(h).length;
    for (const r of rows) max = Math.max(max, fit(r[i]?.text ?? '').length);
    return Math.max(3, max) * charW + padH * 2;
  });
  const colX: number[] = [];
  let acc = 0;
  for (let i = 0; i < ncol; i++) { colX.push(acc); acc += widths[i]; }
  const totalW = Math.max(acc, 1);
  const bodyTop = titleH + rowH; // title + header row
  const totalH = bodyTop + rows.length * rowH;

  const baseline = (top: number) => top + rowH - padV - 1;
  const out: string[] = [];
  out.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${totalW.toFixed(0)}" height="${totalH.toFixed(0)}" ` +
      `viewBox="0 0 ${totalW.toFixed(0)} ${totalH.toFixed(0)}" font-family="monospace" font-size="${fontSize}">`,
  );
  out.push(`<rect width="${totalW.toFixed(0)}" height="${totalH.toFixed(0)}" fill="#ffffff"/>`);

  if (opts.title) {
    out.push(
      `<text x="${padH}" y="${baseline(0)}" fill="${TEXT}" font-weight="bold" font-size="${fontSize + 2}">` +
        `${xmlEscape(opts.title)}</text>`,
    );
  }

  // Header band.
  out.push(`<rect x="0" y="${titleH}" width="${totalW.toFixed(0)}" height="${rowH}" fill="${HEADER_FILL}"/>`);

  const drawRow = (cells: Array<{ text: string; num?: number }>, top: number, bold: boolean) => {
    for (let c = 0; c < ncol; c++) {
      const cell = cells[c] ?? { text: '' };
      const txt = fit(cell.text ?? '');
      if (!txt) continue;
      const rightAlign = bold ? false : cell.num !== undefined;
      const x = rightAlign ? colX[c] + widths[c] - padH : colX[c] + padH;
      const anchor = rightAlign ? 'end' : 'start';
      out.push(
        `<text x="${x.toFixed(1)}" y="${baseline(top)}" fill="${TEXT}" text-anchor="${anchor}"` +
          `${bold ? ' font-weight="bold"' : ''}>${xmlEscape(txt)}</text>`,
      );
    }
  };

  drawRow(header.map((text) => ({ text })), titleH, true);
  for (let r = 0; r < rows.length; r++) drawRow(rows[r], bodyTop + r * rowH, false);

  // Grid lines.
  for (let i = 0; i <= rows.length + 1; i++) {
    const y = titleH + i * rowH;
    out.push(`<line x1="0" y1="${y}" x2="${totalW.toFixed(0)}" y2="${y}" stroke="${GRID}"/>`);
  }
  for (let c = 0; c <= ncol; c++) {
    const x = c < ncol ? colX[c] : totalW;
    out.push(`<line x1="${x.toFixed(1)}" y1="${titleH}" x2="${x.toFixed(1)}" y2="${totalH.toFixed(0)}" stroke="${GRID}"/>`);
  }

  out.push('</svg>');
  return out.join('\n');
}
