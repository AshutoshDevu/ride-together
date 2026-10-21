import { BlurView } from 'expo-blur';
import type { ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { radius, useTheme } from '../lib/theme';

/**
 * Apple-Maps-style frosted panel for controls floating over the map. Real blur on iOS and web
 * (CSS backdrop-filter); on Android the map is a GL surface that can't be blurred, so the
 * translucent theme fill alone does the job.
 */
export function Glass({
  children,
  style,
  round,
}: {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Fully round (FAB buttons) */
  round?: boolean;
}) {
  const { colors, scheme } = useTheme();
  return (
    <View
      style={[
        styles.shadow,
        { shadowColor: colors.shadow, borderRadius: round ? 999 : radius.lg },
        style,
      ]}
    >
      <BlurView
        tint={scheme === 'dark' ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight'}
        intensity={60}
        style={[StyleSheet.absoluteFill, { borderRadius: round ? 999 : radius.lg, overflow: 'hidden' }]}
      />
      <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            backgroundColor: colors.glass,
            borderRadius: round ? 999 : radius.lg,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: scheme === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)',
          },
        ]}
      />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  shadow: {
    shadowOpacity: 1,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
});
