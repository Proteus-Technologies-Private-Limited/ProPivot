// @vitest-environment happy-dom
//
// Range selection (Shift+click / Shift+arrows) and clipboard copy (Ctrl/Cmd+C → TSV).

import { describe, it, expect, beforeEach } from 'vitest';
import { ProPivot } from '../src/facade/ProPivot';
import type { Report } from '../src/core/types';

const mapping = { region: { type: 'string' }, category: { type: 'string' }, sales: { type: 'number' } };
const DATA = [
  { region: 'West', category: 'Tech', sales: 10 },
  { region: 'West', category: 'Furniture', sales: 20 },
  { region: 'East', category: 'Tech', sales: 30 },
  { region: 'East', category: 'Furniture', sales: 40 },
];
const report: Report = {
  dataSource: { type: 'json', data: DATA, mapping },
  slice: {
    rows: [{ uniqueName: 'region' }],
    columns: [{ uniqueName: 'category' }],
    measures: [{ uniqueName: 'sales', aggregation: 'sum' }],
  },
  options: { grid: { showGrandTotals: 'off', showTotals: 'off' } },
} as Report;

function mount(): Promise<{ pivot: ProPivot; container: HTMLElement; table: HTMLElement }> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return new Promise((resolve, reject) => {
    try {
      const pivot = new ProPivot({
        container,
        report: { ...report, options: { ...report.options, configuratorButton: false } },
        reportcomplete: () => resolve({ pivot, container, table: container.querySelector('.pp-table') as HTMLElement }),
      });
    } catch (e) { reject(e as Error); }
  });
}

function key(el: Element, k: string, mods: Partial<KeyboardEventInit> = {}): void {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...mods }));
}
const cellText = (table: HTMLElement, r: number, c: number) =>
  (table.querySelector(`[data-r="${r}"][data-c="${c}"]`)?.textContent ?? '').trim();

let copied = '';
beforeEach(() => {
  copied = '';
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: (t: string) => { copied = t; return Promise.resolve(); } },
  });
});

describe('range selection + copy', () => {
  it('Shift+arrows extend a highlighted rectangle', async () => {
    const { table, pivot } = await mount();
    const start = table.querySelector('[data-r="2"][data-c="1"]') as HTMLElement; // first value cell
    expect(start).toBeTruthy();
    start.focus();
    key(start, 'ArrowRight', { shiftKey: true });
    key(document.activeElement!, 'ArrowDown', { shiftKey: true });
    // 2 rows x 2 value columns selected.
    expect(table.querySelectorAll('.pp-range').length).toBe(4);
    pivot.dispose();
  });

  it('Ctrl+C copies the selected rectangle as TSV', async () => {
    const { table, pivot } = await mount();
    const start = table.querySelector('[data-r="2"][data-c="1"]') as HTMLElement;
    start.focus();
    key(start, 'ArrowRight', { shiftKey: true });
    key(document.activeElement!, 'ArrowDown', { shiftKey: true });
    key(document.activeElement!, 'c', { ctrlKey: true });

    const expected = [
      [cellText(table, 2, 1), cellText(table, 2, 2)].join('\t'),
      [cellText(table, 3, 1), cellText(table, 3, 2)].join('\t'),
    ].join('\n');
    expect(copied).toBe(expected);
    expect(copied.split('\n')).toHaveLength(2);
    pivot.dispose();
  });

  it('Shift+click extends from the anchor', async () => {
    const { table, pivot } = await mount();
    const a = table.querySelector('[data-r="2"][data-c="0"]') as HTMLElement; // East row header
    a.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const bcell = table.querySelector('[data-r="3"][data-c="2"]') as HTMLElement;
    bcell.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
    // Whole 2x3 block (region header + 2 value cols, 2 rows).
    expect(table.querySelectorAll('.pp-range').length).toBe(6);
    pivot.dispose();
  });
});
