import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { StyleSheet, useColorScheme } from 'react-native';
import { getThemeMode, setThemeMode as saveThemeMode } from './storage';

/**
 * Light / dark theme for the whole app, including the map. Follows the phone's setting
 * by default ("auto"); riders can force light or dark.
 */

export type Palette = {
  bg: string;
  surface: string;
  surfaceHigh: string;
  border: string;
  text: string;
  textDim: string;
  accent: string;
  accentText: string;
  danger: string;
  warning: string;
  ok: string;
  stale: string;
  /** Translucent fill for floating "glass" panels over the map */
  glass: string;
  shadow: string;
};

const light: Palette = {
  bg: '#F2F2F7',
  surface: '#FFFFFF',
  surfaceHigh: '#EEEEF3',
  border: '#D8D8DE',
  text: '#1C1C1E',
  textDim: '#6E6E73',
  accent: '#FF6B00',
  accentText: '#FFFFFF',
  danger: '#FF3B30',
  warning: '#FF9F0A',
  ok: '#34C759',
  stale: '#8E8E93',
  glass: 'rgba(255,255,255,0.82)',
  shadow: 'rgba(0,0,0,0.18)',
};

const dark: Palette = {
  bg: '#000000',
  surface: '#1C1C1E',
  surfaceHigh: '#2C2C2E',
  border: '#38383A',
  text: '#FFFFFF',
  textDim: '#98989F',
  accent: '#FF7A1A',
  accentText: '#0E0F12',
  danger: '#FF453A',
  warning: '#FFD60A',
  ok: '#30D158',
  stale: '#8E8E93',
  glass: 'rgba(28,28,30,0.80)',
  shadow: 'rgba(0,0,0,0.5)',
};

export const radius = { sm: 8, md: 14, lg: 22 };

export type Scheme = 'light' | 'dark';
export type ThemeMode = 'auto' | Scheme;
export type Theme = { scheme: Scheme; colors: Palette; mode: ThemeMode; setMode: (m: ThemeMode) => void };

const ThemeContext = createContext<Theme | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('auto');

  useEffect(() => {
    getThemeMode().then((m) => m && setModeState(m));
  }, []);

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    saveThemeMode(m);
  }, []);

  const scheme: Scheme = mode === 'auto' ? (system === 'light' ? 'light' : system === 'dark' ? 'dark' : 'light') : mode;
  const value = useMemo(
    () => ({ scheme, colors: scheme === 'dark' ? dark : light, mode, setMode }),
    [scheme, mode, setMode],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const t = useContext(ThemeContext);
  if (!t) throw new Error('useTheme must be used inside ThemeProvider');
  return t;
}

/**
 * `const useStyles = makeStyles((colors) => ({ ... }))` then `const styles = useStyles()` in the component.
 * Styles are built once per palette and cached.
 */
export function makeStyles<T extends StyleSheet.NamedStyles<T>>(build: (colors: Palette, scheme: Scheme) => T) {
  const cache = new Map<Palette, T>();
  return function useStyles(): T {
    const { colors, scheme } = useTheme();
    let s = cache.get(colors);
    if (!s) {
      s = StyleSheet.create(build(colors, scheme));
      cache.set(colors, s);
    }
    return s;
  };
}
