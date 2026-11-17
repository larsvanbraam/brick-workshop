import { VEHICLES, parkVehicle } from '@brick-workshop/vehicles/vehicle';
import type { Vehicle, VehicleKind } from '@brick-workshop/vehicles/vehicle';
import type { Heading, VehicleSpawn } from './world/island/map.ts';
import { isParkedVehicle } from './save.ts';
import type { ParkedVehicle, SaveGame } from './save.ts';

/**
 * The game's vehicles, between the world's studs and the scene's units: the scene centres a frame
 * of `frame` studs on its origin and runs z the other way (see `worldZ`).
 */

/** The walker's yaw for a compass heading: yaw 0 looks toward world +z, south. */
const YAW: Record<Heading, number> = {
  south: 0,
  west: Math.PI / 2,
  north: Math.PI,
  east: -Math.PI / 2,
};

/** The vehicles at their spots, or where a save game left them. */
export function createVehicles(
  spawns: readonly VehicleSpawn[],
  frame: number,
  save: SaveGame | null,
): Vehicle[] {
  const saved = new Map<string, ParkedVehicle>();
  for (const entry of save?.vehicles ?? []) if (isParkedVehicle(entry)) saved.set(entry.id, entry);
  return spawns.map((spawn) => {
    const left = saved.get(spawn.id);
    const x = (left?.x ?? spawn.x) - frame / 2;
    const z = frame / 2 - (left?.z ?? spawn.z);
    return parkVehicle(spawn.id, spawn.kind, x, z, left?.yaw ?? YAW[spawn.heading], left?.y);
  });
}

/**
 * Puts every vehicle back at its spot, for one that got stuck or was left far away. Each waits,
 * hidden, for the ground there to load, as at the start.
 */
export function returnVehicles(
  vehicles: readonly Vehicle[],
  spawns: readonly VehicleSpawn[],
  frame: number,
) {
  for (const vehicle of vehicles) {
    const spawn = spawns.find((entry) => entry.id === vehicle.id);
    if (!spawn) continue;
    const x = spawn.x - frame / 2;
    const z = frame / 2 - spawn.z;
    Object.assign(vehicle, parkVehicle(spawn.id, spawn.kind, x, z, YAW[spawn.heading]));
  }
}

/** Where each vehicle stands now, for a save game. */
export function parkedVehicles(vehicles: readonly Vehicle[], frame: number): ParkedVehicle[] {
  return vehicles
    .filter((vehicle) => vehicle.settled)
    .map((vehicle) => ({
      id: vehicle.id,
      x: vehicle.x + frame / 2,
      z: frame / 2 - vehicle.z,
      y: vehicle.y,
      yaw: vehicle.yaw,
    }));
}

const VERBS = {
  ride: ['ride', 'riding'],
  drive: ['drive', 'driving'],
  fly: ['fly', 'flying'],
} as const;

/**
 * What the player can do with a vehicle, "drive the car", or with `doing` what they are doing,
 * "driving the car".
 */
export function vehicleAction(kind: VehicleKind, doing = false) {
  const spec = VEHICLES[kind];
  const verb = spec.track === 0 ? 'ride' : spec.handling === 'ground' ? 'drive' : 'fly';
  return `${VERBS[verb][doing ? 1 : 0]} the ${spec.name}`;
}
