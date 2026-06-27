import { describe, it, expect } from 'vitest';
import { createAccumulator, isRelative, ALL_AGGREGATIONS } from '../src/core/aggregations';

function agg(name: any, values: Array<number | string>) {
  const acc = createAccumulator(name);
  for (const v of values) {
    const num = typeof v === 'number' ? v : NaN;
    const key = typeof v === 'number' ? v : v;
    acc.add(num, key);
  }
  return acc.value();
}

describe('aggregations', () => {
  it('sum / count / average / min / max / product', () => {
    expect(agg('sum', [1, 2, 3, 4])).toBe(10);
    expect(agg('count', [1, 2, 3, 4])).toBe(4);
    expect(agg('average', [2, 4, 6])).toBe(4);
    expect(agg('min', [5, 2, 9])).toBe(2);
    expect(agg('max', [5, 2, 9])).toBe(9);
    expect(agg('product', [2, 3, 4])).toBe(24);
  });

  it('distinctcount counts unique non-blank values', () => {
    const acc = createAccumulator('distinctcount');
    ['a', 'b', 'a', 'c', 'b'].forEach((s) => acc.add(NaN, s));
    acc.add(NaN, null); // blank ignored
    expect(acc.value()).toBe(3);
  });

  it('median (odd and even)', () => {
    expect(agg('median', [1, 3, 2])).toBe(2);
    expect(agg('median', [1, 2, 3, 4])).toBe(2.5);
  });

  it('population vs sample stdev', () => {
    const p = agg('stdevp', [2, 4, 4, 4, 5, 5, 7, 9]);
    const s = agg('stdevs', [2, 4, 4, 4, 5, 5, 7, 9]);
    expect(p).toBeCloseTo(2, 5);
    expect(s).toBeCloseTo(2.13809, 4);
  });

  it('relative aggregations are flagged', () => {
    expect(isRelative('percent')).toBe(true);
    expect(isRelative('percentofcolumn')).toBe(true);
    expect(isRelative('runningtotals')).toBe(true);
    expect(isRelative('sum')).toBe(false);
  });

  it('exposes all 17 aggregation identifiers', () => {
    expect(ALL_AGGREGATIONS).toHaveLength(17);
    expect(ALL_AGGREGATIONS).toContain('%difference');
    expect(ALL_AGGREGATIONS).toContain('distinctcount');
  });
});
