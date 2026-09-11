import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { catchError, firstValueFrom, of } from 'rxjs';
import { AuthService } from '../../core/auth.service';
import { HouseholdContextService } from '../../core/household-context.service';
import { environment } from '../../../environments/environment';

/** GitHub API base URL, used to resolve the latest published client release. */
const GITHUB_API_BASE = 'https://api.github.com/repos/dcbasso/homepulse';

/** Prefix identifying a GitHub release as a homepulse-client release (vs. a monorepo-wide release tag). */
const CLIENT_RELEASE_TAG_PREFIX = 'client-v';

/** Asset filename the client CI attaches to each client-v* release. */
const LINUX_ASSET_NAME = 'homepulse-client-linux-x86_64';

/** A GitHub release asset, as returned by the GitHub REST API. */
interface GitHubReleaseAsset {
  name: string;
  browser_download_url: string;
}

/** A GitHub release, as returned by the GitHub REST API (subset of fields used here). */
interface GitHubRelease {
  tag_name: string;
  assets: GitHubReleaseAsset[];
}

/** Result of resolving the latest published homepulse-client release. */
export interface ClientRelease {
  version: string;
  downloadUrl: string;
}

/**
 * Backs the Client screen: issuing self-service ingest API keys and
 * resolving the latest downloadable homepulse-client binary.
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
   * Resolves the most recently published homepulse-client Linux release,
   * by filtering GitHub's public releases list for the client's own tag
   * prefix (`client-v*`) rather than using `/releases/latest` — which would
   * incorrectly resolve to the monorepo's own version tags. Uses GitHub's
   * unauthenticated API, acceptable for a low-traffic screen.
   *
   * @returns The latest client release's version and download URL, or null
   *   when no `client-v*` release has been published yet (or the lookup fails).
   */
  async fetchLatestClientRelease(): Promise<ClientRelease | null> {
    const releases = await firstValueFrom(
      this.http.get<GitHubRelease[]>(`${GITHUB_API_BASE}/releases`).pipe(catchError(() => of([]))),
    );
    const clientRelease = releases.find((release) => release.tag_name.startsWith(CLIENT_RELEASE_TAG_PREFIX));
    if (!clientRelease) {
      return null;
    }
    const asset = clientRelease.assets.find((a) => a.name === LINUX_ASSET_NAME);
    if (!asset) {
      return null;
    }
    return {
      version: clientRelease.tag_name.slice(CLIENT_RELEASE_TAG_PREFIX.length),
      downloadUrl: asset.browser_download_url,
    };
  }
}
