import type { ReactNode } from 'react';
import { CloudUpload, Cloud, Ship } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { Avatar } from './Avatar';
import { db } from '../lib/db';
import { useNetState } from '../lib/net';
import { useEggAnchor } from '../lib/eggRuntime';

interface PageProps {
  title?: string;
  eyebrow?: string;
  avatarSeed?: string;
  avatarDisplayName?: string;
  avatarSrc?: string;
  showBell?: boolean;
  children: ReactNode;
}

export function Page({
  title,
  eyebrow,
  avatarSeed,
  avatarDisplayName,
  avatarSrc,
  showBell = true,
  children,
}: PageProps) {
  const navigate = useNavigate();
  const pending = useLiveQuery(() => db.outbox.count()) ?? 0;
  const atSea = useNetState((s) => s.state) === 'no-internet';
  // Both header controls double as egg anchors. Their real behaviour is
  // untouched: the tap counter runs alongside the navigation, not instead of
  // it, so nobody has to choose between the joke and the button.
  const avatarEgg = useEggAnchor('header-avatar');
  const chipEgg = useEggAnchor('sea-chip');
  return (
    <div className="pt-[max(env(safe-area-inset-top),1rem)] px-4">
      <header className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          {avatarSeed && (
            <button
              type="button"
              {...avatarEgg}
              onClick={() => { avatarEgg.onClick(); navigate('/profile'); }}
              className="rounded-full active:scale-95 transition"
              aria-label="Your profile"
            >
              <Avatar seed={avatarSeed} displayName={avatarDisplayName} src={avatarSrc} size={40} />
            </button>
          )}
          <div>
            {eyebrow && <div className="text-xs uppercase tracking-wider text-ink-600 font-medium">{eyebrow}</div>}
            {title && <h1 className="font-display text-2xl font-semibold leading-tight">{title}</h1>}
          </div>
        </div>
        {showBell && (
          <button
            type="button"
            {...chipEgg}
            // At sea, retrying is pointless and the useful action is to go
            // sync with someone face to face.
            onClick={() => {
              chipEgg.onClick();
              if (atSea) navigate('/devices');
              else window.dispatchEvent(new CustomEvent('tideline:outbox-enqueued'));
            }}
            className="relative grid h-10 w-10 place-items-center rounded-full glass"
            aria-label={syncChipLabel(atSea, pending)}
            title={syncChipLabel(atSea, pending)}
          >
            {atSea ? (
              <Ship size={18} strokeWidth={1.75} className="text-ocean" />
            ) : pending > 0 ? (
              <CloudUpload size={18} strokeWidth={1.75} />
            ) : (
              <Cloud size={18} strokeWidth={1.75} />
            )}
            {pending > 0 && (
              <span className="absolute -top-1 -right-1 grid h-5 min-w-5 place-items-center rounded-full bg-coral px-1 text-[10px] font-semibold text-white ring-2 ring-sage-50">
                {pending > 9 ? '9+' : pending}
              </span>
            )}
          </button>
        )}
      </header>
      <main className="space-y-5">{children}</main>
    </div>
  );
}

function syncChipLabel(atSea: boolean, pending: number): string {
  if (atSea) {
    return pending > 0
      ? `Sea mode — ${pending} saved on this phone. Tap to sync with the family.`
      : 'Sea mode — tap to sync with the family';
  }
  return pending > 0 ? `${pending} items waiting to sync — tap to retry` : 'All synced';
}
