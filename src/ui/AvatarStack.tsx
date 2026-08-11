import { Avatar } from './Avatar';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../lib/db';
import type { MemberId } from '../types';

/**
 * A row of crew members, overlapped.
 *
 * Exists because "3 of 4 on deck" and "2 votes" are facts, while four little
 * faces are a *scoreboard* — you can see at a glance who showed up and who
 * didn't, which is the entire social pressure the app is trying to create.
 *
 * Names are looked up here rather than threaded through every caller: every
 * screen that wants this already has the member ids and none of them want to
 * carry a profile map around for it.
 */
export function AvatarStack({
  members,
  size = 28,
  max = 5,
  /** Dim the faces that aren't in `members` — "who's missing" as a picture. */
  ghosts,
  className = '',
}: {
  members: readonly MemberId[];
  size?: number;
  max?: number;
  ghosts?: readonly MemberId[];
  className?: string;
}) {
  const profiles = useLiveQuery(() => db.profiles.toArray(), []) ?? [];
  const nameOf = (id: MemberId) => profiles.find((p) => p.id === id)?.displayName;

  const present = members.slice(0, max);
  const missing = (ghosts ?? []).filter((g) => !members.includes(g)).slice(0, max);
  const overflow = members.length - present.length;

  if (present.length === 0 && missing.length === 0) return null;

  return (
    <div className={`flex items-center ${className}`}>
      {present.map((id, i) => (
        <span
          key={id}
          // Overlap, with the earlier faces on top so the row reads left to
          // right rather than as a pile.
          style={{ marginLeft: i === 0 ? 0 : -size * 0.3, zIndex: max - i }}
          className="relative"
        >
          <Avatar seed={id} displayName={nameOf(id)} size={size} alt={nameOf(id) ?? ''} />
        </span>
      ))}
      {missing.map((id, i) => (
        <span
          key={id}
          style={{
            marginLeft: present.length === 0 && i === 0 ? 0 : -size * 0.3,
            zIndex: 0,
          }}
          className="relative opacity-30 grayscale"
        >
          <Avatar seed={id} displayName={nameOf(id)} size={size} alt="" />
        </span>
      ))}
      {overflow > 0 && (
        <span
          style={{ marginLeft: -size * 0.3, width: size, height: size }}
          className="relative grid place-items-center rounded-full bg-white/80 ring-1 ring-white text-[10px] font-semibold text-ink-700"
        >
          +{overflow}
        </span>
      )}
    </div>
  );
}
