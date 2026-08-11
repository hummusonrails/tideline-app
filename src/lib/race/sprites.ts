/**
 * Turning a crew avatar into something a canvas can blit at 60fps.
 *
 * CrewAvatar renders an AvatarSpec as inline SVG, which is perfect in the
 * DOM and hopeless in a render loop: serialising + re-rasterising SVG every
 * frame costs milliseconds we don't have on the older phone. So each
 * racer's avatar is rasterised exactly once at lobby time into an offscreen
 * canvas, and the race loop only ever does drawImage — a copy, basically
 * free.
 *
 * The SVG markup builder is pure string work (tested); only `rasterize`
 * touches the DOM.
 */

import {
  ACCESSORIES,
  BASES,
  EYES,
  HATS,
  MOUTHS,
  findPalette,
  findPart,
} from '../avatarCatalog';
import type { AvatarSpec } from '../../types';

/**
 * Full standalone SVG document for a spec — same five layers in the same
 * order as CrewAvatar, plus the circular backdrop the component gets from
 * CSS. Kept in lockstep with CrewAvatar so the kart driver is recognisably
 * "your avatar", not a cousin of it.
 */
export function avatarSvg(spec: AvatarSpec): string {
  const palette = findPalette(spec.palette);
  const layers = [
    findPart(BASES, spec.base).draw(palette),
    findPart(ACCESSORIES, spec.accessory).draw(palette),
    findPart(EYES, spec.eyes).draw(palette),
    findPart(MOUTHS, spec.mouth).draw(palette),
    findPart(HATS, spec.hat).draw(palette),
  ].join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">` +
    `<defs><clipPath id="c"><circle cx="50" cy="50" r="50"/></clipPath></defs>` +
    `<circle cx="50" cy="50" r="50" fill="${palette.belly}"/>` +
    `<g clip-path="url(#c)">${layers}</g>` +
    `</svg>`
  );
}

/**
 * Fallback tint for a racer with no avatar spec at all: a stable colour from
 * their member id, so "the teal kart" stays the teal kart across rematches.
 */
export function fallbackHue(memberId: string): number {
  let h = 0;
  for (let i = 0; i < memberId.length; i++) h = (h * 31 + memberId.charCodeAt(i)) >>> 0;
  return h % 360;
}

export interface RacerSprite {
  /** Pre-rendered avatar disc, or null when the racer has no spec. */
  face: HTMLCanvasElement | null;
  /** Kart body tint. */
  hue: number;
}

/**
 * Rasterise a spec once, at 2× the draw size for crisp results on retina
 * screens. Resolves to null (plain-kart fallback) if anything about the SVG
 * decode fails — a race must never be blocked on cosmetics.
 */
export async function rasterizeAvatar(
  spec: AvatarSpec | null,
  sizePx: number,
): Promise<HTMLCanvasElement | null> {
  if (!spec) return null;
  try {
    const svg = avatarSvg(spec);
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('avatar decode failed'));
      img.src = url;
    });
    const px = sizePx * 2;
    const canvas = document.createElement('canvas');
    canvas.width = px;
    canvas.height = px;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, px, px);
    return canvas;
  } catch {
    return null;
  }
}

export async function buildRacerSprite(
  spec: AvatarSpec | null,
  memberId: string,
  sizePx: number,
): Promise<RacerSprite> {
  return {
    face: await rasterizeAvatar(spec, sizePx),
    hue: spec ? paletteHue(spec) : fallbackHue(memberId),
  };
}

/** Kart tint from the avatar's accent colour, so kart and driver match. */
function paletteHue(spec: AvatarSpec): number {
  const accent = findPalette(spec.palette).accent;
  // Parse #rrggbb → rough hue. Good enough for a tint; not colour science.
  const r = parseInt(accent.slice(1, 3), 16) / 255;
  const g = parseInt(accent.slice(3, 5), 16) / 255;
  const b = parseInt(accent.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const d = max - min;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return Math.round(((h * 60) + 360) % 360);
}
