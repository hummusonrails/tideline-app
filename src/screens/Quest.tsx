import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Page } from '../ui/Page';
import { GlassCard } from '../ui/GlassCard';
import { PillButton } from '../ui/PillButton';
import { TierBadge } from '../ui/TierBadge';
import { Avatar } from '../ui/Avatar';
import { Podium } from '../ui/Podium';
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
import { awardPoints, giftPoint, EARN, CAPS } from '../lib/award';
import { uid } from '../lib/uuid';
import { completionPath } from '../lib/paths';
import { textToBase64 } from '../lib/github';
import { compressForPost } from '../lib/compress';
import { postPhoto } from '../lib/photoPost';
import {
  huntProgress,
  isHuntVisible,
  sortHunts,
  completedStageCount,
  isHuntComplete,
  type HuntContext,
  type StageState,
} from '../lib/hunts';
import {
  canSendKudos, kudosRemaining, goalProgress, KUDOS_POINTS, MAX_NOTE_LENGTH,
} from '../lib/kudos';
import { Camera, CheckCircle2, Check, X } from 'lucide-react';
import type {
  Challenge, ChallengeCompletion, Trivia, MemberId, Hunt, PointEvent, CrewGoal,
} from '../types';

type Tab = 'leaderboard' | 'challenges' | 'hunts' | 'prizes';

export function Quest() {
  const session = useSession();
  const myId = session.identity!;
  const myProfile = useMyProfile();
  const myAvatar = useAvatarSrc(myId);
  const [tab, setTab] = useState<Tab>('leaderboard');
  const newHunts = useNewHuntCount(myId);

  return (
    <Page eyebrow="Quest" title="Compete & earn" avatarSeed={myId} avatarDisplayName={myProfile?.displayName} avatarSrc={myAvatar}>
      {/* Four pills no longer fit a phone width — let the row scroll rather
          than shrinking the labels into initials. */}
      <div className="flex gap-2 overflow-x-auto scroll-clean -mx-4 px-4 pb-1">
        <PillButton active={tab === 'leaderboard'} onClick={() => setTab('leaderboard')}>Leaderboard</PillButton>
        <PillButton active={tab === 'challenges'} onClick={() => setTab('challenges')}>Challenges</PillButton>
        <PillButton active={tab === 'hunts'} onClick={() => setTab('hunts')} className="relative shrink-0">
          Hunts
          {newHunts > 0 && (
            <span className="ml-1 grid h-5 min-w-5 place-items-center rounded-full bg-coral px-1 text-[10px] font-semibold text-white">
              {newHunts}
            </span>
          )}
        </PillButton>
        <PillButton active={tab === 'prizes'} onClick={() => setTab('prizes')}>Prizes</PillButton>
      </div>
      {tab === 'leaderboard' && <Leaderboard myId={myId} />}
      {tab === 'challenges' && <Challenges myId={myId} />}
      {tab === 'hunts' && <Hunts myId={myId} />}
      {tab === 'prizes' && <Prizes myId={myId} />}
    </Page>
  );
}

/**
 * Live hunt context, shared by the Quest tab and the Today card.
 *
 * Presence comes from today's itinerary rows, never from geolocation — see
 * the note in lib/hunts.ts.
 */
function useHuntContext(myId: MemberId): { hunts: Hunt[]; ctx: HuntContext } {
  const today = todayYMD();
  const hunts = useLiveQuery(() => db.hunts.toArray(), []) ?? [];
  const profiles = useLiveQuery(() => db.profiles.toArray(), []) ?? [];
  const completions = useLiveQuery(() => db.completions.toArray(), []) ?? [];
  const todayItinerary =
    useLiveQuery(() => db.itinerary.where('date').equals(today).toArray(), [today]) ?? [];

  const ctx = useMemo<HuntContext>(
    () => ({ today, now: new Date(), todayItinerary, profiles, completions, member: myId }),
    [today, todayItinerary, profiles, completions, myId],
  );
  return { hunts, ctx };
}

/** Visible hunts with an unsolved, unlocked stage waiting. */
export function useOpenHunts(myId: MemberId): { hunt: Hunt; states: StageState[] }[] {
  const { hunts, ctx } = useHuntContext(myId);
  return useMemo(() => {
    const visible = hunts
      .filter((h) => isHuntVisible(h, ctx))
      .map((hunt) => ({ hunt, states: huntProgress(hunt, ctx) }));
    return sortHunts(visible).filter(({ states }) => states.some((s) => s.status === 'open'));
  }, [hunts, ctx]);
}

/** Count of visible hunts nobody has touched yet — the "look here" badge. */
function useNewHuntCount(myId: MemberId): number {
  const { hunts, ctx } = useHuntContext(myId);
  return useMemo(
    () =>
      hunts.filter(
        (h) =>
          isHuntVisible(h, ctx) &&
          huntProgress(h, ctx).every((s) => s.status !== 'done') &&
          huntProgress(h, ctx).some((s) => s.status === 'open'),
      ).length,
    [hunts, ctx],
  );
}

function Hunts({ myId }: { myId: MemberId }) {
  const navigate = useNavigate();
  const { hunts, ctx } = useHuntContext(myId);

  const visible = useMemo(() => {
    const rows = hunts
      .filter((h) => isHuntVisible(h, ctx))
      .map((hunt) => ({ hunt, states: huntProgress(hunt, ctx) }));
    return sortHunts(rows);
  }, [hunts, ctx]);

  if (visible.length === 0) {
    return (
      <GlassCard className="text-ink-600 text-sm text-center">
        No hunts open right now. They appear where — and when — they're meant to. 🗺️
      </GlassCard>
    );
  }

  return (
    <div className="space-y-3">
      {visible.map(({ hunt, states }) => {
        const done = completedStageCount(states);
        const finished = isHuntComplete(states);
        const locked = !finished && !states.some((s) => s.status === 'open');
        const lockedState = states.find((s) => s.status === 'locked');
        return (
          <button
            key={hunt.id}
            type="button"
            onClick={() => navigate(`/hunt/${hunt.id}`)}
            className="w-full text-left active:scale-[0.99] transition"
          >
            <GlassCard className="flex items-center gap-3">
              <div className="text-2xl shrink-0">{hunt.icon}</div>
              <div className="flex-1 min-w-0">
                <div className="font-medium truncate">{hunt.title}</div>
                <div className="text-xs text-ink-600 truncate">
                  {finished
                    ? 'Complete ✓'
                    : locked && lockedState?.status === 'locked'
                      ? lockedState.reason
                      : `Stage ${done + 1} of ${hunt.stages.length} waiting`}
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-white/50 overflow-hidden">
                  <div
                    className="h-full bg-sage-400 rounded-full"
                    style={{ width: `${Math.round((done / hunt.stages.length) * 100)}%` }}
                  />
                </div>
              </div>
              {hunt.team && hunt.team !== 'all' && (
                <span className="text-[10px] uppercase tracking-wide text-ink-500 shrink-0">
                  {hunt.team}
                </span>
              )}
            </GlassCard>
          </button>
        );
      })}
    </div>
  );
}

function LeaderboardRow({ rank, memberId, name, points, children, onGift }: {
  rank: number; memberId: string; name: string; points: number;
  children: React.ReactNode;
  /** Long-press opens the kudos sheet. Absent on your own row. */
  onGift?: () => void;
}) {
  const avatar = useAvatarSrc(memberId);
  const hold = useRef<number | null>(null);

  const start = () => {
    if (!onGift) return;
    hold.current = window.setTimeout(onGift, 550);
  };
  const cancel = () => {
    if (hold.current !== null) {
      window.clearTimeout(hold.current);
      hold.current = null;
    }
  };
  useEffect(() => cancel, []);

  return (
    <GlassCard
      className={`flex items-center gap-3 ${onGift ? 'select-none' : ''}`}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
    >
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
  const [giftTo, setGiftTo] = useState<{ id: MemberId; name: string } | null>(null);

  if (profiles.length === 0) {
    return <GlassCard className="text-ink-600 text-sm text-center">No members synced yet.</GlassCard>;
  }

  return (
    <div className="space-y-3">
      <Podium
        rows={rows.map((r) => ({
          member: r.member,
          name: byId[r.member]?.displayName ?? '—',
          points: r.points,
          tier: r.tier,
        }))}
        myId={myId}
      />
      <CrewGoalBar events={events} />
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
            onGift={
              r.member === myId ? undefined : () => setGiftTo({ id: r.member, name: p?.displayName ?? 'them' })
            }
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
      <div className="text-center text-xs text-ink-500 px-6">
        Hold someone's name to send them a point.
      </div>

      <AnimatePresence>
        {giftTo && (
          <KudosModal
            to={giftTo.id}
            name={giftTo.name}
            myId={myId}
            events={events}
            onClose={() => setGiftTo(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * The shared bar. Everyone's points, one target, one allusive reward.
 *
 * Purely derived: no records, no conflicts, and it moves whenever anyone
 * scores anything — which is the cooperative pull it's there to create.
 */
function CrewGoalBar({ events }: { events: PointEvent[] }) {
  const goalsRow = useLiveQuery(() => db.meta.get('goals'), []);
  const goals = Array.isArray(goalsRow?.value) ? (goalsRow.value as CrewGoal[]) : [];
  const goal = goals[0];
  if (!goal) return null;

  const { total, pct, reached } = goalProgress(events, goal.target);
  return (
    <GlassCard className="bg-gradient-to-br from-ocean/10 to-white/50">
      <div className="flex items-center justify-between">
        <div className="font-medium text-sm">🤝 {goal.label}</div>
        <div className="tabular text-sm text-ink-600">
          {total} / {goal.target}
        </div>
      </div>
      <div className="mt-2 h-2.5 rounded-full bg-white/50 overflow-hidden">
        <motion.div
          className={`h-full rounded-full ${reached ? 'bg-sage-400' : 'bg-ocean'}`}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ type: 'spring', stiffness: 100, damping: 22 }}
        />
      </div>
      <div className="mt-1.5 text-xs text-ink-600">
        {reached ? `Unlocked — ${goal.rewardLabel} 🎉` : `${goal.rewardLabel}, together, by ${goal.until}`}
      </div>
    </GlassCard>
  );
}

/** Hand someone a point, with the note that makes it mean something. */
function KudosModal({
  to, name, myId, events, onClose,
}: {
  to: MemberId;
  name: string;
  myId: MemberId;
  events: PointEvent[];
  onClose: () => void;
}) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const today = todayYMD();
  const left = kudosRemaining(events, myId, today);
  const balance = totalPoints(events, myId);
  const check = canSendKudos({ events, giver: myId, to, note, date: today });

  async function send() {
    if (busy || !check.ok) return;
    setBusy(true);
    try {
      await giftPoint({ to, by: myId, amount: KUDOS_POINTS, note: note.trim() });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div
      className="fixed inset-0 z-50 bg-black/60 flex items-end sm:items-center justify-center"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="w-[min(100%,430px)] glass rounded-t-[28px] sm:rounded-[28px] p-5 pb-8"
        initial={{ y: 40 }} animate={{ y: 0 }} exit={{ y: 40 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3 mb-4">
          <div className="text-3xl">💝</div>
          <div className="flex-1">
            <div className="font-display text-lg font-semibold">Give {name} a point</div>
            {/* Say plainly that it costs — it comes out of your own score. */}
            <div className="text-sm text-ink-600">
              Comes out of your {balance} · {left} left to give today
            </div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-ink-400 p-1">
            <X size={18} />
          </button>
        </div>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What's it for?"
          maxLength={MAX_NOTE_LENGTH}
          className="w-full rounded-2xl bg-white/70 ring-1 ring-white/80 px-4 py-3 text-[15px] outline-none focus:ring-sage-300"
        />
        {/* Balance and cap problems aren't the note's fault, so show those
            straight away rather than waiting for someone to start typing. */}
        {!check.ok && (note.length > 0 || balance < KUDOS_POINTS || left <= 0) && (
          <div className="text-coral text-xs mt-2">{check.reason}</div>
        )}
        <button
          type="button"
          disabled={busy || !check.ok}
          onClick={() => void send()}
          className="mt-4 w-full rounded-full bg-ink-900 text-white font-medium py-3 disabled:opacity-40 active:scale-[0.98] transition"
        >
          {busy ? 'Sending…' : `Give ${KUDOS_POINTS} of yours`}
        </button>
      </motion.div>
    </motion.div>
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
      <div className="text-xs uppercase tracking-wider text-ink-600 px-1">{title}</div>
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
        {/* Trivia pays per correct answer, so a flat "+15" was simply wrong —
            it under-reported a three-question quiz by 2x. */}
        <div className="tabular text-sage-700 font-semibold">
          {challenge.proofType === 'trivia'
            ? `+${challenge.points} ea`
            : `+${challenge.points}${challenge.bonusPoints ? `+${challenge.bonusPoints}` : ''}`}
        </div>
        <div className="mt-1">
          {done ? (
            <span className="inline-flex items-center gap-1 text-xs text-sage-700"><CheckCircle2 size={14} /> done</span>
          ) : locked ? (
            <span className="text-xs text-ink-600">soon</span>
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

      // Excursion-locked: the photo must carry an EXIF capture time inside
      // the window. EXIF-less images (screenshots, anything forwarded through
      // a messaging app) are rejected rather than waved through — otherwise
      // stripping metadata is the easiest way to beat the window check.
      if (challenge.excursionStartISO && challenge.excursionEndISO) {
        if (!result.exifPresent) {
          setError(
            "That image has no capture time, so we can't tell when it was taken. " +
              'Use a photo straight from the camera roll — screenshots and forwarded ' +
              'images lose their timestamp.',
          );
          setBusy(false);
          return;
        }
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
      const photoId = await postPhoto(result, myId, { placeSlug: challenge.placeSlug });
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
          Photo must be taken during the activity. We check the photo's capture
          time, so screenshots and forwarded images won't count.
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
      {/* No `capture` attribute: on iOS it forces the camera and hides the
          Photo Library option. Proof integrity comes from the EXIF window
          check above, not from forcing a live shot. */}
      <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={onFile} />
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
  // Single source of truth for "already claimed". The UI disables its buttons,
  // but a second tap can land before the live query reports the first write —
  // and every duplicate would mint another award.
  const already = await db.completions
    .where('challengeId').equals(c.id)
    .filter((row) => row.by === by)
    .count();
  if (already > 0) return;

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

