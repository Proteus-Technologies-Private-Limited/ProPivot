// @vitest-environment happy-dom
//
// Accessibility contract for the grid: ARIA roles/properties and keyboard
// navigation (roving tabindex). Renders through the real facade in a headless
// DOM and asserts the structure screen readers and keyboard users depend on.

import { describe, it, expect } from 'vitest';
import { ProPivot } from '../src/facade/ProPivot';
import type { Report } from '../src/core/types';
import type { CellData } from '../src/facade/cell';

const mapping = { region: { type: 'string' }, category: { type: 'string' }, sales: { type: 'number' } };
const DATA = [
  { region: 'West', category: 'A', sales: 10 },
  { region: 'West', category: 'B', sales: 20 },
  { region: 'East', category: 'A', sales: 30 },
  { region: 'East', category: 'B', sales: 40 },
];

interface Mounted { pivot: ProPivot; container: HTMLElement; table: HTMLTableElement; clicks: CellData[]; }

function mount(report: Report): Promise<Mounted> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const clicks: CellData[] = [];
  return new Promise((resolve, reject) => {
    try {
      const pivot = new ProPivot({
        container,
        report: { ...report, options: { ...report.options, configuratorButton: false } },
        cellclick: (c: CellData) => clicks.push(c),
        reportcomplete: () => resolve({ pivot, container, table: container.querySelector('.pp-table') as HTMLTableElement, clicks }),
      });
    } catch (e) { reject(e as Error); }
  });
}

function press(el: Element, key: string, init: KeyboardEventInit = {}): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
}

const crossTab: Report = {
  dataSource: { type: 'json', data: DATA, mapping },
  slice: {
    rows: [{ uniqueName: 'region' }, { uniqueName: 'category' }],
    columns: [{ uniqueName: 'category' }],
    measures: [{ uniqueName: 'sales', aggregation: 'sum' }],
  },
} as Report;

const compact: Report = {
  dataSource: { type: 'json', data: DATA, mapping },
  slice: {
    rows: [{ uniqueName: 'region' }, { uniqueName: 'category' }],
    measures: [{ uniqueName: 'sales', aggregation: 'sum' }],
  },
} as Report;

describe('accessibility — ARIA roles & properties', () => {
  it('exposes the table as an ARIA grid with row/col counts', async () => {
    const { table, pivot } = await mount(crossTab);
    expect(table.getAttribute('role')).toBe('grid');
    expect(table.getAttribute('aria-readonly')).toBe('true');
    expect(Number(table.getAttribute('aria-colcount'))).toBeGreaterThan(0);
    expect(Number(table.getAttribute('aria-rowcount'))).toBeGreaterThan(0);
    expect(table.getAttribute('aria-label')).toBeTruthy();
    pivot.dispose();
  });

  it('tags header rows, column headers and a sortable measure header', async () => {
    const { table, pivot } = await mount(crossTab);
    const headRows = table.querySelectorAll('thead tr');
    expect(headRows.length).toBeGreaterThanOrEqual(2);
    headRows.forEach((tr) => {
      expect(tr.getAttribute('role')).toBe('row');
      expect(tr.getAttribute('aria-rowindex')).toBeTruthy();
    });
    expect(table.querySelectorAll('thead [role="columnheader"]').length).toBeGreaterThan(0);
    // The measure header carries aria-sort (one of the recognised tokens).
    const measureH = table.querySelector('.pp-measureh');
    expect(['ascending', 'descending', 'none']).toContain(measureH?.getAttribute('aria-sort'));
    pivot.dispose();
  });

  it('tags body rows, row headers and value gridcells', async () => {
    const { table, pivot } = await mount(crossTab);
    const firstRow = table.querySelector('tbody tr')!;
    expect(firstRow.getAttribute('role')).toBe('row');
    expect(firstRow.getAttribute('aria-rowindex')).toBeTruthy();
    expect(table.querySelector('tbody [role="rowheader"]')).toBeTruthy();
    const cell = table.querySelector('tbody [role="gridcell"]')!;
    expect(cell.getAttribute('aria-selected')).toBe('false');
    expect(cell.getAttribute('aria-colindex')).toBeTruthy();
    pivot.dispose();
  });

  it('marks expandable compact group rows with aria-expanded', async () => {
    const { table, pivot } = await mount(compact);
    const expandable = table.querySelector('tbody [role="rowheader"][aria-expanded]');
    expect(expandable).toBeTruthy();
    expect(['true', 'false']).toContain(expandable!.getAttribute('aria-expanded'));
    pivot.dispose();
  });

  it('keeps exactly one tab stop (roving tabindex)', async () => {
    const { table, pivot } = await mount(crossTab);
    const tabbable = table.querySelectorAll('[data-r][tabindex="0"]');
    expect(tabbable.length).toBe(1);
    const negative = table.querySelectorAll('[data-r][tabindex="-1"]');
    expect(negative.length).toBeGreaterThan(0);
    pivot.dispose();
  });
});

describe('accessibility — keyboard navigation', () => {
  it('moves focus with arrow keys and Home', async () => {
    const { table, pivot } = await mount(crossTab);
    const start = table.querySelector('[data-r][tabindex="0"]') as HTMLElement;
    start.focus();
    const r0 = Number(start.dataset.r), c0 = Number(start.dataset.c);

    press(start, 'ArrowRight');
    let active = document.activeElement as HTMLElement;
    expect(Number(active.dataset.c)).toBeGreaterThan(c0);
    expect(Number(active.dataset.r)).toBe(r0);

    press(active, 'ArrowDown');
    active = document.activeElement as HTMLElement;
    expect(Number(active.dataset.r)).toBeGreaterThan(r0);

    press(active, 'Home');
    active = document.activeElement as HTMLElement;
    expect(Number(active.dataset.c)).toBe(0);
    pivot.dispose();
  });

  it('activates a value cell with Enter (fires cellclick)', async () => {
    const { table, clicks, pivot } = await mount(crossTab);
    const cell = table.querySelector('tbody [role="gridcell"]') as HTMLElement;
    cell.focus();
    const before = clicks.length;
    press(cell, 'Enter');
    expect(clicks.length).toBe(before + 1);
    expect(clicks[clicks.length - 1].type).toBe('value');
    pivot.dispose();
  });

  it('Enter on a compact group row toggles its expansion', async () => {
    const { table, container, pivot } = await mount(compact);
    const group = table.querySelector('tbody [role="rowheader"][aria-expanded="true"]') as HTMLElement;
    expect(group).toBeTruthy();
    const before = table.querySelectorAll('tbody tr').length;
    group.focus();
    press(group, 'Enter');
    // Toggling re-renders into a fresh table — re-query from the container.
    const after = container.querySelector('.pp-table')!.querySelectorAll('tbody tr').length;
    expect(after).toBeLessThan(before); // children collapsed away
    pivot.dispose();
  });
});
