/**
 * Chained treasure hunts.
 *
 * A hunt is an ordered list of stages. You see one clue at a time; solving it
 * reveals the next. Stages can additionally be gated on a date, on being at a
 * place, or on a wall-clock time, which is what lets a hunt unfold across a
 * day in port rather than being solvable from the cabin the night before.
 *
 * Progress is stored as {@link ChallengeCompletion} records under a
 * synthesised id (see {@link huntStageId}) — the same trick `hunt.ts` uses for
 * place checklists. That is the entire reason this feature needs no new sync
 * collection, no new gossip type, and no coordinated upgrade: an older build
 * relays these completions without understanding them, and a newer build
 * reads a peer's progress the moment it arrives.
 *
 * Pure and data-only, so all of it is testable without a DOM or a database.
 */

import type {
  ChallengeCompletion,
  Hunt,
  HuntStage,
  ItineraryItem,
  MemberId,
  Profile,
  Role,
} from '../types';

/** Prefix reserved for hunt-stage completions. Also read by the notifier. */
export const HUNT_STAGE_PREFIX = 'hunt2-';

/**
 * Deterministic completion id for one stage.
 *
 * Derived from content, never authored, so two devices that solve the same
 * stage agree they solved *the same* stage.
 */
export function huntStageId(huntId: string, stageIndex: number): string {
  return `${HUNT_STAGE_PREFIX}${huntId}-s${stageIndex}`;
}

/** The whole-hunt marker, minted once the last stage lands. */
export function huntFinaleId(huntId: string): string {
  return `${HUNT_STAGE_PREFIX}${huntId}-finale`;
}

/**
 * Parse a hunt-stage completion id back into its parts.
 *
 * Used when rendering someone else's progress and by tests; returns null for
 * anything that isn't one of ours, including the finale marker.
 */
export function parseHuntStageId(
  challengeId: string,
): { huntId: string; stageIndex: number } | null {
  if (!challengeId.startsWith(HUNT_STAGE_PREFIX)) return null;
  const rest = challengeId.slice(HUNT_STAGE_PREFIX.length);
  const m = /^(.+)-s(\d+)$/.exec(rest);
  if (!m) return null;
  return { huntId: m[1], stageIndex: Number(m[2]) };
}

// ---------- answers ----------

/**
 * Normalize a typed answer before hashing or comparing.
 *
 * Kids type with enthusiasm rather than precision, and the failure mode we
 * care about is a correct answer being rejected over a trailing space or a
 * capital letter. Case, surrounding whitespace, internal runs of whitespace
 * and trailing punctuation all collapse.
 */
export function normalizeAnswer(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[.!?,;:]+$/, '');
}

/**
 * SHA-256 of a normalized answer, lowercase hex.
 *
 * Answers live hashed in the trip data because every member's token can read
 * that repo. Hashing isn't a security boundary — it's a speed bump sized to
 * the actual threat, which is a bored twelve-year-old with a browser.
 */
export async function hashAnswer(raw: string): Promise<string> {
  const bytes = new TextEncoder().encode(normalizeAnswer(raw));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function checkCodeAnswer(raw: string, expectedHash: string): Promise<boolean> {
  if (!raw.trim()) return false;
  const got = await hashAnswer(raw);
  return got === expectedHash.trim().toLowerCase();
}

// ---------- team membership ----------

/**
 * Who counts as playing this hunt.
 *
 * Team hunts are cooperative: any teammate solving a stage advances it for
 * everyone on that team, which is what makes "kids vs parents" work when the
 * kids are sharing one pair of eyes and two phones.
 */
export function huntTeamMembers(
  hunt: Pick<Hunt, 'team'>,
  profiles: readonly Profile[],
): MemberId[] {
  const team = hunt.team ?? 'all';
  if (team === 'all') return profiles.map((p) => p.id);
  const want: Role = team === 'kids' ? 'kid' : 'parent';
  return profiles.filter((p) => p.role === want).map((p) => p.id);
}

export function isOnHuntTeam(
  hunt: Pick<Hunt, 'team'>,
  profiles: readonly Profile[],
  member: MemberId,
): boolean {
  return huntTeamMembers(hunt, profiles).includes(member);
}

// ---------- progress ----------

export interface HuntContext {
  today: string;                          // local YYYY-MM-DD
  now: Date;
  /** Today's itinerary rows — presence is derived from these, never GPS. */
  todayItinerary: readonly ItineraryItem[];
  profiles: readonly Profile[];
  completions: readonly ChallengeCompletion[];
  member: MemberId;
}

export type StageState =
  | { status: 'done'; hintUsed: boolean; by: MemberId[] }
  | { status: 'open' }
  | { status: 'locked'; reason: string }
  /** An earlier stage is still unsolved, so this one isn't shown at all. */
  | { status: 'future' };

/** Did anyone on the team clear this stage? */
function stageSolvers(
  hunt: Hunt,
  stageIndex: number,
  ctx: HuntContext,
): ChallengeCompletion[] {
  const id = huntStageId(hunt.id, stageIndex);
  const team = new Set(huntTeamMembers(hunt, ctx.profiles));
  return ctx.completions.filter((c) => c.challengeId === id && team.has(c.by));
}

/**
 * Why a stage can't be opened yet, or null if it can.
 *
 * Copy here is deliberately specific but never spoilery: "Unlocks in port" is
 * a reason to come back, "the answer is at the Arctic Brotherhood Hall" is
 * not something a lock screen should say.
 */
export function stageLockReason(
  stage: HuntStage,
  ctx: HuntContext,
  placeName?: string,
): string | null {
  const u = stage.unlock;
  if (!u) return null;
  if (u.onOrAfterDate && ctx.today < u.onOrAfterDate) {
    return `Unlocks ${u.onOrAfterDate}`;
  }
  if (u.placeSlug && !ctx.todayItinerary.some((i) => i.placeSlug === u.placeSlug)) {
    return `Unlocks when we're in ${placeName ?? 'the right place'}`;
  }
  if (u.notBeforeISO && ctx.now.getTime() < Date.parse(u.notBeforeISO)) {
    return `Unlocks later today`;
  }
  return null;
}

/**
 * State of every stage in a hunt, in order.
 *
 * Exactly one stage is ever 'open' or 'locked'; everything before it is
 * 'done' and everything after is 'future'. Clues for future stages are never
 * handed to the UI, which is what stops the whole hunt being readable at once.
 */
export function huntProgress(hunt: Hunt, ctx: HuntContext, placeName?: string): StageState[] {
  const out: StageState[] = [];
  let reachedFrontier = false;

  for (let i = 0; i < hunt.stages.length; i++) {
    if (reachedFrontier) {
      out.push({ status: 'future' });
      continue;
    }
    const solvers = stageSolvers(hunt, i, ctx);
    if (solvers.length > 0) {
      out.push({
        status: 'done',
        // `triviaAnswers` doubles as a marks field on synthetic completions;
        // [1] records that the hint was taken. See completeSynthetic.
        hintUsed: solvers.some((c) => c.triviaAnswers?.[0] === 1),
        by: solvers.map((c) => c.by),
      });
      continue;
    }
    reachedFrontier = true;
    const reason = stageLockReason(hunt.stages[i], ctx, placeName);
    out.push(reason ? { status: 'locked', reason } : { status: 'open' });
  }
  return out;
}

/** Index of the stage the player should be looking at, or null if finished. */
export function currentStageIndex(states: readonly StageState[]): number | null {
  const i = states.findIndex((s) => s.status === 'open' || s.status === 'locked');
  return i === -1 ? null : i;
}

export function completedStageCount(states: readonly StageState[]): number {
  return states.filter((s) => s.status === 'done').length;
}

export function isHuntComplete(states: readonly StageState[]): boolean {
  return states.length > 0 && states.every((s) => s.status === 'done');
}

/**
 * Points for clearing a stage. Taking the hint halves it, rounded up so a
 * hint never reduces a stage to nothing.
 */
export function stagePoints(stage: HuntStage, hintUsed: boolean): number {
  return hintUsed ? Math.ceil(stage.points / 2) : stage.points;
}

/**
 * Has this member personally banked the whole-hunt bonus?
 *
 * Separate from `isHuntComplete`, which is a team-level question: on a team
 * hunt the finale bonus is still minted per person, by their own device.
 */
export function hasFinaleBonus(
  hunt: Pick<Hunt, 'id'>,
  completions: readonly ChallengeCompletion[],
  member: MemberId,
): boolean {
  const id = huntFinaleId(hunt.id);
  return completions.some((c) => c.by === member && c.challengeId === id);
}

// ---------- listing ----------

/**
 * Is this hunt worth showing at all?
 *
 * A hidden hunt stays invisible until its first stage could actually be
 * opened — that's the "a new hunt appeared" moment, and it's the only way to
 * land a surprise on phones that already synced the file days earlier.
 */
export function isHuntVisible(hunt: Hunt, ctx: HuntContext): boolean {
  if (ctx.today < hunt.activeFrom || ctx.today > hunt.activeUntil) return false;
  if (!isOnHuntTeam(hunt, ctx.profiles, ctx.member)) return false;
  if (!hunt.hidden) return true;
  // Already started? Then it's out of the bag regardless.
  if (stageSolvers(hunt, 0, ctx).length > 0) return true;
  return stageLockReason(hunt.stages[0] ?? { clue: '', proof: { type: 'checkbox' }, points: 0 }, ctx) === null;
}

/**
 * Hunts to list, most actionable first: open stages, then locked, then done.
 * Ties break on the earliest end date so things about to expire float up.
 */
export function sortHunts(
  hunts: readonly { hunt: Hunt; states: StageState[] }[],
): { hunt: Hunt; states: StageState[] }[] {
  const rank = (states: StageState[]) => {
    if (isHuntComplete(states)) return 2;
    return states.some((s) => s.status === 'open') ? 0 : 1;
  };
  return [...hunts].sort((a, b) => {
    const d = rank(a.states) - rank(b.states);
    if (d !== 0) return d;
    return a.hunt.activeUntil.localeCompare(b.hunt.activeUntil);
  });
}
