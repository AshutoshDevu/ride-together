import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { formatAgo, formatDistance, kmh } from '../lib/geo';
import type { Rider } from '../lib/groups';
import { colors } from '../lib/theme';
import { initials } from './RiderMarker';

export type RiderRow = Rider & { distance: number | null; stale: boolean };

export function RiderList({
  rows,
  me,
  leaderUid,
  now,
  onSelect,
}: {
  rows: RiderRow[];
  me: string | null;
  leaderUid?: string;
  now: number;
  onSelect: (r: Rider) => void;
}) {
  return (
    <FlatList
      data={rows}
      keyExtractor={(r) => r.uid}
      style={{ maxHeight: 300 }}
      ItemSeparatorComponent={() => <View style={styles.sep} />}
      renderItem={({ item: r }) => {
        const status = r.loc?.status ?? 'ok';
        const speed = kmh(r.loc?.speed);
        return (
          <Pressable style={styles.row} onPress={() => onSelect(r)} disabled={!r.loc}>
            <View style={[styles.avatar, { backgroundColor: r.stale || !r.loc ? colors.stale : r.color }]}>
              <Text style={styles.avatarText}>{initials(r.name)}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={1}>
                {r.name}
                {r.uid === me ? ' (you)' : ''}
                {r.uid === leaderUid ? '  ★ lead' : ''}
              </Text>
              <Text style={[styles.meta, r.stale && { color: colors.warning }]}>
                {!r.loc
                  ? 'Waiting for GPS…'
                  : `${r.stale ? 'Signal lost · ' : ''}${formatAgo(r.loc.ts, now)}` +
                    (speed != null && !r.stale ? ` · ${speed} km/h` : '') +
                    (r.loc.battery != null ? ` · 🔋${r.loc.battery}%` : '')}
              </Text>
            </View>
            {status !== 'ok' && (
              <View style={[styles.badge, { backgroundColor: status === 'sos' ? colors.danger : colors.warning }]}>
                <Text style={styles.badgeText}>{status === 'sos' ? 'SOS' : 'STOP'}</Text>
              </View>
            )}
            {r.distance != null && r.uid !== me && <Text style={styles.dist}>{formatDistance(r.distance)}</Text>}
          </Pressable>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  sep: { height: 1, backgroundColor: colors.border },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#0E0F12', fontWeight: '900', fontSize: 13 },
  name: { color: colors.text, fontSize: 16, fontWeight: '700' },
  meta: { color: colors.textDim, fontSize: 13, marginTop: 1 },
  dist: { color: colors.text, fontWeight: '800', fontSize: 15 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { color: '#0E0F12', fontWeight: '900', fontSize: 11 },
});
