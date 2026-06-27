// Slice planner / cube builder (docs/Architecture.md).
// Uses a GROUPING-SETS scan so every subtotal and grand-total level is computed
// with correct (incl. holistic) aggregation. Then a post-pass derives relative
// aggregations (ratios + positional difference family) and calculated measures.

import type { ColumnStore } from './store';
import { numericValue, rawKey, displayValue } from './store';
import type { NormalReport, NormalMeasure } from './normalize';
import { totalsEnabled } from './normalize';
import { createAccumulator, isRelative, type Accumulator } from './aggregations';
import { parseFormula, collectAggRefs, collectFieldRefs, evaluateFormula, type AstNode } from './formula';
import { resolveFormats, formatNumber } from './format';
import { pathKey, US, GS, type AxisNode, type CellMatrix } from './matrix';
import type { NumberFormat, FilterSpec } from './types';

export interface BaseDesc { key: string; agg: string; field: string; }
interface CalcDesc { measure: NormalMeasure; ast: AstNode; }

const POSITIONAL = new Set(['difference', '%difference', 'runningtotals']);

/** Base aggregations a report needs, plus the keying helpers. Shared by the built-in
 *  TS scan and any external base provider (e.g. the opt-in DuckDB accelerator), so the
 *  two paths agree on exactly which `(field, aggregation)` base cells to produce. */
export interface BasePlan {
  baseList: BaseDesc[];
  calcs: CalcDesc[];
  /** Cell key a non-calculated measure draws its base value from. */
  measureBaseKey: (m: NormalMeasure) => string;
}

/** Plan the base aggregation descriptors for a report (docs/Architecture.md §2). */
export function planBase(measures: NormalMeasure[]): BasePlan {
  const baseList: BaseDesc[] = [];
  const baseSeen = new Set<string>();
  const addBase = (key: string, agg: string, field: string) => {
    if (!baseSeen.has(key)) { baseSeen.add(key); baseList.push({ key, agg, field }); }
  };

  // The base accumulator a measure draws from. Relative aggregations (ratios +
  // positional family) derive from the plain SUM base; everything else uses its own
  // function. The base key is qualified by this agg so e.g. sum AND average of the
  // same field get DISTINCT accumulators instead of one silently shadowing the other.
  const baseAggOf = (m: NormalMeasure) => (isRelative(m.aggregation) ? 'sum' : m.aggregation);
  const measureBaseKey = (m: NormalMeasure) => `m${US}${m.uniqueName}${US}${baseAggOf(m)}`;

  const calcs: CalcDesc[] = [];
  for (const m of measures) {
    if (m.calculated) {
      const ast = parseFormula(m.formula!);
      calcs.push({ measure: m, ast });
      for (const ref of collectAggRefs(ast)) addBase(`a${US}${ref.agg}${US}${ref.field}`, ref.agg, ref.field);
      for (const f of collectFieldRefs(ast)) addBase(`f${US}${f}`, 'sum', f);
    } else {
      addBase(measureBaseKey(m), baseAggOf(m), m.uniqueName);
    }
  }
  return { baseList, calcs, measureBaseKey };
}

/** Built-in GROUPING-SETS scan that fills the base-cell map on the main thread. */
function scanBaseCells(
  store: ColumnStore, normal: NormalReport, selection: number[], baseList: BaseDesc[], datePattern?: string,
): Map<string, number> {
  const { rowFields, colFields, grid } = normal;
  const cellBase = new Map<string, number>();
  const R = rowFields.length;
  const C = colFields.length;
  const showRowTotals = totalsEnabled(grid.showTotals, 'rows');
  const showColTotals = totalsEnabled(grid.showTotals, 'columns');

  for (let gr = 0; gr <= R; gr++) {
    if (gr !== 0 && gr !== R && !showRowTotals) continue;
    for (let gc = 0; gc <= C; gc++) {
      if (gc !== 0 && gc !== C && !showColTotals) continue;

      const groups = new Map<string, Accumulator[]>();
      const rFieldsSlice = rowFields.slice(0, gr);
      const cFieldsSlice = colFields.slice(0, gc);

      for (const row of selection) {
        let rk = '';
        for (let k = 0; k < rFieldsSlice.length; k++) rk += (k ? US : '') + displayValue(store, rFieldsSlice[k], row, datePattern);
        let ck = '';
        for (let k = 0; k < cFieldsSlice.length; k++) ck += (k ? US : '') + displayValue(store, cFieldsSlice[k], row, datePattern);
        const gkey = rk + GS + ck;
        let accs = groups.get(gkey);
        if (!accs) { accs = baseList.map((b) => createAccumulator(b.agg as never)); groups.set(gkey, accs); }
        for (let bi = 0; bi < baseList.length; bi++) {
          const b = baseList[bi];
          accs[bi].add(numericValue(store, b.field, row), rawKey(store, b.field, row));
        }
      }

      for (const [gkey, accs] of groups) {
        const [rk, ck] = gkey.split(GS);
        const rp = rk === '' ? [] : rk.split(US);
        const cp = ck === '' ? [] : ck.split(US);
        for (let bi = 0; bi < baseList.length; bi++) cellBase.set(pathKey(rp, cp, baseList[bi].key), accs[bi].value());
      }
    }
  }
  return cellBase;
}

/**
 * Assemble the full cell matrix from already-computed base cells (derive measures,
 * axis trees, sort, positional pass, formatting). This is shared by the LocalEngine
 * and the DuckDB accelerator so the OUTPUT is identical regardless of who produced the
 * base cells — only the grouping-sets aggregation in step 3 differs between paths.
 */
export function assembleMatrix(
  store: ColumnStore, normal: NormalReport, selection: number[], plan: BasePlan,
  cellBase: Map<string, number>, datePattern?: string,
): CellMatrix {
  const { rowFields, colFields, measures, measuresAxis } = normal;
  const { calcs, measureBaseKey } = plan;

  // ---- 4. Derive measure cell values ----
  const cells = new Map<string, number>();
  const grand = new Map<string, number>();
  const baseVal = (rp: string[], cp: string[], key: string): number => {
    const v = cellBase.get(pathKey(rp, cp, key));
    return v === undefined ? NaN : v;
  };

  const coords = new Set<string>();
  for (const k of cellBase.keys()) coords.add(k.slice(0, k.lastIndexOf(GS)));

  for (const coord of coords) {
    const gi = coord.indexOf(GS);
    const rk = coord.slice(0, gi);
    const ck = coord.slice(gi + 1);
    const rp = rk === '' ? [] : rk.split(US);
    const cp = ck === '' ? [] : ck.split(US);

    for (const m of measures) {
      let value: number;
      if (m.calculated) {
        const calc = calcs.find((c) => c.measure.key === m.key)!;
        value = evaluateFormula(calc.ast, {
          resolveAgg: (agg, field) => baseVal(rp, cp, `a${US}${agg}${US}${field}`),
          resolveField: (name) => baseVal(rp, cp, `f${US}${name}`),
        });
      } else if (isRelative(m.aggregation) && !POSITIONAL.has(m.aggregation)) {
        value = deriveRatio(m, rp, cp, baseVal, measureBaseKey(m));
      } else {
        // plain aggregations + positional measures (positional keeps the sum base here)
        value = baseVal(rp, cp, measureBaseKey(m));
      }
      cells.set(pathKey(rp, cp, m.key), value);
    }
  }

  // ---- 5. Axis trees (members, sort, sort-by-measure) ----
  const rowTree = buildAxisTree(store, selection, rowFields, normal, datePattern);
  const colTree = buildAxisTree(store, selection, colFields, normal, datePattern);
  applySortByMeasure(normal, cells, rowTree, colTree);

  // ---- 6. Positional pass (difference / %difference / runningtotals) ----
  applyPositional(measures, cells, rowTree, colTree, coords);

  for (const m of measures) grand.set(m.key, cells.get(pathKey([], [], m.key)) ?? NaN);

  // ---- 7. Formatting ----
  const formatMap = resolveFormats(normal.report.formats);
  const byKey = new Map(measures.map((m) => [m.key, m]));
  const text = new Map<string, string>();
  for (const [k, v] of cells) {
    const measureKey = k.slice(k.lastIndexOf(GS) + 1);
    const m = byKey.get(measureKey);
    text.set(k, formatNumber(v, pickFormat(m, formatMap)));
  }

  return { rowTree, colTree, rowFields, colFields, measures, measuresAxis, cells, text, grand };
}

export function buildMatrix(store: ColumnStore, normal: NormalReport): CellMatrix {
  const datePattern = normal.options.datePattern;

  // ---- 1. Filters -> selection (member filters + Top/Bottom-N) ----
  const selection = applyFilters(store, normal);

  // NOTE: grid.type (compact | flat | classic) is a RENDERING concern only — it
  // changes how the ROW fields are laid out (one nested column vs one column per
  // field). The cube below is identical for all three. (docs/Architecture.md)

  // ---- 2. Base aggregation descriptors ----
  const plan = planBase(normal.measures);

  // ---- 3. GROUPING SETS scan (main-thread) ----
  const cellBase = scanBaseCells(store, normal, selection, plan.baseList, datePattern);

  // ---- 4–7. Derive, trees, positional, formatting ----
  return assembleMatrix(store, normal, selection, plan, cellBase, datePattern);
}

// ---------------------------------------------------------------------------

function pickFormat(m: NormalMeasure | undefined, formatMap: Map<string, Required<NumberFormat>>) {
  if (m?.format && formatMap.has(m.format)) return formatMap.get(m.format)!;
  return formatMap.get('')!;
}

function deriveRatio(
  m: NormalMeasure, rp: string[], cp: string[],
  baseVal: (rp: string[], cp: string[], key: string) => number, key: string,
): number {
  const self = baseVal(rp, cp, key);
  const grand = baseVal([], [], key);
  const rowTot = baseVal(rp, [], key);
  const colTot = baseVal([], cp, key);
  switch (m.aggregation) {
    case 'percent': return grand ? self / grand : NaN;
    case 'percentofrow': return rowTot ? self / rowTot : NaN;
    case 'percentofcolumn': return colTot ? self / colTot : NaN;
    case 'index': return rowTot && colTot ? (self * grand) / (rowTot * colTot) : NaN;
    default: return self;
  }
}

/**
 * difference / %difference / runningtotals along the ordered leaf axis.
 *
 * Each positional measure walks its `positionalAxis` (default `'columns'`): for every
 * coordinate on the OTHER axis (incl. subtotal/grand coordinates) it steps across that
 * axis's leaf positions in display order, deriving each cell from its predecessor. The
 * step-axis grand cell is left undefined (NaN) — except `runningtotals`, which carries
 * the final running sum there.
 */
function applyPositional(
  measures: NormalMeasure[], cells: Map<string, number>,
  rowTree: AxisNode[], colTree: AxisNode[], coords: Set<string>,
): void {
  const positional = measures.filter((m) => !m.calculated && POSITIONAL.has(m.aggregation));
  if (!positional.length) return;

  const colLeaves = colTree.length ? leafPaths(colTree) : [];
  const rowLeaves = rowTree.length ? leafPaths(rowTree) : [];

  // Distinct row / column coordinates (the "other axis" we hold fixed while stepping).
  const rowCoords = new Set<string>();
  const colCoords = new Set<string>();
  for (const coord of coords) {
    const gi = coord.indexOf(GS);
    rowCoords.add(coord.slice(0, gi));
    colCoords.add(coord.slice(gi + 1));
  }

  for (const m of positional) {
    const alongRows = m.positionalAxis === 'rows';
    const stepLeaves = alongRows ? rowLeaves : colLeaves;
    if (!stepLeaves.length) continue; // nothing to walk across
    const otherCoords = alongRows ? colCoords : rowCoords;

    for (const ok of otherCoords) {
      const op = ok === '' ? [] : ok.split(US);
      let prev = NaN;
      let run = 0;
      let runStarted = false;
      for (const sp of stepLeaves) {
        const k = alongRows ? pathKey(sp, op, m.key) : pathKey(op, sp, m.key);
        const base = cells.get(k);
        if (base === undefined) continue;
        let out: number;
        if (m.aggregation === 'runningtotals') {
          run = (runStarted ? run : 0) + (Number.isNaN(base) ? 0 : base);
          runStarted = true;
          out = run;
        } else if (m.aggregation === 'difference') {
          out = Number.isNaN(prev) ? NaN : base - prev;
        } else {
          // %difference
          out = Number.isNaN(prev) || prev === 0 ? NaN : (base - prev) / prev;
        }
        cells.set(k, out);
        prev = base;
      }
      // The step-axis grand cell is undefined for positional measures.
      const grandKey = alongRows ? pathKey([], op, m.key) : pathKey(op, [], m.key);
      cells.set(grandKey, m.aggregation === 'runningtotals' && runStarted ? run : NaN);
    }
  }
}

function applySortByMeasure(
  normal: NormalReport, cells: Map<string, number>, rowTree: AxisNode[], colTree: AxisNode[],
): void {
  const sorting = normal.report.slice?.sorting;
  if (!sorting) return;

  // The report names the sort measure by uniqueName; cells are keyed by the slot
  // `key`. Resolve to the first measure carrying that uniqueName.
  const keyOf = (measure: string) =>
    normal.measures.find((m) => m.uniqueName === measure)?.key ?? measure;

  const resort = (
    nodes: AxisNode[], measure: string, type: 'asc' | 'desc', colPathOf: (path: string[]) => string[],
  ) => {
    const cmp = (a: AxisNode, b: AxisNode) => {
      const va = cells.get(pathKey(a.path, colPathOf(a.path), measure)) ?? NaN;
      const vb = cells.get(pathKey(b.path, colPathOf(b.path), measure)) ?? NaN;
      const d = (Number.isNaN(va) ? -Infinity : va) - (Number.isNaN(vb) ? -Infinity : vb);
      return type === 'desc' ? -d : d;
    };
    const walk = (list: AxisNode[]) => { list.sort(cmp); list.forEach((n) => walk(n.children)); };
    walk(nodes);
  };

  if (sorting.row?.measure) {
    resort(rowTree, keyOf(sorting.row.measure), sorting.row.type ?? 'desc', () => []);
  }
  if (sorting.column?.measure) {
    resort(colTree, keyOf(sorting.column.measure), sorting.column.type ?? 'desc', () => []);
  }
}

// ---------------------------------------------------------------------------
// Filters (member + Top/Bottom-N)

export function applyFilters(store: ColumnStore, normal: NormalReport): number[] {
  const datePattern = normal.options.datePattern;
  const memberFilters: Array<{ field: string; members: Set<string>; negation: boolean }> = [];
  const rankFilters: Array<{ field: string; spec: FilterSpec }> = [];

  const collect = (hs: { uniqueName: string; filter?: FilterSpec }[]) => {
    for (const h of hs) {
      const f = h.filter;
      if (!f || f.type === 'none') continue;
      if ((f.type === 'top' || f.type === 'bottom') && f.measure) {
        rankFilters.push({ field: h.uniqueName, spec: f });
      } else if (f.members && f.members.length) {
        memberFilters.push({ field: h.uniqueName, members: new Set(f.members), negation: Boolean(f.negation) });
      }
    }
  };
  collect(normal.report.slice?.rows ?? []);
  collect(normal.report.slice?.columns ?? []);
  collect(normal.reportFilters);

  let out: number[] = [];
  for (let i = 0; i < store.rowCount; i++) {
    let keep = true;
    for (const f of memberFilters) {
      const val = displayValue(store, f.field, i, datePattern);
      const inSet = f.members.has(val);
      if (f.negation ? inSet : !inSet) { keep = false; break; }
    }
    if (keep) out.push(i);
  }

  // Top/Bottom-N: rank members by the named measure (sum), keep N, restrict selection.
  for (const rf of rankFilters) {
    const q = rf.spec.quantity ?? 10;
    const sums = new Map<string, number>();
    for (const i of out) {
      const member = displayValue(store, rf.field, i, datePattern);
      const v = numericValue(store, rf.spec.measure!, i);
      sums.set(member, (sums.get(member) ?? 0) + (Number.isNaN(v) ? 0 : v));
    }
    const ranked = [...sums.entries()].sort((a, b) => b[1] - a[1]);
    const chosen = rf.spec.type === 'bottom' ? ranked.slice(-q) : ranked.slice(0, q);
    const keepMembers = new Set(chosen.map((e) => e[0]));
    out = out.filter((i) => keepMembers.has(displayValue(store, rf.field, i, datePattern)));
  }

  return out;
}

// ---------------------------------------------------------------------------
// Axis tree

function captionOf(normal: NormalReport, field: string): string {
  return normal.report.dataSource?.mapping?.[field]?.caption ?? field;
}

function buildAxisTree(
  store: ColumnStore, selection: number[], fields: string[], normal: NormalReport, datePattern?: string,
): AxisNode[] {
  if (!fields.length) return [];
  const sorts = new Map<string, 'asc' | 'desc' | 'unsorted'>();
  for (const h of [...(normal.report.slice?.rows ?? []), ...(normal.report.slice?.columns ?? [])]) {
    if (h.sort) sorts.set(h.uniqueName, h.sort);
  }
  const expandAll = normal.report.slice?.expands?.expandAll ?? true;

  interface Tmp { label: string; children: Map<string, Tmp>; }
  const root: Tmp = { label: '', children: new Map() };

  const blank = normal.localization.blankMember;
  for (const row of selection) {
    let node = root;
    for (const f of fields) {
      const label = displayValue(store, f, row, datePattern) || blank;
      let child = node.children.get(label);
      if (!child) { child = { label, children: new Map() }; node.children.set(label, child); }
      node = child;
    }
  }

  const build = (tmp: Tmp, path: string[], depth: number): AxisNode[] => {
    const field = fields[depth];
    const entries = [...tmp.children.entries()];
    const sort = sorts.get(field) ?? 'asc';
    const natural = store.columns.get(field)?.naturalOrder;
    if (sort !== 'unsorted') {
      entries.sort((a, b) => {
        let cmp: number;
        if (natural) {
          // Natural order (month/weekday/quarter); unknown members fall to the end.
          const ia = natural.indexOf(a[0]); const ib = natural.indexOf(b[0]);
          cmp = (ia < 0 ? natural.length : ia) - (ib < 0 ? natural.length : ib);
        } else {
          const na = Number(a[0]); const nb = Number(b[0]);
          cmp = !Number.isNaN(na) && !Number.isNaN(nb) ? na - nb : a[0].localeCompare(b[0]);
        }
        return sort === 'desc' ? -cmp : cmp;
      });
    }
    return entries.map(([label, child]) => {
      const nodePath = [...path, label];
      const isLeaf = depth === fields.length - 1;
      return {
        path: nodePath, label, field, depth, expanded: expandAll, isLeaf,
        children: isLeaf ? [] : build(child, nodePath, depth + 1),
      } as AxisNode;
    });
  };

  return build(root, [], 0);
}

/** Flatten an axis tree into ordered leaf paths (respecting expand state). */
export function leafPaths(tree: AxisNode[]): string[][] {
  const out: string[][] = [];
  const walk = (nodes: AxisNode[]) => {
    for (const n of nodes) {
      if (n.isLeaf || !n.expanded || !n.children.length) out.push(n.path);
      else walk(n.children);
    }
  };
  walk(tree);
  return out;
}
