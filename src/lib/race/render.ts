/**
 * Canvas renderer for the race. All cosmetic, all procedural — no image
 * assets, no fonts beyond the system stack, nothing fetched.
 *
 * Two-layer strategy:
 *
 *  1. The whole track (water, road, edges, start line, theme decorations)
 *     is drawn ONCE per race into an offscreen canvas at a fixed
 *     world-to-pixel scale. Per frame it's a single drawImage under the
 *     camera transform. Redrawing a few hundred road segments at 60fps
 *     would burn the frame budget the physics and karts need.
 *  2. Dynamic things (karts, items, hazards, particles) draw on top each
 *     frame.
 *
 * The camera rotates the world so the player's kart always points up.
 * With touch steering that's the difference between "left means left" and
 * "left means... wait, which way am I facing?" — fixed-north top-down
 * steering is a genuine skill barrier for kids.
 */

import type { RaceState } from './engine';
import { KART_RADIUS, speedOf } from './physics';
import { ITEM_TUNING, ripplePoint, type ItemKind } from './items';
import { pointAt, normalAt, type Track } from './track';
import type { RacerSprite } from './sprites';

/** Pixels per world unit for the pre-rendered track layer. */
const LAYER_SCALE = 0.35;

const THEME_COLORS: Record<string, { water: string; road: string; edge: string; deco: string }> = {
  sand:  { water: '#bcd9e4', road: '#e8dcbb', edge: '#f7f2df', deco: '#9ec3ad' },
  plank: { water: '#a9c8d6', road: '#c9a06d', edge: '#8a6a44', deco: '#7fa8b8' },
  swirl: { water: '#9db8d4', road: '#dfe7ee', edge: '#b8c9dd', deco: '#7d94b8' },
};

export function buildTrackLayer(track: Track): HTMLCanvasElement {
  const c = THEME_COLORS[track.def.theme] ?? THEME_COLORS.sand;
  const w = Math.ceil((track.bounds.maxX - track.bounds.minX) * LAYER_SCALE);
  const h = Math.ceil((track.bounds.maxY - track.bounds.minY) * LAYER_SCALE);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = c.water;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.scale(LAYER_SCALE, LAYER_SCALE);
  ctx.translate(-track.bounds.minX, -track.bounds.minY);

  const loop = () => {
    ctx.beginPath();
    ctx.moveTo(track.points[0].x, track.points[0].y);
    for (let i = 1; i < track.points.length; i++) {
      ctx.lineTo(track.points[i].x, track.points[i].y);
    }
    ctx.closePath();
  };

  // Edge band first, road on top — cheaper than stroking two offset loops.
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  loop();
  ctx.strokeStyle = c.edge;
  ctx.lineWidth = track.def.halfWidth * 2 + 16;
  ctx.stroke();
  loop();
  ctx.strokeStyle = c.road;
  ctx.lineWidth = track.def.halfWidth * 2;
  ctx.stroke();

  // Center dashes.
  loop();
  ctx.strokeStyle = 'rgba(255,255,255,0.5)';
  ctx.lineWidth = 4;
  ctx.setLineDash([26, 34]);
  ctx.stroke();
  ctx.setLineDash([]);

  // Start line: a checker band across the road at progress 0.
  const sp = pointAt(track, 0);
  const nrm = normalAt(track, 0);
  const tgx = -nrm.y;
  const tgy = nrm.x;
  const cells = 8;
  const cellW = (track.def.halfWidth * 2) / cells;
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < cells; i++) {
      ctx.fillStyle = (i + row) % 2 === 0 ? '#22262b' : '#f2f3f5';
      const off = -track.def.halfWidth + i * cellW;
      const bx = sp.x + nrm.x * off + tgx * row * 12;
      const by = sp.y + nrm.y * off + tgy * row * 12;
      ctx.save();
      ctx.translate(bx, by);
      ctx.rotate(Math.atan2(tgy, tgx));
      ctx.fillRect(0, 0, 12, cellW);
      ctx.restore();
    }
  }

  // Theme decorations, deterministically scattered off-road so both phones
  // (and every rematch) render the same scene.
  ctx.fillStyle = c.deco;
  let seed = 1234567;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < 90; i++) {
    const f = i / 90;
    const p = pointAt(track, f);
    const n = normalAt(track, f);
    const side = rand() > 0.5 ? 1 : -1;
    const away = track.def.halfWidth + 40 + rand() * 130;
    const x = p.x + n.x * away * side;
    const y = p.y + n.y * away * side;
    ctx.beginPath();
    ctx.arc(x, y, 5 + rand() * 9, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
  return canvas;
}

// --- per-frame drawing ---------------------------------------------------

export interface Camera {
  x: number;
  y: number;
  /** World rotation so the followed kart points screen-up. */
  rot: number;
  zoom: number;
}

export const ITEM_GLYPH: Record<ItemKind, string> = {
  gust: '💨',
  kelp: '🌿',
  bubble: '🫧',
  ripple: '🌊',
};

export interface DrawOpts {
  state: RaceState;
  track: Track;
  layer: HTMLCanvasElement;
  sprites: [RacerSprite, RacerSprite];
  /** Which kart index this screen's player drives — the camera target. */
  meIdx: number;
  width: number;
  height: number;
  /** Frame time for animated bits (bobbing boxes etc.). */
  nowMs: number;
}

export function drawFrame(ctx: CanvasRenderingContext2D, opts: DrawOpts): void {
  const { state, track, layer, sprites, meIdx, width, height, nowMs } = opts;
  const me = state.karts[meIdx];

  ctx.clearRect(0, 0, width, height);

  const cam: Camera = {
    x: me.x,
    y: me.y,
    rot: -me.heading - Math.PI / 2,
    zoom: Math.min(width, height) / 620,
  };

  ctx.save();
  // Camera sits ~35% from the bottom so most of the screen is road ahead.
  ctx.translate(width / 2, height * 0.62);
  ctx.scale(cam.zoom, cam.zoom);
  ctx.rotate(cam.rot);
  ctx.translate(-cam.x, -cam.y);

  // Track layer (drawn once, blitted here).
  ctx.drawImage(
    layer,
    track.bounds.minX, track.bounds.minY,
    layer.width / LAYER_SCALE, layer.height / LAYER_SCALE,
  );

  // Kelp tangles.
  for (const kelp of state.kelps) {
    ctx.save();
    ctx.translate(kelp.x, kelp.y);
    ctx.fillStyle = 'rgba(61,92,57,0.85)';
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + nowMs / 900;
      ctx.beginPath();
      ctx.ellipse(Math.cos(a) * 8, Math.sin(a) * 8, 10, 4, a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  // Item boxes (bob gently; ghosted while respawning).
  for (let b = 0; b < track.boxes.length; b++) {
    const box = track.boxes[b];
    const ready = state.tick >= state.boxReadyAt[b];
    ctx.save();
    ctx.translate(box.x, box.y + Math.sin(nowMs / 400 + b) * 3);
    ctx.rotate(nowMs / 1400 + b);
    ctx.globalAlpha = ready ? 0.95 : 0.2;
    ctx.fillStyle = '#e5b842';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    const s = ITEM_TUNING.boxRadius * 0.9;
    ctx.beginPath();
    ctx.rect(-s / 2, -s / 2, s, s);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', 0, 1);
    ctx.restore();
  }

  // Ripples in flight.
  for (const r of state.ripples) {
    const p = ripplePoint(r, track);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.strokeStyle = 'rgba(30,106,168,0.8)';
    ctx.lineWidth = 5;
    for (let ring = 0; ring < 3; ring++) {
      const rr = 14 + ring * 9 + ((nowMs / 60) % 9);
      ctx.globalAlpha = 0.9 - ring * 0.25;
      ctx.beginPath();
      ctx.arc(0, 0, rr, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Karts — opponent first so "my" kart draws on top on overlap.
  drawKart(ctx, state, 1 - meIdx, sprites[1 - meIdx], nowMs);
  drawKart(ctx, state, meIdx, sprites[meIdx], nowMs);

  ctx.restore();
}

function drawKart(
  ctx: CanvasRenderingContext2D,
  state: RaceState,
  idx: number,
  sprite: RacerSprite,
  nowMs: number,
): void {
  const k = state.karts[idx];
  ctx.save();
  ctx.translate(k.x, k.y);

  // Shield bubble surrounds everything, drawn un-rotated.
  if (k.shieldMs > 0) {
    ctx.strokeStyle = 'rgba(127,200,216,0.9)';
    ctx.fillStyle = 'rgba(127,200,216,0.22)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, KART_RADIUS + 12 + Math.sin(nowMs / 160) * 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  ctx.rotate(k.heading);

  // Boost flame behind the kart.
  if (k.boostMs > 0) {
    const flick = 6 + Math.sin(nowMs / 40) * 4;
    ctx.fillStyle = 'rgba(229,184,66,0.9)';
    ctx.beginPath();
    ctx.moveTo(-KART_RADIUS - 2, -7);
    ctx.lineTo(-KART_RADIUS - 14 - flick, 0);
    ctx.lineTo(-KART_RADIUS - 2, 7);
    ctx.closePath();
    ctx.fill();
  }

  // Drift sparks at the rear wheels.
  if (k.driftDir !== 0) {
    const charged = k.driftCharge >= 1.5 ? '#6faede' : k.driftCharge >= 0.7 ? '#e5b842' : '#f2f3f5';
    ctx.fillStyle = charged;
    for (let i = 0; i < 3; i++) {
      const jx = -KART_RADIUS - (nowMs / 30 + i * 7) % 12;
      const jy = (i - 1) * 7 * k.driftDir;
      ctx.fillRect(jx, jy - 2, 4, 4);
    }
  }

  // Kart body: rounded shell + stubby wheels, tinted per racer.
  const hue = sprite.hue;
  ctx.fillStyle = '#22262b';
  const wheel = (wx: number, wy: number) => { ctx.fillRect(wx - 5, wy - 3.5, 10, 7); };
  wheel(-9, -KART_RADIUS + 2);
  wheel(-9, KART_RADIUS - 2);
  wheel(9, -KART_RADIUS + 2);
  wheel(9, KART_RADIUS - 2);
  ctx.fillStyle = `hsl(${hue} 55% 55%)`;
  ctx.strokeStyle = `hsl(${hue} 55% 35%)`;
  ctx.lineWidth = 2.5;
  roundedRect(ctx, -KART_RADIUS, -KART_RADIUS + 4, KART_RADIUS * 2 + 4, KART_RADIUS * 2 - 8, 8);
  ctx.fill();
  ctx.stroke();
  // Nose stripe so the facing direction reads even in a spin.
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  roundedRect(ctx, KART_RADIUS - 8, -5, 10, 10, 4);
  ctx.fill();

  // Driver: the crew avatar, kept upright relative to the *camera* would be
  // ideal, but keeping it upright relative to the kart reads better in a
  // rotating camera (the driver turns with the wheel, like a real kart).
  const faceSize = KART_RADIUS * 1.7;
  if (sprite.face) {
    ctx.rotate(Math.PI / 2); // avatars are authored face-up
    ctx.drawImage(sprite.face, -faceSize / 2, -faceSize / 2, faceSize, faceSize);
  } else {
    ctx.beginPath();
    ctx.fillStyle = `hsl(${hue} 45% 75%)`;
    ctx.arc(0, 0, faceSize / 2, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();

  // Spin stars over a spun-out kart.
  if (k.spinMs > 0) {
    ctx.save();
    ctx.translate(k.x, k.y);
    ctx.fillStyle = '#e5b842';
    ctx.font = 'bold 16px system-ui, sans-serif';
    ctx.textAlign = 'center';
    for (let i = 0; i < 3; i++) {
      const a = nowMs / 200 + (i * Math.PI * 2) / 3;
      ctx.fillText('✦', Math.cos(a) * 26, Math.sin(a) * 26 - 8);
    }
    ctx.restore();
  }
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Minimap: the track outline with two dots. Drawn every frame but tiny —
 * ~300 lineTo calls at minimap scale is cheaper than caching another layer.
 */
export function drawMinimap(
  ctx: CanvasRenderingContext2D,
  track: Track,
  state: RaceState,
  meIdx: number,
  size: number,
): void {
  const bw = track.bounds.maxX - track.bounds.minX;
  const bh = track.bounds.maxY - track.bounds.minY;
  const scale = (size - 12) / Math.max(bw, bh);
  ctx.save();
  ctx.translate(6, 6);
  ctx.scale(scale, scale);
  ctx.translate(-track.bounds.minX, -track.bounds.minY);
  ctx.beginPath();
  ctx.moveTo(track.points[0].x, track.points[0].y);
  for (let i = 1; i < track.points.length; i++) ctx.lineTo(track.points[i].x, track.points[i].y);
  ctx.closePath();
  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 14 / scale > 200 ? 200 : 14 / scale;
  ctx.stroke();
  for (const [idx, color] of [[1 - meIdx, '#ff5a5f'], [meIdx, '#1e6aa8']] as const) {
    const k = state.karts[idx];
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.arc(k.x, k.y, 9 / scale > 260 ? 260 : 9 / scale, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/** Speed as a 0..1 meter fraction for the HUD. */
export function speedFrac(state: RaceState, idx: number): number {
  return Math.min(1, speedOf(state.karts[idx]) / 460);
}
