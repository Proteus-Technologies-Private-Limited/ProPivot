import { describe, it, expect } from 'vitest';
import { resolveLocalization } from '../src/core/normalize';
import { ProPivot } from '../src/facade/ProPivot';
import type { Report } from '../src/core/types';

const data = [
  { region: 'West', sales: 100 },
  { region: 'East', sales: 50 },
];
const baseReport: Report = {
  dataSource: { type: 'json', data },
  slice: { rows: [{ uniqueName: 'region' }], measures: [{ uniqueName: 'sales', aggregation: 'sum' }] },
};

describe('localization', () => {
  it('uses defaults when none provided', () => {
    const loc = resolveLocalization({});
    expect(loc.grandTotal).toBe('Grand Total');
    expect(loc.total).toBe('Total');
    expect(loc.blankMember).toBe('(blank)');
  });

  it('reads options.localization.grid (nested localization style)', () => {
    const loc = resolveLocalization({ options: { localization: { grid: { totals: 'Totaux', blankMember: '—' } } } } as Report);
    expect(loc.total).toBe('Totaux');
    expect(loc.blankMember).toBe('—');
  });

  it('reads top-level report.localization.grid', () => {
    const loc = resolveLocalization({ localization: { grid: { grandTotalCaption: 'All' } } } as Report);
    expect(loc.grandTotal).toBe('All');
  });
});

describe('interactive sort (facade state)', () => {
  it('toggleSort cycles asc -> desc -> unsorted', () => {
    const p = new ProPivot({ container: '#none', report: baseReport });
    p.toggleSort('region');
    expect(p.getReport().slice!.rows![0].sort).toBe('asc');
    p.toggleSort('region');
    expect(p.getReport().slice!.rows![0].sort).toBe('desc');
    p.toggleSort('region');
    expect(p.getReport().slice!.rows![0].sort).toBe('unsorted');
    p.dispose();
  });

  it('sortByMeasure toggles desc -> asc -> off', () => {
    const p = new ProPivot({ container: '#none', report: baseReport });
    p.sortByMeasure('sales');
    expect(p.getReport().slice!.sorting!.row).toEqual({ measure: 'sales', type: 'desc' });
    p.sortByMeasure('sales');
    expect(p.getReport().slice!.sorting!.row).toEqual({ measure: 'sales', type: 'asc' });
    p.sortByMeasure('sales');
    expect(p.getReport().slice!.sorting!.row).toBeUndefined();
    p.dispose();
  });
});
