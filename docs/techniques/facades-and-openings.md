# Facades, windows and doors

A facade tells its story in three bands (ground, middle, top), a rhythm of openings and a
focal point (an entrance, a bay window, a clock). See `walls.md` for materials and relief.

## Compose the facade first

1. **Choose the rhythm.** Openings sit on a grid of 4 to 6 studs; vary it with one wide
   opening (shopfront, bay) and one narrow (stair window) so the facade is not a spreadsheet.
2. **Pick a focal point** and put it off-centre or give it extra emphasis (a pediment, a
   different material, a tower, a balcony).
3. **Mark the storeys** with a band every 9 to 12 plates, stronger at the ground floor.
4. **Close the top** with a cornice, parapet, gable, or pediment; never end a wall flat.
5. **Hang something on it**: signs, lamps, flower boxes, shutters, awnings, flags.

## Windows

The engine has a frame plus glass pair for every common size: `60592` + `60601` (1 x 2 x 2),
`60593` + `60602` (1 x 2 x 3), `60594` + `86210` (1 x 4 x 3), `57894` + `57895` (1 x 4 x 6),
`2493b` + `2494` (1 x 4 x 5), the arched `30044`, the half-round `20309`, and lattice or
barred panes `60607` / `60608`. Use `glazeWindows` for glass.

No window is a plain hole. Each gets all of:

- **A frame** in a contrast colour (white against brick, dark blue against sand, black
  against stone).
- **A sill**: a 1 x 2 or 1 x 4 plate / tile one stud proud under the opening, ideally one
  stud wider each side.
- **A head**: lintel brick of stone or dark colour, a slope hood (`3040b` low side out), or an
  arch from `3659` / `4490`. The window must fit its arch: under a `3659` use the rounded-top
  `30044` with a `30045` / `30046` pane, its head rising into the arch's curve (the engine allows
  it); under a `15254` use the half-round `20309`. A square frame under a wider arch leaves a gap
  at its top corners that shows the interior or the sky.
- **Dressing**: shutters (1 x 2 panels `4865b` or `30413` on side studs), a flower box with
  `32607` sprigs and `24866` flowers on the sill, a curtain (a coloured 1 x 2 tile behind glass).

Window types to mix across a building:

| Type            | Size                  | Where                                                |
| --------------- | --------------------- | ---------------------------------------------------- |
| Casement        | 1 x 2 x 3             | upper floors, repeat in pairs                        |
| Shop window     | 1 x 4 x 3 / 1 x 4 x 6 | ground floor, in a surround of dark bricks or timber |
| Arched          | `30044`, `3659` head  | ground floor of stone, church, library               |
| Round / oculus  | ring of round plates  | gable, pediment, church                              |
| Dormer          | 1 x 2 x 2 in a roof   | see `roofs-and-rooflines.md`                         |
| Slit / loophole | grille `2877`         | castles and towers                                   |
| Bay / oriel     | 3 sides, 2 studs deep | one per facade, upper floor, on corbels              |

### Bay and oriel windows

A projecting window is the single biggest depth win. Two studs out, three glazed faces
(front 1 x 4 `60594`, sides 1 x 2 `60592`), corbel under with `3665a`, roof of slopes or a
small hip. Seat the side windows with side studs, as the courtyard house does.

## Doors and entrances

- Doors: `60596` frame with `60616a` smooth or `60623` four-pane leaf (4 x 6), smaller
  `3579` frame with `3193a` / `3192a` leaves (3 x 4), `3861c` heavy door (4 x 5). Fit leaves
  with `addDoor` (handedness flips under `reflectToFront`).
- An entrance has a _threshold_ (a tile or slope step in a contrast colour), a _surround_
  (pilasters, stone jambs, an arch) and a _signal_ (a sign, a lantern `2039`, a canopy).
- Steps: build from plate stairs: 1 plate rise per course, 1 stud tread; add side walls or
  balustrades `30055` / `3185`.
- **Porch**: 2 columns (`43888` round columns `1 x 1 x 6`), a small slab roof or pediment of
  slopes, a doormat tile.
- **Shopfront**: dark piers, a fascia of tiles above the glass carrying a sign (a pictogram: a
  loaf, a key, a book), an awning (see below), a stall board below the window.

## Awnings, balconies, signs

- **Awning**: slopes `3040b` / `3039` or `4286` low side out, in two or three stripes of `4` / `15`
  or `320` / `15`, on 1 x 1 brackets `99780` or a plate on side studs. Overhang 2 studs.
- **Balcony**: plate slab one stud proud on corbels, railing from `3633` or `30055` balusters,
  a door behind it, a plant on it. Wrought-iron look: black or dark-grey bars `30374`.
- **Signs**: a framed board (tile in the shop colour) hung on a bracket from a side-stud brick
  or from a `2432` handle tile. No lettering: use a pictogram (a few tiles in two colours).
- **Flags** on antennas `3957a` with `2335` / `44676a`, at tower tops and gable ridges.

## Storey bands and cornices

| Band                  | Recipe                                                                               |
| --------------------- | ------------------------------------------------------------------------------------ |
| Plain string          | one plate course in tan on white, 1 stud proud                                       |
| Dentil cornice        | alternating 1 x 1 plates one stud out and one in (or 1 x 1 bricks upside down)       |
| Corbelled cornice     | row of inverted slopes `3665a`, then a plate course, then tiles                      |
| Modillion             | `54200` cheese slopes in a row under the eave                                        |
| Parapet               | course of 1 x 2 tiles on 1 x 2 bricks with gaps (crenellation) every 2 studs         |
| Pediment (triangular) | `3040b` / `3039` slopes forming a triangle over the entrance, tile cap, round window |

## Facade checklist

- Three bands at least; the bottom band is darker or heavier.
- Openings differ in width; one wide, one narrow.
- Every opening has frame, sill and head; at least a third have boxes or shutters.
- One focal element, off the centre line.
- Something hangs off the face (sign, lamp, flag, basket).
- Top is shaped: cornice, parapet, gable, pediment.

## Measured in official models

- Modulars are about 33 bricks (100 plates) tall, so a three-storey facade is not tall by
  the references' standards; count storeys before adding bulk.
- Ornament on facades is sideways: ~10% of modular pieces are placed on their side
  (brackets `99780`, round and quarter-round tiles, cheese slopes, sprig leaves `32607` for
  ivy and boxes). Aim for at least 8% in a town building, 15% in a stone landmark.
- Window and balcony railings use bars (`30374`, `87994`) turned sideways, not just fences.
