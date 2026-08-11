/**
 * Block Tide's rules, with no rendering and no React.
 *
 * Standard falling-block rules: seven pieces from a shuffled bag, rotation
 * about a 4×4 (or 3×3) matrix, wall kicks on rotation, line clears scored on
 * the classic curve. Keeping it pure means the awkward parts — a rotation
 * against the right wall, a clear of four rows at once — are testable without
 * a canvas.
 */

import { shuffle } from '../rng';

export const COLS = 10;
export const ROWS = 20;

/** 0 is empty; 1–7 index {@link PIECE_COLORS}. */
export type Cell = number;
export type Grid = Cell[][];

export interface Piece {
  /** 1-based kind, matching the cell value it leaves behind. */
  kind: number;
  /** Square matrix of 0/1. */
  shape: number[][];
  x: number;
  y: number;
}

/**
 * Piece definitions in their spawn rotation. I and O live on a 4×4 and 2×2
 * respectively so that rotating them behaves the way players expect.
 */
const SHAPES: number[][][] = [
  // I
  [
    [0, 0, 0, 0],
    [1, 1, 1, 1],
    [0, 0, 0, 0],
    [0, 0, 0, 0],
  ],
  // J
  [
    [1, 0, 0],
    [1, 1, 1],
    [0, 0, 0],
  ],
  // L
  [
    [0, 0, 1],
    [1, 1, 1],
    [0, 0, 0],
  ],
  // O
  [
    [1, 1],
    [1, 1],
  ],
  // S
  [
    [0, 1, 1],
    [1, 1, 0],
    [0, 0, 0],
  ],
  // T
  [
    [0, 1, 0],
    [1, 1, 1],
    [0, 0, 0],
  ],
  // Z
  [
    [1, 1, 0],
    [0, 1, 1],
    [0, 0, 0],
  ],
];

/** Neon per piece kind, index 1–7. Index 0 is the empty cell. */
export const PIECE_COLORS: readonly string[] = [
  '#000000',
  '#21e6ff', // I
  '#3b6cff', // J
  '#ff9a1e', // L
  '#ffd21e', // O
  '#7cff4d', // S
  '#a86bff', // T
  '#ff2f5e', // Z
];

export function emptyGrid(): Grid {
  return Array.from({ length: ROWS }, () => Array<Cell>(COLS).fill(0));
}

/**
 * The seven-bag randomiser.
 *
 * Uniform random piece selection produces the twelve-in-a-row drought that
 * makes people put the machine down. A shuffled bag of all seven guarantees
 * the piece you need is at most thirteen away.
 */
export function newBag(rng: () => number): number[] {
  return shuffle([1, 2, 3, 4, 5, 6, 7], rng);
}

export function spawn(kind: number): Piece {
  const shape = SHAPES[kind - 1].map((row) => row.slice());
  return {
    kind,
    shape,
    x: Math.floor((COLS - shape[0].length) / 2),
    // Start one row above the field so a piece that spawns into a full stack
    // is detectable as a top-out rather than silently overlapping.
    y: -1,
  };
}

/** Clockwise rotation of a square matrix. */
export function rotateShape(shape: number[][]): number[][] {
  const n = shape.length;
  const out = Array.from({ length: n }, () => Array<number>(n).fill(0));
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) out[x][n - 1 - y] = shape[y][x];
  }
  return out;
}

export function collides(grid: Grid, piece: Piece, dx = 0, dy = 0, shape?: number[][]): boolean {
  const s = shape ?? piece.shape;
  for (let y = 0; y < s.length; y++) {
    for (let x = 0; x < s[y].length; x++) {
      if (!s[y][x]) continue;
      const gx = piece.x + x + dx;
      const gy = piece.y + y + dy;
      if (gx < 0 || gx >= COLS || gy >= ROWS) return true;
      // Above the ceiling is legal — that's where pieces spawn from.
      if (gy < 0) continue;
      if (grid[gy][gx]) return true;
    }
  }
  return false;
}

/**
 * Rotate with wall kicks.
 *
 * Without kicks, a piece flush against a wall simply refuses to turn, which
 * reads as a broken control rather than a rule. Trying a small set of offsets
 * (in, out, and up for the I piece against the floor) covers every case that
 * comes up in practice.
 */
export function tryRotate(grid: Grid, piece: Piece): Piece {
  const rotated = rotateShape(piece.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const dx of kicks) {
    if (!collides(grid, piece, dx, 0, rotated)) {
      return { ...piece, shape: rotated, x: piece.x + dx };
    }
    if (!collides(grid, piece, dx, -1, rotated)) {
      return { ...piece, shape: rotated, x: piece.x + dx, y: piece.y - 1 };
    }
  }
  return piece;
}

/** Stamp a piece into the grid. Mutates — callers own a fresh grid. */
export function merge(grid: Grid, piece: Piece): void {
  for (let y = 0; y < piece.shape.length; y++) {
    for (let x = 0; x < piece.shape[y].length; x++) {
      if (!piece.shape[y][x]) continue;
      const gy = piece.y + y;
      const gx = piece.x + x;
      if (gy >= 0 && gy < ROWS && gx >= 0 && gx < COLS) grid[gy][gx] = piece.kind;
    }
  }
}

/** Remove full rows, returning the new grid and how many went. */
export function clearLines(grid: Grid): { grid: Grid; cleared: number; rows: number[] } {
  const rows: number[] = [];
  const kept = grid.filter((row, i) => {
    const full = row.every((c) => c !== 0);
    if (full) rows.push(i);
    return !full;
  });
  while (kept.length < ROWS) kept.unshift(Array<Cell>(COLS).fill(0));
  return { grid: kept, cleared: rows.length, rows };
}

/** Classic line-clear scoring, scaled by level. */
export function lineScore(cleared: number, level: number): number {
  const table = [0, 100, 300, 500, 800];
  return (table[cleared] ?? 0) * (level + 1);
}

/** Level from total lines cleared: one level per ten rows, capped. */
export function levelFor(lines: number): number {
  return Math.min(14, Math.floor(lines / 10));
}

/** Gravity interval in ms for a level. */
export function dropIntervalMs(level: number): number {
  return Math.max(90, 800 - level * 55);
}

/** Where the piece would land if dropped now — the ghost outline. */
export function hardDropY(grid: Grid, piece: Piece): number {
  let dy = 0;
  while (!collides(grid, piece, 0, dy + 1)) dy += 1;
  return piece.y + dy;
}
