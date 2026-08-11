/**
 * Gangway! — cross the traffic, then cross the water.
 *
 * Frogger's two-act structure is the whole design: the road punishes standing
 * still and the water punishes moving, so the same input means opposite
 * things in the two halves. Reaching a berth banks it and sends you back to
 * the start; filling all four berths rolls the level.
 *
 * Movement is per-square and instant. Interpolating it looks smoother and
 * plays worse — you need to know exactly which square you are on when a lorry
 * arrives.
 */

import { useEffect, useRef } from 'react';
import { useGameCanvas, useRafLoop } from '../../../lib/arcade/loop';
import { useDirectionKeys, swipeHandlers, type Dir } from '../../../lib/arcade/input';
import { useMySprite, drawSprite } from '../../../lib/arcade/sprites';
import { sfx } from '../../../lib/arcade/sound';
import { hueColor } from '../../../lib/arcade/catalog';
import { Screen, Controls } from '../shared';
import { DPad } from '../../../ui/arcade/DPad';
import { LivesRow } from '../../../ui/arcade/GameShell';
import type { GameProps } from '../shared';

const COLS = 11;
const CELL = 22;
const ROWS = 14;
const W = COLS * CELL;
const H = ROWS * CELL;

/** Row 0 is the berths, 1–5 water, 6 median, 7–11 road, 12–13 start bank. */
const BERTH_ROW = 0;
const START_ROW = 13;

interface Lane {
  row: number;
  kind: 'car' | 'log';
  dir: 1 | -1;
  speed: number;
  width: number;
  gap: number;
  offset: number;
}

interface World {
  x: number;
  row: number;
  lanes: Lane[];
  berths: boolean[];
  level: number;
  hop: number;
  drowned: number;
}

export default function Gangway({ run }: GameProps) {
  const { ref: canvasRef, ctx } = useGameCanvas(W, H);
  const { ref: sprite } = useMySprite(30);
  const worldRef = useRef<World | null>(null);
  const color = hueColor(run.game.hue);

  if (!worldRef.current) worldRef.current = makeWorld(1);

  useEffect(() => {
    run.setLives(3);
    run.setStatus('Level 1 · 0/4 berths');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const move = (dir: Dir) => {
    const world = worldRef.current;
    if (!world || run.phase !== 'playing') return;
    if (dir === 'up' && world.row > 0) {
      world.row -= 1;
      run.addScore(10);
      sfx.blip();
    } else if (dir === 'down' && world.row < START_ROW) {
      world.row += 1;
      sfx.blip();
    } else if (dir === 'left') {
      world.x = Math.max(0.5, world.x - 1);
      sfx.blip();
    } else if (dir === 'right') {
      world.x = Math.min(COLS - 0.5, world.x + 1);
      sfx.blip();
    }
    world.hop = 0.12;
    checkLanding(world);
  };

  useDirectionKeys(move, undefined, run.phase === 'playing');
  const swipe = swipeHandlers(move, 18);

  function die(world: World, reason: 'traffic' | 'water') {
    sfx.boom();
    world.drowned = 0.5;
    if (run.loseLife() <= 0) {
      run.end();
      return;
    }
    world.x = COLS / 2;
    world.row = START_ROW;
    if (reason === 'water') run.addScore(-5);
  }

  function checkLanding(world: World) {
    if (world.row !== BERTH_ROW) return;
    const slot = Math.floor(world.x / (COLS / 4));
    if (slot < 0 || slot > 3 || world.berths[slot]) {
      // A taken berth or the wall between them is a miss, not a free landing.
      die(world, 'water');
      return;
    }
    world.berths[slot] = true;
    run.addScore(120);
    sfx.levelUp();
    const filled = world.berths.filter(Boolean).length;
    run.setStatus(`Level ${world.level} · ${filled}/4 berths`);
    if (filled === 4) {
      run.addScore(300 + world.level * 100);
      Object.assign(world, makeWorld(world.level + 1));
      run.setStatus(`Level ${world.level} · 0/4 berths`);
    } else {
      world.x = COLS / 2;
      world.row = START_ROW;
    }
  }

  useRafLoop((dt) => {
    const world = worldRef.current;
    const c = ctx();
    if (!world || !c) return;

    for (const lane of world.lanes) {
      lane.offset =
        (lane.offset + lane.dir * lane.speed * dt + COLS * 4) % (lane.width + lane.gap);
    }
    world.hop = Math.max(0, world.hop - dt);
    world.drowned = Math.max(0, world.drowned - dt);

    const lane = world.lanes.find((l) => l.row === world.row);
    if (lane) {
      const riding = occupied(lane, world.x);
      if (lane.kind === 'car' && riding) {
        die(world, 'traffic');
      } else if (lane.kind === 'log') {
        if (!riding) {
          die(world, 'water');
        } else {
          world.x += lane.dir * lane.speed * dt;
          if (world.x < -0.5 || world.x > COLS + 0.5) die(world, 'water');
        }
      }
    }

    draw(c, world, color, sprite.current);
  }, run.phase === 'playing');

  return (
    <>
      <Screen canvasRef={canvasRef} width={W} height={H} {...swipe} />
      <Controls>
        <LivesRow lives={run.lives} color={color} />
        <DPad color={color} onPress={move} />
      </Controls>
    </>
  );
}

/** Is a given column covered by a body in this lane? */
function occupied(lane: Lane, x: number): boolean {
  const period = lane.width + lane.gap;
  let pos = (x - lane.offset) % period;
  if (pos < 0) pos += period;
  return pos < lane.width;
}

function makeWorld(level: number): World {
  const boost = 1 + (level - 1) * 0.18;
  const lanes: Lane[] = [
    { row: 1, kind: 'log', dir: 1, speed: 1.5 * boost, width: 3, gap: 3, offset: 0 },
    { row: 2, kind: 'log', dir: -1, speed: 2.1 * boost, width: 2, gap: 3, offset: 1 },
    { row: 3, kind: 'log', dir: 1, speed: 1.1 * boost, width: 4, gap: 3, offset: 2 },
    { row: 4, kind: 'log', dir: -1, speed: 1.8 * boost, width: 3, gap: 3, offset: 0 },
    { row: 5, kind: 'log', dir: 1, speed: 2.4 * boost, width: 2, gap: 3, offset: 3 },
    { row: 7, kind: 'car', dir: -1, speed: 2.2 * boost, width: 1, gap: 4, offset: 0 },
    { row: 8, kind: 'car', dir: 1, speed: 1.6 * boost, width: 2, gap: 5, offset: 2 },
    { row: 9, kind: 'car', dir: -1, speed: 2.9 * boost, width: 1, gap: 5, offset: 1 },
    { row: 10, kind: 'car', dir: 1, speed: 1.2 * boost, width: 2, gap: 4, offset: 3 },
    { row: 11, kind: 'car', dir: -1, speed: 3.4 * boost, width: 1, gap: 6, offset: 0 },
  ];
  return {
    x: COLS / 2,
    row: START_ROW,
    lanes,
    berths: [false, false, false, false],
    level,
    hop: 0,
    drowned: 0,
  };
}

function draw(
  c: CanvasRenderingContext2D,
  world: World,
  color: string,
  sprite: { canvas: HTMLCanvasElement | null; hue: number; accent: string } | null,
) {
  // Bands: berths, water, median, road, bank.
  const band = (row: number, fill: string) => {
    c.fillStyle = fill;
    c.fillRect(0, row * CELL, W, CELL);
  };
  band(0, '#0d2b3d');
  for (let r = 1; r <= 5; r++) band(r, '#062a45');
  band(6, '#123722');
  for (let r = 7; r <= 11; r++) band(r, '#141419');
  band(12, '#123722');
  band(13, '#123722');

  // Berth slots.
  const slotW = W / 4;
  for (let i = 0; i < 4; i++) {
    c.fillStyle = world.berths[i] ? '#7cff4d' : '#04010b';
    c.fillRect(i * slotW + 6, 3, slotW - 12, CELL - 6);
    if (world.berths[i]) {
      c.fillStyle = '#04010b';
      c.font = '10px ui-monospace, monospace';
      c.textAlign = 'center';
      c.fillText('⚓', i * slotW + slotW / 2, CELL - 7);
    }
  }

  // Road markings.
  c.fillStyle = 'rgba(255,255,255,0.12)';
  for (let r = 7; r <= 11; r++) {
    for (let x = 0; x < W; x += 14) c.fillRect(x, r * CELL + CELL - 1, 8, 1);
  }

  for (const lane of world.lanes) {
    const period = lane.width + lane.gap;
    for (let k = -1; k < COLS / period + 2; k++) {
      const startCol = k * period + lane.offset;
      const px = startCol * CELL;
      const pw = lane.width * CELL;
      if (px > W || px + pw < 0) continue;
      if (lane.kind === 'car') {
        c.fillStyle = ['#ff2f5e', '#ffd21e', '#a86bff'][lane.row % 3];
        c.fillRect(px + 2, lane.row * CELL + 4, pw - 4, CELL - 8);
        c.fillStyle = 'rgba(255,255,255,0.5)';
        c.fillRect(px + 4, lane.row * CELL + 6, pw - 8, 3);
      } else {
        c.fillStyle = '#6b4630';
        c.fillRect(px, lane.row * CELL + 5, pw, CELL - 10);
        c.fillStyle = 'rgba(0,0,0,0.25)';
        for (let s = 0; s < lane.width; s++) c.fillRect(px + s * CELL + CELL - 1, lane.row * CELL + 5, 1, CELL - 10);
      }
    }
  }

  const px = world.x * CELL;
  const py = world.row * CELL + CELL / 2;
  const lift = world.hop > 0 ? 3 : 0;
  if (world.drowned > 0) {
    c.fillStyle = 'rgba(255,47,94,0.6)';
    c.beginPath();
    c.arc(px, py, 12 * (1 - world.drowned / 0.5) + 5, 0, Math.PI * 2);
    c.fill();
  }
  c.fillStyle = color;
  c.fillRect(px - 9, py + 7 - lift, 18, 2);
  drawSprite(c, sprite, px, py - lift, 18);
}
