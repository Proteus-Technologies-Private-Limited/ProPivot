import { describe, it, expect } from 'vitest';
import { buildStore } from '../src/core/store';
import { normalizeReport } from '../src/core/normalize';
import { buildMatrix } from '../src/core/planner';
import { pathKey } from '../src/core/matrix';
import type { Report } from '../src/core/types';

const data = [
  { region: 'West', category: 'A', sales: 100, qty: 2 },
  { region: 'West', category: 'B', sales: 200, qty: 5 },
  { region: 'East', category: 'A', sales: 50, qty: 1 },
  { region: 'East', category: 'B', sales: 150, qty: 3 },
];

function build(report: Report) {
  const store = buildStore(data as never);
  const normal = normalizeReport(report);
  return buildMatrix(store, normal);
}

describe('end-to-end pivot', () => {
  const base: Report = {
    dataSource: { type: 'json', data },
    slice: {
      rows: [{ uniqueName: 'region' }],
      columns: [{ uniqueName: 'category' }],
      measures: [{ uniqueName: 'sales', aggregation: 'sum' }],
    },
  };

  it('computes leaf cells, row/col totals, and grand total', () => {
    const m = build(base);
    expect(m.cells.get(pathKey(['West'], ['A'], 'sales'))).toBe(100);
    expect(m.cells.get(pathKey(['West'], ['B'], 'sales'))).toBe(200);
    // row total (across columns)
    expect(m.cells.get(pathKey(['West'], [], 'sales'))).toBe(300);
    expect(m.cells.get(pathKey(['East'], [], 'sales'))).toBe(200);
    // column total (across rows)
    expect(m.cells.get(pathKey([], ['A'], 'sales'))).toBe(150);
    expect(m.cells.get(pathKey([], ['B'], 'sales'))).toBe(350);
    // grand total
    expect(m.cells.get(pathKey([], [], 'sales'))).toBe(500);
    expect(m.grand.get('sales')).toBe(500);
  });

  it('builds row and column member trees', () => {
    const m = build(base);
    expect(m.rowTree.map((n) => n.label).sort()).toEqual(['East', 'West']);
    expect(m.colTree.map((n) => n.label).sort()).toEqual(['A', 'B']);
  });

  it('percent / percentofrow / percentofcolumn', () => {
    const m = build({
      ...base,
      slice: {
        ...base.slice!,
        measures: [
          { uniqueName: 'sales', aggregation: 'percent', caption: 'pct' },
        ],
      },
    });
    // West/A = 100 / grand 500 = 0.2
    expect(m.cells.get(pathKey(['West'], ['A'], 'sales'))).toBeCloseTo(0.2, 6);

    const r = build({
      ...base,
      slice: { ...base.slice!, measures: [{ uniqueName: 'sales', aggregation: 'percentofrow' }] },
    });
    // West/A = 100 / row total 300
    expect(r.cells.get(pathKey(['West'], ['A'], 'sales'))).toBeCloseTo(100 / 300, 6);

    const c = build({
      ...base,
      slice: { ...base.slice!, measures: [{ uniqueName: 'sales', aggregation: 'percentofcolumn' }] },
    });
    // West/A = 100 / col total 150
    expect(c.cells.get(pathKey(['West'], ['A'], 'sales'))).toBeCloseTo(100 / 150, 6);
  });

  it('calculated measure (avg price = sum(sales)/sum(qty))', () => {
    const m = build({
      ...base,
      slice: {
        rows: [{ uniqueName: 'region' }],
        columns: [],
        measures: [
          { uniqueName: 'sales', aggregation: 'sum' },
          { uniqueName: 'aov', formula: "sum('sales')/sum('qty')", caption: 'AOV' },
        ],
      },
    });
    // West: sales 300, qty 7 -> 42.857...
    expect(m.cells.get(pathKey(['West'], [], 'aov'))).toBeCloseTo(300 / 7, 6);
    // Grand: 500 / 11
    expect(m.cells.get(pathKey([], [], 'aov'))).toBeCloseTo(500 / 11, 6);
  });

  it('distinctcount aggregates correctly at totals', () => {
    const m = build({
      ...base,
      slice: {
        rows: [{ uniqueName: 'region' }],
        columns: [],
        measures: [{ uniqueName: 'category', aggregation: 'distinctcount' }],
      },
    });
    expect(m.cells.get(pathKey(['West'], [], 'category'))).toBe(2);
    expect(m.cells.get(pathKey([], [], 'category'))).toBe(2);
  });

  it('member filter restricts rows', () => {
    const m = build({
      ...base,
      slice: {
        rows: [{ uniqueName: 'region', filter: { members: ['West'] } }],
        columns: [{ uniqueName: 'category' }],
        measures: [{ uniqueName: 'sales', aggregation: 'sum' }],
      },
    });
    expect(m.cells.get(pathKey([], [], 'sales'))).toBe(300); // only West
    expect(m.rowTree.map((n) => n.label)).toEqual(['West']);
  });

  it('accepts the dataSourceType spelling synonym', () => {
    const m = build({
      dataSource: { dataSourceType: 'json', data } as never,
      slice: { rows: [{ uniqueName: 'region' }], measures: [{ uniqueName: 'sales' }] },
    });
    expect(m.cells.get(pathKey([], [], 'sales'))).toBe(500);
  });
});
