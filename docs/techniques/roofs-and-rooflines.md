# Roofs and rooflines

The skyline is what people see first. A build with a flat top or a single plain roof looks
like a box. The standard recipes (hinge plates, the courses height-field) live in
`build-standard.md` and the courtyard house; this file adds the roof _types_ and the things
that sit on and around them.

## Choose a roof type per building

| Type              | Use                             | How                                                                                    |
| ----------------- | ------------------------------- | -------------------------------------------------------------------------------------- |
| Gable             | cottage, church nave, barn      | 45° slopes, ridge `3043`, barge boards on the gables                                   |
| Cross gable       | houses with wings               | higher of two height fields; valleys form themselves                                   |
| Hip               | villa, tower, pavilion          | corner slopes `3045` / `3675` at the four corners, ridge short                         |
| Mansard           | Parisian modular, hotels        | steep lower slopes `3678b` / `4460b` (65° / 75°), flat top, dormers                    |
| Gambrel           | barn, western store             | two pitches per side: steep lower `4460b`, shallow upper `3040b`                       |
| Pyramid / spire   | tower, turret                   | `3688` pyramids, stacks of `3037` shrinking one stud per course, cone `3942c` / `4589` |
| Conical           | round towers                    | cones `3943b`, `6233`, `3942c` stacked, finial `59900`                                 |
| Dome              | observatory, museum             | inverted dishes `3960`, `43898`, `4740` with curved slopes; gold `297` cap             |
| Lean-to / shed    | porch, veranda, lean-to         | single slope row, low side away from the wall                                          |
| Flat with parapet | false front, modern, industrial | tile cap, railing, roof furniture (see below)                                          |
| Thatch / rough    | cottage, tavern                 | curved slopes `11477`, `15068` in tan `19` and dark tan `28`, uneven eaves             |

## Texture the roof surface

- Two or three shades of the roof colour, scattered, never in a pattern (a third of a lighter
  shade is plenty).
- Stagger slope lengths from course to course (2 x 1, 2 x 2, 2 x 3, 2 x 4 `3037`).
- Edge details: barge boards in the timber colour on gable slopes, tile cap `3068b` /
  `87079` on the ridge, a shallow drip edge of plates.
- Real pitch: tiles on hinge plates (`3937` / `3938`) for shingle roofs; 45° slopes for slate
  and tile; 33° (`4286`, `3298`, `4161`, `3297`) for low pitches and sheds.
- Overhang: the roof should extend 1 stud past the wall on eaves and gables.

## Things on a roof

A roof with nothing on it is unfinished. Add at least three:

- **Chimneys**: 2 x 2 stack from `3003` or `3941` in brick colour, up to 6 bricks tall,
  tile cap in `72`, round pots `3062b` / `4589` on top. Offset them from the ridge; one chimney
  per roof section; vary heights.
- **Dormers**: a small gabled box (two walls, a 1 x 2 x 2 window, a mini gable of `3040b`) on
  the slope, sitting on plates that follow the pitch (`3040b` rows give the 45°), with its own
  roof ridge. Space them irregularly.
- **Skylights** in transparent plates; a roof hatch with a door; a dormer with a hoist.
- **Ridge furniture**: finials `4589`, weathervane (antenna `3957a` with a 1 x 1 plate),
  decorative end caps `3048b`.
- **Gutters and downpipes**: a 1 x 6 or 1 x 8 plate in `72` at the eave, a vertical bar `30374`
  down the corner.
- **Flags** on poles at tower tops and gable ends.
- **Chimney stacks in groups** (two or three stacks on a gable end, as on a Tudor).
- **Roof terrace**: a flat section with a railing `30055` / `3633`, pots, a table.

## Skyline

Vary neighbours: height, ridge direction, pitch, colour. On a street alternate gable-to-street
with ridge-parallel roofs. On a castle step the roofline: a tall keep, lower hall, corner
turrets with conical roofs, a chapel with a spire. A good silhouette has at least three
different heights and two different roof shapes.

## Towers, turrets, spires

- Round turrets: stack `87081` / `2577` / `48092` / `85080` (round and curved bricks) or build
  octagons from slopes and corner slopes; add corbels `3665a` at the top where the turret
  steps out over the wall.
- Battlements: crenellations of 1 x 1 / 1 x 2 bricks with gaps, machicolation row beneath
  (inverted slopes `3660a`), a parapet walk behind.
- Spire: from a square tower go to an octagon by cutting the corners with `3045` / `3675`,
  then narrow to a point with stacked 45° slopes and a finial.
- Add a clock face (round tiles `67095` / `7212` with a ring), bells (a cone in gold) and a
  lantern on top for cathedral and civic towers.
- Tower silhouette: base wider than the shaft (battered or buttressed), shaft with a
  string course every 12 to 15 plates, a belfry with arches `3659` and louvres, then roof.

## Roof colour palettes

| Building | Roof                                         | Trim                |
| -------- | -------------------------------------------- | ------------------- |
| Cottage  | `320` dark red, `70`, thatch `19` / `28`     | `308` boards        |
| Castle   | `0` or `72` cones, `320` for domestic roofs  | `4` flags           |
| Town     | `272` dark blue mansard, `72` slate, `0`     | `15` dormer frames  |
| Western  | `0`, `72`, `70`, `320` shingles              | `15` hoods          |
| Church   | `72` slate, copper `297` / `288` verdigris   | `19` stone dressing |
| Harbour  | `4` / `15` striped lighthouse top, `0` slate | `72` gallery        |

## Checklist

- At least two roof shapes or two heights in the silhouette.
- Real slopes or hinge tiles, no flat tiles on steps.
- Two shades, staggered lengths, overhang.
- Three or more things on top: chimney, dormer, finial, vane, flag, gutter.
- Ridge capped; gables have barge boards; eaves have a gutter or a fascia.

## Measured in official models

- In the top fifth of a model by height, 35% of modular pieces and 29-32% of town and vehicle
  models are slopes or round pieces (30% in Architecture sets, 12% in castles, which end in
  battlements and flat tops). A roof that is mostly tiles on a flat course is under it.
- Curved and double-ridge slopes show up sideways in roofs: `35464` (100% sideways in
  modulars), `11477`, `50950`, `49307`. Use them for ridges, dormer cheeks and cornices.
- Inverted pieces are rare (about 1% of pieces), so cornices come from a few well-placed
  corbels, not rows of them.
