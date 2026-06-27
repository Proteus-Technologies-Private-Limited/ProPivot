import { describe, it, expect } from 'vitest';
import { compileConditionFormula } from '../src/core/conditions';

describe('conditional-format formula (both dialects)', () => {
  it('legacy #value# placeholder with symbolic operators', () => {
    const p = compileConditionFormula('#value# > 1000');
    expect(p(2000)).toBe(true);
    expect(p(500)).toBe(false);
  });

  it('#value placeholder with word operators (AND/OR)', () => {
    const p = compileConditionFormula('#value > 500 AND #value < 1000');
    expect(p(750)).toBe(true);
    expect(p(1500)).toBe(false);
  });

  it('|| / OR and = / == equivalence', () => {
    const a = compileConditionFormula('#value# < 0 || #value# > 5000');
    expect(a(-1)).toBe(true);
    expect(a(6000)).toBe(true);
    expect(a(10)).toBe(false);

    const eq = compileConditionFormula('#value = 42');
    expect(eq(42)).toBe(true);
    expect(eq(43)).toBe(false);
  });

  it('<> maps to not-equal', () => {
    const p = compileConditionFormula('#value <> 0');
    expect(p(5)).toBe(true);
    expect(p(0)).toBe(false);
  });

  it('isNaN support', () => {
    const p = compileConditionFormula('isNaN(#value)');
    expect(p(NaN)).toBe(true);
    expect(p(1)).toBe(false);
  });

  it('invalid formula never matches', () => {
    const p = compileConditionFormula('');
    expect(p(1)).toBe(false);
  });
});
