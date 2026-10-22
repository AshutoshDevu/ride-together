import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DestinationPicker } from '../../../components/DestinationPicker';
import { Button, Input } from '../../../components/ui';
import { createEvent, eventWhen, type Place } from '../../../lib/clubs';
import { notify } from '../../../lib/dialog';
import { useSession } from '../../../lib/session';
import { makeStyles, radius, useTheme } from '../../../lib/theme';

/** Admins plan a group ride: when, where to meet, where to go. */
export default function NewEvent() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { uid, name } = useSession();
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [dayOffset, setDayOffset] = useState(1);
  const [minutes, setMinutes] = useState(6 * 60); // 6:00 am — riders like early starts
  const [meetPoint, setMeetPoint] = useState<Place | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);
  const [picking, setPicking] = useState<'meet' | 'dest' | null>(null);
  const [busy, setBusy] = useState(false);

  const days = useMemo(
    () =>
      Array.from({ length: 21 }, (_, i) => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() + i);
        return { i, d };
      }),
    [],
  );
  const times = useMemo(() => Array.from({ length: 37 }, (_, i) => 4 * 60 + i * 30), []); // 4:00 → 22:00
  const startAt = useMemo(() => days[dayOffset].d.getTime() + minutes * 60_000, [days, dayOffset, minutes]);

  async function save() {
    if (!uid) return;
    if (title.trim().length < 3) return notify('Name the ride', 'e.g. "Sunrise at Nandi Hills"');
    if (startAt < Date.now() - 60_000) return notify('That time has passed', 'Pick a later time.');
    setBusy(true);
    try {
      const eventId = await createEvent(String(id), uid, name, { title, notes, startAt, meetPoint, destination });
      router.replace({ pathname: '/clubs/[id]/event/[eventId]', params: { id: String(id), eventId } });
    } catch (e: any) {
      notify('Could not create', e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  const fmtTime = (m: number) =>
    new Date(2000, 0, 1, Math.floor(m / 60), m % 60).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <Ionicons name="chevron-back" size={28} color={colors.text} />
          </Pressable>
          <Text style={styles.headerTitle}>Plan a group ride</Text>
        </View>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Ride name</Text>
          <Input value={title} onChangeText={setTitle} placeholder="e.g. Sunrise at Nandi Hills" maxLength={80} />

          <Text style={styles.label}>Day</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {days.map(({ i, d }) => (
              <Pressable key={i} onPress={() => setDayOffset(i)} style={[styles.chip, dayOffset === i && styles.chipOn]}>
                <Text style={[styles.chipSmall, dayOffset === i && styles.chipTextOn]}>
                  {i === 0 ? 'Today' : i === 1 ? 'Tmrw' : d.toLocaleDateString([], { weekday: 'short' })}
                </Text>
                <Text style={[styles.chipBig, dayOffset === i && styles.chipTextOn]}>{d.getDate()}</Text>
              </Pressable>
            ))}
          </ScrollView>

          <Text style={styles.label}>Start time</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {times.map((m) => (
              <Pressable key={m} onPress={() => setMinutes(m)} style={[styles.timeChip, minutes === m && styles.chipOn]}>
                <Text style={[styles.chipSmall, { fontSize: 14 }, minutes === m && styles.chipTextOn]}>{fmtTime(m)}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <Text style={styles.when}>{eventWhen(startAt)}</Text>

          <Text style={styles.label}>Meeting point</Text>
          <Pressable style={styles.placeBtn} onPress={() => setPicking('meet')}>
            <Ionicons name="people-outline" size={20} color={colors.accent} />
            <Text style={[styles.placeText, !meetPoint && styles.dim]} numberOfLines={1}>
              {meetPoint?.name ?? 'Search a meeting point (optional)'}
            </Text>
          </Pressable>

          <Text style={styles.label}>Destination</Text>
          <Pressable style={styles.placeBtn} onPress={() => setPicking('dest')}>
            <Ionicons name="flag-outline" size={20} color={colors.accent} />
            <Text style={[styles.placeText, !destination && styles.dim]} numberOfLines={1}>
              {destination?.name ?? 'Search a destination (optional)'}
            </Text>
          </Pressable>

          <Text style={styles.label}>Notes</Text>
          <Input
            value={notes}
            onChangeText={setNotes}
            placeholder="Pace, fuel stop, breakfast plans, gear…"
            multiline
            maxLength={2000}
            style={{ minHeight: 100, paddingTop: 14, textAlignVertical: 'top' }}
          />
          <Button title="Create ride" onPress={save} loading={busy} style={{ marginTop: 6 }} />
        </ScrollView>
      </KeyboardAvoidingView>
      <DestinationPicker
        visible={picking !== null}
        near={null}
        onClose={() => setPicking(null)}
        onPick={(p) => {
          const place = { name: p.name, lat: p.lat, lng: p.lng };
          if (picking === 'meet') setMeetPoint(place);
          else setDestination(place);
          setPicking(null);
        }}
      />
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 8 },
  headerTitle: { color: colors.text, fontSize: 20, fontWeight: '800' },
  container: { padding: 20, gap: 10, paddingBottom: 40, width: '100%', maxWidth: 560, alignSelf: 'center' },
  label: { color: colors.textDim, fontSize: 13, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 6 },
  dim: { color: colors.textDim },
  chip: { width: 58, paddingVertical: 8, borderRadius: radius.md, backgroundColor: colors.surfaceHigh, alignItems: 'center' },
  timeChip: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.md, backgroundColor: colors.surfaceHigh },
  chipOn: { backgroundColor: colors.accent },
  chipSmall: { color: colors.textDim, fontSize: 12, fontWeight: '700' },
  chipBig: { color: colors.text, fontSize: 20, fontWeight: '900' },
  chipTextOn: { color: colors.accentText },
  when: { color: colors.text, fontWeight: '800', fontSize: 15 },
  placeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 54,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceHigh,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
  },
  placeText: { color: colors.text, fontSize: 16, flex: 1 },
}));
