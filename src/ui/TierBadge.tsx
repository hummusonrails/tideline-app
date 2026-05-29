import type { Tier } from '../types';

const styles: Record<Tier, { label: string; cls: string }> = {
  none:     { label: 'Just starting',  cls: 'bg-ink-200 text-ink-700' },
  bronze:   { label: 'Bronze',         cls: 'bg-tier-bronze/15 text-tier-bronze ring-tier-bronze/30' },
  silver:   { label: 'Silver',         cls: 'bg-tier-silver/20 text-ink-700 ring-tier-silver/40' },
  gold:     { label: 'Gold',           cls: 'bg-tier-gold/20 text-[#7a5e0d] ring-tier-gold/50' },
  platinum: { label: 'Platinum',       cls: 'bg-tier-platinum/20 text-tier-platinum ring-tier-platinum/50' },
};

export function TierBadge({ tier, label }: { tier: Tier; label?: string }) {
  const s = styles[tier];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${s.cls}`}
    >
      {label ?? s.label}
    </span>
  );
}
