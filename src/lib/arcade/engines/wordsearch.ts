/**
 * Tide Search — building a word-search grid, pure.
 *
 * Placement is best-effort by design. A grid is a constraint problem, and the
 * word list it's handed comes from whatever the trip synced, so demanding
 * that all eight words fit would occasionally hand the player an empty board.
 * Instead: try each word in a shuffled set of positions, keep what fits,
 * report what was placed. The game scores what's on the grid, so a grid with
 * six words is a shorter round rather than a broken one.
 */

import { shuffle, randInt } from '../rng';

export interface Placement {
  word: string;
  hint: string;
  /** Grid cell indices, in reading order along the placement. */
  cells: number[];
}

export interface SearchGrid {
  size: number;
  letters: string[];
  placements: Placement[];
}

/** All eight directions, including the backwards ones. */
const DIRS: readonly [number, number][] = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [-1, -1], [1, -1], [-1, 1],
];

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function buildGrid(
  candidates: readonly { word: string; hint: string }[],
  size: number,
  want: number,
  rng: () => number,
): SearchGrid {
  const letters = Array<string>(size * size).fill('');
  const placements: Placement[] = [];
  const at = (x: number, y: number) => y * size + x;

  const usable = shuffle(
    candidates.filter((c) => c.word.length >= 3 && c.word.length <= size),
    rng,
  );

  for (const candidate of usable) {
    if (placements.length >= want) break;
    if (placements.some((p) => p.word === candidate.word)) continue;

    const dirs = shuffle(DIRS, rng);
    let placed = false;
    for (const [dx, dy] of dirs) {
      if (placed) break;
      // A bounded number of random starts beats scanning every cell: it keeps
      // grids varied, and a word that can't find a home in 40 tries almost
      // certainly doesn't fit around what's already there.
      for (let attempt = 0; attempt < 40 && !placed; attempt++) {
        const x0 = randInt(rng, 0, size - 1);
        const y0 = randInt(rng, 0, size - 1);
        const endX = x0 + dx * (candidate.word.length - 1);
        const endY = y0 + dy * (candidate.word.length - 1);
        if (endX < 0 || endY < 0 || endX >= size || endY >= size) continue;

        const cells: number[] = [];
        let ok = true;
        for (let i = 0; i < candidate.word.length; i++) {
          const cell = at(x0 + dx * i, y0 + dy * i);
          const existing = letters[cell];
          // Crossings are welcome — they make a better grid — as long as the
          // shared cell already holds the same letter.
          if (existing && existing !== candidate.word[i]) {
            ok = false;
            break;
          }
          cells.push(cell);
        }
        if (!ok) continue;

        cells.forEach((cell, i) => {
          letters[cell] = candidate.word[i];
        });
        placements.push({ word: candidate.word, hint: candidate.hint, cells });
        placed = true;
      }
    }
  }

  for (let i = 0; i < letters.length; i++) {
    if (!letters[i]) letters[i] = ALPHABET[randInt(rng, 0, 25)];
  }

  return { size, letters, placements };
}

/**
 * The straight line between two cells, or null if they don't form one.
 *
 * Drag selection hands us only the endpoints, so this both validates the
 * gesture (same row, column or exact diagonal) and expands it into the cells
 * to compare against a placement.
 */
export function lineBetween(size: number, from: number, to: number): number[] | null {
  const x0 = from % size;
  const y0 = Math.floor(from / size);
  const x1 = to % size;
  const y1 = Math.floor(to / size);
  const dx = Math.sign(x1 - x0);
  const dy = Math.sign(y1 - y0);
  const stepsX = Math.abs(x1 - x0);
  const stepsY = Math.abs(y1 - y0);
  if (stepsX !== 0 && stepsY !== 0 && stepsX !== stepsY) return null;
  const steps = Math.max(stepsX, stepsY);
  const out: number[] = [];
  for (let i = 0; i <= steps; i++) out.push((y0 + dy * i) * size + (x0 + dx * i));
  return out;
}

/** Does a selection match a placement, in either direction? */
export function matches(placement: Placement, selection: readonly number[]): boolean {
  if (placement.cells.length !== selection.length) return false;
  const forward = placement.cells.every((c, i) => c === selection[i]);
  const backward = placement.cells.every((c, i) => c === selection[selection.length - 1 - i]);
  return forward || backward;
}

/** Longer words are worth more, and finishing the grid pays a bonus. */
export function wordScore(word: string): number {
  return 20 + word.length * 10;
}
