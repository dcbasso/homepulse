import { Timestamp } from '@angular/fire/firestore';

/** A single heartbeat document from the `heartbeats` collection. */
export interface Heartbeat {
  id?: string;
  timestamp: Timestamp;
  external_ip_v4?: string;
  external_ip_v6?: string;
}
