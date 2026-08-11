/**
 * Night Watch — hidden roles for one phone.
 *
 * The classic version needs everybody to close their eyes and a moderator who
 * can't play. This one replaces the moderator with the device: the phone
 * visits each role in turn during the night, so the host is an ordinary
 * player who takes their turn like anyone else.
 *
 * The card swap is what makes the discussion interesting and it's also why
 * roles are held in state rather than fixed at deal time: after the Bosun has
 * been, the card you looked at may no longer be the role you are — including
 * for the Bosun, who never learns what they moved.
 */

import { useMemo, useState } from 'react';
import {
  BigButton, PassDevice, PlayerFace, PlayerPicker, PrivateBanner, ReadAloud, Scoreboard,
} from '../../../ui/party/PartyUI';
import { hueColor } from '../../../lib/arcade/catalog';
import { sfx } from '../../../lib/arcade/sound';
import { rngFromString, shuffle } from '../../../lib/arcade/rng';
import { NIGHT_ROLES, type NightRole } from '../../../lib/party/decks';
import type { PartyPlayer } from '../../../lib/party/session';
import type { PartyGameProps } from '../shared';

type Stage =
  | { s: 'deal'; index: number }
  | { s: 'card'; index: number }
  | { s: 'night-intro' }
  | { s: 'night-pass'; step: number }
  | { s: 'night-act'; step: number }
  | { s: 'day' }
  | { s: 'vote' }
  | { s: 'result'; accused: PartyPlayer; crewWon: boolean };

/** Roles that do something after dark, in the order the host calls them. */
const NIGHT_STEPS = NIGHT_ROLES.filter((r) => r.nightStep).sort(
  (a, b) => (a.nightOrder ?? 99) - (b.nightOrder ?? 99),
);

export default function NightWatch({ game, session, onFinish }: PartyGameProps) {
  const color = hueColor(game.hue);

  const [roles, setRoles] = useState<Record<string, string>>(() =>
    dealRoles(session.players, session.round),
  );
  const [stage, setStage] = useState<Stage>({ s: 'deal', index: 0 });
  const [inspected, setInspected] = useState<{ player: PartyPlayer; role: NightRole } | null>(null);
  const [swapPick, setSwapPick] = useState<PartyPlayer | null>(null);

  const roleOf = (playerId: string): NightRole =>
    NIGHT_ROLES.find((r) => r.id === roles[playerId]) ?? NIGHT_ROLES[NIGHT_ROLES.length - 1];

  const stowawayCount = useMemo(
    () => session.players.filter((p) => roleOf(p.id).team === 'stowaway').length,
    // Recomputed as cards move — the Navigator is told the count *now*.
    [roles, session.players],
  );

  /** Who currently holds a given night role, if anybody does. */
  const holderOf = (roleId: string): PartyPlayer | null =>
    session.players.find((p) => roles[p.id] === roleId) ?? null;

  const advanceNight = (step: number) => {
    // Skip straight past any night role nobody was dealt.
    let next = step + 1;
    while (next < NIGHT_STEPS.length && !holderOf(NIGHT_STEPS[next].id)) next += 1;
    setInspected(null);
    setSwapPick(null);
    if (next >= NIGHT_STEPS.length) setStage({ s: 'day' });
    else setStage({ s: 'night-pass', step: next });
  };

  const startNight = () => {
    let first = 0;
    while (first < NIGHT_STEPS.length && !holderOf(NIGHT_STEPS[first].id)) first += 1;
    if (first >= NIGHT_STEPS.length) setStage({ s: 'day' });
    else setStage({ s: 'night-pass', step: first });
  };

  const settle = (accused: PartyPlayer) => {
    const crewWon = roleOf(accused.id).team === 'stowaway';
    for (const player of session.players) {
      const team = roleOf(player.id).team;
      if (crewWon && team === 'crew') session.addScore(player.id, 2);
      if (!crewWon && team === 'stowaway') session.addScore(player.id, 3);
    }
    if (crewWon) sfx.right();
    else sfx.wrong();
    setStage({ s: 'result', accused, crewWon });
  };

  const nextRound = () => {
    session.nextRound();
    setRoles(dealRoles(session.players, session.round + 1));
    setStage({ s: 'deal', index: 0 });
  };

  return (
    <div className="space-y-4">
      <Scoreboard standings={session.standings} color={color} />

      {stage.s === 'deal' && (
        <PassDevice
          to={session.players[stage.index]}
          color={color}
          note="Your role is on the next screen. Look at it alone, remember it, then pass straight on."
          onReady={() => setStage({ s: 'card', index: stage.index })}
        />
      )}

      {stage.s === 'card' && (
        <>
          <PrivateBanner name={session.players[stage.index].name} />
          <RoleCard role={roleOf(session.players[stage.index].id)} />
          <BigButton
            color={color}
            onClick={() =>
              stage.index + 1 < session.players.length
                ? setStage({ s: 'deal', index: stage.index + 1 })
                : setStage({ s: 'night-intro' })
            }
          >
            {stage.index + 1 < session.players.length ? 'Remembered — pass on' : 'Everyone has a role'}
          </BigButton>
        </>
      )}

      {stage.s === 'night-intro' && (
        <>
          <ReadAloud color={color} label="Host reads this out">
            Night falls on the boat. The phone is about to visit a few people —
            when it comes to you, look at it alone.
          </ReadAloud>
          <BigButton color={color} onClick={startNight}>
            Begin the night
          </BigButton>
        </>
      )}

      {stage.s === 'night-pass' && (
        <PassDevice
          to={holderOf(NIGHT_STEPS[stage.step].id) ?? session.players[0]}
          color={color}
          note={NIGHT_STEPS[stage.step].nightStep}
          onReady={() => setStage({ s: 'night-act', step: stage.step })}
        />
      )}

      {stage.s === 'night-act' && (
        <NightAction
          role={NIGHT_STEPS[stage.step]}
          holder={holderOf(NIGHT_STEPS[stage.step].id)!}
          players={session.players}
          roleOf={roleOf}
          stowawayCount={stowawayCount}
          inspected={inspected}
          swapPick={swapPick}
          color={color}
          onInspect={(player) => setInspected({ player, role: roleOf(player.id) })}
          onSwapPick={(player) => {
            if (!swapPick) {
              setSwapPick(player);
              return;
            }
            if (swapPick.id === player.id) {
              setSwapPick(null);
              return;
            }
            setRoles((prev) => ({
              ...prev,
              [swapPick.id]: prev[player.id],
              [player.id]: prev[swapPick.id],
            }));
            sfx.select();
            advanceNight(stage.step);
          }}
          onDone={() => advanceNight(stage.step)}
        />
      )}

      {stage.s === 'day' && (
        <>
          <ReadAloud color={color} label="Morning">
            Everybody talk. Who was where, who is lying, and who is very keen to
            change the subject. When you have argued enough, vote.
          </ReadAloud>
          <p className="text-center text-[10px] leading-relaxed" style={{ color: 'var(--cab-dim)' }}>
            Remember: cards may have moved in the night. What you were dealt is
            not necessarily what you are now.
          </p>
          <BigButton color={color} onClick={() => setStage({ s: 'vote' })}>
            Ready to vote
          </BigButton>
        </>
      )}

      {stage.s === 'vote' && (
        <>
          <ReadAloud color={color} label="Vote together">
            On three, everybody points. Tap whoever the table accused.
          </ReadAloud>
          <PlayerPicker players={session.players} color={color} onPick={settle} />
        </>
      )}

      {stage.s === 'result' && (
        <div className="space-y-4">
          <div className="text-center">
            <div
              className="neon text-xl font-bold uppercase tracking-[0.12em]"
              style={{ color: stage.crewWon ? 'var(--neon-lime)' : 'var(--neon-red)' }}
            >
              {stage.crewWon ? 'Crew wins the night' : 'The Stowaways win'}
            </div>
            <p className="mt-2 text-[12px]" style={{ color: 'var(--cab-dim)' }}>
              The table accused {stage.accused.name}, who was the{' '}
              {roleOf(stage.accused.id).name}.
            </p>
          </div>
          <ul className="space-y-1.5">
            {session.players.map((player) => {
              const role = roleOf(player.id);
              return (
                <li
                  key={player.id}
                  className="flex items-center gap-2.5 rounded-lg border px-3 py-2"
                  style={{
                    borderColor: role.team === 'stowaway' ? 'var(--neon-red)' : 'var(--cab-line)',
                  }}
                >
                  <PlayerFace player={player} size={26} />
                  <span className="min-w-0 flex-1 truncate text-[12px]">{player.name}</span>
                  <span className="text-[11px]">{role.glyph}</span>
                  <span
                    className="text-[10px] uppercase tracking-wider"
                    style={{ color: role.team === 'stowaway' ? 'var(--neon-red)' : 'var(--cab-dim)' }}
                  >
                    {role.name}
                  </span>
                </li>
              );
            })}
          </ul>
          <BigButton color={color} onClick={nextRound}>
            Another night
          </BigButton>
          <BigButton color="var(--cab-dim)" onClick={onFinish}>
            End the game
          </BigButton>
        </div>
      )}
    </div>
  );
}

function RoleCard({ role }: { role: NightRole }) {
  const isStowaway = role.team === 'stowaway';
  return (
    <div
      className="rounded-xl border-2 p-5 text-center"
      style={{ borderColor: isStowaway ? 'var(--neon-red)' : 'var(--neon-cyan)' }}
    >
      <div className="text-4xl">{role.glyph}</div>
      <div
        className="neon mt-2 text-2xl font-bold uppercase tracking-[0.1em]"
        style={{ color: isStowaway ? 'var(--neon-red)' : 'var(--neon-cyan)' }}
      >
        {role.name}
      </div>
      <p className="mt-3 text-[12px] leading-relaxed" style={{ color: 'var(--cab-dim)' }}>
        {role.brief}
      </p>
    </div>
  );
}

function NightAction({
  role,
  holder,
  players,
  roleOf,
  stowawayCount,
  inspected,
  swapPick,
  color,
  onInspect,
  onSwapPick,
  onDone,
}: {
  role: NightRole;
  holder: PartyPlayer;
  players: PartyPlayer[];
  roleOf: (id: string) => NightRole;
  stowawayCount: number;
  inspected: { player: PartyPlayer; role: NightRole } | null;
  swapPick: PartyPlayer | null;
  color: string;
  onInspect: (player: PartyPlayer) => void;
  onSwapPick: (player: PartyPlayer) => void;
  onDone: () => void;
}) {
  return (
    <>
      <PrivateBanner name={holder.name} />

      {role.id === 'stowaway' && (
        <>
          <div className="rounded-xl border-2 p-4 text-center" style={{ borderColor: 'var(--neon-red)' }}>
            <div className="text-[9px] uppercase tracking-[0.3em]" style={{ color: 'var(--cab-dim)' }}>
              Your side
            </div>
            <div className="mt-2 space-y-1">
              {players
                .filter((p) => roleOf(p.id).team === 'stowaway')
                .map((p) => (
                  <div key={p.id} className="text-base font-bold" style={{ color: 'var(--neon-red)' }}>
                    {p.id === holder.id ? `${p.name} (you)` : p.name}
                  </div>
                ))}
            </div>
            {stowawayCount === 1 && (
              <p className="mt-2 text-[11px]" style={{ color: 'var(--cab-dim)' }}>
                You are on your own tonight.
              </p>
            )}
          </div>
          <BigButton color={color} onClick={onDone}>
            Done
          </BigButton>
        </>
      )}

      {role.id === 'lookout' && (
        <>
          {inspected ? (
            <>
              <div className="rounded-xl border-2 p-4 text-center" style={{ borderColor: color }}>
                <div className="text-[11px]" style={{ color: 'var(--cab-dim)' }}>
                  {inspected.player.name} is the
                </div>
                <div className="neon mt-1 text-2xl font-bold uppercase" style={{ color }}>
                  {inspected.role.glyph} {inspected.role.name}
                </div>
              </div>
              <BigButton color={color} onClick={onDone}>
                Done
              </BigButton>
            </>
          ) : (
            <>
              <p className="text-center text-[12px]" style={{ color: 'var(--cab-dim)' }}>
                Choose one person to inspect.
              </p>
              <PlayerPicker players={players} exclude={holder.id} color={color} onPick={onInspect} />
            </>
          )}
        </>
      )}

      {role.id === 'bosun' && (
        <>
          <p className="text-center text-[12px] leading-relaxed" style={{ color: 'var(--cab-dim)' }}>
            {swapPick
              ? `Swap ${swapPick.name}'s card with…`
              : 'Pick two people to swap. You will not see what you moved.'}
          </p>
          <PlayerPicker
            players={players}
            exclude={holder.id}
            color={color}
            selected={swapPick?.id}
            onPick={onSwapPick}
          />
          <BigButton color="var(--cab-dim)" onClick={onDone}>
            Swap nobody
          </BigButton>
        </>
      )}

      {role.id === 'navigator' && (
        <>
          <div className="rounded-xl border-2 p-6 text-center" style={{ borderColor: color }}>
            <div className="text-[10px] uppercase tracking-[0.3em]" style={{ color: 'var(--cab-dim)' }}>
              Stowaways aboard
            </div>
            <div className="neon mt-2 text-5xl font-bold" style={{ color }}>
              {stowawayCount}
            </div>
          </div>
          <BigButton color={color} onClick={onDone}>
            Done
          </BigButton>
        </>
      )}
    </>
  );
}

/**
 * Deal the roles.
 *
 * One Stowaway up to six players, two above that — the ratio that keeps the
 * discussion winnable in both directions. Everybody else gets a specialist
 * role until they run out, then plain Passengers, so a big table still has
 * something to talk about.
 */
function dealRoles(players: PartyPlayer[], round: number): Record<string, string> {
  const rng = rngFromString(`night-${players.length}-${round}`);
  const stowaways = players.length >= 7 ? 2 : 1;
  const specials = NIGHT_ROLES.filter((r) => r.team === 'crew' && r.id !== 'passenger');

  const deck: string[] = [
    ...Array<string>(stowaways).fill('stowaway'),
    ...specials.map((r) => r.id),
  ].slice(0, players.length);
  while (deck.length < players.length) deck.push('passenger');

  const shuffled = shuffle(deck, rng);
  return Object.fromEntries(players.map((p, i) => [p.id, shuffled[i]]));
}
