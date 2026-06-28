// Report normalization (docs/Architecture.md).
// Accepts both field spellings (`type` / `dataSourceType`) and fills defaults
// so the planner and renderer work against a single internal model.

import type { Report, Slice, Measure, Hierarchy, Options, GridOptions, ColumnPropertiesOptions } from './types';
import { MEASURES_KEY } from './types';
import { expandHierarchyFields } from './store';

export type ResolvedColumnProps = Required<ColumnPropertiesOptions>;

/** Resolve the `columnProperties` option (boolean | object) to a flat shape. */
export function resolveColumnProps(opt: Options['columnProperties']): ResolvedColumnProps {
  if (opt === false) return { enabled: false, edit: false, resize: false, reorder: false };
  if (opt === true || opt === undefined) return { enabled: true, edit: true, resize: true, reorder: true };
  const enabled = opt.enabled !== false;
  return {
    enabled,
    edit: enabled && opt.edit !== false,
    resize: enabled && opt.resize !== false,
    reorder: enabled && opt.reorder !== false,
  };
}

export interface ResolvedLocalization {
  grandTotal: string;
  total: string;
  blankMember: string;
  dateInvalid: string;
  /** Accessible name announced for the grid as a whole (ARIA). */
  gridLabel: string;
}

export interface NormalReport {
  report: Report;
  dataType: 'json' | 'csv';
  rowFields: string[];
  colFields: string[];
  measures: NormalMeasure[];
  reportFilters: Hierarchy[];
  /** which axis carries the measures ('columns' default, or 'rows'). */
  measuresAxis: 'rows' | 'columns';
  options: Required<Pick<Options, never>> & Options;
  grid: GridOptions;
  localization: ResolvedLocalization;
  /** Resolved column-properties UX flags (resize / reorder / edit / enabled). */
  columnProps: ResolvedColumnProps;
}

/** Merge localization from options.localization and report.localization. */
export function resolveLocalization(report: Report): ResolvedLocalization {
  const src = report.options?.localization ?? report.localization;
  const grid = (src && typeof src === 'object' ? (src as { grid?: Record<string, string> }).grid : undefined) ?? {};
  return {
    grandTotal: grid.grandTotalCaption ?? 'Grand Total',
    total: grid.totals ?? 'Total',
    blankMember: grid.blankMember ?? '(blank)',
    dateInvalid: grid.dateInvalidCaption ?? '',
    gridLabel: grid.gridLabel ?? 'Pivot table',
  };
}

export interface NormalMeasure extends Measure {
  uniqueName: string;
  aggregation: NonNullable<Measure['aggregation']>;
  caption: string;
  calculated: boolean;
  /**
   * Stable, unique cell key for this measure SLOT. Cells/totals are keyed by this
   * (not by `uniqueName`) so two measures over the same field but different
   * aggregations — e.g. sum AND average of `sales` — don't collide. Equals
   * `uniqueName` when that name is used once (readable + back-compatible);
   * disambiguated as `uniqueName#n` when the same field is measured more than once.
   */
  key: string;
}

function dataKind(report: Report): 'json' | 'csv' {
  const ds = report.dataSource;
  return (ds?.type ?? ds?.dataSourceType ?? 'json') as 'json' | 'csv';
}

function captionFor(name: string, report: Report): string {
  const m = report.dataSource?.mapping?.[name];
  return m?.caption ?? name;
}

export function normalizeReport(report: Report): NormalReport {
  const slice: Slice = report.slice ?? {};
  const rawRows = slice.rows ?? [];
  const rawCols = slice.columns ?? [];

  let measuresAxis: 'rows' | 'columns' = 'columns';
  if (rawRows.some((h) => h.uniqueName === MEASURES_KEY)) measuresAxis = 'rows';

  const expand = (h: Hierarchy): string[] => {
    const m = report.dataSource?.mapping?.[h.uniqueName];
    return expandHierarchyFields(h.uniqueName, m?.type, m?.caption ?? h.uniqueName);
  };
  const rowFields = rawRows.filter((h) => h.uniqueName !== MEASURES_KEY).flatMap(expand);
  const colFields = rawCols.filter((h) => h.uniqueName !== MEASURES_KEY).flatMap(expand);

  const measures: NormalMeasure[] = (slice.measures ?? [])
    .filter((m) => m.active !== false)
    .map((m) => {
      const calculated = Boolean(m.formula);
      return {
        ...m,
        uniqueName: m.uniqueName,
        aggregation: (m.aggregation ?? (calculated ? 'none' : 'sum')) as NormalMeasure['aggregation'],
        caption: m.caption ?? captionFor(m.uniqueName, report),
        calculated,
        key: m.uniqueName, // finalized below once duplicates are known
      };
    });

  // Disambiguate measures that share a uniqueName so their cells don't collide.
  // A name used once keeps the bare uniqueName; repeats get a `#n` suffix.
  const nameCount = new Map<string, number>();
  for (const m of measures) nameCount.set(m.uniqueName, (nameCount.get(m.uniqueName) ?? 0) + 1);
  const seen = new Map<string, number>();
  for (const m of measures) {
    if ((nameCount.get(m.uniqueName) ?? 0) > 1) {
      const i = seen.get(m.uniqueName) ?? 0;
      seen.set(m.uniqueName, i + 1);
      m.key = `${m.uniqueName}#${i}`;
    }
  }

  const grid: GridOptions = {
    type: 'compact',
    showTotals: 'on',
    showGrandTotals: 'on',
    grandTotalsPosition: 'bottom',
    showHeaders: true,
    ...(report.options?.grid ?? {}),
  };

  return {
    report,
    dataType: dataKind(report),
    rowFields,
    colFields,
    measures,
    reportFilters: slice.reportFilters ?? [],
    measuresAxis,
    options: { ...(report.options ?? {}) },
    grid,
    localization: resolveLocalization(report),
    columnProps: resolveColumnProps(report.options?.columnProperties),
  };
}

export function totalsEnabled(mode: GridOptions['showTotals'], axis: 'rows' | 'columns'): boolean {
  if (mode === undefined || mode === true || mode === 'on') return true;
  if (mode === false || mode === 'off') return false;
  return mode === axis;
}
