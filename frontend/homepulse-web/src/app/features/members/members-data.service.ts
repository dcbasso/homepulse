import { Injectable, inject } from '@angular/core';
import { Firestore, arrayRemove, arrayUnion, doc, updateDoc } from '@angular/fire/firestore';
import { Observable, firstValueFrom, map, switchMap, take } from 'rxjs';
import { FirestoreService } from '../../core/firestore.service';
import { HouseholdContextService } from '../../core/household-context.service';
import { Household, HouseholdMember, HouseholdRole } from '../../core/models/household.model';

/**
 * Manages the `members[]` array on the active household's root document
 * (see ADR 0003). Membership is a manually administered allowlist (see ADR
 * 0005) — there is no self-signup, so adding a member here is what grants
 * them access.
 */
@Injectable({ providedIn: 'root' })
export class MembersDataService {
  private firestore = inject(Firestore);
  private firestoreService = inject(FirestoreService);
  private householdContext = inject(HouseholdContextService);

  /**
   * Returns a real-time observable of the active household's member list.
   */
  getMembers(): Observable<HouseholdMember[]> {
    return this.householdContext.activeHouseholdId$.pipe(
      switchMap((householdId) => this.firestoreService.getDoc<Household>(`households/${householdId}`)),
      map((household) => household?.members ?? []),
    );
  }

  /**
   * Adds a new member to the active household by email.
   *
   * The member's `uid` is left empty until they sign in for the first time —
   * {@link HouseholdContextService.resolveMembershipsFor} falls back to
   * matching by email for members without a resolved uid yet.
   *
   * @param email - Email address of the person to grant access to.
   * @param role - Role to assign to the new member.
   * @throws Error when there is no active household.
   */
  async addMember(email: string, role: HouseholdRole): Promise<void> {
    const householdId = await this.requireActiveHouseholdId();
    const member: HouseholdMember = { uid: '', email, role };
    await updateDoc(doc(this.firestore, `households/${householdId}`), {
      members: arrayUnion(member),
    });
  }

  /**
   * Removes a member from the active household, revoking their access.
   *
   * @param member - The exact member entry to remove, as read from {@link getMembers}.
   * @throws Error when there is no active household.
   */
  async removeMember(member: HouseholdMember): Promise<void> {
    const householdId = await this.requireActiveHouseholdId();
    await updateDoc(doc(this.firestore, `households/${householdId}`), {
      members: arrayRemove(member),
    });
  }

  private async requireActiveHouseholdId(): Promise<string> {
    const householdId = await firstValueFrom(this.householdContext.activeHouseholdId$.pipe(take(1)));
    if (!householdId) {
      throw new Error('No active household');
    }
    return householdId;
  }
}
