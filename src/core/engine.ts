// Engine abstraction (docs/Architecture.md). A LocalEngine runs the columnar
// store + planner inline; a WorkerEngine offloads them to a Web Worker. Both
// expose the same async-friendly interface so the facade is engine-agnostic.

import { buildStore, type ColumnStore } from './store';
import { normalizeReport } from './normalize';
import { buildMatrix } from './planner';
import type { CellMatrix, SerializedMatrix } from './matrix';
import { serializeMatrix, deserializeMatrix } from './matrix';
import type { Mapping, Report } from './types';

export interface PivotEngine {
  setData(data: unknown, mapping?: Mapping): Promise<void> | void;
  compute(report: Report): Promise<CellMatrix>;
  /** Raw rows for getData/export (main-thread copy). */
  rawRows(): Array<Record<string, unknown>>;
  dispose(): void;
}

/** Synchronous, main-thread engine (default). */
export class LocalEngine implements PivotEngine {
  private store: ColumnStore | null = null;

  setData(data: unknown, mapping?: Mapping): void {
    this.store = buildStore(data as never, mapping);
  }

  /** Synchronous build (used directly inside a Worker). */
  computeSync(report: Report): CellMatrix {
    if (!this.store) this.setData(report.dataSource?.data, report.dataSource?.mapping);
    return buildMatrix(this.store!, normalizeReport(report));
  }

  async compute(report: Report): Promise<CellMatrix> {
    return this.computeSync(report);
  }

  rawRows(): Array<Record<string, unknown>> {
    return this.store?.rawRows ?? [];
  }

  dispose(): void {
    this.store = null;
  }
}

interface Pending {
  resolve: (m: CellMatrix) => void;
  reject: (e: unknown) => void;
}

/** Web Worker engine. Falls back to LocalEngine when Workers are unavailable. */
export class WorkerEngine implements PivotEngine {
  private worker: Worker;
  private seq = 0;
  private pending = new Map<number, Pending>();
  private rows: Array<Record<string, unknown>> = [];

  constructor(workerUrl: string) {
    this.worker = new Worker(workerUrl, { type: 'module' });
    this.worker.onmessage = (e: MessageEvent) => {
      const msg = e.data as { type: string; id: number; matrix?: SerializedMatrix; error?: string };
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error));
      else if (msg.matrix) p.resolve(deserializeMatrix(msg.matrix));
    };
  }

  setData(data: unknown, mapping?: Mapping): void {
    this.rows = Array.isArray(data) && !Array.isArray((data as unknown[])[0]) ? (data as Array<Record<string, unknown>>) : [];
    this.worker.postMessage({ type: 'setData', id: ++this.seq, data, mapping });
  }

  compute(report: Report): Promise<CellMatrix> {
    const id = ++this.seq;
    // Strip data from the compute message: the worker keeps the ingested store.
    const lean: Report = { ...report, dataSource: { ...(report.dataSource ?? {}), data: undefined } };
    return new Promise<CellMatrix>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ type: 'compute', id, report: lean });
    });
  }

  rawRows(): Array<Record<string, unknown>> {
    return this.rows;
  }

  dispose(): void {
    this.worker.terminate();
    this.pending.clear();
  }
}

export { serializeMatrix };
