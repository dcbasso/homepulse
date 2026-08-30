import { ChangeDetectionStrategy, Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatNativeDateModule } from '@angular/material/core';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { TranslatePipe } from '@ngx-translate/core';
import { FilterService } from '../../core/filter.service';
import { Period } from '../../core/models/date-range.model';

/**
 * Date range filter bar with preset options and a custom datepicker pair.
 *
 * Reads and writes the global {@link FilterService} state directly, so the
 * selected period stays in sync across every screen that renders this
 * component during the session.
 */
@Component({
  selector: 'app-date-range-filter',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    FormsModule,
    MatFormFieldModule,
    MatSelectModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatInputModule,
    MatButtonModule,
    TranslatePipe,
  ],
  template: `
    <div class="filter-bar">
      <mat-form-field appearance="outline" class="period-select">
        <mat-label>{{ 'DASHBOARD.PERIOD_LABEL' | translate }}</mat-label>
        <mat-select [(ngModel)]="selectedPeriod" (ngModelChange)="onPeriodChange($event)">
          <mat-option value="1h">{{ 'DASHBOARD.PERIOD_1H' | translate }}</mat-option>
          <mat-option value="3h">{{ 'DASHBOARD.PERIOD_3H' | translate }}</mat-option>
          <mat-option value="6h">{{ 'DASHBOARD.PERIOD_6H' | translate }}</mat-option>
          <mat-option value="12h">{{ 'DASHBOARD.PERIOD_12H' | translate }}</mat-option>
          <mat-option value="24h">{{ 'DASHBOARD.PERIOD_24H' | translate }}</mat-option>
          <mat-option value="7d">{{ 'DASHBOARD.PERIOD_7D' | translate }}</mat-option>
          <mat-option value="30d">{{ 'DASHBOARD.PERIOD_30D' | translate }}</mat-option>
          <mat-option value="custom">{{ 'DASHBOARD.CUSTOM' | translate }}</mat-option>
        </mat-select>
      </mat-form-field>

      @if (selectedPeriod === 'custom') {
        <mat-form-field appearance="outline">
          <mat-label>{{ 'DASHBOARD.FROM' | translate }}</mat-label>
          <input matInput [matDatepicker]="pickerFrom" [(ngModel)]="customStart" />
          <mat-datepicker-toggle matIconSuffix [for]="pickerFrom" />
          <mat-datepicker #pickerFrom />
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>{{ 'DASHBOARD.TO' | translate }}</mat-label>
          <input matInput [matDatepicker]="pickerTo" [(ngModel)]="customEnd" />
          <mat-datepicker-toggle matIconSuffix [for]="pickerTo" />
          <mat-datepicker #pickerTo />
        </mat-form-field>

        <button mat-raised-button color="primary" (click)="applyCustom()">
          {{ 'DASHBOARD.APPLY' | translate }}
        </button>
      }
    </div>
  `,
  styles: [`
    .filter-bar {
      display: flex;
      align-items: center;
      gap: 1rem;
      flex-wrap: wrap;
      padding: 1rem 0 0.25rem;
    }
    .period-select { width: 180px; }
    mat-form-field { margin-bottom: -1.25em; }
  `],
})
export class DateRangeFilterComponent implements OnInit {
  private filterService = inject(FilterService);

  selectedPeriod: Period = this.filterService.currentPeriod;
  customStart: Date | null = null;
  customEnd: Date | null = null;

  /**
   * Reads the currently active period/range from the shared FilterService
   * so re-mounting this component (e.g. after SPA navigation) reflects the
   * real current selection, including a 'custom' range.
   */
  ngOnInit(): void {
    this.selectedPeriod = this.filterService.currentPeriod;
    if (this.selectedPeriod === 'custom') {
      this.customStart = this.filterService.currentRange.start;
      this.customEnd = this.filterService.currentRange.end;
    }
  }

  /**
   * Handles preset selection, updating the shared filter state immediately
   * unless the user switched to "custom" (which requires explicit Apply).
   *
   * @param period - The newly selected period option.
   */
  onPeriodChange(period: Period): void {
    if (period !== 'custom') {
      this.filterService.setPeriod(period);
    }
  }

  /**
   * Validates and applies the user-defined custom range to the shared filter state.
   * No-ops if either date input is empty.
   */
  applyCustom(): void {
    if (this.customStart && this.customEnd) {
      this.filterService.setCustomRange({ start: this.customStart, end: this.customEnd });
    }
  }
}
