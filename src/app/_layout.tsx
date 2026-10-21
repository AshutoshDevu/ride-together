// Registers the background location task — must be imported at app start.
import '../lib/tracking';

import { router, Stack, usePathname, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SessionProvider, useSession } from '../lib/session';
import { ThemeProvider, useTheme } from '../lib/theme';

/**
 * Everything needs an account: signed-out riders (and anonymous ones from before accounts
 * existed) go to /sign-in and come back to where they were heading — e.g. an invite link.
 */
function AuthGate() {
  const { ready, signedIn, profile, profileLoaded } = useSession();
  const segments = useSegments();
  const pathname = usePathname();
  const onSignIn = segments[0] === 'sign-in';

  useEffect(() => {
    if (!ready) return;
    const needsSignIn = !signedIn || (profileLoaded && !profile);
    if (needsSignIn && !onSignIn) {
      router.replace({ pathname: '/sign-in', params: pathname && pathname !== '/' ? { next: pathname } : {} });
    }
  }, [ready, signedIn, profile, profileLoaded, onSignIn, pathname]);

  return null;
}

function ThemedStack() {
  const { colors, scheme } = useTheme();
  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <AuthGate />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
          animation: 'fade',
        }}
      />
    </>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <SessionProvider>
          <ThemedStack />
        </SessionProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
