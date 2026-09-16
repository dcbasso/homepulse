import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { NavbarComponent } from '../../shared/navbar/navbar.component';
import { HouseholdContextService } from '../../core/household-context.service';
import { ClientDataService, ClientRelease } from './client-data.service';
import { ApiKeyDialogComponent } from './components/api-key-dialog/api-key-dialog.component';

/**
 * Client download and setup screen. Every household member can view it
 * (installing the client on a new machine isn't restricted to management
 * roles), but only an owner/admin sees the "generate API key" action —
 * mirroring the Members screen's `canManage` check.
 *
 * The Standalone Linux and Windows tabs are functional; Windows is marked
 * experimental (native Windows Service support, see ADR 0011, has only been
 * verified in CI, not on a real Windows host). Debian/Ubuntu and Arch remain
 * placeholders until packaging exists for them.
 */
@Component({
  selector: 'app-client',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NavbarComponent, MatButtonModule, MatCardModule, MatIconModule, MatTabsModule, TranslatePipe],
  template: `
    <app-navbar>
    <main class="client-main">
      <h1 class="client-title">{{ 'CLIENT.TITLE' | translate }}</h1>

      @if (canManage()) {
        <mat-card class="client-card">
          <mat-card-content class="key-section">
            <div>
              <div class="household-id-label">{{ 'CLIENT.HOUSEHOLD_ID_LABEL' | translate }}</div>
              <code>{{ householdId() }}</code>
            </div>
            <button mat-raised-button color="primary" [disabled]="generatingKey()" (click)="generateKey()">
              {{ 'CLIENT.GENERATE_KEY' | translate }}
            </button>
          </mat-card-content>
        </mat-card>
      }

      <mat-card class="client-card">
        <mat-card-content>
          <mat-tab-group>
            <mat-tab [label]="'CLIENT.TAB_LINUX' | translate">
              <div class="tab-content">
                <a
                  mat-raised-button
                  color="primary"
                  [href]="release.downloadUrl"
                  download="homepulse-client-linux-x86_64.tar.gz"
                >
                  <mat-icon>download</mat-icon>
                  {{ 'CLIENT.DOWNLOAD' | translate }} (v{{ release.version }})
                </a>

                <h3>{{ 'CLIENT.INSTALL_STEPS_TITLE' | translate }}</h3>
                <ol class="install-steps">
                  <li>{{ 'CLIENT.INSTALL_STEP_1' | translate }}</li>
                  <li>{{ 'CLIENT.INSTALL_STEP_2' | translate }}</li>
                  <li>{{ 'CLIENT.INSTALL_STEP_3' | translate }}</li>
                  <li>{{ 'CLIENT.INSTALL_STEP_4' | translate }}</li>
                </ol>
                <a
                  href="https://github.com/dcbasso/homepulse/blob/main/client/homepulse-client/README.md"
                  target="_blank"
                  rel="noopener"
                >
                  {{ 'CLIENT.INSTALL_DOCS_LINK' | translate }}
                </a>
              </div>
            </mat-tab>
            <mat-tab>
              <ng-template mat-tab-label>
                {{ 'CLIENT.TAB_WINDOWS' | translate }}
                <span class="experimental-badge">{{ 'CLIENT.EXPERIMENTAL_BADGE' | translate }}</span>
              </ng-template>
              <div class="tab-content">
                <p class="experimental-warning">
                  <mat-icon inline>science</mat-icon>
                  {{ 'CLIENT.WINDOWS_EXPERIMENTAL_WARNING' | translate }}
                </p>

                <a
                  mat-raised-button
                  color="primary"
                  [href]="windowsRelease.downloadUrl"
                  download="homepulse-client-windows-x86_64.zip"
                >
                  <mat-icon>download</mat-icon>
                  {{ 'CLIENT.DOWNLOAD' | translate }} (v{{ windowsRelease.version }})
                </a>

                <h3>{{ 'CLIENT.INSTALL_STEPS_TITLE_WINDOWS' | translate }}</h3>
                <ol class="install-steps">
                  <li>{{ 'CLIENT.INSTALL_STEP_WINDOWS_1' | translate }}</li>
                  <li>{{ 'CLIENT.INSTALL_STEP_WINDOWS_2' | translate }}</li>
                  <li>{{ 'CLIENT.INSTALL_STEP_WINDOWS_3' | translate }}</li>
                  <li>{{ 'CLIENT.INSTALL_STEP_WINDOWS_4' | translate }}</li>
                </ol>
                <a
                  href="https://github.com/dcbasso/homepulse/blob/main/client/homepulse-client/README.md"
                  target="_blank"
                  rel="noopener"
                >
                  {{ 'CLIENT.INSTALL_DOCS_LINK' | translate }}
                </a>
              </div>
            </mat-tab>
            <mat-tab [label]="'CLIENT.TAB_DEBIAN' | translate">
              <p class="empty-state tab-content">{{ 'CLIENT.COMING_SOON' | translate }}</p>
            </mat-tab>
            <mat-tab [label]="'CLIENT.TAB_ARCH' | translate">
              <p class="empty-state tab-content">{{ 'CLIENT.COMING_SOON' | translate }}</p>
            </mat-tab>
          </mat-tab-group>
        </mat-card-content>
      </mat-card>
    </main>
    </app-navbar>
  `,
  styles: [`
    .client-main {
      max-width: 680px;
      margin: 0 auto;
      padding: 0 1.5rem 3rem;
    }

    .client-title {
      font-size: 1.5rem;
      font-weight: 700;
      margin: 1.5rem 0 1rem;
      color: var(--mat-sys-on-surface);
    }

    .client-card {
      margin-bottom: 1.25rem;
    }

    .key-section {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      flex-wrap: wrap;
    }

    .household-id-label {
      font-size: 0.75rem;
      color: var(--mat-sys-on-surface-variant);
    }

    .tab-content {
      padding: 1rem 0;
    }

    .empty-state {
      color: var(--mat-sys-on-surface-variant);
    }

    .install-steps {
      padding-left: 1.25rem;
    }

    .experimental-badge {
      margin-left: 0.4rem;
      padding: 0.05rem 0.5rem;
      border-radius: 1rem;
      font-size: 0.65rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.02em;
      color: var(--mat-sys-on-tertiary-container);
      background: var(--mat-sys-tertiary-container);
    }

    .experimental-warning {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.75rem 1rem;
      margin: 0 0 1rem;
      border-radius: 4px;
      color: var(--mat-sys-on-tertiary-container);
      background: var(--mat-sys-tertiary-container);
    }
  `],
})
export class ClientComponent {
  private clientDataService = inject(ClientDataService);
  private householdContext = inject(HouseholdContextService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);
  private translate = inject(TranslateService);
  private destroyRef = inject(DestroyRef);

  /** True when the signed-in user can generate API keys for the active household. */
  canManage = this.householdContext.canManageActiveHousehold;

  /** Id of the active household, shown so it can be copied into the client's config.json. */
  householdId = signal<string | null>(null);

  /** True while an API key generation request is in flight. */
  generatingKey = signal(false);

  /** The homepulse-client Linux build bundled with this deploy. */
  release: ClientRelease = this.clientDataService.getLinuxRelease();

  /** The homepulse-client Windows build bundled with this deploy (experimental, see ADR 0011). */
  windowsRelease: ClientRelease = this.clientDataService.getWindowsRelease();

  constructor() {
    this.householdContext.activeHousehold$.pipe(
      takeUntilDestroyed(this.destroyRef),
    ).subscribe((household) => this.householdId.set(household?.id ?? null));
  }

  /**
   * Generates a new API key for the active household and shows it once in a
   * dialog for the user to copy.
   */
  generateKey(): void {
    this.generatingKey.set(true);
    this.clientDataService.issueApiKey()
      .then((apiKey) => this.dialog.open(ApiKeyDialogComponent, { data: { apiKey } }))
      .catch(() => this.snackBar.open(this.translate.instant('CLIENT.GENERATE_KEY_ERROR'), '', { duration: 3000 }))
      .finally(() => this.generatingKey.set(false));
  }
}
