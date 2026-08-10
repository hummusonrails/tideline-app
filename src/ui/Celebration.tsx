import { TierBadge } from './TierBadge';
import type { Tier } from '../types';

/**
 * The moment someone crosses a tier.
 *
 * Confetti is hand-rolled CSS rather than a library — a few dozen absolutely
 * positioned spans weigh nothing next to adding a dependency for two seconds
 * of animation, and this ships to phones over ship WiFi.
 *
 * The reward wording comes from the trip config and is deliberately vague
 * ("Something fun"). The app alludes to a reward; it never names one or
 * attaches a value to it.
 */

const PIECES = 28;
const COLORS = ['#e5b842', '#6faede', '#c68b5a', '#79a072', '#ff5a5f'];

export function Celebration({
  tier,
  rewardLabel,
  onDismiss,
}: {
  tier: Tier;
  rewardLabel?: string;
  onDismiss: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-black/50 p-6"
      onClick={onDismiss}
      role="dialog"
      aria-live="polite"
      aria-label={`${tier} unlocked`}
    >
      {/* Decorative only — hidden from assistive tech, and reduced-motion
          users get the card without the shower (see index.css). */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden motion-reduce:hidden">
        {Array.from({ length: PIECES }, (_, i) => (
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

      <div
        className="glass rounded-[28px] px-6 py-7 text-center max-w-xs w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center mb-3">
          <TierBadge tier={tier} />
        </div>
        <div className="font-display text-2xl font-semibold capitalize">{tier} unlocked</div>
        {rewardLabel && (
          <div className="text-sm text-ink-600 mt-1">{rewardLabel} is coming your way.</div>
        )}
        <button
          type="button"
          onClick={onDismiss}
          className="mt-5 w-full rounded-full bg-ink-900 text-white font-medium py-3 active:scale-[0.98] transition"
        >
          Nice
        </button>
      </div>
    </div>
  );
}
