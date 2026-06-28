import { describe, it, expect } from 'vitest';
import { buildStore } from '../src/core/store';
import { normalizeReport } from '../src/core/normalize';
import { buildMatrix } from '../src/core/planner';
import type { Report, FilterSpec } from '../src/core/types';

const data = [
  { region: 'West', category: 'Tech', sales: 100 },
  { region: 'East', category: 'Tech', sales: 5 },
  { region: 'North', category: 'Furniture', sales: 50 },
  { region: 'South', category: 'Furniture', sales: 30 },
];
const mapping = {
  region: { type: 'string' as const },
  category: { type: 'string' as const },
  sales: { type: 'number' as const },
};

function rowMembers(filter?: FilterSpec): string[] {
  const report: Report = {
    dataSource: { type: 'json', data, mapping },
    slice: {
      rows: [{ uniqueName: 'region', filter }],
      measures: [{ uniqueName: 'sales', aggregation: 'sum' }],
    },
  };
  const m = buildMatrix(buildStore(data as never, mapping), normalizeReport(report));
  return m.rowTree.map((n) => n.label).sort();
}

describe('value filters', () => {
  it('keeps members whose measure passes greaterThan', () => {
    expect(rowMembers({ type: 'value', measure: 'sales', operator: 'greaterThan', value: 40 }))
      .toEqual(['North', 'West']); // 100 and 50 pass; East(5), South(30) drop
  });

  it('supports lessEqual', () => {
    expect(rowMembers({ type: 'value', measure: 'sales', operator: 'lessEqual', value: 30 }))
      .toEqual(['East', 'South']); // 5 and 30
  });

  it('supports between (inclusive, order-insensitive bounds)', () => {
    expect(rowMembers({ type: 'value', measure: 'sales', operator: 'between', value: 60, value2: 10 }))
      .toEqual(['North', 'South']); // 50 and 30 within [10,60]
  });
});

describe('label filters', () => {
  it('contains is case-insensitive', () => {
    expect(rowMembers({ type: 'label', labelOperator: 'contains', query: 'th' }))
      .toEqual(['North', 'South']); // norTH, souTH
  });

  it('beginsWith', () => {
    expect(rowMembers({ type: 'label', labelOperator: 'beginsWith', query: 'so' }))
      .toEqual(['South']);
  });

  it('notContains', () => {
    expect(rowMembers({ type: 'label', labelOperator: 'notContains', query: 'th' }))
      .toEqual(['East', 'West']);
  });

  it('equals matches exactly', () => {
    expect(rowMembers({ type: 'label', labelOperator: 'equals', query: 'east' }))
      .toEqual(['East']);
  });
});

describe('filters are inert when unset', () => {
  it('no filter keeps all members', () => {
    expect(rowMembers()).toEqual(['East', 'North', 'South', 'West']);
  });
});
