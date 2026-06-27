// A small, self-contained dataset + report so the starter runs with zero setup.
// Plain browser script — defines two globals used by main.js.
// Swap the rows/mapping for your own, and edit report.slice to pivot them.
(function (global) {
  'use strict';

  var REGIONS = ['West', 'East', 'North', 'South'];
  var CATEGORIES = ['Furniture', 'Office', 'Technology'];
  var SEGMENTS = ['Consumer', 'Corporate', 'Home Office'];
  var YEARS = [2023, 2024, 2025];
  var QUARTERS = ['Q1', 'Q2', 'Q3', 'Q4'];

  function pad(n) { return String(n).padStart(2, '0'); }
  function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

  // Generate `rows` random sales records. Try bumping this to 1_000_000.
  function generateRows(rows) {
    rows = rows || 20000;
    var out = [];
    for (var i = 0; i < rows; i++) {
      var year = pick(YEARS);
      var month = (Math.random() * 12) | 0;
      var day = 1 + ((Math.random() * 28) | 0);
      out.push({
        region: pick(REGIONS),
        category: pick(CATEGORIES),
        segment: pick(SEGMENTS),
        customer: 'Cust-' + String(1 + ((Math.random() * 800) | 0)).padStart(4, '0'),
        orderDate: year + '-' + pad(month + 1) + '-' + pad(day),
        year: year,
        quarter: QUARTERS[(month / 3) | 0],
        sales: Math.round(Math.random() * 6000),
        qty: 1 + ((Math.random() * 60) | 0),
      });
    }
    return out;
  }

  var mapping = {
    region: { type: 'string', caption: 'Region' },
    category: { type: 'string', caption: 'Category' },
    segment: { type: 'string', caption: 'Segment' },
    customer: { type: 'string', caption: 'Customer' },
    orderDate: { type: 'year/quarter/month/day', caption: 'Order Date' },
    year: { type: 'number', caption: 'Year' },
    quarter: { type: 'string', caption: 'Quarter' },
    sales: { type: 'number', caption: 'Sales' },
    qty: { type: 'number', caption: 'Quantity' },
  };

  // Build the ProPivot report object that drives the grid.
  function buildReport(data) {
    return {
      dataSource: { type: 'json', data: data, mapping: mapping },
      slice: {
        rows: [{ uniqueName: 'region' }, { uniqueName: 'category' }],
        columns: [{ uniqueName: 'year' }],
        measures: [
          { uniqueName: 'sales', aggregation: 'sum', caption: 'Sales', format: 'cur' },
          { uniqueName: 'qty', aggregation: 'average', caption: 'Avg Qty', format: 'num' },
          { uniqueName: 'aov', formula: "sum('sales')/sum('qty')", caption: 'Avg Price', format: 'cur' },
        ],
      },
      formats: [
        { name: 'cur', currencySymbol: '$', thousandsSeparator: ',', decimalPlaces: 0 },
        { name: 'num', thousandsSeparator: ',', decimalPlaces: 1 },
      ],
      conditions: [
        { formula: '#value > 120000', measure: 'sales', format: { backgroundColor: '#c5e1a5', color: '#1b5e20' } },
        { formula: '#value < 20000', measure: 'sales', format: { color: '#b71c1c' } },
      ],
      options: { grid: { type: 'compact' } },
    };
  }

  global.ProPivotSample = { generateRows: generateRows, buildReport: buildReport };
})(window);
