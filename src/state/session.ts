import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { MemberId } from '../types';

interface SessionState {
  /** Active member on this device, or null if not signed in. */
  identity: MemberId | null;
  /** Decrypted access token for the private data backend. Persisted in localStorage. */
  pat: string | null;
  /** When the user last re-entered their passphrase. See {@link UNLOCK_TTL_MS}. */
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

/**
 * How long an unlock lasts before we re-prompt for the passphrase.
 *
 * Deliberately longer than any single trip. A shorter window sounds safer but
 * isn't: it comes due while people are somewhere with no connectivity, and a
 * re-unlock at that moment is the one operation nobody can troubleshoot. The
 * real backstop is the PAT's own expiry, which is set per-trip at mint time,
 * plus the panic wipe for a lost phone.
 */
const UNLOCK_TTL_MS = 30 * 24 * 60 * 60 * 1000;

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
        // BASE_URL, not '/': on a project Pages site the app lives under a
        // subpath, and '/' would land on the domain root — outside the app.
        location.replace(import.meta.env.BASE_URL);
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
