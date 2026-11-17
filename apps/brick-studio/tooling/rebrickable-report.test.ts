import { describe, expect, it } from 'vite-plus/test';
import {
  REFERENCE_GROUPS,
  assemblyItems,
  createCanonical,
  findUnderusedParts,
  rankReferenceParts,
  renderReport,
  suffixRelationships,
  summarise,
  supportedDesigns,
  toRebrickablePart,
} from './rebrickable-report.ts';
import type { Catalogue, Model } from './rebrickable-report.ts';
import { EXAMPLES } from '../../../packages/brick-engine/src/examples/registry.ts';

const parts = new Map([
  ['3001', { name: 'Brick 2 x 4', category: 11 }],
  ['3005', { name: 'Brick 1 x 1', category: 11 }],
  ['3023', { name: 'Plate 1 x 2', category: 14 }],
  ['3069b', { name: 'Tile 1 x 2 with Groove', category: 19 }],
  ['3069bpr0001', { name: 'Tile 1 x 2 with Print', category: 19 }],
  ['3665', { name: 'Brick Sloped Inverted 45° 2 x 1', category: 3 }],
  ['3665a', { name: 'Brick Sloped Inverted 45° 2 x 1 [Old]', category: 3 }],
  ['15573', { name: 'Plate Special 1 x 2 Jumper', category: 9 }],
  ['973c01', { name: 'Torso Assembly', category: 60 }],
  ['49307', { name: 'Brick Curved 1 x 1 x 2/3', category: 37 }],
]);

const catalogue: Catalogue = {
  parts,
  colors: new Map([
    [71, { name: 'Light Bluish Gray' }],
    [15, { name: 'White' }],
  ]),
  canonical: createCanonical([
    { type: 'P', child: '3069bpr0001', parent: '3069b' },
    ...suffixRelationships(parts.keys()),
  ]),
};

const bookshop: Model = {
  id: 'ref-1',
  name: 'Reference one',
  items: [
    { part: '3001', color: 71, quantity: 10 },
    { part: '3023', color: 71, quantity: 20 },
    { part: '3069bpr0001', color: 15, quantity: 5 },
    { part: '3069b', color: 15, quantity: 5 },
    { part: '15573', color: 71, quantity: 10 },
    { part: '973c01', color: 15, quantity: 3 },
  ],
};
const pub: Model = {
  id: 'ref-2',
  name: 'Reference two',
  items: [
    { part: '3005', color: 71, quantity: 40 },
    { part: '3665', color: 71, quantity: 6 },
    { part: '49307', color: 15, quantity: 4 },
  ],
};
const example: Model = {
  id: 'example',
  name: 'Example',
  items: [
    { part: '3001', color: 71, quantity: 80 },
    { part: '3665a', color: 71, quantity: 20 },
  ],
};

describe('Rebrickable report', () => {
  it('folds prints and lettered moulds onto one design', () => {
    expect(catalogue.canonical('3069bpr0001')).toBe(catalogue.canonical('3069b'));
    expect(catalogue.canonical('3665a')).toBe(catalogue.canonical('3665'));
    expect(catalogue.canonical('3001')).toBe('3001');
  });

  it('summarises scale, mix and palette without figures', () => {
    const summary = summarise(bookshop, catalogue);
    expect(summary.pieces).toBe(50);
    expect(summary.designs).toBe(4);
    expect(summary.colors).toBe(2);
    expect(summary.buckets.get('Plates')).toBeCloseTo(0.4);
    expect(summary.buckets.get('Plates special (jumpers, brackets, clips)')).toBeCloseTo(0.2);
    // 30 plates and tiles, plus the 10 jumpers, on 10 bricks.
    expect(summary.platesPerBrick).toBe(4);
    // Plate 1 x 2, both tiles and the jumpers.
    expect(summary.smallShare).toBeCloseTo(0.8);
    expect(summary.palette[0]).toEqual({ color: 71, share: 0.8 });
  });

  it('ranks designs by how many sets use them and labels them by the commonest number', () => {
    const ranked = rankReferenceParts([bookshop, pub], catalogue);
    expect(ranked.find((use) => use.part === '973c01')).toBeUndefined();
    const tile = ranked.find((use) => use.design === catalogue.canonical('3069b'))!;
    expect(tile.part).toBe('3069b');
    expect(tile.quantity).toBe(10);
    expect(ranked[0].quantity).toBe(40);
  });

  it('finds supported designs the examples underuse', () => {
    const ranked = rankReferenceParts([bookshop, pub], catalogue);
    const supported = new Set(['3001', '3005', '15573', '3665'].map(catalogue.canonical));
    const underused = findUnderusedParts(ranked, [example], supported, catalogue);
    expect(underused.map((use) => use.part)).toEqual(['3005', '15573']);
    expect(underused.every((use) => use.exampleShare === 0)).toBe(true);
  });

  it('maps engine part IDs onto Rebrickable numbers', () => {
    expect(toRebrickablePart('3023b', { '3023b': '3023' }, parts)).toBe('3023');
    expect(toRebrickablePart('3665a', {}, parts)).toBe('3665a');
    expect(toRebrickablePart('3001a', {}, parts)).toBe('3001');
    expect(toRebrickablePart('99999', {}, parts)).toBe('99999');
    const supported = supportedDesigns(catalogue, ['3665a', '3069b'], {});
    expect(supported.has(catalogue.canonical('3665'))).toBe(true);
  });

  it('counts an assembly by Rebrickable part and colour', () => {
    const brick = { x: 0, y: 0, z: 0, rotation: 0 as const };
    const items = assemblyItems(
      {
        name: 'Test',
        bricks: [
          { ...brick, id: 'a', partId: '3001', color: 71 },
          { ...brick, id: 'b', partId: '3001', color: 71, y: 3 },
          { ...brick, id: 'c', partId: '3023b', color: 15, y: 6 },
        ],
      },
      catalogue,
      { parts: { '3023b': '3023' }, colors: {} },
    );
    expect(items).toEqual([
      { part: '3001', color: 71, quantity: 2 },
      { part: '3023', color: 15, quantity: 1 },
    ]);
  });

  it('renders every group with its examples, gaps and underused parts', () => {
    const ranked = rankReferenceParts([bookshop, pub], catalogue);
    const report = renderReport({
      retrievedAt: '2026-11-13',
      groups: [{ id: 'g', title: 'Group', sets: ['ref-1', 'ref-2'], examples: ['example'] }],
      references: new Map([bookshop, pub].map((model) => [model.id, summarise(model, catalogue)])),
      examples: new Map([[example.id, summarise(example, catalogue)]]),
      gaps: ranked.filter((use) => use.part === '49307'),
      underused: [],
      referenceCount: 2,
      colorLabel: (color) => `Colour \`${color}\``,
    });
    expect(report).toContain('### Group');
    expect(report).toContain('| ref-1 Reference one | 50 |');
    expect(report).toContain('| **Example** (example) | 100 |');
    expect(report).toContain('| `49307` | Brick Curved 1 x 1 x 2/3 |');
    expect(report).toContain('Colour `71` 80%');
  });

  it('benchmarks only examples that exist', () => {
    const ids = new Set(EXAMPLES.map((entry) => entry.id));
    for (const group of REFERENCE_GROUPS)
      for (const id of group.examples) expect(ids.has(id), id).toBe(true);
  });
});
