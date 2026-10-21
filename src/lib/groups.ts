import {
  get,
  onValue,
  ref,
  remove,
  serverTimestamp,
  set,
  update,
  type Unsubscribe,
} from 'firebase/database';
import { Linking, Share } from 'react-native';
import { db } from './firebase';

/**
 * Realtime Database layout (Realtime DB is billed by bandwidth, not per write,
 * so frequent GPS updates from big groups stay cheap — Firestore would charge every update):
 *
 * groups/{CODE}/meta                 { name, createdBy, createdAt }
 * groups/{CODE}/members/{uid}        { name, color, joinedAt }
 * groups/{CODE}/locations/{uid}      { lat, lng, heading, speed, accuracy, battery, status, ts }
 */

export type RiderStatus = 'ok' | 'stop' | 'sos';

/** `endedAt` is set once by the leader; after that nobody can join or share a location. */
export type GroupMeta = { name: string; createdBy: string; createdAt: number; endedAt?: number };
export type Member = { name: string; color: string; joinedAt: number };
export type RiderLocation = {
  lat: number;
  lng: number;
  heading?: number | null;
  speed?: number | null;
  accuracy?: number | null;
  battery?: number | null;
  status?: RiderStatus;
  ts: number;
};

export type Rider = Member & { uid: string; loc?: RiderLocation };

// No 0/O/1/I/L — easy to read out loud on the roadside
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;

export const RIDER_COLORS = [
  '#FF6B00', '#00C2FF', '#7CFF4F', '#FF3D7F', '#FFD400', '#B46BFF',
  '#00E0B0', '#FF8A65', '#4F8BFF', '#E040FB', '#C6FF00', '#FF5252',
];

export function colorForUid(uid: string): string {
  let h = 0;
  for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) >>> 0;
  return RIDER_COLORS[h % RIDER_COLORS.length];
}

export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, CODE_LENGTH);
}

function randomCode(): string {
  let c = '';
  for (let i = 0; i < CODE_LENGTH; i++) c += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return c;
}

export async function createGroup(groupName: string, uid: string, riderName: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomCode();
    const exists = await get(ref(db, `groups/${code}/meta`));
    if (exists.exists()) continue;
    await update(ref(db, `groups/${code}`), {
      meta: { name: groupName.trim() || 'Group ride', createdBy: uid, createdAt: serverTimestamp() },
      [`members/${uid}`]: { name: riderName, color: colorForUid(uid), joinedAt: serverTimestamp() },
    });
    return code;
  }
  throw new Error('Could not allocate a group code, please try again.');
}

export async function getGroupMeta(code: string): Promise<GroupMeta | null> {
  const snap = await get(ref(db, `groups/${code}/meta`));
  return snap.exists() ? (snap.val() as GroupMeta) : null;
}

export async function joinGroup(code: string, uid: string, riderName: string): Promise<GroupMeta> {
  const meta = await getGroupMeta(code);
  if (!meta) throw new Error(`No ride found with code ${code}. Check the code or ask for a new link.`);
  if (meta.endedAt) throw new Error(`The ride "${meta.name}" has already ended.`);
  await set(ref(db, `groups/${code}/members/${uid}`), {
    name: riderName,
    color: colorForUid(uid),
    joinedAt: serverTimestamp(),
  });
  return meta;
}

export async function leaveGroup(code: string, uid: string) {
  await update(ref(db, `groups/${code}`), {
    [`members/${uid}`]: null,
    [`locations/${uid}`]: null,
  });
}

/**
 * Leader only (enforced by the database rules): ends the ride for everyone and wipes
 * all last-known positions. Every rider's app sees `endedAt` and stops sharing.
 */
export async function endRide(code: string) {
  await update(ref(db, `groups/${code}`), {
    'meta/endedAt': serverTimestamp(),
    locations: null,
  });
}

export async function isMember(code: string, uid: string): Promise<boolean> {
  const snap = await get(ref(db, `groups/${code}/members/${uid}`));
  return snap.exists();
}

export async function publishLocation(code: string, uid: string, loc: Omit<RiderLocation, 'ts'>) {
  // Keep the status the rider set (SOS / stop) — only overwrite position fields
  await update(ref(db, `groups/${code}/locations/${uid}`), { ...loc, ts: serverTimestamp() });
}

export async function setRiderStatus(code: string, uid: string, status: RiderStatus) {
  await update(ref(db, `groups/${code}/locations/${uid}`), { status });
}

export async function clearMyLocation(code: string, uid: string) {
  await remove(ref(db, `groups/${code}/locations/${uid}`));
}

/** Live view of the whole group: meta + members merged with their latest location. */
export function subscribeGroup(
  code: string,
  onChange: (state: { meta: GroupMeta | null; riders: Rider[] }) => void,
  onError: (e: Error) => void,
): Unsubscribe {
  let meta: GroupMeta | null = null;
  let members: Record<string, Member> = {};
  let locations: Record<string, RiderLocation> = {};

  const emit = () => {
    const riders: Rider[] = Object.entries(members).map(([uid, m]) => ({
      uid,
      ...m,
      loc: locations[uid] && typeof locations[uid].lat === 'number' ? locations[uid] : undefined,
    }));
    onChange({ meta, riders });
  };

  const unsubs = [
    onValue(ref(db, `groups/${code}/meta`), (s) => { meta = s.val(); emit(); }, onError),
    onValue(ref(db, `groups/${code}/members`), (s) => { members = s.val() ?? {}; emit(); }, onError),
    onValue(ref(db, `groups/${code}/locations`), (s) => { locations = s.val() ?? {}; emit(); }, onError),
  ];
  return () => unsubs.forEach((u) => u());
}

// ---------- Invites ----------

const INVITE_BASE = (process.env.EXPO_PUBLIC_INVITE_BASE_URL ?? '').replace(/\/$/, '');

export function inviteLink(code: string): string {
  return INVITE_BASE ? `${INVITE_BASE}/join/${code}` : `ridetogether://join/${code}`;
}

function inviteMessage(code: string, groupName: string) {
  return (
    `🏍️ Join our ride "${groupName}" on RideTogether so we can all see each other on the map!\n\n` +
    `👉 ${inviteLink(code)}\n\n` +
    `Or open the app and enter code: ${code}`
  );
}

export async function shareToWhatsApp(code: string, groupName: string) {
  const text = encodeURIComponent(inviteMessage(code, groupName));
  try {
    // Opens WhatsApp directly with the message pre-filled; user picks the group chat
    await Linking.openURL(`whatsapp://send?text=${text}`);
  } catch {
    // WhatsApp not installed / blocked → web fallback
    await Linking.openURL(`https://wa.me/?text=${text}`);
  }
}

export async function shareInvite(code: string, groupName: string) {
  await Share.share({ message: inviteMessage(code, groupName) });
}
