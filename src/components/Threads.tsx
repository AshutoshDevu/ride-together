import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { notify } from '../lib/dialog';
import { createThread, subscribeThreads, timeAgo, type Scope, type Thread } from '../lib/forum';
import { makeStyles, radius, useTheme } from '../lib/theme';
import { Button, Input } from './ui';

/** Thread list for a club board or the community forum, with a "New post" composer. */
export function ThreadList({
  scope,
  uid,
  name,
  city,
  header,
  cityFilter,
}: {
  scope: Scope;
  uid: string;
  name: string;
  /** Default city for new posts (from the profile) */
  city: string;
  header?: React.ReactElement;
  /** Community forum: show only posts from this city (null = all) */
  cityFilter?: string | null;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [composing, setComposing] = useState(false);
  const key = scope.kind === 'club' ? scope.clubId : 'public';

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => subscribeThreads(scope, setThreads, (e) => notify('Posts unavailable', e.message)), [key]);

  const shown = (threads ?? []).filter(
    (t) => !cityFilter || t.city.trim().toLowerCase() === cityFilter.trim().toLowerCase(),
  );

  return (
    <>
      <FlatList
        data={shown}
        keyExtractor={(t) => t.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <View style={{ gap: 12, marginBottom: 4 }}>
            {header}
            <Button title="New post" onPress={() => setComposing(true)} icon={<Ionicons name="create-outline" size={18} color={colors.accentText} />} />
          </View>
        }
        ListEmptyComponent={
          threads ? (
            <Text style={styles.empty}>No posts yet — start the conversation.</Text>
          ) : null
        }
        ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
        renderItem={({ item: t }) => (
          <Pressable
            style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}
            onPress={() =>
              router.push({
                pathname: '/thread',
                params: scope.kind === 'club' ? { club: scope.clubId, id: t.id } : { id: t.id },
              })
            }
          >
            <Text style={styles.title} numberOfLines={2}>{t.title}</Text>
            {!!t.body && <Text style={styles.body} numberOfLines={2}>{t.body}</Text>}
            <View style={styles.meta}>
              <Text style={styles.dim}>
                {t.authorName}
                {t.city ? ` · ${t.city}` : ''} · {timeAgo(t.lastActivityAt)}
              </Text>
              <View style={styles.replies}>
                <Ionicons name="chatbubble-outline" size={14} color={colors.textDim} />
                <Text style={styles.dim}>{t.replyCount}</Text>
              </View>
            </View>
          </Pressable>
        )}
      />
      <ComposeThread
        visible={composing}
        defaultCity={city}
        onClose={() => setComposing(false)}
        onPost={async (title, body, postCity) => {
          const id = await createThread(scope, uid, name, { title, body, city: postCity });
          setComposing(false);
          router.push({ pathname: '/thread', params: scope.kind === 'club' ? { club: scope.clubId, id } : { id } });
        }}
      />
    </>
  );
}

function ComposeThread({
  visible,
  defaultCity,
  onClose,
  onPost,
}: {
  visible: boolean;
  defaultCity: string;
  onClose: () => void;
  onPost: (title: string, body: string, city: string) => Promise<void>;
}) {
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [city, setCity] = useState(defaultCity);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (visible) setCity((c) => c || defaultCity);
  }, [visible, defaultCity]);

  async function post() {
    if (title.trim().length < 3) return notify('Add a title', 'At least 3 characters.');
    setBusy(true);
    try {
      await onPost(title, body, city);
      setTitle('');
      setBody('');
    } catch (e: any) {
      notify('Could not post', e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]} onPress={() => {}}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 10 }}>
            <Text style={styles.kicker}>NEW POST</Text>
            <Input value={title} onChangeText={setTitle} placeholder="Title — e.g. Sunrise ride this Sunday?" maxLength={120} />
            <Input
              value={body}
              onChangeText={setBody}
              placeholder="Details (route ideas, meeting point, anything…)"
              multiline
              maxLength={5000}
              style={{ minHeight: 120, paddingTop: 14, textAlignVertical: 'top' }}
            />
            <Input value={city} onChangeText={setCity} placeholder="City (optional)" maxLength={40} autoCapitalize="words" />
            <Button title="Post" onPress={post} loading={busy} />
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  list: { padding: 16, paddingBottom: 40, width: '100%', maxWidth: 720, alignSelf: 'center' },
  card: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: 14, gap: 6 },
  title: { color: colors.text, fontSize: 17, fontWeight: '800' },
  body: { color: colors.textDim, fontSize: 14, lineHeight: 19 },
  meta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  replies: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dim: { color: colors.textDim, fontSize: 12 },
  empty: { color: colors.textDim, textAlign: 'center', marginTop: 30 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: 20,
    maxHeight: '90%',
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
  },
  kicker: { color: colors.accent, fontWeight: '800', letterSpacing: 1, fontSize: 12 },
}));
