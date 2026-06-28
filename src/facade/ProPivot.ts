// ProPivot — the public facade (docs/Architecture.md).
// Compatible API shape: constructor, methods, events, customizeCell.

import type {
  Report, Condition, Measure, Hierarchy, Options, DisplayFormat,
  FilterSpec, LabelOperator, ValueOperator, Binning,
} from '../core/types';
import { normalizeReport, type NormalReport } from '../core/normalize';
import type { CellMatrix, AxisNode } from '../core/matrix';
import { compileConditions } from '../core/conditions';
import { validateFormula } from '../core/formula';
import { ALL_AGGREGATIONS, AGGREGATION_CAPTIONS } from '../core/aggregations';
import { LocalEngine, WorkerEngine, type PivotEngine } from '../core/engine';
import { DuckDBEngine } from '../core/accel/duckdb';
import { parseCsv } from '../core/csv';
import { parseDataset, buildStarterReport, type InferOptions } from '../core/ingest';
import { drillThroughRows } from '../core/drillthrough';
import { EventEmitter, ALL_EVENTS } from './events';
import type { CellData } from './cell';
import { GridRenderer, type Zone, type ColumnRef } from '../grid/renderer';
import { exportMatrix, type ExportType, type ExportParams } from '../export';

export interface ProPivotConfig {
  container: string | HTMLElement;
  toolbar?: boolean;
  width?: string | number;
  height?: string | number;
  report?: Report;
  global?: { dataSource?: Report['dataSource']; options?: Options; localization?: unknown };
  customizeCell?: (cell: unknown, data: CellData) => void;
  customizeContextMenu?: (items: unknown[], data: unknown, viewType: string) => unknown[];
  componentFolder?: string;
  /** Offload aggregation to a Web Worker (docs/Architecture.md). Requires workerUrl. */
  worker?: boolean;
  workerUrl?: string;
  /** Opt-in DuckDB-WASM accelerator for large datasets (browser-only; loads from CDN). */
  accelerator?: 'duckdb';
  /** Tuning for the DuckDB accelerator. */
  duckdb?: { threshold?: number; moduleUrl?: string };
  [event: string]: unknown; // inline event handlers
}

/** Options for the raw-data loaders (`ProPivot.inferReport` / `pivot.loadData`). */
export interface LoadDataOptions extends InferOptions {
  /** Override the auto-picked starter slice (rows/columns/measures). */
  slice?: Report['slice'];
  /**
   * Extra Report fields merged over the inferred one (formats, conditions,
   * options, or a `slice`). `dataSource` is always taken from the parsed data.
   */
  report?: Partial<Report>;
}

/** A slice entry is a calculated measure when it carries a non-empty `formula`. */
function isCalculated(entry: Hierarchy | Measure | undefined): boolean {
  const formula = (entry as Measure | undefined)?.formula;
  return Boolean(formula && formula.trim());
}

export class ProPivot {
  // Keep in sync with package.json "version" — enforced by test-script/check-version.mjs.
  static version = '0.4.0';

  private container: HTMLElement | null = null;
  private emitter = new EventEmitter();
  private engine: PivotEngine;
  private report: Report = {};
  private normal: NormalReport | null = null;
  private matrix: CellMatrix | null = null;
  private renderer: GridRenderer | null = null;
  private customizeCellFn?: (cell: unknown, data: CellData) => void;
  private customizeContextMenuFn?: (items: unknown[], data: unknown, viewType: string) => unknown[];
  private selectedCell: CellData | null = null;
  private options: ProPivotConfig;
  private disposed = false;

  constructor(config: ProPivotConfig) {
    this.options = config;
    this.customizeCellFn = config.customizeCell;
    this.customizeContextMenuFn = config.customizeContextMenu;
    this.engine = this.createEngine(config);

    if (typeof document !== 'undefined') {
      this.container =
        typeof config.container === 'string'
          ? document.querySelector<HTMLElement>(config.container)
          : config.container ?? null;
    }

    for (const key of ALL_EVENTS) {
      const fn = config[key];
      if (typeof fn === 'function') this.emitter.on(key, fn as (...a: unknown[]) => void);
    }

    if (this.container) {
      this.renderer = new GridRenderer(this.container, {
        width: config.width,
        height: config.height,
        toolbar: Boolean(config.toolbar),
        onCellClick: (d) => this.handleCellClick(d, false),
        onCellDoubleClick: (d) => this.handleCellClick(d, true),
        onToggle: (node) => this.handleToggle(node),
        emit: (e, ...a) => this.emitter.emit(e, ...a),
        controller: {
          allFields: () => this.getAllHierarchies(),
          moveField: (uniqueName, zone) => this.moveField(uniqueName, zone),
          setMeasureAggregation: (uniqueName, agg) => this.setMeasureAggregation(uniqueName, agg),
          setMeasureFormula: (ref, formula) => this.setMeasureFormula(ref, formula),
          members: (uniqueName) => this.getMembers(uniqueName),
          setFilter: (uniqueName, members) => this.setFilter(uniqueName, members),
          setLabelFilter: (uniqueName, op, query) => this.setLabelFilter(uniqueName, op, query),
          setValueFilter: (uniqueName, measure, op, value, value2) => this.setValueFilter(uniqueName, measure, op, value, value2),
          drillThrough: (cell) => this.getDrillThroughData(cell),
          exportTo: (type) => this.exportTo(type as ExportType),
          toggleSort: (uniqueName) => this.toggleSort(uniqueName),
          sortByMeasure: (uniqueName) => this.sortByMeasure(uniqueName),
          setColumnWidth: (ref, width) => this.setColumnWidth(ref, width),
          reorderColumn: (uniqueName, toZone, toIndex) => this.reorderColumn(uniqueName, toZone, toIndex),
          setColumnDisplay: (ref, display) => this.setColumnDisplay(ref, display),
          setColumnCaption: (ref, caption) => this.setColumnCaption(ref, caption),
          addCondition: (cond) => this.addCondition(cond),
          removeCondition: (id) => this.removeCondition(id),
          getConditions: () => this.getAllConditions(),
          setTopN: (measureUniqueName, mode, quantity) => this.setTopN(measureUniqueName, mode, quantity),
          setBinning: (uniqueName, interval) => this.setBinning(uniqueName, interval ? { interval } : null),
        },
      });
    }

    if (config.report) this.setReport(this.mergeGlobal(config.report));
  }

  private createEngine(config: ProPivotConfig): PivotEngine {
    if (config.accelerator === 'duckdb') {
      try {
        return new DuckDBEngine(config.duckdb);
      } catch (e) {
        console.warn('[ProPivot] DuckDB engine init failed; using main-thread engine.', e);
      }
    }
    if (config.worker && typeof Worker !== 'undefined' && config.workerUrl) {
      try {
        return new WorkerEngine(config.workerUrl);
      } catch (e) {
        console.warn('[ProPivot] Worker init failed; using main-thread engine.', e);
      }
    } else if (config.worker && !config.workerUrl) {
      console.warn('[ProPivot] worker:true requires workerUrl; using main-thread engine.');
    }
    return new LocalEngine();
  }

  /** Which engine path produced the last compute: 'duckdb' or 'builtin' (main-thread/worker). */
  getComputePath(): string {
    return (this.engine.lastPath as string | undefined) ?? 'builtin';
  }

  // ---------- report / lifecycle ----------

  private mergeGlobal(report: Report): Report {
    const g = this.options.global;
    if (!g) return report;
    return {
      ...report,
      dataSource: { ...(g.dataSource ?? {}), ...(report.dataSource ?? {}) },
      options: { ...(g.options ?? {}), ...(report.options ?? {}) },
      localization: report.localization ?? g.localization,
    };
  }

  setReport(report: Report): void {
    this.report = JSON.parse(JSON.stringify(report ?? {}));
    this.emitter.emit('loadingdata');
    void this.computeAndRender(true).then(() => {
      this.emitter.emit('dataloaded');
      this.emitter.emit('reportchange');
      this.emitter.emit('reportcomplete');
      this.emitter.emit('update');
      this.emitter.emit('ready', this);
    });
  }

  getReport(): Report {
    return JSON.parse(JSON.stringify(this.report));
  }

  /** Recompute the cube (re-ingesting data when `withData`) and repaint. */
  private async computeAndRender(withData: boolean): Promise<void> {
    try {
      if (withData) await this.ingest();
      this.normal = normalizeReport(this.report);
      const m = await this.engine.compute(this.report);
      this.matrix = m;
      this.render();
    } catch (e) {
      this.emitter.emit('dataerror', e);
      console.error('[ProPivot] compute error', e);
    }
  }

  /** Load data from inline array or a CSV/JSON file (dataSource.filename). */
  private async ingest(): Promise<void> {
    const ds = this.report.dataSource ?? {};
    if (!ds.data && ds.filename && typeof fetch !== 'undefined') {
      this.emitter.emit('loadingreportfile');
      const text = await fetch(ds.filename).then((r) => r.text());
      const type = ds.type ?? ds.dataSourceType ?? (ds.filename.toLowerCase().endsWith('.csv') ? 'csv' : 'json');
      if (type === 'csv') {
        const parsed = parseCsv(text, ds);
        if (!ds.mapping) this.report.dataSource!.mapping = parsed.mapping;
        this.engine.setData(parsed.data, this.report.dataSource!.mapping);
      } else {
        this.engine.setData(JSON.parse(text), ds.mapping);
      }
      this.emitter.emit('reportfileloaded');
    } else {
      this.engine.setData(ds.data, ds.mapping);
    }
  }

  /** Underlying raw rows that aggregate into a cell (drill-through). */
  getDrillThroughData(cell: CellData): Array<Record<string, unknown>> {
    if (!this.normal) return [];
    const binners: Record<string, Binning> = {};
    for (const h of [...(this.report.slice?.rows ?? []), ...(this.report.slice?.columns ?? [])]) {
      if (h.binning) binners[h.uniqueName] = h.binning;
    }
    return drillThroughRows(this.engine.rawRows(), {
      rowFields: this.normal.rowFields,
      rowPath: cell.rowPath ?? [],
      colFields: this.normal.colFields,
      colPath: cell.colPath ?? [],
      limit: 10000,
      binners,
    });
  }

  refresh(): void {
    void this.computeAndRender(false).then(() => this.emitter.emit('update'));
  }

  /**
   * Build a Report from a RAW dataset that has NO predefined mapping. Pass CSV
   * text, JSON text, or an already-parsed array of row objects: the column list
   * and field types are inferred (numbers aggregate; ISO dates drill Year ›
   * Month › Day), numeric strings are coerced, and a starter slice is assembled
   * (first text field → Rows, first numeric field → a summed Measure).
   *
   * Pure and static — it returns the Report and renders nothing. Hand it to a
   * constructor (`new ProPivot({ container, report })`), `setReport`, or use the
   * instance shortcut `loadData` to parse + render in one call.
   */
  static inferReport(input: string | unknown[], opts: LoadDataOptions = {}): Report {
    const { data, mapping } = parseDataset(input, opts);
    const report = buildStarterReport(data, mapping, { slice: opts.slice });
    if (opts.report) {
      const { dataSource: _ignored, ...rest } = opts.report;
      Object.assign(report, rest); // formats / conditions / options / slice overrides
    }
    return report;
  }

  /**
   * Parse a RAW dataset (CSV/JSON text or an array of rows), infer its columns
   * and types, build a starter report, and render it — so the user can drag
   * fields between zones to pivot. Returns the inferred Report.
   */
  loadData(input: string | unknown[], opts: LoadDataOptions = {}): Report {
    const report = ProPivot.inferReport(input, opts);
    this.setReport(this.mergeGlobal(report));
    return report;
  }

  updateData(dataSource: { data?: unknown[]; filename?: string }): void {
    this.report.dataSource = { ...(this.report.dataSource ?? {}), ...dataSource } as Report['dataSource'];
    void this.computeAndRender(true).then(() => {
      this.emitter.emit('dataloaded');
      this.emitter.emit('update');
    });
  }

  private render(): void {
    if (!this.renderer || !this.matrix || !this.normal) return;
    this.emitter.emit('beforegriddraw');
    this.renderer.render(this.matrix, {
      normal: this.normal,
      conditions: compileConditions(this.report.conditions),
      customizeCell: this.customizeCellFn,
      selected: this.selectedCell,
    });
    this.emitter.emit('aftergriddraw');
  }

  // ---------- events ----------

  on(event: string, handler: (...args: unknown[]) => void): void { this.emitter.on(event, handler); }
  off(event?: string, handler?: (...args: unknown[]) => void): void { this.emitter.off(event, handler); }

  private handleCellClick(data: CellData, dbl: boolean): void {
    // Only value cells drive the selection highlight; header clicks still emit.
    if (data.type === 'value') this.selectedCell = data;
    this.emitter.emit(dbl ? 'celldoubleclick' : 'cellclick', data);
  }

  private handleToggle(node: AxisNode): void {
    node.expanded = !node.expanded;
    this.render();
    this.emitter.emit('update');
  }

  // ---------- slice / sorting ----------

  setSort(hierarchyUniqueName: string, direction: 'asc' | 'desc' | 'unsorted'): void {
    const find = (list?: { uniqueName: string; sort?: string }[]) =>
      list?.find((h) => h.uniqueName === hierarchyUniqueName);
    const slice = this.report.slice ?? (this.report.slice = {});
    const h = find(slice.rows) ?? find(slice.columns);
    if (h) (h as { sort?: string }).sort = direction;
    this.refresh();
  }

  /** Cycle a hierarchy's member sort asc → desc → unsorted (header click). */
  toggleSort(hierarchyUniqueName: string): void {
    const slice = this.report.slice ?? (this.report.slice = {});
    const h = [...(slice.rows ?? []), ...(slice.columns ?? [])].find((x) => x.uniqueName === hierarchyUniqueName);
    if (!h) return;
    const cur = h.sort ?? 'unsorted';
    h.sort = cur === 'asc' ? 'desc' : cur === 'desc' ? 'unsorted' : 'asc';
    this.refresh();
  }

  /** Toggle sorting rows by a measure: desc → asc → off (measure-header click). */
  sortByMeasure(measureUniqueName: string, axis: 'row' | 'column' = 'row'): void {
    const slice = this.report.slice ?? (this.report.slice = {});
    const sorting = (slice.sorting ?? (slice.sorting = {})) as Record<string, { measure?: string; type?: 'asc' | 'desc' } | undefined>;
    const cur = sorting[axis];
    if (cur && cur.measure === measureUniqueName && cur.type === 'desc') sorting[axis] = { measure: measureUniqueName, type: 'asc' };
    else if (cur && cur.measure === measureUniqueName && cur.type === 'asc') delete sorting[axis];
    else sorting[axis] = { measure: measureUniqueName, type: 'desc' };
    this.refresh();
  }

  runQuery(query: Partial<NonNullable<Report['slice']>>): void {
    this.report.slice = { ...(this.report.slice ?? {}), ...query };
    this.refresh();
  }

  /** Change a single measure's aggregation independently (programmatic or via the
   *  clickable column header). Each measure keeps its own aggregation. */
  setMeasureAggregation(uniqueName: string, aggregation: string): void {
    const slice = this.report.slice ?? (this.report.slice = {});
    const m = (slice.measures ?? []).find((x) => x.uniqueName === uniqueName);
    if (m) {
      m.aggregation = aggregation as Measure['aggregation'];
      this.refresh();
    }
  }

  /**
   * Set or clear a measure's calculation formula. A non-empty formula turns the
   * measure into a calculated value (aggregation `none` — the formula computes the
   * cell). An empty string reverts it to a plain `sum` of its field. The formula
   * language is lenient (invalid expressions evaluate to NaN rather than throwing);
   * use `pivot.validateFormula(...)` for friendly pre-flight feedback in a UI.
   */
  setMeasureFormula(ref: ColumnRef, formula: string): void {
    const entry = this.resolveColumn(ref);
    if (!entry || !('aggregation' in entry)) return;
    const m = entry as Measure;
    const trimmed = formula.trim();
    if (trimmed) {
      m.formula = trimmed;
      m.aggregation = 'none';
    } else {
      delete m.formula;
      m.aggregation = 'sum';
    }
    this.refresh();
    this.emitter.emit('columnpropertychange', { ref, property: 'formula', value: trimmed || null });
  }

  /**
   * Check a calculation formula against the available data fields. Returns
   * `{ ok: true }` for a sound (or empty) formula, otherwise `{ ok: false, message }`
   * describing the first problem (unknown field / aggregation / function).
   */
  validateFormula(formula: string): { ok: boolean; message?: string } {
    return validateFormula(formula, this.getAllHierarchies().map((h) => h.uniqueName));
  }

  /** Set the active member filter for a hierarchy (used by the report-filter UI). */
  setFilter(uniqueName: string, members: string[] | null): void {
    this.applyFieldFilter(uniqueName, members && members.length ? { type: 'members', members } : null);
  }

  /** Label (member-text) filter — keep members whose name matches `query`. */
  setLabelFilter(uniqueName: string, operator: LabelOperator, query: string): void {
    this.applyFieldFilter(uniqueName, query ? { type: 'label', labelOperator: operator, query } : null);
  }

  /** Value filter — keep members whose `measure` aggregate passes the threshold. */
  setValueFilter(uniqueName: string, measure: string, operator: ValueOperator, value: number, value2?: number): void {
    this.applyFieldFilter(
      uniqueName,
      measure && operator ? { type: 'value', measure, operator, value, value2 } : null,
    );
  }

  /** Write (or clear, when spec is null) a field's filter, then re-render. */
  private applyFieldFilter(uniqueName: string, spec: FilterSpec | null): void {
    const slice = this.report.slice ?? (this.report.slice = {});
    const all = [
      ...(slice.rows ?? []), ...(slice.columns ?? []), ...(slice.reportFilters ?? []),
    ];
    const h = all.find((x) => x.uniqueName === uniqueName);
    if (h) {
      if (!spec) delete h.filter;
      else h.filter = spec;
    } else {
      // Not a standalone hierarchy (e.g. an expanded date level) — key it by field.
      const ff = slice.fieldFilters ?? (slice.fieldFilters = {});
      if (!spec) delete ff[uniqueName];
      else ff[uniqueName] = spec;
    }
    this.refresh();
  }

  /** Bucket a numeric row/column field into ranges (or clear with null). */
  setBinning(uniqueName: string, binning: Binning | null): void {
    const slice = this.report.slice ?? (this.report.slice = {});
    const h = [...(slice.rows ?? []), ...(slice.columns ?? [])].find((x) => x.uniqueName === uniqueName);
    if (!h) return;
    if (!binning || (!binning.interval && !(binning.breaks && binning.breaks.length))) delete h.binning;
    else h.binning = binning;
    this.refresh();
  }

  /** Move a field between Field-List zones (drag-drop). */
  moveField(uniqueName: string, toZone: Zone): void {
    const slice = this.report.slice ?? (this.report.slice = {});
    // Find the existing entry so its whole object (caption, width, display, and —
    // crucially — a measure's `formula`/`aggregation`/`format`) rides along instead
    // of being rebuilt from scratch.
    const prior = [...(slice.rows ?? []), ...(slice.columns ?? []),
      ...(slice.reportFilters ?? []), ...(slice.measures ?? [])].find((x) => x.uniqueName === uniqueName);

    // A calculated measure's uniqueName is not a real data field, so it can only
    // live in Values — moving it into a dimension/filter zone would strip the
    // formula and the column would vanish. Ignore such moves.
    if (isCalculated(prior) && toZone !== 'measures') return;

    slice.rows = (slice.rows ?? []).filter((h) => h.uniqueName !== uniqueName);
    slice.columns = (slice.columns ?? []).filter((h) => h.uniqueName !== uniqueName);
    slice.reportFilters = (slice.reportFilters ?? []).filter((h) => h.uniqueName !== uniqueName);
    slice.measures = (slice.measures ?? []).filter((m) => m.uniqueName !== uniqueName);

    const caption = prior?.caption ?? this.report.dataSource?.mapping?.[uniqueName]?.caption ?? uniqueName;
    const base = { ...(prior ?? {}), uniqueName, caption };
    switch (toZone) {
      case 'rows': slice.rows.push(base as Hierarchy); break;
      case 'columns': slice.columns.push(base as Hierarchy); break;
      case 'filters': slice.reportFilters.push(base as Hierarchy); break;
      case 'measures': slice.measures.push({ aggregation: 'sum', active: true, ...base } as Measure); break;
      case 'available': break;
    }
    this.refresh();
  }

  // ---------- column properties (resize / reorder / display / caption) ----------

  /** Resolve a ColumnRef to its slice entry (Measure or Hierarchy). */
  private resolveColumn(ref: ColumnRef): Measure | Hierarchy | undefined {
    const slice = this.report.slice ?? (this.report.slice = {});
    if (ref.kind === 'measure') {
      // Re-derive the stable slot key the same way normalize does, so duplicate
      // uniqueNames (sum AND average of the same field) resolve to the right slot.
      const active = (slice.measures ?? []).filter((m) => m.active !== false);
      const count = new Map<string, number>();
      for (const m of active) count.set(m.uniqueName, (count.get(m.uniqueName) ?? 0) + 1);
      const seen = new Map<string, number>();
      for (const m of active) {
        let key = m.uniqueName;
        if ((count.get(m.uniqueName) ?? 0) > 1) {
          const i = seen.get(m.uniqueName) ?? 0;
          seen.set(m.uniqueName, i + 1);
          key = `${m.uniqueName}#${i}`;
        }
        if (key === ref.key) return m;
      }
      return (slice.measures ?? []).find((m) => m.uniqueName === ref.uniqueName);
    }
    return [...(slice.rows ?? []), ...(slice.columns ?? [])].find((h) => h.uniqueName === ref.uniqueName);
  }

  /**
   * Mirror a measure-targeted presentation change onto the cached matrix. `render()`
   * reuses the existing matrix WITHOUT recomputing, and `matrix.measures` are
   * normalized COPIES of the slice measures — so width/display/caption edits must be
   * applied here too, or the grid would keep showing the pre-edit measure.
   * (Dimension columns are read live from `report`, so they need no mirroring.)
   */
  private patchMatrixMeasure(ref: ColumnRef, patch: Partial<Measure>): void {
    if (ref.kind !== 'measure' || !this.matrix) return;
    const m = this.matrix.measures.find((mm) => mm.key === ref.key);
    if (m) Object.assign(m, patch);
  }

  /** Set a column's pixel width (drag-resize). Presentation only — no recompute. */
  setColumnWidth(ref: ColumnRef, width: number): void {
    const entry = this.resolveColumn(ref);
    if (!entry) return;
    entry.width = Math.max(24, Math.round(width));
    this.patchMatrixMeasure(ref, { width: entry.width });
    this.render();
    this.emitter.emit('columnresize', { ref, width: entry.width });
  }

  /** Set (or clear with null) a column's display format. Presentation only. */
  setColumnDisplay(ref: ColumnRef, display: DisplayFormat | null): void {
    const entry = this.resolveColumn(ref);
    if (!entry) return;
    if (display) entry.display = display; else delete entry.display;
    this.patchMatrixMeasure(ref, { display: display ?? undefined });
    this.render();
    this.emitter.emit('columnpropertychange', { ref, property: 'display', value: display });
  }

  /** Rename a column's heading/caption. */
  setColumnCaption(ref: ColumnRef, caption: string): void {
    const entry = this.resolveColumn(ref);
    if (!entry) return;
    entry.caption = caption;
    this.patchMatrixMeasure(ref, { caption });
    this.render();
    this.emitter.emit('columnpropertychange', { ref, property: 'caption', value: caption });
  }

  /**
   * Reorder a column to `toZone` at `toIndex` (within a zone or across zones),
   * preserving the column's object (width / display / filter / aggregation ride
   * along). Recomputes the cube since order/zone change the layout.
   */
  reorderColumn(uniqueName: string, toZone: Zone, toIndex: number, from?: { zone: Zone; index: number }): void {
    const slice = this.report.slice ?? (this.report.slice = {});
    slice.rows = slice.rows ?? [];
    slice.columns = slice.columns ?? [];
    slice.reportFilters = slice.reportFilters ?? [];
    slice.measures = slice.measures ?? [];

    const zoneArr = (z: Zone): Array<Hierarchy | Measure> | undefined =>
      z === 'rows' ? slice.rows : z === 'columns' ? slice.columns
        : z === 'filters' ? slice.reportFilters : z === 'measures' ? slice.measures : undefined;

    // Detach the existing entry, recording its original index so a same-zone
    // reorder can compensate for the shift below. Prefer the caller-pinned source
    // slot (disambiguates duplicate-uniqueName measures); otherwise fall back to
    // the first matching uniqueName across zones.
    let fromZone: Zone | null = null;
    let fromIndex = -1;
    let hier: Hierarchy | undefined;
    let meas: Measure | undefined;
    const take = (z: Zone, i: number): void => {
      const removed = (zoneArr(z) as Array<Hierarchy | Measure>).splice(i, 1)[0];
      fromZone = z;
      fromIndex = i;
      if (z === 'measures') meas = removed as Measure; else hier = removed as Hierarchy;
    };

    const pinned = from && zoneArr(from.zone);
    if (pinned && pinned[from!.index]?.uniqueName === uniqueName) {
      take(from!.zone, from!.index);
    } else {
      const detach = <T extends { uniqueName: string }>(arr: T[]): T | undefined => {
        const i = arr.findIndex((x) => x.uniqueName === uniqueName);
        if (i < 0) return undefined;
        fromIndex = i;
        return arr.splice(i, 1)[0];
      };
      if ((hier = detach(slice.rows))) fromZone = 'rows';
      else if ((hier = detach(slice.columns))) fromZone = 'columns';
      else if ((hier = detach(slice.reportFilters))) fromZone = 'filters';
      else if ((meas = detach(slice.measures))) fromZone = 'measures';
    }

    // A calculated measure can only live in Values (its uniqueName isn't a real
    // field). Reject a drop into a dimension/filter zone by restoring it where it
    // came from, so the column isn't silently destroyed.
    if (isCalculated(meas) && toZone !== 'measures' && fromZone === 'measures' && fromIndex >= 0) {
      slice.measures.splice(fromIndex, 0, meas as Measure);
      return;
    }

    // `toIndex` is the drop target's index in the PRE-detach array. When the item
    // is reordered within the same zone and it sat before the target, detaching it
    // shifted every later entry (including the target) down by one — so we must
    // decrement the insertion index to land before the column the user aimed at.
    // Otherwise (cross-zone move, or dragging a lower item up) the target keeps its
    // index and `toIndex` is already correct.
    let insertIndex = toIndex;
    if (fromZone === toZone && fromIndex >= 0 && fromIndex < toIndex) insertIndex -= 1;

    // Carry the dragged entry's own caption across a zone change (e.g. a measure
    // captioned "Units" moved to columns), so a custom heading isn't lost to the
    // raw field name. Fall back to the mapping caption only for brand-new entries.
    const caption = hier?.caption ?? meas?.caption
      ?? this.report.dataSource?.mapping?.[uniqueName]?.caption ?? uniqueName;
    const clampIndex = (arr: unknown[]) => Math.max(0, Math.min(insertIndex, arr.length));

    // Carry the whole detached object across a zone change so width / display /
    // filter / aggregation / format ride along; only swap in the destination-required
    // fields (caption everywhere, aggregation/active when landing in Values).
    const carried = hier ?? meas;
    switch (toZone) {
      case 'rows':
      case 'columns':
      case 'filters': {
        const entry = { ...(carried ?? {}), uniqueName, caption } as Hierarchy;
        const arr = toZone === 'rows' ? slice.rows : toZone === 'columns' ? slice.columns : slice.reportFilters;
        arr.splice(clampIndex(arr), 0, entry);
        break;
      }
      case 'measures': {
        const entry = { aggregation: 'sum', active: true, ...(carried ?? {}), uniqueName, caption } as Measure;
        slice.measures.splice(clampIndex(slice.measures), 0, entry);
        break;
      }
      case 'available':
        break; // detached and not re-inserted
    }
    this.refresh();
    this.emitter.emit('columnreorder', { uniqueName, fromZone, toZone, toIndex });
  }

  /** Top/Bottom-N filter on the first row hierarchy, ranked by a measure. */
  setTopN(measureUniqueName: string, mode: 'top' | 'bottom' | 'off', quantity: number): void {
    const slice = this.report.slice ?? (this.report.slice = {});
    const target = (slice.rows ?? [])[0];
    if (!target) return;
    if (mode === 'off') delete target.filter;
    else target.filter = { type: mode, measure: measureUniqueName, quantity: Math.max(1, Math.round(quantity)) };
    this.refresh();
    this.emitter.emit('columnpropertychange', { ref: { kind: 'measure', uniqueName: measureUniqueName }, property: 'topN', value: { mode, quantity } });
  }

  // ---------- conditions ----------

  addCondition(condition: Condition): void {
    const list = this.report.conditions ?? (this.report.conditions = []);
    if (condition.id === undefined) condition.id = list.length + 1;
    list.push(condition);
    this.render();
    this.emitter.emit('update');
  }

  getAllConditions(): Condition[] { return JSON.parse(JSON.stringify(this.report.conditions ?? [])); }

  removeCondition(id: number): void {
    if (!this.report.conditions) return;
    this.report.conditions = this.report.conditions.filter((c) => c.id !== id);
    this.render();
  }

  removeAllConditions(): void { this.report.conditions = []; this.render(); }

  // ---------- measures ----------

  addCalculatedMeasure(measure: Measure): void {
    const slice = this.report.slice ?? (this.report.slice = {});
    const measures = slice.measures ?? (slice.measures = []);
    measures.push({ aggregation: 'none', active: true, ...measure });
    this.refresh();
  }

  removeCalculatedMeasure(uniqueName: string): void {
    const slice = this.report.slice;
    if (slice?.measures) slice.measures = slice.measures.filter((m) => m.uniqueName !== uniqueName);
    this.refresh();
  }

  getAllMeasures(): Array<Record<string, unknown>> {
    const measures = this.normal?.measures ?? [];
    return measures.map((m) => ({
      uniqueName: m.uniqueName,
      name: m.uniqueName,
      caption: m.caption,
      originalCaption: m.caption,
      aggregation: m.aggregation,
      availableAggregations: m.availableAggregations ?? ALL_AGGREGATIONS,
      availableAggregationsCaptions: (m.availableAggregations ?? ALL_AGGREGATIONS).map((a) => AGGREGATION_CAPTIONS[a] ?? a),
      calculated: m.calculated,
      format: m.format ?? '',
      formula: m.formula ?? '',
      grandTotalCaption: m.grandTotalCaption ?? '',
      individual: m.individual ?? false,
    }));
  }

  getAllHierarchies(): Array<{ uniqueName: string; caption: string }> {
    const mapping = this.report.dataSource?.mapping ?? {};
    const out: Array<{ uniqueName: string; caption: string }> = [];
    const seen = new Set<string>();
    const push = (name: string) => {
      if (seen.has(name)) return;
      seen.add(name);
      out.push({ uniqueName: name, caption: mapping[name]?.caption ?? name });
    };
    for (const k of Object.keys(mapping)) push(k);
    const first = this.engine.rawRows()[0];
    if (first) for (const k of Object.keys(first)) push(k);
    return out;
  }

  /** Distinct display members of a field, for the filter pickers. Uses the
   *  store-backed list when available (so expanded date-hierarchy levels like
   *  "Date (Year)" resolve), and falls back to scanning the raw rows. */
  getMembers(uniqueName: string): string[] {
    const fromEngine = this.engine.members?.(uniqueName);
    const seen = new Set<string>();
    if (fromEngine && fromEngine.length) {
      for (const m of fromEngine) seen.add(m);
    } else {
      for (const row of this.engine.rawRows()) {
        const v = row[uniqueName];
        seen.add(v === null || v === undefined || v === '' ? '' : String(v));
      }
    }
    return [...seen].sort((a, b) => {
      const na = Number(a), nb = Number(b);
      return !Number.isNaN(na) && !Number.isNaN(nb) ? na - nb : a.localeCompare(b);
    });
  }

  // ---------- options ----------

  getOptions(): Options { return JSON.parse(JSON.stringify(this.report.options ?? {})); }
  setOptions(options: Options): void { this.report.options = { ...(this.report.options ?? {}), ...options }; }

  // ---------- drill / expand ----------

  expandAllData(): void { this.setExpandAll(true); }
  collapseAllData(): void { this.setExpandAll(false); }

  private setExpandAll(expanded: boolean): void {
    if (!this.matrix) return;
    const walk = (nodes: AxisNode[]) => nodes.forEach((n) => { n.expanded = expanded; walk(n.children); });
    walk(this.matrix.rowTree);
    walk(this.matrix.colTree);
    const slice = this.report.slice ?? (this.report.slice = {});
    slice.expands = { ...(slice.expands ?? {}), expandAll: expanded };
    this.render();
    this.emitter.emit('update');
  }

  // ---------- selection ----------

  getSelectedCell(): CellData | null { return this.selectedCell; }
  getCell(rowIdx: number, colIdx: number): CellData | null { return this.renderer?.getCellData(rowIdx, colIdx) ?? null; }
  removeSelection(): void { this.selectedCell = null; this.render(); }

  // ---------- UI hooks ----------

  customizeCell(fn: (cell: unknown, data: CellData) => void): void {
    this.customizeCellFn = fn;
    this.render();
  }

  customizeContextMenu(fn: (items: unknown[], data: unknown, viewType: string) => unknown[]): void {
    this.customizeContextMenuFn = fn;
  }

  /** Charts are out of scope (docs/Architecture.md) — safe no-ops. */
  showCharts(): void { /* no-op: pivot table only */ }
  showGrid(): void { /* no-op */ }

  // ---------- export ----------

  exportTo(type: ExportType, params?: ExportParams, callback?: (result: unknown) => void): void {
    if (!this.matrix || !this.normal) return;
    const result = exportMatrix(type, this.matrix, this.normal, params);
    if (callback) callback(result);
  }

  // ---------- data accessor ----------

  getData(_options: unknown, callback?: (raw: unknown) => void): { data: unknown[]; meta: Record<string, unknown> } {
    const rows = this.engine.rawRows();
    const raw = { data: rows, meta: { cAmount: 0, rAmount: rows.length, vAmount: this.normal?.measures.length ?? 0 } };
    if (callback) callback(raw);
    return raw;
  }

  // ---------- teardown ----------

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer?.destroy();
    this.engine.dispose();
    this.emitter.clear();
    this.renderer = null;
    this.matrix = null;
    this.normal = null;
    this.selectedCell = null;
  }
}
