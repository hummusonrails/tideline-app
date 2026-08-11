/**
 * The party shelf.
 *
 * Same neon room as the arcade, different furniture: these aren't cabinets
 * with high scores, they're boxes you take off a shelf when there are six of
 * you and one phone. The lobby leads with what actually decides which game
 * gets played — how many people are here and how long you've got.
 */

import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Users, Clock, Gamepad2 } from 'lucide-react';
import { db } from '../lib/db';
import { PARTY_GAMES, STYLE_LABEL } from '../lib/party/catalog';
import { usePartyHistory } from '../lib/party/session';
import { hueColor } from '../lib/arcade/catalog';
import { sfx } from '../lib/arcade/sound';
import { prettyDate } from '../lib/time';
import { useArcadeRoom } from '../lib/arcade/room';
import { useVips, useVipRecord, type Vip } from '../lib/party/vips';
import { VipAvatar } from '../ui/party/VipAvatar';

export function PartyGames() {
  const history = usePartyHistory();
  const profiles = useLiveQuery(() => db.profiles.toArray(), []) ?? [];
  const vips = useVips();
  useArcadeRoom();

  return (
    <div className="arcade arcade-bg arcade-grid relative min-h-dvh overflow-hidden">

      <div className="relative px-4 pt-[max(env(safe-area-inset-top),1rem)] pb-32">
        <header>
          <div className="text-[9px] uppercase tracking-[0.42em]" style={{ color: 'var(--neon-cyan)' }}>
            One phone · everyone plays
          </div>
          <h1
            className="flicker neon mt-1 text-[26px] font-bold uppercase leading-none tracking-[0.14em]"
            style={{ color: 'var(--neon-violet)' }}
          >
            Family
          </h1>
          <h2
            className="neon text-[26px] font-bold uppercase leading-none tracking-[0.26em]"
            style={{ color: 'var(--neon-gold)' }}
          >
            Card Games
          </h2>
        </header>

        <p className="mt-3 text-[11px] leading-relaxed" style={{ color: 'var(--cab-dim)' }}>
          For the car, the lounge, or the long bit in the middle. Whoever opens
          a game is the host: pick who is playing, read the cards out, and the
          phone comes round when something needs to stay secret. The host plays
          too.
        </p>

        <nav className="mt-4 flex gap-2">
          <Link
            to="/arcade"
            onClick={() => sfx.blip()}
            className="arcade-btn flex-1 py-2 text-center text-[10px] font-bold"
            style={{ color: 'var(--cab-dim)' }}
          >
            <Gamepad2 size={12} className="mr-1.5 inline" />
            Arcade
          </Link>
          <span
            className="arcade-btn flex-1 py-2 text-center text-[10px] font-bold"
            style={{ color: 'var(--neon-violet)' }}
          >
            Party
          </span>
        </nav>

        <ul className="mt-4 space-y-2.5">
          {PARTY_GAMES.map((game) => {
            const color = hueColor(game.hue);
            const played = history.filter((h) => h.gameId === game.id).length;
            return (
              <li key={game.id}>
                <Link
                  to={`/party/${game.id}`}
                  onClick={() => sfx.coin()}
                  className="cab-tile flex items-start gap-3 rounded-xl p-3"
                  style={{ ['--cab-hue' as string]: String(game.hue) }}
                >
                  <span className="text-2xl leading-none" aria-hidden>
                    {game.glyph}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span
                      className="neon-soft block text-[12px] font-bold uppercase tracking-[0.14em]"
                      style={{ color }}
                    >
                      {game.title}
                    </span>
                    <span className="mt-1 block text-[11px] leading-snug" style={{ color: 'var(--cab-text)' }}>
                      {game.tagline}
                    </span>
                    <span
                      className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[9px] uppercase tracking-wider"
                      style={{ color: 'var(--cab-dim)' }}
                    >
                      <span className="inline-flex items-center gap-1">
                        <Users size={9} /> {game.minPlayers}–{game.maxPlayers}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Clock size={9} /> {game.minutes} min
                      </span>
                      <span>{STYLE_LABEL[game.style]}</span>
                      {played > 0 && <span style={{ color: 'var(--neon-lime)' }}>played {played}×</span>}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>

        {/* The guests of honour and what this phone has watched them do. */}
        <section className="mt-6">
          <h2 className="mb-2 text-[10px] uppercase tracking-[0.3em]" style={{ color: 'var(--neon-gold)' }}>
            ★ Guests of honour
          </h2>
          <ul className="grid grid-cols-2 gap-2">
            {vips.map((vip) => (
              <li key={vip.id}>
                <VipCard vip={vip} />
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[9px] leading-relaxed" style={{ color: 'var(--cab-dim)' }}>
            No accounts, no phones — they just sit down and play. Add or rename
            guests when you set up a game.
          </p>
        </section>

        {history.length > 0 && (
          <section className="mt-6">
            <h2 className="mb-2 text-[10px] uppercase tracking-[0.3em]" style={{ color: 'var(--cab-dim)' }}>
              Played on this phone
            </h2>
            <ul className="space-y-1.5">
              {history.slice(0, 6).map((session) => {
                const game = PARTY_GAMES.find((g) => g.id === session.gameId);
                const top = [...session.players].sort((a, b) => b.score - a.score)[0];
                const name =
                  profiles.find((p) => p.id === top?.memberId)?.displayName ?? top?.name ?? '—';
                return (
                  <li
                    key={session.id}
                    className="flex items-center gap-2 rounded-lg border px-3 py-2 text-[10px]"
                    style={{ borderColor: 'var(--cab-line)' }}
                  >
                    <span aria-hidden>{game?.glyph ?? '🎲'}</span>
                    <span className="min-w-0 flex-1 truncate">{game?.title ?? session.gameId}</span>
                    <span style={{ color: 'var(--neon-gold)' }}>
                      🥇 {name} {top ? top.score : ''}
                    </span>
                    <span className="shrink-0" style={{ color: 'var(--cab-dim)' }}>
                      {prettyDate(session.playedAt.slice(0, 10)).split(',')[0]}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

/**
 * A guest's card: the portrait plus what this phone has seen them do.
 *
 * A guest can't have a synced leaderboard — there's no account behind them —
 * so their record is honestly scoped to the device that watched the games.
 * It's still the thing that makes bringing them into a round feel like it
 * counted for something.
 */
function VipCard({ vip }: { vip: Vip }) {
  const record = useVipRecord(vip.id);
  return (
    <div
      className="flex items-center gap-2.5 rounded-xl border p-2.5"
      style={{ borderColor: 'rgba(229,184,66,0.45)' }}
    >
      <VipAvatar portrait={vip.portrait} size={38} name={vip.name} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[12px] font-bold">{vip.name}</div>
        <div className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--cab-dim)' }}>
          {record.games === 0
            ? 'Yet to play'
            : `${record.games} game${record.games === 1 ? '' : 's'} · ${record.wins} won`}
        </div>
      </div>
    </div>
  );
}
