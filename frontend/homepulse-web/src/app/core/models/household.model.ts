/** Role a member holds within a household, per ADR 0003/0005. */
export type HouseholdRole = 'owner' | 'admin' | 'member';

/**
 * Firestore document schema for `households/{householdId}/members/{memberId}`
 * (see ADR 0006). The document id is the member's Firebase Auth `uid` once
 * they have signed in at least once; until then it is keyed by their email
 * (see {@link HouseholdContextService.resolveMembershipsFor} for the
 * first-login reconciliation that renames it to the `uid`).
 */
export interface HouseholdMember {
  uid: string;
  email: string;
  role: HouseholdRole;
}

/** Firestore document schema for `households/{id}`. */
export interface Household {
  name: string;
  status: string;
  /** SHA-256 hashes (plus metadata) of issued ingest API keys — never the raw key. */
  api_keys?: unknown[];
}

/** A household the signed-in user belongs to, with their role in it. */
export interface HouseholdMembership {
  id: string;
  name: string;
  role: HouseholdRole;
  status: string;
}
