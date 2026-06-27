// Minimal, dependency-free .xlsx (OOXML SpreadsheetML) writer.
// Produces a real, valid workbook that opens cleanly in Excel / Numbers / Sheets —
// unlike the HTML-table ".xls" trick which Excel flags as corrupted.
//
// Implementation: a small ZIP (STORE/no-compression) container with CRC-32, and
// inline-string worksheet cells (numbers as numeric cells).

import { parseRgb } from '../core/cellStyle';

export interface SheetCell {
  text: string;
  num?: number; // when set, the cell is written as a number
  /** Computed presentation, shared by the HTML/PDF/SVG/xlsx writers so every export
   *  matches the on-screen grid (fill, text color, bold, alignment). */
  style?: { bg?: string; color?: string; bold?: boolean; align?: 'left' | 'right' | 'center' };
  /** Self-contained rich markup (data bars, status tags, …) for the HTML writer. */
  html?: string;
  /** Excel custom number-format code (e.g. `"$"#,##0.00`) for numeric cells. */
  numFmt?: string;
  /** In-cell bar (data_bar / progress) for the PDF/SVG writers to draw. */
  bar?: { pct: number; color: string; bg?: string };
}

// ---- CRC-32 ----
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const enc = new TextEncoder();

interface ZipEntry { name: string; data: Uint8Array; crc: number; offset: number; }

// Build a ZIP archive from named UTF-8 string parts (STORE method).
function zip(parts: Array<{ name: string; content: string }>): Uint8Array {
  const chunks: Uint8Array[] = [];
  const entries: ZipEntry[] = [];
  let offset = 0;

  const push = (u: Uint8Array) => { chunks.push(u); offset += u.length; };
  const u16 = (n: number) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff]);
  const u32 = (n: number) => new Uint8Array([n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]);

  for (const part of parts) {
    const data = enc.encode(part.content);
    const nameBytes = enc.encode(part.name);
    const crc = crc32(data);
    const local = offset;

    // Local file header
    push(u32(0x04034b50));
    push(u16(20));      // version needed
    push(u16(0));       // flags
    push(u16(0));       // method = store
    push(u16(0));       // mod time
    push(u16(0x21));    // mod date (1980-01-01)
    push(u32(crc));
    push(u32(data.length)); // compressed size
    push(u32(data.length)); // uncompressed size
    push(u16(nameBytes.length));
    push(u16(0));       // extra len
    push(nameBytes);
    push(data);

    entries.push({ name: part.name, data, crc, offset: local });
  }

  // Central directory
  const cdStart = offset;
  for (const e of entries) {
    const nameBytes = enc.encode(e.name);
    push(u32(0x02014b50));
    push(u16(20));      // version made by
    push(u16(20));      // version needed
    push(u16(0));       // flags
    push(u16(0));       // method
    push(u16(0));       // time
    push(u16(0x21));    // date
    push(u32(e.crc));
    push(u32(e.data.length));
    push(u32(e.data.length));
    push(u16(nameBytes.length));
    push(u16(0));       // extra
    push(u16(0));       // comment
    push(u16(0));       // disk number
    push(u16(0));       // internal attrs
    push(u32(0));       // external attrs
    push(u32(e.offset));
    push(nameBytes);
  }
  const cdSize = offset - cdStart;

  // End of central directory
  push(u32(0x06054b50));
  push(u16(0));
  push(u16(0));
  push(u16(entries.length));
  push(u16(entries.length));
  push(u32(cdSize));
  push(u32(cdStart));
  push(u16(0));

  // Concatenate
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) { out.set(c, p); p += c.length; }
  return out;
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function colRef(col: number): string {
  let s = '';
  let n = col;
  do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0);
  return s;
}

// ── Cell styles (fills / fonts / alignment) ──────────────────────────────────
// Excel stores cell formatting out-of-line: a styles.xml palette of <fonts>,
// <fills> and <cellXfs> records, with each <c> referencing an xf by index via
// `s="…"`. This registry interns the distinct styles a sheet uses and emits that
// palette so the workbook carries the same fill/color/bold/align as the grid.

/** Normalize a CSS color to Excel's 8-digit ARGB (#rrggbb / named / rgb()). */
function toArgb(c?: string): string | null {
  const rgb = parseRgb(c);
  if (!rgb) return null;
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0').toUpperCase();
  return `FF${h(rgb[0])}${h(rgb[1])}${h(rgb[2])}`;
}

const HEADER_STYLE: NonNullable<SheetCell['style']> = { bg: '#f3f4f6', bold: true };

class StyleRegistry {
  // Index 0 of fonts/fills/xfs is the default; fill index 1 is the Excel-mandated
  // gray125 placeholder. cellXfs[0] is the unstyled default.
  private fonts: string[] = ['<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>'];
  private fills: string[] = [
    '<fill><patternFill patternType="none"/></fill>',
    '<fill><patternFill patternType="gray125"/></fill>',
  ];
  private xfs: string[] = ['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'];
  private fontKey = new Map<string, number>();
  private fillKey = new Map<string, number>();
  private xfKey = new Map<string, number>();
  // Custom number formats start at id 164 (0–163 are Excel built-ins).
  private numFmts: Array<{ id: number; code: string }> = [];
  private numFmtKey = new Map<string, number>();

  private numFmtId(code?: string): number {
    if (!code) return 0; // General
    const hit = this.numFmtKey.get(code);
    if (hit !== undefined) return hit;
    const id = 164 + this.numFmts.length;
    this.numFmts.push({ id, code });
    this.numFmtKey.set(code, id);
    return id;
  }

  private fontId(colorArgb: string | null, bold: boolean): number {
    if (!colorArgb && !bold) return 0;
    const key = `${colorArgb ?? ''}|${bold ? 1 : 0}`;
    const hit = this.fontKey.get(key);
    if (hit !== undefined) return hit;
    const color = colorArgb ? `<color rgb="${colorArgb}"/>` : '<color theme="1"/>';
    this.fonts.push(`<font>${bold ? '<b/>' : ''}<sz val="11"/>${color}<name val="Calibri"/><family val="2"/></font>`);
    const id = this.fonts.length - 1;
    this.fontKey.set(key, id);
    return id;
  }

  private fillId(bgArgb: string | null): number {
    if (!bgArgb) return 0;
    const hit = this.fillKey.get(bgArgb);
    if (hit !== undefined) return hit;
    this.fills.push(`<fill><patternFill patternType="solid"><fgColor rgb="${bgArgb}"/><bgColor indexed="64"/></patternFill></fill>`);
    const id = this.fills.length - 1;
    this.fillKey.set(bgArgb, id);
    return id;
  }

  /** Intern a cell style + number format and return its cellXfs index (0 = default). */
  styleId(style?: SheetCell['style'], numFmt?: string): number {
    const fillArgb = toArgb(style?.bg);
    const colorArgb = toArgb(style?.color);
    const bold = !!style?.bold;
    const align = style?.align;
    const numId = this.numFmtId(numFmt);
    if (!fillArgb && !colorArgb && !bold && !align && numId === 0) return 0;
    const key = `${fillArgb ?? ''}/${colorArgb ?? ''}/${bold ? 1 : 0}/${align ?? ''}/${numId}`;
    const hit = this.xfKey.get(key);
    if (hit !== undefined) return hit;
    const fontId = this.fontId(colorArgb, bold);
    const fillId = this.fillId(fillArgb);
    const applyFont = fontId !== 0 ? ' applyFont="1"' : '';
    const applyFill = fillId !== 0 ? ' applyFill="1"' : '';
    const applyAlign = align ? ' applyAlignment="1"' : '';
    const applyNum = numId !== 0 ? ' applyNumberFormat="1"' : '';
    const alignXml = align ? `<alignment horizontal="${align}"/>` : '';
    this.xfs.push(`<xf numFmtId="${numId}" fontId="${fontId}" fillId="${fillId}" borderId="0" xfId="0"${applyNum}${applyFont}${applyFill}${applyAlign}>${alignXml}</xf>`);
    const id = this.xfs.length - 1;
    this.xfKey.set(key, id);
    return id;
  }

  xml(): string {
    const numFmts = this.numFmts.length
      ? `<numFmts count="${this.numFmts.length}">${this.numFmts.map((n) => `<numFmt numFmtId="${n.id}" formatCode="${xmlEscape(n.code)}"/>`).join('')}</numFmts>`
      : '';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${numFmts}<fonts count="${this.fonts.length}">${this.fonts.join('')}</fonts><fills count="${this.fills.length}">${this.fills.join('')}</fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="${this.xfs.length}">${this.xfs.join('')}</cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  }
}

function sheetXml(header: string[], rows: SheetCell[][], styles: StyleRegistry): string {
  const lines: string[] = [];
  const cellXml = (c: SheetCell, ref: string, styleId: number): string => {
    const s = styleId ? ` s="${styleId}"` : '';
    if (c.num !== undefined && Number.isFinite(c.num)) {
      return `<c r="${ref}"${s}><v>${c.num}</v></c>`;
    }
    return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(c.text ?? '')}</t></is></c>`;
  };

  const headerId = styles.styleId(HEADER_STYLE);
  lines.push(`<row r="1">${header.map((h, i) => cellXml({ text: h }, colRef(i) + '1', headerId)).join('')}</row>`);
  rows.forEach((r, ri) => {
    const rr = ri + 2;
    // Number format only applies to numeric cells; text cells ignore it.
    lines.push(`<row r="${rr}">${r.map((c, ci) => cellXml(c, colRef(ci) + rr, styles.styleId(c.style, c.num !== undefined ? c.numFmt : undefined))).join('')}</row>`);
  });

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${lines.join('')}</sheetData></worksheet>`;
}

/** Build a complete .xlsx file as bytes. */
export function buildXlsx(sheetName: string, header: string[], rows: SheetCell[][]): Uint8Array {
  const safeName = (sheetName || 'Report').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31);

  // Build the worksheet first so the style registry is fully populated before we
  // emit styles.xml.
  const styles = new StyleRegistry();
  const sheet = sheetXml(header, rows, styles);

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEscape(safeName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;

  return zip([
    { name: '[Content_Types].xml', content: contentTypes },
    { name: '_rels/.rels', content: rootRels },
    { name: 'xl/workbook.xml', content: workbook },
    { name: 'xl/_rels/workbook.xml.rels', content: workbookRels },
    { name: 'xl/worksheets/sheet1.xml', content: sheet },
    { name: 'xl/styles.xml', content: styles.xml() },
  ]);
}
