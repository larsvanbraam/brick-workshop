# Brick game

The game behind [Brick World](../../apps/brick-world) and [Brick Island](../../apps/brick-island): a minifigure
that walks, builds and talks in a world made of real bricks. An app starts it with one call:

```ts
import { BRICK_WORLD, startGame } from '@brick-workshop/game/start';

startGame(BRICK_WORLD);
```

It builds on [`brick-engine`](../brick-engine), [`brick-render`](../brick-render), [`brick-walk`](../brick-walk),
[`brick-npc`](../brick-npc), [`brick-vehicles`](../brick-vehicles) and [`brick-audio`](../brick-audio).

## What's inside

All of it lives in `src/`:

| Area                 | Files                                                                                       | What it does                                                                                                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The world            | `world/terrain`, `world/caves`, `world/plants`, `world/sights`, `world/far`, `world/worker` | Terrain from noise alone, so any column's height, water and biome follow from its position and the seed. Caves, plants and small "sights" (a well, a campfire, standing stones) on top; built a chunk at a time in a worker. |
| Brick Island         | `world/island/*`                                                                            | The hand-drawn island, about 600 by 480 studs: its map, houses, civic buildings, structures and minimap.                                                                                                                     |
| Streaming            | `chunks`, `streaming`, `world-index`                                                        | The world is cut into chunks: those near the walker are built in full, those further out are drawn plainly from afar.                                                                                                        |
| Building             | `build`, `hotbar`, `catalog`, `BrickBox`, `export`                                          | Placing and taking off pieces through the engine, the nine-slot hotbar, the brick box and exporting what you built.                                                                                                          |
| People and life      | `npcs`, `animals`, `dialogue`, `locale`, `vehicles`                                         | Who lives where follows from the seed, so a chunk has the same people whenever it loads. Talk, wildlife and vehicles.                                                                                                        |
| Brick Island's world | `quests`, `tide`                                                                            | Little jobs for a young child, and a tide that politely keeps the player on the island.                                                                                                                                      |
| Time and light       | `sky`, `shadows`                                                                            | Day and night (a new world starts on a bright morning) and shadows.                                                                                                                                                          |
| Saves                | `save`                                                                                      | Each game keeps its saves under its own prefix; if storage is blocked the game just forgets.                                                                                                                                 |
| Interface            | `App`, `Menu`, `TitleScreen`, `Minimap`, `gamepad`, `touch-pad`, `TouchControls`            | Menus, the title screen, the minimap, and keyboard, controller and touch input.                                                                                                                                              |

## Two games, one codebase

Brick World and Brick Island are one codebase: an app picks its
game by passing a `GameConfig` to `startGame`.

| Setting     | Brick World                                      | Brick Island                            |
| ----------- | ------------------------------------------------ | --------------------------------------- |
| `world`     | generated from any seed                          | one hand-drawn island (seed 7)          |
| `building`  | on: hotbar, brick box, place and take off pieces | off: a game for walking round           |
| `fixedTime` | day and night                                    | always a bright morning                 |
| `minimap`   | off                                              | on, with landmarks (`N` opens it full)  |
| `saveSlots` | worlds, each with its building                   | save games that remember where you were |
| `vehicles`  | none                                             | parked round the island to drive        |

Saves live in the browser under each game's own prefix, so the two never read each other's.
To add a game, add a `GameConfig` next to `BRICK_WORLD` and `BRICK_ISLAND` in
[game.ts](src/game.ts) and a shell app that starts it.
