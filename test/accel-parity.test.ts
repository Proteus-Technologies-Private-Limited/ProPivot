// DuckDB accelerator parity (docs/Architecture.md §5).
// Runs the SAME grouping-sets SQL the browser accelerator uses — here via duckdb-async
// in Node — and asserts the assembled matrix matches the built-in LocalEngine up to
// floating point. This pins the accelerator's correctness without a browser.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildStore } from '../src/core/store';
import { normalizeReport } from '../src/core/normalize';
import { buildMatrix, planBase, assembleMatrix } from '../src/core/planner';
import { applyFilters } from '../src/core/planner';
import { computeBaseCellsViaSql, ACCEL_TABLE, type SqlRunner } from '../src/core/accel/sql';
import { pathKey } from '../src/core/matrix';
import type { Report } from '../src/core/types';

const data = [
  { region: 'West', category: 'Furniture', year: 2023, sales: 1200, qty: 12, cost: 800 },
  { region: 'West', category: 'Furniture', year: 2024, sales: 1500, qty: 14, cost: 950 },
  { region: 'West', category: 'Tech', year: 2023, sales: 3000, qty: 10, cost: 2100 },
  { region: 'West', category: 'Tech', year: 2024, sales: 4200, qty: 14, cost: 2800 },
  { region: 'East', category: 'Furniture', year: 2023, sales: 600, qty: 8, cost: 420 },
  { region: 'East', category: 'Furniture', year: 2024, sales: 750, qty: 9, cost: 510 },
  { region: 'East', category: 'Tech', year: 2023, sales: 2100, qty: 7, cost: 1500 },
  { region: 'East', category: 'Tech', year: 2024, sales: 2600, qty: 9, cost: 1850 },
  { region: 'North', category: 'Furniture', year: 2023, sales: 900, qty: 10, cost: 600 },
  { region: 'North', category: 'Tech', year: 2024, sales: 5000, qty: 16, cost: 3300 },
];

// duckdb-async is a native dev dependency used only to run the SAME SQL the browser
// accelerator uses. If it can't load on this platform, skip rather than hard-fail.
let Database: typeof import('duckdb-async').Database | undefined;
try { ({ Database } = await import('duckdb-async')); } catch { /* skip below */ }
const available = !!Database;

let db: import('duckdb-async').Database;
let runner: SqlRunner;

beforeAll(async () => {
  if (!available) return;
  db = await Database!.create(':memory:');
  const tmp = join(process.env.TMPDIR ?? '/tmp', `propivot-accel-${process.pid}.json`);
  writeFileSync(tmp, JSON.stringify(data));
  await db.all(`CREATE TABLE ${ACCEL_TABLE} AS SELECT * FROM read_json_auto('${tmp}')`);
  runner = { query: (sql: string) => db.all(sql) as Promise<Array<Record<string, unknown>>> };
});

afterAll(async () => { await db?.close(); });

/** Compute a matrix through the DuckDB base path (shared assembleMatrix). */
async function duckMatrix(report: Report) {
  const store = buildStore(data as never);
  const normal = normalizeReport(report);
  const kindOf = (f: string) => store.columns.get(f)?.kind;
  const plan = planBase(normal.measures);
  const cellBase = await computeBaseCellsViaSql(runner, normal, plan, kindOf);
  if (!cellBase) return null; // unsupported -> caller would fall back
  const selection = applyFilters(store, normal);
  return assembleMatrix(store, normal, selection, plan, cellBase, normal.options.datePattern);
}

function tsMatrix(report: Report) {
  return buildMatrix(buildStore(data as never), normalizeReport(report));
}

/** Compare two matrices: structure exact, numeric cells within fp tolerance. */
function expectParity(a: ReturnType<typeof tsMatrix>, b: NonNullable<Awaited<ReturnType<typeof duckMatrix>>>) {
  expect(b.rowFields).toEqual(a.rowFields);
  expect(b.colFields).toEqual(a.colFields);
  expect(b.measures.map((m) => m.key)).toEqual(a.measures.map((m) => m.key));
  expect([...b.cells.keys()].sort()).toEqual([...a.cells.keys()].sort());
  for (const [k, av] of a.cells) {
    const bv = b.cells.get(k)!;
    if (Number.isNaN(av)) { expect(Number.isNaN(bv)).toBe(true); continue; }
    const denom = Math.max(1, Math.abs(av));
    expect(Math.abs(av - bv) / denom).toBeLessThan(1e-9);
  }
  // Formatted text should agree too (values round identically).
  for (const [k, at] of a.text) expect(b.text.get(k)).toBe(at);
}

const REPORTS: Array<{ name: string; report: Report }> = [
  {
    name: 'sum rows x cols + subtotals + grand',
    report: { dataSource: { type: 'json', data }, slice: {
      rows: [{ uniqueName: 'region' }, { uniqueName: 'category' }],
      columns: [{ uniqueName: 'year' }],
      measures: [{ uniqueName: 'sales', aggregation: 'sum' }],
    } },
  },
  {
    name: 'mixed aggregations over distinct fields',
    report: { dataSource: { type: 'json', data }, slice: {
      rows: [{ uniqueName: 'region' }],
      columns: [{ uniqueName: 'year' }],
      measures: [
        { uniqueName: 'sales', aggregation: 'sum' },
        { uniqueName: 'qty', aggregation: 'average' },
        { uniqueName: 'cost', aggregation: 'max' },
        { uniqueName: 'region', aggregation: 'count', caption: 'Rows' },
        { uniqueName: 'category', aggregation: 'distinctcount', caption: 'Cats' },
      ],
    } },
  },
  {
    name: 'holistic: median + stdev',
    report: { dataSource: { type: 'json', data }, slice: {
      rows: [{ uniqueName: 'region' }],
      measures: [
        { uniqueName: 'sales', aggregation: 'median' },
        { uniqueName: 'sales', aggregation: 'stdevp', caption: 'sp' },
        { uniqueName: 'sales', aggregation: 'stdevs', caption: 'ss' },
      ],
    } },
  },
  {
    name: 'ratios derived from sum base',
    report: { dataSource: { type: 'json', data }, slice: {
      rows: [{ uniqueName: 'region' }],
      columns: [{ uniqueName: 'year' }],
      measures: [{ uniqueName: 'sales', aggregation: 'percentofcolumn' }],
    } },
  },
  {
    name: 'calculated measure',
    report: { dataSource: { type: 'json', data }, slice: {
      rows: [{ uniqueName: 'region' }],
      measures: [{ uniqueName: 'aov', formula: "sum('sales')/sum('qty')", caption: 'AOV' }],
    } },
  },
  {
    name: 'positional runningtotals',
    report: { dataSource: { type: 'json', data }, slice: {
      rows: [{ uniqueName: 'region' }],
      columns: [{ uniqueName: 'year' }],
      measures: [{ uniqueName: 'sales', aggregation: 'runningtotals' }],
    } },
  },
  {
    name: 'member filter (WHERE IN)',
    report: { dataSource: { type: 'json', data }, slice: {
      rows: [{ uniqueName: 'region', filter: { type: 'members', members: ['West', 'East'] } }],
      columns: [{ uniqueName: 'category' }],
      measures: [{ uniqueName: 'sales', aggregation: 'sum' }],
    } },
  },
];

describe.skipIf(!available)('DuckDB accelerator parity vs LocalEngine', () => {
  for (const { name, report } of REPORTS) {
    it(name, async () => {
      const duck = await duckMatrix(report);
      expect(duck, 'report should be accelerator-supported').not.toBeNull();
      expectParity(tsMatrix(report), duck!);
    });
  }

  it('declines top/bottom-N (caller falls back)', async () => {
    const report: Report = { dataSource: { type: 'json', data }, slice: {
      rows: [{ uniqueName: 'region', filter: { type: 'top', measure: 'sales', quantity: 2 } }],
      measures: [{ uniqueName: 'sales', aggregation: 'sum' }],
    } };
    expect(await duckMatrix(report)).toBeNull();
  });
});
