import { Injectable, inject } from '@angular/core';
import { Timestamp, orderBy, where } from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import { FirestoreService } from '../../core/firestore.service';
import { SpeedtestResult } from '../../core/models/speedtest-result.model';

@Injectable({ providedIn: 'root' })
export class DashboardDataService {
  private firestoreService = inject(FirestoreService);

  /**
   * Fetches speedtest results from Firestore within the given date range.
   *
   * Results are ordered by timestamp ascending. The Observable re-emits
   * automatically on any Firestore change within the range.
   *
   * @param start - Start of the query window (inclusive).
   * @param end - End of the query window (inclusive).
   * @returns Observable emitting the result array on every change.
   */
  getResults(start: Date, end: Date): Observable<SpeedtestResult[]> {
    return this.firestoreService.getCollection<SpeedtestResult>(
      'speedtest_results',
      where('timestamp', '>=', Timestamp.fromDate(start)),
      where('timestamp', '<=', Timestamp.fromDate(end)),
      orderBy('timestamp', 'asc'),
    );
  }
}
