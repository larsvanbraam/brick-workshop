# Walls

A wall is never one brick type in one colour. Real reference builds layer three things on every
wall: a **material** (stone, brick, timber, siding, render), a **rhythm** (courses, piers, bands)
and **relief** (anything standing a half stud or a stud off the face). Pick one of each before
laying a course. Parts named here are in the engine catalogue; `part-vocabulary.md` lists what
official sets of each topic lean on.

## Depth budget

A flat wall is the most common failure. Give every wall at least three depth levels:

| Level           | Offset    | Made with                                                                     |
| --------------- | --------- | ----------------------------------------------------------------------------- |
| Recess          | 1 stud in | window and door reveals, arched niches, blind arches, loopholes               |
| Face            | 0         | the base material                                                             |
| Half stud proud | +0.5 stud | side-stud bricks `87087`, `11211`, `30414`, headlight bricks `4070` with tile |
| Stud proud      | +1 stud   | headers (1 x 2 laid along z), piers, plinths, corbels, cornices               |
| Two studs proud | +2 studs  | buttresses, porches, bay windows, balconies, chimney breasts                  |

Rule of thumb: on every 6-stud run of wall at least one thing is in a different plane.

## Stone

- Base `71`, shadow `72`, highlight `151`; for warm stone swap `19` and `28`.
- Lay in running bond (joints a stud off each course). Mix lengths: 1 x 4 `3010`, 1 x 2 `3004`,
  1 x 3 `3622`, with 1 x 1 `3005` now and then. Never stack three identical bricks in a column.
- Patches, not dots: clusters of 4 to 8 bricks in a second shade covering 15-25% of the wall.
  Make the patches bigger low down, where stone is dirty, and lighter near the top.
- Texture bricks: masonry `98283` / `15533` on about a third of the wall, a grille `2877` or
  groove brick `4216` as a drain or loophole, a few `30136` logs for rough ashlar.
- **Battered base**: start 1 stud wider than the wall and step in with a course of
  inverted slopes `3665a` / `3660a` (low side up) or a plate-wide ledge, so the wall grows
  out of the ground.
- **Plinth**: one course of plates or tiles one stud proud in the shadow colour (`72`), under
  everything.
- **Corner quoins**: alternate long (1 x 4) and short (1 x 2) bricks in `151` or `19` on every
  corner, two courses per pair, so the corner reads as dressed stone.
- **Buttresses** every 6 to 8 studs on a long wall: 1 stud proud, stepping in with `3040b`
  slopes at the top (two steps), or a stack of slopes `3039` giving a sloped cap.
- **Stringcourse**: one plate-high band of tiles in the highlight colour at each storey, 0.5-1
  stud proud (tiles on jumpers `3794b` give the half stud).
- **Corbel table** under a parapet or gallery: a row of inverted slopes `3665a`, then a plate
  course, so the wall appears to sprout its top.

## Brick (red / reddish brown / orange)

- Base `70` or `320` with `84` and `308` patches; for orange brick use `25` / `484` with `70`.
- Header and stretcher bond: alternate rows of 1 x 2 turned across the wall with rows of 1 x 4.
- Brick walls have _details in stone_: white or tan lintels over every opening, a sill row,
  a cap of tiles. Without the contrast it reads as a plain red box.
- Decorative bands: one course in a darker or lighter brick every 6 to 9 plates.
- Chimney breasts and pilasters: 2 studs wide, 1 stud proud, running from ground to cornice.

## Half-timber (Tudor)

- Infill `15` (white), `19` (tan) or `78` (cream); beams `308` or `70`.
- Beams go on the storey lines and at the corners first (corner posts: 1 x 1 bricks or
  `87087` in `308` stacked), then verticals every 3 to 4 studs. Diagonal braces: two or three
  `3040b` / `3039` slopes in `308` stepping up a bay (stud-for-3-plates rise matches a 45°
  brace); a St Andrew's cross is two mirrored braces.
- Upper storeys **jettey** (overhang) by one stud over the lower one: lay a `70` plate course,
  corbel it with `3665a`, and start the upper wall a stud out. This alone makes a Tudor house.
- Infill is _recessed_ behind beams: lay the beams one stud proud or use side-stud bricks for
  the beam faces and plain bricks behind.
- Mix `15` infill with a few `19` bricks so the render looks aged.

## Siding and clapboard

- Slopes `3039` / `3040b` stood on the wall, low side out, make each course step out and
  back like boards. Stagger the 2 x 2 joints a stud per course, mix two shades (a third in
  the second), keep plain bricks wherever something stands off the face.
- Vertical boards (barn / western): 1 x 1 and 1 x 2 bricks stacked in 2-colour columns, a few
  `30136` / `30137` logs, a few `84` boards among `70` / `308`.
- Log cabins: horizontal `30137` logs with corner overlap (alternate which wall ends with the
  full log), notches via `87087`, door and window frames in `308`.

## Render and plaster

- Smooth walls in `15`, `19`, `78` or sand colours (`378` green, `379` blue, `335` red) are
  boring unless broken: a dado band at the bottom in a second colour, a cornice, corner
  quoins, a trim of tiles around openings, a pattern course of tiles or grilles near the top.
- Age the render: a few bricks one step darker low on the wall, cracks as 1 x 1 bricks in
  the stone colour showing through.

## Wall types a good build mixes

| Type            | Use for                      | Signature                                               |
| --------------- | ---------------------------- | ------------------------------------------------------- |
| Rubble stone    | castle, cottage ground floor | patches, battered base, loopholes, moss                 |
| Ashlar          | cathedral, bank, museum      | clean courses, quoins, pilasters, cornice, rustication  |
| Brick           | town house, shop, factory    | stone lintels, white sills, pilasters, soldier courses  |
| Half-timber     | Tudor, inn, upper storeys    | jetty, braces, white infill, dark beams                 |
| Clapboard       | western, harbour, barn       | siding slopes, corner boards, painted trim              |
| Log             | cabin, stable, palisade      | notched corners, round logs, chinking in a second shade |
| Render          | Mediterranean, modern        | dado, quoins, shutters, terracotta, pergola             |
| Curtain / glass | modern shop, station         | slim frames `57894`, transparent panes, tile fascia     |

Give every building at least two of these, ground floor in a heavier material than the upper
floors.

## Arcades, arches and openings in thick walls

- Arch bricks: `3659` (1 x 4), `4490` (1 x 3), `6182`, `3307`, `3308` (spans of 4 to 8),
  `15254` thin-top for gothic, `92950` raised arch, `6005` / `88292` quarter arches for
  pointed and ogee tops.
- A **row of arches** on an arcade or cloister: arch, pier (2 studs), arch, pier, with the
  piers in a darker shade than the arch infill.
- Blind arcades: the same arch bricks set in a wall with a brick behind, 1 stud in.
- Rose windows and round windows: `6141` round plates and `98138` round tiles in a ring on a
  transparent plate; keep the ring symmetric.

## Checklist

- Three depth levels in every 6-stud run.
- Two or more materials per building; ground floor heaviest.
- Joints staggered; no three identical bricks stacked.
- A band, a plinth, a cornice: bottom, middle and top are all marked.
- Corners are special (quoins, posts, buttresses).
- No blank run over 4 studs.

## Measured in official models

From 196 LDraw models of official sets (`placement-statistics.md`, 15 modulars and 42 Architecture sets among them):

- **Texture lives in small parts.** 56% of a modular's pieces are 1 x 1 or 1 x 2 (62% in
  Architecture sets, 38-41% in town and castle sets). A wall built mostly from 2 x 4 bricks is
  well under the benchmark.
- **A tenth of a modular is built sideways** (19% in Architecture sets, 3-6% in castles and
  small town sets). The sideways parts are mostly ornament, not structure: quarter-round
  tiles `25269`, double slopes `35464`, round tiles `98138`, cheese slopes `85984`, brackets
  `99780`, bars `30374` / `87994`, and in Architecture sets the grille tile `2412b` (97% of
  its uses are on its side, as fluting and vertical louvres).
- **Plate-heavy façades.** Modulars use 1.5 plates and tiles per brick, Architecture sets
  12.5: layered thin courses carry the detail, bricks carry the mass.
- **Colour is wide on big builds**: 13 main colours (at least 1% of pieces) in a modular,
  7 in an Architecture set, 5 to 8 in castles and small town sets.
