import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { formatDistance } from '../lib/geo';
import { maneuverIcon, type NavProgress, type NavStatus } from '../lib/navigation';
import type { NavStep } from '../lib/places';
import { formatDuration } from '../lib/places';
import { makeStyles, radius, useTheme } from '../lib/theme';

const shadow = {
  shadowColor: '#000',
  shadowOpacity: 0.35,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 4 },
  elevation: 8,
};

/** Big "next turn" banner shown at the top of the map while navigating. */
export function NavBanner(props: {
  status: NavStatus;
  error: string | null;
  progress: NavProgress | null;
  nextStep: NavStep | null;
  thenStep: NavStep | null;
  destinationName: string;
  onRetry: () => void;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { status, error, progress, nextStep, thenStep, destinationName } = props;

  if (status === 'routing' || (status === 'navigating' && !progress)) {
    return (
      <View style={[styles.banner, styles.row]}>
        <ActivityIndicator color="#fff" />
        <Text style={styles.small}>Finding a two-wheeler route…</Text>
      </View>
    );
  }
  if (status === 'error') {
    return (
      <Pressable onPress={props.onRetry} style={[styles.banner, { backgroundColor: colors.danger }]}>
        <Text style={styles.instr}>Couldn't get directions</Text>
        <Text style={styles.small}>{error} — tap to retry</Text>
      </Pressable>
    );
  }
  if (status === 'arrived') {
    return (
      <View style={[styles.banner, styles.row, { backgroundColor: colors.ok }]}>
        <Text style={styles.icon}>🏁</Text>
        <View style={{ flex: 1 }}>
          <Text style={styles.instr}>You've arrived</Text>
          <Text style={styles.small} numberOfLines={1}>{destinationName}</Text>
        </View>
      </View>
    );
  }

  const offRoute = status === 'rerouting';
  return (
    <View style={[styles.banner, offRoute && { backgroundColor: colors.warning }]}>
      <View style={styles.row}>
        <Text style={[styles.icon, offRoute && { color: colors.accentText }]}>
          {offRoute ? '⟳' : nextStep ? maneuverIcon(nextStep.maneuver) : '🏁'}
        </Text>
        <View style={{ flex: 1 }}>
          <Text style={[styles.dist, offRoute && { color: colors.accentText }]}>
            {offRoute ? 'Rerouting…' : progress ? formatDistance(progress.toNextM) : ''}
          </Text>
          {!offRoute && (
            <Text style={styles.instr} numberOfLines={2}>
              {nextStep ? nextStep.instruction : `Arrive at ${destinationName}`}
            </Text>
          )}
        </View>
      </View>
      {!offRoute && thenStep && (
        <View style={styles.then}>
          <Text style={styles.thenText} numberOfLines={1}>
            Then {maneuverIcon(thenStep.maneuver)} {thenStep.instruction}
          </Text>
        </View>
      )}
    </View>
  );
}

/** Bottom bar while navigating: remaining distance / time / arrival, voice toggle, exit, SOS. */
export function NavFooter(props: {
  progress: NavProgress | null;
  voice: boolean;
  onToggleVoice: () => void;
  onExit: () => void;
  onSos: () => void;
  sosActive: boolean;
  bottomInset: number;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const { progress } = props;
  const eta = progress ? new Date(Date.now() + progress.remainingS * 1000) : null;
  return (
    <View style={[styles.footer, { paddingBottom: props.bottomInset + 12 }]}>
      <Pressable onPress={props.onExit} style={styles.exit}>
        <Text style={styles.exitText}>✕</Text>
      </Pressable>
      <View style={{ flex: 1, alignItems: 'center' }}>
        <Text style={styles.eta}>
          {eta ? eta.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '--:--'}
        </Text>
        <Text style={styles.remaining}>
          {progress ? `${formatDistance(progress.remainingM)} · ${formatDuration(progress.remainingS)}` : '—'}
        </Text>
      </View>
      <Pressable onPress={props.onToggleVoice} style={styles.exit}>
        <Text style={{ fontSize: 20 }}>{props.voice ? '🔊' : '🔇'}</Text>
      </Pressable>
      <Pressable onPress={props.onSos} style={styles.sos}>
        <Text style={styles.sosText}>{props.sosActive ? "I'm OK" : 'SOS'}</Text>
      </Pressable>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  banner: { backgroundColor: '#0F5132', borderRadius: radius.lg, padding: 14, marginTop: 6, ...shadow },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  icon: { color: '#fff', fontSize: 44, fontWeight: '900', width: 52, textAlign: 'center' },
  dist: { color: '#fff', fontSize: 30, fontWeight: '900' },
  instr: { color: '#fff', fontSize: 18, fontWeight: '700' },
  small: { color: '#fff', fontSize: 14, opacity: 0.9 },
  then: { marginTop: 10, paddingTop: 8, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.2)' },
  thenText: { color: '#fff', fontSize: 14, fontWeight: '600', opacity: 0.9 },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: 16,
    paddingTop: 14,
    ...shadow,
  },
  exit: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.surfaceHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  exitText: { color: colors.text, fontSize: 22, fontWeight: '800' },
  eta: { color: colors.ok, fontSize: 24, fontWeight: '900' },
  remaining: { color: colors.textDim, fontSize: 14, fontWeight: '600' },
  sos: {
    height: 52,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    backgroundColor: colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sosText: { color: '#fff', fontWeight: '900', fontSize: 15 },
}));
