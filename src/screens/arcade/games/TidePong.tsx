/**
 * Tide Pong — you against the house, first to eleven.
 *
 * The opponent is a tracking paddle with a deliberate reaction limit and a
 * small aiming error, not a perfect follower. A perfect paddle is unbeatable
 * and therefore not a game; capping its speed and letting it misjudge
 * slightly is what makes the rally feel like a rally.
 *
 * Score is games won, not rallies: the cabinet's par is 11, so a clean sweep
 * is a perfect card.
 */

import { useEffect, useRef } from 'react';
import { useGameCanvas, useRafLoop, toLogical } from '../../../lib/arcade/loop';
import { useMySprite, drawSprite } from '../../../lib/arcade/sprites';
import { sfx } from '../../../lib/arcade/sound';
import { hueColor } from '../../../lib/arcade/catalog';
import { Screen, Controls } from '../shared';
import type { GameProps } from '../shared';

const W = 240;
const H = 320;
const PADDLE_W = 44;
const PADDLE_H = 6;
const PLAYER_Y = H - 24;
const CPU_Y = 20;
const TARGET = 11;

interface World {
  playerX: number;
  cpuX: number;
  ball: { x: number; y: number; vx: number; vy: number };
  serveIn: number;
  you: number;
  them: number;
  rally: number;
}

export default function TidePong({ run }: GameProps) {
  const { ref: canvasRef, ctx } = useGameCanvas(W, H);
  const { ref: sprite } = useMySprite(30);
  const worldRef = useRef<World | null>(null);
  const color = hueColor(run.game.hue);
  const opponentName = 'THE HOUSE';

  if (!worldRef.current) {
    worldRef.current = {
      playerX: W / 2,
      cpuX: W / 2,
      ball: { x: W / 2, y: H / 2, vx: 0, vy: 0 },
      serveIn: 1.2,
      you: 0,
      them: 0,
      rally: 0,
    };
  }

  useEffect(() => {
    run.setStatus('0 – 0');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useRafLoop((dt) => {
    const world = worldRef.current;
    const c = ctx();
    if (!world || !c) return;

    if (world.serveIn > 0) {
      world.serveIn -= dt;
      world.ball.x = W / 2;
      world.ball.y = H / 2;
      if (world.serveIn <= 0) {
        const speed = 165 + Math.min(60, world.you * 8);
        world.ball.vx = (Math.random() > 0.5 ? 1 : -1) * speed * 0.5;
        world.ball.vy = (Math.random() > 0.5 ? 1 : -1) * speed;
        sfx.blip();
      }
    } else {
      step(world, dt);
    }

    // The house paddle: chases the ball, but only so fast, and aims at a
    // point slightly off centre so it can be wrong-footed.
    const targetX = world.ball.vy < 0 ? world.ball.x + Math.sin(world.rally) * 12 : W / 2;
    const maxSpeed = 108 + world.them * 7;
    const delta = targetX - world.cpuX;
    world.cpuX += Math.max(-maxSpeed * dt, Math.min(maxSpeed * dt, delta));
    world.cpuX = Math.max(PADDLE_W / 2, Math.min(W - PADDLE_W / 2, world.cpuX));

    draw(c, world, color, sprite.current, opponentName);
  }, run.phase === 'playing');

  function step(world: World, dt: number) {
    const ball = world.ball;
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    if (ball.x < 4 && ball.vx < 0) {
      ball.x = 4;
      ball.vx *= -1;
      sfx.bounce();
    }
    if (ball.x > W - 4 && ball.vx > 0) {
      ball.x = W - 4;
      ball.vx *= -1;
      sfx.bounce();
    }

    const hit = (paddleX: number, paddleY: number, downward: boolean) => {
      const towards = downward ? ball.vy > 0 : ball.vy < 0;
      if (!towards) return false;
      if (Math.abs(ball.y - paddleY) > 6) return false;
      if (Math.abs(ball.x - paddleX) > PADDLE_W / 2 + 3) return false;
      const offset = (ball.x - paddleX) / (PADDLE_W / 2);
      const speed = Math.min(320, Math.hypot(ball.vx, ball.vy) * 1.04);
      const angle = offset * 0.95;
      ball.vx = Math.sin(angle) * speed;
      ball.vy = (downward ? -1 : 1) * Math.abs(Math.cos(angle) * speed);
      ball.y = paddleY + (downward ? -7 : 7);
      world.rally += 1;
      sfx.bounce();
      return true;
    };

    hit(world.playerX, PLAYER_Y, true);
    hit(world.cpuX, CPU_Y, false);

    if (ball.y > H + 10) point(world, false);
    else if (ball.y < -10) point(world, true);
  }

  function point(world: World, mine: boolean) {
    if (mine) {
      world.you += 1;
      // A point is worth one; the rally bonus rewards actually playing the
      // ball rather than waiting for the house to fluff a serve.
      run.setScore(world.you);
      sfx.right();
    } else {
      world.them += 1;
      sfx.wrong();
    }
    world.rally = 0;
    world.serveIn = 1;
    world.ball.vx = 0;
    world.ball.vy = 0;
    run.setStatus(`${world.you} – ${world.them}`);

    if (world.you >= TARGET || world.them >= TARGET) {
      if (world.you >= TARGET) sfx.levelUp();
      run.end(world.you);
    }
  }

  const steer = (clientX: number) => {
    const world = worldRef.current;
    if (!world) return;
    const { x } = toLogical(canvasRef.current, clientX, 0, W, H);
    world.playerX = Math.max(PADDLE_W / 2, Math.min(W - PADDLE_W / 2, x));
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
        }}
        onPointerMove={(e) => {
          if (e.buttons > 0 || e.pointerType === 'touch') steer(e.clientX);
        }}
      />
      <Controls>
        <span className="text-[9px] uppercase tracking-widest" style={{ color: 'var(--cab-dim)' }}>
          First to {TARGET}
        </span>
        <span className="text-[9px] uppercase tracking-widest" style={{ color: 'var(--cab-dim)' }}>
          Drag to move
        </span>
      </Controls>
    </>
  );
}

function draw(
  c: CanvasRenderingContext2D,
  world: World,
  color: string,
  sprite: { canvas: HTMLCanvasElement | null; hue: number; accent: string } | null,
  opponentName: string,
) {
  c.fillStyle = '#04010b';
  c.fillRect(0, 0, W, H);

  c.fillStyle = 'rgba(255,255,255,0.14)';
  for (let x = 6; x < W - 6; x += 12) c.fillRect(x, H / 2 - 1, 7, 2);

  c.font = '26px ui-monospace, monospace';
  c.textAlign = 'center';
  c.fillStyle = 'rgba(255,255,255,0.07)';
  c.fillText(String(world.them), W / 2, H / 2 - 16);
  c.fillText(String(world.you), W / 2, H / 2 + 40);

  c.font = '6px ui-monospace, monospace';
  c.fillStyle = 'rgba(255,255,255,0.3)';
  c.fillText(opponentName, W / 2, 10);

  c.fillStyle = '#ff2f5e';
  c.fillRect(world.cpuX - PADDLE_W / 2, CPU_Y, PADDLE_W, PADDLE_H);

  c.fillStyle = color;
  c.fillRect(world.playerX - PADDLE_W / 2, PLAYER_Y, PADDLE_W, PADDLE_H);
  drawSprite(c, sprite, world.playerX, PLAYER_Y + 16, 18);

  if (world.serveIn > 0) {
    c.fillStyle = 'rgba(255,255,255,0.7)';
    c.font = '9px ui-monospace, monospace';
    c.fillText('SERVE', W / 2, H / 2 + 4);
  } else {
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.arc(world.ball.x, world.ball.y, 3.4, 0, Math.PI * 2);
    c.fill();
  }
}
