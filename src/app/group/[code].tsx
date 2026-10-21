import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { router, useLocalSearchParams } from 'expo-router';
import { onValue, ref } from 'firebase/database';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Modal, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { DestinationPicker } from '../../components/DestinationPicker';
import { Glass } from '../../components/Glass';
import { NavGroupStrip, type GroupStripItem } from '../../components/NavGroupStrip';
import { NavBanner, NavFooter } from '../../components/NavigationHUD';
import { RiderList, type RiderRow } from '../../components/RiderList';
import { freshnessOf, RiderMarker } from '../../components/RiderMarker';
import { Button } from '../../components/ui';
import { playSignalLost } from '../../lib/alerts';
import { declutter } from '../../lib/declutter';
import { finalizeRide, type RideRecord } from '../../lib/history';
import { confirmAction, notify } from '../../lib/dialog';
import { db } from '../../lib/firebase';
import { distanceMeters, formatDistance, type LatLng } from '../../lib/geo';
import {
  clearDestination,
  endRide,
  inviteLink,
  isMember,
  leaveGroup,
  normalizeCode,
  setDestination,
  setRiderStatus,
  shareInvite,
  shareToWhatsApp,
  subscribeGroup,
  type Destination,
  type GroupMeta,
  type Rider,
  type RiderStatus,
} from '../../lib/groups';
import { useSession } from '../../lib/session';
import { gapAlongRoute, getCurrentFix, navZoom, useTurnByTurn, type Fix } from '../../lib/navigation';
import { computeTwoWheelerRoute, decodePolyline, formatDuration, type PlaceResult } from '../../lib/places';
import { mapStyleFor } from '../../lib/mapStyles';
import { getAlertsMuted, setActiveGroup, setAlertsMuted } from '../../lib/storage';
import { makeStyles, radius, useTheme } from '../../lib/theme';
import { backgroundHint, startTracking, stopTracking, type TrackingMode } from '../../lib/tracking';

const LABELS_MAX_DELTA = 0.6; // hide name tags when zoomed far out (big groups get cluttered)

type Sharing = 'starting' | TrackingMode | 'paused' | 'error';

const IS_WEB = Platform.OS === 'web';

export default function GroupMap() {
  const { colors, scheme } = useTheme();
  const styles = useStyles();
  const params = useLocalSearchParams<{ code: string; invite?: string }>();
  const code = normalizeCode(String(params.code ?? ''));
  const { uid } = useSession();
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapView>(null);

  const [meta, setMeta] = useState<GroupMeta | null>(null);
  const [riders, setRiders] = useState<Rider[]>([]);
  const [destination, setDest] = useState<Destination | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [settingDest, setSettingDest] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [myPos, setMyPos] = useState<LatLng | null>(null);
  const [myFix, setMyFix] = useState<Fix | null>(null);
  const [navActive, setNavActive] = useState(false);
  const [follow, setFollow] = useState(true);
  const [voice, setVoice] = useState(true);
  const [lostAlerts, setLostAlerts] = useState<{ uid: string; name: string }[]>([]);
  const [muted, setMuted] = useState(false);
  const [sharing, setSharing] = useState<Sharing>('starting');
  const [showList, setShowList] = useState(false);
  const [showInvite, setShowInvite] = useState(params.invite === '1');
  const [keepAwake, setKeepAwake] = useState(false);
  const [serverOffset, setServerOffset] = useState(0);
  const [tick, setTick] = useState(Date.now());
  const [labels, setLabels] = useState(true);
  const [lngDelta, setLngDelta] = useState<number | null>(null);
  const { width: screenW } = useWindowDimensions();
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
        ({ meta, riders, destination }) => {
          setMeta(meta);
          setRiders(riders);
          setDest(destination);
          setLoaded(true);
        },
        (e) => notify('Connection problem', e.message),
      );
    })();
    const offUnsub = onValue(ref(db, '.info/serverTimeOffset'), (s) => setServerOffset(s.val() ?? 0));
    const t = setInterval(() => setTick(Date.now()), 5_000);
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
    if (!keepAwake && !navActive) return;
    // Browsers may refuse the wake lock (e.g. battery saver) — not worth an error
    activateKeepAwakeAsync('ride').catch(() => {});
    return () => {
      Promise.resolve()
        .then(() => deactivateKeepAwake('ride'))
        .catch(() => {});
    };
  }, [keepAwake, navActive]);

  // --- leader ended the ride → stop sharing everywhere, save it to my history ---
  const ended = !!meta?.endedAt;
  const [saved, setSaved] = useState<RideRecord | null | 'saving'>(null);
  useEffect(() => {
    if (!ended) return;
    stopTracking();
    setActiveGroup(null);
    setSharing('paused');
    setKeepAwake(false);
    if (uid) {
      setSaved('saving');
      finalizeRide(code, uid)
        .then(setSaved)
        .catch(() => setSaved(null));
    }
  }, [ended, uid, code]);

  // --- derived data ---
  const me = riders.find((r) => r.uid === uid);
  const isLeader = !!uid && uid === meta?.createdBy;
  const routeCoords = useMemo(
    () => (destination?.polyline ? decodePolyline(destination.polyline) : null),
    [destination?.polyline],
  );

  // --- in-app turn-by-turn: each rider from their own position to the shared destination ---
  const nav = useTurnByTurn({ active: navActive, destination, fix: myFix, voice });
  const navCoords = useMemo(() => nav.route?.steps.flatMap((st) => st.points) ?? null, [nav.route]);
  const lastHeading = useRef(0);
  useEffect(() => {
    if (!navActive || !follow || !myFix) return;
    // GPS heading is noise when standing still — keep the last good one
    if (myFix.heading != null && myFix.heading >= 0 && (myFix.speed ?? 0) > 1.5) lastHeading.current = myFix.heading;
    mapRef.current?.animateCamera(
      {
        center: { latitude: myFix.latitude, longitude: myFix.longitude },
        heading: lastHeading.current,
        pitch: 45,
        zoom: navZoom(myFix.speed),
      },
      { duration: 800 },
    );
  }, [navActive, follow, myFix]);
  // Leader removed the destination → stop navigating
  useEffect(() => {
    if (!destination) setNavActive(false);
  }, [destination]);
  const myStatus: RiderStatus = me?.loc?.status ?? 'ok';

  const rows: RiderRow[] = useMemo(() => {
    const list = riders.map((r) => ({
      ...r,
      freshness: freshnessOf(r.loc?.ts, now),
      stale: !!r.loc && freshnessOf(r.loc.ts, now) === 'lost',
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

  // Fan out riders whose markers would overlap at this zoom (positions only change on screen)
  const displayPos = useMemo(() => {
    const pts = rows
      .filter((r) => r.uid !== uid && r.loc)
      .map((r) => ({ id: r.uid, lat: r.loc!.lat, lng: r.loc!.lng }));
    return declutter(pts, lngDelta ? screenW / lngDelta : NaN);
  }, [rows, uid, lngDelta, screenW]);

  // --- signal lost: a rider's live light turns red → beep once + banner ---
  useEffect(() => {
    getAlertsMuted().then(setMuted);
  }, []);
  const prevFreshness = useRef(new Map<string, string>());
  useEffect(() => {
    const prev = prevFreshness.current;
    for (const r of rows) {
      if (r.uid === uid || !r.loc) continue;
      const before = prev.get(r.uid);
      prev.set(r.uid, r.freshness);
      if (before && before !== 'lost' && r.freshness === 'lost') {
        setLostAlerts((a) => [...a.filter((x) => x.uid !== r.uid), { uid: r.uid, name: r.name }]);
        if (!muted) playSignalLost();
      } else if (before === 'lost' && r.freshness !== 'lost') {
        setLostAlerts((a) => a.filter((x) => x.uid !== r.uid)); // back online
      }
    }
  }, [rows, uid, muted]);

  // Where everyone is relative to me along my route — most riders are off-screen when zoomed in
  const groupStrip: GroupStripItem[] = useMemo(() => {
    if (!navActive || !nav.route || !nav.progress) return [];
    const route = nav.route, me = nav.progress;
    return rows
      .filter((r) => r.uid !== uid && r.loc)
      .map((r) => {
        const { gapM } = gapAlongRoute(route, me, { latitude: r.loc!.lat, longitude: r.loc!.lng });
        return { rider: r, gapM, distanceM: r.distance, stale: r.stale };
      })
      .sort((a, b) => {
        const alert = (i: GroupStripItem) => ((i.rider.loc?.status ?? 'ok') !== 'ok' ? 1 : 0);
        if (alert(a) !== alert(b)) return alert(b) - alert(a);
        if ((a.gapM == null) !== (b.gapM == null)) return a.gapM == null ? 1 : -1;
        if (a.gapM == null) return (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity); // off route: nearest first
        return (b.gapM ?? 0) - (a.gapM ?? 0); // on route: furthest ahead first
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navActive, nav.route, nav.progress?.remainingM, rows, uid]);

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
    if (destination) coords.push({ latitude: destination.lat, longitude: destination.lng });
    if (!coords.length) return;
    if (coords.length === 1) {
      mapRef.current?.animateToRegion({ ...coords[0], latitudeDelta: 0.02, longitudeDelta: 0.02 }, 400);
      return;
    }
    mapRef.current?.fitToCoordinates(coords, {
      edgePadding: { top: 160, right: 60, bottom: 220, left: 60 },
      animated: true,
    });
  }, [rows, myPos, destination]);

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

  /** Leader picked a place → work out the two-wheeler route once and share it with everyone. */
  async function applyDestination(place: PlaceResult) {
    setShowPicker(false);
    setSettingDest(true);
    try {
      const from = myPos ?? (me?.loc ? { latitude: me.loc.lat, longitude: me.loc.lng } : null);
      const route = from
        ? await computeTwoWheelerRoute(from, { latitude: place.lat, longitude: place.lng }).catch(() => null)
        : null;
      await setDestination(code, {
        lat: place.lat,
        lng: place.lng,
        name: place.name.slice(0, 120),
        address: place.address.slice(0, 300),
        polyline: route?.polyline ?? null,
        distanceM: route?.distanceM ?? null,
        durationS: route?.durationS ?? null,
      });
      const pts = route ? decodePolyline(route.polyline) : [{ latitude: place.lat, longitude: place.lng }];
      if (from) pts.push(from);
      mapRef.current?.fitToCoordinates(pts, {
        edgePadding: { top: 160, right: 60, bottom: 260, left: 60 },
        animated: true,
      });
    } catch (e: any) {
      notify('Could not set destination', e?.message ?? String(e));
    } finally {
      setSettingDest(false);
    }
  }

  async function dropPin(c: { latitude: number; longitude: number }) {
    if (!isLeader) return;
    const ok = await confirmAction({
      title: 'Set destination here?',
      message: 'Everyone in the ride will see this point and the route to it.',
      confirmText: 'Set destination',
    });
    if (ok) {
      await applyDestination({
        name: 'Pinned location',
        address: `${c.latitude.toFixed(5)}, ${c.longitude.toFixed(5)}`,
        lat: c.latitude,
        lng: c.longitude,
      });
    }
  }

  async function confirmClearDestination() {
    const ok = await confirmAction({
      title: 'Remove destination?',
      message: 'The destination and route disappear from everyone\'s map.',
      confirmText: 'Remove',
      destructive: true,
    });
    if (ok) await clearDestination(code).catch((e) => notify('Could not remove', e?.message ?? String(e)));
  }

  async function startNav() {
    setFollow(true);
    setShowList(false);
    setNavActive(true);
    // The map only reports a position when it changes — a rider standing at the start
    // might not have one yet, so ask for it once
    if (!myFix) {
      try {
        const l = await getCurrentFix();
        setMyPos({ latitude: l.latitude, longitude: l.longitude });
        setMyFix(l);
      } catch {}
    }
  }

  function exitNav() {
    setNavActive(false);
    setTimeout(fitAll, 300);
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
    // Save to history before leaving — the rider list is only readable while I'm a member
    if (uid) await finalizeRide(code, uid).catch(() => {});
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

  const onRegion = (r: Region) => {
    setLabels(r.latitudeDelta < LABELS_MAX_DELTA || riders.length <= 15);
    setLngDelta(r.longitudeDelta);
  };

  if (ended) {
    return (
      <View style={styles.center}>
        <Text style={{ fontSize: 48 }}>🏁</Text>
        <Text style={styles.endedTitle}>Ride ended</Text>
        <Text style={styles.endedText}>
          {isLeader ? 'You ended' : 'The leader ended'} "{groupName}". Location sharing has stopped.
        </Text>
        {saved === 'saving' && <ActivityIndicator color={colors.accent} />}
        {saved && saved !== 'saving' && (
          <View style={styles.summary}>
            <Text style={styles.summaryKicker}>SAVED TO YOUR HISTORY</Text>
            <View style={styles.summaryRow}>
              <Stat label="Distance" value={formatDistance(saved.distanceM)} />
              <Stat label="Moving" value={formatDuration(saved.movingS)} />
              <Stat label="Avg" value={`${saved.avgKmh} km/h`} />
              <Stat label="Top" value={`${saved.maxKmh} km/h`} />
            </View>
          </View>
        )}
        {saved && saved !== 'saving' && (
          <Button
            title="View ride"
            variant="secondary"
            onPress={() =>
              router.replace({ pathname: '/history/[id]', params: { id: `${saved.code}-${saved.startedAt}` } })
            }
            style={{ alignSelf: 'stretch' }}
          />
        )}
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
        customMapStyle={mapStyleFor(scheme) as any}
        showsUserLocation
        showsMyLocationButton={false}
        showsCompass
        toolbarEnabled={false}
        onUserLocationChange={(e) => {
          const c = e.nativeEvent.coordinate;
          if (!c) return;
          setMyPos({ latitude: c.latitude, longitude: c.longitude });
          setMyFix({ latitude: c.latitude, longitude: c.longitude, heading: c.heading, speed: c.speed });
        }}
        // Android: 1 s location updates while navigating (default is every 5 s)
        userLocationUpdateInterval={navActive ? 1000 : 5000}
        userLocationFastestInterval={navActive ? 1000 : 5000}
        userLocationPriority="high"
        onPanDrag={() => navActive && setFollow(false)}
        onRegionChangeComplete={onRegion}
        onLongPress={(e) => dropPin(e.nativeEvent.coordinate)}
        mapPadding={{ top: insets.top + (navActive ? 170 : 110), right: 0, bottom: 150, left: 0 }}
      >
        {navActive && navCoords ? (
          <Polyline coordinates={navCoords} strokeColor="#3B8BFF" strokeWidth={7} zIndex={2} />
        ) : (
          routeCoords && <Polyline coordinates={routeCoords} strokeColor={colors.accent} strokeWidth={5} zIndex={1} />
        )}
        {destination && (
          <Marker
            coordinate={{ latitude: destination.lat, longitude: destination.lng }}
            anchor={{ x: 0.5, y: 0.3 }}
            zIndex={900}
            tracksViewChanges={false}
          >
            <View style={styles.destWrap}>
              <View style={styles.destDot}>
                <Text style={{ fontSize: 16 }}>🏁</Text>
              </View>
              <View style={styles.destLabel}>
                <Text style={styles.destLabelText} numberOfLines={1}>{destination.name}</Text>
              </View>
            </View>
          </Marker>
        )}
        {rows
          .filter((r) => r.uid !== uid) // you are the native blue dot
          .map((r) => (
            <RiderMarker
              key={r.uid}
              rider={r}
              freshness={r.freshness}
              displayAt={displayPos.get(r.uid)}
              isLeader={r.uid === meta?.createdBy}
              isMe={false}
              showLabel={labels}
              onPress={focusRider}
            />
          ))}
      </MapView>

      {/* Top bar */}
      <SafeAreaView edges={['top']} style={styles.topWrap} pointerEvents="box-none">
        {navActive && destination ? (
          <NavBanner
            status={nav.status}
            error={nav.error}
            progress={nav.progress}
            nextStep={nav.nextStep}
            thenStep={nav.thenStep}
            destinationName={destination.name}
            onRetry={nav.retry}
          />
        ) : (
        <Glass style={styles.topBar}>
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
        </Glass>
        )}

        {navActive && (
          <NavGroupStrip
            items={groupStrip}
            onSelect={(r) => {
              setFollow(false);
              focusRider(r);
            }}
          />
        )}

        {lostAlerts.map((a) => {
          const r = rows.find((x) => x.uid === a.uid);
          return (
            <Pressable key={`lost-${a.uid}`} onPress={() => r && focusRider(r)} style={[styles.alert, styles.lostAlert]}>
              <View style={styles.lostDot} />
              <Text style={[styles.alertText, { color: colors.text, flex: 1 }]} numberOfLines={2}>
                {a.name}'s signal lost{r?.distance != null ? ` · last seen ${formatDistance(r.distance)} away` : ''}
              </Text>
              {/* Stays until they're back online or you dismiss it */}
              <Pressable
                hitSlop={10}
                onPress={() => setLostAlerts((l) => l.filter((x) => x.uid !== a.uid))}
                accessibilityLabel="Dismiss"
              >
                <Text style={{ color: colors.textDim, fontSize: 18, fontWeight: '700' }}>✕</Text>
              </Pressable>
            </Pressable>
          );
        })}

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
      {navActive ? (
        <View style={[styles.fabs, { bottom: 110 + insets.bottom }]}>
          {!follow && (
            <Pressable style={[styles.fab, { backgroundColor: '#3B8BFF' }]} onPress={() => setFollow(true)}>
              <Text style={[styles.fabText, { color: '#fff' }]}>➤</Text>
              <Text style={[styles.fabLabel, { color: '#fff' }]}>Re-center</Text>
            </Pressable>
          )}
          <Pressable style={styles.fab} onPress={() => { setFollow(false); fitAll(); }}>
            <Text style={styles.fabText}>⤢</Text>
            <Text style={styles.fabLabel}>Group</Text>
          </Pressable>
        </View>
      ) : (
      <View style={[styles.fabs, { bottom: (showList ? 420 : 170) + insets.bottom }]}>
        {isLeader && (
          <Pressable style={[styles.fab, { backgroundColor: colors.accent }]} onPress={() => setShowPicker(true)}>
            {settingDest ? <ActivityIndicator color={colors.accentText} /> : <Text style={[styles.fabText, { color: colors.accentText }]}>📍</Text>}
            <Text style={[styles.fabLabel, { color: colors.accentText }]}>{destination ? 'Change' : 'Go to'}</Text>
          </Pressable>
        )}
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
        <Pressable
          style={styles.fab}
          onPress={() => {
            setMuted((m) => !m);
            setAlertsMuted(!muted);
          }}
        >
          <Text style={styles.fabText}>{muted ? '🔕' : '🔔'}</Text>
          <Text style={styles.fabLabel}>{muted ? 'Muted' : 'Alerts'}</Text>
        </Pressable>
      </View>
      )}

      {/* Bottom sheet (navigation footer while navigating) */}
      {navActive ? (
        <NavFooter
          progress={nav.progress}
          voice={voice}
          onToggleVoice={() => setVoice((v) => !v)}
          onExit={exitNav}
          onSos={confirmSos}
          sosActive={myStatus === 'sos'}
          bottomInset={insets.bottom}
        />
      ) : (
      <Glass style={[styles.sheet, { paddingBottom: insets.bottom + 12 }]}>
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

        {destination && (
          <View style={styles.destCard}>
            <View style={{ flex: 1 }}>
              <Text style={styles.destName} numberOfLines={1}>🏁 {destination.name}</Text>
              <Text style={styles.destMeta} numberOfLines={1}>
                {destination.distanceM ? `${formatDistance(destination.distanceM)} route` : 'No route yet'}
                {destination.durationS ? ` · ~${formatDuration(destination.durationS)}` : ''}
                {myPos ? ` · ${formatDistance(distanceMeters(myPos, { latitude: destination.lat, longitude: destination.lng }))} from you` : ''}
              </Text>
            </View>
            {isLeader && (
              <Pressable onPress={confirmClearDestination} hitSlop={8} style={styles.destX}>
                <Text style={{ color: colors.textDim, fontSize: 18 }}>✕</Text>
              </Pressable>
            )}
            <Pressable onPress={startNav} style={styles.navBtn}>
              <Text style={styles.navText}>Navigate</Text>
            </Pressable>
          </View>
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
      </Glass>
      )}

      <DestinationPicker
        visible={showPicker}
        near={myPos}
        onPick={applyDestination}
        onClose={() => setShowPicker(false)}
      />

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

const useStyles = makeStyles((colors) => ({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg, padding: 24, gap: 10 },
  endedTitle: { color: colors.text, fontSize: 26, fontWeight: '800' },
  endedText: { color: colors.textDim, fontSize: 15, textAlign: 'center', marginBottom: 12 },
  summary: {
    alignSelf: 'stretch',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 16,
    gap: 12,
    marginBottom: 6,
  },
  summaryKicker: { color: colors.accent, fontWeight: '800', letterSpacing: 1, fontSize: 12, textAlign: 'center' },
  summaryRow: { flexDirection: 'row' },
  statValue: { color: colors.text, fontSize: 17, fontWeight: '800' },
  statLabel: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  destWrap: { alignItems: 'center', width: 140 },
  destDot: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#FFFFFF',
    borderWidth: 3,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  destLabel: { marginTop: 2, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, backgroundColor: colors.accent, maxWidth: 140 },
  destLabelText: { color: colors.accentText, fontSize: 11, fontWeight: '800' },
  destCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surfaceHigh,
    borderRadius: radius.md,
    padding: 10,
    paddingLeft: 14,
    marginBottom: 4,
  },
  destName: { color: colors.text, fontWeight: '800', fontSize: 15 },
  destMeta: { color: colors.textDim, fontSize: 12, marginTop: 2 },
  destX: { padding: 6 },
  navBtn: { backgroundColor: colors.accent, borderRadius: radius.sm, paddingHorizontal: 14, paddingVertical: 10 },
  navText: { color: colors.accentText, fontWeight: '800', fontSize: 15 },
  endBtn: { alignItems: 'center', paddingVertical: 12, borderTopWidth: 1, borderTopColor: colors.border },
  endText: { color: colors.danger, fontWeight: '800', fontSize: 15 },
  topWrap: { position: 'absolute', top: 0, left: 0, right: 0, paddingHorizontal: 12, gap: 8 },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 10, marginTop: 6 },
  iconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  iconText: { color: colors.text, fontSize: 30, marginTop: -4 },
  groupName: { color: colors.text, fontSize: 17, fontWeight: '800' },
  groupSub: { color: colors.textDim, fontSize: 12, marginTop: 1 },
  inviteBtn: { backgroundColor: colors.accent, paddingHorizontal: 12, paddingVertical: 9, borderRadius: radius.sm },
  inviteText: { color: colors.accentText, fontWeight: '800' },
  alert: { borderRadius: radius.md, padding: 12, ...shadow },
  lostAlert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: colors.danger,
  },
  lostDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#FF3B30', borderWidth: 2, borderColor: '#FFFFFF' },
  alertText: { color: '#0E0F12', fontWeight: '800', fontSize: 15 },
  fabs: { position: 'absolute', right: 12, gap: 10 },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.glass,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow,
    shadowOpacity: 0.2,
  },
  fabText: { color: colors.text, fontSize: 20, fontWeight: '700' },
  fabLabel: { color: colors.textDim, fontSize: 9, fontWeight: '700' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16 },
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
}));

function Stat({ label, value }: { label: string; value: string }) {
  const styles = useStyles();
  return (
    <View style={{ alignItems: 'center', flex: 1 }}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}
