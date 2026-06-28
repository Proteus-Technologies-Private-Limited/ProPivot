// @vitest-environment happy-dom
//
// Theming (dark mode), text direction (RTL) and UI-string localization.

import { describe, it, expect } from 'vitest';
import { ProPivot } from '../src/facade/ProPivot';
import type { Report } from '../src/core/types';

const mapping = { region: { type: 'string' }, sales: { type: 'number' } };
const DATA = [{ region: 'West', sales: 10 }, { region: 'East', sales: 20 }];

function baseReport(options: Record<string, unknown> = {}): Report {
  return {
    dataSource: { type: 'json', data: DATA, mapping },
    slice: { rows: [{ uniqueName: 'region' }], measures: [{ uniqueName: 'sales', aggregation: 'sum' }] },
    options,
  } as Report;
}

function mount(report: Report): Promise<{ pivot: ProPivot; root: HTMLElement; container: HTMLElement }> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return new Promise((resolve, reject) => {
    try {
      const pivot = new ProPivot({
        container, report, toolbar: true,
        // The container itself receives the .pp-root class.
        reportcomplete: () => resolve({ pivot, root: container, container }),
      });
    } catch (e) { reject(e as Error); }
  });
}

describe('theme & direction', () => {
  it('applies the dark theme class when options.theme = "dark"', async () => {
    const { root, pivot } = await mount(baseReport({ theme: 'dark' }));
    expect(root.classList.contains('pp-theme-dark')).toBe(true);
    pivot.dispose();
  });

  it('stays light by default', async () => {
    const { root, pivot } = await mount(baseReport());
    expect(root.classList.contains('pp-theme-dark')).toBe(false);
    expect(root.getAttribute('dir')).toBe('ltr');
    pivot.dispose();
  });

  it('sets dir="rtl" when options.rtl is true', async () => {
    const { root, pivot } = await mount(baseReport({ rtl: true }));
    expect(root.getAttribute('dir')).toBe('rtl');
    pivot.dispose();
  });
});

describe('UI-string localization', () => {
  it('localizes toolbar labels via localization.grid', async () => {
    const report = baseReport({
      localization: { grid: { fields: 'Champs', excel: 'Classeur' } },
    });
    const { container, pivot } = await mount(report);
    const labels = Array.from(container.querySelectorAll('.pp-toolbar .pp-tb-btn')).map((b) => b.textContent);
    expect(labels).toContain('Champs');
    expect(labels).toContain('Classeur');
    expect(labels).not.toContain('Fields');
    pivot.dispose();
  });
});
