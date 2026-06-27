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
