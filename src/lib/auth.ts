import { GoogleAuthProvider, linkWithPopup, signInWithCredential, signInWithPopup, type User } from 'firebase/auth';
import { signOutEverywhere } from './authCommon';
import { auth } from './firebase';

/**
 * Web sign-in. (Android: auth.native.ts — native Google account picker.)
 * Phone sign-in on both platforms goes through <PhoneVerifier> + confirmPhoneCode().
 */

export async function signInWithGoogle(): Promise<User | null> {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });
  const current = auth.currentUser;
  if (current?.isAnonymous) {
    try {
      return (await linkWithPopup(current, provider)).user;
    } catch (e: any) {
      if (e?.code !== 'auth/credential-already-in-use') throw e;
      const cred = GoogleAuthProvider.credentialFromError(e);
      if (!cred) throw e;
      return (await signInWithCredential(auth, cred)).user;
    }
  }
  return (await signInWithPopup(auth, provider)).user;
}

export async function signOut() {
  await signOutEverywhere();
}
