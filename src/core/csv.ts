// CSV ingestion (docs/Architecture.md). Parses delimited text into the same
// array-of-objects shape the columnar store consumes, deriving a field mapping
// from optional type prefixes.

import type { Mapping, FieldType } from './types';

export interface CsvOptions {
  fieldSeparator?: string;
  ignoreQuotedLineBreaks?: boolean;
  recordsetDelimiter?: string;
}

// CSV header type prefixes -> field type.
const PREFIXES: Array<[string, FieldType]> = [
  ['D4+', 'year/quarter/month/day'],
  ['D+', 'year/month/day'],
  ['ds+', 'date string'],
  ['dt+', 'datetime'],
  ['d+', 'date'],
  ['t+', 'time'],
  ['m+', 'month'],
  ['w+', 'weekday'],
  ['-', 'number'],
  ['+', 'string'],
];

function detectSeparator(firstLine: string): string {
  const candidates = [',', ';', '\t', '|'];
  let best = ',';
  let bestCount = -1;
  for (const c of candidates) {
    const count = firstLine.split(c).length;
    if (count > bestCount) { bestCount = count; best = c; }
  }
  return best;
}

/** Tokenize one delimited document into a matrix of string cells. */
function tokenize(text: string, sep: string): string[][] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  let i = 0;
  const n = text.length;

  const pushField = () => { row.push(field); field = ''; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };

  while (i < n) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === sep) { pushField(); i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { pushRow(); i++; continue; }
    field += ch; i++;
  }
  // trailing field/row
  if (field.length > 0 || row.length > 0) pushRow();
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ''));
}

function splitHeader(raw: string): { name: string; type?: FieldType } {
  for (const [prefix, type] of PREFIXES) {
    if (raw.startsWith(prefix)) return { name: raw.slice(prefix.length).trim(), type };
  }
  return { name: raw.trim() };
}

export function parseCsv(text: string, opts: CsvOptions = {}): { data: Array<Record<string, unknown>>; mapping: Mapping } {
  const firstNewline = text.indexOf('\n');
  const firstLine = firstNewline >= 0 ? text.slice(0, firstNewline) : text;
  const sep = opts.fieldSeparator ?? detectSeparator(firstLine);

  const matrix = tokenize(text, sep);
  if (!matrix.length) return { data: [], mapping: {} };

  const headerRow = matrix[0];
  const fields: string[] = [];
  const mapping: Mapping = {};
  for (const raw of headerRow) {
    const { name, type } = splitHeader(raw);
    fields.push(name);
    mapping[name] = type ? { type, caption: name } : { caption: name };
  }

  const data: Array<Record<string, unknown>> = [];
  for (let r = 1; r < matrix.length; r++) {
    const cells = matrix[r];
    const obj: Record<string, unknown> = {};
    for (let c = 0; c < fields.length; c++) {
      const m = mapping[fields[c]];
      const raw = cells[c] ?? '';
      obj[fields[c]] = m?.type === 'number' ? (raw === '' ? null : Number(raw)) : raw;
    }
    data.push(obj);
  }
  return { data, mapping };
}
