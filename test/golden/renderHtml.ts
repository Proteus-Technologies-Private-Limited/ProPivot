// Render-layer golden helper (docs/Golden Tests.md). Drives the real ProPivot facade
// in a headless DOM, then normalizes the rendered `.pp-table` into a deterministic JSON
// shape. This pins the RENDER contract that the engine matrix can't: layout modes
// (compact/flat/classic), grand-total position, conditional-format styling,
// localization labels, and customizeCell output.
//
// Requires a DOM — the consuming test file declares `// @vitest-environment happy-dom`.

import { ProPivot } from '../../src/facade/ProPivot';
import type { Report } from '../../src/core/types';
import type { CellData } from '../../src/facade/cell';

export interface RenderOptions {
  customizeCell?: (cell: unknown, data: CellData) => void;
}

interface SnapCell {
  /** 'th' (header / row-header) or 'td' (value). */
  tag: string;
  /** innerHTML for value cells, textContent for headers. */
  text: string;
  /** className, or omitted when empty. */
  cls?: string;
  /** Inline style cssText (conditional formats + customizeCell), omitted when empty. */
  style?: string;
  /** rowSpan / colSpan, omitted when 1. */
  rs?: number;
  cs?: number;
}

export interface RenderSnapshot {
  head: SnapCell[][];
  body: SnapCell[][];
}

function snapCell(el: Element): SnapCell {
  const he = el as HTMLElement;
  const cell: SnapCell = { tag: el.tagName.toLowerCase(), text: he.innerHTML };
  const cls = he.getAttribute('class');
  if (cls) cell.cls = cls;
  const style = he.style?.cssText;
  if (style) cell.style = style;
  const rs = Number((el as HTMLTableCellElement).rowSpan ?? 1);
  const cs = Number((el as HTMLTableCellElement).colSpan ?? 1);
  if (rs > 1) cell.rs = rs;
  if (cs > 1) cell.cs = cs;
  return cell;
}

function snapRows(rows: NodeListOf<Element> | Element[]): SnapCell[][] {
  return Array.from(rows).map((tr) => Array.from(tr.children).map(snapCell));
}

/**
 * Render a report through the facade and return a normalized snapshot of `.pp-table`.
 * Resolves once the facade emits `reportcomplete` (compute + DOM render finished).
 */
export function renderSnapshot(report: Report, opts: RenderOptions = {}): Promise<RenderSnapshot> {
  const container = document.createElement('div');
  document.body.appendChild(container);

  return new Promise<RenderSnapshot>((resolve, reject) => {
    let pivot: ProPivot | null = null;
    const finish = () => {
      try {
        const table = container.querySelector('.pp-table');
        if (!table) throw new Error('no .pp-table rendered');
        const snapshot: RenderSnapshot = {
          head: snapRows(table.querySelectorAll('thead tr')),
          body: snapRows(table.querySelectorAll('tbody tr')),
        };
        resolve(snapshot);
      } catch (e) {
        reject(e as Error);
      } finally {
        pivot?.dispose?.();
        container.remove();
      }
    };
    try {
      pivot = new ProPivot({
        container,
        // Drop the configurator/toolbar chrome so the snapshot is just the grid.
        report: { ...report, options: { ...report.options, configuratorButton: false } },
        customizeCell: opts.customizeCell,
        reportcomplete: finish,
      });
    } catch (e) {
      container.remove();
      reject(e as Error);
    }
  });
}
