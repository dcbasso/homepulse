import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Firestore, deleteDoc, doc, setDoc } from '@angular/fire/firestore';
import { Observable, firstValueFrom, switchMap, take } from 'rxjs';
import { FirestoreService } from '../../core/firestore.service';
import { AuthService } from '../../core/auth.service';
import { HouseholdContextService } from '../../core/household-context.service';
import { HouseholdMember, HouseholdRole } from '../../core/models/household.model';
import { environment } from '../../../environments/environment';

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
  private authService = inject(AuthService);
  private http = inject(HttpClient);

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
   * Updates the role of an existing member of the active household.
   *
   * @param member - The member entry to update, as read from {@link getMembers}.
   * @param role - The new role to assign to the member.
   * @throws Error when there is no active household.
   */
  async updateMemberRole(member: HouseholdMemberEntry, role: HouseholdRole): Promise<void> {
    const householdId = await this.requireActiveHouseholdId();
    await setDoc(doc(this.firestore, `households/${householdId}/members/${member.id}`), { role }, { merge: true });
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

  /**
   * Sends (or resends) an invite email to an existing member of the active
   * household, pointing them at the app and the client download page.
   * Restricted server-side to owner/admin callers, and to emails already
   * present in the household's member list.
   *
   * @param memberEmail - Email of the member to invite.
   * @throws Error when the caller is not signed in, there is no active
   *   household, or the Cloud Function rejects the request.
   */
  async sendInvite(memberEmail: string): Promise<void> {
    const idToken = await this.authService.getIdToken();
    if (!idToken) {
      throw new Error('Not signed in');
    }
    const householdId = await this.requireActiveHouseholdId();
    await firstValueFrom(
      this.http.post<{ ok: boolean }>(
        environment.inviteFunctionUrl,
        { household_id: householdId, member_email: memberEmail },
        { headers: { Authorization: `Bearer ${idToken}` } },
      ),
    );
  }

  private async requireActiveHouseholdId(): Promise<string> {
    const householdId = await firstValueFrom(this.householdContext.activeHouseholdId$.pipe(take(1)));
    if (!householdId) {
      throw new Error('No active household');
    }
    return householdId;
  }
}
