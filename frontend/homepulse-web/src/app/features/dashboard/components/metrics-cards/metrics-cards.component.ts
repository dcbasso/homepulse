import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { TranslatePipe } from '@ngx-translate/core';
import { SpeedtestResult } from '../../../../core/models/speedtest-result.model';

interface MetricStats {
  avg: string;
  min: string;
  max: string;
}

interface MetricsSnapshot {
  download: MetricStats;
  upload: MetricStats;
  ping: MetricStats;
  jitter: MetricStats;
  packetLoss: MetricStats;
}

const DASH = '—';

/** Computes avg/min/max for a numeric array, returning dashes for empty arrays. */
function calcStats(values: number[], decimals: number): MetricStats {
  if (values.length === 0) return { avg: DASH, min: DASH, max: DASH };
  const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
  return {
    avg: avg.toFixed(decimals),
    min: Math.min(...values).toFixed(decimals),
    max: Math.max(...values).toFixed(decimals),
  };
}

/**
 * Displays five metric summary cards (download, upload, ping, jitter, packet loss)
 * with average, min, and max values derived from the provided result set.
 *
 * Shows skeleton placeholders while data is loading.
 */
@Component({
  selector: 'app-metrics-cards',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatCardModule, TranslatePipe],
  template: `
    <div class="cards-row">
      @if (loading()) {
        @for (n of [1, 2, 3, 4, 5]; track n) {
          <div class="metric-card skeleton"></div>
        }
      } @else {
        <mat-card class="metric-card">
          <mat-card-content>
            <p class="metric-label">{{ 'DASHBOARD.DOWNLOAD' | translate }} {{ 'DASHBOARD.AVG' | translate }}</p>
            <p class="metric-value">{{ stats().download.avg }}<span class="metric-unit"> Mbps</span></p>
            <p class="metric-minmax">
              {{ 'DASHBOARD.MIN' | translate }}: {{ stats().download.min }} /
              {{ 'DASHBOARD.MAX' | translate }}: {{ stats().download.max }}
            </p>
          </mat-card-content>
        </mat-card>

        <mat-card class="metric-card">
          <mat-card-content>
            <p class="metric-label">{{ 'DASHBOARD.UPLOAD' | translate }} {{ 'DASHBOARD.AVG' | translate }}</p>
            <p class="metric-value">{{ stats().upload.avg }}<span class="metric-unit"> Mbps</span></p>
            <p class="metric-minmax">
              {{ 'DASHBOARD.MIN' | translate }}: {{ stats().upload.min }} /
              {{ 'DASHBOARD.MAX' | translate }}: {{ stats().upload.max }}
            </p>
          </mat-card-content>
        </mat-card>

        <mat-card class="metric-card">
          <mat-card-content>
            <p class="metric-label">{{ 'DASHBOARD.PING' | translate }} {{ 'DASHBOARD.AVG' | translate }}</p>
            <p class="metric-value">{{ stats().ping.avg }}<span class="metric-unit"> ms</span></p>
            <p class="metric-minmax">
              {{ 'DASHBOARD.MIN' | translate }}: {{ stats().ping.min }} /
              {{ 'DASHBOARD.MAX' | translate }}: {{ stats().ping.max }}
            </p>
          </mat-card-content>
        </mat-card>

        <mat-card class="metric-card">
          <mat-card-content>
            <p class="metric-label">{{ 'DASHBOARD.JITTER' | translate }} {{ 'DASHBOARD.AVG' | translate }}</p>
            <p class="metric-value">{{ stats().jitter.avg }}<span class="metric-unit"> ms</span></p>
            <p class="metric-minmax">
              {{ 'DASHBOARD.MIN' | translate }}: {{ stats().jitter.min }} /
              {{ 'DASHBOARD.MAX' | translate }}: {{ stats().jitter.max }}
            </p>
          </mat-card-content>
        </mat-card>

        <mat-card class="metric-card">
          <mat-card-content>
            <p class="metric-label">{{ 'DASHBOARD.PACKET_LOSS' | translate }}</p>
            <p class="metric-value">{{ stats().packetLoss.avg }}<span class="metric-unit"> %</span></p>
            <p class="metric-minmax">
              {{ 'DASHBOARD.MIN' | translate }}: {{ stats().packetLoss.min }} /
              {{ 'DASHBOARD.MAX' | translate }}: {{ stats().packetLoss.max }}
            </p>
          </mat-card-content>
        </mat-card>
      }
    </div>
  `,
  styles: [`
    .cards-row {
      display: flex;
      gap: 1rem;
      flex-wrap: wrap;
      margin: 1rem 0;
    }
    .metric-card {
      flex: 1;
      min-width: 150px;
    }
    .skeleton {
      height: 110px;
      border-radius: 12px;
      background-color: var(--mat-sys-surface-variant);
      animation: pulse 1.5s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50%       { opacity: 0.4; }
    }
    mat-card-content { padding-top: 1rem !important; }
    .metric-label {
      margin: 0 0 0.25rem;
      font-size: 0.75rem;
      color: var(--mat-sys-on-surface-variant);
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .metric-value {
      margin: 0;
      font-size: 1.6rem;
      font-weight: 700;
      color: var(--mat-sys-on-surface);
      line-height: 1.2;
    }
    .metric-unit {
      font-size: 0.85rem;
      font-weight: 400;
      color: var(--mat-sys-on-surface-variant);
    }
    .metric-minmax {
      margin: 0.25rem 0 0;
      font-size: 0.72rem;
      color: var(--mat-sys-on-surface-variant);
    }
  `],
})
export class MetricsCardsComponent {
  /** Speedtest results for the active period. */
  readonly results = input<SpeedtestResult[]>([]);

  /** When true, renders skeleton placeholders instead of real values. */
  readonly loading = input<boolean>(false);

  /**
   * Derives avg/min/max statistics for all five metrics from the current results.
   * Recomputed reactively whenever `results` changes.
   */
  readonly stats = computed<MetricsSnapshot>(() => {
    const r = this.results();
    return {
      download:   calcStats(r.map(x => x.download_mbps),   1),
      upload:     calcStats(r.map(x => x.upload_mbps),     1),
      ping:       calcStats(r.map(x => x.ping_ms),         0),
      jitter:     calcStats(r.map(x => x.jitter_ms),       1),
      packetLoss: calcStats(r.map(x => x.packet_loss_pct), 2),
    };
  });
}
