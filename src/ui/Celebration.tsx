import { TierBadge } from './TierBadge';
import { Confetti } from './Confetti';
import type { Tier } from '../types';

/**
 * The moment someone crosses a tier.
 *
 * The shower itself now lives in {@link Confetti}, because hunts, eggs and
 * live moments all want it too — welding it in here meant the machinery fired
 * at most four times per person for a whole trip.
 *
 * The reward wording comes from the trip config and is deliberately vague
 * ("Something fun"). The app alludes to a reward; it never names one or
 * attaches a value to it.
 */

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
      <Confetti />

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
