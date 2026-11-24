# Brick engine

The rules behind every build in Brick Workshop: coordinates, parts, connections, physics,
colours and the example builds. This package has no UI or rendering dependencies, so the workshop, both games and Claude all build through it.

## Quick start

```ts
import { createExampleAssembly, exportLDraw, placeBrick } from '@brick-workshop/engine';
import type { Assembly } from '@brick-workshop/engine';

let assembly: Assembly = { name: 'Small stack', bricks: [] };

// Each call returns a new valid assembly, or issues that say what is wrong.
const result = placeBrick(assembly, {
  id: 'a',
  partId: '3005', // a 1 x 1 brick
  color: 4, // red
  x: 0,
  y: 0,
  z: 0,
  rotation: 0,
});
if (result.ok) assembly = result.assembly;
else console.log(result.issues);

const ldr = exportLDraw(assembly); // LDraw text, opens in any LDraw tool
const house = createExampleAssembly('courtyard-house'); // a finished example
```

## What's inside

| Area                | Files                                          | What it does                                                                                                                                         |
| ------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Parts and placement | `core`                                         | The part catalogue, placement, collision and support checks, removal, and LDraw export.                                                              |
| Colours             | `colors`, `part-colors`, `part-color-evidence` | The LDraw colour table, and which part came in which colour (see "Colours and evidence" below).                                                      |
| Physics             | `physics`, `part-masses`                       | Static gravity analysis and the masses it uses.                                                                                                      |
| Planning and edits  | `planning`, `edits`, `techniques`, `part-uses` | Placement candidates and connection explanations, atomic patches with an edit policy, building techniques, and searching parts by what they are for. |
| Building shapes     | `board`, `voxels`, `shapes`, `smoothing`       | Floors, filling solids and sampled models with bricks, and smoothing surfaces into slopes and curves.                                                |
| Instructions        | `instructions`                                 | Ordering pieces into building steps, so each comes after what it rests on.                                                                           |
| 9V train track      | `track`                                        | Track sections, curves and switches.                                                                                                                 |
| Examples            | `examples/`                                    | The example builds and their registry (see "Examples" below).                                                                                        |

Everything is exported from the package root; `examples/trees` and `examples/layout` are also
exported for the helpers the example builds share.

## Tests

```sh
pnpm test    # from the repository root
```

## Coordinates and placement

Positions are in studs for X/Z and plates for Y, in steps of 0.5; a brick is
three plates. X/Z are the minimum corner of the rotated footprint, rotations are
quarter turns, and all studs point up (except side-stud bricks, which hold pieces
mounted sideways; a mounted piece's height steps by a quarter plate, so a jumper
can set the next piece half a stud up). Boards are square, 16 to 128 studs (`Assembly.buildArea`).

`placeBrick`, `removeBrick`, `previewPatch` and `applyPatch` return a new valid
assembly or structured issues and never mutate their input. A piece above the
ground needs at least one matching stud connection to grounded support; removing
a piece is refused if it would leave others unsupported. Collisions reserve each
part's whole rectangular envelope.

## Parts

The catalogue in [core.ts](src/core.ts) holds a curated
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
- Bars: the rigid parts of LDraw's Bar category, meaning rods with a bar to clip onto, studded
  and clip bars, towball bars, grilles, gates, fences and barred windows. Only the clips of `11090` and
  `3628` grip; the other clip, hub and ball-joint ends are not modelled yet.
- Measured parts: 328 of the pieces official sets use most that the hand-made catalogue lacked,
  such as brackets, special plates and tiles, wedge plates and curved and sloped bricks, with
  envelopes, stud cells and side studs measured from their LDraw meshes by
  `apps/brick-studio/tooling/generate-measured-parts.ts` (`measured-parts.ts`; do not edit by
  hand). They are rigid pieces that stand on their studs: clips, handles and sockets do not grip.
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

**Wheels and strings.** A part marked `rests` stands on whatever its base touches,
without studs: a wheel (`4624c01`) resting on the road is held, and the pin plate
(`4600`) that clips onto it hangs from it, so a car stands on its wheels. Braided
strings (`75924`, `71149`) are `flexible`: each end is a round plug with a stud on
top and a hollow below, and the string either lies straight, its ends 20 or 40
studs apart, or is strung (`Brick.strung`, the far end's cell) between any two
studs no further apart than that, at any heights and in any direction. The cord
then runs straight between the ends, the plugs stay upright, either end holds it,
and pieces may stand on both plugs. Nothing may cross the cord, except that it
drapes over the edge of what its plugs stand on or carry. The physics solve
weighs a strung string at its middle.

**Horses and riders.** A horse (`4493c01`) stands on its hooves like a wheel, with two studs on
its back. A saddle (`4491b`) sits on those studs and carries a rider's hips and legs
(`3815c01`) on two studs of its own: the rider's feet stand on the saddle, and the flaps either
side rise round his legs.

**Hinges and tilted frames.** A hinge brick base (`3937`) holds a hinge top (`3938`)
one plate up at the same position and turn; the top turns about the pair's long axis.
A piece's optional `tilt` (`toward`, `angle` in 22.5° steps up to 90°, and the hinge
line's height `y` in plates and position `at` in studs) places it as if upright and
then turns it about that line, its top leaning toward `toward`. `getHingeTilt(base,
toward, angle)` gives the line for a base. Pieces with the same tilt share one frame:
they stack on each other's studs as if upright, so a plate on a tilted hinge top can
carry tiles at that angle, as on a hinged roof panel. A tilted top hangs from its base
and the rest of the frame from it, like side-mounted pieces. Pieces in different frames
collide as turned boxes (allowing 2 LDU), and a frame may lean over its own hinge base.
Tilted pieces have no side studs, and the workshop shows them but places pieces only
upright or on side studs.

To add a part, define it in `PARTS` (see `basicPart`, `contouredPart`,
`curvedSlopePart` and friends), read its size, native centre and stud positions
from the `.dat` geometry, and run `pnpm test`. The catalogue sampler example
places every part once, so new parts are covered automatically.

## Physics

`assessPhysicalFeasibility` balances forces and moments on every piece with a
linear solver: the floor and resting surfaces push, studs can pull. It reports
whether the build balances, needs clutch, or tips, and which joints are
overloaded. Masses come from host data, then the bundled BrickLink catalogue
weights ([part-masses.ts](src/part-masses.ts)), then
optional solid-volume estimates; parts without a source stay unknown. Stud
tension is checked against a default of 0.5 N a stud unless the host supplies a
limit. Tipping is decided for any size; the full solve is capped at 1,000 pieces
unless `fullCheck` is set. Hosts can swap in HiGHS with
`setLinearSolver(createHighsSolver(...))`; the workshop runs it in a worker.

Results are a static model, not a certification: bending, shear, construction
order and real clutch strength are not checked, and
`getBuildabilityReport` always reports `certified: false`.

## Colours and evidence

`COLORS` is a snapshot of LDraw's `LDConfig.ldr`. Whether a part was ever made
in a colour comes from a reviewed snapshot of Rebrickable inventories
([part-color-evidence.ts](src/part-color-evidence.ts));
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

## Benchmarks against real sets

[docs/rebrickable-benchmarks.md](../../docs/rebrickable-benchmarks.md) compares the examples with
the reference sets (modular buildings, Architecture landmarks, Ideas and Icons castles and
cottages) by piece count, part-category mix, small-part share and palette. It also ranks
the parts those sets use that the catalogue lacks, and the supported parts the examples
underuse. The reference sets and the example each group benchmarks are `REFERENCE_GROUPS`
in [rebrickable-report.ts](../../apps/brick-studio/tooling/rebrickable-report.ts). Regenerate with:

```sh
pnpm rebrickable:report
pnpm fmt
```

It downloads any missing Rebrickable CSVs into `data/` first. Inventories list parts, not
positions, so it measures proportions, not construction. For counting only, it treats
lettered moulds (`3665a`, `3665`) as one design; it never writes part or colour mappings.

## Examples

| Example             | Pieces | Detail                                                                                                                 |
| ------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------- |
| Courtyard House     | 1,912  | Half-timbered cottage with dormer and outside stair on a landscaped island, tree, well and pond.                       |
| Catalog sampler     | all    | Every supported part once, on an 80 x 80 board.                                                                        |
| Seaside Lighthouse  | 415    | Striped tower on a rocky island with keeper's cottage, jetty and rowboat.                                              |
| Flower Market Stall | 351    | Booth with striped awning, flower buckets, crates, tree and bench.                                                     |
| Nordiska Museet     | 11,506 | The Stockholm museum with its towers, gables, dormers and windows.                                                     |
| Castle              | 7,951  | Walled castle: round towers, gatehouse, moat and drawbridge, keep, well.                                               |
| Hill Valley (1955)  | 11,864 | The courthouse square: portico and clock tower, the Essex theatre, shops, filling station, fifties cars and townsfolk. |

Each example is a module in
[packages/brick-engine/src/examples](src/examples)
implementing `ExampleDefinition`, registered in
[registry.ts](src/examples/registry.ts):

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
