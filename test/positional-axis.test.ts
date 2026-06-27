import { describe, it, expect } from 'vitest';
import { buildStore } from '../src/core/store';
import { normalizeReport } from '../src/core/normalize';
import { buildMatrix } from '../src/core/planner';
import { pathKey } from '../src/core/matrix';
import type { Report } from '../src/core/types';

// Two regions (sort asc -> East, West) x two years, so the row-axis walk order is
// deterministic: East then West.
const data = [
  { region: 'East', year: 2023, sales: 50 },
  { region: 'East', year: 2024, sales: 80 },
  { region: 'West', year: 2023, sales: 100 },
  { region: 'West', year: 2024, sales: 150 },
];

function build(report: Report) {
  return buildMatrix(buildStore(data as never), normalizeReport(report));
}

const base = (aggregation: string, positionalAxis: 'rows' | 'columns') => ({
  dataSource: { type: 'json', data },
  slice: {
    rows: [{ uniqueName: 'region' }],
    columns: [{ uniqueName: 'year' }],
    measures: [{ uniqueName: 'sales', aggregation, positionalAxis } as never],
  },
}) as Report;

describe('positional family along the ROW axis', () => {
  it('runningtotals accumulates DOWN rows within each column', () => {
    const m = build(base('runningtotals', 'rows'));
    // column 2023: East 50 -> 50, West 100 -> 150
    expect(m.cells.get(pathKey(['East'], ['2023'], 'sales'))).toBe(50);
    expect(m.cells.get(pathKey(['West'], ['2023'], 'sales'))).toBe(150);
    // column 2024: East 80 -> 80, West 150 -> 230
    expect(m.cells.get(pathKey(['East'], ['2024'], 'sales'))).toBe(80);
    expect(m.cells.get(pathKey(['West'], ['2024'], 'sales'))).toBe(230);
    // grand ROW for a column carries the final running sum
    expect(m.cells.get(pathKey([], ['2023'], 'sales'))).toBe(150);
    expect(m.cells.get(pathKey([], ['2024'], 'sales'))).toBe(230);
  });

  it('difference is current − previous row (first row NaN)', () => {
    const m = build(base('difference', 'rows'));
    expect(Number.isNaN(m.cells.get(pathKey(['East'], ['2023'], 'sales'))!)).toBe(true);
    expect(m.cells.get(pathKey(['West'], ['2023'], 'sales'))).toBe(50); // 100 - 50
    expect(m.cells.get(pathKey(['West'], ['2024'], 'sales'))).toBe(70); // 150 - 80
    // grand row is undefined (NaN) for difference
    expect(Number.isNaN(m.cells.get(pathKey([], ['2023'], 'sales'))!)).toBe(true);
  });

  it('%difference is (curr − prev)/prev down rows', () => {
    const m = build(base('%difference', 'rows'));
    expect(m.cells.get(pathKey(['West'], ['2024'], 'sales'))).toBeCloseTo(0.875, 6); // (150-80)/80
  });

  it('row axis differs from the default column axis for the same data', () => {
    const rowAxis = build(base('runningtotals', 'rows'));
    const colAxis = build(base('runningtotals', 'columns'));
    // Down rows: West 2023 = 50 + 100 = 150. Across columns: West 2023 = 100 (first col).
    expect(rowAxis.cells.get(pathKey(['West'], ['2023'], 'sales'))).toBe(150);
    expect(colAxis.cells.get(pathKey(['West'], ['2023'], 'sales'))).toBe(100);
  });

  it('defaults to the column axis when positionalAxis is unset', () => {
    const m = build({
      dataSource: { type: 'json', data },
      slice: {
        rows: [{ uniqueName: 'region' }],
        columns: [{ uniqueName: 'year' }],
        measures: [{ uniqueName: 'sales', aggregation: 'runningtotals' }],
      },
    });
    // West row across columns: 2023 -> 100, 2024 -> 250
    expect(m.cells.get(pathKey(['West'], ['2023'], 'sales'))).toBe(100);
    expect(m.cells.get(pathKey(['West'], ['2024'], 'sales'))).toBe(250);
  });
});
