import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApp, getApps, initializeApp } from 'firebase/app';
import * as FirebaseAuth from 'firebase/auth';
import { connectDatabaseEmulator, getDatabase } from 'firebase/database';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { Platform } from 'react-native';

const firebaseConfig = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN,
  databaseURL: process.env.EXPO_PUBLIC_FIREBASE_DATABASE_URL,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
};

export const isFirebaseConfigured = Boolean(
  firebaseConfig.apiKey && firebaseConfig.databaseURL && firebaseConfig.projectId,
);

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

/**
 * `getReactNativePersistence` is only exported from the React Native build of
 * firebase/auth (Metro picks it via the "react-native" export condition), so the
 * web typings don't know about it. Keeps the anonymous rider identity across app restarts.
 */
const getReactNativePersistence = (FirebaseAuth as any).getReactNativePersistence as
  | ((storage: typeof AsyncStorage) => FirebaseAuth.Persistence)
  | undefined;

function createAuth(): FirebaseAuth.Auth {
  try {
    return FirebaseAuth.initializeAuth(app, {
      // Browser: keep the rider in localStorage so a page refresh doesn't make them a new rider
      persistence: Platform.OS === 'web'
        ? FirebaseAuth.browserLocalPersistence
        : getReactNativePersistence
          ? getReactNativePersistence(AsyncStorage)
          : FirebaseAuth.inMemoryPersistence,
      // initializeAuth (unlike getAuth) leaves this out — "Continue with Google" popups need it on web
      ...(Platform.OS === 'web' ? { popupRedirectResolver: FirebaseAuth.browserPopupRedirectResolver } : {}),
    });
  } catch {
    // Already initialized (fast refresh / background task re-import)
    return FirebaseAuth.getAuth(app);
  }
}

export const auth = createAuth();
/** Realtime Database — the live ride (high-frequency positions) */
export const db = getDatabase(app);
/** Cloud Firestore — profiles, clubs, chat, forums, ride history */
export const fs = getFirestore(app);

/** Local demo / development: talk to the Firebase emulators (`npm run emulators`) instead of a real project. */
const useEmulator = process.env.EXPO_PUBLIC_USE_EMULATOR === '1';
if (useEmulator) {
  const host = process.env.EXPO_PUBLIC_EMULATOR_HOST ?? '127.0.0.1';
  try {
    FirebaseAuth.connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
    connectDatabaseEmulator(db, host, 9000);
    connectFirestoreEmulator(fs, host, 8080);
  } catch {
    // Already connected (fast refresh)
  }
}

/** The signed-in rider's uid (waits for the saved session to load), or null when signed out. */
export async function currentUid(): Promise<string | null> {
  await auth.authStateReady();
  return auth.currentUser?.uid ?? null;
}
