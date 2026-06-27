# Column UX: resize, reorder, display formats & the column-properties panel

This document covers the interactive column features and the rich per-column
**display formats**, plus the events a host application can listen to.

## Enabling / disabling

Everything here is **on by default**. Toggle via `report.options.columnProperties`:

```ts
options: {
  // boolean shorthand:
  columnProperties: true,            // all on (default)
  columnProperties: false,           // read-only columns (no resize/reorder/panel)

  // or fine-grained:
  columnProperties: {
    enabled: true,   // master switch
    edit:    true,   // open the properties panel + edit properties
    resize:  true,   // drag-resize columns
    reorder: true,   // drag-reorder columns (between & within zones)
  },
}
```

## Resize

Hover a column header's right edge and drag the resize handle. The width is stored
on the column (`Measure.width` / `Hierarchy.width`) and applied via a `<colgroup>`
so it survives row virtualization. Fires **`columnresize`**.

```ts
pivot.on('columnresize', ({ ref, width }) => { /* persist width */ });
pivot.setColumnWidth({ kind: 'measure', uniqueName: 'sales', key: 'sales' }, 140);
```

## Reorder

Drag a column header onto another to reorder within a zone, or onto a Field-List
zone to move it between **Rows / Columns / Values**. The column's object (width,
display, filter, aggregation) rides along. Fires **`columnreorder`**.

```ts
pivot.on('columnreorder', ({ uniqueName, fromZone, toZone, toIndex }) => { /* … */ });
pivot.reorderColumn('region', 'columns', 0);
```

## Column-properties panel

Click the ▾ button on any column header. The panel is **context-aware**:

| Tab | Measure columns | Dimension columns |
|-----|-----------------|-------------------|
| **Properties** | heading, aggregation, width | heading, width |
| **Display** | numeric display formats | type-appropriate display formats |
| **Conditional** | per-slot conditional formatting (expression builder + color pickers) | — |
| **Filter** | Top / Bottom-N (ranks the first row field) | distinct-value member filter |

Editing fires **`columnpropertychange`** with `{ ref, property, value }`.

Programmatic equivalents:

```ts
pivot.setColumnCaption(ref, 'Revenue');
pivot.setColumnDisplay(ref, { type: 'data_bar', min: 0, max: 10000, color: 'blue' });
pivot.setColumnDisplay(ref, null);            // clear
pivot.setTopN('sales', 'top', 10);            // measure-column Top-N
pivot.setFilter('region', ['West', 'East']);  // dimension member filter
```

`ColumnRef` is `{ kind: 'measure', uniqueName, key }` or `{ kind: 'field', uniqueName }`.
For two measures over the same field (e.g. *sum* AND *average* of `sales`), the slot
`key` (`sales`, `sales#1`, …) disambiguates them.

## Display formats

A column may carry `display: DisplayFormat` (on a `Measure` or a `Hierarchy`). It is
**display-only** — it never changes aggregation or the stored value. The catalog is
ported from the twasta.ai transaction list-table and the exact formatting logic lives
in `src/core/cellStyle.ts` (pure, DOM-free, shared by the grid and the exporters).

Formats are **gated by data type** (`formatsForType`):

- **Numeric** (measures, number fields): `number`, `signed`, `data_bar`, `progress`,
  `percent_ring`, `heatmap`, `rating`, `bullet`, `sparkline`, `background`.
- **Date** fields: `date`, `relative_time`, `date_range`, `countdown`, `case`,
  `truncate`, `template`, `background`.
- **Text** fields: `status_tag`, `status_dot`, `icon_map`, `boolean`, `tags`, `avatar`,
  `two_line`, `case`, `truncate`, `masked`, `template`, `background`, `telephone`,
  `country`, `email`, `url`, `image`, `file`, `map`, `copy`.

Numbers use `Intl.NumberFormat` (decimal/currency/accounting/percent/scientific/compact);
dates use Angular-DatePipe-style tokens (`dd-MMM-yyyy`, `HH:mm`, …).

```ts
measures: [
  { uniqueName: 'sales', aggregation: 'sum',
    display: { type: 'data_bar', min: 0, max: 12000, color: 'blue' } },
]
rows: [
  { uniqueName: 'status',
    display: { type: 'status_tag', map: [
      { when: 'open', color: 'green', label: 'Open' },
      { when: 'closed', color: 'grey', label: 'Closed' },
    ] } },
]
```

## PDF / image export parity

Export now matches the HTML preview. `src/export/index.ts` computes each cell's
visual (`formatVisual` + `evalConditionStyle`) into `SheetCell.style` / `SheetCell.bar`,
and the dependency-free PDF writer (`src/export/pdf.ts`) and SVG writer
(`src/export/svg.ts`) draw the background fills, data/progress bars, text colors, bold,
and alignment from that descriptor — deterministically, so the golden tests stay
byte-stable. (The XLSX writer ignores style for now; cell values are unaffected.)
