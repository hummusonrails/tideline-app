import { describe, it, expect } from 'vitest';
import {
  encodePrediction, parsePrediction, isPrediction, predictionAsPoll, isLocked,
  outcomeEmoji, parseOutcome, settledOutcome, myGuess, didWin, predictionPayoutId,
  encodeDuel, parseDuel, duelWinEmoji, parseDuelWin, isDuelAccepted, duelWinner,
  duelPayoutId, isReservedEmoji, DUEL_ACCEPT,
} from './predictions';
import { parsePoll, voteEmoji, tallyVotes } from './poll';
import type { Message, Profile, Reaction } from '../types';

const PARENT = 'p11111';
const PARENT2 = 'p22222';
const KID = 'k33333';
const KID2 = 'k44444';

const profiles: Profile[] = [
  { id: PARENT, displayName: 'P1', role: 'parent', createdAt: '2026-01-01T00:00:00Z' },
  { id: PARENT2, displayName: 'P2', role: 'parent', createdAt: '2026-01-01T00:00:00Z' },
  { id: KID, displayName: 'K1', role: 'kid', createdAt: '2026-01-01T00:00:00Z' },
  { id: KID2, displayName: 'K2', role: 'kid', createdAt: '2026-01-01T00:00:00Z' },
];

const msg: Pick<Message, 'id' | 'reactions'> = { id: 'm1' };

let seq = 0;
function reaction(by: string, emoji: string | null, at = '2026-08-18T10:00:00Z'): Reaction {
  return { id: `r${++seq}`, messageId: 'm1', by, emoji, at };
}

const LOCK = '2026-08-18T15:00:00-08:00';

describe('encoding', () => {
  it('round-trips', () => {
    const body = encodePrediction('Whale fluke before 3pm?', ['Yes', 'No'], LOCK);
    const parsed = parsePrediction(body);
    expect(parsed).toEqual({ question: 'Whale fluke before 3pm?', options: ['Yes', 'No'], lockISO: LOCK });
  });

  it('is recognisable', () => {
    expect(isPrediction(encodePrediction('q', ['a', 'b'], LOCK))).toBe(true);
    expect(isPrediction('just a message')).toBe(false);
  });

  it('rejects a malformed lock time rather than throwing', () => {
    expect(parsePrediction('predict:not-a-date\nq\na\nb')).toBeNull();
  });

  it('rejects a body with too few options', () => {
    expect(parsePrediction(`predict:${LOCK}\nq\nonly-one`)).toBeNull();
  });

  it('degrades to an ordinary poll on an older build', () => {
    // The key compatibility property: lines 2..n are exactly a poll, so a
    // build that has never heard of predictions still renders something sane.
    const body = encodePrediction('Rain when we dock?', ['Yes', 'No'], LOCK);
    const asPoll = parsePoll(body);
    expect(asPoll).not.toBeNull();
    expect(asPoll!.options).toContain('Yes');
  });

  it('exposes itself as a poll for tallying', () => {
    const p = parsePrediction(encodePrediction('q', ['a', 'b'], LOCK))!;
    expect(predictionAsPoll(p)).toEqual({ question: 'q', options: ['a', 'b'] });
  });
});

describe('locking', () => {
  const p = parsePrediction(encodePrediction('q', ['a', 'b'], LOCK))!;

  it('is open before the deadline', () => {
    expect(isLocked(p, new Date('2026-08-18T14:59:00-08:00'))).toBe(false);
  });

  it('is shut at and after the deadline', () => {
    expect(isLocked(p, new Date('2026-08-18T15:00:00-08:00'))).toBe(true);
    expect(isLocked(p, new Date('2026-08-18T16:00:00-08:00'))).toBe(true);
  });
});

describe('outcomes', () => {
  it('round-trips the marker', () => {
    expect(parseOutcome(outcomeEmoji(2))).toBe(2);
    expect(parseOutcome('vote:1')).toBeNull();
    expect(parseOutcome('❤️')).toBeNull();
    expect(parseOutcome(null)).toBeNull();
  });

  it('stays open until a parent marks it', () => {
    expect(settledOutcome(msg, [reaction(KID, outcomeEmoji(0))], profiles)).toBeNull();
  });

  it('settles on a parent mark', () => {
    expect(settledOutcome(msg, [reaction(PARENT, outcomeEmoji(1))], profiles)).toBe(1);
  });

  it('resolves parent disagreement deterministically', () => {
    const events = [reaction(PARENT, outcomeEmoji(1)), reaction(PARENT2, outcomeEmoji(0))];
    expect(settledOutcome(msg, events, profiles)).toBe(0);
    // Order of observation must not change the answer — the two phones may
    // receive these in either order over gossip.
    expect(settledOutcome(msg, [...events].reverse(), profiles)).toBe(0);
  });

  it('follows a parent who changes their mind', () => {
    const events = [
      reaction(PARENT, outcomeEmoji(1), '2026-08-18T10:00:00Z'),
      reaction(PARENT, outcomeEmoji(0), '2026-08-18T11:00:00Z'),
    ];
    expect(settledOutcome(msg, events, profiles)).toBe(0);
  });
});

describe('guesses and payout', () => {
  it('reads the latest vote', () => {
    const events = [
      reaction(KID, voteEmoji(0), '2026-08-18T09:00:00Z'),
      reaction(KID, voteEmoji(1), '2026-08-18T09:30:00Z'),
    ];
    expect(myGuess(msg, events, KID)).toBe(1);
  });

  it('is null for someone who never guessed', () => {
    expect(myGuess(msg, [reaction(KID, voteEmoji(0))], KID2)).toBeNull();
  });

  it("does not mistake a parent's outcome mark for their guess", () => {
    // A parent who voted, then marked the result, still has their vote read
    // as the vote — the outcome mark is their *standing* reaction.
    const events = [
      reaction(PARENT, voteEmoji(1), '2026-08-18T09:00:00Z'),
      reaction(PARENT, outcomeEmoji(1), '2026-08-18T16:00:00Z'),
    ];
    expect(myGuess(msg, events, PARENT)).toBe(1);
    expect(didWin({ message: msg, events, profiles, me: PARENT })).toBe(true);
  });

  it('pays only the members who called it', () => {
    const events = [
      reaction(KID, voteEmoji(0)),
      reaction(KID2, voteEmoji(1)),
      reaction(PARENT, outcomeEmoji(0)),
    ];
    expect(didWin({ message: msg, events, profiles, me: KID })).toBe(true);
    expect(didWin({ message: msg, events, profiles, me: KID2 })).toBe(false);
  });

  it('pays nobody while it is unsettled', () => {
    expect(didWin({ message: msg, events: [reaction(KID, voteEmoji(0))], profiles, me: KID })).toBe(false);
  });

  it('derives a stable payout id from the message', () => {
    expect(predictionPayoutId('m1')).toBe('pred-m1');
  });
});

describe('votes still tally through the poll machinery', () => {
  it('counts prediction votes like any poll', () => {
    const p = parsePrediction(encodePrediction('q', ['a', 'b'], LOCK))!;
    const events = [reaction(KID, voteEmoji(0)), reaction(KID2, voteEmoji(0)), reaction(PARENT, voteEmoji(1))];
    const tally = tallyVotes(msg, events, predictionAsPoll(p), KID);
    expect(tally.counts).toEqual([2, 1]);
    expect(tally.mine).toBe(0);
  });
});

describe('duels', () => {
  it('round-trips', () => {
    const body = encodeDuel('First eagle photo', KID2);
    expect(parseDuel(body)).toEqual({ text: 'First eagle photo', target: KID2 });
  });

  it('rejects a malformed duel', () => {
    expect(parseDuel('duel:\nno target')).toBeNull();
    expect(parseDuel(`duel:${KID2}`)).toBeNull();
    expect(parseDuel('hello')).toBeNull();
  });

  it('tracks acceptance by the person challenged', () => {
    expect(isDuelAccepted(msg, [reaction(KID2, DUEL_ACCEPT)], KID2)).toBe(true);
    expect(isDuelAccepted(msg, [reaction(KID, DUEL_ACCEPT)], KID2)).toBe(false);
  });

  it('only lets a parent call the winner', () => {
    expect(duelWinner(msg, [reaction(KID, duelWinEmoji(KID))], profiles)).toBeNull();
    expect(duelWinner(msg, [reaction(PARENT, duelWinEmoji(KID))], profiles)).toBe(KID);
  });

  it('resolves conflicting calls deterministically', () => {
    const events = [reaction(PARENT, duelWinEmoji(KID2)), reaction(PARENT2, duelWinEmoji(KID))];
    expect(duelWinner(msg, events, profiles)).toBe(duelWinner(msg, [...events].reverse(), profiles));
  });

  it('round-trips the winner marker', () => {
    expect(parseDuelWin(duelWinEmoji(KID))).toBe(KID);
    expect(parseDuelWin('❤️')).toBeNull();
  });

  it('derives a stable payout id', () => {
    expect(duelPayoutId('m1')).toBe('duel-m1');
  });
});

describe('reserved emoji', () => {
  it('hides mechanic markers from the reaction chips', () => {
    for (const e of [voteEmoji(0), outcomeEmoji(1), duelWinEmoji(KID), DUEL_ACCEPT]) {
      expect(isReservedEmoji(e)).toBe(true);
    }
  });

  it('leaves real reactions alone', () => {
    expect(isReservedEmoji('❤️')).toBe(false);
    expect(isReservedEmoji(null)).toBe(false);
  });
});
