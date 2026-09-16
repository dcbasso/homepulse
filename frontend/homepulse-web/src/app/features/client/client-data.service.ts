import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../core/auth.service';
import { HouseholdContextService } from '../../core/household-context.service';
import { environment } from '../../../environments/environment';

/**
 * Version of the homepulse-client build published under
 * `public/downloads/` — this repository is private, so the browser cannot
 * resolve the latest release through GitHub's public API; the binaries are
 * instead built locally (`cargo build --release` in client/homepulse-client)
 * and copied into the frontend's static assets before each deploy. Bump this
 * constant whenever those files are replaced with a newer build.
 */
export const CLIENT_VERSION = '0.1.1';

/**
 * Path (relative to the site root) the Linux build is served from. Bundles
 * the `homepulse-client` binary alongside `install.sh` and
 * `homepulse-client.service` (see `client/homepulse-client/packaging/`) in a
 * single tar.gz, preserving the executable permission bits that a plain zip
 * would drop.
 */
const LINUX_DOWNLOAD_PATH = '/downloads/homepulse-client-linux-x86_64.tar.gz';

/**
 * Path (relative to the site root) the Windows build is served from. Bundles
 * `homepulse-client.exe` alongside `install.ps1`/`uninstall.ps1` (see
 * `client/homepulse-client/packaging/windows/`) in a single zip, built the
 * same manual way as the Linux binary until CI-published releases are wired
 * into this static site (see ADR 0011).
 */
const WINDOWS_DOWNLOAD_PATH = '/downloads/homepulse-client-windows-x86_64.zip';

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
   * Returns the homepulse-client Windows build bundled with this deploy.
   *
   * Experimental: native Windows Service support (ADR 0011) has not yet
   * been verified on a real Windows host, only in CI.
   *
   * @returns The bundled release's version and download path.
   */
  getWindowsRelease(): ClientRelease {
    return { version: CLIENT_VERSION, downloadUrl: WINDOWS_DOWNLOAD_PATH };
  }
}
