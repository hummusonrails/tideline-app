import { describe, it, expect } from 'vitest';
import {
  buildArcadeContent,
  buildCrew,
  buildHighlights,
  buildQuiz,
  buildWords,
  renderAdLib,
  shortLabel,
  toWords,
  AD_LIB_STORIES,
  type ContentInput,
} from './content';

const EMPTY: ContentInput = {
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
  today: '2026-08-11',
};

function profile(id: string, displayName: string, role: 'parent' | 'kid' = 'kid') {
  return { id, displayName, role, createdAt: '2026-01-01T00:00:00.000Z' };
}

function photo(id: string, from: string) {
  return {
    id,
    from,
    takenAt: '2026-08-10T10:00:00.000Z',
    uploadedAt: '2026-08-10T10:00:00.000Z',
    filePath: `photos/${id}.jpg`,
    width: 100,
    height: 100,
    bytes: 1000,
    exifPresent: false,
  };
}

describe('toWords', () => {
  it('keeps only puzzle-safe words', () => {
    expect(toWords('Anchor Bay, 12 miles!')).toEqual(['ANCHOR', 'MILES']);
  });

  it('drops words that are too short or too long', () => {
    expect(toWords('a an the extraordinarily')).toEqual([]);
  });

  it('folds accents so a name stays guessable on an A-Z keyboard', () => {
    expect(toWords('Tromsø Reykjavík')).toEqual(['TROMS', 'REYKJAVIK']);
  });
});

describe('the word bank', () => {
  it('always has enough words to play with, even with nothing synced', () => {
    const words = buildWords(EMPTY);
    expect(words.length).toBeGreaterThan(20);
    expect(new Set(words.map((w) => w.word)).size).toBe(words.length);
  });

  it('ships no place, date or name in the fallback bank', () => {
    // The public repo must give nothing away. Every fallback word is a plain
    // seaside noun, so this is really a guard against somebody adding a
    // destination to the list later.
    for (const entry of buildWords(EMPTY)) {
      expect(entry.word).toMatch(/^[A-Z]{4,11}$/);
    }
  });

  it('puts trip words first, with their better hints', () => {
    const words = buildWords({
      ...EMPTY,
      places: [
        {
          slug: 'x',
          name: 'Lantern Cove',
          subtitle: '',
          heroCredit: '',
          intro: '',
          didYouKnow: [],
          huntFor: ['puffin colony'],
          trivia: [],
          tags: [],
        },
      ],
    });
    const lantern = words.find((w) => w.word === 'LANTERN');
    expect(lantern?.hint).toBe('Somewhere on this trip');
    expect(words.find((w) => w.word === 'PUFFIN')?.hint).toContain('Lantern Cove');
  });
});

describe('highlights', () => {
  it('sorts by date then time, and keeps timeless items last in the day', () => {
    const highlights = buildHighlights({
      ...EMPTY,
      itinerary: [
        { id: 'c', date: '2026-08-12', kind: 'activity', title: 'Later day' },
        { id: 'b', date: '2026-08-11', kind: 'stop', title: 'No time given' },
        { id: 'a', date: '2026-08-11', kind: 'flight', title: 'Early flight', startTime: '06:30' },
      ],
    });
    expect(highlights.map((h) => h.id)).toEqual(['a', 'b', 'c']);
    expect(highlights[0].glyph).toBe('✈️');
  });

  it('drops items with no title', () => {
    const highlights = buildHighlights({
      ...EMPTY,
      itinerary: [{ id: 'x', date: '2026-08-11', kind: 'note', title: '   ' }],
    });
    expect(highlights).toHaveLength(0);
  });
});

describe('crew', () => {
  it('drops members with no profile name rather than showing an opaque id', () => {
    const crew = buildCrew({
      ...EMPTY,
      profiles: [profile('a1', 'Alex'), profile('b2', '  ')],
    });
    expect(crew.map((c) => c.name)).toEqual(['Alex']);
  });
});

describe('the quiz', () => {
  it('always produces a playable quiz with nothing synced', () => {
    const quiz = buildQuiz(EMPTY);
    expect(quiz.length).toBeGreaterThanOrEqual(4);
    for (const question of quiz) {
      expect(question.options.length).toBeGreaterThanOrEqual(2);
      expect(question.answer).toBeGreaterThanOrEqual(0);
      expect(question.answer).toBeLessThan(question.options.length);
    }
  });

  it('marks the correct option wherever the shuffle put it', () => {
    const quiz = buildQuiz({
      ...EMPTY,
      profiles: [profile('a', 'Alex'), profile('b', 'Blair'), profile('c', 'Casey')],
      photos: [photo('p1', 'a'), photo('p2', 'a'), photo('p3', 'b')],
    });
    const photoQ = quiz.find((q) => q.id === 'c-photos');
    expect(photoQ).toBeDefined();
    expect(photoQ!.options[photoQ!.answer]).toBe('Alex');
  });

  it('refuses to ask a crew question that is tied', () => {
    const quiz = buildQuiz({
      ...EMPTY,
      profiles: [profile('a', 'Alex'), profile('b', 'Blair'), profile('c', 'Casey')],
      photos: [photo('p1', 'a'), photo('p2', 'b')],
    });
    expect(quiz.find((q) => q.id === 'c-photos')).toBeUndefined();
  });

  it('refuses to ask a crew question with nobody to compare against', () => {
    const quiz = buildQuiz({
      ...EMPTY,
      profiles: [profile('a', 'Alex'), profile('b', 'Blair')],
      photos: [photo('p1', 'a')],
    });
    expect(quiz.find((q) => q.id === 'c-photos')).toBeUndefined();
  });

  it('is stable across builds so the answer does not move between renders', () => {
    const input: ContentInput = {
      ...EMPTY,
      profiles: [profile('a', 'Alex'), profile('b', 'Blair'), profile('c', 'Casey')],
      photos: [photo('p1', 'a'), photo('p2', 'a')],
    };
    const first = buildQuiz(input).find((q) => q.id === 'c-photos');
    const second = buildQuiz(input).find((q) => q.id === 'c-photos');
    expect(first).toEqual(second);
  });

  it('carries authored place trivia through unchanged', () => {
    const quiz = buildQuiz({
      ...EMPTY,
      places: [
        {
          slug: 'p',
          name: 'Somewhere',
          subtitle: '',
          heroCredit: '',
          intro: '',
          didYouKnow: [],
          huntFor: [],
          tags: [],
          trivia: [
            { q: 'How deep?', options: ['A', 'B', 'C'], answer: 2, explanation: 'Because.' },
          ],
        },
      ],
    });
    const authored = quiz.find((q) => q.id === 'pt-p-0');
    expect(authored).toMatchObject({ q: 'How deep?', answer: 2, source: 'place' });
  });
});

describe('ad-lib rendering', () => {
  it('fills the player words and the trip context', () => {
    const story = AD_LIB_STORIES[0];
    const answers = Object.fromEntries(story.slots.map((s) => [s.key, `X${s.key}`]));
    const text = renderAdLib(story, answers, {
      place: 'Somewhere',
      crew: 'Alex',
      plan: 'the boat',
    });
    expect(text).toContain('Somewhere');
    expect(text).toContain('Alex');
    for (const slot of story.slots) expect(text).toContain(`X${slot.key}`);
    expect(text).not.toMatch(/\{[a-z0-9]+\}/);
  });

  it('leaves an unanswered blank visible rather than printing "undefined"', () => {
    const story = AD_LIB_STORIES[0];
    const text = renderAdLib(story, {}, { place: 'P', crew: 'C', plan: 'T' });
    expect(text).not.toContain('undefined');
    expect(text).toContain(`{${story.slots[0].key}}`);
  });

  it('has a rendering context token for every slot it uses', () => {
    // Guards against a template referencing a blank nobody is ever asked for.
    for (const story of AD_LIB_STORIES) {
      const tokens = [...story.template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      const known = new Set([...story.slots.map((s) => s.key), 'place', 'crew', 'plan']);
      for (const token of tokens) expect(known.has(token)).toBe(true);
    }
  });
});

describe('shortLabel', () => {
  it('leaves short text alone and ellipsises long text', () => {
    expect(shortLabel('Harbour', 12)).toBe('Harbour');
    expect(shortLabel('A very long itinerary entry', 12)).toHaveLength(12);
  });
});

describe('buildArcadeContent', () => {
  it('reports itself as generic when nothing has synced', () => {
    expect(buildArcadeContent(EMPTY).personalised).toBe(false);
  });

  it('reports itself as personalised once anything has', () => {
    const content = buildArcadeContent({ ...EMPTY, profiles: [profile('a', 'Alex')] });
    expect(content.personalised).toBe(true);
    expect(content.labels.length).toBeGreaterThan(0);
  });
});
