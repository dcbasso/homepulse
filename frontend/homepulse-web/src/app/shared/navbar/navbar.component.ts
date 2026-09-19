import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { BreakpointObserver } from '@angular/cdk/layout';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatMenuModule } from '@angular/material/menu';
import { TranslatePipe } from '@ngx-translate/core';
import { map } from 'rxjs';
import { AuthService } from '../../core/auth.service';
import { HouseholdContextService } from '../../core/household-context.service';
import { environment } from '../../../environments/environment';

/** Max viewport width, in pixels, at which the navbar switches to the drawer layout. */
const MOBILE_BREAKPOINT = '(max-width: 768px)';

/**
 * App shell rendered on all authenticated screens.
 *
 * Wraps its projected content in a `mat-sidenav-container`. On narrow viewports
 * the navigation links, preferences, and sign-out collapse into a
 * hamburger-triggered drawer; on wider viewports they render inline in the
 * toolbar, matching the previous desktop layout. Theme and language are
 * managed on the dedicated Preferences screen, not directly in the navbar.
 */
@Component({
  selector: 'app-navbar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    MatSidenavModule,
    MatListModule,
    MatDividerModule,
    MatFormFieldModule,
    MatSelectModule,
    MatMenuModule,
    RouterLink,
    RouterLinkActive,
    TranslatePipe,
  ],
  template: `
    <mat-sidenav-container class="app-shell">
      <mat-sidenav #drawer mode="over" [fixedInViewport]="true">
        <div class="drawer-user">
          <div class="user-avatar">
            @if (currentUser()?.photoURL; as photoURL) {
              <img [src]="photoURL" alt="" />
            } @else {
              <span>{{ userInitial() }}</span>
            }
          </div>
          <div class="user-info">
            <span class="user-name">{{ currentUser()?.displayName || currentUser()?.email }}</span>
            @if (currentUser()?.displayName) {
              <span class="user-email">{{ currentUser()?.email }}</span>
            }
          </div>
        </div>
        <mat-divider />

        <mat-nav-list>
          <a mat-list-item routerLink="/dashboard" routerLinkActive="active-link" (click)="drawer.close()">
            {{ 'NAV.DASHBOARD' | translate }}
          </a>
          <a mat-list-item routerLink="/incidents" routerLinkActive="active-link" (click)="drawer.close()">
            {{ 'NAV.INCIDENTS' | translate }}
          </a>
          <a mat-list-item routerLink="/heartbeat-history" routerLinkActive="active-link" (click)="drawer.close()">
            {{ 'NAV.HEARTBEAT_HISTORY' | translate }}
          </a>
          <a mat-list-item routerLink="/history" routerLinkActive="active-link" (click)="drawer.close()">
            {{ 'NAV.HISTORY' | translate }}
          </a>
          <a mat-list-item routerLink="/settings" routerLinkActive="active-link" (click)="drawer.close()">
            {{ 'NAV.SETTINGS' | translate }}
          </a>
          <a mat-list-item routerLink="/client" routerLinkActive="active-link" (click)="drawer.close()">
            {{ 'NAV.CLIENT' | translate }}
          </a>
          @if (isSuperAdmin()) {
            <a mat-list-item routerLink="/admin/households" routerLinkActive="active-link" (click)="drawer.close()">
              {{ 'NAV.ADMIN_HOUSEHOLDS' | translate }}
            </a>
          }
          <a mat-list-item routerLink="/about" routerLinkActive="active-link" (click)="drawer.close()">
            {{ 'NAV.ABOUT' | translate }}
          </a>

          <mat-divider />

          @if (households().length > 1) {
            <mat-form-field appearance="outline" class="household-select drawer-household-select">
              <mat-label>{{ 'NAV.HOUSEHOLD' | translate }}</mat-label>
              <mat-select [value]="activeHouseholdId()" (selectionChange)="selectHousehold($event.value)">
                @for (household of households(); track household.id) {
                  <mat-option [value]="household.id">{{ household.name }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
          }

          <a mat-list-item routerLink="/preferences" routerLinkActive="active-link" (click)="drawer.close()">
            <mat-icon matListItemIcon>tune</mat-icon>
            <span matListItemTitle>{{ 'NAV.PREFERENCES' | translate }}</span>
          </a>

          <button mat-list-item (click)="signOut()">
            <mat-icon matListItemIcon>logout</mat-icon>
            <span matListItemTitle>{{ 'NAV.SIGN_OUT' | translate }}</span>
          </button>
        </mat-nav-list>
      </mat-sidenav>

      <mat-sidenav-content>
        <mat-toolbar class="navbar">
          @if (isMobile()) {
            <button mat-icon-button (click)="drawer.toggle()" [attr.aria-label]="'NAV.MENU' | translate">
              <mat-icon>menu</mat-icon>
            </button>
          }

          <img class="app-logo" src="assets/images/logo/logo-icon.png" alt="" />
          <span class="app-title">{{ 'LOGIN.TITLE' | translate }}</span>

          @if (!isMobile()) {
            <nav class="nav-links">
              <a mat-button routerLink="/dashboard" routerLinkActive="active-link">
                {{ 'NAV.DASHBOARD' | translate }}
              </a>
              <a mat-button routerLink="/incidents" routerLinkActive="active-link">
                {{ 'NAV.INCIDENTS' | translate }}
              </a>
              <a mat-button routerLink="/heartbeat-history" routerLinkActive="active-link">
                {{ 'NAV.HEARTBEAT_HISTORY' | translate }}
              </a>
              <a mat-button routerLink="/history" routerLinkActive="active-link">
                {{ 'NAV.HISTORY' | translate }}
              </a>
              <a mat-button routerLink="/settings" routerLinkActive="active-link">
                {{ 'NAV.SETTINGS' | translate }}
              </a>
              <a mat-button routerLink="/client" routerLinkActive="active-link">
                {{ 'NAV.CLIENT' | translate }}
              </a>
              @if (isSuperAdmin()) {
                <a mat-button routerLink="/admin/households" routerLinkActive="active-link">
                  {{ 'NAV.ADMIN_HOUSEHOLDS' | translate }}
                </a>
              }
              <a mat-button routerLink="/about" routerLinkActive="active-link">
                {{ 'NAV.ABOUT' | translate }}
              </a>
            </nav>
          }

          <span class="spacer"></span>

          @if (!isMobile() && households().length > 1) {
            <mat-form-field appearance="outline" class="household-select">
              <mat-select [value]="activeHouseholdId()" (selectionChange)="selectHousehold($event.value)">
                @for (household of households(); track household.id) {
                  <mat-option [value]="household.id">{{ household.name }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
          }

          @if (!isMobile()) {
            <button mat-icon-button [matMenuTriggerFor]="userMenu" [attr.aria-label]="'NAV.USER_MENU' | translate">
              <div class="user-avatar">
                @if (currentUser()?.photoURL; as photoURL) {
                  <img [src]="photoURL" alt="" />
                } @else {
                  <span>{{ userInitial() }}</span>
                }
              </div>
            </button>
            <mat-menu #userMenu="matMenu">
              <div class="menu-user-info">
                <span class="user-name">{{ currentUser()?.displayName || currentUser()?.email }}</span>
                @if (currentUser()?.displayName) {
                  <span class="user-email">{{ currentUser()?.email }}</span>
                }
              </div>
              <mat-divider />
              <a mat-menu-item routerLink="/preferences">
                <mat-icon>tune</mat-icon>
                <span>{{ 'NAV.PREFERENCES' | translate }}</span>
              </a>
              <button mat-menu-item (click)="signOut()">
                <mat-icon>logout</mat-icon>
                <span>{{ 'NAV.SIGN_OUT' | translate }}</span>
              </button>
            </mat-menu>
          }
        </mat-toolbar>

        <ng-content />
      </mat-sidenav-content>
    </mat-sidenav-container>
  `,
  styles: [`
    .app-shell {
      min-height: 100vh;
    }
    .navbar {
      position: sticky;
      top: 0;
      z-index: 100;
      background-color: var(--mat-sys-surface-container);
      color: var(--mat-sys-on-surface);
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      box-shadow: none;
    }
    .app-logo {
      height: 28px;
      width: 28px;
      object-fit: contain;
      margin-right: 0.5rem;
    }
    .app-title {
      font-weight: 700;
      font-size: 1rem;
      margin-right: 1.5rem;
      color: var(--mat-sys-primary);
    }
    .nav-links { display: flex; gap: 0.25rem; }
    .spacer { flex: 1; }
    .active-link { font-weight: 700; }
    .household-select {
      width: 180px;
      margin: 0 0.75rem;
    }
    .household-select ::ng-deep .mat-mdc-form-field-subscript-wrapper { display: none; }
    .drawer-household-select {
      width: calc(100% - 2rem);
      margin: 0.5rem 1rem;
    }
    .user-avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background-color: var(--mat-sys-primary);
      color: var(--mat-sys-on-primary);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 0.9rem;
      font-weight: 700;
      overflow: hidden;
      flex-shrink: 0;
    }
    .user-avatar img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .drawer-user {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 1rem;
    }
    .user-info, .menu-user-info {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .menu-user-info {
      padding: 0.5rem 1rem;
    }
    .user-name {
      font-weight: 600;
      font-size: 0.9rem;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .user-email {
      font-size: 0.8rem;
      color: var(--mat-sys-on-surface-variant);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `],
})
export class NavbarComponent {
  private authService = inject(AuthService);
  private householdContext = inject(HouseholdContextService);
  private breakpointObserver = inject(BreakpointObserver);

  /** True when the viewport is narrow enough to use the drawer layout instead of the inline toolbar. */
  protected isMobile = toSignal(
    this.breakpointObserver.observe([MOBILE_BREAKPOINT]).pipe(map(r => r.matches)),
    { initialValue: this.breakpointObserver.isMatched(MOBILE_BREAKPOINT) },
  );

  /** Households the signed-in user belongs to — the selector only renders when there is more than one. */
  protected households = this.householdContext.households;

  /** Id of the currently active household. */
  protected activeHouseholdId = computed(() => this.householdContext.activeHousehold()?.id ?? null);

  /** True when the signed-in user can manage the active household's members. */
  /** True when the signed-in user is the platform-wide super-admin (see `superAdminGuard`). */
  protected isSuperAdmin = toSignal(
    this.authService.currentUser$.pipe(map((u) => u?.email === environment.superAdminEmail)),
    { initialValue: false },
  );

  /** Currently signed-in Firebase user, shown in the account menu so it's clear who's logged in. */
  protected currentUser = toSignal(this.authService.currentUser$, { initialValue: null });

  /** First letter of the user's name (or email) used as a fallback avatar when there's no photo. */
  protected userInitial = computed(() => {
    const user = this.currentUser();
    const source = user?.displayName || user?.email || '';
    return source.charAt(0).toUpperCase();
  });

  /**
   * Signs out the current user and navigates to the login screen.
   */
  signOut(): void {
    this.authService.signOut().subscribe();
  }

  /**
   * Switches the active household context.
   *
   * @param householdId - Id of the household to make active.
   */
  selectHousehold(householdId: string): void {
    this.householdContext.selectHousehold(householdId);
  }
}
