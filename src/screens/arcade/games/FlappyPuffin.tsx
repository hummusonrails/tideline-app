/**
 * Flappy Puffin.
 *
 * One button, one rule, and a difficulty curve that is entirely the gap size.
 * The bird is your crew avatar, tilted by its own vertical velocity — the
 * cheapest animation in games and still the most legible.
 */

import { useEffect, useRef } from 'react';
import { useGameCanvas, useRafLoop } from '../../../lib/arcade/loop';
import { useMySprite, drawSprite } from '../../../lib/arcade/sprites';
import { sfx, sweep } from '../../../lib/arcade/sound';
import { hueColor } from '../../../lib/arcade/catalog';
import { Screen, Controls } from '../shared';
import type { GameProps } from '../shared';

const W = 240;
const H = 320;
const BIRD_X = 66;
const GROUND = H - 18;
const GRAVITY = 620;
const FLAP = -215;
const PIPE_W = 34;

interface Pipe {
  x: number;
  gapY: number;
  gap: number;
  passed: boolean;
  label: string;
}

interface World {
  y: number;
  vy: number;
  pipes: Pipe[];
  spawnIn: number;
  passed: number;
  started: boolean;
  scroll: number;
}

export default function FlappyPuffin({ run, content }: GameProps) {
  const { ref: canvasRef, ctx } = useGameCanvas(W, H);
  const { ref: sprite } = useMySprite(34);
  const worldRef = useRef<World | null>(null);
  const color = hueColor(run.game.hue);
  const labels = content.labels;

  if (!worldRef.current) {
    worldRef.current = {
      y: H / 2,
      vy: 0,
      pipes: [],
      spawnIn: 0.6,
      passed: 0,
      started: false,
      scroll: 0,
    };
  }

  useEffect(() => {
    run.setStatus('Tap to flap');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const flap = () => {
    const world = worldRef.current;
    if (!world || run.phase !== 'playing') return;
    world.started = true;
    world.vy = FLAP;
    sweep(420, 700, 70, 'triangle', 0.4);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ' || e.key === 'ArrowUp') {
        e.preventDefault();
        flap();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run.phase]);

  useRafLoop((dt) => {
    const world = worldRef.current;
    const c = ctx();
    if (!world || !c) return;

    world.scroll += 74 * dt;

    if (world.started) {
      world.vy += GRAVITY * dt;
      world.y += world.vy * dt;

      world.spawnIn -= dt;
      if (world.spawnIn <= 0) {
        // The gap tightens with every pipe passed, then stops — a curve that
        // keeps narrowing just becomes a coin flip at high scores.
        const gap = Math.max(66, 104 - world.passed * 1.6);
        world.pipes.push({
          x: W + PIPE_W,
          gapY: 50 + Math.random() * (GROUND - 100 - gap),
          gap,
          passed: false,
          label: labels[world.pipes.length % Math.max(1, labels.length)] ?? '',
        });
        world.spawnIn = 1.55;
      }

      for (const p of world.pipes) {
        p.x -= 74 * dt;
        if (!p.passed && p.x + PIPE_W < BIRD_X) {
          p.passed = true;
          world.passed += 1;
          run.setScore(world.passed);
          run.setStatus(`${world.passed} gap${world.passed === 1 ? '' : 's'}`);
          sfx.eat();
        }
      }
      world.pipes = world.pipes.filter((p) => p.x > -PIPE_W - 4);

      const hitGround = world.y > GROUND - 8;
      const hitCeiling = world.y < 6;
      const hitPipe = world.pipes.some(
        (p) =>
          BIRD_X + 8 > p.x &&
          BIRD_X - 8 < p.x + PIPE_W &&
          (world.y - 8 < p.gapY || world.y + 8 > p.gapY + p.gap),
      );
      if (hitGround || hitPipe || hitCeiling) {
        sfx.boom();
        run.end(world.passed);
        return;
      }
    }

    draw(c, world, color, sprite.current);
  }, run.phase === 'playing');

  return (
    <>
      <Screen
        canvasRef={canvasRef}
        width={W}
        height={H}
        onPointerDown={(e) => {
          e.preventDefault();
          flap();
        }}
      />
      <Controls className="justify-center">
        <button
          type="button"
          onClick={flap}
          className="arcade-btn w-full touch-none py-3 text-xs font-bold"
          style={{ color }}
        >
          Flap
        </button>
      </Controls>
    </>
  );
}

function draw(
  c: CanvasRenderingContext2D,
  world: World,
  color: string,
  sprite: { canvas: HTMLCanvasElement | null; hue: number; accent: string } | null,
) {
  const grad = c.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#0b1236');
  grad.addColorStop(1, '#12385c');
  c.fillStyle = grad;
  c.fillRect(0, 0, W, H);

  // Parallax swells behind the pipes.
  c.fillStyle = 'rgba(255,255,255,0.05)';
  for (let i = 0; i < 4; i++) {
    const x = ((i * 90 - world.scroll * 0.25) % (W + 90)) - 45;
    c.beginPath();
    c.arc(x, GROUND - 26, 40, Math.PI, 0);
    c.fill();
  }

  for (const p of world.pipes) {
    c.fillStyle = '#1f7a5a';
    c.fillRect(p.x, 0, PIPE_W, p.gapY);
    c.fillRect(p.x, p.gapY + p.gap, PIPE_W, GROUND - (p.gapY + p.gap));
    c.fillStyle = '#2ea87c';
    c.fillRect(p.x - 3, p.gapY - 9, PIPE_W + 6, 9);
    c.fillRect(p.x - 3, p.gapY + p.gap, PIPE_W + 6, 9);
    if (p.label) {
      c.save();
      c.translate(p.x + PIPE_W / 2, p.gapY + p.gap / 2);
      c.rotate(-Math.PI / 2);
      c.fillStyle = 'rgba(255,255,255,0.5)';
      c.font = '7px ui-monospace, monospace';
      c.textAlign = 'center';
      c.fillText(p.label.toUpperCase().slice(0, 10), 0, 3);
      c.restore();
    }
  }

  c.fillStyle = '#0d2b1d';
  c.fillRect(0, GROUND, W, H - GROUND);
  c.fillStyle = '#7cff4d';
  for (let x = Math.floor(-world.scroll % 12); x < W; x += 12) c.fillRect(x, GROUND, 6, 2);

  const tilt = Math.max(-0.5, Math.min(1.1, world.vy / 340));
  c.save();
  c.translate(BIRD_X, world.y);
  c.rotate(tilt);
  c.fillStyle = color;
  c.beginPath();
  c.ellipse(-4, 2, 9, 5, -0.3, 0, Math.PI * 2);
  c.fill();
  drawSprite(c, sprite, 0, 0, 20);
  c.restore();

  if (!world.started) {
    c.fillStyle = 'rgba(255,255,255,0.8)';
    c.font = '9px ui-monospace, monospace';
    c.textAlign = 'center';
    c.fillText('TAP TO FLAP', W / 2, H / 2 - 46);
  }
}
