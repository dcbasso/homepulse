/** Role a member holds within a household, per ADR 0003/0005. */
export type HouseholdRole = 'owner' | 'admin' | 'member';

/** A single entry of the `members[]` array stored on `households/{id}`. */
export interface HouseholdMember {
  uid: string;
  email: string;
  role: HouseholdRole;
}

/** Firestore document schema for `households/{id}`. */
export interface Household {
  name: string;
  status: string;
  members: HouseholdMember[];
}

/** A household the signed-in user belongs to, with their role in it. */
export interface HouseholdMembership {
  id: string;
  name: string;
  role: HouseholdRole;
}
