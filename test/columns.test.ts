import { describe, it, expect } from 'vitest';
import { ProPivot } from '../src/facade/ProPivot';

const data = [
  { region: 'West', year: 2023, sales: 100, qty: 2 },
  { region: 'East', year: 2024, sales: 200, qty: 5 },
];

const make = () => new ProPivot({
  container: '#none',
  report: {
    dataSource: { type: 'json', data },
    slice: {
      rows: [{ uniqueName: 'region' }],
      columns: [{ uniqueName: 'year' }],
      measures: [{ uniqueName: 'sales', aggregation: 'sum' }],
    },
  },
});

describe('column-properties facade (no DOM)', () => {
  it('setColumnWidth stores width on the measure and emits columnresize', () => {
    const p = make();
    let evt: { width?: number } = {};
    p.on('columnresize', (e) => { evt = e as typeof evt; });
    p.setColumnWidth({ kind: 'measure', uniqueName: 'sales', key: 'sales' }, 140);
    expect(p.getReport().slice!.measures![0].width).toBe(140);
    expect(evt.width).toBe(140);
  });

  it('setColumnWidth on a field stores width on the hierarchy', () => {
    const p = make();
    p.setColumnWidth({ kind: 'field', uniqueName: 'region' }, 90);
    expect(p.getReport().slice!.rows![0].width).toBe(90);
  });

  it('setColumnDisplay sets and clears the display format', () => {
    const p = make();
    p.setColumnDisplay({ kind: 'measure', uniqueName: 'sales', key: 'sales' }, { type: 'data_bar' });
    expect(p.getReport().slice!.measures![0].display).toEqual({ type: 'data_bar' });
    p.setColumnDisplay({ kind: 'measure', uniqueName: 'sales', key: 'sales' }, null);
    expect(p.getReport().slice!.measures![0].display).toBeUndefined();
  });

  it('setColumnCaption renames a column and emits columnpropertychange', () => {
    const p = make();
    let evt: { property?: string } = {};
    p.on('columnpropertychange', (e) => { evt = e as typeof evt; });
    p.setColumnCaption({ kind: 'field', uniqueName: 'region' }, 'Area');
    expect(p.getReport().slice!.rows![0].caption).toBe('Area');
    expect(evt.property).toBe('caption');
  });

  it('reorderColumn moves a field into columns, preserving its object', () => {
    const p = make();
    p.setColumnWidth({ kind: 'field', uniqueName: 'region' }, 77);
    let evt: Record<string, unknown> = {};
    p.on('columnreorder', (e) => { evt = e as typeof evt; });
    p.reorderColumn('region', 'columns', 0);
    const r = p.getReport();
    expect(r.slice!.rows).toEqual([]);
    const moved = r.slice!.columns!.find((h) => h.uniqueName === 'region');
    expect(moved).toBeTruthy();
    expect(moved!.width).toBe(77); // width rode along
    expect(evt).toMatchObject({ uniqueName: 'region', toZone: 'columns' });
  });

  it('reorderColumn reorders measures within the values zone', () => {
    const p = new ProPivot({
      container: '#none',
      report: {
        dataSource: { type: 'json', data },
        slice: {
          rows: [{ uniqueName: 'region' }],
          measures: [{ uniqueName: 'sales', aggregation: 'sum' }, { uniqueName: 'qty', aggregation: 'sum' }],
        },
      },
    });
    p.reorderColumn('qty', 'measures', 0);
    expect(p.getReport().slice!.measures!.map((m) => m.uniqueName)).toEqual(['qty', 'sales']);
  });

  it('reorderColumn moves an earlier measure down to a later target (drop = before target)', () => {
    const p = new ProPivot({
      container: '#none',
      report: {
        dataSource: { type: 'json', data },
        slice: {
          rows: [{ uniqueName: 'region' }],
          measures: [
            { uniqueName: 'sales', aggregation: 'sum' },
            { uniqueName: 'qty', aggregation: 'sum' },
            { uniqueName: 'sales', aggregation: 'average' },
          ],
        },
      },
    });
    // Drop the first measure (index 0) onto the third (index 2). Detaching it shifts
    // the target to index 1, so it must land BEFORE the target: [qty, sales-sum, sales-avg].
    p.reorderColumn('sales', 'measures', 2);
    const m = p.getReport().slice!.measures!;
    expect(m.map((x) => x.aggregation)).toEqual(['sum', 'sum', 'average']);
    expect(m.map((x) => x.uniqueName)).toEqual(['qty', 'sales', 'sales']);
  });

  it('reorderColumn moves a later row field up to an earlier target', () => {
    const p = new ProPivot({
      container: '#none',
      report: {
        dataSource: { type: 'json', data },
        slice: {
          rows: [{ uniqueName: 'region' }, { uniqueName: 'year' }],
          measures: [{ uniqueName: 'sales', aggregation: 'sum' }],
        },
      },
    });
    // Drag the lower field (index 1) up onto the first (index 0): target keeps its index.
    p.reorderColumn('year', 'rows', 0);
    expect(p.getReport().slice!.rows!.map((h) => h.uniqueName)).toEqual(['year', 'region']);
  });

  it('reorderColumn carries a custom caption across a zone change (measure → columns)', () => {
    const p = new ProPivot({
      container: '#none',
      report: {
        dataSource: { type: 'json', data },
        slice: {
          rows: [{ uniqueName: 'region' }],
          columns: [{ uniqueName: 'year' }],
          // uniqueName 'qty' but a custom heading — must survive the move to columns.
          measures: [{ uniqueName: 'qty', aggregation: 'sum', caption: 'Units' }],
        },
      },
    });
    p.reorderColumn('qty', 'columns', 1, { zone: 'measures', index: 0 });
    const moved = p.getReport().slice!.columns!.find((h) => h.uniqueName === 'qty');
    expect(moved!.caption).toBe('Units'); // not the raw 'qty'
    expect(p.getReport().slice!.measures).toEqual([]);
  });

  it('moveField carries a custom caption across a zone change', () => {
    const p = new ProPivot({
      container: '#none',
      report: {
        dataSource: { type: 'json', data },
        slice: {
          rows: [{ uniqueName: 'region' }],
          measures: [{ uniqueName: 'qty', aggregation: 'sum', caption: 'Units' }],
        },
      },
    });
    p.moveField('qty', 'columns');
    expect(p.getReport().slice!.columns!.find((h) => h.uniqueName === 'qty')!.caption).toBe('Units');
  });

  it('reorderColumn with a pinned source reorders the dragged duplicate measure, not the first match', () => {
    const p = new ProPivot({
      container: '#none',
      report: {
        dataSource: { type: 'json', data },
        slice: {
          rows: [{ uniqueName: 'region' }],
          measures: [
            { uniqueName: 'sales', aggregation: 'sum', caption: 'Total' },
            { uniqueName: 'sales', aggregation: 'average', caption: 'Avg' },
            { uniqueName: 'qty', aggregation: 'sum', caption: 'Units' },
          ],
        },
      },
    });
    // Drag the SECOND 'sales' (index 1, "Avg") to the front. Without a pinned
    // source this would detach the first 'sales' instead.
    p.reorderColumn('sales', 'measures', 0, { zone: 'measures', index: 1 });
    const m = p.getReport().slice!.measures!;
    expect(m.map((x) => x.caption)).toEqual(['Avg', 'Total', 'Units']);
    expect(m.map((x) => x.aggregation)).toEqual(['average', 'sum', 'sum']);
  });

  it('setTopN applies and clears a top-N filter on the first row field', () => {
    const p = make();
    p.setTopN('sales', 'top', 5);
    expect(p.getReport().slice!.rows![0].filter).toMatchObject({ type: 'top', measure: 'sales', quantity: 5 });
    p.setTopN('sales', 'off', 5);
    expect(p.getReport().slice!.rows![0].filter).toBeUndefined();
  });
});
