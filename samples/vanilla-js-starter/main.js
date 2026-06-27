// Plain-JavaScript entry point. No framework, no build step — it reads the global
// `window.ProPivot` defined by propivot.global.js and mounts a pivot into #pivot.
(function () {
  'use strict';

  var ProPivot = window.ProPivot;
  var sample = window.ProPivotSample;
  var pivotEl = document.getElementById('pivot');

  if (!ProPivot) {
    pivotEl.innerHTML =
      '<p style="padding:20px;color:#b71c1c">Could not load the ProPivot bundle ' +
      '(vendor/propivot/dist/propivot.global.js).</p>';
    return;
  }

  // Generate the dataset once and build the report that drives the grid.
  var data = sample.generateRows(20000);
  document.getElementById('rowCount').textContent =
    data.length.toLocaleString() + ' rows · client-side';

  // Create the pivot. The container can be a CSS selector or a DOM element.
  var pivot = new ProPivot({
    container: pivotEl,
    toolbar: true,
    report: sample.buildReport(data),
    cellclick: function (cell) { console.log('cell clicked', cell); },
  });

  // Wire the toolbar buttons to the instance API.
  document.getElementById('expand').onclick = function () { pivot.expandAllData(); };
  document.getElementById('collapse').onclick = function () { pivot.collapseAllData(); };
  document.getElementById('csv').onclick = function () {
    pivot.exportTo('csv', { filename: 'propivot' });
  };
  document.getElementById('excel').onclick = function () {
    pivot.exportTo('excel', { filename: 'propivot', excelSheetName: 'Report' });
  };
})();
