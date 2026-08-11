/**
 * The authoritative race simulation and its little state machine:
 *
 *   countdown → racing → finished
 *
 * Exactly one device runs this per race — the host (see net.ts for how the
 * host is elected). The guest runs only the physics for its *own* kart as
 * local prediction; laps, items, hits and the finish order all come from
 * here, over snapshots. One brain per race is the entire netcode strategy:
 * with a single authority there is nothing to reconcile about *outcomes*,
 * only about a few pixels of position, and position is easy to smooth.
 *
 * The lobby lives above this module (it's a UI negotiation, not a sim), and
 * disconnect handling lives above it too: the engine doesn't know what a
 * network is. It just steps a world.
 *
 * Pure and deterministic given (config, inputs): no Date.now, no
 * Math.random, no DOM. See items.ts for where the seeded randomness lives.
 */

import {
  DT,
  KART_RADIUS,
  NEUTRAL_INPUT,
  TICKS_PER_SEC,
  collideKarts,
  collideWithWalls,
  makeKart,
  speedOf,
  stepKart,
  type KartInput,
  type KartState,
  type StepEvents,
} from './physics';
import {
  ITEM_TUNING,
  applyHazardHit,
  kelpCatches,
  makeKelp,
  makeRipple,
  rollItem,
  stepRipple,
  type ItemKind,
  type Kelp,
  type Ripple,
} from './items';
import {
  crossedCheckpoint,
  forwardDelta,
  startPose,
  wrap01,
  type Track,
} from './track';

export const LAPS = 3;
export const COUNTDOWN_TICKS = 3 * TICKS_PER_SEC;
/** Once someone wins, the other kart gets this long to bring it home. */
export const STRAGGLER_TICKS = 20 * TICKS_PER_SEC;

export type RacePhase = 'countdown' | 'racing' | 'finished';

export interface RaceConfig {
  /** Numeric seed for all item rolls; derived from the shared race id. */
  seed: number;
  laps: number;
}

/** Something that happened this tick — consumed for FX/sound and snapshots. */
export type RaceEvent =
  | { t: 'lap'; kart: number; lap: number }
  | { t: 'pickup'; kart: number; item: ItemKind }
  | { t: 'use'; kart: number; item: ItemKind }
  | { t: 'spin'; kart: number }
  | { t: 'blocked'; kart: number }
  | { t: 'boost'; kart: number; tier: 1 | 2 }
  | { t: 'wall'; kart: number }
  | { t: 'finish'; kart: number; tick: number };

export interface RaceState {
  phase: RacePhase;
  tick: number;
  karts: [KartState, KartState];
  /** Item each kart is holding (one slot, like the classics). */
  held: [ItemKind | null, ItemKind | null];
  /** Tick at which each box becomes collectable again. */
  boxReadyAt: number[];
  /** How many times each box has been collected — feeds the item roll. */
  boxPickups: number[];
  kelps: Kelp[];
  ripples: Ripple[];
  /** Kart indices in finishing order. */
  finishOrder: number[];
}

export interface RaceInputs {
  /** Latest known input per kart. The host holds these between messages —
   *  a guest input frame lost to the network just means "same as before",
   *  which for steering is almost always true anyway. */
  karts: [KartInput, KartInput];
  /** One-shot flags: use the held item this tick. Cleared by the engine. */
  useItem: [boolean, boolean];
}

export function makeInputs(): RaceInputs {
  return {
    karts: [{ ...NEUTRAL_INPUT }, { ...NEUTRAL_INPUT }],
    useItem: [false, false],
  };
}

export function createRace(track: Track): RaceState {
  const a = startPose(track, 0);
  const b = startPose(track, 1);
  return {
    phase: 'countdown',
    tick: 0,
    karts: [
      makeKart(a.x, a.y, a.heading, 0.008),
      makeKart(b.x, b.y, b.heading, 0.02),
    ],
    held: [null, null],
    boxReadyAt: track.boxes.map(() => 0),
    boxPickups: track.boxes.map(() => 0),
    kelps: [],
    ripples: [],
    finishOrder: [],
  };
}

/**
 * Total race distance for ranking: completed laps plus how far through the
 * checkpoint sequence the kart has genuinely gotten. Built from `nextCp`,
 * not raw progress, so driving backwards (or being flung backwards) can
 * never *increase* the metric — the same anti-cutting spine the lap counter
 * uses.
 */
export function raceDistance(kart: KartState, track: Track): number {
  const cps = track.checkpoints;
  const prevCp = (kart.nextCp - 1 + cps.length) % cps.length;
  // Fraction of the way from the last crossed checkpoint to the next one.
  const spanStart = cps[prevCp];
  const span = wrap01(cps[kart.nextCp] - spanStart) || 1 / cps.length;
  let frac = forwardDelta(spanStart, kart.progress) / span;
  if (frac < 0) frac = 0;
  if (frac > 1) frac = 1;
  return kart.lap + (prevCp + frac) / cps.length;
}

/** 0-based place of kart `idx` right now (0 = leading). */
export function placeOf(state: RaceState, track: Track, idx: number): number {
  const mine = state.karts[idx];
  const theirs = state.karts[1 - idx];
  if (mine.finishedAtTick !== null || theirs.finishedAtTick !== null) {
    const order = state.finishOrder;
    if (order.includes(idx)) return order.indexOf(idx);
    return order.length; // they finished, we haven't
  }
  return raceDistance(mine, track) >= raceDistance(theirs, track) ? 0 : 1;
}

/**
 * Advance the whole race by one tick. Returns the events that happened, in
 * a caller-provided array to avoid allocating one 60 times a second.
 */
export function stepRace(
  state: RaceState,
  track: Track,
  inputs: RaceInputs,
  config: RaceConfig,
  events: RaceEvent[] = [],
): RaceEvent[] {
  events.length = 0;
  state.tick++;

  if (state.phase === 'countdown') {
    if (state.tick >= COUNTDOWN_TICKS) state.phase = 'racing';
    return events;
  }
  if (state.phase === 'finished') return events;

  const stepEv: StepEvents = { driftBoost: 0, wallHit: false };

  for (let i = 0; i < 2; i++) {
    const kart = state.karts[i];
    // A finished kart coasts to a stop where it is — still collidable, so the
    // winner parked on the line is an obstacle, not a ghost.
    const input = kart.finishedAtTick === null ? inputs.karts[i] : { ...NEUTRAL_INPUT, throttle: 0 };
    stepKart(kart, input, stepEv);
    if (stepEv.driftBoost) events.push({ t: 'boost', kart: i, tier: stepEv.driftBoost });

    const proj = collideWithWalls(kart, track, stepEv);
    if (stepEv.wallHit) events.push({ t: 'wall', kart: i });

    // --- lap + checkpoint accounting ---
    const prevProgress = kart.progress;
    kart.progress = proj.progress;
    if (kart.finishedAtTick === null) {
      const cps = track.checkpoints;
      // A single tick can cross at most one checkpoint (they're ~an eighth
      // of a lap apart; a tick moves a few units), so no loop needed.
      if (crossedCheckpoint(prevProgress, kart.progress, cps[kart.nextCp])) {
        const crossed = kart.nextCp;
        kart.nextCp = (kart.nextCp + 1) % cps.length;
        if (crossed === 0) {
          kart.lap++;
          if (kart.lap >= config.laps) {
            kart.finishedAtTick = state.tick;
            state.finishOrder.push(i);
            events.push({ t: 'finish', kart: i, tick: state.tick });
          } else {
            events.push({ t: 'lap', kart: i, lap: kart.lap });
          }
        }
      }
    }
  }

  collideKarts(state.karts[0], state.karts[1]);

  // --- item boxes ---
  for (let b = 0; b < track.boxes.length; b++) {
    if (state.tick < state.boxReadyAt[b]) continue;
    const box = track.boxes[b];
    for (let i = 0; i < 2; i++) {
      if (state.held[i] !== null || state.karts[i].finishedAtTick !== null) continue;
      const dx = state.karts[i].x - box.x;
      const dy = state.karts[i].y - box.y;
      const r = ITEM_TUNING.boxRadius + KART_RADIUS;
      if (dx * dx + dy * dy > r * r) continue;
      const behind = placeOf(state, track, i) === 1;
      const item = rollItem(config.seed, b, state.boxPickups[b], behind);
      state.held[i] = item;
      state.boxPickups[b]++;
      state.boxReadyAt[b] = state.tick + ITEM_TUNING.boxRespawnTicks;
      events.push({ t: 'pickup', kart: i, item });
      break; // one kart per box per respawn
    }
  }

  // --- using items ---
  for (let i = 0; i < 2; i++) {
    if (!inputs.useItem[i]) continue;
    inputs.useItem[i] = false;
    const item = state.held[i];
    const kart = state.karts[i];
    if (!item || kart.finishedAtTick !== null || kart.spinMs > 0) continue;
    state.held[i] = null;
    events.push({ t: 'use', kart: i, item });
    switch (item) {
      case 'gust':
        kart.boostMs = Math.max(kart.boostMs, ITEM_TUNING.gustBoostMs);
        break;
      case 'bubble':
        kart.shieldMs = ITEM_TUNING.bubbleMs;
        break;
      case 'kelp':
        state.kelps.push(makeKelp(kart, i, state.tick));
        break;
      case 'ripple':
        state.ripples.push(makeRipple(kart.progress, 1 - i, state.tick));
        break;
    }
  }

  // --- kelp hits ---
  for (let k = state.kelps.length - 1; k >= 0; k--) {
    const kelp = state.kelps[k];
    if (state.tick >= kelp.expiresAtTick) {
      state.kelps.splice(k, 1);
      continue;
    }
    for (let i = 0; i < 2; i++) {
      const kart = state.karts[i];
      if (kart.spinMs > 0 || kart.finishedAtTick !== null) continue;
      if (!kelpCatches(kelp, kart, i, state.tick)) continue;
      const result = applyHazardHit(kart);
      events.push(result === 'spun' ? { t: 'spin', kart: i } : { t: 'blocked', kart: i });
      state.kelps.splice(k, 1);
      break; // this kelp is spent
    }
  }

  // --- ripples ---
  for (let r = state.ripples.length - 1; r >= 0; r--) {
    const ripple = state.ripples[r];
    const target = state.karts[ripple.target];
    if (state.tick >= ripple.expiresAtTick || target.finishedAtTick !== null) {
      state.ripples.splice(r, 1);
      continue;
    }
    if (stepRipple(ripple, track, target.progress)) {
      const result = applyHazardHit(target);
      events.push(result === 'spun' ? { t: 'spin', kart: ripple.target } : { t: 'blocked', kart: ripple.target });
      state.ripples.splice(r, 1);
    }
  }

  // --- race end ---
  const bothDone = state.karts.every((k) => k.finishedAtTick !== null);
  const firstDone = state.finishOrder.length > 0
    ? state.karts[state.finishOrder[0]].finishedAtTick! : null;
  if (bothDone || (firstDone !== null && state.tick - firstDone >= STRAGGLER_TICKS)) {
    // A straggler who timed out is ranked by where they were, i.e. last.
    for (let i = 0; i < 2; i++) {
      if (!state.finishOrder.includes(i)) state.finishOrder.push(i);
    }
    state.phase = 'finished';
  }

  return events;
}

/** Race clock for a kart, in ms (finish time once finished, running until). */
export function raceTimeMs(state: RaceState, idx: number): number {
  const k = state.karts[idx];
  const end = k.finishedAtTick ?? state.tick;
  return Math.max(0, Math.round((end - COUNTDOWN_TICKS) * DT * 1000));
}

/** For HUD copy: has this kart stopped racing (crossed the line)? */
export function hasFinished(state: RaceState, idx: number): boolean {
  return state.karts[idx].finishedAtTick !== null;
}

export { speedOf };
