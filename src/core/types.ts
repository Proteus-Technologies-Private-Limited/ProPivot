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

export interface FilterSpec {
  members?: string[];
  negation?: boolean;
  type?: 'none' | 'members' | 'top' | 'bottom';
  measure?: string;
  quantity?: number;
}

export interface Hierarchy {
  uniqueName: string;
  caption?: string;
  sort?: 'asc' | 'desc' | 'unsorted';
  filter?: FilterSpec;
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
  isTotal?: boolean;
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
