/**
 * Cross-tenant isolation tests for `firestore.rules` (Fase 8 of
 * docs/adr/ROADMAP.md, ADR 0002/0006).
 *
 * Runs against the Firestore emulator (see `npm run test:rules`, which
 * wraps this file with `firebase emulators:exec --only firestore`) and
 * proves that a member of one household can never read or write another
 * household's data through the deployed security rules, regardless of how
 * a client might attempt the query.
 *
 * This is intentionally separate from `ng test`: it exercises the
 * server-enforced rules directly against a real Firestore emulator, not
 * Angular components, and runs under plain Node rather than jsdom.
 */
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { collectionGroup, getDocs, query, where } from 'firebase/firestore';

const HOUSE_A = 'house-a';
const HOUSE_B = 'house-b';
const USER_A = 'user-a-uid';
const USER_B = 'user-b-uid';

let testEnv: RulesTestEnvironment;

/** Seeds both households with a member, and one document in each readable subcollection. */
async function seedHouseholds(): Promise<void> {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    await db.doc(`households/${HOUSE_A}`).set({ name: 'House A' });
    await db.doc(`households/${HOUSE_A}/members/${USER_A}`).set({
      uid: USER_A,
      email: 'user-a@example.com',
      role: 'owner',
    });
    await db.doc(`households/${HOUSE_A}/heartbeats/hb-a`).set({ timestamp: new Date() });
    await db.doc(`households/${HOUSE_A}/speedtest_results/st-a`).set({ download_mbps: 100 });
    await db.doc(`households/${HOUSE_A}/incidents/inc-a`).set({ started_at: new Date() });
    await db.doc(`households/${HOUSE_A}/monitor_config/current`).set({ max_minutes_without_data: 5 });

    await db.doc(`households/${HOUSE_B}`).set({ name: 'House B' });
    await db.doc(`households/${HOUSE_B}/members/${USER_B}`).set({
      uid: USER_B,
      email: 'user-b@example.com',
      role: 'owner',
    });
    await db.doc(`households/${HOUSE_B}/heartbeats/hb-b`).set({ timestamp: new Date() });
    await db.doc(`households/${HOUSE_B}/speedtest_results/st-b`).set({ download_mbps: 50 });
    await db.doc(`households/${HOUSE_B}/incidents/inc-b`).set({ started_at: new Date() });
    await db.doc(`households/${HOUSE_B}/monitor_config/current`).set({ max_minutes_without_data: 10 });
  });
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: 'homepulse-rules-test',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
      host: '127.0.0.1',
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

afterEach(async () => {
  await testEnv.clearFirestore();
});

describe('household document', () => {
  it('lets a member read their own household', async () => {
    await seedHouseholds();
    const userA = testEnv.authenticatedContext(USER_A, { email: 'user-a@example.com' });
    await assertSucceeds(userA.firestore().doc(`households/${HOUSE_A}`).get());
  });

  it('blocks a member of house A from reading house B', async () => {
    await seedHouseholds();
    const userA = testEnv.authenticatedContext(USER_A, { email: 'user-a@example.com' });
    await assertFails(userA.firestore().doc(`households/${HOUSE_B}`).get());
  });

  it('blocks an unauthenticated caller entirely', async () => {
    await seedHouseholds();
    const anon = testEnv.unauthenticatedContext();
    await assertFails(anon.firestore().doc(`households/${HOUSE_A}`).get());
  });
});

describe('cross-tenant subcollection isolation', () => {
  it.each([
    ['heartbeats', 'hb'],
    ['speedtest_results', 'st'],
    ['incidents', 'inc'],
    ['monitor_config', 'current'],
  ])('blocks a member of house A from reading house B\'s %s', async (collection, docSuffix) => {
    await seedHouseholds();
    const userA = testEnv.authenticatedContext(USER_A, { email: 'user-a@example.com' });
    const docId = collection === 'monitor_config' ? 'current' : `${docSuffix}-b`;
    await assertFails(userA.firestore().doc(`households/${HOUSE_B}/${collection}/${docId}`).get());
  });

  it.each([
    ['heartbeats', 'hb-a'],
    ['speedtest_results', 'st-a'],
    ['incidents', 'inc-a'],
    ['monitor_config', 'current'],
  ])('lets a member of house A read house A\'s %s', async (collection, docId) => {
    await seedHouseholds();
    const userA = testEnv.authenticatedContext(USER_A, { email: 'user-a@example.com' });
    await assertSucceeds(userA.firestore().doc(`households/${HOUSE_A}/${collection}/${docId}`).get());
  });

  it('blocks a member of house A from writing to house B\'s monitor_config', async () => {
    await seedHouseholds();
    const userA = testEnv.authenticatedContext(USER_A, { email: 'user-a@example.com' });
    await assertFails(
      userA.firestore().doc(`households/${HOUSE_B}/monitor_config/current`).set({ max_minutes_without_data: 1 }),
    );
  });

  it('blocks a member of house A from writing to house B\'s members subcollection', async () => {
    await seedHouseholds();
    const userA = testEnv.authenticatedContext(USER_A, { email: 'user-a@example.com' });
    await assertFails(
      userA
        .firestore()
        .doc(`households/${HOUSE_B}/members/intruder`)
        .set({ uid: USER_A, email: 'user-a@example.com', role: 'owner' }),
    );
  });
});

describe('members collectionGroup discovery (HouseholdContextService)', () => {
  it('lets a signed-in user read their own member entry via the collectionGroup rule', async () => {
    await seedHouseholds();
    const userA = testEnv.authenticatedContext(USER_A, { email: 'user-a@example.com' });
    await assertSucceeds(userA.firestore().doc(`households/${HOUSE_A}/members/${USER_A}`).get());
  });

  it('blocks reading another user\'s member entry directly, even by uid path', async () => {
    await seedHouseholds();
    const userA = testEnv.authenticatedContext(USER_A, { email: 'user-a@example.com' });
    await assertFails(userA.firestore().doc(`households/${HOUSE_B}/members/${USER_B}`).get());
  });

  it('lets the collectionGroup("members") query used by resolveMembershipsFor succeed, matched by uid', async () => {
    await seedHouseholds();
    const userA = testEnv.authenticatedContext(USER_A, { email: 'user-a@example.com' });
    const db = userA.firestore();
    const membersGroup = collectionGroup(db, 'members');
    const snapshot = await assertSucceeds(getDocs(query(membersGroup, where('uid', '==', USER_A))));

    expect(snapshot.docs).toHaveLength(1);
    expect(snapshot.docs[0].ref.path).toBe(`households/${HOUSE_A}/members/${USER_A}`);
  });

  it('lets the collectionGroup("members") query used by resolveMembershipsFor succeed, matched by email', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await context
        .firestore()
        .doc(`households/${HOUSE_A}/members/pending-invite`)
        .set({ uid: '', email: 'user-a@example.com', role: 'member' });
    });

    const userA = testEnv.authenticatedContext(USER_A, { email: 'user-a@example.com' });
    const db = userA.firestore();
    const membersGroup = collectionGroup(db, 'members');
    const snapshot = await assertSucceeds(getDocs(query(membersGroup, where('email', '==', 'user-a@example.com'))));

    expect(snapshot.docs).toHaveLength(1);
    expect(snapshot.docs[0].ref.path).toBe(`households/${HOUSE_A}/members/pending-invite`);
  });

  it('blocks a collectionGroup query for another user\'s uid or email — the rule cannot prove the result is safe from a single-field filter alone, so the whole list is denied rather than silently filtered', async () => {
    await seedHouseholds();
    const userA = testEnv.authenticatedContext(USER_A, { email: 'user-a@example.com' });
    const db = userA.firestore();
    const membersGroup = collectionGroup(db, 'members');

    await assertFails(getDocs(query(membersGroup, where('uid', '==', USER_B))));
    await assertFails(getDocs(query(membersGroup, where('email', '==', 'user-b@example.com'))));
  });
});

describe('membership write authorization', () => {
  it('blocks a non-owner/admin member from adding a new member to their own household', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await db.doc(`households/${HOUSE_A}`).set({ name: 'House A' });
      await db.doc(`households/${HOUSE_A}/members/${USER_A}`).set({
        uid: USER_A,
        email: 'user-a@example.com',
        role: 'member',
      });
    });

    const userA = testEnv.authenticatedContext(USER_A, { email: 'user-a@example.com' });
    await assertFails(
      userA
        .firestore()
        .doc(`households/${HOUSE_A}/members/new-person`)
        .set({ uid: '', email: 'new@example.com', role: 'member' }),
    );
  });

  it('lets an owner add a new member to their own household', async () => {
    await seedHouseholds();
    const userA = testEnv.authenticatedContext(USER_A, { email: 'user-a@example.com' });
    await assertSucceeds(
      userA
        .firestore()
        .doc(`households/${HOUSE_A}/members/new-person`)
        .set({ uid: '', email: 'new@example.com', role: 'member' }),
    );
  });
});
