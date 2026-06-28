# Changelog

All notable changes to ProPivot are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to
follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.1] - 2026-06-28

### Fixed
- **Field-list drag-reorder** — dropping a chip onto a same-`uniqueName` sibling
  (e.g. two measures over the same field, like sum + average) no longer falls
  through to a zone move that rebuilt the zone and dropped the duplicate. Drops
  onto a chip/header in an ordered zone now always stay in the reorder path, and
  the drag carries its source slot so the *dragged* duplicate is reordered, not
  the first `uniqueName` match. `reorderColumn()` gained an optional `from`
  argument to pin the source slot.
- **Custom heading lost on cross-zone move** — moving a measure with a custom
  caption (e.g. `Units` over field `qty`) into Rows/Columns now keeps its heading
  instead of reverting to the raw field name. Both `reorderColumn()` and
  `moveField()` carry the dragged entry's caption.
- **`copy` event** — added to the bindable event set so an inline
  `new ProPivot({ copy: … })` handler fires, matching `pivot.on('copy', …)`.

## [0.3.0] - 2026-06-28

### Added
- **Accessibility** — the grid is now a first-class ARIA grid:
  `role="grid"` with `aria-readonly` / `aria-rowcount` / `aria-colcount` /
  `aria-label`; `role="row"`/`columnheader`/`rowheader`/`gridcell` with
  `aria-rowindex` / `aria-colindex`; `aria-sort` on sortable headers,
  `aria-expanded` on expandable group rows, and `aria-selected` on values.
- **Keyboard navigation** — roving-tabindex movement across the whole grid:
  arrow keys (span-aware), `Home`/`End`, `Ctrl+Home`/`Ctrl+End`,
  `PageUp`/`PageDown`; `Enter`/`Space` activates a cell (toggles a group row,
  otherwise selects or sorts); `Shift+F10` opens column properties / drills
  through. Virtualized rows scroll into view as focus moves. A visible focus
  ring and a single tab stop into the grid.
- **Touch support** — column resize, column reorder, and field-list dragging now
  use Pointer Events, so they work on touch and pen devices (previously
  mouse-only via HTML5 drag-and-drop). Larger resize grip on coarse pointers.
- **Filtering** — label (member-text) filters (`contains` / `beginsWith` /
  `endsWith` / `equals` and negations) and value filters (measure thresholds:
  `>` `<` `≥` `≤` `=` `≠` and `between`), via new `setLabelFilter()` /
  `setValueFilter()` API and the column **Filter** panel. The member picker
  gained a search box (in both the column panel and the report-filter bar).
- **Numeric binning** — group a numeric dimension into ranges, by fixed
  `interval` or custom `breaks`, via `binning` on a row/column field, the new
  `setBinning()` API, or the column **Properties** panel. Buckets sort
  numerically and drill-through resolves raw rows by bin.
- **Range selection + copy** — select a rectangle of cells with Shift+click or
  Shift+arrows, and copy it as TSV with Ctrl/Cmd+C (pasteable into Excel /
  Sheets). Off-screen (virtualized) rows are included in the copied text.
- **Dark mode** — `options.theme: 'dark' | 'auto'` ships a built-in dark palette
  (the grid, toolbar, field list, popups and modals all theme together; `auto`
  follows the OS `prefers-color-scheme`).
- **RTL** — `options.rtl: true` mirrors the grid for right-to-left locales
  (sticky row headers, indentation and the resize grip flip; numbers stay LTR).
- **Localization** — toolbar, filter-panel and drill-through strings are now
  overridable via `localization.grid.*` (e.g. `fields`, `apply`, `all`, `none`,
  `searchMembers`, `labelFilter`, `valueFilter`, `clearFilters`, `drillThrough`).
- **Angular subpath** — the `<pro-pivot>` component is now importable as
  `@proteus/propivot/angular` (compiled by the consumer's Angular toolchain)
  instead of copy-pasting the source; `@angular/core`/`@angular/common` are
  optional peer dependencies, and a CI check type-checks the wrapper.
- New `localization.grid.gridLabel` option for the grid's accessible name.

### Changed
- Field-list chips and column headers are dragged via a unified pointer-drag
  with a floating ghost label instead of the HTML5 Drag-and-Drop API.

### Tooling
- Added `CHANGELOG.md`, `CONTRIBUTING.md`, a continuous-integration workflow
  (typecheck + tests + build on Node 18/20), an npm publish-on-tag workflow,
  and a `check:version` guard that keeps `package.json` and `ProPivot.version`
  in sync.
- Documentation site (GitHub Pages) is now mobile-responsive (collapsible nav,
  swipeable example/section pickers, the data grid no longer collapses on
  phones).

[Unreleased]: https://github.com/Proteus-Technologies-Private-Limited/ProPivot/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/Proteus-Technologies-Private-Limited/ProPivot/releases/tag/v0.3.0
