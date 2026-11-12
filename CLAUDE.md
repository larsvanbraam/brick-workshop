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

### What a good example looks like

The bar is the reference builds this project was steered by: the Bookshop and Pub modular
buildings, Notre-Dame from the Architecture line, and fan-built (MOC) castles, towers and
cottages on landscaped bases. They share one look: a recognisable subject with natural
shapes, layers of small details and muted, realistic colours. A build that is correct but
plain is not finished.

**Buildings are layered, never flat walls.**

- Split every façade into storeys with a band between them: a plate or tile course in a
  contrasting colour (tan on white, white on brick), often stepping out with inverted slopes
  (`3665a`, `3660a`) as a cornice. Give each storey its own material: stone ground floor,
  brick middle, half-timbered or rendered top.
- Corners and edges get quoins (stacked bricks in a lighter shade, alternating long and
  short), pilasters or columns.
- No window is a plain hole: give it a frame, a sill, glazing, and usually a lintel or arch,
  shutters or a window box planted with flowers and sprigs.
- Half-timbering: dark beams (`308` or `70`) in a light infill (`15`, `19` or `78`), with
  diagonal braces where the catalogue allows.
- Roofs are textured and broken up. Lay shingles as a stepped plate roof covered in staggered
  tiles with angled ends (`22385`) or slopes, in two shades of the roof colour with a few
  accent tiles. Add dormers, chimneys with pots, a ridge, eaves that overhang the wall, and
  gutters.
- The roofline never ends flat: finials and cones (`4589`, `59900`), a dome or spire, flags on
  antennas, railings or crenellations along the top.
- A monochrome landmark (Notre-Dame) works only through depth: recesses, columns, rows of
  arches and grilles that cast shadow, and repetition with variation.

**Stone has texture and depth.**

- A stone wall is a base colour with patches of one or two others, the way the reference
  castles scatter tan and dark tan through light grey: clusters of 1 x 1 and 1 x 2 bricks or
  masonry bricks covering 15-25% of the wall, never single evenly spaced dots.
- Vary the surface: a few bricks or tiles stand half a stud proud (headlight and side-stud
  bricks), beam ends and corbels stick out, loopholes and small arched windows break it up.
- Battered bases, buttresses and corbelled turrets keep towers from being straight tubes.

**Landscape bases, not a board with a building on it.**

- The base has an organic outline and height: leave the board's edge free and shape the ground
  with rounded-corner plates, so the build stands on an island, not a square. Show layered rock
  and earth strata (`72`, `71`, `19`, `28`) on the sides like a cut-away.
- Terrain rises and falls by plates. Rocks are angled clusters of mixed sizes in two or three
  greys, worn paths are tan and dark tan tiles, and the ground mixes grass, earth and gravel
  rather than one green field.
- Water is never one flat colour: blue with darker depths and lighter edges, transparent pieces
  for falls and ripples, reeds and lily pads at the bank.
- Plants come in clusters of several kinds and heights: conifers and broadleaf trees, bushes,
  ferns, tall grass and reeds, with small flowers in groups of one colour (yellow, red, white).
- Green climbs buildings: ivy up walls, hanging baskets and window boxes, a tree against the
  façade.

**Stories and props.** Every scene has something going on: a well, a cart, a market stall, a
lamppost and bench, a fountain, barrels and crates, a sign over the door, a flag on the tower.

**Natural shapes, not boxes.**

- Nothing living or natural has a straight edge or a flat top. Rock outcrops are clusters,
  shorelines and paths wander, trees lean and branch.
- Break every outline: step walls in and out, vary heights between neighbours, round corners
  and let pieces overhang a little.
- Sculpt rounded masses (rocks, hills, roots, bushes, figures) from staggered plates and
  bricks, then let smoothing (below) turn the steps into slopes and curves.

**Tiny details everywhere.**

- No bare stud field larger than about 4 x 4 and no blank wall longer than about 4 studs: each
  gets texture, a feature or a prop.
- Texture walls: masonry bricks (`98283`, `15533`), log bricks (`30136`, `30137`), grille and
  groove bricks (`2877`, `4216`), and a few bricks in a second shade.
- Round off: round 1 x 1 bricks and plates (`3062b`, `6141`), quarter-circle plates (`7904`),
  round-corner plates (`30357`, `30565`, `6003`), macaroni tiles, rounded-end plates and tiles
  (`35480`, `77845`, `1126`, `5520`), quarter-round tiles (`25269`), curved slopes (`11477`,
  `50950`, `15068`, `24309`, `93606`) and cheese slopes (`54200`, `85984`).
- Dress surfaces: paths and floors as a mix of tiles (`3070b`, `3069b`, `2412b`) and open
  studs; round tiles (`98138`, `14769`) as stepping stones; jumper plates (`3794b`, `87580`,
  `18674`) for half-stud offsets.
- Build sideways (SNOT) for details off a wall: side-stud bricks (`87087`, `11211`, `30414`,
  `4733`, `47905`), headlight bricks (`4070`) and the bracket (`99780`) for sills, signs,
  lamps, ivy and shutters.
- Plants: `addTree` in `trees.ts` for trees; bushes (`6064`), tall grass (`30093`), leaf
  sprays (`2423`, `2417`, `6255`, `30176`), sprigs (`32607`), flower leaves (`4727`) and
  flowers (`24866`), plus 1 x 1 round plates in flower colours on grass.
- Props tell the story: lampposts (`2039`), fences and railings (`33303`, `3185`, `3633`,
  `30055`), flags on antennas (`2335` on `3957a`), barrels from round bricks (`3941`),
  crates, benches, buckets and pots (see `flower-stall.ts`).
- Search `PARTS` in `core.ts` for anything else; the README explains how to add a part.

**Realistic colour combinations.**

Pick a small palette per material and use it in shades, the way sets do: about 70% base,
20% shadow, 10% highlight, plus small bright accents (under 5% of the pieces).

| Material   | Base                                                                                      | Shadow                | Highlight                     |
| ---------- | ----------------------------------------------------------------------------------------- | --------------------- | ----------------------------- |
| Stone      | Light Bluish Grey `71`                                                                    | Dark Bluish Grey `72` | Very Light Bluish Grey `151`  |
| Earth/sand | Tan `19`                                                                                  | Dark Tan `28`         | (Reddish Brown `70` for soil) |
| Timber     | Reddish Brown `70`                                                                        | Dark Brown `308`      | Medium Nougat `84`            |
| Foliage    | Green `2`                                                                                 | Dark Green `288`      | Bright Green `10`, Lime `27`  |
| Old green  | Sand Green `378`                                                                          | Olive Green `330`     | Yellowish Green `326`         |
| Water      | Blue `1`, Medium Blue `73`                                                                | Dark Blue `272`       | Trans Light Blue `43`         |
| Roofs      | Dark Red `320`, Dark Bluish Grey `72`, Sand Green `378`, Black `0`, Reddish Brown `70`    |
| Accents    | Red `4`, Yellow `14`, White `15`, Pink `13`, Dark Pink `5`, Orange `25`, Pearl Gold `297` |

- Shade by position: darker low down, in recesses and on the shaded side; lighter on tops and
  edges that catch the light. Foliage is darkest inside and below, lightest on top.
- Scatter shades with a seeded hash or `random(seed)` from `trees.ts`, never alternate them in
  a pattern, and keep each example deterministic.
- Avoid large areas of saturated primaries, one flat colour per mass, and bright green, blue
  and red blocks side by side.

Palettes the references use, as starting points:

- **Town building** (Bookshop, Pub): white `15` and tan `19` bands, sand green `378` or green
  `2` shopfront, dark blue `272` mansard roof with dark bluish grey `72` railings, reddish
  brown `70` brick with medium nougat `84`, gold `297` on the dome, red `4` awnings in small
  touches.
- **Castle in a landscape**: light bluish grey `71` walls patched with tan `19` and dark tan
  `28`, reddish brown `70` beams and balconies, black `0` or dark bluish grey `72` cone roofs,
  red `4` flags, dark bluish grey `72` cliffs, blue `1` water, dark green `288` and green `2`
  trees, tan `19` sand.
- **Stone tower**: light bluish grey `71` with tan `19` and dark tan `28` patches, dark red
  `320` roof with orange `25` accent tiles, earth and rock in `72`, `71` and `19`, dark green
  `288` water, yellow `14` flowers.
- **Cottage**: dark red `320` and red `4` shingles, reddish brown `70` and dark brown `308`
  timbers, light grey `71` stone ground floor with `72` quoins, white `15` lattice windows,
  green `2` lawn and dark green `288` tree.
- **Landmark**: one colour family (tan `19` with dark tan `28` in the recesses) on a black `0`
  base, with one dark accent (a spire in `72`).

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
build on and studs meant to show stay as they are. Smoothing pieces count towards
`expectedPieceCount`.

### How to build one

1. **Reference.** Ask for reference images if there are none. List what makes the subject
   recognisable: silhouette, colours, roof, windows, towers, entrance, props, scenery.
2. **Plan.** Draw top-down character maps per layer (see `SQUARE` in `flower-stall.ts` and
   the castle's plans), with the front at high z, and wrap `add` in `turnAround` so the front
   faces the default camera. Set `buildArea` (16 to 128) to fit the subject plus scenery.
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
   "<n> pieces · Valid", and look at it from every side, including the back and from above,
   in the normal and the cinematic view. To see the back of a `turnAround` build, temporarily
   build it without `turnAround`. Restart the dev server after adding parts to the catalogue.
8. **Compare.** Write a point-by-point diff of the render against the reference and the
   standard above, fix the biggest silhouette and colour gaps first, and render again. Rework
   the model itself (roof, windows, towers, steps), not just the scenery around it.
9. **Verify.** `pnpm test` and `pnpm check`. Examples under 2,500 pieces also run through the
   building instructions tests.

### Before calling an example done

- Is the subject recognisable from the reference at a glance, from the front and the back?
- Does every façade have storey bands, framed windows with sills and boxes, and a textured
  roof with a broken roofline?
- Does it stand on a shaped landscape with height, layered edges, mixed ground, water or rock
  where it fits, and plant clusters of several kinds?
- Does anything natural still have a straight edge, a flat top or a hard corner?
- Is there any bare stud field over about 4 x 4, or a blank wall over about 4 studs?
- Does every material use two or three shades, with accents kept small?
- Is it deterministic, valid, and is `expectedPieceCount` right?
