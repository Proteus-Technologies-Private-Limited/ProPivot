# Golden oracle tests

The golden suite pins ProPivot's **output contract** (see [`Architecture.md`](Architecture.md#8-testing)):
a corpus of reports is run through the real code and diffed against recorded reference
outputs. Any unintended change breaks a golden — making it visible in a review diff
instead of silently reaching the applications that embed the library.

There are two layers:

- **Engine goldens** — compute each report via `LocalEngine` and snapshot the cell
  matrix (values, formatted text, axis trees, resolved measures, totals).
- **Render goldens** — render each report through the `ProPivot` facade in a headless
  DOM (happy-dom) and snapshot the normalized `.pp-table` (layout mode, grand-total
  position, conditional-format styling, localization labels, `customizeCell`).

## Layout

```
test/golden/
├─ corpus.ts          # ENGINE: self-contained reports, one per contract surface
├─ canonical.ts       # ENGINE: compute via LocalEngine → deterministic JSON snapshot
├─ golden.test.ts     # ENGINE: diff each entry vs expected/, + integrity checks
├─ expected/          # ENGINE: recorded matrices (one <name>.json per entry)
├─ renderCorpus.ts    # RENDER: reports targeting render-layer concerns (+ customizeCell fns)
├─ renderHtml.ts      # RENDER: drive the facade in happy-dom → normalized .pp-table JSON
├─ render.test.ts     # RENDER: diff each entry vs expected-render/, + integrity checks
└─ expected-render/   # RENDER: recorded grid snapshots (one <name>.json per entry)
```

The render suite declares `// @vitest-environment happy-dom` (per-file) so only it pays
for a DOM; the engine suite stays in the default node environment.

## Running

```bash
npm run test:golden     # diff against recorded outputs (part of `npm test`)
npm run golden:update   # re-record expected/*.json after an INTENDED change
```

`golden:update` sets `UPDATE_GOLDENS=1`, which rewrites the expected files (and creates
missing ones) and passes. **Review the resulting diff before committing — that diff _is_
the contract change.** In normal mode a missing expected file is a hard failure (never a
silent auto-record), and an orphaned `expected/*.json` with no corpus entry also fails,
so a dropped or renamed corpus entry can't pass unnoticed.

## What an engine snapshot captures

`canonical.ts` runs the report through `LocalEngine` (the same path a host uses,
including the Worker-transfer `serializeMatrix` shape) and emits a JSON object with:

- `rowFields` / `colFields` / `measuresAxis`
- `measures` — resolved `NormalMeasure[]` (uniqueName, aggregation, caption, calculated, format, key)
- `rowTree` / `colTree` — axis node structure (paths, labels, depth, leaf/expanded flags)
- `cells` / `grand` — values, sorted by key for stable diffs
- `text` — pre-formatted display strings (locks the number/date/currency formatting contract)
- `flat` — present only for `grid.type === 'flat'`

Non-finite engine outputs (`difference` first column, divide-by-zero) are encoded as the
sentinels `"__NaN__"` / `"__Infinity__"` / `"__-Infinity__"` so the contract on them
survives a JSON round-trip and stays pinned.

## What a render snapshot captures

`renderHtml.ts` renders the report through the `ProPivot` facade (configurator/toolbar
chrome disabled) and normalizes the `.pp-table` into `{ head, body }`, where each cell is
`{ tag, text, cls?, style?, rs?, cs? }`:

- `tag` — `th` (header / row-header) or `td` (value)
- `text` — `innerHTML`, so measure-header markup and toggle glyphs are pinned too
- `cls` — className (layout classes `pp-total` / `pp-grand`, plus consumer classes)
- `style` — inline `cssText`: **conditional-format** results and **customizeCell** styles
- `rs` / `cs` — rowSpan / colSpan (omitted when 1)

This locks what the engine matrix can't: row-header **layout** (compact indentation vs a
column per field for flat/classic, and classic subtotal rows), grand-total **position**,
conditional-format **styling**, **localization** labels, and `customizeCell` output.

## Adding a corpus entry

**Engine:**

1. Append a `CorpusEntry` to `corpus.ts` with a unique `name`, a one-line `pins`, and a
   self-contained `report` (inline `dataSource.data`).
2. Run `npm run golden:update` to record `expected/<name>.json`.
3. Inspect the recorded values for correctness, then commit both files.

**Render:** append a `RenderCorpusEntry` to `renderCorpus.ts` (optionally with a
`customizeCell` fn), run `npm run golden:update` to record `expected-render/<name>.json`,
inspect, and commit.

### Measure cell keys

Cells are keyed by a unique per-measure **slot key** (`NormalMeasure.key`), not the bare
`uniqueName`: it equals `uniqueName` when a field is measured once, and `uniqueName#n`
when the same field carries more than one measure (e.g. sum *and* average of `sales`).
This is why the `same-field-sum-and-average` golden shows `sales#0` / `sales#1` keys with
distinct values. (This replaced an earlier collision bug — see
[`docs/Known Issues.md`](Known%20Issues.md).)
