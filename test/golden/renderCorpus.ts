// Render-layer golden corpus (docs/Golden Tests.md). Each entry pins a RENDER concern
// the engine matrix can't capture: layout mode, grand-total position, conditional-format
// styling, localization labels, customizeCell. Snapshots are recorded in
// test/golden/expected-render/. A TS module (not JSON) because customizeCell is a fn.

import type { Report } from '../../src/core/types';
import type { CellData } from '../../src/facade/cell';

const sales = [
  { region: 'West', category: 'Furniture', year: 2023, sales: 1200 },
  { region: 'West', category: 'Tech', year: 2024, sales: 9000 },
  { region: 'East', category: 'Furniture', year: 2023, sales: 600 },
  { region: 'East', category: 'Tech', year: 2024, sales: 2600 },
];

// A blank region value to exercise the localized blank-member label.
const withBlank = [
  { region: 'West', year: 2023, sales: 1200 },
  { region: '', year: 2023, sales: 400 },
];

export interface RenderCorpusEntry {
  name: string;
  pins: string;
  report: Report;
  customizeCell?: (cell: unknown, data: CellData) => void;
}

export const renderCorpus: RenderCorpusEntry[] = [
  {
    name: 'compact-nested-conditions',
    pins: 'compact layout indents nested rows; conditional format styles matching value cells',
    report: {
      dataSource: { type: 'json', data: sales },
      slice: {
        rows: [{ uniqueName: 'region' }, { uniqueName: 'category' }],
        columns: [{ uniqueName: 'year' }],
        measures: [{ uniqueName: 'sales', aggregation: 'sum' }],
      },
      conditions: [
        { formula: '#value > 5000', measure: 'sales', format: { backgroundColor: '#c5e1a5' } },
      ],
    },
  },
  {
    name: 'flat-multi-row',
    pins: 'flat layout gives each row field its own header column (no indentation)',
    report: {
      dataSource: { type: 'json', data: sales },
      slice: {
        rows: [{ uniqueName: 'region' }, { uniqueName: 'category' }],
        columns: [{ uniqueName: 'year' }],
        measures: [{ uniqueName: 'sales', aggregation: 'sum' }],
      },
      options: { grid: { type: 'flat' } },
    },
  },
  {
    name: 'classic-multi-row',
    pins: 'classic layout: a column per row field with subtotal rows',
    report: {
      dataSource: { type: 'json', data: sales },
      slice: {
        rows: [{ uniqueName: 'region' }, { uniqueName: 'category' }],
        columns: [{ uniqueName: 'year' }],
        measures: [{ uniqueName: 'sales', aggregation: 'sum' }],
      },
      options: { grid: { type: 'classic' } },
    },
  },
  {
    name: 'grand-total-top',
    pins: 'grand-total row rendered at the top instead of the bottom',
    report: {
      dataSource: { type: 'json', data: sales },
      slice: {
        rows: [{ uniqueName: 'region' }],
        columns: [{ uniqueName: 'year' }],
        measures: [{ uniqueName: 'sales', aggregation: 'sum' }],
      },
      options: { grid: { type: 'compact', grandTotalsPosition: 'top' } },
    },
  },
  {
    name: 'localized-blank-member',
    pins: 'localized grand-total caption and blank-member label render in the grid',
    report: {
      dataSource: { type: 'json', data: withBlank },
      slice: {
        rows: [{ uniqueName: 'region' }],
        columns: [{ uniqueName: 'year' }],
        measures: [{ uniqueName: 'sales', aggregation: 'sum' }],
      },
      localization: { grid: { grandTotalCaption: 'All Regions', blankMember: '— none —' } },
    },
  },
  {
    name: 'display-formats',
    pins: 'measure data_bar + dimension status_tag display formats render rich markup',
    report: {
      dataSource: {
        type: 'json', data: sales,
        mapping: { region: { type: 'string' }, year: { type: 'number' }, sales: { type: 'number' } },
      },
      slice: {
        rows: [{ uniqueName: 'region', display: { type: 'status_tag', map: [{ when: 'West', color: 'green', label: 'W' }, { when: 'East', color: 'blue', label: 'E' }] } }],
        columns: [{ uniqueName: 'year' }],
        measures: [{ uniqueName: 'sales', aggregation: 'sum', display: { type: 'data_bar', min: 0, max: 12000, color: 'blue' } }],
      },
    },
  },
  {
    name: 'per-slot-condition',
    pins: 'measureKey scopes a conditional format to one measure slot (sum, not average)',
    report: {
      dataSource: { type: 'json', data: sales },
      slice: {
        rows: [{ uniqueName: 'region' }],
        columns: [{ uniqueName: 'year' }],
        measures: [
          { uniqueName: 'sales', aggregation: 'sum' },
          { uniqueName: 'sales', aggregation: 'average' },
        ],
      },
      conditions: [
        { formula: '#value > 5000', measureKey: 'sales#0', format: { color: '#b71c1c' } },
      ],
    },
  },
  {
    name: 'customize-cell',
    pins: 'customizeCell can add a class and inline style to value cells',
    report: {
      dataSource: { type: 'json', data: sales },
      slice: {
        rows: [{ uniqueName: 'region' }],
        columns: [{ uniqueName: 'year' }],
        measures: [{ uniqueName: 'sales', aggregation: 'sum' }],
      },
    },
    customizeCell: (cell, data) => {
      // Flag the grand-total column for downstream styling — a common consumer pattern.
      if (data.type === 'value' && data.isGrandTotalColumn) {
        const cb = cell as { addClass(c: string): void; style: Record<string, string> };
        cb.addClass('consumer-grand');
        cb.style.fontWeight = 'bold';
      }
    },
  },
];
