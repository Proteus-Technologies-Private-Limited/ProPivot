// Golden report corpus (docs/Architecture.md). Each entry is a
// self-contained Report whose recorded output is pinned in test/golden/expected/.
// The set is deliberately drawn across the contract surface so a single accidental
// behavior change anywhere in the engine breaks at least one golden:
//   values · formats · calculated formulas · subtotals/grand totals ·
//   top/bottom-N · sort-by-measure · positional difference-family ·
//   flat layout · multilevel date hierarchy · localization.
//
// Datasets are inline so a corpus file fully reproduces its own output with no
// external fixtures.

import type { Report } from '../../src/core/types';

/** Two regions × two categories × two years; varied numbers for stable, distinct totals. */
const sales = [
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

/** Date rows for the year/month/day hierarchy contract. */
const dated = [
  { region: 'West', d: '2023-01-15', sales: 100 },
  { region: 'West', d: '2023-02-20', sales: 150 },
  { region: 'West', d: '2024-01-10', sales: 200 },
  { region: 'East', d: '2023-03-05', sales: 50 },
  { region: 'East', d: '2024-02-28', sales: 75 },
];

const dateMapping = {
  region: { type: 'string' as const },
  d: { type: 'year/month/day' as const, caption: 'Order Date' },
  sales: { type: 'number' as const },
};

const currency = { name: 'cur', currencySymbol: '$', decimalPlaces: 0, thousandsSeparator: ',' };

export interface CorpusEntry {
  /** Used as the expected-file name (test/golden/expected/<name>.json). */
  name: string;
  /** One line on what contract surface this entry pins. */
  pins: string;
  report: Report;
}

export const corpus: CorpusEntry[] = [
  {
    name: 'basic-rows-cols-sum',
    pins: 'leaf cells, row/col subtotals, grand total for a single sum measure',
    report: {
      dataSource: { type: 'json', data: sales },
      slice: {
        rows: [{ uniqueName: 'region' }],
        columns: [{ uniqueName: 'year' }],
        measures: [{ uniqueName: 'sales', aggregation: 'sum' }],
      },
    },
  },
  {
    name: 'nested-rows-subtotals',
    pins: 'two-level row nesting (region > category) with subtotal rows',
    report: {
      dataSource: { type: 'json', data: sales },
      slice: {
        rows: [{ uniqueName: 'region' }, { uniqueName: 'category' }],
        columns: [{ uniqueName: 'year' }],
        measures: [{ uniqueName: 'sales', aggregation: 'sum' }],
      },
    },
  },
  {
    name: 'multi-measure-format-calculated',
    pins: 'multiple measures, currency format text, and a calculated-value formula',
    report: {
      dataSource: { type: 'json', data: sales },
      slice: {
        rows: [{ uniqueName: 'region' }],
        columns: [{ uniqueName: 'category' }],
        measures: [
          { uniqueName: 'sales', aggregation: 'sum', format: 'cur' },
          { uniqueName: 'qty', aggregation: 'sum' },
          { uniqueName: 'aov', formula: "sum('sales')/sum('qty')", caption: 'Avg Price', format: 'cur' },
        ],
      },
      formats: [currency],
    },
  },
  {
    // Aggregations coexisting over distinct fields. (Exhaustive per-aggregation
    // coverage lives in aggregations.test.ts.)
    name: 'aggregation-distinct-fields',
    pins: 'several aggregations coexisting over distinct fields (sum/average/max)',
    report: {
      dataSource: { type: 'json', data: sales },
      slice: {
        rows: [{ uniqueName: 'region' }],
        measures: [
          { uniqueName: 'sales', aggregation: 'sum', caption: 'Sum Sales' },
          { uniqueName: 'qty', aggregation: 'average', caption: 'Avg Qty' },
          { uniqueName: 'cost', aggregation: 'max', caption: 'Max Cost' },
        ],
      },
    },
  },
  {
    // Regression pin for the same-uniqueName collision fix: sum AND average of the
    // SAME field coexist. Each gets a distinct slot key (sales#0 / sales#1) so both
    // columns carry their own values instead of one shadowing the other.
    name: 'same-field-sum-and-average',
    pins: 'two measures over the same field (sum + average of sales) keep distinct cells',
    report: {
      dataSource: { type: 'json', data: sales },
      slice: {
        rows: [{ uniqueName: 'region' }],
        columns: [{ uniqueName: 'year' }],
        measures: [
          { uniqueName: 'sales', aggregation: 'sum', caption: 'Sum Sales' },
          { uniqueName: 'sales', aggregation: 'average', caption: 'Avg Sales' },
        ],
      },
    },
  },
  {
    name: 'positional-runningtotals',
    pins: 'runningtotals accumulates along the column axis',
    report: {
      dataSource: { type: 'json', data: sales },
      slice: {
        rows: [{ uniqueName: 'region' }],
        columns: [{ uniqueName: 'year' }],
        measures: [{ uniqueName: 'sales', aggregation: 'runningtotals' }],
      },
    },
  },
  {
    name: 'positional-runningtotals-rows',
    pins: 'positionalAxis:rows — runningtotals accumulates DOWN the row axis instead of across columns',
    report: {
      dataSource: { type: 'json', data: sales },
      slice: {
        rows: [{ uniqueName: 'region' }],
        columns: [{ uniqueName: 'year' }],
        measures: [{ uniqueName: 'sales', aggregation: 'runningtotals', positionalAxis: 'rows' }],
      },
    },
  },
  {
    name: 'positional-difference',
    pins: 'difference (current − previous) with first-column NaN sentinel',
    report: {
      dataSource: { type: 'json', data: sales },
      slice: {
        rows: [{ uniqueName: 'region' }],
        columns: [{ uniqueName: 'year' }],
        measures: [{ uniqueName: 'sales', aggregation: 'difference' }],
      },
    },
  },
  {
    name: 'positional-pct-difference',
    pins: '%difference ((current − previous)/previous) along columns',
    report: {
      dataSource: { type: 'json', data: sales },
      slice: {
        rows: [{ uniqueName: 'region' }],
        columns: [{ uniqueName: 'year' }],
        measures: [{ uniqueName: 'sales', aggregation: '%difference' }],
      },
    },
  },
  {
    name: 'top-n-by-measure',
    pins: 'Top-2 region filtering by sales',
    report: {
      dataSource: { type: 'json', data: sales },
      slice: {
        rows: [{ uniqueName: 'region', filter: { type: 'top', measure: 'sales', quantity: 2 } }],
        measures: [{ uniqueName: 'sales', aggregation: 'sum' }],
      },
    },
  },
  {
    name: 'sort-by-measure-desc',
    pins: 'rows ordered descending by a measure total',
    report: {
      dataSource: { type: 'json', data: sales },
      slice: {
        rows: [{ uniqueName: 'region' }],
        columns: [{ uniqueName: 'year' }],
        measures: [{ uniqueName: 'sales', aggregation: 'sum' }],
        sorting: { row: { measure: 'sales', type: 'desc' } },
      },
    },
  },
  {
    name: 'flat-layout',
    pins: 'flat grid mode emits the flat matrix while leaving the cube identical',
    report: {
      dataSource: { type: 'json', data: sales },
      slice: {
        rows: [{ uniqueName: 'region' }, { uniqueName: 'category' }],
        columns: [{ uniqueName: 'year' }],
        measures: [{ uniqueName: 'sales', aggregation: 'sum', format: 'cur' }],
      },
      formats: [currency],
      options: { grid: { type: 'flat' } },
    },
  },
  {
    name: 'date-hierarchy-ymd',
    pins: 'year/month/day date expansion with natural month ordering and level subtotals',
    report: {
      dataSource: { type: 'json', data: dated, mapping: dateMapping },
      slice: {
        rows: [{ uniqueName: 'd' }],
        columns: [{ uniqueName: 'region' }],
        measures: [{ uniqueName: 'sales', aggregation: 'sum' }],
      },
    },
  },
  {
    name: 'percent-of-column',
    pins: 'percentofcolumn rewrites each cell as its share of the column total',
    report: {
      dataSource: { type: 'json', data: sales },
      slice: {
        rows: [{ uniqueName: 'region' }],
        columns: [{ uniqueName: 'year' }],
        measures: [{ uniqueName: 'sales', aggregation: 'percentofcolumn' }],
      },
    },
  },
  {
    name: 'percent-of-row',
    pins: 'percentofrow rewrites each cell as its share of the row total',
    report: {
      dataSource: { type: 'json', data: sales },
      slice: {
        rows: [{ uniqueName: 'region' }],
        columns: [{ uniqueName: 'year' }],
        measures: [{ uniqueName: 'sales', aggregation: 'percentofrow' }],
      },
    },
  },
  {
    name: 'member-filter',
    pins: 'explicit member-include filter on a row field prunes the cube',
    report: {
      dataSource: { type: 'json', data: sales },
      slice: {
        rows: [{ uniqueName: 'region', filter: { type: 'members', members: ['West', 'East'] } }],
        columns: [{ uniqueName: 'category' }],
        measures: [{ uniqueName: 'sales', aggregation: 'sum' }],
      },
    },
  },
];
