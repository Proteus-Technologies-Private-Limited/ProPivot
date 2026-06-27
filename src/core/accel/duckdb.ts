// Opt-in DuckDB-WASM accelerator (docs/Architecture.md §5).
//
// Offloads the GROUPING-SETS base aggregation to DuckDB-WASM in the browser for large
// datasets, then reuses the shared `assembleMatrix` so output matches the built-in
// engine (verified in test/accel-parity.test.ts via the same SQL run under Node).
//
// EVERYTHING degrades gracefully: below the row threshold, when DuckDB can't load, or
// for any report the SQL path doesn't support (top/bottom-N, date dimensions) or any
// runtime error, it falls back to the built-in main-thread engine. So enabling the
// accelerator can never break a result — at worst it's the same as not enabling it.
//
// The duckdb-wasm module itself is loaded dynamically from a CDN at runtime, so it is
// NOT bundled into ProPivot and adds zero weight unless a consumer opts in.

import { buildStore, type ColumnStore } from '../store';
import { normalizeReport } from '../normalize';
import { buildMatrix, planBase, assembleMatrix, applyFilters } from '../planner';
import type { CellMatrix } from '../matrix';
import type { Mapping, Report } from '../types';
import type { PivotEngine } from '../engine';
import { computeBaseCellsViaSql, ACCEL_TABLE, type SqlRunner } from './sql';

export interface DuckDBOptions {
  /** Use DuckDB only at/above this row count (default 100_000). Smaller data is faster on the main thread. */
  threshold?: number;
  /** ESM URL for the duckdb-wasm module (default jsDelivr 1.29.0). */
  moduleUrl?: string;
}

const DEFAULT_MODULE = 'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/+esm';

// Hidden from the bundler so duckdb-wasm is fetched at runtime, never built in.
const dynamicImport = (url: string): Promise<unknown> =>
  (new Function('u', 'return import(u)') as (u: string) => Promise<unknown>)(url);

/**
 * Engine that accelerates large-data aggregation with DuckDB-WASM, transparently
 * falling back to the built-in columnar engine. The last-used path is reported via
 * {@link lastPath} so a host can show which engine ran.
 */
export class DuckDBEngine implements PivotEngine {
  private store: ColumnStore | null = null;
  private rows: Array<Record<string, unknown>> = [];
  private threshold: number;
  private moduleUrl: string;
  private ready: Promise<void> | null = null;
  private runner: SqlRunner | null = null;
  private db: { terminate?: () => void } | null = null;
  /** 'duckdb' or 'builtin' — which path produced the most recent compute(). */
  lastPath: 'duckdb' | 'builtin' = 'builtin';

  constructor(opts: DuckDBOptions = {}) {
    this.threshold = opts.threshold ?? 100_000;
    this.moduleUrl = opts.moduleUrl ?? DEFAULT_MODULE;
  }

  setData(data: unknown, mapping?: Mapping): void {
    this.store = buildStore(data as never, mapping);
    this.rows = this.store.rawRows;
    // Kick off the (async, best-effort) DuckDB load; never throw from here.
    this.ready = this.load(this.rows).catch((e) => {
      console.warn('[ProPivot] DuckDB-WASM unavailable; using built-in engine.', e);
      this.runner = null;
    });
  }

  async compute(report: Report): Promise<CellMatrix> {
    if (!this.store) this.setData(report.dataSource?.data, report.dataSource?.mapping);
    const store = this.store!;
    const normal = normalizeReport(report);

    const builtin = (): CellMatrix => { this.lastPath = 'builtin'; return buildMatrix(store, normal); };
    if (store.rowCount < this.threshold) return builtin();

    try {
      if (this.ready) await this.ready;
      if (!this.runner) return builtin();
      const plan = planBase(normal.measures);
      const kindOf = (f: string) => store.columns.get(f)?.kind;
      const cellBase = await computeBaseCellsViaSql(this.runner, normal, plan, kindOf);
      if (!cellBase) return builtin(); // unsupported report -> fall back
      const selection = applyFilters(store, normal);
      const matrix = assembleMatrix(store, normal, selection, plan, cellBase, normal.options.datePattern);
      this.lastPath = 'duckdb';
      return matrix;
    } catch (e) {
      console.warn('[ProPivot] DuckDB accelerator errored; using built-in engine.', e);
      return builtin();
    }
  }

  rawRows(): Array<Record<string, unknown>> { return this.rows; }

  dispose(): void {
    try { this.db?.terminate?.(); } catch { /* ignore */ }
    this.db = null;
    this.runner = null;
    this.store = null;
    this.rows = [];
  }

  /** Browser-only: instantiate duckdb-wasm and load the rows. Throws if unavailable. */
  private async load(rows: Array<Record<string, unknown>>): Promise<void> {
    if (typeof window === 'undefined' || typeof Worker === 'undefined' || typeof Blob === 'undefined') {
      throw new Error('DuckDB-WASM requires a browser environment');
    }
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const duckdb: any = await dynamicImport(this.moduleUrl);
    const bundle = await duckdb.selectBundle(duckdb.getJsDelivrBundles());
    const workerUrl = URL.createObjectURL(
      new Blob([`importScripts("${bundle.mainWorker}");`], { type: 'text/javascript' }),
    );
    const worker = new Worker(workerUrl);
    const logger = new duckdb.ConsoleLogger(duckdb.LogLevel?.WARNING ?? 2);
    const db = new duckdb.AsyncDuckDB(logger, worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    URL.revokeObjectURL(workerUrl);

    const conn = await db.connect();
    await db.registerFileText('propivot.json', JSON.stringify(rows));
    await conn.query(
      `CREATE TABLE ${ACCEL_TABLE} AS SELECT * FROM read_json_auto('propivot.json')`,
    );

    this.db = db;
    this.runner = {
      query: async (sql: string) => {
        const table: any = await conn.query(sql);
        const names: string[] = table.schema.fields.map((f: any) => f.name);
        return table.toArray().map((r: any) => {
          const o: Record<string, unknown> = {};
          for (const n of names) o[n] = r[n];
          return o;
        });
      },
    };
    /* eslint-enable @typescript-eslint/no-explicit-any */
  }
}
