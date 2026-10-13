import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NameField } from '../components/NameField';
import { Button, Input } from '../components/ui';
import { CODE_LENGTH, createGroup, getGroupMeta, isMember, joinGroup, normalizeCode } from '../lib/groups';
import { useSession } from '../lib/session';
import { getActiveGroup, setActiveGroup } from '../lib/storage';
import { colors, radius } from '../lib/theme';

export default function Home() {
  const { ready, error, uid, name, saveName } = useSession();
  const [draftName, setDraftName] = useState<string | null>(null);
  const [groupName, setGroupName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<'create' | 'join' | null>(null);
  const [resume, setResume] = useState<{ code: string; name: string } | null>(null);

  const riderName = (draftName ?? name).trim();

  useFocusEffect(
    useCallback(() => {
      if (!uid) return;
      (async () => {
        const active = await getActiveGroup();
        if (!active) return setResume(null);
        const [meta, member] = await Promise.all([getGroupMeta(active), isMember(active, uid)]);
        if (meta && member) setResume({ code: active, name: meta.name });
        else {
          await setActiveGroup(null);
          setResume(null);
        }
      })().catch(() => setResume(null));
    }, [uid]),
  );

  async function withName(): Promise<string | null> {
    if (riderName.length < 2) {
      Alert.alert('Add your name', 'Riders will see this name next to your marker on the map.');
      return null;
    }
    if (riderName !== name) await saveName(riderName);
    return riderName;
  }

  async function onCreate() {
    if (!uid) return;
    const n = await withName();
    if (!n) return;
    setBusy('create');
    try {
      const c = await createGroup(groupName, uid, n);
      router.push({ pathname: '/group/[code]', params: { code: c, invite: '1' } });
    } catch (e: any) {
      Alert.alert('Could not create ride', e?.message ?? String(e));
    } finally {
      setBusy(null);
    }
  }

  async function onJoin() {
    if (!uid) return;
    const n = await withName();
    if (!n) return;
    const c = normalizeCode(code);
    if (c.length !== CODE_LENGTH) return Alert.alert('Invalid code', `Ride codes have ${CODE_LENGTH} characters.`);
    setBusy('join');
    try {
      await joinGroup(c, uid, n);
      router.push({ pathname: '/group/[code]', params: { code: c } });
    } catch (e: any) {
      Alert.alert('Could not join', e?.message ?? String(e));
    } finally {
      setBusy(null);
    }
  }

  if (!ready) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={styles.hero}>
            <Text style={styles.logo}>🏍️</Text>
            <Text style={styles.title}>RideTogether</Text>
            <Text style={styles.subtitle}>One live map for the whole group. Nobody gets left behind.</Text>
          </View>

          {error && (
            <View style={[styles.card, { borderColor: colors.danger }]}>
              <Text style={{ color: colors.danger, fontWeight: '700' }}>Setup problem</Text>
              <Text style={{ color: colors.text }}>{error}</Text>
            </View>
          )}

          {resume && (
            <Pressable
              style={[styles.card, styles.resume]}
              onPress={() => router.push({ pathname: '/group/[code]', params: { code: resume.code } })}
            >
              <Text style={styles.resumeLabel}>RIDE IN PROGRESS</Text>
              <Text style={styles.resumeName}>{resume.name}</Text>
              <Text style={{ color: colors.accentText, fontWeight: '600' }}>Tap to open map · {resume.code}</Text>
            </Pressable>
          )}

          <NameField value={draftName ?? name} onChange={setDraftName} />

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Start a new ride</Text>
            <Input
              value={groupName}
              onChangeText={setGroupName}
              placeholder="Ride name, e.g. Nandi Hills Sunday"
              maxLength={40}
            />
            <Button title="Create ride & get invite link" onPress={onCreate} loading={busy === 'create'} disabled={!uid} />
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Join with a code</Text>
            <Text style={styles.hint}>Got a WhatsApp link? Just tap it. Otherwise type the 6-letter code.</Text>
            <Input
              value={code}
              onChangeText={(t) => setCode(normalizeCode(t))}
              placeholder="ABC123"
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={CODE_LENGTH}
              style={styles.codeInput}
            />
            <Button
              title="Join ride"
              variant="secondary"
              onPress={onJoin}
              loading={busy === 'join'}
              disabled={!uid || code.length !== CODE_LENGTH}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  container: { padding: 20, gap: 18, paddingBottom: 40 },
  hero: { alignItems: 'center', gap: 6, marginTop: 12, marginBottom: 6 },
  logo: { fontSize: 52 },
  title: { color: colors.text, fontSize: 32, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { color: colors.textDim, fontSize: 15, textAlign: 'center', maxWidth: 300 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 18,
    gap: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardTitle: { color: colors.text, fontSize: 19, fontWeight: '700' },
  hint: { color: colors.textDim, fontSize: 14 },
  codeInput: { fontSize: 26, letterSpacing: 8, textAlign: 'center', fontWeight: '800' },
  resume: { backgroundColor: colors.accent, borderColor: colors.accent, gap: 4 },
  resumeLabel: { color: colors.accentText, fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  resumeName: { color: colors.accentText, fontSize: 22, fontWeight: '800' },
});
