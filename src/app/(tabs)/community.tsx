import { useState } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Segmented } from '../../components/Segmented';
import { ThreadList } from '../../components/Threads';
import { useSession } from '../../lib/session';
import { makeStyles } from '../../lib/theme';

/** Public community forum — "where to ride this weekend?", routes, gear, meetups. */
export default function CommunityScreen() {
  const styles = useStyles();
  const { uid, name, profile } = useSession();
  const myCity = profile?.city?.trim() ?? '';
  const [filter, setFilter] = useState<'city' | 'all'>(myCity ? 'city' : 'all');
  if (!uid) return null;

  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top']}>
      <ThreadList
        scope={{ kind: 'public' }}
        uid={uid}
        name={name}
        city={myCity}
        cityFilter={filter === 'city' && myCity ? myCity : null}
        header={
          <View style={{ gap: 12 }}>
            <Text style={styles.title}>Community</Text>
            <Text style={styles.dim}>Ask where to ride, share routes and plan meetups with riders everywhere.</Text>
            {!!myCity && (
              <Segmented
                options={[
                  { value: 'city', label: myCity },
                  { value: 'all', label: 'Everywhere' },
                ]}
                value={filter}
                onChange={setFilter}
              />
            )}
          </View>
        }
      />
    </SafeAreaView>
  );
}

const useStyles = makeStyles((colors) => ({
  title: { color: colors.text, fontSize: 30, fontWeight: '800', letterSpacing: -0.5 },
  dim: { color: colors.textDim, fontSize: 14 },
}));
