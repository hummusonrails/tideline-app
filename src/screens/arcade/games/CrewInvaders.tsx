/**
 * Crew Invaders.
 *
 * The 1978 shape, unchanged: a formation that steps sideways, drops when it
 * touches a wall, and speeds up as you thin it out. Your ship is your crew
 * avatar; the ranks above are labelled with stops from the trip, so clearing
 * a wave reads as working your way down the itinerary.
 *
 * World state lives in one ref and is mutated in place — twenty-odd bullets
 * and thirty invaders per frame is nothing for a canvas and everything for
 * React's reconciler.
 */

import { useEffect, useRef } from 'react';
import { useGameCanvas, useRafLoop, toLogical } from '../../../lib/arcade/loop';
import { useHeldKeys } from '../../../lib/arcade/input';
import { useMySprite, drawSprite } from '../../../lib/arcade/sprites';
import { sfx } from '../../../lib/arcade/sound';
import { hueColor } from '../../../lib/arcade/catalog';
import { Screen, Controls } from '../shared';
import { ActionButton } from '../../../ui/arcade/DPad';
import { LivesRow } from '../../../ui/arcade/GameShell';
import type { GameProps } from '../shared';

const W = 240;
const H = 320;
const COLS = 6;
const ROWS = 4;
const SHIP_Y = H - 26;

interface Invader {
  x: number;
  y: number;
  row: number;
  alive: boolean;
}

interface Shot {
  x: number;
  y: number;
  vy: number;
}

interface World {
  shipX: number;
  invaders: Invader[];
  dir: number;
  stepTimer: number;
  shots: Shot[];
  bombs: Shot[];
  wave: number;
  cooldown: number;
  flash: number;
  invulnerable: number;
}

const RANK_COLOR = ['#ff2f5e', '#ffd21e', '#7cff4d', '#21e6ff'];

export default function CrewInvaders({ run, content }: GameProps) {
  const { ref: canvasRef, ctx } = useGameCanvas(W, H);
  const { held, press, release } = useHeldKeys(run.phase === 'playing');
  const { ref: sprite } = useMySprite(40);
  const worldRef = useRef<World | null>(null);
  const dragRef = useRef<number | null>(null);
  const color = hueColor(run.game.hue);
  const labels = content.labels.slice(0, ROWS);

  if (!worldRef.current) worldRef.current = makeWorld(1);

  useEffect(() => {
    run.setLives(3);
    run.setStatus('Wave 1');
    // Lives and the wave banner belong to the run, and are set once per mount
    // — the shell remounts this component for every new game.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useRafLoop((dt) => {
    const world = worldRef.current;
    const c = ctx();
    if (!world || !c) return;

    // ---- input ----
    const speed = 150 * dt;
    if (held.current.left) world.shipX -= speed;
    if (held.current.right) world.shipX += speed;
    if (dragRef.current !== null) world.shipX = dragRef.current;
    world.shipX = Math.max(14, Math.min(W - 14, world.shipX));

    world.cooldown -= dt;
    if (held.current.fire && world.cooldown <= 0) {
      world.shots.push({ x: world.shipX, y: SHIP_Y - 10, vy: -260 });
      world.cooldown = 0.32;
      sfx.laser();
    }

    // ---- formation ----
    const alive = world.invaders.filter((i) => i.alive);
    // Classic difficulty curve: the fewer left, the faster they march.
    const stepInterval = Math.max(0.09, (0.62 - world.wave * 0.05) * (alive.length / (COLS * ROWS)) + 0.08);
    world.stepTimer -= dt;
    if (world.stepTimer <= 0) {
      world.stepTimer = stepInterval;
      const minX = Math.min(...alive.map((i) => i.x), W);
      const maxX = Math.max(...alive.map((i) => i.x), 0);
      if ((world.dir > 0 && maxX > W - 22) || (world.dir < 0 && minX < 22)) {
        world.dir *= -1;
        for (const inv of world.invaders) inv.y += 12;
      } else {
        for (const inv of world.invaders) inv.x += world.dir * 7;
      }
      sfx.tick();

      // Someone in the bottom row of each column takes a shot.
      if (alive.length && Math.random() < 0.55) {
        const shooter = alive[Math.floor(Math.random() * alive.length)];
        world.bombs.push({ x: shooter.x, y: shooter.y + 8, vy: 90 + world.wave * 14 });
      }
    }

    // ---- projectiles ----
    for (const s of world.shots) s.y += s.vy * dt;
    for (const b of world.bombs) b.y += b.vy * dt;
    world.shots = world.shots.filter((s) => s.y > -8);
    world.bombs = world.bombs.filter((b) => b.y < H + 8);

    for (const shot of world.shots) {
      for (const inv of world.invaders) {
        if (!inv.alive) continue;
        if (Math.abs(inv.x - shot.x) < 10 && Math.abs(inv.y - shot.y) < 8) {
          inv.alive = false;
          shot.y = -100;
          run.addScore((ROWS - inv.row) * 10 + world.wave * 5);
          sfx.hit();
          break;
        }
      }
    }

    world.invulnerable = Math.max(0, world.invulnerable - dt);
    if (world.invulnerable === 0) {
      const hit = world.bombs.find(
        (b) => Math.abs(b.x - world.shipX) < 12 && b.y > SHIP_Y - 12 && b.y < SHIP_Y + 10,
      );
      const landed = world.invaders.some((i) => i.alive && i.y > SHIP_Y - 16);
      if (hit || landed) {
        world.bombs = [];
        world.flash = 0.35;
        world.invulnerable = 1.4;
        sfx.boom();
        if (run.loseLife() <= 0) {
          run.end();
          return;
        }
        if (landed) {
          // Being overrun resets the formation rather than instantly ending
          // the run — a life should always buy you another go.
          Object.assign(worldRef.current!, makeWorld(world.wave), {
            invulnerable: 1.4,
            flash: 0.35,
          });
        }
      }
    }

    // ---- wave cleared ----
    if (!world.invaders.some((i) => i.alive)) {
      const next = world.wave + 1;
      run.addScore(120 + next * 40);
      sfx.levelUp();
      Object.assign(world, makeWorld(next));
      run.setStatus(`Wave ${next}`);
    }

    world.flash = Math.max(0, world.flash - dt);
    draw(c, world, sprite.current, color, labels);
  }, run.phase === 'playing');

  const onPointer = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { x } = toLogical(canvasRef.current, e.clientX, e.clientY, W, H);
    dragRef.current = x;
  };

  return (
    <>
      <Screen
        canvasRef={canvasRef}
        width={W}
        height={H}
        onPointerDown={(e) => {
          (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
          onPointer(e);
        }}
        onPointerMove={(e) => {
          if (e.buttons > 0 || e.pointerType === 'touch') onPointer(e);
        }}
        onPointerUp={() => {
          dragRef.current = null;
        }}
        onPointerCancel={() => {
          dragRef.current = null;
        }}
      />
      <Controls>
        <LivesRow lives={run.lives} color={color} />
        <ActionButton
          label="Fire"
          color={color}
          onPress={() => press('fire')}
          onRelease={() => release('fire')}
        />
      </Controls>
    </>
  );
}

function makeWorld(wave: number): World {
  const invaders: Invader[] = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      invaders.push({ x: 34 + col * 34, y: 44 + row * 26, row, alive: true });
    }
  }
  return {
    shipX: W / 2,
    invaders,
    dir: 1,
    stepTimer: 0.5,
    shots: [],
    bombs: [],
    wave,
    cooldown: 0,
    flash: 0,
    invulnerable: 1,
  };
}

function draw(
  c: CanvasRenderingContext2D,
  world: World,
  sprite: { canvas: HTMLCanvasElement | null; hue: number; accent: string } | null,
  color: string,
  labels: string[],
) {
  c.fillStyle = world.flash > 0 ? '#2a0410' : '#04010b';
  c.fillRect(0, 0, W, H);

  // Starfield, deterministic from index so it doesn't shimmer.
  c.fillStyle = 'rgba(255,255,255,0.35)';
  for (let i = 0; i < 26; i++) {
    const x = (i * 71) % W;
    const y = (i * 143) % (H - 40);
    c.fillRect(x, y, 1, 1);
  }

  // Rank labels down the left, so the formation reads as trip stops.
  c.font = '6px ui-monospace, monospace';
  c.textAlign = 'left';
  labels.forEach((label, i) => {
    c.fillStyle = 'rgba(255,255,255,0.28)';
    c.fillText(label.toUpperCase().slice(0, 8), 3, 48 + i * 26);
  });

  for (const inv of world.invaders) {
    if (!inv.alive) continue;
    c.fillStyle = RANK_COLOR[inv.row % RANK_COLOR.length];
    // Two-row body plus legs — a silhouette, not a sprite sheet.
    c.fillRect(inv.x - 7, inv.y - 5, 14, 8);
    c.fillRect(inv.x - 9, inv.y - 2, 18, 3);
    c.fillRect(inv.x - 7, inv.y + 3, 4, 3);
    c.fillRect(inv.x + 3, inv.y + 3, 4, 3);
    c.fillStyle = '#04010b';
    c.fillRect(inv.x - 4, inv.y - 3, 2, 2);
    c.fillRect(inv.x + 2, inv.y - 3, 2, 2);
  }

  c.fillStyle = color;
  for (const s of world.shots) c.fillRect(s.x - 1, s.y - 5, 2, 7);
  c.fillStyle = '#ff8a8a';
  for (const b of world.bombs) c.fillRect(b.x - 1, b.y, 2, 6);

  // The ship: avatar in a hull, blinking while invulnerable.
  const blink = world.invulnerable > 0 && Math.floor(world.invulnerable * 12) % 2 === 0;
  if (!blink) {
    c.fillStyle = color;
    c.fillRect(world.shipX - 14, SHIP_Y + 6, 28, 4);
    c.fillRect(world.shipX - 2, SHIP_Y - 12, 4, 6);
    drawSprite(c, sprite, world.shipX, SHIP_Y, 20);
  }

  c.fillStyle = 'rgba(255,255,255,0.14)';
  c.fillRect(0, SHIP_Y + 12, W, 1);
}
