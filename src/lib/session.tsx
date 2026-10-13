import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { ensureSignedIn, isFirebaseConfigured } from './firebase';
import { getDisplayName, setDisplayName } from './storage';

type Session = {
  ready: boolean;
  error: string | null;
  uid: string | null;
  name: string;
  saveName: (name: string) => Promise<void>;
};

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uid, setUid] = useState<string | null>(null);
  const [name, setName] = useState('');

  useEffect(() => {
    (async () => {
      try {
        setName((await getDisplayName()) ?? '');
        if (!isFirebaseConfigured) {
          throw new Error('Firebase is not configured. Copy .env.example to .env and fill it in.');
        }
        setUid(await ensureSignedIn());
      } catch (e: any) {
        setError(e?.message ?? String(e));
      } finally {
        setReady(true);
      }
    })();
  }, []);

  const saveName = useCallback(async (n: string) => {
    await setDisplayName(n);
    setName(n.trim());
  }, []);

  return (
    <SessionContext.Provider value={{ ready, error, uid, name, saveName }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): Session {
  const s = useContext(SessionContext);
  if (!s) throw new Error('useSession must be used inside SessionProvider');
  return s;
}
