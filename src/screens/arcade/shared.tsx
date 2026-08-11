/**
 * The handful of pieces every game screen wants, so twenty files don't each
 * reinvent a canvas element and a row of buttons.
 */

import type { ReactNode } from 'react';
import type { ArcadeRun } from '../../lib/arcade/run';
import type { ArcadeContent } from '../../lib/arcade/content';

/** Every game in the lineup takes exactly this. */
export interface GameProps {
  run: ArcadeRun;
  content: ArcadeContent;
}

/**
 * A canvas at a fixed logical resolution, stretched to the panel width.
 *
 * `touch-none` matters as much as anything visual here: without it, a swipe
 * meant for the game scrolls the page instead, which is the single most
 * common way a browser game feels broken on a phone.
 */
export function Screen({
  canvasRef,
  width,
  height,
  className = '',
  ...pointer
}: {
  canvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  width: number;
  height: number;
  className?: string;
} & React.HTMLAttributes<HTMLCanvasElement>) {
  return (
    <canvas
      ref={canvasRef}
      className={`pixelated block w-full touch-none select-none ${className}`}
      style={{ aspectRatio: `${width} / ${height}`, background: '#04010b' }}
      {...pointer}
    />
  );
}

/** The strip of controls under a play field. */
export function Controls({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`flex items-center justify-between gap-3 border-t px-3 py-3 ${className}`}
      style={{ borderColor: 'var(--cab-line)' }}
    >
      {children}
    </div>
  );
}

/** A DOM play field (grids, cards, quizzes) with consistent padding. */
export function Board({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`p-3 ${className}`}>{children}</div>;
}

/** Common HUD line for DOM games: lives, timer, whatever the game tracks. */
export function StatusRow({ left, right }: { left: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2 text-[10px] uppercase tracking-wider">
      <span style={{ color: 'var(--cab-dim)' }}>{left}</span>
      {right && <span style={{ color: 'var(--neon-gold)' }}>{right}</span>}
    </div>
  );
}
