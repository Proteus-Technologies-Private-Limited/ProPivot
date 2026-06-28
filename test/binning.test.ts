import { describe, it, expect } from 'vitest';
import { buildStore } from '../src/core/store';
import { normalizeReport } from '../src/core/normalize';
import { buildMatrix } from '../src/core/planner';
import { pathKey } from '../src/core/matrix';
import { drillThroughRows } from '../src/core/drillthrough';
import type { Report, Binning } from '../src/core/types';

const data = [
  { name: 'a', score: 5, sales: 10 },
  { name: 'b', score: 45, sales: 20 },
  { name: 'c', score: 95, sales: 30 },
  { name: 'd', score: 120, sales: 40 },
  { name: 'e', score: 150, sales: 50 },
];
const mapping = {
  name: { type: 'string' as const },
  score: { type: 'number' as const },
  sales: { type: 'number' as const },
};

function build(binning?: Binning) {
  const report: Report = {
    dataSource: { type: 'json', data, mapping },
    slice: {
      rows: [{ uniqueName: 'score', binning }],
      measures: [{ uniqueName: 'sales', aggregation: 'sum' }],
    },
  };
  return buildMatrix(buildStore(data as never, mapping), normalizeReport(report));
}

describe('numeric binning', () => {
  it('groups a numeric field into fixed-width interval buckets', () => {
    const m = build({ interval: 50 });
    // 5,45 -> "0 - 50"; 95 -> "50 - 100"; 120,150 -> "100 - 150" and "150 - 200"
    expect(m.rowTree.map((n) => n.label)).toEqual(['0 - 50', '50 - 100', '100 - 150', '150 - 200']);
  });

  it('aggregates the measure within each bucket', () => {
    const m = build({ interval: 50 });
    expect(m.cells.get(pathKey(['0 - 50'], [], 'sales'))).toBe(30); // 10 + 20
    expect(m.cells.get(pathKey(['50 - 100'], [], 'sales'))).toBe(30); // 30
    expect(m.cells.get(pathKey(['100 - 150'], [], 'sales'))).toBe(40); // 40
    expect(m.cells.get(pathKey(['150 - 200'], [], 'sales'))).toBe(50); // 50
  });

  it('orders buckets numerically, not lexically', () => {
    const m = build({ interval: 5 });
    const labels = m.rowTree.map((n) => n.label);
    // "5 - 10" must come before "45 - 50" and "95 - 100" (lexical would mis-sort)
    expect(labels.indexOf('5 - 10')).toBeLessThan(labels.indexOf('45 - 50'));
    expect(labels.indexOf('45 - 50')).toBeLessThan(labels.indexOf('95 - 100'));
  });

  it('supports custom breakpoints with an open top bucket', () => {
    const m = build({ breaks: [0, 50, 100] });
    // <50: 5,45 -> "0 - 50"; [50,100): 95 -> "50 - 100"; >=100: 120,150 -> "100+"
    expect(m.rowTree.map((n) => n.label)).toEqual(['0 - 50', '50 - 100', '100+']);
    expect(m.cells.get(pathKey(['100+'], [], 'sales'))).toBe(90); // 40 + 50
  });

  it('is inert without a binning spec (raw numeric members)', () => {
    const m = build();
    expect(m.rowTree.map((n) => n.label)).toEqual(['5', '45', '95', '120', '150']);
  });

  it('drill-through matches raw rows by bin label', () => {
    const binning: Binning = { interval: 50 };
    const rows = drillThroughRows(data, {
      rowFields: ['score'], rowPath: ['0 - 50'], colFields: [], colPath: [],
      binners: { score: binning },
    });
    expect(rows.map((r) => r.name).sort()).toEqual(['a', 'b']); // score 5 and 45
  });
});
