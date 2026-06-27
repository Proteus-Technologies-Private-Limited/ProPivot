import { Window } from 'happy-dom';

// Set up a browser-like global environment (mirrors the demo page).
const win = new Window();
globalThis.window = win;
globalThis.document = win.document;
globalThis.HTMLElement = win.HTMLElement;
globalThis.getComputedStyle = win.getComputedStyle.bind(win);

const { ProPivot } = await import('../dist/index.js');

document.body.innerHTML = '<div id="pivot" style="height:400px"></div>';
const pivot = new ProPivot({ container: '#pivot', toolbar: true });

let fail = 0;
const ok = (c, m) => { if (!c) { fail++; console.error('FAIL:', m); } else console.log('ok  -', m); };

// 1) Load an array of rows (built-in sample path)
const SAMPLE = [
  { Region: 'West', Category: 'Furniture', Date: '2024-01-15', Sales: 1200.5, Quantity: 4 },
  { Region: 'East', Category: 'Office',    Date: '2024-03-11', Sales: 240.75, Quantity: 12 },
  { Region: 'West', Category: 'Office',    Date: '2024-03-05', Sales: 320,    Quantity: 8 },
];
const rep = pivot.loadData(SAMPLE.map((r) => ({ ...r })));
await new Promise((r) => setTimeout(r, 50)); // setReport computes async
ok(rep.dataSource.mapping.Sales.type === 'number', 'array: Sales inferred number');
ok(rep.slice.rows[0].uniqueName === 'Region', 'array: rows=Region');
ok(rep.slice.measures[0].uniqueName === 'Sales', 'array: measure=Sales (Quantity not Date/Year-like)');
const html1 = document.getElementById('pivot').innerHTML;
ok(html1.length > 200, 'array: grid rendered into #pivot (' + html1.length + ' chars)');
ok(html1.includes('West') || html1.includes('Region'), 'array: rendered content includes data');

// 2) Field list reflects inferred columns
const fields = pivot.getAllHierarchies().map((h) => h.uniqueName);
ok(['Region','Category','Sales','Quantity'].every((c) => fields.includes(c)), 'field list has inferred columns: ' + fields.join(','));

// 3) Load CSV text on the SAME instance (re-pivot)
const csv = 'City,Year,Revenue\nNYC,2023,100\nLA,2024,250\nNYC,2024,300';
const rep2 = pivot.loadData(csv);
await new Promise((r) => setTimeout(r, 50));
ok(rep2.dataSource.mapping.Revenue.type === 'number', 'csv: Revenue number');
ok(rep2.slice.measures[0].uniqueName === 'Revenue', 'csv: measure=Revenue (Year skipped as year-like)');
const html2 = document.getElementById('pivot').innerHTML;
ok(html2.includes('NYC') || html2.includes('City'), 'csv: re-rendered with new data');

console.log(fail ? `\n${fail} FAILURE(S)` : '\nALL DOM CHECKS PASSED');
process.exit(fail ? 1 : 0);
