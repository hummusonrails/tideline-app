import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { sfx } from '../../lib/arcade/sound';

interface ArcadeButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Any CSS colour. The glow, border and fill all derive from it. */
  color?: string;
  icon?: ReactNode;
  block?: boolean;
  /** Suppress the click bleep — for controls that make their own noise. */
  silent?: boolean;
}

/**
 * The chunky cabinet button.
 *
 * The colour drives everything through `currentColor`, so one prop styles the
 * border, the glow and the fill together (see `.arcade-btn` in arcade.css).
 */
export function ArcadeButton({
  color = 'var(--neon-cyan)',
  icon,
  block = false,
  silent = false,
  className = '',
  onClick,
  children,
  ...rest
}: ArcadeButtonProps) {
  return (
    <button
      type="button"
      style={{ color }}
      className={`arcade-btn inline-flex items-center justify-center gap-2 text-xs font-bold ${
        block ? 'w-full' : ''
      } ${className}`}
      onClick={(e) => {
        if (!silent) sfx.select();
        onClick?.(e);
      }}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}
