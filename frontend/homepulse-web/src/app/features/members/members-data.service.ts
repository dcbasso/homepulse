import { Injectable, inject } from '@angular/core';
import { Firestore, deleteDoc, doc, setDoc } from '@angular/fire/firestore';
import { Observable, firstValueFrom, switchMap, take } from 'rxjs';
import { FirestoreService } from '../../core/firestore.service';
import { HouseholdContextService } from '../../core/household-context.service';
import { HouseholdMember, HouseholdRole } from '../../core/models/household.model';

/** A household member as read from the `members` subcollection, including its document id. */
export type HouseholdMemberEntry = HouseholdMember & { id: string };

/**
 * Manages the `households/{householdId}/members` subcollection (see ADR
 * 0006). Membership is a manually administered allowlist (see ADR 0005) —
 * there is no self-signup, so adding a member here is what grants them
 * access. A newly added member's document is keyed by email until their
 * first login, at which point {@link HouseholdContextService} claims it
 * under their `uid` (required for `firestore.rules`'s `exists()` check).
 */
@Injectable({ providedIn: 'root' })
export class MembersDataService {
  private firestore = inject(Firestore);
  private firestoreService = inject(FirestoreService);
  private householdContext = inject(HouseholdContextService);

  /**
   * Returns a real-time observable of the active household's member list.
   */
  getMembers(): Observable<HouseholdMemberEntry[]> {
    return this.householdContext.activeHouseholdId$.pipe(
      switchMap((householdId) =>
        this.firestoreService.getCollection<HouseholdMemberEntry>(`households/${householdId}/members`),
      ),
    );
  }

  /**
   * Adds a new member to the active household by email, keyed by that email
   * until the member signs in for the first time.
   *
   * @param email - Email address of the person to grant access to.
   * @param role - Role to assign to the new member.
   * @throws Error when there is no active household.
   */
  async addMember(email: string, role: HouseholdRole): Promise<void> {
    const householdId = await this.requireActiveHouseholdId();
    const member: HouseholdMember = { uid: '', email, role };
    await setDoc(doc(this.firestore, `households/${householdId}/members/${email}`), member);
  }

  /**
   * Removes a member from the active household, revoking their access.
   *
   * @param member - The member entry to remove, as read from {@link getMembers}.
   * @throws Error when there is no active household.
   */
  async removeMember(member: HouseholdMemberEntry): Promise<void> {
    const householdId = await this.requireActiveHouseholdId();
    await deleteDoc(doc(this.firestore, `households/${householdId}/members/${member.id}`));
  }

  private async requireActiveHouseholdId(): Promise<string> {
    const householdId = await firstValueFrom(this.householdContext.activeHouseholdId$.pipe(take(1)));
    if (!householdId) {
      throw new Error('No active household');
    }
    return householdId;
  }
}
