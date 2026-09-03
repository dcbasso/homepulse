import { Injectable, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Auth, user } from '@angular/fire/auth';
import type { User } from '@angular/fire/auth';
import { Firestore, collection, getDocs } from '@angular/fire/firestore';
import { BehaviorSubject, Observable, combineLatest, from, map, of, shareReplay, switchMap } from 'rxjs';
import { Household, HouseholdMembership } from './models/household.model';

/** localStorage key used to remember the user's last-selected household. */
const ACTIVE_HOUSEHOLD_STORAGE_KEY = 'homepulse.activeHouseholdId';

/**
 * Resolves and tracks which household(s) the signed-in user belongs to, and
 * which one is currently active.
 *
 * Membership is stored as `members[]` on each `households/{id}` document
 * (see ADR 0003) rather than in a queryable subcollection, so resolving "which
 * households does this uid belong to" requires a client-side scan of the
 * `households` collection. This is acceptable at the target scale of dozens
 * to a few hundred households (see ADR 0005) and will become a direct query
 * once Fase 6 converts `members` into a `households/{id}/members/{uid}`
 * subcollection.
 */
@Injectable({ providedIn: 'root' })
export class HouseholdContextService {
  private firestore = inject(Firestore);
  private auth = inject(Auth);

  private selectedHouseholdId$ = new BehaviorSubject<string | null>(this.readStoredHouseholdId());

  /** Live list of households the signed-in user belongs to. Empty when signed out or a member of none. */
  readonly households$: Observable<HouseholdMembership[]> = user(this.auth).pipe(
    switchMap((current) => (current ? this.resolveMembershipsFor(current) : of([]))),
    shareReplay({ bufferSize: 1, refCount: false }),
  );

  /** The currently active household, defaulting to the first one the user belongs to. */
  readonly activeHousehold$: Observable<HouseholdMembership | null> = combineLatest([
    this.households$,
    this.selectedHouseholdId$,
  ]).pipe(
    map(([households, selectedId]) => {
      if (households.length === 0) return null;
      return households.find((h) => h.id === selectedId) ?? households[0];
    }),
    shareReplay({ bufferSize: 1, refCount: false }),
  );

  /** The id of the currently active household, or null when the user has none. */
  readonly activeHouseholdId$: Observable<string | null> = this.activeHousehold$.pipe(
    map((household) => household?.id ?? null),
  );

  /** Signal form of {@link households$}, for template bindings. */
  readonly households = toSignal(this.households$, { initialValue: [] as HouseholdMembership[] });

  /** Signal form of {@link activeHousehold$}, for template bindings. */
  readonly activeHousehold = toSignal(this.activeHousehold$, { initialValue: null as HouseholdMembership | null });

  /**
   * Resolves the household memberships for a given Firebase user directly,
   * without going through the reactive {@link households$} stream — used by
   * the login flow to decide whether access is granted before navigating.
   *
   * @param authUser - Signed-in Firebase user to resolve memberships for.
   * @returns Observable emitting the memberships found (empty when the user is not registered in any household).
   */
  resolveMembershipsFor(authUser: User): Observable<HouseholdMembership[]> {
    return from(getDocs(collection(this.firestore, 'households'))).pipe(
      map((snapshot) => {
        const memberships: HouseholdMembership[] = [];
        snapshot.forEach((doc) => {
          const data = doc.data() as Household;
          const membership = (data.members ?? []).find(
            (m) => m.uid === authUser.uid || m.email === authUser.email,
          );
          if (membership) {
            memberships.push({ id: doc.id, name: data.name, role: membership.role });
          }
        });
        return memberships;
      }),
    );
  }

  /**
   * Selects the active household and persists the choice in localStorage so
   * it survives page reloads.
   *
   * @param householdId - Id of the household to make active.
   */
  selectHousehold(householdId: string): void {
    this.selectedHouseholdId$.next(householdId);
    try {
      localStorage.setItem(ACTIVE_HOUSEHOLD_STORAGE_KEY, householdId);
    } catch {
      // localStorage may be unavailable (e.g. private browsing) — selection
      // still works for the current session via the in-memory subject.
    }
  }

  private readStoredHouseholdId(): string | null {
    try {
      return localStorage.getItem(ACTIVE_HOUSEHOLD_STORAGE_KEY);
    } catch {
      return null;
    }
  }
}
