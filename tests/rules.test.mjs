// Security-rule tests against the local emulators:  npm run emulators  (one terminal)
//                                                    npm run test:rules (another)
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import { test, after, before, beforeEach } from 'node:test';
import { ref, set, update, get } from 'firebase/database';
import { doc, getDoc, setDoc, deleteDoc, serverTimestamp, writeBatch, increment, updateDoc, addDoc, collection, getDocs, query, where, collectionGroup } from 'firebase/firestore';

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

// ---------- Firestore: clubs ----------

async function makeClub(fs, id, owner, joinPolicy = 'open') {
  const b = writeBatch(fs);
  b.set(doc(fs, `clubs/${id}`), {
    name: 'Bangalore Riders', nameLower: 'bangalore riders', description: '', city: 'Bengaluru', cityLower: 'bengaluru',
    joinPolicy, ownerId: owner, ownerName: 'Owner', memberCount: 1, createdAt: 1, lastActivityAt: 1,
  });
  b.set(doc(fs, `clubs/${id}/members/${owner}`), { uid: owner, name: 'Owner', role: 'owner', clubName: 'Bangalore Riders', joinedAt: 1 });
  return b.commit();
}
function joinBatch(fs, id, uid) {
  const b = writeBatch(fs);
  b.set(doc(fs, `clubs/${id}/members/${uid}`), { uid, name: uid, role: 'member', clubName: 'Bangalore Riders', joinedAt: 1 });
  b.update(doc(fs, `clubs/${id}`), { memberCount: increment(1) });
  return b.commit();
}

test('anyone signed in can found a club (owner membership in the same batch)', async () => {
  await assertSucceeds(makeClub(google('ashu').firestore(), 'c1', 'ashu'));
  // claiming to be someone else's club fails
  await assertFails(makeClub(google('meera').firestore(), 'c2', 'ashu'));
});

test('open club: self-join and leave keep the member count right', async () => {
  await makeClub(google('ashu').firestore(), 'c1', 'ashu', 'open');
  const fs = google('meera').firestore();
  await assertSucceeds(joinBatch(fs, 'c1', 'meera'));
  // can't bump the count without actually joining
  await assertFails(updateDoc(doc(google('kabir').firestore(), 'clubs/c1'), { memberCount: increment(1) }));
  const b = writeBatch(fs);
  b.delete(doc(fs, 'clubs/c1/members/meera'));
  b.update(doc(fs, 'clubs/c1'), { memberCount: increment(-1) });
  await assertSucceeds(b.commit());
});

test('approval club: no self-join; request → admin approves', async () => {
  await makeClub(google('ashu').firestore(), 'c1', 'ashu', 'approval');
  const meera = google('meera').firestore();
  await assertFails(joinBatch(meera, 'c1', 'meera'));
  await assertSucceeds(setDoc(doc(meera, 'clubs/c1/joinRequests/meera'), { uid: 'meera', name: 'Meera', createdAt: 1 }));
  // another rider can't approve
  await assertFails(joinBatch(google('kabir').firestore(), 'c1', 'meera'));
  const owner = google('ashu').firestore();
  const b = writeBatch(owner);
  b.set(doc(owner, 'clubs/c1/members/meera'), { uid: 'meera', name: 'Meera', role: 'member', clubName: 'x', joinedAt: 1 });
  b.update(doc(owner, 'clubs/c1'), { memberCount: increment(1) });
  b.delete(doc(owner, 'clubs/c1/joinRequests/meera'));
  await assertSucceeds(b.commit());
});

test('club chat is members-only; authors and admins can delete', async () => {
  await makeClub(google('ashu').firestore(), 'c1', 'ashu');
  await joinBatch(google('meera').firestore(), 'c1', 'meera');
  const msg = { uid: 'meera', name: 'Meera', text: 'Ride on Sunday?', createdAt: 1 };
  await assertSucceeds(setDoc(doc(google('meera').firestore(), 'clubs/c1/messages/m1'), msg));
  await assertFails(getDoc(doc(google('outsider').firestore(), 'clubs/c1/messages/m1')));
  await assertFails(setDoc(doc(google('outsider').firestore(), 'clubs/c1/messages/m2'), { ...msg, uid: 'outsider' }));
  await assertFails(setDoc(doc(google('meera').firestore(), 'clubs/c1/messages/m3'), { ...msg, uid: 'ashu' })); // spoofing
  await assertSucceeds(deleteDoc(doc(google('ashu').firestore(), 'clubs/c1/messages/m1'))); // owner moderates
});

test('roles: only the owner promotes; members cannot remove each other; owner cannot be removed', async () => {
  await makeClub(google('ashu').firestore(), 'c1', 'ashu');
  await joinBatch(google('meera').firestore(), 'c1', 'meera');
  await joinBatch(google('kabir').firestore(), 'c1', 'kabir');
  await assertFails(updateDoc(doc(google('meera').firestore(), 'clubs/c1/members/kabir'), { role: 'admin' }));
  await assertSucceeds(updateDoc(doc(google('ashu').firestore(), 'clubs/c1/members/meera'), { role: 'admin' }));
  await assertFails(deleteDoc(doc(google('kabir').firestore(), 'clubs/c1/members/meera')));
  await assertFails(deleteDoc(doc(google('meera').firestore(), 'clubs/c1/members/ashu')));
});

test('group rides: admins schedule; members RSVP with a matching count', async () => {
  await makeClub(google('ashu').firestore(), 'c1', 'ashu');
  await joinBatch(google('meera').firestore(), 'c1', 'meera');
  const ev = { title: 'Nandi sunrise', notes: '', startAt: 9e12, meetPoint: null, destination: null, createdBy: 'meera',
    createdByName: 'Meera', status: 'scheduled', rideCode: null, rsvpCount: 0, createdAt: 1 };
  await assertFails(setDoc(doc(google('meera').firestore(), 'clubs/c1/events/e1'), ev)); // members can't schedule
  await assertSucceeds(setDoc(doc(google('ashu').firestore(), 'clubs/c1/events/e1'), { ...ev, createdBy: 'ashu' }));
  const fs = google('meera').firestore();
  const b = writeBatch(fs);
  b.set(doc(fs, 'clubs/c1/events/e1/rsvps/meera'), { uid: 'meera', name: 'Meera', createdAt: 1 });
  b.update(doc(fs, 'clubs/c1/events/e1'), { rsvpCount: increment(1) });
  await assertSucceeds(b.commit());
  await assertFails(updateDoc(doc(fs, 'clubs/c1/events/e1'), { rsvpCount: increment(5) }));
  await assertFails(updateDoc(doc(fs, 'clubs/c1/events/e1'), { status: 'live', rideCode: 'ABC234' })); // not organiser
  await assertSucceeds(updateDoc(doc(google('ashu').firestore(), 'clubs/c1/events/e1'), { status: 'live', rideCode: 'ABC234' }));
});

test('"my clubs" collection-group query only returns my own memberships', async () => {
  await makeClub(google('ashu').firestore(), 'c1', 'ashu');
  await assertSucceeds(getDocs(query(collectionGroup(google('ashu').firestore(), 'members'), where('uid', '==', 'ashu'))));
});

// ---------- Firestore: community forum ----------
const post = { title: 'Best sunrise ride near Bengaluru?', body: 'Nandi or Skandagiri?', city: 'Bengaluru',
  authorId: 'meera', authorName: 'Meera', replyCount: 0, createdAt: 1, lastActivityAt: 1 };

test('forum: post as yourself, reply bumps the count by one, only authors delete', async () => {
  const meera = google('meera').firestore();
  await assertSucceeds(setDoc(doc(meera, 'forum/t1'), post));
  await assertFails(setDoc(doc(meera, 'forum/t2'), { ...post, authorId: 'ashu' }));
  const kabir = google('kabir').firestore();
  const b = writeBatch(kabir);
  b.set(doc(kabir, 'forum/t1/replies/r1'), { body: 'Skandagiri!', authorId: 'kabir', authorName: 'Kabir', createdAt: 1 });
  b.update(doc(kabir, 'forum/t1'), { replyCount: increment(1), lastActivityAt: 2 });
  await assertSucceeds(b.commit());
  await assertFails(updateDoc(doc(kabir, 'forum/t1'), { title: 'hijacked' }));
  await assertFails(deleteDoc(doc(kabir, 'forum/t1')));
  await assertFails(getDoc(doc(anon('old').firestore(), 'forum/t1')));
});

test('reports: riders can file them but not read them', async () => {
  const fs = google('meera').firestore();
  await assertSucceeds(addDoc(collection(fs, 'reports'), { path: 'forum/t1', reason: 'spam', reporterId: 'meera', createdAt: 1 }));
  await assertFails(getDocs(collection(fs, 'reports')));
});
