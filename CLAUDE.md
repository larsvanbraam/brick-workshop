# Brick Workshop

A LEGO assembly playground: a UI-free engine (`packages/brick-engine`), a Claude adapter
(`packages/claude-adapter`) and the workshop app (`apps/web`). The [README](README.md) covers
the engine's rules (coordinates, parts, connections, physics); read it before placing pieces.

```sh
pnpm dev     # workshop on http://localhost:5173
pnpm test    # Vitest
pnpm check   # format, lint and typecheck; run before every commit
pnpm fmt     # format the workspace
```

Commit straight to `main`; this repo has no feature branches. Commit only when asked.

## Example builds

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
  tests. Keep a single-subject scene (a house, a tower) under that, and spend no more pieces
  on scenery than on the subject.
- **Hidden supports.** Pieces only bond through studs, so a hollow shell (a roof, a dome) can
  leave cells nothing holds. Hidden posts inside it are fine: dark colour (`308` or `72`),
  never visible from any side, and counted (the courtyard house's roof needs about 100).
  Design the shell to bond on its own first; posts are the fallback.

### What a good example looks like

The standard every build is held to, in code or in the workshop's generate panel, lives in
[docs/build-standard.md](docs/build-standard.md); the workshop's Claude loads the same file,
so edit it there to change both.

@docs/build-standard.md

In code, the standard maps onto these helpers:

- Tilted roof panels: tilt hinge tops (`3938`) with `getHingeTilt` (README, "Hinges and
  tilted frames").
- The roof in `courtyard-house.ts` is the worked roof recipe; reuse it.
- Trees: `addTree` in `trees.ts`. Crates, benches, buckets and pots: see `flower-stall.ts`.
- Plant receivers: check a part's `connections` in `core.ts` before placing it.
- Scatter shades with a seeded hash or `random(seed)` from `trees.ts`, so each example stays
  deterministic.
- Search `PARTS` in `core.ts` for anything else; the README explains how to add a part.

### Smoothing

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

### How to build one

1. **Reference.** Ask for reference images if there are none. List what makes the subject
   recognisable: silhouette, colours, roof, windows, towers, entrance, props, scenery.
   Read the subject's group in [docs/rebrickable-benchmarks.md](docs/rebrickable-benchmarks.md)
   for the piece count, part mix and palette real sets of that kind use.
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
4. **Detail.** Go over every surface with the detail list above, by hand where it shows. This
   pass takes as long as the bulk, and it is where an example becomes good.
5. **Smooth.** Add `smooth` passes for rocks, terrain, roots and lawns.
6. **Count.** Update `expectedPieceCount`. To find the count and the first failing piece fast,
   build it with `createExampleRegistry([{ ...definition, expectedPieceCount: 0 }])` in a
   scratch script and read the error. A wrong count throws in the app too, and the workshop
   then hangs on "Preparing build…".
7. **Look.** Run `pnpm dev`, open the example from **File**, check the badge reads
   "<n> pieces · Valid", and look at it from every side, including the back and from above.
   The workshop autosaves the build it shows, so after each change reopen the example from
   **File**. Orbit by dragging (the angle per drag varies, so check where you ended up);
   scroll zoom is coarse; the **Top** and **Front** camera buttons give fixed views. Judge colours in the cinematic view: the normal
   view washes light colours out, so Light Bluish Grey `71` looks almost white there. To see
   the back head-on, orbit round, or temporarily build without `reflectToFront` if the build
   still validates that way. Restart the dev server after adding parts to the catalogue.
8. **Compare.** Write a point-by-point diff of the render against the reference and the
   standard above, fix the biggest silhouette and colour gaps first, and render again. Rework
   the model itself (roof, windows, towers, steps), not just the scenery around it.
9. **Verify.** `pnpm test` and `pnpm check`.

### Before calling an example done

Run the checklist at the end of [docs/build-standard.md](docs/build-standard.md), and check
that the example is deterministic, valid and that `expectedPieceCount` is right.
