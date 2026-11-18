import { layPlateFloor } from '../board.ts';
import { bottomUp, layTrack } from './layout.ts';
import { addSteamTrain } from './steam-train.ts';
import type { ExampleDefinition } from './types.ts';

// A steam train with two wagons standing on three sections of straight 9V track, on a small
// green board. The train itself is `addSteamTrain` (steam-train.ts), which any build can use.

const SIZE = 64;
const G = 2;
const GRASS = 2;
const TRACK = 72;

export const steamTrain: ExampleDefinition = {
  id: 'steam-train',
  name: 'Steam Train',
  tags: ['train', 'locomotive', 'wagons', 'track'],
  expectedPieceCount: 312,
  buildArea: SIZE,
  build(emit) {
    const { add, flush } = bottomUp(emit);
    const floor = layPlateFloor({ x: 0, z: 0, width: SIZE, depth: SIZE }, GRASS);
    if (!floor) throw new Error('The floor needs whole 16 x 16 modules.');
    for (const brick of floor.bricks)
      add(brick.partId, brick.color, brick.x, brick.y, brick.z, brick.rotation);
    layTrack(add, TRACK, { x: 8, y: G, z: 32, angle: 0 }, 'SSS');
    addSteamTrain(add, { x: 10, y: G + 3, z: 32, heading: 0, wagons: 2 });
    flush();
  },
};
