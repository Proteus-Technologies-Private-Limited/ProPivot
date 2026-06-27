import { describe, it, expect } from 'vitest';
import { parseFormula, collectAggRefs, evaluateFormula } from '../src/core/formula';

const ctx = {
  resolveAgg: (agg: string, field: string) => {
    const table: Record<string, number> = {
      'sum:sales': 300, 'count:sales': 3, 'sum:qty': 7, 'distinctcount:region': 2,
    };
    return table[`${agg}:${field}`] ?? NaN;
  },
  resolveField: (name: string) => ({ sales: 300, qty: 7 }[name] ?? NaN),
};

describe('formula engine', () => {
  it('parses and evaluates aggregation division', () => {
    const ast = parseFormula("sum('sales')/sum('qty')");
    expect(evaluateFormula(ast, ctx)).toBeCloseTo(300 / 7, 6);
  });

  it('collects aggregation references', () => {
    const ast = parseFormula("sum('sales') * 2 - count('sales')");
    const refs = collectAggRefs(ast);
    expect(refs).toContainEqual({ agg: 'sum', field: 'sales' });
    expect(refs).toContainEqual({ agg: 'count', field: 'sales' });
  });

  it('supports arithmetic precedence and parentheses', () => {
    const ast = parseFormula('(1 + 2) * 3 ^ 2');
    expect(evaluateFormula(ast, ctx)).toBe(27);
  });

  it('supports if() and comparisons', () => {
    const ast = parseFormula("if(sum('sales') > 100, 1, 0)");
    expect(evaluateFormula(ast, ctx)).toBe(1);
  });

  it('supports #field# interpolation as default aggregate', () => {
    const ast = parseFormula('#sales# / #qty#');
    expect(evaluateFormula(ast, ctx)).toBeCloseTo(300 / 7, 6);
  });

  it('scalar helpers abs/round/min/max', () => {
    expect(evaluateFormula(parseFormula('abs(-5)'), ctx)).toBe(5);
    expect(evaluateFormula(parseFormula('round(3.14159, 2)'), ctx)).toBe(3.14);
    expect(evaluateFormula(parseFormula('max(1, 9, 4)'), ctx)).toBe(9);
  });
});
