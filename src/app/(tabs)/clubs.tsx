import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Input } from '../../components/ui';
import { subscribeDiscover, subscribeMyClubs, type Club, type Membership } from '../../lib/clubs';
import { useSession } from '../../lib/session';
import { makeStyles, radius, useTheme } from '../../lib/theme';

export default function ClubsScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { uid, profile } = useSession();
  const [mine, setMine] = useState<Membership[] | null>(null);
  const [all, setAll] = useState<Club[] | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => (uid ? subscribeMyClubs(uid, setMine, (e) => setError(e.message)) : undefined), [uid]);
  useEffect(() => subscribeDiscover(setAll, (e) => setError(e.message)), []);

  const myIds = useMemo(() => new Set((mine ?? []).map((m) => m.clubId)), [mine]);
  const myCity = (profile?.city ?? '').trim().toLowerCase();
  const discover = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (all ?? [])
      .filter((c) => !myIds.has(c.id))
      .filter((c) => !q || c.name.toLowerCase().includes(q) || c.city.toLowerCase().includes(q))
      // clubs in my city first
      .sort((a, b) => Number(b.city.toLowerCase() === myCity) - Number(a.city.toLowerCase() === myCity));
  }, [all, myIds, search, myCity]);

  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top']}>
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={styles.titleRow}>
          <Text style={styles.title}>Clubs</Text>
          <Button
            title="Create"
            onPress={() => router.push('/clubs/new')}
            style={{ minHeight: 40, paddingHorizontal: 14 }}
            icon={<Ionicons name="add" size={18} color={colors.accentText} />}
          />
        </View>
        {!!error && <Text style={styles.error}>{error}</Text>}

        <Text style={styles.section}>Your clubs</Text>
        {mine === null ? (
          <ActivityIndicator color={colors.accent} />
        ) : mine.length === 0 ? (
          <Text style={styles.dim}>You haven’t joined a club yet — find one below or create your own.</Text>
        ) : (
          mine.map((m) => (
            <Pressable key={m.clubId} style={styles.card} onPress={() => router.push({ pathname: '/clubs/[id]', params: { id: m.clubId } })}>
              <View style={styles.badge}>
                <Ionicons name="people" size={20} color={colors.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.name} numberOfLines={1}>{m.clubName}</Text>
                <Text style={styles.dim}>{m.role === 'owner' ? 'Owner' : m.role === 'admin' ? 'Admin' : 'Member'}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textDim} />
            </Pressable>
          ))
        )}

        <Text style={[styles.section, { marginTop: 10 }]}>Discover</Text>
        <Input value={search} onChangeText={setSearch} placeholder="Search clubs or cities" autoCorrect={false} />
        {all === null ? (
          <ActivityIndicator color={colors.accent} />
        ) : discover.length === 0 ? (
          <Text style={styles.dim}>{search ? 'No clubs match.' : 'No other clubs yet.'}</Text>
        ) : (
          discover.map((c) => (
            <Pressable key={c.id} style={styles.card} onPress={() => router.push({ pathname: '/clubs/[id]', params: { id: c.id } })}>
              <View style={styles.badge}>
                <Ionicons name="people-outline" size={20} color={colors.textDim} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.name} numberOfLines={1}>{c.name}</Text>
                <Text style={styles.dim} numberOfLines={1}>
                  {[c.city, `${c.memberCount} ${c.memberCount === 1 ? 'member' : 'members'}`].filter(Boolean).join(' · ')}
                </Text>
              </View>
              <View style={[styles.policy, c.joinPolicy === 'open' ? styles.open : styles.approval]}>
                <Text style={styles.policyText}>{c.joinPolicy === 'open' ? 'Open' : 'Approval'}</Text>
              </View>
            </Pressable>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { padding: 20, gap: 10, paddingBottom: 40, width: '100%', maxWidth: 720, alignSelf: 'center' },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  title: { color: colors.text, fontSize: 30, fontWeight: '800', letterSpacing: -0.5 },
  section: { color: colors.textDim, fontSize: 13, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  dim: { color: colors.textDim, fontSize: 13 },
  error: { color: colors.danger },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  badge: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.surfaceHigh, alignItems: 'center', justifyContent: 'center' },
  name: { color: colors.text, fontSize: 17, fontWeight: '800' },
  policy: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  open: { backgroundColor: 'rgba(52,199,89,0.18)' },
  approval: { backgroundColor: 'rgba(255,159,10,0.2)' },
  policyText: { color: colors.text, fontSize: 11, fontWeight: '800' },
}));
