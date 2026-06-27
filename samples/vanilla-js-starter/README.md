# ProPivot — Vanilla JavaScript starter

A **zero-build** starter: plain HTML + JavaScript, no framework and no bundler.
It loads the browser global build of **ProPivot**, reads `window.ProPivot`, and
mounts an interactive pivot table over a generated dataset — entirely in the
browser.

This is the pattern to use with server-rendered pages, Web Components, jQuery, an
Android/iOS WebView, or any stack where you just want a `<script>` tag.

## Run it

There's nothing to install. Because browsers restrict some features over the
`file://` protocol, serve the folder over HTTP with any static server:

```bash
# Node (no install): start a static server in this folder
npx --yes serve .

# …or with Python 3
python3 -m http.server 8080
```

Then open the URL it prints (e.g. <http://localhost:3000> or
<http://localhost:8080>). Opening `index.html` directly often works too.

## What's inside

```
index.html        loads propivot.global.js + propivot.css, has #pivot + a toolbar
main.js           reads window.ProPivot and mounts the grid into #pivot
sampleData.js     generates the rows and builds the ProPivot `report` object
styles.css        page layout
vendor/propivot/  the pre-built ProPivot library (see "About the dependency")
```

The key piece is in `index.html` + `main.js`:

```html
<link rel="stylesheet" href="./vendor/propivot/dist/propivot.css" />
<script src="./vendor/propivot/dist/propivot.global.js"></script>
<div id="pivot" style="height:480px"></div>
```

```js
var pivot = new window.ProPivot({
  container: '#pivot',
  toolbar: true,
  report: report, // see sampleData.js
});
```

A **report** is a plain object describing the slice (rows / columns / measures),
number formats, and conditional formatting — see `sampleData.js`. Edit it, or
replace the rows/mapping with your own data, and the grid updates.

## Use your own data

Replace the generated rows in `sampleData.js` with your array of objects and
update `mapping` to describe each field, then adjust `report.slice`:

```js
slice: {
  rows: [{ uniqueName: 'region' }, { uniqueName: 'category' }],
  columns: [{ uniqueName: 'year' }],
  measures: [{ uniqueName: 'sales', aggregation: 'sum', format: 'cur' }],
}
```

## About the dependency

This starter references the pre-built library bundled under `vendor/propivot`, so
it runs offline with no setup. You can also load the same global build from your
own server or a CDN — just point the two `vendor/propivot/dist/...` paths at
`propivot.global.js` and `propivot.css`. MIT licensed —
<https://github.com/Proteus-Technologies-Private-Limited/ProPivot>.
