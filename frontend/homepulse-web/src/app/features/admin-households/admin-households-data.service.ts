import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth.service';
import { environment } from '../../../environments/environment';

/** Account-level metadata for one household, as returned by `list-households`. */
export interface HouseholdSummary {
  id: string;
  name: string;
  status: string;
  ownerEmail: string | null;
  apiKeyCount: number;
}

/** Wire shape returned by the `list-households` Cloud Function. */
interface ListHouseholdsResponse {
  households: {
    id: string;
    name: string;
    status: string;
    owner_email: string | null;
    api_key_count: number;
  }[];
}

/**
 * Fetches the platform-wide households list for the super-admin overview
 * screen. Never fetches a household's private data (speedtest results,
 * incidents, IPs) — only account-level metadata (see `list_households` in
 * the backend's `main.py`).
 */
@Injectable({ providedIn: 'root' })
export class AdminHouseholdsDataService {
  private authService = inject(AuthService);
  private http = inject(HttpClient);

  /**
   * Lists every household on the platform.
   *
   * @returns Promise resolving to the list of households, most recently
   *   created ones included in whatever order the backend returns.
   * @throws Error when the caller is not signed in, or the Cloud Function
   *   rejects the request (e.g. the caller isn't the super-admin).
   */
  async listHouseholds(): Promise<HouseholdSummary[]> {
    const idToken = await this.authService.getIdToken();
    if (!idToken) {
      throw new Error('Not signed in');
    }
    const response = await firstValueFrom(
      this.http.post<ListHouseholdsResponse>(
        environment.listHouseholdsFunctionUrl,
        {},
        { headers: { Authorization: `Bearer ${idToken}` } },
      ),
    );
    return response.households.map((h) => ({
      id: h.id,
      name: h.name,
      status: h.status,
      ownerEmail: h.owner_email,
      apiKeyCount: h.api_key_count,
    }));
  }

  /**
   * Invites an email address into its own new, private household and sends
   * them the invite email. Restricted server-side to the super-admin.
   * Re-inviting an email that already belongs to a household is
   * idempotent: no duplicate household is created.
   *
   * @param email - Email address of the person to invite.
   * @throws Error when the caller is not signed in, or the Cloud Function
   *   rejects the request.
   */
  async inviteHousehold(email: string): Promise<void> {
    const idToken = await this.authService.getIdToken();
    if (!idToken) {
      throw new Error('Not signed in');
    }
    await firstValueFrom(
      this.http.post<{ ok: boolean; household_id: string }>(
        environment.inviteFunctionUrl,
        { member_email: email },
        { headers: { Authorization: `Bearer ${idToken}` } },
      ),
    );
  }
}
