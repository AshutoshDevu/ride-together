import { onAuthStateChanged, type User } from 'firebase/auth';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { auth, isFirebaseConfigured } from './firebase';
import { saveProfile, subscribeProfile, type Profile } from './profile';

/**
 * Who is using the app: the Firebase user (Google / phone account) and their profile.
 * Riders from before accounts existed may still be signed in anonymously — they're sent to the
 * sign-in screen, and signing in links that anonymous user so their id carries over.
 */
type Session = {
  ready: boolean;
  error: string | null;
  user: User | null;
  /** Signed in with Google or phone (not anonymous) */
  signedIn: boolean;
  uid: string | null;
  /** null = signed in but no profile yet (first sign-in) */
  profile: Profile | null;
  profileLoaded: boolean;
  /** Rider name shown to the group */
  name: string;
  saveName: (name: string) => Promise<void>;
  saveProfile: (p: Profile) => Promise<void>;
};

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(
    isFirebaseConfigured ? null : 'Firebase is not configured. Copy .env.example to .env and fill it in.',
  );
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profileLoaded, setProfileLoaded] = useState(false);

  useEffect(
    () =>
      onAuthStateChanged(auth, (u) => {
        setUser(u);
        setReady(true);
      }),
    [],
  );

  const signedIn = !!user && !user.isAnonymous;
  const uid = user?.uid ?? null;

  useEffect(() => {
    setProfile(null);
    setProfileLoaded(false);
    if (!signedIn || !uid) return;
    return subscribeProfile(
      uid,
      (p) => {
        setProfile(p);
        setProfileLoaded(true);
      },
      (e) => {
        setError(e.message);
        setProfileLoaded(true);
      },
    );
  }, [signedIn, uid]);

  const save = useCallback(
    async (p: Profile) => {
      if (!uid) throw new Error('Not signed in');
      await saveProfile(uid, p, !profile);
    },
    [uid, profile],
  );

  const saveName = useCallback(
    async (name: string) => {
      await save({ ...(profile ?? {}), displayName: name.trim() });
    },
    [save, profile],
  );

  return (
    <SessionContext.Provider
      value={{
        ready,
        error,
        user,
        signedIn,
        uid,
        profile,
        profileLoaded,
        name: profile?.displayName ?? '',
        saveName,
        saveProfile: save,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession must be used inside SessionProvider');
  return s;
}
