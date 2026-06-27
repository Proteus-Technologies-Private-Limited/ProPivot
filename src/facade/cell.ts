// CellBuilder + CellData (docs/Architecture.md). These shapes are read/written
// by consumer customizeCell functions, so members must match exactly.

export class CellBuilder {
  text = '';
  style: Record<string, string> = {};
  classes: string[] = [];
  attr: Record<string, string> = {};
  tag = 'td';

  addClass(value: string): void {
    if (value && !this.classes.includes(value)) this.classes.push(value);
  }

  toHtml(): string {
    const cls = this.classes.length ? ` class="${this.classes.join(' ')}"` : '';
    const style = Object.keys(this.style).length
      ? ` style="${Object.entries(this.style).map(([k, v]) => `${kebab(k)}:${v}`).join(';')}"`
      : '';
    const attrs = Object.entries(this.attr).map(([k, v]) => ` ${k}="${v}"`).join('');
    return `<${this.tag}${cls}${style}${attrs}>${this.text}</${this.tag}>`;
  }
}

function kebab(s: string): string {
  return s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
}

/**
 * One entry in a cell's row/column tuple: the field (hierarchy) at this level
 * AND the member value the clicked cell sits on for that field.
 */
export interface CellTupleItem {
  /** Field / hierarchy uniqueName. */
  uniqueName: string;
  /** Field caption. */
  caption?: string;
  /** Member value at this level for the clicked cell (omitted on totals). */
  member?: string;
  /** Display caption of the member. */
  memberCaption?: string;
  /** Depth of this field on its axis (0-based). */
  level?: number;
}

export interface CellData {
  rowIndex: number;
  columnIndex: number;
  /** The cell's ROW tuple: one entry per row field, each with its member here. */
  rows: CellTupleItem[];
  /** The cell's COLUMN tuple: one entry per column field, each with its member here. */
  columns: CellTupleItem[];
  hierarchy?: { uniqueName: string; caption?: string };
  measure?: { uniqueName: string; caption?: string };
  member?: { name: string; caption?: string };
  label?: string;
  value?: number;
  type: 'header' | 'value';
  level?: number;
  /** Member values down the row/column axes for this cell (used by drill-through). */
  rowPath?: string[];
  colPath?: string[];
  isClassicTotalRow?: boolean;
  isDrillThrough?: boolean;
  isGrandTotal?: boolean;
  isGrandTotalColumn?: boolean;
  isGrandTotalRow?: boolean;
  isTotal?: boolean;
  isTotalColumn?: boolean;
  isTotalRow?: boolean;
}
