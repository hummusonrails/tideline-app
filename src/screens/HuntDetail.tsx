import { useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronLeft, Check, Camera, Lock, Lightbulb } from 'lucide-react';
import { db } from '../lib/db';
import { useSession } from '../state/session';
import { GlassCard } from '../ui/GlassCard';
import { Confetti } from '../ui/Confetti';
import { todayYMD } from '../lib/time';
import { completeSynthetic, awardPoints, EARN, CAPS } from '../lib/award';
import { compressForPost } from '../lib/compress';
import { postPhoto } from '../lib/photoPost';
import {
  huntStageId,
  huntFinaleId,
  huntProgress,
  currentStageIndex,
  completedStageCount,
  isHuntComplete,
  stagePoints,
  hasFinaleBonus,
  checkCodeAnswer,
  isOnHuntTeam,
  type HuntContext,
  type StageState,
} from '../lib/hunts';
import type { ChallengeCompletion, Hunt, HuntStage, MemberId } from '../types';

/**
 * One hunt, one clue at a time.
 *
 * Only the current stage's clue is ever rendered: later stages exist in the
 * synced data, but putting them on screen would turn a five-stop hunt into a
 * single scroll. Solved stages collapse to a timeline so progress stays
 * visible without re-reading.
 */
export function HuntDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const session = useSession();
  const myId = session.identity!;
  const today = todayYMD();

  const hunt = useLiveQuery(
    async () => (id ? ((await db.hunts.get(id)) ?? null) : null),
    [id],
  );
  const profiles = useLiveQuery(() => db.profiles.toArray(), []) ?? [];
  const completions = useLiveQuery(() => db.completions.toArray(), []) ?? [];
  const todayItinerary =
    useLiveQuery(() => db.itinerary.where('date').equals(today).toArray(), [today]) ?? [];
  const places = useLiveQuery(() => db.places.toArray(), []) ?? [];

  // Recomputed on every tick of the underlying data; `now` is captured per
  // render, which is enough for gates measured in minutes.
  const ctx: HuntContext = useMemo(
    () => ({ today, now: new Date(), todayItinerary, profiles, completions, member: myId }),
    [today, todayItinerary, profiles, completions, myId],
  );

  if (hunt === undefined) {
    return <div className="min-h-dvh grid place-items-center text-ink-600">Loading…</div>;
  }
  if (hunt === null) {
    return (
      <div className="min-h-dvh grid place-items-center p-6 text-ink-600 text-center">
        That hunt isn't here.
      </div>
    );
  }
  if (!isOnHuntTeam(hunt, profiles, myId)) {
    return (
      <div className="min-h-dvh grid place-items-center p-6 text-ink-600 text-center">
        This one belongs to the other team. 🤐
      </div>
    );
  }

  const placeName = hunt.stages
    .map((s) => s.unlock?.placeSlug)
    .map((slug) => places.find((p) => p.slug === slug)?.name)
    .find(Boolean);
  const states = huntProgress(hunt, ctx, placeName);
  const cursor = currentStageIndex(states);
  const finished = isHuntComplete(states);

  return (
    <div className="min-h-dvh pb-28">
      <div className="pt-[max(env(safe-area-inset-top),1rem)] px-4">
        <header className="flex items-center gap-3 mb-5">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="grid h-10 w-10 place-items-center rounded-full glass shrink-0"
            aria-label="Back"
          >
            <ChevronLeft size={20} strokeWidth={1.75} />
          </button>
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wider text-ink-600 font-medium">
              {completedStageCount(states)} of {hunt.stages.length} solved
            </div>
            <h1 className="font-display text-2xl font-semibold leading-tight truncate">
              {hunt.icon} {hunt.title}
            </h1>
          </div>
        </header>

        <main className="space-y-5">
          <GlassCard className="bg-gradient-to-br from-sage-100/60 to-white/50">
            <p className="text-[15px] leading-relaxed text-ink-900">{hunt.intro}</p>
            <ProgressBar done={completedStageCount(states)} total={hunt.stages.length} />
          </GlassCard>

          <StageTimeline hunt={hunt} states={states} />

          {finished ? (
            <HuntFinale hunt={hunt} myId={myId} completions={completions} />
          ) : cursor !== null ? (
            <ActiveStage
              key={cursor}
              hunt={hunt}
              stageIndex={cursor}
              state={states[cursor]}
              myId={myId}
              isLastStage={cursor === hunt.stages.length - 1}
            />
          ) : null}
        </main>
      </div>
    </div>
  );
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div className="mt-3 h-2 rounded-full bg-white/50 overflow-hidden">
      <motion.div
        className="h-full bg-sage-400 rounded-full"
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ type: 'spring', stiffness: 120, damping: 20 }}
      />
    </div>
  );
}

/** Solved stages, collapsed. Nothing here spoils what's still ahead. */
function StageTimeline({ hunt, states }: { hunt: Hunt; states: StageState[] }) {
  const solved = states
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.status === 'done');
  if (solved.length === 0) return null;

  return (
    <section>
      <div className="text-xs uppercase tracking-wider text-ink-600 mb-2 px-1 font-medium">
        Solved
      </div>
      <GlassCard>
        <ul className="space-y-2">
          {solved.map(({ s, i }) => (
            <li key={i} className="flex items-start gap-2 text-[14px] text-ink-600">
              <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-sage-400 text-white">
                <Check size={12} />
              </span>
              <span className="flex-1 line-through">{hunt.stages[i].clue}</span>
              {s.status === 'done' && s.hintUsed && (
                <span className="text-[11px] text-ink-500 shrink-0" title="Hint taken — half points">
                  💡
                </span>
              )}
            </li>
          ))}
        </ul>
      </GlassCard>
    </section>
  );
}

function ActiveStage({
  hunt,
  stageIndex,
  state,
  myId,
  isLastStage,
}: {
  hunt: Hunt;
  stageIndex: number;
  state: StageState;
  myId: MemberId;
  isLastStage: boolean;
}) {
  const stage = hunt.stages[stageIndex];
  const [hintShown, setHintShown] = useState(false);

  if (state.status === 'locked') {
    return (
      <GlassCard className="flex items-center gap-3">
        <Lock size={18} className="text-ink-600 shrink-0" />
        <div>
          <div className="font-medium text-sm">Next clue is sealed</div>
          <div className="text-xs text-ink-600">{state.reason}</div>
        </div>
      </GlassCard>
    );
  }

  return (
    <section>
      <div className="text-xs uppercase tracking-wider text-ink-600 mb-2 px-1 font-medium">
        Clue {stageIndex + 1}
        {isLastStage ? ' · last one' : ''}
      </div>
      <GlassCard>
        <p className="text-[15px] leading-relaxed text-ink-900 whitespace-pre-line">
          {stage.clue}
        </p>

        {stage.hint && (
          <div className="mt-3">
            {hintShown ? (
              <div className="text-[13px] text-ink-600 rounded-2xl bg-white/50 px-3 py-2">
                💡 {stage.hint}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setHintShown(true)}
                className="inline-flex items-center gap-1.5 text-xs text-ocean font-semibold"
              >
                <Lightbulb size={13} /> Show hint (half points)
              </button>
            )}
          </div>
        )}

        <div className="mt-4">
          <StageProof
            hunt={hunt}
            stage={stage}
            stageIndex={stageIndex}
            hintUsed={hintShown}
            myId={myId}
          />
        </div>

        <div className="mt-2 text-center text-xs text-ink-500">
          worth +{stagePoints(stage, hintShown)}
          {isLastStage && hunt.finaleBonus > 0 && ` · +${hunt.finaleBonus} finale bonus`}
        </div>
      </GlassCard>
    </section>
  );
}

/** The proof control for whichever kind this stage asks for. */
function StageProof({
  hunt,
  stage,
  stageIndex,
  hintUsed,
  myId,
}: {
  hunt: Hunt;
  stage: HuntStage;
  stageIndex: number;
  hintUsed: boolean;
  myId: MemberId;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [answer, setAnswer] = useState('');
  const [pickedOption, setPickedOption] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  async function solve(proofPhotoId?: string) {
    await solveStage({ hunt, stageIndex, by: myId, hintUsed, proofPhotoId });
  }

  async function onCode() {
    if (stage.proof.type !== 'code' || busy) return;
    setBusy(true);
    setError(null);
    try {
      const ok = await checkCodeAnswer(answer, stage.proof.answerHash);
      if (!ok) {
        setError("That's not it. Look again — spelling and spaces don't matter.");
        return;
      }
      await solve();
    } finally {
      setBusy(false);
    }
  }

  async function onQuiz() {
    if (stage.proof.type !== 'quiz' || pickedOption === null || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (pickedOption !== stage.proof.answer) {
        setError('Not quite. Have another think.');
        setPickedOption(null);
        return;
      }
      await solve();
    } finally {
      setBusy(false);
    }
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const result = await compressForPost(file);
      const photoId = await postPhoto(result, myId, { commitMessage: 'hunt proof photo' });
      // The album point too, capped like any other photo — a hunt shouldn't be
      // a way around the daily limit.
      await awardPoints({
        to: myId, by: myId, amount: EARN.photo, reason: 'photo',
        refId: photoId, dailyCap: CAPS.photoPerDay,
      });
      await solve(photoId);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const errorNode = error && <div className="text-coral text-sm mb-3">{error}</div>;

  if (stage.proof.type === 'code') {
    return (
      <div>
        {errorNode}
        <input
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void onCode(); }}
          placeholder={stage.proof.placeholder ?? 'Your answer'}
          // iOS helpfully capitalizes and autocorrects answers into being
          // wrong; the normalizer forgives case but not a swapped word.
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className="w-full rounded-2xl bg-white/70 ring-1 ring-white/80 px-4 py-3 text-[15px] outline-none focus:ring-sage-300"
        />
        <button
          type="button"
          disabled={busy || !answer.trim()}
          onClick={() => void onCode()}
          className="mt-3 w-full rounded-full bg-ink-900 text-white font-medium py-3 disabled:opacity-40 active:scale-[0.98] transition"
        >
          {busy ? 'Checking…' : 'Submit answer'}
        </button>
      </div>
    );
  }

  if (stage.proof.type === 'quiz') {
    const proof = stage.proof;
    return (
      <div>
        {errorNode}
        <div className="font-medium text-sm mb-2">{proof.q}</div>
        <div className="space-y-2">
          {proof.options.map((opt, i) => (
            <button
              key={i}
              type="button"
              disabled={busy}
              onClick={() => setPickedOption(i)}
              className={`w-full text-left text-sm rounded-2xl px-4 py-2.5 transition ${
                pickedOption === i ? 'bg-ink-900 text-white' : 'glass text-ink-900'
              }`}
            >
              {opt}
            </button>
          ))}
        </div>
        <button
          type="button"
          disabled={busy || pickedOption === null}
          onClick={() => void onQuiz()}
          className="mt-3 w-full rounded-full bg-ink-900 text-white font-medium py-3 disabled:opacity-40 active:scale-[0.98] transition"
        >
          {busy ? 'Checking…' : 'Lock it in'}
        </button>
      </div>
    );
  }

  if (stage.proof.type === 'photo') {
    return (
      <div>
        {errorNode}
        <button
          type="button"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
          className="w-full rounded-full bg-ink-900 text-white font-medium py-3 active:scale-[0.98] transition inline-flex items-center justify-center gap-2"
        >
          <Camera size={16} /> {busy ? 'Uploading…' : 'Add the photo'}
        </button>
        {/* No `capture`: on iOS that hides the photo library entirely. */}
        <input ref={fileInput} type="file" accept="image/*" className="hidden" onChange={onFile} />
      </div>
    );
  }

  return (
    <div>
      {errorNode}
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void solve().finally(() => setBusy(false));
        }}
        className="w-full rounded-full bg-ink-900 text-white font-medium py-3 active:scale-[0.98] transition"
      >
        {busy ? 'Saving…' : 'Done — next clue'}
      </button>
    </div>
  );
}

/**
 * The payoff. Shown once every stage is solved; the finale bonus is minted
 * here, once per member, by that member's own device.
 */
function HuntFinale({
  hunt,
  myId,
  completions,
}: {
  hunt: Hunt;
  myId: MemberId;
  completions: readonly ChallengeCompletion[];
}) {
  const claimed = hasFinaleBonus(hunt, completions, myId);
  const [celebrating, setCelebrating] = useState(!claimed);

  // Mint in an effect, not during render: React may render this twice, and
  // while completeSynthetic dedups at the write, kicking off writes from a
  // render body makes that dedup the only thing standing between us and a
  // double award. `claimed` flips via the live query, ending the effect.
  useEffect(() => {
    if (claimed || hunt.finaleBonus <= 0) return;
    void completeSynthetic({
      challengeId: huntFinaleId(hunt.id),
      by: myId,
      points: hunt.finaleBonus,
      commitMessage: `hunt finished: ${hunt.id}`,
    });
  }, [claimed, hunt.id, hunt.finaleBonus, myId]);

  return (
    <>
      <AnimatePresence>
        {celebrating && <Confetti onDone={() => setCelebrating(false)} />}
      </AnimatePresence>
      <GlassCard className="text-center bg-gradient-to-br from-sage-100/70 to-white/50">
        <div className="text-4xl mb-2">{hunt.icon}</div>
        <div className="font-display text-xl font-semibold">Hunt complete</div>
        {hunt.reveal && (
          <p className="mt-3 text-[15px] leading-relaxed text-ink-900 whitespace-pre-line text-left">
            {hunt.reveal}
          </p>
        )}
        {hunt.finaleBonus > 0 && (
          <div className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-sage-200 text-sage-700 px-4 py-2 text-sm font-semibold">
            +{hunt.finaleBonus} finale bonus
          </div>
        )}
      </GlassCard>
    </>
  );
}

/**
 * Write one solved stage.
 *
 * Hint usage rides in the completion's marks so every device renders the same
 * "💡" against that stage — and so the halved award is auditable rather than
 * being a number that appeared from nowhere.
 */
async function solveStage(opts: {
  hunt: Hunt;
  stageIndex: number;
  by: MemberId;
  hintUsed: boolean;
  proofPhotoId?: string;
}): Promise<void> {
  const { hunt, stageIndex, by, hintUsed, proofPhotoId } = opts;
  const stage = hunt.stages[stageIndex];
  await completeSynthetic({
    challengeId: huntStageId(hunt.id, stageIndex),
    by,
    points: stagePoints(stage, hintUsed),
    proofPhotoId,
    marks: hintUsed ? [1] : undefined,
    commitMessage: `hunt: ${hunt.id} stage ${stageIndex + 1}`,
  });
}
