/**
 * Input, for a game that has to work on a phone *and* on the laptop it gets
 * demoed from.
 *
 * Held-key state lives in a ref, not React state: a game reads "is left down"
 * once per frame, and routing that through a re-render would cost sixty
 * renders a second for information nothing else on the page wants.
 */

import { useEffect, useRef } from 'react';

export type Dir = 'up' | 'down' | 'left' | 'right';

const KEY_DIR: Record<string, Dir> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  w: 'up',
  s: 'down',
  a: 'left',
  d: 'right',
  W: 'up',
  S: 'down',
  A: 'left',
  D: 'right',
};

export interface HeldKeys {
  current: { up: boolean; down: boolean; left: boolean; right: boolean; fire: boolean };
}

/**
 * Keyboard + on-screen d-pad state in one object.
 *
 * The returned `press`/`release` are what the touch controls call, so a game
 * only ever reads one source of truth regardless of how it's being played.
 */
export function useHeldKeys(active: boolean): {
  held: HeldKeys;
  press: (k: Dir | 'fire') => void;
  release: (k: Dir | 'fire') => void;
  releaseAll: () => void;
} {
  const held = useRef({ up: false, down: false, left: false, right: false, fire: false });

  useEffect(() => {
    if (!active) return;
    const down = (e: KeyboardEvent) => {
      const dir = KEY_DIR[e.key];
      if (dir) {
        held.current[dir] = true;
        e.preventDefault();
      } else if (e.key === ' ') {
        held.current.fire = true;
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      const dir = KEY_DIR[e.key];
      if (dir) held.current[dir] = false;
      else if (e.key === ' ') held.current.fire = false;
    };
    // Keys held when the window loses focus never report their keyup, and the
    // player comes back to a ship stuck at full left.
    const blur = () => {
      held.current = { up: false, down: false, left: false, right: false, fire: false };
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      blur();
    };
  }, [active]);

  return {
    held,
    press: (k) => {
      held.current[k] = true;
    },
    release: (k) => {
      held.current[k] = false;
    },
    releaseAll: () => {
      held.current = { up: false, down: false, left: false, right: false, fire: false };
    },
  };
}

/**
 * Discrete direction presses — for grid games, where holding left doesn't
 * mean "keep going left forever", it means "turn left, once".
 */
export function useDirectionKeys(
  onDir: (dir: Dir) => void,
  onFire: (() => void) | undefined,
  active: boolean,
): void {
  const onDirRef = useRef(onDir);
  const onFireRef = useRef(onFire);
  onDirRef.current = onDir;
  onFireRef.current = onFire;

  useEffect(() => {
    if (!active) return;
    const down = (e: KeyboardEvent) => {
      const dir = KEY_DIR[e.key];
      if (dir) {
        e.preventDefault();
        onDirRef.current(dir);
      } else if (e.key === ' ' && onFireRef.current) {
        e.preventDefault();
        onFireRef.current();
      }
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, [active]);
}

/**
 * Swipe detection on a element. Returns props to spread.
 *
 * `touch-action: none` on the target is what stops a swipe from scrolling the
 * page out from under the game; the games set it via Tailwind's `touch-none`.
 */
export function swipeHandlers(onDir: (dir: Dir) => void, threshold = 24) {
  let startX = 0;
  let startY = 0;
  let tracking = false;
  return {
    onPointerDown: (e: React.PointerEvent) => {
      startX = e.clientX;
      startY = e.clientY;
      tracking = true;
    },
    onPointerUp: (e: React.PointerEvent) => {
      if (!tracking) return;
      tracking = false;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.abs(dx) < threshold && Math.abs(dy) < threshold) return;
      if (Math.abs(dx) > Math.abs(dy)) onDir(dx > 0 ? 'right' : 'left');
      else onDir(dy > 0 ? 'down' : 'up');
    },
    onPointerCancel: () => {
      tracking = false;
    },
  };
}
