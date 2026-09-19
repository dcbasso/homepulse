import { Injectable, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Auth, user } from '@angular/fire/auth';
import type { User } from '@angular/fire/auth';
import {
  DocumentReference,
  Firestore,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  where,
} from '@angular/fire/firestore';
import { BehaviorSubject, Observable, combineLatest, from, map, of, shareReplay, switchMap } from 'rxjs';
import { Household, HouseholdMember, HouseholdMembership } from './models/household.model';

/** localStorage key used to remember the user's last-selected household. */
const ACTIVE_HOUSEHOLD_STORAGE_KEY = 'homepulse.activeHouseholdId';

/** A `members` subcollection document paired with the household it belongs to. */
interface MemberMatch {
  memberRef: DocumentReference;
  data: HouseholdMember;
}

/**
 * Resolves and tracks which household(s) the signed-in user belongs to, and
 * which one is currently active.
 *
 * Membership is stored as a `households/{householdId}/members/{memberId}`
 * subcollection (see ADR 0006), keyed by Firebase Auth `uid` once the member
 * has signed in at least once, or by email while an admin's invitation is
 * still unclaimed (see ADR 0005 — manual allowlist, no self-signup). Which
 * households a signed-in uid belongs to is resolved via a `collectionGroup`
 * query across all `members` subcollections, matched by `uid` or `email` —
 * this is what `firestore.rules` authorizes for the signed-in user's own
 * entries (see `/{path=**}/members/{memberId}`).
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

  /** True when the signed-in user is an `owner` or `admin` of the active household. */
  readonly canManageActiveHousehold = computed(() => {
    const role = this.activeHousehold()?.role;
    return role === 'owner' || role === 'admin';
  });

  /**
   * Resolves the household memberships for a given Firebase user directly,
   * without going through the reactive {@link households$} stream — used by
   * the login flow to decide whether access is granted before navigating.
   *
   * Matches the `members` collection group by `uid` and by `email`, then
   * reconciles any email-keyed match (an invitation added before the
   * member's first login) by moving it to a `uid`-keyed document, so that
   * `firestore.rules`'s `exists(.../members/$(request.auth.uid))` check
   * authorizes the household from this point on.
   *
   * @param authUser - Signed-in Firebase user to resolve memberships for.
   * @returns Observable emitting the memberships found (empty when the user is not registered in any household).
   */
  resolveMembershipsFor(authUser: User): Observable<HouseholdMembership[]> {
    const membersGroup = collectionGroup(this.firestore, 'members');
    const byUid = getDocs(query(membersGroup, where('uid', '==', authUser.uid)));
    const byEmail = authUser.email
      ? getDocs(query(membersGroup, where('email', '==', authUser.email)))
      : Promise.resolve(null);

    return from(Promise.all([byUid, byEmail])).pipe(
      switchMap(([uidSnapshot, emailSnapshot]) => {
        const matches = new Map<string, MemberMatch>();
        uidSnapshot.forEach((snap) => {
          matches.set(this.householdIdOf(snap.ref), { memberRef: snap.ref, data: snap.data() as HouseholdMember });
        });
        emailSnapshot?.forEach((snap) => {
          const householdId = this.householdIdOf(snap.ref);
          if (!matches.has(householdId)) {
            matches.set(householdId, { memberRef: snap.ref, data: snap.data() as HouseholdMember });
          }
        });

        const unclaimed = Array.from(matches.values()).filter(({ memberRef }) => memberRef.id !== authUser.uid);

        return from(Promise.all(unclaimed.map((match) => this.claimMembership(match, authUser)))).pipe(
          switchMap(() =>
            from(
              Promise.all(
                Array.from(matches.entries()).map(([householdId, { data }]) =>
                  this.loadHouseholdMembership(householdId, data.role),
                ),
              ),
            ),
          ),
          map((memberships) => memberships.filter((m): m is HouseholdMembership => m !== null)),
        );
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

  /**
   * Moves an email-keyed member document (an unclaimed invitation) to a
   * document keyed by the signed-in user's `uid`, so future rule
   * evaluations and lookups can find it by `uid` alone.
   *
   * @param match - The matched member document and its data.
   * @param authUser - The signed-in user claiming the invitation.
   */
  private async claimMembership(match: MemberMatch, authUser: User): Promise<void> {
    const householdId = this.householdIdOf(match.memberRef);
    const claimedRef = doc(this.firestore, `households/${householdId}/members/${authUser.uid}`);
    await setDoc(claimedRef, {
      ...match.data,
      uid: authUser.uid,
      email: authUser.email ?? match.data.email,
    });
    await deleteDoc(match.memberRef);
  }

  /**
   * Loads a household's display name and pairs it with the given role.
   *
   * Returns null for a deactivated household (`status !== 'active'`) so it
   * is excluded from the signed-in user's memberships entirely — this is
   * what makes `AuthService.signInWithGoogle`'s existing "no memberships"
   * check deny login to an owner whose only household(s) are inactive.
   *
   * @param householdId - Id of the household document to read.
   * @param role - The signed-in user's role in that household.
   */
  private async loadHouseholdMembership(
    householdId: string,
    role: HouseholdMembership['role'],
  ): Promise<HouseholdMembership | null> {
    const snapshot = await getDoc(doc(this.firestore, `households/${householdId}`));
    const data = snapshot.data() as Household | undefined;
    const status = data?.status ?? 'active';
    if (status !== 'active') {
      return null;
    }
    return { id: householdId, name: data?.name ?? householdId, role, status };
  }

  private householdIdOf(memberRef: DocumentReference): string {
    return memberRef.parent.parent!.id;
  }

  private readStoredHouseholdId(): string | null {
    try {
      return localStorage.getItem(ACTIVE_HOUSEHOLD_STORAGE_KEY);
    } catch {
      return null;
    }
  }
}
