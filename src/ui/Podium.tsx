import { motion } from 'motion/react';
import { Avatar } from './Avatar';
import { TierBadge } from './TierBadge';
import type { MemberId, Tier } from '../types';

export interface PodiumRow {
  member: MemberId;
  name: string;
  points: number;
  tier: Tier;
}

/**
 * The top three, on blocks, with their crew avatars at the size the effort
 * deserves.
 *
 * A list of names and numbers is a report. This is the bit people screenshot
 * and argue about, and it's the main reason to have spent an afternoon
 * choosing a hat: your crew member stands on a box in front of everyone
 * else's.
 *
 * Standard podium ordering — 2nd, 1st, 3rd — because that's the shape people
 * already read as "who won" without needing the numbers.
 */
export function Podium({ rows, myId }: { rows: readonly PodiumRow[]; myId: MemberId }) {
  const top = rows.slice(0, 3);
  if (top.length < 2) return null;

  // 2nd, 1st, 3rd. With only two players there's no third box to leave a gap
  // for, so they sit side by side instead of straddling an empty step.
  const order = top.length >= 3 ? [top[1], top[0], top[2]] : [top[1], top[0]];
  const heightFor = (rank: number) => (rank === 0 ? 'h-20' : rank === 1 ? 'h-14' : 'h-10');
  const sizeFor = (rank: number) => (rank === 0 ? 64 : 52);

  return (
    <div className="flex items-end justify-center gap-2 pt-2">
      {order.map((row) => {
        const rank = top.indexOf(row);
        const isMe = row.member === myId;
        return (
          <motion.div
            key={row.member}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: rank * 0.08, type: 'spring', stiffness: 160, damping: 18 }}
            className="flex-1 max-w-[112px] flex flex-col items-center"
          >
            <div className="relative">
              <Avatar
                seed={row.member}
                displayName={row.name}
                size={sizeFor(rank)}
                alt={`${row.name}, ${ordinal(rank + 1)}`}
              />
              {rank === 0 && (
                <span aria-hidden className="absolute -top-3 left-1/2 -translate-x-1/2 text-lg">
                  👑
                </span>
              )}
            </div>
            <div className="mt-1.5 text-xs font-medium truncate max-w-full">
              {row.name}
              {isMe && <span className="text-ocean"> (you)</span>}
            </div>
            <div className="font-display tabular text-lg font-semibold leading-none">
              {row.points}
            </div>
            <div
              className={`mt-1.5 w-full ${heightFor(rank)} rounded-t-2xl bg-gradient-to-b from-white/80 to-white/40 ring-1 ring-white/80 grid place-items-start justify-center pt-1.5`}
            >
              <span className="text-[11px] font-semibold text-ink-600">{ordinal(rank + 1)}</span>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}

/** Small helper so the podium and the recap agree on how ranks are written. */
export function ordinal(n: number): string {
  const suffix = n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th';
  return `${n}${suffix}`;
}

/** The tier chip, used beside a podium name where there's room for it. */
export function PodiumTier({ tier }: { tier: Tier }) {
  return <TierBadge tier={tier} />;
}
