// Security-rule tests against the local emulators:  npm run emulators  (one terminal)
//                                                    npm run test:rules (another)
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { test, after, before, beforeEach } from 'node:test';
import { ref, set, update, get } from 'firebase/database';
import { doc, getDoc, setDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';

let env;
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-ridetogether',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
    database: { rules: readFileSync('database.rules.json', 'utf8'), host: '127.0.0.1', port: 9000 },
  });
});
beforeEach(() => Promise.all([env.clearFirestore(), env.clearDatabase()]));
after(() => env.cleanup());

const google = (uid) => env.authenticatedContext(uid, { firebase: { sign_in_provider: 'google.com' } });
const anon = (uid) => env.authenticatedContext(uid, { firebase: { sign_in_provider: 'anonymous' } });
const profile = { displayName: 'Ashu', bike: 'Duke 390', city: 'Bengaluru', photoURL: null };

// ---------- Firestore: users/{uid} ----------
test('a rider can create and edit their own profile', async () => {
  const fs = google('ashu').firestore();
  await assertSucceeds(setDoc(doc(fs, 'users/ashu'), { ...profile, createdAt: serverTimestamp() }));
  await assertSucceeds(setDoc(doc(fs, 'users/ashu'), { displayName: 'Ashu D' }, { merge: true }));
});

test("nobody can write someone else's profile", async () => {
  await assertFails(setDoc(doc(google('meera').firestore(), 'users/ashu'), profile));
});

test('profiles are readable by signed-in riders only (not anonymous, not signed out)', async () => {
  await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'users/ashu'), profile));
  await assertSucceeds(getDoc(doc(google('meera').firestore(), 'users/ashu')));
  await assertFails(getDoc(doc(anon('old').firestore(), 'users/ashu')));
  await assertFails(getDoc(doc(env.unauthenticatedContext().firestore(), 'users/ashu')));
});

test('profile fields are validated', async () => {
  const fs = google('ashu').firestore();
  await assertFails(setDoc(doc(fs, 'users/ashu'), { ...profile, displayName: 'A' })); // too short
  await assertFails(setDoc(doc(fs, 'users/ashu'), { ...profile, displayName: 'x'.repeat(41) }));
  await assertFails(setDoc(doc(fs, 'users/ashu'), { ...profile, isAdmin: true })); // unknown field
  await assertFails(deleteDoc(doc(fs, 'users/ashu')));
});

// ---------- Realtime Database: colour slots ----------
async function makeRide(code = 'ABC234', leader = 'lead') {
  await env.withSecurityRulesDisabled((c) =>
    set(ref(c.database(), `groups/${code}`), {
      meta: { name: 'Test', createdBy: leader, createdAt: Date.now() },
      members: { [leader]: { name: 'Lead', color: '#E6194B', colorIdx: 0, joinedAt: Date.now() } },
      colors: { 0: leader },
    }),
  );
  return code;
}

test('a rider can claim a free colour, but not one already taken', async () => {
  const code = await makeRide();
  const db = google('kabir').database();
  await assertSucceeds(set(ref(db, `groups/${code}/colors/1`), 'kabir'));
  await assertFails(set(ref(db, `groups/${code}/colors/0`), 'kabir')); // the leader's
  await assertFails(set(ref(google('sam').database(), `groups/${code}/colors/1`), 'sam')); // Kabir's now
});

test("riders can only claim slots for themselves and only release their own", async () => {
  const code = await makeRide();
  await assertFails(set(ref(google('kabir').database(), `groups/${code}/colors/2`), 'someone-else'));
  await assertFails(set(ref(google('kabir').database(), `groups/${code}/colors/0`), null));
  await assertSucceeds(set(ref(google('lead').database(), `groups/${code}/colors/0`), null));
});

test('colour slots are limited to 0–15', async () => {
  const code = await makeRide();
  await assertFails(set(ref(google('kabir').database(), `groups/${code}/colors/16`), 'kabir'));
});

test('only the leader can end the ride', async () => {
  const code = await makeRide();
  await assertFails(update(ref(google('kabir').database(), `groups/${code}`), { 'meta/endedAt': Date.now() }));
  await assertSucceeds(update(ref(google('lead').database(), `groups/${code}`), { 'meta/endedAt': Date.now() }));
});

// ---------- Firestore: users/{uid}/rides (history) ----------
const ride = {
  code: 'ABC234', name: 'Nandi Hills', startedAt: 1, endedAt: 2, durationS: 3600, movingS: 3000,
  distanceM: 52000, avgKmh: 62, maxKmh: 98, polyline: 'abc', speeds: [40, 50], riders: ['Ashu', 'Meera'],
  wasLeader: true, destination: 'Nandi Hills',
};

test('a rider can save and read their own ride history', async () => {
  const fs = google('ashu').firestore();
  await assertSucceeds(setDoc(doc(fs, 'users/ashu/rides/r1'), ride));
  await assertSucceeds(getDoc(doc(fs, 'users/ashu/rides/r1')));
  await assertSucceeds(deleteDoc(doc(fs, 'users/ashu/rides/r1')));
});

test("ride history is private — others can't read or write it", async () => {
  await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'users/ashu/rides/r1'), ride));
  await assertFails(getDoc(doc(google('meera').firestore(), 'users/ashu/rides/r1')));
  await assertFails(setDoc(doc(google('meera').firestore(), 'users/ashu/rides/r2'), ride));
});

test('saved rides cannot be edited and fields are checked', async () => {
  const fs = google('ashu').firestore();
  await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'users/ashu/rides/r1'), ride));
  await assertFails(setDoc(doc(fs, 'users/ashu/rides/r1'), { ...ride, distanceM: 999999 }));
  await assertFails(setDoc(doc(fs, 'users/ashu/rides/r3'), { ...ride, hacked: true }));
  await assertFails(setDoc(doc(fs, 'users/ashu/rides/r4'), { ...ride, speeds: new Array(2001).fill(1) }));
});
