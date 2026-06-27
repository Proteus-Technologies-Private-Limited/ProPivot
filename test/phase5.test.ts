import { describe, it, expect } from 'vitest';
import { buildStore } from '../src/core/store';
import { normalizeReport } from '../src/core/normalize';
import { buildMatrix } from '../src/core/planner';
import { pathKey } from '../src/core/matrix';
import { drillThroughRows } from '../src/core/drillthrough';
import type { Report } from '../src/core/types';

const data = [
  { region: 'West', d: '2023-01-15', sales: 100 },
  { region: 'West', d: '2023-02-20', sales: 150 },
  { region: 'West', d: '2024-01-10', sales: 200 },
  { region: 'East', d: '2023-03-05', sales: 50 },
];
const mapping = {
  region: { type: 'string' as const },
  d: { type: 'year/month/day' as const, caption: 'Order Date' },
  sales: { type: 'number' as const },
};
const report: Report = {
  dataSource: { type: 'json', data, mapping },
  slice: { rows: [{ uniqueName: 'd' }], measures: [{ uniqueName: 'sales', aggregation: 'sum' }] },
};

function build(r: Report = report) {
  return buildMatrix(buildStore(data as never, (r.dataSource as { mapping?: typeof mapping })?.mapping), normalizeReport(r));
}

describe('multilevel date hierarchy', () => {
  it('expands a date field into Year > Month > Day levels', () => {
    const normal = normalizeReport(report);
    expect(normal.rowFields).toEqual(['Order Date (Year)', 'Order Date (Month)', 'Order Date (Day)']);
  });

  it('nests members and aggregates at each level', () => {
    const m = build();
    expect(m.rowTree.map((n) => n.label)).toEqual(['2023', '2024']); // years sorted
    // year subtotal
    expect(m.cells.get(pathKey(['2023'], [], 'sales'))).toBe(300); // Jan100 + Feb150 + Mar50
    expect(m.cells.get(pathKey(['2024'], [], 'sales'))).toBe(200);
    // month leaf within a year
    expect(m.cells.get(pathKey(['2023', 'January'], [], 'sales'))).toBe(100);
    // grand
    expect(m.cells.get(pathKey([], [], 'sales'))).toBe(500);
  });

  it('orders months naturally (Jan, Feb, Mar — not alphabetically)', () => {
    const m = build();
    const y2023 = m.rowTree.find((n) => n.label === '2023')!;
    expect(y2023.children.map((c) => c.label)).toEqual(['January', 'February', 'March']);
  });

  it('injects derived level fields into raw rows so drill-through works', () => {
    const store = buildStore(data as never, mapping);
    expect(store.rawRows[0]['Order Date (Year)']).toBe('2023');
    expect(store.rawRows[0]['Order Date (Month)']).toBe('January');
    const rows = drillThroughRows(store.rawRows, {
      rowFields: ['Order Date (Year)', 'Order Date (Month)'], rowPath: ['2023', 'January'],
      colFields: [], colPath: [],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].sales).toBe(100);
  });

  it('supports year/quarter/month/day with natural quarter order', () => {
    const qmap = { ...mapping, d: { type: 'year/quarter/month/day' as const, caption: 'Order Date' } };
    const r: Report = { dataSource: { type: 'json', data, mapping: qmap }, slice: report.slice };
    const normal = normalizeReport(r);
    expect(normal.rowFields).toEqual(['Order Date (Year)', 'Order Date (Quarter)', 'Order Date (Month)', 'Order Date (Day)']);
    const m = buildMatrix(buildStore(data as never, qmap), normal);
    const y2023 = m.rowTree.find((n) => n.label === '2023')!;
    expect(y2023.children.map((c) => c.label)).toEqual(['Q1']); // Jan/Feb/Mar all in Q1
  });
});

describe('natural sort for month / weekday fields', () => {
  it('orders a standalone month field naturally', () => {
    const md = [
      { mon: 'March', v: 1 }, { mon: 'January', v: 1 }, { mon: 'February', v: 1 },
    ];
    const m = buildMatrix(
      buildStore(md as never, { mon: { type: 'month' } }),
      normalizeReport({ dataSource: { type: 'json', data: md, mapping: { mon: { type: 'month' } } }, slice: { rows: [{ uniqueName: 'mon' }], measures: [{ uniqueName: 'v', aggregation: 'sum' }] } }),
    );
    expect(m.rowTree.map((n) => n.label)).toEqual(['January', 'February', 'March']);
  });
});
