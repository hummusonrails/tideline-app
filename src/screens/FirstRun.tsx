import { useState } from 'react';
import { motion } from 'motion/react';
import { db } from '../lib/db';
import { useSession } from '../state/session';
import { useMyProfile } from '../lib/profile';
import { enqueue } from '../lib/sync';
import { uid } from '../lib/uuid';
import { textToBase64 } from '../lib/github';
import { GlassCard } from '../ui/GlassCard';

/**
 * One-time, per-member welcome step. Everyone confirms a daily habit.
 * Shows only when not previously completed for this identity.
 */
export function FirstRun({ onDone }: { onDone: () => void }) {
  const session = useSession();
  const myId = session.identity!;
  const profile = useMyProfile();
  const [habit, setHabit] = useState('');
  const [saving, setSaving] = useState(false);

  // Wait for profile to load before prefilling.
  if (!profile) {
    return (
      <Overlay>
        <GlassCard className="text-center text-ink-600">Getting things ready…</GlassCard>
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
            <div className="text-xs uppercase tracking-wider text-ink-400 mb-1">
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
