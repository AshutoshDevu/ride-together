import { Platform } from 'react-native';
import type { LatLng } from './geo';

/**
 * Google Places (New) + Routes REST calls, made straight from the app.
 *
 * Web uses the browser key (locked to the site's address). Android uses the Android key,
 * which Google only accepts together with the app's package name + signing certificate.
 */

const KEY =
  Platform.OS === 'web'
    ? process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY
    : process.env.EXPO_PUBLIC_GOOGLE_ANDROID_API_KEY;

function headers(fieldMask: string): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Goog-Api-Key': KEY ?? '',
    'X-Goog-FieldMask': fieldMask,
  };
  if (Platform.OS === 'android') {
    h['X-Android-Package'] = process.env.EXPO_PUBLIC_ANDROID_PACKAGE ?? '';
    h['X-Android-Cert'] = process.env.EXPO_PUBLIC_ANDROID_CERT_SHA1 ?? '';
  }
  return h;
}

async function post<T>(url: string, fieldMask: string, body: unknown): Promise<T> {
  if (!KEY) throw new Error('Search is not set up (missing Google API key).');
  const res = await fetch(url, { method: 'POST', headers: headers(fieldMask), body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error?.message ?? `Google request failed (${res.status})`);
  return json as T;
}

export type PlaceResult = { name: string; address: string; lat: number; lng: number };

/** Free-text place search, biased to ~50 km around `near`. One request per search (not per keystroke). */
export async function searchPlaces(query: string, near?: LatLng | null): Promise<PlaceResult[]> {
  const body: any = { textQuery: query, pageSize: 8, regionCode: 'IN' };
  if (near) {
    body.locationBias = {
      circle: { center: { latitude: near.latitude, longitude: near.longitude }, radius: 50000 },
    };
  }
  const json = await post<{ places?: any[] }>(
    'https://places.googleapis.com/v1/places:searchText',
    'places.displayName,places.formattedAddress,places.location',
    body,
  );
  return (json.places ?? []).map((p) => ({
    name: p.displayName?.text ?? 'Unnamed place',
    address: p.formattedAddress ?? '',
    lat: p.location.latitude,
    lng: p.location.longitude,
  }));
}

export type RouteResult = { polyline: string; distanceM: number; durationS: number };

/** Motorcycle / scooter route (Google's TWO_WHEELER mode), or null if Google has none. */
export async function computeTwoWheelerRoute(from: LatLng, to: LatLng): Promise<RouteResult | null> {
  const point = (p: LatLng) => ({ location: { latLng: { latitude: p.latitude, longitude: p.longitude } } });
  const json = await post<{ routes?: any[] }>(
    'https://routes.googleapis.com/directions/v2:computeRoutes',
    'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline',
    { origin: point(from), destination: point(to), travelMode: 'TWO_WHEELER', languageCode: 'en-IN' },
  );
  const r = json.routes?.[0];
  if (!r?.polyline?.encodedPolyline) return null;
  return {
    polyline: r.polyline.encodedPolyline,
    distanceM: r.distanceMeters ?? 0,
    durationS: parseInt(String(r.duration ?? '0s'), 10) || 0,
  };
}

export type NavStep = {
  /** Routes API maneuver, e.g. TURN_RIGHT, ROUNDABOUT_LEFT — taken at the START of this step */
  maneuver: string;
  instruction: string;
  distanceM: number;
  durationS: number;
  points: LatLng[];
};

export type NavRoute = RouteResult & { steps: NavStep[]; fetchedAt: number };

/** Two-wheeler route with turn-by-turn steps, for in-app navigation. */
export async function fetchNavRoute(from: LatLng, to: LatLng, heading?: number | null): Promise<NavRoute | null> {
  const origin: any = { location: { latLng: { latitude: from.latitude, longitude: from.longitude } } };
  // Start in the direction the rider is already moving (avoids "make a U-turn" at the start)
  if (heading != null && heading >= 0) origin.location.heading = Math.round(heading) % 360;
  const json = await post<{ routes?: any[] }>(
    'https://routes.googleapis.com/directions/v2:computeRoutes',
    [
      'routes.distanceMeters',
      'routes.duration',
      'routes.polyline.encodedPolyline',
      'routes.legs.steps.distanceMeters',
      'routes.legs.steps.staticDuration',
      'routes.legs.steps.polyline.encodedPolyline',
      'routes.legs.steps.navigationInstruction',
    ].join(','),
    {
      origin,
      destination: { location: { latLng: { latitude: to.latitude, longitude: to.longitude } } },
      travelMode: 'TWO_WHEELER',
      languageCode: 'en-IN',
      units: 'METRIC',
    },
  );
  const r = json.routes?.[0];
  if (!r?.polyline?.encodedPolyline) return null;
  const steps: NavStep[] = (r.legs ?? []).flatMap((leg: any) =>
    (leg.steps ?? []).map((s: any) => ({
      maneuver: s.navigationInstruction?.maneuver ?? 'STRAIGHT',
      instruction: s.navigationInstruction?.instructions ?? 'Continue',
      distanceM: s.distanceMeters ?? 0,
      durationS: parseInt(String(s.staticDuration ?? '0s'), 10) || 0,
      points: s.polyline?.encodedPolyline ? decodePolyline(s.polyline.encodedPolyline) : [],
    })),
  );
  return {
    polyline: r.polyline.encodedPolyline,
    distanceM: r.distanceMeters ?? 0,
    durationS: parseInt(String(r.duration ?? '0s'), 10) || 0,
    steps: steps.filter((s) => s.points.length > 0),
    fetchedAt: Date.now(),
  };
}

/** Coordinates → Google's encoded polyline format (compact storage for ride tracks). */
export function encodePolyline(points: LatLng[]): string {
  let out = '';
  let pLat = 0, pLng = 0;
  const enc = (v: number) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    while (n >= 0x20) {
      out += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
      n >>= 5;
    }
    out += String.fromCharCode(n + 63);
  };
  for (const p of points) {
    const lat = Math.round(p.latitude * 1e5), lng = Math.round(p.longitude * 1e5);
    enc(lat - pLat);
    enc(lng - pLng);
    pLat = lat;
    pLng = lng;
  }
  return out;
}

/** Google's encoded polyline format → coordinates. */
export function decodePolyline(encoded: string): LatLng[] {
  const out: LatLng[] = [];
  let i = 0, lat = 0, lng = 0;
  while (i < encoded.length) {
    for (const axis of [0, 1]) {
      let shift = 0, result = 0, b: number;
      do {
        b = encoded.charCodeAt(i++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const delta = result & 1 ? ~(result >> 1) : result >> 1;
      if (axis === 0) lat += delta;
      else lng += delta;
    }
    out.push({ latitude: lat / 1e5, longitude: lng / 1e5 });
  }
  return out;
}

export function formatDuration(s: number): string {
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} m`;
}
