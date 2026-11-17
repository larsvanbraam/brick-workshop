# Brick vehicles

Vehicles a minifigure can drive or fly: how they handle, what they are built from, how they are
drawn and how they sound. It builds on [`brick-walk`](../brick-walk), so vehicles move through the
same world of boxes the walker collides with.

Import by module, e.g. `import { stepVehicle } from '@brick-workshop/vehicles/vehicle'`.

| Module                              | What it does                                                                                              |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `vehicle`                           | The handling: `VEHICLES`, `parkVehicle`, `stepVehicle`, `settleVehicle` and helpers for ground and rest.  |
| `models`                            | Each vehicle's LEGO model: which LDraw parts it is made from and where they sit (`MODELS`, `modelParts`). |
| `drive-view`                        | `Vehicles`, the React Three Fiber component, and `vehicleInReach` for getting in.                         |
| `vehicle-model` (used by the above) | `buildVehicle` and `poseVehicle`: the model in the scene, with its wheels, rotors and propellers moving.  |
| `drive-sounds` (used by the above)  | `DriveSounds`: engine, rotor and horn sounds synthesised with Web Audio.                                  |

## What can be driven

A bike, a motorcycle, a car, a race car, a helicopter and an airplane. Wheels climb a brick's step
and roll off ledges, bodies stop against walls, and aircraft land on whatever they come down on.
The handling is arcade, not simulation: each vehicle is a few numbers (top speed, how hard it
turns) that make it easy to drive for a child and different enough from the next to be fun.

## Adding a vehicle

Positions in `models.ts` are in LDraw units (20 a stud, 8 a plate, 24 a brick) and LDraw's frame:
y points down, so up is negative, the front faces -z, and the ground under the wheels is y 0. A
part's origin is the middle of its top, so a plate resting on a surface at height `h` sits at
`h - 8`. Add the model there, its handling in `vehicle.ts`, and any new parts to
`vehicle-parts` in [`brick-render`](../brick-render).

## Tests

```sh
pnpm test    # from the repository root
```
