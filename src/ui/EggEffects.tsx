import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Confetti } from './Confetti';
import { useEggs } from '../lib/eggRuntime';

/**
 * The visible half of an easter egg.
 *
 * Effects are named in the trip data ("aurora", "sonar") and drawn here.
 * Keeping the vocabulary generic is what lets the private repo decide *when*
 * an effect fires without the public repo learning anything about where this
 * family is going or when.
 *
 * Everything is CSS and a handful of spans. Reduced-motion users get the card
 * and skip the theatre.
 */
export function EggOverlay() {
  const { active, dismiss } = useEggs();

  return (
    <AnimatePresence>
      {active && (
        <>
          {active.effect === 'confetti' && <Confetti />}
          {active.effect === 'aurora' && <Aurora />}
          {active.effect === 'sonar' && <Sonar />}
          {active.effect === 'snow' && <Snow />}
          <motion.div
            key="card"
            className="fixed inset-0 z-[75] grid place-items-center p-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={dismiss}
            role="dialog"
            aria-live="polite"
          >
            <motion.div
              className="glass rounded-[28px] px-6 py-7 text-center max-w-xs w-full"
              initial={{ scale: 0.9, y: 12 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 200, damping: 18 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="text-xs uppercase tracking-wider text-ink-600 font-medium">
                You found something
              </div>
              <p className="mt-2 text-[15px] leading-relaxed text-ink-900 whitespace-pre-line">
                {active.copy}
              </p>
              {active.points > 0 && (
                <div className="mt-3 inline-flex items-center rounded-full bg-sage-200 text-sage-700 px-3 py-1 text-xs font-semibold">
                  +{active.points}
                </div>
              )}
              <button
                type="button"
                onClick={dismiss}
                className="mt-5 w-full rounded-full bg-ink-900 text-white font-medium py-3 active:scale-[0.98] transition"
              >
                🤫
              </button>
            </motion.div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

/** A slow wash of northern-lights colour across the top of the screen. */
function Aurora() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[70] overflow-hidden motion-reduce:hidden"
    >
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          className="absolute -inset-x-1/4 h-[45dvh] blur-3xl"
          style={{
            top: `${i * 8}%`,
            background: [
              'linear-gradient(90deg, transparent, rgba(121,160,114,0.55), rgba(111,174,222,0.5), transparent)',
              'linear-gradient(90deg, transparent, rgba(111,174,222,0.45), rgba(198,139,90,0.35), transparent)',
              'linear-gradient(90deg, transparent, rgba(229,184,66,0.35), rgba(121,160,114,0.45), transparent)',
            ][i],
          }}
          initial={{ opacity: 0, x: '-15%', skewY: -6 }}
          animate={{ opacity: [0, 0.9, 0.7, 0], x: ['-15%', '10%', '-5%'], skewY: [-6, 4, -2] }}
          transition={{ duration: 5, delay: i * 0.35, ease: 'easeInOut' }}
        />
      ))}
    </div>
  );
}

/** Expanding rings from the centre, like a depth sounder. */
function Sonar() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[70] grid place-items-center motion-reduce:hidden"
    >
      {[0, 1, 2, 3].map((i) => (
        <motion.span
          key={i}
          className="absolute rounded-full border-2 border-ocean/50"
          initial={{ width: 40, height: 40, opacity: 0.9 }}
          animate={{ width: 640, height: 640, opacity: 0 }}
          transition={{ duration: 3, delay: i * 0.55, ease: 'easeOut' }}
        />
      ))}
    </div>
  );
}

/** Slow, fat flakes. Sized for a glacier, not a blizzard. */
function Snow() {
  const flakes = 34;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[70] overflow-hidden motion-reduce:hidden"
    >
      {Array.from({ length: flakes }, (_, i) => (
        <motion.span
          key={i}
          className="absolute block rounded-full bg-white/85"
          style={{
            left: `${(i * 29) % 100}%`,
            width: 4 + (i % 4) * 2,
            height: 4 + (i % 4) * 2,
          }}
          initial={{ y: '-10dvh', opacity: 0 }}
          animate={{ y: '110dvh', opacity: [0, 1, 1, 0.6], x: [0, (i % 2 ? 18 : -18), 0] }}
          transition={{ duration: 6 + (i % 5), delay: (i % 10) * 0.4, ease: 'linear' }}
        />
      ))}
    </div>
  );
}

type Corner = 'tl' | 'tr' | 'bl' | 'br';

/** How close to a corner counts. Generous enough for a kid's thumb. */
const CORNER_PX = 56;

/**
 * Corner-tap detection for Konami-style codes.
 *
 * This *observes* taps rather than capturing them. The first version laid four
 * invisible buttons over the corners, which quietly ate real controls: the
 * bottom pair covered the lower half of the Today and Quest tabs, and the top
 * pair covered the header avatar and the sync chip. Tapping any of those near
 * a corner did nothing at all.
 *
 * A passive, non-capturing `pointerdown` listener has none of that problem. It
 * can't block, swallow or reorder anything — every real control behaves exactly
 * as if this weren't here, and the corner is noticed on the way past. A hidden
 * joke must never cost a working button.
 *
 * The sequence itself is tracked in the egg runtime, which sits above the
 * router: the corners overlap controls that navigate, so a buffer held here
 * would be wiped by the first tap of the code.
 */
export function CornerTaps() {
  const { tapCorner, deckRequested, clearDeckRequest } = useEggs();
  const navigate = useNavigate();

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const corner = cornerAt(e.clientX, e.clientY);
      if (corner) tapCorner(corner);
    };
    document.addEventListener('pointerdown', onPointerDown, { passive: true });
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [tapCorner]);

  useEffect(() => {
    if (!deckRequested) return;
    clearDeckRequest();
    navigate('/crew-deck');
  }, [deckRequested, clearDeckRequest, navigate]);

  return null;
}

function cornerAt(x: number, y: number): Corner | null {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const left = x <= CORNER_PX;
  const right = x >= w - CORNER_PX;
  const top = y <= CORNER_PX;
  const bottom = y >= h - CORNER_PX;
  if (top && left) return 'tl';
  if (top && right) return 'tr';
  if (bottom && left) return 'bl';
  if (bottom && right) return 'br';
  return null;
}
