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

export interface CellData {
  rowIndex: number;
  columnIndex: number;
  rows: Array<{ uniqueName: string; caption?: string }>;
  columns: Array<{ uniqueName: string; caption?: string }>;
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
