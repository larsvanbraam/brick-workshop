# Flora and terrain

Landscape is half of a build. Sets and MOCs get their charm from messy, natural ground: stepped
terrain, layered rock, leaning trees, and planting in clusters of several heights. Use the
engine's plant parts (`3470`, `3471`, `6064`, `30093`, `2417`, `32607`, `24866`, `4727`,
`30176`, `6255`, `2423`) and `addTree` (`trees.ts`) for the big shapes. Receivers for bushes,
tall grass and ferns sit between studs (half-stud positions): check a part's connectors in
`core.ts` first.

## Ground: calm, layered, edged

- Three or four materials per base, each in patches of at least 3 x 3 studs: lawn (`2`,
  `288`, `10`), earth (`70`, `308`, `84`), gravel and stone (`71`, `72`, `19`, `28`), water
  (`1`, `73`, `272`, `43`).
- **Edges carry the detail**: the foot of a wall, a path border, the bank of a pond, around a
  tree. Leave the middle of a lawn plain with a few tufts.
- Terrain **rises and falls by plates**: 2 to 6 plates of relief across a base, with a
  hill, a hollow, a shelf for the building. Then smooth (`smooth` passes) so steps become slopes.
- **Base edge**: organic outline with bays and promontories at least 3 studs deep; round the
  corners with `30357` / `30565` / `6003` round-corner plates, `22888` half-circles, `7904`
  quarter-circles. Show strata on the sides: `72` bottom, `71`, `19`, `28`, `70` toward the top.

## Trees

Trees are big: a broadleaf crown reaches the eaves of the nearest building and spreads wider
than a storey. Make species, not just "a tree".

| Species    | Trunk                                                         | Crown                                                               |
| ---------- | ------------------------------------------------------------- | ------------------------------------------------------------------- |
| Oak / elm  | thick `70`/`308` round bricks, leaning, forking at 2/3 height | wide layered crown, 3-4 clumps of plates and `2417` / `6255` sprays |
| Birch      | white `15` and black `0` 1 x 1 bricks, thin, slightly leaning | light-green `10` / `27` small clumps on thin branches               |
| Pine / fir | straight `308`                                                | `3471` pyramidal or stacked cones `3943b` shrinking to the tip      |
| Willow     | short trunk, leaning over water                               | drooping `30093` / `2423` fronds hanging from a dome                |
| Cherry     | knotty `70`                                                   | pink `13` / `5` and white `15` clusters, petals fallen on grass     |
| Palm       | tan `19` / `28` ring-stacked, curved                          | 4 to 6 leaves `30176` radiating                                     |
| Dead tree  | `308` forked, no crown                                        | a few bare twigs (bars, antennas), a bird                           |

Build rules:

- Crown colours: darkest inside and below (`288`), `2` in the middle, `10` / `27` on top and
  outer edges. Scatter irregularly.
- Trunks **lean and branch**: stack round bricks with a half-stud shift, split into two branches
  at the crown, add a root flare of 2 x 2 cones or curved slopes at the base.
- Roots: `3943b` and slopes in the trunk colour, wrapping over a rock or a path edge.
- Underplanting: a ring of ferns `6255`, bushes `6064` and tall grass `30093` round the
  base, and a few fallen leaves as 1 x 1 round plates in autumn colours.

## Bushes, hedges, grass

- **Hedges**: a row of 1 x 4 / 1 x 6 bricks in `288` with `2` plates on top and gaps for
  height variation; clip the ends round with slopes. Use for property lines and to hide the
  base of a wall.
- **Bush clusters**: three `6064` of different heights, a fern `6255`, and flowers.
- **Tall grass** `30093` in clumps of 3 to 5 beside water, rocks and fences.
- **Moss** on rocks and walls: 1 x 1 plates and round plates `6141` in `2` / `288` / `330`,
  also `32607` sprigs.
- **Ivy** up a wall: a vertical strand of `32607` and 1 x 1 side-stud bricks in `288` / `2`,
  thickest at the base, one stud wide with offshoots.

## Flowers

- Clumps of one colour (yellow `14`, red `4`, white `15`, pink `13`, orange `25`), 3 to 7
  stems per clump. Use `24866` flowers on `4727` leaves, 1 x 1 round plates `6141` on green
  for ground cover, `32607` sprigs between.
- Flower beds: a bordered patch (tile or low brick edging) with graduated heights.
- Window boxes, hanging baskets and planters repeat the same colour to tie a facade to the
  garden.
- Dress at most one stud in eight of a lawn; do not scatter single flowers.

## Rocks and cliffs

- Rocks are **clusters** of 3 to 7 pieces of mixed sizes in two or three greys (`71`, `72`,
  `151`) or tans (`19`, `28`, `84`), the biggest piece low and a smaller one leaning on it.
- Build outcrops from stacked plates and bricks with the staggered steps pointing outward,
  then smooth. Add cheese slopes `54200` / `85984` on the angled faces and curved slopes
  `11477` / `15068` / `24309` on tops.
- Strata: horizontal bands (`72`, `71`, `19`, `28`), tilted slightly by shifting layers a half
  stud (jumper plates `3794b` / `87580`).
- **Cliffs and crags** read as vertical strata: narrow columns of bricks at different
  heights, ledges, a cave opening, plants in cracks.
- **Boulders at the foot** of any cliff and beside any path.

## Water

- Never one colour: `1` or `73` blue, `272` in the depths, `43` / `14` trans light blue at
  the edge and in falls, `15` white for foam or waves.
- Shoreline: a wandering border of sand `19` / `28`, tiles and round tiles, reeds `30093`,
  lily pads (round tiles `98138` in `2` / `288`), a rock or two.
- Falls and rapids: translucent tiles stacked vertically with a white splash pool.
- Frozen water: trans-clear `15` / `43` with a light blue base.
- Harbour water: layered plates, a quay wall in `71` / `72`, bollards, rope coils.

## Paths, roads and ground cover

- **Paths wander**: tan `19` and dark tan `28` tiles `3070b` / `3069b` / `63864` laid in
  curves, mixed with open studs and round tiles `98138` / `14769` as stepping stones. Edges
  are broken: a few stones, grass encroaching.
- **Gravel**: `72` / `71` / `19` plates and jumper plates `3794b` / `87580` in a patch.
- **Dirt tracks**: `70` / `308` / `84` plates, wheel ruts as parallel darker rows.
- **Cobbles**: round tiles `98138` and `14769` in `71` / `72`, mixed with a few tiles.
- **Sand and desert**: `19` / `28` with `84` and `484` patches, dry scrub in `330`.
- Always dress the junction of a path and a building: a step, a doormat, a lantern.

## Bases by setting (see build-standard.md)

- **Landscape**: organic outline, at least a quarter of the board bare, three or more
  bays, strata on the sides.
- **Street**: rectangular; road (`72`), curb, pavement (`71` / `19` / `28`), tree pit, planters.
- **Desert**: ragged outline, hardpan patches, a rock landmark taller than the buildings.
- **Waterfront**: a built edge (quay, jetty) or rocky shore, plus real water.

## Checklist

- Three or four ground materials; large patches; detail on the edges.
- Terrain has height; outline has bays and promontories.
- Trees have species, lean, branch, have an understorey, and are big.
- Plants come in clusters of several heights; flowers in clumps of one colour.
- Rocks are clusters in two or three greys, smoothed, with moss.
- Water has depth in three colours; banks have reeds and stones.
- Paths wander and fade at the edges.

## Measured in official models

- Plants are a small share even in garden scenes: 1-3% of a modular, castle or town set's
  pieces, none in vehicle sets. A dozen well-placed plants beat a carpet.
- The commonest plant part in modulars is the sprig plate `32607`, placed sideways about half
  the time (ivy up walls, boxes on sills), with flowers `24866` and leaves `2423` secondary.
- Round plates `6141` are placed sideways 45% of the time in vehicle sets (lights, details);
  on terrain, keep them upright as flowers and stones.
