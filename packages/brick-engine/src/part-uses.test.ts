import { describe, expect, it } from 'vite-plus/test';
import { PARTS, PART_USE_IDS, getPart, getPartUses, searchParts } from './index.ts';

describe('part uses', () => {
  it('describes only catalogue parts, and every part has uses', () => {
    for (const id of PART_USE_IDS) expect(() => getPart(id)).not.toThrow();
    for (const part of PARTS) expect(getPartUses(part.id).length).toBeGreaterThan(3);
  });

  it('gives every shaped part its own uses rather than its family default', () => {
    const plain = new Set(['brick', 'plate', 'tile', 'tall', 'baseplate']);
    const missing = PARTS.filter(
      (part) => !plain.has(part.family ?? part.kind) && !PART_USE_IDS.includes(part.id),
    ).map((part) => part.id);
    expect(missing).toEqual([]);
  });

  it('finds parts by the job they do, best match first', () => {
    const top = (query: string, count = 3) =>
      searchParts(query)
        .slice(0, count)
        .map((match) => match.part.id);
    expect(top('roof ridge')).toEqual(expect.arrayContaining(['3043', '35464', '3048b']));
    expect(top('stepping stones')).toEqual(expect.arrayContaining(['98138', '14769']));
    expect(top('flag', 2)).toEqual(['2335', '44676a']);
    expect(top('tree', 2)).toEqual(['3470', '3471']);
    expect(top('3001', 1)).toEqual(['3001']);
    expect(searchParts('cornice').map((match) => match.part.id)).toContain('3665a');
    expect(searchParts('side stud')[0].score).toBe(2);
  });

  it('matches nothing for an empty query and searches only the parts given', () => {
    expect(searchParts('')).toEqual([]);
    expect(searchParts('a')).toEqual([]);
    const slopes = PARTS.filter((part) => part.family === 'slope');
    expect(searchParts('roof', slopes).every((match) => match.part.family === 'slope')).toBe(true);
  });
});
