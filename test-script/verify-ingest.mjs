import { ProPivot, parseDataset, inferMapping, buildStarterReport } from '../dist/index.js';

let failures = 0;
const ok = (cond, msg) => { if (!cond) { failures++; console.error('FAIL:', msg); } else console.log('ok  -', msg); };

// 1) CSV string with no mapping → inferred types + coercion
const csv = `Region,Category,Date,Sales,Share
West,Furniture,2024-01-15,"$1,200.50",42%
East,Office,2024-03-11,240.75,8%
North,Technology,2024-02-19,5600,15%`;
const r1 = parseDataset(csv);
ok(r1.mapping.Region.type === 'string', 'CSV: Region → string');
ok(r1.mapping.Sales.type === 'number', 'CSV: Sales → number');
ok(r1.mapping.Share.type === 'number', 'CSV: Share(42%) → number');
ok(r1.mapping.Date.type === 'year/month/day', 'CSV: ISO Date → year/month/day');
ok(r1.data[0].Sales === 1200.5, 'CSV: "$1,200.50" coerced to 1200.5, got ' + r1.data[0].Sales);
ok(r1.data[0].Share === 42, 'CSV: "42%" coerced to 42, got ' + r1.data[0].Share);

// 2) JSON array of objects
const arr = [
  { City: 'NYC', Year: 2023, Revenue: 100 },
  { City: 'LA',  Year: 2024, Revenue: 200 },
];
const m = inferMapping(arr);
ok(m.Revenue.type === 'number', 'JSON: Revenue → number');
ok(m.Year.type === 'number', 'JSON: Year(2023) → number');
ok(m.City.type === 'string', 'JSON: City → string');

// 3) starter report picks first dim → rows, first number → measures
const rep = buildStarterReport(arr, m);
ok(rep.slice.rows[0].uniqueName === 'City', 'starter: rows = City');
ok(rep.slice.measures[0].uniqueName === 'Revenue' && rep.slice.measures[0].aggregation === 'sum', 'starter: sum(Revenue)');

// 4) static inferReport from JSON text + an override slice
const jsonText = JSON.stringify(arr);
const rep2 = ProPivot.inferReport(jsonText, { report: { options: { grid: { type: 'flat' } } } });
ok(rep2.dataSource.data.length === 2, 'inferReport: JSON text parsed (2 rows)');
ok(rep2.options.grid.type === 'flat', 'inferReport: report override merged (grid.flat)');

// 5) explicit mapping seed wins over inference
const seeded = parseDataset(arr, { mapping: { Year: { type: 'string' } } });
ok(seeded.mapping.Year.type === 'string', 'seed: explicit Year=string overrides number guess');

// 6) error handling
let threw = false;
try { parseDataset(''); } catch { threw = true; }
ok(threw, 'empty input throws');

console.log(failures ? `\n${failures} FAILURE(S)` : '\nALL PASSED');
process.exit(failures ? 1 : 0);
