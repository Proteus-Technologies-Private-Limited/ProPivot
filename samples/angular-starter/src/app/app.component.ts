import { Component } from '@angular/core';
import type { CellData, Report } from '@proteus/propivot';
import { ProPivotComponent } from './pro-pivot.component';
import { buildReport, generateRows } from './sample-data';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [ProPivotComponent],
  template: `
    <div class="page">
      <header class="bar">
        <strong>ProPivot · Angular starter</strong>
        <span class="muted">{{ rowCount.toLocaleString() }} rows · client-side</span>
      </header>

      <!-- Drag fields, double-click a cell to drill through, use the toolbar to export. -->
      <pro-pivot
        class="grid"
        [report]="report"
        [toolbar]="true"
        (cellclick)="onCellClick($event)">
      </pro-pivot>
    </div>
  `,
  styles: [`
    .page { height: 100%; display: flex; flex-direction: column; }
    .bar {
      display: flex; align-items: center; gap: 12px;
      padding: 10px 16px; border-bottom: 1px solid #e6e9f0; background: #fff;
    }
    .bar .muted { color: #5b6478; font-size: 13px; }
    .grid { flex: 1; min-height: 0; }
  `],
})
export class AppComponent {
  readonly rowCount = 20_000;
  readonly report: Report = buildReport(generateRows(this.rowCount));

  onCellClick(cell: CellData): void {
    console.log('cell clicked', cell);
  }
}
