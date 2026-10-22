import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChatView } from '../../../components/ChatView';
import { initials } from '../../../components/RiderMarker';
import { Segmented } from '../../../components/Segmented';
import { ThreadList } from '../../../components/Threads';
import { Button } from '../../../components/ui';
import {
  approveRequest,
  cancelRequest,
  declineRequest,
  eventWhen,
  joinClub,
  leaveClub,
  removeMember,
  requestToJoin,
  setRole,
  subscribeClub,
  subscribeEvents,
  subscribeMembers,
  subscribeMyMembership,
  subscribeMyRequest,
  subscribeRequests,
  type Club,
  type ClubEvent,
  type ClubMember,
  type JoinRequest,
} from '../../../lib/clubs';
import { confirmAction, notify } from '../../../lib/dialog';
import { useSession } from '../../../lib/session';
import { makeStyles, radius, useTheme } from '../../../lib/theme';

type Tab = 'chat' | 'board' | 'rides' | 'members';

export default function ClubScreen() {
  const { colors } = useTheme();
  const styles = useStyles();
  const { id } = useLocalSearchParams<{ id: string }>();
  const clubId = String(id);
  const { uid, name, profile } = useSession();
  const [club, setClub] = useState<Club | null | undefined>(undefined);
  const [me, setMe] = useState<ClubMember | null>(null);
  const [pending, setPending] = useState(false);
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [tab, setTab] = useState<Tab>('chat');
  const [busy, setBusy] = useState(false);

  useEffect(() => subscribeClub(clubId, setClub, () => setClub(null)), [clubId]);
  useEffect(() => (uid ? subscribeMyMembership(clubId, uid, setMe) : undefined), [clubId, uid]);
  useEffect(() => (uid ? subscribeMyRequest(clubId, uid, setPending) : undefined), [clubId, uid]);
  const isAdmin = me?.role === 'owner' || me?.role === 'admin';
  useEffect(() => (isAdmin ? subscribeRequests(clubId, setRequests, () => {}) : undefined), [clubId, isAdmin]);

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e: any) {
      notify('Something went wrong', e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    const ok = await confirmAction({ title: `Leave ${club?.name}?`, message: 'You can join again later.', confirmText: 'Leave', destructive: true });
    if (ok && uid) act(() => leaveClub(clubId, uid));
  }

  if (club === undefined) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }
  if (club === null) {
    return (
      <View style={styles.center}>
        <Text style={styles.title}>Club not found</Text>
        <Button title="Back" variant="secondary" onPress={() => router.back()} />
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top']}>
      <View style={styles.header}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/clubs'))} hitSlop={10}>
          <Ionicons name="chevron-back" size={28} color={colors.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>{club.name}</Text>
          <Text style={styles.dim} numberOfLines={1}>
            {[club.city, `${club.memberCount} ${club.memberCount === 1 ? 'member' : 'members'}`, club.joinPolicy === 'open' ? 'Open' : 'Approval to join']
              .filter(Boolean)
              .join(' · ')}
          </Text>
        </View>
        {isAdmin && (
          <Pressable onPress={() => router.push({ pathname: '/clubs/new', params: { edit: clubId } })} hitSlop={10}>
            <Ionicons name="settings-outline" size={22} color={colors.text} />
          </Pressable>
        )}
      </View>

      {!me ? (
        <ScrollView contentContainerStyle={styles.container}>
          {!!club.description && <Text style={styles.body}>{club.description}</Text>}
          <Text style={styles.dim}>Started by {club.ownerName}</Text>
          {club.joinPolicy === 'open' ? (
            <Button title="Join club" onPress={() => uid && act(() => joinClub(club, uid, name))} loading={busy} />
          ) : pending ? (
            <>
              <View style={styles.pending}>
                <Ionicons name="time-outline" size={18} color={colors.warning} />
                <Text style={styles.body}>Request sent — an admin will review it.</Text>
              </View>
              <Button title="Cancel request" variant="ghost" onPress={() => uid && act(() => cancelRequest(clubId, uid))} loading={busy} />
            </>
          ) : (
            <Button title="Request to join" onPress={() => uid && act(() => requestToJoin(clubId, uid, name))} loading={busy} />
          )}
          <Text style={styles.dim}>Members see the club chat, discussion board and upcoming group rides.</Text>
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>
          <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
            <Segmented<Tab>
              options={[
                { value: 'chat', label: 'Chat' },
                { value: 'board', label: 'Board' },
                { value: 'rides', label: 'Rides' },
                { value: 'members', label: 'Members', badge: isAdmin ? requests.length : 0 },
              ]}
              value={tab}
              onChange={setTab}
            />
          </View>
          {tab === 'chat' && uid && <ChatView clubId={clubId} uid={uid} name={name} canModerate={isAdmin} />}
          {tab === 'board' && uid && (
            <ThreadList scope={{ kind: 'club', clubId }} uid={uid} name={name} city={profile?.city ?? club.city} />
          )}
          {tab === 'rides' && <RidesTab clubId={clubId} isAdmin={isAdmin} />}
          {tab === 'members' && uid && (
            <MembersTab club={club} me={me} uid={uid} requests={requests} onLeave={leave} />
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

function RidesTab({ clubId, isAdmin }: { clubId: string; isAdmin: boolean }) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [events, setEvents] = useState<ClubEvent[] | null>(null);
  useEffect(() => subscribeEvents(clubId, setEvents, (e) => notify('Rides unavailable', e.message)), [clubId]);

  return (
    <FlatList
      data={events ?? []}
      keyExtractor={(e) => e.id}
      contentContainerStyle={styles.container}
      ListHeaderComponent={
        isAdmin ? (
          <Button
            title="Plan a group ride"
            onPress={() => router.push({ pathname: '/clubs/[id]/new-event', params: { id: clubId } })}
            icon={<Ionicons name="calendar-outline" size={18} color={colors.accentText} />}
          />
        ) : null
      }
      ListEmptyComponent={
        events ? <Text style={[styles.dim, { textAlign: 'center', marginTop: 20 }]}>No upcoming rides yet.</Text> : null
      }
      ItemSeparatorComponent={() => <View style={{ height: 10 }} />}
      renderItem={({ item: e }) => (
        <Pressable
          style={[styles.card, e.status === 'live' && { borderColor: colors.ok, borderWidth: 2 }]}
          onPress={() => router.push({ pathname: '/clubs/[id]/event/[eventId]', params: { id: clubId, eventId: e.id } })}
        >
          <View style={styles.dateBox}>
            <Text style={styles.dateDay}>{new Date(e.startAt).getDate()}</Text>
            <Text style={styles.dateMon}>{new Date(e.startAt).toLocaleDateString([], { month: 'short' }).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={styles.name} numberOfLines={1}>{e.title}</Text>
            <Text style={styles.dim} numberOfLines={1}>
              {eventWhen(e.startAt)}
              {e.destination ? ` · to ${e.destination.name}` : ''}
            </Text>
            <Text style={[styles.dim, e.status === 'live' && { color: colors.ok, fontWeight: '800' }]}>
              {e.status === 'live' ? '● Live now — tap to join' : `${e.rsvpCount} going`}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.textDim} />
        </Pressable>
      )}
    />
  );
}

function MembersTab({
  club,
  me,
  uid,
  requests,
  onLeave,
}: {
  club: Club;
  me: ClubMember;
  uid: string;
  requests: JoinRequest[];
  onLeave: () => void;
}) {
  const { colors } = useTheme();
  const styles = useStyles();
  const [members, setMembers] = useState<ClubMember[] | null>(null);
  useEffect(() => subscribeMembers(club.id, setMembers, (e) => notify('Members unavailable', e.message)), [club.id]);
  const isOwner = me.role === 'owner';
  const isAdmin = isOwner || me.role === 'admin';

  async function manage(m: ClubMember) {
    if (m.uid === uid || m.role === 'owner') return;
    if (isOwner) {
      const promote = m.role === 'member';
      const ok = await confirmAction({
        title: m.name,
        message: promote ? 'Make them an admin? Admins approve members, schedule rides and moderate.' : 'Remove their admin role?',
        confirmText: promote ? 'Make admin' : 'Make member',
      });
      if (ok) return setRole(club.id, m.uid, promote ? 'admin' : 'member').catch((e) => notify('Failed', e.message));
    }
    if (isAdmin && (isOwner || m.role === 'member')) {
      const ok = await confirmAction({ title: `Remove ${m.name}?`, message: 'They can request to join again.', confirmText: 'Remove', destructive: true });
      if (ok) removeMember(club.id, m.uid).catch((e) => notify('Failed', e.message));
    }
  }

  return (
    <FlatList
      data={members ?? []}
      keyExtractor={(m) => m.uid}
      contentContainerStyle={styles.container}
      ListHeaderComponent={
        <View style={{ gap: 10, marginBottom: 6 }}>
          {isAdmin && requests.length > 0 && (
            <View style={styles.requests}>
              <Text style={styles.section}>Join requests</Text>
              {requests.map((r) => (
                <View key={r.uid} style={styles.requestRow}>
                  <Text style={[styles.name, { flex: 1 }]} numberOfLines={1}>{r.name}</Text>
                  <Pressable style={[styles.smallBtn, { backgroundColor: colors.ok }]} onPress={() => approveRequest(club, r).catch((e) => notify('Failed', e.message))}>
                    <Text style={styles.smallBtnText}>Accept</Text>
                  </Pressable>
                  <Pressable style={[styles.smallBtn, { backgroundColor: colors.surfaceHigh }]} onPress={() => declineRequest(club.id, r.uid).catch((e) => notify('Failed', e.message))}>
                    <Text style={[styles.smallBtnText, { color: colors.text }]}>Decline</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          )}
          {isAdmin && <Text style={styles.dim}>Tap a member to {isOwner ? 'change their role or remove them' : 'remove them'}.</Text>}
        </View>
      }
      ListFooterComponent={me.role !== 'owner' ? <Button title="Leave club" variant="ghost" onPress={onLeave} style={{ marginTop: 16 }} /> : null}
      ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
      renderItem={({ item: m }) => (
        <Pressable style={styles.memberRow} onPress={() => isAdmin && manage(m)}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{initials(m.name)}</Text>
          </View>
          <Text style={[styles.name, { flex: 1 }]} numberOfLines={1}>
            {m.name}
            {m.uid === uid ? ' (you)' : ''}
          </Text>
          {m.role !== 'member' && (
            <View style={[styles.roleTag, m.role === 'owner' && { backgroundColor: colors.accent }]}>
              <Text style={[styles.roleText, m.role === 'owner' && { color: colors.accentText }]}>{m.role === 'owner' ? 'Owner' : 'Admin'}</Text>
            </View>
          )}
        </Pressable>
      )}
    />
  );
}

const useStyles = makeStyles((colors) => ({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: colors.bg, padding: 24 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 8 },
  title: { color: colors.text, fontSize: 21, fontWeight: '800' },
  container: { padding: 16, gap: 12, paddingBottom: 40, width: '100%', maxWidth: 720, alignSelf: 'center' },
  body: { color: colors.text, fontSize: 15, lineHeight: 21, flexShrink: 1 },
  dim: { color: colors.textDim, fontSize: 13 },
  section: { color: colors.text, fontSize: 16, fontWeight: '800' },
  pending: { flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: colors.surface, borderRadius: radius.md, padding: 12 },
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
  dateBox: { width: 48, alignItems: 'center', backgroundColor: colors.surfaceHigh, borderRadius: radius.sm, paddingVertical: 6 },
  dateDay: { color: colors.text, fontSize: 20, fontWeight: '900' },
  dateMon: { color: colors.accent, fontSize: 11, fontWeight: '800' },
  name: { color: colors.text, fontSize: 16, fontWeight: '800' },
  requests: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 2, borderColor: colors.warning, padding: 14, gap: 10 },
  requestRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  smallBtn: { borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 8 },
  smallBtnText: { color: '#FFFFFF', fontWeight: '800' },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surface, borderRadius: radius.md, padding: 12 },
  avatar: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.surfaceHigh, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: colors.text, fontWeight: '800', fontSize: 13 },
  roleTag: { backgroundColor: colors.surfaceHigh, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  roleText: { color: colors.text, fontSize: 11, fontWeight: '800' },
}));
