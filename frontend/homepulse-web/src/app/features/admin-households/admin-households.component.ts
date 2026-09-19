import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { NavbarComponent } from '../../shared/navbar/navbar.component';
import { AdminHouseholdsDataService, HouseholdSummary } from './admin-households-data.service';

/**
 * Platform-wide admin screen — lets the super-admin (see `superAdminGuard`)
 * see every household using the system (name, status, owner email, how
 * many API keys it has issued) and invite new people by email. Each invite
 * creates a brand-new, private household owned solely by the invitee —
 * never shows or grants access to another household's private data
 * (speedtest results, incidents, IPs). There is no "members" concept
 * anymore: one household, one owner.
 */
@Component({
  selector: 'app-admin-households',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    NavbarComponent,
    TranslatePipe,
  ],
  template: `
    <app-navbar>
    <main class="admin-main">
      <h1 class="admin-title">{{ 'ADMIN_HOUSEHOLDS.TITLE' | translate }}</h1>

      <mat-card class="admin-card">
        <mat-card-header>
          <mat-card-title>{{ 'ADMIN_HOUSEHOLDS.INVITE' | translate }}</mat-card-title>
        </mat-card-header>
        <mat-card-content>
          <p class="invite-hint">{{ 'ADMIN_HOUSEHOLDS.INVITE_HINT' | translate }}</p>
          <form class="invite-form" [formGroup]="inviteForm" (ngSubmit)="invite()">
            <mat-form-field appearance="outline" class="email-field">
              <mat-label>{{ 'ADMIN_HOUSEHOLDS.EMAIL' | translate }}</mat-label>
              <input matInput type="email" formControlName="email" />
            </mat-form-field>

            <button mat-raised-button color="primary" type="submit" [disabled]="inviteForm.invalid || inviting()">
              {{ 'ADMIN_HOUSEHOLDS.INVITE' | translate }}
            </button>
          </form>
        </mat-card-content>
      </mat-card>

      @if (loading()) {
        <p class="loading-state">{{ 'COMMON.LOADING' | translate }}</p>
      } @else if (error()) {
        <p class="error-state">{{ 'ADMIN_HOUSEHOLDS.ERROR' | translate }}</p>
      } @else {
        <mat-card class="admin-card">
          <mat-card-content>
            @if (households().length === 0) {
              <p class="empty-state">{{ 'ADMIN_HOUSEHOLDS.NO_HOUSEHOLDS' | translate }}</p>
            }
            @for (household of households(); track household.id) {
              <div class="household-row">
                <div class="household-info">
                  <mat-icon>home</mat-icon>
                  <div>
                    <div class="household-name">{{ household.name }}</div>
                    <div class="household-owner">{{ household.ownerEmail }}</div>
                  </div>
                </div>
                <div class="household-meta">
                  <span class="status-badge" [class.status-active]="household.status === 'active'">
                    {{ household.status }}
                  </span>
                  <span class="api-key-count">
                    {{ 'ADMIN_HOUSEHOLDS.API_KEY_COUNT' | translate: { count: household.apiKeyCount } }}
                  </span>
                  <button
                    mat-stroked-button
                    [disabled]="updatingStatusId() === household.id"
                    (click)="toggleStatus(household)"
                  >
                    {{ (household.status === 'active' ? 'ADMIN_HOUSEHOLDS.DEACTIVATE' : 'ADMIN_HOUSEHOLDS.ACTIVATE') | translate }}
                  </button>
                </div>
              </div>
            }
          </mat-card-content>
        </mat-card>
      }
    </main>
    </app-navbar>
  `,
  styles: [`
    .admin-main {
      max-width: 680px;
      margin: 0 auto;
      padding: 0 1.5rem 3rem;
    }

    .admin-title {
      font-size: 1.5rem;
      font-weight: 700;
      margin: 1.5rem 0 1rem;
      color: var(--mat-sys-on-surface);
    }

    .admin-card {
      margin-bottom: 1.25rem;
    }

    .invite-hint {
      color: var(--mat-sys-on-surface-variant);
      margin: 0 0 0.75rem;
      font-size: 0.875rem;
    }

    .invite-form {
      display: flex;
      align-items: flex-start;
      gap: 0.75rem;
      flex-wrap: wrap;
    }

    .email-field {
      flex: 2 1 220px;
    }

    .loading-state, .error-state, .empty-state {
      color: var(--mat-sys-on-surface-variant);
      margin: 0;
    }

    .error-state {
      color: var(--mat-sys-error);
    }

    .household-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.6rem 0;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      gap: 1rem;
    }

    .household-row:last-child {
      border-bottom: none;
    }

    .household-info {
      display: flex;
      align-items: center;
      gap: 0.6rem;
    }

    .household-name {
      font-weight: 500;
    }

    .household-owner {
      font-size: 0.8rem;
      color: var(--mat-sys-on-surface-variant);
    }

    .household-meta {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      flex-wrap: wrap;
    }

    .api-key-count {
      font-size: 0.8rem;
      color: var(--mat-sys-on-surface-variant);
      white-space: nowrap;
    }

    .status-badge {
      font-size: 0.75rem;
      text-transform: uppercase;
      padding: 0.1rem 0.5rem;
      border-radius: 8px;
      background: var(--mat-sys-surface-variant);
      color: var(--mat-sys-on-surface-variant);
    }

    .status-badge.status-active {
      background: var(--mat-sys-primary-container);
      color: var(--mat-sys-on-primary-container);
    }
  `],
})
export class AdminHouseholdsComponent {
  private adminHouseholdsDataService = inject(AdminHouseholdsDataService);
  private translate = inject(TranslateService);
  private snackBar = inject(MatSnackBar);
  private fb = inject(FormBuilder);

  /** Every household on the platform, once loaded. */
  households = signal<HouseholdSummary[]>([]);

  /** True while a households fetch is in flight. */
  loading = signal(true);

  /** True when the fetch failed (e.g. network error, or a 403 from a stale session). */
  error = signal(false);

  /** True while an invite request is in flight. */
  inviting = signal(false);

  /** Id of the household currently being activated/deactivated, or null when none is. */
  updatingStatusId = signal<string | null>(null);

  readonly inviteForm = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
  });

  constructor() {
    this.refresh();
  }

  /**
   * Submits the invite form, creating a brand-new household owned by the
   * given email address and emailing them the invite.
   */
  invite(): void {
    if (this.inviteForm.invalid) return;
    const { email } = this.inviteForm.getRawValue();
    this.inviting.set(true);
    this.adminHouseholdsDataService
      .inviteHousehold(email!)
      .then(() => {
        this.inviteForm.reset({ email: '' });
        this.snackBar.open(this.translate.instant('ADMIN_HOUSEHOLDS.INVITE_SUCCESS'), '', { duration: 3000 });
        this.refresh();
      })
      .catch(() => this.snackBar.open(this.translate.instant('ADMIN_HOUSEHOLDS.INVITE_ERROR'), '', { duration: 3000 }))
      .finally(() => this.inviting.set(false));
  }

  /**
   * Flips a household between active and inactive. Deactivating asks for
   * confirmation first, since it immediately denies login to that
   * household's owner and blocks its client's ingest.
   *
   * @param household - Household row to toggle.
   */
  toggleStatus(household: HouseholdSummary): void {
    const nextStatus = household.status === 'active' ? 'inactive' : 'active';
    if (
      nextStatus === 'inactive' &&
      !window.confirm(this.translate.instant('ADMIN_HOUSEHOLDS.CONFIRM_DEACTIVATE', { name: household.name }))
    ) {
      return;
    }

    this.updatingStatusId.set(household.id);
    this.adminHouseholdsDataService
      .setHouseholdStatus(household.id, nextStatus)
      .then(() => {
        this.snackBar.open(this.translate.instant('ADMIN_HOUSEHOLDS.STATUS_UPDATE_SUCCESS'), '', { duration: 3000 });
        this.refresh();
      })
      .catch(() => this.snackBar.open(this.translate.instant('ADMIN_HOUSEHOLDS.STATUS_UPDATE_ERROR'), '', { duration: 3000 }))
      .finally(() => this.updatingStatusId.set(null));
  }

  /**
   * Reloads the platform-wide households list.
   */
  private refresh(): void {
    this.loading.set(true);
    this.adminHouseholdsDataService
      .listHouseholds()
      .then((households) => {
        this.households.set(households);
        this.error.set(false);
      })
      .catch(() => this.error.set(true))
      .finally(() => this.loading.set(false));
  }
}
