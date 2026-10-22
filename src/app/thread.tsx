import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { subscribeMyMembership, type ClubMember } from '../lib/clubs';
import { confirmAction, notify } from '../lib/dialog';
import {
  addReply,
  deleteReply,
  deleteThread,
  report,
  subscribeReplies,
  subscribeThread,
  timeAgo,
  type Reply,
  type Scope,
  type Thread,
} from '../lib/forum';
import { useSession } from '../lib/session';
import { makeStyles, radius, useTheme } from '../lib/theme';

/** One discussion thread — club board (`?club=…&id=…`) or community forum (`?id=…`). */
export default function ThreadScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { club, id } = useLocalSearchParams<{ club?: string; id: string }>();
  const scope: Scope = useMemo(() => (club ? { kind: 'club', clubId: String(club) } : { kind: 'public' }), [club]);
  const { uid, name } = useSession();
  const [thread, setThread] = useState<Thread | null | undefined>(undefined);
  const [replies, setReplies] = useState<Reply[]>([]);
  const [me, setMe] = useState<ClubMember | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => subscribeThread(scope, String(id), setThread, () => setThread(null)), [scope, id]);
  useEffect(() => subscribeReplies(scope, String(id), setReplies, () => {}), [scope, id]);
  useEffect(() => (club && uid ? subscribeMyMembership(String(club), uid, setMe) : undefined), [club, uid]);

  const canModerate = scope.kind === 'club' && (me?.role === 'owner' || me?.role === 'admin');

  async function send() {
    if (!uid || !draft.trim()) return;
    setSending(true);
    const t = draft;
    setDraft('');
    try {
      await addReply(scope, String(id), uid, name, t);
    } catch (e: any) {
      setDraft(t);
      notify('Not sent', e?.message ?? String(e));
    } finally {
      setSending(false);
    }
  }

  async function removeThread() {
    const ok = await confirmAction({ title: 'Delete this post?', message: 'Replies will be hidden too.', confirmText: 'Delete', destructive: true });
    if (!ok) return;
    try {
      await deleteThread(scope, String(id));
      router.back();
    } catch (e: any) {
      notify('Could not delete', e?.message ?? String(e));
    }
  }

  async function removeReply(r: Reply) {
    const ok = await confirmAction({ title: 'Delete reply?', message: r.body.slice(0, 120), confirmText: 'Delete', destructive: true });
    if (ok) deleteReply(scope, String(id), r.id).catch((e) => notify('Could not delete', e.message));
  }

  async function reportIt(path: string) {
    if (!uid) return;
    const ok = await confirmAction({
      title: 'Report this?',
      message: 'It will be sent to the RideTogether team for review.',
      confirmText: 'Report',
      destructive: true,
    });
    if (!ok) return;
    report(uid, path, 'Reported from the app')
      .then(() => notify('Thanks', 'We’ll take a look.'))
      .catch((e) => notify('Could not report', e.message));
  }

  const base = scope.kind === 'club' ? `clubs/${scope.clubId}/threads/${id}` : `forum/${id}`;

  if (thread === undefined) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  if (thread === null) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>This post is no longer available</Text>
        <Pressable onPress={() => router.back()}>
          <Text style={styles.link}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top', 'bottom']}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}>
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>{scope.kind === 'club' ? 'Club board' : 'Community'}</Text>
        {thread.authorId === uid || canModerate ? (
          <Pressable onPress={removeThread} hitSlop={10}>
            <Ionicons name="trash-outline" size={22} color={colors.danger} />
          </Pressable>
        ) : (
          <Pressable onPress={() => reportIt(base)} hitSlop={10}>
            <Ionicons name="flag-outline" size={22} color={colors.textDim} />
          </Pressable>
        )}
      </View>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <FlatList
          data={replies}
          keyExtractor={(r) => r.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <View style={styles.post}>
              <Text style={styles.title}>{thread.title}</Text>
              <Text style={styles.dim}>
                {thread.authorName}
                {thread.city ? ` · ${thread.city}` : ''} · {timeAgo(thread.createdAt)}
              </Text>
              {!!thread.body && <Text style={styles.body}>{thread.body}</Text>}
              <Text style={[styles.dim, { marginTop: 8 }]}>
                {thread.replyCount} {thread.replyCount === 1 ? 'reply' : 'replies'}
              </Text>
            </View>
          }
          ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
          renderItem={({ item: r }) => (
            <Pressable
              style={styles.reply}
              onLongPress={() => (r.authorId === uid || canModerate ? removeReply(r) : reportIt(`${base}/replies/${r.id}`))}
            >
              <Text style={styles.replyAuthor}>
                {r.authorName} <Text style={styles.dim}>· {timeAgo(r.createdAt)}</Text>
              </Text>
              <Text style={styles.body}>{r.body}</Text>
            </Pressable>
          )}
        />
        <View style={styles.composer}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Write a reply"
            placeholderTextColor={colors.textDim}
            style={styles.input}
            multiline
            maxLength={5000}
          />
          <Pressable onPress={send} disabled={!draft.trim() || sending} accessibilityRole="button" accessibilityLabel="Send" style={[styles.send, !draft.trim() && { opacity: 0.4 }]}>
            <Ionicons name="arrow-up" size={20} color={colors.accentText} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: colors.bg, padding: 24 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 8 },
  headerTitle: { flex: 1, color: colors.text, fontSize: 17, fontWeight: '800' },
  list: { padding: 16, paddingBottom: 24, width: '100%', maxWidth: 720, alignSelf: 'center' },
  post: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.border, padding: 16, gap: 6, marginBottom: 14 },
  title: { color: colors.text, fontSize: 21, fontWeight: '800' },
  body: { color: colors.text, fontSize: 15, lineHeight: 21 },
  dim: { color: colors.textDim, fontSize: 12, fontWeight: '500' },
  reply: { backgroundColor: colors.surface, borderRadius: radius.md, padding: 12, gap: 4, borderWidth: 1, borderColor: colors.border },
  replyAuthor: { color: colors.text, fontWeight: '800', fontSize: 14 },
  link: { color: colors.accent, fontWeight: '700' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 10, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 120,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceHigh,
    color: colors.text,
    paddingHorizontal: 14,
    paddingTop: 11,
    paddingBottom: 11,
    fontSize: 15,
  },
  send: { width: 42, height: 42, borderRadius: 21, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
}));
