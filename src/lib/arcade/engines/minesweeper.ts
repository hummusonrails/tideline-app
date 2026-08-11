/**
 * Reef Sweeper — minesweeper rules, pure.
 *
 * Two details that separate a pleasant board from an infuriating one, both
 * handled here: the first tap is never a reef (mines are laid *after* the
 * opening move, around it), and revealing a zero floods outwards so the
 * player doesn't have to tap forty empty squares by hand.
 */

import { randInt } from '../rng';

export interface Cell {
  reef: boolean;
  revealed: boolean;
  flagged: boolean;
  /** Adjacent reefs, 0–8. Only meaningful once laid. */
  near: number;
}

export interface Board {
  w: number;
  h: number;
  mines: number;
  cells: Cell[];
  /** Mines are laid on the first reveal, so `laid` gates the win check. */
  laid: boolean;
}

export const DIFFICULTY = { w: 9, h: 12, mines: 16 } as const;

export function newBoard(w = DIFFICULTY.w, h = DIFFICULTY.h, mines = DIFFICULTY.mines): Board {
  return {
    w,
    h,
    mines,
    laid: false,
    cells: Array.from({ length: w * h }, () => ({
      reef: false,
      revealed: false,
      flagged: false,
      near: 0,
    })),
  };
}

export function idx(board: Board, x: number, y: number): number {
  return y * board.w + x;
}

export function inBounds(board: Board, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < board.w && y < board.h;
}

function neighbours(board: Board, x: number, y: number): number[] {
  const out: number[] = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (inBounds(board, nx, ny)) out.push(idx(board, nx, ny));
    }
  }
  return out;
}

/**
 * Lay the reefs, keeping the opening tap and everything touching it clear.
 *
 * Clearing the whole 3×3 rather than just the tapped square means the first
 * move always opens a pocket instead of a lone "1", which is the difference
 * between a game and a coin flip.
 */
export function layMines(board: Board, safeX: number, safeY: number, rng: () => number): Board {
  const next: Board = { ...board, laid: true, cells: board.cells.map((c) => ({ ...c })) };
  const forbidden = new Set<number>([idx(board, safeX, safeY), ...neighbours(board, safeX, safeY)]);

  const capacity = board.w * board.h - forbidden.size;
  let toPlace = Math.min(board.mines, Math.max(0, capacity));
  next.mines = toPlace;

  while (toPlace > 0) {
    const i = randInt(rng, 0, next.cells.length - 1);
    if (forbidden.has(i) || next.cells[i].reef) continue;
    next.cells[i].reef = true;
    toPlace -= 1;
  }

  for (let y = 0; y < next.h; y++) {
    for (let x = 0; x < next.w; x++) {
      const i = idx(next, x, y);
      next.cells[i].near = neighbours(next, x, y).filter((n) => next.cells[n].reef).length;
    }
  }
  return next;
}

export type RevealResult = { board: Board; hitReef: boolean; revealed: number };

/** Reveal a square, flooding through the zeroes. Flags are respected. */
export function reveal(board: Board, x: number, y: number, rng: () => number): RevealResult {
  let work = board.laid ? { ...board, cells: board.cells.map((c) => ({ ...c })) }
                        : layMines(board, x, y, rng);
  const start = idx(work, x, y);
  if (work.cells[start].flagged || work.cells[start].revealed) {
    return { board: work, hitReef: false, revealed: 0 };
  }
  if (work.cells[start].reef) {
    work.cells[start].revealed = true;
    return { board: work, hitReef: true, revealed: 1 };
  }

  let count = 0;
  const stack = [start];
  while (stack.length) {
    const i = stack.pop()!;
    const cell = work.cells[i];
    if (cell.revealed || cell.flagged || cell.reef) continue;
    cell.revealed = true;
    count += 1;
    if (cell.near === 0) {
      const cy = Math.floor(i / work.w);
      const cx = i % work.w;
      stack.push(...neighbours(work, cx, cy));
    }
  }
  return { board: work, hitReef: false, revealed: count };
}

export function toggleFlag(board: Board, x: number, y: number): Board {
  const i = idx(board, x, y);
  if (board.cells[i].revealed) return board;
  const cells = board.cells.map((c) => ({ ...c }));
  cells[i].flagged = !cells[i].flagged;
  return { ...board, cells };
}

/** Cleared when every non-reef square is open. */
export function isWon(board: Board): boolean {
  if (!board.laid) return false;
  return board.cells.every((c) => c.reef || c.revealed);
}

export function flagsUsed(board: Board): number {
  return board.cells.filter((c) => c.flagged).length;
}

/** Reveal everything — for the game-over board. */
export function revealAll(board: Board): Board {
  return { ...board, cells: board.cells.map((c) => ({ ...c, revealed: true })) };
}

/** Score: squares opened, plus a bonus for clearing with time to spare. */
export function scoreFor(opened: number, secondsLeft: number, won: boolean): number {
  return opened * 4 + (won ? 200 + secondsLeft * 4 : 0);
}

/** Classic minesweeper number colours, redrawn for a dark cabinet. */
export const NEAR_COLORS: readonly string[] = [
  'transparent',
  '#63c9ff',
  '#7cff4d',
  '#ff8a8a',
  '#c39bff',
  '#ffd21e',
  '#4de3d0',
  '#ffffff',
  '#9aa4b5',
];
