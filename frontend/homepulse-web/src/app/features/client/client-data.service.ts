import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Firestore, doc, getDoc } from '@angular/fire/firestore';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth.service';
import { Household } from '../../core/models/household.model';
import { HouseholdContextService } from '../../core/household-context.service';
import { environment } from '../../../environments/environment';

/**
 * Version of the homepulse-client binary published at
 * `public/downloads/homepulse-client-linux-x86_64` — this repository is
 * private, so the browser cannot resolve the latest release through
 * GitHub's public API; the binary is instead built locally
 * (`cargo build --release` in client/homepulse-client) and copied into the
 * frontend's static assets before each deploy. Bump this constant whenever
 * that file is replaced with a newer build.
 */
export const CLIENT_VERSION = '0.1.1';

/** Path (relative to the site root) the Linux binary is served from. */
const LINUX_DOWNLOAD_PATH = '/downloads/homepulse-client-linux-x86_64';

/** The downloadable homepulse-client Linux build bundled with this deploy. */
export interface ClientRelease {
  version: string;
  downloadUrl: string;
}

/**
 * Backs the Client screen: issuing self-service ingest API keys and
 * exposing the bundled homepulse-client binary for download.
 */
@Injectable({ providedIn: 'root' })
export class ClientDataService {
  private http = inject(HttpClient);
  private firestore = inject(Firestore);
  private authService = inject(AuthService);
  private householdContext = inject(HouseholdContextService);

  /**
   * Issues a new ingest API key for the active household, self-service from
   * the UI. Restricted server-side to owner/admin callers. The raw key is
   * returned exactly once — it is never persisted in clear text anywhere.
   *
   * @param label - Optional human-readable label to identify the key later.
   * @throws Error when the caller is not signed in, there is no active
   *   household, or the Cloud Function rejects the request.
   */
  async issueApiKey(label?: string): Promise<string> {
    const idToken = await this.authService.getIdToken();
    if (!idToken) {
      throw new Error('Not signed in');
    }
    const householdId = this.householdContext.activeHousehold()?.id;
    if (!householdId) {
      throw new Error('No active household');
    }
    const response = await firstValueFrom(
      this.http.post<{ api_key: string }>(
        environment.issueApiKeyFunctionUrl,
        { household_id: householdId, label },
        { headers: { Authorization: `Bearer ${idToken}` } },
      ),
    );
    return response.api_key;
  }

  /**
   * Returns the homepulse-client Linux build bundled with this deploy.
   *
   * @returns The bundled release's version and download path.
   */
  getLinuxRelease(): ClientRelease {
    return { version: CLIENT_VERSION, downloadUrl: LINUX_DOWNLOAD_PATH };
  }

  /**
   * Checks whether the given household already has at least one ingest API
   * key issued, so the UI can offer "generate" vs. "regenerate" wording.
   *
   * @param householdId - Household to check.
   * @returns True when the household's `api_keys` array is non-empty.
   */
  async hasApiKey(householdId: string): Promise<boolean> {
    const snapshot = await getDoc(doc(this.firestore, 'households', householdId));
    const household = snapshot.data() as Household | undefined;
    return (household?.api_keys?.length ?? 0) > 0;
  }
}
