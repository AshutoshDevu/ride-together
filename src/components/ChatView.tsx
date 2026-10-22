import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { FlatList, KeyboardAvoidingView, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { deleteMessage, sendMessage, subscribeChat, type ChatMessage } from '../lib/clubs';
import { confirmAction, notify } from '../lib/dialog';
import { timeAgo } from '../lib/forum';
import { makeStyles, radius, useTheme } from '../lib/theme';
import { initials } from './RiderMarker';

const PAGE = 40;

/** Club chat: newest at the bottom, long-press your own message (or any, as an admin) to delete. */
export function ChatView({ clubId, uid, name, canModerate }: { clubId: string; uid: string; name: string; canModerate: boolean }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [max, setMax] = useState(PAGE);
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => subscribeChat(clubId, max, setMessages, (e) => notify('Chat unavailable', e.message)), [clubId, max]);

  async function send() {
    const t = draft.trim();
    if (!t) return;
    setSending(true);
    setDraft('');
    try {
      await sendMessage(clubId, uid, name, t);
    } catch (e: any) {
      setDraft(t);
      notify('Not sent', e?.message ?? String(e));
    } finally {
      setSending(false);
    }
  }

  async function remove(m: ChatMessage) {
    if (m.uid !== uid && !canModerate) return;
    const ok = await confirmAction({ title: 'Delete message?', message: m.text.slice(0, 120), confirmText: 'Delete', destructive: true });
    if (ok) deleteMessage(clubId, m.id).catch((e) => notify('Could not delete', e.message));
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      <FlatList
        inverted
        data={messages ?? []}
        keyExtractor={(m) => m.id}
        contentContainerStyle={{ padding: 12, gap: 8 }}
        onEndReached={() => messages && messages.length >= max && setMax((m) => m + PAGE)}
        onEndReachedThreshold={0.3}
        ListEmptyComponent={
          messages ? <Text style={[styles.dim, { textAlign: 'center', marginTop: 20 }]}>Say hi to the club 👋</Text> : null
        }
        renderItem={({ item: m }) => {
          const mine = m.uid === uid;
          return (
            <Pressable onLongPress={() => remove(m)} style={[styles.msgRow, mine && { justifyContent: 'flex-end' }]}>
              {!mine && (
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{initials(m.name)}</Text>
                </View>
              )}
              <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
                {!mine && <Text style={styles.author}>{m.name}</Text>}
                <Text style={[styles.text, mine && { color: colors.accentText }]}>{m.text}</Text>
                <Text style={[styles.time, mine && { color: colors.accentText, opacity: 0.75 }]}>{timeAgo(m.createdAt)}</Text>
              </View>
            </Pressable>
          );
        }}
      />
      <View style={styles.composer}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder="Message the club"
          placeholderTextColor={colors.textDim}
          style={styles.input}
          multiline
          maxLength={1000}
          onSubmitEditing={send}
          blurOnSubmit={false}
        />
        <Pressable onPress={send} disabled={!draft.trim() || sending} accessibilityRole="button" accessibilityLabel="Send" style={[styles.send, !draft.trim() && { opacity: 0.4 }]}>
          <Ionicons name="arrow-up" size={20} color={colors.accentText} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const useStyles = makeStyles((colors) => ({
  dim: { color: colors.textDim },
  msgRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  avatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.surfaceHigh, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.text, fontSize: 10, fontWeight: '800' },
  bubble: { maxWidth: '78%', borderRadius: 18, paddingHorizontal: 12, paddingVertical: 8, gap: 2 },
  mine: { backgroundColor: colors.accent, borderBottomRightRadius: 6 },
  theirs: { backgroundColor: colors.surface, borderBottomLeftRadius: 6, borderWidth: 1, borderColor: colors.border },
  author: { color: colors.accent, fontSize: 12, fontWeight: '800' },
  text: { color: colors.text, fontSize: 15, lineHeight: 20 },
  time: { color: colors.textDim, fontSize: 10, alignSelf: 'flex-end' },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
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
