/**
 * Tall Tales — invent a definition and get somebody to believe it.
 *
 * Two things have to be true for this to work on one phone, and both are
 * handled here: nobody may vote for their own bluff (the button is simply
 * absent), and the real definition is shuffled in blind so the position of
 * the truth carries no information.
 *
 * Scoring rewards both halves of the game — two points for spotting the real
 * one, one point for every vote your fake steals — so a player who can't
 * recognise a real word can still win by writing a convincing lie.
 */

import { useMemo, useState } from 'react';
import { BigButton, PassDevice, PrivateBanner, ReadAloud, Scoreboard } from '../../../ui/party/PartyUI';
import { hueColor } from '../../../lib/arcade/catalog';
import { sfx } from '../../../lib/arcade/sound';
import { rngFromString, shuffle } from '../../../lib/arcade/rng';
import { TALL_WORDS } from '../../../lib/party/decks';
import type { PartyPlayer } from '../../../lib/party/session';
import type { PartyGameProps } from '../shared';

type Stage =
  | { s: 'word' }
  | { s: 'pass'; index: number }
  | { s: 'write'; index: number }
  | { s: 'read' }
  | { s: 'vote-pass'; index: number }
  | { s: 'vote'; index: number }
  | { s: 'result' };

interface Entry {
  /** Null for the genuine definition. */
  author: PartyPlayer | null;
  text: string;
}

export default function TallTales({ game, session, onFinish }: PartyGameProps) {
  const color = hueColor(game.hue);
  const words = useMemo(
    () => shuffle(TALL_WORDS, rngFromString(`tall-${session.players.length}`)),
    [session.players.length],
  );
  const card = words[session.round % words.length];

  const [stage, setStage] = useState<Stage>({ s: 'word' });
  const [bluffs, setBluffs] = useState<Entry[]>([]);
  const [draft, setDraft] = useState('');
  const [votes, setVotes] = useState<Record<string, number>>({});
  const [scored, setScored] = useState(false);
  /** Highlighted but not yet committed — see judgePick for why this is split. */
  const [picked, setPicked] = useState<number | null>(null);
  const [receipt, setReceipt] = useState<string | null>(null);

  /** The truth mixed in, in a fixed order for the whole round. */
  const entries = useMemo(() => {
    if (bluffs.length < session.players.length) return [];
    return shuffle(
      [...bluffs, { author: null, text: card.truth }],
      rngFromString(`tall-${session.round}-mix`),
    );
  }, [bluffs, session.players.length, card.truth, session.round]);

  const submitBluff = (index: number) => {
    const text = draft.trim();
    if (!text) return;
    setBluffs((prev) => [...prev, { author: session.players[index], text }]);
    setDraft('');
    setReceipt(`${session.players[index].name}'s definition is in`);
    sfx.right();
    if (index + 1 < session.players.length) setStage({ s: 'pass', index: index + 1 });
    else setStage({ s: 'read' });
  };

  const castVote = (voterIndex: number) => {
    if (picked === null) return;
    setVotes((prev) => ({ ...prev, [session.players[voterIndex].id]: picked }));
    setReceipt(`${session.players[voterIndex].name} has voted`);
    setPicked(null);
    sfx.right();
    if (voterIndex + 1 < session.players.length) setStage({ s: 'vote-pass', index: voterIndex + 1 });
    else setStage({ s: 'result' });
  };

  const settle = () => {
    if (scored) return;
    setScored(true);
    for (const player of session.players) {
      const choice = votes[player.id];
      const entry = entries[choice];
      if (!entry) continue;
      if (entry.author === null) session.addScore(player.id, 2);
      else session.addScore(entry.author.id, 1);
    }
    sfx.levelUp();
  };

  const nextRound = () => {
    setBluffs([]);
    setVotes({});
    setDraft('');
    setScored(false);
    setPicked(null);
    setReceipt(null);
    session.nextRound();
    setStage({ s: 'word' });
  };

  return (
    <div className="space-y-4">
      <Scoreboard standings={session.standings} color={color} />

      {stage.s === 'word' && (
        <>
          <ReadAloud color={color} label="Read the word out">
            {card.word}
          </ReadAloud>
          <p className="text-center text-[10px] leading-relaxed" style={{ color: 'var(--cab-dim)' }}>
            It is a real word. The phone is coming round — write a definition that
            sounds like it came out of a dictionary.
          </p>
          <BigButton color={color} onClick={() => setStage({ s: 'pass', index: 0 })}>
            Start passing
          </BigButton>
        </>
      )}

      {stage.s === 'pass' && (
        <PassDevice
          to={session.players[stage.index]}
          color={color}
          confirm={receipt ?? undefined}
          note={`Write a convincing definition for “${card.word}”, then lock it in.`}
          onReady={() => {
            setReceipt(null);
            setStage({ s: 'write', index: stage.index });
          }}
        />
      )}

      {stage.s === 'write' && (
        <>
          <PrivateBanner name={session.players[stage.index].name} />
          <div className="rounded-xl border-2 p-4 text-center" style={{ borderColor: color }}>
            <div className="neon text-2xl font-bold" style={{ color }}>
              {card.word}
            </div>
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submitBluff(stage.index);
            }}
            className="mt-4"
          >
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoFocus
              rows={3}
              maxLength={110}
              aria-label="Your definition"
              placeholder="A small tool for…"
              className="w-full resize-none rounded-lg border bg-transparent px-3 py-2.5 text-[13px] leading-relaxed outline-none"
              style={{ borderColor: 'var(--cab-line)', color: 'var(--cab-text)' }}
            />
            <button
              type="submit"
              disabled={!draft.trim()}
              className="arcade-btn mt-2 w-full py-3 text-xs font-bold disabled:opacity-40"
              style={{ color }}
            >
              Into the pile
            </button>
          </form>
        </>
      )}

      {stage.s === 'read' && (
        <>
          <ReadAloud color={color} label={`Read all of these out — ${card.word}`}>
            <ol className="space-y-2 text-[13px] font-normal">
              {entries.map((entry, i) => (
                <li key={i}>
                  <span className="font-bold" style={{ color }}>
                    {i + 1}.
                  </span>{' '}
                  {entry.text}
                </li>
              ))}
            </ol>
          </ReadAloud>
          <BigButton color={color} onClick={() => setStage({ s: 'vote-pass', index: 0 })}>
            Now vote
          </BigButton>
        </>
      )}

      {stage.s === 'vote-pass' && (
        <PassDevice
          to={session.players[stage.index]}
          color={color}
          confirm={receipt ?? undefined}
          note="Which one is the real definition? Pick it, then lock your vote in."
          onReady={() => {
            setReceipt(null);
            setStage({ s: 'vote', index: stage.index });
          }}
        />
      )}

      {stage.s === 'vote' && (
        <>
          <PrivateBanner name={session.players[stage.index].name} />
          <p className="mb-2 text-center text-[10px] uppercase tracking-[0.2em]" style={{ color }}>
            {picked === null ? 'Pick the one you think is real' : 'Sure? Lock your vote in'}
          </p>
          <ul className="space-y-2">
            {entries.map((entry, i) => {
              // You cannot vote for your own lie. Hiding the button rather
              // than disabling it also stops it being a tell.
              const isMine = entry.author?.id === session.players[stage.index].id;
              if (isMine) return null;
              return (
                <li key={i}>
                  <button
                    type="button"
                    onClick={() => {
                      sfx.blip();
                      setPicked((prev) => (prev === i ? null : i));
                    }}
                    aria-pressed={picked === i}
                    className="w-full rounded-xl border px-3 py-3 text-left text-[13px] leading-snug transition"
                    style={{
                      borderColor: picked === i ? color : 'var(--cab-line)',
                      background: picked === i ? `${color}22` : 'transparent',
                    }}
                  >
                    <span className="mr-2 font-bold" style={{ color }}>
                      {i + 1}
                    </span>
                    {entry.text}
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="mt-4">
            <BigButton color={color} disabled={picked === null} onClick={() => castVote(stage.index)}>
              {picked === null ? 'Pick one first' : 'Lock my vote in'}
            </BigButton>
          </div>
        </>
      )}

      {stage.s === 'result' && (
        <>
          {!scored ? (
            <BigButton color={color} onClick={settle}>
              Reveal the real one
            </BigButton>
          ) : (
            <>
              <div className="rounded-xl border-2 p-4 text-center" style={{ borderColor: 'var(--neon-lime)' }}>
                <div className="text-[9px] uppercase tracking-[0.3em]" style={{ color: 'var(--cab-dim)' }}>
                  {card.word} really means
                </div>
                <div className="mt-1.5 text-[14px] font-bold leading-relaxed">{card.truth}</div>
              </div>
              <ul className="space-y-1.5">
                {entries.map((entry, i) => {
                  const backers = session.players.filter((p) => votes[p.id] === i);
                  return (
                    <li
                      key={i}
                      className="rounded-lg border px-3 py-2 text-[11px]"
                      style={{
                        borderColor: entry.author === null ? 'var(--neon-lime)' : 'var(--cab-line)',
                      }}
                    >
                      <div className="leading-snug">{entry.text}</div>
                      <div className="mt-1 text-[9px]" style={{ color: 'var(--cab-dim)' }}>
                        {entry.author === null ? 'The truth' : `${entry.author.name}'s invention`}
                        {backers.length > 0 && ` · fooled ${backers.map((b) => b.name).join(', ')}`}
                      </div>
                    </li>
                  );
                })}
              </ul>
              <BigButton color={color} onClick={nextRound}>
                Next word
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
