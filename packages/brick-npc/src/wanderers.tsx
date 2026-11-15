import { useEffect, useMemo, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Group, Vector3 } from 'three';
import { loadLDrawModels } from '@brick-workshop/render/ldraw';
import { ANIMAL_PARTS } from '@brick-workshop/render/animal-parts';
import { MINIFIG_BODY, MINIFIG_PARTS } from '@brick-workshop/render/minifig-parts';
import { assembleMinifig, poseMinifig } from '@brick-workshop/walk/minifig';
import type { MinifigOutfit, MinifigRig } from '@brick-workshop/walk/minifig';
import { MINIFIG } from '@brick-workshop/walk/walk';
import type { WalkWorld } from '@brick-workshop/walk/walk';
import { assembleAnimal, poseAnimal } from './animal';
import type { AnimalPart, AnimalRig, Gait } from './animal';
import { WAVE_TIME, createWanderer, stepWanderer } from './wander';
import type { Temper, WanderRules, Wanderer } from './wander';
import { TALK_LEAVE, TALK_RANGE } from './talk';
import type { TalkLink } from './talk';

/** What a wanderer looks like: a minifigure in an outfit, or an animal from its parts. */
export type WandererLook =
  | { kind: 'minifig'; outfit: MinifigOutfit }
  | { kind: 'animal'; parts: readonly AnimalPart[]; gait: Gait };

/** Someone to walk about: where they live, how they look and behave, and their choices' seed. */
export interface WandererSpec {
  /** Stays the same while they are about: a new ID is someone new. */
  id: string;
  /**
   * Where they start and stay near, in scene x and z, and where the ground is: someone whose
   * home turns out to be inside a piece taller than a brick or two stays away.
   */
  x: number;
  z: number;
  y?: number;
  look: WandererLook;
  seed: number;
  temper?: Temper;
  /** Strolling pace, a fraction of the walker's walking speed. */
  pace?: number;
  /** Rules of their own (a pen for farm animals) in place of the shared ones. */
  rules?: WanderRules;
  /** Whether the player can talk to them: people can unless this says otherwise, animals not. */
  talks?: boolean;
}

/** Further than this from the player, in studs, they stand still and are not drawn. */
const ACTIVE_RANGE = 90;

interface Person {
  npc: Wanderer;
  rig: { kind: 'minifig'; rig: MinifigRig & { root: Group } } | { kind: 'animal'; rig: AnimalRig };
  rules: WanderRules | undefined;
  /** The height it moved in at. */
  home: number;
  talks: boolean;
}

/** How long someone keeps facing the player after a line, in seconds. */
const LINGER = 0.8;
/** How high over the feet a speech bubble points, in studs: just over a minifigure's head. */
const BUBBLE_HEIGHT = MINIFIG.height + 0.6;

/** A small seeded 0 to 1 generator (mulberry32). */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Minifigures and animals walking about the world on their own (see `wander.ts`), drawn from
 * their LDraw parts. They come and go with `specs`; each keeps walking where it is while it
 * stays listed. Nobody shows until the parts have loaded, and an animal whose parts the library
 * lacks stays away.
 */
export function Wanderers({
  world,
  specs,
  rules,
  player,
  talk,
}: {
  world: WalkWorld;
  specs: readonly WandererSpec[];
  rules: WanderRules;
  /** Where the player's minifigure stands, in scene units, if anywhere. */
  player: () => { x: number; y: number; z: number } | null;
  /** Who the player can talk to and who is speaking (see `TalkLink`). */
  talk?: TalkLink;
}) {
  const { camera, size, invalidate } = useThree();
  const [head] = useState(() => new Vector3());
  const [models, setModels] = useState<Record<string, Group> | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadLDrawModels([...MINIFIG_PARTS, ...ANIMAL_PARTS])
      .then((loaded) => {
        if (!cancelled) setModels(loaded);
      })
      // Without the animals, extra faces and hats, only people walk, wearing the plain head bare.
      .catch(() => loadLDrawModels(MINIFIG_BODY))
      .then((loaded) => {
        if (!cancelled && loaded) setModels((current) => current ?? loaded);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const [group] = useState(() => new Group());
  const [people] = useState(() => new Map<string, Person>());
  useEffect(() => {
    if (!models) return;
    const wanted = new Set(specs.map((spec) => spec.id));
    for (const [id, person] of people)
      if (!wanted.has(id)) {
        group.remove(person.rig.rig.root);
        people.delete(id);
      }
    for (const spec of specs) {
      if (people.has(spec.id)) continue;
      const from = spec.y ?? 0;
      const y = world.standingHeight(spec.x, spec.z, from);
      // Home is inside something built (a house on that ground): they would stand on its roof.
      if (spec.y !== undefined && y - from > MINIFIG.height / 2) continue;
      const walker = { x: spec.x, y, z: spec.z, velocityY: 0, grounded: true };
      const { look } = spec;
      let rig: Person['rig'];
      if (look.kind === 'minifig')
        rig = { kind: 'minifig', rig: assembleMinifig(models, look.outfit) };
      else {
        const animal = assembleAnimal(models, look.parts, look.gait);
        if (!animal) continue;
        rig = { kind: 'animal', rig: animal };
      }
      rig.rig.root.visible = true;
      group.add(rig.rig.root);
      const traits = { temper: spec.temper, pace: spec.pace };
      people.set(spec.id, {
        npc: createWanderer(walker, seeded(spec.seed), traits),
        rig,
        rules: spec.rules,
        home: y,
        talks: spec.talks ?? look.kind === 'minifig',
      });
    }
  }, [models, specs, people, group, world]);
  useEffect(
    () => () => {
      group.clear();
      people.clear();
    },
    [group, people],
  );
  const near = useMemo(() => ({ x: 0, y: 0, z: 0 }), []);
  useFrame(({ clock }, delta) => {
    const at = player();
    if (at) Object.assign(near, at);
    const walkers = [...people.values()].map((person) => person.npc.walker);
    let nearby: string | null = null;
    let nearest = TALK_RANGE;
    let speaking = false;
    for (const [id, person] of people) {
      const { npc } = person;
      const { walker } = npc;
      const { root } = person.rig.rig;
      const distance = Math.hypot(walker.x - near.x, walker.z - near.z);
      const active = !at || distance < ACTIVE_RANGE;
      root.visible = active;
      if (!active) continue;
      const speaker = talk?.speaker === id;
      if (speaker) npc.talking = LINGER;
      stepWanderer(world, npc, person.rules ?? rules, at, delta, walkers);
      // Lifted out of reach (a piece arrived where it stood, and it landed on top): it leaves.
      if (walker.y > person.home + MINIFIG.height) {
        root.visible = false;
        continue;
      }
      root.position.set(walker.x, walker.y, walker.z);
      root.rotation.y = npc.yaw;
      const motion = {
        stride: npc.stride,
        moved: npc.moved,
        grounded: walker.grounded,
        time: clock.elapsedTime,
      };
      if (person.rig.kind === 'animal') poseAnimal(person.rig.rig, motion);
      else {
        poseMinifig(person.rig.rig, {
          ...motion,
          waving: npc.mode === 'greet' && npc.greeting < WAVE_TIME,
          look: npc.look,
        });
        // Nods along while speaking, and talks with a hand now and then.
        if (speaker) {
          const { rig } = person.rig;
          const time = clock.elapsedTime;
          rig.head?.rotation.set(
            (Math.sin(time * 11) * 0.06 + Math.sin(time * 4.3) * 0.04) * rig.forward,
            npc.look * -rig.forward,
            0,
          );
          rig.leftArm?.rotation.set((0.5 + Math.sin(time * 2.7) * 0.35) * rig.forward, 0, 0);
        }
      }
      if (!at || !person.talks || Math.abs(at.y - walker.y) > 3) continue;
      if (distance < nearest) {
        nearest = distance;
        nearby = id;
      }
      if (speaker && distance < TALK_LEAVE) {
        speaking = true;
        head.set(walker.x, walker.y + BUBBLE_HEIGHT, walker.z).project(camera);
        Object.assign(talk!.anchor, {
          x: ((head.x + 1) / 2) * size.width,
          y: ((1 - head.y) / 2) * size.height,
          // Behind the camera, the projection lands mirrored on screen.
          visible: head.z < 1,
        });
      }
    }
    if (!talk) return;
    talk.setNearby(nearby);
    // The speaker walked off, out of reach or out of the world: the conversation is over.
    if (talk.speaker && !speaking) talk.say(null);
    else if (speaking) invalidate();
  });
  return <primitive object={group} />;
}
