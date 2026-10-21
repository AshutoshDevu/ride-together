import AsyncStorage from '@react-native-async-storage/async-storage';
import { get, ref } from 'firebase/database';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import { db, fs } from './firebase';
import type { Destination, GroupMeta, Member } from './groups';
import { encodePolyline } from './places';
import { distanceMeters } from './geo';
import { computeStats } from './rideStats';
import { clearTrack, readTrack } from './trackBuffer';

/**
 * Ride history: users/{uid}/rides/{rideId} — private to the rider. Written once when a ride ends
 * (ended by the leader, left, or signed out) from the track recorded on the phone.
 */

export type RideRecord = {
  code: string;
  name: string;
  startedAt: number;
  endedAt: number;
  durationS: number;
  movingS: number;
  distanceM: number;
  avgKmh: number;
  maxKmh: number;
  /** Encoded polyline of my track */
  polyline: string;
  /** km/h at each polyline point (for colouring the track by speed) */
  speeds: number[];
  riders: string[];
  wasLeader: boolean;
  destination: string | null;
};
export type RideEntry = RideRecord & { id: string };

const MAX_POINTS = 2000;
const MIN_RIDE_M = 200;
const PENDING_KEY = 'rt.pendingRides';

/** "Sun, 19 Oct, 6:30 am" */
export function rideDate(ms: number): string {
  return new Date(ms).toLocaleString([], { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
}

function thin<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const step = arr.length / max;
  const out: T[] = [];
  for (let i = 0; i < max - 1; i++) out.push(arr[Math.floor(i * step)]);
  out.push(arr[arr.length - 1]);
  return out;
}

const finishing = new Set<string>();

/**
 * Turns the recorded track for `code` into a history entry. Safe to call more than once
 * (ended screen, leave, sign-out, background) — the first call wins and clears the track.
 */
export async function finalizeRide(code: string, uid: string): Promise<RideRecord | null> {
  if (finishing.has(code)) return null;
  finishing.add(code);
  try {
    const pts = await readTrack(code);
    const stats = computeStats(pts);
    if (stats.kept.length < 2 || stats.distanceM < MIN_RIDE_M) {
      await clearTrack(code);
      return null; // too short to be worth keeping
    }

    let meta: GroupMeta | null = null, members: Record<string, Member> = {}, dest: Destination | null = null;
    try {
      [meta, members, dest] = await Promise.all([
        get(ref(db, `groups/${code}/meta`)).then((s) => s.val()),
        get(ref(db, `groups/${code}/members`)).then((s) => s.val() ?? {}),
        get(ref(db, `groups/${code}/destination`)).then((s) => s.val()),
      ]);
    } catch {
      // offline / already removed — save what we have
    }

    const track = thin(stats.kept, MAX_POINTS);
    const record: RideRecord = {
      code,
      name: (meta?.name ?? 'Ride').slice(0, 60),
      startedAt: stats.kept[0].t,
      endedAt: stats.kept[stats.kept.length - 1].t,
      durationS: stats.durationS,
      movingS: stats.movingS,
      distanceM: stats.distanceM,
      avgKmh: stats.avgKmh,
      maxKmh: stats.maxKmh,
      polyline: encodePolyline(track.map((p) => ({ latitude: p.lat, longitude: p.lng }))),
      // GPS speed where the phone reports one, else the speed since the previous point
      speeds: track.map((p, i) => {
        if (p.s != null) return Math.round(p.s * 3.6);
        const prev = track[i - 1];
        if (!prev || p.t <= prev.t) return 0;
        const d = distanceMeters({ latitude: prev.lat, longitude: prev.lng }, { latitude: p.lat, longitude: p.lng });
        return Math.round(Math.min(70, d / ((p.t - prev.t) / 1000)) * 3.6);
      }),
      riders: Object.values(members).map((m) => m.name).slice(0, 50),
      wasLeader: meta?.createdBy === uid,
      destination: dest?.name ?? null,
    };

    const id = `${code}-${record.startedAt}`;
    try {
      await saveRide(uid, id, record);
    } catch {
      await queuePending(uid, id, record); // offline — upload on next app start
    }
    await clearTrack(code);
    return record;
  } finally {
    finishing.delete(code);
  }
}

async function saveRide(uid: string, id: string, r: RideRecord) {
  await setDoc(doc(fs, 'users', uid, 'rides', id), { ...r, createdAt: serverTimestamp() });
}

type Pending = { uid: string; id: string; record: RideRecord };

async function queuePending(uid: string, id: string, record: RideRecord) {
  const list: Pending[] = JSON.parse((await AsyncStorage.getItem(PENDING_KEY)) ?? '[]');
  list.push({ uid, id, record });
  await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(list));
}

/** Upload rides that ended while offline. */
export async function flushPendingRides(uid: string) {
  const list: Pending[] = JSON.parse((await AsyncStorage.getItem(PENDING_KEY)) ?? '[]');
  if (!list.length) return;
  const left: Pending[] = [];
  for (const p of list) {
    if (p.uid !== uid) {
      left.push(p);
      continue;
    }
    try {
      await saveRide(p.uid, p.id, p.record);
    } catch {
      left.push(p);
    }
  }
  await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(left));
}

export function subscribeHistory(uid: string, cb: (rides: RideEntry[]) => void, onError: (e: Error) => void): Unsubscribe {
  return onSnapshot(
    query(collection(fs, 'users', uid, 'rides'), orderBy('startedAt', 'desc'), limit(200)),
    (s) => cb(s.docs.map((d) => ({ id: d.id, ...(d.data() as RideRecord) }))),
    onError,
  );
}

export async function getRide(uid: string, id: string): Promise<RideEntry | null> {
  const s = await getDoc(doc(fs, 'users', uid, 'rides', id));
  return s.exists() ? { id: s.id, ...(s.data() as RideRecord) } : null;
}

export async function deleteRide(uid: string, id: string) {
  await deleteDoc(doc(fs, 'users', uid, 'rides', id));
}
