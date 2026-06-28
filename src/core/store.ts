// Columnar in-memory store (docs/Architecture.md).
// Ingests the JSON `data` array once into column-oriented arrays:
//  - numeric/date columns -> Float64Array
//  - string columns       -> dictionary (string[]) + Int32Array of codes
// This keeps memory low and makes aggregation a tight numeric loop.

import type { FieldType, Mapping, MappingEntry, Binning } from './types';

export type ColumnKind = 'number' | 'string' | 'date';

export interface Column {
  name: string;
  caption: string;
  kind: ColumnKind;
  type: FieldType;
  /** Numeric/date values (epoch ms for dates). NaN = blank. */
  numbers?: Float64Array;
  /** Dictionary codes into `dict` for string columns (-1 = blank). */
  codes?: Int32Array;
  dict?: string[];
  /** Natural member order (month/weekday/quarter) — overrides alpha/numeric sort. */
  naturalOrder?: string[];
}

export const MONTHS_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const WEEKDAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];

export interface LevelDef {
  /** Derived field key (also the displayed caption). */
  key: string;
  level: string;
  fn: (d: Date) => string;
  order?: string[];
}

/**
 * Ordered derived levels for a multilevel date type, or null if not multilevel.
 * Keys are human-readable (e.g. "Order Date (Month)") so captions need no mapping.
 */
export function dateLevelDefs(field: string, type: FieldType | undefined, caption: string): LevelDef[] | null {
  const year: LevelDef = { key: `${caption} (Year)`, level: 'Year', fn: (d) => String(d.getFullYear()) };
  const quarter: LevelDef = { key: `${caption} (Quarter)`, level: 'Quarter', fn: (d) => QUARTERS[Math.floor(d.getMonth() / 3)], order: QUARTERS };
  const month: LevelDef = { key: `${caption} (Month)`, level: 'Month', fn: (d) => MONTHS_FULL[d.getMonth()], order: MONTHS_FULL };
  const day: LevelDef = { key: `${caption} (Day)`, level: 'Day', fn: (d) => String(d.getDate()) };
  if (type === 'year/month/day') return [year, month, day];
  if (type === 'year/quarter/month/day') return [year, quarter, month, day];
  return null;
}

/** Expand a hierarchy field into its ordered level field keys (or [field]). */
export function expandHierarchyFields(field: string, type: FieldType | undefined, caption: string): string[] {
  const defs = dateLevelDefs(field, type, caption);
  return defs ? defs.map((d) => d.key) : [field];
}

export interface ColumnStore {
  rowCount: number;
  columns: Map<string, Column>;
  order: string[];
  /** Raw object rows kept for export / drill-through / getData. */
  rawRows: Array<Record<string, unknown>>;
}

const BLANK_CODE = -1;

function isMetaObject(row: unknown): row is Mapping {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
  // A metadata object's values are themselves objects describing fields.
  const vals = Object.values(row as Record<string, unknown>);
  return vals.length > 0 && vals.every((v) => v && typeof v === 'object' && !Array.isArray(v));
}

function detectKind(type: FieldType | undefined, sampleValues: unknown[]): { kind: ColumnKind; type: FieldType } {
  if (type) {
    if (type === 'number') return { kind: 'number', type };
    if (type === 'date' || type === 'date string' || type === 'datetime' || type === 'time') {
      return { kind: 'date', type };
    }
    return { kind: 'string', type };
  }
  // Auto-detect from the first non-null value.
  for (const v of sampleValues) {
    if (v === null || v === undefined || v === '') continue;
    if (typeof v === 'number') return { kind: 'number', type: 'number' };
    if (v instanceof Date) return { kind: 'date', type: 'date' };
    if (typeof v === 'string') {
      const n = Number(v);
      if (v.trim() !== '' && !Number.isNaN(n)) return { kind: 'number', type: 'number' };
    }
    return { kind: 'string', type: 'string' };
  }
  return { kind: 'string', type: 'string' };
}

function toNumber(v: unknown): number {
  if (v === null || v === undefined || v === '') return NaN;
  if (typeof v === 'number') return v;
  const n = Number(v);
  return Number.isNaN(n) ? NaN : n;
}

function toEpoch(v: unknown): number {
  if (v === null || v === undefined || v === '') return NaN;
  if (v instanceof Date) return v.getTime();
  if (typeof v === 'number') return v;
  const t = Date.parse(String(v));
  return Number.isNaN(t) ? NaN : t;
}

/**
 * Build a ColumnStore from a JSON data array (array-of-objects), an optional
 * leading metadata object, and/or an explicit dataSource.mapping.
 */
export function buildStore(
  data: Array<Record<string, unknown>> | unknown[][] | undefined,
  mapping?: Mapping,
): ColumnStore {
  const rows: Array<Record<string, unknown>> = [];
  let meta: Mapping = mapping ? { ...mapping } : {};

  if (Array.isArray(data) && data.length > 0) {
    if (Array.isArray(data[0])) {
      // array-of-arrays: first subarray = field names.
      const header = data[0] as unknown[];
      for (let i = 1; i < data.length; i++) {
        const arr = data[i] as unknown[];
        const obj: Record<string, unknown> = {};
        header.forEach((h, j) => (obj[String(h)] = arr[j]));
        rows.push(obj);
      }
    } else {
      const start = isMetaObject(data[0]) ? 1 : 0;
      if (start === 1) meta = { ...(data[0] as Mapping), ...meta };
      for (let i = start; i < data.length; i++) rows.push(data[i] as Record<string, unknown>);
    }
  }

  // Derive multilevel date hierarchies + record natural orders. Derived levels are
  // injected as real string fields on each row so every feature (aggregation,
  // drill-through, filtering, members) treats them uniformly.
  const naturalOrders = new Map<string, string[]>();
  for (const [field, entry] of Object.entries(meta)) {
    if (entry.type === 'month') naturalOrders.set(field, MONTHS_FULL);
    else if (entry.type === 'weekday') naturalOrders.set(field, WEEKDAYS_FULL);
    const defs = dateLevelDefs(field, entry.type, entry.caption ?? field);
    if (!defs) continue;
    for (const r of rows) {
      const epoch = toEpoch(r[field]);
      if (Number.isNaN(epoch)) continue;
      const d = new Date(epoch);
      for (const def of defs) r[def.key] = def.fn(d);
    }
    for (const def of defs) {
      meta[def.key] = { type: 'string', caption: def.key };
      if (def.order) naturalOrders.set(def.key, def.order);
    }
  }

  // Collect the full set of field names (mapping order first, then discovered).
  const fields: string[] = [];
  const seen = new Set<string>();
  for (const k of Object.keys(meta)) {
    if (!seen.has(k)) { seen.add(k); fields.push(k); }
  }
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (!seen.has(k)) { seen.add(k); fields.push(k); }
    }
  }

  const columns = new Map<string, Column>();
  const order: string[] = [];
  const rowCount = rows.length;

  for (const name of fields) {
    const entry: MappingEntry = meta[name] ?? {};
    if (entry.type === 'hidden' || entry.visible === false) {
      // still ingest (host may reference it), but it is non-visible by default
    }
    const sample = rows.slice(0, 50).map((r) => r[name]);
    const { kind, type } = detectKind(entry.type, sample);
    const caption = entry.caption ?? name;
    const col: Column = { name, caption, kind, type };
    const natural = naturalOrders.get(name);
    if (natural) col.naturalOrder = natural;

    if (kind === 'number' || kind === 'date') {
      const nums = new Float64Array(rowCount);
      for (let i = 0; i < rowCount; i++) {
        nums[i] = kind === 'date' ? toEpoch(rows[i][name]) : toNumber(rows[i][name]);
      }
      col.numbers = nums;
    } else {
      const dict: string[] = [];
      const dictIndex = new Map<string, number>();
      const codes = new Int32Array(rowCount);
      for (let i = 0; i < rowCount; i++) {
        const raw = rows[i][name];
        if (raw === null || raw === undefined || raw === '') {
          codes[i] = BLANK_CODE;
          continue;
        }
        const s = String(raw);
        let code = dictIndex.get(s);
        if (code === undefined) {
          code = dict.length;
          dict.push(s);
          dictIndex.set(s, code);
        }
        codes[i] = code;
      }
      col.dict = dict;
      col.codes = codes;
    }

    columns.set(name, col);
    order.push(name);
  }

  return { rowCount, columns, order, rawRows: rows };
}

/** Display string for a cell value of a column at a given row. */
export function displayValue(store: ColumnStore, field: string, row: number, datePattern?: string): string {
  const col = store.columns.get(field);
  if (!col) return '';
  if (col.kind === 'string') {
    const code = col.codes![row];
    return code === BLANK_CODE ? '' : col.dict![code];
  }
  const n = col.numbers![row];
  if (Number.isNaN(n)) return '';
  if (col.kind === 'date') return formatEpoch(n, datePattern ?? 'dd/MM/yyyy');
  return String(n);
}

// ---------------------------------------------------------------------------
// Numeric binning — derive a categorical (string) column of range labels so the
// whole pipeline (grouping keys, axis tree, filters) treats a binned numeric
// field as a dimension, with bins ordered numerically via `naturalOrder`.

/** Trim float noise from a bin boundary for a clean label. */
function binNum(n: number): string {
  return String(Number(n.toFixed(10)));
}

/** Range label for a value under a binning spec. */
export function binLabel(value: number, binning: Binning): string {
  const breaks = binning.breaks && binning.breaks.length ? [...binning.breaks].sort((a, b) => a - b) : null;
  if (breaks) {
    const last = breaks[breaks.length - 1];
    if (value >= last) return `${binNum(last)}+`;
    let k = 0;
    while (k + 1 < breaks.length && breaks[k + 1] <= value) k++;
    return `${binNum(breaks[k])} - ${binNum(breaks[k + 1])}`;
  }
  const size = binning.interval && binning.interval > 0 ? binning.interval : 1;
  const lo = Math.floor(value / size) * size;
  return `${binNum(lo)} - ${binNum(lo + size)}`;
}

/** Sort key for a bin label (its lower bound). */
function binSortKey(label: string): number {
  const n = parseFloat(label);
  return Number.isNaN(n) ? Infinity : n;
}

/** Build a string column of range labels from a numeric column. */
function binnedColumn(col: Column, binning: Binning): Column {
  const nums = col.numbers!;
  const dict: string[] = [];
  const index = new Map<string, number>();
  const codes = new Int32Array(nums.length);
  for (let i = 0; i < nums.length; i++) {
    const v = nums[i];
    if (Number.isNaN(v)) { codes[i] = BLANK_CODE; continue; }
    const label = binLabel(v, binning);
    let c = index.get(label);
    if (c === undefined) { c = dict.length; dict.push(label); index.set(label, c); }
    codes[i] = c;
  }
  const naturalOrder = [...dict].sort((a, b) => binSortKey(a) - binSortKey(b));
  return { name: col.name, caption: col.caption, kind: 'string', type: 'string', codes, dict, naturalOrder };
}

/** Return a store where the given numeric fields are replaced by binned (range)
 *  string columns. The original store is untouched (columns map is cloned). */
export function applyBinning(store: ColumnStore, bins: Map<string, Binning>): ColumnStore {
  if (!bins.size) return store;
  const columns = new Map(store.columns);
  let changed = false;
  for (const [field, binning] of bins) {
    const col = columns.get(field);
    if (col && col.kind === 'number') { columns.set(field, binnedColumn(col, binning)); changed = true; }
  }
  return changed ? { ...store, columns } : store;
}

/** Raw numeric value (for numeric aggregation). */
export function numericValue(store: ColumnStore, field: string, row: number): number {
  const col = store.columns.get(field);
  if (!col) return NaN;
  if (col.kind === 'string') return NaN;
  return col.numbers![row];
}

/** Raw value usable by count/distinctcount (string code or number). */
export function rawKey(store: ColumnStore, field: string, row: number): string | number | null {
  const col = store.columns.get(field);
  if (!col) return null;
  if (col.kind === 'string') {
    const code = col.codes![row];
    return code === BLANK_CODE ? null : code;
  }
  const n = col.numbers![row];
  return Number.isNaN(n) ? null : n;
}

// Minimal date formatter shared with format.ts token set.
export function formatEpoch(epoch: number, pattern: string): string {
  const d = new Date(epoch);
  const pad = (n: number, l = 2) => String(n).padStart(l, '0');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const monthsFull = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const daysFull = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const h12 = d.getHours() % 12 || 12;
  const tokens: Array<[RegExp, string]> = [
    [/yyyy/g, String(d.getFullYear())],
    [/yy/g, pad(d.getFullYear() % 100)],
    [/MMMM/g, monthsFull[d.getMonth()]],
    [/MMM/g, months[d.getMonth()]],
    [/MM/g, pad(d.getMonth() + 1)],
    [/dddd/g, daysFull[d.getDay()]],
    [/ddd/g, days[d.getDay()]],
    [/dd/g, pad(d.getDate())],
    [/HH/g, pad(d.getHours())],
    [/hh/g, pad(h12)],
    [/mm/g, pad(d.getMinutes())],
    [/ss/g, pad(d.getSeconds())],
    [/TT/g, d.getHours() < 12 ? 'AM' : 'PM'],
    [/tt/g, d.getHours() < 12 ? 'am' : 'pm'],
  ];
  // Replace multi-char tokens first; single-char fallbacks afterward.
  let out = pattern.replace(/^UTC:/, '');
  for (const [re, val] of tokens) out = out.replace(re, val);
  out = out
    .replace(/\bM\b/g, String(d.getMonth() + 1))
    .replace(/\bd\b/g, String(d.getDate()))
    .replace(/\bH\b/g, String(d.getHours()))
    .replace(/\bh\b/g, String(h12))
    .replace(/\bm\b/g, String(d.getMinutes()))
    .replace(/\bs\b/g, String(d.getSeconds()));
  return out;
}
