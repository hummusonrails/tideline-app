/**
 * Hangman rules, pure.
 *
 * Multi-round: the cabinet keeps handing out words until the rope runs out,
 * so a good round is worth playing carefully rather than being a coin flip on
 * one unlucky word.
 */

export const MAX_MISSES = 6;
export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export interface HangmanRound {
  word: string;
  hint: string;
  guessed: Set<string>;
  misses: number;
}

export function newRound(word: string, hint: string): HangmanRound {
  return { word, hint, guessed: new Set(), misses: 0 };
}

export function guess(round: HangmanRound, letter: string): HangmanRound {
  if (round.guessed.has(letter)) return round;
  const guessed = new Set(round.guessed);
  guessed.add(letter);
  const hit = round.word.includes(letter);
  return { ...round, guessed, misses: round.misses + (hit ? 0 : 1) };
}

export function isSolved(round: HangmanRound): boolean {
  return [...round.word].every((ch) => round.guessed.has(ch));
}

export function isLost(round: HangmanRound): boolean {
  return round.misses >= MAX_MISSES;
}

/** The word as the player sees it: revealed letters and underscores. */
export function masked(round: HangmanRound, revealAll = false): string[] {
  return [...round.word].map((ch) => (revealAll || round.guessed.has(ch) ? ch : '_'));
}

/**
 * Points for solving.
 *
 * Longer words pay more; every unused miss is worth something, so playing the
 * safe letters first is a real strategy rather than the only one.
 */
export function solveScore(round: HangmanRound): number {
  const distinct = new Set(round.word).size;
  return 40 + distinct * 12 + (MAX_MISSES - round.misses) * 15;
}

/**
 * Rope drawing state — how many of the six pieces are up.
 *
 * Deliberately a gallows-free drawing: it's a rope, an anchor and a knot,
 * which reads as "the anchor drops" rather than the original, in a game a
 * family plays together.
 */
export function ropePieces(misses: number): number {
  return Math.min(MAX_MISSES, Math.max(0, misses));
}
