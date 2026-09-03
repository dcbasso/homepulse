import { Injectable, inject } from '@angular/core';
import { Observable, switchMap } from 'rxjs';
import { Timestamp, orderBy, where } from '@angular/fire/firestore';
import { FirestoreService } from '../../core/firestore.service';
import { HouseholdContextService } from '../../core/household-context.service';
import { Heartbeat } from '../../core/models/heartbeat.model';

/**
 * Provides Firestore queries for the heartbeat history screen.
 *
 * Reads from the active household's `heartbeats` subcollection — the
 * lightweight liveness collection written by the client independently of
 * the (heavier, less frequent) speedtest.
 */
@Injectable({ providedIn: 'root' })
export class HeartbeatHistoryDataService {
  private firestoreService = inject(FirestoreService);
  private householdContext = inject(HouseholdContextService);

  /**
   * Returns a live observable of heartbeat documents within the given time range,
   * ordered by timestamp descending (most recent first).
   *
   * @param start - Start of the query window (inclusive).
   * @param end   - End of the query window (inclusive).
   * @returns Observable that emits the heartbeat array on every Firestore change.
   */
  getResults(start: Date, end: Date): Observable<Heartbeat[]> {
    return this.householdContext.activeHouseholdId$.pipe(
      switchMap((householdId) =>
        this.firestoreService.getCollection<Heartbeat>(
          `households/${householdId}/heartbeats`,
          where('timestamp', '>=', Timestamp.fromDate(start)),
          where('timestamp', '<=', Timestamp.fromDate(end)),
          orderBy('timestamp', 'desc'),
        ),
      ),
    );
  }
}
