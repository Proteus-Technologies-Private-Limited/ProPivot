# ProPivot architecture

ProPivot is a **100% client-side** pivot grid engine. Ingestion, aggregation, formatting,
and rendering all happen in the browser (or WebView) — there is no server round-trip. The
library is organized as a framework-agnostic core behind a stable facade, with an optional
Web Worker and DOM renderer layered on top.

```
src/
├─ core/        framework-agnostic engine (also runs inside a Worker)
│  ├─ types.ts        report schema + public type surface
│  ├─ normalize.ts    report → normalized model (field spellings, measures, options)
│  ├─ store.ts        columnar store: typed arrays + dictionary encoding
│  ├─ planner.ts      slice → cube: GROUPING-SETS scan, totals, positional pass
│  ├─ aggregations.ts the 17 aggregation functions (additive / holistic / positional)
│  ├─ formula.ts      calculated-value parser + evaluator
│  ├─ format.ts       number/date formatting + condition parsing
│  ├─ conditions.ts   conditional-format rule compiler
│  ├─ matrix.ts       cell matrix + axis trees (+ serialization for Worker transfer)
│  └─ engine.ts       LocalEngine / WorkerEngine behind one async interface
├─ facade/      ProPivot public class: constructor, methods, events, CellBuilder/CellData
├─ grid/        virtualized DOM renderer + drag-drop field list + CSS
├─ export/      csv · html · xlsx · pdf · svg(image)
└─ wrappers/    React component + Angular <pro-pivot> source
```

## 1. Data model & ingestion

A **report** is a plain object: a `dataSource` (inline JSON or CSV), a `slice` (rows,
columns, measures, filters, sorting), plus `formats`, `conditions`, and `options`.
`normalize.ts` resolves it into a stable internal model: it expands date hierarchies
(e.g. a `year/quarter/month/day` field becomes ordered level fields), resolves measure
captions and aggregations, assigns each measure a unique **slot key**, and fills option
defaults.

`store.ts` builds a **columnar store**: each field becomes a typed array with
**dictionary encoding** (string members → integer codes). This keeps memory compact and
makes the grouping scan cache-friendly on large datasets.

## 2. The cube: slice planner

`planner.ts` turns the slice into the cell matrix in a single pass using **GROUPING SETS**
— it computes every subtotal and grand-total level together, so holistic aggregations
(median, distinct-count, stdev) are correct at every level, not just the leaves.

1. **Filters → selection.** Member filters and Top-N / Bottom-N (ranked by a measure)
   restrict the row set.
2. **Base aggregation.** For each grouping level, per-group accumulators fold the selected
   rows. Base accumulators are keyed by `(field, aggregation)` so two measures over the
   same field with different aggregations never collide.
3. **Derived measures.** Ratios (`percent`, `percentofrow`, `percentofcolumn`, `index`)
   and calculated formulas are derived from the base cells.
4. **Positional pass.** `difference`, `%difference`, and `runningtotals` walk the ordered
   leaf axis. The axis is configurable per measure via `positionalAxis: 'rows' | 'columns'`
   (default `columns`).

The result is a **`CellMatrix`**: row/column axis trees, the resolved measures, a `cells`
map (keyed by `rowPath ⋅ colPath ⋅ measureKey`), a parallel `text` map of pre-formatted
display strings, and grand totals. The matrix is plain-data and serializable for transfer
to/from a Worker.

## 3. Aggregations

Seventeen aggregations in three classes:

- **Additive** (`sum`, `count`, `min`, `max`, …) — computed in one columnar pass; trivially
  mergeable, so drill-down stays exact.
- **Holistic** (`distinctcount`, `median`, `stdevp`, `stdevs`) — per-group accumulators
  (hash sets, order statistics, Welford running variance).
- **Post-aggregation / positional** (`percent`, `percentofrow`, `percentofcolumn`, `index`,
  `difference`, `%difference`, `runningtotals`) — a second pass over the aggregated matrix
  using row/column/grand totals or neighbor cells, respecting axis order.

Each measure aggregates independently; the same field can appear under multiple
aggregations side by side.

## 4. Calculated measures, formatting, conditions

- **Calculated values** (`formula.ts`): a small parser/evaluator for expressions like
  `sum('sales') / sum('qty')`, mixing aggregate references and arithmetic.
- **Formatting** (`format.ts`): number and date formatting (currency, percent, thousands
  separators, decimal places, custom date patterns) produces the matrix's `text` strings.
- **Conditional formatting** (`conditions.ts`): rules such as `#value > 100000` compile to
  predicates that style matching cells at render time. Two value-placeholder dialects are
  supported (`#value` and `#value#`).

## 5. Engine boundary

`engine.ts` exposes a single async `PivotEngine` interface with three implementations:

- **`LocalEngine`** — runs the store + planner on the main thread (default).
- **`WorkerEngine`** — offloads ingestion and compute to a Web Worker, transferring the
  serialized matrix back via structured clone. Falls back to `LocalEngine` automatically
  when `Worker` is unavailable or no worker URL is provided.
- **`DuckDBEngine`** (opt-in, `accelerator: 'duckdb'`) — for large datasets, offloads the
  grouping-sets *base aggregation* to **DuckDB-WASM** (loaded from a CDN at runtime, so it
  is never bundled). It generates SQL `GROUPING SETS`, then reuses the shared
  `assembleMatrix` so the output matches the built-in engine up to floating point —
  verified in `test/accel-parity.test.ts` by running the same SQL under Node. It falls
  back to `LocalEngine` below a row threshold, for unsupported reports (top/bottom-N,
  date dimensions), or on any error, so enabling it can never change or break a result.

Because the matrix is plain-data, the facade and renderer are engine-agnostic. The seam
the accelerator plugs into is the planner's `planBase` → `assembleMatrix` split: only the
base-cell computation in between differs between engines.

## 6. Rendering

`grid/` renders the matrix to a DOM grid:

- **Virtualized body** — only the rows in the viewport are in the DOM, with frozen headers,
  so high-cardinality data scrolls smoothly.
- **Layouts** — `compact` (nested, indented row field with expand/collapse), `flat` (one
  column per row field), and `classic` (one column per row field with subtotal rows). The
  cube is identical across layouts; only the row-header presentation differs.
- **Interactivity** — expand/collapse, selection, sort-by-measure, a drag-drop field list
  (Rows / Columns / Measures / Filters), per-measure aggregation switching, and
  double-click drill-through.
- **`customizeCell`** — a per-cell hook receiving a `CellBuilder` + `CellData`, so consumers
  can add classes, inline styles, or replace cell content.

## 7. Exports

All exports are client-side, built from the current cell matrix (no re-query):

| Type    | Output                                                            |
|---------|------------------------------------------------------------------|
| `csv`   | RFC-4180 CSV string                                              |
| `html`  | a `<table>` string                                              |
| `excel` | a real `.xlsx` workbook (dependency-free writer)                |
| `pdf`   | a real, paginated `.pdf` (dependency-free writer)              |
| `image` | a deterministic `.svg` of the grid; rasterizes to PNG in-browser via `imageFormat: 'png'` |

## 8. Testing

- **Unit tests** cover aggregations, formulas, formatting, conditions, planner, and exports.
- **Golden suite** (`test/golden/`, see [`Golden Tests.md`](Golden%20Tests.md)) pins the
  contract in two layers: an **engine** layer that snapshots the computed cell matrix, and
  a **render** layer that snapshots the rendered grid in a headless DOM. Update recorded
  outputs with `npm run golden:update` and review the diff — that diff *is* the contract
  change.

```bash
npm install
npm test            # unit + golden (engine + render)
npm run build       # tsup → dist (ESM + CJS + d.ts + browser global + css)
npm run typecheck
```
