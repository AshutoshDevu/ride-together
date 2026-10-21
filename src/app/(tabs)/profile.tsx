import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { initials } from '../../components/RiderMarker';
import { ThemeToggle } from '../../components/ThemeToggle';
import { Button, Input } from '../../components/ui';
import { signOut } from '../../lib/auth';
import { confirmAction, notify } from '../../lib/dialog';
import { useSession } from '../../lib/session';
import { stopTracking } from '../../lib/tracking';
import { setActiveGroup } from '../../lib/storage';
import { makeStyles, radius, useTheme } from '../../lib/theme';

export default function ProfileScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { user, profile, saveProfile } = useSession();
  const [displayName, setDisplayName] = useState('');
  const [bike, setBike] = useState('');
  const [city, setCity] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDisplayName(profile?.displayName ?? '');
    setBike(profile?.bike ?? '');
    setCity(profile?.city ?? '');
  }, [profile]);

  const dirty =
    displayName.trim() !== (profile?.displayName ?? '') ||
    bike.trim() !== (profile?.bike ?? '') ||
    city.trim() !== (profile?.city ?? '');

  async function save() {
    if (displayName.trim().length < 2) return notify('Add your name', 'Riders see it next to your marker.');
    setSaving(true);
    try {
      await saveProfile({ ...profile, displayName, bike, city });
    } catch (e: any) {
      notify('Could not save', e?.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  async function doSignOut() {
    const ok = await confirmAction({
      title: 'Sign out?',
      message: 'You will stop sharing your location with any ride you are in.',
      confirmText: 'Sign out',
      destructive: true,
    });
    if (!ok) return;
    await stopTracking();
    await setActiveGroup(null);
    await signOut();
  }

  const account = user?.email ?? user?.phoneNumber ?? '';

  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            {profile?.photoURL ? (
              <Image source={{ uri: profile.photoURL }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatar, { backgroundColor: colors.accent }]}>
                <Text style={styles.avatarText}>{initials(profile?.displayName ?? '?')}</Text>
              </View>
            )}
            <Text style={styles.name}>{profile?.displayName}</Text>
            {!!account && <Text style={styles.dim}>{account}</Text>}
          </View>

          <View style={styles.card}>
            <Text style={styles.section}>Rider profile</Text>
            <Text style={styles.label}>Name (shown on the map)</Text>
            <Input value={displayName} onChangeText={setDisplayName} maxLength={40} autoCapitalize="words" />
            <Text style={styles.label}>Bike</Text>
            <Input value={bike} onChangeText={setBike} placeholder="e.g. KTM Duke 390" maxLength={40} />
            <Text style={styles.label}>City</Text>
            <Input value={city} onChangeText={setCity} placeholder="e.g. Bengaluru" maxLength={40} autoCapitalize="words" />
            <Button title="Save" onPress={save} loading={saving} disabled={!dirty} />
          </View>

          <View style={styles.card}>
            <Text style={styles.section}>Appearance</Text>
            <Text style={styles.dim}>Auto follows your phone's light / dark setting — the map too.</Text>
            <ThemeToggle />
          </View>

          <Button title="Sign out" variant="ghost" onPress={doSignOut} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { padding: 20, gap: 18, paddingBottom: 40, width: '100%', maxWidth: 560, alignSelf: 'center' },
  header: { alignItems: 'center', gap: 6, marginTop: 8 },
  avatar: { width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.accentText, fontSize: 30, fontWeight: '900' },
  name: { color: colors.text, fontSize: 24, fontWeight: '800' },
  dim: { color: colors.textDim, fontSize: 14 },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: 18, gap: 10, borderWidth: 1, borderColor: colors.border },
  section: { color: colors.text, fontSize: 19, fontWeight: '700', marginBottom: 2 },
  label: { color: colors.textDim, fontSize: 13, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase' },
}));
