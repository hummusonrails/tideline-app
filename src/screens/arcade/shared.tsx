/**
 * The handful of pieces every game screen wants, so twenty files don't each
 * reinvent a canvas element and a row of buttons.
 *
 * The theme running through all of it is fitting: a game screen is a fixed box
 * handed down by the shell, and everything here sizes itself *into* that box
 * rather than pushing it around. A play field that works out its own height
 * from its own width is how a board ends up half off the bottom of a phone.
 */

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { ArcadeRun } from '../../lib/arcade/run';
import type { ArcadeContent } from '../../lib/arcade/content';

/** Every game in the lineup takes exactly this. */
export interface GameProps {
  run: ArcadeRun;
  content: ArcadeContent;
}

/**
 * Largest `width × height` box that fits inside `container`, same ratio.
 * Floored, so a rounding error can never overflow by a pixel.
 */
function fitInside(
  container: { width: number; height: number },
  width: number,
  height: number,
): { w: number; h: number } {
  const scale = Math.min(container.width / width, container.height / height);
  return {
    w: Math.max(1, Math.floor(width * scale)),
    h: Math.max(1, Math.floor(height * scale)),
  };
}

/**
 * Watch an element's box. Used by both fitters below.
 *
 * A ResizeObserver rather than a window listener: what changes is the space
 * *left over* after the controls, which moves when a game swaps its control
 * row, when the phone's address bar collapses, and on rotation — none of which
 * a resize handler reliably sees.
 */
function useBoxSize(): [
  React.MutableRefObject<HTMLDivElement | null>,
  { width: number; height: number } | null,
] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState<{ width: number; height: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setBox((prev) =>
          prev && Math.abs(prev.width - rect.width) < 1 && Math.abs(prev.height - rect.height) < 1
            ? prev
            : { width: rect.width, height: rect.height },
        );
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, box];
}

/**
 * A canvas at a fixed logical resolution, scaled to fit whatever room is left.
 *
 * The size is computed and set in pixels rather than left to CSS. `object-fit`
 * would letterbox the bitmap inside a larger element box, and every canvas
 * game maps touches through `getBoundingClientRect` — so the element box and
 * the painted box have to be the same box, or every tap lands slightly wrong.
 *
 * `touch-none` matters as much as anything visual here: without it, a swipe
 * meant for the game scrolls the page instead, which is the single most common
 * way a browser game feels broken on a phone.
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
  const [boxRef, box] = useBoxSize();
  const size = box ? fitInside(box, width, height) : null;

  return (
    <div ref={boxRef} className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
      <canvas
        ref={canvasRef}
        className={`pixelated block touch-none select-none ${className}`}
        style={
          size
            ? { width: size.w, height: size.h, background: '#04010b' }
            : // One frame before the first measurement. Sized rather than
              // hidden so the observer has something to observe.
              { width: 1, height: 1, opacity: 0 }
        }
        {...pointer}
      />
    </div>
  );
}

/**
 * The DOM equivalent: a box of a given ratio, as big as will fit.
 *
 * For the grid games that are tapped or swiped rather than read — 2048, the
 * reef board, the memory cards. Those have to be wholly on screen, because
 * `touch-none` (which they need, so a swipe moves tiles instead of scrolling
 * the page) also means you can't scroll to the part you can't see.
 */
export function FitBox({
  ratio,
  children,
  className = '',
}: {
  /** width ÷ height of the content. 1 for a square grid. */
  ratio: number;
  children: ReactNode;
  className?: string;
}) {
  const [boxRef, box] = useBoxSize();
  const size = box ? fitInside(box, ratio * 1000, 1000) : null;

  return (
    <div ref={boxRef} className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
      <div
        className={className}
        style={size ? { width: size.w, height: size.h } : { width: '100%', opacity: 0 }}
      >
        {children}
      </div>
    </div>
  );
}

/** The strip of controls under a play field. Never shrinks. */
export function Controls({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`flex shrink-0 items-center justify-between gap-3 border-t px-3 py-2.5 ${className}`}
      style={{ borderColor: 'var(--cab-line)' }}
    >
      {children}
    </div>
  );
}

/**
 * A DOM play field.
 *
 * Scrolls when its content genuinely doesn't fit — a long quiz option on a
 * small phone — which is fine for the games that are read and tapped. The ones
 * that are swiped use {@link FitBox} instead and never scroll.
 */
export function Board({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`scroll-clean flex min-h-0 flex-1 flex-col overflow-y-auto p-3 ${className}`}>
      {children}
    </div>
  );
}

/** Common HUD line for DOM games: lives, timer, whatever the game tracks. */
export function StatusRow({ left, right }: { left: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex shrink-0 items-center justify-between gap-2 text-[10px] uppercase tracking-wider">
      <span style={{ color: 'var(--cab-dim)' }}>{left}</span>
      {right && <span style={{ color: 'var(--neon-gold)' }}>{right}</span>}
    </div>
  );
}
