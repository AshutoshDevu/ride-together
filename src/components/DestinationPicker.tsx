import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { LatLng } from '../lib/geo';
import { searchPlaces, type PlaceResult } from '../lib/places';
import { makeStyles, radius, useTheme } from '../lib/theme';
import { Button, Input } from './ui';

type Props = {
  visible: boolean;
  near: LatLng | null;
  onPick: (p: PlaceResult) => void;
  onClose: () => void;
};

/** Leader's "where are we going?" search. Searches on submit only — Places is billed per request. */
export function DestinationPicker({ visible, near, onPick, onClose }: Props) {
  const { colors } = useTheme();
  const styles = useStyles();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PlaceResult[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    const q = query.trim();
    if (q.length < 2) return;
    setBusy(true);
    setError(null);
    try {
      setResults(await searchPlaces(q, near));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + 20 }]} onPress={() => {}}>
          <Text style={styles.kicker}>SET DESTINATION</Text>
          <Text style={styles.title}>Where is the group heading?</Text>
          <View style={styles.row}>
            <Input
              value={query}
              onChangeText={setQuery}
              placeholder="e.g. Nandi Hills"
              autoFocus
              returnKeyType="search"
              onSubmitEditing={search}
              style={{ flex: 1 }}
            />
            <Button title="Search" onPress={search} loading={busy} style={{ paddingHorizontal: 16 }} />
          </View>

          {error && <Text style={styles.error}>{error}</Text>}

          <ScrollView style={{ maxHeight: 320 }} keyboardShouldPersistTaps="handled">
            {busy && !results && <ActivityIndicator color={colors.accent} style={{ marginTop: 16 }} />}
            {results?.length === 0 && <Text style={styles.hint}>No places found. Try a different name.</Text>}
            {results?.map((p, i) => (
              <Pressable key={`${p.lat},${p.lng},${i}`} onPress={() => onPick(p)} style={styles.result}>
                <Text style={styles.resultName}>📍 {p.name}</Text>
                {!!p.address && <Text style={styles.resultAddr} numberOfLines={2}>{p.address}</Text>}
              </Pressable>
            ))}
          </ScrollView>

          <Text style={styles.hint}>Tip: you can also long-press the map (right-click on a laptop) to drop a pin.</Text>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const useStyles = makeStyles((colors) => ({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: 22,
    gap: 12,
    width: '100%',
    maxWidth: 640,
    alignSelf: 'center',
  },
  kicker: { color: colors.accent, fontWeight: '800', letterSpacing: 1, fontSize: 12 },
  title: { color: colors.text, fontWeight: '800', fontSize: 22 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  error: { color: colors.danger, fontSize: 13 },
  hint: { color: colors.textDim, fontSize: 13, marginTop: 4 },
  result: { paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border },
  resultName: { color: colors.text, fontWeight: '700', fontSize: 16 },
  resultAddr: { color: colors.textDim, fontSize: 13, marginTop: 2 },
}));
