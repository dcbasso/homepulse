import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { map, take } from 'rxjs';
import { HouseholdContextService } from './household-context.service';

/**
 * Functional route guard that blocks signed-in users who are not a member of
 * any household (per ADR 0005 — access is granted only via manual allowlist,
 * there is no self-signup). Runs after `authGuard`, so a `null` user here
 * would already have been redirected to `/login`.
 */
export const householdGuard: CanActivateFn = () => {
  const householdContext = inject(HouseholdContextService);
  const router = inject(Router);

  return householdContext.households$.pipe(
    take(1),
    map((households) => (households.length > 0 ? true : router.createUrlTree(['/login']))),
  );
};
