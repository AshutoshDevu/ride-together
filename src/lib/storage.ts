import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  name: 'rt.displayName',
  activeGroup: 'rt.activeGroup',
  theme: 'rt.theme',
  muted: 'rt.alertsMuted',
} as const;

export async function getDisplayName(): Promise<string | null> {
  return AsyncStorage.getItem(KEYS.name);
}
export async function setDisplayName(name: string) {
  await AsyncStorage.setItem(KEYS.name, name.trim());
}

/** The group we are currently sharing location with — read by the background task too. */
export async function getActiveGroup(): Promise<string | null> {
  return AsyncStorage.getItem(KEYS.activeGroup);
}
export async function setActiveGroup(code: string | null) {
  if (code) await AsyncStorage.setItem(KEYS.activeGroup, code);
  else await AsyncStorage.removeItem(KEYS.activeGroup);
}

export async function getThemeMode(): Promise<'auto' | 'light' | 'dark' | null> {
  const v = await AsyncStorage.getItem(KEYS.theme);
  return v === 'auto' || v === 'light' || v === 'dark' ? v : null;
}
export async function setThemeMode(mode: 'auto' | 'light' | 'dark') {
  await AsyncStorage.setItem(KEYS.theme, mode);
}

/** Signal-loss beep muted? */
export async function getAlertsMuted(): Promise<boolean> {
  return (await AsyncStorage.getItem(KEYS.muted)) === '1';
}
export async function setAlertsMuted(muted: boolean) {
  await AsyncStorage.setItem(KEYS.muted, muted ? '1' : '0');
}
