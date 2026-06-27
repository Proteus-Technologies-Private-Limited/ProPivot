// Aggregation accumulators (docs/Architecture.md).
// Streaming where possible; relative/positional functions use a sum base and
// are finished in a post-aggregation pass (see planner.ts).

import type { AggregationType } from './types';

export interface Accumulator {
  add(value: number, key: string | number | null): void;
  /** Base value for the cell (relative aggregations return their sum base). */
  value(): number;
}

class SumAcc implements Accumulator {
  private s = 0;
  private any = false;
  add(v: number) { if (!Number.isNaN(v)) { this.s += v; this.any = true; } }
  value() { return this.any ? this.s : NaN; }
}

class CountAcc implements Accumulator {
  private c = 0;
  add(_v: number, key: string | number | null) { if (key !== null) this.c++; }
  value() { return this.c; }
}

class DistinctCountAcc implements Accumulator {
  private set = new Set<string | number>();
  add(_v: number, key: string | number | null) { if (key !== null) this.set.add(key); }
  value() { return this.set.size; }
}

class AverageAcc implements Accumulator {
  private s = 0;
  private c = 0;
  add(v: number) { if (!Number.isNaN(v)) { this.s += v; this.c++; } }
  value() { return this.c ? this.s / this.c : NaN; }
}

class MinAcc implements Accumulator {
  private m = Infinity;
  private any = false;
  add(v: number) { if (!Number.isNaN(v)) { this.any = true; if (v < this.m) this.m = v; } }
  value() { return this.any ? this.m : NaN; }
}

class MaxAcc implements Accumulator {
  private m = -Infinity;
  private any = false;
  add(v: number) { if (!Number.isNaN(v)) { this.any = true; if (v > this.m) this.m = v; } }
  value() { return this.any ? this.m : NaN; }
}

class ProductAcc implements Accumulator {
  private p = 1;
  private any = false;
  add(v: number) { if (!Number.isNaN(v)) { this.p *= v; this.any = true; } }
  value() { return this.any ? this.p : NaN; }
}

class MedianAcc implements Accumulator {
  private vals: number[] = [];
  add(v: number) { if (!Number.isNaN(v)) this.vals.push(v); }
  value() {
    if (!this.vals.length) return NaN;
    const a = this.vals.slice().sort((x, y) => x - y);
    const mid = a.length >> 1;
    return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
  }
}

// Welford's online variance.
class StdevAcc implements Accumulator {
  private n = 0;
  private mean = 0;
  private m2 = 0;
  constructor(private population: boolean) {}
  add(v: number) {
    if (Number.isNaN(v)) return;
    this.n++;
    const delta = v - this.mean;
    this.mean += delta / this.n;
    this.m2 += delta * (v - this.mean);
  }
  value() {
    if (this.population) return this.n > 0 ? Math.sqrt(this.m2 / this.n) : NaN;
    return this.n > 1 ? Math.sqrt(this.m2 / (this.n - 1)) : NaN;
  }
}

/** Aggregations whose value is derived from a sum base in a post-pass. */
export const RELATIVE_AGGREGATIONS: ReadonlySet<AggregationType> = new Set<AggregationType>([
  'percent',
  'percentofcolumn',
  'percentofrow',
  'index',
  'difference',
  '%difference',
  'runningtotals',
]);

export function isRelative(agg: AggregationType): boolean {
  return RELATIVE_AGGREGATIONS.has(agg);
}

export function createAccumulator(agg: AggregationType): Accumulator {
  switch (agg) {
    case 'count': return new CountAcc();
    case 'distinctcount': return new DistinctCountAcc();
    case 'average': return new AverageAcc();
    case 'median': return new MedianAcc();
    case 'product': return new ProductAcc();
    case 'min': return new MinAcc();
    case 'max': return new MaxAcc();
    case 'stdevp': return new StdevAcc(true);
    case 'stdevs': return new StdevAcc(false);
    // sum + all relative aggregations use a sum base.
    case 'sum':
    case 'percent':
    case 'percentofcolumn':
    case 'percentofrow':
    case 'index':
    case 'difference':
    case '%difference':
    case 'runningtotals':
    case 'none':
    default:
      return new SumAcc();
  }
}

export const ALL_AGGREGATIONS: AggregationType[] = [
  'sum', 'count', 'distinctcount', 'average', 'median', 'product', 'min', 'max',
  'percent', 'percentofcolumn', 'percentofrow', 'index', 'difference',
  '%difference', 'stdevp', 'stdevs', 'runningtotals',
];

export const AGGREGATION_CAPTIONS: Record<string, string> = {
  sum: 'Sum',
  count: 'Count',
  distinctcount: 'Distinct Count',
  average: 'Average',
  median: 'Median',
  product: 'Product',
  min: 'Min',
  max: 'Max',
  percent: '% of Grand Total',
  percentofcolumn: '% of Column',
  percentofrow: '% of Row',
  index: 'Index',
  difference: 'Difference',
  '%difference': '% Difference',
  stdevp: 'Population StdDev',
  stdevs: 'Sample StdDev',
  runningtotals: 'Running Totals',
};
