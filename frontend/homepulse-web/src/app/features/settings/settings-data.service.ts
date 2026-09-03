import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { serverTimestamp } from '@angular/fire/firestore';
import { Observable, firstValueFrom, switchMap, take } from 'rxjs';
import { FirestoreService } from '../../core/firestore.service';
import { AuthService } from '../../core/auth.service';
import { HouseholdContextService } from '../../core/household-context.service';
import { MonitorConfig, Recipient, TelegramRecipient } from '../../core/models/monitor-config.model';
import { environment } from '../../../environments/environment';

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
  private householdContext = inject(HouseholdContextService);
  private http = inject(HttpClient);

  /**
   * Returns a real-time observable of the current monitor configuration for
   * the active household. Emits `undefined` when the document does not exist.
   */
  getConfig(): Observable<MonitorConfig | undefined> {
    return this.householdContext.activeHouseholdId$.pipe(
      switchMap((householdId) =>
        this.firestoreService.getDoc<MonitorConfig>(`households/${householdId}/monitor_config/current`),
      ),
    );
  }

  /**
   * Persists the monitor configuration for the active household to Firestore
   * with a server-side timestamp.
   *
   * @param config - Configuration values to write (updated_at is appended automatically).
   * @returns Promise that resolves when the write is committed.
   * @throws Error when there is no active household.
   */
  async saveConfig(config: Omit<MonitorConfig, 'updated_at'>): Promise<void> {
    const householdId = await firstValueFrom(this.householdContext.activeHouseholdId$.pipe(take(1)));
    if (!householdId) {
      throw new Error('No active household');
    }
    return this.firestoreService.setDoc(`households/${householdId}/monitor_config/current`, {
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
   * @throws Error when the caller is not signed in, there is no active household,
   *   or the Cloud Function rejects the request.
   */
  async sendTestAlert(request: TestAlertRequest): Promise<number> {
    const idToken = await this.authService.getIdToken();
    if (!idToken) {
      throw new Error('Not signed in');
    }
    const householdId = await firstValueFrom(this.householdContext.activeHouseholdId$.pipe(take(1)));
    if (!householdId) {
      throw new Error('No active household');
    }
    const response = await firstValueFrom(
      this.http.post<{ ok: boolean; sent: number }>(
        environment.testAlertFunctionUrl,
        {
          household_id: householdId,
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
