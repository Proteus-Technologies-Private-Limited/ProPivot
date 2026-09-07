# ProPivot Benchmarks

ProPivot is designed for interactive pivot analysis over large browser-resident datasets. This document defines how performance claims should be measured and reported so results remain reproducible rather than promotional.

## Live stress test

The project website includes an interactive **2,000,000-row demo**:

https://proteus-technologies-private-limited.github.io/ProPivot/demo.html

The live demo is useful for a quick hands-on check, but published benchmark numbers should include the environment and pivot configuration described below.

## What to measure

For each benchmark run, record:

- dataset row count
- number of source columns
- cardinality of row and column dimensions
- selected measures and aggregation types
- execution engine (`LocalEngine`, `WorkerEngine`, or DuckDB-WASM)
- initial pivot time
- subsequent pivot/refresh time
- sort-by-measure time
- filter / Top-N time where applicable
- peak memory when practical
- rendered row count / viewport configuration

## Required environment metadata

Every published result should include:

- operating system
- browser and version
- CPU
- RAM
- ProPivot version / commit
- whether DevTools was open
- whether the run was cold or warm

## Recommended benchmark matrix

| Rows | Dimensions | Measures | Engine | Initial pivot | Refresh | Sort | Filter / Top-N |
| ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| 100,000 | TBD | TBD | Local | TBD | TBD | TBD | TBD |
| 500,000 | TBD | TBD | Worker | TBD | TBD | TBD | TBD |
| 1,000,000 | TBD | TBD | Worker | TBD | TBD | TBD | TBD |
| 2,000,000 | TBD | TBD | DuckDB-WASM | TBD | TBD | TBD | TBD |

`TBD` values are intentional. We do not want to publish synthetic numbers until they have been captured through a reproducible benchmark harness.

## Suggested dataset profiles

Performance can vary dramatically with cardinality, so row count alone is not enough. At minimum, test these profiles:

### Low-cardinality business dataset

Example fields:

- region: 8 values
- country: 40 values
- category: 12 values
- year: 6 values
- sales: numeric
- quantity: numeric

### Medium-cardinality transactional dataset

Example fields:

- customer: 25,000 values
- product: 5,000 values
- channel: 8 values
- month: 60 values
- revenue: numeric
- units: numeric

### High-cardinality stress dataset

Include at least one dimension with hundreds of thousands of unique values to expose dictionary, grouping, and memory costs.

## Benchmark methodology

1. Generate or load the same deterministic dataset for every run.
2. Warm the page once, then refresh before the measured series.
3. Run each scenario at least five times.
4. Report the median rather than the fastest result.
5. Keep browser extensions and unrelated workloads to a minimum.
6. Do not compare engines using different pivot configurations.
7. Record failures or browser memory limits rather than omitting them.

## What the benchmark should prove

The goal is not to claim that ProPivot is always faster than every alternative. The benchmark should answer practical questions:

- How does latency change from 100K to 2M rows?
- When does moving work to a Web Worker improve responsiveness?
- At what dataset size does DuckDB-WASM become worthwhile?
- How strongly does cardinality affect aggregation time and memory?
- Which operations remain interactive at each scale?

## Contributing benchmark results

Benchmark contributions are welcome. Please include the full environment metadata and enough information to reproduce the pivot configuration. Results without hardware/browser/configuration details should be treated as anecdotal rather than comparable measurements.
