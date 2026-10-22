import {
  addDoc,
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
  type DocumentData,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { fs } from './firebase';
import { createGroup, setDestination } from './groups';
import { computeTwoWheelerRoute } from './places';

/**
 * Clubs (Firestore):
 *   clubs/{id}                     { name, nameLower, description, city, cityLower, joinPolicy, ownerId, ownerName, memberCount, createdAt, lastActivityAt }
 *   clubs/{id}/members/{uid}       { uid, name, role: owner|admin|member, clubName, joinedAt }
 *   clubs/{id}/joinRequests/{uid}  { uid, name, createdAt }                 (approval clubs)
 *   clubs/{id}/messages/{m}        { uid, name, text, createdAt }           (club chat)
 *   clubs/{id}/events/{e}          { title, notes, startAt, meetPoint?, destination?, createdBy, createdByName,
 *                                    status: scheduled|live|done, rideCode?, rsvpCount, createdAt }
 *   clubs/{id}/events/{e}/rsvps/{uid} { uid, name, createdAt }
 * Permissions live in firestore.rules (members-only content, admin moderation, owner settings).
 */

export type JoinPolicy = 'open' | 'approval';
export type Role = 'owner' | 'admin' | 'member';

export type Club = {
  id: string;
  name: string;
  description: string;
  city: string;
  joinPolicy: JoinPolicy;
  ownerId: string;
  ownerName: string;
  memberCount: number;
  lastActivityAt: number;
};
export type Membership = { clubId: string; clubName: string; role: Role; name: string; uid: string };
export type ClubMember = { uid: string; name: string; role: Role; joinedAt: number };
export type JoinRequest = { uid: string; name: string; createdAt: number };
export type ChatMessage = { id: string; uid: string; name: string; text: string; createdAt: number };
export type Place = { name: string; lat: number; lng: number };
export type ClubEvent = {
  id: string;
  clubId: string;
  title: string;
  notes: string;
  startAt: number;
  meetPoint: Place | null;
  destination: Place | null;
  createdBy: string;
  createdByName: string;
  status: 'scheduled' | 'live' | 'done';
  rideCode: string | null;
  rsvpCount: number;
};

/** Firestore Timestamp | number | pending serverTimestamp → epoch ms */
export function ms(v: any): number {
  if (!v) return Date.now();
  if (typeof v === 'number') return v;
  if (typeof v.toMillis === 'function') return v.toMillis();
  return Date.now();
}
const snapOpts = { serverTimestamps: 'estimate' as const };

function toClub(d: QueryDocumentSnapshot<DocumentData> | { id: string; data: () => any }): Club {
  const x = d.data(snapOpts as any) ?? {};
  return {
    id: d.id,
    name: x.name,
    description: x.description ?? '',
    city: x.city ?? '',
    joinPolicy: x.joinPolicy ?? 'open',
    ownerId: x.ownerId,
    ownerName: x.ownerName ?? '',
    memberCount: x.memberCount ?? 0,
    lastActivityAt: ms(x.lastActivityAt),
  };
}

// ---------- clubs ----------

export async function createClub(
  uid: string,
  ownerName: string,
  c: { name: string; description: string; city: string; joinPolicy: JoinPolicy },
): Promise<string> {
  const ref = doc(collection(fs, 'clubs'));
  const b = writeBatch(fs);
  const name = c.name.trim().slice(0, 60);
  const city = c.city.trim().slice(0, 40);
  b.set(ref, {
    name,
    nameLower: name.toLowerCase(),
    description: c.description.trim().slice(0, 1000),
    city,
    cityLower: city.toLowerCase(),
    joinPolicy: c.joinPolicy,
    ownerId: uid,
    ownerName: ownerName.slice(0, 40),
    memberCount: 1,
    createdAt: serverTimestamp(),
    lastActivityAt: serverTimestamp(),
  });
  b.set(doc(fs, 'clubs', ref.id, 'members', uid), {
    uid,
    name: ownerName.slice(0, 40),
    role: 'owner',
    clubName: name,
    joinedAt: serverTimestamp(),
  });
  await b.commit();
  return ref.id;
}

export async function updateClub(id: string, c: { name: string; description: string; city: string; joinPolicy: JoinPolicy }) {
  const name = c.name.trim().slice(0, 60);
  const city = c.city.trim().slice(0, 40);
  await updateDoc(doc(fs, 'clubs', id), {
    name,
    nameLower: name.toLowerCase(),
    description: c.description.trim().slice(0, 1000),
    city,
    cityLower: city.toLowerCase(),
    joinPolicy: c.joinPolicy,
  });
}

export function subscribeClub(id: string, cb: (c: Club | null) => void, onError: (e: Error) => void): Unsubscribe {
  return onSnapshot(doc(fs, 'clubs', id), (s) => cb(s.exists() ? toClub(s as any) : null), onError);
}

/** Recently active clubs — searched / filtered on the device (club lists are small). */
export function subscribeDiscover(cb: (c: Club[]) => void, onError: (e: Error) => void): Unsubscribe {
  return onSnapshot(
    query(collection(fs, 'clubs'), orderBy('lastActivityAt', 'desc'), limit(100)),
    (s) => cb(s.docs.map(toClub)),
    onError,
  );
}

/** Clubs I'm in (collection-group query on members/{myUid}). */
export function subscribeMyClubs(uid: string, cb: (m: Membership[]) => void, onError: (e: Error) => void): Unsubscribe {
  return onSnapshot(
    query(collectionGroup(fs, 'members'), where('uid', '==', uid)),
    (s) =>
      cb(
        s.docs.map((d) => {
          const x = d.data();
          return { clubId: d.ref.parent.parent!.id, clubName: x.clubName ?? '', role: x.role, name: x.name, uid };
        }),
      ),
    onError,
  );
}

// ---------- membership ----------

export function subscribeMyMembership(clubId: string, uid: string, cb: (m: ClubMember | null) => void): Unsubscribe {
  return onSnapshot(
    doc(fs, 'clubs', clubId, 'members', uid),
    (s) => {
      const x = s.data(snapOpts);
      cb(s.exists() && x ? { uid, name: x.name, role: x.role, joinedAt: ms(x.joinedAt) } : null);
    },
    () => cb(null),
  );
}

export function subscribeMembers(clubId: string, cb: (m: ClubMember[]) => void, onError: (e: Error) => void): Unsubscribe {
  return onSnapshot(
    query(collection(fs, 'clubs', clubId, 'members'), orderBy('joinedAt', 'asc'), limit(500)),
    (s) =>
      cb(
        s.docs.map((d) => {
          const x = d.data(snapOpts);
          return { uid: d.id, name: x.name, role: x.role, joinedAt: ms(x.joinedAt) };
        }),
      ),
    onError,
  );
}

/** Open club: join straight away (member doc + member count, atomically). */
export async function joinClub(club: Club, uid: string, name: string) {
  const b = writeBatch(fs);
  b.set(doc(fs, 'clubs', club.id, 'members', uid), {
    uid,
    name: name.slice(0, 40),
    role: 'member',
    clubName: club.name,
    joinedAt: serverTimestamp(),
  });
  b.update(doc(fs, 'clubs', club.id), { memberCount: increment(1) });
  await b.commit();
}

export async function leaveClub(clubId: string, uid: string) {
  const b = writeBatch(fs);
  b.delete(doc(fs, 'clubs', clubId, 'members', uid));
  b.update(doc(fs, 'clubs', clubId), { memberCount: increment(-1) });
  await b.commit();
}

/** Approval club: ask to join. */
export async function requestToJoin(clubId: string, uid: string, name: string) {
  const b = writeBatch(fs);
  b.set(doc(fs, 'clubs', clubId, 'joinRequests', uid), { uid, name: name.slice(0, 40), createdAt: serverTimestamp() });
  await b.commit();
}

export async function cancelRequest(clubId: string, uid: string) {
  await deleteDoc(doc(fs, 'clubs', clubId, 'joinRequests', uid));
}

export function subscribeMyRequest(clubId: string, uid: string, cb: (pending: boolean) => void): Unsubscribe {
  return onSnapshot(doc(fs, 'clubs', clubId, 'joinRequests', uid), (s) => cb(s.exists()), () => cb(false));
}

export function subscribeRequests(clubId: string, cb: (r: JoinRequest[]) => void, onError: (e: Error) => void): Unsubscribe {
  return onSnapshot(
    query(collection(fs, 'clubs', clubId, 'joinRequests'), orderBy('createdAt', 'asc'), limit(200)),
    (s) =>
      cb(
        s.docs.map((d) => {
          const x = d.data(snapOpts);
          return { uid: d.id, name: x.name, createdAt: ms(x.createdAt) };
        }),
      ),
    onError,
  );
}

/** Admin: accept a request — creates the membership and removes the request. */
export async function approveRequest(club: Club, r: JoinRequest) {
  const b = writeBatch(fs);
  b.set(doc(fs, 'clubs', club.id, 'members', r.uid), {
    uid: r.uid,
    name: r.name,
    role: 'member',
    clubName: club.name,
    joinedAt: serverTimestamp(),
  });
  b.update(doc(fs, 'clubs', club.id), { memberCount: increment(1) });
  b.delete(doc(fs, 'clubs', club.id, 'joinRequests', r.uid));
  await b.commit();
}

export async function declineRequest(clubId: string, uid: string) {
  await deleteDoc(doc(fs, 'clubs', clubId, 'joinRequests', uid));
}

/** Admin: remove a member. */
export async function removeMember(clubId: string, uid: string) {
  await leaveClub(clubId, uid);
}

/** Owner: make someone an admin or a regular member. */
export async function setRole(clubId: string, uid: string, role: 'admin' | 'member') {
  await updateDoc(doc(fs, 'clubs', clubId, 'members', uid), { role });
}

// ---------- chat ----------

export function subscribeChat(clubId: string, max: number, cb: (m: ChatMessage[]) => void, onError: (e: Error) => void): Unsubscribe {
  return onSnapshot(
    query(collection(fs, 'clubs', clubId, 'messages'), orderBy('createdAt', 'desc'), limit(max)),
    (s) =>
      cb(
        s.docs.map((d) => {
          const x = d.data(snapOpts);
          return { id: d.id, uid: x.uid, name: x.name, text: x.text, createdAt: ms(x.createdAt) };
        }),
      ),
    onError,
  );
}

export async function sendMessage(clubId: string, uid: string, name: string, text: string) {
  const t = text.trim().slice(0, 1000);
  if (!t) return;
  await addDoc(collection(fs, 'clubs', clubId, 'messages'), { uid, name: name.slice(0, 40), text: t, createdAt: serverTimestamp() });
  updateDoc(doc(fs, 'clubs', clubId), { lastActivityAt: serverTimestamp() }).catch(() => {});
}

export async function deleteMessage(clubId: string, id: string) {
  await deleteDoc(doc(fs, 'clubs', clubId, 'messages', id));
}

// ---------- group rides (events) ----------

function toEvent(clubId: string, d: { id: string; data: (o?: any) => any }): ClubEvent {
  const x = d.data(snapOpts);
  return {
    id: d.id,
    clubId,
    title: x.title,
    notes: x.notes ?? '',
    startAt: x.startAt,
    meetPoint: x.meetPoint ?? null,
    destination: x.destination ?? null,
    createdBy: x.createdBy,
    createdByName: x.createdByName ?? '',
    status: x.status ?? 'scheduled',
    rideCode: x.rideCode ?? null,
    rsvpCount: x.rsvpCount ?? 0,
  };
}

export function subscribeEvents(clubId: string, cb: (e: ClubEvent[]) => void, onError: (e: Error) => void): Unsubscribe {
  // Rides from the last 12 h onwards (so a ride in progress still shows)
  return onSnapshot(
    query(
      collection(fs, 'clubs', clubId, 'events'),
      where('startAt', '>=', Date.now() - 12 * 3600_000),
      orderBy('startAt', 'asc'),
      limit(50),
    ),
    (s) => cb(s.docs.map((d) => toEvent(clubId, d))),
    onError,
  );
}

export function subscribeEvent(clubId: string, id: string, cb: (e: ClubEvent | null) => void, onError: (e: Error) => void): Unsubscribe {
  return onSnapshot(doc(fs, 'clubs', clubId, 'events', id), (s) => cb(s.exists() ? toEvent(clubId, s) : null), onError);
}

export async function createEvent(
  clubId: string,
  uid: string,
  name: string,
  e: { title: string; notes: string; startAt: number; meetPoint: Place | null; destination: Place | null },
): Promise<string> {
  const r = await addDoc(collection(fs, 'clubs', clubId, 'events'), {
    title: e.title.trim().slice(0, 80),
    notes: e.notes.trim().slice(0, 2000),
    startAt: e.startAt,
    meetPoint: e.meetPoint,
    destination: e.destination,
    createdBy: uid,
    createdByName: name.slice(0, 40),
    status: 'scheduled',
    rideCode: null,
    rsvpCount: 0,
    createdAt: serverTimestamp(),
  });
  updateDoc(doc(fs, 'clubs', clubId), { lastActivityAt: serverTimestamp() }).catch(() => {});
  return r.id;
}

export async function deleteEvent(clubId: string, id: string) {
  await deleteDoc(doc(fs, 'clubs', clubId, 'events', id));
}

export function subscribeRsvps(
  clubId: string,
  eventId: string,
  cb: (r: { uid: string; name: string }[]) => void,
  onError: (e: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(collection(fs, 'clubs', clubId, 'events', eventId, 'rsvps'), orderBy('createdAt', 'asc'), limit(500)),
    (s) => cb(s.docs.map((d) => ({ uid: d.id, name: d.data().name }))),
    onError,
  );
}

export async function setRsvp(clubId: string, eventId: string, uid: string, name: string, going: boolean) {
  const b = writeBatch(fs);
  const r = doc(fs, 'clubs', clubId, 'events', eventId, 'rsvps', uid);
  if (going) b.set(r, { uid, name: name.slice(0, 40), createdAt: serverTimestamp() });
  else b.delete(r);
  b.update(doc(fs, 'clubs', clubId, 'events', eventId), { rsvpCount: increment(going ? 1 : -1) });
  await b.commit();
}

/**
 * Organiser starts the group ride: creates the live ride (with the planned destination and its
 * two-wheeler route) and publishes its code on the event so RSVP'd members can join.
 */
export async function startEventRide(
  ev: ClubEvent,
  uid: string,
  name: string,
  from: { latitude: number; longitude: number } | null,
): Promise<string> {
  const code = await createGroup(ev.title, uid, name, { clubId: ev.clubId, eventId: ev.id });
  if (ev.destination) {
    const route =
      from &&
      (await computeTwoWheelerRoute(from, { latitude: ev.destination.lat, longitude: ev.destination.lng }).catch(() => null));
    await setDestination(code, {
      lat: ev.destination.lat,
      lng: ev.destination.lng,
      name: ev.destination.name.slice(0, 120),
      address: '',
      polyline: route?.polyline ?? null,
      distanceM: route?.distanceM ?? null,
      durationS: route?.durationS ?? null,
    }).catch(() => {});
  }
  await updateDoc(doc(fs, 'clubs', ev.clubId, 'events', ev.id), { status: 'live', rideCode: code });
  return code;
}

export async function markEventDone(clubId: string, eventId: string) {
  await updateDoc(doc(fs, 'clubs', clubId, 'events', eventId), { status: 'done' });
}

/** Upcoming / live rides across my clubs, for the Ride tab. */
export async function upcomingRidesFor(clubIds: string[]): Promise<(ClubEvent & { clubName?: string })[]> {
  const lists = await Promise.all(
    clubIds.slice(0, 20).map((id) =>
      getDocs(
        query(
          collection(fs, 'clubs', id, 'events'),
          where('startAt', '>=', Date.now() - 12 * 3600_000),
          orderBy('startAt', 'asc'),
          limit(5),
        ),
      )
        .then((s) => s.docs.map((d) => toEvent(id, d)))
        .catch(() => [] as ClubEvent[]),
    ),
  );
  return lists
    .flat()
    .filter((e) => e.status !== 'done')
    .sort((a, b) => a.startAt - b.startAt);
}

export async function getClub(id: string): Promise<Club | null> {
  const s = await getDoc(doc(fs, 'clubs', id));
  return s.exists() ? toClub(s as any) : null;
}

/** "Sun 26 Oct · 6:00 am" */
export function eventWhen(t: number): string {
  const d = new Date(t);
  return `${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} · ${d.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })}`;
}
