// Shared feature-gallery engine. The host page provides the DOM skeleton
// (#nav, #title, #desc, #tryhint, #demo, #code, #copy, #codepen, #jsfiddle,
// #cdnjs, #cdncss), loads the ProPivot global bundle (window.ProPivot), sets
// window.GALLERY_CFG = { cdnJs, cdnCss }, then loads this script.
(function () {
  'use strict';
  var cfg = window.GALLERY_CFG || {};
  var CDN_JS = cfg.cdnJs || '';
  var CDN_CSS = cfg.cdnCss || '';
  var cj = document.getElementById('cdnjs'); if (cj) cj.textContent = CDN_JS;
  var cc = document.getElementById('cdncss'); if (cc) cc.textContent = CDN_CSS;

  // ── Shared sample dataset (inlined into every runnable snippet) ─────────────
  var DATA_ROWS = [
    { region: 'West',  category: 'Furniture', product: 'Desk',   date: '2023-02-11', sales: 1200, qty: 6,  cost: 820,  status: 'shipped',  rating: 4 },
    { region: 'West',  category: 'Tech',      product: 'Laptop', date: '2023-08-04', sales: 9000, qty: 12, cost: 6400, status: 'returned', rating: 2 },
    { region: 'West',  category: 'Tech',      product: 'Phone',  date: '2024-03-22', sales: 5200, qty: 20, cost: 3100, status: 'shipped',  rating: 5 },
    { region: 'East',  category: 'Furniture', product: 'Chair',  date: '2023-05-19', sales: 600,  qty: 3,  cost: 410,  status: 'pending',  rating: 3 },
    { region: 'East',  category: 'Tech',      product: 'Laptop', date: '2024-01-09', sales: 2600, qty: 7,  cost: 1900, status: 'shipped',  rating: 4 },
    { region: 'East',  category: 'Furniture', product: 'Desk',   date: '2024-11-02', sales: 1500, qty: 8,  cost: 1000, status: 'shipped',  rating: 4 },
    { region: 'North', category: 'Tech',      product: 'Phone',  date: '2023-07-15', sales: 4200, qty: 18, cost: 2500, status: 'returned', rating: 1 },
    { region: 'North', category: 'Furniture', product: 'Chair',  date: '2024-04-27', sales: 1800, qty: 9,  cost: 1200, status: 'pending',  rating: 3 },
    { region: 'North', category: 'Tech',      product: 'Laptop', date: '2024-09-30', sales: 7300, qty: 11, cost: 5200, status: 'shipped',  rating: 5 },
    { region: 'South', category: 'Furniture', product: 'Desk',   date: '2023-12-12', sales: 2100, qty: 10, cost: 1400, status: 'shipped',  rating: 4 },
    { region: 'South', category: 'Tech',      product: 'Phone',  date: '2024-06-08', sales: 3400, qty: 15, cost: 2000, status: 'pending',  rating: 3 },
    { region: 'South', category: 'Tech',      product: 'Laptop', date: '2023-10-21', sales: 6100, qty: 9,  cost: 4300, status: 'returned', rating: 2 },
  ];
  var PREAMBLE =
    'const PP = window.ProPivot;\n' +
    "const log = (m) => { const el = document.getElementById('log'); if (el) el.textContent = m + '\\n' + el.textContent; };\n";
  var DATA = 'const data = ' + JSON.stringify(DATA_ROWS, null, 2) + ';\n\n';

  // ── Feature catalog ─────────────────────────────────────────────────────────
  var F = [
    // ===== New in v0.3 =====
    { group: 'New in v0.3', id: 'binning', title: 'Numeric binning', desc:
      '<p>Group a numeric dimension into ranges with <code>binning</code> on the field — a fixed <code>interval</code> or custom <code>breaks</code>. Buckets sort numerically and drill-through still resolves the underlying rows.</p>',
      hint: 'Double-click a bucket cell to drill through to its source rows.',
      body:
"const pivot = new PP({\n  container: '#pivot',\n  report: {\n    dataSource: { type: 'json', data },\n    slice: {\n      rows: [{ uniqueName: 'sales', binning: { interval: 2000 } }], // 0–2000, 2000–4000, …\n      columns: [{ uniqueName: 'category' }],\n      measures: [{ uniqueName: 'qty', aggregation: 'sum', caption: 'Units' }],\n    },\n  },\n});\nlog('Sales bucketed into $2,000 ranges. Try { breaks: [0, 2000, 6000] } for custom edges.');" },

    { group: 'New in v0.3', id: 'label-value-filters', title: 'Label & value filters', desc:
      '<p>Filter members by text (<code>contains</code>, <code>beginsWith</code>…) or by a measure threshold (<code>&gt; &lt; ≥ ≤ = ≠ between</code>) — declaratively or via <code>setLabelFilter()</code> / <code>setValueFilter()</code>. The picker also has a member search box.</p>',
      hint: 'Open the ▾ on the Region header → Filter tab to try the search box, label, and value filters.',
      body:
"const pivot = new PP({\n  container: '#pivot',\n  report: {\n    dataSource: { type: 'json', data },\n    slice: {\n      // Keep only regions whose total Sales exceed 10,000.\n      rows: [{ uniqueName: 'region', filter: { type: 'value', measure: 'sales', operator: 'greaterThan', value: 10000 } }],\n      columns: [{ uniqueName: 'category' }],\n      measures: [{ uniqueName: 'sales', aggregation: 'sum' }],\n    },\n  },\n});\n// Apply more at runtime:\n// pivot.setLabelFilter('region', 'contains', 'o');\n// pivot.setValueFilter('region', 'sales', 'between', 5000, 14000);\nlog('Value filter: Sales > 10,000. Open Region ▾ → Filter for label / value / search.');" },

    { group: 'New in v0.3', id: 'range-copy', title: 'Range selection & copy', desc:
      '<p>Select a rectangle of cells and copy it as TSV — pasteable into Excel or Sheets. Off-screen (virtualized) rows are included, and a <code>copy</code> event fires with <code>{ rows, columns, text }</code>.</p>',
      hint: 'Click a value cell, then Shift+click another (or Shift+arrow keys), and press Ctrl/Cmd+C.',
      body:
"const pivot = new PP({\n  container: '#pivot',\n  report: {\n    dataSource: { type: 'json', data },\n    slice: {\n      rows: [{ uniqueName: 'region' }, { uniqueName: 'product' }],\n      columns: [{ uniqueName: 'category' }],\n      measures: [{ uniqueName: 'sales', aggregation: 'sum' }, { uniqueName: 'qty', aggregation: 'sum', caption: 'Qty' }],\n    },\n  },\n});\npivot.on('copy', (e) => log('Copied ' + e.rows + '×' + e.columns + ' cells:\\n' + e.text));\nlog('Shift-select a range, then Ctrl/Cmd+C. Tab in and use arrow keys too.');" },

    { group: 'New in v0.3', id: 'dark-mode', title: 'Dark mode', desc:
      '<p>Built-in dark theme via <code>options.theme</code> (<code>\'dark\'</code>, or <code>\'auto\'</code> to follow the OS). The grid, toolbar, field list, popups and modals all theme together.</p>',
      body:
"const pivot = new PP({\n  container: '#pivot',\n  toolbar: true,\n  report: {\n    dataSource: { type: 'json', data },\n    slice: {\n      rows: [{ uniqueName: 'region' }],\n      columns: [{ uniqueName: 'category' }],\n      measures: [{ uniqueName: 'sales', aggregation: 'sum' }],\n    },\n    options: { theme: 'dark' }, // 'light' | 'dark' | 'auto'\n  },\n});" },

    { group: 'New in v0.3', id: 'rtl', title: 'Right-to-left (RTL)', desc:
      '<p><code>options.rtl: true</code> mirrors the whole grid for right-to-left locales — sticky row headers, indentation and the resize grip flip, while numbers stay left-to-right.</p>',
      body:
"const pivot = new PP({\n  container: '#pivot',\n  toolbar: true,\n  report: {\n    dataSource: { type: 'json', data },\n    slice: {\n      rows: [{ uniqueName: 'region' }, { uniqueName: 'category' }],\n      columns: [{ uniqueName: 'product' }],\n      measures: [{ uniqueName: 'sales', aggregation: 'sum' }],\n    },\n    options: { rtl: true },\n  },\n});" },

    { group: 'New in v0.3', id: 'localization', title: 'Localization (i18n)', desc:
      '<p>Every toolbar / filter / drill-through string is overridable via <code>localization.grid</code>. Here the chrome is in French.</p>',
      body:
"const pivot = new PP({\n  container: '#pivot',\n  toolbar: true,\n  report: {\n    dataSource: { type: 'json', data },\n    slice: {\n      rows: [{ uniqueName: 'region' }],\n      columns: [{ uniqueName: 'category' }],\n      measures: [{ uniqueName: 'sales', aggregation: 'sum' }],\n    },\n    options: { localization: { grid: {\n      fields: 'Champs', fullscreen: 'Plein écran', apply: 'Appliquer', all: 'Tout', none: 'Aucun',\n      searchMembers: 'Rechercher…', labelFilter: 'Filtre texte', valueFilter: 'Filtre valeur',\n      clearFilters: 'Effacer', drillThrough: 'Détail', grandTotalCaption: 'Total général', totals: 'Total',\n    } } },\n  },\n});" },

    // ===== Basics =====
    { group: 'Basics', id: 'basic', title: 'Basic pivot', desc:
      '<p>The minimum: a <code>dataSource</code> plus a <code>slice</code> of <b>rows</b>, <b>columns</b> and <b>measures</b>. ProPivot aggregates entirely in the browser.</p>',
      body:
"const pivot = new PP({\n  container: '#pivot',\n  report: {\n    dataSource: { type: 'json', data },\n    slice: {\n      rows: [{ uniqueName: 'region' }],\n      columns: [{ uniqueName: 'category' }],\n      measures: [{ uniqueName: 'sales', aggregation: 'sum' }],\n    },\n  },\n});" },

    { group: 'Basics', id: 'multi-measure', title: 'Multiple measures', desc:
      '<p>Add several measures — even the same field aggregated different ways. Each gets its own column.</p>',
      body:
"const pivot = new PP({\n  container: '#pivot',\n  report: {\n    dataSource: { type: 'json', data },\n    slice: {\n      rows: [{ uniqueName: 'region' }],\n      columns: [{ uniqueName: 'category' }],\n      measures: [\n        { uniqueName: 'sales', aggregation: 'sum',   caption: 'Total Sales' },\n        { uniqueName: 'sales', aggregation: 'average', caption: 'Avg Sale' },\n        { uniqueName: 'qty',   aggregation: 'sum',   caption: 'Units' },\n      ],\n    },\n  },\n});" },

    { group: 'Basics', id: 'number-formats', title: 'Number formats', desc:
      '<p>Define named <code>formats</code> (currency, percent, decimals, separators) and reference them from a measure via <code>format</code>.</p>',
      body:
"const pivot = new PP({\n  container: '#pivot',\n  report: {\n    dataSource: { type: 'json', data },\n    slice: {\n      rows: [{ uniqueName: 'region' }],\n      columns: [{ uniqueName: 'category' }],\n      measures: [\n        { uniqueName: 'sales', aggregation: 'sum', format: 'cur' },\n        { uniqueName: 'qty',   aggregation: 'sum', format: 'int' },\n      ],\n    },\n    formats: [\n      { name: 'cur', currencySymbol: '$', decimalPlaces: 0, thousandsSeparator: ',' },\n      { name: 'int', decimalPlaces: 0, thousandsSeparator: ',' },\n    ],\n  },\n});" },

    // ===== Layout =====
    { group: 'Layout', id: 'compact', title: 'Compact layout (nesting)', desc:
      '<p>The default. Multiple row fields nest into one indented column with expand/collapse and subtotals.</p>',
      hint: 'Click the ▾/▸ toggles on the row headers to expand and collapse.',
      body:
"const pivot = new PP({\n  container: '#pivot',\n  report: {\n    dataSource: { type: 'json', data },\n    slice: {\n      rows: [{ uniqueName: 'region' }, { uniqueName: 'category' }],\n      columns: [{ uniqueName: 'product' }],\n      measures: [{ uniqueName: 'sales', aggregation: 'sum' }],\n    },\n    options: { grid: { type: 'compact' } },\n  },\n});" },

    { group: 'Layout', id: 'flat', title: 'Flat layout', desc:
      '<p>Each row field gets its own column, with no indentation — a denser, spreadsheet-like grid.</p>',
      body:
"const pivot = new PP({\n  container: '#pivot',\n  report: {\n    dataSource: { type: 'json', data },\n    slice: {\n      rows: [{ uniqueName: 'region' }, { uniqueName: 'category' }],\n      columns: [{ uniqueName: 'product' }],\n      measures: [{ uniqueName: 'sales', aggregation: 'sum' }],\n    },\n    options: { grid: { type: 'flat' } },\n  },\n});" },

    { group: 'Layout', id: 'classic', title: 'Classic layout (subtotals)', desc:
      '<p>A column per row field with classic subtotal rows between groups.</p>',
      body:
"const pivot = new PP({\n  container: '#pivot',\n  report: {\n    dataSource: { type: 'json', data },\n    slice: {\n      rows: [{ uniqueName: 'region' }, { uniqueName: 'category' }],\n      columns: [{ uniqueName: 'product' }],\n      measures: [{ uniqueName: 'sales', aggregation: 'sum' }],\n    },\n    options: { grid: { type: 'classic' } },\n  },\n});" },

    { group: 'Layout', id: 'totals', title: 'Totals & grand totals', desc:
      '<p>Control totals with <code>showTotals</code>/<code>showGrandTotals</code> (<code>on</code>/<code>off</code>/<code>rows</code>/<code>columns</code>) and place the grand total with <code>grandTotalsPosition</code>.</p>',
      body:
"const pivot = new PP({\n  container: '#pivot',\n  report: {\n    dataSource: { type: 'json', data },\n    slice: {\n      rows: [{ uniqueName: 'region' }, { uniqueName: 'category' }],\n      columns: [{ uniqueName: 'product' }],\n      measures: [{ uniqueName: 'sales', aggregation: 'sum' }],\n    },\n    options: { grid: { grandTotalsPosition: 'top', showGrandTotals: 'on', showTotals: 'on' } },\n  },\n});" },

    { group: 'Layout', id: 'report-filters', title: 'Report-filter area', desc:
      '<p>Fields placed in <code>reportFilters</code> appear as a filter bar above the grid; pick members to slice the whole report.</p>',
      hint: 'Click the “category” filter button above the grid to choose members.',
      body:
"const pivot = new PP({\n  container: '#pivot',\n  report: {\n    dataSource: { type: 'json', data },\n    slice: {\n      reportFilters: [{ uniqueName: 'category' }],\n      rows: [{ uniqueName: 'region' }],\n      columns: [{ uniqueName: 'product' }],\n      measures: [{ uniqueName: 'sales', aggregation: 'sum' }],\n    },\n  },\n});" },

    { group: 'Layout', id: 'measures-on-rows', title: 'Measures on the row axis', desc:
      '<p>Put the special <code>[Measures]</code> placeholder in <code>rows</code> to lay measures down the rows instead of across the columns.</p>',
      body:
"const pivot = new PP({\n  container: '#pivot',\n  report: {\n    dataSource: { type: 'json', data },\n    slice: {\n      rows: [{ uniqueName: 'region' }, { uniqueName: '[Measures]' }],\n      columns: [{ uniqueName: 'category' }],\n      measures: [\n        { uniqueName: 'sales', aggregation: 'sum' },\n        { uniqueName: 'qty', aggregation: 'sum' },\n      ],\n    },\n  },\n});" },

    // ===== Aggregations =====
    { group: 'Aggregations', id: 'core-aggs', title: 'Core aggregations', desc:
      '<p>17 built-in aggregations. Here: sum, average, min, max, count, distinct-count, median and sample std-dev — each its own measure over the same field.</p>',
      body:
"const aggs = ['sum','average','min','max','count','distinctcount','median','stdevs'];\nconst pivot = new PP({\n  container: '#pivot',\n  report: {\n    dataSource: { type: 'json', data },\n    slice: {\n      rows: [{ uniqueName: 'region' }],\n      measures: aggs.map((a) => ({ uniqueName: 'sales', aggregation: a, caption: a })),\n    },\n  },\n});" },

    { group: 'Aggregations', id: 'percent-aggs', title: '% of column / row / total', desc:
      '<p>Share-of aggregations: <code>percentofcolumn</code>, <code>percentofrow</code> and <code>percent</code> (% of grand total), plus <code>index</code>.</p>',
      body:
"const pivot = new PP({\n  container: '#pivot',\n  report: {\n    dataSource: { type: 'json', data },\n    slice: {\n      rows: [{ uniqueName: 'region' }],\n      columns: [{ uniqueName: 'category' }],\n      measures: [\n        { uniqueName: 'sales', aggregation: 'sum',            caption: 'Sales' },\n        { uniqueName: 'sales', aggregation: 'percentofcolumn', caption: '% of Col' },\n        { uniqueName: 'sales', aggregation: 'percentofrow',    caption: '% of Row' },\n      ],\n    },\n  },\n});" },

    { group: 'Aggregations', id: 'positional', title: 'Running totals & difference', desc:
      '<p>The positional family (<code>runningtotals</code>, <code>difference</code>, <code>%difference</code>) walks an axis set by <code>positionalAxis</code> (here, down the rows).</p>',
      body:
"const pivot = new PP({\n  container: '#pivot',\n  report: {\n    dataSource: { type: 'json', data },\n    slice: {\n      rows: [{ uniqueName: 'product' }],\n      measures: [\n        { uniqueName: 'sales', aggregation: 'sum', caption: 'Sales' },\n        { uniqueName: 'sales', aggregation: 'runningtotals', positionalAxis: 'rows', caption: 'Running' },\n        { uniqueName: 'sales', aggregation: 'difference',    positionalAxis: 'rows', caption: 'Diff' },\n      ],\n    },\n  },\n});" },

    // ===== Calculated & formatting =====
    { group: 'Calculated & formatting', id: 'calculated', title: 'Calculated measures', desc:
      '<p>Define a measure from a <code>formula</code> over other aggregations, e.g. profit and margin. ' +
      'Open a column ▾ → <b>Calculation</b> tab to see its type, edit the formula, and browse the ' +
      'built-in functions; or do it in code with <code>pivot.setMeasureFormula()</code>. Gate the panel ' +
      'with <code>options.columnProperties</code> (<code>showType</code> / <code>showFormula</code> / <code>editFormula</code>).</p>',
      hint: 'Open the ▾ on the Profit or Margin header → Calculation tab to edit the formula.',
      body:
"const pivot = new PP({\n  container: '#pivot',\n  report: {\n    dataSource: { type: 'json', data },\n    slice: {\n      rows: [{ uniqueName: 'region' }],\n      measures: [\n        { uniqueName: 'sales', aggregation: 'sum', format: 'cur' },\n        { uniqueName: 'profit', formula: \"sum('sales') - sum('cost')\", caption: 'Profit', format: 'cur' },\n        { uniqueName: 'margin', formula: \"(sum('sales') - sum('cost')) / sum('sales')\", caption: 'Margin', format: 'pct' },\n      ],\n    },\n    formats: [\n      { name: 'cur', currencySymbol: '$', decimalPlaces: 0, thousandsSeparator: ',' },\n      { name: 'pct', isPercent: true, decimalPlaces: 1 },\n    ],\n  },\n});" },

    { group: 'Calculated & formatting', id: 'conditional', title: 'Conditional formatting', desc:
      '<p>Style cells by value with <code>conditions</code>. The formula uses <code>#value</code>; each rule carries a CSS <code>format</code>.</p>',
      body:
"const pivot = new PP({\n  container: '#pivot',\n  report: {\n    dataSource: { type: 'json', data },\n    slice: {\n      rows: [{ uniqueName: 'region' }],\n      columns: [{ uniqueName: 'category' }],\n      measures: [{ uniqueName: 'sales', aggregation: 'sum' }],\n    },\n    conditions: [\n      { formula: '#value > 6000', measure: 'sales', format: { backgroundColor: '#c5e1a5', color: '#1b5e20' } },\n      { formula: '#value < 1500', measure: 'sales', format: { backgroundColor: '#ffcdd2', color: '#b71c1c' } },\n    ],\n  },\n});" },

    { group: 'Calculated & formatting', id: 'customize-cell', title: 'customizeCell hook', desc:
      '<p>The <code>customizeCell</code> callback lets you add classes/styles/attributes to any cell as it renders — full programmatic control.</p>',
      body:
"const pivot = new PP({\n  container: '#pivot',\n  report: {\n    dataSource: { type: 'json', data },\n    slice: {\n      rows: [{ uniqueName: 'region' }],\n      columns: [{ uniqueName: 'category' }],\n      measures: [{ uniqueName: 'sales', aggregation: 'sum' }],\n    },\n  },\n  customizeCell: (cell, d) => {\n    if (d.type === 'value' && typeof d.value === 'number') {\n      // Heat the text from blue (low) to red (high).\n      const t = Math.min(1, d.value / 9000);\n      cell.style.color = `rgb(${Math.round(40 + t * 180)}, 60, ${Math.round(220 - t * 180)})`;\n      cell.style.fontWeight = '600';\n    }\n  },\n});" },

    { group: 'Calculated & formatting', id: 'display-numeric', title: 'Display formats — numeric', desc:
      '<p>Rich per-measure visuals: <code>data_bar</code>, <code>heatmap</code>, <code>rating</code>, <code>signed</code>. Set on each measure’s <code>display</code>.</p>',
      body:
"const pivot = new PP({\n  container: '#pivot',\n  report: {\n    dataSource: { type: 'json', data, mapping: { sales: { type: 'number' }, qty: { type: 'number' }, rating: { type: 'number' } } },\n    slice: {\n      rows: [{ uniqueName: 'region' }],\n      measures: [\n        { uniqueName: 'sales', aggregation: 'sum', caption: 'Sales', display: { type: 'data_bar', min: 0, max: 12000, color: 'blue' } },\n        { uniqueName: 'qty',   aggregation: 'sum', caption: 'Qty',   display: { type: 'heatmap', applyTo: 'background', thresholds: [20, 35, 50] } },\n        { uniqueName: 'rating', aggregation: 'average', caption: 'Rating', display: { type: 'rating', max: 5 } },\n      ],\n    },\n  },\n});\nlog('Open a column ▾ → Display tab to try other formats.');" },

    { group: 'Calculated & formatting', id: 'display-status', title: 'Display formats — status & tags', desc:
      '<p>For text dimension columns: <code>status_tag</code>, <code>boolean</code>, <code>tags</code>, <code>icon_map</code> via a value→color/label map.</p>',
      body:
"const pivot = new PP({\n  container: '#pivot',\n  report: {\n    dataSource: { type: 'json', data, mapping: { status: { type: 'string' } } },\n    slice: {\n      rows: [\n        { uniqueName: 'status', display: { type: 'status_tag', map: [\n          { when: 'shipped',  color: 'green', label: 'Shipped' },\n          { when: 'pending',  color: 'amber', label: 'Pending' },\n          { when: 'returned', color: 'red',   label: 'Returned' },\n        ] } },\n        { uniqueName: 'region' },\n      ],\n      measures: [{ uniqueName: 'sales', aggregation: 'sum' }],\n    },\n    options: { grid: { type: 'flat' } },\n  },\n});" },

    { group: 'Calculated & formatting', id: 'display-text', title: 'Display formats — date & text', desc:
      '<p>Date and text transforms: <code>date</code> (Angular-style tokens), <code>template</code>, <code>case</code>, <code>truncate</code>.</p>',
      body:
"const pivot = new PP({\n  container: '#pivot',\n  report: {\n    dataSource: { type: 'json', data, mapping: { product: { type: 'string' } } },\n    slice: {\n      rows: [{ uniqueName: 'product', display: { type: 'template', template: 'SKU-{value}' } }],\n      columns: [{ uniqueName: 'region', display: { type: 'case', textCase: 'upper' } }],\n      measures: [{ uniqueName: 'sales', aggregation: 'sum' }],\n    },\n  },\n});" },

    // ===== Data & sorting =====
    { group: 'Data & sorting', id: 'date-hierarchy', title: 'Date hierarchy', desc:
      '<p>Map a date field as <code>year/quarter/month/day</code> and ProPivot expands it into a drill-down Year → Quarter → Month hierarchy.</p>',
      hint: 'Expand the Year nodes to drill into quarters and months.',
      body:
"const pivot = new PP({\n  container: '#pivot',\n  report: {\n    dataSource: { type: 'json', data, mapping: { date: { type: 'year/quarter/month/day', caption: 'Date' } } },\n    slice: {\n      rows: [{ uniqueName: 'date' }],\n      columns: [{ uniqueName: 'category' }],\n      measures: [{ uniqueName: 'sales', aggregation: 'sum' }],\n    },\n  },\n});" },

    { group: 'Data & sorting', id: 'sorting-topn', title: 'Sorting & Top-N', desc:
      '<p>Sort members, sort rows by a measure, and keep only the top/bottom N. Click a header to sort; or set it declaratively with a <code>filter</code> of type <code>top</code>.</p>',
      hint: 'Click a measure header to sort rows by it; click a row-field header to sort members.',
      body:
"const pivot = new PP({\n  container: '#pivot',\n  report: {\n    dataSource: { type: 'json', data },\n    slice: {\n      rows: [{ uniqueName: 'product', filter: { type: 'top', measure: 'sales', quantity: 2 } }],\n      columns: [{ uniqueName: 'category' }],\n      measures: [{ uniqueName: 'sales', aggregation: 'sum' }],\n      sorting: { row: { measure: 'sales', type: 'desc' } },\n    },\n  },\n});\nlog('Showing the Top 2 products by sales, sorted descending.');" },

    { group: 'Data & sorting', id: 'member-filter', title: 'Member filtering', desc:
      '<p>Restrict a field to chosen members with a <code>members</code> filter (works on rows, columns and report filters).</p>',
      body:
"const pivot = new PP({\n  container: '#pivot',\n  report: {\n    dataSource: { type: 'json', data },\n    slice: {\n      rows: [{ uniqueName: 'region', filter: { members: ['West', 'East'] } }],\n      columns: [{ uniqueName: 'category' }],\n      measures: [{ uniqueName: 'sales', aggregation: 'sum' }],\n    },\n  },\n});" },

    // ===== Column UX =====
    { group: 'Column UX', id: 'column-resize', title: 'Column resize', desc:
      '<p>Drag a header’s right edge to resize. Widths persist via a <code>&lt;colgroup&gt;</code> and fire <code>columnresize</code>.</p>',
      hint: 'Drag the right edge of any column header.',
      body:
"const pivot = new PP({\n  container: '#pivot',\n  report: {\n    dataSource: { type: 'json', data },\n    slice: {\n      rows: [{ uniqueName: 'region' }, { uniqueName: 'category' }],\n      columns: [{ uniqueName: 'product' }],\n      measures: [{ uniqueName: 'sales', aggregation: 'sum' }],\n    },\n  },\n  columnresize: (e) => log('columnresize → ' + e.ref.uniqueName + ' = ' + e.width + 'px'),\n});" },

    { group: 'Column UX', id: 'column-reorder', title: 'Column reorder', desc:
      '<p>Drag a header onto another to reorder, or onto a Field-List zone to move between Rows/Columns/Values. Fires <code>columnreorder</code>.</p>',
      hint: 'Drag the “category” header onto “region”, or drag fields between the zones above.',
      body:
"const pivot = new PP({\n  container: '#pivot',\n  report: {\n    dataSource: { type: 'json', data },\n    slice: {\n      rows: [{ uniqueName: 'region' }, { uniqueName: 'category' }],\n      columns: [{ uniqueName: 'product' }],\n      measures: [{ uniqueName: 'sales', aggregation: 'sum' }, { uniqueName: 'qty', aggregation: 'sum' }],\n    },\n  },\n  columnreorder: (e) => log('columnreorder → ' + e.uniqueName + ': ' + e.fromZone + ' → ' + e.toZone),\n});" },

    { group: 'Column UX', id: 'column-panel', title: 'Column-properties panel', desc:
      '<p>Click the <b>▾</b> on a header for a context-aware panel: heading, aggregation, conditional formatting (expression + color), display format, and filter. Fires <code>columnpropertychange</code>.</p>',
      hint: 'Click the ▾ on the Sales header → try the Conditional and Display tabs.',
      body:
"const pivot = new PP({\n  container: '#pivot',\n  report: {\n    dataSource: { type: 'json', data },\n    slice: {\n      rows: [{ uniqueName: 'region' }],\n      columns: [{ uniqueName: 'category' }],\n      measures: [{ uniqueName: 'sales', aggregation: 'sum' }],\n    },\n  },\n  columnpropertychange: (e) => log('columnpropertychange → ' + JSON.stringify(e)),\n});\nlog('Click the ▾ on any header.');" },

    { group: 'Column UX', id: 'read-only', title: 'Read-only columns', desc:
      '<p>Disable the column UX with <code>options.columnProperties: false</code> (or fine-tune <code>{ edit, resize, reorder }</code>) — no ▾, no drag.</p>',
      body:
"const pivot = new PP({\n  container: '#pivot',\n  report: {\n    dataSource: { type: 'json', data },\n    slice: {\n      rows: [{ uniqueName: 'region' }],\n      columns: [{ uniqueName: 'category' }],\n      measures: [{ uniqueName: 'sales', aggregation: 'sum' }],\n    },\n    options: { columnProperties: false },\n  },\n});\nlog('No ▾ / resize / reorder — columns are read-only.');" },

    // ===== Export =====
    { group: 'Export', id: 'export', title: 'Export (PDF / Excel / CSV / …)', desc:
      '<p>One call per format: <code>pivot.exportTo(\'pdf\'|\'excel\'|\'csv\'|\'html\'|\'image\')</code>. PDF and SVG carry the on-screen styling (fills, bars, conditional formats).</p>',
      hint: 'Click a button — the PDF/image match the styled grid.',
      body:
"const pivot = new PP({\n  container: '#pivot',\n  report: {\n    dataSource: { type: 'json', data },\n    slice: {\n      rows: [{ uniqueName: 'region' }],\n      columns: [{ uniqueName: 'category' }],\n      measures: [{ uniqueName: 'sales', aggregation: 'sum', display: { type: 'data_bar', min: 0, max: 12000, color: '#2f6fdb' } }],\n    },\n    conditions: [{ formula: '#value > 6000', measure: 'sales', format: { backgroundColor: '#c5e1a5' } }],\n  },\n});\nconst bar = document.createElement('div');\nbar.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;margin:10px 0';\n['pdf','excel','csv','html','image'].forEach((t) => {\n  const b = document.createElement('button');\n  b.textContent = t.toUpperCase();\n  b.style.cssText = 'padding:6px 12px;cursor:pointer';\n  b.onclick = () => pivot.exportTo(t, { filename: 'propivot' });\n  bar.appendChild(b);\n});\ndocument.getElementById('pivot').after(bar);" },

    // ===== Interaction =====
    { group: 'Interaction', id: 'drill-through', title: 'Drill-through', desc:
      '<p>Double-click any value cell to see the underlying source rows that aggregate into it (toggle with <code>options.drillThrough</code>).</p>',
      hint: 'Double-click a value cell to open the drill-through view.',
      body:
"const pivot = new PP({\n  container: '#pivot',\n  report: {\n    dataSource: { type: 'json', data },\n    slice: {\n      rows: [{ uniqueName: 'region' }],\n      columns: [{ uniqueName: 'category' }],\n      measures: [{ uniqueName: 'sales', aggregation: 'sum' }],\n    },\n  },\n});\nlog('Double-click any value cell.');" },

    { group: 'Interaction', id: 'events', title: 'Events', desc:
      '<p>Subscribe with <code>pivot.on(event, handler)</code> or inline in the config. <code>cellclick</code> fires for value cells <b>and</b> row/column headers and carries the full cell context — the <code>rows</code>/<code>columns</code> tuples (each field with its member), <code>measure</code>, <code>value</code>, <code>label</code> and total flags. Column events join the lifecycle/interaction events; all are forwarded by the React &amp; Angular wrappers.</p>',
      hint: 'Click cells, resize/reorder columns, edit a property — events stream below.',
      body:
"const pivot = new PP({\n  container: '#pivot',\n  report: {\n    dataSource: { type: 'json', data },\n    slice: {\n      rows: [{ uniqueName: 'region' }, { uniqueName: 'category' }],\n      columns: [{ uniqueName: 'product' }],\n      measures: [{ uniqueName: 'sales', aggregation: 'sum' }],\n    },\n  },\n});\n// cellclick reports the FULL cell context: row tuple, column tuple, measure, value.\npivot.on('cellclick', (d) => {\n  const rows = d.rows.map((r) => r.caption + '=' + r.member).join(', ');\n  const cols = d.columns.map((c) => c.caption + '=' + c.member).join(', ');\n  log('cellclick [' + d.type + '] { rows: {' + rows + '}, cols: {' + cols + '}, measure: ' + (d.measure ? d.measure.uniqueName : '-') + ', value: ' + d.value + ' }');\n});\npivot.on('columnresize',         (e) => log('columnresize → ' + e.ref.uniqueName + ' ' + e.width + 'px'));\npivot.on('columnreorder',        (e) => log('columnreorder → ' + e.uniqueName + ' → ' + e.toZone));\npivot.on('columnpropertychange', (e) => log('columnpropertychange → ' + e.property));\nlog('Click a value cell — or a row/column header — to see the full cell data.');" },

    // ===== Scale =====
    { group: 'Scale', id: 'virtualization', title: 'Virtualized rendering', desc:
      '<p>The grid only renders visible rows, so it stays smooth on large data. This demo generates <b>5,000</b> rows on the fly.</p>',
      hint: 'Scroll the grid — rows are recycled as you go. See the 2M-row demo for the DuckDB accelerator.',
      body:
"const regions = ['West','East','North','South','Central'];\nconst cats = ['Furniture','Tech','Office','Outdoor'];\nconst big = Array.from({ length: 5000 }, (_, i) => ({\n  region: regions[i % regions.length],\n  category: cats[(i >> 2) % cats.length],\n  sku: 'SKU-' + (1000 + i),\n  sales: 100 + ((i * 37) % 9000),\n}));\nconst pivot = new PP({\n  container: '#pivot',\n  report: {\n    dataSource: { type: 'json', data: big },\n    slice: {\n      rows: [{ uniqueName: 'region' }, { uniqueName: 'sku' }],\n      columns: [{ uniqueName: 'category' }],\n      measures: [{ uniqueName: 'sales', aggregation: 'sum' }],\n    },\n  },\n});\nlog('5,000 rows pivoted client-side.');" },

    // ===== Frameworks (code-only) =====
    { group: 'Frameworks', id: 'frameworks', title: 'React & Angular', live: false, playground: false, desc:
      '<p>Use the framework wrappers, or read <code>window.ProPivot</code> from a plain <code>&lt;script&gt;</code>. All events (including the column events) are forwarded.</p>',
      codeOverride:
"// ── React ───────────────────────────────────────────────\nimport { Pivot } from '@proteus/propivot/react';\nimport '@proteus/propivot/propivot.css';\n\n<Pivot\n  report={report}\n  toolbar\n  columnresize={(e) => console.log(e)}\n  onReady={(pivot) => console.log('ready', pivot)}\n/>;\n\n// ── Angular ─────────────────────────────────────────────\n// import { ProPivotComponent } from '@proteus/propivot/angular';\n<pro-pivot\n  [report]=\"report\"\n  [toolbar]=\"true\"\n  (columnresize)=\"onResize($event)\"\n  (columnreorder)=\"onReorder($event)\">\n</pro-pivot>\n\n// ── Plain script tag ────────────────────────────────────\n// <link rel=\"stylesheet\" href=\"propivot.css\">\n// <script src=\"propivot.global.js\"></script>\nconst pivot = new window.ProPivot({ container: '#pivot', report });" },
  ];

  F.forEach(function (f) {
    f.live = f.live !== false;
    f.playground = f.playground !== false && f.live;
    f.code = f.codeOverride || (PREAMBLE + DATA + f.body);
  });

  // ── Playground ──────────────────────────────────────────────────────────────
  var PLAY_HTML = '<div id="pivot"></div>\n<pre id="log"></pre>';
  var PLAY_CSS = '#pivot { height: 380px; }\n#log { font: 12px/1.5 ui-monospace, monospace; color: #374151; white-space: pre-wrap; max-height: 160px; overflow: auto; }';
  function submitForm(action, fields) {
    var fm = document.createElement('form');
    fm.method = 'POST'; fm.action = action; fm.target = '_blank';
    Object.keys(fields).forEach(function (k) {
      var i = document.createElement('input');
      i.type = 'hidden'; i.name = k; i.value = fields[k]; fm.appendChild(i);
    });
    document.body.appendChild(fm); fm.submit(); fm.remove();
  }
  function openCodePen(f) {
    submitForm('https://codepen.io/pen/define', { data: JSON.stringify({
      title: 'ProPivot — ' + f.title, html: PLAY_HTML, css: PLAY_CSS, js: f.code,
      css_external: CDN_CSS, js_external: CDN_JS, editors: '111',
    }) });
  }
  function openJsFiddle(f) {
    submitForm('https://jsfiddle.net/api/post/library/pure/', {
      title: 'ProPivot — ' + f.title, html: PLAY_HTML, css: PLAY_CSS, js: f.code,
      resources: CDN_CSS + ',' + CDN_JS, wrap: 'b',
    });
  }

  // ── Download ────────────────────────────────────────────────────────────────
  // Live examples download as a complete, runnable single-file HTML page (loads
  // the library from this site's CDN). Code-only examples (framework snippets)
  // download as a .js file.
  function buildStandaloneHtml(f) {
    return [
      '<!DOCTYPE html>',
      '<html lang="en">',
      '<head>',
      '  <meta charset="utf-8" />',
      '  <meta name="viewport" content="width=device-width, initial-scale=1" />',
      '  <title>ProPivot — ' + f.title + '</title>',
      '  <link rel="stylesheet" href="' + CDN_CSS + '" />',
      '  <style>' + PLAY_CSS + '</style>',
      '</head>',
      '<body>',
      '  ' + PLAY_HTML.replace(/\n/g, '\n  '),
      '  <script src="' + CDN_JS + '"></scr' + 'ipt>',
      '  <script>',
      f.code.replace(/^/gm, '    '),
      '  </scr' + 'ipt>',
      '</body>',
      '</html>',
      '',
    ].join('\n');
  }
  function triggerDownload(filename, text, mime) {
    try {
      var blob = new Blob([text], { type: mime });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
    } catch (e) { if (window.console) console.error(e); }
  }
  function downloadCode(f) {
    if (f.live) triggerDownload('propivot-' + f.id + '.html', buildStandaloneHtml(f), 'text/html');
    else triggerDownload('propivot-' + f.id + '.js', f.code, 'text/javascript');
  }

  // ── Render ──────────────────────────────────────────────────────────────────
  var nav = document.getElementById('nav');
  var current = null;
  var lastGroup = null;
  F.forEach(function (f) {
    if (f.group !== lastGroup) {
      var h = document.createElement('div');
      h.className = 'navgroup';
      h.textContent = f.group;
      nav.appendChild(h);
      lastGroup = f.group;
    }
    var b = document.createElement('button');
    b.textContent = f.title;
    b.dataset.id = f.id;
    b.addEventListener('click', function () { location.hash = f.id; });
    nav.appendChild(b);
  });

  function render(f) {
    current = f;
    [].forEach.call(document.querySelectorAll('#nav button'), function (b) {
      b.classList.toggle('active', b.dataset.id === f.id);
    });
    document.getElementById('title').textContent = f.title;
    document.getElementById('desc').innerHTML = f.desc;
    document.getElementById('tryhint').innerHTML = f.hint ? '<div class="tryhint">▶ ' + f.hint + '</div>' : '';
    document.getElementById('code').textContent = f.code;

    var pg = document.getElementById('codepen');
    var jf = document.getElementById('jsfiddle');
    if (pg) pg.style.display = f.playground ? '' : 'none';
    if (jf) jf.style.display = f.playground ? '' : 'none';

    var demo = document.getElementById('demo');
    if (!f.live) {
      demo.innerHTML = '<div class="note">This is framework / integration code — copy it into your app. The live preview is omitted here.</div>';
      return;
    }
    demo.innerHTML = '<div id="pivot"></div><pre id="log" class="log"></pre>';
    try {
      new Function(f.code)();
    } catch (e) {
      document.getElementById('log').textContent = 'Error: ' + (e && e.message ? e.message : e);
      if (window.console) console.error(e);
    }
  }

  var copyBtn = document.getElementById('copy');
  if (copyBtn) copyBtn.addEventListener('click', function () {
    try {
      navigator.clipboard.writeText(current.code);
      copyBtn.textContent = 'Copied ✓';
      setTimeout(function () { copyBtn.textContent = 'Copy code'; }, 1200);
    } catch (e) { /* clipboard unavailable */ }
  });
  var dlBtn = document.getElementById('download');
  if (dlBtn) dlBtn.addEventListener('click', function () {
    downloadCode(current);
    var label = dlBtn.textContent;
    dlBtn.textContent = 'Downloaded ✓';
    setTimeout(function () { dlBtn.textContent = label; }, 1200);
  });
  var cpBtn = document.getElementById('codepen');
  if (cpBtn) cpBtn.addEventListener('click', function () { openCodePen(current); });
  var jfBtn = document.getElementById('jsfiddle');
  if (jfBtn) jfBtn.addEventListener('click', function () { openJsFiddle(current); });

  function fromHash() {
    var id = location.hash.replace('#', '');
    for (var i = 0; i < F.length; i++) if (F[i].id === id) return F[i];
    return F[0];
  }
  window.addEventListener('hashchange', function () { render(fromHash()); });
  render(fromHash());
})();
