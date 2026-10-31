import type { ExampleBrickAdder, ExampleDefinition } from './types.ts';

type WallAxis = 'x' | 'z';
type Interval = readonly [number, number];

function addWallRun(
  add: ExampleBrickAdder,
  axis: WallAxis,
  fixed: number,
  y: number,
  start: number,
  end: number,
  material: 'stone' | 'plaster' | 'timber',
  row: number,
  holes: readonly Interval[] = [],
) {
  let cursor = start;
  while (cursor < end) {
    const coveringHole = holes.find(([from, to]) => cursor >= from && cursor < to);
    if (coveringHole) {
      cursor = coveringHole[1];
      continue;
    }
    const nextHole = Math.min(
      end,
      ...holes.filter(([from]) => from > cursor).map(([from]) => from),
    );
    const available = nextHole - cursor;
    const length = available >= 4 && (cursor + row + fixed) % 3 === 0 ? 4 : available >= 2 ? 2 : 1;
    const partId =
      length === 4
        ? material === 'stone'
          ? '15533'
          : '3010'
        : length === 2
          ? material === 'stone'
            ? '98283'
            : '3004'
          : '3005';
    const color =
      material === 'stone'
        ? (cursor + fixed + row) % 4 === 0
          ? 72
          : 71
        : material === 'plaster'
          ? 19
          : (cursor + fixed + row) % 4 === 0
            ? 6
            : 70;
    add(
      partId,
      color,
      axis === 'x' ? cursor : fixed,
      y,
      axis === 'x' ? fixed : cursor,
      axis === 'x' ? 90 : 0,
    );
    cursor += length;
  }
}

function addBarrel(add: ExampleBrickAdder, x: number, z: number) {
  add('3941', 70, x, 1, z);
  for (const y of [4, 7])
    for (const dx of [0, 1]) for (const dz of [0, 1]) add('3062b', 70, x + dx, y, z + dz);
  add('14769', 6, x, 10, z);
}

function addCrate(add: ExampleBrickAdder, x: number, z: number) {
  add('3022', 70, x, 1, z);
  for (const dx of [0, 1]) for (const dz of [0, 1]) add('3005', 70, x + dx, 2, z + dz);
  add('3068b', 6, x, 5, z);
}

export const crookedTankard: ExampleDefinition = {
  id: 'crooked-tankard',
  name: 'The Crooked Tankard',
  tags: ['medieval', 'tavern', 'timber-framed', 'stonework', 'pitched-roof', '24x24'],
  expectedPieceCount: 692,
  buildArea: 24,
  brickIdPrefix: 'tankard',
  build(add) {
    const addFramedWindow = (x: number, y: number, z: number, rotation: 0 | 90) => {
      add('60593', 70, x, y, z, rotation);
    };

    for (const z of [0, 8, 16]) for (const x of [0, 8, 16]) add('41539', 2, x, 0, z);

    const frontWindows: readonly Interval[] = [
      [6, 8],
      [14, 16],
    ];
    const backWindows: readonly Interval[] = [[9, 11]];
    const chimneyWall: readonly Interval[] = [[16, 19]];
    const leftWindow: readonly Interval[] = [[8, 10]];
    const rightWindow: readonly Interval[] = [[15, 17]];

    for (let course = 0; course < 4; course++) {
      const y = 1 + course * 3;
      const doorHole: readonly Interval[] = [[9, 12]];
      addWallRun(add, 'x', 3, y, 3, 20, 'stone', course, [
        ...(course >= 1 ? frontWindows : []),
        ...doorHole,
      ]);
      addWallRun(add, 'x', 21, y, 3, 20, 'stone', course + 1, [
        ...(course >= 1 ? backWindows : []),
        ...chimneyWall,
      ]);
      addWallRun(add, 'z', 2, y, 4, 21, 'stone', course + 2, course >= 1 ? leftWindow : []);
      addWallRun(add, 'z', 20, y, 4, 21, 'stone', course + 3, course >= 1 ? rightWindow : []);
      for (const x of [2, 20]) for (const z of [3, 21]) add('3005', course % 2 ? 72 : 71, x, y, z);
    }

    add('3579', 70, 9, 1, 3, 90);
    add('801a', 70, 9, 1, 2.5, 90);
    for (const x of [8, 12]) {
      add('2453b', 70, x, 1, 2);
      add('3062b', 46, x, 16, 2);
      add('98138', 46, x, 19, 2);
    }
    for (const [x, z, rotation] of [
      [6, 3, 90],
      [14, 3, 90],
      [9, 21, 90],
      [2, 8, 0],
      [20, 15, 0],
    ] as const) {
      addFramedWindow(x, 4, z, rotation);
    }

    for (const x of [1, 5, 9, 13]) add('3020', 70, x, 13, 3, 90);
    add('3795', 70, 17, 13, 3, 90);
    for (const x of [1, 5, 9]) add('3020', 70, x, 13, 20, 90);
    add('3021', 70, 13, 13, 20, 90);
    add('3021', 70, 19, 13, 20, 90);
    for (const x of [1, 20]) {
      for (const z of [5, 9, 13]) add('3020', 70, x, 13, z);
      add('3021', 70, x, 13, 17);
    }

    const bayHole: readonly Interval[] = [[8, 14]];
    const upperFrontWindows: readonly Interval[] = [
      [5, 7],
      [16, 18],
    ];
    const upperBackWindows: readonly Interval[] = [[8, 10]];
    const upperLeftWindow: readonly Interval[] = [[8, 10]];
    const upperRightWindow: readonly Interval[] = [[14, 16]];
    const frontPosts = [2, 4, 14, 20];
    const backPosts = [2, 5, 12, 20];
    const leftPosts = [4, 7, 12, 17, 20];
    const rightPosts = [4, 7, 12, 17, 20];

    for (let course = 0; course < 4; course++) {
      const y = 14 + course * 3;
      const framed = course === 0 || course === 3;
      const frontHoles = course >= 1 ? [...upperFrontWindows, ...bayHole] : [];
      const backHoles = [...(course >= 1 ? upperBackWindows : []), ...chimneyWall];
      const leftHoles = course >= 1 ? upperLeftWindow : [];
      const rightHoles = course >= 1 ? upperRightWindow : [];
      const postHoles = (posts: readonly number[]) =>
        course >= 1 && !framed ? posts.map((post) => [post, post + 1] as const) : [];
      const material = framed ? 'timber' : 'plaster';
      addWallRun(add, 'x', 3, y, 2, 21, material, course, [
        ...frontHoles,
        ...postHoles(frontPosts),
      ]);
      addWallRun(add, 'x', 21, y, 2, 21, material, course + 1, [
        ...backHoles,
        ...postHoles(backPosts),
      ]);
      addWallRun(add, 'z', 1, y, 4, 21, material, course + 2, [
        ...leftHoles,
        ...postHoles(leftPosts),
      ]);
      addWallRun(add, 'z', 21, y, 4, 21, material, course + 3, [
        ...rightHoles,
        ...postHoles(rightPosts),
      ]);
      for (const x of [1, 21]) for (const z of [3, 21]) add('3005', 70, x, y, z);
      if (!framed) {
        for (const x of frontPosts) add('3005', 70, x, y, 3);
        for (const x of backPosts) add('3005', 70, x, y, 21);
        for (const z of leftPosts) add('3005', 70, 1, y, z);
        for (const z of rightPosts) add('3005', 70, 21, y, z);
      }
    }

    for (const [x, z, rotation] of [
      [5, 3, 90],
      [16, 3, 90],
      [8, 21, 90],
      [1, 8, 0],
      [21, 14, 0],
    ] as const) {
      addFramedWindow(x, 17, z, rotation);
    }
    add('60594', 70, 9, 17, 3, 90);

    for (const x of [1, 21])
      for (let course = 0; course < 4; course++) {
        const y = 26 + course * 3;
        const start = 4 + course * 2;
        const end = 21 - course * 2;
        const framed = course === 0 || course === 3;
        const edgeHoles: readonly Interval[] = framed
          ? []
          : [
              [start, start + 1],
              [end - 1, end],
            ];
        addWallRun(
          add,
          'z',
          x,
          y,
          start,
          end,
          framed ? 'timber' : 'plaster',
          course + x,
          edgeHoles,
        );
        if (!framed) {
          add('3005', 70, x, y, start);
          add('3005', 70, x, y, end - 1);
        }
      }

    for (let course = 0; course < 15; course++) {
      const y = 1 + course * 3;
      for (let dx = 0; dx < 3; dx++)
        for (let dz = 0; dz < 3; dz++) {
          const color = (course + dx + dz) % 3 === 0 ? 72 : 71;
          const partId = (course + dx * 2 + dz) % 7 === 0 ? '3062b' : '3005';
          add(partId, color, 16 + dx, y, 20 + dz);
        }
    }
    for (const [x, z] of [
      [16, 20],
      [18, 20],
      [16, 22],
      [18, 22],
    ] as const) {
      add('3062b', 70, x, 46, z);
      add('4589', 6, x, 49, z);
    }

    for (let step = 0; step < 4; step++) {
      const y = 26 + step * 3;
      const frontZ = 1 + step * 2;
      const backZ = 20 - step * 2;
      for (const x of [2, 6, 10, 14]) {
        const color = (x / 4 + step) % 3 === 0 ? 6 : 70;
        add('3297', color, x, y, frontZ);
      }
      add('4161', step % 2 ? 6 : 70, 18, y, frontZ);
      if (step < 2) {
        for (const x of [2, 6, 10]) add('3297', 70, x, y, backZ, 180);
        add('3298', 6, 14, y, backZ, 180);
        add('3298', 70, 19, y, backZ, 180);
      } else {
        for (const x of [2, 6, 10, 14]) add('3297', 70, x, y, backZ, 180);
        add('4161', 6, 18, y, backZ, 180);
      }
    }
    for (let x = 1; x < 21; x += 2) {
      add('3795', 70, x, 38, 9);
      if (x < 7 || x >= 15) add('69729', x % 4 ? 6 : 70, x, 39, 9);
    }

    add('3032', 70, 8, 39, 10, 90);
    for (const y of [40, 43]) {
      addWallRun(add, 'x', 10, y, 9, 13, 'timber', y, [[10, 12]]);
      addWallRun(add, 'x', 13, y, 9, 13, 'timber', y);
      addWallRun(add, 'z', 8, y, 11, 13, 'timber', y);
      addWallRun(add, 'z', 13, y, 11, 13, 'timber', y);
      for (const x of [8, 13]) for (const z of [10, 13]) add('3005', 70, x, y, z);
    }
    add('60592', 70, 10, 40, 10, 90);
    add('3037', 70, 9, 46, 10);
    add('3037', 6, 9, 46, 12, 180);
    add('3020', 70, 9, 49, 11, 90);
    add('87079', 6, 9, 50, 11, 90);

    addBarrel(add, 0, 7);
    addBarrel(add, 22, 8);
    addBarrel(add, 18, 0);
    addCrate(add, 0, 12);
    addCrate(add, 22, 16);
    for (const x of [0, 1]) for (const y of [1, 4, 7]) add('30137', 70, x, y, 16);

    for (const [x, z] of [
      [5, 0],
      [6, 0],
      [5, 1],
      [6, 1],
    ] as const)
      add('3005', 70, x, 1, z);
    add('3022', 70, 5, 4, 0);
    for (const [x, z] of [
      [14, 0],
      [17, 0],
      [14, 1],
      [17, 1],
    ] as const)
      add('3005', 70, x, 1, z);
    add('3020', 70, 14, 4, 0, 90);
    add('3062b', 6, 5, 5, 0);
    add('98138', 70, 5, 8, 0);
    add('3062b', 70, 14, 5, 0);
    add('98138', 70, 14, 8, 0);

    for (const [x, z] of [
      [0, 21],
      [23, 3],
    ] as const) {
      add('2453b', 70, x, 1, z);
      add('3062b', 46, x, 16, z);
      add('98138', 46, x, 19, z);
    }

    add('2412b', 0, 2, 1, 0);
    add('2412b', 0, 21, 1, 1);
    for (const [x, z, color] of [
      [0, 4, 4],
      [22, 4, 14],
    ] as const) {
      add('32607', 2, x, 1, z);
      add('98138', color, x, 2, z + 1);
    }
    for (const [x, z] of [
      [0, 0],
      [0, 2],
      [22, 18],
      [22, 20],
    ] as const) {
      add('32607', 2, x, 1, z);
      add('98138', 4, x, 2, z + 1);
    }
    add('3062b', 19, 0, 1, 10);
    add('98138', 4, 0, 4, 10);
    add('3062b', 19, 23, 1, 12);
    add('98138', 14, 23, 4, 12);

    const reserved = [
      [0, 0, 2, 4],
      [0, 4, 2, 2],
      [0, 7, 2, 2],
      [0, 10, 1, 1],
      [0, 12, 2, 2],
      [0, 16, 2, 4],
      [2, 0, 1, 2],
      [5, 0, 2, 2],
      [8, 2, 1, 1],
      [13, 2, 1, 1],
      [14, 0, 4, 2],
      [18, 0, 2, 2],
      [21, 1, 1, 2],
      [22, 4, 2, 2],
      [22, 8, 2, 2],
      [23, 12, 1, 1],
      [22, 16, 2, 2],
      [22, 18, 2, 4],
      [23, 3, 1, 1],
      [0, 21, 1, 1],
    ];
    const used = new Set<string>();
    for (const [x, z, width, depth] of reserved)
      for (let dx = 0; dx < width; dx++)
        for (let dz = 0; dz < depth; dz++) used.add(`${x + dx}:${z + dz}`);
    for (let z = 0; z < 24; z++)
      for (let x = 0; x < 24; x++) {
        if ((x >= 2 && x < 21 && z >= 3 && z < 22) || used.has(`${x}:${z}`)) continue;
        if ((x * 3 + z * 5) % 3 === 0) add('3070b', (x + z) % 3 ? 71 : 72, x, 1, z);
      }
  },
};
