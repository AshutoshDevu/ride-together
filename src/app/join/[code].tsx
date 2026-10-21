import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NameField } from '../../components/NameField';
import { Button } from '../../components/ui';
import { getGroupMeta, isMember, joinGroup, normalizeCode, type GroupMeta } from '../../lib/groups';
import { notify } from '../../lib/dialog';
import { useSession } from '../../lib/session';
import { colors, radius } from '../../lib/theme';

/**
 * Opened from the WhatsApp invite: https://<host>/join/CODE or ridetogether://join/CODE
 */
export default function JoinScreen() {
  const params = useLocalSearchParams<{ code: string }>();
  const code = normalizeCode(String(params.code ?? ''));
  const { ready, uid, name, saveName, error } = useSession();
  const [meta, setMeta] = useState<GroupMeta | null | undefined>(undefined);
  const [draft, setDraft] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    if (!uid) return;
    (async () => {
      // Already in this ride? Go straight to the map.
      if (await isMember(code, uid)) {
        router.replace({ pathname: '/group/[code]', params: { code } });
        return;
      }
      setMeta(await getGroupMeta(code));
    })().catch(() => setMeta(null));
  }, [uid, code]);

  async function onJoin() {
    const n = (draft ?? name).trim();
    if (n.length < 2) return notify('Add your name', 'So the group knows which marker is you.');
    if (!uid) return;
    setJoining(true);
    try {
      if (n !== name) await saveName(n);
      await joinGroup(code, uid, n);
      router.replace({ pathname: '/group/[code]', params: { code } });
    } catch (e: any) {
      notify('Could not join', e?.message ?? String(e));
    } finally {
      setJoining(false);
    }
  }

  if (!ready || (uid && meta === undefined)) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {error || meta === null ? (
        <View style={styles.card}>
          <Text style={styles.title}>Ride not found</Text>
          <Text style={styles.dim}>
            {error ?? `There is no active ride with code ${code}. Ask the organiser for a fresh link.`}
          </Text>
          <Button title="Go home" variant="secondary" onPress={() => router.replace('/')} />
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.kicker}>YOU'RE INVITED TO</Text>
          <Text style={styles.title}>{meta?.name}</Text>
          <Text style={styles.dim}>Code {code}</Text>
          <NameField value={draft ?? name} onChange={setDraft} />
          <Button title="Join ride & share my location" onPress={onJoin} loading={joining} />
          <Text style={styles.dim}>
            Your live location is shared only with riders in this group, and only until you leave the ride.
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  container: { flex: 1, padding: 20, justifyContent: 'center', width: '100%', maxWidth: 560, alignSelf: 'center' },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 22, gap: 14, borderWidth: 1, borderColor: colors.border },
  kicker: { color: colors.accent, fontWeight: '800', letterSpacing: 1, fontSize: 12 },
  title: { color: colors.text, fontSize: 28, fontWeight: '800' },
  dim: { color: colors.textDim, fontSize: 14 },
});
