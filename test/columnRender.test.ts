// @vitest-environment happy-dom
//
// Render-level guards for the column-properties UX: presentation-only edits
// (resize / display / caption) must take effect WITHOUT a recompute — i.e. the
// renderer must not keep showing a stale measure — and the compact-mode row
// dimension must be reachable from a header ▾.
import { describe, it, expect } from 'vitest';
import { ProPivot } from '../src/facade/ProPivot';
import type { Report } from '../src/core/types';

const data = [
  { region: 'West', year: 2023, sales: 100 },
  { region: 'West', year: 2024, sales: 150 },
  { region: 'East', year: 2023, sales: 50 },
];

function mount(report: Report): Promise<{ p: ProPivot; c: HTMLElement }> {
  const c = document.createElement('div');
  document.body.appendChild(c);
  return new Promise((resolve) => {
    const p = new ProPivot({
      container: c,
      report: { ...report, options: { ...report.options, configuratorButton: false } },
      reportcomplete: () => resolve({ p, c }),
    });
  });
}

const baseReport: Report = {
  dataSource: { type: 'json', data },
  slice: { rows: [{ uniqueName: 'region' }], columns: [{ uniqueName: 'year' }], measures: [{ uniqueName: 'sales', aggregation: 'sum' }] },
};

describe('column render-only updates take effect without recompute', () => {
  it('setColumnWidth on a measure reaches the <colgroup>', async () => {
    const { p, c } = await mount(baseReport);
    p.setColumnWidth({ kind: 'measure', uniqueName: 'sales', key: 'sales' }, 150);
    const widths = [...c.querySelectorAll('colgroup col')].map((x) => (x as HTMLElement).style.width);
    expect(widths).toContain('150px');
  });

  it('setColumnWidth on a row field reaches the <colgroup>', async () => {
    const { p, c } = await mount(baseReport);
    p.setColumnWidth({ kind: 'field', uniqueName: 'region' }, 120);
    const widths = [...c.querySelectorAll('colgroup col')].map((x) => (x as HTMLElement).style.width);
    expect(widths).toContain('120px');
  });

  it('setColumnDisplay on a measure renders rich markup immediately', async () => {
    const { p, c } = await mount(baseReport);
    p.setColumnDisplay({ kind: 'measure', uniqueName: 'sales', key: 'sales' }, { type: 'data_bar', min: 0, max: 200, color: 'blue' });
    // The data-bar wraps the value in an absolutely-positioned fill span.
    expect(c.querySelector('tbody')!.innerHTML).toContain('position:absolute');
  });

  it('setColumnCaption on a measure updates the header immediately', async () => {
    const { p, c } = await mount(baseReport);
    p.setColumnCaption({ kind: 'measure', uniqueName: 'sales', key: 'sales' }, 'Revenue');
    expect(c.querySelector('thead')!.textContent).toContain('Revenue');
  });

  it('compact-mode row dimension is reachable via a header ▾', async () => {
    const { c } = await mount(baseReport);
    expect(c.querySelector('.pp-corner .pp-colprops')).toBeTruthy();
  });
});
