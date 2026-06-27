// DOM grid renderer (docs/Architecture.md).
// Renders the pivot from a CellMatrix. grid.type controls ONLY how row fields are
// laid out: 'compact' nests them in one indented column (expand/collapse); 'flat'
// and 'classic' give each row field its own column. Columns/measures are identical
// across modes. Virtualizes rows, applies customizeCell + conditions, and lets the
// user change a measure's aggregation by clicking its column header.

import type { CellMatrix, AxisNode } from '../core/matrix';
import { pathKey, GS } from '../core/matrix';
import type { NormalReport } from '../core/normalize';
import { totalsEnabled } from '../core/normalize';
import { ALL_AGGREGATIONS, AGGREGATION_CAPTIONS } from '../core/aggregations';
import type { CompiledCondition } from '../core/conditions';
import type { DisplayFormat, DisplayFormatType, Condition, FieldType, Hierarchy } from '../core/types';
import { formatVisual, evalConditionStyle, formatsForType } from '../core/cellStyle';
import { CellBuilder, type CellData, type CellTupleItem } from '../facade/cell';

export type Zone = 'rows' | 'columns' | 'measures' | 'filters' | 'available';

/** Identifies a grid column for the column-properties / resize / display APIs. */
export type ColumnRef =
  | { kind: 'measure'; uniqueName: string; key: string }
  | { kind: 'field'; uniqueName: string };

export interface PivotController {
  allFields(): Array<{ uniqueName: string; caption: string }>;
  moveField(uniqueName: string, toZone: Zone): void;
  setMeasureAggregation(uniqueName: string, aggregation: string): void;
  /** Distinct display members of a field (for the report-filter picker). */
  members(uniqueName: string): string[];
  /** Apply (or clear, when members is null) a member filter. */
  setFilter(uniqueName: string, members: string[] | null): void;
  /** Underlying raw rows that aggregate into a cell (drill-through). */
  drillThrough(cell: CellData): Array<Record<string, unknown>>;
  /** Export the current view. */
  exportTo(type: string): void;
  /** Cycle a hierarchy's member sort (header click). */
  toggleSort(uniqueName: string): void;
  /** Toggle sorting rows by a measure (measure-header click). */
  sortByMeasure(uniqueName: string): void;
  /** Set a column's pixel width (drag-resize). */
  setColumnWidth(ref: ColumnRef, width: number): void;
  /** Reorder a column to a zone + index (drag-reorder, within or across zones). */
  reorderColumn(uniqueName: string, toZone: Zone, toIndex: number): void;
  /** Set (or clear with null) a column's display format. */
  setColumnDisplay(ref: ColumnRef, display: DisplayFormat | null): void;
  /** Rename a column's heading/caption. */
  setColumnCaption(ref: ColumnRef, caption: string): void;
  /** Add a conditional-format rule. */
  addCondition(condition: Condition): void;
  /** Remove a conditional-format rule by id. */
  removeCondition(id: number): void;
  /** All conditions (used to populate the column-properties panel). */
  getConditions(): Condition[];
  /** Apply a Top/Bottom-N filter to a row hierarchy ranked by a measure. */
  setTopN(measureUniqueName: string, mode: 'top' | 'bottom' | 'off', quantity: number): void;
}

export interface RendererOptions {
  width?: string | number;
  height?: string | number;
  onCellClick: (data: CellData) => void;
  onCellDoubleClick: (data: CellData) => void;
  onToggle: (node: AxisNode) => void;
  emit: (event: string, ...args: unknown[]) => void;
  controller: PivotController;
  rowHeight?: number;
  virtualizeThreshold?: number;
  /** Render the built-in toolbar. */
  toolbar?: boolean;
}

export interface RenderContext {
  normal: NormalReport;
  conditions: CompiledCondition[];
  customizeCell?: (cell: unknown, data: CellData) => void;
  selected: CellData | null;
}

interface VisualRow {
  node: AxisNode | null;
  path: string[];
  label: string;
  depth: number;
  isGroup: boolean;
  isSubtotal: boolean;
  isGrand: boolean;
}

interface BodyState {
  matrix: CellMatrix;
  ctx: RenderContext;
  visualRows: VisualRow[];
  colLeaves: AxisNode[];
  measures: CellMatrix['measures'];
  showColGrand: boolean;
  colCount: number;
  rowHeaderCols: number;
  multi: boolean;
  rowHeight: number;
  tbody: HTMLElement;
  scroll: HTMLElement;
}

export class GridRenderer {
  private root: HTMLElement;
  private gridEl: HTMLElement;
  private cellIndex = new Map<string, CellData>();
  private body: BodyState | null = null;
  private rowHeight: number;
  private threshold: number;
  private onScroll = () => this.paintBody();
  private editor: HTMLElement | null = null;
  private editorOutside?: (e: MouseEvent) => void;
  private editorKey?: (e: KeyboardEvent) => void;
  /** Per-measure-slot value range, used to auto-scale data_bar / heatmap. */
  private colStats = new Map<string, { min: number; max: number }>();

  constructor(container: HTMLElement, private opts: RendererOptions) {
    this.root = container;
    this.root.classList.add('pp-root');
    this.root.innerHTML = '';
    if (opts.width !== undefined) this.root.style.width = size(opts.width);
    if (opts.height !== undefined) this.root.style.height = size(opts.height);
    this.gridEl = document.createElement('div');
    this.gridEl.className = 'pp-grid-wrap';
    this.root.appendChild(this.gridEl);
    this.rowHeight = opts.rowHeight ?? 28;
    this.threshold = opts.virtualizeThreshold ?? 150;
  }

  destroy(): void {
    this.closeEditor();
    if (this.body) this.body.scroll.removeEventListener('scroll', this.onScroll);
    this.root.innerHTML = '';
    this.root.classList.remove('pp-root');
    this.cellIndex.clear();
    this.body = null;
  }

  getCellData(rowIdx: number, colIdx: number): CellData | null {
    return this.cellIndex.get(`${rowIdx}:${colIdx}`) ?? null;
  }

  render(matrix: CellMatrix, ctx: RenderContext): void {
    this.closeEditor();
    this.cellIndex.clear();
    if (this.body) this.body.scroll.removeEventListener('scroll', this.onScroll);
    this.body = null;
    this.gridEl.innerHTML = '';

    if (this.opts.toolbar) this.gridEl.appendChild(this.buildToolbar());
    if (ctx.normal.options.configuratorButton !== false) {
      this.gridEl.appendChild(this.buildFieldList(matrix, ctx));
    }
    const filtersBar = this.buildFiltersBar(ctx);
    if (filtersBar) this.gridEl.appendChild(filtersBar);

    const R = matrix.rowFields.length;
    const mode = ctx.normal.grid.type ?? 'compact';
    const multi = mode !== 'compact' && R > 0;
    const rowHeaderCols = multi ? R : 1;

    const table = document.createElement('table');
    table.className = 'pp-table';

    const colLeaves = matrix.colTree.length ? preorderLeaves(matrix.colTree) : [emptyNode()];
    const measures = matrix.measures;
    const showColGrand = totalsEnabled(ctx.normal.grid.showGrandTotals, 'columns') && matrix.colTree.length > 0;

    this.computeColStats(matrix);
    const colgroup = this.buildColgroup(ctx, colLeaves, measures, showColGrand, rowHeaderCols, multi);
    if (colgroup) table.appendChild(colgroup);

    table.appendChild(this.buildHead(matrix, ctx, colLeaves, showColGrand, rowHeaderCols, multi));

    const tbody = document.createElement('tbody');
    table.appendChild(tbody);

    const scroll = document.createElement('div');
    scroll.className = 'pp-scroll';
    scroll.appendChild(table);
    this.gridEl.appendChild(scroll);

    const measureSpan = Math.max(1, measures.length);
    const colCount = rowHeaderCols + colLeaves.length * measureSpan + (showColGrand ? measureSpan : 0);

    this.body = {
      matrix, ctx,
      visualRows: this.collectVisualRows(matrix, ctx, mode),
      colLeaves, measures, showColGrand, colCount, rowHeaderCols, multi,
      rowHeight: this.rowHeight, tbody, scroll,
    };
    scroll.addEventListener('scroll', this.onScroll);
    this.paintBody();
  }

  /** Min/max per measure slot across the matrix, to auto-scale data_bar/heatmap. */
  private computeColStats(matrix: CellMatrix): void {
    this.colStats.clear();
    const needs = matrix.measures.some((m) => {
      const t = m.display?.type;
      return t === 'data_bar' || t === 'progress' || t === 'heatmap' || t === 'percent_ring';
    });
    if (!needs) return;
    for (const [k, v] of matrix.cells) {
      if (!Number.isFinite(v)) continue;
      const mk = k.slice(k.lastIndexOf(GS) + 1);
      const cur = this.colStats.get(mk);
      if (!cur) this.colStats.set(mk, { min: v, max: v });
      else { if (v < cur.min) cur.min = v; if (v > cur.max) cur.max = v; }
    }
  }

  /** A <colgroup> carrying per-column widths so they survive row virtualization. */
  private buildColgroup(
    ctx: RenderContext, colLeaves: AxisNode[], measures: CellMatrix['measures'],
    showColGrand: boolean, rowHeaderCols: number, multi: boolean,
  ): HTMLElement | null {
    const rowFields = ctx.normal.rowFields;
    const measureSpan = Math.max(1, measures.length);
    const colCount = rowHeaderCols + colLeaves.length * measureSpan + (showColGrand ? measureSpan : 0);
    const cg = document.createElement('colgroup');
    const addCol = (w?: number) => {
      const col = document.createElement('col');
      if (w && w > 0) col.style.width = `${w}px`;
      cg.appendChild(col);
    };
    // Row-header columns.
    if (multi) for (let j = 0; j < rowHeaderCols; j++) addCol(hierarchyOf(ctx, rowFields[j])?.width);
    else addCol(rowFields.length ? hierarchyOf(ctx, rowFields[0])?.width : undefined);
    // Value columns (per leaf, then grand) — one per measure slot.
    const measureCols = () => { for (const m of measures.length ? measures : [null]) addCol(m?.width); };
    for (let i = 0; i < colLeaves.length; i++) measureCols();
    if (showColGrand) measureCols();
    // Guard: only emit when it matches the body column count.
    return cg.childElementCount === colCount ? cg : null;
  }

  // ---------- virtualized body ----------

  private paintBody(): void {
    const b = this.body;
    if (!b) return;
    const total = b.visualRows.length;
    const virtualize = total > this.threshold;
    let start = 0;
    let end = total;
    if (virtualize) {
      const viewport = b.scroll.clientHeight || 400;
      const overscan = 8;
      start = Math.max(0, Math.floor(b.scroll.scrollTop / b.rowHeight) - overscan);
      end = Math.min(total, start + Math.ceil(viewport / b.rowHeight) + overscan * 2);
    }
    b.tbody.innerHTML = '';
    if (virtualize && start > 0) b.tbody.appendChild(spacer(b.colCount, start * b.rowHeight));
    for (let i = start; i < end; i++) b.tbody.appendChild(this.buildRow(b, b.visualRows[i], i));
    if (virtualize && end < total) b.tbody.appendChild(spacer(b.colCount, (total - end) * b.rowHeight));
  }

  // ---------- header ----------

  private buildHead(
    matrix: CellMatrix, ctx: RenderContext, colLeaves: AxisNode[],
    showColGrand: boolean, rowHeaderCols: number, multi: boolean,
  ): HTMLElement {
    const thead = document.createElement('thead');
    const measures = matrix.measures;
    const measureSpan = Math.max(1, measures.length);
    const colDepth = matrix.colFields.length;
    const combinedCaption = matrix.rowFields.map((f) => captionOf(ctx, f)).join(' / ') || ' ';

    for (let d = 0; d < colDepth; d++) {
      const tr = document.createElement('tr');
      if (d === 0) {
        const corner = document.createElement('th');
        corner.className = 'pp-corner';
        corner.colSpan = rowHeaderCols;
        corner.rowSpan = multi ? colDepth : colDepth + 1;
        if (!multi) {
          corner.textContent = combinedCaption;
          // Compact mode nests every row field into this one corner column — give it
          // a panel for the (first) row field so the row dimension is reachable.
          if (matrix.rowFields.length) this.decorateHeader(corner, ctx, { ref: { kind: 'field', uniqueName: matrix.rowFields[0] }, zone: 'rows', index: 0 });
        }
        tr.appendChild(corner);
      }
      let i = 0;
      while (i < colLeaves.length) {
        const label = colLeaves[i].path[d] ?? '';
        let span = 1;
        while (i + span < colLeaves.length && (colLeaves[i + span].path[d] ?? '') === label) span++;
        const th = document.createElement('th');
        th.className = 'pp-colh';
        th.colSpan = span * measureSpan;
        this.renderMember(th, ctx, matrix.colFields[d], label);
        this.decorateHeader(th, ctx, { ref: { kind: 'field', uniqueName: matrix.colFields[d] }, zone: 'columns', index: d, resizable: false });
        const colTuplePath = colLeaves[i].path.slice(0, d + 1);
        const colTupleIdx = i;
        th.addEventListener('click', () => this.emitHeaderClick(ctx, 'columns', matrix.colFields, colTuplePath, -1, colTupleIdx));
        tr.appendChild(th);
        i += span;
      }
      if (showColGrand) {
        const th = document.createElement('th');
        th.className = 'pp-colh pp-grand';
        th.colSpan = measureSpan;
        if (d === 0) { th.rowSpan = colDepth; th.textContent = ctx.normal.localization.grandTotal; }
        tr.appendChild(th);
      }
      thead.appendChild(tr);
    }

    const trM = document.createElement('tr');
    if (multi) {
      for (const f of matrix.rowFields) {
        const th = document.createElement('th');
        th.className = 'pp-corner';
        const hier = hierarchyOf(ctx, f);
        th.textContent = captionOf(ctx, f) + (hier ? sortGlyph(hier.sort) : '');
        if (hier) {
          th.classList.add('pp-sortable');
          th.title = 'Click to sort';
          th.addEventListener('click', () => this.opts.controller.toggleSort(f));
        }
        this.decorateHeader(th, ctx, { ref: { kind: 'field', uniqueName: f }, zone: 'rows', index: matrix.rowFields.indexOf(f) });
        trM.appendChild(th);
      }
    } else if (colDepth === 0) {
      const corner = document.createElement('th');
      corner.className = 'pp-corner';
      corner.textContent = combinedCaption;
      if (matrix.rowFields.length) this.decorateHeader(corner, ctx, { ref: { kind: 'field', uniqueName: matrix.rowFields[0] }, zone: 'rows', index: 0 });
      trM.appendChild(corner);
    }
    const measureHeaders = (count: number, grand: boolean) => {
      for (let c = 0; c < count; c++) {
        if (!measures.length) {
          const th = document.createElement('th');
          th.className = 'pp-measureh' + (grand ? ' pp-grand' : '');
          trM.appendChild(th);
          continue;
        }
        for (let mi = 0; mi < measures.length; mi++) trM.appendChild(this.measureHeader(measures[mi], grand, ctx, mi));
      }
    };
    measureHeaders(colLeaves.length, false);
    if (showColGrand) measureHeaders(1, true);
    thead.appendChild(trM);
    return thead;
  }

  private measureHeader(m: CellMatrix['measures'][number], grand: boolean, ctx: RenderContext, index: number): HTMLElement {
    const th = document.createElement('th');
    th.className = 'pp-measureh' + (grand ? ' pp-grand' : '');
    // The heading stays clean — caption only (clicking it sorts rows by this measure).
    const cap = document.createElement('span');
    cap.className = 'pp-measureh-cap pp-sortable';
    const rowSort = ctx.normal.report.slice?.sorting?.row;
    const sorted = rowSort && rowSort.measure === m.uniqueName ? (rowSort.type === 'desc' ? ' ▼' : ' ▲') : '';
    cap.textContent = m.caption + sorted;
    cap.title = 'Click to sort rows by this measure';
    cap.addEventListener('click', (e) => { e.stopPropagation(); this.opts.controller.sortByMeasure(m.uniqueName); });
    th.appendChild(cap);
    // Aggregation now lives in the column-properties panel (the ▾ button added by
    // decorateHeader) — no separate gear button, so the two no longer duplicate.
    this.decorateHeader(th, ctx, { ref: { kind: 'measure', uniqueName: m.uniqueName, key: m.key }, zone: 'measures', index });
    return th;
  }

  /** Clamp a fixed-position popup so it stays fully inside the viewport. */
  private placePopup(pop: HTMLElement, ev: MouseEvent): void {
    const m = 8;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
    const rect = pop.getBoundingClientRect();
    let left = ev.clientX;
    let top = ev.clientY;
    if (left + rect.width + m > vw) left = vw - rect.width - m;
    if (top + rect.height + m > vh) top = vh - rect.height - m;
    pop.style.left = `${Math.max(m, left)}px`;
    pop.style.top = `${Math.max(m, top)}px`;
  }

  private closeEditor(): void {
    if (this.editor) { this.editor.remove(); this.editor = null; }
    if (this.editorOutside) { document.removeEventListener('mousedown', this.editorOutside); this.editorOutside = undefined; }
    if (this.editorKey) { document.removeEventListener('keydown', this.editorKey); this.editorKey = undefined; }
    if (this.resizeMove) { document.removeEventListener('mousemove', this.resizeMove); this.resizeMove = undefined; }
    if (this.resizeUp) { document.removeEventListener('mouseup', this.resizeUp); this.resizeUp = undefined; }
  }

  // ---------- column controls (resize / reorder / properties) ----------

  /** Add resize handle, drag-reorder, and a properties button to a header cell. */
  private decorateHeader(
    th: HTMLElement, ctx: RenderContext,
    o: { ref: ColumnRef; zone: Zone; index: number; resizable?: boolean },
  ): void {
    const cp = ctx.normal.columnProps;
    if (!cp.enabled) return;

    if (cp.edit) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pp-colprops';
      btn.title = 'Column properties';
      btn.textContent = '▾';
      btn.addEventListener('click', (e) => { e.stopPropagation(); this.openColumnPropsEditor(e as MouseEvent, ctx, o.ref); });
      th.appendChild(btn);
    }

    if (cp.reorder) {
      th.draggable = true;
      th.classList.add('pp-draggable');
      th.addEventListener('dragstart', (e) => {
        e.dataTransfer?.setData('text/plain', o.ref.uniqueName);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      });
      th.addEventListener('dragover', (e) => { e.preventDefault(); th.classList.add('pp-col-dragover'); });
      th.addEventListener('dragleave', () => th.classList.remove('pp-col-dragover'));
      th.addEventListener('drop', (e) => {
        e.preventDefault();
        th.classList.remove('pp-col-dragover');
        const name = e.dataTransfer?.getData('text/plain');
        if (name && name !== o.ref.uniqueName) this.opts.controller.reorderColumn(name, o.zone, o.index);
      });
    }

    if (o.resizable !== false && cp.resize) {
      const handle = document.createElement('span');
      handle.className = 'pp-resize';
      handle.title = 'Drag to resize';
      handle.addEventListener('click', (e) => e.stopPropagation());
      handle.addEventListener('mousedown', (e) => this.startResize(e as MouseEvent, th, o.ref));
      handle.draggable = false;
      th.appendChild(handle);
    }
  }

  private resizeMove?: (e: MouseEvent) => void;
  private resizeUp?: (e: MouseEvent) => void;

  private startResize(e: MouseEvent, th: HTMLElement, ref: ColumnRef): void {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = th.getBoundingClientRect().width || 80;
    this.resizeMove = (ev: MouseEvent) => {
      const w = Math.max(24, startW + (ev.clientX - startX));
      th.style.width = `${w}px`;
    };
    this.resizeUp = (ev: MouseEvent) => {
      if (this.resizeMove) document.removeEventListener('mousemove', this.resizeMove);
      if (this.resizeUp) document.removeEventListener('mouseup', this.resizeUp);
      this.resizeMove = undefined; this.resizeUp = undefined;
      const w = Math.max(24, startW + (ev.clientX - startX));
      this.opts.controller.setColumnWidth(ref, w);
    };
    document.addEventListener('mousemove', this.resizeMove);
    document.addEventListener('mouseup', this.resizeUp);
  }

  // ---------- column-properties panel ----------

  private openColumnPropsEditor(ev: MouseEvent, ctx: RenderContext, ref: ColumnRef): void {
    if (!ctx.normal.columnProps.edit) return;
    this.closeEditor();

    const isMeasure = ref.kind === 'measure';
    const measure = isMeasure ? (this.body?.measures.find((m) => m.key === ref.key) ?? null) : null;
    const field = isMeasure ? (measure?.uniqueName ?? ref.uniqueName) : ref.uniqueName;
    const caption = isMeasure ? (measure?.caption ?? ref.uniqueName) : captionOf(ctx, field);
    const fieldType: FieldType = isMeasure ? 'number' : (fieldTypeOf(ctx, field) ?? 'string');
    const currentDisplay: DisplayFormat | undefined = isMeasure ? measure?.display : hierarchyOf(ctx, field)?.display;

    const pop = document.createElement('div');
    pop.className = 'pp-popup pp-colprops-popup';
    // Positioned after it is in the DOM (so we can measure it) — see placePopup below.
    pop.style.left = '0px';
    pop.style.top = '0px';
    pop.style.visibility = 'hidden';

    const title = document.createElement('div');
    title.className = 'pp-popup-title';
    title.textContent = caption;
    pop.appendChild(title);

    // Tabs.
    const tabsBar = document.createElement('div');
    tabsBar.className = 'pp-tabs';
    const panes = document.createElement('div');
    panes.className = 'pp-tab-panes';
    const tabDefs: Array<{ id: string; label: string; build: (p: HTMLElement) => void }> = [];

    tabDefs.push({ id: 'props', label: 'Properties', build: (p) => this.buildPropsPane(p, ctx, ref, measure, caption) });
    tabDefs.push({ id: 'display', label: 'Display', build: (p) => this.buildDisplayPane(p, ctx, ref, fieldType, currentDisplay) });
    if (isMeasure) tabDefs.push({ id: 'cond', label: 'Conditional', build: (p) => this.buildConditionsPane(p, ctx, ref) });
    tabDefs.push({ id: 'filter', label: 'Filter', build: (p) => this.buildFilterPane(p, ctx, ref, field) });

    const paneEls: Record<string, HTMLElement> = {};
    let active = '';
    const activate = (id: string) => {
      active = id;
      for (const d of tabDefs) {
        paneEls[d.id].style.display = d.id === id ? '' : 'none';
        tabsBar.querySelector(`[data-tab="${d.id}"]`)?.classList.toggle('pp-tab-active', d.id === id);
      }
    };
    for (const d of tabDefs) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pp-tab';
      b.dataset.tab = d.id;
      b.textContent = d.label;
      b.addEventListener('click', () => activate(d.id));
      tabsBar.appendChild(b);
      const pane = document.createElement('div');
      pane.className = 'pp-tab-pane';
      d.build(pane);
      paneEls[d.id] = pane;
      panes.appendChild(pane);
    }
    pop.append(tabsBar, panes);
    activate(tabDefs[0].id);

    document.body.appendChild(pop);
    this.placePopup(pop, ev);
    pop.style.visibility = '';
    this.editor = pop;
    this.editorOutside = (e: MouseEvent) => { if (!pop.contains(e.target as Node)) this.closeEditor(); };
    this.editorKey = (e: KeyboardEvent) => { if (e.key === 'Escape') this.closeEditor(); };
    setTimeout(() => { if (this.editorOutside) document.addEventListener('mousedown', this.editorOutside); }, 0);
    document.addEventListener('keydown', this.editorKey);
  }

  private buildPropsPane(
    p: HTMLElement, ctx: RenderContext, ref: ColumnRef,
    measure: CellMatrix['measures'][number] | null, caption: string,
  ): void {
    p.appendChild(fieldRow('Heading', (() => {
      const wrap = document.createElement('div');
      wrap.className = 'pp-field-inline';
      const input = document.createElement('input');
      input.type = 'text';
      input.value = caption;
      const apply = primaryBtn('Apply', () => this.opts.controller.setColumnCaption(ref, input.value));
      wrap.append(input, apply);
      return wrap;
    })()));

    if (ref.kind === 'measure' && measure && !measure.calculated) {
      p.appendChild(fieldRow('Aggregation', (() => {
        const sel = document.createElement('select');
        for (const a of ALL_AGGREGATIONS) {
          const o = document.createElement('option');
          o.value = a; o.textContent = AGGREGATION_CAPTIONS[a] ?? a;
          if (a === measure.aggregation) o.selected = true;
          sel.appendChild(o);
        }
        sel.addEventListener('change', () => this.opts.controller.setMeasureAggregation(measure.uniqueName, sel.value));
        return sel;
      })()));
    }

    if (ctx.normal.columnProps.resize) {
      p.appendChild(fieldRow('Width (px)', (() => {
        const wrap = document.createElement('div');
        wrap.className = 'pp-field-inline';
        const input = document.createElement('input');
        input.type = 'number'; input.min = '24'; input.placeholder = 'auto';
        const cur = ref.kind === 'measure' ? measure?.width : hierarchyOf(ctx, ref.uniqueName)?.width;
        if (cur) input.value = String(cur);
        const apply = primaryBtn('Apply', () => { const w = Number(input.value); if (w > 0) this.opts.controller.setColumnWidth(ref, w); });
        wrap.append(input, apply);
        return wrap;
      })()));
    }
  }

  private buildDisplayPane(
    p: HTMLElement, ctx: RenderContext, ref: ColumnRef, fieldType: FieldType, current?: DisplayFormat,
  ): void {
    const allowed = formatsForType(fieldType);
    const inputs = new Map<string, HTMLInputElement | HTMLSelectElement>();
    const sel = document.createElement('select');
    for (const t of allowed) {
      const o = document.createElement('option');
      o.value = t; o.textContent = DISPLAY_LABELS[t] ?? t;
      if (current?.type === t) o.selected = true;
      sel.appendChild(o);
    }
    p.appendChild(fieldRow('Format', sel));

    const opts = document.createElement('div');
    opts.className = 'pp-display-opts';
    p.appendChild(opts);

    const preview = document.createElement('div');
    preview.className = 'pp-display-preview';
    const sample = document.createElement('input');
    sample.type = 'text';
    sample.className = 'pp-sample';
    sample.value = isNumericField(fieldType) ? '1234.5' : isDateField(fieldType) ? '2024-01-15' : 'Sample';
    const previewOut = document.createElement('span');
    previewOut.className = 'pp-preview-out';
    preview.append(labelSpan('Preview'), sample, previewOut);

    const read = (): DisplayFormat => {
      const fmt: DisplayFormat = { type: sel.value as DisplayFormatType };
      for (const [k, ctrl] of inputs) {
        const v = ctrl.value;
        if (v === '' || v == null) continue;
        if (NUMERIC_OPT_KEYS.has(k)) (fmt as unknown as Record<string, unknown>)[k] = Number(v);
        else if (k === 'showValue' || k === 'hideValue' || k === 'showFlag') (fmt as unknown as Record<string, unknown>)[k] = (ctrl as HTMLInputElement).checked;
        else if (k === 'thresholds' || k === 'colors') (fmt as unknown as Record<string, unknown>)[k] = v.split(',').map((s) => s.trim()).filter(Boolean).map((s) => (k === 'thresholds' ? Number(s) : s));
        else if (k === 'rules') (fmt as unknown as Record<string, unknown>).rules = parseRules(v);
        else if (k === 'map') (fmt as unknown as Record<string, unknown>).map = parseMap(v);
        else (fmt as unknown as Record<string, unknown>)[k] = v;
      }
      return fmt;
    };

    const refreshPreview = () => {
      const fmt = read();
      const raw = sample.value;
      const num = Number(raw);
      const vis = formatVisual({
        value: Number.isFinite(num) && raw.trim() !== '' ? num : undefined,
        raw, baseText: raw, display: fmt, fieldType, now: 0,
      });
      previewOut.innerHTML = vis.html !== undefined ? vis.html : escapeHtml(vis.text);
      previewOut.removeAttribute('style');
      if (!vis.rich) {
        if (vis.color) previewOut.style.color = vis.color;
        if (vis.bg) previewOut.style.backgroundColor = vis.bg;
        if (vis.bold) previewOut.style.fontWeight = '600';
      }
    };

    const renderOpts = () => {
      opts.innerHTML = '';
      inputs.clear();
      const keys = FIELD_FOR_TYPE[sel.value] ?? [];
      for (const key of keys) {
        const ctrl = makeOptControl(key, current);
        if (!ctrl) continue;
        inputs.set(key, ctrl);
        ctrl.addEventListener('change', refreshPreview);
        ctrl.addEventListener('input', refreshPreview);
        opts.appendChild(fieldRow(OPT_LABELS[key] ?? key, ctrl));
      }
      refreshPreview();
    };
    sel.addEventListener('change', renderOpts);
    sample.addEventListener('input', refreshPreview);
    renderOpts();

    p.appendChild(preview);

    const actions = document.createElement('div');
    actions.className = 'pp-popup-actions';
    actions.append(
      primaryBtn('Apply', () => this.opts.controller.setColumnDisplay(ref, sel.value === 'text' ? null : read())),
      plainBtn('Clear', () => this.opts.controller.setColumnDisplay(ref, null)),
    );
    p.appendChild(actions);
  }

  private buildConditionsPane(p: HTMLElement, ctx: RenderContext, ref: ColumnRef): void {
    if (ref.kind !== 'measure') return;
    const all = this.opts.controller.getConditions();
    const mine = all.filter((c) => c.measureKey === ref.key || (!c.measureKey && (c.measure ?? '').toLowerCase() === ref.uniqueName.toLowerCase()));

    const list = document.createElement('div');
    list.className = 'pp-cond-list';
    if (!mine.length) { const e = document.createElement('div'); e.className = 'pp-muted'; e.textContent = 'No rules yet.'; list.appendChild(e); }
    for (const c of mine) {
      const row = document.createElement('div');
      row.className = 'pp-cond-item';
      const swatch = document.createElement('span');
      swatch.className = 'pp-cond-swatch';
      swatch.style.background = c.format?.backgroundColor ?? '#fff';
      swatch.style.color = c.format?.color ?? '#000';
      swatch.textContent = 'Aa';
      const lbl = document.createElement('span');
      lbl.textContent = c.formula ?? '';
      const rm = plainBtn('✕', () => { if (c.id !== undefined) this.opts.controller.removeCondition(c.id); });
      rm.classList.add('pp-cond-rm');
      row.append(swatch, lbl, rm);
      list.appendChild(row);
    }
    p.appendChild(list);

    // Add-rule form: operator + value + colors.
    const form = document.createElement('div');
    form.className = 'pp-cond-form';
    const op = document.createElement('select');
    for (const o of ['>', '>=', '<', '<=', '==', '!=']) { const e = document.createElement('option'); e.value = o; e.textContent = o; op.appendChild(e); }
    const val = document.createElement('input'); val.type = 'number'; val.placeholder = 'value';
    const bg = document.createElement('input'); bg.type = 'color'; bg.value = '#c5e1a5'; bg.title = 'Background';
    const fg = document.createElement('input'); fg.type = 'color'; fg.value = '#1b5e20'; fg.title = 'Text color';
    const add = primaryBtn('Add', () => {
      if (val.value === '') return;
      this.opts.controller.addCondition({
        formula: `#value ${op.value} ${Number(val.value)}`,
        measure: ref.uniqueName,
        measureKey: ref.key,
        format: { backgroundColor: bg.value, color: fg.value },
      });
    });
    form.append(labelSpan('Add rule: #value'), op, val, bg, fg, add);
    p.appendChild(form);
  }

  private buildFilterPane(p: HTMLElement, ctx: RenderContext, ref: ColumnRef, field: string): void {
    if (ref.kind === 'measure') {
      // Top/Bottom-N on the first row hierarchy ranked by this measure.
      const wrap = document.createElement('div');
      wrap.className = 'pp-field-inline';
      const mode = document.createElement('select');
      for (const [v, t] of [['off', 'Show all'], ['top', 'Top N'], ['bottom', 'Bottom N']] as const) { const o = document.createElement('option'); o.value = v; o.textContent = t; mode.appendChild(o); }
      const qty = document.createElement('input'); qty.type = 'number'; qty.min = '1'; qty.value = '10';
      const apply = primaryBtn('Apply', () => this.opts.controller.setTopN(ref.uniqueName, mode.value as 'top' | 'bottom' | 'off', Number(qty.value) || 10));
      wrap.append(mode, qty, apply);
      p.appendChild(fieldRow('Rank rows by this measure', wrap));
      const note = document.createElement('div'); note.className = 'pp-muted'; note.textContent = 'Filters the first row field by this measure.';
      p.appendChild(note);
      return;
    }
    // Dimension column: distinct-value member filter.
    const members = this.opts.controller.members(field);
    const selected = (hierarchyOf(ctx, field)?.filter ?? ctx.normal.report.slice?.fieldFilters?.[field])?.members ?? null;
    const selSet = new Set(selected ?? members);
    const tools = document.createElement('div');
    tools.className = 'pp-popup-tools';
    const allLink = document.createElement('a'); allLink.textContent = 'All'; allLink.href = 'javascript:void(0)';
    const noneLink = document.createElement('a'); noneLink.textContent = 'None'; noneLink.href = 'javascript:void(0)';
    tools.append(allLink, noneLink);
    p.appendChild(tools);
    const listEl = document.createElement('div');
    listEl.className = 'pp-popup-list';
    const boxes: HTMLInputElement[] = [];
    for (const m of members) {
      const rowL = document.createElement('label');
      rowL.className = 'pp-popup-item';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.value = m; cb.checked = selSet.has(m);
      boxes.push(cb);
      const sp = document.createElement('span'); sp.textContent = m || '(blank)';
      rowL.append(cb, sp);
      listEl.appendChild(rowL);
    }
    allLink.addEventListener('click', () => boxes.forEach((b) => (b.checked = true)));
    noneLink.addEventListener('click', () => boxes.forEach((b) => (b.checked = false)));
    p.appendChild(listEl);
    const apply = primaryBtn('Apply', () => {
      const checked = boxes.filter((b) => b.checked).map((b) => b.value);
      this.opts.controller.setFilter(field, checked.length === members.length ? null : checked);
    });
    const actions = document.createElement('div'); actions.className = 'pp-popup-actions'; actions.appendChild(apply);
    p.appendChild(actions);
  }

  // ---------- report-filter area ----------

  private buildFiltersBar(ctx: RenderContext): HTMLElement | null {
    const filters = ctx.normal.reportFilters ?? [];
    if (!filters.length || ctx.normal.grid.showReportFiltersArea === false) return null;

    const bar = document.createElement('div');
    bar.className = 'pp-filters';
    const lead = document.createElement('span');
    lead.className = 'pp-filters-label';
    lead.textContent = 'Filters:';
    bar.appendChild(lead);

    for (const h of filters) {
      const caption = captionOf(ctx, h.uniqueName);
      const selected = h.filter?.members ?? null;
      const btn = document.createElement('button');
      btn.className = 'pp-filter-btn';
      const summary = !selected ? 'All' : `${selected.length} selected`;
      btn.innerHTML = `<b>${escapeHtml(caption)}:</b> ${escapeHtml(summary)} ▾`;
      btn.addEventListener('click', (e) => this.openFilterEditor(e as MouseEvent, h.uniqueName, caption, selected));
      bar.appendChild(btn);
    }
    return bar;
  }

  private openFilterEditor(ev: MouseEvent, uniqueName: string, caption: string, selected: string[] | null): void {
    ev.stopPropagation();
    this.closeEditor();
    const members = this.opts.controller.members(uniqueName);
    const selSet = new Set(selected ?? members);

    const pop = document.createElement('div');
    pop.className = 'pp-popup pp-filter-popup';
    pop.style.left = `${ev.clientX}px`;
    pop.style.top = `${ev.clientY}px`;

    const title = document.createElement('div');
    title.className = 'pp-popup-title';
    title.textContent = caption;
    pop.appendChild(title);

    const tools = document.createElement('div');
    tools.className = 'pp-popup-tools';
    const all = document.createElement('a'); all.textContent = 'All'; all.href = 'javascript:void(0)';
    const none = document.createElement('a'); none.textContent = 'None'; none.href = 'javascript:void(0)';
    tools.append(all, none);
    pop.appendChild(tools);

    const list = document.createElement('div');
    list.className = 'pp-popup-list';
    const boxes: HTMLInputElement[] = [];
    for (const m of members) {
      const row = document.createElement('label');
      row.className = 'pp-popup-item';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.value = m;
      cb.checked = selSet.has(m);
      boxes.push(cb);
      const span = document.createElement('span');
      span.textContent = m || '(blank)';
      row.append(cb, span);
      list.appendChild(row);
    }
    all.addEventListener('click', () => boxes.forEach((b) => (b.checked = true)));
    none.addEventListener('click', () => boxes.forEach((b) => (b.checked = false)));
    pop.appendChild(list);

    const apply = document.createElement('button');
    apply.className = 'pp-popup-apply';
    apply.textContent = 'Apply';
    apply.addEventListener('click', () => {
      const checked = boxes.filter((b) => b.checked).map((b) => b.value);
      this.opts.controller.setFilter(uniqueName, checked.length === members.length ? null : checked);
      this.closeEditor();
    });
    pop.appendChild(apply);

    document.body.appendChild(pop);
    this.editor = pop;
    this.editorOutside = (e: MouseEvent) => { if (!pop.contains(e.target as Node)) this.closeEditor(); };
    setTimeout(() => document.addEventListener('mousedown', this.editorOutside!), 0);
  }

  // ---------- body rows ----------

  private collectVisualRows(matrix: CellMatrix, ctx: RenderContext, mode: string): VisualRow[] {
    const out: VisualRow[] = [];
    const R = matrix.rowFields.length;

    const grandLabel = ctx.normal.localization.grandTotal;
    if (R === 0) {
      out.push({ node: null, path: [], label: grandLabel, depth: 0, isGroup: false, isSubtotal: false, isGrand: true });
      return out;
    }

    if (mode === 'flat') {
      for (const n of leafNodes(matrix.rowTree)) {
        out.push({ node: n, path: n.path, label: n.label, depth: n.depth, isGroup: false, isSubtotal: false, isGrand: false });
      }
    } else {
      const walk = (nodes: AxisNode[]) => {
        for (const n of nodes) {
          const isGroup = !n.isLeaf;
          out.push({ node: n, path: n.path, label: n.label, depth: n.depth, isGroup, isSubtotal: isGroup, isGrand: false });
          if (isGroup && n.expanded && n.children.length) walk(n.children);
        }
      };
      walk(matrix.rowTree);
    }

    if (totalsEnabled(ctx.normal.grid.showGrandTotals, 'rows')) {
      const grandRow: VisualRow = { node: null, path: [], label: grandLabel, depth: 0, isGroup: false, isSubtotal: false, isGrand: true };
      if (ctx.normal.grid.grandTotalsPosition === 'top') out.unshift(grandRow);
      else out.push(grandRow);
    }
    return out;
  }

  private buildRow(b: BodyState, vr: VisualRow, rowIdx: number): HTMLElement {
    const { matrix, ctx, colLeaves, measures, showColGrand, multi } = b;
    const R = matrix.rowFields.length;
    const tr = document.createElement('tr');
    tr.style.height = `${b.rowHeight}px`;
    if (rowIdx % 2 === 1) tr.classList.add('pp-alt');
    if (vr.isGrand) tr.classList.add('pp-grand-row');
    else if (vr.isSubtotal) tr.classList.add('pp-total-row');

    if (multi) {
      for (let j = 0; j < R; j++) {
        const th = document.createElement('th');
        th.className = 'pp-rowh';
        if (vr.isGrand) th.textContent = j === 0 ? b.ctx.normal.localization.grandTotal : '';
        else if (j < vr.path.length) {
          this.renderMember(th, b.ctx, matrix.rowFields[j], vr.path[j]);
          const rPath = vr.path.slice(0, j + 1);
          th.addEventListener('click', () => this.emitHeaderClick(b.ctx, 'rows', matrix.rowFields, rPath, rowIdx, -1));
        } else if (vr.isSubtotal && j === vr.path.length) th.textContent = b.ctx.normal.localization.total;
        else th.textContent = '';
        tr.appendChild(th);
      }
    } else {
      const th = document.createElement('th');
      th.className = 'pp-rowh';
      th.style.paddingLeft = `${8 + vr.depth * 16}px`;
      if (vr.isGroup && vr.node) {
        const toggle = document.createElement('span');
        toggle.className = 'pp-toggle';
        toggle.textContent = vr.node.expanded ? '▾' : '▸';
        toggle.addEventListener('click', (e) => { e.stopPropagation(); this.opts.onToggle(vr.node!); });
        th.appendChild(toggle);
      }
      const labelEl = document.createElement('span');
      if (vr.isGrand || R === 0) labelEl.textContent = vr.label;
      else {
        this.renderMember(labelEl, b.ctx, matrix.rowFields[Math.min(vr.depth, R - 1)], vr.label);
        th.addEventListener('click', () => this.emitHeaderClick(b.ctx, 'rows', matrix.rowFields, vr.path, rowIdx, -1));
      }
      th.appendChild(labelEl);
      tr.appendChild(th);
    }

    let colIdx = 0;
    const renderGroup = (cp: string[], grandCol: boolean) => {
      for (const m of measures.length ? measures : [null]) {
        tr.appendChild(this.buildValueCell(matrix, ctx, vr, cp, m, rowIdx, colIdx++, grandCol));
      }
    };
    for (const leaf of colLeaves) renderGroup(leaf.path, false);
    if (showColGrand) renderGroup([], true);
    return tr;
  }

  /** Emit a `cellclick` for a clicked row/column member HEADER cell — carries the
   *  full tuple + member + hierarchy for that axis (same payload shape as values). */
  private emitHeaderClick(
    ctx: RenderContext, axis: 'rows' | 'columns', fields: string[], path: string[], rowIndex: number, columnIndex: number,
  ): void {
    const depth = Math.max(0, path.length - 1);
    const field = fields[Math.min(depth, fields.length - 1)];
    const last = path[path.length - 1] ?? '';
    this.opts.onCellClick({
      rowIndex,
      columnIndex,
      rows: axis === 'rows' ? tupleOf(ctx, fields, path) : [],
      columns: axis === 'columns' ? tupleOf(ctx, fields, path) : [],
      hierarchy: field ? { uniqueName: field, caption: captionOf(ctx, field) } : undefined,
      member: { name: last, caption: last },
      label: last,
      type: 'header',
      level: depth,
      rowPath: axis === 'rows' ? path : undefined,
      colPath: axis === 'columns' ? path : undefined,
    });
  }

  /** Set a dimension member cell's content, applying its column display format. */
  private renderMember(el: HTMLElement, ctx: RenderContext, field: string, label: string): void {
    const display = hierarchyOf(ctx, field)?.display;
    if (!display || display.type === 'text') { el.textContent = label; return; }
    const num = Number(label);
    const vis = formatVisual({
      value: Number.isFinite(num) && label.trim() !== '' ? num : undefined,
      raw: label,
      baseText: label,
      display,
      fieldType: fieldTypeOf(ctx, field),
    });
    if (vis.html !== undefined) el.innerHTML = vis.html; else el.textContent = vis.text;
    if (!vis.rich) {
      if (vis.color) el.style.color = vis.color;
      if (vis.bg) el.style.backgroundColor = vis.bg;
      if (vis.bold) el.style.fontWeight = '600';
      if (vis.align) el.style.textAlign = vis.align;
    }
  }

  private buildValueCell(
    matrix: CellMatrix, ctx: RenderContext, vr: VisualRow, cp: string[],
    measure: CellMatrix['measures'][number] | null, rowIdx: number, colIdx: number, grandCol: boolean,
  ): HTMLElement {
    const R = matrix.rowFields.length;
    // Cells are keyed by the measure SLOT key (so same-field measures don't collide).
    const measureKey = measure?.key ?? matrix.measures[0]?.key ?? '';
    const value = measureKey ? matrix.cells.get(pathKey(vr.path, cp, measureKey)) ?? NaN : NaN;
    const text = measureKey ? matrix.text.get(pathKey(vr.path, cp, measureKey)) ?? '' : '';

    const isTotalRow = vr.isSubtotal || vr.isGrand || vr.path.length < R;
    const isGrandRow = vr.isGrand;

    const cb = new CellBuilder();
    cb.text = text;
    cb.classes.push('pp-cell');
    if (isTotalRow) cb.classes.push('pp-total');
    if (isGrandRow || grandCol) cb.classes.push('pp-grand');

    const data: CellData = {
      rowIndex: rowIdx,
      columnIndex: colIdx,
      rows: tupleOf(ctx, matrix.rowFields, vr.path),
      columns: tupleOf(ctx, matrix.colFields, cp),
      hierarchy: R ? { uniqueName: matrix.rowFields[Math.min(vr.depth, R - 1)], caption: captionOf(ctx, matrix.rowFields[Math.min(vr.depth, R - 1)]) } : undefined,
      measure: measure ? { uniqueName: measure.uniqueName, caption: measure.caption } : undefined,
      member: { name: vr.label, caption: vr.label },
      label: text,
      value: Number.isNaN(value) ? undefined : value,
      type: 'value',
      level: vr.depth,
      rowPath: vr.path,
      colPath: cp,
      isTotal: isTotalRow,
      isTotalRow: vr.isSubtotal,
      isGrandTotal: isGrandRow || grandCol,
      isGrandTotalRow: isGrandRow,
      isGrandTotalColumn: grandCol,
    };

    const measureName = measure?.uniqueName ?? matrix.measures[0]?.uniqueName ?? '';

    // Display format — a presentation layer over the base (number-formatted) text.
    const display = measure?.display;
    if (display && display.type !== 'text') {
      const vis = formatVisual({
        value: Number.isNaN(value) ? undefined : value,
        raw: Number.isNaN(value) ? undefined : value,
        baseText: text,
        display,
        fieldType: 'number',
        isTotal: isTotalRow,
        isGrand: isGrandRow,
        columnStats: this.colStats.get(measureKey),
      });
      if (vis.html !== undefined) cb.text = vis.html;
      if (!vis.rich) {
        if (vis.color) cb.style.color = vis.color;
        if (vis.bg) cb.style.backgroundColor = vis.bg;
        if (vis.bold) cb.style.fontWeight = '600';
        if (vis.align) cb.style.textAlign = vis.align;
      }
    }

    // Conditional formatting — applied after the display format so its rules win.
    Object.assign(cb.style, evalConditionStyle(ctx.conditions, value, measureName, measureKey, isTotalRow));

    if (ctx.customizeCell) ctx.customizeCell(cb, data);

    const td = document.createElement('td');
    td.className = cb.classes.join(' ');
    td.innerHTML = cb.text;
    for (const [k, v] of Object.entries(cb.style)) td.style.setProperty(toKebab(k), v ?? '');
    for (const [k, v] of Object.entries(cb.attr)) td.setAttribute(k, v);

    this.cellIndex.set(`${rowIdx}:${colIdx}`, data);
    if (ctx.selected && ctx.selected.rowIndex === rowIdx && ctx.selected.columnIndex === colIdx) td.classList.add('pp-selected');

    td.addEventListener('click', () => this.opts.onCellClick(data));
    td.addEventListener('dblclick', () => {
      this.opts.onCellDoubleClick(data);
      if (measure && ctx.normal.options.drillThrough !== false) this.openDrillModal(ctx, data);
    });
    return td;
  }

  // ---------- drill-through modal ----------

  private openDrillModal(ctx: RenderContext, cell: CellData): void {
    const rows = this.opts.controller.drillThrough(cell);
    this.closeEditor();

    const backdrop = document.createElement('div');
    backdrop.className = 'pp-modal-backdrop';
    const dialog = document.createElement('div');
    dialog.className = 'pp-modal pp-drill';

    const h = document.createElement('h3');
    const where = [...(cell.rowPath ?? []), ...(cell.colPath ?? [])].filter(Boolean).join(' · ');
    h.textContent = `Drill-through${where ? ': ' + where : ''} (${rows.length} rows)`;
    dialog.appendChild(h);

    const fields = rows.length ? Object.keys(rows[0]) : [];
    const wrap = document.createElement('div');
    wrap.className = 'pp-drill-scroll';
    const table = document.createElement('table');
    table.className = 'pp-table';
    const thead = document.createElement('thead');
    const htr = document.createElement('tr');
    for (const f of fields) {
      const th = document.createElement('th');
      th.className = 'pp-colh';
      th.textContent = ctx.normal.report.dataSource?.mapping?.[f]?.caption ?? f;
      htr.appendChild(th);
    }
    thead.appendChild(htr);
    table.appendChild(thead);
    const tbody = document.createElement('tbody');
    for (const r of rows.slice(0, 500)) {
      const tr = document.createElement('tr');
      for (const f of fields) {
        const td = document.createElement('td');
        td.className = 'pp-cell';
        td.textContent = r[f] === null || r[f] === undefined ? '' : String(r[f]);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    dialog.appendChild(wrap);

    const actions = document.createElement('div');
    actions.className = 'pp-modal-actions';
    const close = document.createElement('button');
    close.className = 'primary';
    close.textContent = 'Close';
    close.addEventListener('click', () => this.closeEditor());
    actions.appendChild(close);
    dialog.appendChild(actions);

    backdrop.appendChild(dialog);
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) this.closeEditor(); });
    document.body.appendChild(backdrop);
    this.editor = backdrop;
    this.editorKey = (e: KeyboardEvent) => { if (e.key === 'Escape') this.closeEditor(); };
    document.addEventListener('keydown', this.editorKey);
  }

  // ---------- toolbar ----------

  private buildToolbar(): HTMLElement {
    const bar = document.createElement('div');
    bar.className = 'pp-toolbar';

    // A tabs descriptor consumers can mutate via beforetoolbarcreated.
    const tabs: Array<{ id: string; title: string; handler: () => void }> = [
      { id: 'pp-tab-fields', title: 'Fields', handler: () => this.toggleFieldList() },
      { id: 'pp-tab-export-csv', title: 'CSV', handler: () => this.opts.controller.exportTo('csv') },
      { id: 'pp-tab-export-excel', title: 'Excel', handler: () => this.opts.controller.exportTo('excel') },
      { id: 'pp-tab-export-pdf', title: 'PDF', handler: () => this.opts.controller.exportTo('pdf') },
      { id: 'pp-tab-export-html', title: 'HTML', handler: () => this.opts.controller.exportTo('html') },
      { id: 'pp-tab-fullscreen', title: 'Fullscreen', handler: () => this.toggleFullscreen() },
    ];
    this.opts.emit('beforetoolbarcreated', { getTabs: () => tabs });

    const group = (label: string, ids: string[]) => {
      const g = document.createElement('div');
      g.className = 'pp-tb-group';
      if (label) { const l = document.createElement('span'); l.className = 'pp-tb-label'; l.textContent = label; g.appendChild(l); }
      for (const id of ids) {
        const t = tabs.find((x) => x.id === id);
        if (!t) continue;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'pp-tb-btn';
        b.textContent = t.title;
        b.addEventListener('click', t.handler);
        g.appendChild(b);
      }
      return g;
    };

    bar.appendChild(group('', ['pp-tab-fields']));
    bar.appendChild(group('Export:', ['pp-tab-export-csv', 'pp-tab-export-excel', 'pp-tab-export-pdf', 'pp-tab-export-html']));
    bar.appendChild(group('', ['pp-tab-fullscreen']));
    return bar;
  }

  private toggleFieldList(): void {
    const fl = this.gridEl.querySelector('.pp-fieldlist') as HTMLElement | null;
    if (fl) fl.style.display = fl.style.display === 'none' ? '' : 'none';
  }

  private toggleFullscreen(): void {
    const el = this.root;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el.requestFullscreen?.();
  }

  // ---------- drag-drop field list ----------

  private buildFieldList(matrix: CellMatrix, ctx: RenderContext): HTMLElement {
    const panel = document.createElement('div');
    panel.className = 'pp-fieldlist';

    const used = new Set<string>([
      ...matrix.rowFields, ...matrix.colFields, ...matrix.measures.map((m) => m.uniqueName),
    ]);
    const available = this.opts.controller.allFields().filter((f) => !used.has(f.uniqueName));

    const makeZone = (title: string, zone: Zone, fields: Array<{ uniqueName: string; caption: string }>) => {
      const z = document.createElement('div');
      z.className = 'pp-zone';
      z.dataset.zone = zone;
      const h = document.createElement('div');
      h.className = 'pp-zone-title';
      h.textContent = title;
      z.appendChild(h);
      const body = document.createElement('div');
      body.className = 'pp-zone-body';
      for (const f of fields) body.appendChild(this.makeChip(f));
      z.appendChild(body);
      z.addEventListener('dragover', (e) => { e.preventDefault(); z.classList.add('pp-dragover'); });
      z.addEventListener('dragleave', () => z.classList.remove('pp-dragover'));
      z.addEventListener('drop', (e) => {
        e.preventDefault();
        z.classList.remove('pp-dragover');
        const uniqueName = e.dataTransfer?.getData('text/plain');
        if (uniqueName) this.opts.controller.moveField(uniqueName, zone);
      });
      return z;
    };

    panel.appendChild(makeZone('Fields', 'available', available));
    panel.appendChild(makeZone('Filters', 'filters', this.fieldDefs(ctx, (ctx.normal.reportFilters ?? []).map((x) => x.uniqueName))));
    panel.appendChild(makeZone('Rows', 'rows', this.fieldDefs(ctx, matrix.rowFields)));
    panel.appendChild(makeZone('Columns', 'columns', this.fieldDefs(ctx, matrix.colFields)));
    panel.appendChild(makeZone('Values', 'measures', matrix.measures.map((m) => ({ uniqueName: m.uniqueName, caption: m.caption }))));
    return panel;
  }

  private fieldDefs(ctx: RenderContext, names: string[]): Array<{ uniqueName: string; caption: string }> {
    return names.map((n) => ({ uniqueName: n, caption: captionOf(ctx, n) }));
  }

  private makeChip(field: { uniqueName: string; caption: string }): HTMLElement {
    const chip = document.createElement('div');
    chip.className = 'pp-chip';
    chip.textContent = field.caption;
    chip.draggable = true;
    chip.addEventListener('dragstart', (e) => e.dataTransfer?.setData('text/plain', field.uniqueName));
    return chip;
  }
}

// ---------- helpers ----------

// Column-properties panel: form-control builders + display-format option metadata.

const DISPLAY_LABELS: Record<string, string> = {
  text: 'Plain text', number: 'Number', signed: 'Signed (+/−)', data_bar: 'Data bar',
  progress: 'Progress bar', percent_ring: 'Percent ring', heatmap: 'Heatmap', rating: 'Rating',
  bullet: 'Bullet', sparkline: 'Sparkline', background: 'Conditional background',
  status_tag: 'Status tag', status_dot: 'Status dot', icon_map: 'Icon map', boolean: 'Yes / No',
  tags: 'Tags', avatar: 'Avatar', two_line: 'Two-line', date: 'Date', relative_time: 'Relative time',
  date_range: 'Date range', countdown: 'Countdown', telephone: 'Phone', country: 'Country',
  email: 'Email', url: 'Link', image: 'Image', file: 'File', map: 'Map', copy: 'Copyable',
  case: 'Text case', truncate: 'Truncate', masked: 'Masked', template: 'Template',
};

const OPT_LABELS: Record<string, string> = {
  numberStyle: 'Number style', decimals: 'Decimals', currency: 'Currency', prefix: 'Prefix',
  suffix: 'Suffix', min: 'Min', max: 'Max', color: 'Color', scale: 'Scale', thresholds: 'Thresholds',
  colors: 'Band colors', applyTo: 'Apply to', icon: 'Icon', showValue: 'Show value', hideValue: 'Hide value',
  datePattern: 'Date pattern', warnDays: 'Warn days', dangerDays: 'Danger days', textCase: 'Case',
  truncate: 'Max chars', maskLast: 'Visible chars', maskChar: 'Mask char', template: 'Template',
  label: 'Label', showFlag: 'Show flag', countryShow: 'Show', map: 'Value map', rules: 'Rules',
  defaultColor: 'Default color', defaultIcon: 'Default icon',
};

const FIELD_FOR_TYPE: Record<string, string[]> = {
  number: ['numberStyle', 'decimals', 'currency', 'prefix', 'suffix'],
  signed: ['numberStyle', 'decimals', 'prefix', 'suffix'],
  data_bar: ['numberStyle', 'decimals', 'min', 'max', 'color'],
  progress: ['min', 'max', 'color', 'showValue'],
  percent_ring: ['max', 'color', 'showValue'],
  heatmap: ['numberStyle', 'decimals', 'scale', 'thresholds', 'colors', 'applyTo'],
  rating: ['max', 'icon', 'color'],
  bullet: ['numberStyle', 'max', 'color'],
  sparkline: ['color'],
  background: ['rules', 'defaultColor'],
  status_tag: ['map', 'defaultColor'],
  status_dot: ['map', 'defaultColor', 'hideValue'],
  icon_map: ['map', 'defaultIcon', 'hideValue'],
  boolean: ['map'],
  tags: ['map', 'defaultColor'],
  date: ['datePattern'],
  date_range: ['datePattern'],
  relative_time: ['datePattern'],
  countdown: ['datePattern', 'warnDays', 'dangerDays'],
  case: ['textCase'],
  truncate: ['truncate'],
  masked: ['maskLast', 'maskChar'],
  template: ['template'],
  telephone: ['label', 'showFlag'],
  country: ['countryShow'],
  email: ['label'], url: ['label'], file: ['label'], map: ['label'],
  avatar: [], two_line: [], image: [], copy: [], text: [],
};

const NUMERIC_OPT_KEYS = new Set(['decimals', 'min', 'max', 'truncate', 'maskLast', 'warnDays', 'dangerDays']);
const SELECT_OPTS: Record<string, string[]> = {
  numberStyle: ['decimal', 'currency', 'accounting', 'percent', 'scientific', 'compact'],
  scale: ['stepped', 'gradient'],
  applyTo: ['text', 'background'],
  textCase: ['upper', 'lower', 'title', 'camel', 'sentence'],
  icon: ['star', 'heart', 'circle'],
  countryShow: ['flag_name', 'flag', 'flag_code'],
};
const COLOR_OPT_KEYS = new Set(['color', 'defaultColor']);
const BOOL_OPT_KEYS = new Set(['showValue', 'hideValue', 'showFlag']);

function isNumericField(ft?: FieldType): boolean { return ft === 'number' || ft === undefined; }
function isDateField(ft?: FieldType): boolean {
  return ft === 'date' || ft === 'date string' || ft === 'datetime' || ft === 'time'
    || ft === 'year/month/day' || ft === 'year/quarter/month/day' || ft === 'month' || ft === 'weekday';
}

function fieldRow(label: string, control: HTMLElement): HTMLElement {
  // A <div> (not <label>) so clicking the row never re-targets/blurs the input and
  // the input doesn't inherit the popup's label styling (uppercase / muted color).
  const row = document.createElement('div');
  row.className = 'pp-field';
  const l = document.createElement('span');
  l.className = 'pp-field-label';
  l.textContent = label;
  row.append(l, control);
  return row;
}
function labelSpan(text: string): HTMLElement { const s = document.createElement('span'); s.className = 'pp-field-label'; s.textContent = text; return s; }
function primaryBtn(text: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'pp-popup-apply'; b.textContent = text;
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return b;
}
function plainBtn(text: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'pp-btn'; b.textContent = text;
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return b;
}

function makeOptControl(key: string, current?: DisplayFormat): HTMLInputElement | HTMLSelectElement | null {
  const cur = current as unknown as Record<string, unknown> | undefined;
  if (SELECT_OPTS[key]) {
    const sel = document.createElement('select');
    for (const v of SELECT_OPTS[key]) { const o = document.createElement('option'); o.value = v; o.textContent = v; if (cur?.[key] === v) o.selected = true; sel.appendChild(o); }
    return sel;
  }
  const input = document.createElement('input');
  if (BOOL_OPT_KEYS.has(key)) { input.type = 'checkbox'; input.checked = cur?.[key] !== false; return input; }
  if (COLOR_OPT_KEYS.has(key)) { input.type = 'color'; input.value = typeof cur?.[key] === 'string' ? String(cur[key]) : '#2563eb'; return input; }
  if (NUMERIC_OPT_KEYS.has(key)) { input.type = 'number'; if (cur?.[key] != null) input.value = String(cur[key]); return input; }
  input.type = 'text';
  if (key === 'thresholds' || key === 'colors') input.value = Array.isArray(cur?.[key]) ? (cur![key] as unknown[]).join(', ') : '';
  else if (key === 'map') input.value = serializeMap(cur?.map as DisplayFormat['map']);
  else if (key === 'rules') input.value = serializeRules(cur?.rules as DisplayFormat['rules']);
  else if (cur?.[key] != null) input.value = String(cur[key]);
  if (key === 'map') input.placeholder = 'open|Open|green, closed|Closed|red';
  if (key === 'rules') input.placeholder = 'value > 1000|green, value < 0|red';
  if (key === 'datePattern') input.placeholder = 'dd-MMM-yyyy';
  if (key === 'template') input.placeholder = 'INV-{value}';
  return input;
}

function parseMap(text: string): DisplayFormat['map'] {
  return text.split(',').map((s) => s.trim()).filter(Boolean).map((entry) => {
    const [when, label, color, icon] = entry.split('|').map((x) => x.trim());
    const e: { when: string; label?: string; color?: string; icon?: string } = { when };
    if (label) e.label = label; if (color) e.color = color; if (icon) e.icon = icon;
    return e;
  });
}
function serializeMap(map?: DisplayFormat['map']): string {
  return (map ?? []).map((e) => [e.when, e.label ?? '', e.color ?? '', e.icon ?? ''].join('|').replace(/\|+$/, '')).join(', ');
}
function parseRules(text: string): DisplayFormat['rules'] {
  return text.split(',').map((s) => s.trim()).filter(Boolean).map((entry) => {
    const idx = entry.lastIndexOf('|');
    return idx >= 0 ? { when: entry.slice(0, idx).trim(), color: entry.slice(idx + 1).trim() } : { when: entry, color: 'green' };
  });
}
function serializeRules(rules?: DisplayFormat['rules']): string {
  return (rules ?? []).map((r) => `${r.when}|${r.color}`).join(', ');
}

function size(v: string | number): string { return typeof v === 'number' ? `${v}px` : v; }
function toKebab(s: string): string { return s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()); }
function escapeHtml(v: string): string { return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function captionOf(ctx: RenderContext, field: string): string {
  return ctx.normal.report.dataSource?.mapping?.[field]?.caption ?? field;
}
/** Build a cell's row/column tuple: one entry per member with its field + caption. */
function tupleOf(ctx: RenderContext, fields: string[], path: string[]): CellTupleItem[] {
  return path.map((member, i) => ({
    uniqueName: fields[i],
    caption: fields[i] ? captionOf(ctx, fields[i]) : undefined,
    member,
    memberCaption: member,
    level: i,
  }));
}
function hierarchyOf(ctx: RenderContext, field: string): Hierarchy | undefined {
  const slice = ctx.normal.report.slice;
  return [...(slice?.rows ?? []), ...(slice?.columns ?? [])].find((h) => h.uniqueName === field);
}
function fieldTypeOf(ctx: RenderContext, field: string): FieldType | undefined {
  return ctx.normal.report.dataSource?.mapping?.[field]?.type;
}
function sortGlyph(sort?: string): string {
  return sort === 'asc' ? ' ▲' : sort === 'desc' ? ' ▼' : '';
}
function emptyNode(): AxisNode {
  return { path: [], label: '', field: '', depth: 0, children: [], expanded: true, isLeaf: true };
}
function preorderLeaves(tree: AxisNode[]): AxisNode[] {
  const out: AxisNode[] = [];
  const walk = (nodes: AxisNode[]) => {
    for (const n of nodes) {
      if (n.isLeaf || !n.expanded || !n.children.length) out.push(n);
      else walk(n.children);
    }
  };
  walk(tree);
  return out;
}
function leafNodes(tree: AxisNode[]): AxisNode[] {
  const out: AxisNode[] = [];
  const walk = (nodes: AxisNode[]) => {
    for (const n of nodes) {
      if (n.isLeaf || !n.children.length) out.push(n);
      else walk(n.children);
    }
  };
  walk(tree);
  return out;
}
function spacer(colCount: number, height: number): HTMLElement {
  const tr = document.createElement('tr');
  tr.className = 'pp-spacer';
  const td = document.createElement('td');
  td.colSpan = colCount;
  td.style.height = `${height}px`;
  td.style.padding = '0';
  td.style.border = 'none';
  tr.appendChild(td);
  return tr;
}
