import { Pressable, ScrollView, Text, View } from 'react-native';
import { formatDistance } from '../lib/geo';
import type { Rider } from '../lib/groups';
import { makeStyles, radius, useTheme } from '../lib/theme';

export type GroupStripItem = {
  rider: Rider;
  /** Metres along my route: positive = ahead of me, negative = behind. null = not on my route */
  gapM: number | null;
  /** Straight-line distance from me */
  distanceM: number | null;
  stale: boolean;
};

function label(i: GroupStripItem): string {
  if (i.stale) return 'signal lost';
  if (i.gapM != null) {
    if (Math.abs(i.gapM) < 80) return 'with you';
    return `${formatDistance(Math.abs(i.gapM))} ${i.gapM > 0 ? 'ahead' : 'behind'}`;
  }
  return i.distanceM != null ? `off route · ${formatDistance(i.distanceM)}` : 'off route';
}

/** "Where's everyone?" while navigating — the map is zoomed in, so most riders are off-screen. */
export function NavGroupStrip({ items, onSelect }: { items: GroupStripItem[]; onSelect: (r: Rider) => void }) {
  const { colors } = useTheme();
  const styles = useStyles();
  if (!items.length) return null;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {items.map((i) => {
        const status = i.rider.loc?.status ?? 'ok';
        const alert = status === 'sos' ? colors.danger : status === 'stop' ? colors.warning : null;
        return (
          <Pressable
            key={i.rider.uid}
            onPress={() => onSelect(i.rider)}
            style={[styles.chip, alert && { backgroundColor: alert }]}
          >
            <View style={[styles.dot, { backgroundColor: i.stale ? colors.stale : i.rider.color }]} />
            <Text style={[styles.name, alert && { color: colors.accentText }]} numberOfLines={1}>
              {status === 'sos' ? '🆘 ' : status === 'stop' ? '✋ ' : ''}
              {i.rider.name}
            </Text>
            <Text style={[styles.gap, alert && { color: colors.accentText }]}>{label(i)}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const useStyles = makeStyles((colors) => ({
  row: { gap: 8, paddingVertical: 2 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: colors.glass,
    borderRadius: radius.lg,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  dot: { width: 12, height: 12, borderRadius: 6, borderWidth: 1.5, borderColor: '#fff' },
  name: { color: colors.text, fontWeight: '800', fontSize: 13, maxWidth: 120 },
  gap: { color: colors.textDim, fontWeight: '700', fontSize: 12 },
}));
