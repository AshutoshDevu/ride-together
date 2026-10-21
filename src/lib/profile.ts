import { doc, onSnapshot, serverTimestamp, setDoc, type Unsubscribe } from 'firebase/firestore';
import { fs } from './firebase';

/** users/{uid} — public rider profile (shown in rides, clubs and forums). */
export type Profile = {
  displayName: string;
  bike?: string;
  city?: string;
  photoURL?: string | null;
};

export function subscribeProfile(uid: string, cb: (p: Profile | null) => void, onError: (e: Error) => void): Unsubscribe {
  return onSnapshot(
    doc(fs, 'users', uid),
    (s) => cb(s.exists() ? (s.data() as Profile) : null),
    onError,
  );
}

export async function saveProfile(uid: string, p: Profile, isNew: boolean) {
  const clean: Record<string, unknown> = {
    displayName: p.displayName.trim().slice(0, 40),
    bike: (p.bike ?? '').trim().slice(0, 40),
    city: (p.city ?? '').trim().slice(0, 40),
    photoURL: p.photoURL ?? null,
    updatedAt: serverTimestamp(),
  };
  if (isNew) clean.createdAt = serverTimestamp();
  await setDoc(doc(fs, 'users', uid), clean, { merge: true });
}
