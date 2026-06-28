# ProPivot (`@proteus/propivot`)

[![CI](https://github.com/Proteus-Technologies-Private-Limited/ProPivot/actions/workflows/ci.yml/badge.svg)](https://github.com/Proteus-Technologies-Private-Limited/ProPivot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

> **Pivot millions of rows in a heartbeat — right inside your app.**

An **enterprise-grade, open-source JavaScript library** for building pivot tables
over **millions of rows**. Works with **React**, **Angular**, **Vue**, and any JavaScript
framework — or plain JavaScript via a `<script>` tag. Lightning fast, lightweight,
feature-rich, highly configurable — and instantly embedded in any project. The columnar
engine aggregates **100% client-side** (no server round-trips): 17 aggregations,
calculated-value formulas, conditional formatting, virtualized rendering, a `customizeCell`
hook, and five export formats.

**[▶ Live demo & docs →](https://proteus-technologies-private-limited.github.io/ProPivot/)**

## Install

```bash
npm install @proteus/propivot
```

Or drop in a plain `<script>` (no bundler) and read `window.ProPivot`.

## Usage

```ts
import { ProPivot } from '@proteus/propivot';
import '@proteus/propivot/propivot.css';

const pivot = new ProPivot({
  container: '#pivot',
  toolbar: true,
  report: {
    dataSource: { type: 'json', data, mapping },
    slice: {
      rows: [{ uniqueName: 'region' }, { uniqueName: 'category' }],
      columns: [{ uniqueName: 'year' }],
      measures: [
        { uniqueName: 'sales', aggregation: 'sum', format: 'cur' },
        { uniqueName: 'aov', formula: "sum('sales')/sum('qty')", caption: 'Avg Price' },
      ],
    },
    formats: [{ name: 'cur', currencySymbol: '$', decimalPlaces: 0 }],
    conditions: [{ formula: '#value > 100000', measure: 'sales', format: { backgroundColor: '#c5e1a5' } }],
  },
  reportcomplete: () => console.log('ready'),
});
```

## Features

- **Core engine** (`src/core`): columnar store + dictionary encoding; slice planner
  with GROUPING-SETS subtotals/grand totals; all **17 aggregations** including the
  positional family (`difference`, `%difference`, `runningtotals`) along a **configurable
  row/column axis** (`measure.positionalAxis`, default `columns`);
  **Top-N / Bottom-N** filtering and **sort-by-measure**; **flat grid** mode;
  calculated-value formula parser/evaluator; number/date formatting; conditional-format
  parser (both `#value#` and `#value` dialects).
- **Engine abstraction** (`src/core/engine.ts`): `LocalEngine` (main-thread) and
  `WorkerEngine` (off-thread) behind one async interface; matrix is serializable for
  structured-clone transfer.
- **Facade** (`src/facade`): `ProPivot` class — constructor, `setReport`/`getReport`,
  `refresh`, `updateData`, `on`/`off` + full event superset, `customizeCell`,
  `addCondition`, `addCalculatedMeasure`, `setSort`, `expandAllData`/`collapseAllData`,
  `getSelectedCell`/`getCell`, `exportTo`, `dispose`, and more.
- **Renderer** (`src/grid`): DOM pivot grid (compact / flat / classic), **virtualized rows**
  (viewport-only DOM), frozen headers, expand/collapse, selection, conditional + number
  formatting, `CellBuilder`/`CellData`, drag-drop Field List.
- **Export** (`src/export`): all five — `csv`, `html`, `excel` (real `.xlsx`), `pdf`
  (real, dependency-free `.pdf`), and `image` (a deterministic `.svg` of the grid;
  `exportTo('image', { imageFormat: 'png' })` rasterizes it to PNG in the browser).
- **Wrappers**: React (`@proteus/propivot/react`), Vue (`@proteus/propivot/vue`), and
  Angular (`@proteus/propivot/angular` — the `<pro-pivot>` component, compiled by your
  Angular toolchain). Or read `window.ProPivot` from the global `<script>` build for any
  other stack.

### Off-thread compute (optional)

```ts
const pivot = new ProPivot({
  container: '#pivot',
  worker: true,
  workerUrl: new URL('propivot.worker.js', import.meta.url).href, // served from dist/
  report,
});
```
Falls back to the main-thread engine automatically when `Worker` is unavailable or no
`workerUrl` is provided.

## Develop

```bash
npm install
npm test               # vitest — engine unit + e2e pivot + golden + a11y + touch
npm run test:golden    # just the golden suite
npm run golden:update  # re-record golden reference outputs after an intended change
npm run build          # tsup -> dist (ESM + CJS + d.ts + browser global + css)
npm run typecheck
npm run ci             # everything CI runs: version check + typecheck + test + build
```

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the full workflow and the release
process, and [`CHANGELOG.md`](CHANGELOG.md) for release notes.

Open `demo/index.html` after a build to see it run.

The **golden suite** (`test/golden`, see [`docs/Golden Tests.md`](docs/Golden%20Tests.md))
pins the output contract so unintended changes fail in review. Two layers: **engine
goldens** snapshot the computed cell matrix (values/formatting/structure), and **render
goldens** snapshot the rendered grid in a headless DOM (layout modes, grand-total
position, conditional-format styling, localization, `customizeCell`).

## Documentation

- [Architecture](docs/Architecture.md) — engine, planner, aggregations, rendering, exports.
- [Golden tests](docs/Golden%20Tests.md) — the two-layer contract test suite.
- [Known issues](docs/Known%20Issues.md).

## Roadmap

Done: virtualized rendering, compact / flat / classic layouts, positional
difference-family along a configurable row/column axis, Top/Bottom-N, sort-by-measure,
Web Worker engine, **opt-in DuckDB-WASM accelerator** (parity-tested vs the built-in
engine), all five exports (csv/html/excel/pdf/image), and a two-layer golden test suite
(engine matrix + render-layer DOM).

```ts
// Opt-in accelerator for large data (browser-only; loads duckdb-wasm from a CDN).
new ProPivot({ container: '#pivot', accelerator: 'duckdb', duckdb: { threshold: 100_000 }, report });
```

Next:
- PNG image export pinned in CI (the browser SVG→PNG path is feature-gated today).

## License

[MIT](LICENSE) © Proteus Technologies Private Limited
