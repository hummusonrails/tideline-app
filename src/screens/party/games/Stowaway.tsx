/**
 * The Stowaway — everybody can see the grid, everybody but one knows which
 * square is the secret.
 *
 * The pass round is the entire game and it has one hard requirement: the
 * Stowaway must not be able to tell from the interface that they're the
 * Stowaway any *earlier* than everyone else learns their own role. So every
 * player sees the identical screen shape — grid, then one highlighted panel —
 * and only the contents differ.
 *
 * The steal is what keeps a caught Stowaway in the game: named correctly,
 * they take the round anyway, so the crew has to weigh accusing loudly
 * against handing over clues.
 */

import { useMemo, useState } from 'react';
import { BigButton, PassDevice, PlayerPicker, PrivateBanner, ReadAloud, Scoreboard } from '../../../ui/party/PartyUI';
import { hueColor } from '../../../lib/arcade/catalog';
import { sfx } from '../../../lib/arcade/sound';
import { rngFromString, pick, randInt } from '../../../lib/arcade/rng';
import { STOWAWAY_TOPICS } from '../../../lib/party/decks';
import type { PartyPlayer } from '../../../lib/party/session';
import type { PartyGameProps } from '../shared';

type Stage =
  | { s: 'pass'; index: number }
  | { s: 'card'; index: number }
  | { s: 'talk' }
  | { s: 'vote' }
  | { s: 'steal'; accused: PartyPlayer }
  | { s: 'result'; caught: boolean; stolen: boolean; accused: PartyPlayer };

export default function Stowaway({ game, session, onFinish }: PartyGameProps) {
  const color = hueColor(game.hue);

  const { topic, secret, stowaway } = useMemo(() => {
    const rng = rngFromString(`stow-${session.round}-${session.players.length}`);
    const chosenTopic = pick(STOWAWAY_TOPICS, rng);
    return {
      topic: chosenTopic,
      secret: chosenTopic.words[randInt(rng, 0, chosenTopic.words.length - 1)],
      stowaway: session.players[randInt(rng, 0, session.players.length - 1)],
    };
  }, [session.round, session.players]);

  const [stage, setStage] = useState<Stage>({ s: 'pass', index: 0 });

  const settle = (accused: PartyPlayer, stolen: boolean) => {
    const caught = accused.id === stowaway.id;
    if (caught && !stolen) {
      for (const player of session.players) {
        if (player.id !== stowaway.id) session.addScore(player.id, 2);
      }
      sfx.right();
    } else {
      session.addScore(stowaway.id, 4);
      sfx.wrong();
    }
    setStage({ s: 'result', caught, stolen, accused });
  };

  const nextRound = () => {
    session.nextRound();
    setStage({ s: 'pass', index: 0 });
  };

  return (
    <div className="space-y-4">
      <Scoreboard standings={session.standings} color={color} />

      {stage.s === 'pass' && (
        <PassDevice
          to={session.players[stage.index]}
          color={color}
          note="Your card is on the next screen. Look at it alone, then pass straight on."
          onReady={() => setStage({ s: 'card', index: stage.index })}
        />
      )}

      {stage.s === 'card' && (
        <>
          <PrivateBanner name={session.players[stage.index].name} />
          <Grid topic={topic} secret={session.players[stage.index].id === stowaway.id ? null : secret} color={color} />
          {session.players[stage.index].id === stowaway.id ? (
            <div className="rounded-xl border-2 p-4 text-center" style={{ borderColor: 'var(--neon-red)' }}>
              <div className="neon text-xl font-bold uppercase tracking-[0.15em]" style={{ color: 'var(--neon-red)' }}>
                You are the Stowaway
              </div>
              <p className="mt-2 text-[11px] leading-relaxed" style={{ color: 'var(--cab-dim)' }}>
                You do not know the word. Bluff a clue that could fit half this grid,
                and work out the real one from what everybody else says.
              </p>
            </div>
          ) : (
            <div className="rounded-xl border-2 p-4 text-center" style={{ borderColor: color }}>
              <div className="text-[9px] uppercase tracking-[0.3em]" style={{ color: 'var(--cab-dim)' }}>
                The secret word
              </div>
              <div className="neon mt-1 text-2xl font-bold" style={{ color }}>
                {secret}
              </div>
              <p className="mt-2 text-[11px] leading-relaxed" style={{ color: 'var(--cab-dim)' }}>
                Prove you know it without giving it away.
              </p>
            </div>
          )}
          <BigButton
            color={color}
            onClick={() =>
              stage.index + 1 < session.players.length
                ? setStage({ s: 'pass', index: stage.index + 1 })
                : setStage({ s: 'talk' })
            }
          >
            {stage.index + 1 < session.players.length ? 'Got it — pass on' : 'Everyone has seen their card'}
          </BigButton>
        </>
      )}

      {stage.s === 'talk' && (
        <>
          <Grid topic={topic} secret={null} color={color} />
          <ReadAloud color={color} label="Host reads this out">
            Going round the table, everybody says one word about the secret. Then
            argue about it for as long as you like.
          </ReadAloud>
          <BigButton color={color} onClick={() => setStage({ s: 'vote' })}>
            Ready to vote
          </BigButton>
        </>
      )}

      {stage.s === 'vote' && (
        <>
          <ReadAloud color={color} label="Vote together">
            On three, everybody points. Then tap whoever the table accused.
          </ReadAloud>
          <PlayerPicker
            players={session.players}
            color={color}
            onPick={(accused) =>
              accused.id === stowaway.id ? setStage({ s: 'steal', accused }) : settle(accused, false)
            }
          />
        </>
      )}

      {stage.s === 'steal' && (
        <>
          <div className="text-center">
            <div className="neon text-xl font-bold uppercase" style={{ color: 'var(--neon-red)' }}>
              Caught
            </div>
            <p className="mt-2 text-[12px] leading-relaxed">
              {stage.accused.name} was the Stowaway — but they get one chance to steal
              it. {stage.accused.name}, tap the secret word.
            </p>
          </div>
          <Grid
            topic={topic}
            secret={null}
            color={color}
            onPick={(word) => settle(stage.accused, word === secret)}
          />
        </>
      )}

      {stage.s === 'result' && (
        <div className="space-y-4 text-center">
          <div
            className="neon text-xl font-bold uppercase tracking-[0.1em]"
            style={{ color: stage.caught && !stage.stolen ? 'var(--neon-lime)' : 'var(--neon-red)' }}
          >
            {stage.caught
              ? stage.stolen
                ? 'Stolen at the last second'
                : 'Crew wins'
              : 'The Stowaway got away'}
          </div>
          <p className="text-[12px] leading-relaxed" style={{ color: 'var(--cab-dim)' }}>
            {stowaway.name} was the Stowaway. The word was{' '}
            <strong style={{ color: 'var(--cab-text)' }}>{secret}</strong>.
            {!stage.caught && ` The table accused ${stage.accused.name}.`}
          </p>
          <BigButton color={color} onClick={nextRound}>
            Deal another
          </BigButton>
          <BigButton color="var(--cab-dim)" onClick={onFinish}>
            End the game
          </BigButton>
        </div>
      )}
    </div>
  );
}

function Grid({
  topic,
  secret,
  color,
  onPick,
}: {
  topic: { title: string; words: readonly string[] };
  /** Highlight this word. Null means "show the grid with nothing marked". */
  secret: string | null;
  color: string;
  onPick?: (word: string) => void;
}) {
  return (
    <div>
      <div className="mb-2 text-center text-[10px] uppercase tracking-[0.3em]" style={{ color: 'var(--cab-dim)' }}>
        {topic.title}
      </div>
      <div className="grid grid-cols-4 gap-1">
        {topic.words.map((word) => {
          const marked = secret === word;
          return (
            <button
              key={word}
              type="button"
              disabled={!onPick}
              onClick={() => onPick?.(word)}
              className="grid aspect-[5/4] place-items-center rounded px-0.5 text-center text-[9px] font-bold leading-tight"
              style={{
                background: marked ? color : 'rgba(255,255,255,0.05)',
                color: marked ? '#04010b' : 'var(--cab-text)',
                border: `1px solid ${marked ? color : 'var(--cab-line)'}`,
              }}
            >
              {word}
            </button>
          );
        })}
      </div>
    </div>
  );
}
