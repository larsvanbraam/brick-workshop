import { describe, expect, it } from 'vite-plus/test';
import { getWorldBounds, validateAssembly } from '@brick-workshop/engine';
import type { Brick } from '@brick-workshop/engine';
import { findSpawn, generateChunk } from '@brick-workshop/game/world/generate.ts';
import { MAX_LAYERS } from '@brick-workshop/game/world/terrain.ts';
import { islandTerrain } from './terrain.ts';
import { crossingApproach, crossingLayer } from './crossings.ts';
import { islandColumn } from './column.ts';
import { buildFireStation, buildPoliceStation } from './civic.ts';
import { buildHouse, turnPieces } from './houses.ts';
import { VEHICLES } from '@brick-workshop/vehicles/vehicle';
import { ROADS, VEHICLE_SPAWNS } from './map.ts';
import { islandStructures } from './structures.ts';

const SEED = 7;

describe('Brick Island', () => {
  it('is an island: sea all round, land in the middle, nothing taller than the world allows', () => {
    for (const [x, z] of [
      [-60, 260],
      [700, 260],
      [320, -60],
      [320, 600],
    ])
      expect(islandColumn(SEED, x, z).biome).toBe('sea');
    let land = 0;
    for (let z = 0; z < 520; z += 4)
      for (let x = 0; x < 640; x += 4) {
        const column = islandColumn(SEED, x, z);
        expect(Math.max(column.height, column.water)).toBeLessThanOrEqual(MAX_LAYERS);
        if (!column.water) land++;
      }
    // Most of the 160 by 130 samples are dry land.
    expect(land).toBeGreaterThan(160 * 130 * 0.55);
  });

  it('parks every vehicle on level, open ground, clear of every building', () => {
    const structures = islandStructures(SEED);
    for (const spawn of VEHICLE_SPAWNS) {
      const spec = VEHICLES[spawn.kind];
      const alongX = spawn.heading === 'east' || spawn.heading === 'west';
      const halfX = (alongX ? spec.length : spec.width) / 2;
      const halfZ = (alongX ? spec.width : spec.length) / 2;
      const x0 = Math.floor(spawn.x - halfX);
      const x1 = Math.ceil(spawn.x + halfX);
      const z0 = Math.floor(spawn.z - halfZ);
      const z1 = Math.ceil(spawn.z + halfZ);
      const heights = new Set<number>();
      for (let z = z0; z < z1; z++)
        for (let x = x0; x < x1; x++) {
          const column = islandColumn(SEED, x, z);
          expect(column.water, `${spawn.id} at ${x},${z}`).toBe(0);
          expect(['road', 'pavement', 'yard'], `${spawn.id} at ${x},${z}`).toContain(column.biome);
          heights.add(column.height);
        }
      expect([...heights], spawn.id).toHaveLength(1);
      for (const structure of structures) {
        const { bounds } = structure;
        const clear = bounds.x1 <= x0 || bounds.x0 >= x1 || bounds.z1 <= z0 || bounds.z0 >= z1;
        expect(clear, `${spawn.id} and ${structure.id}`).toBe(true);
      }
    }
  });

  it('lays every road it draws, so every place is joined up', () => {
    for (const road of ROADS)
      for (const [x, z, layer] of road.points) {
        const column = islandColumn(SEED, Math.floor(x), Math.floor(z));
        // The railway's bed is paved ground, and its pieces stand on it.
        const biomes = road.rail ? ['pavement', 'road', 'river'] : ['road', 'river'];
        expect(biomes, `${road.name} at ${x},${z}`).toContain(column.biome);
        // A crossing with the railway, and the steps down to it, are levelled to the track instead.
        if (
          column.biome === 'road' &&
          !road.rail &&
          crossingLayer(Math.floor(x), Math.floor(z)) === null &&
          crossingApproach(Math.floor(x), Math.floor(z)) === null
        )
          expect(column.height).toBe(Math.round(layer));
      }
  });

  it('starts the walker on a road in town', () => {
    const terrain = islandTerrain(SEED);
    const spawn = findSpawn(terrain);
    expect(islandColumn(SEED, Math.floor(spawn.x), Math.floor(spawn.z)).biome).toBe('road');
  });

  it('builds houses that stand up in every turn', () => {
    let seed = 1;
    const next = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const base: Brick[] = [];
    for (let x = 0; x < 16; x += 2)
      for (let z = 0; z < 16; z += 2)
        base.push({ id: `base${x}-${z}`, partId: '3022', color: 2, x, y: 0, z, rotation: 0 });
    for (const [width, depth, storeys] of [
      [8, 6, 1],
      [10, 8, 2],
      [12, 8, 1],
    ] as const)
      for (let quarters = 0; quarters < 4; quarters++) {
        const plan = {
          width,
          depth,
          storeys,
          wall: 15,
          wallShade: 19,
          upper: 19,
          trim: 71,
          roof: 320,
          roofLight: 4,
          frame: 15,
        };
        const pieces = turnPieces(buildHouse(plan, next), quarters, width, depth).map(
          (piece, index) => ({
            ...piece,
            id: `house${index}`,
            x: piece.x + 2,
            y: piece.y + 1,
            z: piece.z + 2,
          }),
        );
        expect(pieces.filter((piece) => piece.partId === '60623')).toHaveLength(1);
        expect(
          validateAssembly({ name: 'house', bricks: [...base, ...pieces], buildArea: 16 }),
        ).toEqual([]);
      }
  });

  it('builds a fire station and a police station, with a jail, that stand up', () => {
    for (const [name, build] of [
      ['fire-station', buildFireStation],
      ['police-station', buildPoliceStation],
    ] as const) {
      let seed = 1;
      const next = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
      const base: Brick[] = [];
      for (let x = 0; x < 32; x += 2)
        for (let z = 0; z < 32; z += 2)
          base.push({ id: `base${x}-${z}`, partId: '3022', color: 2, x, y: 0, z, rotation: 0 });
      const pieces = build(next).map((piece, index) => ({
        ...piece,
        id: `${name}${index}`,
        x: piece.x + 2,
        y: piece.y + 1,
        z: piece.z + 2,
      }));
      expect(validateAssembly({ name, bricks: [...base, ...pieces], buildArea: 32 })).toEqual([]);
      // The police station's cells: bars, and benches behind them.
      if (name === 'police-station')
        expect(pieces.filter((piece) => piece.partId === '15332').length).toBeGreaterThanOrEqual(9);
    }
  });

  it('puts the fire station and the police station on level town ground, off the roads', () => {
    const structures = islandStructures(SEED);
    for (const id of ['fire-station', 'police-station']) {
      const building = structures.find((structure) => structure.id === id)!;
      expect(building, id).toBeDefined();
      const { x0, z0, x1, z1 } = building.bounds;
      for (let z = z0; z < z1; z++)
        for (let x = x0; x < x1; x++) {
          const column = islandColumn(SEED, x, z);
          expect(column.biome, `${id} at ${x},${z}`).toBe('yard');
          expect(column.height, `${id} at ${x},${z}`).toBe(4);
        }
      for (const other of structures)
        if (other !== building)
          expect(
            x0 < other.bounds.x1 &&
              other.bounds.x0 < x1 &&
              z0 < other.bounds.z1 &&
              other.bounds.z0 < z1,
            `${id} and ${other.id}`,
          ).toBe(false);
    }
  });

  it('fills the town with houses that keep off the roads and each other', () => {
    const structures = islandStructures(SEED);
    const houses = structures.filter((structure) => structure.id.startsWith('house'));
    expect(houses.length).toBeGreaterThan(40);
    expect(structures.some((structure) => structure.id === 'lighthouse')).toBe(true);
    expect(
      structures.filter((structure) => structure.id.startsWith('bridge')).length,
    ).toBeGreaterThan(0);
    for (const house of houses) {
      const { x0, z0, x1, z1 } = house.bounds;
      for (let z = z0; z < z1; z++)
        for (let x = x0; x < x1; x++) expect(islandColumn(SEED, x, z).biome).not.toBe('road');
      for (const other of houses)
        if (other !== house)
          expect(
            x0 < other.bounds.x1 &&
              other.bounds.x0 < x1 &&
              z0 < other.bounds.z1 &&
              other.bounds.z0 < z1,
          ).toBe(false);
    }
  });

  it('builds a town chunk with its houses on top of the ground, roads paved', () => {
    const terrain = islandTerrain(SEED);
    const house = islandStructures(SEED).find((structure) => structure.id.startsWith('house'))!;
    const chunk = generateChunk(
      SEED,
      Math.floor(house.anchor.x / 32),
      Math.floor(house.anchor.z / 32),
      terrain,
      Infinity,
    );
    const ids = new Set(chunk.bricks.map((brick) => brick.id));
    expect(ids.size).toBe(chunk.bricks.length);
    expect(chunk.bricks.some((brick) => brick.id.startsWith('house'))).toBe(true);
    expect(chunk.bricks.some((brick) => brick.id.startsWith('ground-tile'))).toBe(true);
    // Every house piece sits at or above the town's ground.
    for (const brick of chunk.bricks)
      if (brick.id.startsWith('house'))
        expect(getWorldBounds(brick).minY).toBeGreaterThanOrEqual(12);
  });
});
