// Number formatting (docs/Architecture.md). The 13-field Number Format object.

import type { NumberFormat } from './types';

const DEFAULT_FORMAT: Required<NumberFormat> = {
  name: '',
  thousandsSeparator: ' ',
  decimalSeparator: '.',
  decimalPlaces: -1,
  maxDecimalPlaces: -1,
  maxSymbols: 20,
  currencySymbol: '',
  currencySymbolAlign: 'left',
  isPercent: false,
  nullValue: '',
  infinityValue: 'Infinity',
  divideByZeroValue: 'Infinity',
  textAlign: 'right',
};

export function resolveFormats(formats: NumberFormat[] | undefined): Map<string, Required<NumberFormat>> {
  const map = new Map<string, Required<NumberFormat>>();
  for (const f of formats ?? []) {
    map.set(f.name ?? '', { ...DEFAULT_FORMAT, ...f });
  }
  if (!map.has('')) map.set('', { ...DEFAULT_FORMAT });
  return map;
}

function groupThousands(intPart: string, sep: string): string {
  if (!sep) return intPart;
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

export function formatNumber(value: number, fmt?: Required<NumberFormat>): string {
  const f = fmt ?? DEFAULT_FORMAT;
  if (value === null || value === undefined || Number.isNaN(value)) return f.nullValue;
  if (!Number.isFinite(value)) return f.infinityValue;

  let v = value;
  if (f.isPercent) v = v * 100;

  let decimals = f.decimalPlaces;
  if (decimals < 0) {
    // auto: show up to maxDecimalPlaces (or 2) but trim trailing zeros.
    const cap = f.maxDecimalPlaces >= 0 ? f.maxDecimalPlaces : 2;
    const rounded = Number(v.toFixed(cap));
    const str = String(rounded);
    const dot = str.indexOf('.');
    decimals = dot >= 0 ? str.length - dot - 1 : 0;
  } else if (f.maxDecimalPlaces >= 0 && decimals > f.maxDecimalPlaces) {
    decimals = f.maxDecimalPlaces;
  }

  const neg = v < 0;
  const abs = Math.abs(v);
  const fixed = abs.toFixed(Math.max(0, decimals));
  const [intRaw, decRaw] = fixed.split('.');
  let out = groupThousands(intRaw, f.thousandsSeparator);
  if (decRaw) out += f.decimalSeparator + decRaw;

  if (f.currencySymbol) {
    out = f.currencySymbolAlign === 'right' ? out + f.currencySymbol : f.currencySymbol + out;
  }
  if (f.isPercent) out += '%';
  if (neg) out = '-' + out;
  if (f.maxSymbols > 0 && out.length > f.maxSymbols) out = out.slice(0, f.maxSymbols);
  return out;
}

/**
 * Excel custom number-format code mirroring `formatNumber` for a NumberFormat, so
 * the .xlsx writer can keep numeric cells live yet show the same grouping /
 * decimals / currency / percent as the grid. (Excel localizes the actual grouping
 * and decimal characters, so the custom thousands/decimal separators aren't encoded
 * literally — the numeric shape is what carries across.)
 */
export function excelNumberFormatCode(fmt?: NumberFormat): string {
  const f = { ...DEFAULT_FORMAT, ...(fmt ?? {}) };
  const intPart = f.thousandsSeparator !== '' ? '#,##0' : '0';
  let dec = '';
  if (f.decimalPlaces >= 0) {
    if (f.decimalPlaces > 0) dec = '.' + '0'.repeat(f.decimalPlaces);
  } else {
    const cap = f.maxDecimalPlaces >= 0 ? f.maxDecimalPlaces : 2;
    if (cap > 0) dec = '.' + '#'.repeat(cap);
  }
  let code = intPart + dec;
  if (f.currencySymbol) {
    const sym = `"${f.currencySymbol.replace(/"/g, '')}"`;
    code = f.currencySymbolAlign === 'right' ? code + sym : sym + code;
  }
  if (f.isPercent) code += '%';
  return code;
}
