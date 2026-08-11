import { describe, expect, it } from 'vitest';
import { buildTripRecap, hasTripRecap, datesBetween, bestTier, type TripRecapInput } from './recap';
import { huntFinaleId } from './hunts';
import { encodePoll, voteEmoji } from './poll';
import { outcomeEmoji } from './predictions';
import type {
  ChallengeCompletion, CrewGoal, HabitCheckIn, Hunt, Message, Photo, PointEvent, Profile, Reaction,
} from '../types';

const A = 'aaa111';
const B = 'bbb222';

const profiles: Profile[] = [
  { id: A, displayName: 'Ana', role: 'parent', createdAt: '2026-01-01T00:00:00Z' },
  { id: B, displayName: 'Bo', role: 'kid', createdAt: '2026-01-01T00:00:00Z' },
];
const names = { [A]: 'Ana', [B]: 'Bo' };

let seq = 0;
function photo(from: string, day: string, id?: string): Photo {
  const pid = id ?? `p${++seq}`;
  return {
    id: pid, from, takenAt: `${day}T12:00:00`, uploadedAt: `${day}T12:00:00`,
    filePath: '', width: 1, height: 1, bytes: 1, exifPresent: true,
  };
}
function pointEvent(to: string, amount: number, day: string): PointEvent {
  return { id: `e${++seq}`, to, by: to, at: `${day}T12:00:00`, amount, reason: 'challenge' };
}
function journal(from: string, day: string, body: string): Message {
  return { id: `m${++seq}`, from, sentAt: `${day}T18:00:00`, body, kind: 'journal' };
}
function reaction(by: string, messageId: string, emoji: string | null): Reaction {
  return { id: `r${++seq}`, messageId, by, emoji, at: '2026-08-18T12:00:00Z' };
}

function input(over: Partial<TripRecapInput> = {}): TripRecapInput {
  return {
    startDate: '2026-08-16',
    endDate: '2026-08-18',
    photos: [], messages: [], pointEvents: [], completions: [], habits: [],
    names, reactions: [], profiles, hunts: [],
    ...over,
  };
}

describe('datesBetween', () => {
  it('is inclusive at both ends', () => {
    expect(datesBetween('2026-08-16', '2026-08-18')).toEqual(['2026-08-16', '2026-08-17', '2026-08-18']);
  });

  it('handles a single day', () => {
    expect(datesBetween('2026-08-16', '2026-08-16')).toEqual(['2026-08-16']);
  });

  it('crosses a month boundary', () => {
    expect(datesBetween('2026-07-31', '2026-08-02')).toEqual(['2026-07-31', '2026-08-01', '2026-08-02']);
  });

  it('refuses a reversed or empty range instead of looping', () => {
    expect(datesBetween('2026-08-18', '2026-08-16')).toEqual([]);
    expect(datesBetween('', '')).toEqual([]);
  });
});

describe('the story', () => {
  it('opens with a title and closes with a sign-off', () => {
    const slides = buildTripRecap(input({ photos: [photo(A, '2026-08-16')] }));
    expect(slides[0].kind).toBe('stat');
    expect(slides[slides.length - 1].kind).toBe('end');
  });

  it('walks the days in order', () => {
    const slides = buildTripRecap(input({
      photos: [photo(A, '2026-08-18'), photo(B, '2026-08-16')],
    }));
    const chapters = slides.filter((s) => s.kind === 'chapter');
    expect(chapters).toHaveLength(2);
    // Aug 16 before Aug 18 regardless of the order records arrived in.
    const headlines = chapters.map((c) => (c.kind === 'chapter' ? c.headline : ''));
    expect(headlines[0]).toContain('16');
    expect(headlines[1]).toContain('18');
  });

  it('skips a day that produced nothing', () => {
    const slides = buildTripRecap(input({ photos: [photo(A, '2026-08-16')] }));
    expect(slides.filter((s) => s.kind === 'chapter')).toHaveLength(1);
  });

  it('ranks each day’s photos by reactions', () => {
    const loved = photo(A, '2026-08-16', 'loved');
    const ignored = photo(A, '2026-08-16', 'ignored');
    const alsoRan = photo(A, '2026-08-16', 'also');
    const slides = buildTripRecap(input({
      photos: [ignored, alsoRan, loved],
      reactions: [reaction(B, 'loved', '❤️'), reaction(A, 'loved', '😂'), reaction(B, 'also', '👍')],
    }));
    const photoIds = slides.flatMap((s) => (s.kind === 'photo' ? [s.photo.id] : []));
    // Two per day, best first.
    expect(photoIds).toEqual(['loved', 'also']);
  });

  it('does not let poll votes masquerade as love for a photo', () => {
    const a = photo(A, '2026-08-16', 'quiet');
    const b = photo(A, '2026-08-16', 'voted');
    const slides = buildTripRecap(input({
      photos: [a, b],
      // vote: markers share the reaction store but are not appreciation.
      reactions: [reaction(B, 'voted', voteEmoji(0)), reaction(B, 'quiet', '❤️')],
    }));
    const first = slides.find((s) => s.kind === 'photo');
    expect(first?.kind === 'photo' && first.photo.id).toBe('quiet');
  });

  it('includes one journal entry per day', () => {
    const slides = buildTripRecap(input({
      messages: [journal(B, '2026-08-17', 'Saw a whale.')],
      photos: [photo(A, '2026-08-17')],
    }));
    expect(slides.some((s) => s.kind === 'journal' && s.body === 'Saw a whale.')).toBe(true);
  });
});

describe('superlatives', () => {
  const base = input({
    photos: [photo(A, '2026-08-16'), photo(A, '2026-08-17'), photo(B, '2026-08-16')],
    messages: [journal(B, '2026-08-16', 'x'), journal(B, '2026-08-17', 'y')],
    pointEvents: [pointEvent(A, 120, '2026-08-16'), pointEvent(B, 40, '2026-08-17')],
    habits: [
      { id: 'h1', by: B, date: '2026-08-16', at: '2026-08-16T09:00:00' },
      { id: 'h2', by: B, date: '2026-08-17', at: '2026-08-17T09:00:00' },
    ] as HabitCheckIn[],
    reactions: [reaction(A, 'm1', '❤️'), reaction(A, 'm2', '😂')],
  });

  const detailFor = (headline: string) => {
    const s = buildTripRecap(base).find((x) => x.kind === 'stat' && x.headline === headline);
    return s && s.kind === 'stat' ? s.detail : null;
  };

  it('names the photographer', () => {
    expect(detailFor('Official trip photographer')).toContain('Ana');
  });

  it('names the hype captain', () => {
    expect(detailFor('Hype captain')).toContain('Ana');
  });

  it('names the chronicler', () => {
    expect(detailFor('The chronicler')).toContain('Bo');
  });

  it('finds the biggest single day', () => {
    expect(detailFor('Biggest single day')).toContain('120');
  });

  it('names who never missed a check-in', () => {
    expect(detailFor('Never missed a day')).toContain('Bo');
  });

  it('omits a superlative nobody qualifies for', () => {
    const slides = buildTripRecap(input({ photos: [photo(A, '2026-08-16')] }));
    expect(slides.some((s) => s.kind === 'stat' && s.headline === 'Most generous')).toBe(false);
  });

  it('credits the most generous when gifts exist', () => {
    const gift: PointEvent = { id: 'g1', to: B, by: A, at: '2026-08-16T12:00:00', amount: 1, reason: 'gift', note: 'nice' };
    const slides = buildTripRecap(input({ photos: [photo(A, '2026-08-16')], pointEvents: [gift] }));
    const s = slides.find((x) => x.kind === 'stat' && x.headline === 'Most generous');
    expect(s && s.kind === 'stat' && s.detail).toContain('Ana');
  });
});

describe('awards', () => {
  const ballot: Message = {
    id: 'ballot1', from: A, sentAt: '2026-08-18T20:00:00',
    body: encodePoll('⭐ Best photo', ['The glacier', 'The otter']),
    kind: 'poll',
  };

  it('tallies a ballot and names the winner', () => {
    const slides = buildTripRecap(input({
      photos: [photo(A, '2026-08-16')],
      awardBallots: [ballot],
      reactions: [
        reaction(A, 'ballot1', voteEmoji(1)),
        reaction(B, 'ballot1', voteEmoji(1)),
      ],
    }));
    const award = slides.find((s) => s.kind === 'award');
    expect(award && award.kind === 'award' && award.winner).toBe('The otter');
  });

  it('skips a ballot nobody voted on', () => {
    const slides = buildTripRecap(input({ photos: [photo(A, '2026-08-16')], awardBallots: [ballot] }));
    expect(slides.some((s) => s.kind === 'award')).toBe(false);
  });

  it('breaks a tie the same way on every device', () => {
    const events = [reaction(A, 'ballot1', voteEmoji(0)), reaction(B, 'ballot1', voteEmoji(1))];
    const forward = buildTripRecap(input({ photos: [photo(A, '2026-08-16')], awardBallots: [ballot], reactions: events }));
    const backward = buildTripRecap(input({ photos: [photo(A, '2026-08-16')], awardBallots: [ballot], reactions: [...events].reverse() }));
    const winnerOf = (s: ReturnType<typeof buildTripRecap>) => {
      const a = s.find((x) => x.kind === 'award');
      return a && a.kind === 'award' ? a.winner : null;
    };
    expect(winnerOf(forward)).toBe(winnerOf(backward));
  });

  it('ignores an outcome marker left on a ballot', () => {
    const slides = buildTripRecap(input({
      photos: [photo(A, '2026-08-16')],
      awardBallots: [ballot],
      reactions: [reaction(A, 'ballot1', outcomeEmoji(0)), reaction(B, 'ballot1', voteEmoji(1))],
    }));
    const award = slides.find((s) => s.kind === 'award');
    expect(award && award.kind === 'award' && award.winner).toBe('The otter');
  });
});

describe('meta-hunt reveal', () => {
  const meta: Hunt = {
    id: 'cipher', title: 'The Cipher', icon: '🔐', intro: '', kind: 'meta',
    stages: [{ clue: 'x', proof: { type: 'checkbox' }, points: 10 }],
    finaleBonus: 100, reveal: 'You found it.',
    activeFrom: '2026-08-16', activeUntil: '2026-08-18',
  };

  it('stays sealed until the hunt is finished', () => {
    const slides = buildTripRecap(input({ photos: [photo(A, '2026-08-16')], hunts: [meta] }));
    expect(slides.some((s) => s.kind === 'reveal')).toBe(false);
  });

  it('plays once anyone completes it', () => {
    const done: ChallengeCompletion = {
      id: 'c1', challengeId: huntFinaleId('cipher'), by: B,
      completedAt: '2026-08-18T12:00:00', awardedPoints: 100,
    };
    const slides = buildTripRecap(input({ photos: [photo(A, '2026-08-16')], hunts: [meta], completions: [done] }));
    const reveal = slides.find((s) => s.kind === 'reveal');
    expect(reveal && reveal.kind === 'reveal' && reveal.body).toBe('You found it.');
  });

  it('never reveals a port hunt — only the meta one', () => {
    const port: Hunt = { ...meta, id: 'port1', kind: 'port', reveal: 'Port secret' };
    const done: ChallengeCompletion = {
      id: 'c2', challengeId: huntFinaleId('port1'), by: B,
      completedAt: '2026-08-18T12:00:00', awardedPoints: 50,
    };
    const slides = buildTripRecap(input({ photos: [photo(A, '2026-08-16')], hunts: [port], completions: [done] }));
    expect(slides.some((s) => s.kind === 'reveal')).toBe(false);
  });
});

describe('crew goal and standings', () => {
  const goal: CrewGoal = { id: 'g', label: 'Crew goal', target: 100, rewardLabel: 'a whole-crew surprise', until: '2026-08-18' };

  it('celebrates a cleared goal', () => {
    const slides = buildTripRecap(input({
      photos: [photo(A, '2026-08-16')],
      pointEvents: [pointEvent(A, 80, '2026-08-16'), pointEvent(B, 40, '2026-08-16')],
      goal,
    }));
    const s = slides.find((x) => x.kind === 'stat' && x.headline.includes('together'));
    expect(s && s.kind === 'stat' && s.detail).toContain('cleared');
  });

  it('is gracious about falling short', () => {
    const slides = buildTripRecap(input({
      photos: [photo(A, '2026-08-16')],
      pointEvents: [pointEvent(A, 30, '2026-08-16')],
      goal,
    }));
    const s = slides.find((x) => x.kind === 'stat' && x.headline.includes('together'));
    expect(s && s.kind === 'stat' && s.detail).toContain('70 short');
  });

  it('ends on the standings, highest first', () => {
    const slides = buildTripRecap(input({
      photos: [photo(A, '2026-08-16')],
      pointEvents: [pointEvent(A, 30, '2026-08-16'), pointEvent(B, 90, '2026-08-16')],
    }));
    const board = slides.find((s) => s.kind === 'leaderboard');
    expect(board && board.kind === 'leaderboard' && board.rows.map((r) => r.name)).toEqual(['Bo', 'Ana']);
  });
});

describe('readiness', () => {
  it('is not ready with nothing recorded', () => {
    expect(hasTripRecap(buildTripRecap(input()))).toBe(false);
  });

  it('is ready once there is a single photo', () => {
    expect(hasTripRecap(buildTripRecap(input({ photos: [photo(A, '2026-08-16')] })))).toBe(true);
  });
});

describe('bestTier', () => {
  it('reports the highest anyone reached', () => {
    const events = [pointEvent(A, 120, '2026-08-16'), pointEvent(B, 650, '2026-08-16')];
    expect(bestTier(events, profiles)).toBe('gold');
  });

  it('is none when nobody scored', () => {
    expect(bestTier([], profiles)).toBe('none');
  });
});
