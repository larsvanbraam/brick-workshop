# Brick game

The core of the games [Brick World](../../apps/brick-world) and [Brick Island](../../apps/brick-island): a
minifigure that walks, builds and talks in a world made of real bricks. It holds what every game shares and
nothing of any one game: each app brings its own world, map, vehicles and extras as a `GameConfig` and starts
the game with one call:

```ts
import { startGame } from '@brick-workshop/game/start';
import { BRICK_WORLD } from './world.ts';

startGame(BRICK_WORLD);
```

It builds on [`brick-engine`](../brick-engine), [`brick-render`](../brick-render), [`brick-walk`](../brick-walk),
[`brick-npc`](../brick-npc), [`brick-vehicles`](../brick-vehicles) and [`brick-audio`](../brick-audio).

## What's inside

All of it lives in `src/`:

| Area            | Files                                                                                      | What it does                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The world       | `world/terrain`, `world/caves`, `world/plants`, `world/sights`, `world/far`, `world/serve` | Terrain from a `WorldSource` a game supplies. `world/noise-world` is a ready-made one of noise alone (`NOISE_WORLD`, with its landforms and volcanoes as parts to reuse), so any column's height, water and biome follow from its position and the seed; a game may draw its own map instead. Caves, plants and small "sights" (a well, a campfire, standing stones) on top; built a chunk at a time in a worker (`serveChunks`). |
| Streaming       | `chunks`, `streaming`, `world-index`                                                       | The world is cut into chunks: those near the walker are built in full, those further out are drawn plainly from afar.                                                                                                                                                                                                                                                                                                             |
| Building        | `build`, `hotbar`, `catalog`, `BrickBox`, `export`                                         | Placing and taking off pieces through the engine, the nine-slot hotbar, the brick box and exporting what you built.                                                                                                                                                                                                                                                                                                               |
| People and life | `npcs`, `animals`, `dialogue`, `locale`, `vehicles`                                        | Who lives where follows from the seed, so a chunk has the same people whenever it loads. Talk, wildlife, farm animals in a game's pastures and vehicles.                                                                                                                                                                                                                                                                          |
| Time and light  | `sky`, `shadows`                                                                           | Day and night (a new world starts on a bright morning) and shadows.                                                                                                                                                                                                                                                                                                                                                               |
| Saves           | `save`                                                                                     | Each game keeps its saves under its own prefix; if storage is blocked the game just forgets.                                                                                                                                                                                                                                                                                                                                      |
| Interface       | `App`, `Menu`, `TitleScreen`, `Minimap`, `gamepad`, `touch-pad`, `TouchControls`           | Menus, the title screen, the map, and keyboard, controller and touch input.                                                                                                                                                                                                                                                                                                                                                       |
| Extending       | `game`, `extension`                                                                        | `GameConfig` and the add-on hook (see below).                                                                                                                                                                                                                                                                                                                                                                                     |

## Games are apps

The game package has no game in it. An app passes a `GameConfig` to `startGame`:

| Setting        | What it is                                                                                |
| -------------- | ----------------------------------------------------------------------------------------- |
| `source`       | The `WorldSource` that shapes the world: endless land from any seed, or one drawn map.    |
| `createWorker` | Starts the worker that builds chunks, a file in the app that calls `serveChunks(source)`. |
| `building`     | Whether the player builds: the hotbar, the brick box, placing and taking off pieces.      |
| `fixedTime`    | A time of day to stay at, for a game without day and night.                               |
| `map`          | A map in the corner: its picture, its bounds and its landmarks (`N` opens it full).       |
| `saveSlots`    | Save games that remember where you were, instead of worlds each with their building.      |
| `vehicles`     | Vehicles parked round the world to drive.                                                 |
| `pastures`     | Where farm animals graze.                                                                 |
| `chat`         | Extra lines for people to say about the game's place.                                     |
| `controls`     | Keys the game adds to the controls page.                                                  |
| `useAddon`     | A hook for what the game adds on top, below.                                              |

Saves live in the browser under each game's own prefix, so games never read each other's.

### Add-ons

`useAddon` is called each render with an `AddonHost` (the terrain, the walker, the language, a way to
make someone speak) and returns an `Addon`: what to draw in the scene and over the screen, a line for the
status bar, pins for the map, the people it brings, what to keep in the save game, and how the talk and
hat keys act. Brick Island's jobs, hats, tide and sharks are one (see
[its add-on](../../apps/brick-island/src/jobs/addon.tsx)). A game without one gets nothing extra.

To add a game, make an app with a `GameConfig` and a worker file, and start it.
