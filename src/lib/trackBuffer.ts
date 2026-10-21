import AsyncStorage from '@react-native-async-storage/async-storage';
import { distanceMeters } from './geo';

/**
 * The rider's own track for the current ride, kept on the phone while riding (works in the
 * background task too) and turned into a ride-history entry when the ride ends.
 * Downsampled: a point every ≥25 m or ≥15 s — ~1,500 points for a 6-hour ride.
 */

export type TrackPoint = {
  lat: number;
  lng: number;
  /** epoch ms */
  t: number;
  /** GPS speed, m/s (null when the GPS didn't report one) */
  s: number | null;
};

const MIN_METERS = 25;
const MIN_MS = 15_000;
const key = (code: string) => `rt.track.${code}`;

// Last point per ride kept in memory so we don't re-read storage on every GPS fix
const lastPoint = new Map<string, TrackPoint>();
// Serialise read-modify-write: the foreground watcher and background task can fire together
let queue: Promise<unknown> = Promise.resolve();

export function appendTrackPoint(code: string, p: TrackPoint): Promise<void> {
  const prev = lastPoint.get(code);
  if (prev && p.t - prev.t < MIN_MS && distanceMeters(
    { latitude: prev.lat, longitude: prev.lng },
    { latitude: p.lat, longitude: p.lng },
  ) < MIN_METERS) {
    return Promise.resolve();
  }
  lastPoint.set(code, p);
  const job = queue.then(async () => {
    const pts = await readTrack(code);
    pts.push(p);
    await AsyncStorage.setItem(key(code), JSON.stringify(pts));
  });
  queue = job.catch(() => {});
  return job;
}

export async function readTrack(code: string): Promise<TrackPoint[]> {
  try {
    const raw = await AsyncStorage.getItem(key(code));
    return raw ? (JSON.parse(raw) as TrackPoint[]) : [];
  } catch {
    return [];
  }
}

export async function clearTrack(code: string) {
  lastPoint.delete(code);
  await AsyncStorage.removeItem(key(code));
}
