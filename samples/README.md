# ProPivot starter samples

Downloadable, ready-to-run starter projects that embed ProPivot. They are served
from the docs site at **[/starters.html](https://proteus-technologies-private-limited.github.io/ProPivot/starters.html)**.

| Sample | Stack | Folder |
| ------ | ----- | ------ |
| React starter | Vite · React 18 · TypeScript | [`react-starter/`](./react-starter) |
| Angular starter | Angular 18 standalone · TypeScript | [`angular-starter/`](./angular-starter) |
| Vue starter | Vite · Vue 3 · TypeScript | [`vue-starter/`](./vue-starter) |
| Vanilla JS starter | Plain HTML + JavaScript · no build step | [`vanilla-js-starter/`](./vanilla-js-starter) |

The React, Angular, and Vue starters consume ProPivot through the package name
`@proteus/propivot` (idiomatic `import { Pivot } from '@proteus/propivot/react'`,
`/vue`, etc.). The vanilla starter instead loads the global `<script>` build and
reads `window.ProPivot` — no bundler at all. Because the package is not published
to a public registry, each starter wires it up against a pre-built copy of the
library under `<sample>/vendor/propivot` (a local `file:` dependency for the
framework starters, a relative `<script>`/`<link>` path for the vanilla one).
That folder is generated — see below.

## Regenerating the downloadable zips

The pre-built library copies (`vendor/propivot`) and the shipped archives
(`docs/downloads/*.zip`) are produced by one script:

```bash
bash samples/build-zips.sh
```

It (1) runs `npm run build` to refresh `dist/`, (2) copies the runtime files into
each sample's `vendor/propivot`, and (3) zips each sample (excluding
`node_modules`, build output, and the editor `.angular` cache) into
`docs/downloads/`.

Run this whenever the library's `dist/` changes so the downloads stay current.
The archives are byte-reproducible (fixed timestamps + sorted entries), so they
only change when their contents actually do.

> The `vendor/` folders and per-sample `node_modules`/`dist` are git-ignored —
> they are build products. The committed deliverables are the sample **source**
> and the regenerated `docs/downloads/*.zip` archives.

## Keeping the downloads fresh automatically

You normally don't have to remember to run the script — two safety nets keep
`docs/downloads` in sync:

- **CI** — [`.github/workflows/refresh-starters.yml`](../.github/workflows/refresh-starters.yml)
  rebuilds the zips on any push to `main` that touches `src/**`, the sample
  sources, `build-zips.sh`, `package.json`, or `tsup.config.ts`, and commits them
  back if their contents changed. (It ignores `docs/**`, so its own commit never
  loops.) This is the authority for what the site serves.

- **Pre-commit hook (opt-in)** — [`.githooks/pre-commit`](../.githooks/pre-commit)
  regenerates and stages the zips locally when you commit changes to the library
  or sample source. Enable it once per clone:

  ```bash
  git config core.hooksPath .githooks
  ```

  (The hook runs `npm run build`, so install the root dev dependencies first.)
