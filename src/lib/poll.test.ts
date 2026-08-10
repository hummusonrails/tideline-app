import { describe, expect, it } from 'vitest';
import {
  encodePoll,
  parsePoll,
  parseVote,
  tallyVotes,
  voteEmoji,
  votePercent,
} from './poll';
import type { Message, Reaction } from '../types';

const msg = (body: string): Message => ({
  id: 'p1', from: 'm-a', sentAt: '2026-08-14T18:00:00.000Z', body, kind: 'poll',
});

const vote = (id: string, by: string, option: number | null, at = '2026-08-14T18:05:00.000Z'): Reaction => ({
  id, messageId: 'p1', by, emoji: option === null ? null : voteEmoji(option), at,
});

describe('encode / parse', () => {
  it('round-trips a question and options', () => {
    const body = encodePoll('Dinner?', ['Buffet', 'Dining room']);
    expect(parsePoll(body)).toEqual({ question: 'Dinner?', options: ['Buffet', 'Dining room'] });
  });

  it('drops blank options', () => {
    const body = encodePoll('Dinner?', ['Buffet', '', '  ', 'Room service']);
    expect(parsePoll(body)?.options).toEqual(['Buffet', 'Room service']);
  });

  it('caps at four options', () => {
    const body = encodePoll('Pick', ['a', 'b', 'c', 'd', 'e']);
    expect(parsePoll(body)?.options).toHaveLength(4);
  });

  it('returns null for a body with too few options to be a poll', () => {
    expect(parsePoll('Just a question?')).toBeNull();
    expect(parsePoll('Question?\nOnly one')).toBeNull();
  });

  it('returns null for an empty body rather than throwing', () => {
    expect(parsePoll('')).toBeNull();
  });
});

describe('parseVote', () => {
  it('reads an option index', () => {
    expect(parseVote('vote:2')).toBe(2);
  });

  it('ignores ordinary emoji reactions', () => {
    expect(parseVote('❤️')).toBeNull();
  });

  it('ignores a retraction', () => {
    expect(parseVote(null)).toBeNull();
  });

  it('rejects a malformed index', () => {
    expect(parseVote('vote:abc')).toBeNull();
    expect(parseVote('vote:-1')).toBeNull();
  });
});

describe('tallyVotes', () => {
  const poll = { question: 'Dinner?', options: ['Buffet', 'Dining room'] };
  const message = msg(encodePoll(poll.question, poll.options));

  it('counts nothing when nobody has voted', () => {
    const t = tallyVotes(message, [], poll, 'm-a');
    expect(t.counts).toEqual([0, 0]);
    expect(t.total).toBe(0);
    expect(t.mine).toBeNull();
  });

  it('counts one vote per member', () => {
    const t = tallyVotes(message, [vote('r1', 'm-a', 0), vote('r2', 'm-b', 1)], poll, 'm-a');
    expect(t.counts).toEqual([1, 1]);
    expect(t.total).toBe(2);
    expect(t.mine).toBe(0);
  });

  it('lets a member change their mind without double-counting', () => {
    const events = [
      vote('r1', 'm-a', 0, '2026-08-14T18:05:00.000Z'),
      vote('r2', 'm-a', 1, '2026-08-14T18:06:00.000Z'),
    ];
    const t = tallyVotes(message, events, poll, 'm-a');
    expect(t.counts).toEqual([0, 1]);
    expect(t.total).toBe(1);
    expect(t.mine).toBe(1);
  });

  it('removes a retracted vote', () => {
    const events = [
      vote('r1', 'm-a', 0, '2026-08-14T18:05:00.000Z'),
      vote('r2', 'm-a', null, '2026-08-14T18:06:00.000Z'),
    ];
    const t = tallyVotes(message, events, poll, 'm-a');
    expect(t.total).toBe(0);
    expect(t.mine).toBeNull();
  });

  it('ignores plain emoji reactions on the poll', () => {
    const heart: Reaction = { id: 'r9', messageId: 'p1', by: 'm-c', emoji: '❤️', at: '2026-08-14T18:07:00.000Z' };
    const t = tallyVotes(message, [heart], poll, 'm-a');
    expect(t.total).toBe(0);
  });

  it('ignores a vote for an option that no longer exists', () => {
    const t = tallyVotes(message, [vote('r1', 'm-a', 7)], poll, 'm-a');
    expect(t.total).toBe(0);
  });

  it('records who voted for what', () => {
    const t = tallyVotes(message, [vote('r1', 'm-a', 0), vote('r2', 'm-b', 0)], poll, 'm-a');
    expect(t.votersByOption[0].sort()).toEqual(['m-a', 'm-b']);
    expect(t.votersByOption[1]).toEqual([]);
  });
});

describe('votePercent', () => {
  it('is zero when nobody voted, rather than NaN', () => {
    expect(votePercent(0, 0)).toBe(0);
  });

  it('rounds to whole numbers', () => {
    expect(votePercent(1, 3)).toBe(33);
    expect(votePercent(2, 3)).toBe(67);
  });
});
