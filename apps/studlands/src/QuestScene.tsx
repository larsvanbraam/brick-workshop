import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import {
  AdditiveBlending,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
} from 'three';
import { PLATE_HEIGHT, getLDrawTransform } from '@brick-workshop/engine';
import { coloredLDrawModel, loadLDrawModels } from '@brick-workshop/render/ldraw';
import { LDRAW_SCALE } from '@brick-workshop/render/scene-frame';
import { assembleMinifig, poseMinifig } from '@brick-workshop/walk/minifig';
import type { MinifigRig } from '@brick-workshop/walk/minifig';
import { MINIFIG_BODY } from '@brick-workshop/render/minifig-parts';
import { MINIFIG } from '@brick-workshop/walk/walk';
import type { WalkWorld } from '@brick-workshop/walk/walk';
import type { WalkProbe } from '@brick-workshop/walk/walk-view';
import { TALK_RANGE } from '@brick-workshop/npc/talk';
import { QUESTS, buildSize, giverId, questById, takerId } from './quests.ts';
import type { MinifigOutfit } from '@brick-workshop/walk/minifig';
import type { Look, QuestEvent, QuestProgress, Spot } from './quests.ts';
import type { Terrain } from './world/terrain.ts';

/** What the scene shows of the jobs: the one being done, and those finished. */
export interface QuestView {
  active: QuestProgress | null;
  done: ReadonlySet<string>;
}

/** Where everyone about stands, by wanderer ID, in scene units (see `Wanderers`). */
export type Positions = Map<string, { x: number; y: number; z: number }>;

/** A brick layer of ground, in scene units. */
const LAYER = 3 * PLATE_HEIGHT;
/** Further than this, in studs, nothing of a job is drawn. */
const SHOW_RANGE = 140;
/** How close, in studs, the walker comes to pick something up, unless the job says. */
const PICK_REACH = 2.2;
/** How close to come to someone, or somewhere, to hand a thing over. */
const TAKE_REACH = 4;
/** How far up or down, in studs, something can be and still be reached. */
const REACH_HEIGHT = 5;
/** How much bigger than a real piece things to find are drawn, to see them easily. */
const FIND_SCALE = 1.7;

const PARTS = [
  ...new Set(
    QUESTS.flatMap((quest) => {
      const { goal } = quest;
      const looks: Look[] = [];
      const figures: MinifigOutfit[] = [];
      if (goal.kind === 'find') {
        looks.push(goal.look, ...(goal.build ? [goal.build.pieces] : []));
        figures.push(...(goal.crooks ?? []), ...(goal.build?.figures ?? []).map((f) => f.outfit));
      } else if (goal.leave) looks.push(goal.leave);
      return [
        ...looks.flatMap((look) => look.map((piece) => piece.part)),
        ...figures.flatMap((each) => [
          ...MINIFIG_BODY,
          each.head,
          ...(each.headgear ? [each.headgear.part] : []),
        ]),
      ];
    }),
  ),
];

/** A minifigure standing upright and still, for a thief to find or in the cell. */
function buildFigure(outfit: MinifigOutfit, models: Record<string, Group>, scale = 1) {
  const rig = assembleMinifig(models, outfit);
  rig.root.visible = true;
  rig.root.scale.setScalar(scale);
  return { object: rig.root, rig };
}

/** A look built from its loaded parts, standing on its origin in scene units. */
function buildLook(look: Look, models: Record<string, Group>, scale = 1) {
  const ldraw = new Group();
  ldraw.scale.set(LDRAW_SCALE[0] * scale, LDRAW_SCALE[1] * scale, LDRAW_SCALE[2] * scale);
  for (const piece of look) {
    const model = models[piece.part];
    if (!model) continue;
    const object = coloredLDrawModel(model, piece.color);
    const { x, y, z, matrix } = getLDrawTransform({
      id: 'look',
      partId: piece.part,
      color: piece.color,
      x: piece.x ?? 0,
      y: piece.y ?? 0,
      z: piece.z ?? 0,
      rotation: piece.rotation ?? 0,
    });
    const [a, b, c, d, e, f, g, h, i] = matrix;
    new Matrix4()
      .set(a, b, c, x, d, e, f, y, g, h, i, z, 0, 0, 0, 1)
      .decompose(object.position, object.quaternion, object.scale);
    ldraw.add(object);
  }
  const root = new Group();
  root.add(ldraw);
  root.traverse((object) => {
    object.castShadow = true;
  });
  return root;
}

/** A bright arrow pointing down at something to go to, with a column of light under it. */
function makeBeacon(color: number) {
  const root = new Group();
  const arrow = new Mesh(
    new ConeGeometry(0.9, 1.6, 4),
    new MeshBasicMaterial({ color, fog: false }),
  );
  arrow.rotation.x = Math.PI;
  arrow.name = 'arrow';
  root.add(arrow);
  const beam = new Mesh(
    new CylinderGeometry(0.5, 0.9, 40, 12, 1, true),
    new MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.18,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
      fog: false,
    }),
  );
  beam.position.y = 20;
  root.add(beam);
  return root;
}

/** The yellow gem over a helper with a job to give. */
function makeGem() {
  const gem = new Mesh(
    new OctahedronGeometry(0.55),
    new MeshBasicMaterial({ color: 0xffcc00, fog: false }),
  );
  gem.scale.y = 1.5;
  return gem;
}

/**
 * The jobs in the world: a gem over each helper with a job to give, the things to find bobbing
 * where they lie, an arrow and a beam of light over wherever to go next, and what the jobs left
 * behind (the tower, the flag on the top). It watches the walker and says when it picks
 * something up, comes back to the helper or arrives with what it carries.
 */
export function QuestMarks({
  view,
  world,
  terrain,
  buildArea,
  probe,
  positions,
  onEvent,
}: {
  view: QuestView;
  world: WalkWorld;
  terrain: Terrain;
  buildArea: number;
  probe: { current: WalkProbe | null };
  positions: Positions;
  onEvent: (event: QuestEvent) => void;
}) {
  const half = buildArea / 2;
  const [models, setModels] = useState<Record<string, Group> | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadLDrawModels(PARTS)
      .then((loaded) => {
        if (!cancelled) setModels(loaded);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const quest = view.active ? questById(view.active.id) : null;
  const progress = view.active;

  /** Scene x and z of a world spot, and the height to look for ground from. */
  const at = useMemo(
    () => (spot: Spot) => {
      const x = spot.x - half;
      const z = half - spot.z;
      return {
        x,
        z,
        from: terrain.column(Math.floor(spot.x), Math.floor(spot.z)).height * LAYER - LAYER / 2,
      };
    },
    [half, terrain],
  );

  // Everything drawn, rebuilt when the jobs change.
  const [root] = useState(() => new Group());
  const drawn = useRef<{
    items: { index: number; spot: Spot; object: Group; rig?: MinifigRig }[];
    beacons: { spot: Spot | string; object: Group; lift: number }[];
    gems: { id: string; object: Mesh }[];
    fixed: { spot: Spot; object: Group; rig?: MinifigRig }[];
  }>({ items: [], beacons: [], gems: [], fixed: [] });

  useEffect(() => {
    root.clear();
    const items: (typeof drawn.current)['items'] = [];
    const beacons: (typeof drawn.current)['beacons'] = [];
    const gems: (typeof drawn.current)['gems'] = [];
    const fixed: (typeof drawn.current)['fixed'] = [];
    // A gem over every helper whose job is not on, and over this job's helper once it is time
    // to go back.
    for (const each of QUESTS) {
      const own = quest?.id === each.id;
      if (own && progress?.step === 'go') continue;
      if (!own && view.done.has(each.id)) continue;
      const gem = makeGem();
      root.add(gem);
      gems.push({ id: giverId(each), object: gem });
    }
    if (quest && progress && models) {
      const { goal } = quest;
      if (goal.kind === 'find' && progress.step === 'go')
        goal.spots.forEach((spot, index) => {
          if (progress.found.includes(index)) return;
          const crook = goal.crooks?.[index];
          const figure = crook ? buildFigure(crook, models, 1.3) : null;
          const object =
            figure?.object ?? buildLook(goal.look, models, goal.reach ? 1.6 : FIND_SCALE);
          root.add(object);
          items.push({ index, spot, object, rig: figure?.rig });
          const beacon = makeBeacon(0x3ee06a);
          root.add(beacon);
          beacons.push({ spot, object: beacon, lift: 7 });
        });
      if (goal.kind === 'find' && progress.step === 'back') {
        const beacon = makeBeacon(0xffcc00);
        root.add(beacon);
        beacons.push({ spot: giverId(quest), object: beacon, lift: MINIFIG.height + 2.6 });
      }
      if (goal.kind === 'take') {
        const beacon = makeBeacon(0x3ee06a);
        root.add(beacon);
        beacons.push(
          'outfit' in goal.to
            ? { spot: takerId(quest), object: beacon, lift: MINIFIG.height + 2.6 }
            : { spot: goal.to, object: beacon, lift: 4 },
        );
      }
    }
    if (models)
      for (const each of QUESTS) {
        const { goal } = each;
        const own = quest?.id === each.id ? progress : null;
        // The tower: the bricks put on so far, or all of it once built.
        if (goal.kind === 'find' && goal.build) {
          const count = own
            ? own.step === 'build'
              ? own.built
              : 0
            : view.done.has(each.id)
              ? buildSize(goal.build)
              : 0;
          if (count && goal.build.figures) {
            // Each thief in the cell, waving from behind the bars.
            for (const figure of goal.build.figures.slice(0, count)) {
              const made = buildFigure(figure.outfit, models, 1.3);
              root.add(made.object);
              fixed.push({ spot: figure, object: made.object, rig: made.rig });
            }
          } else if (count) {
            const object = buildLook(goal.build.pieces.slice(0, count), models, 1.5);
            root.add(object);
            fixed.push({ spot: goal.build, object });
          }
          if (own?.step === 'build') {
            const beacon = makeBeacon(0xffcc00);
            root.add(beacon);
            beacons.push({ spot: goal.build, object: beacon, lift: 10 });
          }
        }
        if (goal.kind === 'take' && goal.leave && !own && view.done.has(each.id)) {
          const object = buildLook(goal.leave, models, 2);
          root.add(object);
          fixed.push({ spot: goal.to, object });
        }
      }
    drawn.current = { items, beacons, gems, fixed };
    fired.current = '';
  }, [root, models, quest, progress, view.done]);

  /** The last event said, so one is said once until the jobs change. */
  const fired = useRef('');
  const fire = (key: string, event: QuestEvent) => {
    if (fired.current === key) return;
    fired.current = key;
    onEvent(event);
  };

  const ground = (spot: Spot) => {
    const { x, z, from } = at(spot);
    return { x, z, y: world.standingHeight(x, z, from) };
  };

  useFrame(({ clock }) => {
    const walker = probe.current?.walker;
    if (!walker) return;
    const time = clock.elapsedTime;
    const near = (x: number, z: number) => Math.hypot(x - walker.x, z - walker.z) < SHOW_RANGE;
    const { items, beacons, gems, fixed } = drawn.current;
    for (const item of items) {
      const { x, y, z } = ground(item.spot);
      item.object.visible = near(x, z);
      if (!item.object.visible) continue;
      if (item.rig) {
        // A thief stands about, looking this way and that, ready to run.
        item.object.position.set(x, y, z);
        item.object.rotation.y = Math.sin(time * 1.2 + item.index * 2) * 0.8;
        poseMinifig(item.rig, { stride: 0, moved: 0, grounded: true, time });
      } else {
        const bob = 0.5 + Math.sin(time * 2.5 + item.index) * 0.25;
        item.object.position.set(x, y + bob, z);
        item.object.rotation.y = time * 1.5 + item.index;
      }
      const goal = quest?.goal;
      const reach = goal?.kind === 'find' ? (goal.reach ?? PICK_REACH) : PICK_REACH;
      if (Math.hypot(x - walker.x, z - walker.z) < reach && Math.abs(y - walker.y) < REACH_HEIGHT)
        fire(`pick${item.index}`, { kind: 'pick', index: item.index });
    }
    for (const beacon of beacons) {
      const place =
        typeof beacon.spot === 'string' ? positions.get(beacon.spot) : ground(beacon.spot);
      beacon.object.visible = Boolean(place) && near(place!.x, place!.z);
      if (!place || !beacon.object.visible) continue;
      const y = place.y + beacon.lift + Math.sin(time * 4) * 0.35;
      beacon.object.position.set(place.x, y, place.z);
      beacon.object.getObjectByName('arrow')!.rotation.y = time * 2;
    }
    for (const gem of gems) {
      const place = positions.get(gem.id);
      gem.object.visible = Boolean(place) && near(place!.x, place!.z);
      if (!place || !gem.object.visible) continue;
      gem.object.position.set(
        place.x,
        place.y + MINIFIG.height + 1.6 + Math.sin(time * 3) * 0.2,
        place.z,
      );
      gem.object.rotation.y = time * 1.8;
    }
    for (const thing of fixed) {
      const { x, y, z } = ground(thing.spot);
      thing.object.visible = near(x, z);
      thing.object.position.set(x, y, z);
      if (thing.rig)
        poseMinifig(thing.rig, { stride: 0, moved: 0, grounded: true, time, waving: true });
    }
    if (!quest || !progress) return;
    const { goal } = quest;
    // Back to the helper with everything found.
    if (progress.step === 'back') {
      const giver = positions.get(giverId(quest));
      if (
        giver &&
        Math.hypot(giver.x - walker.x, giver.z - walker.z) < TALK_RANGE &&
        Math.abs(giver.y - walker.y) < REACH_HEIGHT
      )
        fire('giver', { kind: 'giver' });
    }
    // Arriving with what is carried.
    if (goal.kind === 'take') {
      const place = 'outfit' in goal.to ? positions.get(takerId(quest)) : ground(goal.to);
      const reach = 'outfit' in goal.to ? TAKE_REACH : TAKE_REACH + 2;
      if (
        place &&
        Math.hypot(place.x - walker.x, place.z - walker.z) < reach &&
        Math.abs(place.y - walker.y) < REACH_HEIGHT
      )
        fire('arrive', { kind: 'arrive' });
    }
  });
  return <primitive object={root} />;
}
