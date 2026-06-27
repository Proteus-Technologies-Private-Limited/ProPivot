import { describe, it, expect } from 'vitest';
import {
  parseDataset, inferMapping, inferSchema, coerceData, parseNumber, buildStarterReport,
} from '../src/core/ingest';
import { ProPivot } from '../src/facade/ProPivot';

describe('ingest — schema inference from raw data', () => {
  it('parses CSV text, infers types, and coerces loose numbers', () => {
    const csv = [
      'Region,Category,Date,Sales,Share',
      'West,Furniture,2024-01-15,"$1,200.50",42%',
      'East,Office,2024-03-11,240.75,8%',
      'North,Technology,2024-02-19,5600,15%',
    ].join('\n');
    const { data, mapping } = parseDataset(csv);
    expect(mapping.Region.type).toBe('string');
    expect(mapping.Sales.type).toBe('number');
    expect(mapping.Share.type).toBe('number');
    expect(mapping.Date.type).toBe('year/month/day');
    expect(data[0].Sales).toBe(1200.5);
    expect(data[0].Share).toBe(42);
  });

  it('infers types from an array of row objects', () => {
    const arr = [
      { City: 'NYC', Year: 2023, Revenue: 100 },
      { City: 'LA', Year: 2024, Revenue: 200 },
    ];
    const m = inferMapping(arr);
    expect(m.City.type).toBe('string');
    expect(m.Year.type).toBe('number');
    expect(m.Revenue.type).toBe('number');
  });

  it('respects an explicit mapping seed over the value guess', () => {
    const arr = [{ Year: 2023, V: 1 }, { Year: 2024, V: 2 }];
    const { mapping } = inferSchema(arr, { mapping: { Year: { type: 'string' } } });
    expect(mapping.Year.type).toBe('string');
  });

  it('keeps ISO dates flat when dateHierarchy is disabled, datetime when timed', () => {
    const arr = [{ d: '2024-01-15' }, { d: '2024-02-20' }];
    expect(inferMapping(arr).d.type).toBe('year/month/day');
    expect(inferMapping(arr, { dateHierarchy: false }).d.type).toBe('date');
    const timed = [{ d: '2024-01-15T08:30:00' }, { d: '2024-02-20T09:00:00' }];
    expect(inferMapping(timed).d.type).toBe('datetime');
  });

  it('parseNumber handles currency, percent, thousands, and rejects junk', () => {
    expect(parseNumber('$1,234.50')).toBe(1234.5);
    expect(parseNumber('42%')).toBe(42);
    expect(parseNumber(7)).toBe(7);
    expect(parseNumber('abc')).toBeNull();
    expect(parseNumber('')).toBeNull();
  });

  it('coerceData rewrites only number columns in place', () => {
    const arr = [{ a: '10', b: 'x' }];
    coerceData(arr, { a: { type: 'number' }, b: { type: 'string' } });
    expect(arr[0].a).toBe(10);
    expect(arr[0].b).toBe('x');
  });

  it('builds a starter report: first dimension → rows, first real metric → summed measure', () => {
    const arr = [
      { City: 'NYC', Year: 2023, Revenue: 100 },
      { City: 'LA', Year: 2024, Revenue: 200 },
    ];
    const { data, mapping } = inferSchema(arr);
    const rep = buildStarterReport(data, mapping);
    expect(rep.slice!.rows![0].uniqueName).toBe('City');
    // Year is integer-in-range so it is skipped in favour of Revenue.
    expect(rep.slice!.measures![0].uniqueName).toBe('Revenue');
    expect(rep.slice!.measures![0].aggregation).toBe('sum');
  });

  it('throws descriptive errors for empty / malformed input', () => {
    expect(() => parseDataset('')).toThrow(/empty/i);
    expect(() => parseDataset('[1,2,3', {})).toThrow(/JSON/i);
    expect(() => parseDataset([])).toThrow(/No rows/i);
  });
});

describe('ingest — facade integration', () => {
  it('ProPivot.inferReport returns a renderable report and merges overrides', () => {
    const json = JSON.stringify([{ City: 'NYC', Revenue: 100 }, { City: 'LA', Revenue: 200 }]);
    const rep = ProPivot.inferReport(json, { report: { options: { grid: { type: 'flat' } } } });
    expect(rep.dataSource!.data!.length).toBe(2);
    expect(rep.options!.grid!.type).toBe('flat');
    expect(rep.slice!.measures![0].uniqueName).toBe('Revenue');
  });

  it('pivot.loadData ingests raw rows and computes a cube', () => {
    const p = new ProPivot({ container: '#none' });
    const rep = p.loadData([
      { Region: 'West', Sales: 100 },
      { Region: 'East', Sales: 250 },
    ]);
    expect(rep.slice!.rows![0].uniqueName).toBe('Region');
    const got = p.getReport();
    expect(got.dataSource!.mapping!.Sales.type).toBe('number');
  });
});
