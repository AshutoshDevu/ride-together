import { Pressable, Text, View } from 'react-native';
import { makeStyles, radius } from '../lib/theme';

/** iOS-style segmented control. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; badge?: number }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const styles = useStyles();
  return (
    <View style={styles.row} accessibilityRole="tablist">
      {options.map((o) => (
        <Pressable
          key={o.value}
          onPress={() => onChange(o.value)}
          style={[styles.seg, value === o.value && styles.segOn]}
          accessibilityRole="tab"
          accessibilityState={{ selected: value === o.value }}
        >
          <Text style={[styles.text, value === o.value && styles.textOn]} numberOfLines={1}>
            {o.label}
            {o.badge ? ` · ${o.badge}` : ''}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  row: { flexDirection: 'row', backgroundColor: colors.surfaceHigh, borderRadius: radius.sm + 2, padding: 2 },
  seg: { flex: 1, paddingVertical: 8, borderRadius: radius.sm, alignItems: 'center' },
  segOn: {
    backgroundColor: colors.surface,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
  text: { color: colors.textDim, fontWeight: '700', fontSize: 13 },
  textOn: { color: colors.text },
}));
