# ProPivot — Angular starter

A minimal [Angular](https://angular.dev) (standalone, v18) app that embeds the
**ProPivot** pivot table over a generated dataset, entirely in the browser.

## Run it

You need [Node.js](https://nodejs.org) 18.19 or newer.

```bash
npm install
npm start
```

Then open <http://localhost:4200>.

To make a production build:

```bash
npm run build
```

## What's inside

```
src/
  main.ts                     bootstraps the standalone AppComponent
  styles.css                  global styles
  app/
    app.component.ts          uses <pro-pivot [report]="report" [toolbar]="true">
    pro-pivot.component.ts     the reusable Angular wrapper around ProPivot
    sample-data.ts            generates the rows and builds the `report` object
angular.json                  also loads @proteus/propivot/dist/propivot.css
vendor/propivot/              the pre-built ProPivot library (see "About the dependency")
```

`pro-pivot.component.ts` is a thin, standalone wrapper you can copy straight into
your own project. Use it like any component:

```html
<pro-pivot [report]="report" [toolbar]="true" (cellclick)="onCellClick($event)"></pro-pivot>
```

A **report** is a plain object describing the slice (rows / columns / measures),
number formats, and conditional formatting — see `app/sample-data.ts`. Edit it,
or replace `data`/`mapping` with your own rows, and the grid updates.

The pivot grid stylesheet is loaded via the `styles` array in `angular.json`:

```json
"styles": [
  "src/styles.css",
  "node_modules/@proteus/propivot/dist/propivot.css"
]
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
