import {
  BASES, EYES, MOUTHS, HATS, ACCESSORIES,
  findPart, findPalette,
} from '../lib/avatarCatalog';
import { todayYMD } from '../lib/time';
import type { AvatarSpec, Tier } from '../types';

/**
 * Draws a composed crew avatar.
 *
 * Layer order is fixed: body, then accessory (which hangs below the chin),
 * then face, then hat. Parts are authored against that order — an accessory
 * drawn after the face would sit on top of the mouth.
 *
 * Output is one inline SVG string. No images, no network, no fonts: it
 * renders identically on a plane, and it's the same handful of bytes whether
 * it's 32px in a chat bubble or 160px in the editor.
 */

const TIER_RING: Record<Tier, string | null> = {
  none: null,
  bronze: '#c68b5a',
  silver: '#b9c0c7',
  gold: '#e5b842',
  platinum: '#8fa3b8',
};

export function CrewAvatar({
  spec,
  size = 40,
  tier = 'none',
  className = '',
  alt = '',
}: {
  spec: AvatarSpec;
  size?: number;
  /** Draws the tier ring, so the leaderboard reads as cosmetic progress. */
  tier?: Tier;
  className?: string;
  alt?: string;
}) {
  const palette = findPalette(spec.palette);
  const svg = [
    findPart(BASES, spec.base).draw(palette),
    findPart(ACCESSORIES, spec.accessory).draw(palette),
    findPart(EYES, spec.eyes).draw(palette),
    findPart(MOUTHS, spec.mouth).draw(palette),
    findPart(HATS, spec.hat).draw(palette),
  ].join('');

  const ring = TIER_RING[tier];
  const mood = isMoodCurrent(spec) ? spec.mood?.emoji : undefined;

  return (
    <span
      className={`relative inline-block shrink-0 ${className}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={alt || 'Crew avatar'}
    >
      <span
        className="block h-full w-full rounded-full overflow-hidden shadow-md"
        style={{
          background: `linear-gradient(160deg, ${palette.belly}, #ffffff)`,
          boxShadow: ring ? `0 0 0 2px ${ring}` : undefined,
        }}
      >
        <svg
          viewBox="0 0 100 100"
          width="100%"
          height="100%"
          aria-hidden
          // The parts are trusted, first-party path data compiled into the
          // bundle — never user input, never anything pulled from the backend.
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </span>
      {mood && (
        <span
          aria-hidden
          className="absolute -bottom-0.5 -right-0.5 grid place-items-center rounded-full bg-white shadow ring-1 ring-white"
          style={{ width: Math.max(14, size * 0.4), height: Math.max(14, size * 0.4), fontSize: Math.max(9, size * 0.24) }}
        >
          {mood}
        </span>
      )}
    </span>
  );
}

/**
 * A mood is only today's mood.
 *
 * Date-scoping means it expires by itself: nobody is stuck looking grumpy on
 * Thursday because of how Tuesday went, and there's no clearing chore. The
 * comparison is against the device's *local* day, matching how the mood was
 * stamped — a UTC day would flip the badge off mid-afternoon at a far enough
 * western longitude.
 */
export function isMoodCurrent(spec: Pick<AvatarSpec, 'mood'>, today: string = todayYMD()): boolean {
  return spec.mood?.date === today;
}
