import { Timestamp } from '@angular/fire/firestore';

/** Represents a single internet outage recorded in the `incidents` Firestore collection. */
export interface Incident {
  /** Firestore document ID. */
  id: string;
  /** Timestamp when the outage was first detected. */
  started_at: Timestamp;
  /** Timestamp when connectivity was restored, or null if the incident is ongoing. */
  recovered_at: Timestamp | null;
  /** Total outage duration in minutes, or null if the incident has not yet recovered. */
  duration_minutes: number | null;
}
