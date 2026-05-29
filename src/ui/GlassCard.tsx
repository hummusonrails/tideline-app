import type { HTMLAttributes } from 'react';

export function GlassCard({
  className = '',
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={`glass rounded-[28px] p-5 ${className}`} {...rest}>
      {children}
    </div>
  );
}
