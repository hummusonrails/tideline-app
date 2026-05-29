import type { ReactNode } from 'react';

interface HeroCardProps {
  image?: string;
  alt: string;
  eyebrow?: ReactNode;
  title: string;
  subtitle?: string;
  topRight?: ReactNode;
  bottomRight?: ReactNode;
  onClick?: () => void;
  height?: 'tall' | 'short' | 'auto';
  className?: string;
}

export function HeroCard({
  image,
  alt,
  eyebrow,
  title,
  subtitle,
  topRight,
  bottomRight,
  onClick,
  height = 'tall',
  className = '',
}: HeroCardProps) {
  const heightClass =
    height === 'tall' ? 'h-[420px]' : height === 'short' ? 'h-[220px]' : '';

  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative w-full overflow-hidden rounded-[28px] text-left ${heightClass} ${className}`}
    >
      {image ? (
        <img
          src={image}
          alt={alt}
          className="absolute inset-0 h-full w-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-sage-300 to-sage-700" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/65 via-black/15 to-black/10" />
      {eyebrow && (
        <div className="absolute left-4 top-4 glass rounded-full px-3 py-1 text-xs font-medium text-ink-900">
          {eyebrow}
        </div>
      )}
      {topRight && <div className="absolute right-4 top-4">{topRight}</div>}
      <div className="absolute bottom-5 left-5 right-5">
        <h2 className="text-white drop-shadow-lg font-display text-[34px] leading-[1.05] font-semibold tracking-tight">
          {title}
        </h2>
        {subtitle && (
          <p className="mt-2 text-white/90 text-sm leading-snug max-w-[80%]">
            {subtitle}
          </p>
        )}
      </div>
      {bottomRight && <div className="absolute bottom-5 right-5">{bottomRight}</div>}
    </button>
  );
}
