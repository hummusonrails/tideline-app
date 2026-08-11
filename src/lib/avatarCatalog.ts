/**
 * The crew-avatar parts catalog.
 *
 * All art, no identity. Every entry here is a generic sea creature or a hat —
 * nothing in this file knows who is on the trip, where they're going, or how
 * many of them there are. That's what lets the drawings live in the public
 * repo while the *choices* live in the private one as `AvatarSpec`.
 *
 * Parts are plain SVG path data on a 0–100 canvas so they compose without a
 * renderer, scale to any size, and cost nothing over ship WiFi. Unlock rules
 * are evaluated locally against records the device already has, so a locked
 * hat needs no coordination and can't disagree between phones.
 */

import type { Tier } from '../types';
import { tierRank } from './celebrate';

export interface UnlockRule {
  /** Minimum tier. */
  tier?: Tier;
  /** Minimum easter eggs found. */
  eggsFound?: number;
  /** Minimum hunts fully completed. */
  huntsDone?: number;
  /** Minimum photos posted. */
  photos?: number;
  /** Minimum streak, in days. */
  streak?: number;
}

export interface Part {
  id: string;
  label: string;
  /** SVG markup fragment, drawn on a 0–100 viewBox. */
  draw: (c: Palette) => string;
  unlock?: UnlockRule;
}

export interface Palette {
  id: string;
  label: string;
  body: string;
  belly: string;
  accent: string;
  unlock?: UnlockRule;
}

// ---------- palettes ----------

export const PALETTES: Palette[] = [
  { id: 'otter',   label: 'Driftwood', body: '#a9744f', belly: '#e6cdb4', accent: '#6b4630' },
  { id: 'kelp',    label: 'Kelp',      body: '#5f8f68', belly: '#d9e8cf', accent: '#3c5f43' },
  { id: 'tide',    label: 'Tide',      body: '#4f86b5', belly: '#d5e7f4', accent: '#2f5b80' },
  { id: 'coral',   label: 'Coral',     body: '#d4726a', belly: '#f7ded9', accent: '#9c4a44' },
  { id: 'slate',   label: 'Slate',     body: '#5d6570', belly: '#dfe3e8', accent: '#3a4048' },
  { id: 'sunset',  label: 'Sunset',    body: '#dc9a4e', belly: '#fbe6c8', accent: '#a86a25', unlock: { tier: 'silver' } },
  { id: 'glacier', label: 'Glacier',   body: '#7fc8d8', belly: '#e6f7fb', accent: '#3f8fa3', unlock: { tier: 'gold' } },
  { id: 'aurora',  label: 'Aurora',    body: '#7d6fd1', belly: '#e4dffa', accent: '#4b3f96', unlock: { tier: 'platinum' } },
];

// ---------- bases ----------

/**
 * Each base draws a head silhouette plus whatever makes it recognisable
 * (ears, a beak, a fin). Eyes and mouths are layered on top by the renderer,
 * so every base has to leave the middle of the face clear.
 */
export const BASES: Part[] = [
  {
    id: 'otter',
    label: 'Otter',
    draw: (c) => `
      <ellipse cx="50" cy="56" rx="34" ry="32" fill="${c.body}"/>
      <circle cx="22" cy="26" r="10" fill="${c.body}"/>
      <circle cx="78" cy="26" r="10" fill="${c.body}"/>
      <circle cx="22" cy="26" r="5" fill="${c.accent}"/>
      <circle cx="78" cy="26" r="5" fill="${c.accent}"/>
      <ellipse cx="50" cy="66" rx="20" ry="16" fill="${c.belly}"/>`,
  },
  {
    id: 'orca',
    label: 'Orca',
    draw: (c) => `
      <ellipse cx="50" cy="55" rx="35" ry="31" fill="${c.accent}"/>
      <path d="M50 24 L62 6 L70 26 Z" fill="${c.accent}"/>
      <ellipse cx="50" cy="70" rx="24" ry="14" fill="${c.belly}"/>
      <ellipse cx="32" cy="42" rx="9" ry="5" fill="${c.belly}"/>
      <ellipse cx="68" cy="42" rx="9" ry="5" fill="${c.belly}"/>`,
  },
  {
    id: 'puffin',
    label: 'Puffin',
    draw: (c) => `
      <ellipse cx="50" cy="55" rx="32" ry="33" fill="${c.accent}"/>
      <ellipse cx="50" cy="60" rx="22" ry="24" fill="${c.belly}"/>
      <path d="M38 62 Q50 54 62 62 Q50 78 38 62 Z" fill="#e8913c"/>
      <path d="M44 62 Q50 58 56 62 Q50 70 44 62 Z" fill="#d8543f"/>`,
  },
  {
    id: 'octopus',
    label: 'Octopus',
    draw: (c) => `
      <ellipse cx="50" cy="46" rx="31" ry="30" fill="${c.body}"/>
      <path d="M22 62 Q16 84 30 92 Q30 74 36 68 Z" fill="${c.body}"/>
      <path d="M40 70 Q36 90 48 94 Q46 78 50 72 Z" fill="${c.accent}"/>
      <path d="M60 70 Q64 90 52 94 Q54 78 50 72 Z" fill="${c.body}"/>
      <path d="M78 62 Q84 84 70 92 Q70 74 64 68 Z" fill="${c.accent}"/>`,
  },
  {
    id: 'seal',
    label: 'Seal',
    draw: (c) => `
      <ellipse cx="50" cy="57" rx="33" ry="30" fill="${c.body}"/>
      <ellipse cx="50" cy="68" rx="17" ry="13" fill="${c.belly}"/>
      <ellipse cx="50" cy="64" rx="6" ry="4.5" fill="${c.accent}"/>`,
  },
  {
    id: 'crab',
    label: 'Crab',
    draw: (c) => `
      <ellipse cx="50" cy="58" rx="35" ry="26" fill="${c.body}"/>
      <path d="M14 46 q-8 -12 2 -18 q8 -4 10 6 z" fill="${c.accent}"/>
      <path d="M86 46 q8 -12 -2 -18 q-8 -4 -10 6 z" fill="${c.accent}"/>
      <circle cx="36" cy="34" r="6" fill="${c.belly}"/>
      <circle cx="64" cy="34" r="6" fill="${c.belly}"/>`,
  },
  {
    id: 'whale',
    label: 'Humpback',
    unlock: { huntsDone: 1 },
    draw: (c) => `
      <ellipse cx="50" cy="56" rx="36" ry="29" fill="${c.body}"/>
      <path d="M14 56 q-10 -4 -12 -14 q12 2 16 8 z" fill="${c.accent}"/>
      <ellipse cx="52" cy="70" rx="26" ry="12" fill="${c.belly}"/>
      <path d="M30 78 h44" stroke="${c.accent}" stroke-width="2" stroke-linecap="round" fill="none"/>
      <path d="M32 84 h40" stroke="${c.accent}" stroke-width="2" stroke-linecap="round" fill="none"/>`,
  },
  {
    id: 'raven',
    label: 'Raven',
    unlock: { eggsFound: 3 },
    draw: (c) => `
      <ellipse cx="50" cy="55" rx="32" ry="31" fill="${c.accent}"/>
      <path d="M18 40 q14 -18 34 -14 q-16 6 -22 20 z" fill="${c.body}"/>
      <path d="M40 60 L20 66 L40 70 Z" fill="#3b3b3b"/>`,
  },
];

// ---------- eyes ----------

export const EYES: Part[] = [
  {
    id: 'round',
    label: 'Round',
    draw: () => `
      <circle cx="38" cy="50" r="6.5" fill="#fff"/><circle cx="62" cy="50" r="6.5" fill="#fff"/>
      <circle cx="39" cy="51" r="3.4" fill="#22262b"/><circle cx="63" cy="51" r="3.4" fill="#22262b"/>`,
  },
  {
    id: 'happy',
    label: 'Happy',
    draw: () => `
      <path d="M32 52 q6 -8 12 0" stroke="#22262b" stroke-width="3.2" fill="none" stroke-linecap="round"/>
      <path d="M56 52 q6 -8 12 0" stroke="#22262b" stroke-width="3.2" fill="none" stroke-linecap="round"/>`,
  },
  {
    id: 'sleepy',
    label: 'Sleepy',
    draw: () => `
      <path d="M32 51 q6 5 12 0" stroke="#22262b" stroke-width="3.2" fill="none" stroke-linecap="round"/>
      <path d="M56 51 q6 5 12 0" stroke="#22262b" stroke-width="3.2" fill="none" stroke-linecap="round"/>`,
  },
  {
    id: 'wink',
    label: 'Wink',
    draw: () => `
      <circle cx="38" cy="50" r="6.5" fill="#fff"/><circle cx="39" cy="51" r="3.4" fill="#22262b"/>
      <path d="M56 52 q6 -7 12 0" stroke="#22262b" stroke-width="3.2" fill="none" stroke-linecap="round"/>`,
  },
  {
    id: 'star',
    label: 'Starstruck',
    unlock: { tier: 'gold' },
    draw: (c) => `
      <circle cx="38" cy="50" r="7" fill="#fff"/><circle cx="62" cy="50" r="7" fill="#fff"/>
      <path d="M38 45 l1.6 4 4.4.4 -3.4 2.9 1.1 4.3 -3.7-2.4 -3.7 2.4 1.1-4.3 -3.4-2.9 4.4-.4z" fill="${c.accent}"/>
      <path d="M62 45 l1.6 4 4.4.4 -3.4 2.9 1.1 4.3 -3.7-2.4 -3.7 2.4 1.1-4.3 -3.4-2.9 4.4-.4z" fill="${c.accent}"/>`,
  },
  {
    id: 'shades',
    label: 'Shades',
    unlock: { photos: 25 },
    draw: () => `
      <rect x="28" y="44" width="44" height="13" rx="6" fill="#22262b"/>
      <rect x="31" y="46.5" width="16" height="8" rx="4" fill="#4a5058"/>
      <rect x="53" y="46.5" width="16" height="8" rx="4" fill="#4a5058"/>`,
  },
];

// ---------- mouths ----------

export const MOUTHS: Part[] = [
  { id: 'smile',  label: 'Smile',  draw: () => `<path d="M42 66 q8 7 16 0" stroke="#22262b" stroke-width="3" fill="none" stroke-linecap="round"/>` },
  { id: 'grin',   label: 'Grin',   draw: () => `<path d="M38 63 q12 14 24 0 z" fill="#22262b"/><path d="M40 64 q10 4 20 0" stroke="#fff" stroke-width="2.5" fill="none"/>` },
  { id: 'oh',     label: 'Oh!',    draw: () => `<ellipse cx="50" cy="68" rx="5" ry="6" fill="#22262b"/>` },
  { id: 'smirk',  label: 'Smirk',  draw: () => `<path d="M44 67 q9 5 14 -2" stroke="#22262b" stroke-width="3" fill="none" stroke-linecap="round"/>` },
  { id: 'tongue', label: 'Tongue', unlock: { streak: 5 }, draw: () => `<path d="M40 64 q10 11 20 0 z" fill="#22262b"/><ellipse cx="50" cy="71" rx="6" ry="5" fill="#e0827f"/>` },
];

// ---------- hats ----------

export const HATS: Part[] = [
  { id: 'none', label: 'No hat', draw: () => '' },
  {
    id: 'beanie',
    label: 'Beanie',
    draw: (c) => `
      <path d="M20 30 q30 -28 60 0 z" fill="${c.accent}"/>
      <rect x="18" y="28" width="64" height="8" rx="4" fill="${c.belly}"/>`,
  },
  {
    id: 'captain',
    label: "Captain's cap",
    unlock: { tier: 'gold' },
    draw: () => `
      <path d="M22 30 q28 -24 56 0 z" fill="#f2f3f5"/>
      <rect x="18" y="28" width="64" height="9" rx="4" fill="#22323f"/>
      <rect x="14" y="35" width="72" height="5" rx="2.5" fill="#22262b"/>
      <circle cx="50" cy="22" r="4" fill="#e5b842"/>`,
  },
  {
    id: 'rain',
    label: 'Rain hood',
    draw: (c) => `
      <path d="M16 40 q34 -34 68 0 q-34 -14 -68 0 z" fill="${c.accent}"/>
      <path d="M16 40 q34 -16 68 0" stroke="${c.belly}" stroke-width="3" fill="none"/>`,
  },
  {
    id: 'crown',
    label: 'Crown',
    unlock: { tier: 'platinum' },
    draw: () => `
      <path d="M26 30 L26 14 L38 24 L50 10 L62 24 L74 14 L74 30 Z" fill="#e5b842"/>
      <circle cx="50" cy="18" r="3" fill="#d8543f"/>`,
  },
  {
    id: 'explorer',
    label: 'Explorer hat',
    unlock: { huntsDone: 2 },
    draw: (c) => `
      <ellipse cx="50" cy="34" rx="38" ry="7" fill="${c.accent}"/>
      <path d="M30 32 q20 -26 40 0 z" fill="${c.body}"/>
      <rect x="30" y="28" width="40" height="5" fill="${c.belly}"/>`,
  },
];

// ---------- accessories ----------

export const ACCESSORIES: Part[] = [
  { id: 'none', label: 'Nothing', draw: () => '' },
  { id: 'scarf', label: 'Scarf', draw: (c) => `<path d="M24 82 q26 12 52 0 l0 8 q-26 10 -52 0 z" fill="${c.accent}"/>` },
  { id: 'binocs', label: 'Binoculars', draw: () => `<rect x="30" y="80" width="16" height="11" rx="3" fill="#3a4048"/><rect x="54" y="80" width="16" height="11" rx="3" fill="#3a4048"/><rect x="46" y="83" width="8" height="4" fill="#22262b"/>` },
  { id: 'camera', label: 'Camera', unlock: { photos: 10 }, draw: (c) => `<rect x="36" y="79" width="28" height="18" rx="4" fill="#3a4048"/><circle cx="50" cy="88" r="6" fill="${c.belly}"/><circle cx="50" cy="88" r="3" fill="#22262b"/>` },
  { id: 'medal', label: 'Medal', unlock: { tier: 'silver' }, draw: () => `<path d="M44 78 l6 10 6 -10" stroke="#6faede" stroke-width="3" fill="none"/><circle cx="50" cy="92" r="7" fill="#e5b842"/><text x="50" y="96" font-size="9" text-anchor="middle" fill="#8a6a10">★</text>` },
  { id: 'lantern', label: 'Lantern', unlock: { eggsFound: 5 }, draw: () => `<rect x="66" y="76" width="12" height="16" rx="3" fill="#3a4048"/><rect x="68" y="79" width="8" height="10" fill="#f4d67a"/><path d="M68 76 q4 -6 8 0" stroke="#3a4048" stroke-width="2" fill="none"/>` },
];

// ---------- unlock evaluation ----------

export interface UnlockState {
  tier: Tier;
  eggsFound: number;
  huntsDone: number;
  photos: number;
  streak: number;
}

/** Is a part earned yet? Parts with no rule are always available. */
export function isUnlocked(part: { unlock?: UnlockRule }, state: UnlockState): boolean {
  const u = part.unlock;
  if (!u) return true;
  if (u.tier && tierRank(state.tier) < tierRank(u.tier)) return false;
  if (u.eggsFound !== undefined && state.eggsFound < u.eggsFound) return false;
  if (u.huntsDone !== undefined && state.huntsDone < u.huntsDone) return false;
  if (u.photos !== undefined && state.photos < u.photos) return false;
  if (u.streak !== undefined && state.streak < u.streak) return false;
  return true;
}

/** Human-readable "how do I get this" line for a locked part. */
export function unlockHint(part: { unlock?: UnlockRule }): string | null {
  const u = part.unlock;
  if (!u) return null;
  if (u.tier) return `Reach ${u.tier}`;
  if (u.eggsFound !== undefined) return `Find ${u.eggsFound} secrets`;
  if (u.huntsDone !== undefined) return `Finish ${u.huntsDone} hunt${u.huntsDone === 1 ? '' : 's'}`;
  if (u.photos !== undefined) return `Post ${u.photos} photos`;
  if (u.streak !== undefined) return `${u.streak}-day streak`;
  return null;
}

export function findPart(list: readonly Part[], id: string | undefined): Part {
  return list.find((p) => p.id === id) ?? list[0];
}

export function findPalette(id: string | undefined): Palette {
  return PALETTES.find((p) => p.id === id) ?? PALETTES[0];
}

/** A sensible starting look, varied by member id so nobody starts identical. */
export function defaultSpecFor(memberId: string): {
  base: string; palette: string; eyes: string; mouth: string;
} {
  let h = 0;
  for (let i = 0; i < memberId.length; i++) h = (h * 31 + memberId.charCodeAt(i)) >>> 0;
  const open = <T extends { unlock?: UnlockRule }>(list: readonly T[]) =>
    list.filter((p) => !p.unlock);
  const bases = open(BASES);
  const palettes = open(PALETTES);
  const eyes = open(EYES);
  const mouths = open(MOUTHS);
  // Unsigned shifts throughout: `h` runs to 2^32-1, and a signed `>>` on
  // anything past 2^31 yields a negative index and an undefined part.
  return {
    base: bases[h % bases.length].id,
    palette: palettes[(h >>> 3) % palettes.length].id,
    eyes: eyes[(h >>> 6) % eyes.length].id,
    mouth: mouths[(h >>> 9) % mouths.length].id,
  };
}
