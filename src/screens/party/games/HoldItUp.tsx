/**
 * Hold It Up — phone on the forehead, everyone else describes, sixty seconds.
 *
 * The tap zones are enormous and split top/bottom rather than left/right,
 * because the person tapping cannot see the screen: they're feeling for a
 * half of a phone held at arm's length above their own head. Anything
 * smaller than half the display would be a guess.
 *
 * One of the categories is built from the trip itself, which turns the whole
 * game into "describe that place we went on Tuesday without saying its name".
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, SkipForward } from 'lucide-react';
import { BigButton, PassDevice, ReadAloud, Scoreboard } from '../../../ui/party/PartyUI';
import { hueColor } from '../../../lib/arcade/catalog';
import { sfx } from '../../../lib/arcade/sound';
import { rngFromString, shuffle } from '../../../lib/arcade/rng';
import { holdCategories, type HoldCategory } from '../../../lib/party/decks';
import type { PartyGameProps } from '../shared';

const TURN_SECONDS = 60;

type Stage =
  | { s: 'category' }
  | { s: 'pass'; index: number }
  | { s: 'ready'; index: number }
  | { s: 'playing'; index: number }
  | { s: 'turn-over'; index: number; got: number; skipped: number };

export default function HoldItUp({ game, session, content, onFinish }: PartyGameProps) {
  const color = hueColor(game.hue);
  const categories = useMemo(() => holdCategories(content), [content]);
  const [category, setCategory] = useState<HoldCategory | null>(null);
  const [stage, setStage] = useState<Stage>({ s: 'category' });

  return (
    <div className="space-y-4">
      {stage.s !== 'playing' && <Scoreboard standings={session.standings} color={color} />}

      {stage.s === 'category' && (
        <>
          <ReadAloud color={color} label="Pick a deck">
            Everybody plays the same deck. One minute each.
          </ReadAloud>
          <ul className="grid grid-cols-2 gap-2">
            {categories.map((cat) => (
              <li key={cat.id}>
                <button
                  type="button"
                  onClick={() => {
                    sfx.select();
                    setCategory(cat);
                    setStage({ s: 'pass', index: 0 });
                  }}
                  className="w-full rounded-xl border p-3 text-left"
                  style={{ borderColor: 'var(--cab-line)' }}
                >
                  <span className="text-xl" aria-hidden>
                    {cat.glyph}
                  </span>
                  <span className="mt-1 block text-[12px] font-bold">{cat.title}</span>
                  <span className="text-[9px]" style={{ color: 'var(--cab-dim)' }}>
                    {cat.cards.length} cards
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {stage.s === 'pass' && category && (
        <PassDevice
          to={session.players[stage.index]}
          color={color}
          note="Hold it up on your forehead — screen facing everyone else."
          onReady={() => setStage({ s: 'ready', index: stage.index })}
        />
      )}

      {stage.s === 'ready' && category && (
        <div className="grid place-items-center gap-5 py-10 text-center">
          <div className="text-[10px] uppercase tracking-[0.3em]" style={{ color: 'var(--cab-dim)' }}>
            {session.players[stage.index].name} · {category.title}
          </div>
          <p className="max-w-[18rem] text-[12px] leading-relaxed">
            Screen out, on your forehead. Everyone else describes what they can see
            — no saying the word, no rhymes, no spelling it.
          </p>
          <div className="w-full space-y-2">
            <BigButton color="var(--neon-lime)" onClick={() => setStage({ s: 'playing', index: stage.index })}>
              Start the minute
            </BigButton>
          </div>
        </div>
      )}

      {stage.s === 'playing' && category && (
        <Turn
          category={category}
          seed={`${category.id}-${stage.index}-${session.round}`}
          color={color}
          onEnd={(got, skipped) => {
            session.addScore(session.players[stage.index].id, got);
            setStage({ s: 'turn-over', index: stage.index, got, skipped });
          }}
        />
      )}

      {stage.s === 'turn-over' && category && (
        <div className="grid place-items-center gap-4 py-8 text-center">
          <div className="neon text-4xl font-bold" style={{ color }}>
            {stage.got}
          </div>
          <div className="text-[11px] uppercase tracking-[0.2em]" style={{ color: 'var(--cab-dim)' }}>
            {session.players[stage.index].name} · {stage.skipped} skipped
          </div>
          <div className="w-full space-y-2">
            {stage.index + 1 < session.players.length ? (
              <BigButton color={color} onClick={() => setStage({ s: 'pass', index: stage.index + 1 })}>
                Next player
              </BigButton>
            ) : (
              <BigButton
                color={color}
                onClick={() => {
                  session.nextRound();
                  setStage({ s: 'category' });
                }}
              >
                Round over — new deck
              </BigButton>
            )}
            <BigButton color="var(--cab-dim)" onClick={onFinish}>
              End the game
            </BigButton>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * One player's minute.
 *
 * The card index and the timer are refs, not state, for the same reason
 * everything else in the games is: the only thing React needs to know about
 * is which word is showing, and a timer that re-renders the whole tree once a
 * second would drop taps.
 */
function Turn({
  category,
  seed,
  color,
  onEnd,
}: {
  category: HoldCategory;
  seed: string;
  color: string;
  onEnd: (got: number, skipped: number) => void;
}) {
  const deck = useMemo(() => shuffle(category.cards, rngFromString(seed)), [category, seed]);
  const [index, setIndex] = useState(0);
  const [remaining, setRemaining] = useState(TURN_SECONDS);
  const [flash, setFlash] = useState<'got' | 'skip' | null>(null);
  const gotRef = useRef(0);
  const skippedRef = useRef(0);
  const endedRef = useRef(false);

  useEffect(() => {
    const id = window.setInterval(() => {
      setRemaining((t) => {
        if (t <= 1) {
          window.clearInterval(id);
          if (!endedRef.current) {
            endedRef.current = true;
            sfx.gameOver();
            onEnd(gotRef.current, skippedRef.current);
          }
          return 0;
        }
        if (t <= 6) sfx.tick();
        return t - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const advance = (kind: 'got' | 'skip') => {
    if (endedRef.current) return;
    if (kind === 'got') {
      gotRef.current += 1;
      sfx.right();
    } else {
      skippedRef.current += 1;
      sfx.blip();
    }
    setFlash(kind);
    window.setTimeout(() => setFlash(null), 180);
    setIndex((i) => i + 1);
  };

  const word = deck[index % deck.length];

  return (
    <div
      className="relative -mx-4 flex h-[70vh] touch-none select-none flex-col overflow-hidden rounded-xl"
      style={{
        background:
          flash === 'got' ? 'rgba(124,255,77,0.35)' : flash === 'skip' ? 'rgba(255,74,94,0.3)' : 'transparent',
      }}
    >
      <button
        type="button"
        onClick={() => advance('got')}
        aria-label="Got it"
        className="flex flex-1 flex-col items-center justify-end gap-2 border-b pb-4"
        style={{ borderColor: 'var(--cab-line)', color: 'var(--neon-lime)' }}
      >
        <Check size={26} />
        <span className="text-[10px] uppercase tracking-[0.3em]">Got it</span>
      </button>

      <div className="grid shrink-0 place-items-center px-3 py-6 text-center">
        <div className="tabular text-[11px] uppercase tracking-[0.3em]" style={{ color: remaining <= 6 ? 'var(--neon-red)' : 'var(--cab-dim)' }}>
          {remaining}s · {gotRef.current} got
        </div>
        <div
          className="neon mt-2 text-[30px] font-bold uppercase leading-tight"
          style={{ color }}
        >
          {word}
        </div>
      </div>

      <button
        type="button"
        onClick={() => advance('skip')}
        aria-label="Skip"
        className="flex flex-1 flex-col items-center justify-start gap-2 border-t pt-4"
        style={{ borderColor: 'var(--cab-line)', color: 'var(--neon-red)' }}
      >
        <span className="text-[10px] uppercase tracking-[0.3em]">Skip</span>
        <SkipForward size={26} />
      </button>
    </div>
  );
}
