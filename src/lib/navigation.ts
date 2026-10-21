import * as Location from 'expo-location';
import * as Speech from 'expo-speech';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { distanceMeters, type LatLng } from './geo';
import { fetchNavRoute, type NavRoute } from './places';

/**
 * In-app turn-by-turn navigation: follows the rider's GPS fixes along a Routes API
 * two-wheeler route, announces turns by voice and re-routes when they leave the route.
 * Each rider navigates from their own position to the leader's shared destination.
 */

export type Fix = LatLng & { heading?: number | null; speed?: number | null };

/** One-off position. On web expo-location's helpers go through the same buggy watcher path, so ask the browser. */
export async function getCurrentFix(): Promise<Fix> {
  if (Platform.OS === 'web') {
    const p = await new Promise<GeolocationPosition>((res, rej) =>
      navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 10_000, maximumAge: 15_000 }),
    );
    return { latitude: p.coords.latitude, longitude: p.coords.longitude, heading: p.coords.heading, speed: p.coords.speed };
  }
  const l = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  return { latitude: l.coords.latitude, longitude: l.coords.longitude, heading: l.coords.heading, speed: l.coords.speed };
}

export type NavProgress = {
  stepIdx: number;
  /** Metres to the next maneuver (end of the current step) */
  toNextM: number;
  remainingM: number;
  remainingS: number;
  /** Distance from the rider to the route line */
  offRouteM: number;
};

const OFF_ROUTE_M = 50;
const ARRIVE_M = 35;
const REROUTE_MIN_GAP_MS = 15_000;
// Look this many steps ahead when matching — avoids snapping to a parallel road further back
const LOOKAHEAD_STEPS = 4;

/** Nearest point on segment a→b to p, in metres (local flat-earth approximation is fine at this scale). */
function projectOnSegment(p: LatLng, a: LatLng, b: LatLng) {
  const kx = 111320 * Math.cos((p.latitude * Math.PI) / 180);
  const ky = 110540;
  const ax = (a.longitude - p.longitude) * kx, ay = (a.latitude - p.latitude) * ky;
  const bx = (b.longitude - p.longitude) * kx, by = (b.latitude - p.latitude) * ky;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
  const x = ax + t * dx, y = ay + t * dy;
  return { dist: Math.hypot(x, y), t };
}

export function computeProgress(route: NavRoute, p: LatLng, fromStep: number): NavProgress {
  let best = { step: fromStep, seg: 0, t: 0, dist: Infinity };
  const last = Math.min(route.steps.length - 1, fromStep + LOOKAHEAD_STEPS);
  for (let s = Math.max(0, fromStep); s <= last; s++) {
    const pts = route.steps[s].points;
    for (let i = 0; i < pts.length - 1; i++) {
      const r = projectOnSegment(p, pts[i], pts[i + 1]);
      if (r.dist < best.dist) best = { step: s, seg: i, t: r.t, dist: r.dist };
    }
  }
  const step = route.steps[best.step];
  const pts = step.points;
  // Distance left in the current step from the projected point
  let toNextM = 0;
  if (pts.length > 1) {
    const a = pts[best.seg], b = pts[best.seg + 1];
    toNextM = distanceMeters(a, b) * (1 - best.t);
    for (let i = best.seg + 1; i < pts.length - 1; i++) toNextM += distanceMeters(pts[i], pts[i + 1]);
  }
  let remainingM = toNextM;
  let remainingS = step.distanceM ? step.durationS * (toNextM / step.distanceM) : 0;
  for (let s = best.step + 1; s < route.steps.length; s++) {
    remainingM += route.steps[s].distanceM;
    remainingS += route.steps[s].durationS;
  }
  return { stepIdx: best.step, toNextM, remainingM, remainingS, offRouteM: best.dist };
}

function spokenDistance(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(1).replace(/\.0$/, '')} kilometres`;
  return `${Math.max(50, Math.round(m / 50) * 50)} metres`;
}

function say(text: string) {
  Speech.stop();
  Speech.speak(text, { language: 'en-IN', rate: 1.0 });
}

export type NavStatus = 'idle' | 'routing' | 'navigating' | 'rerouting' | 'arrived' | 'error';

export function useTurnByTurn(opts: {
  active: boolean;
  destination: { lat: number; lng: number; name: string } | null;
  fix: Fix | null;
  voice: boolean;
}) {
  const { active, destination, fix, voice } = opts;
  const [route, setRoute] = useState<NavRoute | null>(null);
  const [progress, setProgress] = useState<NavProgress | null>(null);
  const [status, setStatus] = useState<NavStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const stepRef = useRef(0);
  const offCount = useRef(0);
  const fetching = useRef(false);
  const announced = useRef(new Set<string>());
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  const speak = (t: string) => voiceRef.current && say(t);

  const destKey = destination ? `${destination.lat},${destination.lng}` : '';

  const loadRoute = useCallback(
    async (from: Fix, reason: 'start' | 'reroute') => {
      if (!destination || fetching.current) return;
      fetching.current = true;
      setStatus(reason === 'start' ? 'routing' : 'rerouting');
      if (reason === 'reroute') speak('Rerouting');
      try {
        const r = await fetchNavRoute(from, { latitude: destination.lat, longitude: destination.lng }, from.heading);
        if (!r || !r.steps.length) throw new Error('No two-wheeler route found to this destination.');
        stepRef.current = 0;
        offCount.current = 0;
        announced.current = new Set();
        setRoute(r);
        setError(null);
        setStatus('navigating');
        if (reason === 'start') speak(`Starting navigation to ${destination.name}. ${r.steps[0].instruction}`);
      } catch (e: any) {
        setError(e?.message ?? String(e));
        setStatus('error');
      } finally {
        fetching.current = false;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [destKey],
  );

  // Start / stop
  useEffect(() => {
    if (!active) {
      setRoute(null);
      setProgress(null);
      setStatus('idle');
      setError(null);
      Speech.stop();
      return;
    }
    if (active && fix && !route && status === 'idle') loadRoute(fix, 'start');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, !!fix]);

  // Destination changed by the leader mid-ride → route to the new one
  useEffect(() => {
    if (active && fix && route) loadRoute(fix, 'start');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [destKey]);

  // Every GPS fix: progress, voice prompts, arrival, off-route detection
  useEffect(() => {
    if (!active || !route || !fix || !destination || status === 'arrived') return;

    if (distanceMeters(fix, { latitude: destination.lat, longitude: destination.lng }) < ARRIVE_M) {
      setStatus('arrived');
      speak(`You have arrived at ${destination.name}`);
      return;
    }

    const p = computeProgress(route, fix, stepRef.current);
    stepRef.current = p.stepIdx;
    setProgress(p);

    if (p.offRouteM > OFF_ROUTE_M) {
      offCount.current++;
      // Two bad fixes in a row (GPS jumps happen) and not too soon after the last request
      if (offCount.current >= 2 && Date.now() - route.fetchedAt > REROUTE_MIN_GAP_MS) loadRoute(fix, 'reroute');
      return;
    }
    offCount.current = 0;

    const next = route.steps[p.stepIdx + 1];
    const what = next ? next.instruction : `you will arrive at ${destination.name}`;
    const key = (t: string) => `${p.stepIdx + 1}:${t}`;
    if (p.toNextM <= 120 && !announced.current.has(key('now'))) {
      announced.current.add(key('now'));
      announced.current.add(key('soon'));
      speak(next ? next.instruction : `Your destination, ${destination.name}, is ahead`);
    } else if (p.toNextM <= 600 && p.toNextM > 250 && !announced.current.has(key('soon'))) {
      announced.current.add(key('soon'));
      speak(`In ${spokenDistance(p.toNextM)}, ${what}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fix?.latitude, fix?.longitude, route]);

  const nextStep = route && progress ? route.steps[progress.stepIdx + 1] ?? null : null;
  const thenStep = route && progress ? route.steps[progress.stepIdx + 2] ?? null : null;
  return { route, progress, status, error, nextStep, thenStep, retry: () => fix && loadRoute(fix, 'start') };
}

/** Routes API maneuver → arrow glyph for the banner. */
export function maneuverIcon(m: string | undefined): string {
  switch (m) {
    case 'TURN_LEFT': return '↰';
    case 'TURN_RIGHT': return '↱';
    case 'TURN_SLIGHT_LEFT': case 'RAMP_LEFT': case 'FORK_LEFT': return '↖';
    case 'TURN_SLIGHT_RIGHT': case 'RAMP_RIGHT': case 'FORK_RIGHT': return '↗';
    case 'TURN_SHARP_LEFT': return '⬉';
    case 'TURN_SHARP_RIGHT': return '⬈';
    case 'UTURN_LEFT': case 'UTURN_RIGHT': return '⮌';
    case 'ROUNDABOUT_LEFT': return '⟲';
    case 'ROUNDABOUT_RIGHT': return '⟳';
    case 'MERGE': return '↗';
    case 'FERRY': case 'FERRY_TRAIN': return '⛴';
    default: return '↑';
  }
}
