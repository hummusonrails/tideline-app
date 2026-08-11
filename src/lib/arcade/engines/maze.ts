/**
 * Maze Muncher's board and the chasers' brains.
 *
 * The maze is hand-authored rather than generated: a generated maze makes a
 * dull chase game, because what makes the genre work is loops, a tunnel, and
 * a middle the ghosts come out of. Twenty-one columns by twenty-three rows on
 * a portrait screen, with a wrap-around tunnel on the middle row.
 *
 * Legend: `#` wall, `.` pellet, `o` power pellet, ` ` empty, `-` gate.
 */

export const MAZE: readonly string[] = [
  '#####################',
  '#.........#.........#',
  '#o###.###.#.###.###o#',
  '#.###.###.#.###.###.#',
  '#...................#',
  '#.###.#.#####.#.###.#',
  '#.....#...#...#.....#',
  '#####.###.#.###.#####',
  '    #.#.......#.#    ',
  '#####.#.##-##.#.#####',
  '.........#   #.......',
  '#####.#.##!##.#.#####',
  '    #.#.......#.#    ',
  '#####.#.#####.#.#####',
  '#.........#.........#',
  '#.###.###.#.###.###.#',
  '#o..#.....P.....#..o#',
  '###.#.#.#####.#.#.###',
  '#.....#...#...#.....#',
  '#.#######.#.#######.#',
  '#...................#',
  '#####################',
];

export const COLS = MAZE[0].length;
export const ROWS = MAZE.length;
export const TUNNEL_ROW = 10;

export type TileKind = 'wall' | 'pellet' | 'power' | 'empty' | 'gate';

export interface MazeState {
  /** Row-major tiles. Pellets get eaten out of this. */
  tiles: TileKind[];
  pelletsLeft: number;
}

export function tileAt(state: MazeState, cx: number, cy: number): TileKind {
  if (cy < 0 || cy >= ROWS) return 'wall';
  // The tunnel wraps; everything else off the side is wall.
  const x = ((cx % COLS) + COLS) % COLS;
  return state.tiles[cy * COLS + x];
}

export function isWalkable(state: MazeState, cx: number, cy: number, ghost = false): boolean {
  const t = tileAt(state, cx, cy);
  if (t === 'wall') return false;
  // Only the chasers may pass the pen gate, and only outward.
  if (t === 'gate') return ghost;
  return true;
}

export interface MazeSpawns {
  player: { x: number; y: number };
  ghosts: { x: number; y: number }[];
  pen: { x: number; y: number };
}

export function buildMaze(): { state: MazeState; spawns: MazeSpawns } {
  const tiles: TileKind[] = [];
  let pellets = 0;
  let player = { x: 10, y: 16 };
  let pen = { x: 10, y: 10 };

  MAZE.forEach((row, y) => {
    for (let x = 0; x < COLS; x++) {
      const ch = row[x] ?? ' ';
      let kind: TileKind = 'empty';
      if (ch === '#') kind = 'wall';
      else if (ch === '.') { kind = 'pellet'; pellets += 1; }
      else if (ch === 'o') { kind = 'power'; pellets += 1; }
      else if (ch === '-') kind = 'gate';
      else if (ch === 'P') player = { x, y };
      else if (ch === '!') pen = { x, y };
      tiles.push(kind);
    }
  });

  return {
    state: { tiles, pelletsLeft: pellets },
    spawns: {
      player,
      pen,
      // Four chasers stacked in and around the pen, released on a timer.
      ghosts: [
        { x: pen.x, y: pen.y - 1 },
        { x: pen.x, y: pen.y },
        { x: pen.x - 1, y: pen.y },
        { x: pen.x + 1, y: pen.y },
      ],
    },
  };
}

export type Dir = { x: number; y: number };
export const DIRS: Record<string, Dir> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/**
 * A chaser's next move.
 *
 * Greedy toward a target, never reversing unless it's the only option — which
 * is the classic behaviour and is what makes them feel like they're hunting
 * rather than wandering. Each chaser gets a different target (see the screen)
 * so they don't stack into a single ghost train.
 */
export function chooseGhostDir(
  state: MazeState,
  pos: { x: number; y: number },
  current: Dir,
  target: { x: number; y: number },
  scared: boolean,
): Dir {
  const options = Object.values(DIRS).filter((d) => {
    const reversing = d.x === -current.x && d.y === -current.y;
    if (reversing) return false;
    return isWalkable(state, pos.x + d.x, pos.y + d.y, true);
  });
  const usable = options.length
    ? options
    : Object.values(DIRS).filter((d) => isWalkable(state, pos.x + d.x, pos.y + d.y, true));
  if (!usable.length) return current;

  const dist = (d: Dir) => {
    const nx = pos.x + d.x;
    const ny = pos.y + d.y;
    return (nx - target.x) ** 2 + (ny - target.y) ** 2;
  };
  // Frightened chasers run for the far corner instead of the player, which
  // reads as fleeing without needing a second pathfinder.
  const sorted = usable.slice().sort((a, b) => (scared ? dist(b) - dist(a) : dist(a) - dist(b)));
  return sorted[0];
}

/** Wrap an x coordinate through the tunnel. */
export function wrapX(x: number): number {
  return ((x % COLS) + COLS) % COLS;
}

export const PELLET_SCORE = 10;
export const POWER_SCORE = 50;
/** Chasers eaten during one power pellet: 200, 400, 800, 1600. */
export function ghostScore(chainIndex: number): number {
  return 200 * 2 ** Math.min(3, chainIndex);
}
