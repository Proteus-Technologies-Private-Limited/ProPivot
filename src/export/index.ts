// Client-side export (docs/Architecture.md). csv/html/excel/pdf/image all built from
// the cell matrix; excel is a real .xlsx (see ./xlsx), pdf a real .pdf (see ./pdf), and
// image a real SVG (see ./svg). SVG can be rasterized to PNG in a browser on request.

import type { CellMatrix } from '../core/matrix';
import { pathKey, GS } from '../core/matrix';
import { leafPaths } from '../core/planner';
import type { NormalReport } from '../core/normalize';
import { compileConditions, type CompiledCondition } from '../core/conditions';
import { formatVisual, evalConditionStyle, type VisualCell } from '../core/cellStyle';
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
  if (vis) { cell.text = vis.text; if (vis.bar) cell.bar = vis.bar; }
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

function toHtml(t: Table): string {
  const head = `<tr>${t.header.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr>`;
  const body = t.rows.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(c.text)}</td>`).join('')}</tr>`).join('');
  return `<table border="1" cellspacing="0">${head}${body}</table>`;
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
