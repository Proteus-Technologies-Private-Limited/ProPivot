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

  it('shows a before/after insertion indicator on the chip under the pointer, then reorders', async () => {
    const twoRows: Report = {
      dataSource: { type: 'json', data: DATA, mapping },
      slice: {
        rows: [{ uniqueName: 'region' }, { uniqueName: 'category' }],
        measures: [{ uniqueName: 'sales', aggregation: 'sum' }],
      },
    } as Report;
    const { container, pivot } = await mount(twoRows);
    const chips = Array.from(container.querySelectorAll('.pp-zone[data-zone="rows"] .pp-chip')) as HTMLElement[];
    const regionChip = chips.find((c) => c.dataset.ppName === 'region')!;
    const categoryChip = chips.find((c) => c.dataset.ppName === 'category')!;

    // Stand in for layout: the pointer is "over" the region chip, whose top half
    // (y < midpoint 110) means "insert before".
    regionChip.getBoundingClientRect = () =>
      ({ top: 100, height: 20, bottom: 120, left: 0, width: 100, right: 100, x: 0, y: 100, toJSON() {} }) as DOMRect;
    const orig = document.elementFromPoint;
    (document as unknown as { elementFromPoint: () => Element }).elementFromPoint = () => regionChip;
    try {
      pointer(categoryChip, 'pointerdown', 10, 200);
      pointer(categoryChip, 'pointermove', 40, 105); // over region chip, top half
      // The insertion line is shown on the target — the lost-then-restored indicator.
      expect(regionChip.classList.contains('pp-chip-drop-before')).toBe(true);
      pointer(categoryChip, 'pointerup', 40, 105);
    } finally {
      (document as unknown as { elementFromPoint: typeof orig }).elementFromPoint = orig;
    }
    // Dropped before region → category now leads the Rows zone…
    expect(rowNames(pivot)).toEqual(['category', 'region']);
    // …and the indicator is cleared once the drag ends.
    expect(regionChip.classList.contains('pp-chip-drop-before')).toBe(false);
    pivot.dispose();
  });

  it('renders the field list inline by default (no ⚙ button)', async () => {
    const { container, pivot } = await mount(report);
    expect(container.querySelector('.pp-fieldlist')).toBeTruthy();
    expect(container.querySelector('.pp-fieldlist-btn')).toBeNull();
    pivot.dispose();
  });

  it('fieldList.mode "icon" shows a ⚙ button that opens the rearrange UI in a modal', async () => {
    document.querySelectorAll('.pp-fieldlist-modal').forEach((n) => n.remove());
    const { container, pivot } = await mount({
      ...report,
      options: { fieldList: { mode: 'icon', placement: 'top-left' } },
    } as Report);
    // No inline panel; a gear button instead.
    expect(container.querySelector('.pp-fieldlist')).toBeNull();
    const btn = container.querySelector('.pp-fieldlist-btn') as HTMLElement;
    expect(btn).toBeTruthy();
    expect(btn.classList.contains('pp-fl-top-left')).toBe(true);
    // Opening it surfaces the field list (with its zones) inside a modal.
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const modal = document.querySelector('.pp-fieldlist-modal') as HTMLElement;
    expect(modal).toBeTruthy();
    expect(modal.querySelector('.pp-fieldlist .pp-zone[data-zone="rows"]')).toBeTruthy();
    pivot.dispose(); // disposing also closes the modal
    expect(document.querySelector('.pp-fieldlist-modal')).toBeNull();
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
