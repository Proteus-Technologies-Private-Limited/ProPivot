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

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));

describe('cellclick carries the full cell context (row + column tuple)', () => {
  it('a value-cell click reports the row/column members, measure and value', async () => {
    const { p, c } = await mount(baseReport);
    let ev: any;
    p.on('cellclick', (d) => { ev = d; });
    (c.querySelector('tbody td') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(ev.type).toBe('value');
    expect(ev.rows[0]).toMatchObject({ uniqueName: 'region' });
    expect(typeof ev.rows[0].member).toBe('string');
    expect(ev.columns[0]).toMatchObject({ uniqueName: 'year' });
    expect(ev.measure).toMatchObject({ uniqueName: 'sales' });
  });

  it('clicking a row member header fires a header cellclick with the tuple', async () => {
    const { p, c } = await mount(baseReport);
    let ev: any;
    p.on('cellclick', (d) => { ev = d; });
    (c.querySelector('tbody .pp-rowh') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(ev.type).toBe('header');
    expect(ev.rows.length).toBeGreaterThan(0);
    expect(typeof ev.rows[0].member).toBe('string');
  });

  it('clicking a column member header fires a header cellclick on the column axis', async () => {
    const { p, c } = await mount(baseReport);
    let ev: any;
    p.on('cellclick', (d) => { ev = d; });
    (c.querySelector('thead .pp-colh') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(ev.type).toBe('header');
    expect(ev.columns.length).toBeGreaterThan(0);
  });
});

describe('date hierarchy (year/month/day) auto-expands and is filterable', () => {
  const dateReport: Report = {
    dataSource: { type: 'json', data: [
      { d: '2023-02-11', s: 1 }, { d: '2023-08-04', s: 1 }, { d: '2024-03-22', s: 1 }, { d: '2024-09-30', s: 1 },
    ], mapping: { d: { type: 'year/month/day', caption: 'Date' } } },
    slice: { rows: [{ uniqueName: 'd' }], measures: [{ uniqueName: 's', aggregation: 'sum' }] },
  };

  it('expands a single date field into Year / Month / Day levels', async () => {
    const { p } = await mount(dateReport);
    expect(p.getMembers('Date (Year)')).toEqual(expect.arrayContaining(['2023', '2024']));
    expect(p.getMembers('Date (Month)')).toEqual(expect.arrayContaining(['February', 'March']));
    expect(p.getMembers('Date (Day)')).toEqual(expect.arrayContaining(['11', '22']));
  });

  it('filtering an expanded date level reduces the rendered data', async () => {
    const { p, c } = await mount(dateReport);
    const before = c.querySelectorAll('tbody tr').length;
    p.setFilter('Date (Year)', ['2024']);
    await tick();
    const after = c.querySelectorAll('tbody tr').length;
    expect(p.getReport().slice!.fieldFilters!['Date (Year)']).toMatchObject({ members: ['2024'] });
    expect(after).toBeLessThan(before);
  });
});
