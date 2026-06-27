// A small, self-contained dataset + report so the starter runs with zero setup.
// Swap `data`/`mapping` for your own rows, and edit `report.slice` to pivot them.
import type { Report } from '@proteus/propivot';

const REGIONS = ['West', 'East', 'North', 'South'];
const CATEGORIES = ['Furniture', 'Office', 'Technology'];
const SEGMENTS = ['Consumer', 'Corporate', 'Home Office'];
const YEARS = [2023, 2024, 2025];
const QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];

const pad = (n: number) => String(n).padStart(2, '0');
const pick = <T,>(arr: T[]) => arr[(Math.random() * arr.length) | 0];

export interface SalesRow {
  region: string;
  category: string;
  segment: string;
  customer: string;
  orderDate: string;
  year: number;
  quarter: string;
  sales: number;
  qty: number;
  // Allow indexing by field name so a row is a valid ProPivot data record.
  [field: string]: string | number;
}

/** Generate `rows` random sales records. Try bumping this to 1_000_000. */
export function generateRows(rows = 20_000): SalesRow[] {
  const out: SalesRow[] = [];
  for (let i = 0; i < rows; i++) {
    const year = pick(YEARS);
    const month = (Math.random() * 12) | 0;
    const day = 1 + ((Math.random() * 28) | 0);
    out.push({
      region: pick(REGIONS),
      category: pick(CATEGORIES),
      segment: pick(SEGMENTS),
      customer: 'Cust-' + String(1 + ((Math.random() * 800) | 0)).padStart(4, '0'),
      orderDate: `${year}-${pad(month + 1)}-${pad(day)}`,
      year,
      quarter: QUARTERS[(month / 3) | 0],
      sales: Math.round(Math.random() * 6000),
      qty: 1 + ((Math.random() * 60) | 0),
    });
  }
  return out;
}

const mapping = {
  region: { type: 'string', caption: 'Region' },
  category: { type: 'string', caption: 'Category' },
  segment: { type: 'string', caption: 'Segment' },
  customer: { type: 'string', caption: 'Customer' },
  orderDate: { type: 'year/quarter/month/day', caption: 'Order Date' },
  year: { type: 'number', caption: 'Year' },
  quarter: { type: 'string', caption: 'Quarter' },
  sales: { type: 'number', caption: 'Sales' },
  qty: { type: 'number', caption: 'Quantity' },
} as const;

/** Build the ProPivot report object that drives the grid. */
export function buildReport(data: SalesRow[]): Report {
  return {
    dataSource: { type: 'json', data, mapping },
    slice: {
      rows: [{ uniqueName: 'region' }, { uniqueName: 'category' }],
      columns: [{ uniqueName: 'year' }],
      measures: [
        { uniqueName: 'sales', aggregation: 'sum', caption: 'Sales', format: 'cur' },
        { uniqueName: 'qty', aggregation: 'average', caption: 'Avg Qty', format: 'num' },
        { uniqueName: 'aov', formula: "sum('sales')/sum('qty')", caption: 'Avg Price', format: 'cur' },
      ],
    },
    formats: [
      { name: 'cur', currencySymbol: '$', thousandsSeparator: ',', decimalPlaces: 0 },
      { name: 'num', thousandsSeparator: ',', decimalPlaces: 1 },
    ],
    conditions: [
      { formula: '#value > 120000', measure: 'sales', format: { backgroundColor: '#c5e1a5', color: '#1b5e20' } },
      { formula: '#value < 20000', measure: 'sales', format: { color: '#b71c1c' } },
    ],
    options: { grid: { type: 'compact' } },
  };
}
