import { Pressable, Text, View } from 'react-native';
import { makeStyles, radius, useTheme, type ThemeMode } from '../lib/theme';

const OPTIONS: { mode: ThemeMode; label: string }[] = [
  { mode: 'auto', label: 'Auto' },
  { mode: 'light', label: '☀︎ Light' },
  { mode: 'dark', label: '☾ Dark' },
];

/** Segmented Auto / Light / Dark switch (Auto follows the phone's setting). */
export function ThemeToggle() {
  const { mode, setMode } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.row} accessibilityRole="radiogroup">
      {OPTIONS.map((o) => (
        <Pressable
          key={o.mode}
          onPress={() => setMode(o.mode)}
          style={[styles.seg, mode === o.mode && styles.segOn]}
          accessibilityRole="radio"
          accessibilityState={{ selected: mode === o.mode }}
        >
          <Text style={[styles.text, mode === o.mode && styles.textOn]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  row: { flexDirection: 'row', backgroundColor: colors.surfaceHigh, borderRadius: radius.sm + 2, padding: 2, alignSelf: 'center' },
  seg: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.sm },
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
