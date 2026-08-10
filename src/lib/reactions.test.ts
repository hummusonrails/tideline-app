import { describe, expect, it } from 'vitest';
import { effectiveReactions, hasEverReacted, nextEmojiFor } from './reactions';
import type { Message, Reaction } from '../types';

const message = (reactions?: Record<string, string>): Pick<Message, 'id' | 'reactions'> => ({
  id: 'm1',
  reactions,
});

const ev = (
  id: string,
  by: string,
  emoji: string | null,
  at = '2026-08-10T12:00:00.000Z',
  messageId = 'm1',
): Reaction => ({ id, messageId, by, emoji, at });

describe('effectiveReactions', () => {
  it('returns nothing for a message nobody reacted to', () => {
    expect(effectiveReactions(message(), [])).toEqual({});
  });

  it('still renders legacy inline reactions', () => {
    expect(effectiveReactions(message({ 'm-a': '❤️' }), [])).toEqual({ 'm-a': '❤️' });
  });

  it('applies reaction events', () => {
    expect(effectiveReactions(message(), [ev('r1', 'm-a', '🔥')])).toEqual({ 'm-a': '🔥' });
  });

  it('lets a later event supersede an earlier one from the same member', () => {
    const events = [
      ev('r1', 'm-a', '❤️', '2026-08-10T12:00:00.000Z'),
      ev('r2', 'm-a', '😂', '2026-08-10T12:05:00.000Z'),
    ];
    expect(effectiveReactions(message(), events)).toEqual({ 'm-a': '😂' });
  });

  it('is order-independent — events may arrive from a peer out of order', () => {
    const events = [
      ev('r2', 'm-a', '😂', '2026-08-10T12:05:00.000Z'),
      ev('r1', 'm-a', '❤️', '2026-08-10T12:00:00.000Z'),
    ];
    expect(effectiveReactions(message(), events)).toEqual({ 'm-a': '😂' });
  });

  it('lets an event override a legacy inline reaction', () => {
    expect(effectiveReactions(message({ 'm-a': '❤️' }), [ev('r1', 'm-a', '🙏')])).toEqual({
      'm-a': '🙏',
    });
  });

  it('removes a reaction on retraction', () => {
    expect(effectiveReactions(message(), [ev('r1', 'm-a', '❤️'), ev('r2', 'm-a', null, '2026-08-10T12:01:00.000Z')])).toEqual({});
  });

  it('retracts a legacy inline reaction too', () => {
    expect(effectiveReactions(message({ 'm-a': '❤️' }), [ev('r1', 'm-a', null)])).toEqual({});
  });

  it('keeps different members independent', () => {
    const events = [ev('r1', 'm-a', '❤️'), ev('r2', 'm-b', '🔥')];
    expect(effectiveReactions(message(), events)).toEqual({ 'm-a': '❤️', 'm-b': '🔥' });
  });

  it('ignores events belonging to other messages', () => {
    const events = [ev('r1', 'm-a', '❤️', '2026-08-10T12:00:00.000Z', 'other')];
    expect(effectiveReactions(message(), events)).toEqual({});
  });

  it('breaks same-timestamp ties deterministically so devices agree', () => {
    const at = '2026-08-10T12:00:00.000Z';
    const forward = effectiveReactions(message(), [ev('a', 'm-a', '❤️', at), ev('b', 'm-a', '🔥', at)]);
    const reverse = effectiveReactions(message(), [ev('b', 'm-a', '🔥', at), ev('a', 'm-a', '❤️', at)]);
    expect(forward).toEqual(reverse);
    expect(forward).toEqual({ 'm-a': '🔥' });
  });
});

describe('hasEverReacted', () => {
  it('is false with no history', () => {
    expect(hasEverReacted(message(), [], 'm-a')).toBe(false);
  });

  it('counts a legacy inline reaction', () => {
    expect(hasEverReacted(message({ 'm-a': '❤️' }), [], 'm-a')).toBe(true);
  });

  it('counts a retracted reaction, so re-adding cannot farm points', () => {
    expect(hasEverReacted(message(), [ev('r1', 'm-a', null)], 'm-a')).toBe(true);
  });

  it('does not count another member reacting', () => {
    expect(hasEverReacted(message(), [ev('r1', 'm-b', '❤️')], 'm-a')).toBe(false);
  });
});

describe('nextEmojiFor', () => {
  it('sets an emoji when none is standing', () => {
    expect(nextEmojiFor({}, 'm-a', '❤️')).toBe('❤️');
  });

  it('retracts when tapping the emoji already showing', () => {
    expect(nextEmojiFor({ 'm-a': '❤️' }, 'm-a', '❤️')).toBeNull();
  });

  it('replaces when tapping a different emoji', () => {
    expect(nextEmojiFor({ 'm-a': '❤️' }, 'm-a', '🔥')).toBe('🔥');
  });
});
