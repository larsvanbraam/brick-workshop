# Brick Workshop

A local LEGO assembly playground in a pnpm monorepo using Vite Plus, React 19,
TypeScript, and Three.js. The engine has no UI or rendering dependencies.

## Run

Requires Node.js 22.18+, 24.11+, or 26+ and pnpm 12.16.1.

```sh
pnpm install
pnpm dev
```

Open the URL printed by the development server, normally http://localhost:5173.
The project-local Vite Plus CLI is included; a global installation is optional.

## Workspace

- `apps/web`: 3D assembly viewer, part palette, placement preview, layer
  inspection, exploded view, undo/redo, full-library browser, and JSON/LDraw exports.
- `packages/brick-engine`: prototype catalog, placement, collision and support
  validation, static gravity/load analysis, safe removal, bill of materials,
  LDraw export, and shared examples.
- `packages/claude-adapter`: Node-only Claude tool sessions, validated tool inputs,
  bounded API loop, and a local generation command. The engine does not import it.
- `data`: instructions for the local, Git-ignored LDraw parts library.
- Root `vite.config.ts`: shared formatting, linting, and engine tests.

The web app consumes `@lego-builder/brick-engine` through a workspace dependency.
Source is exported directly for development. The engine's separate build also
produces an ESM bundle and declarations under its `dist` directory.

## Checks

```sh
pnpm test       # Engine, catalog, and library tests via Vite Plus / Vitest
pnpm check      # Formatting, lint, and TypeScript checks
pnpm build      # Typecheck, web build, standalone engine build
pnpm fmt       # Format the workspace
```

Engine tests construct the complete 164-design catalogue sampler through
`placeBrick`, placing every supported part exactly once on a 64 x 64 board at
Y=0 with half-stud gaps. This includes all supported tiles, architectural
details and foliage. Focused tests separately cover connection, support-removal
and part-family behavior.
Mixed smooth/studded contact and half-unit mounts remain covered by focused tests.
They cover collisions, floating placements, support removal, top-down disassembly,
bill-of-materials totals, input-order independence, and layer-based LDraw exports.
The same definitions are available in the workshop's **Load example** dropdown,
alongside Courtyard House. Loading an example resets the view and placement
preview and can be undone. These checks are not physical-strength certification.

| Example         | Pieces | Detail                                                                                                                                                     |
| --------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Courtyard House | 306    | Two-storey medieval hall, half-timbering, watchtower, stepped slate roof, chimney, well and furnished courtyard; 35 designs, eight colors, 49 plates high. |
| Catalog sampler | 164    | Every supported design exactly once, including all architectural details and foliage, on one 64 x 64 ground-level board.                                   |

Examples validate geometry, not every manufacturing combination or physical
strength requirement. Medieval colors outside the six mapped colors and the
two ambiguous legacy doors retain unknown manufacturing evidence.

## Workshop Performance

Selection reuses assembly validation, placement previews, physical reports and
the part/color pickers. Geometry validation uses spatial collision buckets and
an index of grounded stud sites, while retaining exact clearance checks and
deterministic issue ordering.

Opaque native pieces are batched by part and color: faces use instancing and
shared mesh BVHs for picking; ordinary and conditional edges are merged with
their native attributes preserved. Transparent pieces and procedural fallback
geometry retain individual rendering. Draw-call savings therefore depend on
part/color diversity, and picking still considers individual instances.
The canvas renders on demand, including orbit movement, selection and edits.

Startup loads only the designs used by the initial assembly plus the selected
part (currently 36 designs for Courtyard House), not all 164 supported designs.
Supported parts share selective manifests and cached model promises; selecting
or placing another design loads only missing geometry while retaining the
current scene. Failed model requests are evicted so later requests can retry.
The server prepares only requested dependency closures, serves safe geometry
assets independently and defers full-catalogue indexing until the browser needs it.
Static builds still package the complete supported library, but the client parses
only requested models.

Example registries cache successfully validated templates and return independent
copies on subsequent loads. The first build retains all sequential placement
checks. Local Node timings for the 306-piece house were approximately 450 ms
for its first construction and 0.15-0.22 ms for subsequent copies; these are not
browser startup timings. This also avoids repeating generation during development
Strict Mode initialization without disabling Strict Mode.

An initial loading screen hides the unfinished workspace until the local parts
library resolves and the scene has rendered its first frame. Missing native
files still open the procedural fallback rather than leaving loading stuck.
Loading and GPU preparation can still involve synchronous work; the loading
screen does not move that work to a worker.

Performance changes do not relax geometry validation, the Claude adapter's
500-piece limit, the static solver's 200-piece limit, or certification rules.

## Adding Examples

The engine core lives in `packages/brick-engine/src/core.ts`; the public entry
point re-exports it alongside the example registry. Each example lives in its own
module under `packages/brick-engine/src/examples/` and implements `ExampleDefinition`:

```ts
import type { ExampleDefinition } from './types.ts';

export const smallStack: ExampleDefinition = {
  id: 'small-stack',
  name: 'Small stack',
  tags: ['vertical-support'],
  expectedPieceCount: 2,
  build(add) {
    add('3005', 4, 0, 0, 0);
    add('3005', 14, 0, 3, 0);
  },
};
```

Import the definition in
[registry.ts](packages/brick-engine/src/examples/registry.ts) and add it to the
`createExampleRegistry([...])` list. No picker changes or switch cases are needed.
Use a unique kebab-case ID and meaningful scenario tags. `build` is synchronous;
`add(partId, color, x, y, z, rotation?)` defaults to zero rotation and validates
each placement through the engine on the first load, then reuses an isolated
copy of the validated template on subsequent loads. The registry rejects duplicate IDs, invalid
metadata/placements, and mismatched piece counts, and returns fresh assemblies
on every load. `EXAMPLES` exposes immutable metadata without the build functions.
Set optional `buildArea` on an example to choose a whole-number square board
from 16 to 64 studs. The registry retains it on the assembly and metadata.

Common engine tests run for every registered example: validity, reverse input
order, bill of materials, exports, invalid placements, and reverse disassembly.
Keep scenario-specific assertions in the existing engine tests, such as a seam's
supporting bricks or a tower's alternate supports. Intentionally invalid scenes
belong in rejection tests rather than the loadable example registry.

## Engine Contract

Positions use studs for X/Z and plate units for Y, all in increments of 0.5. One plate is
3.2 mm; one brick is three plates. The default board is 16 x 16 studs;
optional `Assembly.buildArea` selects a square board from 16 to 64 studs.
`getBuildArea` resolves the current dimension; `MAX_BUILD_AREA` is 64.
The maximum height remains 60 plates. X/Z describe the minimum corner of a rotated reserved footprint.
Quarter-turn rotations are supported; all studs point upward.
The viewer grid, camera, placement bounds and JSON exports follow the assembly
board size. Claude accepts host-selected board sizes but cannot change the
host's board through a placement tool. Existing models retain their 16 x 16 boards.

`placeBrick` and `removeBrick` return a new valid assembly or structured issues
without modifying their input. The Claude tool adapter calls these
same APIs. Removing a piece is rejected if it leaves unsupported pieces.

The catalog currently contains 164 curated building designs and 320 official LDraw
colors. If the local library is installed, the viewer uses real LDraw meshes,
including studs, underside geometry, and edge lines. Otherwise it explicitly
falls back to simplified bodies and studs. Manufactured combinations are tracked
separately through inventory evidence; current stock is unknown. Native LDraw axes are mapped to the engine's grid
by `getLDrawTransform`, shared by rendering and export.

The supported range includes the original rectangular bricks, plates and tiles,
10 tall bricks, 21 roof slopes, eight round parts, six arches, two baseplates,
four cones, five doors/door frames, six windows/window frames, 24 detail parts
and ten foliage designs. The 56 additional designs target architectural builds:

- Masonry, grille and log textures; corner and headlight bricks; half-stud jumper plates.
- Shallow and steep roofs, inverted eaves, cheese slopes, curved caps and roof ridges.
- Lattice and picket fences, spindled balustrades, wall panels and additional arches/windows.
- Oval and evergreen trees, bushes, tall grass, leaf canopies, bamboo, sprigs and flowers.

Minifigures and figure accessories are excluded from the supported builder catalogue,
but remain previewable in the full-library browser. Loose door leaves/glazing,
sideways SNOT attachment, clips, hinges, Technic and other special connections remain unsupported.
Side-stud bricks can be placed upright using their vertical connections only;
their protruding side studs reserve additional clearance. `family` identifies these
parts independently of the brick/plate/tile `kind`; height is always in plates.
The picker searches all 164 IDs and has dedicated Details and Foliage filters.

Architectural starter IDs are arches `3659`, `4490`, `6182`, `3307`; baseplates
`3865` (8 x 16), `3867` (16 x 16); cones `4589`, `3942c`, `3943b`, `6233`;
doors/frames `801a`, `802a`, `3861c`, `3579`, `60596`; and windows/frames
`60592`, `60593`, `60594`, `2493b`, `3853`. Baseplates are half a plate thick,
have no underside receivers, and must stay on the ground. Larger boards do not
add new baseplate designs to the supported catalogue. Arches accept underside studs only at their
legs; cone tops use their actual centred one- or four-stud layouts. Integral
hinge doors are closed static pieces, not animated hinges or insert attachments.
Modern four-wide frames expose only the reviewed two centre top studs where
applicable. Protruding handles, hinges and sills reserve half-stud margins.

Ordinary slopes expose studs only on their high rear row; inverted slopes have
rear underside receivers and top studs, while smooth cheese/curved caps have no
top studs. Foliage uses explicit underside attachment sites and reserves its full
canopy envelope. Tree tops are not mounting surfaces; leaf elements expose only
their reviewed vertical sites. This deliberately disallows leaves or other parts
interlocking within reserved canopy space. Round parts use their reviewed
upright grid connections; tiles never support studs on top. Collision checks
reserve each part's entire rectangular envelope, including unused space around
round/conical bodies, above slope faces, and inside arch/frame openings. This conservative model does not permit
interlocking in that empty space. Native slope origins are offset by half a stud;
the shared render/export transform corrects that offset in all four rotations.
Native vertical base offsets also keep trees and bottom-origin roof caps aligned
in individual meshes, instanced batches and exported LDraw files.
With a local library installed, tests measure every supported mesh's native
width, depth, body height and centre against the engine definition; hardware
and sill meshes must remain inside their deliberately larger reserved envelopes.

| Stud Footprint | Brick ID | Plate ID |
| -------------- | -------- | -------- |
| 1 x 1          | 3005     | 3024     |
| 1 x 2          | 3004     | 3023b    |
| 1 x 3          | 3622     | 3623     |
| 1 x 4          | 3010     | 3710     |
| 1 x 6          | 3009     | 3666     |
| 1 x 8          | 3008     | 3460     |
| 2 x 2          | 3003     | 3022     |
| 2 x 3          | 3002     | 3021     |
| 2 x 4          | 3001     | 3020     |
| 2 x 6          | 2456     | 3795     |

| Tile Footprint | LDraw ID |
| -------------- | -------- |
| 1 x 1          | 3070b    |
| 1 x 2          | 3069b    |
| 1 x 3          | 63864    |
| 1 x 4          | 2431     |
| 2 x 2          | 3068b    |
| 2 x 4          | 87079    |

Tiles are one plate tall, with underside stud receivers but no top studs. They
can cap bricks and plates, but cannot supply stud support to a piece above.
A piece spanning a smooth tile and a studded plate can still connect through
the plate. Removing that plate is rejected if the piece loses its only stud
connection. This is connection validation, not a ban on physical surface contact
or a stability calculation. Both real meshes and the procedural fallback show
smooth tile tops. Choose **Tiles** or load **Catalog sampler** in the workshop.

`3023b` is the current LDraw 1 x 2 plate definition; `3023` is a moved alias.
Native body bounds for all 26 designs were checked against the installed
library in all four rotations and retained as engine regression fixtures.

Each part declares `connections.topStuds` and `connections.bottomReceivers` as
zero-based stud-cell indices, including reviewed half-cell offsets, in its unrotated footprint. `getConnectionSites`
rotates these into world-space stud centers (X/Z) and plate-unit heights (Y).
`hasStudConnection` requires matching top and underside sites on the exact height
plane. Validation applies this test only to already-grounded supports, regardless
of input order. Ordinary rectangular bricks and plates use complete connection grids;
tiles have complete underside grids and empty top-stud sets. The
underside sites describe compatible stud contact locations, not literal tube
geometry or measured clutch strength. Missing or misaligned sites do not connect
merely because the bodies overlap horizontally.

Validation checks body occupancy, bounds, supported IDs/colors, and at least one
grounded stud connection below each elevated piece. It does **not** certify
physical strength, sufficient clutch support, stability, a single connected model,
or an executable assembly sequence. Layer-based LDraw steps are a starting point,
not validated building instructions. Inspect exports in a LEGO editor and
physically test builds before relying on them.

Changes currently live in memory until exported. Refreshing resets the example.

## AI Placement Planning

The UI-independent engine exports `getEngineCapabilities(assembly)` and
`getPartCapabilities(partId)` for shared connector rules, reviewed static
frame/insert exceptions, conservative collision geometry and physics limits.
Runtime part connector fit remains unknown. Capability metadata describes model
coverage, not a successful physical assessment.

`findPlacementCandidates(assembly, query)` aligns an upright part's declared
receivers with existing world-space studs and validates every proposed placement.
`query` requires `partId` and `color`; optional `supportId`, `rotations`,
`includeGround`, `maxCandidates` and `maxChecks` restrict the search. Ground-grid
search defaults on only for empty assemblies. Defaults are 20 candidates and
256 unique placement checks; maxima are 50 and 2,000. Results are deterministic,
deduplicated and explicitly marked `truncated` when a limit cuts the search short.
Searches do not enumerate static frame inserts or special connections and are
not optimal or exhaustive searches over all possible geometry.

`explainConnection(assembly, brick)` reports ground contact, supporting stud
sites, reviewed insert frames and geometry issues. Neither API mutates the input.
Candidate IDs are temporary and collision-free within the supplied assembly.
Raw engine candidates check geometry only, not manufacturing, stock or physics.
Compatible connector sites do not establish measured clutch strength.

The Claude adapter's read-only `brick_candidates` tool adds the host's
manufacturing and physical policies. It defaults to eight candidates, allows
at most 20, and reports `placementAllowed` separately from physical uncertainty.
Model-infeasible candidates remain visible with rejection labels; unknown
results are never called safe or certified. `brick_connection` explains an
existing piece by stable ID. To commit a candidate, call `brick_place` with its
part, color, coordinates and rotation, without its temporary ID. Placement
rechecks current state and assigns a stable ID.

Palette harmony, inventory-aware design ranking and verified construction
sequences are not implemented yet.

## Building Technique Guidance

The engine includes a versioned, repository-authored advisory library in
[packages/brick-engine/src/techniques.ts](packages/brick-engine/src/techniques.ts).
Its initial guides cover grounded foundations, staggered wall joints and bridging
existing seams for reinforcement. Each guide includes prerequisites, supported
connections, required designs, steps, tradeoffs and explicit limitations.
These are upright connectivity heuristics, not measured structural capacities.

`getBuildingTechniques({ id?, topic?, limit? })` returns independent guide records
with version metadata. Topics are `foundations`, `walls` and `reinforcement`;
queries return at most three guides and report truncation. Exact IDs are
`foundations`, `staggered-walls` and `reinforcement`.

`createBuildingTechniqueExample(id, options)` creates a separate reference
assembly through sequential `placeBrick` checks. Options include `sections`
(2-4), `courses` (2-4, walls only), recognized `color` and a nonnegative half-grid
X/Z origin. Defaults are two sections, two wall courses, red and origin zero.
The reference board is 16 studs; out-of-bounds options are rejected. Tests cover
parameterized geometry, connections to both sides of seams, observed default
part/color combinations and nominal static balance. They do not verify real
clutch strength, construction access or physical load performance.

Claude's read-only `brick_techniques` tool explicitly sends selected guides into
the API conversation. Optional `includeExamples` defaults on. Examples include
parameter bounds but remain separate reference assemblies: their IDs are
illustrative, their coordinates are not placements in the current model, and
host policy approval is not evaluated. The tool also reports current build
capabilities. Guidance cannot bypass geometry, manufacturing, inventory or
physical-policy checks; adapt it using placement candidates and patch previews.

The runner asks the model to retrieve relevant guides on demand rather than
injecting the whole library into every system prompt. Editor skill files are
not automatically discovered by the application's API session. When updating
guidance or recipes, review the limitations, update version metadata and rerun
the technique fixtures and adapter conversation tests. Construction sequences
and physical buildability remain unverified.

## Atomic Edits And Policy

The engine exports `previewPatch`, `applyPatch` and `evaluateAssemblyPolicy`.
Patches contain 1-100 operations: `add` with a complete `brick`, `remove` by `id`,
or `update` by `id` with nonempty `changes`. Updates can move, rotate, recolor
or change the design but cannot change an ID. Each ID can be targeted only once.
The input assembly must have valid geometry. The complete resulting arrangement
is checked atomically, so coordinated swaps and support replacements need not
be valid after each listed operation.

Both APIs are pure: input assemblies, patch data and host data remain unchanged.
Preview returns an isolated proposed assembly and assessment without advancing
the revision. Apply reevaluates current data and policy, returning a new assembly
and incremented revision only on success. Rejections return structured errors
without a partial assembly. Callers implementing concurrency must retain their
revision, pass it in `{ revision, policy }`, and include the same
`expectedRevision` in the patch. A stale revision returns `revision_conflict`;
a preview is not a reusable approval token. Without an explicit revision,
standalone calls default to revision zero.

`EditPolicy` combines geometry, optional `maxPieces`, manufacturing evidence,
declared inventory and physical settings. Recognized colors alone are not
manufacturing evidence. `requireObservedColors` defaults off in the engine;
`rejectInfeasible` defaults on, while unknown physical results remain permitted
but uncertified. Engine mass estimation remains opt-in. The adapter retains
its stricter observed-color policy and enabled estimates; the workshop retains
unverified-color exploration and its host-selected physical settings.
Workshop previews, placements, removals and undo/redo use these shared checks.

Optional inventory is an array of unique `{ partId, color, quantity }` records
with nonnegative integer quantities. Usage is the complete final BOM, so removals
release quantities within a patch. Exceeding a declared quantity is rejected.
Missing records mean unknown, not zero; `requireInventory: true` rejects unknown
quantities. Inventory is supplied by the host, not independently authenticated
marketplace stock. Adapter hosts can provide `inventory` and `requireInventory`
through `createBuilderSession`; model tools cannot alter them.

Claude `brick_preview_patch` and `brick_apply_patch` require `expectedRevision`.
Successful commits increment the session revision once, irrespective of operation
count. Complete additions include a proposed unique ID and rotation; IDs become
stable only after success. Single-piece tools and placement candidates use the
same evaluator. Inspection/export retains declared inventory usage separately
from unknown marketplace stock.

Every assessment reports `constructionSequence: "not-validated"` and retains
the existing uncertified buildability report. A final-state support replacement
does not establish a safe order for removing and inserting the actual pieces.

## Physical Feasibility

`assessPhysicalFeasibility` is separate from `validateAssembly`. It uses
`javascript-lp-solver` to balance each piece's vertical forces and two gravity
moments, with equal/opposite forces on adjacent pieces. Ground contacts transmit
compression only; overlapping rectangular body surfaces transmit compression;
matching studs may transmit tension. This detects both global/component tipping
and local overhangs that need clutch tension, rather than accepting a single
stud as proof of adequate support. It accounts for mass ratios, rotations,
supplied centers of mass, and loads propagated through multiple joints.

```ts
import { assessPhysicalFeasibility, createExampleAssembly } from '@lego-builder/brick-engine';

const assessment = assessPhysicalFeasibility(createExampleAssembly('catalog-sampler'), {
  estimateMissingMasses: true,
});
```

By default the engine API uses the bundled **catalogue-reported** nominal weights
for 107 of the 164 supported parts. Tall brick `39266` and the 56 new architectural
and foliage designs have no verified bundled weight and remain missing unless a
host supplies one or enables estimates. New designs likewise have no bundled
manufacturing-colour observations; rendering support does not establish availability.
Lookup order is host-supplied `data.parts` overrides,
then catalogue weights, then optional estimates. Set `useCatalogMasses: false`
to disable the catalogue fallback. If no source is enabled for a part, total mass
and gravity remain unknown. Opt-in estimates use solid rectangular body volume,
8 mm stud pitch, 3.2 mm plate height, and assumed ABS density 1.05 g/cm3.
These are **not actual part weights**: cavities, studs and material differences
are ignored, and relative mass errors can change the tipping result. No measured
mass or connection-strength dataset is bundled; catalogue values are not
independently measured exact-piece masses.

Supply validated physical data with `importPhysicalData` and the assessment's
`data` option. The JSON format is:

```json
{
  "version": 1,
  "parts": {
    "3005": {
      "massGrams": 1,
      "kind": "estimated",
      "source": "Format example only, NOT a measured LEGO part weight.",
      "centerOfMassStuds": { "x": 0.5, "z": 0.5 }
    }
  }
}
```

Replace example values with sourced measurements and use `kind: "measured"`
only for measured masses. Centers are in unrotated local footprint studs;
omitted centers default to the body center. Provenance is supplied by the data
owner, not independently authenticated. An optional `studConnection` object
accepts `maxTensionPerStudNewtons`, `safetyFactor` (at least 1), and `source`.
This is a uniform host-supplied tensile cap, not a universal LEGO strength value.
The solver checks whether any equilibrium fits every per-stud cap after the
safety factor, not merely whether average load is low enough.

Results separate `gravity` (`balanced`, `requires-clutch`, `unstable`, or
`not-assessed`), mass basis/provenance, joint compression/tension, and supplied
tensile-limit status. `minimumStudTensionNewtons` is the minimum **total** across
all joints, not the force at each stud. Joint loads are one admissible static
solution, not a unique prediction. `status: "infeasible"` means no equilibrium
under the selected model or supplied limits. Otherwise physical feasibility
remains `unknown`, even for measured masses and apparently balanced builds.
Empty and geometrically invalid assemblies have separate statuses.

Assemblies containing slopes, round/conical parts, arches, doors/windows or thin
baseplates retain their mass/provenance report,
but return `gravity: "not-assessed"` and unknown connection strength. The
rectangular static solver does not represent their actual contact surfaces;
even host-supplied measured masses or tensile limits cannot bypass that boundary.
Hinge behaviour, aperture contacts and baseplate flexure are not simulated.

Numerical force/moment residuals are checked independently. Solver failures,
missing masses, more than 200 pieces, or more than 4,000 contact-force variables
leave assessment unknown, never passed. Bottom-up `assemblyOrder` has idealized
vertical insertion clearance for these upright rectangular bodies only. Bending,
intermediate construction stability, temporary supports,
shear, compression strength, friction, wear, disturbances, tipping margin,
real contact patches, deformation, and hand/tool clearance remain unverified.

The workshop's **Physical feasibility** inspector shows these distinctions,
imports physical JSON with validated local persistence, and exposes estimate
and rejection toggles. Catalogue weights, missing-mass estimates and rejection
of model-infeasible edits are enabled initially. Turning off estimates does not
disable catalogue weights. Geometry-valid but model-infeasible placements/removals are
rejected before mutation, including counterweight removal. Rejection can be
disabled for inspection; unknown results are not silently upgraded to safe.
JSON assembly and parts-list exports retain the assessment, data and policy.
`physicalData` contains custom overrides; `physicalAssessment.masses` retains
each effective mass and its provenance, including catalogue fallback values.

`getBuildabilityReport(assessment)` adds a fail-closed certification report:
passed, reported, estimated, failed and unknown requirements are separate.
Catalogue masses use `kind: 'catalog'`, `massBasis: 'catalog'` (or `'mixed'`), and
a `reported` mass check, never a measured/pass claim. Supplied masses,
centers and tensile caps cannot substitute for verified body strength, safe
construction steps, disturbance resistance, independent evidence or physical
validation. The current engine always reports `certified: false`; it cannot
establish a 100% real-world buildability guarantee. The inspector and JSON
exports list blockers. LDraw exports carry an `UNVERIFIED DRAFT` comment.
Claude `brick_export` accepts optional `purpose: "construction"` but refuses
that approval with `buildability_not_certified`; ordinary exports are drafts.

Published weights are available: BrickLink currently lists
[3001 at 2.32 g](https://www.bricklink.com/v2/catalog/catalogitem.page?P=3001),
[3005 at 0.44 g](https://www.bricklink.com/v2/catalog/catalogitem.page?P=3005), and
[87079 at 0.90 g](https://www.bricklink.com/v2/catalog/catalogitem.page?P=87079)
(checked 2026-10-31). Its catalog API documents `weight` in grams to two decimal
places and requires OAuth credentials. These are nominal catalogue observations,
not independently measured exact-piece weights or proof of connection strength.
The reviewed 107-part weight snapshot is bundled in
[packages/brick-engine/src/part-masses.ts](packages/brick-engine/src/part-masses.ts)
and exported as `CATALOG_PART_MASSES` / `PART_MASS_SOURCE`. It works offline and
requires no BrickLink credentials at runtime. Every record retains the source URL,
catalogue ID, retrieval date, nominal grams and mapping note. Explicit mappings are
`3023b -> 3023`, `3070b -> 3070`, `3069b -> 3069`, `3068b -> 3068`,
`6934 -> 6934a`, `2454b -> 2454`, `3040b -> 3040`, `3062b -> 3062`,
`6141 -> 4073`, `4032a -> 4032`, `801a -> 801apb00`, `802a -> 802apb00`, and
`3861c -> 3861`. The newer aliases are explicitly identified
in the native LDraw metadata, not inferred from similar-looking numbers.
BrickLink lists the three tile `b` IDs as alternates and lists ungrooved `a`
variants separately. No suffix-stripping or similar-size fallback is performed.
Catalogue entries may group mould variations, and weights are not colour-specific.
For updates, review each linked public item page (or use the authenticated API),
check its identifier/variant and weight in grams, then update the snapshot and
retrieval date together. Missing or ambiguous entries must remain unknown or
explicitly estimated, never be filled with an invented catalogue value.
The tooling-only `node apps/web/tooling/import-masses.ts review.json` collects
missing public-page records for review, using a structured HTML parser and
strict catalogue-ID checks. Optional arguments `engineId=catalogueId` require
independent alias review. It reports absent weight fields, stops on HTTP errors,
and never mutates the committed mass snapshot automatically.
Imported `catalog` records require valid date/source metadata and a reviewed
engine-to-BrickLink mapping; this validation does not authenticate the measurement.

## Colors And Inventory Evidence

`COLORS` is a committed, versioned snapshot of LDraw.org's `LDConfig.ldr`
(2026-05-29). `COLOR_SOURCE` records its source URL and SHA-256. The engine
and searchable color pickers work without a local library. Contextual main/edge
codes 16 and 24 are not selectable assembly colors.

Rendering applies LDraw RGB, edge colors, alpha, luminance, and Three.js's
standard chrome, pearl, metallic, and rubber finish parameters. Fixed colors in
patterned parts remain unchanged. Neutral local environment reflections require
no external image download. Glitter, speckle, fabric, and custom material
descriptors are preserved, but Three.js approximates their appearance rather
than simulating their detailed surfaces. Alpha transparency is not physical
light transmission or strength certification.

Three independent statuses are exposed by `getPartColorStatus`:

- **Rendering:** recognized LDraw color, not manufacturing evidence.
- **Manufacturing:** observed in a mapped Rebrickable inventory, or unknown.
- **Stock:** unknown; no marketplace or personal-stock source is connected.

The starter `DEFAULT_PART_COLOR_EVIDENCE` contains 562 observed combinations
under 106 reviewed part mappings and six color mappings: Black, Blue, Green,
Red, Yellow, and White. Not every part has observations in every mapped color. Explicit
reviewed mappings are retained, including LDraw `3023b` to Rebrickable `3023`.
The grooved tile variants `3070b`, `3069b`, and `3068b` use explicitly reviewed
matching Rebrickable IDs, not inferred unsuffixed aliases.
Native metadata explicitly maps LDraw `6934` to Rebrickable `6934a`, and
`39266` to `39268`, and `3861c` to `3861b`.
Legacy doors `801a` and `802a` remain inventory-unmapped because native handle
labels disagree with inventory design names. Their explicit native BrickLink
weight aliases do not resolve that manufacturing identity discrepancy.
The other 314 colors are rendering-supported but unmapped. Absence from the
dataset is **unknown**, never evidence that a combination was never manufactured.
Inventory observations can be historical and do not prove current production.

The source is Rebrickable's public `inventory_parts.csv.gz`; basic design/color
labels were reviewed against its `parts.csv.gz` and `colors.csv.gz` exports.
Data remains subject to [Rebrickable's terms](https://rebrickable.com/terms/).
Source URL, retrieval timestamp, mapping notes, and a supporting inventory ID
are retained. Imported provenance is supplied by the importer, not authenticated
by a signature; import only trusted datasets. No API key is needed for bulk files.

Refresh the LDraw palette or inventory evidence with:

```sh
pnpm colors:import # Optional argument: path to LDConfig.ldr
curl --fail --location --output data/inventory_parts.csv.gz https://cdn.rebrickable.com/media/downloads/inventory_parts.csv.gz
pnpm colors:inventory data/inventory_parts.csv.gz
pnpm fmt
```

Bulk CSVs are Git-ignored; only the compact evidence snapshot is retained. The
inventory importer streams plain/gzip CSV, validates headers and mappings,
ignores zero quantities, and keeps one supporting observation per combination.
Default retrieval time uses the downloaded file's modification time; preserve
that timestamp or supply accurate provenance in a custom configuration.

For more mappings, supply a JSON configuration with `version: 1`, `source`,
`mappings.parts`, and `mappings.colors`, using the snapshot's schema. Part keys
are canonical LDraw IDs; values are Rebrickable part numbers. Color keys are
LDraw codes; values are explicitly verified Rebrickable IDs. Do not infer
mappings from equal numbers, names, or RGB alone. Record how each mapping was
verified in `source.mappingNote`.

```sh
pnpm colors:inventory data/inventory_parts.csv.gz mapping-config.json data/part-colors-custom.json
```

Use **Import evidence** in the inspector to load the resulting JSON. Validated
imports persist locally when browser storage is available; invalid imports leave
the current dataset unchanged. JSON assembly and parts-list exports include
evidence/provenance and statuses. LDraw exports keep their original color codes.

The LDraw palette is derived from the community-maintained LDraw.org
configuration, not LEGO-authored data. Preserve applicable LDraw attribution
and licenses when redistributing palette or mesh data.

## Local LDraw Download

Keep the entire library, including `parts/`, `parts/s/`, `p/`, `LDConfig.ldr`,
and its license files, under `data/ldraw/`. Do not commit the download. See
[data/README.md](data/README.md) for structure and an external-path option.
The Vite plugin reads `LDRAW_LIBRARY_PATH` from the root `.env` (restart after
changing it), or defaults to `data/ldraw`. It serves supported parts and their
dependencies under `/ldraw/` and packages that subset with attribution/license
files for production. The full downloaded library remains Git-ignored. Builds
without it use procedural geometry; incomplete installed libraries fail the build
with the missing dependency. The viewport links to LDraw attribution when loaded.

## Full Library Browser

Choose **Browse full library** to search the installed library by part ID, name,
category, or header keywords. Search terms are combined, exact IDs rank first,
and results are paginated. The index includes top-level part files, including
patterns and aliases, but excludes internal subparts and primitives.

Select any result for an on-demand LDraw preview with orbit controls, camera
reset, preview colors, geometry dimensions, and a link to the attributed source.
Preview colors do not establish real part/color availability. Only the 26
engine-supported designs enable **Use in assembly**; viewing a mesh does not
authorize placement or validate its connections.

`pnpm dev` and `pnpm preview` serve arbitrary part geometry from the local library.
A production build includes the full metadata index, but bundles only the 26
supported designs and their dependencies. A static-only host can browse metadata
and preview those 26 designs; other previews require the local library server.
Restart the server after changing the engine catalog or installing/replacing the
library to refresh its cached manifests and index.

## Local Claude Adapter

The headless adapter sends text prompts to the Claude API and lets Claude call
only twelve engine tools: technique guidance, catalog, placement candidates, connection explanations,
atomic patch preview/application,
inspection, physical assessment, placement,
removal, color status, and export. It does not expose a shell, filesystem, web browsing, arbitrary
code execution, or browser access. JSON schemas are checked locally with Ajv;
the engine independently rejects collisions, floating parts, and unsafe removal.
Tool calls are applied in response order. Rejected calls do not change session
state; Claude receives the structured error and can revise its plan.

Set `ANTHROPIC_API_KEY` privately in the root ignored `.env` or your terminal
environment. Never put it in `VITE_` variables, source files, screenshots, or chat.
`CLAUDE_MODEL` defaults to `claude-sonnet-5-5`; `--model` overrides it. The command
loads the root `.env` but neither logs nor exports credentials. The prompt and
initial assembly and tool-returned physical data/provenance are sent to Anthropic,
and normal API charges apply.

```sh
pnpm claude:build --help
pnpm claude:build "Build a small bridge using supported bricks and plates" --out output/bridge
pnpm claude:build "Add a second level" --input output/bridge/assembly.json --out output/two-level
pnpm claude:build "Build a stable tower" --physical-data measurements.json --no-mass-estimates
```

The host-selected directory receives `assembly.json` and `assembly.ldr`. The JSON
contains the authoritative engine assembly, BOM, physical assessment/data/policy,
inventory evidence/statuses, tool outcome
trace, token usage, and Claude's final text. Claude cannot choose output paths.
The command starts empty unless `--input` supplies an assembly or workshop JSON
export; input is validated and cloned. It is not synchronized with the browser
workshop, and generated files should be inspected in an LDraw editor for now.

By default only inventory-observed part/color combinations can be placed. The
host can explicitly allow rendering-only choices with `--allow-unverified-colors`;
their manufacturing/stock status remains unknown. Limits are 500 pieces,
12 API turns by default (`--max-turns 1..32`), and 4,096 output tokens per turn.
Each API request has a 60-second timeout and no automatic retries. These bound
execution, not a monetary budget; input context grows with tool results.

The default session uses catalogue-reported nominal weights and rejects edits
infeasible under that model. Solid-envelope estimates apply only to missing
masses. `--physical-data` loads host-chosen overrides/limits; `--no-mass-estimates`
disables estimates but retains catalogue weights. `--no-catalog-masses` disables
the catalogue fallback; use both flags to leave unsupplied masses unknown.
Workshop exports do not implicitly override host physics settings: supply the
physical data separately. Programmatic hosts can set `physical` options and
`rejectInfeasible: false` to inspect/repair infeasible input; this policy and
physical data cannot be changed through Claude's tools. `brick_physics` is
read-only, and inspection/JSON export include the assessment. Static balance
is not permission to claim unknown strength or access is safe.

Turn/output limits yield clearly marked partial results and exit code 2.
Invalid prompts, configuration, initial state, and transport/API errors fail
the command rather than inventing success. On transport errors the CLI does not
write a final export; the programmatic session still retains successful prior
mutations. API text is not proof of completion or quality: inspect the returned
assembly and checks. Static gravity results depend on their mass model; physical
strength, real access, stock, and visual fidelity remain uncertified even when
Claude ends its turn successfully.

Use `createBuilderSession`, `BUILDER_TOOLS`, and `runClaudeBuild` from
`@lego-builder/claude-adapter` for another local host. The transport is injectable;
tests cover the official SDK with mocked HTTP responses, dependency ordering,
error recovery, input validation, immutable snapshots, and partial results.
A live Claude generation requires a locally supplied key and is not part of
the offline test suite. No web chat or upload pipeline is included in this step.

## Next Steps

1. Add sourced mass/connection measurements, bending/shear and robust tipping
   margins, real assembly-access checks, and verified part/color coverage.
2. Connect generated assemblies to the workshop and add model/reference uploads.
   Keep Claude/API secrets server-side.
3. Expand useful part families with measured geometry and connection tests.

The local Claude API adapter is available; no web chat, upload pipeline,
or marketplace-stock API is connected yet.
