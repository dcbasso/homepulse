import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { DatePipe } from '@angular/common';
import { TranslatePipe } from '@ngx-translate/core';

/**
 * Small pulsing-dot badge showing that the screen's data comes from a live
 * Firestore listener, alongside the timestamp of the last received update.
 */
@Component({
  selector: 'app-live-indicator',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, TranslatePipe],
  template: `
    <div class="live-indicator">
      <span class="dot"></span>
      <span class="label">{{ 'COMMON.LIVE' | translate }}</span>
      @if (lastUpdated(); as updated) {
        <span class="timestamp">
          {{ 'COMMON.LAST_UPDATED' | translate: { time: (updated | date: 'HH:mm:ss') } }}
        </span>
      }
    </div>
  `,
  styles: [`
    .live-indicator {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      font-size: 0.8rem;
      color: var(--mat-sys-on-surface-variant);
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background-color: #34A853;
      animation: pulse 2s ease-in-out infinite;
    }
    .label {
      font-weight: 600;
      color: #34A853;
    }
    .timestamp {
      color: var(--mat-sys-on-surface-variant);
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.35; }
    }
    @media (prefers-reduced-motion: reduce) {
      .dot { animation: none; }
    }
  `],
})
export class LiveIndicatorComponent {
  /** Timestamp of the most recent data received from the Firestore listener. */
  lastUpdated = input<Date | null>(null);
}
