import { describe, it, expect } from 'vitest';
import { resolveFormats, formatNumber } from '../src/core/format';

describe('number formatting', () => {
  it('default format groups thousands with auto decimals', () => {
    const f = resolveFormats([])!.get('')!;
    expect(formatNumber(1234567, f)).toBe('1 234 567');
  });

  it('currency with fixed decimals and left symbol', () => {
    const f = resolveFormats([{ name: 'cur', currencySymbol: '$', decimalPlaces: 2, thousandsSeparator: ',' }])!.get('cur')!;
    expect(formatNumber(1234.5, f)).toBe('$1,234.50');
  });

  it('percent multiplies by 100 and appends %', () => {
    const f = resolveFormats([{ name: 'p', isPercent: true, decimalPlaces: 1 }])!.get('p')!;
    expect(formatNumber(0.2, f)).toBe('20.0%');
  });

  it('nullValue for NaN', () => {
    const f = resolveFormats([{ name: 'n', nullValue: '-' }])!.get('n')!;
    expect(formatNumber(NaN, f)).toBe('-');
  });

  it('negative numbers keep grouping', () => {
    const f = resolveFormats([])!.get('')!;
    expect(formatNumber(-12000, f)).toBe('-12 000');
  });
});
