import { CrewAvatar } from './CrewAvatar';
import { useAvatarSpec, useTierFor } from '../lib/avatar';

interface AvatarProps {
  /** Stable token used to pick a deterministic color gradient. */
  seed: string;
  /** When set, takes precedence over the seed for the displayed initial. */
  displayName?: string;
  src?: string;
  size?: number;
  alt?: string;
  className?: string;
  /**
   * Opt out of the composed crew avatar (the slot picker, where nobody is
   * signed in yet and there's no spec to read).
   */
  noCrew?: boolean;
}

/**
 * One member, drawn.
 *
 * Fallback chain, highest first: an uploaded photo, then the composed crew
 * avatar, then the deterministic gradient initial. The gradient is keyed by
 * `seed` so an un-decorated member still looks like themselves everywhere.
 */
export function Avatar({
  seed,
  displayName,
  src,
  size = 40,
  alt = '',
  className = '',
  noCrew = false,
}: AvatarProps) {
  const spec = useAvatarSpec(noCrew ? null : seed);
  const tier = useTierFor(noCrew ? null : seed);
  const sz = { width: size, height: size };

  if (src) {
    return (
      <img
        src={src}
        alt={alt}
        style={sz}
        className={`rounded-full object-cover ring-1 ring-white shadow-md ${className}`}
      />
    );
  }

  if (spec) {
    return (
      <CrewAvatar
        spec={spec}
        size={size}
        tier={tier}
        className={className}
        alt={alt || displayName || 'Crew avatar'}
      />
    );
  }

  const initial = (displayName ?? seed).charAt(0).toUpperCase();
  return (
    <div
      style={{ ...sz, background: gradientFor(seed) }}
      className={`grid place-items-center rounded-full text-white font-semibold ring-1 ring-white shadow-md ${className}`}
      aria-label={alt || displayName}
    >
      {initial}
    </div>
  );
}

function seedToHue(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h % 360;
}

/** Deterministic gradient string for a seed — shared with the slot picker. */
export function gradientFor(seed: string): string {
  const hue = seedToHue(seed);
  return `linear-gradient(135deg, hsl(${hue} 70% 60%), hsl(${(hue + 40) % 360} 70% 45%))`;
}
