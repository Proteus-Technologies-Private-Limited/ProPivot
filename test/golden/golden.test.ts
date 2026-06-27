// Golden oracle suite (docs/Architecture.md). Every corpus report
// is computed through the real engine and diffed against its recorded reference
// output in ./expected/. This is the compatibility contract: any change to engine
// values, formatting, axis structure, or totals that isn't intentional breaks here.
//
//   npm run test:golden            run the suite
//   npm run golden:update          re-record expected/*.json after an intended change
//
// In update mode the suite WRITES the expected files (and creates missing ones) and
// passes; review the resulting diff before committing — that diff *is* the contract
// change. In normal mode a missing expected file is a hard failure, not a silent
// auto-record, so a dropped/renamed corpus entry can't pass unnoticed.

import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { corpus } from './corpus';
import { snapshotReport } from './canonical';

const here = dirname(fileURLToPath(import.meta.url));
const expectedDir = join(here, 'expected');
const UPDATE = process.env.UPDATE_GOLDENS === '1' || process.env.UPDATE_GOLDENS === 'true';

function expectedPath(name: string): string {
  return join(expectedDir, `${name}.json`);
}

beforeAll(() => {
  if (UPDATE && !existsSync(expectedDir)) mkdirSync(expectedDir, { recursive: true });
});

describe('golden oracle (recorded reference outputs)', () => {
  it('corpus entry names are unique', () => {
    const names = corpus.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
  });

  for (const entry of corpus) {
    it(`${entry.name} — ${entry.pins}`, () => {
      const actual = snapshotReport(entry.report);
      const path = expectedPath(entry.name);

      if (UPDATE) {
        writeFileSync(path, JSON.stringify(actual, null, 2) + '\n', 'utf8');
        return;
      }

      if (!existsSync(path)) {
        throw new Error(
          `Missing golden for "${entry.name}" (${path}). ` +
            `Run \`npm run golden:update\` to record it, then review the diff.`,
        );
      }

      const expected = JSON.parse(readFileSync(path, 'utf8'));
      expect(actual).toEqual(expected);
    });
  }

  it('no orphaned golden files (every expected/*.json maps to a corpus entry)', () => {
    if (UPDATE || !existsSync(expectedDir)) return;
    const names = new Set(corpus.map((c) => c.name));
    const orphans = readdirSync(expectedDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace(/\.json$/, ''))
      .filter((n) => !names.has(n));
    expect(orphans).toEqual([]);
  });
});
