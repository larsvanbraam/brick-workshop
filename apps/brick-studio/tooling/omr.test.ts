import { describe, expect, it } from 'vitest';
import { flatten, measure, readHeader, splitFiles } from './omr-analyse.ts';
import { formatLayers, neighbourhood } from './omr-excerpt.ts';
import { mainModelUrl, parseSetList } from './omr-fetch.ts';

const MODEL = `0 FILE main.ldr
0 Author: Test Builder [tb]
0 !LICENSE Licensed under CC BY 4.0 : see CAreadme.txt
1 4 0 0 0 1 0 0 0 1 0 0 0 1 wall.ldr
1 15 0 -24 0 0 -1 0 1 0 0 0 0 1 3004.dat
0 FILE wall.ldr
1 16 0 0 0 1 0 0 0 1 0 0 0 1 3001.dat
`;

describe('LDraw flattening', () => {
  it('splits an MPD into files and reads its credit', () => {
    expect([...splitFiles(MODEL).keys()]).toEqual(['main.ldr', 'wall.ldr']);
    expect(readHeader(MODEL)).toEqual({
      author: 'Test Builder [tb]',
      license: 'Licensed under CC BY 4.0',
    });
  });

  it('places sub-model parts, inherits colour 16 and detects a part on its side', () => {
    const placed = flatten(MODEL);
    expect(placed).toHaveLength(2);
    expect(placed[0]).toMatchObject({ part: '3001', color: 4, up: 1 });
    expect(placed[1]).toMatchObject({ part: '3004', color: 15 });
    expect(Math.abs(placed[1]!.up)).toBeLessThan(0.1);
    expect(placed[1]!.y).toBe(3);
  });

  it('needs enough structural parts to measure a model', () => {
    expect(
      measure(flatten(MODEL), new Map([['3001', { name: 'Brick 2 x 4', bucket: 'Bricks' }]])),
    ).toBeUndefined();
  });
});

describe('OMR pages', () => {
  it('reads a set list row and the result count', () => {
    const html = `<tr\n wire:key="a.1110"><td class="column.number"><a href="https://library.ldraw.org/omr/sets/1110"><div class="x fi-size-sm">10176-1</div></a></td>
<td class="column.name"><div class="fi-size-sm">Royal King&#039;s Castle</div></td>
<td class="column.theme.name"><div class="fi-size-sm">Castle &gt; Knights Kingdom II</div></td>
<td class="column.year"><div class="fi-size-sm">2001</div></td></tr> Showing 1 to 1 of 1,472 results`;
    const { sets, total } = parseSetList(html);
    expect(total).toBe(1472);
    expect(sets).toEqual([
      {
        id: 1110,
        number: '10176-1',
        name: "Royal King's Castle",
        theme: 'Castle > Knights Kingdom II',
        year: 2001,
      },
    ]);
  });

  it('picks the main model, not an alternate build', () => {
    const html = `"https://library.ldraw.org/media/omr_models/7/10001-1_B-Model.mpd?v=1" "https://library.ldraw.org/media/omr_models/6/10001-1.mpd?v=1"`;
    expect(mainModelUrl(html, '10001-1')).toBe(
      'https://library.ldraw.org/media/omr_models/6/10001-1.mpd',
    );
  });
});

describe('OMR excerpts', () => {
  it('flattens positions in studs and reads the turn about the vertical', () => {
    const [brick, tile] = flatten(
      [
        '1 4 40 0 -20 0 0 1 0 1 0 -1 0 0 3004.dat',
        '1 15 60 -24 -20 1 0 0 0 1 0 0 0 1 3069b.dat',
      ].join('\n'),
    );
    expect(brick).toMatchObject({ part: '3004', x: 2, z: -1, yaw: 90 });
    expect(tile).toMatchObject({ x: 3, z: -1, yaw: 0, y: 3 });
  });

  it('keeps the parts round a centre and prints them layer by layer', () => {
    const placed = flatten(
      [
        '1 4 0 0 0 1 0 0 0 1 0 0 0 1 2877.dat',
        '1 15 20 -24 0 1 0 0 0 1 0 0 0 1 3069b.dat',
        '1 15 400 0 0 1 0 0 0 1 0 0 0 1 3001.dat',
      ].join('\n'),
    );
    const near = neighbourhood(placed, placed[0]!, 3, 4, 12);
    expect(near.map((p) => p.part).sort()).toEqual(['2877', '3069b']);
    const text = formatLayers(near, placed[0]!, new Map()).join('\n');
    expect(text).toMatch(/y 0\n\s+x\s+0\.0\s+z\s+0\.0\s+yaw\s+0\s+2877/);
    expect(text).toMatch(/y 3\n\s+x\s+1\.0/);
  });
});
