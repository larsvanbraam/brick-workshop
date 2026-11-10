import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  BoxGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
} from 'three';
import { LDrawLoader } from 'three/addons/loaders/LDrawLoader.js';
import { LDrawConditionalLineMaterial } from 'three/addons/materials/LDrawConditionalLineMaterial.js';
import { COLORS, parseLDrawColors } from '@brick-workshop/engine';
import { COLOR_CONFIG, cloneLDrawModel, colorMaterialProperties, displayHex } from '../src/ldraw-materials';
import { Readable } from 'node:stream';
import { gzipSync } from 'node:zlib';
import { basicInventoryConfiguration, readInventoryEvidence } from './import-inventory';
import { readCatalogueWeight } from './import-masses';

const loader = new LDrawLoader().setConditionalLineMaterial(LDrawConditionalLineMaterial);
beforeAll(async () => {
  vi.stubGlobal('ProgressEvent', class extends Event {});
  await loader.preloadMaterials(`data:text/plain,${encodeURIComponent(COLOR_CONFIG)}`);
});
afterAll(() => vi.unstubAllGlobals());

describe('catalogue weight imports', () => {
  it('reads structured weight fields while requiring the requested item identifier', () => {
    const html =
      '<html><body><h1 id="item-name-title">Brick 1 x 10</h1>Item No: 6111 <span id="item-weight-info">3.8g</span></body></html>';
    expect(readCatalogueWeight(html, '6111')).toEqual({ title: 'Brick 1 x 10', massGrams: 3.8 });
    expect(() => readCatalogueWeight(html, '6112')).toThrow('mismatched');
    for (const weight of ['0g', '-1g', 'Unknown', '3.8kg'])
      expect(() => readCatalogueWeight(html.replace('3.8g', weight), '6111')).toThrow();
    expect(() => readCatalogueWeight('<html><body>No items found</body></html>', '6111')).toThrow();
  });
});

describe('streaming inventory imports', () => {
  const configuration = basicInventoryConfiguration('2026-07-31T00:00:00Z');
  const csv =
    'inventory_id,part_num,color_id,quantity,is_spare\n123,3023,4,2,f\n124,3023,4,1,t\n125,3001,36,1,f\n126,9999,4,1,f\n127,3001,1,0,f\n128,3001,0,1,f\n';
  it('keeps observed mapped combinations, deduplicates, and excludes zero quantities', async () => {
    const evidence = await readInventoryEvidence(Readable.from([csv]), configuration);
    expect(evidence.observations).toEqual([
      { partId: '3023', colorId: 4, inventoryId: 123 },
      { partId: '3001', colorId: 0, inventoryId: 128 },
    ]);
    expect(evidence.mappings.parts['3023b']).toBe('3023');
  });
  it('reads gzip exports and rejects invalid headers, quantities, and inventory IDs', async () => {
    expect(
      (await readInventoryEvidence(Readable.from([gzipSync(csv)]), configuration, true))
        .observations,
    ).toHaveLength(2);
    await expect(
      readInventoryEvidence(Readable.from(['wrong,header\na,b\n']), configuration),
    ).rejects.toThrow('CSV schema');
    await expect(
      readInventoryEvidence(
        Readable.from(['inventory_id,part_num,color_id,quantity\n123,3001,4,-1\n']),
        configuration,
      ),
    ).rejects.toThrow('quantity');
    await expect(
      readInventoryEvidence(
        Readable.from(['inventory_id,part_num,color_id,quantity\n0,3001,4,1\n']),
        configuration,
      ),
    ).rejects.toThrow('inventory ID');
    await expect(
      readInventoryEvidence(Readable.from(['not gzip']), configuration, true),
    ).rejects.toThrow();
  });
});

describe('official color materials', () => {
  it('round-trips the entire palette including material descriptors', () => {
    expect(COLORS).toHaveLength(320);
    // The viewer's palette is LDraw's except for display overrides (Black reads as black).
    expect(parseLDrawColors(COLOR_CONFIG)).toEqual(COLORS.map((color) => ({ ...color, hex: displayHex(color) })));
    expect(displayHex(COLORS.find((color) => color.id === 0)!)).toBe('#05131d');
    expect(COLORS.filter((color) => displayHex(color) !== color.hex).map((color) => color.id)).toEqual([0]);
    expect(COLORS.some((color) => color.id === 16 || color.id === 24)).toBe(false);
    for (const color of COLORS) {
      const material = loader.getMaterial(String(color.id)) as MeshStandardMaterial;
      expect(material.color.getHexString()).toBe(displayHex(color).slice(1).toLowerCase());
      expect(material.opacity).toBe(color.alpha / 255);
      expect(material.transparent).toBe(color.alpha < 255);
      expect(material.roughness).toBe(colorMaterialProperties(color).roughness);
      expect(material.metalness).toBe(colorMaterialProperties(color).metalness);
    }
  });
  it.each([4, 36, 61])(
    'recolors faces and both edge types for color %s without changing fixed colors',
    (colorId) => {
      const model = new Group();
      const main = loader.getMainMaterial() as MeshStandardMaterial;
      const fixed = loader.getMaterial('1') as MeshStandardMaterial;
      const edge = new LineBasicMaterial();
      edge.userData.code = '24';
      const conditional = new LineSegments(new BoxGeometry(), edge);
      Object.assign(conditional, { isConditionalLine: true });
      model.add(
        new Mesh(new BoxGeometry(), [main, fixed]),
        new LineSegments(new BoxGeometry(), edge),
        conditional,
      );
      const clone = cloneLDrawModel(model, colorId, loader);
      const materials = (clone.children[0] as Mesh).material as MeshStandardMaterial[];
      const color = COLORS.find((entry) => entry.id === colorId)!;
      expect(materials[0].userData.code).toBe(String(colorId));
      expect(materials[0].opacity).toBe(color.alpha / 255);
      expect(materials[1].color.getHexString()).toBe(fixed.color.getHexString());
      expect(materials[1]).not.toBe(fixed);
      expect((model.children[0] as Mesh).material).toEqual([main, fixed]);
      const lineMaterial = (clone.children[1] as LineSegments).material as LineBasicMaterial;
      expect(lineMaterial.color.getHexString()).toBe((color.edge as string).slice(1));
      expect(lineMaterial.opacity).toBe(color.alpha / 255);
      expect(
        ((clone.children[2] as LineSegments).material as LineBasicMaterial).userData.code,
      ).toBe(String(colorId));
      expect((clone.children[0] as Mesh).geometry).toBe((model.children[0] as Mesh).geometry);
    },
  );
});
