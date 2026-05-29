import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface PillButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: ReactNode;
  active?: boolean;
  variant?: 'glass' | 'solid';
}

export function PillButton({
  icon,
  active = false,
  variant = 'glass',
  className = '',
  children,
  ...rest
}: PillButtonProps) {
  const base =
    'inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium transition active:scale-[0.97]';
  const styles = active
    ? 'bg-white text-ink-900 shadow-[var(--shadow-pill)]'
    : variant === 'solid'
    ? 'bg-ink-900 text-white shadow-[var(--shadow-pill)]'
    : 'glass text-ink-700';
  return (
    <button className={`${base} ${styles} ${className}`} {...rest}>
      {icon && <span className="grid place-items-center">{icon}</span>}
      {children}
    </button>
  );
}
