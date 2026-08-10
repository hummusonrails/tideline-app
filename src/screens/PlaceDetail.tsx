import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronLeft, Check, X } from 'lucide-react';
import { db } from '../lib/db';
import { useSession } from '../state/session';
import { useMyProfile } from '../lib/profile';
import { usePlaceImage } from '../lib/places';
import { GlassCard } from '../ui/GlassCard';
import { PillButton } from '../ui/PillButton';
import { todayYMD } from '../lib/time';
import { huntChallengeId, isHuntDone, shouldLockTrivia } from '../lib/hunt';
import { completionPath } from '../lib/paths';
import { textToBase64 } from '../lib/github';
import { enqueue } from '../lib/sync';
import { awardPoints } from '../lib/award';
import { uid } from '../lib/uuid';
import type { ChallengeCompletion, MemberId, Trivia } from '../types';

export function PlaceDetail() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const session = useSession();
  const myProfile = useMyProfile();
  // `db.places.get` resolves `undefined` for a row that isn't there, which is
  // the same value useLiveQuery reports while the query is still running. Map
  // the miss to `null` so the two states are actually distinguishable —
  // otherwise an unknown slug renders "Loading…" forever.
  const place = useLiveQuery(
    async () => (slug ? ((await db.places.get(slug)) ?? null) : null),
    [slug],
  );
  const heroUrl = usePlaceImage(slug);
  const today = todayYMD();
  const completions = useLiveQuery(() => db.completions.toArray(), []) ?? [];
  const challenges = useLiveQuery(() => db.challenges.toArray(), []) ?? [];
  const itinerary = useLiveQuery(() => db.itinerary.where('date').equals(today).toArray(), [today]) ?? [];

  // "Here today" = today's itinerary references this place.
  const isHereToday = !!slug && itinerary.some((i) => i.placeSlug === slug);

  const lockedTrivia = slug && session.identity
    ? shouldLockTrivia({
        placeSlug: slug,
        challenges,
        completions,
        member: session.identity,
        today,
      })
    : null;

  if (!slug) return null;
  if (place === undefined) {
    return (
      <div className="min-h-dvh grid place-items-center text-ink-600">Loading…</div>
    );
  }
  if (place === null) {
    return (
      <div className="min-h-dvh grid place-items-center p-6 text-ink-600 text-center">
        Place not found.
      </div>
    );
  }

  const myNote =
    place.kidsCorner && session.identity ? place.kidsCorner[session.identity] : undefined;

  return (
    <div className="min-h-dvh pb-28">
      {/* Hero with back button overlay */}
      <div className="relative h-[420px] -mt-[max(env(safe-area-inset-top),0px)]">
        {heroUrl ? (
          <img src={heroUrl} alt={place.name} className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-sage-300 to-sage-700" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-black/30" />
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="absolute top-[max(env(safe-area-inset-top),1rem)] left-4 grid h-10 w-10 place-items-center rounded-full glass text-ink-900"
          aria-label="Back"
        >
          <ChevronLeft size={20} strokeWidth={1.75} />
        </button>
        <div className="absolute left-5 right-5 bottom-6">
          <div className="inline-flex items-center gap-1.5 glass rounded-full px-3 py-1 text-xs font-medium text-ink-900 mb-3">
            📍 {place.name}
          </div>
          <h1 className="font-display text-[34px] leading-[1.05] font-semibold tracking-tight text-white drop-shadow-lg">
            {place.name}
          </h1>
          {place.subtitle && (
            <p className="mt-2 text-white/90 text-sm leading-snug">{place.subtitle}</p>
          )}
        </div>
        {place.heroCredit && place.heroCredit !== 'TBD' && (
          <div className="absolute bottom-1 right-2 text-[10px] text-white/60">{place.heroCredit}</div>
        )}
      </div>

      <div className="px-4 -mt-5 space-y-5">
        {/* Intro */}
        <GlassCard>
          <p className="text-[15px] leading-relaxed text-ink-900">{place.intro}</p>
        </GlassCard>

        {/* Did you know */}
        {place.didYouKnow.length > 0 && (
          <section>
            <SectionHeader>Did you know</SectionHeader>
            <div className="space-y-3">
              {place.didYouKnow.map((f, i) => (
                <GlassCard key={i} className="flex gap-3">
                  <div className="text-2xl shrink-0">{f.icon}</div>
                  <div className="text-[14px] leading-relaxed text-ink-900">{f.fact}</div>
                </GlassCard>
              ))}
            </div>
          </section>
        )}

        {/* Hunt for */}
        {place.huntFor.length > 0 && (
          <section>
            <SectionHeader>Hunt for</SectionHeader>
            <GlassCard>
              <ul className="space-y-1">
                {place.huntFor.map((h, i) => (
                  <HuntRow
                    key={i}
                    label={h}
                    slug={place.slug}
                    index={i}
                    done={isHuntDone(completions, session.identity!, place.slug, i)}
                    // Only claimable while you're actually here — otherwise the
                    // whole trip's list could be ticked off on day one from a
                    // hotel room.
                    claimable={isHereToday}
                    myId={session.identity!}
                  />
                ))}
              </ul>
              {!isHereToday && (
                <div className="text-xs text-ink-600 mt-2">
                  Tick these off for points when you're there.
                </div>
              )}
            </GlassCard>
          </section>
        )}

        {/* Trivia */}
        {place.trivia.length > 0 && (
          <section>
            <SectionHeader>Trivia</SectionHeader>
            {lockedTrivia ? (
              // Answers stay hidden while the same questions are worth points
              // in Quest. See shouldLockTrivia.
              <GlassCard className="flex items-center gap-3">
                <div className="text-2xl">🧠</div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">
                    {place.trivia.length} question{place.trivia.length === 1 ? '' : 's'} worth points
                  </div>
                  <div className="text-xs text-ink-600">
                    Take the quiz in Quest first — the answers show up here afterwards.
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => navigate('/quest')}
                  className="text-xs rounded-full px-3 py-1.5 bg-ink-900 text-white shrink-0"
                >
                  Quest
                </button>
              </GlassCard>
            ) : (
              <div className="space-y-3">
                {place.trivia.map((q, i) => (
                  <TriviaCard key={i} q={q} />
                ))}
              </div>
            )}
          </section>
        )}

        {/* Kids corner — personalized */}
        {myNote && (
          <section>
            <SectionHeader>For you{myProfile?.displayName ? `, ${myProfile.displayName}` : ''}</SectionHeader>
            <GlassCard className="bg-gradient-to-br from-white/60 to-sage-100/60">
              <p className="text-[14px] leading-relaxed text-ink-900">{myNote}</p>
            </GlassCard>
          </section>
        )}

        {/* Tags */}
        {place.tags.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-2">
            {place.tags.map((t) => (
              <span
                key={t}
                className="rounded-full bg-white/60 ring-1 ring-white/80 px-3 py-1 text-xs text-ink-700"
              >
                #{t}
              </span>
            ))}
          </div>
        )}

        <div className="pt-2">
          <PillButton onClick={() => navigate(-1)}>Back</PillButton>
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-xs uppercase tracking-wider text-ink-600 mb-2 px-1 font-medium">
      {children}
    </div>
  );
}

const HUNT_POINTS = 10;

/**
 * One tickable hunt-for item.
 *
 * Completions are the existing record type with a synthesised challenge id, so
 * these ride the same sync, dedup and points machinery as authored challenges
 * without inventing a parallel one.
 */
function HuntRow({
  label, slug, index, done, claimable, myId,
}: {
  label: string;
  slug: string;
  index: number;
  done: boolean;
  claimable: boolean;
  myId: MemberId;
}) {
  const [busy, setBusy] = useState(false);

  async function claim() {
    if (done || busy || !claimable) return;
    setBusy(true);
    try {
      await completeHunt(slug, index, label, myId);
    } finally {
      setBusy(false);
    }
  }

  return (
    <li>
      <button
        type="button"
        onClick={() => void claim()}
        disabled={done || busy || !claimable}
        aria-pressed={done}
        className={`w-full flex items-start gap-2 text-left text-[14px] rounded-2xl px-2 py-2 transition ${
          claimable && !done ? 'active:scale-[0.98] hover:bg-white/40' : ''
        } ${done ? 'text-ink-600' : ''}`}
      >
        <span
          className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full ${
            done ? 'bg-sage-400 text-white' : 'ring-1 ring-sage-300 text-transparent'
          }`}
        >
          <Check size={12} />
        </span>
        <span className={`flex-1 ${done ? 'line-through' : ''}`}>{label}</span>
        {!done && claimable && (
          <span className="text-xs text-sage-700 font-semibold shrink-0">+{HUNT_POINTS}</span>
        )}
      </button>
    </li>
  );
}

async function completeHunt(slug: string, index: number, label: string, by: MemberId) {
  const challengeId = huntChallengeId(slug, index);
  // Guard at the write, not just in the UI — a double tap can outrun the
  // live query that disables the button.
  const already = await db.completions
    .where('challengeId').equals(challengeId)
    .filter((c) => c.by === by)
    .count();
  if (already > 0) return;

  const now = new Date();
  const completion: ChallengeCompletion = {
    id: uid(),
    challengeId,
    by,
    completedAt: now.toISOString(),
    awardedPoints: HUNT_POINTS,
  };
  await db.completions.put(completion);
  await enqueue({
    id: `comp-${completion.id}`,
    enqueuedAt: now.toISOString(),
    op: {
      kind: 'put-file',
      path: completionPath(completion),
      contentBase64: textToBase64(JSON.stringify(completion)),
      commitMessage: `hunt: ${label.slice(0, 40)}`,
    },
  });
  await awardPoints({
    to: by, by, amount: HUNT_POINTS, reason: 'challenge', refId: challengeId,
  });
}

function TriviaCard({ q }: { q: Trivia }) {
  const [picked, setPicked] = useState<number | null>(null);
  const revealed = picked !== null;

  return (
    <GlassCard>
      <div className="font-medium mb-3">{q.q}</div>
      <div className="space-y-2">
        {q.options.map((opt, i) => {
          const isCorrect = i === q.answer;
          const isPicked = picked === i;
          const cls = !revealed
            ? 'glass text-ink-900 hover:bg-white/70'
            : isCorrect
            ? 'bg-sage-200 text-sage-700 ring-1 ring-sage-300'
            : isPicked
            ? 'bg-coral/15 text-coral ring-1 ring-coral/30'
            : 'bg-white/40 text-ink-600';
          return (
            <button
              key={i}
              type="button"
              onClick={() => !revealed && setPicked(i)}
              disabled={revealed}
              className={`w-full text-left text-sm rounded-2xl px-4 py-2.5 flex items-center justify-between transition ${cls}`}
            >
              <span>{opt}</span>
              {revealed && isCorrect && <Check size={16} />}
              {revealed && isPicked && !isCorrect && <X size={16} />}
            </button>
          );
        })}
      </div>
      <AnimatePresence>
        {revealed && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-3 text-[13px] text-ink-600"
          >
            {q.explanation}
          </motion.div>
        )}
      </AnimatePresence>
    </GlassCard>
  );
}
