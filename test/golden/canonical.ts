// Golden-test canonicalizer (docs/Architecture.md). Computes a report through
// the real engine path and produces a deterministic, JSON-serializable snapshot of
// the cell matrix — the recorded reference output that pins the compatibility
// contract. Anything the engine guarantees (values, formatted text, axis structure,
// resolved measures, totals) is captured; anything order-unstable is sorted so the
// snapshot diffs cleanly run to run.

import { LocalEngine } from '../../src/core/engine';
import { serializeMatrix } from '../../src/core/matrix';
import type { Report } from '../../src/core/types';

/** Stable string compare so cell/text/grand entries serialize in a fixed order. */
function byKey(a: [string, unknown], b: [string, unknown]): number {
  return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
}

export interface GoldenSnapshot {
  rowFields: string[];
  colFields: string[];
  measuresAxis: 'rows' | 'columns';
  measures: unknown[];
  rowTree: unknown[];
  colTree: unknown[];
  cells: Array<[string, number]>;
  text: Array<[string, string]>;
  grand: Array<[string, number]>;
  flat?: unknown;
}

/**
 * Run a report through LocalEngine (the same path a host uses, including the
 * Worker-transfer serialization shape) and return a canonical snapshot.
 *
 * Errors are not swallowed: a report that throws is a contract change the golden
 * suite must surface, not hide.
 */
export function snapshotReport(report: Report): GoldenSnapshot {
  const engine = new LocalEngine();
  try {
    engine.setData(report.dataSource?.data, report.dataSource?.mapping);
    const matrix = engine.computeSync(report);
    const s = serializeMatrix(matrix);
    // NaN/Infinity are valid engine outputs (e.g. first-column `difference`,
    // divide-by-zero) but are not valid JSON. Encode them as sentinels so the
    // snapshot survives a JSON round-trip and the contract on them is still pinned.
    const num = (v: number): number | string =>
      Number.isFinite(v) ? v : Number.isNaN(v) ? '__NaN__' : v > 0 ? '__Infinity__' : '__-Infinity__';

    const snapshot: GoldenSnapshot = {
      rowFields: s.rowFields,
      colFields: s.colFields,
      measuresAxis: s.measuresAxis,
      measures: s.measures as unknown[],
      rowTree: s.rowTree as unknown[],
      colTree: s.colTree as unknown[],
      cells: s.cells.map(([k, v]) => [k, num(v) as number]).sort(byKey),
      text: [...s.text].sort(byKey),
      grand: s.grand.map(([k, v]) => [k, num(v) as number]).sort(byKey),
    };
    if (s.flat !== undefined) snapshot.flat = s.flat;
    // Normalize undefined/Map artifacts the same way the on-disk JSON will read back.
    return JSON.parse(JSON.stringify(snapshot)) as GoldenSnapshot;
  } finally {
    engine.dispose();
  }
}
