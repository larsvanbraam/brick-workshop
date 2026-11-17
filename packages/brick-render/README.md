# Brick render

Everything that draws bricks: LDraw loading, batched drawing, the cinematic look and the small
pieces of UI the apps share. The workshop and both games render through it; it builds on
[`brick-engine`](../brick-engine) and Three.js (via React Three Fiber).

Import by module, e.g. `import { loadLDrawPart } from '@brick-workshop/render/ldraw'`.

## What's inside

| Module                                           | What it does                                                                                                                       |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `ldraw`, `ldraw-library`                         | Load the LDraw catalogue and parts (`loadLDrawCatalog`, `loadLDrawPart`, `useLDrawLibrary`), and the Vite plugin that serves them. |
| `ldraw-batches`, `ldraw-materials`               | Batched drawing: pieces that share a look share one mesh and one draw call. Display colours and finishes.                          |
| `fallback-batch`, `fallback-geometry`            | Simplified procedural geometry, used when the LDraw library isn't installed.                                                       |
| `cinematic`, `cinematic-look`                    | The cinematic view: `CinematicStage`, with moods, ambient occlusion, bloom, vignette and fog.                                      |
| `scene-frame`                                    | The scene's coordinates (see below) and how to frame a build.                                                                      |
| `loader`, `fullscreen`, `scene-debug`            | The loading card, the fullscreen button and the debug overlay.                                                                     |
| `splash`, `splash-plugin`                        | The boot splash that appears before the app has loaded.                                                                            |
| `part-thumbnails`                                | `usePartThumbnail`: part pictures for the part pickers.                                                                            |
| `minifig-parts`, `animal-parts`, `vehicle-parts` | The LDraw parts of the figures, animals and vehicles.                                                                              |

## The LDraw library and the Vite plugins

Each app adds two plugins in its `vite.config.ts`:

```ts
import { ldrawLibraryPlugin } from '@brick-workshop/render/ldraw-library';
import { splashPlugin } from '@brick-workshop/render/splash-plugin';

plugins: [
  react(),
  splashPlugin({ title: 'Brick World', message: 'Loading…', colors: { background: '#1b1915', ink: '#f4f1ea' } }),
  ldrawLibraryPlugin(resolve(workspaceRoot, env.LDRAW_LIBRARY_PATH || 'data/ldraw')),
],
```

`ldrawLibraryPlugin` indexes the library and packages only the parts the app can use, with
their attribution and licences, so a static deploy needs no library at runtime. The figure,
animal and vehicle parts are not building parts, but they are listed here so the plugin ships them too.
The page side of the splash is `setSplashMessage` and `dismissSplash` from `splash`.

## Scene coordinates

Scene units are studs (20 LDU a stud). LDraw's y points down, so a part is turned half round its
x axis to stand upright; its depth flips with it, so the scene's z runs against the build
grid's. Use `worldZ` and the helpers in `scene-frame` instead of converting by hand.

## Tests

```sh
pnpm test    # from the repository root
```
