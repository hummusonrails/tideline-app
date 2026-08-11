/**
 * Tide 2048 — the slide-and-merge rules, pure.
 *
 * The whole game is one operation applied in four directions, so it's written
 * once for "left" and the other three directions are transposes of that. Each
 * tile may merge at most once per move, which is the rule everyone
 * reimplements wrong the first time (4-4-4-4 sliding left is 8-8, never 16).
 */

import { randInt } from '../rng';

export const SIZE = 4;
export type Board = number[][];

export function emptyBoard(): Board {
  return Array.from({ length: SIZE }, () => Array<number>(SIZE).fill(0));
}

export function spawnTile(board: Board, rng: () => number): Board {
  const empties: [number, number][] = [];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) if (board[y][x] === 0) empties.push([y, x]);
  }
  if (!empties.length) return board;
  const [y, x] = empties[randInt(rng, 0, empties.length - 1)];
  const next = board.map((row) => row.slice());
  next[y][x] = rng() < 0.9 ? 2 : 4;
  return next;
}

export function newBoard(rng: () => number): Board {
  return spawnTile(spawnTile(emptyBoard(), rng), rng);
}

/** Slide + merge one row towards index 0. Returns the row and points scored. */
export function collapseRow(row: readonly number[]): { row: number[]; gained: number } {
  const values = row.filter((v) => v !== 0);
  const out: number[] = [];
  let gained = 0;
  for (let i = 0; i < values.length; i++) {
    if (i + 1 < values.length && values[i] === values[i + 1]) {
      const merged = values[i] * 2;
      out.push(merged);
      gained += merged;
      i += 1; // consumed both — this is what stops a triple-merge
    } else {
      out.push(values[i]);
    }
  }
  while (out.length < SIZE) out.push(0);
  return { row: out, gained };
}

function transpose(board: Board): Board {
  return board[0].map((_, x) => board.map((row) => row[x]));
}

function reverseRows(board: Board): Board {
  return board.map((row) => row.slice().reverse());
}

export type Move = 'left' | 'right' | 'up' | 'down';

/**
 * Apply a move. `moved` is false when nothing shifted, which is how the game
 * knows not to spawn a new tile — spawning on a no-op move is a slow death
 * the player didn't earn.
 */
export function applyMove(board: Board, move: Move): { board: Board; gained: number; moved: boolean } {
  let work = board;
  if (move === 'right') work = reverseRows(work);
  else if (move === 'up') work = transpose(work);
  else if (move === 'down') work = reverseRows(transpose(work));

  let gained = 0;
  const collapsed = work.map((row) => {
    const r = collapseRow(row);
    gained += r.gained;
    return r.row;
  });

  let result = collapsed;
  if (move === 'right') result = reverseRows(result);
  else if (move === 'up') result = transpose(result);
  else if (move === 'down') result = transpose(reverseRows(result));

  const moved = result.some((row, y) => row.some((v, x) => v !== board[y][x]));
  return { board: result, gained, moved };
}

/** Any move left? False means game over. */
export function hasMoves(board: Board): boolean {
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      if (board[y][x] === 0) return true;
      if (x + 1 < SIZE && board[y][x] === board[y][x + 1]) return true;
      if (y + 1 < SIZE && board[y][x] === board[y + 1][x]) return true;
    }
  }
  return false;
}

export function highestTile(board: Board): number {
  return Math.max(...board.flat());
}

/** Tile colours, keyed by value. Deep sea → bright surf as it grows. */
export function tileStyle(value: number): { bg: string; fg: string } {
  const map: Record<number, { bg: string; fg: string }> = {
    2: { bg: '#123049', fg: '#9fd8ff' },
    4: { bg: '#16406a', fg: '#bfe6ff' },
    8: { bg: '#12587f', fg: '#e6f8ff' },
    16: { bg: '#0f7594', fg: '#ffffff' },
    32: { bg: '#0e93a1', fg: '#ffffff' },
    64: { bg: '#16b39c', fg: '#04231f' },
    128: { bg: '#4ad08a', fg: '#04231f' },
    256: { bg: '#9ee06a', fg: '#12250a' },
    512: { bg: '#ffd21e', fg: '#2a2000' },
    1024: { bg: '#ff9a1e', fg: '#2a1400' },
    2048: { bg: '#ff2fd0', fg: '#ffffff' },
  };
  return map[value] ?? { bg: '#ff2f5e', fg: '#ffffff' };
}
