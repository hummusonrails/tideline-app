interface AvatarProps {
  /** Stable token used to pick a deterministic color gradient. */
  seed: string;
  /** When set, takes precedence over the seed for the displayed initial. */
  displayName?: string;
  src?: string;
  size?: number;
  alt?: string;
  className?: string;
}

/**
 * Renders the user-provided photo if any, else a deterministic gradient
 * placeholder. The gradient is keyed by `seed` (kept stable across renders);
 * the displayed letter is the first character of `displayName` when present,
 * else the first character of `seed`.
 */
export function Avatar({
  seed,
  displayName,
  src,
  size = 40,
  alt = '',
  className = '',
}: AvatarProps) {
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
