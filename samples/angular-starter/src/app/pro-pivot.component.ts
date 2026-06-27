// A thin standalone Angular wrapper around the ProPivot facade.
// Selector: <pro-pivot>. Bind [report]/[toolbar]/[width]/[height] and listen to
// any of the forwarded events (cellclick, ready, reportcomplete, …).
//
// This mirrors src/wrappers/angular.ts from the ProPivot repo, but imports the
// public API from the package instead of internal paths, so you can copy it
// straight into your own app.

/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  Component, ElementRef, EventEmitter, Input, OnChanges, OnDestroy,
  Output, SimpleChanges, ViewChild,
} from '@angular/core';
import { ProPivot, type CellData, type Report } from '@proteus/propivot';

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
  standalone: true,
  template: '<div class="pp-ng-wrapper" #wrapper></div>',
  styles: [':host, .pp-ng-wrapper { display: block; height: 100%; }'],
})
export class ProPivotComponent implements OnChanges, OnDestroy {
  @Input() toolbar: boolean | any;
  @Input() width: string | any;
  @Input() height: string | any;
  @Input() report: Report | any;
  @Input() global: any;
  @Input() customizeCell!: (cell: any, data: CellData) => void;

  @Output() cellclick = new EventEmitter<CellData>();
  @Output() celldoubleclick = new EventEmitter<CellData>();
  @Output() ready = new EventEmitter<ProPivot>();
  @Output() reportcomplete = new EventEmitter<object>();
  @Output() reportchange = new EventEmitter<object>();
  @Output() update = new EventEmitter<object>();
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
      customizeCell: this.customizeCell,
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
