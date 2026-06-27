import { describe, it, expect } from 'vitest';
import { parseCsv } from '../src/core/csv';
import { drillThroughRows } from '../src/core/drillthrough';
import { buildStore } from '../src/core/store';
import { normalizeReport } from '../src/core/normalize';
import { buildMatrix } from '../src/core/planner';
import { pathKey } from '../src/core/matrix';

describe('CSV ingestion', () => {
  it('parses comma-separated text with a header', () => {
    const { data, mapping } = parseCsv('region,sales\nWest,100\nEast,50');
    expect(data).toHaveLength(2);
    expect(data[0]).toEqual({ region: 'West', sales: '100' });
    expect(mapping.region.caption).toBe('region');
  });

  it('honors type prefixes (- number, + string)', () => {
    const { data, mapping } = parseCsv('+region,-sales\nWest,100');
    expect(mapping.region.type).toBe('string');
    expect(mapping.sales.type).toBe('number');
    expect(data[0].sales).toBe(100); // numeric
  });

  it('handles quoted fields with embedded commas, quotes, and newlines', () => {
    const text = 'name,note\n"Smith, John","said ""hi""\nthere"\nDoe,plain';
    const { data } = parseCsv(text);
    expect(data).toHaveLength(2);
    expect(data[0].name).toBe('Smith, John');
    expect(data[0].note).toBe('said "hi"\nthere');
    expect(data[1].name).toBe('Doe');
  });

  it('auto-detects semicolon separator', () => {
    const { data } = parseCsv('a;b\n1;2');
    expect(data[0]).toEqual({ a: '1', b: '2' });
  });

  it('feeds the pivot engine end-to-end', () => {
    const { data, mapping } = parseCsv('-amount,+region\n100,West\n50,West\n25,East');
    const m = buildMatrix(
      buildStore(data, mapping),
      normalizeReport({ dataSource: { type: 'json', data }, slice: { rows: [{ uniqueName: 'region' }], measures: [{ uniqueName: 'amount', aggregation: 'sum' }] } }),
    );
    expect(m.cells.get(pathKey(['West'], [], 'amount'))).toBe(150);
    expect(m.cells.get(pathKey([], [], 'amount'))).toBe(175);
  });
});

describe('drill-through', () => {
  const rawRows = [
    { region: 'West', cat: 'A', year: 2023, sales: 100 },
    { region: 'West', cat: 'A', year: 2024, sales: 150 },
    { region: 'West', cat: 'B', year: 2023, sales: 200 },
    { region: 'East', cat: 'A', year: 2023, sales: 50 },
  ];

  it('returns rows for a leaf cell (full row + col path)', () => {
    const rows = drillThroughRows(rawRows, {
      rowFields: ['region', 'cat'], rowPath: ['West', 'A'],
      colFields: ['year'], colPath: ['2023'],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].sales).toBe(100);
  });

  it('returns all rows under a subtotal (partial path)', () => {
    const rows = drillThroughRows(rawRows, {
      rowFields: ['region', 'cat'], rowPath: ['West'], // region subtotal
      colFields: ['year'], colPath: [],
    });
    expect(rows).toHaveLength(3); // all West rows
  });

  it('grand total (empty paths) returns everything', () => {
    const rows = drillThroughRows(rawRows, { rowFields: ['region'], rowPath: [], colFields: [], colPath: [] });
    expect(rows).toHaveLength(4);
  });

  it('respects the row limit', () => {
    const rows = drillThroughRows(rawRows, { rowFields: ['region'], rowPath: ['West'], colFields: [], colPath: [], limit: 2 });
    expect(rows).toHaveLength(2);
  });
});
