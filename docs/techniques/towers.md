# Towers and keeps

A tower is mostly wall, so it is judged on whether every face earns its place. A tower that is
generated course by course from one rule looks like a tube from any side, however good the
front is. Plan a tower as a list of **features per face**, hand-placed, and let a loop fill only
the plain stone between them.

The `pnpm` commands below are for building examples in code; in the workshop, use the tables.

Read this with `walls.md` (stone, depth levels) and `roofs-and-rooflines.md` (turrets, spires).
For real constructions to copy, run `pnpm omr:excerpt find <part>` (see "Looking at how
official sets do it" below).

## Features per face

Give every face of the shaft at least this, and make no two faces the same:

- **Openings**: two or three, of at least two kinds (loophole, barred window `60594` frame
  with `60608` bars, arched window, a door `60596` on one face only). Each has a sill, a head
  (lintel or arch) and a different reveal depth.
- **Relief**: one element standing out 1 to 2 studs: buttress, bay, garderobe, stair turret,
  balcony or lean-to.
- **Bands**: a string course (plates or tiles one stud proud, in `72` or `151`) every 12 to 15
  plates, with the storey change on the face as a step in the wall.
- **Material change**: a second stone shade in patches low down, brick or timber on an upper
  storey, rendered infill in panels.
- **Small things on side studs**: ivy `30176` / `3471`, a lantern, an iron bracket, a banner on
  an antenna, beam ends, a clock, a shield. Five or six per face, by hand.
- **Weathering**: dark patches low (`72`), moss (`288` / `330` on 1 x 1 side studs) where
  water would run, a few missing-brick gaps with a darker brick behind them.

A fast check: `pnpm example:score <id>` reports the distinct part and colour pairs on the
poorest face. If that face is under 24, it needs more of the list above.

## Parts that make a tower look built

| Detail             | How                                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Loophole           | grille `2877` flanked by a headlight brick `4070` or side-stud brick `87087` on each side, a tile `3069b` on top               |
| Barred window      | frame `60594`, bars `60608`, a sill of plate `3024` or tile on side studs, a lintel brick spanning both frame studs            |
| Window arch        | `3659` or `6091` over a 2 or 3 stud opening; keystone in `151`                                                                 |
| Corbel table       | inverted slopes `3665a` / `3660a` in a row under the parapet, round bricks `3062b` between them every other stud               |
| Machicolation      | the parapet walk one stud proud on `3665a`, with a row of `4216` groove bricks behind                                          |
| Crenellations      | 1 x 1 / 1 x 2 bricks with one-stud gaps, tiles or `85984` slopes as caps; stagger the pattern at corners so the merlons turn   |
| Battered base      | one stud wider than the shaft, a ledge of inverted slopes, then the shaft                                                      |
| Buttress           | a stack of `3004` narrowing to a `3040b` cap in two steps, the top level with a string course                                  |
| Stair turret       | a round or octagonal stack `87081` / `2577` against one corner, taller than the shaft, with its own cone `3942c` and loopholes |
| Roof turret / flag | a stud-thick pole on an antenna `3957a` with flag `2335`; a cone `4589` or `59900` finial on a small turret                    |

## Plan before code

Write the tower down as a table before any `add()` call:

| Face  | Openings | Relief | Bands | Material | Side-stud details |
| ----- | -------- | ------ | ----- | -------- | ----------------- |
| Front | ...      | ...    | ...   | ...      | ...               |
| Right | ...      | ...    | ...   | ...      | ...               |
| Back  | ...      | ...    | ...   | ...      | ...               |
| Left  | ...      | ...    | ...   | ...      | ...               |

No cell is empty and no two rows match. Build each face from its row, by hand, after the plain
stone has been laid. Render each face head-on before the next step; the front looking good
does not tell you about the back.

## Budget

The tower is the subject, so it gets the pieces. Spend at least two thirds of the build on the
tower and its immediate base (plinth, steps, buttresses, moat edge) and at most one third on the
scenery (trees, rocks, fence, lamps). A 24-stud board with 500 pieces leaves about 150 pieces
for a tower of 10 studs a side and 30 plates tall, which is why it reads thin. Official
Architecture sets average 597 pieces and 17 bricks tall for one subject, with no scenery.

## Looking at how official sets do it

`pnpm omr:excerpt` prints a short layer-by-layer list of parts, positions and turns from the
official models in `data/omr/` (fetch them with `pnpm omr:fetch topics`). Use it for a construction
you are unsure of, then adapt the idea in your own coordinates and colours; do not copy a set's
parts across.

```sh
pnpm omr:excerpt find 2877 --topic architecture   # how designers surround a grille brick
pnpm omr:excerpt find 3665a --radius 2 --limit 2  # corbels: what sits above and below them
pnpm omr:excerpt box 10305-1 10,20,18,30          # everything in a region of one set
```

`x` and `z` are studs from the part searched for (or the box's corner), `y` is plates up, `side`
marks a part turned onto its side and `inv` an inverted part. The output names the set and its
author. It is for reference while building: the repository keeps statistics only, so do not
paste excerpts into code comments or docs.

## Checklist

- A table of features per face, no empty cell, no two faces alike.
- Poorest face at 24 or more distinct part and colour pairs in `example:score`.
- At least three heights in the silhouette (shaft, turret, parapet or roof, flag).
- A string course on every face and a battered base or plinth.
- Side-stud details by hand on every face, not only the front.
- More than two thirds of the pieces on the tower and its base.

## Measured in official models

- Architecture sets turn 19% of their parts onto their sides; castles and towers lean on the
  grille `2877` (97% sideways), `87087`, headlight bricks `4070` and jumper plates `3794b`.
- Architecture sets average 17 bricks tall and 597 pieces, 62% of them 1 x 1 or 1 x 2.
- Flat tops are normal for castles (12% slopes in the top fifth); the crenellations, a turret
  and a flag make the skyline, not slopes.
