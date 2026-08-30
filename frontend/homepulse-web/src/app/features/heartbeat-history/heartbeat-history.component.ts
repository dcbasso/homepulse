import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatCardModule } from '@angular/material/card';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { catchError, of, switchMap, tap } from 'rxjs';
import { FilterService } from '../../core/filter.service';
import { Heartbeat } from '../../core/models/heartbeat.model';
import { NavbarComponent } from '../../shared/navbar/navbar.component';
import { DateRangeFilterComponent } from '../../shared/date-range-filter/date-range-filter.component';
import { LiveIndicatorComponent } from '../../shared/live-indicator/live-indicator.component';
import { HeartbeatTableComponent } from './components/heartbeat-table/heartbeat-table.component';
import { HeartbeatHistoryDataService } from './heartbeat-history-data.service';

/**
 * Heartbeat History screen.
 *
 * Displays a filterable, paginated table of heartbeat documents showing
 * the external IP captured at each liveness check.
 */
@Component({
  selector: 'app-heartbeat-history',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    NavbarComponent,
    DateRangeFilterComponent,
    LiveIndicatorComponent,
    HeartbeatTableComponent,
    MatProgressSpinnerModule,
    MatCardModule,
    TranslatePipe,
  ],
  template: `
    <app-navbar>
    <main class="heartbeat-history-main">
      <h2 class="page-title">{{ 'HEARTBEAT_HISTORY.TITLE' | translate }}</h2>

      <div class="filter-row">
        <app-date-range-filter />
        <app-live-indicator [lastUpdated]="lastUpdated()" />
      </div>

      @if (!loading()) {
        <div class="summary-row">
          <mat-card appearance="outlined" class="summary-card">
            <mat-card-content>
              <span class="summary-label">{{ 'HEARTBEAT_HISTORY.UNIQUE_IPS' | translate }}</span>
              <span class="summary-value">{{ uniqueIpCount() }}</span>
            </mat-card-content>
          </mat-card>
        </div>
      }

      @if (loading()) {
        <div class="loading-row">
          <mat-spinner diameter="40" />
        </div>
      } @else {
        <app-heartbeat-table [results]="results()" />
      }
    </main>
    </app-navbar>
  `,
  styles: [`
    .heartbeat-history-main {
      max-width: 1100px;
      margin: 0 auto;
      padding: 0 1.5rem 3rem;
    }

    .page-title {
      margin: 1.5rem 0 0;
      font-size: 1.1rem;
      font-weight: 600;
      color: var(--mat-sys-on-surface);
    }

    .filter-row {
      display: flex;
      align-items: center;
      gap: 1rem;
      flex-wrap: wrap;
    }

    .loading-row {
      display: flex;
      justify-content: center;
      padding: 3rem 0;
    }

    .summary-row {
      display: flex;
      gap: 1rem;
      margin: 1rem 0;
    }

    .summary-card {
      min-width: 160px;
    }

    mat-card-content {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 0.75rem 1.25rem !important;
      gap: 0.25rem;
    }

    .summary-label {
      font-size: 0.75rem;
      color: var(--mat-sys-on-surface-variant);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .summary-value {
      font-size: 1.75rem;
      font-weight: 700;
      color: var(--mat-sys-primary);
    }
  `],
})
export class HeartbeatHistoryComponent implements OnInit {
  private dataService   = inject(HeartbeatHistoryDataService);
  private filterService = inject(FilterService);
  private snackBar      = inject(MatSnackBar);
  private translate     = inject(TranslateService);
  private destroyRef    = inject(DestroyRef);

  /** True while a Firestore query is in flight. */
  readonly loading = signal(true);

  /** Current result list for the active date range. */
  readonly results = signal<Heartbeat[]>([]);

  /** Timestamp of the most recent data received from the Firestore listener. */
  readonly lastUpdated = signal<Date | null>(null);

  /** Number of distinct external IPs in the current result set. */
  readonly uniqueIpCount = computed(() =>
    new Set(
      this.results()
        .map(r => `${r.external_ip_v4 ?? ''}|${r.external_ip_v6 ?? ''}`)
        .filter(pair => pair !== '|'),
    ).size,
  );

  /**
   * Subscribes to filter range changes and fetches matching results from Firestore.
   * On query failure, shows a snackbar and falls back to an empty list.
   */
  ngOnInit(): void {
    this.filterService.range$.pipe(
      tap(() => this.loading.set(true)),
      switchMap(range =>
        this.dataService.getResults(range.start, range.end).pipe(
          catchError(() => {
            const msg = this.translate.instant('COMMON.ERROR');
            this.snackBar.open(msg, '', { duration: 4000 });
            return of([] as Heartbeat[]);
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
