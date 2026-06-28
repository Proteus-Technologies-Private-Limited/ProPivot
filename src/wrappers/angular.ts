// Angular wrapper (source — compiled by the consuming Angular project, since it
// needs @angular/core as a peer). Mirrors the @Inputs/@Outputs the existing
// dashboards bind (docs/Architecture.md). Drop into the consumer's library or
// import from a published Angular sub-package.
//
// Selector: <pro-pivot>. Migration is the single import line; the 29 outputs and
// all inputs match what the existing wrapper already binds.

/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Component, ElementRef, EventEmitter, Input, OnChanges, OnDestroy,
  Output, SimpleChanges, ViewChild,
} from '@angular/core';
// Import the engine from the published package entry (the built core) so the
// consumer's Angular toolchain only has to compile this small wrapper.
import { ProPivot } from '@proteus/propivot';
import type { Report, CellData, CellBuilder } from '@proteus/propivot';

const FORWARDED_EVENTS = [
  'cellclick', 'celldoubleclick', 'dataloaded', 'datachanged', 'dataerror',
  'datafilecancelled', 'fieldslistopen', 'fieldslistclose', 'filteropen',
  'fullscreen', 'loadingdata', 'loadinglocalization', 'loadingreportfile',
  'localizationerror', 'localizationloaded', 'openingreportfile', 'querycomplete',
  'queryerror', 'ready', 'reportchange', 'reportcomplete', 'reportfilecancelled',
  'reportfileerror', 'reportfileloaded', 'runningquery', 'update',
  'beforetoolbarcreated', 'aftergriddraw', 'beforegriddraw',
  'columnresize', 'columnreorder', 'columnpropertychange',
];

@Component({
  selector: 'pro-pivot',
  template: '<div class="pp-ng-wrapper" #wrapper></div>',
})
export class ProPivotComponent implements OnChanges, OnDestroy {
  @Input() toolbar: boolean | any;
  @Input() width: string | any;
  @Input() height: string | any;
  @Input() report: Report | any;
  @Input() global: any;
  @Input() customizeCell!: (cell: CellBuilder, data: CellData) => void;

  @Output() cellclick = new EventEmitter<CellData>();
  @Output() celldoubleclick = new EventEmitter<CellData>();
  @Output() dataloaded = new EventEmitter<object>();
  @Output() datachanged = new EventEmitter<object>();
  @Output() dataerror = new EventEmitter<object>();
  @Output() datafilecancelled = new EventEmitter<object>();
  @Output() fieldslistopen = new EventEmitter<object>();
  @Output() fieldslistclose = new EventEmitter<object>();
  @Output() filteropen = new EventEmitter<object>();
  @Output() fullscreen = new EventEmitter<object>();
  @Output() loadingdata = new EventEmitter<object>();
  @Output() loadinglocalization = new EventEmitter<object>();
  @Output() loadingreportfile = new EventEmitter<object>();
  @Output() localizationerror = new EventEmitter<object>();
  @Output() localizationloaded = new EventEmitter<object>();
  @Output() openingreportfile = new EventEmitter<object>();
  @Output() querycomplete = new EventEmitter<object>();
  @Output() queryerror = new EventEmitter<object>();
  @Output() ready = new EventEmitter<ProPivot>();
  @Output() reportchange = new EventEmitter<object>();
  @Output() reportcomplete = new EventEmitter<object>();
  @Output() reportfilecancelled = new EventEmitter<object>();
  @Output() reportfileerror = new EventEmitter<object>();
  @Output() reportfileloaded = new EventEmitter<object>();
  @Output() runningquery = new EventEmitter<object>();
  @Output() update = new EventEmitter<object>();
  @Output() beforetoolbarcreated = new EventEmitter<object>();
  @Output() aftergriddraw = new EventEmitter<object>();
  @Output() beforegriddraw = new EventEmitter<object>();
  @Output() columnresize = new EventEmitter<object>();
  @Output() columnreorder = new EventEmitter<object>();
  @Output() columnpropertychange = new EventEmitter<object>();

  @ViewChild('wrapper', { static: true }) wrapper!: ElementRef<HTMLElement>;

  pivot!: ProPivot;

  ngOnChanges(changes: SimpleChanges): void {
    if (!this.pivot) {
      this.init();
    } else if (changes['report'] && this.report) {
      this.pivot.setReport(this.report);
    }
  }

  private init(): void {
    this.pivot = new ProPivot({
      container: this.wrapper.nativeElement,
      width: this.width,
      height: this.height,
      toolbar: this.toolbar,
      report: this.report,
      global: this.global,
      customizeCell: this.customizeCell as (cell: unknown, data: CellData) => void,
    });
    for (const ev of FORWARDED_EVENTS) {
      const emitter = (this as any)[ev] as EventEmitter<any> | undefined;
      if (emitter) this.pivot.on(ev, (arg?: any) => emitter.emit(arg));
    }
  }

  ngOnDestroy(): void {
    this.pivot?.dispose();
  }
}
