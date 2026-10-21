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
 * groups/{CODE}/members/{uid}        { name, color, colorIdx?, joinedAt }
 * groups/{CODE}/colors/{idx}          uid — who holds each rider colour (claimed once, so colours never repeat)
 * groups/{CODE}/locations/{uid}      { lat, lng, heading, speed, accuracy, battery, status, ts }
 * groups/{CODE}/destination          { lat, lng, name, address, polyline?, distanceM?, durationS?, setAt } (leader only)
 */

export type RiderStatus = 'ok' | 'stop' | 'sos';

/** `endedAt` is set once by the leader; after that nobody can join or share a location. */
export type GroupMeta = { name: string; createdBy: string; createdAt: number; endedAt?: number };
export type Member = { name: string; color: string; colorIdx?: number; joinedAt: number };
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

/** Where the whole group is heading — set by the leader, the same route for every rider. */
export type Destination = {
  lat: number;
  lng: number;
  name: string;
  address?: string;
  /** Google encoded polyline of the two-wheeler route from the leader's position when it was set */
  polyline?: string | null;
  distanceM?: number | null;
  durationS?: number | null;
  setAt: number;
};

// No 0/O/1/I/L — easy to read out loud on the roadside
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;

/**
 * 16 rider colours spread around the colour wheel, each readable on both the light and dark map.
 * Kept clear of the blue "you" dot and the orange/blue route lines.
 */
export const RIDER_COLORS = [
  '#E6194B', // red
  '#3CB44B', // green
  '#FFB000', // amber
  '#7B2FF7', // violet
  '#00B8D9', // cyan
  '#F032E6', // magenta
  '#8DB600', // lime
  '#FF6F91', // pink
  '#008B8B', // teal
  '#B5651D', // brown
  '#5C6BC0', // indigo
  '#FF8C42', // tangerine
  '#00A86B', // jade
  '#C71585', // plum
  '#6D8B74', // sage
  '#D4A017', // mustard
];

/** Readable initials colour on top of a rider colour. */
export function onColor(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#111114' : '#FFFFFF';
}

/** Fallback when all 16 are taken (17+ riders) — colours start repeating. */
function hashColorIdx(uid: string): number {
  let h = 0;
  for (let i = 0; i < uid.length; i++) h = (h * 31 + uid.charCodeAt(i)) >>> 0;
  return h % RIDER_COLORS.length;
}

/**
 * Claims the first free colour in this ride. The database only accepts a claim on an empty slot,
 * so two riders joining at the same moment can't end up with the same colour.
 */
async function claimColor(code: string, uid: string): Promise<{ color: string; colorIdx?: number }> {
  const taken: Record<string, string> = (await get(ref(db, `groups/${code}/colors`))).val() ?? {};
  const mine = Object.entries(taken).find(([, u]) => u === uid);
  if (mine) return { color: RIDER_COLORS[+mine[0]], colorIdx: +mine[0] };
  for (let i = 0; i < RIDER_COLORS.length; i++) {
    if (taken[i]) continue;
    try {
      await set(ref(db, `groups/${code}/colors/${i}`), uid);
      return { color: RIDER_COLORS[i], colorIdx: i };
    } catch {
      // someone grabbed it a moment ago — try the next one
    }
  }
  return { color: RIDER_COLORS[hashColorIdx(uid)] };
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
      // The ride is brand new, so the leader always gets the first colour
      [`members/${uid}`]: { name: riderName, color: RIDER_COLORS[0], colorIdx: 0, joinedAt: serverTimestamp() },
      'colors/0': uid,
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
  const { color, colorIdx } = await claimColor(code, uid);
  await set(ref(db, `groups/${code}/members/${uid}`), {
    name: riderName,
    color,
    ...(colorIdx != null ? { colorIdx } : {}),
    joinedAt: serverTimestamp(),
  });
  return meta;
}

export async function leaveGroup(code: string, uid: string) {
  const me = (await get(ref(db, `groups/${code}/members/${uid}`))).val() as Member | null;
  await update(ref(db, `groups/${code}`), {
    [`members/${uid}`]: null,
    [`locations/${uid}`]: null,
    // free my colour for the next rider
    ...(me?.colorIdx != null ? { [`colors/${me.colorIdx}`]: null } : {}),
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

export async function setDestination(code: string, d: Omit<Destination, 'setAt'>) {
  await set(ref(db, `groups/${code}/destination`), { ...d, setAt: serverTimestamp() });
}

export async function clearDestination(code: string) {
  await remove(ref(db, `groups/${code}/destination`));
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
  onChange: (state: { meta: GroupMeta | null; riders: Rider[]; destination: Destination | null }) => void,
  onError: (e: Error) => void,
): Unsubscribe {
  let meta: GroupMeta | null = null;
  let members: Record<string, Member> = {};
  let locations: Record<string, RiderLocation> = {};
  let destination: Destination | null = null;

  const emit = () => {
    const riders: Rider[] = Object.entries(members).map(([uid, m]) => ({
      uid,
      ...m,
      loc: locations[uid] && typeof locations[uid].lat === 'number' ? locations[uid] : undefined,
    }));
    onChange({ meta, riders, destination });
  };

  const unsubs = [
    onValue(ref(db, `groups/${code}/meta`), (s) => { meta = s.val(); emit(); }, onError),
    onValue(ref(db, `groups/${code}/members`), (s) => { members = s.val() ?? {}; emit(); }, onError),
    onValue(ref(db, `groups/${code}/locations`), (s) => { locations = s.val() ?? {}; emit(); }, onError),
    onValue(ref(db, `groups/${code}/destination`), (s) => { destination = s.val(); emit(); }, onError),
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
