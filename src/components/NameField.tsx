import { Text, View } from 'react-native';
import { makeStyles, useTheme } from '../lib/theme';
import { Input } from './ui';

export function NameField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const styles = useStyles();
  return (
    <View style={{ gap: 8 }}>
      <Text style={styles.label}>Your rider name</Text>
      <Input
        value={value}
        onChangeText={onChange}
        placeholder="e.g. Ashu (Duke 390)"
        maxLength={24}
        autoCapitalize="words"
        returnKeyType="done"
      />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  label: { color: colors.textDim, fontSize: 13, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase' },
}));
