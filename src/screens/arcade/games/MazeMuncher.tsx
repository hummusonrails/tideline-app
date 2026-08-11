/**
 * Maze Muncher.
 *
 * The chase game, with the crew as the chasers — every other member of the
 * family gets an avatar in the pen, and eating a power pellet means they
 * scatter. It is, as far as the kids are concerned, the entire point of the
 * cabinet.
 *
 * Grid-locked movement with a queued turn: you can input a turn *before* you
 * reach the junction and it fires the moment it becomes legal. Without that
 * lookahead the game is unplayable on a touchscreen, and with it the corners
 * feel exactly like the original.
 */

import { useEffect, useMemo, useRef } from 'react';
import { useGameCanvas, useRafLoop } from '../../../lib/arcade/loop';
import { useDirectionKeys, swipeHandlers, type Dir } from '../../../lib/arcade/input';
import { useCrewSprites, useMySprite, drawSprite, type Sprite } from '../../../lib/arcade/sprites';
import { useSession } from '../../../state/session';
import { sfx } from '../../../lib/arcade/sound';
import { hueColor } from '../../../lib/arcade/catalog';
import {
  COLS,
  ROWS,
  DIRS,
  PELLET_SCORE,
  POWER_SCORE,
  buildMaze,
  chooseGhostDir,
  ghostScore,
  isWalkable,
  tileAt,
  wrapX,
  type MazeState,
} from '../../../lib/arcade/engines/maze';
import { Screen, Controls } from '../shared';
import { DPad } from '../../../ui/arcade/DPad';
import { LivesRow } from '../../../ui/arcade/GameShell';
import type { GameProps } from '../shared';

const CELL = 11;
const W = COLS * CELL;
const H = ROWS * CELL + 10;

interface Mover {
  x: number;
  y: number;
  dir: { x: number; y: number };
  /** 0..1 progress towards the next cell. */
  t: number;
}

interface Ghost extends Mover {
  memberId: string | null;
  scared: number;
  penTimer: number;
  eaten: boolean;
  home: { x: number; y: number };
}

interface World {
  maze: MazeState;
  player: Mover;
  queued: { x: number; y: number } | null;
  ghosts: Ghost[];
  level: number;
  chain: number;
  frozen: number;
}

const GHOST_TINT = ['#ff2f5e', '#ff9a1e', '#21e6ff', '#a86bff'];

export default function MazeMuncher({ run, content }: GameProps) {
  const { ref: canvasRef, ctx } = useGameCanvas(W, H);
  const me = useSession((s) => s.identity);
  const { ref: mySprite } = useMySprite(28);
  const color = hueColor(run.game.hue);

  // The chasers are the *other* crew members. With nobody else synced yet the
  // maze still needs four of them, so the extras run as anonymous shades.
  const chasers = useMemo(
    () => content.crew.filter((c) => c.id !== me).slice(0, 4),
    [content.crew, me],
  );
  const crewSprites = useCrewSprites(chasers, 28);
  const worldRef = useRef<World | null>(null);

  if (!worldRef.current) {
    const { state, spawns } = buildMaze();
    worldRef.current = {
      maze: state,
      player: { x: spawns.player.x, y: spawns.player.y, dir: DIRS.left, t: 0 },
      queued: null,
      ghosts: spawns.ghosts.map((g, i) => ({
        x: g.x,
        y: g.y,
        dir: DIRS.up,
        t: 0,
        memberId: chasers[i]?.id ?? null,
        scared: 0,
        penTimer: i * 2.2,
        eaten: false,
        home: { x: spawns.pen.x, y: spawns.pen.y },
      })),
      level: 1,
      chain: 0,
      frozen: 1,
    };
  }

  useEffect(() => {
    run.setLives(3);
    run.setStatus('Deck 1');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const turn = (dir: Dir) => {
    const world = worldRef.current;
    if (!world || run.phase !== 'playing') return;
    world.queued = DIRS[dir];
  };

  useDirectionKeys(turn, undefined, run.phase === 'playing');
  const swipe = swipeHandlers(turn, 16);

  useRafLoop((dt) => {
    const world = worldRef.current;
    const c = ctx();
    if (!world || !c) return;

    if (world.frozen > 0) {
      world.frozen -= dt;
      draw(c, world, color, mySprite.current, crewSprites);
      return;
    }

    const speed = 5.4 + world.level * 0.3;
    stepPlayer(world, dt * speed);

    for (const ghost of world.ghosts) {
      if (ghost.penTimer > 0) {
        ghost.penTimer -= dt;
        continue;
      }
      ghost.scared = Math.max(0, ghost.scared - dt);
      const ghostSpeed = ghost.eaten ? speed * 1.7 : ghost.scared > 0 ? speed * 0.6 : speed * 0.92;
      stepGhost(world, ghost, dt * ghostSpeed);
    }

    // ---- collisions ----
    for (const ghost of world.ghosts) {
      if (ghost.penTimer > 0 || ghost.eaten) continue;
      const near = Math.abs(ghost.x - world.player.x) < 0.6 && Math.abs(ghost.y - world.player.y) < 0.6;
      if (!near) continue;
      if (ghost.scared > 0) {
        ghost.eaten = true;
        ghost.scared = 0;
        run.addScore(ghostScore(world.chain));
        world.chain += 1;
        sfx.right();
      } else {
        sfx.boom();
        if (run.loseLife() <= 0) {
          run.end();
          return;
        }
        resetPositions(world);
        return;
      }
    }

    if (world.maze.pelletsLeft === 0) {
      world.level += 1;
      const { state, spawns } = buildMaze();
      world.maze = state;
      world.player = { x: spawns.player.x, y: spawns.player.y, dir: DIRS.left, t: 0 };
      world.ghosts.forEach((g, i) => {
        g.x = spawns.ghosts[i].x;
        g.y = spawns.ghosts[i].y;
        g.penTimer = i * 1.6;
        g.eaten = false;
        g.scared = 0;
      });
      world.frozen = 1;
      run.addScore(500);
      run.setStatus(`Deck ${world.level}`);
      sfx.levelUp();
    }

    draw(c, world, color, mySprite.current, crewSprites);
  }, run.phase === 'playing');

  function stepPlayer(world: World, step: number) {
    const p = world.player;
    p.t += step;
    while (p.t >= 1) {
      p.t -= 1;
      p.x = wrapX(p.x + p.dir.x);
      p.y += p.dir.y;

      // Eat whatever is on the cell we just landed on.
      const tile = tileAt(world.maze, p.x, p.y);
      const index = p.y * COLS + wrapX(p.x);
      if (tile === 'pellet') {
        world.maze.tiles[index] = 'empty';
        world.maze.pelletsLeft -= 1;
        run.addScore(PELLET_SCORE);
        sfx.tick();
      } else if (tile === 'power') {
        world.maze.tiles[index] = 'empty';
        world.maze.pelletsLeft -= 1;
        run.addScore(POWER_SCORE);
        world.chain = 0;
        for (const g of world.ghosts) if (!g.eaten) g.scared = 7;
        sfx.coin();
      }

      // Apply a queued turn at the cell boundary, then keep going if we can.
      if (world.queued && isWalkable(world.maze, p.x + world.queued.x, p.y + world.queued.y)) {
        p.dir = world.queued;
        world.queued = null;
      }
      if (!isWalkable(world.maze, p.x + p.dir.x, p.y + p.dir.y)) {
        p.t = 0;
        break;
      }
    }
  }

  function stepGhost(world: World, ghost: Ghost, step: number) {
    ghost.t += step;
    while (ghost.t >= 1) {
      ghost.t -= 1;
      ghost.x = wrapX(ghost.x + ghost.dir.x);
      ghost.y += ghost.dir.y;

      if (ghost.eaten && Math.abs(ghost.x - ghost.home.x) < 1 && Math.abs(ghost.y - ghost.home.y) < 1) {
        ghost.eaten = false;
        ghost.penTimer = 1.5;
      }

      // Each chaser aims somewhere different: straight at you, ahead of you,
      // at your mirror image, or at a corner. Four behaviours, one function.
      const p = world.player;
      const index = world.ghosts.indexOf(ghost);
      const target = ghost.eaten
        ? ghost.home
        : index === 0
        ? { x: p.x, y: p.y }
        : index === 1
        ? { x: p.x + p.dir.x * 4, y: p.y + p.dir.y * 4 }
        : index === 2
        ? { x: COLS - p.x, y: p.y }
        : { x: 1, y: ROWS - 2 };

      ghost.dir = chooseGhostDir(world.maze, ghost, ghost.dir, target, ghost.scared > 0 && !ghost.eaten);
      if (!isWalkable(world.maze, ghost.x + ghost.dir.x, ghost.y + ghost.dir.y, true)) {
        ghost.t = 0;
        break;
      }
    }
  }

  function resetPositions(world: World) {
    const { spawns } = buildMaze();
    world.player = { x: spawns.player.x, y: spawns.player.y, dir: DIRS.left, t: 0 };
    world.queued = null;
    world.ghosts.forEach((g, i) => {
      g.x = spawns.ghosts[i].x;
      g.y = spawns.ghosts[i].y;
      g.dir = DIRS.up;
      g.t = 0;
      g.scared = 0;
      g.eaten = false;
      g.penTimer = i * 1.4;
    });
    world.frozen = 1.2;
  }

  return (
    <>
      <Screen canvasRef={canvasRef} width={W} height={H} {...swipe} />
      <Controls>
        <LivesRow lives={run.lives} color={color} />
        <DPad color={color} onPress={turn} />
      </Controls>
    </>
  );
}

function draw(
  c: CanvasRenderingContext2D,
  world: World,
  color: string,
  mySprite: Sprite | null,
  crewSprites: Record<string, Sprite>,
) {
  c.fillStyle = '#04010b';
  c.fillRect(0, 0, W, H);

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const tile = world.maze.tiles[y * COLS + x];
      const px = x * CELL;
      const py = y * CELL;
      if (tile === 'wall') {
        c.fillStyle = '#1b2a6b';
        c.fillRect(px + 1, py + 1, CELL - 2, CELL - 2);
        c.fillStyle = '#3b57d8';
        c.fillRect(px + 1, py + 1, CELL - 2, 1.5);
      } else if (tile === 'gate') {
        c.fillStyle = '#ff9ad6';
        c.fillRect(px + 1, py + CELL / 2 - 1, CELL - 2, 2);
      } else if (tile === 'pellet') {
        c.fillStyle = '#ffe9a8';
        c.fillRect(px + CELL / 2 - 1, py + CELL / 2 - 1, 2, 2);
      } else if (tile === 'power') {
        c.fillStyle = '#ffd21e';
        c.beginPath();
        c.arc(px + CELL / 2, py + CELL / 2, 3.2 + Math.sin(Date.now() / 180) * 0.8, 0, Math.PI * 2);
        c.fill();
      }
    }
  }

  const posOf = (m: Mover) => ({
    px: (wrapX(m.x) + m.dir.x * m.t + 0.5) * CELL,
    py: (m.y + m.dir.y * m.t + 0.5) * CELL,
  });

  world.ghosts.forEach((ghost, i) => {
    const { px, py } = posOf(ghost);
    if (ghost.eaten) {
      // Eyes only, heading home.
      c.fillStyle = '#ffffff';
      c.fillRect(px - 4, py - 2, 3, 3);
      c.fillRect(px + 1, py - 2, 3, 3);
      return;
    }
    c.save();
    if (ghost.scared > 0) {
      c.globalAlpha = ghost.scared < 2 && Math.floor(ghost.scared * 6) % 2 === 0 ? 0.4 : 0.85;
      c.fillStyle = '#3b57d8';
      c.beginPath();
      c.arc(px, py, CELL * 0.48, 0, Math.PI * 2);
      c.fill();
    } else {
      c.fillStyle = GHOST_TINT[i % GHOST_TINT.length];
      c.beginPath();
      c.arc(px, py, CELL * 0.5, 0, Math.PI * 2);
      c.fill();
    }
    c.restore();
    const sprite = ghost.memberId ? crewSprites[ghost.memberId] : undefined;
    drawSprite(c, sprite ?? null, px, py, CELL * 0.86);
  });

  const { px, py } = posOf(world.player);
  c.fillStyle = color;
  c.beginPath();
  c.arc(px, py, CELL * 0.56, 0, Math.PI * 2);
  c.fill();
  drawSprite(c, mySprite, px, py, CELL);

  if (world.frozen > 0) {
    c.fillStyle = 'rgba(255,255,255,0.85)';
    c.font = '9px ui-monospace, monospace';
    c.textAlign = 'center';
    c.fillText('READY', W / 2, H / 2 + 26);
  }
}
