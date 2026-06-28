# Contributing to ProPivot

Thanks for your interest in improving ProPivot! This guide covers local setup,
the test suite, and how releases work.

## Prerequisites

- [Node.js](https://nodejs.org) 18 or newer
- npm 9+ (ships with Node 18)

## Setup

```bash
git clone https://github.com/Proteus-Technologies-Private-Limited/ProPivot.git
cd ProPivot
npm ci
```

## Everyday commands

| Command | What it does |
| --- | --- |
| `npm test` | Run the full unit + golden + a11y + touch suite (Vitest) |
| `npm run test:watch` | Watch mode |
| `npm run typecheck` | `tsc --noEmit` (strict) |
| `npm run build` | Build the library bundles with tsup into `dist/` |
| `npm run check:version` | Assert `package.json` and `ProPivot.version` match |
| `npm run ci` | Everything CI runs: version check → typecheck → tests → build |

Run `npm run ci` before opening a pull request — it mirrors the CI gate.

## Tests

The suite has several layers (see `docs/Golden Tests.md` for detail):

- **Unit** (`test/*.test.ts`) — engine, aggregations, formatting, exports, etc.
- **Golden** (`test/golden/`) — pins both the computed cell matrix and the
  rendered grid DOM so the compatibility contract can't drift silently.
- **Accessibility** (`test/a11y.test.ts`) — ARIA roles and keyboard navigation.
- **Touch** (`test/touch.test.ts`) — the pointer-drag field-list / resize path.

If you change rendering or computation on purpose, update the goldens and review
the diff:

```bash
npm run golden:update
git diff test/golden   # confirm the changes are intentional
```

## Architecture

`docs/Architecture.md` describes the engine → planner → matrix → renderer
pipeline. The core is framework-agnostic; the React/Vue/Angular wrappers live in
`src/wrappers/`.

## Coding style

- TypeScript, strict mode. Keep the public API typed and documented.
- Match the surrounding code's naming and comment density.
- Keep changes focused; add or update tests alongside behavioural changes.

## Releasing (maintainers)

1. Update `CHANGELOG.md` and bump the version in **both** `package.json` and
   `src/facade/ProPivot.ts` (`npm run check:version` enforces they match).
2. Commit, then tag: `git tag vX.Y.Z && git push --tags`.
3. The `release` workflow builds, tests, and publishes to npm with provenance.
   (`NPM_TOKEN` must be configured as a repository secret.)

## Reporting issues

Please file bugs and feature requests at
<https://github.com/Proteus-Technologies-Private-Limited/ProPivot/issues> with a
minimal reproduction (a `report` object and the data shape) where possible.
