// Calculated-value formula language (docs/Architecture.md).
// Grammar: field-aggregation functions over a quoted field name, scalar math
// helpers, arithmetic (+ - * / ^), comparison, and/or, if(cond,then,else),
// and `#field#` interpolation. Parsed to an AST then evaluated per cell.

export type AstNode =
  | { kind: 'num'; value: number }
  | { kind: 'field'; name: string } // bare identifier or #field# -> default aggregate
  | { kind: 'agg'; agg: string; field: string }
  | { kind: 'call'; name: string; args: AstNode[] }
  | { kind: 'unary'; op: string; arg: AstNode }
  | { kind: 'binary'; op: string; left: AstNode; right: AstNode }
  | { kind: 'if'; cond: AstNode; then: AstNode; else?: AstNode };

const FIELD_AGGS = new Set([
  'sum', 'average', 'count', 'distinctcount', 'median', 'product', 'min', 'max',
  'percent', 'percentofcolumn', 'percentofrow', 'index', 'difference',
  'runningtotals', 'stdevp', 'stdevs',
]);

/**
 * UI-facing reference for the formula language — the single source the column
 * Calculation panel renders so users can discover what's available. Keep the
 * `aggregations` list in sync with FIELD_AGGS above and `scalars` with the scalar
 * cases in evaluateFormula.
 */
export const FORMULA_HELP: {
  aggregations: Array<{ syntax: string; desc: string }>;
  scalars: Array<{ syntax: string; desc: string }>;
  operators: Array<{ syntax: string; desc: string }>;
  syntax: Array<{ syntax: string; desc: string }>;
} = {
  aggregations: [
    { syntax: "sum('field')", desc: 'Sum of a field' },
    { syntax: "average('field')", desc: 'Mean of a field' },
    { syntax: "count('field')", desc: 'Row count' },
    { syntax: "distinctcount('field')", desc: 'Distinct values' },
    { syntax: "median('field')", desc: 'Median' },
    { syntax: "product('field')", desc: 'Product of values' },
    { syntax: "min('field')", desc: 'Minimum' },
    { syntax: "max('field')", desc: 'Maximum' },
    { syntax: "percent('field')", desc: 'Percent of grand total' },
    { syntax: "percentofcolumn('field')", desc: 'Percent of column total' },
    { syntax: "percentofrow('field')", desc: 'Percent of row total' },
    { syntax: "index('field')", desc: 'Weighted index' },
    { syntax: "difference('field')", desc: 'Difference vs previous' },
    { syntax: "runningtotals('field')", desc: 'Running total' },
    { syntax: "stdevp('field')", desc: 'Population std. deviation' },
    { syntax: "stdevs('field')", desc: 'Sample std. deviation' },
  ],
  scalars: [
    { syntax: 'abs(x)', desc: 'Absolute value' },
    { syntax: 'round(x, n?)', desc: 'Round (to n decimals)' },
    { syntax: 'min(a, b, …)', desc: 'Smallest argument' },
    { syntax: 'max(a, b, …)', desc: 'Largest argument' },
    { syntax: 'isnan(x)', desc: '1 if x is NaN, else 0' },
  ],
  operators: [
    { syntax: '+  -  *  /  ^', desc: 'Arithmetic (^ = power)' },
    { syntax: '>  <  >=  <=  ==  !=', desc: 'Comparison → 1 / 0' },
    { syntax: 'and   or', desc: 'Boolean → 1 / 0' },
  ],
  syntax: [
    { syntax: 'if(cond, then, else)', desc: 'Conditional value' },
    { syntax: '#field#', desc: "Field by its default aggregation (same as sum('field') for numbers)" },
  ],
};

type Tok = { t: string; v: string };

function lex(input: string): Tok[] {
  const s = input;
  const toks: Tok[] = [];
  let i = 0;
  const isD = (c: string) => c >= '0' && c <= '9';
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t' || c === '\n') { i++; continue; }
    // #field# interpolation
    if (c === '#') {
      const end = s.indexOf('#', i + 1);
      if (end > i) { toks.push({ t: 'hashfield', v: s.slice(i + 1, end) }); i = end + 1; continue; }
    }
    if (c === '"' || c === "'") {
      const end = s.indexOf(c, i + 1);
      const str = end > i ? s.slice(i + 1, end) : s.slice(i + 1);
      toks.push({ t: 'str', v: str });
      i = (end > i ? end : s.length) + 1;
      continue;
    }
    if (isD(c) || (c === '.' && isD(s[i + 1] ?? ''))) {
      let j = i + 1;
      while (j < s.length && (isD(s[j]) || s[j] === '.')) j++;
      toks.push({ t: 'num', v: s.slice(i, j) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
      toks.push({ t: 'ident', v: s.slice(i, j) });
      i = j;
      continue;
    }
    const two = s.slice(i, i + 2);
    if (['>=', '<=', '==', '!='].includes(two)) { toks.push({ t: 'op', v: two }); i += 2; continue; }
    if ('+-*/^(),<>'.includes(c)) { toks.push({ t: 'op', v: c }); i++; continue; }
    if (c === '=') { toks.push({ t: 'op', v: '==' }); i++; continue; }
    i++;
  }
  return toks;
}

class FParser {
  private pos = 0;
  constructor(private toks: Tok[]) {}

  parse(): AstNode { return this.expr(); }
  private peek() { return this.toks[this.pos]; }
  private eat(v?: string) {
    const t = this.toks[this.pos];
    if (v && (!t || t.v !== v)) throw new Error(`expected ${v}`);
    this.pos++;
    return t;
  }
  private isOp(v: string) { const t = this.peek(); return t && t.t === 'op' && t.v === v; }

  private expr(): AstNode { return this.or(); }
  private or(): AstNode {
    let l = this.and();
    while (this.peek() && this.peek().t === 'ident' && this.peek().v.toLowerCase() === 'or') {
      this.pos++;
      l = { kind: 'binary', op: 'or', left: l, right: this.and() };
    }
    return l;
  }
  private and(): AstNode {
    let l = this.cmp();
    while (this.peek() && this.peek().t === 'ident' && this.peek().v.toLowerCase() === 'and') {
      this.pos++;
      l = { kind: 'binary', op: 'and', left: l, right: this.cmp() };
    }
    return l;
  }
  private cmp(): AstNode {
    let l = this.add();
    const t = this.peek();
    if (t && t.t === 'op' && ['>', '<', '>=', '<=', '==', '!='].includes(t.v)) {
      this.pos++;
      return { kind: 'binary', op: t.v, left: l, right: this.add() };
    }
    return l;
  }
  private add(): AstNode {
    let l = this.mul();
    while (this.isOp('+') || this.isOp('-')) {
      const op = this.eat()!.v;
      l = { kind: 'binary', op, left: l, right: this.mul() };
    }
    return l;
  }
  private mul(): AstNode {
    let l = this.pow();
    while (this.isOp('*') || this.isOp('/')) {
      const op = this.eat()!.v;
      l = { kind: 'binary', op, left: l, right: this.pow() };
    }
    return l;
  }
  private pow(): AstNode {
    let l = this.unary();
    while (this.isOp('^')) {
      this.eat();
      l = { kind: 'binary', op: '^', left: l, right: this.unary() };
    }
    return l;
  }
  private unary(): AstNode {
    if (this.isOp('-')) { this.eat(); return { kind: 'unary', op: '-', arg: this.unary() }; }
    return this.primary();
  }
  private primary(): AstNode {
    const t = this.peek();
    if (!t) return { kind: 'num', value: 0 };
    if (t.t === 'num') { this.pos++; return { kind: 'num', value: parseFloat(t.v) }; }
    if (t.t === 'hashfield') { this.pos++; return { kind: 'field', name: t.v }; }
    if (t.t === 'str') { this.pos++; return { kind: 'field', name: t.v }; }
    if (t.t === 'op' && t.v === '(') {
      this.eat('(');
      const e = this.expr();
      if (this.isOp(')')) this.eat(')');
      return e;
    }
    if (t.t === 'ident') {
      this.pos++;
      const name = t.v.toLowerCase();
      if (this.isOp('(')) {
        this.eat('(');
        const args: AstNode[] = [];
        if (!this.isOp(')')) {
          args.push(this.expr());
          while (this.isOp(',')) { this.eat(','); args.push(this.expr()); }
        }
        if (this.isOp(')')) this.eat(')');
        // Field-aggregation form: single string/field argument.
        if (FIELD_AGGS.has(name) && args.length === 1 && args[0].kind === 'field') {
          return { kind: 'agg', agg: name, field: args[0].name };
        }
        if (name === 'if') {
          return { kind: 'if', cond: args[0], then: args[1], else: args[2] };
        }
        return { kind: 'call', name, args };
      }
      // bare identifier = field reference (default aggregate)
      return { kind: 'field', name: t.v };
    }
    this.pos++;
    return { kind: 'num', value: 0 };
  }
}

export function parseFormula(formula: string): AstNode {
  return new FParser(lex(formula)).parse();
}

const SCALAR_FNS = new Set(['abs', 'round', 'min', 'max', 'isnan']);

/**
 * Lightweight validity check for the calculation editor. The parser itself is
 * deliberately lenient (it recovers from anything), so this walks the AST and
 * flags the mistakes a user actually makes: an unknown aggregation, an unknown
 * scalar function, or a reference to a field that isn't in the data. Returns the
 * first problem found, or `{ ok: true }` for an empty or sound formula.
 */
export function validateFormula(formula: string, knownFields: Iterable<string>): { ok: boolean; message?: string } {
  const trimmed = formula.trim();
  if (!trimmed) return { ok: true };
  const known = new Set(knownFields);
  let problem = '';
  const walk = (n: AstNode): void => {
    if (problem) return;
    switch (n.kind) {
      case 'agg':
        if (!FIELD_AGGS.has(n.agg)) problem = `Unknown aggregation "${n.agg}"`;
        else if (!known.has(n.field)) problem = `Unknown field "${n.field}"`;
        break;
      case 'field':
        if (!known.has(n.name)) problem = `Unknown field "${n.name}"`;
        break;
      case 'call':
        if (!SCALAR_FNS.has(n.name)) problem = `Unknown function "${n.name}"`;
        else n.args.forEach(walk);
        break;
      case 'unary': walk(n.arg); break;
      case 'binary': walk(n.left); walk(n.right); break;
      case 'if': walk(n.cond); walk(n.then); if (n.else) walk(n.else); break;
    }
  };
  walk(parseFormula(trimmed));
  return problem ? { ok: false, message: problem } : { ok: true };
}

/** All (agg, field) references that must be pre-aggregated for a cell. */
export function collectAggRefs(ast: AstNode, out: Array<{ agg: string; field: string }> = []): Array<{ agg: string; field: string }> {
  switch (ast.kind) {
    case 'agg': out.push({ agg: ast.agg, field: ast.field }); break;
    case 'unary': collectAggRefs(ast.arg, out); break;
    case 'binary': collectAggRefs(ast.left, out); collectAggRefs(ast.right, out); break;
    case 'call': ast.args.forEach((a) => collectAggRefs(a, out)); break;
    case 'if': collectAggRefs(ast.cond, out); collectAggRefs(ast.then, out); if (ast.else) collectAggRefs(ast.else, out); break;
  }
  return out;
}

export function collectFieldRefs(ast: AstNode, out: Set<string> = new Set()): Set<string> {
  switch (ast.kind) {
    case 'field': out.add(ast.name); break;
    case 'unary': collectFieldRefs(ast.arg, out); break;
    case 'binary': collectFieldRefs(ast.left, out); collectFieldRefs(ast.right, out); break;
    case 'call': ast.args.forEach((a) => collectFieldRefs(a, out)); break;
    case 'if': collectFieldRefs(ast.cond, out); collectFieldRefs(ast.then, out); if (ast.else) collectFieldRefs(ast.else, out); break;
  }
  return out;
}

export interface FormulaContext {
  /** Aggregated value of `field` under `agg` for the current cell group. */
  resolveAgg(agg: string, field: string): number;
  /** Bare field / #field# reference -> default aggregate (sum). */
  resolveField(name: string): number;
}

export function evaluateFormula(ast: AstNode, ctx: FormulaContext): number {
  const ev = (n: AstNode): number => {
    switch (n.kind) {
      case 'num': return n.value;
      case 'field': return ctx.resolveField(n.name);
      case 'agg': return ctx.resolveAgg(n.agg, n.field);
      case 'unary': return n.op === '-' ? -ev(n.arg) : ev(n.arg);
      case 'binary': {
        const a = ev(n.left);
        const b = ev(n.right);
        switch (n.op) {
          case '+': return a + b;
          case '-': return a - b;
          case '*': return a * b;
          case '/': return b === 0 ? NaN : a / b;
          case '^': return Math.pow(a, b);
          case '>': return a > b ? 1 : 0;
          case '<': return a < b ? 1 : 0;
          case '>=': return a >= b ? 1 : 0;
          case '<=': return a <= b ? 1 : 0;
          case '==': return a === b ? 1 : 0;
          case '!=': return a !== b ? 1 : 0;
          case 'and': return a && b ? 1 : 0;
          case 'or': return a || b ? 1 : 0;
          default: return NaN;
        }
      }
      case 'if': return ev(n.cond) ? ev(n.then) : n.else ? ev(n.else) : 0;
      case 'call': {
        const args = n.args.map(ev);
        switch (n.name) {
          case 'abs': return Math.abs(args[0]);
          case 'round': return args.length > 1 ? Number(args[0].toFixed(args[1])) : Math.round(args[0]);
          case 'min': return Math.min(...args);
          case 'max': return Math.max(...args);
          case 'isnan': return Number.isNaN(args[0]) ? 1 : 0;
          default: return NaN;
        }
      }
    }
  };
  return ev(ast);
}
