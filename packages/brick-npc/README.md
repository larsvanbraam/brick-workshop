# Brick NPC

The people and animals that walk about on their own: minifigures and animals that stroll, stop,
turn back at the water's edge and react to the player. It builds on [`brick-walk`](../brick-walk),
so they move with the walker's own physics: they climb steps, fall and collide like the player.

Import by module, e.g. `import { createWanderer } from '@brick-workshop/npc/wander'`.

| Module      | What it does                                                                                                                     |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `wander`    | The behaviour: `createWanderer` and `stepWanderer`, with each one's temper, pace and home.                                       |
| `wanderers` | `Wanderers`, the React Three Fiber component that draws them. A look is either a minifig outfit or an animal.                    |
| `animal`    | An animal from LDraw parts and how it moves: `assembleAnimal`, `poseAnimal`, with a gait of `walk`, `hop` or `waddle`.           |
| `talk`      | `TalkLink`: who is near enough to talk to and where their head is on screen. The scene writes it every frame, the game reads it. |

## Behaviour

A wanderer strolls a while, stands a while, turns back at ground it shouldn't cross (water, a
cliff, the edge of what is loaded), hops up a step it bumps into and keeps near its home.
When the player comes close it does what its temper says: a **friendly** one stops to wave, a
**shy** one runs off, a **calm** one carries on.

## Tests

```sh
pnpm test    # from the repository root
```
