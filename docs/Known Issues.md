# Known issues

Engine/contract defects discovered while building the golden suite. Fixed entries are
kept for the record with their repro and the regression test that now pins them.

## ✅ FIXED — Measure cell collision on shared `uniqueName`

**Severity:** medium — silently wrong values for a common pivot configuration.

**Discovered:** 2026-06-27, while building the golden oracle suite.
**Fixed:** 2026-06-27. Regression pinned by the `same-field-sum-and-average` golden
(`test/golden/corpus.ts`).

The cell matrix keys every value by `pathKey(rowPath, colPath, measure.uniqueName)`
(`src/core/planner.ts`, e.g. lines 124/136/195). The key uses **only the measure's
`uniqueName`**, not its aggregation. When a report places two measures over the *same*
field that differ only by aggregation — a standard pivot need (e.g. "Sum of Sales" and
"Average of Sales" side by side) — both measures write the same cell key. The last write
wins, so:

- `matrix.measures` correctly holds both measures (both column headers render), but
- both columns read the **same** cell value (whichever aggregation was computed last).

### Repro

```ts
const data = [
  { region: 'West', sales: 100 },
  { region: 'West', sales: 200 },
];
const m = buildMatrix(buildStore(data), normalizeReport({
  dataSource: { type: 'json', data },
  slice: {
    rows: [{ uniqueName: 'region' }],
    measures: [
      { uniqueName: 'sales', aggregation: 'sum', caption: 'Sum' },
      { uniqueName: 'sales', aggregation: 'average', caption: 'Avg' },
    ],
  },
}));

m.measures.map((x) => x.aggregation);          // ['sum', 'average']  ✓ both present
m.cells.get(pathKey(['West'], [], 'sales'));   // 300  — only the SUM; the average (150) is lost
```

Expected: the `Sum` column shows 300 and the `Avg` column shows 150.

### Fix applied

Two collisions were addressed:

1. **Final cell key.** `NormalMeasure` now carries a unique slot `key`
   (`src/core/normalize.ts`): the bare `uniqueName` when used once (readable +
   back-compatible), or `uniqueName#n` when a field is measured more than once. The
   planner keys `cells`/`grand`/positional/`text` by `m.key`; the renderer
   (`buildValueCell`) and export (`toTable`) read by `m.key`. Conditions still match on
   `uniqueName` (user-facing).
2. **Base accumulator key.** `measureBaseKey` is now aggregation-qualified
   (`m␟<uniqueName>␟<baseAgg>`), so `average(sales)` no longer reuses the `sum(sales)`
   accumulator that `addBase` had been deduplicating.

Sort-by-measure resolves the report's measure `uniqueName` to the first matching slot
`key`. With the fix the repro returns 300 (Sum) and 150 (Avg) in their own cells.
