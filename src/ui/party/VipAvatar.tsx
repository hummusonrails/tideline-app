/**
 * Portraits for the guests of honour.
 *
 * The crew avatar catalog is a parts system: a base, a palette, eyes, a
 * mouth, a hat. It's built for members who sit down and compose one in the
 * studio, and stretching it to draw a grandmother would mean adding
 * grandmother-shaped parts to a catalog everyone else picks from.
 *
 * So the VIPs get their own hand-drawn portraits instead — the same 0–100
 * viewBox, the same inline-SVG-and-nothing-else approach, and a gold ring
 * that marks them as guests rather than crew wherever they turn up.
 */

import type { VipPortrait } from '../../lib/party/vips';

const GOLD = '#e5b842';

export function VipAvatar({
  portrait,
  size = 44,
  name = '',
  className = '',
}: {
  portrait: VipPortrait;
  size?: number;
  name?: string;
  className?: string;
}) {
  return (
    <span
      className={`relative inline-block shrink-0 ${className}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={name ? `${name}, guest of honour` : 'Guest of honour'}
    >
      <span
        className="block h-full w-full overflow-hidden rounded-full"
        style={{
          background: 'linear-gradient(160deg, #f6e9d6, #ffffff)',
          boxShadow: `0 0 0 2px ${GOLD}, 0 0 14px rgba(229,184,66,0.45)`,
        }}
      >
        <svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden>
          {portrait === 'bobbi' ? <Bobbi /> : portrait === 'zeidi' ? <Zeidi /> : <Guest />}
        </svg>
      </span>
      {/* A small star, so a VIP reads as a VIP at 24px in a scoreboard. */}
      <span
        aria-hidden
        className="absolute -bottom-0.5 -right-0.5 grid place-items-center rounded-full"
        style={{
          width: Math.max(13, size * 0.36),
          height: Math.max(13, size * 0.36),
          fontSize: Math.max(8, size * 0.22),
          background: GOLD,
          color: '#4a3400',
        }}
      >
        ★
      </span>
    </span>
  );
}

/** Silver curls, big round glasses, pearls, and a cardigan in cherry red. */
function Bobbi() {
  return (
    <>
      <ellipse cx="50" cy="90" rx="34" ry="20" fill="#b6413f" />
      <path d="M30 92 q20 -12 40 0 l0 18 l-40 0 z" fill="#d4726a" />
      {/* pearls */}
      <g fill="#fdf6e8">
        <circle cx="38" cy="86" r="2.6" />
        <circle cx="45" cy="89" r="2.6" />
        <circle cx="53" cy="89" r="2.6" />
        <circle cx="61" cy="85" r="2.6" />
      </g>
      {/* curls */}
      <g fill="#dfe3e8">
        <circle cx="26" cy="40" r="12" />
        <circle cx="74" cy="40" r="12" />
        <circle cx="34" cy="24" r="13" />
        <circle cx="66" cy="24" r="13" />
        <circle cx="50" cy="19" r="14" />
      </g>
      <ellipse cx="50" cy="50" rx="27" ry="29" fill="#f0c9a8" />
      <path d="M23 40 q27 -18 54 0 q-6 -20 -27 -20 q-21 0 -27 20z" fill="#eaeef2" />
      {/* glasses */}
      <g stroke="#8a6a10" strokeWidth="2.2" fill="rgba(255,255,255,0.5)">
        <circle cx="39" cy="52" r="9" />
        <circle cx="61" cy="52" r="9" />
        <path d="M48 52 h4" fill="none" />
      </g>
      <circle cx="39" cy="52" r="3" fill="#3b2a20" />
      <circle cx="61" cy="52" r="3" fill="#3b2a20" />
      {/* rosy cheeks and a proper smile */}
      <circle cx="28" cy="62" r="5" fill="#e79a94" opacity="0.65" />
      <circle cx="72" cy="62" r="5" fill="#e79a94" opacity="0.65" />
      <path d="M40 66 q10 10 20 0" stroke="#8d4a4a" strokeWidth="3" fill="none" strokeLinecap="round" />
      {/* earrings */}
      <circle cx="22" cy="55" r="3" fill={GOLD} />
      <circle cx="78" cy="55" r="3" fill={GOLD} />
    </>
  );
}

/** Flat cap, white beard, half-moon glasses, and a knitted jumper. */
function Zeidi() {
  return (
    <>
      <ellipse cx="50" cy="92" rx="34" ry="20" fill="#3d5c39" />
      <path d="M32 92 q18 -10 36 0 l0 18 l-36 0 z" fill="#5f8f68" />
      <path d="M38 90 h24" stroke="#3d5c39" strokeWidth="2" />
      <ellipse cx="50" cy="52" rx="27" ry="29" fill="#eec4a0" />
      {/* beard */}
      <path d="M23 52 q0 34 27 34 q27 0 27 -34 q-6 26 -27 26 q-21 0 -27 -26z" fill="#e8ecef" />
      <path d="M36 70 q14 12 28 0 q-14 20 -28 0z" fill="#f4f7f9" />
      {/* moustache */}
      <path d="M38 65 q12 -6 24 0 q-12 8 -24 0z" fill="#e8ecef" />
      {/* flat cap */}
      <path d="M20 36 q30 -26 60 0 z" fill="#5d6570" />
      <path d="M16 36 q34 -8 68 0 q-4 7 -34 7 q-30 0 -34 -7z" fill="#4a5058" />
      <path d="M14 38 q36 6 72 0 q-4 6 -36 6 q-32 0 -36 -6z" fill="#3a4048" />
      {/* half-moon glasses */}
      <g stroke="#8a6a10" strokeWidth="2" fill="none">
        <path d="M28 52 q10 9 20 0" />
        <path d="M52 52 q10 9 20 0" />
        <path d="M48 52 h4" />
      </g>
      <circle cx="38" cy="52" r="2.8" fill="#3b2a20" />
      <circle cx="62" cy="52" r="2.8" fill="#3b2a20" />
      {/* eyebrows with opinions */}
      <path d="M29 44 q9 -5 17 -1" stroke="#dfe3e8" strokeWidth="3.4" fill="none" strokeLinecap="round" />
      <path d="M54 43 q9 -4 17 1" stroke="#dfe3e8" strokeWidth="3.4" fill="none" strokeLinecap="round" />
    </>
  );
}

/** Anybody else who joins: a party hat and no particular opinions. */
function Guest() {
  return (
    <>
      <ellipse cx="50" cy="90" rx="33" ry="20" fill="#4f86b5" />
      <ellipse cx="50" cy="54" rx="27" ry="28" fill="#e9c39c" />
      <path d="M50 8 L68 40 L32 40 Z" fill="#ff2fd0" />
      <path d="M50 8 L58 24 L42 24 Z" fill="#ffd21e" />
      <circle cx="50" cy="8" r="4" fill="#7cff4d" />
      <circle cx="40" cy="52" r="3.4" fill="#3b2a20" />
      <circle cx="60" cy="52" r="3.4" fill="#3b2a20" />
      <path d="M40 66 q10 9 20 0" stroke="#8d4a4a" strokeWidth="3" fill="none" strokeLinecap="round" />
      <circle cx="30" cy="62" r="4.5" fill="#e79a94" opacity="0.6" />
      <circle cx="70" cy="62" r="4.5" fill="#e79a94" opacity="0.6" />
    </>
  );
}
