import { useMemo, useState } from 'react';
// The pivot grid styles. Resolved from the @proteus/propivot package exports.
import '@proteus/propivot/propivot.css';
// `Pivot` is the React wrapper; `ProPivot` is the underlying instance type.
import { Pivot, type ProPivot } from '@proteus/propivot/react';
import { generateRows, buildReport } from './sampleData';

export default function App() {
  // Generate the dataset once; rebuild the report only when the data changes.
  const [rowCount] = useState(20_000);
  const data = useMemo(() => generateRows(rowCount), [rowCount]);
  const report = useMemo(() => buildReport(data), [data]);

  const [pivot, setPivot] = useState<ProPivot | null>(null);

  return (
    <div className="page">
      <header className="bar">
        <strong>ProPivot · React starter</strong>
        <span className="muted">{data.length.toLocaleString()} rows · client-side</span>
        <div className="spacer" />
        <button onClick={() => pivot?.expandAllData()}>Expand</button>
        <button onClick={() => pivot?.collapseAllData()}>Collapse</button>
        <button onClick={() => pivot?.exportTo('csv', { filename: 'propivot' })}>CSV</button>
        <button onClick={() => pivot?.exportTo('excel', { filename: 'propivot', excelSheetName: 'Report' })}>
          Excel
        </button>
      </header>

      {/* The grid fills the remaining height. Drag fields, double-click a cell to drill through, export. */}
      <Pivot
        report={report}
        toolbar
        className="grid"
        onReady={(p) => setPivot(p)}
      />
    </div>
  );
}
