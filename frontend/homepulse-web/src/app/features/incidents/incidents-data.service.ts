import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { Timestamp, orderBy, where } from '@angular/fire/firestore';
import { FirestoreService } from '../../core/firestore.service';
import { Incident } from '../../core/models/incident.model';

/**
 * Provides Firestore queries for the incidents collection.
 */
@Injectable({ providedIn: 'root' })
export class IncidentsDataService {
  private firestoreService = inject(FirestoreService);

  /**
   * Returns a live observable of incidents that started within the given range,
   * ordered by start time descending (most recent first).
   *
   * @param start - Start of the query window (inclusive).
   * @param end   - End of the query window (inclusive).
   * @returns Observable that emits the incident array on every Firestore change.
   */
  getIncidents(start: Date, end: Date): Observable<Incident[]> {
    return this.firestoreService.getCollection<Incident>(
      'incidents',
      where('started_at', '>=', Timestamp.fromDate(start)),
      where('started_at', '<=', Timestamp.fromDate(end)),
      orderBy('started_at', 'desc'),
    );
  }
}
