/**
 * Port Breaker.
 *
 * Breakout, with the bricks labelled from the itinerary — knocking out the
 * wall is knocking out the trip, stop by stop. The paddle carries your
 * avatar.
 *
 * Ball physics are deliberately old-fashioned: the bounce angle comes from
 * *where* on the paddle it lands, not from the incoming angle. That's the
 * rule that makes the game controllable, and every version that "improved"
 * it made the game worse.
 */

import { useEffect, useRef } from 'react';
import { useGameCanvas, useRafLoop, toLogical } from '../../../lib/arcade/loop';
import { useMySprite, drawSprite } from '../../../lib/arcade/sprites';
import { sfx } from '../../../lib/arcade/sound';
import { hueColor } from '../../../lib/arcade/catalog';
import { Screen, Controls } from '../shared';
import { LivesRow } from '../../../ui/arcade/GameShell';
import type { GameProps } from '../shared';

const W = 240;
const H = 320;
const COLS = 6;
const ROWS = 5;
const BRICK_W = 36;
const BRICK_H = 14;
const TOP = 40;
const PADDLE_Y = H - 22;

interface Brick {
  x: number;
  y: number;
  row: number;
  label: string;
  alive: boolean;
}

interface World {
  paddleX: number;
  paddleW: number;
  ball: { x: number; y: number; vx: number; vy: number };
  stuck: boolean;
  bricks: Brick[];
  level: number;
}

const ROW_COLOR = ['#ff2f5e', '#ff9a1e', '#ffd21e', '#7cff4d', '#21e6ff'];

export default function PortBreaker({ run, content }: GameProps) {
  const { ref: canvasRef, ctx } = useGameCanvas(W, H);
  const { ref: sprite } = useMySprite(32);
  const worldRef = useRef<World | null>(null);
  const color = hueColor(run.game.hue);
  const labels = content.labels;

  if (!worldRef.current) worldRef.current = makeWorld(1, labels);

  useEffect(() => {
    run.setLives(3);
    run.setStatus('Wall 1');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useRafLoop((dt) => {
    const world = worldRef.current;
    const c = ctx();
    if (!world || !c) return;

    if (world.stuck) {
      world.ball.x = world.paddleX;
      world.ball.y = PADDLE_Y - 8;
    } else {
      // Sub-stepping keeps a fast ball from tunnelling through a brick on a
      // slow frame — cheaper and more reliable than swept collision here.
      const steps = 3;
      for (let s = 0; s < steps; s++) advance(world, dt / steps, run);
      if (world.ball.y > H + 12) {
        sfx.boom();
        if (run.loseLife() <= 0) {
          run.end();
          return;
        }
        world.stuck = true;
        world.ball.vx = 0;
        world.ball.vy = 0;
      }
    }

    if (!world.bricks.some((b) => b.alive)) {
      const next = world.level + 1;
      run.addScore(150 + next * 50);
      sfx.levelUp();
      Object.assign(world, makeWorld(next, labels));
      run.setStatus(`Wall ${next}`);
    }

    draw(c, world, color, sprite.current);
  }, run.phase === 'playing');

  const steer = (clientX: number) => {
    const world = worldRef.current;
    if (!world) return;
    const { x } = toLogical(canvasRef.current, clientX, 0, W, H);
    world.paddleX = Math.max(world.paddleW / 2, Math.min(W - world.paddleW / 2, x));
  };

  const launch = () => {
    const world = worldRef.current;
    if (!world || !world.stuck) return;
    world.stuck = false;
    const speed = 150 + world.level * 12;
    world.ball.vx = (Math.random() > 0.5 ? 1 : -1) * speed * 0.55;
    world.ball.vy = -speed;
    sfx.laser();
  };

  return (
    <>
      <Screen
        canvasRef={canvasRef}
        width={W}
        height={H}
        onPointerDown={(e) => {
          (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
          steer(e.clientX);
          launch();
        }}
        onPointerMove={(e) => {
          if (e.buttons > 0 || e.pointerType === 'touch') steer(e.clientX);
        }}
      />
      <Controls>
        <LivesRow lives={run.lives} color={color} />
        <span className="text-[9px] uppercase tracking-widest" style={{ color: 'var(--cab-dim)' }}>
          Drag to steer · tap to launch
        </span>
      </Controls>
    </>
  );
}

function makeWorld(level: number, labels: string[]): World {
  const bricks: Brick[] = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      // Higher levels start with gaps, so a later wall isn't just a slower
      // grind through the same thirty bricks.
      if (level > 1 && (row + col + level) % 7 === 0) continue;
      bricks.push({
        x: 6 + col * (BRICK_W + 1.6),
        y: TOP + row * (BRICK_H + 3),
        row,
        label: labels[(row * COLS + col) % Math.max(1, labels.length)] ?? '',
        alive: true,
      });
    }
  }
  return {
    paddleX: W / 2,
    paddleW: Math.max(36, 56 - level * 3),
    ball: { x: W / 2, y: PADDLE_Y - 8, vx: 0, vy: 0 },
    stuck: true,
    bricks,
    level,
  };
}

function advance(world: World, dt: number, run: GameProps['run']): void {
  const ball = world.ball;
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  if (ball.x < 4) {
    ball.x = 4;
    ball.vx = Math.abs(ball.vx);
    sfx.bounce();
  }
  if (ball.x > W - 4) {
    ball.x = W - 4;
    ball.vx = -Math.abs(ball.vx);
    sfx.bounce();
  }
  if (ball.y < 4) {
    ball.y = 4;
    ball.vy = Math.abs(ball.vy);
    sfx.bounce();
  }

  // Paddle: the contact point sets the angle.
  if (
    ball.vy > 0 &&
    ball.y > PADDLE_Y - 6 &&
    ball.y < PADDLE_Y + 6 &&
    Math.abs(ball.x - world.paddleX) < world.paddleW / 2 + 3
  ) {
    const offset = (ball.x - world.paddleX) / (world.paddleW / 2);
    const speed = Math.min(280, Math.hypot(ball.vx, ball.vy) * 1.02);
    const angle = offset * 1.05;
    ball.vx = Math.sin(angle) * speed;
    ball.vy = -Math.abs(Math.cos(angle) * speed);
    ball.y = PADDLE_Y - 6;
    sfx.bounce();
  }

  for (const brick of world.bricks) {
    if (!brick.alive) continue;
    if (
      ball.x > brick.x - 3 &&
      ball.x < brick.x + BRICK_W + 3 &&
      ball.y > brick.y - 3 &&
      ball.y < brick.y + BRICK_H + 3
    ) {
      brick.alive = false;
      run.addScore((ROWS - brick.row) * 10 + world.level * 5);
      sfx.hit();
      // Reflect on whichever axis the ball entered from.
      const overlapX = Math.min(
        Math.abs(ball.x - brick.x),
        Math.abs(ball.x - (brick.x + BRICK_W)),
      );
      const overlapY = Math.min(
        Math.abs(ball.y - brick.y),
        Math.abs(ball.y - (brick.y + BRICK_H)),
      );
      if (overlapX < overlapY) ball.vx *= -1;
      else ball.vy *= -1;
      break;
    }
  }
}

function draw(
  c: CanvasRenderingContext2D,
  world: World,
  color: string,
  sprite: { canvas: HTMLCanvasElement | null; hue: number; accent: string } | null,
) {
  c.fillStyle = '#04010b';
  c.fillRect(0, 0, W, H);

  c.font = '5px ui-monospace, monospace';
  c.textAlign = 'center';
  for (const brick of world.bricks) {
    if (!brick.alive) continue;
    const fill = ROW_COLOR[brick.row % ROW_COLOR.length];
    c.fillStyle = fill;
    c.fillRect(brick.x, brick.y, BRICK_W, BRICK_H);
    c.fillStyle = 'rgba(255,255,255,0.35)';
    c.fillRect(brick.x, brick.y, BRICK_W, 2);
    if (brick.label) {
      c.fillStyle = 'rgba(4,1,11,0.85)';
      c.fillText(brick.label.toUpperCase().slice(0, 9), brick.x + BRICK_W / 2, brick.y + 10);
    }
  }

  c.fillStyle = color;
  c.fillRect(world.paddleX - world.paddleW / 2, PADDLE_Y, world.paddleW, 5);
  drawSprite(c, sprite, world.paddleX, PADDLE_Y - 6, 16);

  c.fillStyle = '#ffffff';
  c.beginPath();
  c.arc(world.ball.x, world.ball.y, 3.2, 0, Math.PI * 2);
  c.fill();

  if (world.stuck) {
    c.fillStyle = 'rgba(255,255,255,0.7)';
    c.font = '8px ui-monospace, monospace';
    c.fillText('TAP TO LAUNCH', W / 2, PADDLE_Y - 24);
  }
}
