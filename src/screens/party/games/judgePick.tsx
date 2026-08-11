/**
 * The judge-picks engine, shared by Blank Sea and Like for Like.
 *
 * Both games are the same four beats — the Judge shows a card, everybody else
 * privately answers, the answers come back shuffled and anonymous, the Judge
 * picks one — so they're one implementation with two decks rather than two
 * near-identical files that drift apart.
 *
 * The anonymity is the part that has to be right. Answers are shuffled once,
 * when the last player has submitted, and the author is never rendered until
 * after the Judge has chosen. That's what lets the Judge be an ordinary
 * player who takes their turn like everyone else, which is the whole reason
 * the role rotates.
 */

import { useMemo, useState } from 'react';
import { BigButton, PassDevice, PlayerFace, PrivateBanner, ReadAloud, Scoreboard } from '../../../ui/party/PartyUI';
import { hueColor } from '../../../lib/arcade/catalog';
import { sfx } from '../../../lib/arcade/sound';
import { rngFromString, sample, shuffle } from '../../../lib/arcade/rng';
import type { PartyPlayer } from '../../../lib/party/session';
import type { PartyGameProps } from '../shared';

export interface JudgeDeckRound {
  /** What the Judge reads out. */
  prompt: string;
  /** The label above the prompt — "Fill the blank", "Best match". */
  promptLabel: string;
  /** The cards a player chooses from this round. */
  hand: string[];
}

type Stage =
  | { s: 'prompt' }
  | { s: 'pass'; index: number }
  | { s: 'answer'; index: number }
  | { s: 'judging' }
  | { s: 'verdict'; winner: PartyPlayer };

interface Submission {
  player: PartyPlayer;
  card: string;
}

export function JudgePickGame({
  game,
  session,
  onFinish,
  buildRound,
  handSize,
}: PartyGameProps & {
  /** Deals the round: the prompt to read and one hand per answering player. */
  buildRound: (round: number, answerers: number, rng: () => number) => JudgeDeckRound;
  handSize: number;
}) {
  const color = hueColor(game.hue);
  const judge = session.roleHolder;
  const answerers = useMemo(
    () => session.players.filter((p) => p.id !== judge.id),
    [session.players, judge.id],
  );

  const rng = useMemo(() => rngFromString(`${game.id}-${session.round}`), [game.id, session.round]);
  const deal = useMemo(
    () => buildRound(session.round, answerers.length, rng),
    [buildRound, session.round, answerers.length, rng],
  );

  const [stage, setStage] = useState<Stage>({ s: 'prompt' });
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [revealed, setRevealed] = useState(0);
  /** The card the current answerer has highlighted but not yet committed. */
  const [chosen, setChosen] = useState<string | null>(null);
  const [justLocked, setJustLocked] = useState<string | null>(null);

  /** Each answerer gets their own slice of the deal, so no two hands match. */
  const handFor = (index: number) =>
    deal.hand.slice(index * handSize, index * handSize + handSize);

  const shuffled = useMemo(
    () =>
      submissions.length === answerers.length
        ? shuffle(submissions, rngFromString(`${game.id}-${session.round}-reveal`))
        : submissions,
    [submissions, answerers.length, game.id, session.round],
  );

  const lockIn = (index: number) => {
    if (!chosen) return;
    setSubmissions((prev) => [...prev, { player: answerers[index], card: chosen }]);
    setJustLocked(answerers[index].name);
    setChosen(null);
    sfx.right();
    if (index + 1 < answerers.length) setStage({ s: 'pass', index: index + 1 });
    else setStage({ s: 'judging' });
  };

  const choose = (submission: Submission) => {
    session.addScore(submission.player.id, 1);
    sfx.record();
    setStage({ s: 'verdict', winner: submission.player });
  };

  const nextRound = () => {
    setSubmissions([]);
    setRevealed(0);
    setChosen(null);
    setJustLocked(null);
    setStage({ s: 'prompt' });
    session.nextRound();
  };

  return (
    <div className="space-y-4">
      <Scoreboard standings={session.standings} highlight={judge.id} color={color} />

      {stage.s === 'prompt' && (
        <>
          <JudgeBanner judge={judge} color={color} />
          <ReadAloud color={color} label={deal.promptLabel}>
            {deal.prompt}
          </ReadAloud>
          <BigButton color={color} onClick={() => setStage({ s: 'pass', index: 0 })}>
            Start passing the phone
          </BigButton>
          <p className="text-center text-[10px] leading-relaxed" style={{ color: 'var(--cab-dim)' }}>
            Everyone except {judge.name} answers. {answerers.length} to go.
          </p>
        </>
      )}

      {stage.s === 'pass' && (
        <PassDevice
          to={answerers[stage.index]}
          color={color}
          confirm={justLocked ? `${justLocked}'s answer is in` : undefined}
          note="Choose a card in private, lock it in, then hand the phone on."
          onReady={() => {
            setJustLocked(null);
            setStage({ s: 'answer', index: stage.index });
          }}
        />
      )}

      {stage.s === 'answer' && (
        <>
          <PrivateBanner name={answerers[stage.index].name} />
          <ReadAloud color="var(--cab-dim)" label={deal.promptLabel}>
            {deal.prompt}
          </ReadAloud>
          <p className="mt-3 text-center text-[10px] uppercase tracking-[0.2em]" style={{ color }}>
            {chosen ? 'Happy with that? Lock it in' : 'Tap the card you want to play'}
          </p>
          {/* Choosing and committing are two separate taps on purpose. A single
              tap that both picks and submits gives you no way to change your
              mind and no sign that anything was saved — which is exactly the
              moment somebody hands the phone on and asks "did that work?" */}
          <ul className="mt-2 space-y-2">
            {handFor(stage.index).map((card) => (
              <li key={card}>
                <button
                  type="button"
                  onClick={() => {
                    sfx.blip();
                    setChosen((prev) => (prev === card ? null : card));
                  }}
                  aria-pressed={chosen === card}
                  className="w-full rounded-xl border px-3 py-3 text-left text-[13px] leading-snug transition"
                  style={{
                    borderColor: chosen === card ? color : 'var(--cab-line)',
                    background: chosen === card ? `${color}22` : 'transparent',
                  }}
                >
                  {card}
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-4">
            <BigButton color={color} disabled={!chosen} onClick={() => lockIn(stage.index)}>
              {chosen
                ? stage.index + 1 < answerers.length
                  ? `Lock it in & pass to ${answerers[stage.index + 1].name}`
                  : 'Lock it in & hand back to the Judge'
                : 'Pick a card first'}
            </BigButton>
          </div>
        </>
      )}

      {stage.s === 'judging' && (
        <>
          <JudgeBanner judge={judge} color={color} verb="is judging" />
          <ReadAloud color={color} label={deal.promptLabel}>
            {deal.prompt}
          </ReadAloud>
          <p className="text-center text-[10px] uppercase tracking-widest" style={{ color: 'var(--cab-dim)' }}>
            {revealed < shuffled.length
              ? 'Tap to turn over the next answer'
              : 'Now pick the winner'}
          </p>
          <ul className="space-y-2">
            {shuffled.map((submission, i) => {
              const shown = i < revealed;
              return (
                <li key={`${submission.player.id}-${i}`}>
                  <button
                    type="button"
                    onClick={() => {
                      if (!shown) {
                        // Strictly in order, so the Judge reads them out one
                        // at a time instead of the table skim-reading the lot.
                        if (i === revealed) {
                          setRevealed(revealed + 1);
                          sfx.blip();
                        }
                        return;
                      }
                      if (revealed === shuffled.length) choose(submission);
                    }}
                    className="w-full rounded-xl border px-3 py-3 text-left text-[13px] leading-snug"
                    style={{
                      borderColor: shown ? color : 'var(--cab-line)',
                      opacity: shown ? 1 : 0.55,
                    }}
                  >
                    {shown ? submission.card : `Answer ${i + 1} — tap to reveal`}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {stage.s === 'verdict' && (
        <div className="grid place-items-center py-6 text-center">
          <div className="text-[10px] uppercase tracking-[0.3em]" style={{ color: 'var(--cab-dim)' }}>
            {judge.name} picks
          </div>
          <div className="my-4">
            <PlayerFace player={stage.winner} size={84} />
          </div>
          <div className="neon text-2xl font-bold uppercase" style={{ color: 'var(--neon-gold)' }}>
            {stage.winner.name}
          </div>
          <p className="mt-2 max-w-[18rem] text-[12px] italic leading-relaxed">
            “{submissions.find((s) => s.player.id === stage.winner.id)?.card}”
          </p>
          <div className="mt-8 w-full space-y-2">
            <BigButton color={color} onClick={nextRound}>
              Next round
            </BigButton>
            <BigButton color="var(--cab-dim)" onClick={onFinish}>
              End the game
            </BigButton>
          </div>
        </div>
      )}
    </div>
  );
}

function JudgeBanner({ judge, color, verb = 'is the Judge' }: { judge: PartyPlayer; color: string; verb?: string }) {
  return (
    <div className="flex items-center justify-center gap-2">
      <PlayerFace player={judge} size={30} />
      <span className="text-[11px] uppercase tracking-[0.2em]" style={{ color }}>
        {judge.name} {verb}
      </span>
    </div>
  );
}

/** Deal `count` distinct cards, topping up from the deck if it runs short. */
export function dealCards(deck: readonly string[], count: number, rng: () => number): string[] {
  if (deck.length >= count) return sample(deck, count, rng);
  const out: string[] = [];
  while (out.length < count) out.push(...shuffle(deck, rng));
  return out.slice(0, count);
}
