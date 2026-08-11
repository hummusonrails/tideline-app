/**
 * Asteroid Drift.
 *
 * Momentum, no brakes, wrap-around edges: the 1979 handling model, which is
 * still the best argument ever made for inertia in a game. Big floes split
 * into medium, medium into small, small into nothing, and the field refills
 * one heavier each time you clear it.
 *
 * Everything wraps through the screen edges, including bullets and the
 * player, so the arena has no corners to hide in.
 */

import { useEffect, useRef } from 'react';
import { useGameCanvas, useRafLoop } from '../../../lib/arcade/loop';
import { useHeldKeys } from '../../../lib/arcade/input';
import { useMySprite, drawSprite } from '../../../lib/arcade/sprites';
import { sfx } from '../../../lib/arcade/sound';
import { hueColor } from '../../../lib/arcade/catalog';
import { Screen, Controls } from '../shared';
import { ActionButton, DPad } from '../../../ui/arcade/DPad';
import { LivesRow } from '../../../ui/arcade/GameShell';
import type { GameProps } from '../shared';

const W = 260;
const H = 300;

interface Rock {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: 3 | 2 | 1;
  spin: number;
  angle: number;
  shape: number[];
}

interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

interface World {
  ship: { x: number; y: number; vx: number; vy: number; angle: number };
  rocks: Rock[];
  bullets: Bullet[];
  cooldown: number;
  wave: number;
  invulnerable: number;
  debris: { x: number; y: number; vx: number; vy: number; life: number }[];
}

const SIZE_RADIUS: Record<number, number> = { 3: 22, 2: 13, 1: 7 };
const SIZE_SCORE: Record<number, number> = { 3: 20, 2: 50, 1: 100 };

export default function AsteroidDrift({ run }: GameProps) {
  const { ref: canvasRef, ctx } = useGameCanvas(W, H);
  const { held, press, release } = useHeldKeys(run.phase === 'playing');
  const { ref: sprite } = useMySprite(36);
  const worldRef = useRef<World | null>(null);
  const color = hueColor(run.game.hue);

  if (!worldRef.current) {
    worldRef.current = {
      ship: { x: W / 2, y: H / 2, vx: 0, vy: 0, angle: -Math.PI / 2 },
      rocks: spawnField(4),
      bullets: [],
      cooldown: 0,
      wave: 1,
      invulnerable: 1.5,
      debris: [],
    };
  }

  useEffect(() => {
    run.setLives(3);
    run.setStatus('Field 1');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useRafLoop((dt) => {
    const world = worldRef.current;
    const c = ctx();
    if (!world || !c) return;
    const ship = world.ship;

    if (held.current.left) ship.angle -= 3.4 * dt;
    if (held.current.right) ship.angle += 3.4 * dt;
    const thrusting = held.current.up;
    if (thrusting) {
      ship.vx += Math.cos(ship.angle) * 150 * dt;
      ship.vy += Math.sin(ship.angle) * 150 * dt;
    }
    // A whisper of drag: pure Newtonian drift is authentic and unplayable on
    // a screen this small.
    ship.vx *= 1 - 0.5 * dt;
    ship.vy *= 1 - 0.5 * dt;
    const speed = Math.hypot(ship.vx, ship.vy);
    if (speed > 170) {
      ship.vx = (ship.vx / speed) * 170;
      ship.vy = (ship.vy / speed) * 170;
    }
    ship.x = wrap(ship.x + ship.vx * dt, W);
    ship.y = wrap(ship.y + ship.vy * dt, H);

    world.cooldown -= dt;
    if (held.current.fire && world.cooldown <= 0) {
      world.bullets.push({
        x: ship.x,
        y: ship.y,
        vx: Math.cos(ship.angle) * 240 + ship.vx * 0.4,
        vy: Math.sin(ship.angle) * 240 + ship.vy * 0.4,
        life: 1.1,
      });
      world.cooldown = 0.26;
      sfx.laser();
    }

    for (const b of world.bullets) {
      b.x = wrap(b.x + b.vx * dt, W);
      b.y = wrap(b.y + b.vy * dt, H);
      b.life -= dt;
    }
    world.bullets = world.bullets.filter((b) => b.life > 0);

    for (const r of world.rocks) {
      r.x = wrap(r.x + r.vx * dt, W);
      r.y = wrap(r.y + r.vy * dt, H);
      r.angle += r.spin * dt;
    }

    // Bullet → rock.
    for (const b of world.bullets) {
      const hitIndex = world.rocks.findIndex(
        (r) => distWrapped(b.x, b.y, r.x, r.y) < SIZE_RADIUS[r.size],
      );
      if (hitIndex === -1) continue;
      const rock = world.rocks[hitIndex];
      b.life = 0;
      run.addScore(SIZE_SCORE[rock.size]);
      world.rocks.splice(hitIndex, 1);
      if (rock.size > 1) {
        const smaller = (rock.size - 1) as 2 | 1;
        for (let i = 0; i < 2; i++) world.rocks.push(makeRock(rock.x, rock.y, smaller));
      }
      for (let i = 0; i < 7; i++) {
        world.debris.push({
          x: rock.x,
          y: rock.y,
          vx: (Math.random() - 0.5) * 90,
          vy: (Math.random() - 0.5) * 90,
          life: 0.4,
        });
      }
      sfx.boom();
    }
    world.bullets = world.bullets.filter((b) => b.life > 0);

    for (const d of world.debris) {
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      d.life -= dt;
    }
    world.debris = world.debris.filter((d) => d.life > 0);

    // Rock → ship.
    world.invulnerable = Math.max(0, world.invulnerable - dt);
    if (world.invulnerable === 0) {
      const struck = world.rocks.some(
        (r) => distWrapped(ship.x, ship.y, r.x, r.y) < SIZE_RADIUS[r.size] + 7,
      );
      if (struck) {
        sfx.boom();
        if (run.loseLife() <= 0) {
          run.end();
          return;
        }
        ship.x = W / 2;
        ship.y = H / 2;
        ship.vx = 0;
        ship.vy = 0;
        world.invulnerable = 2;
      }
    }

    if (!world.rocks.length) {
      world.wave += 1;
      run.addScore(200 + world.wave * 50);
      world.rocks = spawnField(3 + world.wave);
      world.invulnerable = 1.2;
      run.setStatus(`Field ${world.wave}`);
      sfx.levelUp();
    }

    draw(c, world, color, sprite.current, thrusting);
  }, run.phase === 'playing');

  return (
    <>
      <Screen canvasRef={canvasRef} width={W} height={H} />
      <Controls>
        <DPad
          axis="horizontal"
          color={color}
          onPress={(d) => press(d)}
          onRelease={(d) => release(d)}
        />
        <LivesRow lives={run.lives} color={color} />
        <div className="flex gap-2">
          <ActionButton
            label="Thr"
            color="var(--neon-cyan)"
            onPress={() => press('up')}
            onRelease={() => release('up')}
          />
          <ActionButton
            label="Fire"
            color="var(--neon-pink)"
            onPress={() => press('fire')}
            onRelease={() => release('fire')}
          />
        </div>
      </Controls>
    </>
  );
}

function wrap(v: number, max: number): number {
  return ((v % max) + max) % max;
}

/** Distance that accounts for the wrap — the short way round. */
function distWrapped(ax: number, ay: number, bx: number, by: number): number {
  const dx = Math.min(Math.abs(ax - bx), W - Math.abs(ax - bx));
  const dy = Math.min(Math.abs(ay - by), H - Math.abs(ay - by));
  return Math.hypot(dx, dy);
}

function makeRock(x: number, y: number, size: 3 | 2 | 1): Rock {
  const angle = Math.random() * Math.PI * 2;
  const speed = 16 + Math.random() * 26 + (3 - size) * 9;
  return {
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    size,
    spin: (Math.random() - 0.5) * 2,
    angle: 0,
    // A per-rock radius wobble, so no two floes are the same lump.
    shape: Array.from({ length: 9 }, () => 0.72 + Math.random() * 0.42),
  };
}

function spawnField(count: number): Rock[] {
  return Array.from({ length: count }, () => {
    // Spawn around the rim so nothing materialises on top of the ship.
    const edge = Math.random();
    const x = edge < 0.5 ? Math.random() * W : Math.random() < 0.5 ? 6 : W - 6;
    const y = edge < 0.5 ? (Math.random() < 0.5 ? 6 : H - 6) : Math.random() * H;
    return makeRock(x, y, 3);
  });
}

function draw(
  c: CanvasRenderingContext2D,
  world: World,
  color: string,
  sprite: { canvas: HTMLCanvasElement | null; hue: number; accent: string } | null,
  thrusting: boolean,
) {
  c.fillStyle = '#04010b';
  c.fillRect(0, 0, W, H);

  c.fillStyle = 'rgba(255,255,255,0.25)';
  for (let i = 0; i < 30; i++) c.fillRect((i * 97) % W, (i * 61) % H, 1, 1);

  c.strokeStyle = '#8fd8ff';
  c.lineWidth = 1.4;
  for (const r of world.rocks) {
    c.save();
    c.translate(r.x, r.y);
    c.rotate(r.angle);
    c.beginPath();
    const radius = SIZE_RADIUS[r.size];
    r.shape.forEach((mult, i) => {
      const a = (i / r.shape.length) * Math.PI * 2;
      const px = Math.cos(a) * radius * mult;
      const py = Math.sin(a) * radius * mult;
      if (i === 0) c.moveTo(px, py);
      else c.lineTo(px, py);
    });
    c.closePath();
    c.stroke();
    c.restore();
  }

  c.fillStyle = '#ffd21e';
  for (const b of world.bullets) c.fillRect(b.x - 1, b.y - 1, 2.5, 2.5);
  for (const d of world.debris) {
    c.globalAlpha = Math.max(0, d.life / 0.4);
    c.fillStyle = '#ff9a1e';
    c.fillRect(d.x, d.y, 2, 2);
  }
  c.globalAlpha = 1;

  const ship = world.ship;
  const blink = world.invulnerable > 0 && Math.floor(world.invulnerable * 12) % 2 === 0;
  if (!blink) {
    c.save();
    c.translate(ship.x, ship.y);
    c.rotate(ship.angle + Math.PI / 2);
    if (thrusting) {
      c.fillStyle = '#ff9a1e';
      c.beginPath();
      c.moveTo(-4, 10);
      c.lineTo(0, 10 + 6 + Math.random() * 5);
      c.lineTo(4, 10);
      c.closePath();
      c.fill();
    }
    c.strokeStyle = color;
    c.lineWidth = 1.6;
    c.beginPath();
    c.moveTo(0, -14);
    c.lineTo(9, 10);
    c.lineTo(-9, 10);
    c.closePath();
    c.stroke();
    c.restore();
    drawSprite(c, sprite, ship.x, ship.y + 1, 13);
  }
}
