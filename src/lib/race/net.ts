/**
 * Netcode for the kart duel, riding the p2p layer's `game` control frames.
 *
 * ## Why host-authoritative (and not lockstep or rollback)
 *
 * The transport is a reliable, *ordered* data channel shared with the
 * family's photo/message gossip. That rules the alternatives out on their
 * own terms:
 *
 *  - **Deterministic lockstep** steps only when both inputs for a tick have
 *    arrived, so every keypress feels like the network's round trip
 *    (30–150ms here), and one backgrounded phone freezes both screens.
 *    It also bets the race on cross-engine floating-point determinism.
 *  - **Rollback** hides that latency but needs state snapshots plus
 *    re-simulation every time a late input lands — a lot of machinery whose
 *    payoff is fairness under adversarial timing. This is two kids on a
 *    couch, not an esport.
 *  - **Host-authoritative** gives each player zero-latency control of their
 *    own kart (the guest *predicts* itself with the same physics) and makes
 *    every outcome — laps, items, hits, the finish — one machine's word.
 *    The guest's view of the *opponent* runs a snapshot behind, which for
 *    phones physically next to each other is a cosmetic offset, not a
 *    gameplay one.
 *
 * ## Rates, and why they're safe on a shared channel
 *
 * Guest → host inputs at 20Hz; host → guest snapshots at 15Hz. Both frames
 * are well under 300 bytes, so the game adds ~10KB/s to a channel that
 * streams photos in 60KB chunks — noise. The number that actually matters
 * on a reliable-ordered channel is *queue depth*: every frame must be
 * delivered in order, so a burst during a radio hiccup delays everything
 * behind it. At these rates a full 150ms stall queues at most ~5 tiny
 * frames, which drain in one round trip. That's the budget reasoning, and
 * it's why the rates are constants here and not "as fast as rAF".
 *
 * ## Host election
 *
 * The host is the peer whose device fingerprint sorts first. Both sides
 * already hold both fingerprints (their own identity and the paired peer's
 * trust-store row), so both compute the same answer before a single game
 * frame is exchanged — no coin toss, no race, no negotiation message that
 * could itself race.
 *
 * ## Mixed builds
 *
 * A peer on an older build drops the entire `game` frame in decodeControl
 * (unknown type → null) — silence, never a crash. Within builds that do
 * know `game`, RACE_GV gates compatibility: a frame with a different gv is
 * answered (once) with 'nope', so the newer build can tell the player to
 * update instead of leaving them staring at "waiting…".
 */

import type { GameMsg } from '../p2p/protocol';
import type { AvatarSpec } from '../../types';
import type { ItemKind, Kelp, Ripple } from './items';
import type { KartState } from './physics';
import type { RacePhase, RaceEvent } from './engine';

/** Bump when the game protocol changes incompatibly. Independent of PROTOCOL_VERSION. */
export const RACE_GV = 1;

/** Guest input send rate. See the header comment for the budget reasoning. */
export const INPUT_HZ = 20;
/** Host snapshot send rate. */
export const SNAPSHOT_HZ = 15;
/**
 * Watchdog: this much silence mid-race and the race is called off. Covers a
 * backgrounded phone (iOS suspends PWAs without closing the channel) well
 * before the p2p layer's 45s zombie reaper would notice.
 */
export const RACE_TIMEOUT_MS = 4000;

/** Deterministic host election: the fingerprint that sorts first drives. */
export function electHost(myFingerprint: string, theirFingerprint: string): boolean {
  return myFingerprint < theirFingerprint;
}

// --- message kinds -----------------------------------------------------------

/** What both sides say about themselves when a duel is proposed/accepted. */
export interface RacerIntro {
  memberId: string;
  name: string;
  /**
   * The sender's composed avatar, carried in the handshake because the
   * spec normally syncs over git and may simply not have reached this
   * device yet. Null when the sender never made one.
   */
  avatar: AvatarSpec | null;
}

export interface RaceCfg {
  /** Shared race id — seeds the items and keys the points dedup. */
  raceId: string;
  trackId: string;
  laps: number;
}

/** Compact kart state for snapshots. Positions to 0.1u, heading to mrad. */
export interface WireKart {
  x: number;
  y: number;
  h: number;
  vx: number;
  vy: number;
  /** progress fraction ×10000. */
  pr: number;
  lap: number;
  cp: number;
  /** effect timers, ms. */
  bo: number;
  sp: number;
  sh: number;
  dd: -1 | 0 | 1;
  dc: number;
}

export interface Snapshot {
  t: number;
  ph: RacePhase;
  k: [WireKart, WireKart];
  hi: (ItemKind | null)[];
  /** Kelp on the road: [x, y, owner, droppedAtTick, expiresAtTick][] */
  ke: [number, number, number, number, number][];
  /** Ripples: [progress×10000, target, expiresAtTick][] */
  ri: [number, number, number][];
  /** Events since the last snapshot (lap fanfares, spins, pickups…). */
  ev: RaceEvent[];
  /** Item box ready-at ticks. */
  bx: number[];
}

export type RaceNetMsg =
  | { kind: 'invite'; intro: RacerIntro }
  | { kind: 'accept'; intro: RacerIntro }
  | { kind: 'decline' }
  | { kind: 'cfg'; cfg: RaceCfg }
  /** Guest → host: ready to start. */
  | { kind: 'ready' }
  /** Host → guest: countdown begins on receipt. */
  | { kind: 'go' }
  /** Guest → host: input frame. */
  | { kind: 'in'; seq: number; st: number; th: number; dr: 0 | 1; it: 0 | 1 }
  /** Host → guest: state snapshot. */
  | { kind: 'st'; snap: Snapshot }
  /** Host → guest: authoritative result. */
  | { kind: 'fin'; order: number[]; timesMs: number[] }
  | { kind: 'rematch' }
  | { kind: 'leave' }
  /** Sender's build can't play with ours (gv mismatch). */
  | { kind: 'nope'; gv: number };

// --- encode ------------------------------------------------------------------

export function encodeRaceMsg(msg: RaceNetMsg): Omit<GameMsg, 'type'> {
  const { kind, ...rest } = msg as RaceNetMsg & Record<string, unknown>;
  return { gv: RACE_GV, k: kind, p: rest };
}

const q = (v: number, f: number) => Math.round(v * f) / f;

export function packKart(k: KartState): WireKart {
  return {
    x: q(k.x, 10), y: q(k.y, 10), h: q(k.heading, 1000),
    vx: q(k.vx, 10), vy: q(k.vy, 10),
    pr: Math.round(k.progress * 10000),
    lap: k.lap, cp: k.nextCp,
    bo: Math.round(k.boostMs), sp: Math.round(k.spinMs), sh: Math.round(k.shieldMs),
    dd: k.driftDir, dc: q(k.driftCharge, 100),
  };
}

/** Rehydrate a wire kart into a full state (lastSeg is re-found locally). */
export function unpackKart(w: WireKart, into: KartState): void {
  into.x = w.x; into.y = w.y; into.heading = w.h;
  into.vx = w.vx; into.vy = w.vy;
  into.progress = w.pr / 10000;
  into.lap = w.lap; into.nextCp = w.cp;
  into.boostMs = w.bo; into.spinMs = w.sp; into.shieldMs = w.sh;
  into.driftDir = w.dd; into.driftCharge = w.dc;
  into.finishedAtTick = null; // authoritative finish arrives via 'fin'
}

export function packKelps(kelps: readonly Kelp[]): Snapshot['ke'] {
  return kelps.map((k) => [q(k.x, 10), q(k.y, 10), k.owner, k.droppedAtTick, k.expiresAtTick]);
}

export function unpackKelps(ke: Snapshot['ke']): Kelp[] {
  return ke.map(([x, y, owner, droppedAtTick, expiresAtTick]) => ({
    x, y, owner, droppedAtTick, expiresAtTick,
  }));
}

export function packRipples(ripples: readonly Ripple[]): Snapshot['ri'] {
  return ripples.map((r) => [Math.round(r.progress * 10000), r.target, r.expiresAtTick]);
}

export function unpackRipples(ri: Snapshot['ri']): Ripple[] {
  return ri.map(([pr, target, expiresAtTick]) => ({
    progress: pr / 10000, target, expiresAtTick,
  }));
}

// --- decode ------------------------------------------------------------------

/**
 * The result of looking at an incoming game frame:
 *  - a parsed message,
 *  - 'unsupported' — speaks a different game version (tell the player),
 *  - null — malformed or an unknown kind. Ignored without ceremony, which is
 *    what lets a *newer* build add message kinds without breaking us.
 */
export type ParsedGame =
  | { ok: true; msg: RaceNetMsg }
  | { ok: false; reason: 'unsupported'; gv: number }
  | null;

const ITEM_KINDS = new Set(['gust', 'kelp', 'bubble', 'ripple']);

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function isIntro(v: unknown): v is RacerIntro {
  if (!isObj(v)) return false;
  if (typeof v.memberId !== 'string' || typeof v.name !== 'string') return false;
  // Avatar is either null or spec-shaped; a garbled spec degrades to null
  // rather than poisoning the lobby.
  return v.avatar === null || isObj(v.avatar);
}

function isFiniteNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isWireKart(v: unknown): v is WireKart {
  if (!isObj(v)) return false;
  return (['x', 'y', 'h', 'vx', 'vy', 'pr', 'lap', 'cp', 'bo', 'sp', 'sh', 'dc'] as const)
    .every((f) => isFiniteNum(v[f])) && (v.dd === -1 || v.dd === 0 || v.dd === 1);
}

function isSnapshot(v: unknown): v is Snapshot {
  if (!isObj(v)) return false;
  if (!isFiniteNum(v.t)) return false;
  if (v.ph !== 'countdown' && v.ph !== 'racing' && v.ph !== 'finished') return false;
  if (!Array.isArray(v.k) || v.k.length !== 2 || !v.k.every(isWireKart)) return false;
  if (!Array.isArray(v.hi) || !v.hi.every((h) => h === null || (typeof h === 'string' && ITEM_KINDS.has(h)))) return false;
  if (!Array.isArray(v.ke) || !Array.isArray(v.ri) || !Array.isArray(v.ev) || !Array.isArray(v.bx)) return false;
  return true;
}

export function parseRaceMsg(msg: GameMsg): ParsedGame {
  if (msg.gv !== RACE_GV) return { ok: false, reason: 'unsupported', gv: msg.gv };
  const p = isObj(msg.p) ? msg.p : {};
  switch (msg.k) {
    case 'invite':
    case 'accept':
      if (isIntro(p.intro)) {
        const intro = p.intro;
        return {
          ok: true,
          msg: {
            kind: msg.k,
            intro: {
              memberId: intro.memberId,
              name: intro.name,
              avatar: isValidAvatar(intro.avatar) ? intro.avatar : null,
            },
          },
        };
      }
      return null;
    case 'decline': return { ok: true, msg: { kind: 'decline' } };
    case 'cfg': {
      const cfg = p.cfg;
      if (isObj(cfg) && typeof cfg.raceId === 'string' && typeof cfg.trackId === 'string' && isFiniteNum(cfg.laps)) {
        return { ok: true, msg: { kind: 'cfg', cfg: { raceId: cfg.raceId, trackId: cfg.trackId, laps: cfg.laps } } };
      }
      return null;
    }
    case 'ready': return { ok: true, msg: { kind: 'ready' } };
    case 'go': return { ok: true, msg: { kind: 'go' } };
    case 'in':
      if (isFiniteNum(p.seq) && isFiniteNum(p.st) && isFiniteNum(p.th) && (p.dr === 0 || p.dr === 1) && (p.it === 0 || p.it === 1)) {
        // Clamp at the boundary: a hostile/buggy peer must not be able to
        // inject super-speed via out-of-range inputs.
        return {
          ok: true,
          msg: {
            kind: 'in', seq: p.seq,
            st: Math.max(-1, Math.min(1, p.st)),
            th: Math.max(-1, Math.min(1, p.th)),
            dr: p.dr, it: p.it,
          },
        };
      }
      return null;
    case 'st':
      if (isSnapshot(p.snap)) return { ok: true, msg: { kind: 'st', snap: p.snap } };
      return null;
    case 'fin':
      if (Array.isArray(p.order) && p.order.every(isFiniteNum) &&
          Array.isArray(p.timesMs) && p.timesMs.every(isFiniteNum)) {
        return { ok: true, msg: { kind: 'fin', order: p.order, timesMs: p.timesMs } };
      }
      return null;
    case 'rematch': return { ok: true, msg: { kind: 'rematch' } };
    case 'leave': return { ok: true, msg: { kind: 'leave' } };
    case 'nope':
      if (isFiniteNum(p.gv)) return { ok: true, msg: { kind: 'nope', gv: p.gv } };
      return null;
    default:
      // A kind from the future. Not an error — just not for us.
      return null;
  }
}

/**
 * Just enough validation to hand a peer-supplied avatar to the renderer:
 * the catalog lookups fall back to defaults for unknown part ids, so all we
 * must guarantee is the string-ness of the fields we index with.
 */
function isValidAvatar(v: unknown): v is AvatarSpec {
  if (!isObj(v)) return false;
  return ['memberId', 'base', 'palette', 'eyes', 'mouth'].every(
    (f) => typeof v[f] === 'string',
  );
}
