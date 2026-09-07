# ProPivot (`@proteus/propivot`)

[![CI](https://github.com/Proteus-Technologies-Private-Limited/ProPivot/actions/workflows/ci.yml/badge.svg)](https://github.com/Proteus-Technologies-Private-Limited/ProPivot/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@proteus/propivot.svg)](https://www.npmjs.com/package/@proteus/propivot)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

> # The open-source JavaScript pivot table for serious data.
>
> **Pivot millions of rows entirely in the browser.** No backend required.

**React · Angular · Vue · Vanilla JS · TypeScript · Web Workers · DuckDB-WASM · MIT**

ProPivot is a modern, MIT-licensed pivot table and pivot-grid engine for applications that need to explore large datasets without sending every interaction back to a server. Its columnar engine aggregates 100% client-side and combines virtualized rendering, calculated measures, conditional formatting, Top/Bottom-N filtering, sort-by-measure, Web Worker execution, and optional DuckDB-WASM acceleration.

### Try it before installing

- **[▶ Pivot 2,000,000 rows in your browser](https://proteus-technologies-private-limited.github.io/ProPivot/demo.html)**
- **[⬆ Pivot your own CSV / JSON](https://proteus-technologies-private-limited.github.io/ProPivot/upload.html)**
- **[🧩 Download framework starter apps](https://proteus-technologies-private-limited.github.io/ProPivot/starters.html)**
- **[📚 Documentation & examples](https://proteus-technologies-private-limited.github.io/ProPivot/)**

```bash
npm install @proteus/propivot
```

## Why ProPivot?

Many JavaScript pivot components are either tied to commercial licensing, optimized for smaller datasets, or coupled tightly to one framework. ProPivot is designed for a different use case:

- **MIT licensed** — use it in commercial or open-source applications.
- **100% client-side** — pivot, sort, filter, calculate, and format without server round-trips.
- **Large-data focused** — columnar storage, dictionary encoding, virtualized rows, Web Workers, and optional DuckDB-WASM.
- **Framework independent** — React, Angular, Vue, vanilla JavaScript, or a global `<script>` build.
- **Full pivot feature set** — 17 aggregations, calculated measures, positional calculations, Top/Bottom-N, conditional formatting, subtotals, grand totals, and multiple layouts.
- **Useful exports** — CSV, HTML, real `.xlsx`, dependency-free PDF, SVG, and browser PNG export.

## Quick start

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
        {
          uniqueName: 'aov',
          formula: "sum('sales')/sum('qty')",
          caption: 'Avg Price',
        },
      ],
    },
    formats: [{ name: 'cur', currencySymbol: '$', decimalPlaces: 0 }],
    conditions: [
      {
        formula: '#value > 100000',
        measure: 'sales',
        format: { backgroundColor: '#c5e1a5' },
      },
    ],
  },
  reportcomplete: () => console.log('ready'),
});
```

## Feature snapshot

| Capability | ProPivot |
| --- | --- |
| License | MIT |
| Processing | 100% client-side |
| React | ✅ |
| Angular | ✅ |
| Vue | ✅ |
| Vanilla JS / global build | ✅ |
| Virtualized rows | ✅ |
| Web Worker engine | ✅ |
| Optional DuckDB-WASM accelerator | ✅ |
| Calculated measures | ✅ |
| Conditional formatting | ✅ |
| Top-N / Bottom-N | ✅ |
| Sort by measure | ✅ |
| CSV / HTML / XLSX / PDF / image export | ✅ |

## Core capabilities

- **Core engine** (`src/core`): columnar store + dictionary encoding; slice planner with GROUPING-SETS subtotals/grand totals; all **17 aggregations**, including positional calculations (`difference`, `%difference`, `runningtotals`) on a configurable row/column axis.
- **Large-data execution**: `LocalEngine` and `WorkerEngine` share one async interface; computed matrices are structured-clone friendly.
- **Optional DuckDB-WASM**: opt-in accelerator for large browser datasets.
- **Pivot operations**: Top-N / Bottom-N, sort-by-measure, flat grid mode, calculated-value formulas, number/date formatting, and conditional formatting.
- **Renderer**: compact / flat / classic layouts, virtualized rows, frozen headers, expand/collapse, selection, drag-drop field list, and `customizeCell`.
- **Exports**: CSV, HTML, real `.xlsx`, dependency-free `.pdf`, SVG image export, plus browser SVG→PNG rasterization.
- **Wrappers**: React (`@proteus/propivot/react`), Vue (`@proteus/propivot/vue`), Angular (`@proteus/propivot/angular`), plus the global `<script>` build.

## Off-thread compute

```ts
const pivot = new ProPivot({
  container: '#pivot',
  worker: true,
  workerUrl: new URL('propivot.worker.js', import.meta.url).href,
  report,
});
```

ProPivot automatically falls back to the main-thread engine when `Worker` is unavailable or no `workerUrl` is provided.

## DuckDB-WASM accelerator

```ts
new ProPivot({
  container: '#pivot',
  accelerator: 'duckdb',
  duckdb: { threshold: 100_000 },
  report,
});
```

The accelerator is optional; the built-in engine remains the default.

## Performance & benchmarks

The live site includes a **2,000,000-row interactive demo** that runs in the browser. For reproducible measurements, hardware/browser details, and benchmark methodology, see **[BENCHMARKS.md](BENCHMARKS.md)**.

Performance depends on row count, cardinality, selected dimensions/measures, browser, memory, and whether the Worker or DuckDB-WASM path is used. Benchmark claims should therefore always be read together with the test configuration.

## ProPivot compared with other approaches

ProPivot is not intended to replace every data-grid product. It is focused specifically on **open-source pivot analytics over large browser-resident datasets**.

| Approach | Best fit | Where ProPivot differs |
| --- | --- | --- |
| Traditional open-source pivot libraries | Lightweight/simple pivoting | ProPivot adds modern framework wrappers, virtualization, workers, calculated measures, richer exports, and large-data execution paths. |
| Commercial pivot components | Enterprises wanting vendor suites/support | ProPivot is MIT licensed and can be embedded without commercial runtime licensing. |
| General-purpose data grids | Broad table/grid use cases | ProPivot focuses on multidimensional pivoting and aggregation rather than being a generic grid first. |
| Server-side OLAP/BI | Centralized analytics and very large remote datasets | ProPivot keeps interactive pivot computation inside the browser when the data is already available client-side. |

Detailed, evidence-based comparison guides are planned. If you are evaluating ProPivot against another library, open a Discussion or issue with your requirements—we want the comparisons to stay factual and reproducible.

## Framework support

### React

```ts
import { ProPivot } from '@proteus/propivot';
import '@proteus/propivot/propivot.css';
```

React bindings are available from `@proteus/propivot/react`.

### Vue

Vue bindings are available from `@proteus/propivot/vue`.

### Angular

Angular bindings are available from `@proteus/propivot/angular` and expose the `<pro-pivot>` component.

### Vanilla JavaScript

Use the browser global build and read `window.ProPivot`.

See the **[starter apps](https://proteus-technologies-private-limited.github.io/ProPivot/starters.html)** for complete runnable examples.

## Develop

```bash
npm install
npm test
npm run test:golden
npm run build
npm run typecheck
npm run ci
```

The golden test suite pins both computed engine output and rendered grid behavior so unintended changes fail in review.

## Documentation

- **[Live demo & docs](https://proteus-technologies-private-limited.github.io/ProPivot/)**
- [Architecture](docs/Architecture.md)
- [Golden tests](docs/Golden%20Tests.md)
- [Known issues](docs/Known%20Issues.md)
- [Contributing](CONTRIBUTING.md)
- [Changelog](CHANGELOG.md)
- [Benchmarks](BENCHMARKS.md)

## Roadmap & contributing

ProPivot is actively developed. Contributions are welcome in areas such as framework examples, accessibility, documentation, performance testing, integrations, themes, and developer experience.

Look for issues labeled **`good first issue`**, **`help wanted`**, or **`documentation`**. If you are already using ProPivot, opening an issue with a real dataset shape or workflow is especially valuable—even when the library already works for you.

### Already available

- Virtualized rendering
- Compact / flat / classic layouts
- Positional difference-family calculations on row or column axis
- Top/Bottom-N
- Sort-by-measure
- Web Worker engine
- Optional DuckDB-WASM accelerator
- Five export families
- Two-layer golden test suite

### Next

- PNG image export pinned in CI
- Broader framework starter coverage
- Public reproducible benchmark suite expansion
- Accessibility and documentation improvements

## License

MIT © Proteus Technologies Private Limited
