# Brick Workshop

A LEGO assembly playground: a 3D workshop for building with real LDraw parts, a
UI-free engine that validates every placement, and a Claude adapter that builds
through the same engine. pnpm monorepo with Vite Plus, React 19, TypeScript and
Three.js.

## Run

Requires Node.js 22.18+, 24.11+ or 26+ and pnpm 12.16.1.

```sh
pnpm install
pnpm ldraw:fetch   # optional: download the LDraw library into data/ldraw
pnpm dev           # http://localhost:5173
```

Without the LDraw library the viewer falls back to simplified procedural
geometry. See [data/README.md](data/README.md) to use a library elsewhere.

```sh
pnpm test    # Vitest via Vite Plus
pnpm check   # format, lint and typecheck
pnpm build   # typecheck, web build, engine and adapter packages
pnpm fmt     # format the workspace
```

## Workspace

- `packages/brick-engine`: part catalogue, placement, collision and support
  validation, static gravity analysis, atomic edits, LDraw export, building
  instructions and the example builds. No UI or rendering dependencies.
- `packages/claude-adapter`: Claude tool sessions over the engine, the local
  generation CLI and the workshop server.
- `apps/web`: the workshop (viewer, part picker, editing, undo/redo, imports and
  exports, full-library browser) and the building instructions tool.
- `data`: the local, Git-ignored LDraw library and inventory downloads.

## Workshop

- **Saving.** The current build autosaves in the browser. **File → Save** (⌘S)
  writes `builds/<name>.json` (override with `WORKSHOP_BUILDS_PATH`); saved builds
  are listed under **File**. Only the dev and preview servers serve this folder.
- **Import** reads assembly JSON and workshop/CLI exports (up to 2 MB, 50,000
  pieces). Everything is revalidated against the current policy.
- **Building instructions** (**Export → Building instructions…**) turns a build
  into a printable PDF manual, ordering pieces so each comes after what it rests on.
- **Add 3D model** converts SketchUp (`.skp`), COLLADA (`.dae`) or `.glb` models in
  the browser: the surface is sampled into brick-sized cells, filled with wall
  bricks, roofs get slopes and detected openings get door and window frames.
- **Smooth surfaces** (**File**) dresses the whole build as one undoable edit:
  outside corners of plain 1 x 1 and 2 x 2 pieces turn round, cheese and curved
  slopes lean on steps, plate steps and open edges get tiles and corners
  quarter-round tiles; **…and add flowers** also scatters flowers on green tops.
  `smoothAssembly` in the engine does the work, and Claude calls it as
  `brick_smooth` once a sculpted shape or terrain is finished.
- **Generate** drafts or revises a build with Claude, optionally from up to four
  reference photos, in a separate dialog; nothing changes until **Apply draft**.

Generation needs the workshop server next to the dev server:

```sh
pnpm workshop:server
pnpm dev
```

Set `ANTHROPIC_API_KEY` in the server's environment or the ignored root `.env`
(never in `VITE_` variables); `CLAUDE_MODEL` picks the model. Without a key the
server runs through your local Claude Code login instead, which is for personal
local use only. The server binds to `127.0.0.1:8787` (`WORKSHOP_API_PORT`) and
Vite proxies `/api/workshop` to it.

## Engine

Positions are in studs for X/Z and plates for Y, in steps of 0.5; a brick is
three plates. X/Z are the minimum corner of the rotated footprint, rotations are
quarter turns, and all studs point up (except side-stud bricks, which hold pieces
mounted sideways). Boards are square, 16 to 128 studs (`Assembly.buildArea`).

`placeBrick`, `removeBrick`, `previewPatch` and `applyPatch` return a new valid
assembly or structured issues and never mutate their input. A piece above the
ground needs at least one matching stud connection to grounded support; removing
a piece is refused if it would leave others unsupported. Collisions reserve each
part's whole rectangular envelope.

### Parts

The catalogue in [core.ts](packages/brick-engine/src/core.ts) holds a curated
set of LDraw designs, each with a footprint, height and explicit connection
cells (`connections.topStuds` and `connections.bottomReceivers`, zero-based in the
unrotated footprint). `getLDrawTransform` maps them onto native LDraw geometry for
rendering and export. Families:

- Bricks, plates and tiles in the usual sizes, tall bricks, baseplates.
- Slopes: 45°, 33°, 18°, 65° and 75° roofs, inside and outside corners for
  hipped roofs, ridges, steep tower caps and pyramids, inverted slopes, cheese
  slopes, and curved slopes up to 6 x 2.
- Round: round bricks, plates and tiles from 1 x 1 to 8 x 8, half circles,
  quarter circles, round-corner bricks and plates, macaroni bricks and tiles,
  rounded-end plates and tiles, curved-top bricks, a dome-topped round brick and
  inverted dishes for onion domes.
- Detail: masonry, log, grille and headlight bricks, side-stud bricks (studs on
  one, two or four sides), a 1 x 2 - 1 x 2 bracket, facet bricks, jumper plates,
  wedge plates, panels, antenna finials, corner, wedge, triangular and
  angled-end tiles, flags, fences and railings. The bracket's standing plate
  covers its own top studs, so it takes pieces only on its front studs.
- Architecture: arches, quarter arches, half-arch bricks, columns, cones (plain and with a
  top groove), doors
  and frames, windows, glass and casements.
- Foliage: trees, bushes, grass, leaves and flowers.

Plain parts connect on every cell. Shaped parts connect only where they really
do: slopes on their high rear row, tiles never on top, and round, corner and
macaroni pieces only on the cells their mesh covers. Doors, glass and casements
hang in their matching frames (`INSERT_FRAME_PARTS`). With the LDraw library
installed, tests check every part's real mesh against its declared envelope and
centre in all four rotations.

**Clips and bars.** Parts can declare `bars` (a segment along a bar's centre line)
and `clips` (where a clip grips and the axis it holds). A clip holds a piece whose
bar runs through it, anywhere along the bar, such as a flag (`2335`) up an antenna
(`3957a`), or a loose bar (`30374`, `87994`) mounted level between clip plates
(`4081b`, `60470a`, `63868`). Pieces held this way hang like side-mounted ones:
validation hangs them a pass at a time from held pieces, a clip and the bar it grips
may share space, physics carries them on their hosts and clamps several hosts of one
piece together, and building instructions place them after their hosts.

To add a part, define it in `PARTS` (see `basicPart`, `contouredPart`,
`curvedSlopePart` and friends), read its size, native centre and stud positions
from the `.dat` geometry, and run `pnpm test`. The catalogue sampler example
places every part once, so new parts are covered automatically.

### Physics

`assessPhysicalFeasibility` balances forces and moments on every piece with a
linear solver: the floor and resting surfaces push, studs can pull. It reports
whether the build balances, needs clutch, or tips, and which joints are
overloaded. Masses come from host data, then the bundled BrickLink catalogue
weights ([part-masses.ts](packages/brick-engine/src/part-masses.ts)), then
optional solid-volume estimates; parts without a source stay unknown. Stud
tension is checked against a default of 0.5 N a stud unless the host supplies a
limit. Tipping is decided for any size; the full solve is capped at 1,000 pieces
unless `fullCheck` is set. Hosts can swap in HiGHS with
`setLinearSolver(createHighsSolver(...))`; the workshop runs it in a worker.

Results are a static model, not a certification: bending, shear, construction
order and real clutch strength are not checked, and
`getBuildabilityReport` always reports `certified: false`.

### Colours and evidence

`COLORS` is a snapshot of LDraw's `LDConfig.ldr`. Whether a part was ever made
in a colour comes from a reviewed snapshot of Rebrickable inventories
([part-color-evidence.ts](packages/brick-engine/src/part-color-evidence.ts));
missing combinations are unknown, not impossible. Nearly every supported part is
mapped; the 45° cut tiles `5091`/`5092` are not, because Rebrickable uses those
numbers for other tiles. Refresh with:

```sh
pnpm colors:import
curl --fail --location --output data/inventory_parts.csv.gz https://cdn.rebrickable.com/media/downloads/inventory_parts.csv.gz
pnpm colors:inventory data/inventory_parts.csv.gz
pnpm fmt
```

A refresh keeps the snapshot's mappings and updates its observations. To map a new
part, pass a configuration file with it added as the second argument. Map parts
and colours explicitly, from matching names or LDraw's `Rebrickable` keywords;
never infer them from similar numbers, names or RGB values.

## Examples

| Example             | Pieces | Detail                                                                    |
| ------------------- | ------ | ------------------------------------------------------------------------- |
| Courtyard House     | 383    | Stone hall with half-timbered upper storey, watchtower, well and garden.  |
| Catalog sampler     | all    | Every supported part once, on an 80 x 80 board.                           |
| Seaside Lighthouse  | 415    | Striped tower on a rocky island with keeper's cottage, jetty and rowboat. |
| Flower Market Stall | 351    | Booth with striped awning, flower buckets, crates, tree and bench.        |
| Nordiska Museet     | 11,506 | The Stockholm museum with its towers, gables, dormers and windows.        |
| Castle              | 7,951  | Walled castle: round towers, gatehouse, moat and drawbridge, keep, well.  |

Each example is a module in
[packages/brick-engine/src/examples](packages/brick-engine/src/examples)
implementing `ExampleDefinition`, registered in
[registry.ts](packages/brick-engine/src/examples/registry.ts):

```ts
export const smallStack: ExampleDefinition = {
  id: 'small-stack',
  name: 'Small stack',
  tags: ['vertical-support'],
  expectedPieceCount: 2,
  build(add) {
    add('3005', 4, 0, 0, 0); // partId, color, x, y, z, rotation?
    add('3005', 14, 0, 3, 0);
  },
};
```

Every placement is validated on first load and `expectedPieceCount` must match.
Shared tests check every registered example.

## Claude Adapter

Claude builds only through engine tools (catalogue, placement candidates,
patches, inspection, physics, export); it has no shell, files or web access, and
the engine rejects anything invalid. By default it may only use part/colour
combinations with inventory evidence.

```sh
pnpm claude:build --help
pnpm claude:build "Build a small bridge" --out output/bridge
pnpm claude:build "Add a second level" --input output/bridge/assembly.json --out output/two-level
```

The output folder gets `assembly.json` (assembly, parts list, physics and tool
trace) and `assembly.ldr`; both import into the workshop. Use
`createBuilderSession` and `runClaudeBuild` from `@brick-workshop/claude-adapter`
to host it elsewhere.

## Deploying

`vercel.json` deploys the web app as a static site: the build fetches the LDraw
library, packages only the supported parts with their attribution and licences,
and sets `VITE_WORKSHOP_GENERATION=false` to hide generation. Saving to
`builds/` and previews of arbitrary library parts need the local server.

The LDraw library is community-maintained, not LEGO-authored; keep its
attribution and licences when redistributing meshes or the palette.
