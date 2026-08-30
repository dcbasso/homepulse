import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { catchError, of, switchMap, tap } from 'rxjs';
import { Timestamp } from '@angular/fire/firestore';
import { FilterService } from '../../core/filter.service';
import { SpeedtestResult } from '../../core/models/speedtest-result.model';
import { NavbarComponent } from '../../shared/navbar/navbar.component';
import { DashboardDataService } from './dashboard-data.service';
import { DateRangeFilterComponent } from '../../shared/date-range-filter/date-range-filter.component';
import { LiveIndicatorComponent } from '../../shared/live-indicator/live-indicator.component';
import { MetricsCardsComponent } from './components/metrics-cards/metrics-cards.component';
import { ChartPoint, ChartSeries, SpeedChartComponent, makeColorScheme } from './components/speed-chart/speed-chart.component';
import { Color } from '@swimlane/ngx-charts';

const COLOR_SPEED:   Color = makeColorScheme(['#4285F4', '#34A853']); // download blue, upload green
const COLOR_LATENCY: Color = makeColorScheme(['#FF9800', '#9E9E9E']); // ping orange, jitter gray
const COLOR_LOSS:    Color = makeColorScheme(['#EA4335']);             // packet loss red

/** Formats a Firestore Timestamp to "DD/MM HH:mm" for chart X axis labels. */
function formatTs(ts: Timestamp): string {
  const d = ts.toDate();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Builds a single-metric ChartSeries from a result array. */
function toSeries(name: string, results: SpeedtestResult[], getValue: (r: SpeedtestResult) => number): ChartSeries {
  return {
    name,
    series: results.map(r => ({ name: formatTs(r.timestamp), value: getValue(r) })),
  };
}

/**
 * Main dashboard screen.
 *
 * Orchestrates the date range filter, metric summary cards, and three charts
 * (download+upload speed, ping+jitter latency, packet loss). All data comes
 * from Firestore via DashboardDataService and re-emits live on collection changes.
 */
@Component({
  selector: 'app-dashboard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NavbarComponent,
    DateRangeFilterComponent,
    LiveIndicatorComponent,
    MetricsCardsComponent,
    SpeedChartComponent,
    TranslatePipe,
  ],
  template: `
    <app-navbar>
    <main class="dashboard-main">
      <div class="filter-row">
        <app-date-range-filter />
        <app-live-indicator [lastUpdated]="lastUpdated()" />
      </div>

      <app-metrics-cards [results]="results()" [loading]="loading()" />

      @if (!loading() && results().length === 0) {
        <p class="no-data">{{ 'DASHBOARD.NO_DATA' | translate }}</p>
      }

      <app-speed-chart
        type="line"
        title="DASHBOARD.CHART_DOWNLOAD_UPLOAD"
        yAxisLabel="Mbps"
        [lineSeries]="speedSeries()"
        [colorScheme]="colorSpeed"
        [loading]="loading()"
      />

      <app-speed-chart
        type="line"
        title="DASHBOARD.CHART_PING_JITTER"
        yAxisLabel="ms"
        [lineSeries]="latencySeries()"
        [colorScheme]="colorLatency"
        [loading]="loading()"
      />

      <app-speed-chart
        type="bar"
        title="DASHBOARD.CHART_PACKET_LOSS"
        yAxisLabel="%"
        [barPoints]="lossPoints()"
        [colorScheme]="colorLoss"
        [loading]="loading()"
      />
    </main>
    </app-navbar>
  `,
  styles: [`
    .dashboard-main {
      max-width: 1200px;
      margin: 0 auto;
      padding: 0 1.5rem 3rem;
    }
    .filter-row {
      display: flex;
      align-items: center;
      gap: 1rem;
      flex-wrap: wrap;
    }
    .no-data {
      text-align: center;
      color: var(--mat-sys-on-surface-variant);
      padding: 2rem 0;
      font-size: 0.9rem;
    }
  `],
})
export class DashboardComponent implements OnInit {
  private dataService   = inject(DashboardDataService);
  private filterService = inject(FilterService);
  private snackBar      = inject(MatSnackBar);
  private translate     = inject(TranslateService);
  private destroyRef    = inject(DestroyRef);

  private langChange = toSignal(this.translate.onLangChange, { initialValue: null });

  /** Exposed color schemes for template binding. */
  protected readonly colorSpeed   = COLOR_SPEED;
  protected readonly colorLatency = COLOR_LATENCY;
  protected readonly colorLoss    = COLOR_LOSS;

  /** True while a Firestore query is in flight. */
  readonly loading = signal(true);

  /** Latest result set for the active date range. */
  readonly results = signal<SpeedtestResult[]>([]);

  /** Timestamp of the most recent data received from the Firestore listener. */
  readonly lastUpdated = signal<Date | null>(null);

  /** Line chart series for download and upload speed (Mbps). */
  readonly speedSeries = computed<ChartSeries[]>(() => {
    this.langChange();
    return [
      toSeries(this.translate.instant('DASHBOARD.DOWNLOAD'), this.results(), r => r.download_mbps),
      toSeries(this.translate.instant('DASHBOARD.UPLOAD'),   this.results(), r => r.upload_mbps),
    ];
  });

  /** Line chart series for ping and jitter latency (ms). */
  readonly latencySeries = computed<ChartSeries[]>(() => {
    this.langChange();
    return [
      toSeries(this.translate.instant('DASHBOARD.PING'),    this.results(), r => r.ping_ms),
      toSeries(this.translate.instant('DASHBOARD.JITTER'),  this.results(), r => r.jitter_ms),
    ];
  });

  /** Bar chart points for packet loss (%). */
  readonly lossPoints = computed<ChartPoint[]>(() =>
    this.results().map(r => ({ name: formatTs(r.timestamp), value: r.packet_loss_pct }))
  );

  /**
   * Subscribes to filter range changes and fetches matching Firestore data.
   * Shows a snackbar on query failure and falls back to an empty result set.
   */
  ngOnInit(): void {
    this.filterService.range$.pipe(
      tap(() => this.loading.set(true)),
      switchMap(range =>
        this.dataService.getResults(range.start, range.end).pipe(
          catchError((err) => {
            console.error('[Dashboard] Firestore error:', err);
            const msg = this.translate.instant('COMMON.ERROR');
            this.snackBar.open(msg, '', { duration: 4000 });
            return of([] as SpeedtestResult[]);
          }),
        ),
      ),
      takeUntilDestroyed(this.destroyRef),
    ).subscribe(results => {
      this.results.set(results);
      this.loading.set(false);
      this.lastUpdated.set(new Date());
    });
  }
}
