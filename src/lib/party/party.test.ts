import { describe, it, expect } from 'vitest';
import { PARTY_GAMES, partyGameById } from './catalog';
import {
  CODE_WORDS,
  HOLD_CATEGORIES,
  NIGHT_ROLES,
  STOWAWAY_TOPICS,
  TALL_WORDS,
  codeWordPool,
  fillTokens,
  holdCategories,
} from './decks';
import { isVipId, VIP_PREFIX } from './vips';
import { makeRng } from '../arcade/rng';
import { buildArcadeContent, type ContentInput } from '../arcade/content';

const EMPTY_INPUT: ContentInput = {
  places: [],
  itinerary: [],
  profiles: [],
  avatarSpecs: [],
  photos: [],
  messages: [],
  reactions: [],
  pointEvents: [],
  habits: [],
  completions: [],
};

const EMPTY = buildArcadeContent(EMPTY_INPUT);

describe('the party catalog', () => {
  it('has ten games with unique ids and sane player counts', () => {
    expect(PARTY_GAMES).toHaveLength(10);
    expect(new Set(PARTY_GAMES.map((g) => g.id)).size).toBe(10);
    for (const game of PARTY_GAMES) {
      expect(game.minPlayers).toBeGreaterThanOrEqual(3);
      expect(game.maxPlayers).toBeGreaterThan(game.minPlayers);
      expect(game.howTo.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('looks a game up by id', () => {
    expect(partyGameById('herd')?.title).toBe('Herd');
    expect(partyGameById('nope')).toBeUndefined();
  });
});

describe('deck integrity', () => {
  it('gives every Stowaway topic a full four-by-four grid', () => {
    for (const topic of STOWAWAY_TOPICS) {
      expect(topic.words).toHaveLength(16);
      expect(new Set(topic.words).size).toBe(16);
    }
  });

  it('has enough grid words for a full board with room to spare', () => {
    expect(CODE_WORDS.length).toBeGreaterThanOrEqual(50);
    expect(new Set(CODE_WORDS).size).toBe(CODE_WORDS.length);
  });

  it('gives every Tall Tales word a real definition', () => {
    for (const entry of TALL_WORDS) {
      expect(entry.truth.length).toBeGreaterThan(10);
      // The truth must not simply restate the word.
      expect(entry.truth.toLowerCase()).not.toContain(entry.word.toLowerCase());
    }
  });

  it('has a night role for both sides and an ordered night', () => {
    expect(NIGHT_ROLES.some((r) => r.team === 'stowaway')).toBe(true);
    expect(NIGHT_ROLES.filter((r) => r.team === 'crew').length).toBeGreaterThanOrEqual(4);
    const ordered = NIGHT_ROLES.filter((r) => r.nightStep).map((r) => r.nightOrder);
    expect(ordered.every((o) => typeof o === 'number')).toBe(true);
    expect(new Set(ordered).size).toBe(ordered.length);
  });

  it('gives every Hold It Up category enough cards for a full minute', () => {
    for (const category of HOLD_CATEGORIES) {
      expect(category.cards.length).toBeGreaterThanOrEqual(18);
    }
  });
});

describe('token filling', () => {
  it('resolves every token even with nothing synced', () => {
    const text = fillTokens('{crew} went to {place} before {plan}.', EMPTY, makeRng(1));
    expect(text).not.toMatch(/\{(place|crew|plan)\}/);
    expect(text).toContain('went to');
  });

  it('prefers real trip content when it exists', () => {
    const content = buildArcadeContent({
      ...EMPTY_INPUT,
      profiles: [{ id: 'a', displayName: 'Alex', role: 'kid', createdAt: '2026-01-01' }],
    });
    expect(fillTokens('{crew}', content, makeRng(2))).toBe('Alex');
  });
});

describe('code word pool', () => {
  it('falls back to the generic pool and stays deduped', () => {
    const pool = codeWordPool(EMPTY);
    expect(pool.length).toBeGreaterThanOrEqual(25);
    expect(new Set(pool).size).toBe(pool.length);
  });

  it('mixes trip place names in at the front', () => {
    const content = buildArcadeContent({
      ...EMPTY_INPUT,
      places: [
        {
          slug: 'p',
          name: 'Lantern Cove',
          subtitle: '',
          heroCredit: '',
          intro: '',
          didYouKnow: [],
          huntFor: [],
          trivia: [],
          tags: [],
        },
      ],
    });
    expect(codeWordPool(content)[0]).toBe('LANTERN COVE');
  });
});

describe('hold-it-up categories', () => {
  it('offers only the house decks with nothing synced', () => {
    expect(holdCategories(EMPTY).some((c) => c.id === 'this-trip')).toBe(false);
  });

  it('adds a trip deck once there is enough to describe', () => {
    const content = buildArcadeContent({
      ...EMPTY_INPUT,
      itinerary: Array.from({ length: 12 }, (_, i) => ({
        id: `i${i}`,
        date: '2026-08-11',
        kind: 'activity' as const,
        title: `Thing number ${i}`,
      })),
    });
    const categories = holdCategories(content);
    expect(categories[0].id).toBe('this-trip');
    expect(categories[0].cards.length).toBeGreaterThanOrEqual(10);
  });
});

describe('VIP guests', () => {
  it('marks guest ids so they can be kept out of the points system', () => {
    expect(isVipId(`${VIP_PREFIX}bobbi`)).toBe(true);
    expect(isVipId('a3f91c')).toBe(false);
  });
});
