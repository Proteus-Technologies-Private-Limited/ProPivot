// Client-side export (docs/Architecture.md). csv/html/excel/pdf/image all built from
// the cell matrix; excel is a real .xlsx (see ./xlsx), pdf a real .pdf (see ./pdf), and
// image a real SVG (see ./svg). SVG can be rasterized to PNG in a browser on request.

import type { CellMatrix } from '../core/matrix';
import { pathKey, GS } from '../core/matrix';
import { leafPaths } from '../core/planner';
import type { NormalReport } from '../core/normalize';
import { compileConditions, type CompiledCondition } from '../core/conditions';
import { formatVisual, evalConditionStyle, excelDisplayFormatCode, type VisualCell } from '../core/cellStyle';
import { resolveFormats, excelNumberFormatCode } from '../core/format';
import type { FieldType } from '../core/types';
import { buildXlsx, type SheetCell } from './xlsx';
import { buildPdf } from './pdf';
import { buildSvg } from './svg';
import { rasterizeSvgToPng } from './raster';

export type ExportType = 'html' | 'csv' | 'excel' | 'image' | 'pdf';

export interface ExportParams {
  filename?: string;
  destinationType?: 'file' | 'server';
  url?: string;
  excelSheetName?: string;
  showFilters?: boolean;
  pageOrientation?: 'portrait' | 'landscape';
  /** image export format. 'svg' (default, portable) or 'png' (browser-only raster). */
  imageFormat?: 'svg' | 'png';
}

interface Table {
  header: string[];
  rows: SheetCell[][];
}

/** Display formats whose cell text is itself a formatted number (so an Excel
 *  numFmt derived from the display is faithful). Others fall back to the base
 *  measure format — their grid text is non-numeric (stars, %, bars, …). */
const NUMERIC_TEXT_DISPLAYS = new Set(['number', 'signed', 'data_bar', 'heatmap']);

/** Per-measure-slot value range, to auto-scale data_bar/heatmap in exports. */
function columnStats(matrix: CellMatrix): Map<string, { min: number; max: number }> {
  const out = new Map<string, { min: number; max: number }>();
  for (const [k, v] of matrix.cells) {
    if (!Number.isFinite(v)) continue;
    const mk = k.slice(k.lastIndexOf(GS) + 1);
    const cur = out.get(mk);
    if (!cur) out.set(mk, { min: v, max: v });
    else { if (v < cur.min) cur.min = v; if (v > cur.max) cur.max = v; }
  }
  return out;
}

/** Fold a VisualCell + condition style into a SheetCell's style/bar fields. */
function applyVisual(cell: SheetCell, vis: VisualCell | null, cond: Record<string, string | undefined>): void {
  const align = (a?: string): 'left' | 'right' | 'center' | undefined =>
    a === 'left' || a === 'right' || a === 'center' ? a : undefined;
  let bg = vis?.bg, color = vis?.color, bold = vis?.bold, al = vis?.align;
  if (vis) { cell.text = vis.text; if (vis.html !== undefined) cell.html = vis.html; if (vis.bar) cell.bar = vis.bar; }
  // Conditions win over display formatting.
  if (cond.backgroundColor) bg = cond.backgroundColor;
  if (cond.color) color = cond.color;
  if (cond.fontWeight) bold = /bold|[6-9]00/.test(cond.fontWeight);
  if (cond.textAlign) al = align(cond.textAlign) ?? al;
  if (bg || color || bold || al) cell.style = { bg, color, bold, align: al };
}

/** Flatten the matrix into a 2-D table; measure cells carry numeric values + style. */
function toTable(matrix: CellMatrix, normal: NormalReport, conditions: CompiledCondition[]): Table {
  const rowLeaves = matrix.rowTree.length ? leafPaths(matrix.rowTree) : [[]];
  const colLeaves = matrix.colTree.length ? leafPaths(matrix.colTree) : [[]];
  const measures = matrix.measures;
  const stats = columnStats(matrix);
  const mapping = normal.report.dataSource?.mapping ?? {};
  // Excel number-format code per measure slot: derived from a numeric display
  // format when the cell text is itself a formatted number, else from the
  // measure's base NumberFormat — so currency / percent / decimals survive.
  const formatMap = resolveFormats(normal.report.formats);
  const measureNumFmt = (m: CellMatrix['measures'][number]): string | undefined => {
    const d = m.display;
    if (d && NUMERIC_TEXT_DISPLAYS.has(d.type)) {
      const code = excelDisplayFormatCode(d);
      if (code) return code;
    }
    return excelNumberFormatCode(m.format && formatMap.has(m.format) ? formatMap.get(m.format) : formatMap.get(''));
  };
  const findHier = (field: string) =>
    [...(normal.report.slice?.rows ?? []), ...(normal.report.slice?.columns ?? [])].find((h) => h.uniqueName === field);

  const header: string[] = [...matrix.rowFields];
  for (const cp of colLeaves) {
    for (const m of measures) {
      const colLabel = cp.length ? cp.join(' / ') : '';
      header.push(colLabel ? `${colLabel} - ${m.caption}` : m.caption);
    }
  }

  const rows: SheetCell[][] = [];
  for (const rp of rowLeaves) {
    const line: SheetCell[] = [];
    for (let i = 0; i < matrix.rowFields.length; i++) {
      const field = matrix.rowFields[i];
      const label = rp[i] ?? '';
      const cell: SheetCell = { text: label };
      const display = findHier(field)?.display;
      if (display && display.type !== 'text') {
        const num = Number(label);
        const vis = formatVisual({
          value: Number.isFinite(num) && label.trim() !== '' ? num : undefined,
          raw: label, baseText: label, display, fieldType: mapping[field]?.type as FieldType | undefined,
        });
        applyVisual(cell, vis, {});
      }
      line.push(cell);
    }
    for (const cp of colLeaves) {
      for (const m of measures) {
        const key = pathKey(rp, cp, m.key);
        const text = matrix.text.get(key) ?? '';
        const num = matrix.cells.get(key);
        const value = num !== undefined && Number.isFinite(num) ? num : NaN;
        const cell: SheetCell = { text, num: Number.isFinite(value) ? value : undefined };
        const display = m.display;
        const vis = display && display.type !== 'text'
          ? formatVisual({ value: Number.isNaN(value) ? undefined : value, raw: Number.isNaN(value) ? undefined : value, baseText: text, display, fieldType: 'number', columnStats: stats.get(m.key) })
          : null;
        const cond = evalConditionStyle(conditions, value, m.uniqueName, m.key, false);
        applyVisual(cell, vis, cond);
        if (cell.num !== undefined) cell.numFmt = measureNumFmt(m);
        line.push(cell);
      }
    }
    rows.push(line);
  }
  return { header, rows };
}

function escapeCsv(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function toCsv(t: Table): string {
  const lines = [
    t.header.map(escapeCsv).join(','),
    ...t.rows.map((r) => r.map((c) => escapeCsv(c.text)).join(',')),
  ];
  return lines.join('\n');
}

function escapeHtml(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Inline `style="…"` for an exported cell, mirroring the DOM grid's cell styling. */
function cellStyleAttr(style?: SheetCell['style']): string {
  if (!style) return '';
  const parts: string[] = [];
  if (style.bg) parts.push(`background-color:${style.bg}`);
  if (style.color) parts.push(`color:${style.color}`);
  if (style.bold) parts.push('font-weight:600');
  if (style.align) parts.push(`text-align:${style.align}`);
  return parts.length ? ` style="${parts.join(';')}"` : '';
}

function toHtml(t: Table): string {
  const head = `<tr>${t.header.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr>`;
  const body = t.rows.map((r) => `<tr>${r.map((c) => {
    // Rich display formats (data bars, status tags, …) carry self-contained markup;
    // otherwise fall back to escaped text. Either way apply the shared cell style so
    // colors / bold / alignment from display & conditional formatting survive.
    const inner = c.html !== undefined ? c.html : escapeHtml(c.text);
    return `<td${cellStyleAttr(c.style)}>${inner}</td>`;
  }).join('')}</tr>`).join('');
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
table.propivot{border-collapse:collapse;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:13px}
table.propivot th,table.propivot td{border:1px solid #d1d5db;padding:4px 8px}
table.propivot th{background:#f3f4f6;font-weight:600;text-align:left}
</style></head><body><table class="propivot" cellspacing="0">${head}${body}</table></body></html>`;
}

function download(content: string | Uint8Array, filename: string, mime: string): void {
  if (typeof document === 'undefined' || typeof Blob === 'undefined') return;
  const part: BlobPart = typeof content === 'string' ? content : (content.slice().buffer as ArrayBuffer);
  const blob = new Blob([part], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(a.href);
}

export function exportMatrix(
  type: ExportType,
  matrix: CellMatrix,
  normal: NormalReport,
  params?: ExportParams,
): string | Uint8Array | null {
  const filenameBase = params?.filename ?? 'pivot';
  const table = toTable(matrix, normal, compileConditions(normal.report.conditions));
  const toFile = params?.destinationType !== 'server';

  switch (type) {
    case 'csv': {
      const csv = toCsv(table);
      if (toFile) download(csv, `${filenameBase}.csv`, 'text/csv;charset=utf-8');
      return csv;
    }
    case 'html': {
      const html = toHtml(table);
      if (toFile) download(html, `${filenameBase}.html`, 'text/html;charset=utf-8');
      return html;
    }
    case 'excel': {
      const bytes = buildXlsx(params?.excelSheetName ?? 'Report', table.header, table.rows);
      if (toFile) {
        download(bytes, `${filenameBase}.xlsx`, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      }
      return bytes;
    }
    case 'pdf': {
      const bytes = buildPdf(
        table.header,
        table.rows,
        { title: params?.filename, orientation: params?.pageOrientation ?? 'landscape' },
      );
      if (toFile) download(bytes, `${filenameBase}.pdf`, 'application/pdf');
      return bytes;
    }
    case 'image': {
      const svg = buildSvg(table.header, table.rows, { title: params?.filename });
      if (toFile) {
        // Default: download the portable SVG. With imageFormat:'png' in a browser,
        // rasterize the SVG to PNG (async, best-effort) and fall back to SVG otherwise.
        if (params?.imageFormat === 'png') {
          void rasterizeSvgToPng(svg).then((png) => {
            if (png) download(png, `${filenameBase}.png`, 'image/png');
            else download(svg, `${filenameBase}.svg`, 'image/svg+xml;charset=utf-8');
          });
        } else {
          download(svg, `${filenameBase}.svg`, 'image/svg+xml;charset=utf-8');
        }
      }
      return svg;
    }
    default:
      console.warn(`[ProPivot] exportTo('${type}') is not a supported export type.`);
      return null;
  }
}
