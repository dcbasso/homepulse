import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { Color, LegendPosition, NgxChartsModule, ScaleType } from '@swimlane/ngx-charts';
import { TranslatePipe } from '@ngx-translate/core';

/** A single data point for bar charts (x label + y value). */
export interface ChartPoint {
  name: string;
  value: number;
}

/** A named series for line charts (series name + array of points). */
export interface ChartSeries {
  name: string;
  series: ChartPoint[];
}

/** Builds a properly typed ngx-charts Color object from a color domain array. */
export function makeColorScheme(domain: string[]): Color {
  return { name: 'custom', selectable: false, group: ScaleType.Ordinal, domain };
}

/**
 * Generic chart wrapper that renders either a line chart or a vertical bar chart
 * depending on the `type` input.
 *
 * Uses ngx-charts under the hood. Displays a skeleton placeholder while loading.
 */
@Component({
  selector: 'app-speed-chart',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgxChartsModule, TranslatePipe],
  template: `
    <div class="chart-section">
      <h3 class="chart-title">{{ title() | translate }}</h3>
      <div class="chart-wrap">
        @if (loading()) {
          <div class="chart-skeleton"></div>
        } @else if (isEmpty()) {
          <div class="chart-empty">
            <span>{{ 'DASHBOARD.NO_DATA' | translate }}</span>
          </div>
        } @else if (type() === 'line') {
          <ngx-charts-line-chart
            [results]="lineSeries()"
            [scheme]="colorScheme()"
            [xAxis]="true"
            [yAxis]="true"
            [legend]="true"
            [legendTitle]="''"
            [legendPosition]="legendBelow"
            [showXAxisLabel]="false"
            [showYAxisLabel]="true"
            [yAxisLabel]="yAxisLabel()"
            [autoScale]="true"
          />
        } @else {
          <ngx-charts-bar-vertical
            [results]="barPoints()"
            [scheme]="colorScheme()"
            [xAxis]="true"
            [yAxis]="true"
            [legend]="false"
            [showYAxisLabel]="true"
            [yAxisLabel]="yAxisLabel()"
          />
        }
      </div>
    </div>
  `,
  styles: [`
    .chart-section { margin: 1.5rem 0; }
    .chart-title {
      margin: 0 0 0.75rem;
      font-size: 0.9rem;
      font-weight: 600;
      color: var(--mat-sys-on-surface-variant);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .chart-wrap {
      height: 260px;
      width: 100%;
    }
    ngx-charts-line-chart,
    ngx-charts-bar-vertical {
      display: block;
      width: 100%;
      height: 100%;
    }
    .chart-skeleton {
      width: 100%;
      height: 100%;
      border-radius: 8px;
      background-color: var(--mat-sys-surface-variant);
      animation: pulse 1.5s ease-in-out infinite;
    }
    .chart-empty {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.9rem;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50%       { opacity: 0.4; }
    }
    :host ::ng-deep .ngx-charts text {
      fill: var(--mat-sys-on-surface-variant) !important;
    }
    :host ::ng-deep .ngx-charts .gridline-path {
      stroke: var(--mat-sys-outline-variant) !important;
    }
  `],
})
export class SpeedChartComponent {
  /** 'line' renders a line chart; 'bar' renders a vertical bar chart. */
  readonly type = input<'line' | 'bar'>('line');

  /** i18n key for the chart section heading. */
  readonly title = input<string>('');

  /** Y-axis label (units, e.g. "Mbps", "ms", "%"). */
  readonly yAxisLabel = input<string>('');

  /** Data for line charts — array of named series. */
  readonly lineSeries = input<ChartSeries[]>([]);

  /** Data for bar charts — flat array of name/value points. */
  readonly barPoints = input<ChartPoint[]>([]);

  /** ngx-charts Color scheme. */
  readonly colorScheme = input<Color>(makeColorScheme(['#4285F4']));

  /** Shows skeleton placeholder when true. */
  readonly loading = input<boolean>(false);

  /** Legend position constant used in the template. */
  protected readonly legendBelow = LegendPosition.Below;

  /**
   * Returns true when the active data set is empty (no points to render).
   * Used to show the "no data" message instead of a blank chart.
   */
  isEmpty(): boolean {
    if (this.type() === 'line') {
      return this.lineSeries().every(s => s.series.length === 0);
    }
    return this.barPoints().length === 0;
  }
}
