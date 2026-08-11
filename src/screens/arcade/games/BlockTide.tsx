/**
 * Block Tide — the falling-block game.
 *
 * All the rules live in `lib/arcade/engines/tetris.ts`; this file is the
 * canvas, the controls and the speed curve. Tap to rotate, swipe to move,
 * swipe down to hard drop — which is the control scheme that survives on a
 * phone, where a soft-drop button never gets pressed at the right moment.
 */

import { useEffect, useRef } from 'react';
import { useGameCanvas, useRafLoop, toLogical } from '../../../lib/arcade/loop';
import { useDirectionKeys } from '../../../lib/arcade/input';
import { rngFromString } from '../../../lib/arcade/rng';
import { sfx, sweep } from '../../../lib/arcade/sound';
import { hueColor } from '../../../lib/arcade/catalog';
import { useMySprite, drawSprite } from '../../../lib/arcade/sprites';
import {
  COLS,
  ROWS,
  PIECE_COLORS,
  clearLines,
  collides,
  dropIntervalMs,
  emptyGrid,
  hardDropY,
  levelFor,
  lineScore,
  merge,
  newBag,
  spawn,
  tryRotate,
  type Grid,
  type Piece,
} from '../../../lib/arcade/engines/tetris';
import { Screen, Controls } from '../shared';
import { ActionButton, DPad } from '../../../ui/arcade/DPad';
import type { GameProps } from '../shared';

const CELL = 14;
const PAD = 3;
const W = COLS * CELL + PAD * 2;
const H = ROWS * CELL + PAD * 2 + 22;

interface World {
  grid: Grid;
  piece: Piece;
  bag: number[];
  next: number;
  lines: number;
  level: number;
  dropAcc: number;
  clearFlash: { rows: number[]; t: number } | null;
}

export default function BlockTide({ run }: GameProps) {
  const { ref: canvasRef, ctx } = useGameCanvas(W, H);
  const { ref: sprite } = useMySprite(28);
  const worldRef = useRef<World | null>(null);
  const rngRef = useRef(rngFromString(`block-${run.nonce}`));
  const touchRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const color = hueColor(run.game.hue);

  if (!worldRef.current) {
    const bag = newBag(rngRef.current);
    worldRef.current = {
      grid: emptyGrid(),
      piece: spawn(bag.pop()!),
      bag,
      next: bag[bag.length - 1] ?? 1,
      lines: 0,
      level: 0,
      dropAcc: 0,
      clearFlash: null,
    };
  }

  useEffect(() => {
    run.setStatus('Level 1');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const nextPiece = (world: World) => {
    if (!world.bag.length) world.bag = newBag(rngRef.current);
    const kind = world.bag.pop()!;
    world.next = world.bag[world.bag.length - 1] ?? kind;
    return spawn(kind);
  };

  const lockPiece = (world: World) => {
    merge(world.grid, world.piece);
    const { grid, cleared, rows } = clearLines(world.grid);
    world.grid = grid;
    if (cleared > 0) {
      world.lines += cleared;
      const nextLevel = levelFor(world.lines);
      run.addScore(lineScore(cleared, world.level));
      world.clearFlash = { rows, t: 0.18 };
      if (nextLevel > world.level) {
        world.level = nextLevel;
        run.setStatus(`Level ${nextLevel + 1}`);
        sfx.levelUp();
      } else {
        sfx.right();
      }
    } else {
      sfx.bounce();
    }

    const piece = nextPiece(world);
    // Spawning into the stack is the top-out. Checked before the piece is
    // ever drawn, so the last frame shows the board that killed you.
    if (collides(world.grid, piece)) {
      world.piece = piece;
      run.end();
      return;
    }
    world.piece = piece;
  };

  const move = (dx: number) => {
    const world = worldRef.current;
    if (!world || run.phase !== 'playing') return;
    if (!collides(world.grid, world.piece, dx, 0)) {
      world.piece = { ...world.piece, x: world.piece.x + dx };
      sfx.blip();
    }
  };

  const rotate = () => {
    const world = worldRef.current;
    if (!world || run.phase !== 'playing') return;
    world.piece = tryRotate(world.grid, world.piece);
    sfx.select();
  };

  const softDrop = () => {
    const world = worldRef.current;
    if (!world || run.phase !== 'playing') return;
    if (!collides(world.grid, world.piece, 0, 1)) {
      world.piece = { ...world.piece, y: world.piece.y + 1 };
      run.addScore(1);
    } else {
      lockPiece(world);
    }
  };

  const hardDrop = () => {
    const world = worldRef.current;
    if (!world || run.phase !== 'playing') return;
    const target = hardDropY(world.grid, world.piece);
    run.addScore(Math.max(0, target - world.piece.y) * 2);
    world.piece = { ...world.piece, y: target };
    sweep(520, 160, 110, 'triangle', 0.5);
    lockPiece(world);
  };

  useDirectionKeys(
    (dir) => {
      if (dir === 'left') move(-1);
      else if (dir === 'right') move(1);
      else if (dir === 'down') softDrop();
      else rotate();
    },
    hardDrop,
    run.phase === 'playing',
  );

  useRafLoop((dt) => {
    const world = worldRef.current;
    const c = ctx();
    if (!world || !c) return;

    world.dropAcc += dt * 1000;
    const interval = dropIntervalMs(world.level);
    while (world.dropAcc >= interval) {
      world.dropAcc -= interval;
      if (!collides(world.grid, world.piece, 0, 1)) {
        world.piece = { ...world.piece, y: world.piece.y + 1 };
      } else {
        lockPiece(world);
        break;
      }
    }

    if (world.clearFlash) {
      world.clearFlash.t -= dt;
      if (world.clearFlash.t <= 0) world.clearFlash = null;
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
          const p = toLogical(canvasRef.current, e.clientX, e.clientY, W, H);
          touchRef.current = { x: p.x, y: p.y, moved: false };
        }}
        onPointerMove={(e) => {
          const start = touchRef.current;
          if (!start) return;
          const p = toLogical(canvasRef.current, e.clientX, e.clientY, W, H);
          const dx = p.x - start.x;
          const dy = p.y - start.y;
          // One cell per CELL of travel, so a long drag slides several columns
          // rather than one — matching what the finger actually did.
          if (Math.abs(dx) >= CELL && Math.abs(dx) > Math.abs(dy)) {
            move(Math.sign(dx));
            start.x += Math.sign(dx) * CELL;
            start.moved = true;
          } else if (dy >= CELL * 1.6) {
            hardDrop();
            touchRef.current = null;
          }
        }}
        onPointerUp={() => {
          if (touchRef.current && !touchRef.current.moved) rotate();
          touchRef.current = null;
        }}
        onPointerCancel={() => {
          touchRef.current = null;
        }}
      />
      <Controls>
        <DPad
          axis="horizontal"
          color={color}
          onPress={(dir) => move(dir === 'left' ? -1 : 1)}
        />
        {/* Side by side, not stacked: every row of controls is a row the well
            doesn't get, and the well is the game. */}
        <div className="flex gap-2">
          <ActionButton label="Rot" color="var(--neon-gold)" onPress={rotate} />
          <ActionButton label="Drop" color="var(--neon-pink)" onPress={hardDrop} />
        </div>
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
  c.fillStyle = '#04010b';
  c.fillRect(0, 0, W, H);

  const top = 22;

  // Well grid.
  c.strokeStyle = 'rgba(255,255,255,0.05)';
  c.lineWidth = 1;
  for (let x = 0; x <= COLS; x++) {
    c.beginPath();
    c.moveTo(PAD + x * CELL + 0.5, top);
    c.lineTo(PAD + x * CELL + 0.5, top + ROWS * CELL);
    c.stroke();
  }
  for (let y = 0; y <= ROWS; y++) {
    c.beginPath();
    c.moveTo(PAD, top + y * CELL + 0.5);
    c.lineTo(PAD + COLS * CELL, top + y * CELL + 0.5);
    c.stroke();
  }

  const cell = (gx: number, gy: number, fill: string, alpha = 1) => {
    if (gy < 0) return;
    c.globalAlpha = alpha;
    c.fillStyle = fill;
    c.fillRect(PAD + gx * CELL + 1, top + gy * CELL + 1, CELL - 2, CELL - 2);
    c.globalAlpha = alpha * 0.4;
    c.fillStyle = '#ffffff';
    c.fillRect(PAD + gx * CELL + 1, top + gy * CELL + 1, CELL - 2, 2);
    c.globalAlpha = 1;
  };

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      if (world.grid[y][x]) cell(x, y, PIECE_COLORS[world.grid[y][x]]);
    }
  }

  // Ghost outline where the piece would land.
  const ghostY = hardDropY(world.grid, world.piece);
  for (let y = 0; y < world.piece.shape.length; y++) {
    for (let x = 0; x < world.piece.shape[y].length; x++) {
      if (world.piece.shape[y][x]) {
        cell(world.piece.x + x, ghostY + y, PIECE_COLORS[world.piece.kind], 0.16);
      }
    }
  }

  for (let y = 0; y < world.piece.shape.length; y++) {
    for (let x = 0; x < world.piece.shape[y].length; x++) {
      if (world.piece.shape[y][x]) {
        cell(world.piece.x + x, world.piece.y + y, PIECE_COLORS[world.piece.kind]);
      }
    }
  }

  if (world.clearFlash) {
    c.fillStyle = 'rgba(255,255,255,0.75)';
    for (const row of world.clearFlash.rows) {
      c.fillRect(PAD, top + row * CELL, COLS * CELL, CELL);
    }
  }

  // Header: next piece, lines, and the avatar watching over the well.
  c.fillStyle = 'rgba(255,255,255,0.06)';
  c.fillRect(0, 0, W, top - 2);
  c.font = '7px ui-monospace, monospace';
  c.textAlign = 'left';
  c.fillStyle = color;
  c.fillText(`LINES ${world.lines}`, 4, 13);

  c.textAlign = 'right';
  c.fillStyle = 'rgba(255,255,255,0.55)';
  c.fillText('NEXT', W - 34, 13);
  const nextShape = spawn(world.next).shape;
  for (let y = 0; y < nextShape.length; y++) {
    for (let x = 0; x < nextShape[y].length; x++) {
      if (!nextShape[y][x]) continue;
      c.fillStyle = PIECE_COLORS[world.next];
      c.fillRect(W - 30 + x * 5, 4 + y * 5, 4, 4);
    }
  }
  drawSprite(c, sprite, W - 8, 11, 14);
}
