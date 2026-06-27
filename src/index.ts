// ProPivot public entry point.
//   import { ProPivot } from '@proteus/propivot';

export { ProPivot } from './facade/ProPivot';
export type { ProPivotConfig, LoadDataOptions } from './facade/ProPivot';
export { CellBuilder } from './facade/cell';
export type { CellData } from './facade/cell';
export { ALL_AGGREGATIONS, AGGREGATION_CAPTIONS } from './core/aggregations';

// Engine internals (useful for headless aggregation, SSR-free pipelines, tests).
export { buildStore } from './core/store';
export { normalizeReport, resolveLocalization } from './core/normalize';
export type { ResolvedLocalization } from './core/normalize';
export { buildMatrix, leafPaths } from './core/planner';
export { parseFormula, evaluateFormula } from './core/formula';
export { compileConditionFormula, compileConditions } from './core/conditions';
export { formatNumber, resolveFormats } from './core/format';
export { LocalEngine, WorkerEngine } from './core/engine';
export type { PivotEngine } from './core/engine';
// Headless export builders (no DOM required).
export { exportMatrix } from './export';
export type { ExportType, ExportParams } from './export';
export { buildXlsx } from './export/xlsx';
export { buildPdf } from './export/pdf';
export { parseCsv } from './core/csv';
// Raw-data ingestion: infer columns/types from CSV/JSON with no predefined mapping.
export {
  parseDataset, inferSchema, inferMapping, coerceData, parseNumber, buildStarterReport,
} from './core/ingest';
export type { InferOptions, StarterReportOptions } from './core/ingest';
export { drillThroughRows } from './core/drillthrough';
export type { DrillThroughQuery } from './core/drillthrough';

export * from './core/types';
export type {
  CellMatrix, AxisNode, CellValue, FlatMatrix, FlatColumn, FlatCell, SerializedMatrix,
} from './core/matrix';
export { serializeMatrix, deserializeMatrix } from './core/matrix';

import { ProPivot } from './facade/ProPivot';
export default ProPivot;

/**
 * Namespace mirroring the legacy `*.d.ts` shape so a typed consumer wrapper
 * (e.g. `ProPivot.Report`, `ProPivot.Pivot`, `ProPivot.CellBuilder`,
 * `ProPivot.CellData`) compiles after the one-line import alias.
 */
export namespace ProPivotNS {
  export type Report = import('./core/types').Report;
  export type Pivot = import('./facade/ProPivot').ProPivot;
  export type CellBuilder = import('./facade/cell').CellBuilder;
  export type CellData = import('./facade/cell').CellData;
}
