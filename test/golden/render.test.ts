// @vitest-environment happy-dom
//
// Render-layer golden suite (docs/Golden Tests.md). Each corpus report is rendered
// through the real ProPivot facade in a headless DOM and its normalized `.pp-table`
// is diffed against a recorded reference in ./expected-render/. This pins the RENDER
// contract — layout modes, grand-total position, conditional-format styling,
// localization labels, customizeCell — that the engine-matrix goldens can't.
//
//   npm run test:golden       runs this alongside the engine goldens
//   npm run golden:update     re-records expected-render/*.json after an intended change

import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderCorpus } from './renderCorpus';
import { renderSnapshot } from './renderHtml';

const here = dirname(fileURLToPath(import.meta.url));
const expectedDir = join(here, 'expected-render');
const UPDATE = process.env.UPDATE_GOLDENS === '1' || process.env.UPDATE_GOLDENS === 'true';

const expectedPath = (name: string) => join(expectedDir, `${name}.json`);

beforeAll(() => {
  if (UPDATE && !existsSync(expectedDir)) mkdirSync(expectedDir, { recursive: true });
});

describe('render-layer golden (recorded grid HTML)', () => {
  it('corpus entry names are unique', () => {
    const names = renderCorpus.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  for (const entry of renderCorpus) {
    it(`${entry.name} — ${entry.pins}`, async () => {
      const snap = await renderSnapshot(entry.report, { customizeCell: entry.customizeCell });
      const actual = JSON.parse(JSON.stringify(snap));
      const path = expectedPath(entry.name);

      if (UPDATE) {
        writeFileSync(path, JSON.stringify(actual, null, 2) + '\n', 'utf8');
        return;
      }

      if (!existsSync(path)) {
        throw new Error(
          `Missing render golden for "${entry.name}" (${path}). ` +
            `Run \`npm run golden:update\` to record it, then review the diff.`,
        );
      }

      const expected = JSON.parse(readFileSync(path, 'utf8'));
      expect(actual).toEqual(expected);
    });
  }

  it('no orphaned render-golden files', () => {
    if (UPDATE || !existsSync(expectedDir)) return;
    const names = new Set(renderCorpus.map((c) => c.name));
    const orphans = readdirSync(expectedDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''))
      .filter((n) => !names.has(n));
    expect(orphans).toEqual([]);
  });
});
