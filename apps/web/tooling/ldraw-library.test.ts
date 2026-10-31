import { describe, expect, it, vi } from 'vite-plus/test';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Box3,
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  LoadingManager,
  Matrix3,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Raycaster,
  Vector3,
} from 'three';
import { canBatchLDrawModel, createLDrawBatch, disposeLDrawBatch } from '../src/ldraw-batches';
import { createFallbackGeometry } from '../src/fallback-geometry';
import { getLDrawModelOffset, getSceneFrame } from '../src/scene-frame';
import { LDrawLoader } from 'three/addons/loaders/LDrawLoader.js';
import { LDrawConditionalLineMaterial } from 'three/addons/materials/LDrawConditionalLineMaterial.js';
import { PARTS, footprint, getLDrawTransform } from '@lego-builder/brick-engine';
import { cloneLDrawModel } from '../src/ldraw-materials';
import { searchCatalog } from '../src/catalog';
import {
  collectLibrary,
  getReferences,
  indexLibrary,
  isLibraryPath,
  parsePartHeader,
} from './ldraw-library';

describe('local LDraw assets', () => {
  it('batches faces with preserved material groups and picks the correct mirrored native instance', () => {
    const geometry = new BoxGeometry(20, 24, 20).translate(0, 12, 0);
    const material = new MeshStandardMaterial();
    const model = new Group().add(new Mesh(geometry, material));
    const bricks = [0, 3].map((x, index) => ({
      id: `brick-${index}`,
      partId: '3005',
      color: 4,
      x,
      y: 0,
      z: 0,
      rotation: index === 0 ? (0 as const) : (90 as const),
    }));
    const batch = createLDrawBatch(bricks, model, 16);
    batch.updateMatrixWorld(true);
    const instances = batch.children[0] as InstancedMesh;
    expect(instances.count).toBe(2);
    expect(instances.geometry).toBe(geometry);
    expect(instances.geometry.groups).toHaveLength(6);
    for (const [index, brick] of bricks.entries()) {
      const ray = new Raycaster(new Vector3(brick.x + 0.5 - 8, 4, -7.5), new Vector3(0, -1, 0));
      const hit = ray.intersectObject(batch)[0];
      expect(hit.instanceId).toBe(index);
      expect(hit.point.y).toBeCloseTo(1.2);
      expect(instances.userData.brickIds[hit.instanceId!]).toBe(brick.id);
    }
    expect(canBatchLDrawModel(model)).toBe(true);
    material.transparent = true;
    expect(canBatchLDrawModel(model)).toBe(false);
    const dispose = vi.spyOn(geometry, 'dispose');
    disposeLDrawBatch(batch);
    expect(dispose).not.toHaveBeenCalled();
    geometry.dispose();
  });
  it('transforms conditional edge controls as points and directions without translation', () => {
    const geometry = new BufferGeometry();
    for (const name of ['position', 'control0', 'control1', 'direction'])
      geometry.setAttribute(name, new Float32BufferAttribute([1, 2, 3, 4, 5, 6], 3));
    const model = new Group().add(new LineSegments(geometry, new LineBasicMaterial()));
    const brick = { id: 'edge', partId: '3005', color: 4, x: 3, y: 3, z: 2, rotation: 90 as const };
    const batch = createLDrawBatch([brick], model, 16, true);
    const transform = new Matrix4().makeRotationY(Math.PI / 2).setPosition(-90, -58.8, -110);
    const lines = batch.children[0] as LineSegments;
    const control = new Vector3().fromBufferAttribute(lines.geometry.getAttribute('control0'), 0);
    const direction = new Vector3().fromBufferAttribute(
      lines.geometry.getAttribute('direction'),
      0,
    );
    expect(control.distanceTo(new Vector3(1, 2, 3).applyMatrix4(transform))).toBeLessThan(0.00001);
    expect(
      direction.distanceTo(
        new Vector3(1, 2, 3).applyMatrix3(new Matrix3().setFromMatrix4(transform)),
      ),
    ).toBeLessThan(0.00001);
    disposeLDrawBatch(batch);
    geometry.dispose();
  });
  it('renders open arch and frame fallbacks rather than solid collision boxes', () => {
    for (const partId of ['3659', '6182', '60592', '60594', '3579', '60596']) {
      const geometry = createFallbackGeometry({
        id: 'mesh',
        partId,
        color: 4,
        x: 0,
        y: 0,
        z: 0,
        rotation: 0,
      });
      const mesh = new Mesh(geometry);
      mesh.updateMatrixWorld();
      const ray = new Raycaster(new Vector3(-10, 0, 0), new Vector3(1, 0, 0));
      expect(ray.intersectObject(mesh), partId).toHaveLength(0);
      geometry.dispose();
    }
  });
  it('keeps every rotated fallback inside its declared body envelope', () => {
    for (const part of PARTS)
      for (const rotation of [0, 90, 180, 270] as const) {
        const geometry = createFallbackGeometry({
          id: 'mesh',
          partId: part.id,
          color: 4,
          x: 0,
          y: 0,
          z: 0,
          rotation,
        });
        geometry.computeBoundingBox();
        const bounds = geometry.boundingBox!;
        expect(bounds.max.x - bounds.min.x).toBeLessThanOrEqual(
          (rotation % 180 ? part.depth : part.width) + 0.001,
        );
        expect(bounds.max.z - bounds.min.z).toBeLessThanOrEqual(
          (rotation % 180 ? part.width : part.depth) + 0.001,
        );
        expect(bounds.max.y - bounds.min.y).toBeLessThanOrEqual(part.height * 0.4 + 0.001);
        geometry.dispose();
      }
  });
  it('frames tall examples in every view across desktop and mobile aspects', () => {
    for (const buildArea of [16, 64])
      for (const height of [4, 19.77, 29])
        for (const aspect of [921 / 745, 375 / 395])
          for (const view of ['perspective', 'top', 'front'] as const) {
            const frame = getSceneFrame(height, view, aspect, 38, buildArea);
            const camera = new PerspectiveCamera(38, aspect, 0.1, 500);
            camera.position.fromArray(frame.position);
            camera.lookAt(...frame.target);
            camera.updateMatrixWorld();
            for (const horizontal of [-buildArea / 2, buildArea / 2])
              for (const vertical of [0, height])
                for (const depth of [-buildArea / 2, buildArea / 2]) {
                  const projected = new Vector3(horizontal, vertical, depth).project(camera);
                  expect(Math.abs(projected.x)).toBeLessThan(0.95);
                  expect(Math.abs(projected.y)).toBeLessThan(0.95);
                }
          }
  });
  it('applies native off-centre slope origins to rendering in all rotations', () => {
    const brick = { id: 'slope', partId: '3039', color: 4, x: 0, y: 0, z: 0, rotation: 0 as const };
    const offsets = ([0, 90, 180, 270] as const).map((rotation) =>
      getLDrawModelOffset({ ...brick, rotation }),
    );
    expect(offsets.map(([horizontal, , depth]) => [horizontal, depth])).toEqual([
      [0, 0.5],
      [0.5, 0],
      [0, -0.5],
      [-0.5, 0],
    ]);
    for (const offset of offsets) expect(offset[1]).toBeCloseTo(1.2, 8);
  });
  const installedLibrary = fileURLToPath(new URL('../../../data/ldraw/', import.meta.url));
  it.skipIf(!existsSync(join(installedLibrary, 'LDConfig.ldr')))(
    'matches every installed native mesh to its supported envelope and centre',
    async () => {
      vi.stubGlobal('ProgressEvent', class extends Event {});
      try {
        const { assets, manifest } = await collectLibrary(installedLibrary);
        const manager = new LoadingManager();
        manager.setURLModifier((url) => {
          if (url.startsWith('data:')) return url;
          const key = posix.normalize(url.replace(/^\/ldraw\//, '')).replace(/^\.\.\//, '');
          const text = assets.get(key) ?? assets.get(`parts/${key}`) ?? assets.get(`p/${key}`);
          if (text === undefined) throw new Error(`Missing mesh dependency: ${key}`);
          return `data:text/plain,${encodeURIComponent(text)}`;
        });
        const loader = new LDrawLoader(manager)
          .setPartsLibraryPath('/ldraw/')
          .setFileMap(manifest.fileMap)
          .setConditionalLineMaterial(LDrawConditionalLineMaterial);
        await loader.preloadMaterials(
          `data:text/plain,${encodeURIComponent(assets.get('LDConfig.ldr')!)}`,
        );
        for (const part of PARTS) {
          const model = await loader.loadAsync(`/ldraw/parts/${part.id}.dat`);
          if (canBatchLDrawModel(model)) {
            const bricks = ([0, 90, 180, 270] as const).map((rotation, index) => ({
              id: `native-${index}`,
              partId: part.id,
              color: 4,
              x: index * 16,
              y: 0,
              z: 0,
              rotation,
            }));
            const batch = createLDrawBatch(bricks, cloneLDrawModel(model, 4, loader), 64);
            const reference = new Group();
            for (const brick of bricks) {
              const size = footprint(brick);
              const root = new Group();
              root.position.set(brick.x + size.width / 2 - 32, 0, brick.z + size.depth / 2 - 32);
              const origin = new Group();
              origin.position.fromArray(getLDrawModelOffset(brick));
              const native = model.clone(true);
              native.scale.set(0.05, -0.05, 0.05);
              native.rotation.y = (getLDrawTransform(brick).rotation * Math.PI) / 180;
              native.traverse((object) => {
                object.userData.brickId = brick.id;
                if (object instanceof LineSegments) object.raycast = () => {};
              });
              origin.add(native);
              root.add(origin);
              reference.add(root);
            }
            reference.updateMatrixWorld(true);
            batch.updateMatrixWorld(true);
            const expectedBounds = new Box3().setFromObject(reference);
            const actualBounds = new Box3().setFromObject(batch);
            expect(
              actualBounds.min.distanceTo(expectedBounds.min),
              `${part.id} batched minimum`,
            ).toBeLessThan(0.0001);
            expect(
              actualBounds.max.distanceTo(expectedBounds.max),
              `${part.id} batched maximum`,
            ).toBeLessThan(0.0001);
            for (const brick of bricks) {
              const size = footprint(brick);
              const ray = new Raycaster(
                new Vector3(
                  brick.x + size.width / 2 - 32,
                  part.height * 0.4 + 4,
                  size.depth / 2 - 32,
                ),
                new Vector3(0, -1, 0),
              );
              const expected = ray.intersectObject(reference)[0];
              const actual = ray.intersectObject(batch)[0];
              expect(Boolean(actual), `${part.id} face hit`).toBe(Boolean(expected));
              if (actual && expected) {
                expect(
                  actual.point.distanceTo(expected.point),
                  `${part.id} hit position`,
                ).toBeLessThan(0.0001);
                expect(
                  actual.object.userData.brickIds[actual.instanceId!],
                  `${part.id} selected instance`,
                ).toBe(expected.object.userData.brickId);
              }
            }
            disposeLDrawBatch(batch);
          }
          const bounds = new Box3().setFromObject(model);
          const quarterTurn = part.ldrawRotation === 90;
          if (['801a', '802a', '3861c', '3853'].includes(part.id)) {
            for (const [axis, extent] of [
              ['x', (quarterTurn ? part.depth : part.width) * 20],
              ['z', (quarterTurn ? part.width : part.depth) * 20],
            ] as const) {
              const center = part.ldrawCenter?.[axis] ?? 0;
              expect(
                bounds.min[axis],
                `${part.id} reserved ${axis} minimum`,
              ).toBeGreaterThanOrEqual(center - extent / 2);
              expect(bounds.max[axis], `${part.id} reserved ${axis} maximum`).toBeLessThanOrEqual(
                center + extent / 2,
              );
            }
            expect(bounds.max.y, `${part.id} body height`).toBeCloseTo(part.height * 8, 2);
            model.traverse((object) => {
              if ('geometry' in object) (object.geometry as { dispose(): void }).dispose();
            });
            continue;
          }
          expect(bounds.max.x - bounds.min.x, `${part.id} width`).toBeCloseTo(
            (quarterTurn ? part.depth : part.width) * 20,
            2,
          );
          expect(bounds.max.z - bounds.min.z, `${part.id} depth`).toBeCloseTo(
            (quarterTurn ? part.width : part.depth) * 20,
            2,
          );
          expect(bounds.max.y, `${part.id} body height`).toBeCloseTo(part.height * 8, 2);
          expect((bounds.max.x + bounds.min.x) / 2, `${part.id} centre X`).toBeCloseTo(
            part.ldrawCenter?.x ?? 0,
            2,
          );
          expect((bounds.max.z + bounds.min.z) / 2, `${part.id} centre Z`).toBeCloseTo(
            part.ldrawCenter?.z ?? 0,
            2,
          );
          model.traverse((object) => {
            if ('geometry' in object) (object.geometry as { dispose(): void }).dispose();
          });
        }
      } finally {
        vi.unstubAllGlobals();
      }
    },
    30_000,
  );
  it('searches IDs, names and keywords while preserving support and category filters', () => {
    const parts = [
      parsePartHeader('30010', '0 Brick 1 x 1'),
      parsePartHeader('3001', '0 Brick 2 x 4'),
      parsePartHeader('3069b', '0 Tile 1 x 2\n0 !KEYWORDS smooth'),
    ];
    expect(searchCatalog(parts, '3001', '', false)[0].id).toBe('3001');
    expect(searchCatalog(parts, 'SMOOTH', 'Tile', false).map((part) => part.id)).toEqual(['3069b']);
    expect(searchCatalog(parts, 'brick 2 4', '', false).map((part) => part.id)).toEqual(['3001']);
    expect(searchCatalog(parts, '', '', true).map((part) => part.id)).toEqual(['3001', '3069b']);
    expect(searchCatalog(parts, 'smooth', '', true).map((part) => part.id)).toEqual(['3069b']);
    expect(searchCatalog(parts, '30010', '', true)).toEqual([]);
    expect(searchCatalog(parts, 'no match', '', false)).toEqual([]);
  });
  it('indexes names, explicit categories, keywords, and support independently', () => {
    expect(
      parsePartHeader(
        '3069b',
        '0 Tile  1 x  2\n0 !CATEGORY Tile\n0 !KEYWORDS smooth, flat\n0 !KEYWORDS panel',
      ),
    ).toEqual({
      id: '3069b',
      name: 'Tile 1 x 2',
      category: 'Tile',
      keywords: ['smooth', 'flat', 'panel'],
      supported: true,
    });
    expect(parsePartHeader('3001', '0 Brick  2 x  4').supported).toBe(true);
    expect(parsePartHeader('3001', '0 Brick  2 x  4').category).toBe('Brick');
    expect(parsePartHeader('3070a', '0 Tile 1 x 1 without Groove').supported).toBe(false);
  });
  it('reads type-1 references without treating comments or faces as dependencies', () => {
    expect(
      getReferences('0 Name: test.dat\r\n1 16 0 0 0 1 0 0 0 1 0 0 0 1 s\\TEST.dat\n4 16 0 0 0'),
    ).toEqual(['s/test.dat']);
  });
  it('rejects traversal and non-relative asset paths', () => {
    for (const path of [
      '../package.json',
      'parts/../../secret',
      '/etc/passwd',
      'parts\\test.dat',
      'parts/./test.dat',
    ])
      expect(isLibraryPath(path)).toBe(false);
    expect(isLibraryPath('parts/s/3001s01.dat')).toBe(true);
  });
  it('returns an explicit fallback when the local library is absent', async () => {
    const result = await collectLibrary(join(tmpdir(), `missing-ldraw-${crypto.randomUUID()}`));
    expect(result.manifest.available).toBe(false);
    expect(result.assets.size).toBe(0);
  });
  it('collects only supported parts and their dependencies, retaining attribution', async () => {
    const sandbox = await mkdtemp(join(tmpdir(), 'ldraw-test-'));
    const root = join(sandbox, 'library');
    try {
      await mkdir(join(root, 'parts', 's'), { recursive: true });
      await mkdir(join(root, 'p'));
      await writeFile(
        join(root, 'LDConfig.ldr'),
        '0 !COLOUR Red CODE 4 VALUE #C91A09 EDGE #333333',
      );
      await writeFile(join(root, 'CAreadme.txt'), 'Fixture attribution');
      for (const part of PARTS)
        await writeFile(
          join(root, 'parts', `${part.id}.dat`),
          '0 Fixture\n1 16 0 0 0 1 0 0 0 1 0 0 0 1 s\\shared.dat',
        );
      await writeFile(
        join(root, 'parts', 's', 'shared.dat'),
        '0 Shared\n1 16 0 0 0 1 0 0 0 1 0 0 0 1 stud.dat',
      );
      await writeFile(join(root, 'p', 'stud.dat'), '0 Primitive');
      await writeFile(join(root, 'parts', 'unused.dat'), '0 Not supported');
      const catalog = await indexLibrary(root);
      expect(catalog.parts).toHaveLength(PARTS.length + 1);
      expect(catalog.parts.filter((part) => part.supported)).toHaveLength(PARTS.length);
      expect(catalog.parts.find((part) => part.id === 'unused')?.supported).toBe(false);
      expect(catalog.parts.some((part) => part.id === 'shared' || part.id === 'stud')).toBe(false);
      const preview = await collectLibrary(root, ['unused']);
      expect(preview.manifest.parts).toEqual(['unused']);
      expect(preview.assets.has('parts/3001.dat')).toBe(false);
      await expect(collectLibrary(root, ['../private'])).rejects.toThrow('Invalid part ID');
      const result = await collectLibrary(root);
      expect(result.manifest.available).toBe(true);
      expect(result.manifest.parts).toHaveLength(PARTS.length);
      expect(result.manifest.fileMap['stud.dat']).toBe('../p/stud.dat');
      expect(result.assets.has('p/stud.dat')).toBe(true);
      expect(result.assets.has('parts/unused.dat')).toBe(false);
      expect(result.manifest.licenses).toContain('CAreadme.txt');
      await rm(join(root, 'parts', '3001.dat'));
      await writeFile(join(sandbox, 'outside.dat'), '0 Private file');
      await symlink(join(sandbox, 'outside.dat'), join(root, 'parts', '3001.dat'));
      await expect(collectLibrary(root)).rejects.toThrow('External LDraw reference');
    } finally {
      await rm(sandbox, { recursive: true, force: true });
    }
  });
});
