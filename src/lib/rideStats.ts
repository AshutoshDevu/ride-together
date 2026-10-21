import { distanceMeters } from './geo';
import type { TrackPoint } from './trackBuffer';

/** Distance, moving time and speeds from a recorded track — with GPS glitches filtered out. */

// A "jump" faster than this between two fixes is a GPS glitch and is dropped
const MAX_PLAUSIBLE_MS = 70; // 252 km/h
const MOVING_MS = 1; // 3.6 km/h

export function computeStats(pts: TrackPoint[]) {
  let distanceM = 0, movingS = 0, maxMs = 0;
  const kept: TrackPoint[] = pts.length ? [pts[0]] : [];
  const cum: number[] = pts.length ? [0] : []; // distance so far at each kept point
  for (let i = 1; i < pts.length; i++) {
    const a = kept[kept.length - 1], b = pts[i];
    const dt = (b.t - a.t) / 1000;
    if (dt <= 0) continue;
    const d = distanceMeters({ latitude: a.lat, longitude: a.lng }, { latitude: b.lat, longitude: b.lng });
    const v = d / dt;
    if (v > MAX_PLAUSIBLE_MS) continue; // jump — drop the point
    kept.push(b);
    distanceM += d;
    cum.push(distanceM);
    if (v > MOVING_MS && dt < 120) movingS += dt;
    if (b.s != null && b.s <= MAX_PLAUSIBLE_MS) maxMs = Math.max(maxMs, b.s);
  }
  // Top speed also from distance over any ≥10 s stretch — some phones / browsers report no GPS speed,
  // and shorter windows exaggerate GPS jitter
  for (let i = 1, j = 0; i < kept.length; i++) {
    while (j < i - 1 && kept[i].t - kept[j + 1].t >= 10_000) j++;
    const dt = (kept[i].t - kept[j].t) / 1000;
    if (dt >= 10) maxMs = Math.max(maxMs, Math.min(MAX_PLAUSIBLE_MS, (cum[i] - cum[j]) / dt));
  }
  const durationS = kept.length > 1 ? (kept[kept.length - 1].t - kept[0].t) / 1000 : 0;
  return {
    kept,
    distanceM: Math.round(distanceM),
    durationS: Math.round(durationS),
    movingS: Math.round(movingS),
    avgKmh: movingS > 0 ? Math.round((distanceM / movingS) * 3.6) : 0,
    maxKmh: Math.round(maxMs * 3.6),
  };
}

