/**
 * Port Codes — two teams, a five-by-five grid, and one word of help at a time.
 *
 * The private information here is bigger than in any other game on the shelf:
 * two Signallers share a key that decides the whole game. So the key is
 * behind a press-and-hold rather than a toggle — a key left on screen because
 * somebody forgot to tap it off would end the game, and a hold can't be
 * forgotten.
 *
 * Place names from the trip are mixed into the word pool, which is quietly
 * the best thing about this cabinet: giving your team a one-word clue for a
 * town you visited on Tuesday is a clue only your family could get.
 */

import { useMemo, useState } from 'react';
import { Eye } from 'lucide-react';
import {
  BigButton, PassDevice, PlayerFace, PrivateBanner, ReadAloud, Scoreboard,
} from '../../../ui/party/PartyUI';
import { hueColor } from '../../../lib/arcade/catalog';
import { sfx } from '../../../lib/arcade/sound';
import { rngFromString, shuffle } from '../../../lib/arcade/rng';
import { codeWordPool } from '../../../lib/party/decks';
import type { PartyPlayer } from '../../../lib/party/session';
import type { PartyGameProps } from '../shared';

const GRID = 25;
type Owner = 'a' | 'b' | 'neutral' | 'wreck';

const OWNER_COLOR: Record<Owner, string> = {
  a: '#21e6ff',
  b: '#ff6b3d',
  neutral: '#8a7fb5',
  wreck: '#12060f',
};

interface Tile {
  word: string;
  owner: Owner;
  revealed: boolean;
}

type Stage =
  | { s: 'teams' }
  | { s: 'signaller-pass'; team: 'a' | 'b' }
  | { s: 'signaller-view'; team: 'a' | 'b' }
  | { s: 'guessing' }
  | { s: 'over'; winner: 'a' | 'b'; why: string };

export default function PortCodes({ game, session, content, onFinish }: PartyGameProps) {
  const color = hueColor(game.hue);
  const rng = useMemo(() => rngFromString(`codes-${session.round}`), [session.round]);

  /** Team A starts, so they get the extra word — and the extra pressure. */
  const [tiles, setTiles] = useState<Tile[]>(() => buildGrid(codeWordPool(content), rng));
  const [teams, setTeams] = useState<Record<string, 'a' | 'b'>>(() => autoTeams(session.players));
  const [signallers, setSignallers] = useState<Record<'a' | 'b', string | null>>({ a: null, b: null });
  const [turn, setTurn] = useState<'a' | 'b'>('a');
  const [stage, setStage] = useState<Stage>({ s: 'teams' });
  const [peeking, setPeeking] = useState(false);

  const left = (owner: 'a' | 'b') => tiles.filter((t) => t.owner === owner && !t.revealed).length;
  const teamOf = (id: string) => teams[id] ?? 'a';
  const roster = (team: 'a' | 'b') => session.players.filter((p) => teamOf(p.id) === team);

  const finishGame = (winner: 'a' | 'b', why: string) => {
    // Everybody on the winning team scores, Signaller included — the clue is
    // at least as much work as the guessing.
    for (const player of roster(winner)) session.addScore(player.id, 3);
    setTiles((prev) => prev.map((t) => ({ ...t, revealed: true })));
    setStage({ s: 'over', winner, why });
    sfx.levelUp();
  };

  const tapTile = (index: number) => {
    if (stage.s !== 'guessing') return;
    const tile = tiles[index];
    if (tile.revealed) return;

    setTiles((prev) => prev.map((t, i) => (i === index ? { ...t, revealed: true } : t)));

    if (tile.owner === 'wreck') {
      sfx.boom();
      finishGame(turn === 'a' ? 'b' : 'a', `${turn === 'a' ? 'Cyan' : 'Orange'} hit the wreck.`);
      return;
    }
    if (tile.owner === turn) {
      sfx.right();
      if (left(turn) - 1 === 0) {
        finishGame(turn, 'All their words found.');
      }
      return;
    }
    // Anything else — the other team's word or a neutral — ends the turn.
    sfx.wrong();
    const other = turn === 'a' ? 'b' : 'a';
    if (tile.owner === other && left(other) - 1 === 0) {
      finishGame(other, 'Handed them their last word.');
      return;
    }
    setTurn(other);
    setStage({ s: 'signaller-pass', team: other });
  };

  return (
    <div className="space-y-4">
      {stage.s === 'teams' && (
        <TeamSetup
          players={session.players}
          teams={teams}
          signallers={signallers}
          color={color}
          onToggleTeam={(id) =>
            setTeams((prev) => ({ ...prev, [id]: (prev[id] ?? 'a') === 'a' ? 'b' : 'a' }))
          }
          onSetSignaller={(team, id) => setSignallers((prev) => ({ ...prev, [team]: id }))}
          onStart={() => setStage({ s: 'signaller-pass', team: 'a' })}
        />
      )}

      {stage.s === 'signaller-pass' && (
        <PassDevice
          to={
            session.players.find((p) => p.id === signallers[stage.team]) ??
            roster(stage.team)[0] ??
            session.players[0]
          }
          color={OWNER_COLOR[stage.team]}
          note="You are the Signaller. Hold the button to see the key, then give one word and a number."
          onReady={() => setStage({ s: 'signaller-view', team: stage.team })}
        />
      )}

      {stage.s === 'signaller-view' && (
        <>
          <PrivateBanner
            name={session.players.find((p) => p.id === signallers[stage.team])?.name ?? 'Signaller'}
          />
          <Grid tiles={tiles} showKey={peeking} onTap={() => undefined} />
          <button
            type="button"
            onPointerDown={() => setPeeking(true)}
            onPointerUp={() => setPeeking(false)}
            onPointerLeave={() => setPeeking(false)}
            onPointerCancel={() => setPeeking(false)}
            className="arcade-btn w-full touch-none py-3 text-xs font-bold"
            style={{ color: OWNER_COLOR[stage.team] }}
          >
            <Eye size={14} className="mr-2 inline" />
            {peeking ? 'Key showing — let go to hide' : 'Hold to see the key'}
          </button>
          <p className="text-center text-[10px] leading-relaxed" style={{ color: 'var(--cab-dim)' }}>
            Say one word and a number out loud, then put the phone on the table for
            your team. {stage.team === 'a' ? 'Cyan' : 'Orange'} has {left(stage.team)} left.
          </p>
          <BigButton color={color} onClick={() => setStage({ s: 'guessing' })}>
            Clue given — team's turn
          </BigButton>
        </>
      )}

      {stage.s === 'guessing' && (
        <>
          <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.2em]">
            <span style={{ color: OWNER_COLOR.a, fontWeight: turn === 'a' ? 700 : 400 }}>
              Cyan {left('a')}
            </span>
            <span style={{ color: 'var(--cab-dim)' }}>
              {turn === 'a' ? 'Cyan' : 'Orange'} guessing
            </span>
            <span style={{ color: OWNER_COLOR.b, fontWeight: turn === 'b' ? 700 : 400 }}>
              {left('b')} Orange
            </span>
          </div>
          <Grid tiles={tiles} showKey={false} onTap={tapTile} />
          <BigButton
            color="var(--cab-dim)"
            onClick={() => {
              const other = turn === 'a' ? 'b' : 'a';
              setTurn(other);
              setStage({ s: 'signaller-pass', team: other });
            }}
          >
            Stop guessing — pass the turn
          </BigButton>
        </>
      )}

      {stage.s === 'over' && (
        <div className="space-y-4 text-center">
          <div
            className="neon text-2xl font-bold uppercase tracking-[0.1em]"
            style={{ color: OWNER_COLOR[stage.winner] }}
          >
            {stage.winner === 'a' ? 'Cyan' : 'Orange'} wins
          </div>
          <p className="text-[12px]" style={{ color: 'var(--cab-dim)' }}>
            {stage.why}
          </p>
          <Grid tiles={tiles} showKey onTap={() => undefined} />
          <Scoreboard standings={session.standings} color={color} />
          <BigButton
            color={color}
            onClick={() => {
              setTiles(buildGrid(codeWordPool(content), rngFromString(`codes-${session.round + 1}`)));
              setTurn('a');
              setStage({ s: 'signaller-pass', team: 'a' });
              session.nextRound();
            }}
          >
            Another grid
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
  tiles,
  showKey,
  onTap,
}: {
  tiles: Tile[];
  showKey: boolean;
  onTap: (index: number) => void;
}) {
  return (
    <div className="grid grid-cols-5 gap-1">
      {tiles.map((tile, i) => {
        const lit = tile.revealed || showKey;
        return (
          <button
            key={`${tile.word}-${i}`}
            type="button"
            onClick={() => onTap(i)}
            disabled={tile.revealed}
            className="grid aspect-[4/3] place-items-center rounded px-0.5 text-center text-[8px] font-bold uppercase leading-tight"
            style={{
              background: lit ? OWNER_COLOR[tile.owner] : 'rgba(255,255,255,0.06)',
              color: lit ? (tile.owner === 'wreck' ? '#ff6b7f' : '#04010b') : 'var(--cab-text)',
              border: `1px solid ${lit ? OWNER_COLOR[tile.owner] : 'var(--cab-line)'}`,
              opacity: tile.revealed && !showKey ? 0.75 : 1,
            }}
          >
            {tile.word}
          </button>
        );
      })}
    </div>
  );
}

function TeamSetup({
  players,
  teams,
  signallers,
  color,
  onToggleTeam,
  onSetSignaller,
  onStart,
}: {
  players: PartyPlayer[];
  teams: Record<string, 'a' | 'b'>;
  signallers: Record<'a' | 'b', string | null>;
  color: string;
  onToggleTeam: (id: string) => void;
  onSetSignaller: (team: 'a' | 'b', id: string) => void;
  onStart: () => void;
}) {
  const teamOf = (id: string) => teams[id] ?? 'a';
  const ready =
    (['a', 'b'] as const).every((t) => players.some((p) => teamOf(p.id) === t)) &&
    signallers.a &&
    signallers.b;

  return (
    <div className="space-y-4">
      <ReadAloud color={color} label="Set up">
        Split into two teams and pick a Signaller for each.
      </ReadAloud>

      <ul className="space-y-1.5">
        {players.map((player) => {
          const team = teamOf(player.id);
          const isSignaller = signallers[team] === player.id;
          return (
            <li
              key={player.id}
              className="flex items-center gap-2 rounded-xl border px-2.5 py-2"
              style={{ borderColor: OWNER_COLOR[team] }}
            >
              <PlayerFace player={player} size={30} />
              <span className="min-w-0 flex-1 truncate text-[12px] font-bold">{player.name}</span>
              <button
                type="button"
                onClick={() => onToggleTeam(player.id)}
                className="rounded border px-2 py-1 text-[9px] font-bold uppercase"
                style={{ borderColor: OWNER_COLOR[team], color: OWNER_COLOR[team] }}
              >
                {team === 'a' ? 'Cyan' : 'Orange'}
              </button>
              <button
                type="button"
                onClick={() => onSetSignaller(team, player.id)}
                className="rounded border px-2 py-1 text-[9px] font-bold uppercase"
                style={{
                  borderColor: isSignaller ? 'var(--neon-gold)' : 'var(--cab-line)',
                  color: isSignaller ? 'var(--neon-gold)' : 'var(--cab-dim)',
                }}
              >
                {isSignaller ? '★ Signal' : 'Signal'}
              </button>
            </li>
          );
        })}
      </ul>

      <BigButton color={color} disabled={!ready} onClick={onStart}>
        {ready ? 'Deal the grid' : 'Both teams need a Signaller'}
      </BigButton>
    </div>
  );
}

/** Alternate down the roster — a sane default nobody has to think about. */
function autoTeams(players: PartyPlayer[]): Record<string, 'a' | 'b'> {
  return Object.fromEntries(players.map((p, i) => [p.id, i % 2 === 0 ? 'a' : 'b'] as const));
}

function buildGrid(pool: readonly string[], rng: () => number): Tile[] {
  const words = shuffle(pool, rng).slice(0, GRID);
  while (words.length < GRID) words.push(`WORD ${words.length + 1}`);
  // 9 / 8 / 7 / 1 — the split that makes the first team's advantage exactly
  // one word, and leaves a single tile that loses the game outright.
  const owners: Owner[] = [
    ...Array<Owner>(9).fill('a'),
    ...Array<Owner>(8).fill('b'),
    ...Array<Owner>(7).fill('neutral'),
    'wreck',
  ];
  const assigned = shuffle(owners, rng);
  return words.map((word, i) => ({ word, owner: assigned[i], revealed: false }));
}
