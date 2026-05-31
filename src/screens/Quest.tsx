import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Page } from '../ui/Page';
import { GlassCard } from '../ui/GlassCard';
import { PillButton } from '../ui/PillButton';
import { TierBadge } from '../ui/TierBadge';
import { Avatar } from '../ui/Avatar';
import { db } from '../lib/db';
import { useSession } from '../state/session';
import { useMyProfile, useAvatarSrc } from '../lib/profile';
import {
  DEFAULT_CONFIG,
  totalPoints,
  currentTier,
  nextTier,
  leaderboard as buildLeaderboard,
  hasCompletedChallenge,
} from '../lib/points';
import { todayYMD } from '../lib/time';
import { enqueue } from '../lib/sync';
import { awardPoints, EARN, CAPS } from '../lib/award';
import { uid } from '../lib/uuid';
import { completionPath, photoBinaryPath, photoSidecarPath } from '../lib/paths';
import { textToBase64 } from '../lib/github';
import { compressForPost, blobToBase64 } from '../lib/compress';
import { Camera, CheckCircle2, Check, X } from 'lucide-react';
import type { Challenge, ChallengeCompletion, Photo, Trivia, MemberId } from '../types';

type Tab = 'leaderboard' | 'challenges' | 'prizes';

export function Quest() {
  const session = useSession();
  const myId = session.identity!;
  const myProfile = useMyProfile();
  const myAvatar = useAvatarSrc(myId);
  const [tab, setTab] = useState<Tab>('leaderboard');

  return (
    <Page eyebrow="Quest" title="Compete & earn" avatarSeed={myId} avatarDisplayName={myProfile?.displayName} avatarSrc={myAvatar}>
      <div className="flex gap-2">
        <PillButton active={tab === 'leaderboard'} onClick={() => setTab('leaderboard')}>Leaderboard</PillButton>
        <PillButton active={tab === 'challenges'} onClick={() => setTab('challenges')}>Challenges</PillButton>
        <PillButton active={tab === 'prizes'} onClick={() => setTab('prizes')}>Prizes</PillButton>
      </div>
      {tab === 'leaderboard' && <Leaderboard myId={myId} />}
      {tab === 'challenges' && <Challenges myId={myId} />}
      {tab === 'prizes' && <Prizes myId={myId} />}
    </Page>
  );
}

function LeaderboardRow({ rank, memberId, name, points, children }: {
  rank: number; memberId: string; name: string; points: number; children: React.ReactNode;
}) {
  const avatar = useAvatarSrc(memberId);
  return (
    <GlassCard className="flex items-center gap-3">
      <div className="tabular text-sm text-ink-500 w-5 text-center">{rank}</div>
      <Avatar seed={memberId} displayName={name} src={avatar} size={40} />
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{name}</div>
        {children}
      </div>
      <div className="text-right">
        <div className="font-display text-xl tabular font-semibold">{points}</div>
      </div>
    </GlassCard>
  );
}

function Leaderboard({ myId }: { myId: MemberId }) {
  const profiles = useLiveQuery(() => db.profiles.toArray()) ?? [];
  const events = useLiveQuery(() => db.pointEvents.toArray()) ?? [];
  const rows = useMemo(() => buildLeaderboard(events, profiles.map((p) => p.id)), [events, profiles]);
  const byId = useMemo(() => Object.fromEntries(profiles.map((p) => [p.id, p])), [profiles]);

  if (profiles.length === 0) {
    return <GlassCard className="text-ink-600 text-sm text-center">No members synced yet.</GlassCard>;
  }

  return (
    <div className="space-y-3">
      {rows.map((r, i) => {
        const p = byId[r.member];
        const next = nextTier(r.points, DEFAULT_CONFIG);
        return (
          <LeaderboardRow
            key={r.member}
            rank={i + 1}
            memberId={r.member}
            name={p?.displayName ?? '—'}
            points={r.points}
          >
            <div className="flex items-center gap-2 mt-0.5">
              <TierBadge tier={r.tier} />
              <span className="text-xs text-ink-600">
                {next ? `${next.remaining} to ${next.tier}` : 'max tier'}
              </span>
              {r.member === myId && <span className="text-[11px] text-ocean">you</span>}
            </div>
          </LeaderboardRow>
        );
      })}
    </div>
  );
}

function Challenges({ myId }: { myId: MemberId }) {
  const today = todayYMD();
  const challenges = useLiveQuery(() => db.challenges.toArray()) ?? [];
  const completions = useLiveQuery(() => db.completions.where('by').equals(myId).toArray(), [myId]) ?? [];
  const [claim, setClaim] = useState<Challenge | null>(null);

  const active = challenges
    .filter((c) => c.activeFrom <= today && c.activeUntil >= today)
    .sort((a, b) => b.points - a.points);
  const upcoming = challenges
    .filter((c) => c.activeFrom > today)
    .sort((a, b) => a.activeFrom.localeCompare(b.activeFrom));

  return (
    <>
      <Section title="Active now">
        {active.length === 0 ? (
          <GlassCard className="text-ink-600 text-sm text-center">Nothing active right now.</GlassCard>
        ) : (
          active.map((c) => (
            <ChallengeRow
              key={c.id}
              challenge={c}
              done={hasCompletedChallenge(completions, myId, c.id)}
              onClaim={() => setClaim(c)}
            />
          ))
        )}
      </Section>
      {upcoming.length > 0 && (
        <Section title="Coming up">
          {upcoming.slice(0, 6).map((c) => (
            <ChallengeRow key={c.id} challenge={c} done={false} locked />
          ))}
        </Section>
      )}

      <AnimatePresence>
        {claim && <ClaimModal challenge={claim} myId={myId} onClose={() => setClaim(null)} />}
      </AnimatePresence>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="text-xs uppercase tracking-wider text-ink-400 px-1">{title}</div>
      {children}
    </div>
  );
}

function ChallengeRow({
  challenge,
  done,
  locked,
  onClaim,
}: {
  challenge: Challenge;
  done: boolean;
  locked?: boolean;
  onClaim?: () => void;
}) {
  return (
    <GlassCard className="flex items-center gap-3">
      <div className="text-2xl">{challenge.icon}</div>
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{challenge.title}</div>
        <div className="text-xs text-ink-600 line-clamp-2">{challenge.description}</div>
      </div>
      <div className="text-right shrink-0">
        <div className="tabular text-sage-700 font-semibold">
          +{challenge.points}{challenge.bonusPoints ? `+${challenge.bonusPoints}` : ''}
        </div>
        <div className="mt-1">
          {done ? (
            <span className="inline-flex items-center gap-1 text-xs text-sage-700"><CheckCircle2 size={14} /> done</span>
          ) : locked ? (
            <span className="text-xs text-ink-400">soon</span>
          ) : (
            <button
              type="button"
              onClick={onClaim}
              className="text-xs rounded-full px-3 py-1.5 bg-ink-900 text-white active:scale-95 transition inline-flex items-center gap-1"
            >
              {challenge.proofType === 'photo'
                ? <><Camera size={12} /> claim</>
                : challenge.proofType === 'trivia' ? 'quiz' : 'claim'}
            </button>
          )}
        </div>
      </div>
    </GlassCard>
  );
}

// ---- Claim flow ----

function ClaimModal({ challenge, myId, onClose }: { challenge: Challenge; myId: MemberId; onClose: () => void }) {
  return (
    <motion.div
      className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="w-[min(100%,430px)] glass rounded-t-[28px] sm:rounded-[28px] p-5 pb-8"
        initial={{ y: 40 }}
        animate={{ y: 0 }}
        exit={{ y: 40 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-4">
          <div className="text-3xl">{challenge.icon}</div>
          <div className="flex-1">
            <div className="font-display text-lg font-semibold">{challenge.title}</div>
            <div className="text-sm text-ink-600">{challenge.description}</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-ink-400 p-1"><X size={18} /></button>
        </div>

        {challenge.proofType === 'trivia' ? (
          <TriviaClaim challenge={challenge} myId={myId} onDone={onClose} />
        ) : challenge.proofType === 'photo' ? (
          <PhotoClaim challenge={challenge} myId={myId} onDone={onClose} />
        ) : (
          <CheckboxClaim challenge={challenge} myId={myId} onDone={onClose} />
        )}
      </motion.div>
    </motion.div>
  );
}

function CheckboxClaim({ challenge, myId, onDone }: { challenge: Challenge; myId: MemberId; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await completeChallenge(challenge, myId, { awardedPoints: challenge.points });
        onDone();
      }}
      className="w-full rounded-full bg-ink-900 text-white font-medium py-3 active:scale-[0.98] transition"
    >
      {busy ? 'Saving…' : `Mark done · +${challenge.points}`}
    </button>
  );
}

function PhotoClaim({ challenge, myId, onDone }: { challenge: Challenge; myId: MemberId; onDone: () => void }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const result = await compressForPost(file);

      // Excursion-locked: enforce EXIF time window when EXIF is present.
      if (challenge.excursionStartISO && challenge.excursionEndISO && result.exifPresent) {
        const t = Date.parse(result.takenAt);
        const start = Date.parse(challenge.excursionStartISO);
        const end = Date.parse(challenge.excursionEndISO);
        if (t < start || t > end) {
          setError('That photo was taken outside the excursion window. Use a photo from the activity.');
          setBusy(false);
          return;
        }
      }

      // Post the photo to the album.
      const photoId = await postProofPhoto(result, myId, challenge.placeSlug);
      // Standard photo point (capped) + the challenge award.
      await awardPoints({ to: myId, by: myId, amount: EARN.photo, reason: 'photo', refId: photoId, dailyCap: CAPS.photoPerDay });
      await completeChallenge(challenge, myId, { proofPhotoId: photoId, awardedPoints: challenge.points + (challenge.bonusPoints ?? 0) });
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <div>
      {challenge.excursionStartISO && (
        <div className="text-xs text-ink-500 mb-3">
          Photo must be taken during the activity (EXIF time is checked when available).
        </div>
      )}
      {error && <div className="text-coral text-sm mb-3">{error}</div>}
      <button
        type="button"
        disabled={busy}
        onClick={() => fileInput.current?.click()}
        className="w-full rounded-full bg-ink-900 text-white font-medium py-3 active:scale-[0.98] transition inline-flex items-center justify-center gap-2"
      >
        <Camera size={16} /> {busy ? 'Uploading…' : `Add proof photo · +${challenge.points}`}
      </button>
      <input ref={fileInput} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFile} />
    </div>
  );
}

function TriviaClaim({ challenge, myId, onDone }: { challenge: Challenge; myId: MemberId; onDone: () => void }) {
  const place = useLiveQuery(
    () => (challenge.triviaPlaceSlug ? db.places.get(challenge.triviaPlaceSlug) : undefined),
    [challenge.triviaPlaceSlug],
  );
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);

  if (place === undefined) return <div className="text-ink-600 text-sm py-4 text-center">Loading…</div>;
  if (!place || place.trivia.length === 0)
    return <div className="text-ink-600 text-sm py-4 text-center">No trivia available.</div>;

  const allAnswered = place.trivia.every((_, i) => answers[i] !== undefined);
  const correctCount = place.trivia.filter((q, i) => answers[i] === q.answer).length;
  const earned = correctCount * challenge.points; // points per correct

  async function submit() {
    setBusy(true);
    setSubmitted(true);
    const triviaAnswers = place!.trivia.map((_, i) => answers[i] ?? -1);
    await completeChallenge(challenge, myId, {
      triviaAnswers,
      triviaCorrect: correctCount,
      awardedPoints: earned,
      reason: 'trivia',
    });
    setBusy(false);
  }

  return (
    <div className="space-y-4 max-h-[60dvh] overflow-y-auto scroll-clean">
      {place.trivia.map((q: Trivia, qi) => (
        <div key={qi}>
          <div className="font-medium text-sm mb-2">{q.q}</div>
          <div className="space-y-2">
            {q.options.map((opt, oi) => {
              const picked = answers[qi] === oi;
              const reveal = submitted;
              const isCorrect = oi === q.answer;
              const cls = !reveal
                ? picked ? 'bg-ink-900 text-white' : 'glass text-ink-900'
                : isCorrect ? 'bg-sage-200 text-sage-700 ring-1 ring-sage-300'
                : picked ? 'bg-coral/15 text-coral ring-1 ring-coral/30'
                : 'bg-white/40 text-ink-500';
              return (
                <button
                  key={oi}
                  type="button"
                  disabled={submitted}
                  onClick={() => setAnswers((a) => ({ ...a, [qi]: oi }))}
                  className={`w-full text-left text-sm rounded-2xl px-4 py-2.5 flex items-center justify-between transition ${cls}`}
                >
                  <span>{opt}</span>
                  {reveal && isCorrect && <Check size={16} />}
                  {reveal && picked && !isCorrect && <X size={16} />}
                </button>
              );
            })}
          </div>
          {submitted && <div className="text-xs text-ink-600 mt-1.5">{q.explanation}</div>}
        </div>
      ))}

      {!submitted ? (
        <button
          type="button"
          disabled={!allAnswered || busy}
          onClick={() => void submit()}
          className="w-full rounded-full bg-ink-900 text-white font-medium py-3 disabled:opacity-40 active:scale-[0.98] transition"
        >
          Submit answers
        </button>
      ) : (
        <button
          type="button"
          onClick={onDone}
          className="w-full rounded-full bg-sage-200 text-sage-700 font-medium py-3"
        >
          {correctCount}/{place.trivia.length} correct · +{earned} points
        </button>
      )}
    </div>
  );
}

function Prizes({ myId }: { myId: MemberId }) {
  const events = useLiveQuery(() => db.pointEvents.where('to').equals(myId).toArray(), [myId]) ?? [];
  const points = totalPoints(events, myId);
  const cfg = DEFAULT_CONFIG;
  const cur = currentTier(points, cfg);

  return (
    <div className="space-y-3">
      <GlassCard className="text-center bg-gradient-to-br from-sage-100/60 to-white/50">
        <div className="text-3xl mb-1">🎁</div>
        <div className="font-display text-lg font-semibold">Climb the tiers</div>
        <div className="text-sm text-ink-600 mt-1">
          Every level unlocks a little something. The higher you climb, the better the surprise.
        </div>
      </GlassCard>

      {cfg.tiers.map((t) => {
        const reached = points >= t.threshold;
        const isCurrent = cur === t.tier;
        const pct = Math.min(100, Math.round((points / t.threshold) * 100));
        return (
          <GlassCard key={t.tier} className={reached ? '' : 'opacity-90'}>
            <div className="flex items-center justify-between">
              <TierBadge tier={t.tier} />
              <div className="tabular text-sm text-ink-600">{t.threshold} pts</div>
            </div>
            <div className="mt-2 font-medium">{t.rewardLabel}</div>
            <div className="mt-2 h-2 rounded-full bg-white/50 overflow-hidden">
              <div className="h-full bg-sage-400 rounded-full" style={{ width: `${reached ? 100 : pct}%` }} />
            </div>
            {isCurrent && <div className="mt-1 text-xs text-ocean">You're here</div>}
            {reached && <div className="mt-1 text-xs text-sage-700">Unlocked ✓</div>}
          </GlassCard>
        );
      })}
    </div>
  );
}

// ---- write helpers ----

async function completeChallenge(
  c: Challenge,
  by: MemberId,
  opts: { proofPhotoId?: string; triviaAnswers?: number[]; triviaCorrect?: number; awardedPoints: number; reason?: 'challenge' | 'trivia' },
) {
  const now = new Date();
  const compId = uid();
  const completion: ChallengeCompletion = {
    id: compId,
    challengeId: c.id,
    by,
    completedAt: now.toISOString(),
    proofPhotoId: opts.proofPhotoId,
    triviaAnswers: opts.triviaAnswers,
    triviaCorrect: opts.triviaCorrect,
    awardedPoints: opts.awardedPoints,
  };
  await db.completions.put(completion);
  await enqueue({
    id: `comp-${compId}`,
    enqueuedAt: now.toISOString(),
    op: {
      kind: 'put-file',
      path: completionPath(completion),
      contentBase64: textToBase64(JSON.stringify(completion)),
      commitMessage: 'challenge complete',
    },
  });
  if (opts.awardedPoints > 0) {
    await awardPoints({ to: by, by, amount: opts.awardedPoints, reason: opts.reason ?? 'challenge', refId: c.id });
  }
}

async function postProofPhoto(
  result: Awaited<ReturnType<typeof compressForPost>>,
  by: MemberId,
  placeSlug?: string,
): Promise<string> {
  const now = new Date();
  const id = uid();
  const photo: Photo = {
    id,
    from: by,
    takenAt: result.takenAt,
    uploadedAt: now.toISOString(),
    caption: undefined,
    placeSlug,
    filePath: '',
    width: result.width,
    height: result.height,
    bytes: result.bytes,
    exifPresent: result.exifPresent,
  };
  const jpgPath = photoBinaryPath(photo);
  const sidecarPath = photoSidecarPath(photo);
  photo.filePath = jpgPath;
  await db.photos.put(photo);
  await db.photoBlobs.put({ photoId: id, bytes: result.file });
  await enqueue({
    id: `${id}-bin`,
    enqueuedAt: now.toISOString(),
    op: { kind: 'put-file', path: jpgPath, contentBase64: await blobToBase64(result.file), commitMessage: 'add photo' },
  });
  await enqueue({
    id: `${id}-meta`,
    enqueuedAt: now.toISOString(),
    op: { kind: 'put-file', path: sidecarPath, contentBase64: textToBase64(JSON.stringify(photo)), commitMessage: 'add photo metadata' },
  });
  return id;
}
