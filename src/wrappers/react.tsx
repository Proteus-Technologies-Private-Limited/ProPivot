// React wrapper (optional). Thin mount/unmount around the ProPivot facade.
//   import { Pivot } from '@proteus/propivot/react';

import * as React from 'react';
import { ProPivot, type ProPivotConfig } from '../facade/ProPivot';
import type { Report } from '../core/types';
import type { CellData } from '../facade/cell';

export interface PivotProps extends Omit<ProPivotConfig, 'container'> {
  report?: Report;
  toolbar?: boolean;
  width?: string | number;
  height?: string | number;
  customizeCell?: (cell: unknown, data: CellData) => void;
  className?: string;
  style?: React.CSSProperties;
  /** Called with the ProPivot instance once mounted. */
  onReady?: (pivot: ProPivot) => void;
}

export function Pivot(props: PivotProps): React.ReactElement {
  const { className, style, onReady, ...config } = props;
  const elRef = React.useRef<HTMLDivElement | null>(null);
  const onReadyRef = React.useRef(onReady);
  onReadyRef.current = onReady;

  React.useEffect(() => {
    if (!elRef.current) return;
    const pivot = new ProPivot({ ...(config as ProPivotConfig), container: elRef.current });
    onReadyRef.current?.(pivot);
    return () => pivot.dispose();
    // Re-create when the report identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.report]);

  return React.createElement('div', { ref: elRef, className, style });
}

export default Pivot;
export { ProPivot };
