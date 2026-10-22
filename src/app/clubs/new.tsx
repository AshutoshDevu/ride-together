import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Segmented } from '../../components/Segmented';
import { Button, Input } from '../../components/ui';
import { createClub, getClub, updateClub, type JoinPolicy } from '../../lib/clubs';
import { notify } from '../../lib/dialog';
import { useSession } from '../../lib/session';
import { makeStyles, radius, useTheme } from '../../lib/theme';

/** Create a club, or edit one (`?edit=<clubId>`, owner / admins). */
export default function NewClub() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  const { uid, name, profile } = useSession();
  const [clubName, setClubName] = useState('');
  const [description, setDescription] = useState('');
  const [city, setCity] = useState(profile?.city ?? '');
  const [policy, setPolicy] = useState<JoinPolicy>('open');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!edit) return;
    getClub(String(edit)).then((c) => {
      if (!c) return;
      setClubName(c.name);
      setDescription(c.description);
      setCity(c.city);
      setPolicy(c.joinPolicy);
    });
  }, [edit]);

  async function save() {
    if (!uid) return;
    if (clubName.trim().length < 3) return notify('Name your club', 'At least 3 characters.');
    setBusy(true);
    try {
      const data = { name: clubName, description, city, joinPolicy: policy };
      if (edit) {
        await updateClub(String(edit), data);
        router.back();
      } else {
        const id = await createClub(uid, name, data);
        router.replace({ pathname: '/clubs/[id]', params: { id } });
      }
    } catch (e: any) {
      notify('Could not save', e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1 }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={10}>
            <Ionicons name="chevron-back" size={28} color={colors.text} />
          </Pressable>
          <Text style={styles.headerTitle}>{edit ? 'Club settings' : 'New club'}</Text>
        </View>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <Text style={styles.label}>Club name</Text>
          <Input value={clubName} onChangeText={setClubName} placeholder="e.g. Bangalore Sunday Riders" maxLength={60} />
          <Text style={styles.label}>City</Text>
          <Input value={city} onChangeText={setCity} placeholder="e.g. Bengaluru" maxLength={40} autoCapitalize="words" />
          <Text style={styles.label}>About</Text>
          <Input
            value={description}
            onChangeText={setDescription}
            placeholder="What kind of rides, how often, who it's for…"
            multiline
            maxLength={1000}
            style={{ minHeight: 110, paddingTop: 14, textAlignVertical: 'top' }}
          />
          <Text style={styles.label}>Who can join</Text>
          <Segmented
            options={[
              { value: 'open', label: 'Anyone (open)' },
              { value: 'approval', label: 'Admins approve' },
            ]}
            value={policy}
            onChange={setPolicy}
          />
          <Text style={styles.dim}>
            {policy === 'open'
              ? 'Riders join instantly and can see the chat, board and rides.'
              : 'Riders send a request; you or your admins accept it.'}
          </Text>
          <Button title={edit ? 'Save' : 'Create club'} onPress={save} loading={busy} style={{ marginTop: 8 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 8 },
  headerTitle: { color: colors.text, fontSize: 20, fontWeight: '800' },
  container: { padding: 20, gap: 10, paddingBottom: 40, width: '100%', maxWidth: 560, alignSelf: 'center' },
  label: { color: colors.textDim, fontSize: 13, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 6 },
  dim: { color: colors.textDim, fontSize: 13 },
  card: { borderRadius: radius.lg },
}));
