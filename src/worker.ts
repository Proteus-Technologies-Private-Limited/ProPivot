// Web Worker entry (docs/Architecture.md). Built to dist/propivot.worker.js.
// Keeps the ingested columnar store and answers compute requests off the main
// thread so the UI never blocks during a re-pivot.

import { LocalEngine, serializeMatrix } from './core/engine';
import type { Report, Mapping } from './core/types';

const engine = new LocalEngine();

type InMsg =
  | { type: 'setData'; id: number; data: unknown; mapping?: Mapping }
  | { type: 'compute'; id: number; report: Report };

const ctx = self as unknown as Worker;

ctx.onmessage = (e: MessageEvent<InMsg>) => {
  const msg = e.data;
  try {
    if (msg.type === 'setData') {
      engine.setData(msg.data, msg.mapping);
      ctx.postMessage({ type: 'setData', id: msg.id, ok: true });
    } else if (msg.type === 'compute') {
      const matrix = engine.computeSync(msg.report);
      ctx.postMessage({ type: 'compute', id: msg.id, matrix: serializeMatrix(matrix) });
    }
  } catch (err) {
    ctx.postMessage({ type: msg.type, id: msg.id, error: (err as Error).message });
  }
};
