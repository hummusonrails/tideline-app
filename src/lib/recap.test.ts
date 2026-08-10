import { describe, expect, it } from 'vitest';
import { buildRecap, hasRecap, localDay, type RecapInput } from './recap';
import type { Message, Photo, PointEvent } from '../types';

const DATE = '2026-08-14';
const at = (hhmm: string) => `${DATE}T${hhmm}:00.000Z`;

const photo = (id: string, from = 'm-a', takenAt = at('12:00')): Photo => ({
  id, from, takenAt, uploadedAt: takenAt,
  filePath: `photos/${DATE}/${id}.jpg`, width: 1, height: 1, bytes: 1, exifPresent: false,
});

const journal = (id: string, body: string, from = 'm-a'): Message => ({
  id, from, sentAt: at('20:00'), body, kind: 'journal',
});

const chat = (id: string, body: string): Message => ({
  id, from: 'm-a', sentAt: at('20:00'), body, kind: 'message',
});

const points = (id: string, to: string, amount: number): PointEvent => ({
  id, to, by: to, at: at('15:00'), amount, reason: 'photo',
});

function input(over: Partial<RecapInput> = {}): RecapInput {
  return {
    date: DATE,
    photos: [],
    messages: [],
    pointEvents: [],
    completions: [],
    habits: [],
    names: { 'm-a': 'Alex', 'm-b': 'Robin' },
    ...over,
  };
}

describe('localDay', () => {
  it('extracts a calendar day', () => {
    expect(localDay('2026-08-14T12:00:00.000Z')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('buildRecap', () => {
  it('produces nothing for an empty day', () => {
    expect(buildRecap(input())).toEqual([]);
    expect(hasRecap(buildRecap(input()))).toBe(false);
  });

  it('leads with photos, in the order they were taken', () => {
    const slides = buildRecap(input({
      photos: [photo('p2', 'm-a', at('16:00')), photo('p1', 'm-a', at('09:00'))],
    }));
    expect(slides[0]).toMatchObject({ kind: 'photo', photo: { id: 'p1' } });
    expect(slides[1]).toMatchObject({ kind: 'photo', photo: { id: 'p2' } });
  });

  it('attributes photos by display name', () => {
    const slides = buildRecap(input({ photos: [photo('p1', 'm-b')] }));
    expect(slides[0]).toMatchObject({ author: 'Robin' });
  });

  it('falls back gracefully for an unknown member', () => {
    const slides = buildRecap(input({ photos: [photo('p1', 'm-zzz')] }));
    expect(slides[0]).toMatchObject({ author: 'Someone' });
  });

  it('excludes other days', () => {
    const slides = buildRecap(input({
      photos: [photo('old', 'm-a', '2026-08-01T12:00:00.000Z')],
    }));
    expect(slides).toEqual([]);
  });

  it('summarises the day’s points and names the leader', () => {
    const slides = buildRecap(input({
      photos: [photo('p1')],
      pointEvents: [points('e1', 'm-a', 30), points('e2', 'm-b', 55)],
    }));
    const stat = slides.find((s) => s.kind === 'stat');
    expect(stat).toMatchObject({ headline: '+85 points today' });
    expect((stat as { detail: string }).detail).toContain('Robin');
  });

  it('includes journal entries but not ordinary chat', () => {
    const slides = buildRecap(input({
      photos: [photo('p1')],
      messages: [journal('j1', 'What a day'), chat('c1', 'ok')],
    }));
    const journals = slides.filter((s) => s.kind === 'journal');
    expect(journals).toHaveLength(1);
    expect(journals[0]).toMatchObject({ body: 'What a day', author: 'Alex' });
  });

  it('caps how many photos one recap shows', () => {
    const many = Array.from({ length: 30 }, (_, i) =>
      photo(`p${i}`, 'm-a', at(`${String(i % 24).padStart(2, '0')}:00`)),
    );
    const slides = buildRecap(input({ photos: many }));
    expect(slides.filter((s) => s.kind === 'photo').length).toBeLessThanOrEqual(12);
  });

  it('ends with a closing slide', () => {
    const slides = buildRecap(input({ photos: [photo('p1')] }));
    expect(slides[slides.length - 1]).toMatchObject({ kind: 'end' });
  });

  it('counts habit check-ins for the day', () => {
    const slides = buildRecap(input({
      photos: [photo('p1')],
      habits: [
        { id: 'h1', by: 'm-a', date: DATE, at: at('08:00') },
        { id: 'h2', by: 'm-b', date: DATE, at: at('08:30') },
        { id: 'h3', by: 'm-a', date: '2026-08-13', at: '2026-08-13T08:00:00.000Z' },
      ],
    }));
    expect(slides.some((s) => s.kind === 'stat' && s.headline.startsWith('2 habit'))).toBe(true);
  });

  it('omits the points slide when the day scored nothing', () => {
    const slides = buildRecap(input({ photos: [photo('p1')] }));
    expect(slides.some((s) => s.kind === 'stat' && s.headline.includes('points'))).toBe(false);
  });
});

describe('hasRecap', () => {
  it('does not count the closing slide on its own', () => {
    expect(hasRecap([{ kind: 'end', headline: 'Goodnight' }])).toBe(false);
  });

  it('is true once there is real content', () => {
    expect(hasRecap([
      { kind: 'stat', headline: 'x', detail: '' },
      { kind: 'end', headline: 'Goodnight' },
    ])).toBe(true);
  });
});
