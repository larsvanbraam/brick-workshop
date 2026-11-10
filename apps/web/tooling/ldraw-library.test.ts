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
  CylinderGeometry,
  Float32BufferAttribute,
  Group,
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
import type { Material, ShaderMaterial } from 'three';
import { LDrawBatch, canBatchLDrawModel } from '../src/ldraw-batches';
import { createFallbackGeometry } from '../src/fallback-geometry';
import { getLDrawModelOffset, getMaxZoomDistance, getSceneFrame } from '../src/scene-frame';
import { LDrawLoader } from 'three/addons/loaders/LDrawLoader.js';
import { LDrawConditionalLineMaterial } from 'three/addons/materials/LDrawConditionalLineMaterial.js';
import { PARTS, footprint, getLDrawTransform } from '@lego-builder/brick-engine';
import { cloneLDrawModel } from '../src/ldraw-materials';
import { loadLDrawModels } from '../src/ldraw';
import { inferLDrawPartDefinition, searchCatalog } from '../src/catalog';
import {
  collectLibrary,
  getReferences,
  indexLibrary,
  isExcludedCatalogPart,
  isLibraryPath,
  ldrawLibraryPlugin,
  parsePartHeader,
} from './ldraw-library';

describe('local LDraw assets', () => {
  it('loads only requested models and shares overlapping in-flight requests', async () => {
    const fetch = vi.fn().mockImplementation(
      async () =>
        new Response(JSON.stringify({ available: true, fileMap: {} }), {
          headers: { 'content-type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetch);
    const load = vi
      .spyOn(LDrawLoader.prototype, 'loadAsync')
      .mockImplementation(async () => new Group());
    vi.spyOn(LDrawLoader.prototype, 'preloadMaterials').mockResolvedValue(undefined);
    try {
      const first = loadLDrawModels(['3001', '3001']);
      const second = loadLDrawModels(['3001', '3005']);
      const [initial, expanded] = await Promise.all([first, second]);
      expect(Object.keys(initial)).toEqual(['3001']);
      expect(initial['3001']).toBe(expanded['3001']);
      expect(fetch.mock.calls.map(([url]) => url)).toEqual([
        '/ldraw/manifest.json?parts=3001',
        '/ldraw/manifest.json?parts=3005',
      ]);
      expect(load).toHaveBeenCalledTimes(2);
      await loadLDrawModels(['3001']);
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });

  it('evicts failed model requests so subsequent loads can retry', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('Unavailable', { status: 503 }))
      .mockResolvedValue(
        new Response(JSON.stringify({ available: true, fileMap: {} }), {
          headers: { 'content-type': 'application/json' },
        }),
      );
    vi.stubGlobal('fetch', fetch);
    vi.spyOn(LDrawLoader.prototype, 'loadAsync').mockResolvedValue(new Group());
    vi.spyOn(LDrawLoader.prototype, 'preloadMaterials').mockResolvedValue(undefined);
    try {
      await expect(loadLDrawModels(['3004'])).rejects.toThrow('could not be read');
      expect(Object.keys(await loadLDrawModels(['3004']))).toEqual(['3004']);
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });

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
    const batch = new LDrawBatch((part) => part);
    batch.update(
      bricks.map((brick) => ({ brick, model })),
      16,
    );
    batch.object.updateMatrixWorld(true);
    // One finish, so every face of every brick lands in a single batched mesh.
    expect(batch.meshes).toHaveLength(1);
    const [instances] = batch.meshes;
    expect(instances.instanceCount).toBe(2);
    const hitAt = (x: number) =>
      new Raycaster(new Vector3(x + 0.5 - 8, 4, -7.5), new Vector3(0, -1, 0)).intersectObject(
        batch.object,
      )[0];
    for (const [index, brick] of bricks.entries()) {
      const hit = hitAt(brick.x);
      expect(hit.batchId).toBe(index);
      expect(hit.point.y).toBeCloseTo(1.2);
      expect(instances.userData.brickIds[hit.batchId!]).toBe(brick.id);
    }
    // Moving a brick rewrites only that brick, in the slot it already had.
    const moved = { ...bricks[1], x: 6 };
    batch.update(
      [bricks[0], moved].map((brick) => ({ brick, model })),
      16,
    );
    expect(instances.instanceCount).toBe(2);
    expect(hitAt(bricks[1].x)).toBeUndefined();
    expect(instances.userData.brickIds[hitAt(moved.x).batchId!]).toBe(moved.id);
    batch.update([{ brick: bricks[0], model }], 16);
    expect(hitAt(moved.x)).toBeUndefined();
    expect(canBatchLDrawModel(model)).toBe(true);
    const dispose = vi.spyOn(geometry, 'dispose');
    batch.dispose();
    expect(dispose).not.toHaveBeenCalled();
    geometry.dispose();
  });
  it('leaves out studs that an opaque brick sits on', () => {
    // A 1 x 1 brick: a 24 LDU body below the top (LDraw y = 0) and a stud standing on it.
    const body = new BoxGeometry(20, 24, 20).translate(0, 12, 0);
    const stud = new CylinderGeometry(6, 6, 4, 16).translate(0, -2, 0);
    const model = new Group().add(
      new Mesh(body, new MeshStandardMaterial()),
      new Mesh(stud, new MeshStandardMaterial()),
    );
    const brick = (id: string, y: number, color = 4) => ({
      id,
      partId: '3005',
      color,
      x: 2,
      y,
      z: 2,
      rotation: 0 as const,
    });
    const lower = brick('lower', 0);
    const batch = new LDrawBatch((part) => part);
    const vertices = () => batch.stats().layers[0].vertices;
    batch.update([{ brick: lower, model }], 16);
    const single = vertices();
    const studVertices = stud.toNonIndexed().getAttribute('position').count;
    expect(batch.stats().coveredStuds).toBe(0);

    // Stacked: the lower brick is re-baked without its stud; the top one keeps its own.
    const stacked = [lower, brick('upper', 3)].map((brick) => ({ brick, model }));
    expect(batch.changes(stacked, 16)).toBe(2);
    batch.update(stacked, 16);
    expect(batch.stats().coveredStuds).toBe(1);
    expect(batch.stats().looks).toBe(2);
    expect(vertices()).toBe(single + single - studVertices);

    // A see-through brick shows the stud under it, and so does an exploded view.
    const glass = [lower, brick('upper', 3, 47)].map((brick) => ({ brick, model }));
    batch.update(glass, 16);
    expect(batch.stats().coveredStuds).toBe(0);
    batch.update(stacked, 16, true);
    expect(batch.stats().coveredStuds).toBe(0);

    // Taking the top brick away brings the stud back.
    batch.update(stacked, 16);
    batch.update([{ brick: lower, model }], 16);
    expect(batch.stats().coveredStuds).toBe(0);
    batch.dispose();
  });

  it('leaves out undersides that are closed off below', () => {
    // A 1 x 1 brick with a tube inside its hollow underside, within the 4 LDU walls.
    const body = new BoxGeometry(20, 24, 20).translate(0, 12, 0);
    const tube = new BoxGeometry(8, 16, 8).translate(0, 14, 0);
    const model = new Group().add(
      new Mesh(body, new MeshStandardMaterial()),
      new Mesh(tube, new MeshStandardMaterial()),
    );
    const brick = (id: string, y: number, color = 4, x = 2) => ({
      id,
      partId: '3005',
      color,
      x,
      y,
      z: 2,
      rotation: 0 as const,
    });
    const entries = (...bricks: ReturnType<typeof brick>[]) =>
      bricks.map((brick) => ({ brick, model }));
    const tubeVertices = tube.toNonIndexed().getAttribute('position').count;

    // On a solid ground, the bottom brick is closed off by it; the top one by the studs below.
    const grounded = new LDrawBatch((part) => part, { solidGround: true });
    grounded.update(entries(brick('lower', 0), brick('upper', 3)), 16);
    expect(grounded.stats().closedUndersides).toBe(2);
    const bodyVertices = body.toNonIndexed().getAttribute('position').count;
    expect(grounded.stats().layers[0].vertices).toBe(bodyVertices);
    expect(tubeVertices).toBeGreaterThan(0);
    grounded.dispose();

    // Floating over nothing, or seen through, the underside stays.
    const batch = new LDrawBatch((part) => part);
    batch.update(entries(brick('lower', 0), brick('upper', 3)), 16);
    expect(batch.stats().closedUndersides).toBe(1);
    batch.update(entries(brick('lower', 0), brick('upper', 3, 47)), 16);
    expect(batch.stats().closedUndersides).toBe(0);
    // Half on a brick, half over air: still open.
    batch.update(entries(brick('lower', 0), brick('upper', 3, 4, 2.5)), 16);
    expect(batch.stats().closedUndersides).toBe(0);
    batch.dispose();
  });

  it('places big rebuilds in slices, and a newer update cancels a running one', async () => {
    const geometry = new BoxGeometry(20, 24, 20).translate(0, 12, 0);
    const model = new Group().add(new Mesh(geometry, new MeshStandardMaterial()));
    const bricks = Array.from({ length: 600 }, (_, index) => ({
      id: `brick-${index}`,
      partId: '3005',
      color: 4,
      x: index % 16,
      y: Math.floor(index / 16) * 3,
      z: 0,
      rotation: 0 as const,
    }));
    const entries = bricks.map((brick) => ({ brick, model }));
    const batch = new LDrawBatch((part) => part);
    expect(batch.changes(entries, 16)).toBe(600);
    const reports: number[] = [];
    const first = batch.updateInSlices(entries, 16, false, {
      budget: 0,
      onProgress: (done) => reports.push(done),
    });
    // Before it finishes, the build shrinks to its first 100 bricks.
    await Promise.resolve();
    const second = batch.updateInSlices(entries.slice(0, 100), 16, false, { budget: 0 });
    expect(await first).toBe(false);
    expect(await second).toBe(true);
    expect(reports.length).toBeGreaterThan(0);
    expect(batch.changes(entries.slice(0, 100), 16)).toBe(0);
    const [mesh] = batch.meshes;
    expect(mesh.userData.brickIds.filter(Boolean)).toHaveLength(100);
    // Finishing in slices leaves the same batch a one-shot update does.
    await batch.updateInSlices(entries, 16);
    const once = new LDrawBatch((part) => part);
    once.update(entries, 16);
    expect(mesh.userData.brickIds.filter(Boolean)).toHaveLength(600);
    expect(batch.stats().edgeSegments).toBe(once.stats().edgeSegments);
    batch.dispose();
    once.dispose();
    geometry.dispose();
  });
  it('batches see-through and mirrored faces into a sorted glass layer that faces outward', () => {
    const geometry = new BoxGeometry(20, 24, 20).translate(0, 12, 0);
    const opaque = new Mesh(geometry, new MeshStandardMaterial());
    const glass = new Mesh(
      geometry,
      new MeshStandardMaterial({ color: 0x2255ff, transparent: true, opacity: 0.5 }),
    );
    // Mirrored, as LDraw sub-parts sometimes are: the bake has to turn its triangles back out.
    glass.scale.x = -1;
    const solid = new Group().add(opaque);
    const window = new Group().add(glass);
    expect(canBatchLDrawModel(window)).toBe(true);
    const bricks = [0, 3].map((x, index) => ({
      id: `brick-${index}`,
      partId: '3005',
      color: 4,
      x,
      y: 0,
      z: 0,
      rotation: 0 as const,
    }));
    const batch = new LDrawBatch((part) => part);
    batch.update(
      [
        { brick: bricks[0], model: solid },
        { brick: bricks[1], model: window },
      ],
      16,
    );
    batch.object.updateMatrixWorld(true);
    expect(batch.meshes).toHaveLength(2);
    const layer = batch.meshes.find((mesh) => (mesh.material as Material).transparent)!;
    expect(layer.sortObjects).toBe(true);
    expect((layer.material as Material).depthWrite).toBe(false);
    const color = layer.geometry.getAttribute('color');
    expect(color.itemSize).toBe(4);
    expect(color.getW(0)).toBeCloseTo(0.5);
    const hit = new Raycaster(
      new Vector3(bricks[1].x + 0.5 - 8, 4, -7.5),
      new Vector3(0, -1, 0),
    ).intersectObject(batch.object)[0];
    expect(hit.object).toBe(layer);
    expect(layer.userData.brickIds[hit.batchId!]).toBe('brick-1');
    expect(hit.point.y).toBeCloseTo(1.2);
    const glassEdges = batch.lines.filter((lines) => (lines.material as Material).transparent);
    expect(glassEdges).toHaveLength(2);
    batch.dispose();
    geometry.dispose();
  });
  it('stores conditional edges once and moves ends, controls and direction with the brick', () => {
    const geometry = new BufferGeometry();
    for (const name of ['position', 'control0', 'control1', 'direction'])
      geometry.setAttribute(name, new Float32BufferAttribute([1, 2, 3, 4, 5, 6], 3));
    const model = new Group().add(
      Object.assign(new LineSegments(geometry, new LineBasicMaterial()), {
        isConditionalLine: true,
      }),
    );
    const brick = { id: 'edge', partId: '3005', color: 4, x: 3, y: 3, z: 2, rotation: 90 as const };
    const batch = new LDrawBatch((part) => part);
    batch.update([{ brick, model }], 16, true);
    const transform = new Matrix4().makeRotationY(Math.PI / 2).setPosition(-90, -58.8, -110);
    const lines = batch.lines[1];
    expect(lines.visible).toBe(true);
    expect(batch.lines[0].visible).toBe(false);
    expect(batch.stats().conditionalSegments).toBe(1);
    // The part's edges stay in part space; the brick's turn and place are its instance matrix.
    expect(
      new Vector3().fromBufferAttribute(lines.geometry.getAttribute('control0'), 0).toArray(),
    ).toEqual([1, 2, 3]);
    const placed = lines.getMatrixAt(0, new Matrix4());
    for (const [index, value] of transform.elements.entries())
      expect(placed.elements[index]).toBeCloseTo(value, 5);
    // ...which the conditional shader applies to the ends, both controls and the direction.
    const shader = {
      vertexShader: (lines.material as ShaderMaterial).vertexShader,
      fragmentShader: (lines.material as ShaderMaterial).fragmentShader,
      uniforms: {},
    };
    (lines.material as ShaderMaterial).onBeforeCompile(shader as never, undefined as never);
    expect(shader.vertexShader).toContain('#include <batching_vertex>');
    for (const input of ['position', 'control0', 'control1', 'segmentStart + direction'])
      expect(shader.vertexShader).toContain(`batchingMatrix * vec4( ${input}, 1.0 )`);
    expect(shader.vertexShader).not.toMatch(/modelViewMatrix \* vec4\(/);
    // Both ends test the segment from its start, so they agree on dropping it.
    expect(shader.vertexShader).toContain('batchingMatrix * vec4( segmentStart, 1.0 )');
    expect(shader.vertexShader).toContain('if (discardFlag > 0.5) gl_Position =');
    expect(
      new Vector3().fromBufferAttribute(lines.geometry.getAttribute('segmentStart'), 1).toArray(),
    ).toEqual([1, 2, 3]);
    batch.dispose();
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
  it('renders recognizable non-box foliage and uses native plant bases at every layer', () => {
    for (const part of PARTS.filter((part) => part.family === 'foliage')) {
      const brick = {
        id: 'plant',
        partId: part.id,
        color: 2,
        x: 0,
        y: 3,
        z: 0,
        rotation: 0 as const,
      };
      const geometry = createFallbackGeometry(brick);
      expect(geometry.type, part.id).toBe('BufferGeometry');
      expect(geometry.getAttribute('position').count, part.id).toBeGreaterThan(100);
      expect(getLDrawModelOffset(brick)[1], part.id).toBeCloseTo(
        (part.ldrawBaseY ?? part.height * 8) / 20,
      );
      geometry.dispose();
    }
    for (const partId of ['54200', '11477', '15068'])
      expect(
        getLDrawModelOffset({ id: 'cap', partId, color: 4, x: 0, y: 3, z: 0, rotation: 0 })[1],
      ).toBeCloseTo(0, 8);
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
  it('caps zooming out a little past the starting view, for boards of every size', () => {
    for (const buildArea of [16, 64, 128])
      for (const height of [4, 29])
        for (const aspect of [921 / 745, 375 / 395]) {
          const frame = getSceneFrame(height, 'perspective', aspect, 38, buildArea);
          const start = new Vector3(...frame.position).distanceTo(new Vector3(...frame.target));
          const max = getMaxZoomDistance(buildArea, height, aspect, 38);
          expect(max).toBeGreaterThan(start * 1.4);
          expect(max).toBeLessThan(start * 2);
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
            const batch = new LDrawBatch((part, color) => cloneLDrawModel(part, color, loader));
            batch.update(
              bricks.map((brick) => ({ brick, model })),
              64,
            );
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
            batch.object.updateMatrixWorld(true);
            const expectedBounds = new Box3().setFromObject(reference);
            const actualBounds = new Box3().setFromObject(batch.object);
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
                  brick.x + size.width / 2 - 32 + 0.123,
                  part.height * 0.4 + 4,
                  size.depth / 2 - 32 + 0.217,
                ),
                new Vector3(0, -1, 0),
              );
              const expected = ray.intersectObject(reference)[0];
              const actual = ray.intersectObject(batch.object)[0];
              expect(Boolean(actual), `${part.id} face hit`).toBe(Boolean(expected));
              if (actual && expected) {
                expect(
                  actual.point.distanceTo(expected.point),
                  `${part.id} hit position`,
                ).toBeLessThan(0.0001);
                expect(
                  actual.object.userData.brickIds[actual.batchId!],
                  `${part.id} selected instance`,
                ).toBe(expected.object.userData.brickId);
              }
            }
            batch.dispose();
          }
          const bounds = new Box3().setFromObject(model);
          const quarterTurn = part.ldrawRotation === 90;
          if (
            part.clearance === 'reserved' ||
            [
              '3193a',
              '3192a',
              '60616a',
              '60623',
              '60601',
              '60602',
              '86210',
              '2494',
              '3861c',
              '3853',
            ].includes(part.id)
          ) {
            for (const [axis, extent] of [
              ['x', (quarterTurn ? part.depth : part.width) * 20],
              ['z', (quarterTurn ? part.width : part.depth) * 20],
            ] as const) {
              const center = part.ldrawCenter?.[axis] ?? 0;
              expect(
                bounds.min[axis],
                `${part.id} reserved ${axis} minimum`,
              ).toBeGreaterThanOrEqual(center - extent / 2 - 0.005);
              expect(bounds.max[axis], `${part.id} reserved ${axis} maximum`).toBeLessThanOrEqual(
                center + extent / 2 + 0.005,
              );
            }
            const baseY = part.ldrawBaseY ?? part.height * 8;
            expect(bounds.max.y, `${part.id} native base`).toBeLessThanOrEqual(baseY + 0.01);
            expect(bounds.min.y, `${part.id} reserved height`).toBeGreaterThanOrEqual(
              baseY - part.height * 8 - 4.01,
            );
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
      official: false,
    });
    expect(parsePartHeader('3001', '0 Brick  2 x  4').supported).toBe(true);
    expect(parsePartHeader('3001', '0 Brick  2 x  4').category).toBe('Brick');
    expect(parsePartHeader('3070a', '0 Tile 1 x 1 without Groove').supported).toBe(false);
  });
  it('infers a half-grid envelope and native origin without connections', () => {
    const part = parsePartHeader(
      'runtime-fixture',
      '0 Runtime fixture\n0 !LDRAW_ORG Part UPDATE 2026-01',
    );
    expect(
      inferLDrawPartDefinition(part, {
        min: { x: -15, y: -12, z: -20 },
        max: { x: 15, y: 0, z: 20 },
      }),
    ).toMatchObject({
      id: 'runtime-fixture',
      width: 1.5,
      depth: 2,
      height: 1.5,
      ldrawCenter: { x: 0, z: 0 },
      ldrawBaseY: 0,
      connections: { topStuds: [], bottomReceivers: [] },
    });
    expect(
      inferLDrawPartDefinition(part, {
        min: { x: 0, y: 0, z: 0 },
        max: { x: 20, y: 0, z: 20 },
      }),
    ).toBeNull();
  });
  it('excludes minifigure, DUPLO, and electrical parts', () => {
    for (const header of [
      '0 Minifig Head\n0 !CATEGORY Minifig Head',
      '0 DUPLO brick 2 x 4\n0 !CATEGORY Duplo',
      '0 Electric motor 9V\n0 !CATEGORY Electrical',
      '0 Train cable\n0 !KEYWORDS wire, electric',
    ])
      expect(isExcludedCatalogPart(parsePartHeader('fixture', header))).toBe(true);
    expect(isExcludedCatalogPart(parsePartHeader('3001', '0 Brick 2 x 4'))).toBe(false);
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
  it('serves selective manifests and raw assets without preparing unrelated designs', async () => {
    const root = await mkdtemp(join(tmpdir(), 'ldraw-subset-'));
    try {
      await mkdir(join(root, 'parts', 's'), { recursive: true });
      await writeFile(join(root, 'LDConfig.ldr'), '0 Fixture colors');
      await writeFile(join(root, 'CAreadme.txt'), 'Fixture attribution');
      await writeFile(
        join(root, 'parts', '3001.dat'),
        '0 Brick\n1 16 0 0 0 1 0 0 0 1 0 0 0 1 s/shared.dat',
      );
      await writeFile(join(root, 'parts', 's', 'shared.dat'), '0 Shared geometry');
      const plugin = ldrawLibraryPlugin(root);
      const use = vi.fn();
      if (typeof plugin.configureServer !== 'function') throw new Error('Missing middleware');
      await plugin.configureServer({ middlewares: { use } } as never);
      const middleware = use.mock.calls[0][0] as (
        request: { url: string },
        response: {
          statusCode: number;
          setHeader(name: string, value: string): void;
          end(content: string): void;
        },
        next: () => void,
      ) => Promise<void>;
      const request = async (url: string) => {
        let body = '';
        const response = {
          statusCode: 200,
          setHeader: vi.fn(),
          end(content: string) {
            body = content;
          },
        };
        await middleware({ url }, response, vi.fn());
        return { status: response.statusCode, body };
      };
      expect(await request('/ldraw/LDConfig.ldr')).toEqual({
        status: 200,
        body: '0 Fixture colors',
      });
      expect(await request('/ldraw/CAreadme.txt')).toEqual({
        status: 200,
        body: 'Fixture attribution',
      });
      expect(await request('/ldraw/parts/3001.dat')).toMatchObject({ status: 200 });
      const subset = await request('/ldraw/manifest.json?parts=3001');
      expect(subset.status).toBe(200);
      expect(JSON.parse(subset.body)).toMatchObject({
        available: true,
        parts: ['3001'],
        fileMap: { 's/shared.dat': 's/shared.dat' },
      });
      expect(await request('/ldraw/parts/s/shared.dat')).toEqual({
        status: 200,
        body: '0 Shared geometry',
      });
      expect(await request('/ldraw/manifest.json?parts=unknown')).toMatchObject({ status: 400 });
      expect(await request('/ldraw/manifest.json?parts=3001&parts=3005')).toMatchObject({
        status: 400,
      });
      expect(await request('/ldraw/parts/%2e%2e%2f%2e%2e%2fsecret')).toMatchObject({ status: 400 });
      expect(await request('/ldraw/manifest.json')).toMatchObject({ status: 503 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
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
          '0 Fixture\n0 !LDRAW_ORG Part\n1 16 0 0 0 1 0 0 0 1 0 0 0 1 s\\shared.dat',
        );
      await writeFile(
        join(root, 'parts', 's', 'shared.dat'),
        '0 Shared\n1 16 0 0 0 1 0 0 0 1 0 0 0 1 stud.dat',
      );
      await writeFile(join(root, 'p', 'stud.dat'), '0 Primitive');
      await writeFile(join(root, 'parts', 'unused.dat'), '0 Not supported\n0 !LDRAW_ORG Part');
      await writeFile(
        join(root, 'parts', 'unofficial.dat'),
        '0 Unofficial\n0 !LDRAW_ORG Unofficial_Part',
      );
      await writeFile(
        join(root, 'parts', 'minifig.dat'),
        '0 Minifig Head\n0 !LDRAW_ORG Part\n0 !CATEGORY Minifig Head',
      );
      await writeFile(
        join(root, 'parts', 'duplo.dat'),
        '0 DUPLO brick\n0 !LDRAW_ORG Part\n0 !CATEGORY Duplo',
      );
      await writeFile(
        join(root, 'parts', 'motor.dat'),
        '0 Electric motor\n0 !LDRAW_ORG Part\n0 !CATEGORY Electrical',
      );
      const catalog = await indexLibrary(root);
      expect(catalog.parts).toHaveLength(PARTS.length + 1);
      expect(catalog.parts.filter((part) => part.supported)).toHaveLength(PARTS.length);
      expect(catalog.parts.find((part) => part.id === 'unused')?.supported).toBe(false);
      expect(catalog.parts.some((part) => part.id === 'shared' || part.id === 'stud')).toBe(false);
      expect(
        catalog.parts.some((part) => ['unofficial', 'minifig', 'duplo', 'motor'].includes(part.id)),
      ).toBe(false);
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
