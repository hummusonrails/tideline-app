import { describe, it, expect } from 'vitest';
import { uid, eventFilename, dateFolder } from './uuid';

describe('uuid helpers', () => {
  it('generates unique-ish ids', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uid()));
    expect(ids.size).toBe(1000);
  });

  it('builds a sortable event filename', () => {
    const at = new Date(2099, 2, 16, 14, 23, 5);
    expect(eventFilename(at, 'abc123', 'deadbeef', '.json')).toBe('14-23-05-abc123-deadbeef.json');
  });

  it('builds a date folder', () => {
    const at = new Date(2099, 2, 6, 9, 0, 0);
    expect(dateFolder(at)).toBe('2099-03-06');
  });

  it('event filenames sort chronologically within a day', () => {
    const a = eventFilename(new Date(2099, 2, 16, 9, 5, 0), 'x', '1', '.json');
    const b = eventFilename(new Date(2099, 2, 16, 14, 23, 5), 'x', '2', '.json');
    expect([b, a].sort()).toEqual([a, b]);
  });
});
