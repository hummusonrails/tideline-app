import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { LockKeyhole, ArrowRight, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { Avatar, gradientFor } from '../ui/Avatar';
import { GlassCard } from '../ui/GlassCard';
import { PillButton } from '../ui/PillButton';
import { useSession } from '../state/session';
import { decryptSecret, type EncryptedBundle } from '../lib/crypto';
import { getBranch, GHError } from '../lib/github';
import { shouldAttemptNetwork } from '../lib/net';
import type { MemberManifest, MemberId } from '../types';

export function Onboarding() {
  const session = useSession();
  const [manifest, setManifest] = useState<MemberManifest | null>(null);
  const [pickedId, setPickedId] = useState<MemberId | null>(null);
  const [passphrase, setPassphrase] = useState('');
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const base = import.meta.env.BASE_URL || '/';
    fetch(`${base}users/manifest.json`, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('manifest missing'))))
      .then(setManifest)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  async function unlock() {
    if (!pickedId) return;
    setSubmitting(true);
    setError(null);
    try {
      const base = import.meta.env.BASE_URL || '/';
      const res = await fetch(`${base}users/${pickedId}.enc`, { cache: 'no-cache' });
      if (!res.ok) throw new Error('slot not found');
      const bundle = (await res.json()) as EncryptedBundle;
      const payload = await decryptSecret(bundle, passphrase);

      // Validate the credentials can actually reach the backend before we
      // commit to a session — otherwise a wrong token/owner/repo only shows
      // up later as a silent background sync failure.
      // `navigator.onLine` is true on a captive-portal WiFi, which would make
      // every at-sea unlock wait out a doomed request before proceeding.
      if (shouldAttemptNetwork()) {
        try {
          await getBranch({ owner: payload.owner, repo: payload.repo, token: payload.pat, branch: 'main' });
        } catch (ve: unknown) {
          // Diagnostic: show exactly which backend + status failed so a
          // typo'd owner/repo or token issue is obvious at a glance.
          const where = `${payload.owner}/${payload.repo}`;
          if (ve instanceof GHError && ve.status === 401) {
            throw new Error(`Token rejected (401) for ${where}. The saved access token is invalid — regenerate this member's code.`);
          }
          if (ve instanceof GHError && ve.status === 404) {
            throw new Error(`Can't find ${where} (404). The token can't see that repo — check the owner/repo are spelled exactly right and the token has that repo selected.`);
          }
          if (ve instanceof GHError && ve.status === 403) {
            throw new Error(`Access denied to ${where} (403). The token is missing a permission (needs Contents: Read and write).`);
          }
          // Network/other: allow sign-in (offline-first); sync will retry.
        }
      }

      session.signIn(pickedId, payload.pat, payload.owner, payload.repo);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  if (!manifest) {
    return (
      <div className="min-h-dvh grid place-items-center p-6 text-ink-600">
        {error ? <ErrorBlock message={error} /> : <div>Loading…</div>}
      </div>
    );
  }

  return (
    <div className="min-h-dvh px-5 pt-[max(env(safe-area-inset-top),2rem)] pb-10">
      <div className="text-center mb-8">
        <div className="font-display text-3xl font-semibold">Welcome back</div>
        <div className="text-ink-600 text-sm mt-1">Choose your slot, then unlock with your passphrase.</div>
      </div>

      <AnimatePresence mode="wait">
        {!pickedId ? (
          <motion.div
            key="picker"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="grid grid-cols-2 gap-4"
          >
            {manifest.slots.map((slot) => (
              <button
                key={slot.id}
                type="button"
                onClick={() => setPickedId(slot.id)}
                className="glass rounded-[28px] p-5 flex flex-col items-center gap-3 active:scale-[0.98] transition"
              >
                {slot.emoji ? (
                  <div
                    className="grid h-[72px] w-[72px] place-items-center rounded-full text-4xl ring-1 ring-white shadow-md"
                    style={{ background: gradientFor(slot.avatarSeed) }}
                  >
                    {slot.emoji}
                  </div>
                ) : (
                  <Avatar seed={slot.avatarSeed} size={72} noCrew />
                )}
                <span className="font-medium text-ink-700">
                  {slot.emoji ? 'Tap to unlock' : `Slot ${slot.id.slice(0, 4)}`}
                </span>
              </button>
            ))}
          </motion.div>
        ) : (
          <motion.div
            key="unlock"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
          >
            <GlassCard className="text-center">
              <div className="flex justify-center mb-3">
                {(() => {
                  const slot = manifest.slots.find((s) => s.id === pickedId)!;
                  return slot.emoji ? (
                    <div
                      className="grid h-[84px] w-[84px] place-items-center rounded-full text-5xl ring-1 ring-white shadow-md"
                      style={{ background: gradientFor(slot.avatarSeed) }}
                    >
                      {slot.emoji}
                    </div>
                  ) : (
                    <Avatar seed={slot.avatarSeed} size={84} noCrew />
                  );
                })()}
              </div>
              <div className="font-medium text-ink-700 mb-5">Enter your passphrase</div>
              <div className="relative">
                <LockKeyhole
                  size={18}
                  className="absolute left-4 top-1/2 -translate-y-1/2 text-ink-400"
                  strokeWidth={1.75}
                />
                <input
                  type={showPassphrase ? 'text' : 'password'}
                  autoFocus
                  inputMode="text"
                  autoComplete="current-password"
                  // iOS autocorrect and auto-capitalisation happily "fix" a
                  // passphrase into something that won't decrypt, and the only
                  // feedback is a wrong-passphrase error.
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={passphrase}
                  onChange={(e) => setPassphrase(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void unlock();
                  }}
                  className="w-full rounded-full bg-white/80 pl-11 pr-12 py-3 text-base outline-none ring-1 ring-white/80 focus:ring-ocean/40"
                  placeholder="Passphrase"
                />
                <button
                  type="button"
                  onClick={() => setShowPassphrase((v) => !v)}
                  aria-label={showPassphrase ? 'Hide passphrase' : 'Show passphrase'}
                  className="absolute right-3 top-1/2 -translate-y-1/2 grid h-8 w-8 place-items-center rounded-full text-ink-600"
                >
                  {showPassphrase ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              {error && (
                <div className="mt-3 text-coral text-sm flex items-center justify-center gap-1.5">
                  <AlertCircle size={14} /> {error}
                </div>
              )}
              <div className="mt-5 flex items-center justify-between">
                <PillButton onClick={() => { setPickedId(null); setPassphrase(''); setError(null); }}>
                  Back
                </PillButton>
                <PillButton
                  variant="solid"
                  active={false}
                  disabled={submitting || passphrase.length < 4}
                  onClick={() => void unlock()}
                  icon={<ArrowRight size={16} />}
                >
                  {submitting ? 'Unlocking…' : 'Unlock'}
                </PillButton>
              </div>
            </GlassCard>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ErrorBlock({ message }: { message: string }) {
  return (
    <div className="glass rounded-2xl p-5 max-w-sm text-center">
      <AlertCircle className="mx-auto mb-2 text-coral" />
      <div className="text-ink-900 font-medium mb-1">Setup needed</div>
      <div className="text-ink-600 text-sm">{message}</div>
    </div>
  );
}
