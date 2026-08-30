import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { TranslatePipe } from '@ngx-translate/core';
import { filter, take } from 'rxjs';
import { AuthService } from '../../core/auth.service';

/**
 * Login screen — the only public route in the application.
 *
 * Checks for an existing session on init and redirects to /dashboard
 * immediately if the user is already authenticated. Otherwise, renders
 * a Google Sign-In button and handles the allowed-email restriction.
 */
@Component({
  selector: 'app-login',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatProgressSpinnerModule, TranslatePipe],
  template: `
    <div class="login-page">
      <div class="login-card">
        <img class="login-logo" src="assets/images/logo/logo-full-400w.png" alt="HomePulse" />
        <p class="login-subtitle">{{ 'LOGIN.SUBTITLE' | translate }}</p>

        <button
          mat-raised-button
          class="google-btn"
          [disabled]="loading()"
          (click)="signIn()"
        >
          @if (loading()) {
            <mat-spinner diameter="20" />
          } @else {
            <svg class="google-icon" viewBox="0 0 24 24" aria-hidden="true">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            {{ 'LOGIN.BUTTON' | translate }}
          }
        </button>

        @if (errorKey()) {
          <p class="login-error">{{ errorKey()! | translate }}</p>
        }
      </div>
    </div>
  `,
  styles: [`
    .login-page {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      background-color: var(--mat-sys-surface);
    }

    .login-card {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 0.5rem;
      padding: 3rem 2.5rem;
      border-radius: 12px;
      background-color: var(--mat-sys-surface-container);
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.12);
      min-width: 320px;
    }

    .login-logo {
      width: 220px;
      max-width: 100%;
      margin: 0 0 0.5rem;
    }

    .login-subtitle {
      margin: 0 0 1.5rem;
      color: var(--mat-sys-on-surface-variant);
      font-size: 0.95rem;
    }

    .google-btn {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      min-width: 240px;
      height: 44px;
      padding: 0 1.25rem;
      background-color: var(--mat-sys-surface) !important;
      color: var(--mat-sys-on-surface) !important;
      border: 1px solid var(--mat-sys-outline-variant) !important;
      border-radius: 22px !important;
    }

    .google-btn:hover:not(:disabled) {
      background-color: var(--mat-sys-surface-variant) !important;
    }

    .google-icon {
      width: 18px;
      height: 18px;
      flex-shrink: 0;
    }

    mat-spinner {
      margin: 0 auto;
    }

    .login-error {
      margin: 0.75rem 0 0;
      color: var(--mat-sys-error);
      font-size: 0.875rem;
      text-align: center;
    }
  `],
})
export class LoginComponent implements OnInit {
  private authService = inject(AuthService);
  private router = inject(Router);
  private destroyRef = inject(DestroyRef);

  loading = signal(false);
  errorKey = signal<string | null>(null);

  /**
   * Checks for an existing authenticated session on component init.
   * Redirects to /dashboard immediately if the user is already logged in,
   * avoiding a redundant login screen on page refresh.
   */
  ngOnInit(): void {
    this.authService.currentUser$
      .pipe(
        filter((user) => user !== null),
        take(1),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe(() => this.router.navigate(['/dashboard']));
  }

  /**
   * Opens the Google Sign-In popup via AuthService and handles the result.
   * Disables the button during the async flow and maps errors to i18n keys.
   */
  signIn(): void {
    this.loading.set(true);
    this.errorKey.set(null);
    this.authService.signInWithGoogle().subscribe({
      error: (err: Error) => {
        this.loading.set(false);
        this.errorKey.set(
          err.message === 'ACCESS_DENIED' ? 'LOGIN.ERROR_DENIED' : 'LOGIN.ERROR_GENERIC',
        );
      },
    });
  }
}
