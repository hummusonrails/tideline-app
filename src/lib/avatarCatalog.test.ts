import { describe, it, expect } from 'vitest';
import {
  BASES, EYES, MOUTHS, HATS, ACCESSORIES, PALETTES,
  isUnlocked, unlockHint, findPart, findPalette, defaultSpecFor,
  type UnlockState,
} from './avatarCatalog';

const NOTHING: UnlockState = { tier: 'none', eggsFound: 0, huntsDone: 0, photos: 0, streak: 0 };

describe('catalog integrity', () => {
  const groups = { BASES, EYES, MOUTHS, HATS, ACCESSORIES };

  for (const [name, parts] of Object.entries(groups)) {
    it(`${name} has unique ids`, () => {
      const ids = parts.map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it(`${name} draws without throwing for every palette`, () => {
      for (const part of parts) {
        for (const palette of PALETTES) {
          expect(typeof part.draw(palette)).toBe('string');
        }
      }
    });
  }

  it('palette ids are unique', () => {
    const ids = PALETTES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('offers an unlocked option in every group, so a new member can finish', () => {
    for (const parts of Object.values(groups)) {
      expect(parts.some((p) => isUnlocked(p, NOTHING))).toBe(true);
    }
    expect(PALETTES.some((p) => isUnlocked(p, NOTHING))).toBe(true);
  });

  it('ships no identifying text — the catalog is art, not people', () => {
    const blob = JSON.stringify(
      Object.values(groups).flat().map((p) => [p.id, p.label]).concat(
        PALETTES.map((p) => [p.id, p.label]),
      ),
    );
    // A crude but effective guard: the catalog must stay generic nouns.
    expect(blob).not.toMatch(/\b(mom|dad|mum|grandma|grandpa)\b/i);
  });
});

describe('unlock rules', () => {
  it('treats a rule-free part as always available', () => {
    expect(isUnlocked({ }, NOTHING)).toBe(true);
  });

  it('gates on tier by rank, not string equality', () => {
    expect(isUnlocked({ unlock: { tier: 'gold' } }, { ...NOTHING, tier: 'silver' })).toBe(false);
    expect(isUnlocked({ unlock: { tier: 'gold' } }, { ...NOTHING, tier: 'gold' })).toBe(true);
    expect(isUnlocked({ unlock: { tier: 'gold' } }, { ...NOTHING, tier: 'platinum' })).toBe(true);
  });

  it('gates on counters at or above the threshold', () => {
    expect(isUnlocked({ unlock: { photos: 10 } }, { ...NOTHING, photos: 9 })).toBe(false);
    expect(isUnlocked({ unlock: { photos: 10 } }, { ...NOTHING, photos: 10 })).toBe(true);
    expect(isUnlocked({ unlock: { eggsFound: 3 } }, { ...NOTHING, eggsFound: 4 })).toBe(true);
    expect(isUnlocked({ unlock: { huntsDone: 2 } }, { ...NOTHING, huntsDone: 1 })).toBe(false);
    expect(isUnlocked({ unlock: { streak: 5 } }, { ...NOTHING, streak: 5 })).toBe(true);
  });

  it('requires every condition in a compound rule', () => {
    const rule = { unlock: { tier: 'silver' as const, photos: 5 } };
    expect(isUnlocked(rule, { ...NOTHING, tier: 'silver', photos: 4 })).toBe(false);
    expect(isUnlocked(rule, { ...NOTHING, tier: 'silver', photos: 5 })).toBe(true);
  });

  it('explains how to earn a locked part', () => {
    expect(unlockHint({ unlock: { tier: 'gold' } })).toBe('Reach gold');
    expect(unlockHint({ unlock: { huntsDone: 1 } })).toBe('Finish 1 hunt');
    expect(unlockHint({ unlock: { huntsDone: 3 } })).toBe('Finish 3 hunts');
    expect(unlockHint({})).toBeNull();
  });
});

describe('lookups', () => {
  it('falls back to the first part for an unknown id', () => {
    expect(findPart(BASES, 'nope').id).toBe(BASES[0].id);
    expect(findPart(BASES, undefined).id).toBe(BASES[0].id);
    expect(findPalette('nope').id).toBe(PALETTES[0].id);
  });

  it('resolves a real id exactly', () => {
    expect(findPart(HATS, 'crown').id).toBe('crown');
  });
});

describe('default spec', () => {
  it('is deterministic for a member', () => {
    expect(defaultSpecFor('abc123')).toEqual(defaultSpecFor('abc123'));
  });

  it('only ever picks parts that are already unlocked', () => {
    for (const id of ['aaa111', 'bbb222', 'ccc333', 'ddd444', 'e10131', 'fb99f8']) {
      const spec = defaultSpecFor(id);
      expect(isUnlocked(findPart(BASES, spec.base), NOTHING)).toBe(true);
      expect(isUnlocked(findPalette(spec.palette), NOTHING)).toBe(true);
      expect(isUnlocked(findPart(EYES, spec.eyes), NOTHING)).toBe(true);
      expect(isUnlocked(findPart(MOUTHS, spec.mouth), NOTHING)).toBe(true);
    }
  });

  it('does not hand every member the same face', () => {
    const looks = ['aaa111', 'bbb222', 'ccc333', 'ddd444'].map((id) =>
      JSON.stringify(defaultSpecFor(id)),
    );
    expect(new Set(looks).size).toBeGreaterThan(1);
  });
});
