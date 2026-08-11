/**
 * Sea Snake.
 *
 * Grid game, so it ticks rather than integrates — the speed *is* the
 * difficulty curve, and it tightens every few pieces of plankton. The head is
 * your avatar, which turns the moment you realise you're about to eat your
 * own tail into something slightly more personal.
 *
 * Turns are queued rather than applied immediately. Without that, two fast
 * taps between ticks (right, then down) drop the first one, and the snake
 * ignores an input the player definitely made.
 */

import { useEffect, useRef } from 'react';
import { useGameCanvas, useRafLoop } from '../../../lib/arcade/loop';
import { useDirectionKeys, swipeHandlers, type Dir } from '../../../lib/arcade/input';
import { useMySprite, drawSprite } from '../../../lib/arcade/sprites';
import { sfx } from '../../../lib/arcade/sound';
import { hueColor } from '../../../lib/arcade/catalog';
import { Screen, Controls } from '../shared';
import { DPad } from '../../../ui/arcade/DPad';
import type { GameProps } from '../shared';

const GRID = 15;
const CELL = 16;
const W = GRID * CELL;
const H = GRID * CELL;

const VEC: Record<Dir, { x: number; y: number }> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

interface World {
  body: { x: number; y: number }[];
  dir: Dir;
  queued: Dir[];
  food: { x: number; y: number };
  grow: number;
  acc: number;
  interval: number;
  eaten: number;
}

export default function SeaSnake({ run }: GameProps) {
  const { ref: canvasRef, ctx } = useGameCanvas(W, H);
  const { ref: sprite } = useMySprite(30);
  const worldRef = useRef<World | null>(null);
  const color = hueColor(run.game.hue);

  if (!worldRef.current) {
    worldRef.current = {
      body: [
        { x: 7, y: 7 },
        { x: 6, y: 7 },
        { x: 5, y: 7 },
      ],
      dir: 'right',
      queued: [],
      food: { x: 11, y: 7 },
      grow: 0,
      acc: 0,
      interval: 200,
      eaten: 0,
    };
  }

  useEffect(() => {
    run.setStatus('Plankton 0');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const turn = (dir: Dir) => {
    const world = worldRef.current;
    if (!world || run.phase !== 'playing') return;
    const last = world.queued[world.queued.length - 1] ?? world.dir;
    // Reversing into yourself is never what anyone meant.
    if (VEC[dir].x === -VEC[last].x && VEC[dir].y === -VEC[last].y) return;
    if (dir === last) return;
    if (world.queued.length < 2) world.queued.push(dir);
  };

  useDirectionKeys(turn, undefined, run.phase === 'playing');
  const swipe = swipeHandlers(turn, 18);

  useRafLoop((dt) => {
    const world = worldRef.current;
    const c = ctx();
    if (!world || !c) return;

    world.acc += dt * 1000;
    while (world.acc >= world.interval) {
      world.acc -= world.interval;
      step(world);
      if (!worldRef.current) return;
    }
    draw(c, world, color, sprite.current);
  }, run.phase === 'playing');

  function step(world: World) {
    const next = world.queued.shift();
    if (next) world.dir = next;
    const head = world.body[0];
    const nx = head.x + VEC[world.dir].x;
    const ny = head.y + VEC[world.dir].y;

    const hitWall = nx < 0 || ny < 0 || nx >= GRID || ny >= GRID;
    // The tail cell is about to move out of the way unless the snake is
    // growing, so running into it is legal — a detail that separates a snake
    // that feels fair from one that doesn't.
    const bodyToCheck = world.grow > 0 ? world.body : world.body.slice(0, -1);
    const hitSelf = bodyToCheck.some((s) => s.x === nx && s.y === ny);
    if (hitWall || hitSelf) {
      sfx.boom();
      run.end();
      return;
    }

    world.body.unshift({ x: nx, y: ny });
    if (world.grow > 0) world.grow -= 1;
    else world.body.pop();

    if (nx === world.food.x && ny === world.food.y) {
      world.grow += 2;
      world.eaten += 1;
      run.addScore(10 + Math.floor(world.eaten / 3) * 5);
      run.setStatus(`Plankton ${world.eaten}`);
      world.interval = Math.max(75, 200 - world.eaten * 5);
      sfx.eat();
      world.food = placeFood(world);
    }
  }

  return (
    <>
      <Screen canvasRef={canvasRef} width={W} height={H} {...swipe} />
      <Controls className="justify-center">
        <DPad color={color} onPress={turn} />
      </Controls>
    </>
  );
}

function placeFood(world: World): { x: number; y: number } {
  const taken = new Set(world.body.map((s) => `${s.x},${s.y}`));
  const free: { x: number; y: number }[] = [];
  for (let y = 0; y < GRID; y++) {
    for (let x = 0; x < GRID; x++) if (!taken.has(`${x},${y}`)) free.push({ x, y });
  }
  return free.length ? free[Math.floor(Math.random() * free.length)] : { x: 0, y: 0 };
}

function draw(
  c: CanvasRenderingContext2D,
  world: World,
  color: string,
  sprite: { canvas: HTMLCanvasElement | null; hue: number; accent: string } | null,
) {
  c.fillStyle = '#04010b';
  c.fillRect(0, 0, W, H);

  c.strokeStyle = 'rgba(255,255,255,0.045)';
  for (let i = 0; i <= GRID; i++) {
    c.beginPath();
    c.moveTo(i * CELL + 0.5, 0);
    c.lineTo(i * CELL + 0.5, H);
    c.stroke();
    c.beginPath();
    c.moveTo(0, i * CELL + 0.5);
    c.lineTo(W, i * CELL + 0.5);
    c.stroke();
  }

  // Plankton, pulsing.
  const pulse = 3 + Math.sin(Date.now() / 140) * 1.2;
  c.fillStyle = '#7cff4d';
  c.beginPath();
  c.arc(world.food.x * CELL + CELL / 2, world.food.y * CELL + CELL / 2, pulse, 0, Math.PI * 2);
  c.fill();

  world.body.forEach((seg, i) => {
    if (i === 0) return;
    const fade = 1 - (i / world.body.length) * 0.6;
    c.globalAlpha = fade;
    c.fillStyle = color;
    c.fillRect(seg.x * CELL + 2, seg.y * CELL + 2, CELL - 4, CELL - 4);
    c.globalAlpha = 1;
  });

  const head = world.body[0];
  drawSprite(c, sprite, head.x * CELL + CELL / 2, head.y * CELL + CELL / 2, CELL + 2);
}
