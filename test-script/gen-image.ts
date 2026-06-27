import { buildStore } from '../src/core/store';
import { normalizeReport } from '../src/core/normalize';
import { buildMatrix } from '../src/core/planner';
import { exportMatrix } from '../src/export';
import { writeFileSync } from 'node:fs';

const data = [
  { region: 'West', category: 'Furniture', year: 2023, sales: 1200, qty: 12 },
  { region: 'West', category: 'Tech', year: 2024, sales: 4200, qty: 14 },
  { region: 'East', category: 'Furniture', year: 2023, sales: 600, qty: 8 },
  { region: 'East', category: 'Tech', year: 2024, sales: 2600, qty: 9 },
];
const report = {
  dataSource: { type: 'json' as const, data },
  slice: {
    rows: [{ uniqueName: 'region' }, { uniqueName: 'category' }],
    columns: [{ uniqueName: 'year' }],
    measures: [
      { uniqueName: 'sales', aggregation: 'sum' as const, format: 'cur' },
      { uniqueName: 'qty', aggregation: 'sum' as const },
    ],
  },
  formats: [{ name: 'cur', currencySymbol: '$', decimalPlaces: 0, thousandsSeparator: ',' }],
};
const normal = normalizeReport(report as never);
const matrix = buildMatrix(buildStore(data as never), normal);
const svg = exportMatrix('image', matrix, normal, { filename: 'Sales by Region' }) as string;
writeFileSync('test-script/output/sample.svg', svg);
console.log('wrote test-script/output/sample.svg', svg.length, 'bytes');
console.log(svg.split('\n').slice(0, 6).join('\n'));
