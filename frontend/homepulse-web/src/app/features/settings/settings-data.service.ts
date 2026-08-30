import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { serverTimestamp } from '@angular/fire/firestore';
import { Observable, firstValueFrom } from 'rxjs';
import { FirestoreService } from '../../core/firestore.service';
import { AuthService } from '../../core/auth.service';
import { MonitorConfig, Recipient, TelegramRecipient } from '../../core/models/monitor-config.model';
import { environment } from '../../../environments/environment';

const CONFIG_PATH = 'monitor_config/current';

/** Request payload accepted by the `send-test-alert` Cloud Function. */
export interface TestAlertRequest {
  channel: 'email' | 'telegram';
  subject: string;
  bodyTemplate: string;
  timezone: string;
  dateFormat: string;
  recipients: Recipient[] | TelegramRecipient[];
}

@Injectable({ providedIn: 'root' })
export class SettingsDataService {
  private firestoreService = inject(FirestoreService);
  private authService = inject(AuthService);
  private http = inject(HttpClient);

  /**
   * Returns a real-time observable of the current monitor configuration.
   * Emits `undefined` when the document does not exist in Firestore.
   */
  getConfig(): Observable<MonitorConfig | undefined> {
    return this.firestoreService.getDoc<MonitorConfig>(CONFIG_PATH);
  }

  /**
   * Persists the monitor configuration to Firestore with a server-side timestamp.
   *
   * @param config - Configuration values to write (updated_at is appended automatically).
   * @returns Promise that resolves when the write is committed.
   */
  saveConfig(config: Omit<MonitorConfig, 'updated_at'>): Promise<void> {
    return this.firestoreService.setDoc(CONFIG_PATH, {
      ...config,
      updated_at: serverTimestamp(),
    });
  }

  /**
   * Sends a one-off test alert (email or Telegram) using the given draft values —
   * lets the Settings screen preview a channel's subject/body/timezone/date-format
   * before saving, filled with synthetic sample data instead of a real incident.
   *
   * @param request - Channel, template, and recipient values to test with.
   * @returns Promise resolving to the number of recipients the test was sent to.
   * @throws Error when the caller is not signed in, or the Cloud Function rejects the request.
   */
  async sendTestAlert(request: TestAlertRequest): Promise<number> {
    const idToken = await this.authService.getIdToken();
    if (!idToken) {
      throw new Error('Not signed in');
    }
    const response = await firstValueFrom(
      this.http.post<{ ok: boolean; sent: number }>(
        environment.testAlertFunctionUrl,
        {
          channel: request.channel,
          subject: request.subject,
          body_template: request.bodyTemplate,
          timezone: request.timezone,
          date_format: request.dateFormat,
          recipients: request.recipients,
        },
        { headers: { Authorization: `Bearer ${idToken}` } },
      ),
    );
    return response.sent;
  }
}
