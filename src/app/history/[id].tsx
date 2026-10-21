import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../components/ui';
import { confirmAction, notify } from '../../lib/dialog';
import { formatDistance, type LatLng } from '../../lib/geo';
import { deleteRide, getRide, rideDate, type RideEntry } from '../../lib/history';
import { mapStyleFor } from '../../lib/mapStyles';
import { decodePolyline, formatDuration } from '../../lib/places';
import { useSession } from '../../lib/session';
import { makeStyles, radius, useTheme } from '../../lib/theme';

/** Speed bands for colouring the track (km/h) */
const BANDS = [
  { max: 30, color: '#34C759', label: '< 30' },
  { max: 60, color: '#FFCC00', label: '30–60' },
  { max: 90, color: '#FF9500', label: '60–90' },
  { max: Infinity, color: '#FF3B30', label: '90+' },
];
const bandOf = (kmh: number) => BANDS.findIndex((b) => kmh < b.max);

/** Consecutive points in the same speed band → one coloured polyline each. */
function speedSegments(points: LatLng[], speeds: number[]) {
  const segs: { color: string; coords: LatLng[] }[] = [];
  let cur: { band: number; coords: LatLng[] } | null = null;
  points.forEach((p, i) => {
    const band = bandOf(speeds[i] ?? 0);
    if (!cur || cur.band !== band) {
      // share the joining point so the line has no gaps
      const start = cur ? [cur.coords[cur.coords.length - 1]] : [];
      cur = { band, coords: [...start, p] };
      segs.push({ color: BANDS[band].color, coords: cur.coords });
    } else {
      cur.coords.push(p);
    }
  });
  return segs.filter((s) => s.coords.length > 1);
}

export default function RideDetail() {
  const { colors, scheme } = useTheme();
  const styles = useStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { uid } = useSession();
  const [ride, setRide] = useState<RideEntry | null | undefined>(undefined);
  const mapRef = useRef<MapView>(null);

  useEffect(() => {
    if (!uid || !id) return;
    getRide(uid, String(id))
      .then(setRide)
      .catch(() => setRide(null));
  }, [uid, id]);

  const points = useMemo(() => (ride ? decodePolyline(ride.polyline) : []), [ride]);
  const segments = useMemo(() => (ride ? speedSegments(points, ride.speeds) : []), [ride, points]);

  function fit() {
    if (points.length > 1) {
      mapRef.current?.fitToCoordinates(points, {
        edgePadding: { top: 40, right: 40, bottom: 40, left: 40 },
        animated: false,
      });
    }
  }

  async function remove() {
    if (!uid || !ride) return;
    const ok = await confirmAction({
      title: 'Delete this ride?',
      message: 'It will be removed from your history. Other riders keep their own copies.',
      confirmText: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteRide(uid, ride.id);
      router.back();
    } catch (e: any) {
      notify('Could not delete', e?.message ?? String(e));
    }
  }

  if (ride === undefined) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }
  if (ride === null) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Ride not found</Text>
        <Button title="Back" variant="secondary" onPress={() => router.replace('/history')} />
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/history'))} hitSlop={10}>
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{ride.name}</Text>
          <Text style={styles.dim}>{rideDate(ride.startedAt)}</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.mapBox}>
          <MapView
            ref={mapRef}
            style={StyleSheet.absoluteFill}
            provider={PROVIDER_GOOGLE}
            customMapStyle={mapStyleFor(scheme) as any}
            onMapReady={fit}
            toolbarEnabled={false}
          >
            {segments.map((s, i) => (
              <Polyline key={i} coordinates={s.coords} strokeColor={s.color} strokeWidth={5} />
            ))}
            {points.length > 1 && (
              <>
                <Marker coordinate={points[0]} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
                  <View style={[styles.endDot, { backgroundColor: '#34C759' }]} />
                </Marker>
                <Marker coordinate={points[points.length - 1]} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
                  <View style={[styles.endDot, { backgroundColor: colors.text }]}>
                    <Text style={{ fontSize: 9 }}>🏁</Text>
                  </View>
                </Marker>
              </>
            )}
          </MapView>
        </View>

        <View style={styles.legend}>
          {BANDS.map((b) => (
            <View key={b.label} style={styles.legendItem}>
              <View style={[styles.legendSwatch, { backgroundColor: b.color }]} />
              <Text style={styles.dim}>{b.label}</Text>
            </View>
          ))}
          <Text style={styles.dim}>km/h</Text>
        </View>

        <View style={styles.grid}>
          <Stat label="Distance" value={formatDistance(ride.distanceM)} />
          <Stat label="Moving time" value={formatDuration(ride.movingS)} />
          <Stat label="Total time" value={formatDuration(ride.durationS)} />
          <Stat label="Avg speed" value={`${ride.avgKmh} km/h`} />
          <Stat label="Top speed" value={`${ride.maxKmh} km/h`} />
          <Stat label={ride.wasLeader ? 'Riders · you led' : 'Riders'} value={String(ride.riders.length || 1)} />
        </View>

        {!!ride.destination && (
          <View style={styles.card}>
            <Text style={styles.section}>Destination</Text>
            <Text style={styles.body}>🏁 {ride.destination}</Text>
          </View>
        )}

        {ride.riders.length > 0 && (
          <View style={styles.card}>
            <Text style={styles.section}>Who rode</Text>
            <View style={styles.chips}>
              {ride.riders.map((n, i) => (
                <View key={`${n}-${i}`} style={styles.chip}>
                  <Text style={styles.chipText}>{n}</Text>
                </View>
              ))}
            </View>
          </View>
        )}

        <Button title="Delete ride" variant="ghost" onPress={remove} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  const styles = useStyles();
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: colors.bg, padding: 24 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 8 },
  container: { padding: 16, gap: 14, paddingBottom: 40, width: '100%', maxWidth: 720, alignSelf: 'center' },
  title: { color: colors.text, fontSize: 22, fontWeight: '800' },
  dim: { color: colors.textDim, fontSize: 13 },
  mapBox: { height: 320, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: colors.surfaceHigh },
  endDot: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 3,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  legend: { flexDirection: 'row', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendSwatch: { width: 18, height: 6, borderRadius: 3 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  stat: {
    flexBasis: '30%',
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
  },
  statValue: { color: colors.text, fontSize: 19, fontWeight: '800' },
  statLabel: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 8 },
  section: { color: colors.text, fontSize: 17, fontWeight: '800' },
  body: { color: colors.text, fontSize: 15 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: colors.surfaceHigh, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6 },
  chipText: { color: colors.text, fontWeight: '700' },
}));
