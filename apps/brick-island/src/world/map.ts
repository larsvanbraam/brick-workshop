/**
 * Brick Island's map, drawn by hand: the coastline, the hills and the mountain, the lake and the
 * river, the town's streets and the roads that join every part of the island. Everything is in
 * world studs, x running east and z running south, and heights in brick layers (the sea's surface
 * is layer 3). The island is about 600 by 480 studs; `column.ts` turns this plan into ground.
 */

import type { Landmark, VehicleSpawn } from '@brick-workshop/game/game.ts';
import { steamTrainSpec } from '@brick-workshop/vehicles/rail';
import { RAIL_LAYER, railway, stationSpots } from './rail.ts';
import { stationCentre } from './stations.ts';

/** A point on a road, with the road's height there in brick layers. */
export type RoadPoint = readonly [x: number, z: number, layer: number];

export interface Road {
  name: string;
  /** Studs across the tarmac. Odd, so a straight road has a middle stud for its centre line. */
  width: number;
  points: readonly RoadPoint[];
  /** A town street: pavements either side instead of a grass verge. */
  street?: boolean;
  /** A closed loop: the last point joins the first. */
  loop?: boolean;
  /** A railway: track on a levelled bed, with no markings, crossing roads and the river level. */
  rail?: boolean;
}

/**
 * Studs across a road or street: two lanes, each wide enough for the car (5.4 studs) with room
 * to pass, and a middle stud for the centre line.
 */
export const ROAD_WIDTH = 13;

/** The middle the coastline is drawn round. */
export const CENTRE = { x: 320, z: 260 } as const;

/**
 * The coast's distance from the middle every 22.5°, starting due east and turning toward the
 * south (+z): headlands where it reaches out, bays where it draws in.
 */
export const COAST: readonly number[] = [
  295, // east: the speedway's shore
  270,
  305, // south-east: Lighthouse Point
  250,
  248, // south: the harbour
  250,
  215, // south-west: Sunset Bay
  262,
  285, // west
  255,
  275, // north-west: the pinewood's headland
  232,
  238, // north: Summit Peak's cliffs
  226,
  265, // north-east
  262,
];

/** A rise in the land: its middle, how far it reaches and how many layers it adds at the top. */
export interface Hill {
  x: number;
  z: number;
  radius: number;
  height: number;
}

/** Summit Peak, the island's mountain, climbing in terraces to snow. */
export const PEAK: Hill = { x: 330, z: 92, radius: 125, height: 13 };

export const HILLS: readonly Hill[] = [
  { x: 115, z: 165, radius: 75, height: 3 },
  { x: 215, z: 105, radius: 60, height: 3 },
  { x: 560, z: 120, radius: 60, height: 3 },
  { x: 555, z: 450, radius: 55, height: 3 },
  { x: 200, z: 330, radius: 45, height: 1 },
];

/** Stretches of coast that rise as cliffs instead of ending on a beach. */
export const CLIFFS: readonly { x: number; z: number; radius: number }[] = [
  { x: 330, z: 20, radius: 110 },
  { x: 590, z: 470, radius: 60 },
  { x: 610, z: 120, radius: 55 },
];

/** Where the beaches widen into proper bays of sand. */
export const BEACHES: readonly { x: number; z: number; radius: number; width: number }[] = [
  { x: 190, z: 430, radius: 80, width: 22 },
  { x: 610, z: 280, radius: 60, width: 14 },
  { x: 60, z: 300, radius: 60, width: 12 },
];

/** Woods: dense forest round the middle, thinning to its noisy edge. */
export const FORESTS: readonly { x: number; z: number; radius: number }[] = [
  { x: 130, z: 140, radius: 100 },
  { x: 250, z: 70, radius: 55 },
  { x: 500, z: 95, radius: 55 },
];

/** Mirror Lake, in the pinewood, its surface a layer over the surrounding ground. */
export const LAKE = { x: 185, z: 205, rx: 38, rz: 24, level: 6 } as const;

/**
 * The river, from a spring on Summit Peak's southern flank to the sea east of the harbour, with
 * its water's height at each bend.
 */
export const RIVER: readonly RoadPoint[] = [
  [360, 180, 8],
  [378, 222, 7],
  [402, 262, 6],
  [432, 300, 5],
  [448, 345, 4],
  [452, 395, 4],
  [458, 440, 3],
  [462, 520, 3],
];

/** Flat ground for the town, the farm and the speedway, with the layer it is levelled to. */
export interface Flat {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  layer: number;
  /** Studs over which it blends back into the land round it. */
  blend: number;
}

/** Harbour Town: its streets, squares and gardens. */
export const TOWN: Flat = { x0: 228, z0: 322, x1: 418, z1: 466, layer: 4, blend: 10 };
/** The harbour basin, cut into the town's southern edge, with quays round it. */
export const HARBOUR = { x0: 300, z0: 456, x1: 342, z1: 540 } as const;
/** The town square, paved, with the flower stall in it. */
export const SQUARE = { x0: 326, z0: 401, x1: 379, z1: 438 } as const;

/**
 * The fire station and the police station, on the north side of Main Street either side of
 * Church Street, their fronts on the pavement: the corner of each nearest the town's north-west.
 */
export const FIRE_STATION_AT = { x: 332, z: 370 } as const;
export const POLICE_STATION_AT = { x: 280, z: 370 } as const;

export const FARM: Flat = { x0: 95, z0: 282, x1: 190, z1: 352, layer: 5, blend: 10 };
/** The crop fields on the farm. */
export const FIELDS: readonly { x0: number; z0: number; x1: number; z1: number; turn: boolean }[] =
  [
    { x0: 100, z0: 288, x1: 140, z1: 318, turn: false },
    { x0: 100, z0: 322, x1: 140, z1: 348, turn: true },
    { x0: 162, z0: 322, x1: 186, z1: 348, turn: false },
  ];

/** The speedway: an oval track round a grassy infield, for races later. */
export const SPEEDWAY = { x: 508, z: 232, half: 42, radius: 36, layer: 5, width: 17 } as const;
export const SPEEDWAY_FLAT: Flat = { x0: 412, z0: 180, x1: 600, z1: 284, layer: 5, blend: 12 };

/** The lookout on Summit Peak, where the mountain road ends. */
export const LOOKOUT: Flat = { x0: 318, z0: 70, x1: 344, z1: 90, layer: 15, blend: 4 };

/** Lighthouse Point's lighthouse, on a levelled headland. */
export const LIGHTHOUSE: Flat = { x0: 528, z0: 448, x1: 552, z1: 472, layer: 6, blend: 5 };

/** The speedway's oval as a closed road. */
function oval(): RoadPoint[] {
  const { x, z, half, radius, layer } = SPEEDWAY;
  const points: RoadPoint[] = [];
  const steps = 10;
  for (let i = 0; i <= steps; i++) {
    const a = -Math.PI / 2 + (Math.PI * i) / steps;
    points.push([x + half + Math.cos(a) * radius, z + Math.sin(a) * radius, layer]);
  }
  for (let i = 0; i <= steps; i++) {
    const a = Math.PI / 2 + (Math.PI * i) / steps;
    points.push([x - half + Math.cos(a) * radius, z + Math.sin(a) * radius, layer]);
  }
  return points;
}

/**
 * Every road on the island. Junctions share a point and a height, so roads meet level. Town
 * streets run on the grid; the country roads join the town, the farm, the lake, the mountain,
 * the speedway and Lighthouse Point, and loop round so every place has two ways in.
 */
export const ROADS: readonly Road[] = [
  // Harbour Town.
  {
    name: 'Main Street',
    width: ROAD_WIDTH,
    street: true,
    points: [
      [226, 395, 4],
      [420, 395, 4],
    ],
  },
  {
    name: 'Harbour Street',
    width: ROAD_WIDTH,
    street: true,
    points: [
      [240, 445, 4],
      [410, 445, 4],
    ],
  },
  {
    name: 'North Street',
    width: ROAD_WIDTH,
    street: true,
    points: [
      [255, 340, 4],
      [385, 340, 4],
    ],
  },
  {
    name: 'West Street',
    width: ROAD_WIDTH,
    street: true,
    points: [
      [255, 340, 4],
      [255, 445, 4],
    ],
  },
  {
    name: 'Church Street',
    width: ROAD_WIDTH,
    street: true,
    points: [
      [320, 322, 4],
      [320, 445, 4],
    ],
  },
  {
    name: 'East Street',
    width: ROAD_WIDTH,
    street: true,
    points: [
      [385, 340, 4],
      [385, 445, 4],
    ],
  },

  // Out of town to the north, to the crossroads in the middle of the island.
  {
    name: 'Middle Road',
    width: ROAD_WIDTH,
    points: [
      [320, 322, 4],
      [322, 290, 5],
      [326, 252, 6],
    ],
  },
  // The west loop: from the farm lane, round the lake and through the pinewood to the mountain's
  // foot, where it meets Summit Road. The railway runs up the lake's east shore, so the road no
  // longer cuts across the island to the crossroads in the middle.
  {
    name: 'Farm Road',
    width: ROAD_WIDTH,
    points: [
      [102, 246, 5],
      [150, 246, 5],
    ],
  },
  {
    name: 'Lake Road',
    width: ROAD_WIDTH,
    points: [
      [102, 246, 5],
      [84, 196, 6],
      [104, 136, 6],
      [160, 100, 7],
      [228, 128, 8],
      [286, 160, 8],
    ],
  },
  // The farm lane, and the coast road from the farm down to Sunset Bay and into town.
  {
    name: 'Farm Lane',
    width: ROAD_WIDTH,
    points: [
      [150, 246, 5],
      [150, 300, 5],
    ],
  },
  {
    name: 'Bay Road',
    width: ROAD_WIDTH,
    points: [
      [102, 246, 5],
      [88, 320, 5],
      [130, 380, 4],
      [190, 400, 4],
      [226, 395, 4],
    ],
  },
  // Up Summit Peak in switchbacks to the lookout.
  {
    name: 'Summit Road',
    width: ROAD_WIDTH,
    points: [
      [286, 160, 8],
      [356, 146, 10],
      [384, 118, 11],
      [352, 104, 13],
      [300, 104, 14],
      [312, 84, 15],
      [331, 80, 15],
    ],
  },
  // East: to the speedway and on along the mountain's flank back to its foot.
  {
    name: 'Speedway Road',
    width: ROAD_WIDTH,
    points: [
      [326, 252, 6],
      [380, 250, 6],
      [430, 240, 5],
    ],
  },
  {
    name: 'Ridge Road',
    width: ROAD_WIDTH,
    points: [
      [508, 196, 5],
      [494, 160, 6],
      [446, 140, 8],
      [400, 150, 9],
      [356, 146, 10],
    ],
  },
  // From town out east, over the river, to the speedway and to Lighthouse Point.
  {
    name: 'Coast Road',
    width: ROAD_WIDTH,
    points: [
      [420, 395, 4],
      [476, 392, 4],
      [512, 344, 5],
      [512, 268, 5],
    ],
  },
  {
    name: 'Lighthouse Road',
    width: ROAD_WIDTH,
    points: [
      [476, 392, 4],
      [504, 418, 5],
      [522, 442, 6],
    ],
  },
  { name: 'Speedway', width: SPEEDWAY.width, loop: true, points: oval() },
  // The railway round the island, one layer high all the way.
  {
    name: 'Railway',
    width: 9,
    loop: railway().path.closed,
    rail: true,
    points: railway().points.map(([x, z]): RoadPoint => [x, z, RAIL_LAYER]),
  },
];

export const LANDMARKS: readonly Landmark[] = [
  { name: 'Harbour Town', x: 290, z: 368, icon: '🏠' },
  { name: 'Flower Stall', x: 352, z: 419, icon: '🌷' },
  { name: 'Fire Station', x: 345, z: 377, icon: '🚒' },
  { name: 'Police Station', x: 290, z: 377, icon: '🚓' },
  { name: 'Harbour', x: 321, z: 488, icon: '⚓' },
  { name: 'Lighthouse Point', x: 541, z: 462, icon: '💡' },
  { name: 'Speedway', x: 508, z: 232, icon: '🏁' },
  { name: 'Summit Peak', x: 331, z: 80, icon: '⛰️' },
  { name: 'Pinewood', x: 120, z: 140, icon: '🌲' },
  { name: 'Mirror Lake', x: 185, z: 205, icon: '💧' },
  { name: 'Farm', x: 150, z: 312, icon: '🚜' },
  { name: 'Sunset Bay', x: 168, z: 440, icon: '🏖️' },
  { name: 'River Bridge', x: 452, z: 393, icon: '🌉' },
];

/**
 * Where the vehicles are parked when a game starts: the car, the motorcycle and the bike in
 * Harbour Town near the start, the helicopter in the town square, and the race car on the
 * speedway's start line with the airplane on the lawn inside the track, its runway.
 */
export const VEHICLE_SPAWNS: readonly VehicleSpawn[] = [
  { id: 'car', kind: 'car', x: 342, z: 396, heading: 'east' },
  { id: 'motorcycle', kind: 'motorcycle', x: 300, z: 393, heading: 'west' },
  { id: 'bike', kind: 'bike', x: 322, z: 378, heading: 'north' },
  { id: 'helicopter', kind: 'helicopter', x: 370, z: 420, heading: 'north' },
  { id: 'racecar', kind: 'racecar', x: 530, z: 196, heading: 'east' },
  { id: 'airplane', kind: 'airplane', x: 476, z: 232, heading: 'east' },
];

/** The stations are marked on the map. */
export const STATION_LANDMARKS: readonly Landmark[] = stationSpots().map((spot) => ({
  name: spot.name,
  ...stationCentre(spot),
  icon: '🚉',
}));

/**
 * The steam train, waiting at City Station with its middle at the platform's middle, ready to board.
 */
export const TRAIN_SPAWN: VehicleSpawn = (() => {
  const { path } = railway();
  const spec = steamTrainSpec(2);
  const city = stationSpots().find((spot) => spot.id === 'city')!;
  const distance = city.distance + spec.length / 2;
  const front = path.pointAt(distance);
  return {
    id: 'train',
    kind: 'train',
    x: front.x,
    z: front.z,
    heading: 'north',
    rail: { path, spec, distance },
  };
})();
