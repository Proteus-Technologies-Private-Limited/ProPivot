// @vitest-environment happy-dom
//
// Public filter API end-to-end: setValueFilter / setLabelFilter drive the facade
// + engine + render, reducing the row members shown in the grid.

import { describe, it, expect } from 'vitest';
import { ProPivot } from '../src/facade/ProPivot';
import type { Report } from '../src/core/types';

const mapping = { region: { type: 'string' }, sales: { type: 'number' } };
const DATA = [
  { region: 'West', sales: 100 },
  { region: 'East', sales: 5 },
  { region: 'North', sales: 50 },
  { region: 'South', sales: 30 },
];
const report: Report = {
  dataSource: { type: 'json', data: DATA, mapping },
  slice: { rows: [{ uniqueName: 'region' }], measures: [{ uniqueName: 'sales', aggregation: 'sum' }] },
} as Report;

function mount(): Promise<{ pivot: ProPivot; container: HTMLElement }> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return new Promise((resolve, reject) => {
    try {
      const pivot = new ProPivot({
        container,
        report: { ...report, options: { configuratorButton: false } },
        reportcomplete: () => resolve({ pivot, container }),
      });
    } catch (e) { reject(e as Error); }
  });
}

const memberRows = (container: HTMLElement): string[] =>
  Array.from(container.querySelectorAll('tbody .pp-rowh'))
    .map((el) => (el.textContent || '').replace(/[▾▸]/g, '').trim())
    .filter((t) => t && t !== 'Grand Total');

// refresh() repaints the grid on a tick — wait for it before reading the DOM.
const tick = () => new Promise((r) => setTimeout(r, 0));

describe('public filter API', () => {
  it('setValueFilter keeps only members passing the threshold', async () => {
    const { pivot, container } = await mount();
    expect(memberRows(container).sort()).toEqual(['East', 'North', 'South', 'West']);
    pivot.setValueFilter('region', 'sales', 'greaterThan', 40);
    await tick();
    expect(memberRows(container).sort()).toEqual(['North', 'West']);
    pivot.dispose();
  });

  it('setLabelFilter keeps members matching the text query', async () => {
    const { pivot, container } = await mount();
    pivot.setLabelFilter('region', 'contains', 'th');
    await tick();
    expect(memberRows(container).sort()).toEqual(['North', 'South']);
    pivot.dispose();
  });

  it('clearing via setFilter(null) restores all members', async () => {
    const { pivot, container } = await mount();
    pivot.setValueFilter('region', 'sales', 'lessThan', 40);
    await tick();
    expect(memberRows(container).sort()).toEqual(['East', 'South']);
    pivot.setFilter('region', null);
    await tick();
    expect(memberRows(container).sort()).toEqual(['East', 'North', 'South', 'West']);
    pivot.dispose();
  });
});
