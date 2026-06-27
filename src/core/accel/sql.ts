// DuckDB accelerator — SQL generation + result mapping (docs/Architecture.md §5).
//
// The opt-in accelerator offloads only the GROUPING-SETS *base aggregation* (planner
// step 3) to DuckDB; everything else (derive/positional/format/axis-trees) is the shared
// `assembleMatrix`, so results match the built-in engine up to floating-point. This
// module is pure (no DuckDB import) so the SQL + mapping can be unit-tested and run
// against either duckdb-wasm (browser) or duckdb-async (Node tests).

import type { ColumnKind } from '../store';
import type { NormalReport } from '../normalize';
import { totalsEnabled } from '../normalize';
import type { BasePlan, BaseDesc } from '../planner';
import { pathKey, US } from '../matrix';

export const ACCEL_TABLE = 'propivot_data';

/** A minimal async SQL runner. Implemented by duckdb-wasm (browser) and duckdb-async (Node). */
export interface SqlRunner {
  query(sql: string): Promise<Array<Record<string, unknown>>>;
}

export interface UnsupportedReport { supported: false; reason: string; }
export interface BaseQueries { supported: true; queries: GroupingQuery[]; }
interface GroupingQuery { sql: string; rowFields: string[]; colFields: string[]; }

const sqlStr = (s: string) => `'${s.replace(/'/g, "''")}'`;
const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;

/** Member value as the engine sees it: a dimension's display string, blank coalesced to ''. */
const dimExpr = (field: string) => `COALESCE(CAST(${ident(field)} AS VARCHAR), '')`;
const measExpr = (field: string) => `TRY_CAST(${ident(field)} AS DOUBLE)`;

/** SQL aggregate matching the corresponding TS accumulator (see aggregations.ts). */
function aggExpr(desc: BaseDesc, kindOf: (f: string) => ColumnKind | undefined): string {
  const f = desc.field;
  const num = measExpr(f);
  switch (desc.agg) {
    case 'sum': return `SUM(${num})`;
    case 'average': return `AVG(${num})`;
    case 'min': return `MIN(${num})`;
    case 'max': return `MAX(${num})`;
    case 'product': return `PRODUCT(${num})`;
    case 'median': return `MEDIAN(${num})`;
    case 'stdevp': return `STDDEV_POP(${num})`;
    case 'stdevs': return `STDDEV_SAMP(${num})`;
    case 'count':
      // rawKey is null for blank strings / missing numbers — match that.
      return kindOf(f) === 'string' ? `COUNT(NULLIF(${ident(f)}, ''))` : `COUNT(${num})`;
    case 'distinctcount':
      return kindOf(f) === 'string'
        ? `COUNT(DISTINCT NULLIF(${ident(f)}, ''))`
        : `COUNT(DISTINCT ${num})`;
    default:
      return `SUM(${num})`;
  }
}

/** Which grouping-set prefix lengths the report needs along an axis (mirrors scanBaseCells). */
function allowedLevels(n: number, showTotals: boolean): number[] {
  const out: number[] = [];
  for (let g = 0; g <= n; g++) if (g === 0 || g === n || showTotals) out.push(g);
  return out;
}

/** WHERE clause from member filters (top/bottom-N is not handled here — caller falls back). */
function whereClause(normal: NormalReport): string {
  const clauses: string[] = [];
  const collect = (hs: { uniqueName: string; filter?: { type?: string; members?: string[]; negation?: boolean } }[]) => {
    for (const h of hs) {
      const fil = h.filter;
      if (!fil || fil.type === 'none') continue;
      if (fil.type === 'top' || fil.type === 'bottom') continue; // handled by caller (fallback)
      if (fil.members && fil.members.length) {
        const list = fil.members.map(sqlStr).join(', ');
        clauses.push(`${dimExpr(h.uniqueName)} ${fil.negation ? 'NOT IN' : 'IN'} (${list})`);
      }
    }
  };
  collect(normal.report.slice?.rows ?? []);
  collect(normal.report.slice?.columns ?? []);
  collect(normal.reportFilters);
  return clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
}

/** True when a report uses a top/bottom-N filter (the accelerator declines those). */
export function hasRankFilter(normal: NormalReport): boolean {
  const any = (hs: { filter?: { type?: string; measure?: string } }[]) =>
    hs.some((h) => (h.filter?.type === 'top' || h.filter?.type === 'bottom') && h.filter?.measure);
  return any(normal.report.slice?.rows ?? []) || any(normal.report.slice?.columns ?? []) ||
    any(normal.reportFilters ?? []);
}

/**
 * Build one GROUP BY query per grouping set, or report why the accelerator can't run
 * this report (caller then falls back to the built-in engine).
 */
export function buildBaseQueries(
  normal: NormalReport, plan: BasePlan, kindOf: (f: string) => ColumnKind | undefined,
): BaseQueries | UnsupportedReport {
  const { rowFields, colFields, grid } = normal;

  if (hasRankFilter(normal)) return { supported: false, reason: 'top/bottom-N filter' };
  for (const f of [...rowFields, ...colFields]) {
    const k = kindOf(f);
    // Date/datetime dimensions are display-formatted in the engine; don't risk a mismatch.
    if (k === 'date') return { supported: false, reason: `date dimension "${f}"` };
  }
  if (!plan.baseList.length) return { supported: false, reason: 'no base aggregations' };

  const where = whereClause(normal);
  const aggSelect = plan.baseList.map((b, i) => `${aggExpr(b, kindOf)} AS b${i}`).join(', ');
  const rLevels = allowedLevels(rowFields.length, totalsEnabled(grid.showTotals, 'rows'));
  const cLevels = allowedLevels(colFields.length, totalsEnabled(grid.showTotals, 'columns'));

  const queries: GroupingQuery[] = [];
  for (const gr of rLevels) {
    for (const gc of cLevels) {
      const rf = rowFields.slice(0, gr);
      const cf = colFields.slice(0, gc);
      const dims = [...rf, ...cf];
      const dimSelect = dims.map((f, i) => `${dimExpr(f)} AS d${i}`).join(', ');
      const select = [dimSelect, aggSelect].filter(Boolean).join(', ');
      const groupBy = dims.length ? ` GROUP BY ${dims.map((_, i) => `d${i}`).join(', ')}` : '';
      queries.push({
        sql: `SELECT ${select} FROM ${ACCEL_TABLE}${where}${groupBy}`,
        rowFields: rf,
        colFields: cf,
      });
    }
  }
  return { supported: true, queries };
}

function toNum(v: unknown): number {
  if (v === null || v === undefined) return NaN;
  if (typeof v === 'bigint') return Number(v);
  const n = Number(v);
  return Number.isFinite(n) || Number.isNaN(n) ? n : NaN;
}

/**
 * Run the grouping-set queries and assemble the base-cell map keyed like the TS scan:
 * `pathKey(rowPath, colPath, baseKey) -> value`.
 */
export async function computeBaseCellsViaSql(
  runner: SqlRunner, normal: NormalReport, plan: BasePlan, kindOf: (f: string) => ColumnKind | undefined,
): Promise<Map<string, number> | null> {
  const built = buildBaseQueries(normal, plan, kindOf);
  if (!built.supported) return null;

  const cellBase = new Map<string, number>();
  for (const q of built.queries) {
    const rows = await runner.query(q.sql);
    const nDim = q.rowFields.length + q.colFields.length;
    for (const row of rows) {
      const dimVals: string[] = [];
      for (let i = 0; i < nDim; i++) dimVals.push(String(row[`d${i}`] ?? ''));
      const rp = dimVals.slice(0, q.rowFields.length);
      const cp = dimVals.slice(q.rowFields.length);
      for (let i = 0; i < plan.baseList.length; i++) {
        cellBase.set(pathKey(rp, cp, plan.baseList[i].key), toNum(row[`b${i}`]));
      }
    }
  }
  return cellBase;
}

// Re-export so callers building dimension keys stay consistent with the engine separator.
export { US };
