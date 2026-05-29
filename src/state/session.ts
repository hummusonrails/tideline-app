import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { MemberId } from '../types';

interface SessionState {
  /** Active member on this device, or null if not signed in. */
  identity: MemberId | null;
  /** Decrypted access token for the private data backend. Persisted in localStorage. */
  pat: string | null;
  /** When the user last re-entered their passphrase. We re-prompt every 7 days. */
  lastUnlockAt: number | null;
  /** Backend coordinates — only known after a successful passphrase unlock. */
  dataOwner: string | null;
  dataRepo: string | null;

  signIn: (identity: MemberId, pat: string, owner: string, repo: string) => void;
  signOut: () => void;
  /** Force a passphrase re-unlock (keeps identity), e.g. after token expiry. */
  requireReunlock: () => void;
  panic: () => void;
}

const UNLOCK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      identity: null,
      pat: null,
      lastUnlockAt: null,
      dataOwner: null,
      dataRepo: null,

      signIn: (identity, pat, owner, repo) =>
        set({ identity, pat, dataOwner: owner, dataRepo: repo, lastUnlockAt: Date.now() }),
      signOut: () =>
        set({ identity: null, pat: null, dataOwner: null, dataRepo: null, lastUnlockAt: null }),
      requireReunlock: () => set({ pat: null, lastUnlockAt: null }),
      panic: () => {
        // Best-effort local wipe. Sync engine listens on storage event to clear Dexie.
        localStorage.clear();
        indexedDB.databases?.().then((dbs) =>
          dbs.forEach((db) => db.name && indexedDB.deleteDatabase(db.name)),
        );
        location.replace('/');
      },
    }),
    {
      name: 'tideline-session',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        identity: s.identity,
        pat: s.pat,
        lastUnlockAt: s.lastUnlockAt,
        dataOwner: s.dataOwner,
        dataRepo: s.dataRepo,
      }),
    },
  ),
);

export function isUnlockFresh(state: SessionState): boolean {
  return state.lastUnlockAt !== null && Date.now() - state.lastUnlockAt < UNLOCK_TTL_MS;
}
