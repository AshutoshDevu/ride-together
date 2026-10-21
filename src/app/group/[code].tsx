import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { router, useLocalSearchParams } from 'expo-router';
import { onValue, ref } from 'firebase/database';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import MapView, { PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { RiderList, type RiderRow } from '../../components/RiderList';
import { RiderMarker } from '../../components/RiderMarker';
import { Button } from '../../components/ui';
import { confirmAction, notify } from '../../lib/dialog';
import { db } from '../../lib/firebase';
import { distanceMeters, formatDistance, type LatLng } from '../../lib/geo';
import {
  endRide,
  inviteLink,
  isMember,
  leaveGroup,
  normalizeCode,
  setRiderStatus,
  shareInvite,
  shareToWhatsApp,
  subscribeGroup,
  type GroupMeta,
  type Rider,
  type RiderStatus,
} from '../../lib/groups';
import { useSession } from '../../lib/session';
import { setActiveGroup } from '../../lib/storage';
import { colors, radius } from '../../lib/theme';
import { backgroundHint, startTracking, stopTracking, type TrackingMode } from '../../lib/tracking';

const STALE_AFTER_MS = 2 * 60 * 1000;
const LABELS_MAX_DELTA = 0.6; // hide name tags when zoomed far out (big groups get cluttered)

type Sharing = 'starting' | TrackingMode | 'paused' | 'error';

const IS_WEB = Platform.OS === 'web';

export default function GroupMap() {
  const params = useLocalSearchParams<{ code: string; invite?: string }>();
  const code = normalizeCode(String(params.code ?? ''));
  const { uid } = useSession();
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);

  const [meta, setMeta] = useState<GroupMeta | null>(null);
  const [riders, setRiders] = useState<Rider[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [myPos, setMyPos] = useState<LatLng | null>(null);
  const [sharing, setSharing] = useState<Sharing>('starting');
  const [showList, setShowList] = useState(false);
  const [showInvite, setShowInvite] = useState(params.invite === '1');
  const [keepAwake, setKeepAwake] = useState(false);
  const [serverOffset, setServerOffset] = useState(0);
  const [tick, setTick] = useState(Date.now());
  const [labels, setLabels] = useState(true);
  const didFit = useRef(false);

  const now = tick + serverOffset;
  const groupName = meta?.name ?? 'Group ride';

  // --- membership guard + live subscription ---
  useEffect(() => {
    if (!uid || !code) return;
    let unsub: (() => void) | undefined;
    let cancelled = false;
    (async () => {
      if (!(await isMember(code, uid))) {
        router.replace({ pathname: '/join/[code]', params: { code } });
        return;
      }
      if (cancelled) return;
      await setActiveGroup(code);
      unsub = subscribeGroup(
        code,
        ({ meta, riders }) => {
          setMeta(meta);
          setRiders(riders);
          setLoaded(true);
        },
        (e) => notify('Connection problem', e.message),
      );
    })();
    const offUnsub = onValue(ref(db, '.info/serverTimeOffset'), (s) => setServerOffset(s.val() ?? 0));
    const t = setInterval(() => setTick(Date.now()), 10_000);
    return () => {
      cancelled = true;
      unsub?.();
      offUnsub();
      clearInterval(t);
    };
  }, [uid, code]);

  // If I was removed from the group (left on another device), go home
  useEffect(() => {
    if (loaded && uid && riders.length && !riders.some((r) => r.uid === uid)) {
      stopTracking();
      setActiveGroup(null);
      router.replace('/');
    }
  }, [loaded, riders, uid]);

  // --- start sharing my location once the group is loaded ---
  const start = useCallback(async () => {
    setSharing('starting');
    try {
      const mode = await startTracking(groupName);
      setSharing(mode);
    } catch (e: any) {
      setSharing('error');
      if (IS_WEB) return notify('Location needed', 'Allow location for this site in your browser to share your position.');
      Alert.alert('Location needed', e?.message ?? String(e), [
        { text: 'Open settings', onPress: () => Linking.openSettings() },
        { text: 'OK' },
      ]);
    }
  }, [groupName]);

  const startedOnce = useRef(false);
  useEffect(() => {
    if (meta && !meta.endedAt && !startedOnce.current) {
      startedOnce.current = true;
      start();
    }
  }, [meta, start]);

  useEffect(() => {
    // Only release the lock we actually took — deactivating an inactive tag throws
    if (!keepAwake) return;
    activateKeepAwakeAsync('ride');
    return () => {
      Promise.resolve()
        .then(() => deactivateKeepAwake('ride'))
        .catch(() => {});
    };
  }, [keepAwake]);

  // --- leader ended the ride → stop sharing everywhere ---
  const ended = !!meta?.endedAt;
  useEffect(() => {
    if (!ended) return;
    stopTracking();
    setActiveGroup(null);
    setSharing('paused');
    setKeepAwake(false);
  }, [ended]);

  // --- derived data ---
  const me = riders.find((r) => r.uid === uid);
  const myStatus: RiderStatus = me?.loc?.status ?? 'ok';

  const rows: RiderRow[] = useMemo(() => {
    const list = riders.map((r) => ({
      ...r,
      stale: !!r.loc && now - r.loc.ts > STALE_AFTER_MS,
      distance:
        myPos && r.loc ? distanceMeters(myPos, { latitude: r.loc.lat, longitude: r.loc.lng }) : null,
    }));
    return list.sort((a, b) => {
      if (a.uid === uid) return -1;
      if (b.uid === uid) return 1;
      if (!a.loc !== !b.loc) return a.loc ? -1 : 1;
      return (a.distance ?? Infinity) - (b.distance ?? Infinity);
    });
  }, [riders, myPos, now, uid]);

  const located = rows.filter((r) => r.loc && !r.stale);
  const alerts = rows.filter((r) => r.loc && r.loc.status && r.loc.status !== 'ok');

  /** Distance between the two riders furthest apart — "how stretched is the group?" */
  const spread = useMemo(() => {
    let max = 0;
    for (let i = 0; i < located.length; i++)
      for (let j = i + 1; j < located.length; j++) {
        const a = located[i].loc!, b = located[j].loc!;
        max = Math.max(max, distanceMeters({ latitude: a.lat, longitude: a.lng }, { latitude: b.lat, longitude: b.lng }));
      }
    return max;
  }, [located]);

  // --- map actions ---
  const fitAll = useCallback(() => {
    const coords = rows
      .filter((r) => r.loc)
      .map((r) => ({ latitude: r.loc!.lat, longitude: r.loc!.lng }));
    if (myPos) coords.push(myPos);
    if (!coords.length) return;
    if (coords.length === 1) {
      mapRef.current?.animateToRegion({ ...coords[0], latitudeDelta: 0.02, longitudeDelta: 0.02 }, 400);
      return;
    }
    mapRef.current?.fitToCoordinates(coords, {
      edgePadding: { top: 160, right: 60, bottom: 220, left: 60 },
      animated: true,
    });
  }, [rows, myPos]);

  useEffect(() => {
    if (!didFit.current && rows.some((r) => r.loc)) {
      didFit.current = true;
      setTimeout(fitAll, 400);
    }
  }, [rows, fitAll]);

  const focusRider = useCallback((r: Rider) => {
    if (!r.loc) return;
    setShowList(false);
    mapRef.current?.animateToRegion(
      { latitude: r.loc.lat, longitude: r.loc.lng, latitudeDelta: 0.01, longitudeDelta: 0.01 },
      500,
    );
  }, []);

  const centerMe = () => {
    if (myPos) mapRef.current?.animateToRegion({ ...myPos, latitudeDelta: 0.01, longitudeDelta: 0.01 }, 400);
  };

  async function toggleSharing() {
    if (sharing === 'background' || sharing === 'foreground') {
      await stopTracking();
      setSharing('paused');
    } else {
      await start();
    }
  }

  async function setStatus(s: RiderStatus) {
    if (!uid) return;
    try {
      await setRiderStatus(code, uid, s);
    } catch (e: any) {
      notify('Could not update', e?.message ?? String(e));
    }
  }

  async function confirmSos() {
    if (myStatus === 'sos') return setStatus('ok');
    const ok = await confirmAction({
      title: 'Send SOS?',
      message: 'Every rider in the group will see a red SOS marker at your location.',
      confirmText: 'Send SOS',
      destructive: true,
    });
    if (ok) setStatus('sos');
  }

  async function confirmLeave() {
    const ok = await confirmAction({
      title: 'Leave ride?',
      message: 'You will stop sharing your location and disappear from the group map.',
      confirmText: 'Leave',
      destructive: true,
    });
    if (!ok) return;
    await stopTracking();
    if (uid) await leaveGroup(code, uid).catch(() => {});
    await setActiveGroup(null);
    router.replace('/');
  }

  async function confirmEnd() {
    const ok = await confirmAction({
      title: 'End ride for everyone?',
      message: 'Location sharing stops on every rider\'s phone and nobody can join with this code any more.',
      confirmText: 'End ride',
      destructive: true,
    });
    if (!ok) return;
    setShowInvite(false);
    try {
      await endRide(code);
    } catch (e: any) {
      notify('Could not end the ride', e?.message ?? String(e));
    }
  }

  const onRegion = (r: Region) => setLabels(r.latitudeDelta < LABELS_MAX_DELTA || riders.length <= 15);

  const isLeader = !!uid && uid === meta?.createdBy;

  if (ended) {
    return (
      <View style={styles.center}>
        <Text style={{ fontSize: 48 }}>🏁</Text>
        <Text style={styles.endedTitle}>Ride ended</Text>
        <Text style={styles.endedText}>
          {isLeader ? 'You ended' : 'The leader ended'} "{groupName}". Location sharing has stopped.
        </Text>
        <Button title="Back home" onPress={() => router.replace('/')} style={{ alignSelf: 'stretch' }} />
      </View>
    );
  }

  if (!loaded) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} size="large" />
        <Text style={{ color: colors.textDim, marginTop: 12 }}>Loading ride {code}…</Text>
      </View>
    );
  }

  const sharingLabel =
    sharing === 'background' ? 'Sharing · background'
    : sharing === 'foreground' ? (IS_WEB ? 'Sharing · keep this tab open' : 'Sharing · app open only')
    : sharing === 'starting' ? 'Starting GPS…'
    : sharing === 'paused' ? 'Paused — tap to share'
    : 'Location off — tap to retry';
  const sharingOn = sharing === 'background' || sharing === 'foreground';

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <MapView
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        provider={PROVIDER_GOOGLE}
        showsUserLocation
        showsMyLocationButton={false}
        showsCompass
        toolbarEnabled={false}
        onUserLocationChange={(e) => {
          const c = e.nativeEvent.coordinate;
          if (c) setMyPos({ latitude: c.latitude, longitude: c.longitude });
        }}
        onRegionChangeComplete={onRegion}
        mapPadding={{ top: insets.top + 110, right: 0, bottom: 150, left: 0 }}
      >
        {rows
          .filter((r) => r.uid !== uid) // you are the native blue dot
          .map((r) => (
            <RiderMarker
              key={r.uid}
              rider={r}
              stale={r.stale}
              isLeader={r.uid === meta?.createdBy}
              isMe={false}
              showLabel={labels}
              onPress={focusRider}
            />
          ))}
      </MapView>

      {/* Top bar */}
      <SafeAreaView edges={['top']} style={styles.topWrap} pointerEvents="box-none">
        <View style={styles.topBar}>
          <Pressable onPress={() => router.navigate('/')} hitSlop={10} style={styles.iconBtn}>
            <Text style={styles.iconText}>‹</Text>
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={styles.groupName} numberOfLines={1}>{groupName}</Text>
            <Text style={styles.groupSub}>
              {located.length}/{riders.length} live · code {code}
              {spread > 0 ? ` · spread ${formatDistance(spread)}` : ''}
            </Text>
          </View>
          <Pressable onPress={() => setShowInvite(true)} style={styles.inviteBtn}>
            <Text style={styles.inviteText}>+ Invite</Text>
          </Pressable>
        </View>

        {alerts.map((r) => (
          <Pressable
            key={r.uid}
            onPress={() => focusRider(r)}
            style={[styles.alert, { backgroundColor: r.loc!.status === 'sos' ? colors.danger : colors.warning }]}
          >
            <Text style={styles.alertText}>
              {r.loc!.status === 'sos' ? '🆘' : '✋'} {r.uid === uid ? 'You' : r.name}{' '}
              {r.loc!.status === 'sos' ? 'needs help' : 'needs a stop'}
              {r.distance != null && r.uid !== uid ? ` · ${formatDistance(r.distance)} away` : ''} — tap to view
            </Text>
          </Pressable>
        ))}
      </SafeAreaView>

      {/* Map buttons */}
      <View style={[styles.fabs, { bottom: (showList ? 420 : 170) + insets.bottom }]}>
        <Pressable style={styles.fab} onPress={fitAll}>
          <Text style={styles.fabText}>⤢</Text>
          <Text style={styles.fabLabel}>All</Text>
        </Pressable>
        <Pressable style={styles.fab} onPress={centerMe}>
          <Text style={styles.fabText}>◎</Text>
          <Text style={styles.fabLabel}>Me</Text>
        </Pressable>
        <Pressable style={[styles.fab, keepAwake && { backgroundColor: colors.accent }]} onPress={() => setKeepAwake((k) => !k)}>
          <Text style={[styles.fabText, keepAwake && { color: colors.accentText }]}>☀︎</Text>
          <Text style={[styles.fabLabel, keepAwake && { color: colors.accentText }]}>Screen</Text>
        </Pressable>
      </View>

      {/* Bottom sheet */}
      <View style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
        <Pressable onPress={() => setShowList((s) => !s)} style={styles.sheetHandle}>
          <View style={styles.grabber} />
          <Text style={styles.sheetTitle}>
            {showList ? 'Hide riders' : `Riders (${riders.length})`} {showList ? '▾' : '▴'}
          </Text>
        </Pressable>

        {showList && <RiderList rows={rows} me={uid} leaderUid={meta?.createdBy} now={now} onSelect={focusRider} />}
        {showList && (
          <Pressable onPress={isLeader ? confirmEnd : confirmLeave} style={styles.endBtn}>
            <Text style={styles.endText}>{isLeader ? '🏁 End ride for everyone' : 'Leave ride'}</Text>
          </Pressable>
        )}

        <View style={styles.actions}>
          <Pressable
            onPress={toggleSharing}
            style={[styles.shareChip, { borderColor: sharingOn ? colors.ok : colors.warning }]}
          >
            <View style={[styles.liveDot, { backgroundColor: sharingOn ? colors.ok : colors.warning }]} />
            <Text style={styles.shareChipText} numberOfLines={1}>{sharingLabel}</Text>
          </Pressable>
          <Pressable
            onPress={() => setStatus(myStatus === 'stop' ? 'ok' : 'stop')}
            style={[styles.statusBtn, myStatus === 'stop' && { backgroundColor: colors.warning }]}
          >
            <Text style={[styles.statusText, myStatus === 'stop' && { color: colors.accentText }]}>
              {myStatus === 'stop' ? 'Cancel stop' : '✋ Stop'}
            </Text>
          </Pressable>
          <Pressable onPress={confirmSos} style={[styles.statusBtn, { backgroundColor: colors.danger }]}>
            <Text style={[styles.statusText, { color: '#fff' }]}>{myStatus === 'sos' ? "I'm OK" : 'SOS'}</Text>
          </Pressable>
        </View>
        {sharing === 'foreground' && !IS_WEB && <Text style={styles.hint}>{backgroundHint}</Text>}
      </View>

      {/* Invite modal */}
      <Modal visible={showInvite} transparent animationType="slide" onRequestClose={() => setShowInvite(false)}>
        <Pressable style={styles.backdrop} onPress={() => setShowInvite(false)}>
          <Pressable style={[styles.modal, { paddingBottom: insets.bottom + 20 }]} onPress={() => {}}>
            <Text style={styles.modalKicker}>INVITE RIDERS</Text>
            <Text style={styles.modalTitle}>{groupName}</Text>
            <Text style={styles.code}>{code}</Text>
            <Text style={styles.link} selectable>{inviteLink(code)}</Text>
            <Button title="Share on WhatsApp" onPress={() => shareToWhatsApp(code, groupName)} style={{ backgroundColor: '#25D366' }} />
            <Button title="More share options" variant="secondary" onPress={() => shareInvite(code, groupName)} />
            {isLeader ? (
              <Button title="End ride for everyone" variant="danger" onPress={confirmEnd} />
            ) : (
              <Button title="Leave ride" variant="ghost" onPress={() => { setShowInvite(false); confirmLeave(); }} />
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const shadow = {
  shadowColor: '#000',
  shadowOpacity: 0.35,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 4 },
  elevation: 8,
};

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, padding: 24, gap: 10 },
  endedTitle: { color: colors.text, fontSize: 26, fontWeight: '800' },
  endedText: { color: colors.textDim, fontSize: 15, textAlign: 'center', marginBottom: 12 },
  endBtn: { alignItems: 'center', paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.border },
  endText: { color: colors.danger, fontWeight: '800', fontSize: 15 },
  topWrap: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 12, gap: 8 },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: 10,
    marginTop: 6,
    ...shadow,
  },
  iconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  iconText: { color: colors.text, fontSize: 30, marginTop: -4 },
  groupName: { color: colors.text, fontSize: 17, fontWeight: '800' },
  groupSub: { color: colors.textDim, fontSize: 12, marginTop: 1 },
  inviteBtn: { backgroundColor: colors.accent, paddingHorizontal: 12, paddingVertical: 9, borderRadius: radius.sm },
  inviteText: { color: colors.accentText, fontWeight: '800' },
  alert: { borderRadius: radius.md, padding: 12, ...shadow },
  alertText: { color: '#0E0F12', fontWeight: '800', fontSize: 15 },
  fabs: { position: 'absolute', right: 12, gap: 10 },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow,
  },
  fabText: { color: colors.text, fontSize: 20, fontWeight: '700' },
  fabLabel: { color: colors.textDim, fontSize: 9, fontWeight: '700' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    paddingHorizontal: 16,
    ...shadow,
  },
  sheetHandle: { alignItems: 'center', paddingTop: 8, paddingBottom: 8, gap: 6 },
  grabber: { width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border },
  sheetTitle: { color: colors.text, fontWeight: '700', fontSize: 15 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 8 },
  shareChip: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1.5,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    minHeight: 52,
  },
  liveDot: { width: 10, height: 10, borderRadius: 5 },
  shareChipText: { color: colors.text, fontWeight: '700', fontSize: 13, flexShrink: 1 },
  statusBtn: {
    minHeight: 52,
    paddingHorizontal: 14,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusText: { color: colors.text, fontWeight: '800', fontSize: 15 },
  hint: { color: colors.warning, fontSize: 12, marginTop: 8 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  modal: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: 22,
    gap: 12,
  },
  modalKicker: { color: colors.accent, fontWeight: '800', letterSpacing: 1, fontSize: 12 },
  modalTitle: { color: colors.text, fontWeight: '800', fontSize: 24 },
  code: { color: colors.text, fontSize: 44, fontWeight: '900', letterSpacing: 10, textAlign: 'center', marginVertical: 6 },
  link: { color: colors.textDim, textAlign: 'center', fontSize: 13, marginBottom: 6 },
});
