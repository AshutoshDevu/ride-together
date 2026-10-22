import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '../../../../components/ui';
import {
  deleteEvent,
  eventWhen,
  markEventDone,
  setRsvp,
  startEventRide,
  subscribeEvent,
  subscribeMyMembership,
  subscribeRsvps,
  type ClubEvent,
  type ClubMember,
} from '../../../../lib/clubs';
import { confirmAction, notify } from '../../../../lib/dialog';
import { joinGroup, isMember as isRideMember } from '../../../../lib/groups';
import { getCurrentFix } from '../../../../lib/navigation';
import { useSession } from '../../../../lib/session';
import { makeStyles, radius, useTheme } from '../../../../lib/theme';

/** A scheduled group ride: details, RSVP, and — at ride time — start / join the live ride. */
export default function EventScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { id, eventId } = useLocalSearchParams<{ id: string; eventId: string }>();
  const clubId = String(id);
  const { uid, name } = useSession();
  const [ev, setEv] = useState<ClubEvent | null | undefined>(undefined);
  const [rsvps, setRsvps] = useState<{ uid: string; name: string }[]>([]);
  const [me, setMe] = useState<ClubMember | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => subscribeEvent(clubId, String(eventId), setEv, () => setEv(null)), [clubId, eventId]);
  useEffect(() => subscribeRsvps(clubId, String(eventId), setRsvps, () => {}), [clubId, eventId]);
  useEffect(() => (uid ? subscribeMyMembership(clubId, uid, setMe) : undefined), [clubId, uid]);

  const going = !!uid && rsvps.some((r) => r.uid === uid);
  const isAdmin = me?.role === 'owner' || me?.role === 'admin';
  const canRun = !!ev && (ev.createdBy === uid || isAdmin);

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    try {
      await fn();
    } catch (e: any) {
      notify('Something went wrong', e?.message ?? String(e));
    } finally {
      setBusy(null);
    }
  }

  async function start() {
    if (!ev || !uid) return;
    const ok = await confirmAction({
      title: 'Start the ride now?',
      message: `Everyone who RSVP'd sees "Ride is live" and can join the live map${ev.destination ? ` — destination ${ev.destination.name} is set for the group` : ''}.`,
      confirmText: 'Start ride',
    });
    if (!ok) return;
    run('start', async () => {
      const from = await getCurrentFix().catch(() => null);
      const code = await startEventRide(ev, uid, name, from);
      router.push({ pathname: '/group/[code]', params: { code } });
    });
  }

  async function joinLive() {
    if (!ev?.rideCode || !uid) return;
    run('join', async () => {
      if (!(await isRideMember(ev.rideCode!, uid))) await joinGroup(ev.rideCode!, uid, name);
      router.push({ pathname: '/group/[code]', params: { code: ev.rideCode! } });
    });
  }

  async function remove() {
    const ok = await confirmAction({ title: 'Delete this ride?', message: 'RSVPs will be lost.', confirmText: 'Delete', destructive: true });
    if (ok) run('delete', async () => {
      await deleteEvent(clubId, String(eventId));
      router.back();
    });
  }

  if (ev === undefined) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  if (ev === null) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Ride not found</Text>
        <Button title="Back" variant="secondary" onPress={() => router.back()} />
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>Group ride</Text>
        {canRun && (
          <Pressable onPress={remove} hitSlop={10}>
            <Ionicons name="trash-outline" size={22} color={colors.danger} />
          </Pressable>
        )}
      </View>
      <ScrollView contentContainerStyle={styles.container}>
        {ev.status === 'live' && (
          <View style={styles.live}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>Ride is live</Text>
          </View>
        )}
        <Text style={styles.title}>{ev.title}</Text>
        <Text style={styles.when}>{eventWhen(ev.startAt)}</Text>
        <Text style={styles.dim}>Organised by {ev.createdByName}</Text>

        <View style={styles.card}>
          <Row icon="people-outline" label="Meet at" value={ev.meetPoint?.name ?? 'Not set'} />
          <Row icon="flag-outline" label="Riding to" value={ev.destination?.name ?? 'Not set'} />
          {!!ev.notes && <Text style={styles.body}>{ev.notes}</Text>}
        </View>

        {ev.status === 'live' && ev.rideCode ? (
          <Button title="Join the live ride" onPress={joinLive} loading={busy === 'join'} style={{ backgroundColor: colors.ok }} />
        ) : ev.status === 'scheduled' ? (
          <Button
            title={going ? "✓ You're going — tap to cancel" : "I'm going"}
            variant={going ? 'secondary' : 'primary'}
            onPress={() => uid && run('rsvp', () => setRsvp(clubId, ev.id, uid, name, !going))}
            loading={busy === 'rsvp'}
          />
        ) : (
          <Text style={styles.dim}>This ride has finished.</Text>
        )}

        {canRun && ev.status === 'scheduled' && (
          <Button title="Start ride now" variant="secondary" onPress={start} loading={busy === 'start'}
            icon={<Ionicons name="play" size={16} color={colors.text} />} />
        )}
        {canRun && ev.status === 'live' && (
          <Button title="Mark ride as finished" variant="ghost" onPress={() => run('done', () => markEventDone(clubId, ev.id))} loading={busy === 'done'} />
        )}

        <Text style={styles.section}>Going · {ev.rsvpCount}</Text>
        <View style={styles.chips}>
          {rsvps.length === 0 ? (
            <Text style={styles.dim}>No one yet — be the first.</Text>
          ) : (
            rsvps.map((r) => (
              <View key={r.uid} style={styles.chip}>
                <Text style={styles.chipText}>{r.name}{r.uid === uid ? ' (you)' : ''}</Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ icon, label, value }: { icon: any; label: string; value: string }) {
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={20} color={colors.accent} />
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: colors.bg, padding: 24 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 8 },
  headerTitle: { flex: 1, color: colors.text, fontSize: 17, fontWeight: '800' },
  container: { padding: 20, gap: 12, paddingBottom: 40, width: '100%', maxWidth: 560, alignSelf: 'center' },
  title: { color: colors.text, fontSize: 26, fontWeight: '800' },
  when: { color: colors.accent, fontSize: 16, fontWeight: '800' },
  dim: { color: colors.textDim, fontSize: 13 },
  body: { color: colors.text, fontSize: 15, lineHeight: 21 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  rowLabel: { color: colors.textDim, fontSize: 13, width: 70 },
  rowValue: { color: colors.text, fontSize: 15, fontWeight: '700', flex: 1 },
  live: { flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', backgroundColor: 'rgba(52,199,89,0.18)', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 5 },
  liveDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.ok },
  liveText: { color: colors.ok, fontWeight: '900' },
  section: { color: colors.text, fontSize: 17, fontWeight: '800', marginTop: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: colors.surfaceHigh, borderRadius: 14, paddingHorizontal: 12, paddingVertical: 6 },
  chipText: { color: colors.text, fontWeight: '700' },
}));
