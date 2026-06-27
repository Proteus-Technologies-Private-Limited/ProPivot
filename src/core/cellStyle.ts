// Cell presentation — the single source of truth for how a cell *looks*, shared
// by the DOM grid renderer (src/grid/renderer.ts) and the export writers
// (src/export/*). Pure & DOM-free so it stays structured-clone/Worker-safe and
// deterministic for the golden tests.
//
// `formatVisual` takes a value + its base (number-formatted) text + an optional
// `DisplayFormat` and returns a dual descriptor: a plain `text` (for csv / pdf
// text / fallback), an optional self-styled `html` fragment for the DOM grid,
// and structured `color`/`bg`/`bold`/`align`/`bar` fields the dependency-free
// PDF/SVG writers draw from. The display-format catalog is ported verbatim from
// the twasta.ai transaction list-table (packages/page-runtime/src/txn/displayFormat.tsx).
//
// `evalConditionStyle` lifts the per-cell conditional-formatting loop so the
// renderer and the exporters apply identical rules. `formatsForType` gates which
// display formats are offered for a column given its data type.

import type {
  DisplayFormat, DisplayFormatType, DisplayMapEntry, FieldType,
  ConditionFormatStyle,
} from './types';
import type { CompiledCondition } from './conditions';

// ── The dual descriptor ──────────────────────────────────────────────────────

export interface VisualBar {
  /** Fill fraction 0..1. */
  pct: number;
  color: string;
  bg?: string;
}

export interface VisualCell {
  /** Plain text (csv / pdf text / tooltip / fallback). */
  text: string;
  /** Self-contained DOM markup. `undefined` ⇒ no display format active (caller
   *  keeps its existing base-text behaviour, so default snapshots are unchanged). */
  html?: string;
  /** When true, `html` already paints its own colors — the DOM must NOT also
   *  apply `color`/`bg`/`bold` to the cell (PDF still uses them). */
  rich?: boolean;
  color?: string;
  bg?: string;
  bold?: boolean;
  align?: 'left' | 'right' | 'center';
  /** In-cell bar (data_bar / progress) for the PDF/SVG writers to draw. */
  bar?: VisualBar;
}

export interface CellStyleInput {
  /** Numeric value (NaN/undefined for blanks / non-numeric members). */
  value: number | undefined;
  /** Raw value (the member string for headers, the number for value cells). */
  raw?: unknown;
  /** Base display text (already number-formatted, or the member label). */
  baseText: string;
  display?: DisplayFormat;
  fieldType?: FieldType;
  isTotal?: boolean;
  isGrand?: boolean;
  /** Min/max across the column, used to auto-scale data_bar/progress/heatmap. */
  columnStats?: { min: number; max: number };
  /** Current time (ms) for relative_time / countdown; omit for determinism. */
  now?: number;
}

// ── Colors (concrete hex so the PDF writer can parse every default) ──────────

const ACCENT = '#2563eb';
const MUTED = '#6b7280';
const TEXT = '#111827';
const TRACK = '#e5e7eb';

const NAMED_COLORS: Record<string, string> = {
  green: '#16a34a', red: '#dc2626', yellow: '#eab308', amber: '#f59e0b',
  orange: '#ea580c', blue: '#2563eb', grey: '#9ca3af', gray: '#9ca3af',
  purple: '#7c3aed', pink: '#ec4899', teal: '#14b8a6', cyan: '#06b6d4',
  black: '#111827', white: '#ffffff',
};

function resolveColor(c?: string | null): string {
  if (!c) return MUTED;
  const key = String(c).trim().toLowerCase();
  return NAMED_COLORS[key] || String(c).trim();
}

/** Parse '#rgb' / '#rrggbb' / 'rgb(r,g,b)' / a named color to [r,g,b]. */
export function parseRgb(c?: string | null): [number, number, number] | null {
  if (!c) return null;
  let s = String(c).trim().toLowerCase();
  if (NAMED_COLORS[s]) s = NAMED_COLORS[s];
  const m3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s);
  if (m3) return [parseInt(m3[1] + m3[1], 16), parseInt(m3[2] + m3[2], 16), parseInt(m3[3] + m3[3], 16)];
  const m6 = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(s);
  if (m6) return [parseInt(m6[1], 16), parseInt(m6[2], 16), parseInt(m6[3], 16)];
  const mr = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(s);
  if (mr) return [+mr[1], +mr[2], +mr[3]];
  return null;
}

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** Blend a color toward white (deterministic; matches DOM and PDF exactly). */
function softHex(color: string, amount = 0.16): string {
  const rgb = parseRgb(color);
  if (!rgb) return '#f1f5f9';
  return rgbToHex(rgb[0] + (255 - rgb[0]) * (1 - amount), rgb[1] + (255 - rgb[1]) * (1 - amount), rgb[2] + (255 - rgb[2]) * (1 - amount));
}

function lerpColor(a: string, b: string, t: number): string {
  const pa = parseRgb(a), pb = parseRgb(b);
  if (!pa || !pb) return a;
  return rgbToHex(pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t, pa[2] + (pb[2] - pa[2]) * t);
}

// ── HTML helpers ─────────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function span(style: string, inner: string, title?: string): string {
  return `<span${title ? ` title="${esc(title)}"` : ''} style="${style}">${inner}</span>`;
}

// ── Value helpers ────────────────────────────────────────────────────────────

function toNum(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[, ]/g, ''));
  return Number.isFinite(n) ? n : null;
}
function clamp01(n: number): number { return n < 0 ? 0 : n > 1 ? 1 : n; }

const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function parseDate(v: unknown): Date | null {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatDateValue(v: unknown, pattern?: string | null): string {
  const d = parseDate(v);
  if (!d) return v == null ? '' : String(v);
  const pat = pattern && String(pattern).trim() ? String(pattern) : 'dd-MMM-yyyy';
  const pad = (n: number) => String(n).padStart(2, '0');
  const h12 = d.getHours() % 12 || 12;
  const tokens: Record<string, string> = {
    yyyy: String(d.getFullYear()), yy: String(d.getFullYear()).slice(-2),
    MMMM: MONTHS_LONG[d.getMonth()], MMM: MONTHS_SHORT[d.getMonth()],
    MM: pad(d.getMonth() + 1), M: String(d.getMonth() + 1),
    dd: pad(d.getDate()), d: String(d.getDate()),
    EEEE: DAYS_LONG[d.getDay()], EEE: DAYS_SHORT[d.getDay()],
    HH: pad(d.getHours()), H: String(d.getHours()),
    hh: pad(h12), h: String(h12),
    mm: pad(d.getMinutes()), ss: pad(d.getSeconds()),
    a: d.getHours() < 12 ? 'AM' : 'PM',
  };
  return pat.replace(/yyyy|yy|MMMM|MMM|MM|M|dd|d|EEEE|EEE|HH|H|hh|h|mm|ss|a/g, (t) => tokens[t] ?? t);
}

export function formatNumberValue(v: unknown, fmt: DisplayFormat): string {
  const n = toNum(v);
  if (n == null) return v == null ? '' : String(v);
  const style = fmt.numberStyle || 'decimal';
  const locale = fmt.locale || undefined;
  const opts: Intl.NumberFormatOptions = {};
  if (fmt.decimals != null) { opts.minimumFractionDigits = fmt.decimals; opts.maximumFractionDigits = fmt.decimals; }
  else opts.maximumFractionDigits = 4;
  let body: string;
  try {
    switch (style) {
      case 'currency':
        body = n.toLocaleString(locale, { ...opts, style: 'currency', currency: fmt.currency || 'USD' }); break;
      case 'accounting':
        body = n.toLocaleString(locale, { ...opts, style: 'currency', currency: fmt.currency || 'USD', currencySign: 'accounting' }); break;
      case 'percent':
        body = n.toLocaleString(locale, { ...opts, style: 'percent' }); break;
      case 'scientific':
        body = n.toExponential(fmt.decimals ?? 2); break;
      case 'compact':
        body = n.toLocaleString(locale, { ...opts, notation: 'compact', compactDisplay: 'short' }); break;
      default:
        body = n.toLocaleString(locale, opts);
    }
  } catch {
    body = n.toLocaleString(undefined, opts);
  }
  return `${fmt.prefix || ''}${body}${fmt.suffix || ''}`;
}

// Currency symbols for the Excel writer (deterministic — no Intl/locale variance).
const EXCEL_CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$', EUR: '€', GBP: '£', JPY: '¥', CNY: '¥', INR: '₹', KRW: '₩', RUB: '₽',
  BRL: 'R$', ZAR: 'R', AUD: 'A$', CAD: 'C$', NZD: 'NZ$', HKD: 'HK$', SGD: 'S$',
  CHF: 'CHF', SEK: 'kr', NOK: 'kr', DKK: 'kr', PLN: 'zł', THB: '฿', TRY: '₺',
  MXN: '$', IDR: 'Rp', MYR: 'RM', PHP: '₱', VND: '₫', ILS: '₪', AED: 'AED',
};
function excelCurrencySymbol(code?: string): string {
  const c = (code || 'USD').trim().toUpperCase();
  return EXCEL_CURRENCY_SYMBOLS[c] || c;
}

/**
 * Excel custom number-format code mirroring `formatNumberValue` for a numeric
 * DisplayFormat, or `null` when the format has no faithful Excel equivalent
 * (e.g. `compact`). Lets the .xlsx writer keep cells numeric while showing the
 * same currency / percent / decimals as the grid.
 */
export function excelDisplayFormatCode(fmt: DisplayFormat): string | null {
  const dp = fmt.decimals;
  const grp = '#,##0';
  const fixed = (n?: number, fallback = '.00') => (n != null ? (n > 0 ? '.' + '0'.repeat(n) : '') : fallback);
  const prefix = fmt.prefix ? `"${fmt.prefix.replace(/"/g, '')}"` : '';
  const suffix = fmt.suffix ? `"${fmt.suffix.replace(/"/g, '')}"` : '';
  let core: string | null;
  switch (fmt.numberStyle || 'decimal') {
    case 'currency':
    case 'accounting':
      core = `"${excelCurrencySymbol(fmt.currency)}"${grp}${fixed(dp)}`;
      break;
    case 'percent':
      core = `${grp}${fixed(dp)}%`;
      break;
    case 'scientific':
      core = `0${fixed(dp)}E+00`;
      break;
    case 'compact':
      core = null; // no faithful Excel equivalent — fall back to the base format
      break;
    default: // decimal
      core = grp + (dp != null ? fixed(dp, '') : '.####');
  }
  return core == null ? null : prefix + core + suffix;
}

function transformCase(s: string, mode: DisplayFormat['textCase']): string {
  switch (mode) {
    case 'upper': return s.toUpperCase();
    case 'lower': return s.toLowerCase();
    case 'title': return s.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
    case 'sentence': return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
    case 'camel': {
      const parts = s.split(/[\s_-]+/).filter(Boolean);
      if (!parts.length) return s;
      return parts.map((p, i) => i === 0 ? p.toLowerCase() : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join('');
    }
    default: return s;
  }
}

function maskValue(s: string, fmt: DisplayFormat): string {
  const last = fmt.maskLast ?? 4;
  const ch = fmt.maskChar || '•';
  if (s.length <= last) return s;
  return ch.repeat(Math.min(s.length - last, 8)) + s.slice(-last);
}

function applyTemplate(tpl: string, value: unknown): string {
  return tpl.replace(/\{([^}]+)\}/g, (_m, key) => {
    const k = String(key).trim();
    if (k.toLowerCase() === 'value') return value == null ? '' : String(value);
    return '';
  });
}

function matchMapEntry(value: unknown, map?: DisplayMapEntry[]): DisplayMapEntry | undefined {
  if (!map || !map.length) return undefined;
  const s = value == null ? '' : String(value).trim().toLowerCase();
  return map.find((e) => String(e.when).trim().toLowerCase() === s);
}

// Regional-indicator flag from a 2-letter ISO code (no data table needed).
function flagEmoji(iso2: string): string {
  const cc = iso2.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(cc)) return '';
  return String.fromCodePoint(...[...cc].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

function parseSeries(value: unknown): number[] {
  if (Array.isArray(value)) return value.map((v) => Number(v)).filter((n) => Number.isFinite(n));
  if (typeof value === 'string') {
    const s = value.trim();
    if (s.startsWith('[')) { try { const a = JSON.parse(s); return Array.isArray(a) ? a.map(Number).filter((n) => Number.isFinite(n)) : []; } catch { /* fallthrough */ } }
    return s.split(/[,\s]+/).map(Number).filter((n) => Number.isFinite(n));
  }
  return [];
}

function humanizeDelta(ms: number): string {
  const past = ms < 0;
  const abs = Math.abs(ms);
  const mins = Math.round(abs / 60000);
  const hours = Math.round(abs / 3600000);
  const days = Math.round(abs / 86400000);
  let body: string;
  if (mins < 1) return 'now';
  if (mins < 60) body = `${mins}m`;
  else if (hours < 24) body = `${hours}h`;
  else if (days < 30) body = `${days}d`;
  else if (days < 365) body = `${Math.round(days / 30)}mo`;
  else body = `${Math.round(days / 365)}y`;
  return past ? `${body} ago` : `in ${body}`;
}

// ── Safe expression evaluator for `background` rules (subset: value-scoped) ────

type Scalar = number | string | boolean;

function evalExpr(src: string, value: unknown): Scalar {
  const re = /\s*(>=|<=|==|!=|&&|\|\||[-+*/%()<>]|"[^"]*"|'[^']*'|[A-Za-z_][A-Za-z0-9_.]*|\d+(?:\.\d+)?)/y;
  const tokens: string[] = [];
  let pos = 0;
  while (pos < src.length) { re.lastIndex = pos; const m = re.exec(src); if (!m) break; tokens.push(m[1]); pos = re.lastIndex; }
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  const num = (v: Scalar): number => typeof v === 'number' ? v : Number(v);
  function parseOr(): Scalar { let l = parseAnd(); while (peek() === '||') { next(); l = (!!l || !!parseAnd()); } return l; }
  function parseAnd(): Scalar { let l = parseCmp(); while (peek() === '&&') { next(); l = (!!l && !!parseCmp()); } return l; }
  function parseCmp(): Scalar {
    const l = parseAdd(); const op = peek();
    if (op === '<' || op === '>' || op === '<=' || op === '>=' || op === '==' || op === '!=') {
      next(); const r = parseAdd();
      const bothNum = typeof l !== 'string' && typeof r !== 'string';
      const a = bothNum ? num(l) : String(l), b = bothNum ? num(r) : String(r);
      switch (op) { case '<': return a < b; case '>': return a > b; case '<=': return a <= b; case '>=': return a >= b; case '==': return a === b; case '!=': return a !== b; }
    }
    return l;
  }
  function parseAdd(): Scalar { let l = parseMul(); while (peek() === '+' || peek() === '-') { const o = next(); const r = parseMul(); l = o === '+' ? num(l) + num(r) : num(l) - num(r); } return l; }
  function parseMul(): Scalar { let l = parseUnary(); while (peek() === '*' || peek() === '/' || peek() === '%') { const o = next(); const a = num(l), b = num(parseUnary()); l = o === '*' ? a * b : o === '/' ? (b === 0 ? 0 : a / b) : (b === 0 ? 0 : a % b); } return l; }
  function parseUnary(): Scalar { if (peek() === '-') { next(); return -num(parseUnary()); } if (peek() === '+') { next(); return num(parseUnary()); } return parsePrimary(); }
  function parsePrimary(): Scalar {
    const t = next();
    if (t === '(') { const v = parseOr(); if (peek() === ')') next(); return v; }
    if (t == null) return 0;
    if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
    if (/^\d/.test(t)) return Number(t);
    if (t.toLowerCase() === 'value') { const n = toNum(value); return n != null ? n : (value == null ? '' : String(value)); }
    return 0;
  }
  try { return parseOr(); } catch { return false; }
}

function heatmapColor(n: number | null, fmt: DisplayFormat, stats?: { min: number; max: number }): string {
  if (n == null) return MUTED;
  const colors = (fmt.colors && fmt.colors.length ? fmt.colors : ['#16a34a', '#eab308', '#f59e0b', '#dc2626']).map(resolveColor);
  if (fmt.scale === 'gradient') {
    const min = fmt.min ?? stats?.min ?? 0, max = fmt.max ?? stats?.max ?? 100;
    return lerpColor(colors[0], colors[colors.length - 1], clamp01((n - min) / ((max - min) || 1)));
  }
  const thr = fmt.thresholds && fmt.thresholds.length ? fmt.thresholds : [25, 50, 75];
  let band = 0;
  for (let i = 0; i < thr.length; i++) if (n >= thr[i]) band = i + 1;
  return colors[Math.min(band, colors.length - 1)];
}

// ── Display-format catalog gated by data type ────────────────────────────────

const NUMERIC_FORMATS: DisplayFormatType[] = [
  'number', 'signed', 'data_bar', 'progress', 'percent_ring', 'heatmap',
  'rating', 'bullet', 'sparkline', 'background',
];
const DATE_FORMATS: DisplayFormatType[] = [
  'date', 'relative_time', 'date_range', 'countdown', 'case', 'truncate', 'template', 'background',
];
const TEXT_FORMATS: DisplayFormatType[] = [
  'status_tag', 'status_dot', 'icon_map', 'boolean', 'tags', 'avatar', 'two_line',
  'case', 'truncate', 'masked', 'template', 'background',
  'telephone', 'country', 'email', 'url', 'image', 'file', 'map', 'copy',
];

function isNumericType(t?: FieldType): boolean {
  return t === 'number' || t === undefined;
}
function isDateType(t?: FieldType): boolean {
  return t === 'date' || t === 'date string' || t === 'datetime' || t === 'time'
    || t === 'year/month/day' || t === 'year/quarter/month/day' || t === 'month' || t === 'weekday';
}

/** The display-format types offered for a column of the given data type. */
export function formatsForType(fieldType?: FieldType): DisplayFormatType[] {
  if (isNumericType(fieldType)) return ['text', ...NUMERIC_FORMATS];
  if (isDateType(fieldType)) return ['text', ...DATE_FORMATS];
  return ['text', ...TEXT_FORMATS];
}

// ── The formatter ────────────────────────────────────────────────────────────

const noDisplay = (text: string): VisualCell => ({ text });

export function formatVisual(input: CellStyleInput): VisualCell {
  const fmt = input.display;
  if (!fmt || !fmt.type || fmt.type === 'text') return noDisplay(input.baseText);

  const raw = input.raw !== undefined ? input.raw : input.value;
  const empty = raw == null || raw === '';
  const stats = input.columnStats;

  switch (fmt.type) {
    case 'number': {
      const text = formatNumberValue(raw, fmt);
      return { text, html: esc(text), align: 'right' };
    }

    case 'signed': {
      const n = toNum(raw);
      if (n == null) return { text: '', html: '' };
      const color = n > 0 ? NAMED_COLORS.green : n < 0 ? NAMED_COLORS.red : MUTED;
      const arrow = n > 0 ? '▲' : n < 0 ? '▼' : '';
      const body = formatNumberValue(Math.abs(n), fmt);
      const text = `${arrow ? arrow + ' ' : ''}${n > 0 ? '+' : n < 0 ? '−' : ''}${body}`;
      return { text, html: esc(text), color, bold: true, align: 'right' };
    }

    case 'data_bar': {
      const n = toNum(raw);
      const min = fmt.min ?? stats?.min ?? 0;
      const max = fmt.max ?? stats?.max ?? 100;
      const pct = n == null ? 0 : clamp01((n - min) / ((max - min) || 1));
      const color = resolveColor(fmt.color || ACCENT);
      const text = formatNumberValue(raw, fmt);
      const fill = softHex(color);
      const html = span(
        'position:relative;display:inline-block;min-width:70px;padding:1px 4px;width:100%;box-sizing:border-box;text-align:right',
        span(`position:absolute;inset:0;width:${(pct * 100).toFixed(1)}%;background:${fill};border-radius:3px`, '')
        + span('position:relative', esc(text)),
      );
      return { text, html, rich: true, align: 'right', bar: { pct, color: fill } };
    }

    case 'progress': {
      const n = toNum(raw);
      const min = fmt.min ?? 0;
      const max = fmt.max ?? stats?.max ?? 100;
      const pct = n == null ? 0 : clamp01((n - min) / ((max - min) || 1));
      const color = resolveColor(fmt.color || ACCENT);
      const text = `${Math.round(pct * 100)}%`;
      const html = span(
        'display:inline-flex;align-items:center;gap:6px;min-width:90px',
        span(`flex:1;height:8px;border-radius:999px;background:${TRACK};overflow:hidden;min-width:48px`,
          span(`display:block;height:100%;width:${(pct * 100).toFixed(1)}%;background:${color};border-radius:999px`, ''))
        + (fmt.showValue !== false ? span(`font-size:0.82em;color:${MUTED}`, n == null ? '' : esc(text)) : ''),
      );
      return { text: n == null ? '' : text, html, rich: true, bar: { pct, color, bg: TRACK } };
    }

    case 'percent_ring': {
      const n = toNum(raw);
      const max = fmt.max ?? 100;
      const pct = n == null ? 0 : clamp01(n / (max || 100));
      const color = resolveColor(fmt.color || ACCENT);
      const r = 9, circ = 2 * Math.PI * r;
      const text = n == null ? '' : `${Math.round(pct * 100)}%`;
      const html = span('display:inline-flex;align-items:center;gap:6px',
        `<svg width="24" height="24" viewBox="0 0 24 24" style="flex-shrink:0">`
        + `<circle cx="12" cy="12" r="${r}" fill="none" stroke="${TRACK}" stroke-width="3"/>`
        + `<circle cx="12" cy="12" r="${r}" fill="none" stroke="${color}" stroke-width="3" stroke-dasharray="${(circ * pct).toFixed(2)} ${circ.toFixed(2)}" stroke-linecap="round" transform="rotate(-90 12 12)"/>`
        + `</svg>`
        + (fmt.showValue !== false ? span('', esc(text)) : ''));
      return { text, html, rich: true, bar: { pct, color, bg: TRACK } };
    }

    case 'heatmap': {
      const n = toNum(raw);
      const color = heatmapColor(n, fmt, stats);
      const text = formatNumberValue(raw, fmt);
      if (fmt.applyTo === 'background') {
        const bg = softHex(color);
        return { text, html: span(`display:inline-block;padding:2px 8px;border-radius:4px;background:${bg};color:${TEXT}`, esc(text)), rich: true, bg, align: 'right' };
      }
      return { text, html: span(`color:${color};font-weight:600`, esc(text)), rich: true, color, bold: true, align: 'right' };
    }

    case 'rating': {
      const n = Math.round(toNum(raw) ?? 0);
      const max = fmt.max ?? 5;
      const full = fmt.icon === 'heart' ? '❤' : fmt.icon === 'circle' ? '●' : '★';
      const emptyG = fmt.icon === 'heart' ? '🤍' : fmt.icon === 'circle' ? '○' : '☆';
      const color = resolveColor(fmt.color || '#f59e0b');
      const text = Array.from({ length: max }, (_, i) => (i < n ? full : emptyG)).join('');
      return { text, html: span(`color:${color};letter-spacing:1px`, text, `${n}/${max}`), rich: true, color };
    }

    case 'sparkline': {
      const series = parseSeries(raw);
      if (!series.length) return { text: '—', html: span(`color:${MUTED}`, '—'), rich: true };
      const w = 64, h = 18, lo = Math.min(...series), hi = Math.max(...series);
      const spanV = hi - lo || 1;
      const pts = series.map((v, i) => `${((i / (series.length - 1 || 1)) * w).toFixed(1)},${(h - ((v - lo) / spanV) * h).toFixed(1)}`).join(' ');
      const html = `<svg width="${w}" height="${h}" style="vertical-align:middle"><polyline points="${pts}" fill="none" stroke="${resolveColor(fmt.color || ACCENT)}" stroke-width="1.5"/></svg>`;
      return { text: `${series[0]}…${series[series.length - 1]}`, html, rich: true };
    }

    case 'bullet': {
      const actual = toNum(raw) ?? 0;
      const target = fmt.max ?? 0;
      const scaleMax = Math.max(actual, target) * 1.1 || 1;
      const aPct = clamp01(actual / scaleMax), tPct = clamp01(target / scaleMax);
      const ok = target > 0 && actual >= target;
      const color = resolveColor(fmt.color || (ok ? NAMED_COLORS.green : ACCENT));
      const text = `${formatNumberValue(actual, fmt)} / ${formatNumberValue(target, fmt)}`;
      const html = span('display:inline-flex;flex-direction:column;gap:2px;min-width:110px',
        span(`font-size:0.78em;color:${MUTED}`, esc(text))
        + span(`position:relative;height:8px;border-radius:999px;background:${TRACK}`,
          span(`position:absolute;left:0;top:0;height:100%;width:${(aPct * 100).toFixed(1)}%;background:${color};border-radius:999px`, '')
          + span(`position:absolute;left:${(tPct * 100).toFixed(1)}%;top:-2px;height:12px;width:2px;background:${TEXT}`, '')));
      return { text, html, rich: true, bar: { pct: aPct, color, bg: TRACK } };
    }

    case 'status_tag': {
      const e = matchMapEntry(raw, fmt.map);
      const color = resolveColor(e?.color || fmt.defaultColor);
      const label = e?.label || (empty ? '' : String(raw));
      if (empty && !label) return { text: '', html: '' };
      const bg = softHex(color);
      const html = span(`display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:999px;background:${bg};color:${color};font-weight:600;font-size:0.82em`,
        (e?.icon ? span('', esc(e.icon)) : '') + esc(label));
      return { text: label, html, rich: true, bg, color };
    }

    case 'status_dot': {
      const e = matchMapEntry(raw, fmt.map);
      const color = resolveColor(e?.color || fmt.defaultColor);
      const label = e?.label || (empty ? '' : String(raw));
      const html = span('display:inline-flex;align-items:center;gap:6px',
        span(`width:10px;height:10px;border-radius:999px;background:${color};flex-shrink:0;box-shadow:0 0 0 2px ${softHex(color)}`, '')
        + (!fmt.hideValue ? span('', esc(label)) : ''), label);
      return { text: label, html, rich: true, color };
    }

    case 'icon_map': {
      const e = matchMapEntry(raw, fmt.map);
      const icon = e?.icon || fmt.defaultIcon || '';
      const label = e?.label || (empty ? '' : String(raw));
      const html = span('display:inline-flex;align-items:center;gap:6px',
        span(`color:${resolveColor(e?.color)}`, esc(icon)) + (!fmt.hideValue ? span('', esc(label)) : ''), empty ? '' : String(raw));
      return { text: `${icon} ${label}`.trim(), html, rich: true };
    }

    case 'boolean': {
      const truthy = raw === true || raw === 1 || raw === '1' || String(raw).toLowerCase() === 'true' || String(raw).toLowerCase() === 'yes';
      const e = matchMapEntry(raw, fmt.map);
      if (e) { const c = resolveColor(e.color); const t = e.icon || e.label || String(raw); return { text: t, html: span(`color:${c}`, esc(t)), rich: true, color: c }; }
      const color = truthy ? NAMED_COLORS.green : MUTED;
      const text = truthy ? '✓' : '✗';
      return { text, html: span(`color:${color};font-weight:600`, text), rich: true, color, bold: true };
    }

    case 'tags': {
      const parts = Array.isArray(raw) ? raw.map(String) : String(raw ?? '').split(/[,;]/).map((s) => s.trim()).filter(Boolean);
      if (!parts.length) return { text: '', html: '' };
      const chips = parts.map((p) => {
        const e = matchMapEntry(p, fmt.map);
        const color = resolveColor(e?.color || fmt.defaultColor || ACCENT);
        return span(`padding:1px 7px;border-radius:999px;background:${softHex(color)};color:${color};font-size:0.8em;font-weight:600`, esc(e?.label || p));
      }).join('');
      return { text: parts.join(', '), html: span('display:inline-flex;flex-wrap:wrap;gap:4px', chips), rich: true };
    }

    case 'avatar': {
      const name = String(raw ?? '').trim();
      const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase()).join('') || '?';
      let h = 0; for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
      const bg = `hsl(${h}, 55%, 45%)`;
      const html = span('display:inline-flex;align-items:center;gap:8px',
        span(`width:24px;height:24px;border-radius:999px;background:${bg};color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:0.7em;font-weight:700;flex-shrink:0`, esc(initials))
        + span('', esc(name)));
      return { text: name, html, rich: true };
    }

    case 'background': {
      let color: string | undefined;
      for (const rule of fmt.rules || []) if (evalExpr(rule.when, raw)) { color = resolveColor(rule.color); break; }
      if (!color && fmt.defaultColor) color = resolveColor(fmt.defaultColor);
      const text = empty ? '' : String(raw);
      if (!color) return { text, html: esc(text) };
      const bg = softHex(color);
      return { text, html: span(`display:inline-block;padding:2px 8px;border-radius:4px;background:${bg};color:${TEXT}`, esc(text)), rich: true, bg };
    }

    case 'date': {
      const text = formatDateValue(raw, fmt.datePattern);
      return { text, html: esc(text) };
    }

    case 'relative_time': {
      const d = parseDate(raw);
      const text = d && input.now != null ? humanizeDelta(d.getTime() - input.now) : formatDateValue(raw, fmt.datePattern);
      return { text, html: esc(text) };
    }

    case 'date_range': {
      const text = formatDateValue(raw, fmt.datePattern || 'd MMM');
      return { text, html: esc(text) };
    }

    case 'countdown': {
      const due = parseDate(raw);
      if (!due) return { text: '—', html: span(`color:${MUTED}`, '—'), rich: true };
      if (input.now == null) { const text = formatDateValue(raw, fmt.datePattern); return { text, html: esc(text) }; }
      const ms = due.getTime() - input.now;
      const days = ms / 86400000;
      const color = ms < 0 ? NAMED_COLORS.red : days <= (fmt.dangerDays ?? 1) ? NAMED_COLORS.red : days <= (fmt.warnDays ?? 3) ? NAMED_COLORS.amber : NAMED_COLORS.green;
      const text = humanizeDelta(ms);
      return { text, html: span(`color:${color};font-weight:600`, esc(text)), rich: true, color, bold: true };
    }

    case 'telephone': {
      if (empty) return { text: '', html: '' };
      const numStr = String(raw);
      const text = fmt.label || numStr;
      const html = `<a href="tel:${esc(numStr.replace(/[^0-9+]/g, ''))}" style="color:${ACCENT};text-decoration:none">📞 ${esc(text)}</a>`;
      return { text, html, rich: true, color: ACCENT };
    }

    case 'country': {
      if (empty) return { text: '', html: '' };
      const code = String(raw).trim();
      const flag = code.length === 2 ? flagEmoji(code) : '';
      const mode = fmt.countryShow || 'flag_name';
      const label = mode === 'flag' ? '' : code;
      const text = `${flag ? flag + ' ' : ''}${label}`.trim();
      return { text, html: span('display:inline-flex;align-items:center;gap:6px', `${flag ? esc(flag) : '🏳️'}${label ? ' ' + esc(label) : ''}`), rich: true };
    }

    case 'email': {
      if (empty) return { text: '', html: '' };
      const addr = String(raw);
      const text = fmt.label || addr;
      return { text, html: `<a href="mailto:${esc(addr)}" style="color:${ACCENT};text-decoration:none">✉️ ${esc(text)}</a>`, rich: true, color: ACCENT };
    }

    case 'url': {
      if (empty) return { text: '', html: '' };
      const href = String(raw);
      const text = fmt.label || href;
      return { text, html: `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer" style="color:${ACCENT};text-decoration:underline">🔗 ${esc(text)}</a>`, rich: true, color: ACCENT };
    }

    case 'image': {
      if (empty) return { text: '', html: '' };
      return { text: String(raw), html: `<img src="${esc(String(raw))}" alt="" style="height:28px;width:28px;object-fit:cover;border-radius:4px;vertical-align:middle"/>`, rich: true };
    }

    case 'file': {
      if (empty) return { text: '', html: '' };
      const href = String(raw);
      const name = fmt.label || href.split('/').pop() || href;
      return { text: name, html: `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer" style="color:${ACCENT};text-decoration:none">📎 ${esc(name)}</a>`, rich: true, color: ACCENT };
    }

    case 'map': {
      if (empty) return { text: '', html: '' };
      const text = fmt.label || String(raw);
      const q = encodeURIComponent(String(raw));
      return { text, html: `<a href="https://www.google.com/maps/search/?api=1&query=${q}" target="_blank" rel="noopener noreferrer" style="color:${ACCENT};text-decoration:none">📍 ${esc(text)}</a>`, rich: true, color: ACCENT };
    }

    case 'copy': {
      if (empty) return { text: '', html: '' };
      const text = String(raw);
      return { text, html: span('display:inline-flex;align-items:center;gap:6px', esc(text) + span(`color:${MUTED}`, '⧉')), rich: true };
    }

    case 'case': {
      const text = transformCase(empty ? '' : String(raw), fmt.textCase);
      return { text, html: esc(text) };
    }

    case 'truncate': {
      const s = empty ? '' : String(raw);
      const n = fmt.truncate ?? 40;
      const short = s.length > n ? s.slice(0, n).trimEnd() + '…' : s;
      return { text: short, html: span('', esc(short), s.length > n ? s : undefined) };
    }

    case 'masked': {
      if (empty) return { text: '', html: '' };
      const text = maskValue(String(raw), fmt);
      return { text, html: span('font-family:ui-monospace,monospace', esc(text)) };
    }

    case 'template': {
      const text = applyTemplate(fmt.template || '{value}', raw);
      return { text, html: esc(text) };
    }

    case 'two_line': {
      const text = empty ? '' : String(raw);
      return { text, html: span('display:inline-flex;flex-direction:column;line-height:1.2', span('font-weight:600', esc(text))), rich: true, bold: true };
    }

    default:
      return noDisplay(input.baseText);
  }
}

// ── Conditional formatting (shared by renderer + exporters) ──────────────────

/**
 * Evaluate the report conditions for one value cell and return the merged CSS
 * style object to apply (lifted from the old inline renderer loop so the DOM
 * grid and the export writers behave identically).
 */
export function evalConditionStyle(
  conditions: CompiledCondition[],
  value: number,
  measureUniqueName: string,
  measureKey: string,
  isTotalRow: boolean,
): ConditionFormatStyle {
  const out: ConditionFormatStyle = {};
  if (Number.isNaN(value)) return out;
  for (const c of conditions) {
    const cond = c.condition;
    if (cond.measureKey) {
      if (cond.measureKey !== measureKey) continue;
    } else if (cond.measure && cond.measure.toLowerCase() !== measureUniqueName.toLowerCase()) {
      continue;
    }
    if (cond.isTotal === true && !isTotalRow) continue;
    if (cond.isTotal === false && isTotalRow) continue;
    if (c.predicate(value)) Object.assign(out, cond.format ?? {});
  }
  return out;
}
