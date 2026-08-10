/**
 * Noticing when someone crosses a tier boundary.
 *
 * Crossing Bronze → Silver currently changes a badge and nothing else, which
 * is the one moment in the points system worth marking. The detection has to
 * be idempotent across reloads and across devices syncing the same events, so
 * it works off a persisted "last acknowledged tier" rather than off a
 * transition observed in memory.
 */

import type { PointEvent, PointsConfig, Tier } from '../types';
import { currentTier, totalPoints } from './points';

export const TIER_ACK_PREFIX = 'tier-ack-';

const ORDER: Tier[] = ['none', 'bronze', 'silver', 'gold', 'platinum'];

export function tierRank(tier: Tier): number {
  const i = ORDER.indexOf(tier);
  return i === -1 ? 0 : i;
}

/**
 * The tier to celebrate, or null.
 *
 * Only fires on an *upward* crossing. A correction that takes points away
 * shouldn't trigger anything, and re-acknowledging a lower tier afterwards
 * would make the next re-crossing celebrate a second time.
 */
export function tierToCelebrate(
  events: readonly PointEvent[],
  member: string,
  config: PointsConfig,
  acknowledged: Tier | null,
): Tier | null {
  const tier = currentTier(totalPoints(events as PointEvent[], member), config);
  if (tier === 'none') return null;
  const prior = acknowledged ?? 'none';
  return tierRank(tier) > tierRank(prior) ? tier : null;
}

export function tierAckKey(member: string): string {
  return `${TIER_ACK_PREFIX}${member}`;
}
