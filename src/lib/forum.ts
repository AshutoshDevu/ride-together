import {
  addDoc,
  collection,
  doc,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { ms } from './clubs';
import { fs } from './firebase';

/**
 * Discussion threads — the same shape in two places:
 *   club board:       clubs/{clubId}/threads/{t}/replies/{r}   (club members only)
 *   community forum:  forum/{t}/replies/{r}                    (every signed-in rider)
 * Thread: { title, body, city, authorId, authorName, replyCount, createdAt, lastActivityAt }
 * Reports go to reports/{id} for the project owner to review.
 */

export type Scope = { kind: 'club'; clubId: string } | { kind: 'public' };
export type Thread = {
  id: string;
  title: string;
  body: string;
  city: string;
  authorId: string;
  authorName: string;
  replyCount: number;
  createdAt: number;
  lastActivityAt: number;
};
export type Reply = { id: string; body: string; authorId: string; authorName: string; createdAt: number };

const threadsPath = (s: Scope) => (s.kind === 'club' ? `clubs/${s.clubId}/threads` : 'forum');
const opts = { serverTimestamps: 'estimate' as const };

function toThread(d: { id: string; data: (o?: any) => any }): Thread {
  const x = d.data(opts);
  return {
    id: d.id,
    title: x.title,
    body: x.body ?? '',
    city: x.city ?? '',
    authorId: x.authorId,
    authorName: x.authorName ?? '',
    replyCount: x.replyCount ?? 0,
    createdAt: ms(x.createdAt),
    lastActivityAt: ms(x.lastActivityAt),
  };
}

export function subscribeThreads(scope: Scope, cb: (t: Thread[]) => void, onError: (e: Error) => void): Unsubscribe {
  return onSnapshot(
    query(collection(fs, threadsPath(scope)), orderBy('lastActivityAt', 'desc'), limit(100)),
    (s) => cb(s.docs.map(toThread)),
    onError,
  );
}

export function subscribeThread(scope: Scope, id: string, cb: (t: Thread | null) => void, onError: (e: Error) => void): Unsubscribe {
  return onSnapshot(doc(fs, threadsPath(scope), id), (s) => cb(s.exists() ? toThread(s) : null), onError);
}

export async function createThread(
  scope: Scope,
  uid: string,
  name: string,
  t: { title: string; body: string; city: string },
): Promise<string> {
  const r = await addDoc(collection(fs, threadsPath(scope)), {
    title: t.title.trim().slice(0, 120),
    body: t.body.trim().slice(0, 5000),
    city: t.city.trim().slice(0, 40),
    authorId: uid,
    authorName: name.slice(0, 40),
    replyCount: 0,
    createdAt: serverTimestamp(),
    lastActivityAt: serverTimestamp(),
  });
  if (scope.kind === 'club') updateDoc(doc(fs, 'clubs', scope.clubId), { lastActivityAt: serverTimestamp() }).catch(() => {});
  return r.id;
}

export async function deleteThread(scope: Scope, id: string) {
  const b = writeBatch(fs);
  b.delete(doc(fs, threadsPath(scope), id));
  await b.commit();
}

export function subscribeReplies(scope: Scope, threadId: string, cb: (r: Reply[]) => void, onError: (e: Error) => void): Unsubscribe {
  return onSnapshot(
    query(collection(fs, threadsPath(scope), threadId, 'replies'), orderBy('createdAt', 'asc'), limit(500)),
    (s) =>
      cb(
        s.docs.map((d) => {
          const x = d.data(opts);
          return { id: d.id, body: x.body, authorId: x.authorId, authorName: x.authorName ?? '', createdAt: ms(x.createdAt) };
        }),
      ),
    onError,
  );
}

/** Reply + bump the thread's reply count and activity time, atomically. */
export async function addReply(scope: Scope, threadId: string, uid: string, name: string, body: string) {
  const text = body.trim().slice(0, 5000);
  if (!text) return;
  const b = writeBatch(fs);
  b.set(doc(collection(fs, threadsPath(scope), threadId, 'replies')), {
    body: text,
    authorId: uid,
    authorName: name.slice(0, 40),
    createdAt: serverTimestamp(),
  });
  b.update(doc(fs, threadsPath(scope), threadId), { replyCount: increment(1), lastActivityAt: serverTimestamp() });
  await b.commit();
}

export async function deleteReply(scope: Scope, threadId: string, replyId: string) {
  const b = writeBatch(fs);
  b.delete(doc(fs, threadsPath(scope), threadId, 'replies', replyId));
  b.update(doc(fs, threadsPath(scope), threadId), { replyCount: increment(-1) });
  await b.commit();
}

/** Flag a post for the project owner to review in the Firebase console (reports collection). */
export async function report(uid: string, path: string, reason: string) {
  await addDoc(collection(fs, 'reports'), {
    path: path.slice(0, 300),
    reason: reason.trim().slice(0, 500),
    reporterId: uid,
    createdAt: serverTimestamp(),
  });
}

export function timeAgo(t: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(t).toLocaleDateString([], { day: 'numeric', month: 'short' });
}
