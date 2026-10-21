import { GoogleSignin, statusCodes } from '@react-native-google-signin/google-signin';
import { GoogleAuthProvider, type User } from 'firebase/auth';
import { completeSignIn, signOutEverywhere } from './authCommon';

/**
 * Android sign-in: the native Google account picker hands us an ID token, which signs into the
 * same Firebase JS SDK the rest of the app uses. (Web: auth.ts.)
 */

let configured = false;
function configure() {
  if (configured) return;
  GoogleSignin.configure({ webClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID });
  configured = true;
}

/** Resolves null when the rider closes the account picker. */
export async function signInWithGoogle(): Promise<User | null> {
  configure();
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  try {
    const res = await GoogleSignin.signIn();
    if (res.type !== 'success') return null;
    if (!res.data.idToken) throw new Error('Google did not return an ID token.');
    return await completeSignIn(GoogleAuthProvider.credential(res.data.idToken));
  } catch (e: any) {
    if (e?.code === statusCodes.SIGN_IN_CANCELLED || e?.code === statusCodes.IN_PROGRESS) return null;
    throw e;
  }
}

export async function signOut() {
  configure();
  await GoogleSignin.signOut().catch(() => {});
  await signOutEverywhere();
}
