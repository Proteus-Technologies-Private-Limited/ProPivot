// Minimal, dependency-free .xlsx (OOXML SpreadsheetML) writer.
// Produces a real, valid workbook that opens cleanly in Excel / Numbers / Sheets —
// unlike the HTML-table ".xls" trick which Excel flags as corrupted.
//
// Implementation: a small ZIP (STORE/no-compression) container with CRC-32, and
// inline-string worksheet cells (numbers as numeric cells).

export interface SheetCell {
  text: string;
  num?: number; // when set, the cell is written as a number
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

function sheetXml(header: string[], rows: SheetCell[][]): string {
  const lines: string[] = [];
  const cellXml = (c: SheetCell, ref: string): string => {
    if (c.num !== undefined && Number.isFinite(c.num)) {
      return `<c r="${ref}"><v>${c.num}</v></c>`;
    }
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(c.text ?? '')}</t></is></c>`;
  };

  lines.push(`<row r="1">${header.map((h, i) => cellXml({ text: h }, colRef(i) + '1')).join('')}</row>`);
  rows.forEach((r, ri) => {
    const rr = ri + 2;
    lines.push(`<row r="${rr}">${r.map((c, ci) => cellXml(c, colRef(ci) + rr)).join('')}</row>`);
  });

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${lines.join('')}</sheetData></worksheet>`;
}

/** Build a complete .xlsx file as bytes. */
export function buildXlsx(sheetName: string, header: string[], rows: SheetCell[][]): Uint8Array {
  const safeName = (sheetName || 'Report').replace(/[\\/?*[\]:]/g, ' ').slice(0, 31);

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEscape(safeName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`;

  return zip([
    { name: '[Content_Types].xml', content: contentTypes },
    { name: '_rels/.rels', content: rootRels },
    { name: 'xl/workbook.xml', content: workbook },
    { name: 'xl/_rels/workbook.xml.rels', content: workbookRels },
    { name: 'xl/worksheets/sheet1.xml', content: sheetXml(header, rows) },
  ]);
}
