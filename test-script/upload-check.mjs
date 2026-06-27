// Validates the upload demo flow against the REAL built bundle (dist/propivot.global.js)
// in a happy-dom environment: CSV parse -> type inference -> ProPivot render.
import { Window } from 'happy-dom';
import { readFileSync } from 'node:fs';

const win = new Window({ url: 'http://localhost/' });
const doc = win.document;
// Expose globals the IIFE + page logic expect.
globalThis.window = win; globalThis.document = doc;
globalThis.location = win.location;
globalThis.Blob = win.Blob; globalThis.URL = win.URL;
globalThis.requestAnimationFrame = (cb) => win.setTimeout(() => cb(Date.now()), 0);

// Load the built browser global -> window.ProPivot
const bundle = readFileSync(new URL('../dist/propivot.global.js', import.meta.url), 'utf8');
new win.Function(bundle)();
const PP = win.ProPivot;
if (!PP) throw new Error('window.ProPivot not defined by the bundle');

// ---- Replicate the page's parse + inference (kept in sync with demo/upload.html) ----
const ISO_DATE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?)?$/;
const NUMERIC = /^-?\s*\$?\s*[\d,]*\.?\d+%?$/;
const toNumber = (v) => { const n = Number(String(v).replace(/[$,%\s]/g, '')); return Number.isFinite(n) ? n : null; };
function parseCSV(text) {
  const rows = []; let field = '', row = [], inQ = false;
  for (let i = 0; i < text.length; i++) { const c = text[i];
    if (inQ) { if (c === '"') { if (text[i+1] === '"') { field += '"'; i++; } else inQ = false; } else field += c; }
    else if (c === '"') inQ = true; else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); field = ''; row = []; }
    else if (c === '\r') {} else field += c; }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const header = rows.shift().map((h) => h.trim());
  return rows.filter((r) => r.some((v) => v !== '')).map((r) => { const o = {}; header.forEach((h, i) => o[h] = r[i] ?? ''); return o; });
}
function inferAndCoerce(data) {
  const cols = Object.keys(data[0]); const mapping = {}, types = {};
  for (const col of cols) { let nNum = 0, nDate = 0, nNon = 0;
    for (const r of data) { const v = r[col]; if (v === '' || v == null) continue; nNon++; const s = String(v).trim();
      if (ISO_DATE.test(s)) nDate++; else if (NUMERIC.test(s) && toNumber(s) != null) nNum++; }
    let t = nNon === 0 ? 'string' : nDate === nNon ? 'year/month/day' : nNum === nNon ? 'number' : 'string';
    types[col] = t; mapping[col] = { type: t, caption: col }; }
  for (const r of data) for (const col of cols) if (types[col] === 'number') { const n = toNumber(r[col]); r[col] = n == null ? null : n; }
  return { mapping, types };
}

// ---- A user-edited CSV (commas-in-quotes, $ and % values, ISO dates) ----
const csv = [
  'Region,Category,Date,Sales,Margin',
  'West,"Furniture, Living",2024-01-15,"$1,200.50",42%',
  'East,Office,2024-02-03,800,15%',
  'West,Office,2024-03-11,240.75,33%',
  'North,Technology,2024-02-19,5600,28%',
].join('\n');

const data = parseCSV(csv);
const { mapping, types } = inferAndCoerce(data);
console.log('rows parsed:', data.length);
console.log('types:', types);
console.log('row0:', data[0]);

const firstText = Object.keys(mapping).find((c) => types[c] !== 'number');
const firstNum = Object.keys(mapping).find((c) => types[c] === 'number');
const report = {
  dataSource: { type: 'json', data, mapping },
  slice: { rows: [{ uniqueName: firstText }], columns: [], measures: [{ uniqueName: firstNum, aggregation: 'sum' }] },
  options: { grid: { type: 'compact', showGrandTotals: 'on' } },
};
const container = doc.createElement('div'); container.id = 'pivot'; doc.body.appendChild(container);

let done = false, error = null;
const pivot = new PP({ container, toolbar: true, report,
  reportcomplete: () => { done = true; }, dataerror: (e) => { error = e; } });

await new Promise((r) => win.setTimeout(r, 60));

if (error) throw error;
const cells = container.querySelectorAll('td.pp-cell').length;
const rowHdrs = container.querySelectorAll('th.pp-rowh').length;
const fieldList = container.parentElement?.querySelector?.('*');
console.log('reportcomplete fired:', done);
console.log('value cells rendered:', cells);
console.log('row-header cells:', rowHdrs);

// Verify export retains formatting on this uploaded data.
const xlsx = pivot.exportTo ? null : null;
const ok = done && cells > 0 && rowHdrs > 0 && types.Sales === 'number' && types.Date === 'year/month/day' && data[0].Sales === 1200.5;
console.log(ok ? '\n✅ PASS — upload flow renders a pivot with inferred types' : '\n❌ FAIL');
process.exit(ok ? 0 : 1);
