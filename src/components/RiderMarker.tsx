import { memo, useEffect, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { Marker } from 'react-native-maps';
import { kmh } from '../lib/geo';
import { onColor, type Rider } from '../lib/groups';
import { makeStyles, useTheme } from '../lib/theme';

export function initials(name: string): string {
  // Letters/digits only, so "Ashu (Duke 390)" → "AD", not "A("
  const parts = name.trim().split(/\s+/).map((p) => p.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/** How fresh a rider's position is — drives the live light, the rider list and the signal-loss beep. */
export type Freshness = 'live' | 'delayed' | 'lost';
export const DELAYED_AFTER_MS = 20_000;
export const LOST_AFTER_MS = 60_000;
export function freshnessOf(ts: number | undefined, now: number): Freshness {
  if (!ts) return 'lost';
  const age = now - ts;
  return age >= LOST_AFTER_MS ? 'lost' : age >= DELAYED_AFTER_MS ? 'delayed' : 'live';
}

type Props = {
  rider: Rider;
  freshness: Freshness;
  /** Where to draw it when fanned out from a bunch of overlapping riders (see lib/declutter) */
  displayAt?: { lat: number; lng: number };
  isLeader: boolean;
  isMe: boolean;
  showLabel: boolean;
  onPress: (r: Rider) => void;
};

const FLASH_MS = 700;

/**
 * Rider marker: colour disc (unique per rider) with initials, heading arrow, live light, and a
 * name + speed pill everyone can read on both map themes.
 * `tracksViewChanges` is only switched on briefly when the look changes (new position flash,
 * status, theme) — keeping it on for 30+ riders makes the map stutter on Android.
 */
function RiderMarkerBase({ rider, freshness, displayAt, isLeader, isMe, showLabel, onPress }: Props) {
  const { colors, scheme } = useTheme();
  const styles = useStyles();
  const loc = rider.loc;
  const status = loc?.status ?? 'ok';
  const speed = kmh(loc?.speed);
  const moving = speed != null && speed >= 3;
  const heading = moving && loc?.heading != null && loc.heading >= 0 ? Math.round(loc.heading / 10) * 10 : null;

  // Flash the live light every time a new position arrives
  const [flash, setFlash] = useState(false);
  const lastTs = useRef(loc?.ts);
  useEffect(() => {
    if (!loc?.ts || loc.ts === lastTs.current) return;
    lastTs.current = loc.ts;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), FLASH_MS);
    return () => clearTimeout(t);
  }, [loc?.ts]);

  const lookKey = [rider.color, freshness, isLeader, status, showLabel, rider.name, speed, heading, flash, scheme].join('|');
  const [tracks, setTracks] = useState(true);
  useEffect(() => {
    setTracks(true);
    const t = setTimeout(() => setTracks(false), FLASH_MS + 200);
    return () => clearTimeout(t);
  }, [lookKey]);

  if (!loc) return null;

  const lost = freshness === 'lost';
  const ring = status === 'sos' ? colors.danger : status === 'stop' ? colors.warning : '#FFFFFF';
  const fill = lost ? colors.stale : rider.color;
  const light =
    freshness === 'lost' ? '#FF3B30' : freshness === 'delayed' ? '#FF9F0A' : flash ? '#7CFF8A' : '#30D158';

  return (
    <Marker
      coordinate={{ latitude: displayAt?.lat ?? loc.lat, longitude: displayAt?.lng ?? loc.lng }}
      // the disc's centre: 28 px down a ~74 px tall marker (disc box 56 + name pill)
      anchor={{ x: 0.5, y: showLabel ? 0.38 : 0.5 }}
      tracksViewChanges={tracks}
      onPress={() => onPress(rider)}
      zIndex={status !== 'ok' ? 1000 : isLeader ? 500 : isMe ? 400 : 1}
    >
      <View style={styles.wrap}>
        <View style={styles.discBox}>
          {heading != null && (
            <View style={[styles.arrowBox, { transform: [{ rotate: `${heading}deg` }] }]}>
              <View style={[styles.arrow, { borderBottomColor: fill }]} />
            </View>
          )}
          <View
            style={[
              styles.disc,
              { backgroundColor: fill, borderColor: ring },
              status !== 'ok' && styles.alertDisc,
            ]}
          >
            <Text style={[styles.initials, { color: onColor(fill) }]}>
              {status === 'sos' ? 'SOS' : initials(rider.name)}
            </Text>
          </View>
          <View
            style={[
              styles.light,
              { backgroundColor: light },
              flash && styles.lightFlash,
            ]}
          />
          {isLeader && <Text style={styles.crown}>★</Text>}
        </View>
        {showLabel && (
          <View style={[styles.pill, lost && { opacity: 0.75 }]}>
            <Text style={styles.pillName} numberOfLines={1}>
              {isMe ? 'You' : rider.name}
            </Text>
            <Text style={[styles.pillSpeed, lost && { color: '#FF3B30' }]} numberOfLines={1}>
              {lost ? 'no signal' : speed != null ? `${speed} km/h` : '— km/h'}
            </Text>
          </View>
        )}
      </View>
    </Marker>
  );
}

export const RiderMarker = memo(RiderMarkerBase);

const useStyles = makeStyles((colors, scheme) => ({
  wrap: { alignItems: 'center', width: 120 },
  discBox: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  disc: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 5,
  },
  alertDisc: { width: 46, height: 46, borderRadius: 23, borderWidth: 5 },
  initials: { fontWeight: '900', fontSize: 14, letterSpacing: 0.3 },
  // Heading arrow sits just outside the disc and rotates around its centre
  arrowBox: { position: 'absolute', width: 56, height: 56, alignItems: 'center' },
  arrow: {
    width: 0,
    height: 0,
    borderLeftWidth: 7,
    borderRightWidth: 7,
    borderBottomWidth: 10,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  light: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 13,
    height: 13,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  lightFlash: { width: 15, height: 15, borderRadius: 8, top: 5, right: 5 },
  crown: { position: 'absolute', top: -4, fontSize: 14, color: '#FFB000' },
  pill: {
    marginTop: -2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 9,
    maxWidth: 120,
    backgroundColor: scheme === 'dark' ? 'rgba(28,28,30,0.92)' : 'rgba(255,255,255,0.95)',
    borderWidth: 1,
    borderColor: scheme === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)',
  },
  pillName: { color: colors.text, fontSize: 11, fontWeight: '800', flexShrink: 1 },
  // The speed must always be readable — the name shortens instead
  pillSpeed: { color: colors.textDim, fontSize: 11, fontWeight: '700', flexShrink: 0 },
}));
