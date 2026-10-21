import {
  GoogleAuthProvider,
  linkWithCredential,
  PhoneAuthProvider,
  signInWithCredential,
  signOut as fbSignOut,
  type AuthCredential,
  type User,
} from 'firebase/auth';
import { auth } from './firebase';

/**
 * Every sign-in method ends here with a credential. A rider who used the app before accounts
 * existed is signed in anonymously — link the credential to that user so their id (and any ride
 * they're in) carries over. If the Google account / number already has its own RideTogether
 * account, sign into that one instead.
 */
export async function completeSignIn(cred: AuthCredential): Promise<User> {
  const current = auth.currentUser;
  if (current?.isAnonymous) {
    try {
      return (await linkWithCredential(current, cred)).user;
    } catch (e: any) {
      if (e?.code !== 'auth/credential-already-in-use' && e?.code !== 'auth/account-exists-with-different-credential') {
        throw e;
      }
      // Phone codes are single-use — the error carries a fresh credential to sign in with
      const again =
        cred.providerId === 'phone' ? PhoneAuthProvider.credentialFromError(e) : GoogleAuthProvider.credentialFromError(e);
      return (await signInWithCredential(auth, again ?? cred)).user;
    }
  }
  return (await signInWithCredential(auth, cred)).user;
}

/** "+91 98765 43210" / "9876543210" → "+919876543210" (India by default) */
export function normalizePhone(input: string, defaultCountry = '+91'): string | null {
  const digits = input.replace(/[^\d+]/g, '');
  const e164 = digits.startsWith('+') ? digits : `${defaultCountry}${digits.replace(/^0+/, '')}`;
  return /^\+\d{10,15}$/.test(e164) ? e164 : null;
}

export async function confirmPhoneCode(verificationId: string, code: string): Promise<User> {
  return completeSignIn(PhoneAuthProvider.credential(verificationId, code.trim()));
}

export function friendlyAuthError(e: any): string {
  switch (e?.code) {
    case 'auth/invalid-verification-code':
      return 'That code is wrong. Check the SMS and try again.';
    case 'auth/code-expired':
      return 'That code has expired. Ask for a new one.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Please wait a few minutes and try again.';
    case 'auth/invalid-phone-number':
      return 'That phone number doesn’t look right.';
    case 'auth/network-request-failed':
      return 'No internet connection.';
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return '';
    default:
      return e?.message ?? String(e);
  }
}

export async function signOutEverywhere() {
  await fbSignOut(auth);
}
