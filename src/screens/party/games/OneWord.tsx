/**
 * One Word — everybody helps the Guesser, and identical clues cancel out.
 *
 * The cancelling is the whole game and it's also the thing a phone does far
 * better than cards: matching is done on a normalised comparison (case,
 * spacing and simple plurals folded), so "SEAGULL" and "seagulls" cancel each
 * other exactly the way a table would rule they should, without anybody
 * having to arbitrate it.
 *
 * Co-operative, so the score is shared: everyone in the roster gets the same
 * points, and the scoreboard is really the team's record to beat.
 */

import { useMemo, useState } from 'react';
import { BigButton, PassDevice, PrivateBanner, ReadAloud, Scoreboard } from '../../../ui/party/PartyUI';
import { hueColor } from '../../../lib/arcade/catalog';
import { sfx } from '../../../lib/arcade/sound';
import { rngFromString, shuffle } from '../../../lib/arcade/rng';
import { ONE_WORD_SECRETS } from '../../../lib/party/decks';
import type { PartyPlayer } from '../../../lib/party/session';
import type { PartyGameProps } from '../shared';

const ROUNDS = 13;

type Stage =
  | { s: 'intro' }
  | { s: 'pass'; index: number }
  | { s: 'write'; index: number }
  | { s: 'filter' }
  | { s: 'guess' }
  | { s: 'result'; got: boolean };

interface Clue {
  player: PartyPlayer;
  word: string;
}

export default function OneWord({ game, session, onFinish }: PartyGameProps) {
  const color = hueColor(game.hue);
  const guesser = session.roleHolder;
  const cluegivers = useMemo(
    () => session.players.filter((p) => p.id !== guesser.id),
    [session.players, guesser.id],
  );

  const secrets = useMemo(
    () => shuffle(ONE_WORD_SECRETS, rngFromString(`oneword-${session.players.length}`)),
    [session.players.length],
  );
  const secret = secrets[session.round % secrets.length];

  const [stage, setStage] = useState<Stage>({ s: 'intro' });
  const [clues, setClues] = useState<Clue[]>([]);
  const [draft, setDraft] = useState('');
  const [got, setGot] = useState(0);
  const [receipt, setReceipt] = useState<string | null>(null);

  /** Clues that survive the duplicate cull, and the ones that didn't. */
  const { kept, cancelled } = useMemo(() => {
    const counts = new Map<string, number>();
    for (const clue of clues) {
      const key = normalise(clue.word);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return {
      kept: clues.filter((c) => counts.get(normalise(c.word)) === 1),
      cancelled: clues.filter((c) => (counts.get(normalise(c.word)) ?? 0) > 1),
    };
  }, [clues]);

  const submit = (index: number) => {
    const word = draft.trim();
    if (!word) return;
    setClues((prev) => [...prev, { player: cluegivers[index], word }]);
    setDraft('');
    setReceipt(`${cluegivers[index].name}'s clue is in`);
    sfx.right();
    if (index + 1 < cluegivers.length) setStage({ s: 'pass', index: index + 1 });
    else setStage({ s: 'filter' });
  };

  const score = (correct: boolean) => {
    if (correct) {
      setGot((g) => g + 1);
      // A shared result deserves a shared score.
      for (const player of session.players) session.addScore(player.id, 1);
      sfx.right();
    } else {
      sfx.wrong();
    }
    setStage({ s: 'result', got: correct });
  };

  const nextRound = () => {
    setClues([]);
    setDraft('');
    setReceipt(null);
    if (session.round + 1 >= ROUNDS) {
      onFinish();
      return;
    }
    session.nextRound();
    setStage({ s: 'intro' });
  };

  return (
    <div className="space-y-4">
      <Scoreboard standings={session.standings} highlight={guesser.id} color={color} />
      <div className="text-center text-[10px] uppercase tracking-[0.25em]" style={{ color: 'var(--cab-dim)' }}>
        Card {session.round + 1} of {ROUNDS} · {got} found
      </div>

      {stage.s === 'intro' && (
        <>
          <ReadAloud color={color} label="Host reads this out">
            {guesser.name} is guessing — look away. Everyone else, the phone is coming
            round for your one-word clue.
          </ReadAloud>
          <BigButton color={color} onClick={() => setStage({ s: 'pass', index: 0 })}>
            Start passing
          </BigButton>
        </>
      )}

      {stage.s === 'pass' && (
        <PassDevice
          to={cluegivers[stage.index]}
          color={color}
          confirm={receipt ?? undefined}
          note="Write one word and lock it in. If somebody else writes the same one, both are thrown away."
          onReady={() => {
            setReceipt(null);
            setStage({ s: 'write', index: stage.index });
          }}
        />
      )}

      {stage.s === 'write' && (
        <>
          <PrivateBanner name={cluegivers[stage.index].name} />
          <div className="rounded-xl border-2 p-5 text-center" style={{ borderColor: color }}>
            <div className="text-[9px] uppercase tracking-[0.3em]" style={{ color: 'var(--cab-dim)' }}>
              The secret word
            </div>
            <div className="neon mt-2 text-3xl font-bold tracking-[0.08em]" style={{ color }}>
              {secret}
            </div>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit(stage.index);
            }}
            className="mt-4"
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value.replace(/\s+/g, ' '))}
              autoFocus
              maxLength={18}
              autoComplete="off"
              spellCheck={false}
              aria-label="Your one-word clue"
              placeholder="one word"
              className="w-full rounded-lg border bg-transparent px-3 py-3 text-center text-lg outline-none"
              style={{ borderColor: 'var(--cab-line)', color: 'var(--cab-text)' }}
            />
            <button
              type="submit"
              disabled={!draft.trim()}
              className="arcade-btn mt-3 w-full py-3 text-xs font-bold disabled:opacity-40"
              style={{ color }}
            >
              Lock it in
            </button>
          </form>
        </>
      )}

      {stage.s === 'filter' && (
        <>
          <ReadAloud color={color} label="Before the Guesser looks">
            Duplicates are out. {kept.length} clue{kept.length === 1 ? '' : 's'} survived.
          </ReadAloud>
          {cancelled.length > 0 && (
            <div className="rounded-xl border p-3" style={{ borderColor: 'var(--neon-red)' }}>
              <div className="mb-1.5 text-[9px] uppercase tracking-[0.25em]" style={{ color: 'var(--neon-red)' }}>
                Cancelled
              </div>
              <div className="flex flex-wrap gap-1.5">
                {cancelled.map((clue, i) => (
                  <span
                    key={i}
                    className="rounded border px-2 py-0.5 text-[11px] line-through"
                    style={{ borderColor: 'var(--cab-line)', color: 'var(--cab-dim)' }}
                  >
                    {clue.word}
                  </span>
                ))}
              </div>
            </div>
          )}
          <BigButton color={color} onClick={() => setStage({ s: 'guess' })}>
            Give the phone to {guesser.name}
          </BigButton>
        </>
      )}

      {stage.s === 'guess' && (
        <>
          <div className="text-center text-[11px] uppercase tracking-[0.2em]" style={{ color }}>
            {guesser.name}, one guess
          </div>
          {kept.length === 0 ? (
            <p className="py-8 text-center text-[12px]" style={{ color: 'var(--neon-red)' }}>
              Every single clue cancelled. That happens. Guess anyway.
            </p>
          ) : (
            <div className="flex flex-wrap justify-center gap-2 py-6">
              {kept.map((clue, i) => (
                <span
                  key={i}
                  className="pop-in rounded-lg border px-3 py-2 text-base font-bold"
                  style={{ borderColor: color, color }}
                >
                  {clue.word}
                </span>
              ))}
            </div>
          )}
          <p className="text-center text-[10px] leading-relaxed" style={{ color: 'var(--cab-dim)' }}>
            Say your guess out loud, then whoever is nearest taps the answer.
          </p>
          <div className="flex gap-2">
            <BigButton color="var(--neon-lime)" onClick={() => score(true)}>
              Got it
            </BigButton>
            <BigButton color="var(--neon-red)" onClick={() => score(false)}>
              Missed
            </BigButton>
          </div>
        </>
      )}

      {stage.s === 'result' && (
        <div className="grid place-items-center gap-4 py-6 text-center">
          <div
            className="neon text-2xl font-bold uppercase tracking-[0.1em]"
            style={{ color: stage.got ? 'var(--neon-lime)' : 'var(--neon-red)' }}
          >
            {stage.got ? 'Found it' : 'Missed'}
          </div>
          <div className="text-[12px]" style={{ color: 'var(--cab-dim)' }}>
            The word was <strong style={{ color: 'var(--cab-text)' }}>{secret}</strong>
          </div>
          <div className="w-full space-y-2">
            <BigButton color={color} onClick={nextRound}>
              {session.round + 1 >= ROUNDS ? 'See the final score' : 'Next card'}
            </BigButton>
            <BigButton color="var(--cab-dim)" onClick={onFinish}>
              Stop here
            </BigButton>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Fold a clue to its comparison form.
 *
 * Case, punctuation and a naive plural are all stripped, because the table's
 * instinct is that "seagull" and "Seagulls" are the same clue and a rule that
 * disagrees with the table is a rule that gets ignored.
 */
export function normalise(word: string): string {
  const base = word
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]/g, '');
  if (base.length > 3 && base.endsWith('es')) return base.slice(0, -2);
  if (base.length > 3 && base.endsWith('s')) return base.slice(0, -1);
  return base;
}
