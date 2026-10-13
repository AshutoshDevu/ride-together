import AsyncStorage from '@react-native-async-storage/async-storage';
import { getApp, getApps, initializeApp } from 'firebase/app';
import * as FirebaseAuth from 'firebase/auth';
import { getDatabase } from 'firebase/database';

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
      persistence: getReactNativePersistence
        ? getReactNativePersistence(AsyncStorage)
        : FirebaseAuth.inMemoryPersistence,
    });
  } catch {
    // Already initialized (fast refresh / background task re-import)
    return FirebaseAuth.getAuth(app);
  }
}

export const auth = createAuth();
export const db = getDatabase(app);

/** Resolves to the signed-in rider's uid, signing in anonymously the first time. */
export async function ensureSignedIn(): Promise<string> {
  await auth.authStateReady();
  if (auth.currentUser) return auth.currentUser.uid;
  const cred = await FirebaseAuth.signInAnonymously(auth);
  return cred.user.uid;
}
