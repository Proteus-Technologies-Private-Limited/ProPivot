import { describe, it, expect } from 'vitest';
import { buildStore } from '../src/core/store';
import { normalizeReport } from '../src/core/normalize';
import { buildMatrix, leafPaths } from '../src/core/planner';
import { pathKey, serializeMatrix, deserializeMatrix } from '../src/core/matrix';
import type { Report } from '../src/core/types';

const data = [
  { region: 'West', year: 2023, sales: 100 },
  { region: 'West', year: 2024, sales: 150 },
  { region: 'West', year: 2025, sales: 250 },
  { region: 'East', year: 2023, sales: 50 },
  { region: 'East', year: 2024, sales: 80 },
  { region: 'East', year: 2025, sales: 60 },
  { region: 'North', year: 2023, sales: 400 },
  { region: 'North', year: 2024, sales: 410 },
  { region: 'North', year: 2025, sales: 420 },
];

function build(report: Report) {
  return buildMatrix(buildStore(data as never), normalizeReport(report));
}

describe('positional aggregations (along columns)', () => {
  const base: Report = {
    dataSource: { type: 'json', data },
    slice: {
      rows: [{ uniqueName: 'region' }],
      columns: [{ uniqueName: 'year' }],
      measures: [{ uniqueName: 'sales', aggregation: 'runningtotals' }],
    },
  };

  it('runningtotals accumulates across years', () => {
    const m = build(base);
    expect(m.cells.get(pathKey(['West'], ['2023'], 'sales'))).toBe(100);
    expect(m.cells.get(pathKey(['West'], ['2024'], 'sales'))).toBe(250);
    expect(m.cells.get(pathKey(['West'], ['2025'], 'sales'))).toBe(500);
  });

  it('difference is current - previous (first column NaN)', () => {
    const m = build({ ...base, slice: { ...base.slice!, measures: [{ uniqueName: 'sales', aggregation: 'difference' }] } });
    expect(Number.isNaN(m.cells.get(pathKey(['West'], ['2023'], 'sales'))!)).toBe(true);
    expect(m.cells.get(pathKey(['West'], ['2024'], 'sales'))).toBe(50); // 150-100
    expect(m.cells.get(pathKey(['West'], ['2025'], 'sales'))).toBe(100); // 250-150
  });

  it('%difference is (curr - prev)/prev', () => {
    const m = build({ ...base, slice: { ...base.slice!, measures: [{ uniqueName: 'sales', aggregation: '%difference' }] } });
    expect(m.cells.get(pathKey(['West'], ['2024'], 'sales'))).toBeCloseTo(0.5, 6); // (150-100)/100
  });
});

describe('Top-N / Bottom-N filtering', () => {
  it('top 1 region by sales keeps only North', () => {
    const m = build({
      dataSource: { type: 'json', data },
      slice: {
        rows: [{ uniqueName: 'region', filter: { type: 'top', measure: 'sales', quantity: 1 } }],
        measures: [{ uniqueName: 'sales', aggregation: 'sum' }],
      },
    });
    expect(m.rowTree.map((n) => n.label)).toEqual(['North']);
    expect(m.cells.get(pathKey([], [], 'sales'))).toBe(1230); // 400+410+420
  });

  it('bottom 1 region by sales keeps only East', () => {
    const m = build({
      dataSource: { type: 'json', data },
      slice: {
        rows: [{ uniqueName: 'region', filter: { type: 'bottom', measure: 'sales', quantity: 1 } }],
        measures: [{ uniqueName: 'sales', aggregation: 'sum' }],
      },
    });
    expect(m.rowTree.map((n) => n.label)).toEqual(['East']);
  });
});

describe('sort by measure', () => {
  it('orders rows descending by sales total', () => {
    const m = build({
      dataSource: { type: 'json', data },
      slice: {
        rows: [{ uniqueName: 'region' }],
        measures: [{ uniqueName: 'sales', aggregation: 'sum' }],
        sorting: { row: { measure: 'sales', type: 'desc' } },
      },
    });
    expect(m.rowTree.map((n) => n.label)).toEqual(['North', 'West', 'East']);
  });
});

describe('flat grid mode is render-only (cube unchanged)', () => {
  const slice = {
    rows: [{ uniqueName: 'region' }],
    columns: [{ uniqueName: 'year' }],
    measures: [{ uniqueName: 'sales', aggregation: 'sum' as const }],
  };
  it('keeps the pivot cube identical to compact (flat only changes row layout)', () => {
    const compact = build({ dataSource: { type: 'json', data }, slice, options: { grid: { type: 'compact' } } });
    const flat = build({ dataSource: { type: 'json', data }, slice, options: { grid: { type: 'flat' } } });
    // Same grand total, same leaf cells — flat must NOT drop columns/measures.
    expect(flat.cells.get(pathKey([], [], 'sales'))).toBe(compact.cells.get(pathKey([], [], 'sales')));
    expect(flat.cells.get(pathKey(['West'], ['2023'], 'sales'))).toBe(compact.cells.get(pathKey(['West'], ['2023'], 'sales')));
    expect(flat.colFields).toEqual(['year']);
    expect(flat.measures.map((m) => m.uniqueName)).toEqual(['sales']);
  });
});

describe('per-measure aggregation is independent', () => {
  it('each measure aggregates with its own function', () => {
    const m = build({
      dataSource: { type: 'json', data },
      slice: {
        rows: [{ uniqueName: 'region' }],
        measures: [
          { uniqueName: 'sales', aggregation: 'sum' },
          { uniqueName: 'sales', aggregation: 'average', caption: 'Avg' },
        ],
      },
    });
    // Two measures over the same field, different aggregations, must coexist.
    expect(m.measures).toHaveLength(2);
    expect(m.measures[0].aggregation).toBe('sum');
    expect(m.measures[1].aggregation).toBe('average');
  });
});

describe('matrix serialization round-trip (Worker transfer)', () => {
  it('survives serialize/deserialize', () => {
    const m = build({
      dataSource: { type: 'json', data },
      slice: { rows: [{ uniqueName: 'region' }], columns: [{ uniqueName: 'year' }], measures: [{ uniqueName: 'sales' }] },
    });
    const round = deserializeMatrix(serializeMatrix(m));
    expect(round.cells.get(pathKey([], [], 'sales'))).toBe(m.cells.get(pathKey([], [], 'sales')));
    expect(leafPaths(round.colTree).length).toBe(leafPaths(m.colTree).length);
  });
});
