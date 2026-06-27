import { describe, it, expect } from 'vitest';
import { buildStore } from '../src/core/store';
import { normalizeReport } from '../src/core/normalize';
import { buildMatrix } from '../src/core/planner';
import { exportMatrix } from '../src/export';
import { buildXlsx } from '../src/export/xlsx';
import { buildPdf } from '../src/export/pdf';
import { buildSvg } from '../src/export/svg';
import type { Report } from '../src/core/types';

const data = [
  { region: 'West', year: 2023, sales: 100 },
  { region: 'West', year: 2024, sales: 150 },
  { region: 'East', year: 2023, sales: 50 },
];
const report: Report = {
  dataSource: { type: 'json', data },
  slice: { rows: [{ uniqueName: 'region' }], columns: [{ uniqueName: 'year' }], measures: [{ uniqueName: 'sales', aggregation: 'sum' }] },
};
const normal = normalizeReport(report);
const matrix = buildMatrix(buildStore(data as never), normal);

describe('xlsx writer', () => {
  it('produces a real ZIP (PK local-file-header signature)', () => {
    const bytes = buildXlsx('Report', ['A', 'B'], [[{ text: 'x' }, { text: '', num: 5 }]]);
    expect(bytes[0]).toBe(0x50); // 'P'
    expect(bytes[1]).toBe(0x4b); // 'K'
    expect(bytes[2]).toBe(0x03);
    expect(bytes[3]).toBe(0x04);
    // Contains the worksheet part name somewhere in the archive.
    const ascii = Buffer.from(bytes).toString('latin1');
    expect(ascii).toContain('xl/worksheets/sheet1.xml');
    expect(ascii).toContain('[Content_Types].xml');
  });
});

describe('pdf writer', () => {
  it('produces a valid PDF header and EOF', () => {
    const bytes = buildPdf(['Region', 'Sales'], [['West', '250'], ['East', '50']], { title: 'Report' });
    const text = Buffer.from(bytes).toString('latin1');
    expect(text.startsWith('%PDF-1.')).toBe(true);
    expect(text).toContain('/Type /Catalog');
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
  });
});

describe('svg writer', () => {
  it('produces a well-formed SVG with header and cell text', () => {
    const svg = buildSvg(['Region', '2023', '2024'], [
      [{ text: 'West' }, { text: '100', num: 100 }, { text: '150', num: 150 }],
      [{ text: 'East' }, { text: '50', num: 50 }, { text: '', }],
    ], { title: 'Report' });
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true);
    expect(svg).toContain('>Region<');
    expect(svg).toContain('>West<');
    expect(svg).toContain('>150<');
    expect(svg).toContain('>Report<'); // title
    // numeric cells are right-aligned, text cells left-aligned
    expect(svg).toContain('text-anchor="end"');
    expect(svg).toContain('text-anchor="start"');
  });

  it('is deterministic (same input -> identical bytes)', () => {
    const args: Parameters<typeof buildSvg> = [['A', 'B'], [[{ text: 'x' }, { text: '1', num: 1 }]], {}];
    expect(buildSvg(...args)).toBe(buildSvg(...args));
  });

  it('escapes XML metacharacters in cell text', () => {
    const svg = buildSvg(['A & <B>'], [[{ text: '"q"' }]]);
    expect(svg).toContain('A &amp; &lt;B&gt;');
    expect(svg).toContain('&quot;q&quot;');
    expect(svg).not.toContain('<B>');
  });
});

describe('exportMatrix', () => {
  it('csv returns header + rows', () => {
    const csv = exportMatrix('csv', matrix, normal) as string;
    expect(csv.split('\n')[0]).toContain('region');
    expect(csv).toContain('West');
  });

  it('image returns an SVG of the grid', () => {
    const svg = exportMatrix('image', matrix, normal) as string;
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('region');
    expect(svg).toContain('West');
    expect(svg).toContain('</svg>');
  });

  it('excel returns real xlsx bytes', () => {
    const bytes = exportMatrix('excel', matrix, normal) as Uint8Array;
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
  });

  it('pdf returns %PDF bytes', () => {
    const bytes = exportMatrix('pdf', matrix, normal) as Uint8Array;
    expect(Buffer.from(bytes).toString('latin1').startsWith('%PDF-1.')).toBe(true);
  });

  it('html returns a table', () => {
    const html = exportMatrix('html', matrix, normal) as string;
    expect(html).toContain('<table');
    expect(html).toContain('<th>');
  });
});

describe('export carries HTML-preview styling (PDF/SVG parity)', () => {
  const styled: Report = {
    dataSource: { type: 'json', data },
    slice: {
      rows: [{ uniqueName: 'region' }],
      columns: [{ uniqueName: 'year' }],
      measures: [{ uniqueName: 'sales', aggregation: 'sum', display: { type: 'data_bar', min: 0, max: 200, color: 'blue' } }],
    },
    conditions: [{ formula: '#value > 120', measure: 'sales', format: { backgroundColor: '#c5e1a5' } }],
  };
  const sNormal = normalizeReport(styled);
  const sMatrix = buildMatrix(buildStore(data as never), sNormal);

  it('PDF embeds fill rectangles for backgrounds / data bars', () => {
    const bytes = exportMatrix('pdf', sMatrix, sNormal) as Uint8Array;
    const text = Buffer.from(bytes).toString('latin1');
    expect(text).toContain(' rg'); // a fill color was set
    expect(text).toContain(' re'); // a rectangle was drawn (background/bar)
  });

  it('SVG embeds <rect fill> cell backgrounds / bars', () => {
    const svg = exportMatrix('image', sMatrix, sNormal) as string;
    expect(svg).toMatch(/<rect[^>]*fill="#/);
  });

  it('plain reports do not emit cell fills (no churn)', () => {
    const bytes = exportMatrix('pdf', matrix, normal) as Uint8Array;
    const text = Buffer.from(bytes).toString('latin1');
    // No cell-fill rectangle operators in an unstyled export.
    expect(text).not.toContain(' re f');
  });
});
