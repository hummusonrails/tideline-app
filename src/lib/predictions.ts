/**
 * Predictions — the family betting parlour, minus the betting.
 *
 * "Will we see a whale fluke before 3pm?" Everyone locks a guess before a
 * deadline, a parent marks what actually happened, and whoever called it
 * scores.
 *
 * Built entirely on top of polls, which are themselves built on messages and
 * reactions. That stack is not laziness — it's the only shape that survives
 * this trip. Votes inherit the reaction event model (last write per member
 * wins, retraction propagates, no mutable shared document), the whole thing
 * gossips device-to-device with no new collection, and a phone still running
 * last week's build renders a prediction as an ordinary poll instead of
 * breaking. Mixed versions mid-cruise are a certainty, not a risk.
 *
 * Payout is self-minted: each device awards *its own* member when it sees that
 * their vote matched the outcome. Nobody mints for anybody else, so two
 * devices observing the same result can't pay twice.
 */

import type { MemberId, Message, Profile, Reaction } from '../types';
import { effectiveReactions } from './reactions';
import { parseVote, MIN_OPTIONS, MAX_OPTIONS, type Poll } from './poll';

export const PREDICT_MARKER = 'predict:';
export const OUTCOME_PREFIX = 'outcome:';
export const PREDICTION_POINTS = 15;
export const PREDICTION_PREFIX = 'pred-';

export interface Prediction {
  question: string;
  options: string[];
  /** Votes cast after this are refused by the UI. */
  lockISO: string;
}

/**
 * Encode a prediction into a poll body.
 *
 * First line carries the marker and the lock time; the rest is exactly a
 * poll, which is what makes the graceful degradation work — an older build
 * parses lines 2..n and shows a normal poll with a slightly odd first line.
 */
export function encodePrediction(question: string, options: string[], lockISO: string): string {
  return [
    `${PREDICT_MARKER}${lockISO}`,
    question.trim(),
    ...options.map((o) => o.trim()).filter(Boolean),
  ].join('\n');
}

/**
 * Parse a prediction body, or null if it isn't one.
 *
 * Needs the marker line, a question, and at least {@link MIN_OPTIONS} choices
 * — the same floor polls enforce. A one-option prediction isn't a prediction,
 * and returning null degrades it to a plain message rather than rendering a
 * ballot with nothing to choose between.
 */
export function parsePrediction(body: string): Prediction | null {
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2 + MIN_OPTIONS) return null;
  const [head, question, ...options] = lines;
  if (!head.startsWith(PREDICT_MARKER)) return null;
  const lockISO = head.slice(PREDICT_MARKER.length).trim();
  if (Number.isNaN(Date.parse(lockISO))) return null;
  return { question, options: options.slice(0, MAX_OPTIONS), lockISO };
}

export function isPrediction(body: string): boolean {
  return parsePrediction(body) !== null;
}

/** A prediction is also a valid poll, for tallying. */
export function predictionAsPoll(p: Prediction): Poll {
  return { question: p.question, options: p.options };
}

export function isLocked(p: Prediction, now: Date = new Date()): boolean {
  return now.getTime() >= Date.parse(p.lockISO);
}

// ---------- outcomes ----------

export function outcomeEmoji(optionIndex: number): string {
  return `${OUTCOME_PREFIX}${optionIndex}`;
}

export function parseOutcome(emoji: string | null): number | null {
  if (!emoji || !emoji.startsWith(OUTCOME_PREFIX)) return null;
  const n = Number(emoji.slice(OUTCOME_PREFIX.length));
  return Number.isInteger(n) && n >= 0 ? n : null;
}

/**
 * The settled result, or null while it's still open.
 *
 * Only a parent's mark counts. That isn't distrust of the kids so much as
 * removing the temptation entirely: whoever can declare the winner is
 * effectively holding the points, and that shouldn't be a player.
 *
 * If two parents disagree, the lower option index wins — arbitrary, but it has
 * to be *deterministic*, or two phones would pay out different people.
 */
export function settledOutcome(
  message: Pick<Message, 'id' | 'reactions'>,
  events: readonly Reaction[],
  profiles: readonly Profile[],
): number | null {
  const parents = new Set(profiles.filter((p) => p.role === 'parent').map((p) => p.id));
  const standing = effectiveReactions(message, events);
  const marks: number[] = [];
  for (const [member, emoji] of Object.entries(standing)) {
    if (!parents.has(member)) continue;
    const idx = parseOutcome(emoji);
    if (idx !== null) marks.push(idx);
  }
  if (marks.length === 0) return null;
  return Math.min(...marks);
}

/** What this member guessed, ignoring any outcome marks they also left. */
export function myGuess(
  message: Pick<Message, 'id' | 'reactions'>,
  events: readonly Reaction[],
  me: MemberId,
): number | null {
  // A parent's standing reaction may be their outcome mark rather than a vote,
  // so read votes from the event stream directly instead of the collapsed map.
  const mine = events
    .filter((e) => e.messageId === message.id && e.by === me && parseVote(e.emoji) !== null)
    .sort((a, b) => (a.at === b.at ? a.id.localeCompare(b.id) : a.at.localeCompare(b.at)));
  const last = mine[mine.length - 1];
  return last ? parseVote(last.emoji) : null;
}

export function predictionPayoutId(messageId: string): string {
  return `${PREDICTION_PREFIX}${messageId}`;
}

/**
 * Did this member call it? Only true once the outcome is settled and their
 * standing guess matches.
 */
export function didWin(opts: {
  message: Pick<Message, 'id' | 'reactions'>;
  events: readonly Reaction[];
  profiles: readonly Profile[];
  me: MemberId;
}): boolean {
  const outcome = settledOutcome(opts.message, opts.events, opts.profiles);
  if (outcome === null) return false;
  return myGuess(opts.message, opts.events, opts.me) === outcome;
}

// ---------- duels ----------

/**
 * A duel is a challenge issued to one person, accepted by them, and called by
 * a parent. Same trick as predictions: an encoded message plus reactions, so
 * it needs nothing new to sync.
 */
export const DUEL_MARKER = 'duel:';
export const DUEL_ACCEPT = 'duel-accept';
export const DUEL_WIN_PREFIX = 'duel-win:';
export const DUEL_POINTS = 20;
export const DUEL_PREFIX = 'duel-';

export interface Duel {
  text: string;
  target: MemberId;
}

export function encodeDuel(text: string, target: MemberId): string {
  return `${DUEL_MARKER}${target}\n${text.trim()}`;
}

export function parseDuel(body: string): Duel | null {
  const lines = body.split('\n');
  const head = lines[0]?.trim() ?? '';
  if (!head.startsWith(DUEL_MARKER)) return null;
  const target = head.slice(DUEL_MARKER.length).trim();
  const text = lines.slice(1).join('\n').trim();
  if (!target || !text) return null;
  return { text, target };
}

export function duelWinEmoji(memberId: MemberId): string {
  return `${DUEL_WIN_PREFIX}${memberId}`;
}

export function parseDuelWin(emoji: string | null): MemberId | null {
  if (!emoji || !emoji.startsWith(DUEL_WIN_PREFIX)) return null;
  const id = emoji.slice(DUEL_WIN_PREFIX.length).trim();
  return id || null;
}

export function isDuelAccepted(
  message: Pick<Message, 'id'>,
  events: readonly Reaction[],
  target: MemberId,
): boolean {
  return events.some(
    (e) => e.messageId === message.id && e.by === target && e.emoji === DUEL_ACCEPT,
  );
}

/**
 * Who a parent declared the winner, or null.
 *
 * Same determinism rule as predictions: on disagreement, the lexicographically
 * smallest member id wins so every device agrees.
 */
export function duelWinner(
  message: Pick<Message, 'id' | 'reactions'>,
  events: readonly Reaction[],
  profiles: readonly Profile[],
): MemberId | null {
  const parents = new Set(profiles.filter((p) => p.role === 'parent').map((p) => p.id));
  const standing = effectiveReactions(message, events);
  const calls: MemberId[] = [];
  for (const [member, emoji] of Object.entries(standing)) {
    if (!parents.has(member)) continue;
    const win = parseDuelWin(emoji);
    if (win) calls.push(win);
  }
  if (calls.length === 0) return null;
  return calls.sort()[0];
}

export function duelPayoutId(messageId: string): string {
  return `${DUEL_PREFIX}${messageId}`;
}

/**
 * Emoji namespaces reserved by these mechanics.
 *
 * The chat's reaction chips must filter these out — a row of "vote:1" and
 * "outcome:0" chips under a message would be both ugly and confusing.
 */
export function isReservedEmoji(emoji: string | null): boolean {
  if (!emoji) return false;
  return (
    emoji.startsWith('vote:') ||
    emoji.startsWith(OUTCOME_PREFIX) ||
    emoji.startsWith(DUEL_WIN_PREFIX) ||
    emoji === DUEL_ACCEPT
  );
}
