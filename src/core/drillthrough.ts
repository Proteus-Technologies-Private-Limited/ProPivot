// Drill-through (docs/Architecture.md). Given a clicked cell's row-path and
// col-path member values, return the underlying raw rows that aggregate into it.

export interface DrillThroughQuery {
  rowFields: string[];
  rowPath: string[];
  colFields: string[];
  colPath: string[];
  /** Cap the number of returned rows (0 = no cap). */
  limit?: number;
}

function matches(row: Record<string, unknown>, fields: string[], path: string[]): boolean {
  // A shorter path (subtotal / grand total) only constrains the levels present.
  for (let i = 0; i < path.length; i++) {
    const raw = row[fields[i]];
    const val = raw === null || raw === undefined || raw === '' ? '' : String(raw);
    if (val !== path[i]) return false;
  }
  return true;
}

export function drillThroughRows(
  rawRows: Array<Record<string, unknown>>,
  query: DrillThroughQuery,
): Array<Record<string, unknown>> {
  const { rowFields, rowPath, colFields, colPath, limit = 0 } = query;
  const out: Array<Record<string, unknown>> = [];
  for (const row of rawRows) {
    if (matches(row, rowFields, rowPath) && matches(row, colFields, colPath)) {
      out.push(row);
      if (limit > 0 && out.length >= limit) break;
    }
  }
  return out;
}
