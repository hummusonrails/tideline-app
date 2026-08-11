/**
 * Hosting a party game, start to finish.
 *
 * Three acts: pick who is playing, play, then settle up. The middle act is
 * the only part a game implements — the roster, the rules card and the whole
 * end-of-game settlement (recording, posting the results, paying the podium)
 * live here so that ten games don't each get their own slightly different
 * version of them.
 */

import { Suspense, lazy, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { Award, MessageSquare, RotateCcw, Users } from 'lucide-react';
import { PartyShell, BigButton, PlayerFace, Scoreboard } from '../ui/party/PartyUI';
import { VipAvatar } from '../ui/party/VipAvatar';
import { addVip, isVipId, removeVip, renameVip, useVips, type Vip } from '../lib/party/vips';
import { partyGameById, STYLE_LABEL, type PartyGameDef } from '../lib/party/catalog';
import {
  awardPodium,
  canAwardPodium,
  postResults,
  recordSession,
  usePartySession,
  useHostId,
  PARTY_HOST_POINTS,
  PODIUM_BONUS,
  type PartyPlayer,
} from '../lib/party/session';
import { useArcadeContent } from '../lib/arcade/content';
import { hueColor } from '../lib/arcade/catalog';
import { sfx } from '../lib/arcade/sound';
import type { PartyGameProps } from './party/shared';

const PARTY_COMPONENTS: Record<string, ComponentType<PartyGameProps>> = {
  'blank-sea': lazy(() => import('./party/games/BlankSea')),
  'like-for-like': lazy(() => import('./party/games/LikeForLike')),
  'port-codes': lazy(() => import('./party/games/PortCodes')),
  'one-word': lazy(() => import('./party/games/OneWord')),
  'the-dial': lazy(() => import('./party/games/TheDial')),
  herd: lazy(() => import('./party/games/Herd')),
  stowaway: lazy(() => import('./party/games/Stowaway')),
  'tall-tales': lazy(() => import('./party/games/TallTales')),
  'night-watch': lazy(() => import('./party/games/NightWatch')),
  'hold-it-up': lazy(() => import('./party/games/HoldItUp')),
};

type Act = 'setup' | 'playing' | 'results';

export function PartyGame() {
  const { gameId } = useParams();
  const game = partyGameById(gameId);
  if (!game) return <Navigate to="/party" replace />;
  return <Host game={game} />;
}

function Host({ game }: { game: PartyGameDef }) {
  const navigate = useNavigate();
  const content = useArcadeContent();
  const hostId = useHostId();
  const color = hueColor(game.hue);

  const [act, setAct] = useState<Act>('setup');
  const [roster, setRoster] = useState<PartyPlayer[]>([]);
  const session = usePartySession(roster);

  return (
    <PartyShell game={game} onExit={() => navigate('/party')}>
      {act === 'setup' && (
        <Setup
          game={game}
          crew={content.crew}
          hostId={hostId}
          onStart={(players) => {
            setRoster(players);
            setAct('playing');
            sfx.coin();
          }}
        />
      )}

      {act === 'playing' && (
        <Suspense fallback={<Loading color={color} />}>
          <GameBody game={game} session={session} content={content} onFinish={() => setAct('results')} />
        </Suspense>
      )}

      {act === 'results' && (
        <Results
          game={game}
          session={session}
          hostId={hostId}
          onPlayAgain={() => {
            session.resetScores();
            setAct('playing');
          }}
          onNewRoster={() => {
            session.resetScores();
            setAct('setup');
          }}
        />
      )}
    </PartyShell>
  );
}

function GameBody(props: PartyGameProps) {
  const Game = PARTY_COMPONENTS[props.game.id];
  if (!Game) return <Loading color={hueColor(props.game.hue)} />;
  return <Game {...props} />;
}

function Loading({ color }: { color: string }) {
  return (
    <div className="grid place-items-center py-20">
      <span className="blink text-[10px] uppercase tracking-[0.3em]" style={{ color }}>
        Dealing…
      </span>
    </div>
  );
}

// ---------- act one: who is playing ----------

function Setup({
  game,
  crew,
  hostId,
  onStart,
}: {
  game: PartyGameDef;
  crew: { id: string; name: string; spec: PartyPlayer['spec'] }[];
  hostId: string | null;
  onStart: (players: PartyPlayer[]) => void;
}) {
  const color = hueColor(game.hue);
  const vips = useVips();
  const [picked, setPicked] = useState<Set<string>>(() => new Set<string>());
  const [guestName, setGuestName] = useState('');

  // The host is in by default — they're holding the phone, and the single most
  // common setup mistake would be forgetting to add yourself. This can't be an
  // initialiser: the crew arrives from a live query a tick later, so on the
  // first render there is nobody to match the host against yet. It applies
  // once, and never fights a host who has already started picking.
  const hostDefaulted = useRef(false);
  useEffect(() => {
    if (hostDefaulted.current || !hostId) return;
    if (!crew.some((c) => c.id === hostId)) return;
    hostDefaulted.current = true;
    setPicked((prev) => (prev.size === 0 ? new Set([hostId]) : prev));
  }, [crew, hostId]);

  const chosen = useMemo<PartyPlayer[]>(
    () => [
      ...crew.filter((c) => picked.has(c.id)).map((c) => ({ ...c, vip: undefined })),
      ...vips
        .filter((v) => picked.has(v.id))
        .map((v) => ({ id: v.id, name: v.name, spec: null, vip: v.portrait })),
    ],
    [crew, vips, picked],
  );

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const enough = chosen.length >= game.minPlayers && chosen.length <= game.maxPlayers;

  return (
    <div className="space-y-5">
      <div className="rounded-xl border p-4" style={{ borderColor: 'var(--cab-line)' }}>
        <div className="mb-1 flex items-center gap-2 text-[9px] uppercase tracking-[0.25em]" style={{ color }}>
          <Users size={12} /> {STYLE_LABEL[game.style]} · {game.minPlayers}–{game.maxPlayers} players ·{' '}
          {game.minutes} min
        </div>
        <p className="text-[12px] leading-relaxed" style={{ color: 'var(--cab-dim)' }}>
          {game.tagline}
        </p>
      </div>

      <section>
        <h2 className="mb-2 text-[10px] uppercase tracking-[0.3em]" style={{ color: 'var(--cab-dim)' }}>
          Who is playing?
        </h2>
        {crew.length === 0 && (
          <p className="mb-3 text-[11px] leading-relaxed" style={{ color: 'var(--cab-dim)' }}>
            No crew profiles have synced to this phone yet. Add players by name below —
            they'll play exactly the same, they just won't have their avatars.
          </p>
        )}
        <div className="grid grid-cols-4 gap-2">
          {crew.map((member) => {
            const on = picked.has(member.id);
            return (
              <button
                key={member.id}
                type="button"
                onClick={() => {
                  sfx.blip();
                  toggle(member.id);
                }}
                aria-pressed={on}
                className="grid place-items-center gap-1 rounded-xl border p-2 transition"
                style={{
                  borderColor: on ? color : 'var(--cab-line)',
                  background: on ? `${color}1f` : 'transparent',
                  opacity: on ? 1 : 0.5,
                }}
              >
                <PlayerFace
                  player={{ id: member.id, name: member.name, spec: member.spec }}
                  size={40}
                />
                <span className="w-full truncate text-center text-[10px]">{member.name}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* Guests of honour: people who play but have no account. They score,
          they win, they go on the board — they just can't be paid in trip
          points, because there's no device of theirs to mint them. */}
      <section>
        <h2 className="mb-2 text-[10px] uppercase tracking-[0.3em]" style={{ color: 'var(--neon-gold)' }}>
          ★ Guests of honour
        </h2>
        <div className="grid grid-cols-4 gap-2">
          {vips.map((vip) => (
            <VipTile
              key={vip.id}
              vip={vip}
              on={picked.has(vip.id)}
              onToggle={() => {
                sfx.blip();
                toggle(vip.id);
              }}
              onRename={(name) => void renameVip(vip.id, name)}
              onRemove={() => {
                setPicked((prev) => {
                  const next = new Set(prev);
                  next.delete(vip.id);
                  return next;
                });
                void removeVip(vip.id);
              }}
            />
          ))}
        </div>

        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const name = guestName.trim();
            if (!name) return;
            void addVip(name).then((vip) => setPicked((prev) => new Set(prev).add(vip.id)));
            setGuestName('');
            sfx.blip();
          }}
        >
          <input
            value={guestName}
            onChange={(e) => setGuestName(e.target.value)}
            placeholder="Add another guest"
            maxLength={14}
            className="min-w-0 flex-1 rounded-lg border bg-transparent px-3 py-2 text-[12px] outline-none"
            style={{ borderColor: 'var(--cab-line)', color: 'var(--cab-text)' }}
          />
          <button
            type="submit"
            disabled={!guestName.trim()}
            className="arcade-btn shrink-0 text-[10px] font-bold disabled:opacity-40"
            style={{ color: 'var(--neon-gold)' }}
          >
            Add
          </button>
        </form>
        <p className="mt-2 text-[9px] leading-relaxed" style={{ color: 'var(--cab-dim)' }}>
          Guests keep score and win games. They don't collect trip points —
          there's no account behind them. Tap a name to change it.
        </p>
      </section>

      <section>
        <h2 className="mb-2 text-[10px] uppercase tracking-[0.3em]" style={{ color: 'var(--cab-dim)' }}>
          How it works
        </h2>
        <ol className="space-y-1.5">
          {game.howTo.map((step, i) => (
            <li key={i} className="flex gap-2 text-[12px] leading-relaxed">
              <span className="shrink-0 font-bold" style={{ color }}>
                {i + 1}.
              </span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
        {game.passes && (
          <p className="mt-3 rounded-lg border px-3 py-2 text-[10px] leading-relaxed"
             style={{ borderColor: 'var(--cab-line)', color: 'var(--cab-dim)' }}>
            📱 This one passes the phone around. Everyone else can put theirs away.
          </p>
        )}
      </section>

      <BigButton color={color} disabled={!enough} onClick={() => onStart(chosen)}>
        {chosen.length < game.minPlayers
          ? `Need ${game.minPlayers - chosen.length} more player${game.minPlayers - chosen.length === 1 ? '' : 's'}`
          : chosen.length > game.maxPlayers
          ? `Too many — max ${game.maxPlayers}`
          : `Start with ${chosen.length}`}
      </BigButton>
    </div>
  );
}

/**
 * A guest tile: tap the portrait to bring them in, tap the name to rename.
 *
 * Renaming in place matters more than it sounds — the shipped defaults are
 * kinship words, and every family says them slightly differently. Long-press
 * removes a guest, which is deliberately the least discoverable action here.
 */
function VipTile({
  vip,
  on,
  onToggle,
  onRename,
  onRemove,
}: {
  vip: Vip;
  on: boolean;
  onToggle: () => void;
  onRename: (name: string) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(vip.name);

  return (
    <div
      className="grid place-items-center gap-1 rounded-xl border p-2"
      style={{
        borderColor: on ? 'var(--neon-gold)' : 'var(--cab-line)',
        background: on ? 'rgba(229,184,66,0.12)' : 'transparent',
        opacity: on ? 1 : 0.55,
      }}
    >
      <button type="button" onClick={onToggle} aria-pressed={on} aria-label={`${vip.name} plays`}>
        <VipAvatar portrait={vip.portrait} size={40} name={vip.name} />
      </button>
      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onRename(draft);
            setEditing(false);
          }}
        >
          <input
            value={draft}
            autoFocus
            maxLength={16}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => {
              onRename(draft);
              setEditing(false);
            }}
            aria-label={`Rename ${vip.name}`}
            className="w-full bg-transparent text-center text-[10px] outline-none"
            style={{ color: 'var(--cab-text)' }}
          />
        </form>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(true)}
          onContextMenu={(e) => {
            e.preventDefault();
            onRemove();
          }}
          className="w-full truncate text-center text-[10px]"
        >
          {vip.name}
        </button>
      )}
    </div>
  );
}

// ---------- act three: settling up ----------

function Results({
  game,
  session,
  hostId,
  onPlayAgain,
  onNewRoster,
}: {
  game: PartyGameDef;
  session: ReturnType<typeof usePartySession>;
  hostId: string | null;
  onPlayAgain: () => void;
  onNewRoster: () => void;
}) {
  const navigate = useNavigate();
  const color = hueColor(game.hue);
  const [posted, setPosted] = useState(false);
  const [awarded, setAwarded] = useState<number | null>(null);
  const [canAward, setCanAward] = useState(false);

  // Record once, on arrival. The host's own points are the only thing minted
  // automatically — everything else on this screen is a deliberate tap.
  //
  // The guard is a ref, not state. Under StrictMode this effect runs, cleans
  // up and runs again inside the same commit, and a state flag set in the
  // first pass is still `false` when the second one reads it — which wrote the
  // session, the completion and the host's points twice. A ref is updated
  // synchronously and holds across the remount.
  const savedRef = useRef(false);
  useEffect(() => {
    if (savedRef.current || !hostId) return;
    savedRef.current = true;
    void recordSession({ game, hostId, standings: session.standings });
    void canAwardPodium(hostId).then(setCanAward);
    sfx.levelUp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostId]);

  const winner = session.standings[0];

  return (
    <div className="space-y-5">
      <div className="text-center">
        <div className="text-[10px] uppercase tracking-[0.3em]" style={{ color: 'var(--cab-dim)' }}>
          Final scores
        </div>
        {winner && winner.score > 0 && (
          <div className="pop-in mt-3">
            <PlayerFace player={winner.player} size={78} />
            <div className="neon mt-2 text-xl font-bold uppercase tracking-[0.1em]" style={{ color: 'var(--neon-gold)' }}>
              {winner.player.name}
            </div>
            <div className="text-[10px] uppercase tracking-[0.25em]" style={{ color: 'var(--cab-dim)' }}>
              wins with {winner.score}
            </div>
          </div>
        )}
      </div>

      <ol className="space-y-1.5">
        {session.standings.map(({ player, score, rank }) => (
          <li
            key={player.id}
            className="flex items-center gap-3 rounded-xl border px-3 py-2"
            style={{ borderColor: rank === 1 ? 'var(--neon-gold)' : 'var(--cab-line)' }}
          >
            <span className="tabular w-4 text-[11px]" style={{ color: 'var(--cab-dim)' }}>
              {rank}
            </span>
            <PlayerFace player={player} size={30} />
            <span className="min-w-0 flex-1 truncate text-[13px] font-bold">{player.name}</span>
            <span className="tabular text-base font-bold" style={{ color }}>
              {score}
            </span>
          </li>
        ))}
      </ol>

      {hostId && (
        <p className="text-center text-[10px]" style={{ color: 'var(--neon-lime)' }}>
          +{PARTY_HOST_POINTS} trip points for hosting
        </p>
      )}
      {session.standings.some((entry) => isVipId(entry.player.id)) && (
        <p className="text-center text-[9px] leading-relaxed" style={{ color: 'var(--cab-dim)' }}>
          ★ Guests of honour keep their place on the board — trip points only go
          to crew with accounts.
        </p>
      )}

      <div className="space-y-2">
        <button
          type="button"
          disabled={!hostId || posted}
          onClick={() => {
            if (!hostId) return;
            void postResults({ game, hostId, standings: session.standings });
            setPosted(true);
            sfx.coin();
          }}
          className="arcade-btn w-full py-2.5 text-[11px] font-bold disabled:opacity-40"
          style={{ color: 'var(--neon-cyan)' }}
        >
          <MessageSquare size={13} className="mr-1.5 inline" />
          {posted ? 'Posted to the family chat' : 'Post the scores to chat'}
        </button>

        {/* Only a parent can hand out points to other people — the app's one
            sanctioned cross-member mint. See lib/party/session.ts. */}
        {canAward && (
          <button
            type="button"
            disabled={awarded !== null}
            onClick={() => {
              if (!hostId) return;
              void awardPodium({ game, hostId, standings: session.standings }).then(setAwarded);
              sfx.record();
            }}
            className="arcade-btn w-full py-2.5 text-[11px] font-bold disabled:opacity-40"
            style={{ color: 'var(--neon-gold)' }}
          >
            <Award size={13} className="mr-1.5 inline" />
            {awarded === null
              ? `Award the podium (${PODIUM_BONUS.join('/')})`
              : `Awarded ${awarded} points`}
          </button>
        )}
      </div>

      <Scoreboard standings={session.standings} color={color} />

      <div className="flex gap-2">
        <BigButton color={color} onClick={onPlayAgain}>
          <RotateCcw size={14} className="mr-1.5 inline" />
          Again
        </BigButton>
        <BigButton color="var(--neon-violet)" onClick={onNewRoster}>
          New players
        </BigButton>
      </div>
      <button
        type="button"
        onClick={() => navigate('/party')}
        className="w-full py-2 text-[10px] uppercase tracking-[0.25em]"
        style={{ color: 'var(--cab-dim)' }}
      >
        Back to the shelf
      </button>
    </div>
  );
}
