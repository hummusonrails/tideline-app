/**
 * Helpers for the two things a place page can turn into gameplay: its
 * "hunt for" list, and knowing when its trivia is currently worth points.
 */

import type { Challenge, ChallengeCompletion, MemberId } from '../types';

/**
 * Deterministic challenge id for one hunt-for item.
 *
 * Synthesised on the client rather than authored, so the existing completions
 * pipeline carries these with no new record type, no new collection, and no
 * change to the sync bridge. Every device derives the same id from the same
 * place data, which is what makes dedup work across phones.
 */
export function huntChallengeId(slug: string, index: number): string {
  return `hunt-${slug}-${index}`;
}

export function isHuntDone(
  completions: readonly ChallengeCompletion[],
  member: MemberId,
  slug: string,
  index: number,
): boolean {
  const id = huntChallengeId(slug, index);
  return completions.some((c) => c.by === member && c.challengeId === id);
}

/**
 * Should this place's trivia be hidden behind its scored quiz?
 *
 * The place page and the Quest challenge draw on the same question set, and
 * the place page reveals the answers. Left alone, the "quiz" is a memory test
 * of a page you can open in the next tab — which makes the points meaningless
 * for anyone who notices, and unfair to whoever doesn't.
 *
 * Locks whenever a quiz on these questions is still ahead of them — including
 * one that hasn't opened yet, since pre-reading the answers is the same
 * problem a day early. Unlocks once they've taken it, or once its window has
 * closed and the questions are just nice content again.
 */
export function shouldLockTrivia(opts: {
  placeSlug: string;
  challenges: readonly Challenge[];
  completions: readonly ChallengeCompletion[];
  member: MemberId;
  today: string;
}): Challenge | null {
  const scored = opts.challenges.find(
    (c) =>
      c.proofType === 'trivia' &&
      c.triviaPlaceSlug === opts.placeSlug &&
      c.activeUntil >= opts.today,
  );
  if (!scored) return null;
  const taken = opts.completions.some(
    (c) => c.by === opts.member && c.challengeId === scored.id,
  );
  return taken ? null : scored;
}
