// Public + internal type definitions for ProPivot.
// The report schema and identifier names define the library's public API surface
// (see docs/Architecture.md §1).

/** All supported aggregation identifiers. `none` is used by calculated measures. */
export type AggregationType =
  | 'sum'
  | 'count'
  | 'distinctcount'
  | 'average'
  | 'median'
  | 'product'
  | 'min'
  | 'max'
  | 'percent'
  | 'percentofcolumn'
  | 'percentofrow'
  | 'index'
  | 'difference'
  | '%difference'
  | 'stdevp'
  | 'stdevs'
  | 'runningtotals'
  | 'none';

export type FieldType =
  | 'string'
  | 'number'
  | 'date'
  | 'date string'
  | 'datetime'
  | 'time'
  | 'year/month/day'
  | 'year/quarter/month/day'
  | 'month'
  | 'weekday'
  | 'level'
  | 'hidden';

export interface MappingEntry {
  type?: FieldType;
  caption?: string;
  visible?: boolean;
  hierarchy?: string;
  parent?: string;
  level?: string;
}

export interface Mapping {
  [field: string]: MappingEntry;
}

export interface DataSource {
  /** "json" | "csv" — accepts both `type` and the legacy `dataSourceType` spelling. */
  type?: 'json' | 'csv';
  dataSourceType?: 'json' | 'csv';
  filename?: string;
  data?: Array<Record<string, unknown>> | unknown[][];
  mapping?: Mapping;
  fieldSeparator?: string;
  ignoreQuotedLineBreaks?: boolean;
  recordsetDelimiter?: string;
  browseForFile?: boolean;
}

/** Text-match operators for a label filter (case-insensitive). */
export type LabelOperator = 'contains' | 'notContains' | 'beginsWith' | 'endsWith' | 'equals' | 'notEquals';
/** Threshold operators for a value filter (measure aggregated per member). */
export type ValueOperator = 'greaterThan' | 'lessThan' | 'greaterEqual' | 'lessEqual' | 'equal' | 'notEqual' | 'between';

export interface FilterSpec {
  members?: string[];
  negation?: boolean;
  type?: 'none' | 'members' | 'top' | 'bottom' | 'label' | 'value';
  /** Measure a Top/Bottom-N or value filter ranks/tests members by. */
  measure?: string;
  /** Keep-count for Top/Bottom-N. */
  quantity?: number;
  /** Label (member-text) filter: keep members whose name matches `query`. */
  labelOperator?: LabelOperator;
  query?: string;
  /** Value filter: keep members whose `measure` aggregate satisfies the test. */
  operator?: ValueOperator;
  value?: number;
  /** Upper bound for the `between` value operator. */
  value2?: number;
}

export interface Hierarchy {
  uniqueName: string;
  caption?: string;
  sort?: 'asc' | 'desc' | 'unsorted';
  filter?: FilterSpec;
  /** Pixel column width (drag-resized or set programmatically). */
  width?: number;
  /** Rich display format applied to this dimension's member cells. */
  display?: DisplayFormat;
}

/** Special placeholder for the measures axis inside rows/columns. */
export const MEASURES_KEY = '[Measures]';

export interface Measure {
  uniqueName: string;
  aggregation?: AggregationType;
  caption?: string;
  format?: string;
  formula?: string;
  active?: boolean;
  grandTotalCaption?: string;
  individual?: boolean;
  availableAggregations?: string[];
  /**
   * Axis the positional family (`difference` / `%difference` / `runningtotals`) walks
   * along. Defaults to `'columns'` (current-versus-previous across the column axis);
   * `'rows'` computes down the row axis instead. Ignored for non-positional measures.
   */
  positionalAxis?: 'rows' | 'columns';
  /** Pixel column width (drag-resized or set programmatically). */
  width?: number;
  /** Rich display format applied to this measure's value cells. */
  display?: DisplayFormat;
}

export interface Sorting {
  row?: { tuple?: string[]; measure?: string; type?: 'asc' | 'desc' };
  column?: { tuple?: string[]; measure?: string; type?: 'asc' | 'desc' };
}

export interface Slice {
  rows?: Hierarchy[];
  columns?: Hierarchy[];
  measures?: Measure[];
  reportFilters?: Hierarchy[];
  /**
   * Filters keyed by the resolved field name — used for fields that are not a
   * standalone slice hierarchy, notably the expanded levels of a date hierarchy
   * (e.g. `"Date (Year)"`). Honored by the planner alongside hierarchy filters.
   */
  fieldFilters?: Record<string, FilterSpec>;
  sorting?: Sorting;
  expands?: { expandAll?: boolean; rows?: Array<{ tuple: string[] }>; columns?: Array<{ tuple: string[] }> };
  drills?: { drillAll?: boolean; rows?: Array<{ tuple: string[] }>; columns?: Array<{ tuple: string[] }> };
}

export type TotalsMode = 'on' | 'off' | 'rows' | 'columns';

export interface GridOptions {
  type?: 'compact' | 'flat' | 'classic';
  title?: string;
  showFilter?: boolean;
  showHeaders?: boolean;
  showTotals?: TotalsMode | boolean;
  showGrandTotals?: TotalsMode | boolean;
  grandTotalsPosition?: 'top' | 'bottom';
  showHierarchies?: boolean;
  showHierarchyCaptions?: boolean;
  showReportFiltersArea?: boolean;
}

export interface Options {
  grid?: GridOptions;
  viewType?: 'grid';
  configuratorActive?: boolean;
  configuratorButton?: boolean;
  showAggregations?: boolean;
  showCalculatedValuesButton?: boolean;
  drillThrough?: boolean;
  showDrillThroughConfigurator?: boolean;
  sorting?: 'on' | 'columns' | 'rows' | 'off';
  datePattern?: string;
  dateTimePattern?: string;
  saveAllFormats?: boolean;
  showDefaultSlice?: boolean;
  defaultHierarchySortName?: 'asc' | 'desc' | 'unsorted';
  showAggregationLabels?: boolean;
  localization?: unknown;
  /**
   * Column UX: drag-resize, drag-reorder, and the per-column properties panel
   * (heading / aggregation / conditional formatting / display format / filter).
   * `true` (default) enables everything; an object toggles each facet. `false`
   * disables all of it (read-only columns).
   */
  columnProperties?: boolean | ColumnPropertiesOptions;
}

export interface ColumnPropertiesOptions {
  /** Master switch (default true). */
  enabled?: boolean;
  /** Allow opening the panel and editing properties (default true). */
  edit?: boolean;
  /** Allow drag-resizing columns (default true). */
  resize?: boolean;
  /** Allow drag-reordering columns between/within zones (default true). */
  reorder?: boolean;
}

export interface NumberFormat {
  name?: string;
  thousandsSeparator?: string;
  decimalSeparator?: string;
  decimalPlaces?: number;
  maxDecimalPlaces?: number;
  maxSymbols?: number;
  currencySymbol?: string;
  currencySymbolAlign?: 'left' | 'right';
  isPercent?: boolean;
  nullValue?: string;
  infinityValue?: string;
  divideByZeroValue?: string;
  textAlign?: 'left' | 'right';
}

export interface ConditionFormatStyle {
  backgroundColor?: string;
  color?: string;
  fontFamily?: string;
  fontSize?: string;
  fontWeight?: string;
  fontStyle?: string;
  textAlign?: string;
  [k: string]: string | undefined;
}

export interface Condition {
  formula?: string;
  format?: ConditionFormatStyle;
  id?: number;
  row?: number;
  column?: number;
  measure?: string;
  /**
   * Optional per-SLOT scope. When set, the condition only applies to the measure
   * whose stable slot `key` matches (so two measures over the same field — e.g.
   * sum AND average of `sales` — don't bleed each other's conditional formats).
   * Falls back to `measure` (uniqueName) matching when absent.
   */
  measureKey?: string;
  isTotal?: boolean;
}

// ── Display formats (per-column rich rendering) ──────────────────────────────
// Ported from the twasta.ai transaction list-table; the formatting logic lives
// in src/core/cellStyle.ts. A column may carry an optional `display: DisplayFormat`.
// It is display-only — it never affects aggregation or the stored value.

export type DisplayFormatType =
  | 'text'            // default — no special formatting
  | 'number'          // decimal / currency / accounting / percent / scientific / compact
  | 'percent_ring'    // circular completeness ring around the value
  | 'progress'        // horizontal progress bar (value within min..max)
  | 'data_bar'        // in-cell bar drawn behind the number
  | 'heatmap'         // text/background graded across value bands (stepped or gradient)
  | 'rating'          // stars / hearts / dots out of N
  | 'signed'          // +/- delta, colored, with ▲▼ arrow
  | 'sparkline'       // tiny inline line chart from an array / comma list
  | 'bullet'          // target-vs-actual bullet (actual bar + target tick)
  | 'status_tag'      // colored badge/pill (value → color map)
  | 'status_dot'      // colored dot; value beside it (optionally hidden)
  | 'icon_map'        // value → icon glyph
  | 'boolean'         // ✓ / ✗ (or a value map)
  | 'tags'            // comma/array value → colored chips
  | 'avatar'          // initials avatar + name
  | 'background'      // conditional cell background from first-matching rule
  | 'date'            // date/time pattern
  | 'relative_time'   // "3 days ago" / "in 2h"
  | 'date_range'      // start + end companion column shown as one cell
  | 'countdown'       // time remaining to a due date, SLA-colored
  | 'telephone'       // phone link (tel:) — optional country flag from dial code
  | 'country'         // country flag + value from an ISO-2 code
  | 'email'           // mail link (mailto:)
  | 'url'             // open link in a new tab
  | 'image'           // thumbnail of an image URL
  | 'file'            // filename + icon, click to open
  | 'map'             // map pin opening the location in a new tab
  | 'copy'            // value with a copy-to-clipboard affordance
  | 'case'            // text case transform (upper/lower/title/camel/sentence)
  | 'truncate'        // clamp long text with a hover tooltip
  | 'masked'          // mask sensitive value (••••1234)
  | 'template'        // wrap value in a template, e.g. "INV-{value}"
  | 'two_line';       // bold primary value + muted secondary companion column

export interface DisplayMapEntry {
  when: string;                 // matched (case-insensitively) against the value
  color?: string;               // named color or hex/css
  icon?: string;                // emoji / glyph
  label?: string;               // replacement display text
}

export interface DisplayRule {
  when: string;                 // expression over the value, e.g. "value > 1000"
  color: string;                // applied when the expression is truthy
}

export interface DisplayFormat {
  type: DisplayFormatType;

  // numeric formatting (number / data_bar / signed / etc.)
  numberStyle?: 'decimal' | 'currency' | 'accounting' | 'percent' | 'scientific' | 'compact';
  locale?: string;
  currency?: string;
  decimals?: number;
  prefix?: string;
  suffix?: string;

  // progress / ring / bullet / data_bar / rating
  min?: number;
  max?: number;
  color?: string;
  showValue?: boolean;

  // heatmap
  scale?: 'stepped' | 'gradient';
  thresholds?: number[];
  colors?: string[];
  applyTo?: 'text' | 'background';

  // status maps / conditional background
  map?: DisplayMapEntry[];
  rules?: DisplayRule[];
  defaultColor?: string;
  defaultIcon?: string;
  defaultLabel?: string;
  hideValue?: boolean;

  // rating / icons
  icon?: string;                // 'star' | 'heart' | 'circle' | any emoji

  // text transforms
  textCase?: 'upper' | 'lower' | 'title' | 'camel' | 'sentence';
  truncate?: number;
  maskLast?: number;
  maskChar?: string;
  template?: string;

  // temporal
  datePattern?: string;
  warnDays?: number;
  dangerDays?: number;

  // contact / link / media
  label?: string;
  showFlag?: boolean;

  // country
  countryShow?: 'flag_name' | 'flag' | 'flag_code';
}

export interface Report {
  dataSource?: DataSource;
  slice?: Slice;
  options?: Options;
  formats?: NumberFormat[];
  conditions?: Condition[];
  tableSizes?: { columns?: unknown[]; rows?: unknown[] };
  localization?: unknown;
  /** Flat-grid column defs (used by the simple-grid path). */
  columns?: unknown[];
}
