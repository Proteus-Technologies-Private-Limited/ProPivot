# ProPivot — Vue starter

A minimal [Vite](https://vitejs.dev) + [Vue 3](https://vuejs.org) + TypeScript app
that embeds the **ProPivot** pivot table over a generated dataset, entirely in the
browser.

## Run it

You need [Node.js](https://nodejs.org) 18 or newer.

```bash
npm install
npm run dev
```

Then open the URL Vite prints (usually <http://localhost:5173>).

To make a production build:

```bash
npm run build
npm run preview
```

## What's inside

```
src/
  main.ts         app entry
  App.vue         renders <Pivot :report="report" toolbar /> + a small toolbar
  sampleData.ts   generates the rows and builds the ProPivot `report` object
  index.css       page layout
vendor/propivot/  the pre-built ProPivot library (see "About the dependency")
```

The key piece is in `src/App.vue`:

```vue
<script setup lang="ts">
import '@proteus/propivot/propivot.css';
import { Pivot, type ProPivot } from '@proteus/propivot/vue';

function onReady(p: ProPivot) { /* … */ }
</script>

<template>
  <Pivot :report="report" toolbar @ready="onReady" />
</template>
```

The `<Pivot>` wrapper creates and disposes the engine for you, forwards every
facade event as a Vue emit (`@cellclick`, `@columnresize`, `@ready`, …), and swaps
the report in place when the bound `report` changes.

A **report** is a plain object describing the slice (rows / columns / measures),
number formats, and conditional formatting — see `src/sampleData.ts`. Edit it,
or replace `data`/`mapping` with your own rows, and the grid updates.

## Use your own data

Replace the generated rows in `sampleData.ts` with your array of objects and
update `mapping` to describe each field, then adjust `report.slice`:

```ts
slice: {
  rows: [{ uniqueName: 'region' }, { uniqueName: 'category' }],
  columns: [{ uniqueName: 'year' }],
  measures: [{ uniqueName: 'sales', aggregation: 'sum', format: 'cur' }],
}
```

## About the dependency

ProPivot is referenced as a local `file:` dependency pointing at the pre-built
library bundled under `vendor/propivot`, so this starter runs offline with no
extra setup. In a project of your own you would instead install it from your
registry:

```bash
npm install @proteus/propivot
```

…and the imports stay exactly the same. MIT licensed —
<https://github.com/Proteus-Technologies-Private-Limited/ProPivot>.
