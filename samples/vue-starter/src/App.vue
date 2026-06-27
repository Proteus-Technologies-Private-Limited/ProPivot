<script setup lang="ts">
import { ref, shallowRef } from 'vue';
// The pivot grid styles. Resolved from the @proteus/propivot package exports.
import '@proteus/propivot/propivot.css';
// `Pivot` is the Vue wrapper component; `ProPivot` is the underlying instance type.
import { Pivot, type ProPivot } from '@proteus/propivot/vue';
import { generateRows, buildReport } from './sampleData';

// Generate the dataset once and build the report that drives the grid.
const data = generateRows(20_000);
const report = ref(buildReport(data));

// Capture the live ProPivot instance so the toolbar buttons can call its API.
const pivot = shallowRef<ProPivot | null>(null);
function onReady(p: ProPivot) {
  pivot.value = p;
}
</script>

<template>
  <div class="page">
    <header class="bar">
      <strong>ProPivot · Vue starter</strong>
      <span class="muted">{{ data.length.toLocaleString() }} rows · client-side</span>
      <div class="spacer" />
      <button @click="pivot?.expandAllData()">Expand</button>
      <button @click="pivot?.collapseAllData()">Collapse</button>
      <button @click="pivot?.exportTo('csv', { filename: 'propivot' })">CSV</button>
      <button @click="pivot?.exportTo('excel', { filename: 'propivot', excelSheetName: 'Report' })">
        Excel
      </button>
    </header>

    <!-- The grid fills the remaining height. Drag fields, double-click a cell to drill through, export. -->
    <Pivot :report="report" toolbar class="grid" @ready="onReady" />
  </div>
</template>
