import { describe, it, expect } from 'vitest';
import {
  formatVisual, evalConditionStyle, formatsForType, parseRgb, formatDateValue,
} from '../src/core/cellStyle';
import { compileConditions } from '../src/core/conditions';

describe('formatVisual', () => {
  it('no display format returns base text only (default render unchanged)', () => {
    const v = formatVisual({ value: 5, raw: 5, baseText: '5' });
    expect(v.text).toBe('5');
    expect(v.html).toBeUndefined();
  });

  it('number applies Intl formatting and right alignment', () => {
    const v = formatVisual({ value: 1234.5, raw: 1234.5, baseText: '1234.5', display: { type: 'number', numberStyle: 'currency', currency: 'USD', decimals: 2 }, fieldType: 'number' });
    expect(v.text).toContain('$');
    expect(v.align).toBe('right');
  });

  it('signed shows a down arrow and red color for negatives', () => {
    const v = formatVisual({ value: -5, raw: -5, baseText: '-5', display: { type: 'signed' }, fieldType: 'number' });
    expect(v.text).toContain('▼');
    expect(v.color).toBe('#dc2626');
  });

  it('data_bar emits a bar at the right fraction', () => {
    const v = formatVisual({ value: 50, raw: 50, baseText: '50', display: { type: 'data_bar', min: 0, max: 100 }, fieldType: 'number' });
    expect(v.bar?.pct).toBeCloseTo(0.5);
    expect(v.rich).toBe(true);
    expect(v.html).toContain('span');
  });

  it('data_bar auto-scales from columnStats when no min/max', () => {
    const v = formatVisual({ value: 5, raw: 5, baseText: '5', display: { type: 'data_bar' }, fieldType: 'number', columnStats: { min: 0, max: 10 } });
    expect(v.bar?.pct).toBeCloseTo(0.5);
  });

  it('heatmap background sets a hex bg', () => {
    const v = formatVisual({ value: 90, raw: 90, baseText: '90', display: { type: 'heatmap', applyTo: 'background', thresholds: [25, 50, 75] }, fieldType: 'number' });
    expect(v.bg).toMatch(/^#/);
  });

  it('status_tag maps a value to a colored pill', () => {
    const v = formatVisual({ value: undefined, raw: 'open', baseText: 'open', display: { type: 'status_tag', map: [{ when: 'open', color: 'green', label: 'Open' }] }, fieldType: 'string' });
    expect(v.text).toBe('Open');
    expect(v.bg).toMatch(/^#/);
    expect(v.html).toContain('Open');
  });

  it('case transforms text', () => {
    const v = formatVisual({ value: undefined, raw: 'hello world', baseText: 'hello world', display: { type: 'case', textCase: 'title' }, fieldType: 'string' });
    expect(v.text).toBe('Hello World');
  });

  it('masked keeps the trailing chars', () => {
    const v = formatVisual({ value: undefined, raw: '123456789', baseText: '123456789', display: { type: 'masked', maskLast: 4 }, fieldType: 'string' });
    expect(v.text.endsWith('6789')).toBe(true);
    expect(v.text).toContain('•');
  });

  it('template wraps the value', () => {
    const v = formatVisual({ value: 42, raw: '42', baseText: '42', display: { type: 'template', template: 'INV-{value}' }, fieldType: 'string' });
    expect(v.text).toBe('INV-42');
  });

  it('date formats with Angular-style tokens', () => {
    const v = formatVisual({ value: undefined, raw: '2024-01-15', baseText: '2024-01-15', display: { type: 'date', datePattern: 'dd-MMM-yyyy' }, fieldType: 'date' });
    expect(v.text).toBe('15-Jan-2024');
  });

  it('background rule applies a bg when its expression is true', () => {
    const on = formatVisual({ value: 2000, raw: 2000, baseText: '2000', display: { type: 'background', rules: [{ when: 'value > 1000', color: 'red' }] }, fieldType: 'number' });
    const off = formatVisual({ value: 10, raw: 10, baseText: '10', display: { type: 'background', rules: [{ when: 'value > 1000', color: 'red' }] }, fieldType: 'number' });
    expect(on.bg).toMatch(/^#/);
    expect(off.bg).toBeUndefined();
  });
});

describe('formatsForType gating by data type', () => {
  it('numeric offers data_bar but not status_tag', () => {
    const f = formatsForType('number');
    expect(f).toContain('data_bar');
    expect(f).not.toContain('status_tag');
  });
  it('string offers status_tag but not data_bar', () => {
    const f = formatsForType('string');
    expect(f).toContain('status_tag');
    expect(f).not.toContain('data_bar');
  });
  it('date offers the date format', () => {
    expect(formatsForType('date')).toContain('date');
  });
});

describe('evalConditionStyle', () => {
  it('matches by measure uniqueName', () => {
    const c = compileConditions([{ formula: '#value > 10', measure: 'sales', format: { color: 'red' } }]);
    expect(evalConditionStyle(c, 20, 'sales', 'sales', false)).toEqual({ color: 'red' });
    expect(evalConditionStyle(c, 5, 'sales', 'sales', false)).toEqual({});
  });
  it('measureKey scopes a condition to one slot', () => {
    const c = compileConditions([{ formula: '#value > 10', measureKey: 'sales#0', format: { color: 'red' } }]);
    expect(evalConditionStyle(c, 20, 'sales', 'sales#0', false)).toEqual({ color: 'red' });
    expect(evalConditionStyle(c, 20, 'sales', 'sales#1', false)).toEqual({});
  });
});

describe('parseRgb', () => {
  it('parses hex / rgb / named, rejects css vars', () => {
    expect(parseRgb('#fff')).toEqual([255, 255, 255]);
    expect(parseRgb('#2563eb')).toEqual([37, 99, 235]);
    expect(parseRgb('rgb(1,2,3)')).toEqual([1, 2, 3]);
    expect(parseRgb('green')).toEqual([22, 163, 74]);
    expect(parseRgb('var(--x)')).toBeNull();
  });
});

describe('formatDateValue', () => {
  it('falls back to the default pattern', () => {
    expect(formatDateValue('2024-03-09')).toBe('09-Mar-2024');
  });
});
