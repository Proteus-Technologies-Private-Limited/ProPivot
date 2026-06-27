// Conditional-format formula evaluation (docs/Architecture.md §4).
// Accepts BOTH value-placeholder dialects:
//   - `#value` and `#value#`
//   - operators &&/AND, ||/OR, =/==, <>/!=, plus < <= > >= and isNaN()
// Implemented with a small no-eval recursive-descent evaluator.

import type { Condition } from './types';

type Token = { t: 'num' | 'op' | 'lparen' | 'rparen' | 'ident' | 'value'; v: string };

function tokenize(input: string): Token[] {
  // Normalize placeholder and word operators to symbolic forms.
  let s = input
    .replace(/#value#/gi, '#value')
    .replace(/\bAND\b/gi, '&&')
    .replace(/\bOR\b/gi, '||');
  const tokens: Token[] = [];
  let i = 0;
  const isDigit = (c: string) => c >= '0' && c <= '9';
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t') { i++; continue; }
    if (s.startsWith('#value', i)) { tokens.push({ t: 'value', v: '#value' }); i += 6; continue; }
    if (c === '(') { tokens.push({ t: 'lparen', v: c }); i++; continue; }
    if (c === ')') { tokens.push({ t: 'rparen', v: c }); i++; continue; }
    // multi-char operators
    const two = s.slice(i, i + 2);
    if (['>=', '<=', '==', '!=', '<>', '&&', '||'].includes(two)) {
      tokens.push({ t: 'op', v: two === '<>' ? '!=' : two });
      i += 2;
      continue;
    }
    if (c === '=') { tokens.push({ t: 'op', v: '==' }); i++; continue; }
    if ('<>+-*/'.includes(c)) { tokens.push({ t: 'op', v: c }); i++; continue; }
    if (c === '!') { tokens.push({ t: 'op', v: '!' }); i++; continue; }
    if (isDigit(c) || (c === '.' && isDigit(s[i + 1] ?? ''))) {
      let j = i + 1;
      while (j < s.length && (isDigit(s[j]) || s[j] === '.')) j++;
      tokens.push({ t: 'num', v: s.slice(i, j) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i + 1;
      while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
      tokens.push({ t: 'ident', v: s.slice(i, j) });
      i = j;
      continue;
    }
    i++; // skip unknown char
  }
  return tokens;
}

// Recursive-descent parser building a predicate over the cell value.
class Parser {
  private pos = 0;
  constructor(private tokens: Token[], private value: number) {}

  parse(): number | boolean {
    const r = this.parseOr();
    return r;
  }

  private peek(): Token | undefined { return this.tokens[this.pos]; }
  private next(): Token | undefined { return this.tokens[this.pos++]; }
  private eatOp(v: string): boolean {
    const t = this.peek();
    if (t && t.t === 'op' && t.v === v) { this.pos++; return true; }
    return false;
  }

  private parseOr(): number | boolean {
    let left = this.parseAnd();
    while (this.eatOp('||')) {
      const right = this.parseAnd();
      left = Boolean(left) || Boolean(right);
    }
    return left;
  }

  private parseAnd(): number | boolean {
    let left = this.parseComparison();
    while (this.eatOp('&&')) {
      const right = this.parseComparison();
      left = Boolean(left) && Boolean(right);
    }
    return left;
  }

  private parseComparison(): number | boolean {
    let left = this.parseAdd();
    const t = this.peek();
    if (t && t.t === 'op' && ['>', '<', '>=', '<=', '==', '!='].includes(t.v)) {
      this.pos++;
      const right = this.parseAdd() as number;
      const a = left as number;
      switch (t.v) {
        case '>': return a > right;
        case '<': return a < right;
        case '>=': return a >= right;
        case '<=': return a <= right;
        case '==': return a === right;
        case '!=': return a !== right;
      }
    }
    return left;
  }

  private parseAdd(): number | boolean {
    let left = this.parseMul();
    for (;;) {
      const t = this.peek();
      if (t && t.t === 'op' && (t.v === '+' || t.v === '-')) {
        this.pos++;
        const r = this.parseMul() as number;
        left = t.v === '+' ? (left as number) + r : (left as number) - r;
      } else break;
    }
    return left;
  }

  private parseMul(): number | boolean {
    let left = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (t && t.t === 'op' && (t.v === '*' || t.v === '/')) {
        this.pos++;
        const r = this.parseUnary() as number;
        left = t.v === '*' ? (left as number) * r : (left as number) / r;
      } else break;
    }
    return left;
  }

  private parseUnary(): number | boolean {
    if (this.eatOp('!')) return !this.parseUnary();
    if (this.eatOp('-')) return -(this.parseUnary() as number);
    return this.parsePrimary();
  }

  private parsePrimary(): number | boolean {
    const t = this.next();
    if (!t) return 0;
    if (t.t === 'value') return this.value;
    if (t.t === 'num') return parseFloat(t.v);
    if (t.t === 'lparen') {
      const r = this.parseOr();
      this.eatRParen();
      return r;
    }
    if (t.t === 'ident') {
      const name = t.v.toLowerCase();
      if (name === 'isnan') {
        // isNaN(expr)
        this.expectLParen();
        const arg = this.parseOr();
        this.eatRParen();
        return Number.isNaN(arg as number);
      }
      if (name === 'true') return true;
      if (name === 'false') return false;
      return 0;
    }
    return 0;
  }

  private expectLParen() { const t = this.peek(); if (t && t.t === 'lparen') this.pos++; }
  private eatRParen() { const t = this.peek(); if (t && t.t === 'rparen') this.pos++; }
}

export type ConditionPredicate = (value: number) => boolean;

/** Compile a condition formula into a predicate. Invalid formulas => never match. */
export function compileConditionFormula(formula: string): ConditionPredicate {
  if (!formula || !formula.trim()) return () => false;
  const tokens = tokenize(formula);
  return (value: number) => {
    try {
      const result = new Parser(tokens, value).parse();
      return Boolean(result);
    } catch {
      return false;
    }
  };
}

export interface CompiledCondition {
  predicate: ConditionPredicate;
  condition: Condition;
}

export function compileConditions(conditions: Condition[] | undefined): CompiledCondition[] {
  return (conditions ?? []).map((c) => ({
    predicate: compileConditionFormula(c.formula ?? ''),
    condition: c,
  }));
}
