/**
 * Crew avatars, ready to blit.
 *
 * The canvas games all want the player's avatar in them — piloting the ship,
 * flapping through the pipes, munching the deck — and none of them can afford
 * to re-rasterise an SVG per frame. The kart duel solved this already, so the
 * rasteriser is reused verbatim (`lib/race/sprites.ts`); what's added here is
 * the React plumbing: rasterise once when the spec loads, hand back a ref the
 * render loop can read without re-rendering.
 *
 * Every sprite is nullable and every caller must draw something without it.
 * Cosmetics never block a game.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db';
import { useSession } from '../../state/session';
import { rasterizeAvatar, fallbackHue } from '../race/sprites';
import { findPalette } from '../avatarCatalog';
import type { AvatarSpec, MemberId } from '../../types';

export interface Sprite {
  canvas: HTMLCanvasElement | null;
  hue: number;
  /** Accent colour of the avatar's palette — for trails, bullets, glows. */
  accent: string;
}

const NO_SPRITE: Sprite = { canvas: null, hue: 190, accent: '#21e6ff' };

function spriteColors(spec: AvatarSpec | null, memberId: string): Pick<Sprite, 'hue' | 'accent'> {
  if (!spec) return { hue: fallbackHue(memberId), accent: '#21e6ff' };
  const palette = findPalette(spec.palette);
  return { hue: fallbackHue(memberId), accent: palette.accent };
}

/**
 * The signed-in member's avatar, rasterised at `sizePx`.
 *
 * Returned as a ref *and* a state value: the ref is what a render loop reads
 * every frame, the state is what makes a DOM game re-render once the image is
 * ready. Both point at the same canvas.
 */
export function useMySprite(sizePx = 48): { ref: React.RefObject<Sprite>; sprite: Sprite } {
  const memberId = useSession((s) => s.identity);
  const spec = useLiveQuery(
    async () => (memberId ? ((await db.avatarSpecs.get(memberId)) ?? null) : null),
    [memberId],
  );
  return useSpriteFor(spec ?? null, memberId ?? 'anon', sizePx);
}

export function useSpriteFor(
  spec: AvatarSpec | null,
  memberId: string,
  sizePx = 48,
): { ref: React.RefObject<Sprite>; sprite: Sprite } {
  const colors = useMemo(() => spriteColors(spec, memberId), [spec, memberId]);
  const [sprite, setSprite] = useState<Sprite>({ ...NO_SPRITE, ...colors });
  const ref = useRef<Sprite>(sprite);

  useEffect(() => {
    let cancelled = false;
    const base: Sprite = { canvas: null, ...colors };
    ref.current = base;
    setSprite(base);
    void rasterizeAvatar(spec, sizePx).then((canvas) => {
      if (cancelled) return;
      const next: Sprite = { canvas, ...colors };
      ref.current = next;
      setSprite(next);
    });
    return () => {
      cancelled = true;
    };
  }, [spec, sizePx, colors]);

  return { ref, sprite };
}

/**
 * Every crewmate's avatar at once — the chasers in Maze Muncher, the heads in
 * Whack-a-Crab, the cards in Crew Match.
 *
 * Rasterising happens in one pass and the result is keyed by member id, so a
 * game can look up whoever it drew into a slot without holding a hook per
 * crewmate (which it can't, since the crew size isn't known at compile time).
 */
export function useCrewSprites(
  members: readonly { id: MemberId; spec: AvatarSpec | null }[],
  sizePx = 48,
): Record<MemberId, Sprite> {
  const [sprites, setSprites] = useState<Record<MemberId, Sprite>>({});
  // Rasterising is keyed on what actually changes the picture. Without this,
  // a new array identity every render would restart the whole batch forever.
  const signature = members
    .map((m) => `${m.id}:${m.spec ? `${m.spec.base}${m.spec.palette}${m.spec.updatedAt}` : '-'}`)
    .join('|');

  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      members.map(async (m) => {
        const canvas = await rasterizeAvatar(m.spec, sizePx);
        return [m.id, { canvas, ...spriteColors(m.spec, m.id) }] as const;
      }),
    ).then((entries) => {
      if (cancelled) return;
      setSprites(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, sizePx]);

  return sprites;
}

/**
 * Draw a sprite as a circle at a canvas position, falling back to a coloured
 * disc when there's no avatar. Every canvas game routes its avatar drawing
 * through this so the fallback is identical everywhere.
 */
export function drawSprite(
  ctx: CanvasRenderingContext2D,
  sprite: Sprite | null,
  cx: number,
  cy: number,
  size: number,
): void {
  const r = size / 2;
  if (sprite?.canvas) {
    ctx.drawImage(sprite.canvas, cx - r, cy - r, size, size);
    return;
  }
  ctx.save();
  ctx.fillStyle = `hsl(${sprite?.hue ?? 190} 85% 60%)`;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#06010f';
  ctx.beginPath();
  ctx.arc(cx - r * 0.3, cy - r * 0.15, r * 0.16, 0, Math.PI * 2);
  ctx.arc(cx + r * 0.3, cy - r * 0.15, r * 0.16, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
