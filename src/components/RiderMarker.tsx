import { memo, useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Marker } from 'react-native-maps';
import type { Rider } from '../lib/groups';
import { colors } from '../lib/theme';

export function initials(name: string): string {
  // Letters/digits only, so "Ashu (Duke 390)" → "AD", not "A("
  const parts = name.trim().split(/\s+/).map((p) => p.replace(/[^\p{L}\p{N}]/gu, '')).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

type Props = {
  rider: Rider;
  stale: boolean;
  isLeader: boolean;
  isMe: boolean;
  showLabel: boolean;
  onPress: (r: Rider) => void;
};

/**
 * Small custom marker: coloured dot with initials + name tag.
 * `tracksViewChanges` is only on briefly after the look changes — keeping it on
 * for 30–100 riders makes the map stutter badly, especially on Android.
 */
function RiderMarkerBase({ rider, stale, isLeader, isMe, showLabel, onPress }: Props) {
  const status = rider.loc?.status ?? 'ok';
  const lookKey = `${rider.color}|${stale}|${isLeader}|${status}|${showLabel}|${rider.name}`;
  const [tracks, setTracks] = useState(true);

  useEffect(() => {
    setTracks(true);
    const t = setTimeout(() => setTracks(false), 600);
    return () => clearTimeout(t);
  }, [lookKey]);

  if (!rider.loc) return null;

  const ring = status === 'sos' ? colors.danger : status === 'stop' ? colors.warning : '#FFFFFF';
  const fill = stale ? colors.stale : rider.color;

  return (
    <Marker
      coordinate={{ latitude: rider.loc.lat, longitude: rider.loc.lng }}
      anchor={{ x: 0.5, y: showLabel ? 0.3 : 0.5 }}
      tracksViewChanges={tracks}
      onPress={() => onPress(rider)}
      zIndex={status !== 'ok' ? 1000 : isLeader ? 500 : isMe ? 400 : 1}
    >
      <View style={styles.wrap}>
        <View style={[styles.dot, { backgroundColor: fill, borderColor: ring }, status !== 'ok' && styles.alertDot]}>
          <Text style={styles.initials}>{status === 'sos' ? 'SOS' : initials(rider.name)}</Text>
          {isLeader && <Text style={styles.crown}>★</Text>}
        </View>
        {showLabel && (
          <View style={[styles.label, stale && { opacity: 0.7 }]}>
            <Text style={styles.labelText} numberOfLines={1}>
              {isMe ? 'You' : rider.name}
            </Text>
          </View>
        )}
      </View>
    </Marker>
  );
}

export const RiderMarker = memo(RiderMarkerBase);

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', width: 90 },
  dot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  alertDot: { width: 38, height: 38, borderRadius: 19, borderWidth: 4 },
  initials: { color: '#0E0F12', fontWeight: '900', fontSize: 11 },
  crown: { position: 'absolute', top: -12, fontSize: 13, color: colors.warning },
  label: {
    marginTop: 2,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 6,
    backgroundColor: 'rgba(14,15,18,0.85)',
    maxWidth: 90,
  },
  labelText: { color: '#fff', fontSize: 10, fontWeight: '700' },
});
