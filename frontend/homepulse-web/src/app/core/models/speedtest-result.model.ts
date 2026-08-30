import { Timestamp } from '@angular/fire/firestore';

/** A single speedtest measurement document from the `speedtest_results` collection. */
export interface SpeedtestResult {
  id?: string;
  timestamp: Timestamp;
  download_mbps: number;
  upload_mbps: number;
  ping_ms: number;
  jitter_ms: number;
  packet_loss_pct: number;
  server?: string;
  isp?: string;
  external_ip_v4?: string;
  external_ip_v6?: string;
  result_url?: string;
}
