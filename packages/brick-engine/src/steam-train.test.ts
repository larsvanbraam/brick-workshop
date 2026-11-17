import { describe, expect, it } from 'vite-plus/test';
import { assessPhysicalFeasibility, createExampleAssembly, validateAssembly } from './index.ts';
import type { Brick } from './index.ts';
import { layTrack } from './examples/layout.ts';
import { addSteamTrain, steamTrainLength } from './examples/steam-train.ts';
import type { Heading } from './examples/steam-train.ts';

/** A floor, a straight run of track along `heading` and a train of `wagons` standing on it. */
function standing(heading: Heading, wagons: number) {
  const bricks: Brick[] = [];
  const add = (
    partId: string,
    color: number,
    x: number,
    y: number,
    z: number,
    rotation = 0,
    _facing?: unknown,
    _upsideDown?: boolean,
    _tilt?: unknown,
    _strung?: unknown,
    yaw?: number,
  ) => {
    bricks.push({
      id: `b${bricks.length}`,
      partId,
      color,
      x,
      y,
      z,
      rotation: rotation as Brick['rotation'],
      ...(yaw ? { yaw } : {}),
    });
  };
  // Two 16 stud floor layers across a 128 board, so everything has ground to stand on.
  for (const y of [0, 1])
    for (let x = 0; x < 128; x += 16) for (let z = 0; z < 128; z += 16) add('91405', 2, x, y, z);
  const length = steamTrainLength(wagons);
  const sections = Math.ceil(length / 16);
  const start = { x: 64, z: 64 };
  const lead = { 0: [1, 0], 90: [0, 1], 180: [-1, 0], 270: [0, -1] }[heading];
  // Track along the heading, starting a little behind the train's rear.
  const from = { x: start.x - lead[0]! * 4, z: start.z - lead[1]! * 4 };
  layTrack(add, 72, { x: from.x, y: 2, z: from.z, angle: heading }, 'S'.repeat(sections + 1));
  const train = addSteamTrain(add, { x: start.x, y: 5, z: start.z, heading, wagons });
  return { name: 'T', bricks, buildArea: 128, train };
}

describe('steam train', () => {
  it('measures a train by its cars', () => {
    expect(steamTrainLength(0)).toBe(23);
    expect(steamTrainLength(2)).toBe(43);
  });

  it('stands on straight track in all four directions, valid and balanced', () => {
    for (const heading of [0, 90, 180, 270] as const) {
      const { train, ...assembly } = standing(heading, 1);
      expect(validateAssembly(assembly), `heading ${heading}`).toEqual([]);
      const lead = { 0: [1, 0], 90: [0, 1], 180: [-1, 0], 270: [0, -1] }[heading];
      expect(train.front.x).toBe(64 + lead[0]! * train.length);
      expect(train.front.z).toBe(64 + lead[1]! * train.length);
      const report = assessPhysicalFeasibility(assembly, {
        estimateMissingMasses: true,
        useCatalogMasses: true,
        useDefaultStudConnection: true,
      });
      expect(report.gravity, `heading ${heading}`).toBe('balanced');
    }
  });

  it('puts a bogie under each end of every car, on the rails', () => {
    const { bricks } = standing(0, 2);
    const bogies = bricks.filter((brick) => brick.partId === '2878c01');
    // The locomotive, the tender and two wagons have two bogies each.
    expect(bogies).toHaveLength(8);
    for (const bogie of bogies) expect(bogie.y).toBe(5);
  });

  it('ships as a standalone example', () => {
    const assembly = createExampleAssembly('steam-train');
    expect(assembly.bricks.some((brick) => brick.partId === '2878c01')).toBe(true);
    expect(validateAssembly(assembly)).toEqual([]);
  });
});
