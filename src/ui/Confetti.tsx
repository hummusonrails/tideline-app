import { useEffect } from 'react';

/**
 * The confetti shower, on its own so anything can throw a party.
 *
 * It used to be welded into the tier Celebration, which meant the machinery
 * fired at most four times per person for the whole trip. Hunts, eggs and
 * moments all want the same two seconds of nonsense.
 *
 * Hand-rolled CSS rather than a library: a few dozen absolutely positioned
 * spans weigh nothing, and this ships to phones over ship WiFi.
 */

const PIECES = 28;
const COLORS = ['#e5b842', '#6faede', '#c68b5a', '#79a072', '#ff5a5f'];
const DURATION_MS = 2600;

export function Confetti({
  pieces = PIECES,
  onDone,
}: {
  pieces?: number;
  onDone?: () => void;
}) {
  useEffect(() => {
    if (!onDone) return;
    const t = window.setTimeout(onDone, DURATION_MS);
    return () => window.clearTimeout(t);
  }, [onDone]);

  return (
    // Decorative only — hidden from assistive tech, and reduced-motion users
    // skip it entirely (see index.css).
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[70] overflow-hidden motion-reduce:hidden"
    >
      {Array.from({ length: pieces }, (_, i) => (
        <span
          key={i}
          className="absolute block h-2 w-2 rounded-[1px] animate-[tideline-fall_2.4s_linear_forwards]"
          style={{
            left: `${(i * 37) % 100}%`,
            backgroundColor: COLORS[i % COLORS.length],
            animationDelay: `${(i % 8) * 0.12}s`,
            transform: `rotate(${(i * 47) % 360}deg)`,
          }}
        />
      ))}
    </div>
  );
}
