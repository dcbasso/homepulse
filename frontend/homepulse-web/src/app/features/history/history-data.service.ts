import { Injectable, inject } from '@angular/core';
import { Observable, switchMap } from 'rxjs';
import { Timestamp, orderBy, where } from '@angular/fire/firestore';
import { FirestoreService } from '../../core/firestore.service';
import { HouseholdContextService } from '../../core/household-context.service';
import { SpeedtestResult } from '../../core/models/speedtest-result.model';

/**
 * Provides Firestore queries for the history screen (active household's speedtest_results subcollection).
 */
@Injectable({ providedIn: 'root' })
export class HistoryDataService {
  private firestoreService = inject(FirestoreService);
  private householdContext = inject(HouseholdContextService);

  /**
   * Returns a live observable of speedtest results within the given date range,
   * ordered by timestamp descending (most recent first).
   *
   * @param start - Start of the query window (inclusive).
   * @param end   - End of the query window (inclusive).
   * @returns Observable that emits the result array on every Firestore change.
   */
  getResults(start: Date, end: Date): Observable<SpeedtestResult[]> {
    return this.householdContext.activeHouseholdId$.pipe(
      switchMap((householdId) =>
        this.firestoreService.getCollection<SpeedtestResult>(
          `households/${householdId}/speedtest_results`,
          where('timestamp', '>=', Timestamp.fromDate(start)),
          where('timestamp', '<=', Timestamp.fromDate(end)),
          orderBy('timestamp', 'desc'),
        ),
      ),
    );
  }
}
