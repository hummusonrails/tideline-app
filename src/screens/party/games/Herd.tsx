/**
 * Herd — answer with the crowd, not with the truth.
 *
 * The comparison is the fiddly bit at a table and trivial on a phone:
 * answers are grouped on a normalised form, so "Sea gull" and "seagulls" land
 * in the same pen without anybody having to adjudicate it. That's the only
 * reason this game works with a device instead of a whiteboard.
 */

import { useMemo, useState } from 'react';
import { BigButton, PassDevice, PrivateBanner, ReadAloud, Scoreboard } from '../../../ui/party/PartyUI';
import { hueColor } from '../../../lib/arcade/catalog';
import { sfx } from '../../../lib/arcade/sound';
import { rngFromString, shuffle } from '../../../lib/arcade/rng';
import { HERD_QUESTIONS } from '../../../lib/party/decks';
import { normalise } from './OneWord';
import type { PartyPlayer } from '../../../lib/party/session';
import type { PartyGameProps } from '../shared';

type Stage =
  | { s: 'question' }
  | { s: 'pass'; index: number }
  | { s: 'write'; index: number }
  | { s: 'reveal' };

interface Answer {
  player: PartyPlayer;
  text: string;
}

export default function Herd({ game, session, onFinish }: PartyGameProps) {
  const color = hueColor(game.hue);
  const questions = useMemo(
    () => shuffle(HERD_QUESTIONS, rngFromString(`herd-${session.players.length}`)),
    [session.players.length],
  );
  const question = questions[session.round % questions.length];

  const [stage, setStage] = useState<Stage>({ s: 'question' });
  const [answers, setAnswers] = useState<Answer[]>([]);
  const [draft, setDraft] = useState('');
  const [scored, setScored] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);

  /** Answers bucketed by their normalised form, biggest pen first. */
  const groups = useMemo(() => {
    const buckets = new Map<string, Answer[]>();
    for (const answer of answers) {
      const key = normalise(answer.text) || answer.text.toLowerCase();
      buckets.set(key, [...(buckets.get(key) ?? []), answer]);
    }
    return [...buckets.values()].sort((a, b) => b.length - a.length);
  }, [answers]);

  const biggest = groups[0]?.length ?? 0;

  const submit = (index: number) => {
    const text = draft.trim();
    if (!text) return;
    setAnswers((prev) => [...prev, { player: session.players[index], text }]);
    setDraft('');
    setReceipt(`${session.players[index].name}'s answer is in`);
    sfx.right();
    if (index + 1 < session.players.length) setStage({ s: 'pass', index: index + 1 });
    else setStage({ s: 'reveal' });
  };

  const reveal = () => {
    if (scored) return;
    setScored(true);
    for (const group of groups) {
      // Everyone in the biggest pen scores. Being the only one with an answer
      // is its own, worse, outcome.
      if (group.length === biggest && biggest > 1) {
        for (const answer of group) session.addScore(answer.player.id, 2);
      } else if (group.length === 1 && session.players.length > 2) {
        session.addScore(group[0].player.id, -1);
      }
    }
    sfx.levelUp();
  };

  const nextRound = () => {
    setAnswers([]);
    setDraft('');
    setScored(false);
    setReceipt(null);
    session.nextRound();
    setStage({ s: 'question' });
  };

  return (
    <div className="space-y-4">
      <Scoreboard standings={session.standings} color={color} />

      {stage.s === 'question' && (
        <>
          <ReadAloud color={color} label={`Question ${session.round + 1}`}>
            {question}
          </ReadAloud>
          <p className="text-center text-[10px] leading-relaxed" style={{ color: 'var(--cab-dim)' }}>
            Do not say your answer out loud. Write the one you think everybody
            else will write.
          </p>
          <BigButton color={color} onClick={() => setStage({ s: 'pass', index: 0 })}>
            Start passing the phone
          </BigButton>
        </>
      )}

      {stage.s === 'pass' && (
        <PassDevice
          to={session.players[stage.index]}
          color={color}
          confirm={receipt ?? undefined}
          note={`${question} Write it and lock it in.`}
          onReady={() => {
            setReceipt(null);
            setStage({ s: 'write', index: stage.index });
          }}
        />
      )}

      {stage.s === 'write' && (
        <>
          <PrivateBanner name={session.players[stage.index].name} />
          <ReadAloud color="var(--cab-dim)" label="The question">
            {question}
          </ReadAloud>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit(stage.index);
            }}
            className="mt-4"
          >
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoFocus
              maxLength={24}
              autoComplete="off"
              aria-label="Your answer"
              placeholder="your answer"
              className="w-full rounded-lg border bg-transparent px-3 py-3 text-center text-lg outline-none"
              style={{ borderColor: 'var(--cab-line)', color: 'var(--cab-text)' }}
            />
            <button
              type="submit"
              disabled={!draft.trim()}
              className="arcade-btn mt-3 w-full py-3 text-xs font-bold disabled:opacity-40"
              style={{ color }}
            >
              Into the pen
            </button>
          </form>
        </>
      )}

      {stage.s === 'reveal' && (
        <>
          <ReadAloud color={color} label="The question was">
            {question}
          </ReadAloud>

          {!scored ? (
            <BigButton color={color} onClick={reveal}>
              Open the pens
            </BigButton>
          ) : (
            <ul className="space-y-2">
              {groups.map((group, i) => {
                const isHerd = group.length === biggest && biggest > 1;
                const isAlone = group.length === 1 && session.players.length > 2;
                return (
                  <li
                    key={i}
                    className="pop-in rounded-xl border p-3"
                    style={{
                      borderColor: isHerd
                        ? 'var(--neon-lime)'
                        : isAlone
                        ? 'var(--neon-red)'
                        : 'var(--cab-line)',
                    }}
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-[14px] font-bold">{group[0].text}</span>
                      <span
                        className="shrink-0 text-[9px] uppercase tracking-wider"
                        style={{
                          color: isHerd
                            ? 'var(--neon-lime)'
                            : isAlone
                            ? 'var(--neon-red)'
                            : 'var(--cab-dim)',
                        }}
                      >
                        {isHerd ? '+2 each' : isAlone ? 'odd one out −1' : 'no score'}
                      </span>
                    </div>
                    <div className="mt-1 text-[10px]" style={{ color: 'var(--cab-dim)' }}>
                      {group.map((a) => a.player.name).join(', ')}
                      {group.length > 1 && ` — ${group.length} of you`}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}

          {scored && (
            <>
              <BigButton color={color} onClick={nextRound}>
                Next question
              </BigButton>
              <BigButton color="var(--cab-dim)" onClick={onFinish}>
                End the game
              </BigButton>
            </>
          )}
        </>
      )}
    </div>
  );
}
