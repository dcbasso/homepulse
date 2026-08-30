import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { DEFAULT_PERIOD, DateRange, Period, rangeFromPeriod } from './models/date-range.model';

/**
 * Global date-range filter state shared by every screen with a time filter.
 *
 * State lives only in memory (no localStorage): it stays in sync while the
 * user navigates the SPA, but resets to the default period on page reload.
 */
@Injectable({ providedIn: 'root' })
export class FilterService {
  private periodSubject = new BehaviorSubject<Period>(DEFAULT_PERIOD);
  private rangeSubject = new BehaviorSubject<DateRange>(rangeFromPeriod(DEFAULT_PERIOD));

  /** Emits the currently selected period (preset or 'custom'). */
  period$: Observable<Period> = this.periodSubject.asObservable();

  /** Emits the resolved start/end date range matching the current selection. */
  range$: Observable<DateRange> = this.rangeSubject.asObservable();

  /** Currently selected period (preset or 'custom'). */
  get currentPeriod(): Period {
    return this.periodSubject.value;
  }

  /** Currently resolved start/end date range. */
  get currentRange(): DateRange {
    return this.rangeSubject.value;
  }

  /**
   * Selects a preset period and resolves it to a concrete date range.
   *
   * @param period - The preset period to activate.
   */
  setPeriod(period: Exclude<Period, 'custom'>): void {
    this.periodSubject.next(period);
    this.rangeSubject.next(rangeFromPeriod(period));
  }

  /**
   * Selects a user-defined custom date range.
   *
   * @param range - The custom start/end range to activate.
   */
  setCustomRange(range: DateRange): void {
    this.periodSubject.next('custom');
    this.rangeSubject.next(range);
  }
}
