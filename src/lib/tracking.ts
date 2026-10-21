import * as Battery from 'expo-battery';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { currentUid } from './firebase';
import { distanceMeters } from './geo';
import { publishLocation } from './groups';
import { getActiveGroup, setActiveGroup } from './storage';
import { appendTrackPoint } from './trackBuffer';
import { finalizeRide } from './history';

/**
 * Location sharing.
 *
 * Preferred mode: a background location task (Android foreground service with a
 * persistent notification / iOS "Always" + background mode) so the group still sees
 * you when the phone is locked in a tank bag or mount.
 * Fallback: foreground-only watcher if the rider declines background permission.
 */

export const LOCATION_TASK = 'ride-together-location';

const MIN_PUBLISH_INTERVAL_MS = 4000;
let lastPublish = 0;
let lastFix: { lat: number; lng: number; t: number } | null = null;

/**
 * GPS speed (m/s), or — for laptops and phones that don't report one — the speed since the last
 * published position, so every rider's speed shows on the map.
 */
function speedOf(loc: Location.LocationObject, now: number): number | null {
  const t = loc.timestamp || now;
  const prev = lastFix;
  lastFix = { lat: loc.coords.latitude, lng: loc.coords.longitude, t };
  if (loc.coords.speed != null && loc.coords.speed >= 0) return loc.coords.speed;
  if (!prev || t - prev.t < 2000 || t - prev.t > 60_000) return null;
  const d = distanceMeters({ latitude: prev.lat, longitude: prev.lng }, { latitude: lastFix.lat, longitude: lastFix.lng });
  const v = d / ((t - prev.t) / 1000);
  return v > 70 ? null : v; // > 250 km/h = GPS jump
}

async function publish(loc: Location.LocationObject) {
  const now = Date.now();
  if (now - lastPublish < MIN_PUBLISH_INTERVAL_MS) return;
  lastPublish = now;

  const code = await getActiveGroup();
  if (!code) return;
  const uid = await currentUid();
  if (!uid) return; // signed out — no rider to share as

  let battery: number | null = null;
  try {
    const level = await Battery.getBatteryLevelAsync();
    battery = level >= 0 ? Math.round(level * 100) : null;
  } catch {}

  const speed = speedOf(loc, now);

  // My own track for ride history (stays on the phone until the ride ends)
  appendTrackPoint(code, {
    lat: loc.coords.latitude,
    lng: loc.coords.longitude,
    t: loc.timestamp || now,
    s: speed,
  }).catch(() => {});

  await publishLocation(code, uid, {
    lat: loc.coords.latitude,
    lng: loc.coords.longitude,
    heading: loc.coords.heading ?? null,
    speed,
    accuracy: loc.coords.accuracy ?? null,
    battery,
  });
}

/** Ride ended (or we were removed) → the rules reject our writes, so stop the GPS for good. */
async function onPublishError(e: unknown) {
  if (String((e as any)?.code ?? (e as any)?.message ?? e).toUpperCase().includes('PERMISSION_DENIED')) {
    const code = await getActiveGroup();
    await setActiveGroup(null);
    await stopTracking();
    const uid = await currentUid();
    if (code && uid) await finalizeRide(code, uid).catch(() => {}); // save it to my history
    return;
  }
  console.warn('[tracking] publish failed', e);
}

// Must be defined at module top-level; this file is imported from the root layout.
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;
  const latest = data.locations[data.locations.length - 1];
  try {
    await publish(latest);
  } catch (e) {
    await onPublishError(e);
  }
});

let foregroundSub: Location.LocationSubscription | null = null;

export type TrackingMode = 'background' | 'foreground';

export async function startTracking(groupName: string): Promise<TrackingMode> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') {
    throw new Error('Location permission is needed so your group can see you on the map.');
  }

  let bgGranted = false;
  // Browsers have no background location → foreground watcher only
  if (Platform.OS !== 'web') try {
    const bg = await Location.requestBackgroundPermissionsAsync();
    bgGranted = bg.status === 'granted';
  } catch {
    // Expo Go / missing native config → foreground only
  }

  lastPublish = 0;

  if (bgGranted) {
    stopForegroundWatch();
    if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK);
    }
    await Location.startLocationUpdatesAsync(LOCATION_TASK, {
      accuracy: Location.Accuracy.High,
      timeInterval: 5000,
      // Report even when standing still (tea stop, signal) — otherwise the group's live light for
      // this rider turns red and beeps "signal lost" while they're simply parked
      distanceInterval: 0,
      activityType: Location.ActivityType.AutomotiveNavigation,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      foregroundService: {
        notificationTitle: `Riding with ${groupName}`,
        notificationBody: 'Your group can see you on the map. Open the app to stop sharing.',
        notificationColor: '#FF6B00',
        killServiceOnDestroy: false,
      },
    });
    return 'background';
  }

  await startForegroundWatch();
  return 'foreground';
}

async function startForegroundWatch() {
  stopForegroundWatch();
  if (Platform.OS === 'web') {
    // expo-location's web watcher tags updates with the browser's watch id instead of its own,
    // so they never reach our callback — talk to the browser directly instead.
    let last: Location.LocationObject | null = null;
    const id = navigator.geolocation.watchPosition(
      (p) => {
        const { latitude, longitude, altitude, accuracy, altitudeAccuracy, heading, speed } = p.coords;
        last = {
          coords: { latitude, longitude, altitude, accuracy, altitudeAccuracy, heading, speed },
          timestamp: p.timestamp,
        };
        publish(last).catch(onPublishError);
      },
      (e) => console.warn('[tracking] browser location error', e.message),
      { enableHighAccuracy: true, maximumAge: 5000 },
    );
    // A laptop barely moves, so the browser rarely reports — re-send well inside the 20 s "delayed" window
    const heartbeat = setInterval(() => last && publish(last).catch(onPublishError), 10_000);
    foregroundSub = {
      remove: () => {
        navigator.geolocation.clearWatch(id);
        clearInterval(heartbeat);
      },
    };
    return;
  }
  foregroundSub = await Location.watchPositionAsync(
    { accuracy: Location.Accuracy.High, timeInterval: 5000, distanceInterval: 0 },
    (loc) => publish(loc).catch(onPublishError),
  );
}

function stopForegroundWatch() {
  foregroundSub?.remove();
  foregroundSub = null;
}

export async function stopTracking() {
  stopForegroundWatch();
  try {
    if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK);
    }
  } catch {}
}

export async function isTracking(): Promise<boolean> {
  if (foregroundSub) return true;
  try {
    return await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
  } catch {
    return false;
  }
}

export const backgroundHint =
  Platform.OS === 'ios'
    ? 'Set Location to "Always" in Settings so the group sees you while your phone is locked.'
    : 'Allow location "All the time" so the group sees you while your screen is off.';
