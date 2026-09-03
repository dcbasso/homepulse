import { Injectable, inject } from '@angular/core';
import { Observable, switchMap } from 'rxjs';
import { Timestamp, orderBy, where } from '@angular/fire/firestore';
import { FirestoreService } from '../../core/firestore.service';
import { HouseholdContextService } from '../../core/household-context.service';
import { Incident } from '../../core/models/incident.model';

/**
 * Provides Firestore queries for the active household's incidents subcollection.
 */
@Injectable({ providedIn: 'root' })
export class IncidentsDataService {
  private firestoreService = inject(FirestoreService);
  private householdContext = inject(HouseholdContextService);

  /**
   * Returns a live observable of incidents that started within the given range,
   * ordered by start time descending (most recent first).
   *
   * @param start - Start of the query window (inclusive).
   * @param end   - End of the query window (inclusive).
   * @returns Observable that emits the incident array on every Firestore change.
   */
  getIncidents(start: Date, end: Date): Observable<Incident[]> {
    return this.householdContext.activeHouseholdId$.pipe(
      switchMap((householdId) =>
        this.firestoreService.getCollection<Incident>(
          `households/${householdId}/incidents`,
          where('started_at', '>=', Timestamp.fromDate(start)),
          where('started_at', '<=', Timestamp.fromDate(end)),
          orderBy('started_at', 'desc'),
        ),
      ),
    );
  }
}
