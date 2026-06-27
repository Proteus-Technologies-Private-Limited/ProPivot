// Cell matrix + axis tree types (docs/Architecture.md).

import type { NormalMeasure } from './normalize';

export interface AxisNode {
  /** Member values from the root down to this node. [] = grand total. */
  path: string[];
  /** Display label for this node's own member. */
  label: string;
  /** Field (hierarchy uniqueName) this node belongs to. */
  field: string;
  depth: number;
  children: AxisNode[];
  expanded: boolean;
  /** Leaf = deepest level (no further drill). */
  isLeaf: boolean;
}

export const US = '␟'; // unit separator inside a path
export const GS = '␞'; // group separator between row/col/measure

export function pathKey(rowPath: string[], colPath: string[], measure: string): string {
  return rowPath.join(US) + GS + colPath.join(US) + GS + measure;
}

export interface CellValue {
  value: number;
  /** Pre-formatted display string. */
  text: string;
  isTotal: boolean;
  isGrandTotal: boolean;
}

export interface FlatColumn {
  key: string;
  caption: string;
  isMeasure: boolean;
  align: 'left' | 'right';
}

export interface FlatCell {
  text: string;
  value?: number;
  isMeasure: boolean;
}

export interface FlatMatrix {
  columns: FlatColumn[];
  rows: FlatCell[][];
}

export interface CellMatrix {
  rowTree: AxisNode[];
  colTree: AxisNode[];
  rowFields: string[];
  colFields: string[];
  measures: NormalMeasure[];
  measuresAxis: 'rows' | 'columns';
  cells: Map<string, number>;
  /** Formatted text cache keyed the same as `cells`. */
  text: Map<string, string>;
  grand: Map<string, number>; // measureUniqueName -> grand total value
  /** Present only when grid.type === 'flat'. */
  flat?: FlatMatrix;
}

/** Plain-object form of a CellMatrix for structured-clone transfer to/from a Worker. */
export interface SerializedMatrix {
  rowTree: AxisNode[];
  colTree: AxisNode[];
  rowFields: string[];
  colFields: string[];
  measures: NormalMeasure[];
  measuresAxis: 'rows' | 'columns';
  cells: Array<[string, number]>;
  text: Array<[string, string]>;
  grand: Array<[string, number]>;
  flat?: FlatMatrix;
}

export function serializeMatrix(m: CellMatrix): SerializedMatrix {
  return {
    rowTree: m.rowTree,
    colTree: m.colTree,
    rowFields: m.rowFields,
    colFields: m.colFields,
    measures: m.measures,
    measuresAxis: m.measuresAxis,
    cells: [...m.cells],
    text: [...m.text],
    grand: [...m.grand],
    flat: m.flat,
  };
}

export function deserializeMatrix(s: SerializedMatrix): CellMatrix {
  return {
    rowTree: s.rowTree,
    colTree: s.colTree,
    rowFields: s.rowFields,
    colFields: s.colFields,
    measures: s.measures,
    measuresAxis: s.measuresAxis,
    cells: new Map(s.cells),
    text: new Map(s.text),
    grand: new Map(s.grand),
    flat: s.flat,
  };
}
