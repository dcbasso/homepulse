import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { inject } from '@angular/core';
import { IncidentPattern } from '../../../../core/models/incident-pattern.model';

/** Pads a number to two digits. */
function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** Formats a 2-hour window as "HH:00 – HH:00". */
function hourRangeLabel(start: number, end: number): string {
  return `${pad(start)}:00 – ${pad(end === 24 ? 0 : end)}:00`;
}

/** Formats minutes as "Xh YYmin" or "Ymin". */
function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${pad(m)}min` : `${m}min`;
}

/** Formats an ISO date string "YYYY-MM-DD" to "DD/MM/YYYY". */
function formatIsoDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
}

/**
 * Displays the pre-computed IncidentPattern as a read-only summary panel.
 * Renders nothing when pattern is null (no incidents in the selected period).
 */
@Component({
  selector: 'app-incident-pattern',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatCardModule, MatIconModule, TranslatePipe],
  template: `
    @if (pattern()) {
      <mat-card class="pattern-card">
        <mat-card-header>
          <mat-card-title>{{ 'INCIDENTS.PATTERN_TITLE' | translate }}</mat-card-title>
        </mat-card-header>
        <mat-card-content>
          <div class="pattern-grid">

            @if (pattern()!.peakHourRange) {
              <div class="pattern-row">
                <mat-icon class="row-icon warning">schedule</mat-icon>
                <span class="row-label">{{ 'INCIDENTS.PATTERN_PEAK_HOUR' | translate }}</span>
                <span class="row-value">
                  {{ peakHourLabel() }}
                  <span class="row-count">({{ pattern()!.peakHourRange!.count }})</span>
                </span>
              </div>
            }

            @if (pattern()!.peakWeekday !== null) {
              <div class="pattern-row">
                <mat-icon class="row-icon warning">calendar_today</mat-icon>
                <span class="row-label">{{ 'INCIDENTS.PATTERN_PEAK_WEEKDAY' | translate }}</span>
                <span class="row-value">
                  {{ 'INCIDENTS.WEEKDAY_' + pattern()!.peakWeekday!.weekdayIndex | translate }}
                  <span class="row-count">({{ pattern()!.peakWeekday!.count }})</span>
                </span>
              </div>
            }

            @if (pattern()!.worstDay) {
              <div class="pattern-row">
                <mat-icon class="row-icon danger">event_busy</mat-icon>
                <span class="row-label">{{ 'INCIDENTS.PATTERN_WORST_DAY' | translate }}</span>
                <span class="row-value">
                  {{ worstDayLabel() }}
                  <span class="row-count">({{ pattern()!.worstDay!.count }}
                    @if (pattern()!.worstDay!.totalMinutes > 0) {
                      · {{ worstDayMinutesLabel() }}
                    }
                  )</span>
                </span>
              </div>
            }

            @if (pattern()!.stableHourRange) {
              <div class="pattern-row">
                <mat-icon class="row-icon stable">check_circle</mat-icon>
                <span class="row-label">{{ 'INCIDENTS.PATTERN_STABLE_HOUR' | translate }}</span>
                <span class="row-value stable">{{ stableHourLabel() }}</span>
              </div>
            }

            @if (pattern()!.avgDurationMinutes !== null) {
              <div class="pattern-row">
                <mat-icon class="row-icon neutral">timer</mat-icon>
                <span class="row-label">{{ 'INCIDENTS.PATTERN_AVG_DURATION' | translate }}</span>
                <span class="row-value">{{ avgDurationLabel() }}</span>
              </div>
            }

            @if (pattern()!.longestIncident) {
              <div class="pattern-row">
                <mat-icon class="row-icon danger">hourglass_top</mat-icon>
                <span class="row-label">{{ 'INCIDENTS.PATTERN_LONGEST' | translate }}</span>
                <span class="row-value">
                  {{ longestLabel() }}
                  <span class="row-count">({{ formatIsoDate(pattern()!.longestIncident!.date) }})</span>
                </span>
              </div>
            }

          </div>
        </mat-card-content>
      </mat-card>
    }
  `,
  styles: [`
    .pattern-card {
      margin-bottom: 1.5rem;
    }

    mat-card-header {
      padding-bottom: 0.25rem;
    }

    .pattern-grid {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      padding-top: 0.75rem;
    }

    .pattern-row {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .row-icon {
      font-size: 1.1rem;
      width: 1.1rem;
      height: 1.1rem;
      flex-shrink: 0;
    }

    .row-icon.warning { color: #f29900; }
    .row-icon.danger  { color: #ea4335; }
    .row-icon.stable  { color: #34a853; }
    .row-icon.neutral { color: var(--mat-sys-on-surface-variant); }

    .row-label {
      font-size: 0.85rem;
      color: var(--mat-sys-on-surface-variant);
      min-width: 160px;
      flex-shrink: 0;
    }

    .row-value {
      font-size: 0.95rem;
      font-weight: 600;
      color: var(--mat-sys-on-surface);
    }

    .row-value.stable { color: #34a853; }

    .row-count {
      font-size: 0.8rem;
      font-weight: 400;
      color: var(--mat-sys-on-surface-variant);
      margin-left: 0.25rem;
    }
  `],
})
export class IncidentPatternComponent {
  /** Pattern report to display. When null, the component renders nothing. */
  readonly pattern = input<IncidentPattern | null>(null);

  private translate = inject(TranslateService);

  readonly peakHourLabel = computed(() => {
    const r = this.pattern()?.peakHourRange;
    return r ? hourRangeLabel(r.startHour, r.endHour) : '';
  });

  readonly stableHourLabel = computed(() => {
    const r = this.pattern()?.stableHourRange;
    return r ? hourRangeLabel(r.startHour, r.endHour) : '';
  });

  readonly worstDayLabel = computed(() => {
    const d = this.pattern()?.worstDay;
    return d ? formatIsoDate(d.date) : '';
  });

  readonly worstDayMinutesLabel = computed(() => {
    const d = this.pattern()?.worstDay;
    return d ? formatMinutes(d.totalMinutes) : '';
  });

  readonly avgDurationLabel = computed(() => {
    const m = this.pattern()?.avgDurationMinutes;
    return m != null ? formatMinutes(m) : '';
  });

  readonly longestLabel = computed(() => {
    const l = this.pattern()?.longestIncident;
    return l ? formatMinutes(l.durationMinutes) : '';
  });

  protected readonly formatIsoDate = formatIsoDate;
}
