import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatDistance } from '../../lib/geo';
import { rideDate, subscribeHistory, type RideEntry } from '../../lib/history';
import { formatDuration } from '../../lib/places';
import { useSession } from '../../lib/session';
import { makeStyles, radius, useTheme } from '../../lib/theme';

export default function HistoryScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { uid } = useSession();
  const [rides, setRides] = useState<RideEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!uid) return;
    return subscribeHistory(uid, setRides, (e) => setError(e.message));
  }, [uid]);

  const month = useMemo(() => {
    const start = new Date();
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    const mine = (rides ?? []).filter((r) => r.startedAt >= start.getTime());
    return {
      label: start.toLocaleString([], { month: 'long' }),
      rides: mine.length,
      distanceM: mine.reduce((s, r) => s + r.distanceM, 0),
      movingS: mine.reduce((s, r) => s + r.movingS, 0),
    };
  }, [rides]);

  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top']}>
      <FlatList
        data={rides ?? []}
        keyExtractor={(r) => r.id}
        contentContainerStyle={styles.container}
        ListHeaderComponent={
          <View style={{ gap: 14 }}>
            <Text style={styles.title}>Your rides</Text>
            <View style={styles.monthCard}>
              <Text style={styles.monthLabel}>{month.label.toUpperCase()}</Text>
              <View style={styles.monthRow}>
                <Total value={formatDistance(month.distanceM)} label="distance" />
                <Total value={String(month.rides)} label={month.rides === 1 ? 'ride' : 'rides'} />
                <Total value={formatDuration(month.movingS)} label="riding" />
              </View>
            </View>
            {!!error && <Text style={styles.error}>{error}</Text>}
            {rides === null && !error && <ActivityIndicator color={colors.accent} style={{ marginTop: 30 }} />}
          </View>
        }
        ListEmptyComponent={
          rides ? (
            <View style={styles.empty}>
              <Ionicons name="bicycle" size={44} color={colors.textDim} />
              <Text style={styles.emptyTitle}>No rides yet</Text>
              <Text style={styles.dim}>
                Rides you join are saved here automatically when they end — your route, distance and speeds.
              </Text>
            </View>
          ) : null
        }
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        renderItem={({ item: r }) => (
          <Pressable
            style={({ pressed }) => [styles.row, pressed && { opacity: 0.85 }]}
            onPress={() => router.push({ pathname: '/history/[id]', params: { id: r.id } })}
          >
            <View style={styles.rowIcon}>
              <Ionicons name={r.wasLeader ? 'flag' : 'bicycle'} size={22} color={colors.accent} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.rowName} numberOfLines={1}>{r.name}</Text>
              <Text style={styles.dim} numberOfLines={1}>
                {rideDate(r.startedAt)}
                {r.riders.length > 1 ? ` · ${r.riders.length} riders` : ''}
              </Text>
              <Text style={styles.rowStats}>
                {formatDistance(r.distanceM)} · {formatDuration(r.movingS)} · avg {r.avgKmh} km/h
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textDim} />
          </Pressable>
        )}
      />
    </SafeAreaView>
  );
}

function Total({ value, label }: { value: string; label: string }) {
  const styles = useStyles();
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <Text style={styles.totalValue}>{value}</Text>
      <Text style={styles.totalLabel}>{label}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { padding: 20, gap: 0, paddingBottom: 40, width: '100%', maxWidth: 640, alignSelf: 'center' },
  title: { color: colors.text, fontSize: 30, fontWeight: '800', letterSpacing: -0.5 },
  monthCard: { backgroundColor: colors.accent, borderRadius: radius.lg, padding: 16, gap: 10, marginBottom: 6 },
  monthLabel: { color: colors.accentText, fontWeight: '800', letterSpacing: 1, fontSize: 12 },
  monthRow: { flexDirection: 'row' },
  totalValue: { color: colors.accentText, fontSize: 22, fontWeight: '900' },
  totalLabel: { color: colors.accentText, opacity: 0.85, fontSize: 12, fontWeight: '600' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  rowIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.surfaceHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowName: { color: colors.text, fontSize: 17, fontWeight: '800' },
  rowStats: { color: colors.text, fontSize: 13, fontWeight: '600' },
  dim: { color: colors.textDim, fontSize: 13 },
  empty: { alignItems: 'center', gap: 8, marginTop: 40, paddingHorizontal: 20 },
  emptyTitle: { color: colors.text, fontSize: 19, fontWeight: '800' },
  error: { color: colors.danger },
}));
