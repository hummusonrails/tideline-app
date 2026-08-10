import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import { useSession } from '../state/session';
import { useMyProfile } from '../lib/profile';
import { useSyncError, retrySync } from '../lib/syncStatus';
import { enqueue } from '../lib/sync';
import { uid } from '../lib/uuid';
import { textToBase64 } from '../lib/github';
import { GlassCard } from '../ui/GlassCard';

/** Compact, temporary diagnostic shown while the first sync is in progress. */
function SyncDebug() {
  const phase = useLiveQuery(() => db.meta.get('sync-phase'));
  const profiles = useLiveQuery(() => db.profiles.count()) ?? 0;
  const places = useLiveQuery(() => db.places.count()) ?? 0;
  const p = (phase?.value as { phase?: string } | undefined)?.phase ?? '(no tick yet)';
  return (
    <div className="mt-3 text-[10px] text-ink-600 tabular leading-relaxed">
      <div>online: {String(navigator.onLine)} · phase: {p}</div>
      <div>profiles: {profiles} · places: {places}</div>
    </div>
  );
}

/**
 * One-time, per-member welcome step. Everyone confirms a daily habit.
 * Shows only when not previously completed for this identity.
 */
export function FirstRun({ onDone }: { onDone: () => void }) {
  const session = useSession();
  const myId = session.identity!;
  const profile = useMyProfile();
  const syncError = useSyncError();
  const [habit, setHabit] = useState('');
  const [saving, setSaving] = useState(false);
  const [slow, setSlow] = useState(false);
  const [debugTaps, setDebugTaps] = useState(0);

  // Only surface a "taking a while" hint after a generous window, since the
  // first sync can take time on a phone. A real error (syncError) shows
  // immediately regardless.
  useEffect(() => {
    if (profile) return;
    const t = window.setTimeout(() => setSlow(true), 30_000);
    return () => window.clearTimeout(t);
  }, [profile]);

  // Wait for profile to load before prefilling — but never hang forever.
  if (!profile) {
    // A genuine failure (bad token / unreachable) — show it with actions.
    if (syncError) {
      return (
        <Overlay>
          <GlassCard className="text-center max-w-sm">
            <div className="text-3xl mb-2">📡</div>
            <div className="font-display text-lg font-semibold mb-1">Couldn't load your data</div>
            <p className="text-sm text-ink-600">{syncError.message}</p>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => { setSlow(false); retrySync(); }}
                className="flex-1 rounded-full bg-ink-900 text-white text-sm font-medium py-2.5 active:scale-[0.98] transition"
              >
                Try again
              </button>
              <button
                type="button"
                onClick={() => session.signOut()}
                className="flex-1 rounded-full bg-white/70 text-ink-700 text-sm font-medium py-2.5 ring-1 ring-white/80"
              >
                Sign out
              </button>
            </div>
          </GlassCard>
        </Overlay>
      );
    }
    // No error yet — still pulling. Reassure rather than alarm.
    return (
      <Overlay>
        <GlassCard className="text-center text-ink-600">
          {/* Five taps reveals the sync diagnostics. They're genuinely useful
              when something is stuck, but showing raw phase strings to a kid
              waiting for the app to open just looks broken. */}
          <button
            type="button"
            onClick={() => setDebugTaps((n) => n + 1)}
            className="mb-1 w-full"
          >
            Getting things ready…
          </button>
          {slow && (
            <div className="text-xs text-ink-600">First sync can take a moment on a new device.</div>
          )}
          {debugTaps >= 5 && <SyncDebug />}
        </GlassCard>
      </Overlay>
    );
  }

  const habitValue = habit || profile.habit?.label || '';

  async function finish() {
    setSaving(true);
    try {
      const updated = {
        ...profile!,
        habit: habitValue.trim()
          ? { label: habitValue.trim(), emoji: profile!.habit?.emoji ?? '✅' }
          : profile!.habit,
      };
      await db.profiles.put(updated);
      await enqueue({
        id: `profile-${myId}-${uid()}`,
        enqueuedAt: new Date().toISOString(),
        op: {
          kind: 'put-file',
          path: `profiles/${myId}.json`,
          contentBase64: textToBase64(JSON.stringify(updated)),
          commitMessage: 'first-run setup',
        },
      });
      localStorage.setItem(`tideline-firstrun-${myId}`, '1');
      onDone();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Overlay>
      <motion.div
        initial={{ y: 30, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        className="w-[min(100%,430px)]"
      >
        <GlassCard className="!py-7">
          <div className="text-center mb-5">
            <div className="font-display text-2xl font-semibold">Welcome, {profile.displayName}!</div>
            <div className="text-ink-600 text-sm mt-1">One quick thing before we start.</div>
          </div>

          <div className="mb-6">
            <div className="text-xs uppercase tracking-wider text-ink-600 mb-1">
              {profile.habit?.emoji ?? '🔥'} Your daily habit
            </div>
            <input
              value={habitValue}
              onChange={(e) => setHabit(e.target.value)}
              placeholder="e.g. 20 min reading"
              className="w-full rounded-2xl bg-white/80 px-4 py-3 text-base outline-none ring-1 ring-white/80 focus:ring-ocean/40"
            />
            <div className="mt-1.5 text-xs text-ink-500">Tap it each day to earn points + build a streak.</div>
          </div>

          <button
            type="button"
            disabled={saving}
            onClick={() => void finish()}
            className="w-full rounded-full bg-ink-900 text-white font-medium py-3 active:scale-[0.98] transition"
          >
            {saving ? 'Saving…' : "Let's go"}
          </button>
        </GlassCard>
      </motion.div>
    </Overlay>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm grid place-items-center p-4">
      {children}
    </div>
  );
}

/** Whether the first-run step still needs to be shown for this member. */
export function needsFirstRun(identity: string | null): boolean {
  if (!identity) return false;
  return localStorage.getItem(`tideline-firstrun-${identity}`) !== '1';
}
