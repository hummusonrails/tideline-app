/**
 * Polls, built on top of messages and reactions.
 *
 * A poll is a `Message` with `kind: 'poll'` whose body is the question on the
 * first line and one option per line after. Votes are {@link Reaction} events
 * with an `emoji` of `vote:<index>`.
 *
 * That reuse is the whole design: votes inherit the reaction machinery's
 * conflict-free semantics for free — last write per member wins, retraction
 * works, and they propagate over gossip, AirDrop and Git without a single new
 * collection or sync route. A device on an older build renders the poll as a
 * plain message rather than breaking.
 */

import type { MemberId, Message, Reaction } from '../types';
import { effectiveReactions } from './reactions';

export const VOTE_PREFIX = 'vote:';
export const MAX_OPTIONS = 4;
export const MIN_OPTIONS = 2;

export interface Poll {
  question: string;
  options: string[];
}

export function encodePoll(question: string, options: string[]): string {
  return [question.trim(), ...options.map((o) => o.trim()).filter(Boolean)].join('\n');
}

/**
 * Parse a poll body, or null if it isn't one.
 *
 * Returns null rather than throwing for a malformed body so a corrupted or
 * hand-edited record degrades to a plain message instead of breaking the chat.
 */
export function parsePoll(body: string): Poll | null {
  const lines = body.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length < 1 + MIN_OPTIONS) return null;
  const [question, ...options] = lines;
  return { question, options: options.slice(0, MAX_OPTIONS) };
}

export function voteEmoji(optionIndex: number): string {
  return `${VOTE_PREFIX}${optionIndex}`;
}

export function parseVote(emoji: string | null): number | null {
  if (!emoji || !emoji.startsWith(VOTE_PREFIX)) return null;
  const n = Number(emoji.slice(VOTE_PREFIX.length));
  return Number.isInteger(n) && n >= 0 ? n : null;
}

export interface Tally {
  /** Vote count per option index. */
  counts: number[];
  /** Who voted for what, for showing avatars. */
  votersByOption: MemberId[][];
  total: number;
  /** The current member's choice, if any. */
  mine: number | null;
}

/**
 * Count votes for a poll.
 *
 * Built from `effectiveReactions` so one member holds at most one live vote —
 * changing your mind replaces, it doesn't add.
 */
export function tallyVotes(
  message: Pick<Message, 'id' | 'reactions'>,
  events: readonly Reaction[],
  poll: Poll,
  me: MemberId,
): Tally {
  const standing = effectiveReactions(message, events);
  const counts = new Array<number>(poll.options.length).fill(0);
  const votersByOption: MemberId[][] = poll.options.map(() => []);
  let total = 0;
  let mine: number | null = null;

  for (const [member, emoji] of Object.entries(standing)) {
    const idx = parseVote(emoji);
    if (idx === null || idx >= poll.options.length) continue;
    counts[idx] += 1;
    votersByOption[idx].push(member);
    total += 1;
    if (member === me) mine = idx;
  }

  return { counts, votersByOption, total, mine };
}

/** Whole-number percentage, guarding the zero-vote case. */
export function votePercent(count: number, total: number): number {
  return total === 0 ? 0 : Math.round((count / total) * 100);
}
