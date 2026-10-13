import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  name: 'rt.displayName',
  activeGroup: 'rt.activeGroup',
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
