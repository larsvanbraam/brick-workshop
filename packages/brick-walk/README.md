# Brick walk

A minifigure that walks through a build or a world: the physics, the figure itself, the camera,
controller input and footstep sounds. The workshop's walk mode and both games use it, and
[`brick-npc`](../brick-npc) and [`brick-vehicles`](../brick-vehicles) build on it.

Import by module, e.g. `import { stepWalker } from '@brick-workshop/walk/walk'`.

| Module         | What it does                                                                                                                     |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `walk`         | The walker's physics: `WalkWorld`, `spawnWalker`, `stepWalker`, and the camera's follow distance and clearance.                  |
| `walk-view`    | `WalkMode`, the React Three Fiber component that runs a walker in a scene.                                                       |
| `minifig`      | A minifigure from its LDraw parts, with the limbs on pivots: `buildMinifig`, `assembleMinifig`, `poseMinifig`, `CLASSIC_OUTFIT`. |
| `walk-gamepad` | Controller input from the browser's Gamepad API: sticks, dead zones, look rate, button layouts.                                  |
| `walk-sounds`  | Plastic clicks for steps, jumps and landings, synthesised with Web Audio (no sound files).                                       |

## How walking works

The walker moves in scene units, a stud wide and 0.4 a plate high. Pieces are solid boxes from
their bounds, so a walker climbs a brick's step, falls off ledges and stops against walls.
Plants and doors are left out, so the walker brushes through foliage and walks in at doorways.
Outfits are plain data (`MinifigOutfit`: LDraw colours and part IDs), so the people of Brick
World share the same rig with different faces, hair and hats.

## Tests

```sh
pnpm test    # from the repository root
```
