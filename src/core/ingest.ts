// Schema inference + flexible ingestion (docs/Architecture.md).
//
// Turns a *raw* dataset — CSV text, JSON text, or an array of row objects with
// NO predefined mapping — into a ProPivot Report. It scans the values, infers a
// column list with field types (number / drillable date / text), coerces numeric
// strings ("$1,200", "42%") to real numbers, and assembles a starter slice so a
// user can immediately drag fields to pivot.
//
// This is the library home for the logic the "load your own data" demo used to
// carry inline. Exposed on the facade as `ProPivot.inferReport` (pure) and
// `pivot.loadData` (parse + render).

import type { Mapping, FieldType, Report } from './types';
import { parseCsv, type CsvOptions } from './csv';

export interface InferOptions extends CsvOptions {
  /** Max rows scanned per column when guessing types (default 500). */
  sampleSize?: number;
  /**
   * Map all-ISO-date columns to a drillable Year/Month/Day hierarchy (default
   * true). When false they stay a flat `date`.
   */
  dateHierarchy?: boolean;
  /** Rewrite numeric strings to real numbers in-place (default true). */
  coerce?: boolean;
  /**
   * Seed field types/captions. Inference only fills columns left untyped here,
   * so an explicit `{ price: { type: 'number' } }` always wins over the guess.
   */
  mapping?: Mapping;
}

// ISO date with an optional time component, and the date-only subset.
const ISO_DATE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/;
const ISO_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
// Loose number: optional sign / currency / thousands separators / percent.
const NUMERIC = /^-?\s*\$?\s*[\d,]*\.?\d+%?$/;

/** Parse a loose numeric string ("$1,234.50", "42%", "1 200") to a number, or null. */
export function parseNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[$,%\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** Infer a single column's field type from a sample of its values. */
function inferType(values: unknown[], sampleSize: number, dateHierarchy: boolean): FieldType {
  let nNum = 0;
  let nDate = 0;
  let nDateTime = 0;
  let nNonEmpty = 0;
  const limit = Math.min(values.length, sampleSize);
  for (let i = 0; i < limit; i++) {
    const v = values[i];
    if (v === null || v === undefined || v === '') continue;
    nNonEmpty++;
    if (v instanceof Date) { nDate++; continue; }
    const s = String(v).trim();
    if (ISO_DATE.test(s)) {
      nDate++;
      if (!ISO_DATE_ONLY.test(s)) nDateTime++;
    } else if (NUMERIC.test(s) && parseNumber(s) !== null) {
      nNum++;
    } else if (typeof v === 'number' && Number.isFinite(v)) {
      nNum++;
    }
  }
  if (nNonEmpty === 0) return 'string';
  if (nDate === nNonEmpty) return nDateTime > 0 ? 'datetime' : dateHierarchy ? 'year/month/day' : 'date';
  if (nNum === nNonEmpty) return 'number';
  return 'string';
}

/** The ordered column list for a dataset (first row's keys, then any extra mapping keys). */
function columnsOf(data: Array<Record<string, unknown>>, base: Mapping): string[] {
  const cols: string[] = [];
  const seen = new Set<string>();
  const add = (k: string) => { if (!seen.has(k)) { seen.add(k); cols.push(k); } };
  for (const row of data) {
    if (row && typeof row === 'object') { for (const k of Object.keys(row)) add(k); break; }
  }
  for (const k of Object.keys(base)) add(k);
  return cols;
}

/**
 * Build a field `mapping` by inferring each column's type from its values.
 * Columns already typed in `opts.mapping` are kept verbatim.
 */
export function inferMapping(data: Array<Record<string, unknown>>, opts: InferOptions = {}): Mapping {
  if (!Array.isArray(data)) throw new TypeError('inferMapping: expected an array of row objects.');
  const base = opts.mapping ?? {};
  const sampleSize = opts.sampleSize ?? 500;
  const dateHierarchy = opts.dateHierarchy !== false;
  const mapping: Mapping = {};
  for (const col of columnsOf(data, base)) {
    const seed = base[col];
    if (seed?.type) {
      mapping[col] = { caption: col, ...seed };
      continue;
    }
    const values = data.map((r) => (r ? r[col] : undefined));
    mapping[col] = { type: inferType(values, sampleSize, dateHierarchy), caption: seed?.caption ?? col };
  }
  return mapping;
}

/** Rewrite every `number`-typed column's values to real numbers (or null) in-place. */
export function coerceData(data: Array<Record<string, unknown>>, mapping: Mapping): void {
  const numCols = Object.keys(mapping).filter((c) => mapping[c]?.type === 'number');
  if (!numCols.length) return;
  for (const row of data) {
    if (!row || typeof row !== 'object') continue;
    for (const col of numCols) row[col] = parseNumber(row[col]);
  }
}

/** Infer the mapping for a dataset and (by default) coerce numeric strings. */
export function inferSchema(
  data: Array<Record<string, unknown>>,
  opts: InferOptions = {},
): { data: Array<Record<string, unknown>>; mapping: Mapping } {
  const mapping = inferMapping(data, opts);
  if (opts.coerce !== false) coerceData(data, mapping);
  return { data, mapping };
}

/** Coax a parsed JSON value into an array of row objects (accepts `{data|rows|records:[...]}`). */
function asRows(parsed: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(parsed)) return parsed as Array<Record<string, unknown>>;
  if (parsed && typeof parsed === 'object') {
    const o = parsed as Record<string, unknown>;
    for (const key of ['data', 'rows', 'records']) {
      if (Array.isArray(o[key])) return o[key] as Array<Record<string, unknown>>;
    }
  }
  throw new Error('Expected a JSON array of row objects (or an object with a "data"/"rows" array).');
}

/**
 * Parse a raw dataset and infer its schema. `input` may be:
 *  - a CSV string (auto-detected separator; header type-prefixes respected),
 *  - a JSON string (array of objects, or `{ data: [...] }`),
 *  - an already-parsed array of row objects.
 * Returns coerced `data` plus the inferred `mapping`. Throws a descriptive error
 * for empty / malformed input.
 */
export function parseDataset(
  input: string | Array<Record<string, unknown>> | unknown[],
  opts: InferOptions = {},
): { data: Array<Record<string, unknown>>; mapping: Mapping } {
  let data: Array<Record<string, unknown>>;
  let seedMapping = opts.mapping;

  if (typeof input === 'string') {
    const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input; // strip UTF-8 BOM
    const trimmed = text.trim();
    if (!trimmed) throw new Error('The data is empty.');
    if (trimmed[0] === '[' || trimmed[0] === '{') {
      let parsed: unknown;
      try { parsed = JSON.parse(trimmed); } catch (e) {
        throw new Error('Could not parse JSON: ' + (e instanceof Error ? e.message : String(e)));
      }
      data = asRows(parsed);
    } else {
      // CSV: lean on the library parser (separator + header type-prefixes), then
      // let value-inference upgrade any columns the header left untyped.
      const parsed = parseCsv(text, opts);
      data = parsed.data;
      seedMapping = { ...parsed.mapping, ...(opts.mapping ?? {}) };
    }
  } else if (Array.isArray(input)) {
    data = input as Array<Record<string, unknown>>;
  } else {
    throw new TypeError('parseDataset: input must be a CSV/JSON string or an array of row objects.');
  }

  if (!data.length) throw new Error('No rows found in the data.');
  if (typeof data[0] !== 'object' || data[0] === null) throw new Error('Expected an array of row objects.');

  return inferSchema(data, { ...opts, mapping: seedMapping });
}

export interface StarterReportOptions {
  /** Override the starter slice instead of the auto-picked rows/measure. */
  slice?: Report['slice'];
}

/**
 * Heuristic: a numeric column whose sampled values are all whole numbers in a
 * plausible calendar-year range. Such columns (Year, FiscalYear) read as
 * dimensions, so they make poor default *measures* — summing years is useless.
 */
function looksLikeYear(values: unknown[]): boolean {
  let seen = 0;
  for (let i = 0; i < Math.min(values.length, 200); i++) {
    const n = parseNumber(values[i]);
    if (n === null) continue;
    seen++;
    if (!Number.isInteger(n) || n < 1900 || n > 2100) return false;
  }
  return seen > 0;
}

/**
 * Assemble a sensible starter Report from data + an inferred mapping: the first
 * text/date field goes to Rows, the first numeric field becomes a summed Measure,
 * and Columns is left empty for the user to fill by dragging.
 */
export function buildStarterReport(
  data: Array<Record<string, unknown>>,
  mapping: Mapping,
  opts: StarterReportOptions = {},
): Report {
  const cols = Object.keys(mapping);
  const isNumber = (c: string) => mapping[c]?.type === 'number';
  const valuesOf = (c: string) => data.map((r) => (r ? r[c] : undefined));
  const numericCols = cols.filter(isNumber);
  // Prefer a "real" metric over a year-like integer column for the default measure.
  const firstNum = numericCols.find((c) => !looksLikeYear(valuesOf(c))) ?? numericCols[0];
  // Prefer a plain string field for rows; else the first non-numeric field.
  const firstDim = cols.find((c) => mapping[c]?.type === 'string') ?? cols.find((c) => !isNumber(c));

  const slice: NonNullable<Report['slice']> = opts.slice ?? {
    rows: firstDim ? [{ uniqueName: firstDim, caption: mapping[firstDim]?.caption ?? firstDim }] : [],
    columns: [],
    measures: firstNum
      ? [{ uniqueName: firstNum, caption: mapping[firstNum]?.caption ?? firstNum, aggregation: 'sum', active: true }]
      : [],
  };

  return {
    dataSource: { type: 'json', data, mapping },
    slice,
    options: { grid: { type: 'compact', showGrandTotals: 'on' } },
  };
}
