---
name: build-example
description: Build, rework or extend an example model in packages/brick-engine/src/examples (a house, castle, tower, shop, town, vehicle, garden or any scene). Covers reference, plan, bulk, detail, smoothing, piece count, rendering and verification, with the technique notes. Use whenever the user asks to make, generate, improve or fix an example build or model.
---

# Building an example

Most work here is making example builds: TypeScript files in
`packages/brick-engine/src/examples/` registered in `registry.ts`. An example is an
`ExampleDefinition` whose `build(add)` calls `add(partId, color, x, y, z, rotation, facing)`
for every piece. The registry validates the result and throws on the first unsupported or
colliding piece, and on a piece count that differs from `expectedPieceCount`.

Rules the registry and the tests enforce:

- **Build order.** Every piece must come after whatever holds it up. The registry names the
  first failing piece by replaying the list in order, the disassembly test removes pieces in
  reverse, and the validation tests rebuild the list course by course. A plan drawn in any
  other order reports bogus "unsupported" pieces. Wrap the adder in `bottomUp` (`layout.ts`)
  and call `flush()` at the end of `build` to hand pieces on bottom-up, side-mounted pieces
  last.
- **The demo build.** `courtyard-house` is also `createDemoAssembly`, and the tests in
  `index.test.ts` describe it in detail: piece count, board size, the resize shift, the
  island's corners, window counts, the wheel's facing, the roof's height profile, the parts it
  must use and its brick IDs. When you change it, update those tests to describe the new
  model.
- **Physics.** The full gravity solve runs up to `MAX_PHYSICS_PIECES` (1,000 pieces). Above
  that only tipping is checked, so the example gravity test expects `not-assessed` there.
- **Instructions.** Examples under 2,500 pieces also run through the building instructions
  tests. Keep a single-subject scene (a house, a tower) under that, and give the subject at
  least two thirds of the pieces: scenery gets at most a third. A 500-piece tower on a 24-stud
  board with trees, rocks and a fence has about 150 pieces left for the tower, and reads thin.
- **Hidden supports.** Pieces only bond through studs, so a hollow shell (a roof, a dome) can
  leave cells nothing holds. Hidden posts inside it are fine: dark colour (`308` or `72`),
  never visible from any side, and counted (the courtyard house's roof needs about 100).
  Design the shell to bond on its own first; posts are the fallback.

## What a good example looks like

The standard every build is held to, in code or in the workshop's generate panel, lives in
[docs/build-standard.md](../../../docs/build-standard.md); the workshop's Claude loads the same file,
so edit it there to change both. Read it now, then the technique notes for what you are building
([docs/techniques/](../../../docs/techniques/README.md)).

In code, the standard maps onto these helpers:

- Tilted roof panels: tilt hinge tops (`3938`) with `getHingeTilt` (packages/brick-engine/README.md, "Hinges and
  tilted frames").
- `courtyard-house.ts` is the worked recipe for a gabled, hinge-tiled roof. Reuse it only when the design brief calls for that roof; a second build with the same roof is a failure (see the brief below).
- Trees: `addTree` in `trees.ts`. Crates, benches, buckets and pots: see `flower-stall.ts`.
- Plant receivers: check a part's `connections` in `core.ts` before placing it. A plant plugs into
  one stud by a receiver off its own corner (bush `(1.5, 1.5)`, fern `(2, 1.5)`, tall grass
  `(1.5, 0)`), and its box is large (a bush is 4 x 4), so place each plant with a collision check
  and a lawn stud under that one stud, never on a tile (see `wishing-well.ts`).
- Trees must not be round poles: use `addTree(..., { gnarled: true })` for a thick, tapering log
  trunk, a grove of a main tree and smaller companions, and an `accent` for fruit or blossom
  (the flora note has the rules). Leave 5 studs of board round a tree; a 16-stud board is too
  small beside a building.
- Side-mounted detail uses 1 x 1 parts (round plate `6141`, cheese slope `54200`, plate `3024`).
  The 2 x 2 sprig `32607` collides with its own host when mounted sideways.
- Scatter shades with a seeded hash or `random(seed)` from `trees.ts`, so each example stays
  deterministic.
- A gabled roof of 45° slope courses needs one more course on each side than the gable wall
  has, or the two faces stop a stud short of the ridge. Ridge pieces (`3043`) have no studs, so
  nothing stands on them.
- Tiles hold nothing: keep plates (open studs) under every post, prop, plant and furniture
  piece, and a window frame with two centre studs (`60594`) needs a lintel brick that spans them.
- Tall doors are `60596` frames (4 wide, 6 bricks) with `60623` or `60616a` leaves; fit the
  leaf with `addDoor` as the courtyard house does.
- Wheels (`4624c01`) rest on the ground; a `4600` pin plate clips between a pair, and a 2 x 2
  brick on it carries the bed (see the wagon in `western-town.ts`).
- Search `PARTS` in `core.ts` for anything else; packages/brick-engine/README.md explains how to add a part.

## Smoothing

`smoothAssembly` (`smoothing.ts`) finishes surfaces: outside corners turn round, cheese and
curved slopes lean on steps, open studs get tiles and corners quarter-round tiles, and
optionally flowers go on green tops. An example opts in with `smooth` passes, run in order over
the finished build:

```ts
smooth: [
  { only: (brick) => [71, 72, 151].includes(brick.color) }, // rocks
  { only: (brick) => brick.color === 2, accents: true }, // lawn with flowers
],
```

Limit each pass with `only` or `region` to the natural parts, so walls, floors you still
build on and studs meant to show stay as they are. Only pieces in a pass's scope count as
steps to lean slopes on, so a lawn pass leaves the house walls alone. When natural and built
parts share colours (grey rock and grey walls), tag the natural pieces while building (a
`Set` of positions, as `courtyard-house.ts` does) and test that set in `only`. With
`accents: true`, flowers grow in small clumps of one colour; place showpiece flower beds by
hand. Smoothing pieces count towards `expectedPieceCount`.

## 0. Intake

Do this before reading any code. A request like "make a bakery" is under-specified, and the
usual failure is a build that looks like the last one, so **ask unless the user already gave
every answer below or said "just build" in those words**. One `AskUserQuestion` call, these four
questions (skip one only if the request or an attached image already answers it):

1. **References.** Will you attach reference images? Options: "I'll attach images", "No
   reference, use your judgement".
2. **Style direction (the most important one).** Offer three or four distinct directions for
   the subject, drawn from the notes, so the build does not default to the house style. For a
   bakery: Tudor half-timber corner shop with a jetty, brick modular with striped awning and
   mansard roof, rendered Mediterranean with terracotta and a pergola, rustic stone cottage with
   a thatched roof. For a saloon: false-front clapboard, adobe, brick bank. Name the wall
   material, roof type and palette in each option.
3. **Setting.** Landscape, street, desert or waterfront (see the build standard).
4. **Size.** A small prop, a single building or a full scene. It sets the piece budget (under
   2,500 for the instructions tests, under 1,000 for the full physics solve) and `buildArea`.

For a rework, ask which example instead and read its file first. If the user said "just build",
pick the direction yourself, make it differ from the existing examples' walls and roofs, and
state it in one line.

### Read the notes (required, not optional)

Before planning, open these files with the Read tool; do not write code until you have. The
table gives the minimum per subject.

| Subject                    | Read                                                             |
| -------------------------- | ---------------------------------------------------------------- |
| Town house, shop, modular  | walls, facades-and-openings, roofs-and-rooflines, city-and-props |
| Castle, tower, ruin        | walls, towers, roofs-and-rooflines, flora-and-terrain            |
| Western town, harbour      | walls, facades-and-openings, city-and-props, flora-and-terrain   |
| Vehicle, train, boat       | vehicles, then city-and-props for its scene                      |
| Garden, landscape, animals | flora-and-terrain, fauna                                         |

Files are `docs/techniques/<name>.md`; also read the subject's group in
`docs/rebrickable-benchmarks.md` and the matching topic in `docs/techniques/placement-statistics.md`
(for the targets: small-part share, sideways share, roof slopes). Add vehicles when a scene has a
wagon, train or boat, and fauna when it has animals.

### Write a design brief before any code

Post this brief to the user (short, concrete, no code), then build to it. It is the check that
the notes were used and that the build is not a copy of an earlier one.

- **Direction** chosen and why.
- **Walls**: material per storey (at least two), the depth levels used (recess, proud headers,
  side-stud bricks, piers), quoins, bands, plinth.
- **Facade**: focal point, window types and their sills, heads and dressing, entrance, one
  projecting element (bay, jetty, balcony, porch).
- **Roof**: type and pitch method, and how it differs from the roofs of `courtyard-house`,
  `castle` and the other examples; three things on it (chimney, dormer, finial, flag, gutter).
- **Ground and planting**: ground materials (three or four), the tree species, bushes, flowers
  in clumps, rock or water if any.
- **Faces** (any building, tower or vehicle seen from all sides): a table with one row per
  face (front, back, left, right) and columns for openings, relief, bands, material and side-stud
  details. No cell is empty and no two rows match. The back is where builds go bare, so write
  it first. Subject notes may give the columns in more detail (towers.md).
- **Props and story**: at least eight props from four or more groups, and what is going on.
- **Palette**: the colour IDs with rough shares, base, shadow and highlight per material.
- **Targets**: expected piece count, small-part share (benchmark 40-56%), and the share built
  sideways (benchmark 5-10%), and the split of pieces between subject and scenery (subject at
  least two thirds).

## How to build one

1. **Reference.** Ask for reference images if there are none, and read the technique notes for the subject (the measured targets at the end of each give the benchmark: small-part share, sideways share, roof slopes). List what makes the subject
   recognisable: silhouette, colours, roof, windows, towers, entrance, props, scenery.
   Read the subject's group in [docs/rebrickable-benchmarks.md](../../../docs/rebrickable-benchmarks.md)
   for the piece count, part mix and palette real sets of that kind use. Pick the setting the
   base follows (landscape, street, desert or waterfront, in the build standard): a town
   house goes on a street, not an island. The catalogue has no road or cactus parts: lay
   roads from tiles (kept as plates where props stand, since tiles have no studs) and build
   cacti from round bricks with arms on rounded plates (`35480`). `western-town.ts` is the
   worked desert setting, with a wagon on `4624c01` wheels and `4600` pin plates.
2. **Plan.** Draw top-down character maps per layer (see `SQUARE` in `flower-stall.ts` and
   the castle's plans), with the front at high z and x running left to right as seen from the
   front. Wrap `add` in `reflectToFront` (`layout.ts`) so the front faces the default camera
   the right way round; `turnAround` turns the plan instead and leaves it mirrored. Set
   `buildArea` (16 to 128) to fit the subject plus scenery. Two kinds of piece need care
   under the reflection (`courtyard-house.ts` shows both):
   - Doors and casements are handed. Reflect the frame first, fit the door against the frame
     where it lands on the board with `isMatchingInsertFrame`, and hand the door on
     unreflected (`addDoor`).
   - Side-mounted pieces: seat them in plan space with `seatOnSideStuds` on their host and add
     them with their `facing`; the reflection flips ±z facings (`mount`, `sideStud`).
3. **Bulk.** Lay floors with `layPlateFloor` (`board.ts`) and walls and slabs with the
   `layout.ts` helpers: `addRun`, `addRing`, `addBondedMap`, `addAreaMap`, `addRowMap`, and
   `glazeWindows` for glass. Keep joints staggered between courses.
4. **Detail.** Procedural loops (hash-patched stone, `addRowMap` runs) are for the plain wall
   only. Everything in the brief's **Faces** table is placed by hand, one face at a time, so
   each face has its own windows, bands, relief and side-stud details. When unsure how a
   construction goes together (a corbel table, a window surround, a parapet), look at how
   official sets do it: `pnpm omr:excerpt find <part>` prints the parts round a part in the
   LDraw models in `data/omr/` (see towers.md); adapt the idea in your own coordinates, never
   the parts themselves, and do not paste the output into the repository. Read the technique notes for each surface and object in the build ([docs/techniques/](../../../docs/techniques/README.md): walls, facades-and-openings, roofs-and-rooflines, flora-and-terrain, vehicles, fauna, city-and-props) and go over every surface with the detail list above, by hand where it shows. This
   pass takes as long as the bulk, and it is where an example becomes good.
5. **Smooth.** Add `smooth` passes for rocks, terrain, roots and lawns.
6. **Count.** Update `expectedPieceCount`. To find the count and the first failing piece fast,
   build it with `createExampleRegistry([{ ...definition, expectedPieceCount: 0 }])` in a
   scratch script and read the error. A wrong count throws in the app too, and the workshop
   then hangs on "Preparing build…".
7. **Look.** Run `pnpm dev:studio`, open the example from **File**, check the badge reads
   "<n> pieces · Valid", and look at it from every side, including the back and from above.
   Judge each face head-on against its row of the Faces table; the front looking good says
   nothing about the others.
   The workshop autosaves the build it shows, so after each change reopen the example from
   **File**. Orbit by dragging (the angle per drag varies, so check where you ended up);
   scroll zoom is coarse; the **Top** and **Front** camera buttons give fixed views. Judge colours in the cinematic view: the normal
   view washes light colours out, so Light Bluish Grey `71` looks almost white there. To see
   the back head-on, orbit round, or temporarily build without `reflectToFront` if the build
   still validates that way. Restart the dev server after adding parts to the catalogue.
8. **Compare.** Write a point-by-point diff of the render against the reference and the
   standard above, fix the biggest silhouette and colour gaps first, and render again. Rework
   the model itself (roof, windows, towers, steps), not just the scenery around it.
9. **Score.** Run `pnpm example:score <id>` after the bulk, and again after the detail pass. It
   measures part variety, small-part share, side-mounted detail, sloped top, colours, thin layers,
   wall relief (how much the walls step in and out), planting variety and how alike the build is
   to the other examples, against what official sets do. Every `LOW`
   line names the fix; work through them (in the design brief's terms) and rerun until none is
   low, or say why one is not wanted (a flat-roofed build has no sloped top). Side-mounted detail
   is where examples fall shortest: the existing examples mount about 0.1% of their pieces on
   side studs against 3-10% in official models, so plan sills, shutters, lamps, ivy and signs
   with `seatOnSideStud` from the start. `Every face detailed` counts the distinct part and
   colour pairs on the poorest face of the build; a bare back wall fails it. `Plain wall` is
   the share of the visible wall that is a field of one brick and colour. Both are heuristics
   calibrated on the examples: they catch a flat face, not a dull design, so the render
   comparison in step 8 still decides.
10. **Verify.** `pnpm test` and `pnpm check`.

## Before calling an example done

Run the checklist at the end of [docs/build-standard.md](../../../docs/build-standard.md), check
that the example is deterministic, valid and that `expectedPieceCount` is right, and that
`pnpm example:score <id>` shows no unexplained `LOW`.

## Looking at it headlessly

The workshop needs a browser. To check a build without the user: run `pnpm dev:studio` in the
background on a spare port, drive it with playwright-core and the cached headless Chromium
(`--use-angle=swiftshader --enable-unsafe-swiftshader`; software rendering is slow, wait about
40 s for big builds and give `page.screenshot` a long timeout), click **File** then the example's
name, and crop areas with `sips -c`. Check the badge reads "<n> pieces · Valid" before judging
the look. A wrong `expectedPieceCount` hangs the workshop on "Preparing build…", so fix it before
rendering. Restart the dev server after adding parts to the catalogue.
