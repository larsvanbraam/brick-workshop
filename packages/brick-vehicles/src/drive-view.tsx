import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Vector3 } from 'three';
import type { Group } from 'three';
import { loadLDrawModels } from '@brick-workshop/render/ldraw';
import { MINIFIG_PARTS } from '@brick-workshop/render/minifig-parts';
import { MINIFIG, followDistance } from '@brick-workshop/walk/walk';
import type { WalkWorld } from '@brick-workshop/walk/walk';
import { LOOK_RATE, readGamepads } from '@brick-workshop/walk/walk-gamepad';
import type { WalkCamera, WalkProbe } from '@brick-workshop/walk/walk-view';
import { DriveSounds } from './drive-sounds';
import { Smoke } from './smoke';
import { MODELS, modelParts } from './models';
import { buildVehicle, poseVehicle } from './vehicle-model';
import type { VehicleRig } from './vehicle-model';
import {
  IDLE,
  VEHICLES,
  distanceTo,
  exitSpot,
  exitSpots,
  isAtRest,
  forwardOf,
  parkedBoxes,
  settleVehicle,
  stepVehicle,
} from './vehicle';
import type { DriveInput, Vehicle, VehicleKind } from './vehicle';

/** How close the walker must be to a vehicle's side to get in, in studs. */
export const REACH = 2.5;

const KEYS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  /** Climbs in an aircraft; the handbrake on wheels. */
  up: ['Space'],
  down: ['ShiftLeft', 'ShiftRight', 'KeyC'],
  horn: ['KeyH'],
};
const DRIVING = new Set(Object.values(KEYS).flat());
const ENTER = 'KeyE';
/** The standard gamepad's X button (square on a PlayStation pad): gets in and out. */
const PAD_X = 2;

const LOOK_SPEED = 0.0022;
/** After this long without looking round, the camera swings back behind the vehicle. */
const LOOK_RETURN = 1.4;

/** Keys typed into a field are text, not driving. */
function isTyping(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

/** The vehicle within reach of the walker, nearest first, or null. */
export function vehicleInReach(
  vehicles: readonly Vehicle[],
  walker: { x: number; y: number; z: number },
) {
  let best: Vehicle | null = null;
  let bestDistance = REACH;
  for (const vehicle of vehicles) {
    if (!vehicle.settled || vehicle.driven) continue;
    const spec = VEHICLES[vehicle.kind];
    // A train's rails stand on a bed a layer or more above the ground the walker comes along.
    const below = spec.handling === 'rail' ? 3.5 : 2;
    if (walker.y < vehicle.y - below || walker.y > vehicle.y + spec.height + 1) continue;
    const distance = distanceTo(vehicle, walker.x, walker.z);
    if (distance < bestDistance) {
      best = vehicle;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * The island's vehicles: drawn where they stand, solid to walk into while parked, and driven by the
 * minifigure. E (or a controller's X) gets in when the walker is beside one and out again. On
 * wheels W and S drive and brake, A and D steer and Space is the handbrake; a helicopter climbs
 * with Space and sinks with Shift, and an airplane pulls up and dives with them. H sounds the
 * horn. While driving the vehicle takes the camera over from walking, following behind it (or
 * from the driver's seat in first person), and keeps the walker with it.
 */
export function Vehicles({
  vehicles,
  world,
  probe,
  driving,
  onDrive,
  onNear,
  view,
  onViewChange,
  active,
  sound = true,
}: {
  /** The vehicles, which this moves; the caller keeps them, for saving where they are. */
  vehicles: readonly Vehicle[];
  world: WalkWorld;
  /** The walker, which drives along with its vehicle and gets out beside it. */
  probe: { current: WalkProbe | null };
  /** The vehicle being driven, by ID. */
  driving: string | null;
  /** Getting in (an ID) or out (null); `flying` asks the walker to fly, out of an aircraft. */
  onDrive: (id: string | null, flying?: boolean) => void;
  /** The vehicle the walker could get in now, whenever that changes. */
  onNear: (kind: VehicleKind | null) => void;
  view: WalkCamera;
  onViewChange?: (view: WalkCamera) => void;
  /** Off while a menu is open: no getting in or out, and the vehicle coasts. */
  active: boolean;
  sound?: boolean;
}) {
  const { camera, gl, invalidate } = useThree();
  const [models, setModels] = useState<Record<string, Group> | null>(null);
  useEffect(() => {
    let cancelled = false;
    const parts = new Set<string>(MINIFIG_PARTS);
    for (const model of Object.values(MODELS))
      for (const part of modelParts(model)) parts.add(part);
    loadLDrawModels([...parts])
      .then((loaded) => {
        if (!cancelled) setModels(loaded);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const rigs = useMemo(() => {
    const built = new Map<string, VehicleRig>();
    if (models)
      for (const vehicle of vehicles)
        built.set(vehicle.id, buildVehicle(MODELS[vehicle.kind], models));
    return built;
  }, [models, vehicles]);
  useEffect(() => {
    invalidate();
  }, [rigs, invalidate]);

  const state = useRef({
    driving,
    onDrive,
    onNear,
    onViewChange,
    active,
    view,
    /** A press of E (or X) waiting to be acted on. */
    toggle: false,
    honk: false,
    near: null as VehicleKind | null,
    /** Vehicles whose boxes stand in the walk world, by where they stood when parked. */
    parked: new Map<string, string>(),
    /** The height each model is drawn at, easing toward its vehicle's. */
    shown: new Map<string, number>(),
    look: { yaw: 0, pitch: 0, idle: 0 },
    /** The follow camera: its heading as it swings round after the vehicle, and its distance. */
    chase: { yaw: Number.NaN, distance: 0 },
    padHeld: {},
    padX: false,
    bumped: 0,
  });
  useEffect(() => {
    Object.assign(state.current, { driving, onDrive, onNear, onViewChange, active, view });
    invalidate();
  }, [driving, onDrive, onNear, onViewChange, active, view, invalidate]);

  const held = useRef(new Set<string>());
  const [sounds] = useState(() => new DriveSounds());
  useEffect(() => sounds.setEnabled(sound), [sounds, sound]);
  useEffect(() => () => sounds.dispose(), [sounds]);
  // The engine starts on getting in and stops on getting out.
  const drivenKind = vehicles.find((vehicle) => vehicle.id === driving)?.kind ?? null;
  useEffect(() => {
    held.current.clear();
    const live = state.current;
    live.look = { yaw: 0, pitch: 0, idle: 0 };
    live.chase = { yaw: Number.NaN, distance: 0 };
    if (!drivenKind) {
      sounds.stop();
      return;
    }
    sounds.wake();
    sounds.start(drivenKind);
  }, [drivenKind, sounds]);
  // Whoever is driving at the start (a resumed game) is at the controls.
  useEffect(() => {
    for (const vehicle of vehicles) vehicle.driven = vehicle.id === driving;
  }, [vehicles, driving]);

  useEffect(() => {
    const element = gl.domElement;
    const keydown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;
      const live = state.current;
      if (!live.active) return;
      if (event.code === ENTER && !event.repeat) {
        live.toggle = true;
        sounds.wake();
        invalidate();
        return;
      }
      if (!live.driving || !DRIVING.has(event.code)) return;
      event.preventDefault();
      // Keeps walking's own keys (Space jumps) out of it.
      event.stopImmediatePropagation();
      if (KEYS.horn.includes(event.code) && !event.repeat) live.honk = true;
      held.current.add(event.code);
      invalidate();
    };
    const keyup = (event: KeyboardEvent) => {
      held.current.delete(event.code);
    };
    const blur = () => held.current.clear();
    let dragging = false;
    const down = (event: PointerEvent) => {
      if (event.button === 0) dragging = true;
    };
    const up = () => {
      dragging = false;
    };
    const move = (event: MouseEvent) => {
      const live = state.current;
      if (!live.driving) return;
      if (document.pointerLockElement !== element && !dragging) return;
      live.look.yaw -= event.movementX * LOOK_SPEED;
      live.look.pitch = Math.max(
        -1.2,
        Math.min(1.2, live.look.pitch - event.movementY * LOOK_SPEED),
      );
      live.look.idle = 0;
    };
    window.addEventListener('keydown', keydown, true);
    window.addEventListener('keyup', keyup, true);
    window.addEventListener('blur', blur);
    element.addEventListener('pointerdown', down);
    window.addEventListener('pointerup', up);
    document.addEventListener('mousemove', move);
    return () => {
      window.removeEventListener('keydown', keydown, true);
      window.removeEventListener('keyup', keyup, true);
      window.removeEventListener('blur', blur);
      element.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up);
      document.removeEventListener('mousemove', move);
    };
  }, [gl, invalidate, sounds]);

  const [smoke] = useState(() => new Smoke());
  useEffect(() => () => smoke.dispose(), [smoke]);
  const chimney = useMemo(() => new Vector3(), []);

  const target = useMemo(() => new Vector3(), []);
  const behind = useMemo(() => new Vector3(), []);
  const eye = useMemo(() => new Vector3(), []);

  useFrame((_, delta) => {
    const live = state.current;
    const walker = probe.current?.walker;
    const look = probe.current?.look;
    let animating = false;

    // A controller: X gets in and out, the sticks and triggers drive.
    const pads = typeof navigator !== 'undefined' ? navigator.getGamepads?.() : undefined;
    const pad = pads ? readGamepads(pads, live.padHeld, 'walk') : null;
    const xDown = Boolean(
      pads && [...pads].some((entry) => entry?.connected && entry.buttons[PAD_X]?.pressed),
    );
    if (xDown && !live.padX && live.active) live.toggle = true;
    live.padX = xDown;

    const current = live.driving
      ? vehicles.find((vehicle) => vehicle.id === live.driving)
      : undefined;

    if (live.toggle && walker) {
      live.toggle = false;
      if (current) {
        // Getting out: the vehicle is left to roll to a stop (or settle, in the air), and the
        // walker is set down beside it, flying if it was up in the air.
        current.driven = false;
        const spec = VEHICLES[current.kind];
        const airborne = !current.grounded && spec.handling !== 'ground';
        // A train stops dead where it stands, so none of its cars runs on through the walker.
        if (current.rail) {
          current.rail.train.speed = 0;
          current.speed = 0;
        }
        if (isAtRest(current)) {
          world.setBoxes(boxKey(current), parkedBoxes(current));
          live.parked.set(current.id, parkedAt(current));
        }
        const fits = (x: number, z: number) => {
          const y = airborne ? current.y : world.standingHeight(x, z, current.y);
          // A platform stands a few studs over a train's track, so a train allows a taller step.
          const reach = spec.handling === 'rail' ? 4.6 : 1.4;
          return y - current.y < reach && world.blocking(x, y, z).length === 0;
        };
        let spot = exitSpot(current, fits);
        if (current.rail) {
          // Off either side, onto the platform if there is one: the highest place that fits.
          let height = -Infinity;
          for (const candidate of exitSpots(current)) {
            if (!fits(candidate.x, candidate.z)) continue;
            const up = world.standingHeight(candidate.x, candidate.z, current.y);
            if (up > height) [spot, height] = [candidate, up];
          }
        }
        const x = spot?.x ?? current.x;
        const z = spot?.z ?? current.z;
        walker.x = x;
        walker.z = z;
        walker.y = airborne ? current.y : world.standingHeight(x, z, current.y);
        walker.velocityY = 0;
        walker.grounded = !airborne;
        walker.flying = airborne;
        if (look) {
          look.yaw = current.yaw;
          look.pitch = -0.08;
        }
        live.onDrive(null, airborne);
      } else {
        const vehicle = vehicleInReach(vehicles, walker);
        if (vehicle) {
          world.removeGroup(boxKey(vehicle));
          live.parked.delete(vehicle.id);
          vehicle.driven = true;
          live.onDrive(vehicle.id);
        }
      }
    }

    // The vehicles nobody drives: settle onto the ground as it loads, roll to a stop when left,
    // and stand solid for the walker once still.
    for (const vehicle of vehicles) {
      if (vehicle.driven) continue;
      if (!vehicle.settled) {
        // One sent back to its spot leaves nothing solid behind where it stood.
        if (live.parked.delete(vehicle.id)) world.removeGroup(boxKey(vehicle));
        if (!settleVehicle(world, vehicle)) continue;
        animating = true;
      }
      const resting = isAtRest(vehicle) && vehicle.engine === 0;
      if (!resting) {
        stepVehicle(world, vehicle, IDLE, delta);
        animating = true;
      }
      const at = parkedAt(vehicle);
      if (resting && live.parked.get(vehicle.id) !== at) {
        world.setBoxes(boxKey(vehicle), parkedBoxes(vehicle));
        live.parked.set(vehicle.id, at);
      } else if (!resting && live.parked.has(vehicle.id)) {
        world.removeGroup(boxKey(vehicle));
        live.parked.delete(vehicle.id);
      }
    }

    // The vehicle being driven, once it stands somewhere.
    if (current && walker && current.settled) {
      animating = true;
      const keys = held.current;
      const pressed = (codes: string[]) => codes.some((code) => keys.has(code));
      const spec = VEHICLES[current.kind];
      const input: DriveInput = { ...IDLE };
      if (live.active) {
        input.throttle = (pressed(KEYS.forward) ? 1 : 0) - (pressed(KEYS.back) ? 1 : 0);
        input.steer = (pressed(KEYS.right) ? 1 : 0) - (pressed(KEYS.left) ? 1 : 0);
        const rise = (pressed(KEYS.up) ? 1 : 0) - (pressed(KEYS.down) ? 1 : 0);
        if (spec.handling === 'ground') input.brake = pressed(KEYS.up);
        else input.rise = rise;
        if (pad) {
          // The left stick steers and drives; on wheels the triggers drive too.
          if (!input.steer) input.steer = pad.strafe;
          if (!input.throttle)
            input.throttle = pad.forward || (spec.handling === 'ground' ? pad.rise : 0);
          if (spec.handling !== 'ground' && !input.rise) input.rise = pad.rise;
          live.look.yaw -= pad.lookX ** 3 * LOOK_RATE.yaw * delta;
          live.look.pitch = Math.max(
            -1.2,
            Math.min(1.2, live.look.pitch + pad.lookY ** 3 * LOOK_RATE.pitch * delta),
          );
          if (pad.lookX || pad.lookY) live.look.idle = 0;
          if (pad.pressed.y) live.honk = true;
          if (pad.pressed.view) live.onViewChange?.(live.view === 'first' ? 'third' : 'first');
        }
      }
      if (live.honk) {
        live.honk = false;
        sounds.honk();
      }
      const before = current.speed;
      const hit = stepVehicle(world, current, input, delta);
      const impact = Math.abs(before - current.speed);
      if (hit && impact > 3 && performance.now() - live.bumped > 300) {
        live.bumped = performance.now();
        sounds.bump(impact);
      }
      const revs =
        spec.handling === 'helicopter'
          ? current.engine
          : Math.min(
              1,
              Math.abs(current.speed) / spec.maxSpeed +
                (spec.handling === 'airplane' ? current.engine * 0.3 : 0),
            );
      sounds.update(revs, Math.abs(input.throttle));
      // The walker rides along, so the world streams in round the vehicle and a save finds it.
      walker.x = current.x;
      walker.z = current.z;
      walker.y = current.y;
      walker.velocityY = 0;
      walker.flying = !current.grounded && spec.handling !== 'ground';
      if (look) {
        look.yaw = current.yaw;
        look.pitch = -0.08;
      }
    }

    // Draw each vehicle where it is, easing over the steps its wheels climb.
    for (const vehicle of vehicles) {
      const rig = rigs.get(vehicle.id);
      if (!rig || !vehicle.settled) {
        if (rig) rig.root.visible = false;
        continue;
      }
      const last = live.shown.get(vehicle.id);
      const shown =
        last === undefined || !Number.isFinite(last) || Math.abs(vehicle.y - last) > 4
          ? vehicle.y
          : last + (vehicle.y - last) * Math.min(1, delta * (vehicle.y < last ? 18 : 12));
      if (Math.abs(shown - vehicle.y) > 0.002) animating = true;
      live.shown.set(vehicle.id, shown);
      const firstPerson = vehicle.driven && live.view === 'first';
      poseVehicle(rig, vehicle, shown, vehicle.driven && !firstPerson);
    }

    // A steam locomotive's chimney puffs while it works, harder the faster it goes.
    for (const vehicle of vehicles) {
      const rig = vehicle.rail ? rigs.get(vehicle.id) : undefined;
      if (!rig || !vehicle.settled) continue;
      const working = vehicle.driven ? 5 + Math.abs(vehicle.speed) * 0.7 : vehicle.engine * 1.5;
      if (working > 0.05) {
        rig.root.updateMatrixWorld();
        // The chimney's top, in the locomotive's own frame (see `train-model.ts`).
        chimney.set(0.5, 11, -5.5);
        rig.root.localToWorld(chimney);
        const ahead = forwardOf(vehicle.yaw);
        smoke.emit(delta, chimney, working, {
          x: ahead.x * vehicle.speed,
          z: ahead.z * vehicle.speed,
        });
      }
    }
    if (smoke.step(delta)) animating = true;

    if (current) {
      const rig = rigs.get(current.id);
      const spec = VEHICLES[current.kind];
      const lookAround = live.look;
      lookAround.idle += delta;
      if (lookAround.idle > LOOK_RETURN) {
        const ease = Math.min(1, delta * 2.5);
        lookAround.yaw -= lookAround.yaw * ease;
        lookAround.pitch -= lookAround.pitch * ease;
      }
      const shown = live.shown.get(current.id) ?? current.y;
      if (live.view === 'first' && rig) {
        // From the driver's eyes, turning and tipping with the vehicle.
        const { seat, eye: lookout } = MODELS[current.kind].rider;
        const [sx, sy, sz] = lookout ?? seat;
        rig.root.updateMatrixWorld();
        eye.set(-sx * 0.05, -sy * 0.05 + 1.15, sz * 0.05);
        rig.root.localToWorld(eye);
        camera.position.copy(eye);
        camera.rotation.set(
          current.pitch + lookAround.pitch,
          current.yaw + lookAround.yaw,
          current.roll * 0.5,
          'YXZ',
        );
      } else {
        // Behind and above, swinging round after the vehicle as it turns, pulled in where a wall
        // is in the way.
        const chase = live.chase;
        if (!Number.isFinite(chase.yaw)) chase.yaw = current.yaw;
        let turn = current.yaw - chase.yaw;
        turn = Math.atan2(Math.sin(turn), Math.cos(turn));
        chase.yaw += turn * Math.min(1, delta * 4);
        const yaw = chase.yaw + lookAround.yaw;
        const air = spec.handling !== 'ground';
        const pitch = Math.max(
          -1.2,
          Math.min(
            0.9,
            (air ? -0.2 : -0.24) +
              lookAround.pitch +
              (spec.handling === 'airplane' ? current.pitch * 0.5 : 0),
          ),
        );
        target.set(current.x, shown + spec.height * 0.75, current.z);
        behind.set(
          Math.sin(yaw) * Math.cos(pitch),
          -Math.sin(pitch),
          Math.cos(yaw) * Math.cos(pitch),
        );
        const room = followDistance(world, target, behind, spec.follow);
        chase.distance =
          room < chase.distance
            ? room
            : Math.min(room, chase.distance + (room - chase.distance) * Math.min(1, delta * 4));
        camera.position
          .copy(target)
          .addScaledVector(behind, Math.max(chase.distance, MINIFIG.radius));
        camera.rotation.set(pitch, yaw, 0, 'YXZ');
      }
    }

    // What the walker could get in, for the game's prompt.
    if (!current && walker) {
      const near = vehicleInReach(vehicles, walker)?.kind ?? null;
      if (near !== live.near) {
        live.near = near;
        live.onNear(near);
      }
    } else if (live.near !== null) {
      live.near = null;
      live.onNear(null);
    }

    // Keeps drawing while anything moves: the canvas otherwise renders on demand.
    if (animating) invalidate();
  });

  return (
    <>
      <primitive object={smoke.group} dispose={null} />
      {[...rigs].map(([id, rig]) => (
        <group key={id}>
          <primitive object={rig.root} dispose={null} />
          {rig.trailers.map((car, index) => (
            <primitive key={index} object={car} dispose={null} />
          ))}
        </group>
      ))}
    </>
  );
}

const boxKey = (vehicle: Vehicle) => `vehicle:${vehicle.id}`;
/** Where a vehicle stands, to tell when its parked boxes are out of date. */
const parkedAt = (vehicle: Vehicle) =>
  `${vehicle.x.toFixed(2)},${vehicle.y.toFixed(2)},${vehicle.z.toFixed(2)},${vehicle.yaw.toFixed(3)}`;
