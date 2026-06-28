// @vitest-environment happy-dom
//
// Touch / pointer drag contract. The field list and column headers drive their
// own drag from Pointer Events (HTML5 drag-and-drop never fires on touch). Here we
// stub elementFromPoint (happy-dom has no layout) and drive a pointer sequence to
// confirm a chip dragged onto a zone actually moves the field.

import { describe, it, expect } from 'vitest';
import { ProPivot } from '../src/facade/ProPivot';
import type { Report } from '../src/core/types';

const mapping = { region: { type: 'string' }, category: { type: 'string' }, sales: { type: 'number' } };
const DATA = [
  { region: 'West', category: 'A', sales: 10 },
  { region: 'East', category: 'B', sales: 20 },
];

function mount(report: Report): Promise<{ pivot: ProPivot; container: HTMLElement }> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return new Promise((resolve, reject) => {
    try {
      const pivot = new ProPivot({ container, report, reportcomplete: () => resolve({ pivot, container }) });
    } catch (e) { reject(e as Error); }
  });
}

function pointer(el: Element, type: string, x: number, y: number): void {
  // happy-dom doesn't populate clientX/clientY from the init dict, so set the
  // fields our handlers read directly on the event instance.
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(ev, { clientX: x, clientY: y, button: 0, pointerId: 1, pointerType: 'touch' });
  el.dispatchEvent(ev);
}

const report: Report = {
  dataSource: { type: 'json', data: DATA, mapping },
  slice: { rows: [{ uniqueName: 'region' }], measures: [{ uniqueName: 'sales', aggregation: 'sum' }] },
} as Report;

describe('touch / pointer drag', () => {
  it('chips are pointer-draggable, not HTML5 draggable', async () => {
    const { container, pivot } = await mount(report);
    const chip = container.querySelector('.pp-chip[data-pp-name]') as HTMLElement;
    expect(chip).toBeTruthy();
    expect(chip.getAttribute('draggable')).toBeNull(); // no HTML5 DnD
    expect(chip.dataset.ppZone).toBeTruthy();
    pivot.dispose();
  });

  const rowNames = (pivot: ProPivot): string[] =>
    (pivot.getReport().slice?.rows ?? []).map((r) => r.uniqueName);

  it('dragging an available field onto the Rows zone adds it to rows', async () => {
    const { container, pivot } = await mount(report);
    // "category" starts unused → it's a chip in the Fields (available) pool.
    const chip = Array.from(container.querySelectorAll('.pp-chip')).find(
      (c) => (c as HTMLElement).dataset.ppName === 'category',
    ) as HTMLElement;
    expect(chip).toBeTruthy();
    expect(chip.dataset.ppZone).toBe('available');
    expect(rowNames(pivot)).not.toContain('category');

    const rowsZone = container.querySelector('.pp-zone[data-zone="rows"]') as HTMLElement;
    // Stand in for layout: the pointer is "over" the Rows zone for the whole drag.
    const orig = document.elementFromPoint;
    (document as unknown as { elementFromPoint: () => Element }).elementFromPoint = () => rowsZone;
    try {
      pointer(chip, 'pointerdown', 10, 10);
      pointer(chip, 'pointermove', 80, 80); // exceeds threshold → drag begins
      pointer(chip, 'pointerup', 80, 80);   // drop on Rows zone
    } finally {
      (document as unknown as { elementFromPoint: typeof orig }).elementFromPoint = orig;
    }
    expect(rowNames(pivot)).toContain('category');
    pivot.dispose();
  });

  it('a tap (no movement past threshold) does not move anything', async () => {
    const { container, pivot } = await mount(report);
    const chip = Array.from(container.querySelectorAll('.pp-chip')).find(
      (c) => (c as HTMLElement).dataset.ppName === 'category',
    ) as HTMLElement;
    const rowsZone = container.querySelector('.pp-zone[data-zone="rows"]') as HTMLElement;
    const orig = document.elementFromPoint;
    (document as unknown as { elementFromPoint: () => Element }).elementFromPoint = () => rowsZone;
    try {
      pointer(chip, 'pointerdown', 10, 10);
      pointer(chip, 'pointermove', 12, 11); // within threshold — not a drag
      pointer(chip, 'pointerup', 12, 11);
    } finally {
      (document as unknown as { elementFromPoint: typeof orig }).elementFromPoint = orig;
    }
    expect(rowNames(pivot)).not.toContain('category');
    pivot.dispose();
  });
});
