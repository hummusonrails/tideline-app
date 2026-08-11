/**
 * Crew Match — pairs, against the clock.
 *
 * The deck is built from whatever the trip has: crew avatars first, then
 * places, then itinerary glyphs, then a generic seaside set. Because the
 * faces are the family's own, "I know where that one is" is a real feeling
 * rather than an abstract one.
 *
 * Scoring rewards efficiency, not just completion: every pair pays, a wrong
 * flip costs a little, and finishing early banks the remaining seconds.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { CrewAvatar } from '../../../ui/CrewAvatar';
import { useCountdown } from '../../../lib/arcade/loop';
import { sfx } from '../../../lib/arcade/sound';
import { hueColor } from '../../../lib/arcade/catalog';
import { rngFromString, shuffle } from '../../../lib/arcade/rng';
import { Board, FitBox, StatusRow } from '../shared';
import type { CrewMember } from '../../../lib/arcade/content';
import type { GameProps } from '../shared';

const PAIRS = 8;
const ROUND_SECONDS = 90;

interface Face {
  key: string;
  label: string;
  glyph?: string;
  member?: CrewMember;
}

interface Card {
  id: number;
  face: Face;
  flipped: boolean;
  matched: boolean;
}

const GENERIC_FACES: Face[] = [
  { key: 'anchor', label: 'Anchor', glyph: '⚓' },
  { key: 'wheel', label: 'Wheel', glyph: '🛞' },
  { key: 'whale', label: 'Whale', glyph: '🐋' },
  { key: 'crab', label: 'Crab', glyph: '🦀' },
  { key: 'shell', label: 'Shell', glyph: '🐚' },
  { key: 'wave', label: 'Wave', glyph: '🌊' },
  { key: 'sun', label: 'Sun', glyph: '🌅' },
  { key: 'map', label: 'Map', glyph: '🗺️' },
  { key: 'boat', label: 'Boat', glyph: '⛵' },
  { key: 'bird', label: 'Bird', glyph: '🐦' },
];

export default function CrewMatch({ run, content }: GameProps) {
  const color = hueColor(run.game.hue);
  const rng = useMemo(() => rngFromString(`match-${run.nonce}`), [run.nonce]);
  const [remaining, setRemaining] = useState(ROUND_SECONDS);
  const remainingRef = useRef(ROUND_SECONDS);
  const [cards, setCards] = useState<Card[]>(() => buildDeck(content.crew, content.highlights, rng));
  const [picked, setPicked] = useState<number[]>([]);
  const [moves, setMoves] = useState(0);
  const lockRef = useRef(false);

  const matched = cards.filter((c) => c.matched).length / 2;

  useCountdown(
    ROUND_SECONDS,
    run.phase === 'playing',
    (r) => {
      setRemaining(r);
      remainingRef.current = r;
      run.setStatus(`${r}s · ${matched}/${PAIRS} pairs`);
    },
    () => run.end(),
  );

  useEffect(() => {
    if (matched === PAIRS && run.phase === 'playing') {
      // Clearing the board with time left is where the good scores live.
      run.addScore(200 + remainingRef.current * 6);
      sfx.levelUp();
      window.setTimeout(() => run.end(), 500);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matched]);

  const flip = (id: number) => {
    if (run.phase !== 'playing' || lockRef.current) return;
    const card = cards.find((c) => c.id === id);
    if (!card || card.flipped || card.matched) return;

    const nextPicked = [...picked, id];
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, flipped: true } : c)));
    setPicked(nextPicked);
    sfx.blip();

    if (nextPicked.length < 2) return;

    setMoves((m) => m + 1);
    const [a, b] = nextPicked.map((cid) => cards.find((c) => c.id === cid)!);
    if (a.face.key === b.face.key) {
      run.addScore(60 + Math.max(0, 40 - moves * 2));
      sfx.right();
      setCards((prev) =>
        prev.map((c) => (nextPicked.includes(c.id) ? { ...c, matched: true, flipped: true } : c)),
      );
      setPicked([]);
    } else {
      // Lock input while the mismatch is on show — otherwise a fast third tap
      // flips a card that's about to be turned back over.
      lockRef.current = true;
      run.addScore(-6);
      sfx.wrong();
      window.setTimeout(() => {
        setCards((prev) =>
          prev.map((c) => (nextPicked.includes(c.id) ? { ...c, flipped: false } : c)),
        );
        setPicked([]);
        lockRef.current = false;
      }, 760);
    }
  };

  return (
    <Board>
      <StatusRow left={`${matched}/${PAIRS} pairs · ${moves} moves`} right={`${remaining}s`} />

      <FitBox ratio={(4 * 3) / (4 * 4)}>
        <div className="grid h-full w-full grid-cols-4 grid-rows-4 gap-2">
          {cards.map((card) => (
          <button
            key={card.id}
            type="button"
            onClick={() => flip(card.id)}
            aria-label={card.flipped || card.matched ? card.face.label : 'Face-down card'}
            className="grid min-h-0 place-items-center rounded-lg border transition-all"
            style={{
              borderColor: card.matched ? 'var(--neon-lime)' : 'var(--cab-line)',
              background: card.flipped || card.matched
                ? 'rgba(255,255,255,0.08)'
                : `linear-gradient(150deg, ${color}22, rgba(4,1,11,0.9))`,
              opacity: card.matched ? 0.55 : 1,
            }}
          >
            {card.flipped || card.matched ? (
              card.face.member?.spec ? (
                <CrewAvatar spec={card.face.member.spec} size={34} alt={card.face.label} />
              ) : (
                <span className="pop-in text-xl">{card.face.glyph ?? card.face.label.charAt(0)}</span>
              )
            ) : (
              <span className="text-lg" style={{ color }} aria-hidden>
                ?
              </span>
            )}
            </button>
          ))}
        </div>
      </FitBox>

      <p className="mt-2 shrink-0 text-center text-[9px] uppercase tracking-widest" style={{ color: 'var(--cab-dim)' }}>
        Clear the board before the clock does
      </p>
    </Board>
  );
}

/**
 * Build a deck of eight distinct faces.
 *
 * Crew first because they're the reason to play this cabinet, then trip
 * glyphs, then the generic set to make up the numbers — so the deck degrades
 * gracefully from "the whole family plus the itinerary" to "seaside icons"
 * without ever coming up short.
 */
function buildDeck(
  crew: readonly CrewMember[],
  highlights: readonly { glyph: string; title: string }[],
  rng: () => number,
): Card[] {
  const faces: Face[] = [];
  for (const member of crew) {
    faces.push({ key: `crew-${member.id}`, label: member.name, member });
  }

  const seenGlyph = new Set<string>();
  for (const h of highlights) {
    if (faces.length >= PAIRS) break;
    if (seenGlyph.has(h.glyph)) continue;
    seenGlyph.add(h.glyph);
    faces.push({ key: `hl-${h.glyph}`, label: h.title, glyph: h.glyph });
  }

  for (const face of GENERIC_FACES) {
    if (faces.length >= PAIRS) break;
    faces.push(face);
  }

  const chosen = faces.slice(0, PAIRS);
  const deck = shuffle([...chosen, ...chosen], rng);
  return deck.map((face, i) => ({ id: i, face, flipped: false, matched: false }));
}
