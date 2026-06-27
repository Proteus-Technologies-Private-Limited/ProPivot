// Vue 3 wrapper (optional). Thin mount/unmount around the ProPivot facade.
//   import { Pivot } from '@proteus/propivot/vue';
//
//   <Pivot :report="report" toolbar @cellclick="onCellClick" @ready="onReady" />
//
// The component creates a ProPivot instance on mount, forwards every facade event
// as a Vue emit, swaps the report in place when `report` changes, and disposes the
// instance on unmount.

import {
  defineComponent,
  h,
  ref,
  onMounted,
  onBeforeUnmount,
  watch,
  type PropType,
} from 'vue';
import { ProPivot, type ProPivotConfig } from '../facade/ProPivot';
import type { Report } from '../core/types';
import type { CellData } from '../facade/cell';

// Facade events forwarded as Vue emits — listen with `@cellclick`, `@ready`, etc.
const FORWARDED_EVENTS = [
  'cellclick', 'celldoubleclick', 'dataloaded', 'datachanged', 'dataerror',
  'datafilecancelled', 'fieldslistopen', 'fieldslistclose', 'filteropen',
  'fullscreen', 'loadingdata', 'loadinglocalization', 'loadingreportfile',
  'localizationerror', 'localizationloaded', 'openingreportfile', 'querycomplete',
  'queryerror', 'ready', 'reportchange', 'reportcomplete', 'reportfilecancelled',
  'reportfileerror', 'reportfileloaded', 'runningquery', 'update',
  'beforetoolbarcreated', 'aftergriddraw', 'beforegriddraw',
  'columnresize', 'columnreorder', 'columnpropertychange',
] as const;

export const Pivot = defineComponent({
  name: 'ProPivot',
  props: {
    report: { type: Object as PropType<Report>, default: undefined },
    toolbar: { type: Boolean, default: undefined },
    width: { type: [String, Number] as PropType<string | number>, default: undefined },
    height: { type: [String, Number] as PropType<string | number>, default: undefined },
    customizeCell: {
      type: Function as PropType<(cell: unknown, data: CellData) => void>,
      default: undefined,
    },
  },
  // `ready` carries the ProPivot instance; the rest mirror the facade events.
  emits: FORWARDED_EVENTS as unknown as string[],
  setup(props, { emit, expose }) {
    const el = ref<HTMLDivElement | null>(null);
    let pivot: ProPivot | null = null;

    const create = (): void => {
      if (!el.value) return;
      pivot = new ProPivot({
        container: el.value,
        report: props.report,
        toolbar: props.toolbar,
        width: props.width,
        height: props.height,
        customizeCell: props.customizeCell,
      } as ProPivotConfig);
      for (const ev of FORWARDED_EVENTS) {
        pivot.on(ev, (arg?: unknown) => emit(ev, arg));
      }
      // `ready` lets templates capture the instance even if the core doesn't emit it.
      emit('ready', pivot);
    };

    onMounted(create);

    // Swap the report in place when its identity changes (no full re-create).
    watch(
      () => props.report,
      (next) => {
        if (pivot && next) pivot.setReport(next);
      },
    );

    onBeforeUnmount(() => {
      pivot?.dispose();
      pivot = null;
    });

    // Expose the live instance for template refs: `pivotRef.value.getPivot()`.
    expose({ getPivot: () => pivot });

    return () => h('div', { ref: el, style: { height: '100%' } });
  },
});

export default Pivot;
export { ProPivot };
