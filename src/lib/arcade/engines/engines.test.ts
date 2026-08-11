import { describe, it, expect } from 'vitest';
import { makeRng, rngFromString, shuffle } from '../rng';
import {
  COLS,
  ROWS,
  clearLines,
  collides,
  emptyGrid,
  hardDropY,
  levelFor,
  lineScore,
  merge,
  newBag,
  rotateShape,
  spawn,
  tryRotate,
} from './tetris';
import { applyMove, collapseRow, emptyBoard, hasMoves, SIZE } from './g2048';
import {
  DIFFICULTY,
  isWon,
  layMines,
  newBoard as newMineBoard,
  reveal,
  toggleFlag,
  idx,
} from './minesweeper';
import { buildGrid, lineBetween, matches } from './wordsearch';
import { MAX_MISSES, guess, isLost, isSolved, masked, newRound, solveScore } from './hangman';
import {
  buildMaze, chooseGhostDir, isWalkable, DIRS, wrapX,
  COLS as MAZE_COLS, ROWS as ROWS_MAZE,
} from './maze';

// ---------- tetris ----------

describe('tetris', () => {
  it('deals every piece once per bag', () => {
    const bag = newBag(makeRng(7));
    expect([...bag].sort()).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('rotates a matrix clockwise', () => {
    expect(rotateShape([[1, 0], [0, 0]])).toEqual([[0, 1], [0, 0]]);
  });

  it('detects the walls and the floor', () => {
    const grid = emptyGrid();
    const piece = { ...spawn(6), x: 0, y: 0 };
    expect(collides(grid, piece, -1, 0)).toBe(true);
    expect(collides(grid, piece, COLS, 0)).toBe(true);
    expect(collides(grid, piece, 0, ROWS)).toBe(true);
  });

  it('allows a piece to sit above the ceiling where it spawns', () => {
    const grid = emptyGrid();
    expect(collides(grid, spawn(1))).toBe(false);
  });

  it('kicks a rotation away from the wall instead of refusing it', () => {
    const grid = emptyGrid();
    // An I piece hard against the right wall.
    const piece = { ...spawn(1), x: COLS - 2 };
    const rotated = tryRotate(grid, piece);
    expect(rotated.shape).not.toEqual(piece.shape);
    expect(collides(grid, rotated)).toBe(false);
  });

  it('clears full rows and pushes the rest down', () => {
    const grid = emptyGrid();
    grid[ROWS - 1] = Array(COLS).fill(3);
    grid[ROWS - 2][0] = 5;
    const result = clearLines(grid);
    expect(result.cleared).toBe(1);
    expect(result.grid[ROWS - 1][0]).toBe(5);
    expect(result.grid[0].every((c) => c === 0)).toBe(true);
    expect(result.grid).toHaveLength(ROWS);
  });

  it('clears four rows at once', () => {
    const grid = emptyGrid();
    for (let i = 1; i <= 4; i++) grid[ROWS - i] = Array(COLS).fill(1);
    expect(clearLines(grid).cleared).toBe(4);
  });

  it('scores a tetris well above four singles', () => {
    expect(lineScore(4, 0)).toBeGreaterThan(lineScore(1, 0) * 4);
    expect(lineScore(1, 3)).toBe(lineScore(1, 0) * 4);
  });

  it('levels up every ten lines and stops climbing', () => {
    expect(levelFor(0)).toBe(0);
    expect(levelFor(29)).toBe(2);
    expect(levelFor(9999)).toBe(14);
  });

  it('drops a piece to the floor and no further', () => {
    const grid = emptyGrid();
    const piece = spawn(4); // O piece, 2x2
    const y = hardDropY(grid, piece);
    merge(grid, { ...piece, y });
    expect(grid[ROWS - 1].some((c) => c !== 0)).toBe(true);
    expect(clearLines(grid).cleared).toBe(0);
  });
});

// ---------- 2048 ----------

describe('2048', () => {
  it('merges a pair and scores it', () => {
    expect(collapseRow([2, 2, 0, 0])).toEqual({ row: [4, 0, 0, 0], gained: 4 });
  });

  it('never merges the same tile twice in one move', () => {
    // The classic bug: this must be 8-8, not 16.
    expect(collapseRow([4, 4, 4, 4])).toEqual({ row: [8, 8, 0, 0], gained: 16 });
    // The trailing 4 slides up against the new 4 but must not merge with it.
    expect(collapseRow([2, 2, 4, 0])).toEqual({ row: [4, 4, 0, 0], gained: 4 });
  });

  it('slides without merging unequal tiles', () => {
    expect(collapseRow([0, 2, 0, 4]).row).toEqual([2, 4, 0, 0]);
  });

  it('reports a no-op move so no tile is spawned for free', () => {
    const board = emptyBoard();
    board[0][0] = 2;
    expect(applyMove(board, 'left').moved).toBe(false);
    expect(applyMove(board, 'up').moved).toBe(false);
    expect(applyMove(board, 'right').moved).toBe(true);
  });

  it('moves in all four directions consistently', () => {
    const board = emptyBoard();
    board[1][1] = 2;
    expect(applyMove(board, 'up').board[0][1]).toBe(2);
    expect(applyMove(board, 'down').board[SIZE - 1][1]).toBe(2);
    expect(applyMove(board, 'left').board[1][0]).toBe(2);
    expect(applyMove(board, 'right').board[1][SIZE - 1]).toBe(2);
  });

  it('knows when the board is dead', () => {
    const alive = emptyBoard();
    expect(hasMoves(alive)).toBe(true);

    const checker = emptyBoard();
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) checker[y][x] = (x + y) % 2 === 0 ? 2 : 4;
    }
    expect(hasMoves(checker)).toBe(false);

    checker[0][0] = 4; // now 4,4 adjacent
    expect(hasMoves(checker)).toBe(true);
  });
});

// ---------- minesweeper ----------

describe('minesweeper', () => {
  it('never puts a reef on or beside the first tap', () => {
    for (let seed = 0; seed < 25; seed++) {
      const board = layMines(newMineBoard(), 4, 5, makeRng(seed));
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          expect(board.cells[idx(board, 4 + dx, 5 + dy)].reef).toBe(false);
        }
      }
    }
  });

  it('lays the requested number of reefs and counts neighbours', () => {
    const board = layMines(newMineBoard(), 0, 0, makeRng(3));
    expect(board.cells.filter((c) => c.reef)).toHaveLength(DIFFICULTY.mines);
    const total = board.cells.reduce((sum, c) => sum + (c.reef ? 0 : c.near), 0);
    expect(total).toBeGreaterThan(0);
  });

  it('floods outwards from an empty square', () => {
    const result = reveal(newMineBoard(), 4, 5, makeRng(9));
    expect(result.hitReef).toBe(false);
    // The safe 3x3 guarantees a zero somewhere, so the flood opens more than one.
    expect(result.revealed).toBeGreaterThan(1);
  });

  it('will not open a flagged square', () => {
    const flagged = toggleFlag(layMines(newMineBoard(), 4, 5, makeRng(1)), 0, 0);
    const result = reveal(flagged, 0, 0, makeRng(1));
    expect(result.revealed).toBe(0);
    expect(result.board.cells[0].revealed).toBe(false);
  });

  it('is only won once every safe square is open', () => {
    let board = layMines(newMineBoard(), 4, 5, makeRng(11));
    expect(isWon(board)).toBe(false);
    board = {
      ...board,
      cells: board.cells.map((c) => (c.reef ? c : { ...c, revealed: true })),
    };
    expect(isWon(board)).toBe(true);
  });

  it('is never won before the reefs are laid', () => {
    expect(isWon(newMineBoard())).toBe(false);
  });
});

// ---------- word search ----------

describe('word search', () => {
  const bank = [
    'ANCHOR', 'HARBOUR', 'LANTERN', 'COMPASS', 'VOYAGE',
    'BEACON', 'GLACIER', 'KRAKEN', 'SEAGULL', 'WHISTLE',
  ].map((word) => ({ word, hint: 'test' }));

  it('places words and fills the rest with letters', () => {
    const grid = buildGrid(bank, 10, 6, rngFromString('search'));
    expect(grid.placements.length).toBeGreaterThan(0);
    expect(grid.placements.length).toBeLessThanOrEqual(6);
    expect(grid.letters).toHaveLength(100);
    expect(grid.letters.every((l) => /^[A-Z]$/.test(l))).toBe(true);
  });

  it('puts each placed word on its own cells, in order', () => {
    const grid = buildGrid(bank, 10, 6, rngFromString('search'));
    for (const placement of grid.placements) {
      const read = placement.cells.map((c) => grid.letters[c]).join('');
      expect(read).toBe(placement.word);
    }
  });

  it('never places the same word twice', () => {
    const grid = buildGrid([...bank, ...bank], 10, 8, rngFromString('dupes'));
    const words = grid.placements.map((p) => p.word);
    expect(new Set(words).size).toBe(words.length);
  });

  it('expands a straight drag and rejects a crooked one', () => {
    expect(lineBetween(5, 0, 4)).toEqual([0, 1, 2, 3, 4]);
    expect(lineBetween(5, 0, 12)).toEqual([0, 6, 12]);
    expect(lineBetween(5, 0, 7)).toBeNull();
  });

  it('accepts a word selected backwards', () => {
    const placement = { word: 'NET', hint: '', cells: [3, 4, 5] };
    expect(matches(placement, [3, 4, 5])).toBe(true);
    expect(matches(placement, [5, 4, 3])).toBe(true);
    expect(matches(placement, [3, 4])).toBe(false);
  });
});

// ---------- hangman ----------

describe('hangman', () => {
  it('reveals hits and counts misses', () => {
    let round = newRound('OTTER', 'hint');
    round = guess(round, 'T');
    expect(round.misses).toBe(0);
    expect(masked(round).join('')).toBe('_TT__');
    round = guess(round, 'Z');
    expect(round.misses).toBe(1);
  });

  it('ignores a repeated guess', () => {
    let round = guess(newRound('OTTER', ''), 'Z');
    round = guess(round, 'Z');
    expect(round.misses).toBe(1);
  });

  it('ends at six misses', () => {
    let round = newRound('OTTER', '');
    for (const letter of 'ZXQVBW') round = guess(round, letter);
    expect(round.misses).toBe(MAX_MISSES);
    expect(isLost(round)).toBe(true);
  });

  it('solves when every distinct letter is guessed', () => {
    let round = newRound('OTTER', '');
    for (const letter of 'OTER') round = guess(round, letter);
    expect(isSolved(round)).toBe(true);
    expect(masked(round).join('')).toBe('OTTER');
  });

  it('pays more for a clean solve than a scruffy one', () => {
    const clean = { ...newRound('LANTERN', ''), misses: 0 };
    const scruffy = { ...newRound('LANTERN', ''), misses: 4 };
    expect(solveScore(clean)).toBeGreaterThan(solveScore(scruffy));
  });
});

// ---------- maze ----------

describe('maze', () => {
  it('builds a walkable board with pellets', () => {
    const { state, spawns } = buildMaze();
    expect(state.pelletsLeft).toBeGreaterThan(100);
    expect(isWalkable(state, spawns.player.x, spawns.player.y)).toBe(true);
  });

  it('keeps the player out of the pen gate but lets chasers through', () => {
    const { state } = buildMaze();
    const gate = state.tiles.findIndex((t) => t === 'gate');
    expect(gate).toBeGreaterThan(-1);
    const gx = gate % MAZE_COLS;
    const gy = Math.floor(gate / MAZE_COLS);
    expect(isWalkable(state, gx, gy)).toBe(false);
    expect(isWalkable(state, gx, gy, true)).toBe(true);
  });

  it('wraps the tunnel round the sides', () => {
    expect(wrapX(-1)).toBe(MAZE_COLS - 1);
    expect(wrapX(MAZE_COLS)).toBe(0);
  });

  it('sends a chaser towards its target and away when frightened', () => {
    const { state } = buildMaze();
    // Pick a junction with a real choice — at a dead end there is only one
    // legal move and hunting and fleeing necessarily agree.
    let junction: { x: number; y: number } | null = null;
    for (let y = 1; y < ROWS_MAZE - 1 && !junction; y++) {
      for (let x = 1; x < MAZE_COLS - 1; x++) {
        if (!isWalkable(state, x, y)) continue;
        const exits = Object.values(DIRS).filter((d) => isWalkable(state, x + d.x, y + d.y));
        if (exits.length >= 3) {
          junction = { x, y };
          break;
        }
      }
    }
    expect(junction).not.toBeNull();

    const target = { x: junction!.x, y: junction!.y - 4 };
    const hunting = chooseGhostDir(state, junction!, DIRS.right, target, false);
    const fleeing = chooseGhostDir(state, junction!, DIRS.right, target, true);
    const distTo = (d: { x: number; y: number }) =>
      (junction!.x + d.x - target.x) ** 2 + (junction!.y + d.y - target.y) ** 2;
    expect(distTo(hunting)).toBeLessThan(distTo(fleeing));
  });

  it('always returns a legal direction', () => {
    const { state, spawns } = buildMaze();
    const dir = chooseGhostDir(state, spawns.player, DIRS.up, spawns.pen, false);
    expect(
      isWalkable(state, spawns.player.x + dir.x, spawns.player.y + dir.y, true),
    ).toBe(true);
  });
});

// ---------- rng ----------

describe('seeded randomness', () => {
  it('is deterministic for the same seed', () => {
    const a = Array.from({ length: 5 }, makeRng(42));
    const b = Array.from({ length: 5 }, makeRng(42));
    expect(a).toEqual(b);
  });

  it('shuffles without losing or duplicating anything', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = shuffle(input, rngFromString('x'));
    expect([...out].sort((a, b) => a - b)).toEqual(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]); // not mutated
  });
});
