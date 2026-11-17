import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  BoxGeometry,
  Color,
  CylinderGeometry,
  Matrix4,
  MeshBasicMaterial,
  MeshLambertMaterial,
} from 'three';
import type { Group, InstancedMesh, Mesh } from 'three';
import { PLATE_HEIGHT } from '@brick-workshop/engine';
import type { WalkProbe } from '@brick-workshop/walk/walk-view';
import { hash2 } from '@brick-workshop/game/world/noise.ts';
import { WATER_LAYERS } from '@brick-workshop/game/world/terrain.ts';
import type { Terrain } from '@brick-workshop/game/world/terrain.ts';

/** The sea's surface in scene units. */
const SEA = WATER_LAYERS * 3 * PLATE_HEIGHT;
/** How many sharks are at it round the walker. */
const SHARKS = 2;
/** How far from the walker a jump starts, in studs: out in the distance, not under their feet. */
const NEAR = 55;
const FAR = 130;
/** A jump's length in seconds, how far it carries and how high it goes, in studs. */
const JUMP = [1.9, 2.6] as const;
const REACH = [16, 26] as const;
const HEIGHT = [7, 12] as const;
/** How long a shark lies low between jumps, in seconds. */
const REST = [8, 20] as const;
/** How long a splash ring spreads. */
const SPLASH = 1.1;
/** Studs of open sea a jump needs all round, so sharks stay out where nobody can reach. */
const CLEAR = 24;

/** Offsets round a spot, near and far in eight directions: all open sea, or it is not out of reach. */
const LOOKOUTS = [CLEAR / 2, CLEAR].flatMap((r) =>
  Array.from({ length: 8 }, (_, k) => [
    Math.round(Math.cos((k * Math.PI) / 4) * r),
    Math.round(Math.sin((k * Math.PI) / 4) * r),
  ]),
);
const SLOTS = Array.from({ length: SHARKS }, (_, i) => i);
const ring = new CylinderGeometry(1, 1, 0.06, 20, 1, true);
const foam = new MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false });

type Phase = 'rest' | 'jump';
interface Shark {
  phase: Phase;
  /** Seconds into the phase. */
  t: number;
  /** How long the phase lasts. */
  span: number;
  x: number;
  z: number;
  /** The jump's direction, its reach, its height and its size. */
  dx: number;
  dz: number;
  reach: number;
  lift: number;
  scale: number;
  /** The splash rings: one where it leaves the water, one where it goes back in. */
  splash: [number, number];
  spots: [[number, number], [number, number]];
}

/**
 * Sharks that leap out of the sea in the distance round the walker, arc over and dive back in
 * with a splash: a gimmick for Brick Island's coast. Each picks open deep water, never a lake,
 * the shore or the harbour.
 */
export function Sharks({
  terrain,
  probe,
  size,
}: {
  terrain: Terrain;
  probe: { current: WalkProbe | null };
  size: number;
}) {
  const half = size / 2;
  const invalidate = useThree((state) => state.invalidate);
  const bodies = useRef<(Group | null)[]>([]);
  const rings = useRef<(Mesh | null)[]>([]);
  const [state] = useState((): { n: number; sharks: Shark[] } => ({
    n: 0,
    sharks: Array.from({ length: SHARKS }, (_, i) => ({
      phase: 'rest' as Phase,
      t: 0,
      span: 1 + i * 1.5,
      x: 0,
      z: 0,
      dx: 1,
      dz: 0,
      reach: 20,
      lift: 9,
      scale: 1,
      splash: [SPLASH, SPLASH],
      spots: [
        [0, 0],
        [0, 0],
      ],
    })),
  }));
  // Idle sharks need the scene to wake now and then: the walker's own movement does most of it.
  useEffect(() => {
    const timer = window.setInterval(invalidate, 250);
    return () => window.clearInterval(timer);
  }, [invalidate]);
  const open = useMemo(() => {
    /** Whether a stud (in studs, not scene units) is deep, open sea. */
    return (sx: number, sz: number) => {
      const column = terrain.column(Math.floor(sx), Math.floor(sz));
      return column.water === WATER_LAYERS && column.height < WATER_LAYERS - 1;
    };
  }, [terrain]);
  const random = (a: number, b: number, salt: number) => {
    const s = state;
    return a + (b - a) * hash2(salt, ++s.n, 7);
  };
  useFrame((_, rawDelta) => {
    const s = state;
    const walker = probe.current?.walker;
    if (!walker) return;
    const delta = Math.min(rawDelta, 0.1);
    let busy = false;
    s.sharks.forEach((shark, i) => {
      shark.t += delta;
      for (const k of [0, 1] as const) if (shark.splash[k] < SPLASH) shark.splash[k] += delta;
      if (shark.phase === 'rest' && shark.t >= shark.span) {
        // Look for a stretch of sea, in a random direction, with room round both ends.
        for (let tries = 0; tries < 6; tries++) {
          const angle = random(0, Math.PI * 2, 31 + i);
          const away = random(NEAR, FAR, 37 + i);
          const x = walker.x + Math.cos(angle) * away;
          const z = walker.z + Math.sin(angle) * away;
          const heading = random(0, Math.PI * 2, 41 + i);
          const reach = random(REACH[0], REACH[1], 43 + i);
          const dx = Math.cos(heading);
          const dz = Math.sin(heading);
          const ex = x + dx * reach;
          const ez = z + dz * reach;
          const ok = [
            [x, z],
            [ex, ez],
            [(x + ex) / 2, (z + ez) / 2],
          ].every(([px, pz]) =>
            LOOKOUTS.every(([ox, oz]) => open(px! + ox! + half, half - (pz! + oz!))),
          );
          if (!ok) continue;
          Object.assign(shark, {
            phase: 'jump',
            t: 0,
            span: random(JUMP[0], JUMP[1], 47 + i),
            x,
            z,
            dx,
            dz,
            reach,
            lift: random(HEIGHT[0], HEIGHT[1], 53 + i),
            scale: random(0.8, 1.25, 59 + i),
            spots: [
              [x, z],
              [ex, ez],
            ],
          });
          shark.splash[0] = 0;
          break;
        }
        if (shark.phase === 'rest') {
          shark.t = 0;
          shark.span = 1.5;
        }
      } else if (shark.phase === 'jump' && shark.t >= shark.span) {
        shark.phase = 'rest';
        shark.t = 0;
        shark.span = random(REST[0], REST[1], 61 + i);
        shark.splash[1] = 0;
      }
      const group = bodies.current[i];
      if (group) {
        group.visible = shark.phase === 'jump';
        if (shark.phase === 'jump') {
          busy = true;
          const u = Math.min(1, shark.t / shark.span);
          // A parabola: out of the water at 0, back in at 1.
          const lift = 4 * u * (1 - u) * shark.lift;
          const slope = 4 * (1 - 2 * u) * shark.lift;
          group.position.set(
            shark.x + shark.dx * shark.reach * u,
            SEA + lift,
            shark.z + shark.dz * shark.reach * u,
          );
          // Face along the jump, nose up as it leaves and down as it falls back, with a roll.
          group.rotation.set(0, Math.atan2(-shark.dz, shark.dx), 0, 'YXZ');
          group.rotateZ(Math.atan2(slope, shark.reach));
          group.rotateX((u - 0.5) * 1.6);
          group.scale.setScalar(shark.scale);
        }
      }
      for (const k of [0, 1] as const) {
        const mesh = rings.current[i * 2 + k];
        if (!mesh) continue;
        const spread = shark.splash[k] / SPLASH;
        mesh.visible = spread < 1;
        if (spread < 1) {
          busy = true;
          const [px, pz] = shark.spots[k];
          mesh.position.set(px, SEA + 0.05, pz);
          mesh.scale.set(1 + spread * 6, 1, 1 + spread * 6);
          (mesh.material as MeshBasicMaterial).opacity = 0.8 * (1 - spread);
        }
      }
    });
    if (busy) invalidate();
  });
  return (
    <>
      {SLOTS.map((i) => (
        <group key={i} ref={(g) => void (bodies.current[i] = g)} visible={false}>
          <SharkBody />
        </group>
      ))}
      {SLOTS.flatMap((i) =>
        [0, 1].map((k) => (
          <mesh
            key={`${i}-${k}`}
            ref={(m) => void (rings.current[i * 2 + k] = m)}
            geometry={ring}
            material={foam.clone()}
            visible={false}
            raycast={() => null}
          />
        )),
      )}
    </>
  );
}

/**
 * The shark's plan, bottom layer first: five rows of fourteen studs, tail at the left and the nose
 * at the right. G is grey, W white belly, F darker fin, D an eye.
 */
const PLAN: readonly (readonly string[])[] = [
  ['..............', '....WWWWWWW...', '...WWWWWWWWW..', '....WWWWWWW...', '..............'],
  ['......FF......', '..GGGWWWWWWGG.', '.GGGGWWWWWWWGG', '..GGGWWWWWWGG.', '......FF......'],
  ['......GGGG....', '..GGGGGGGGGDGG', '.GGGGGGGGGGGGG', '..GGGGGGGGGDGG', '......GGGG....'],
  ['..............', '....GGGGGGGG..', '...GGGGGGGGGG.', '....GGGGGGGG..', '..............'],
  ['..............', '..............', 'FF....GGGG....', '..............', '..............'],
  ['..............', '..............', 'FFF...FFF.....', '..............', '..............'],
  ['..............', '..............', '.......FF.....', '..............', '..............'],
];
const SHADES: Record<string, number> = { G: 0x6b7f93, W: 0xe9eef2, F: 0x4d5d6e, D: 0x10151a };
/** A brick is a stud wide and a brick layer (1.2) high; the whole shark is scaled to about 8 long. */
const LAYER_HEIGHT = 1.2;
const brick = new BoxGeometry(1, LAYER_HEIGHT, 1);
const stud = new CylinderGeometry(0.3, 0.3, 0.2, 10);
const plastic = new MeshLambertMaterial({ color: 0xffffff });

/** A shark built from bricks, nose toward +x: its studs and all, from a handful of instances. */
function SharkBody() {
  const cells = useMemo(() => {
    const found: { x: number; y: number; z: number; color: Color; top: boolean }[] = [];
    PLAN.forEach((layer, y) =>
      layer.forEach((row, z) =>
        [...row].forEach((c, x) => {
          const shade = SHADES[c];
          if (shade === undefined) return;
          const above = PLAN[y + 1]?.[z]?.[x];
          found.push({
            x: x - 6.5,
            y: y * LAYER_HEIGHT,
            z: z - 2,
            color: new Color(shade),
            top: above === undefined || above === '.',
          });
        }),
      ),
    );
    return found;
  }, []);
  const place = (mesh: InstancedMesh | null, studs: boolean) => {
    if (!mesh) return;
    const list = studs ? cells.filter((cell) => cell.top) : cells;
    const matrix = new Matrix4();
    list.forEach((cell, i) => {
      matrix.makeTranslation(cell.x, cell.y + (studs ? (LAYER_HEIGHT + 0.2) / 2 : 0), cell.z);
      mesh.setMatrixAt(i, matrix);
      mesh.setColorAt(i, cell.color);
    });
    mesh.count = list.length;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  };
  return (
    <group scale={0.55} raycast={() => null}>
      <instancedMesh
        ref={(m) => place(m, false)}
        args={[brick, plastic, cells.length]}
        frustumCulled={false}
        raycast={() => null}
      />
      <instancedMesh
        ref={(m) => place(m, true)}
        args={[stud, plastic, cells.length]}
        frustumCulled={false}
        raycast={() => null}
      />
    </group>
  );
}
