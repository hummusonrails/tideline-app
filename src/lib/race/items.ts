/**
 * Items for the kart duel: a tiny set with one job each.
 *
 *  - 'gust'   — a burst of speed, right now.
 *  - 'kelp'   — a tangle dropped behind you; the other kart spins on it.
 *  - 'bubble' — a shield that eats the next bad thing that happens to you.
 *  - 'ripple' — a wave that chases the other kart along the track and spins
 *               it on contact. The comeback tool.
 *
 * Names are invented and sea-flavoured to match the app's crew-of-sea-
 * creatures look — and, like everything in this public repo, reference
 * nothing real.
 *
 * Determinism: every roll comes from a seeded PRNG keyed on (race seed, box
 * index, pickup count). Both phones could derive the same roll independently
 * — in practice only the host rolls (it owns the sim) and the guest hears
 * about it in the next snapshot, but keeping the roll pure means tests can
 * pin exact sequences and a future replay feature costs nothing.
 *
 * Catch-up weighting: the kart in second place rolls from a friendlier
 * table. A two-player race that's decided by the first corner is boring for
 * the loser and therefore, thirty seconds later, for the winner too.
 */

import {
  TICKS_PER_SEC,
  TUNING,
  type KartState,
} from './physics';
import { forwardDelta, pointAt, wrap01, type Track } from './track';

export type ItemKind = 'gust' | 'kelp' | 'bubble' | 'ripple';

export const ITEM_LABEL: Record<ItemKind, string> = {
  gust: 'Gust',
  kelp: 'Kelp Tangle',
  bubble: 'Bubble',
  ripple: 'Ripple',
};

/** Effect constants, in one place for tuning. */
export const ITEM_TUNING = {
  gustBoostMs: 1200,
  bubbleMs: 6000,
  /** Kelp lives this long on the road, ticks. 20s: a hazard, not litter. */
  kelpLifeTicks: 20 * TICKS_PER_SEC,
  /** Radius within which kelp trips a kart. */
  kelpRadius: 26,
  /** The dropper is immune to their own kelp for this many ticks. */
  kelpOwnerGraceTicks: Math.round(1.2 * TICKS_PER_SEC),
  /** Ripple travel speed along the track, as lap-fraction per tick. */
  rippleSpeedFrac: (TUNING.topSpeed * 1.5) / 60, // world u/tick; converted per track
  /** Ripple gives up after this long, ticks. */
  rippleLifeTicks: 8 * TICKS_PER_SEC,
  /** Progress window within which a ripple catches its target. */
  rippleCatchFrac: 0.004,
  /** Item box respawn delay, ticks. */
  boxRespawnTicks: 4 * TICKS_PER_SEC,
  /** Pickup radius around a box. */
  boxRadius: 30,
} as const;

// --- deterministic rolls -----------------------------------------------------

/**
 * mulberry32 — tiny, well-distributed, and identical everywhere. Math.random
 * is banned in the sim: it would fork the two phones' realities.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fold a string seed into 32 bits (FNV-1a). */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Weighted tables. Leader gets utility; the chaser gets speed. */
const TABLE_AHEAD: readonly [ItemKind, number][] = [
  ['kelp', 4], ['bubble', 3], ['gust', 2], ['ripple', 1],
];
const TABLE_BEHIND: readonly [ItemKind, number][] = [
  ['gust', 4], ['ripple', 3], ['bubble', 2], ['kelp', 1],
];

/**
 * The item granted by box `boxIdx` on its `pickupCount`-th collection in the
 * race with `seed`. Pure function of its arguments — same everywhere, always.
 */
export function rollItem(seed: number, boxIdx: number, pickupCount: number, behind: boolean): ItemKind {
  const rng = mulberry32((seed ^ Math.imul(boxIdx + 1, 0x9e3779b9) ^ Math.imul(pickupCount + 1, 0x85ebca6b)) >>> 0);
  const table = behind ? TABLE_BEHIND : TABLE_AHEAD;
  const total = table.reduce((sum, [, w]) => sum + w, 0);
  let pick = rng() * total;
  for (const [kind, weight] of table) {
    pick -= weight;
    if (pick <= 0) return kind;
  }
  return table[table.length - 1][0];
}

// --- live hazards -------------------------------------------------------------

export interface Kelp {
  x: number;
  y: number;
  /** Kart index that dropped it (0/1). */
  owner: number;
  droppedAtTick: number;
  expiresAtTick: number;
}

export interface Ripple {
  /** Lap-progress position of the wavefront. */
  progress: number;
  /** Kart index it hunts. */
  target: number;
  expiresAtTick: number;
}

export function makeKelp(kart: KartState, owner: number, tick: number): Kelp {
  // Drop just behind the rear bumper so you can't spin on your own drop
  // in the same breath (there's a grace period too, belt and suspenders).
  const back = 40;
  return {
    x: kart.x - Math.cos(kart.heading) * back,
    y: kart.y - Math.sin(kart.heading) * back,
    owner,
    droppedAtTick: tick,
    expiresAtTick: tick + ITEM_TUNING.kelpLifeTicks,
  };
}

export function makeRipple(fromProgress: number, target: number, tick: number): Ripple {
  return {
    progress: fromProgress,
    target,
    expiresAtTick: tick + ITEM_TUNING.rippleLifeTicks,
  };
}

/**
 * Advance a ripple one tick along the track toward its target's progress.
 * Returns true when it has caught up (the caller applies the hit).
 * It only ever travels forward — driving backwards to "dodge" it just
 * shortens the chase.
 */
export function stepRipple(ripple: Ripple, track: Track, targetProgress: number): boolean {
  const frac = ITEM_TUNING.rippleSpeedFrac / track.totalLen;
  ripple.progress = wrap01(ripple.progress + frac);
  const gap = forwardDelta(ripple.progress, targetProgress);
  // Caught when the target is within the catch window *ahead or just behind*
  // the wavefront — a fast target can't perpetually straddle the boundary.
  return Math.abs(gap) <= ITEM_TUNING.rippleCatchFrac;
}

/** World position of a ripple, for rendering and near-miss FX. */
export function ripplePoint(ripple: Ripple, track: Track): { x: number; y: number } {
  return pointAt(track, ripple.progress);
}

/** Is this kart currently touching this kelp (and allowed to be hurt by it)? */
export function kelpCatches(kelp: Kelp, kart: KartState, kartIdx: number, tick: number): boolean {
  if (kartIdx === kelp.owner && tick - kelp.droppedAtTick < ITEM_TUNING.kelpOwnerGraceTicks) {
    return false;
  }
  const dx = kart.x - kelp.x;
  const dy = kart.y - kelp.y;
  return dx * dx + dy * dy <= ITEM_TUNING.kelpRadius * ITEM_TUNING.kelpRadius;
}

/**
 * Apply a spin-class hit (kelp or ripple) to a kart, honouring the shield.
 * Returns 'blocked' when the bubble ate it, 'spun' when it landed.
 */
export function applyHazardHit(kart: KartState): 'blocked' | 'spun' {
  if (kart.shieldMs > 0) {
    kart.shieldMs = 0; // the bubble pops — one save per bubble
    return 'blocked';
  }
  kart.spinMs = TUNING.spinMs;
  kart.driftCharge = 0;
  kart.driftDir = 0;
  return 'spun';
}
