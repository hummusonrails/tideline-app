/**
 * Collapsing reaction events into what should actually be on screen.
 *
 * Two sources have to merge: the legacy inline `message.reactions` map written
 * by older builds, and the {@link Reaction} event stream that replaced it.
 * Events win — a member who reacted under the old scheme and has since changed
 * or retracted their reaction should see the newer intent.
 *
 * Kept pure and separate from the Chat screen so the merge rules are testable
 * without a DOM.
 */

import type { MemberId, Message, Reaction } from '../types';

/** memberId → emoji, for reactions that are currently standing. */
export type EffectiveReactions = Record<MemberId, string>;

/**
 * Resolve the visible reactions for one message.
 *
 * `events` may contain reactions for any message; only this one's are read, so
 * callers can pass the whole table without pre-filtering.
 */
export function effectiveReactions(
  message: Pick<Message, 'id' | 'reactions'>,
  events: readonly Reaction[],
): EffectiveReactions {
  const out: EffectiveReactions = { ...(message.reactions ?? {}) };

  // Last write per member wins. Ties on `at` — two events in the same
  // millisecond — break on id so every device resolves them identically.
  const latestByMember = new Map<MemberId, Reaction>();
  for (const e of events) {
    if (e.messageId !== message.id) continue;
    const prior = latestByMember.get(e.by);
    if (!prior || e.at > prior.at || (e.at === prior.at && e.id > prior.id)) {
      latestByMember.set(e.by, e);
    }
  }

  for (const [member, event] of latestByMember) {
    if (event.emoji === null) delete out[member];
    else out[member] = event.emoji;
  }
  return out;
}

/**
 * Has this member ever reacted to this message?
 *
 * Drives the award rule, which pays out only on a member's first reaction to a
 * given message. Deliberately counts retracted and superseded reactions too:
 * otherwise removing a reaction and re-adding it would mint points repeatedly.
 */
export function hasEverReacted(
  message: Pick<Message, 'id' | 'reactions'>,
  events: readonly Reaction[],
  member: MemberId,
): boolean {
  if (message.reactions?.[member]) return true;
  return events.some((e) => e.messageId === message.id && e.by === member);
}

/**
 * What tapping `emoji` should record for `member`.
 *
 * Tapping the emoji already showing means "take it back"; anything else
 * replaces it. Returning null-vs-emoji rather than a delete keeps retraction
 * on the same propagation path as every other write.
 */
export function nextEmojiFor(
  current: EffectiveReactions,
  member: MemberId,
  emoji: string,
): string | null {
  return current[member] === emoji ? null : emoji;
}
