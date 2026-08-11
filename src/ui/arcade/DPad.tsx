/**
 * Touch controls.
 *
 * Two modes, because the games split cleanly in two: grid games want a
 * *press* ("turn left, once") and driving games want a *hold* ("keep going
 * left"). One component covers both so the controls sit in the same place,
 * at the same size, on every cabinet — muscle memory across twenty games is
 * worth more than a bespoke layout for each.
 *
 * Pointer events throughout, with capture, so a thumb that slides off a
 * button still releases it. `touch-none` on every control is what stops the
 * page scrolling under a game.
 */

import type { ReactNode } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from 'lucide-react';
import type { Dir } from '../../lib/arcade/input';

interface DPadProps {
  onPress: (dir: Dir) => void;
  onRelease?: (dir: Dir) => void;
  color?: string;
  /** Hide the up/down keys for games that only move on one axis. */
  axis?: 'both' | 'horizontal' | 'vertical';
  className?: string;
}

export function DPad({
  onPress,
  onRelease,
  color = 'var(--neon-cyan)',
  axis = 'both',
  className = '',
}: DPadProps) {
  const key = (dir: Dir, label: string, icon: ReactNode, area: string) => (
    <button
      type="button"
      aria-label={label}
      style={{ color, gridArea: area }}
      className="arcade-btn touch-none grid h-14 w-14 place-items-center p-0"
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        onPress(dir);
      }}
      onPointerUp={() => onRelease?.(dir)}
      onPointerCancel={() => onRelease?.(dir)}
      onPointerLeave={() => onRelease?.(dir)}
      onContextMenu={(e) => e.preventDefault()}
    >
      {icon}
    </button>
  );

  return (
    <div
      className={`grid gap-1.5 ${className}`}
      style={{
        gridTemplateAreas: `". up ." "left . right" ". down ."`,
        gridTemplateColumns: 'repeat(3, auto)',
      }}
    >
      {axis !== 'horizontal' && key('up', 'Up', <ChevronUp size={22} />, 'up')}
      {axis !== 'vertical' && key('left', 'Left', <ChevronLeft size={22} />, 'left')}
      {axis !== 'vertical' && key('right', 'Right', <ChevronRight size={22} />, 'right')}
      {axis !== 'horizontal' && key('down', 'Down', <ChevronDown size={22} />, 'down')}
    </div>
  );
}

interface ActionButtonProps {
  label: string;
  onPress: () => void;
  onRelease?: () => void;
  color?: string;
  className?: string;
}

/** The big red one. Fire, thrust, flap, drop. */
export function ActionButton({
  label,
  onPress,
  onRelease,
  color = 'var(--neon-pink)',
  className = '',
}: ActionButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      style={{ color }}
      className={`arcade-btn touch-none grid h-16 w-16 place-items-center rounded-full p-0 text-[10px] font-bold tracking-widest ${className}`}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        onPress();
      }}
      onPointerUp={() => onRelease?.()}
      onPointerCancel={() => onRelease?.()}
      onPointerLeave={() => onRelease?.()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {label}
    </button>
  );
}
