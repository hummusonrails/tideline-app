/**
 * Kart physics — the part that decides whether the game is fun.
 *
 * The model is deliberately arcade, not simulation: velocity is a free 2D
 * vector, but every tick its *lateral* component (relative to where the kart
 * points) is bled off hard. High lateral grip is what makes a kart feel
 * planted and responsive; releasing most of that grip while the drift button
 * is held is what makes drifting feel like a slide you're steering, not a
 * spin you're surviving. Every constant below was tuned against that.
 *
 * Everything runs at a fixed 60Hz step. Fixed-step matters twice over: it
 * makes the sim frame-rate independent on a phone that's dropping frames,
 * and it means the host and the guest's local prediction integrate the same
 * inputs into the same trajectory (floating point is deterministic per
 * engine, and cross-engine drift is corrected by snapshots anyway — see
 * RaceDuel's reconciliation).
 *
 * Pure math, no DOM, no randomness — fully unit-testable.
 */

import { project, type Track, type Projection } from './track';

/** Simulation tick length. 60Hz — one physics step per typical display frame. */
export const DT = 1 / 60;
export const TICKS_PER_SEC = 60;

/** Kart collision radius, world units. Road half-widths are ≥ 66. */
export const KART_RADIUS = 16;

// --- tuning ---------------------------------------------------------------
// Grouped so "the kart feels floaty" has exactly one place to be fixed.

export const TUNING = {
  /** Top speed, u/s. A lap of the easy track ≈ 5000u ≈ 17s flat out. */
  topSpeed: 330,
  /** Reverse crawl speed, u/s. Enough to un-stick, useless for racing. */
  reverseSpeed: 90,
  /**
   * Exponential approach rate toward target speed, 1/s. 2.4 reaches ~90% of
   * top speed in about a second — quick enough to feel punchy after a wall
   * hit, slow enough that the boost items still feel like a reward.
   */
  accelRate: 2.4,
  /** Extra top speed and snap while a boost is live. */
  boostTopSpeed: 460,
  boostAccelRate: 5.0,
  /** Peak yaw rate, rad/s. ~2.6 turns a hairpin without feeling twitchy. */
  steerRate: 2.6,
  /** Extra yaw authority while drifting — the whole reason to drift. */
  driftSteerBonus: 1.45,
  /**
   * Per-tick lateral velocity retention. 0.78 ≈ "on rails"; the drift value
   * keeps ~94% per tick, which at 60Hz is a long, controllable slide.
   */
  gripNormal: 0.78,
  gripDrift: 0.94,
  /** Drift only engages above this fraction of top speed. */
  driftMinSpeedFrac: 0.45,
  /** Seconds of held drift for each boost tier. */
  driftMini: 0.7,
  driftSuper: 1.5,
  /** Boost durations granted on drift release, ms. */
  driftMiniBoostMs: 500,
  driftSuperBoostMs: 950,
  /** Spin-out: total duration and revolutions. Punishing but readable. */
  spinMs: 900,
  spinRevs: 1.5,
  /** Speed multiplier while spinning (per tick) — you don't park, you skid. */
  spinDragPerTick: 0.965,
  /** Wall contact: gentle scrape vs. hard hit speed retention. */
  wallScrapeKeep: 0.92,
  wallHitKeep: 0.55,
  /** Outward speed (u/s) above which a wall contact counts as a hard hit. */
  wallHardThreshold: 140,
} as const;

// --- state ------------------------------------------------------------------

export interface KartInput {
  /** -1 (full left) .. 1 (full right). */
  steer: number;
  /** 1 forward, 0 coast, -1 brake/reverse. Touch controls always send 1. */
  throttle: number;
  drift: boolean;
}

export const NEUTRAL_INPUT: KartInput = { steer: 0, throttle: 1, drift: false };

export interface KartState {
  x: number;
  y: number;
  /** Facing, radians. */
  heading: number;
  vx: number;
  vy: number;
  /** Seconds of drift held so far; 0 when not drifting. */
  driftCharge: number;
  /** Locked slide direction while drifting: -1 left, 1 right, 0 not drifting. */
  driftDir: -1 | 0 | 1;
  /** Remaining boost, ms. */
  boostMs: number;
  /** Remaining spin-out, ms. No control while > 0. */
  spinMs: number;
  /** Remaining shield, ms. */
  shieldMs: number;
  /** Lap progress fraction from the last projection. */
  progress: number;
  /** Completed laps. */
  lap: number;
  /** Index of the next checkpoint this kart must cross. */
  nextCp: number;
  /** Projection hint — keeps the centerline lookup continuous. */
  lastSeg: number;
  /** Tick at which this kart finished, or null while still racing. */
  finishedAtTick: number | null;
}

export function makeKart(x: number, y: number, heading: number, startProgress: number): KartState {
  return {
    x, y, heading, vx: 0, vy: 0,
    driftCharge: 0, driftDir: 0,
    boostMs: 0, spinMs: 0, shieldMs: 0,
    progress: startProgress, lap: 0, nextCp: 1,
    lastSeg: 0,
    finishedAtTick: null,
  };
}

export function speedOf(k: Pick<KartState, 'vx' | 'vy'>): number {
  return Math.hypot(k.vx, k.vy);
}

/** Events a single physics step can produce, for sound/FX and netcode. */
export interface StepEvents {
  /** 0 = none, 1 = mini boost released, 2 = super boost released. */
  driftBoost: 0 | 1 | 2;
  wallHit: boolean;
}

/**
 * Advance one kart by one fixed tick.
 *
 * Mutates `kart` in place — this runs 120×/second across two karts plus the
 * guest's prediction replays, and allocating a fresh state object each step
 * is measurable GC pressure on the older phone. Tests clone before stepping.
 */
export function stepKart(kart: KartState, input: KartInput, events?: StepEvents): void {
  if (events) { events.driftBoost = 0; events.wallHit = false; }

  // Timers first so a 1-tick effect still shows for its full duration.
  if (kart.boostMs > 0) kart.boostMs = Math.max(0, kart.boostMs - DT * 1000);
  if (kart.shieldMs > 0) kart.shieldMs = Math.max(0, kart.shieldMs - DT * 1000);

  if (kart.spinMs > 0) {
    // Spinning out: control is gone, the kart pirouettes and sheds speed.
    kart.spinMs = Math.max(0, kart.spinMs - DT * 1000);
    kart.heading += (TUNING.spinRevs * 2 * Math.PI) / (TUNING.spinMs / 1000) * DT;
    kart.vx *= TUNING.spinDragPerTick;
    kart.vy *= TUNING.spinDragPerTick;
    kart.x += kart.vx * DT;
    kart.y += kart.vy * DT;
    kart.driftCharge = 0;
    kart.driftDir = 0;
    return;
  }

  const speed = speedOf(kart);
  const boosted = kart.boostMs > 0;
  const top = boosted ? TUNING.boostTopSpeed : TUNING.topSpeed;

  // --- drift state machine ---
  const wantsDrift =
    input.drift &&
    Math.abs(input.steer) > 0.25 &&
    speed > TUNING.topSpeed * TUNING.driftMinSpeedFrac;
  if (kart.driftDir === 0 && wantsDrift) {
    // Lock the slide direction at initiation; counter-steering later adjusts
    // the arc but can't flip the slide — that's what makes it feel like SNES
    // karting instead of a fishtail.
    kart.driftDir = input.steer > 0 ? 1 : -1;
    kart.driftCharge = 0;
  }
  const drifting = kart.driftDir !== 0 && input.drift && speed > TUNING.topSpeed * 0.25;
  if (drifting) {
    kart.driftCharge += DT;
  } else if (kart.driftDir !== 0) {
    // Drift released (or scrubbed off): pay out the charge.
    if (kart.driftCharge >= TUNING.driftSuper) {
      kart.boostMs = Math.max(kart.boostMs, TUNING.driftSuperBoostMs);
      if (events) events.driftBoost = 2;
    } else if (kart.driftCharge >= TUNING.driftMini) {
      kart.boostMs = Math.max(kart.boostMs, TUNING.driftMiniBoostMs);
      if (events) events.driftBoost = 1;
    }
    kart.driftDir = 0;
    kart.driftCharge = 0;
  }

  // --- steering ---
  // Yaw authority scales with speed (a touch less at top speed so flat-out
  // driving needs a breath of care) but never drops below a floor: a kart
  // shoved nose-first into a wall must be able to wiggle itself free, or the
  // race soft-locks the first time a kid panics into a corner.
  const speedFactor =
    Math.max(0.35, Math.min(1, speed / 60)) *
    (1 - 0.25 * Math.min(1, speed / TUNING.topSpeed));
  let yaw = TUNING.steerRate * input.steer * speedFactor;
  if (drifting) {
    // While sliding, the kart yaws around the locked direction: steering with
    // the slide tightens it, against it opens it up — but never reverses it.
    const bias = 0.55 * kart.driftDir + 0.45 * input.steer;
    yaw = TUNING.steerRate * TUNING.driftSteerBonus * bias * Math.min(1, speed / 60);
  }
  kart.heading += yaw * DT;

  // --- longitudinal ---
  const fx = Math.cos(kart.heading);
  const fy = Math.sin(kart.heading);
  let vf = kart.vx * fx + kart.vy * fy;        // forward component
  let vl = -kart.vx * fy + kart.vy * fx;        // lateral component (left +)

  const target =
    input.throttle > 0 ? top * input.throttle :
    input.throttle < 0 ? (vf > 20 ? 0 : -TUNING.reverseSpeed) :
    0;
  const rate = boosted ? TUNING.boostAccelRate : TUNING.accelRate;
  // Exponential approach: smooth ramp to top speed, natural engine braking
  // when the throttle lifts, and one formula for all of it.
  vf += (target - vf) * Math.min(1, rate * DT);

  // --- grip ---
  vl *= drifting ? TUNING.gripDrift : TUNING.gripNormal;

  kart.vx = fx * vf - fy * vl;
  kart.vy = fy * vf + fx * vl;
  kart.x += kart.vx * DT;
  kart.y += kart.vy * DT;
}

/**
 * Keep a kart on the road. The road edge is "halfWidth from the centerline",
 * so a wall hit is just a projection whose distance came back too big: the
 * kart is placed back at the edge and the outward velocity component is
 * removed (you scrape along walls, you don't stick to them). Fast, square
 * hits also cost real speed — walls have to be worth avoiding or the fastest
 * line through a corner would be "bounce off the outside".
 *
 * Returns the projection so callers reuse it for lap accounting instead of
 * paying for a second centerline search.
 */
export function collideWithWalls(kart: KartState, track: Track, events?: StepEvents): Projection {
  const proj = project(track, kart, kart.lastSeg);
  kart.lastSeg = proj.seg;
  const limit = track.def.halfWidth - KART_RADIUS;
  if (proj.dist > limit) {
    const outward = kart.vx * proj.nx + kart.vy * proj.ny;
    // Reposition exactly on the edge along the outward normal.
    kart.x -= proj.nx * (proj.dist - limit);
    kart.y -= proj.ny * (proj.dist - limit);
    if (outward > 0) {
      kart.vx -= proj.nx * outward;
      kart.vy -= proj.ny * outward;
      const keep = outward > TUNING.wallHardThreshold ? TUNING.wallHitKeep : TUNING.wallScrapeKeep;
      kart.vx *= keep;
      kart.vy *= keep;
      if (events && outward > TUNING.wallHardThreshold) events.wallHit = true;
    }
  }
  return proj;
}

/**
 * Resolve two overlapping karts: separate them equally and trade momentum
 * along the contact normal, mildly inelastic. Mild is the point — bumping is
 * part of the fun, but a shove that launches someone into a wall every touch
 * would make the whole race about ramming.
 */
export function collideKarts(a: KartState, b: KartState): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const dist = Math.hypot(dx, dy);
  const minDist = KART_RADIUS * 2;
  if (dist >= minDist || dist === 0) return false;
  const nx = dx / dist;
  const ny = dy / dist;
  const overlap = minDist - dist;
  a.x -= nx * overlap / 2;
  a.y -= ny * overlap / 2;
  b.x += nx * overlap / 2;
  b.y += ny * overlap / 2;
  // Relative velocity along the normal; only resolve if they're approaching.
  const rvx = b.vx - a.vx;
  const rvy = b.vy - a.vy;
  const closing = rvx * nx + rvy * ny;
  if (closing < 0) {
    const restitution = 0.35;
    const impulse = -(1 + restitution) * closing / 2; // equal masses
    a.vx -= nx * impulse;
    a.vy -= ny * impulse;
    b.vx += nx * impulse;
    b.vy += ny * impulse;
  }
  return true;
}
