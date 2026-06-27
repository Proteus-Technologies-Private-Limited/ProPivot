// DOM grid renderer (docs/Architecture.md).
// Renders the pivot from a CellMatrix. grid.type controls ONLY how row fields are
// laid out: 'compact' nests them in one indented column (expand/collapse); 'flat'
// and 'classic' give each row field its own column. Columns/measures are identical
// across modes. Virtualizes rows, applies customizeCell + conditions, and lets the
// user change a measure's aggregation by clicking its column header.

import type { CellMatrix, AxisNode } from '../core/matrix';
import { pathKey } from '../core/matrix';
import type { NormalReport } from '../core/normalize';
import { totalsEnabled } from '../core/normalize';
import { ALL_AGGREGATIONS, AGGREGATION_CAPTIONS } from '../core/aggregations';
import type { CompiledCondition } from '../core/conditions';
import { CellBuilder, type CellData } from '../facade/cell';

export type Zone = 'rows' | 'columns' | 'measures' | 'filters' | 'available';

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
        if (!multi) corner.textContent = combinedCaption;
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
        th.textContent = label;
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
        trM.appendChild(th);
      }
    } else if (colDepth === 0) {
      const corner = document.createElement('th');
      corner.className = 'pp-corner';
      corner.textContent = combinedCaption;
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
        for (const m of measures) trM.appendChild(this.measureHeader(m, grand, ctx));
      }
    };
    measureHeaders(colLeaves.length, false);
    if (showColGrand) measureHeaders(1, true);
    thead.appendChild(trM);
    return thead;
  }

  private measureHeader(m: CellMatrix['measures'][number], grand: boolean, ctx: RenderContext): HTMLElement {
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
    // A subtle gear button (revealed on hover) opens a modal to change aggregation.
    if (!m.calculated) {
      const gear = document.createElement('button');
      gear.type = 'button';
      gear.className = 'pp-gear';
      gear.title = 'Configure aggregation';
      gear.textContent = '⚙';
      gear.addEventListener('click', (e) => { e.stopPropagation(); this.openMeasureModal(m); });
      th.appendChild(gear);
    }
    return th;
  }

  // ---------- per-measure aggregation modal ----------

  private openMeasureModal(measure: CellMatrix['measures'][number]): void {
    this.closeEditor();

    const backdrop = document.createElement('div');
    backdrop.className = 'pp-modal-backdrop';
    const dialog = document.createElement('div');
    dialog.className = 'pp-modal';

    const h = document.createElement('h3');
    h.textContent = `Configure: ${measure.caption}`;
    dialog.appendChild(h);

    const lbl = document.createElement('label');
    lbl.textContent = 'Aggregation';
    dialog.appendChild(lbl);

    const sel = document.createElement('select');
    for (const a of ALL_AGGREGATIONS) {
      const o = document.createElement('option');
      o.value = a;
      o.textContent = AGGREGATION_CAPTIONS[a] ?? a;
      if (a === measure.aggregation) o.selected = true;
      sel.appendChild(o);
    }
    dialog.appendChild(sel);

    const actions = document.createElement('div');
    actions.className = 'pp-modal-actions';
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => this.closeEditor());
    const apply = document.createElement('button');
    apply.className = 'primary';
    apply.textContent = 'Apply';
    apply.addEventListener('click', () => {
      this.opts.controller.setMeasureAggregation(measure.uniqueName, sel.value);
      this.closeEditor();
    });
    actions.append(cancel, apply);
    dialog.appendChild(actions);

    backdrop.appendChild(dialog);
    backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) this.closeEditor(); });
    document.body.appendChild(backdrop);
    this.editor = backdrop;
    this.editorKey = (e: KeyboardEvent) => { if (e.key === 'Escape') this.closeEditor(); };
    document.addEventListener('keydown', this.editorKey);
  }

  private closeEditor(): void {
    if (this.editor) { this.editor.remove(); this.editor = null; }
    if (this.editorOutside) { document.removeEventListener('mousedown', this.editorOutside); this.editorOutside = undefined; }
    if (this.editorKey) { document.removeEventListener('keydown', this.editorKey); this.editorKey = undefined; }
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
        else if (j < vr.path.length) th.textContent = vr.path[j];
        else if (vr.isSubtotal && j === vr.path.length) th.textContent = b.ctx.normal.localization.total;
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
      labelEl.textContent = vr.label;
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
      rows: matrix.rowFields.map((f) => ({ uniqueName: f, caption: captionOf(ctx, f) })),
      columns: matrix.colFields.map((f) => ({ uniqueName: f, caption: captionOf(ctx, f) })),
      hierarchy: R ? { uniqueName: matrix.rowFields[Math.min(vr.depth, R - 1)], caption: '' } : undefined,
      measure: measure ? { uniqueName: measure.uniqueName, caption: measure.caption } : undefined,
      member: { name: vr.label },
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
    for (const c of ctx.conditions) {
      const cond = c.condition;
      if (cond.measure && cond.measure.toLowerCase() !== measureName.toLowerCase()) continue;
      if (cond.isTotal === true && !isTotalRow) continue;
      if (cond.isTotal === false && isTotalRow) continue;
      if (!Number.isNaN(value) && c.predicate(value)) Object.assign(cb.style, cond.format ?? {});
    }

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

function size(v: string | number): string { return typeof v === 'number' ? `${v}px` : v; }
function toKebab(s: string): string { return s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase()); }
function escapeHtml(v: string): string { return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function captionOf(ctx: RenderContext, field: string): string {
  return ctx.normal.report.dataSource?.mapping?.[field]?.caption ?? field;
}
function hierarchyOf(ctx: RenderContext, field: string): { uniqueName: string; sort?: 'asc' | 'desc' | 'unsorted' } | undefined {
  const slice = ctx.normal.report.slice;
  return [...(slice?.rows ?? []), ...(slice?.columns ?? [])].find((h) => h.uniqueName === field);
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
