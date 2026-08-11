/**
 * Frame loops and canvas plumbing shared by every arcade game.
 *
 * The one rule that keeps twenty games from melting an older phone: nothing
 * that runs per-frame goes through React state. Games keep their world in
 * refs, draw to a canvas (or mutate a small amount of DOM), and only push to
 * React when something a human would notice changes — a score, a life, a
 * game over.
 */

import { useEffect, useLayoutEffect, useRef } from 'react';

/**
 * requestAnimationFrame loop that pauses cleanly.
 *
 * `dt` is capped: coming back from a backgrounded tab hands you a delta of
 * several seconds, and a physics step that large tunnels straight through
 * every wall in the game.
 */
export function useRafLoop(
  fn: (dtSeconds: number, elapsedSeconds: number) => void,
  active: boolean,
): void {
  const fnRef = useRef(fn);
  // Keep the callback fresh without restarting the loop — re-subscribing every
  // render would drop a frame each time and reset `elapsed`.
  useLayoutEffect(() => {
    fnRef.current = fn;
  });

  useEffect(() => {
    if (!active) return;
    let raf = 0;
    let last = performance.now();
    let elapsed = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      elapsed += dt;
      fnRef.current(dt, elapsed);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active]);
}

/** A countdown in whole seconds, for timed games. Fires `onEnd` once at zero. */
export function useCountdown(
  seconds: number,
  active: boolean,
  onTick: (remaining: number) => void,
  onEnd: () => void,
): void {
  const onTickRef = useRef(onTick);
  const onEndRef = useRef(onEnd);
  useLayoutEffect(() => {
    onTickRef.current = onTick;
    onEndRef.current = onEnd;
  });

  useEffect(() => {
    if (!active) return;
    let remaining = seconds;
    onTickRef.current(remaining);
    const id = window.setInterval(() => {
      remaining -= 1;
      onTickRef.current(Math.max(0, remaining));
      if (remaining <= 0) {
        window.clearInterval(id);
        onEndRef.current();
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [seconds, active]);
}

/**
 * Sets a canvas up at a fixed logical resolution and hands back its 2D
 * context.
 *
 * Fixed low resolution, scaled up by CSS, is doing real work: it makes every
 * game look identical on every phone, removes all devicePixelRatio maths from
 * twenty separate files, and gives the chunky pixels the whole section is
 * going for (`.pixelated` in arcade.css does the rest).
 */
export function useGameCanvas(
  width: number,
  height: number,
): {
  ref: React.MutableRefObject<HTMLCanvasElement | null>;
  ctx: () => CanvasRenderingContext2D | null;
} {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);

  useLayoutEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    const c = canvas.getContext('2d');
    if (c) c.imageSmoothingEnabled = false;
    ctxRef.current = c;
  }, [width, height]);

  return { ref, ctx: () => ctxRef.current };
}

/**
 * Pointer position in a canvas's own coordinates.
 *
 * Every canvas game is a fixed logical resolution stretched by CSS, so a
 * touch at 210px across a 390px-wide element has to be scaled back down
 * before the game can use it. Getting this wrong is invisible on the machine
 * it was written on and badly wrong on every other screen size.
 */
export function toLogical(
  canvas: HTMLCanvasElement | null,
  clientX: number,
  clientY: number,
  width: number,
  height: number,
): { x: number; y: number } {
  if (!canvas) return { x: 0, y: 0 };
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return { x: 0, y: 0 };
  return {
    x: ((clientX - rect.left) / rect.width) * width,
    y: ((clientY - rect.top) / rect.height) * height,
  };
}
