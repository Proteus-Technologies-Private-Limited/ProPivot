// Drill-through (docs/Architecture.md). Given a clicked cell's row-path and
// col-path member values, return the underlying raw rows that aggregate into it.

import type { Binning } from './types';
import { binLabel } from './store';

export interface DrillThroughQuery {
  rowFields: string[];
  rowPath: string[];
  colFields: string[];
  colPath: string[];
  /** Cap the number of returned rows (0 = no cap). */
  limit?: number;
  /** Fields binned into ranges — match a raw value by its bin label. */
  binners?: Record<string, Binning>;
}

function matches(
  row: Record<string, unknown>, fields: string[], path: string[], binners?: Record<string, Binning>,
): boolean {
  // A shorter path (subtotal / grand total) only constrains the levels present.
  for (let i = 0; i < path.length; i++) {
    const field = fields[i];
    const raw = row[field];
    const bin = binners?.[field];
    let val: string;
    if (bin) {
      const n = Number(raw);
      val = Number.isNaN(n) ? '' : binLabel(n, bin);
    } else {
      val = raw === null || raw === undefined || raw === '' ? '' : String(raw);
    }
    if (val !== path[i]) return false;
  }
  return true;
}

export function drillThroughRows(
  rawRows: Array<Record<string, unknown>>,
  query: DrillThroughQuery,
): Array<Record<string, unknown>> {
  const { rowFields, rowPath, colFields, colPath, limit = 0, binners } = query;
  const out: Array<Record<string, unknown>> = [];
  for (const row of rawRows) {
    if (matches(row, rowFields, rowPath, binners) && matches(row, colFields, colPath, binners)) {
      out.push(row);
      if (limit > 0 && out.length >= limit) break;
    }
  }
  return out;
}
