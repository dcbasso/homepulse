import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map, take } from 'rxjs';
import { AuthService } from './auth.service';
import { environment } from '../../environments/environment';

/**
 * Functional route guard that blocks any signed-in user other than the
 * platform-wide super-admin (`environment.superAdminEmail`) from the
 * cross-household admin screens. This is a client-side UX guard only — the
 * real access control is re-enforced server-side by `list-households`
 * (see `SUPER_ADMIN_EMAIL` in the backend's `main.py`).
 */
export const superAdminGuard: CanActivateFn = () => {
  const authService = inject(AuthService);
  const router = inject(Router);

  return authService.currentUser$.pipe(
    take(1),
    map((user) =>
      user?.email === environment.superAdminEmail ? true : router.createUrlTree(['/dashboard']),
    ),
  );
};
