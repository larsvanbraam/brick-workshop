# The build standard

This is the bar for every build in the workshop, made by hand in code (CLAUDE.md) or by
Claude through the engine tools in the workshop's generate panel (the adapter loads this file
into its system prompt). Keep it about how a build looks, not about one way of building it.

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
- Roofs follow their pitch: the surface is real slope pieces or tiles on hinged panels,
  never flat tiles on steps. Upright tiles laid on a stepped roof read as horizontal shelves
  from the side, however they overlap. For a tiled roof, hinge plates up to the pitch: hinge
  bases (`3937`) along the eaves, tops (`3938`) tilted to the pitch, plates on them and tiles
  on the plates, all with the same tilt. Otherwise use 45° slopes (`3040b`, `3039`, `3038`,
  `3037`; 3 plates up per stud) or 33° slopes (`4286`, `3298`, `4161`, `3297`; 3 plates up per
  3 studs), low side downhill. Turn a slope by its low side: it faces -z at rotation 0, -x at
  90, +z at 180 and +x at 270.
- Texture the roof with the slopes themselves: staggered lengths from course to course and
  two shades of the roof colour (about a third in the lighter one), never in a pattern.
- A recipe for a pitched roof: give each cell of the roof's footprint a course from a height
  field. Each course is a shell two studs deep, set 3 plates up and 1 stud in from the one
  below, made of 45° slopes whose high row carries the next course. A cross gable is the
  higher of two height fields, so the valleys come out on their own. Barge boards are slopes
  in the timber colour, and ridge caps (`3043`) close the top.
- Add dormers, chimneys with pots, a ridge, eaves that overhang the wall, and gutters.
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

**A base that fits the subject, not a board with a building on it.**

Pick the setting the subject would really stand in, the way the reference sets do: a modular
on its street, a castle on its crag, a saloon on a dusty main street. Every setting shares the
rules below; the settings then differ in outline, ground and planting.

- The base has height and depth: it rises at least a plate or two above the board, and its
  edges show what it is made of (strata, a curb, a quay wall, boardwalk posts).
- The ground follows "Calm ground" below: a few large areas of one material each, detail at
  the edges and transitions.
- Something living or weathered softens the built edges: plants, ivy, dust, worn paving.

_Landscape_ (castle, cottage, tower, ruin, mill):

- The base has an organic outline and height: leave the board's edge free and shape the ground
  with rounded-corner plates, so the build stands on an island, not a square. Show layered rock
  and earth strata (`72`, `71`, `19`, `28`) on the sides like a cut-away.
- From above the outline is clearly organic, with bays and promontories, not a square with
  rounded corners: leave at least a quarter of the board bare, and give the outline three or
  more bays at least 3 studs deep.
- Terrain rises and falls by plates. Rocks are angled clusters of mixed sizes in two or three
  greys, worn paths are tan and dark tan tiles, and the ground mixes grass, earth and gravel
  rather than one green field.
- Water is never one flat colour: blue with darker depths and lighter edges, transparent pieces
  for falls and ripples, reeds and lily pads at the bank.
- Plants come in clusters of several kinds and heights: conifers and broadleaf trees, bushes,
  ferns, tall grass and reeds, with small flowers in groups of one colour (yellow, red, white).
  Trees are big: a broadleaf tree's crown reaches the eaves and spreads wider than a storey,
  as in the cottage reference. A trunk of brown round bricks that leans and branches carries
  a crown of staggered plates and leaf sprays, darkest inside and below.
- Green climbs buildings: ivy up walls, hanging baskets and window boxes, a tree against the
  façade.

_Street_ (town houses, shops, modulars, a station):

- A rectangular base is right here, as in the modular sets: the building fills its plot to
  the back and sides, and the street runs along the front.
- The street is layered: a road of dark bluish grey `72` plates and tiles (with a few
  `71` patches, white `15` tile markings and a drain grille), a curb a plate higher, then a
  pavement of tiles in light bluish grey `71` with tan `19` or dark tan `28` borders and some
  open studs, reaching the façade. A side alley or a cobbled corner in `71`/`72` round tiles
  breaks the rectangle.
- Street furniture tells the story: lampposts, a bench, a post box, a bin, a bicycle rack,
  café tables, crates and a sign by the shop door.
- Green comes in planters, window boxes, hanging baskets, a tree in a pavement pit and ivy,
  not lawns.
- A row of buildings varies plot by plot: heights, colours, rooflines and setbacks change
  between neighbours.

_Desert_ (western town, mine, mesa, desert outpost):

- The base has a ragged outline like a landscape base, but the ground is dry: tan `19` sand
  and dark tan `28` hardpan in large patches, medium nougat `84` and dark orange `484` patches
  where the earth turns red, and a wheel-rutted main street in dark tan. Dirt tracks and
  hardpan patches wander in curves and in tiles of mixed size; rectangular blocks of colour
  read as a floor plan.
- Rock is the landmark and it dominates: a mesa, a crag or a mountain with a mine entrance
  that stands taller than the tallest building, not a mound in a corner. Build it from
  vertical strata, narrow bricks stacked in staggered columns of different heights so the face
  shows ridges and ledges, in two or three shades: banded sandstone in dark orange `484`,
  medium nougat `84`, tan `19` and reddish brown `70`, or grey rock in `71`, `72` and `151`
  with a timber-framed mine mouth, a ledge on posts and a track running out. Smooth the steps
  into rounded ledges and put a few boulders at the foot.
- Buildings stand on a raised boardwalk of reddish brown `70` and dark brown `308` tiles on
  posts, with a hitching rail, a water trough, barrels, crates, sacks and a wagon in front.
  Wood is weathered: two or three browns mixed, a few medium nougat `84` boards.
- The street is a row of different buildings, not one box repeated: a saloon with a balcony,
  a bank or store with a tall false front, a sheriff's office with a cell, a church or
  schoolhouse, a barn, a station. Give each its own plot: set them back by different amounts,
  leave an alley or a gap, and change heights, footprints and angles.
- Vary the materials building by building: vertical planks, horizontal boards, orange or tan
  brick, adobe in tan `19` and sand `28`, and a painted façade in sand green `378`, sand blue
  `379`, sand red `335` or dark red `320`. A false front is a square or stepped wall that
  climbs past the roof, with a stepped cornice, a sign board and finials.
- Roofs are low and textured: plank or shingle roofs in black `0`, dark bluish grey `72`,
  reddish brown `70` or dark red `320` in staggered lengths and two shades, with veranda roofs
  in red shingles over the boardwalk. A steep gable that shows from the side looks like a
  barn; build a low pitch, or hide it behind the false front.
- A façade has relief, not just colour: a flat, mottled wall of bricks is the mistake to avoid.
  The reference western buildings (a green-shingled bank with white cornice and window hoods; a
  tan-clapboard saloon with dark timber corners, blue frames and a brown balcony) get their
  character from layers, so build them in this order:
  - _Siding._ Lay walls and false fronts in sloped siding, not plain bricks: 45° slopes (`3039`,
    `3040b`) stand on the wall with the low side out (turn 180 on a front, 0 on a back, 90 and 270
    on the sides), high row on the wall's studs, so every course steps out and back like
    clapboards. Stagger the 2 x 2 joints a stud per course and mix two shades (about a third
    in the second). Use tan and dark tan for a saloon, sand green and olive (or dark green)
    shingles for a painted store, and keep adobe or masonry for one building only. Leave plain
    bricks where something stands off the wall.
  - _Framing._ Dark or reddish-brown timber corner posts, piers and veranda posts, a cornice, and
    a string course and corbel row under each cap, in contrast to the siding. White is for
    trim only (window hoods, sills, one cornice), never for whole piers.
  - _Relief._ Push bricks out of the wall as headers (a 1 x 2 laid along z, standing on the course
    below): sills, lintels, beam ends, and the sign's pictogram or frame so it stands proud.
    Stand piers a stud off the wall from the deck up through the veranda roof to the cap, with
    long and short bricks alternating at the corners. Hang a slope hood over each upper window
    and a flower box on each ground sill.
  - _Colour accents._ Window frames and doors in one accent (blue, white or green), balusters in
    timber brown, and a balcony with turned balusters over a porch on posts.
    Keep the studs these need free of props; the validator names the first collision.
- Windows and doors have a frame, a lintel and a sill band; add shutters, hanging signs on
  brackets, wanted posters on a solid wall, lanterns and window boxes. The catalogue has no
  lettering, so signs are a framed board with a pictogram (a star, a bottle, a boot) or a
  band of dark and light blocks.
- The street is alive: a stagecoach or wagon with a horse team, hitched and loose horses,
  a windmill, a water tower on a trestle with a ladder, a well, a railway with a platform, a
  tied-up horse by the trough, and sacks, barrels and crates that spill out of doors.
- Interiors show through the windows and the door: a bar with a back shelf of bottles,
  tables and stools in the saloon; a desk and a jail cell with bars; a counter and shelves of
  goods in the store.
- Plants are sparse and grouped: cacti built from green `2` and olive green `330` round
  bricks with arms on rounded plates (`35480`), agave and dry scrub in olive green `330`, a
  dead tree in dark brown `308`, with small flowers only on the cacti. No lawns.
- Water is rare and earns its place: a trough, a well, a muddy waterhole in dark tan with a
  little blue.

_Waterfront_ (harbour, lighthouse, quay, boathouse):

- The land side follows the landscape or street rules; the water side ends in a straight
  built edge (a quay wall in `71`/`72` stone, a timber jetty on posts) or a rocky shore.
- Water fills a real share of the board and is layered as above, with boats, buoys, bollards,
  rope coils, nets and crates on the quay.

**Calm ground, not confetti.** The references read as a few large, quiet areas (a lawn, a
path, a rocky bank, a pond; a road, a pavement; a sandy street, a boardwalk) with detail
gathered where they meet. Scattering single pieces in many colours over the whole base reads
as noise.

- Each ground area is one material with its own two or three shades, in patches of at least
  about 3 x 3 studs. Keep to three or four materials across the base.
- Gather detail along edges and transitions (the foot of a wall, a path's border, the bank of
  the pond, the curb, round a tree) and leave the middle of a lawn, a road or a sandy street
  mostly plain with a few tufts, patches or ruts.
- Dress at most about one stud in eight of a lawn; flowers in clumps of one colour.

**Stories and props.** Every scene has something going on: a well, a cart, a market stall, a
lamppost and bench, a fountain, barrels and crates, a sign over the door, a flag on the tower.

**Natural shapes, not boxes.**

- Nothing living or natural has a straight edge or a flat top. Rock outcrops are clusters,
  shorelines and paths wander, trees lean and branch.
- Break every outline: step walls in and out, vary heights between neighbours, round corners
  and let pieces overhang a little.
- Sculpt rounded masses (rocks, hills, roots, bushes, figures) from staggered plates and
  bricks, then let smoothing turn the steps into slopes and curves.

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
  lamps, ivy and shutters. A piece on a headlight brick sits in the wall's plane, so it
  collides with its neighbours; use side-stud bricks where it should stand proud.
- Plants: bushes (`6064`), tall grass (`30093`), leaf sprays (`2423`, `2417`, `6255`,
  `30176`), sprigs (`32607`), flower leaves (`4727`) and flowers (`24866`), plus 1 x 1 round
  plates in flower colours on grass. Bushes, tall grass and ferns (`6064`, `30093`, `6255`)
  have their receivers between studs, so they sit at half-stud positions; check a part's
  connectors before placing it.
- Props tell the story: lampposts (`2039`), fences and railings (`33303`, `3185`, `3633`,
  `30055`), flags on antennas (`2335` on `3957a`), barrels from round bricks (`3941`),
  crates, benches, buckets and pots.

**Realistic colour combinations.**

Pick a small palette per material and use it in shades, the way sets do: about 70% base,
20% shadow, 10% highlight, plus small bright accents (under 5% of the pieces).

| Material    | Base                                                                                      | Shadow                | Highlight                                                |
| ----------- | ----------------------------------------------------------------------------------------- | --------------------- | -------------------------------------------------------- |
| Stone       | Light Bluish Grey `71`                                                                    | Dark Bluish Grey `72` | Very Light Bluish Grey `151`                             |
| Earth/sand  | Tan `19`                                                                                  | Dark Tan `28`         | (Reddish Brown `70` for soil)                            |
| Desert rock | Medium Nougat `84`, Dark Orange `484`                                                     | Reddish Brown `70`    | Tan `19`                                                 |
| Street      | Dark Bluish Grey `72` (road)                                                              | Black `0`             | Light Bluish Grey `71` (pavement), White `15` (markings) |
| Timber      | Reddish Brown `70`                                                                        | Dark Brown `308`      | Medium Nougat `84`                                       |
| Foliage     | Green `2`                                                                                 | Dark Green `288`      | Bright Green `10`, Lime `27`                             |
| Old green   | Sand Green `378`                                                                          | Olive Green `330`     | Yellowish Green `326`                                    |
| Water       | Blue `1`, Medium Blue `73`                                                                | Dark Blue `272`       | Trans Light Blue `43`                                    |
| Roofs       | Dark Red `320`, Dark Bluish Grey `72`, Sand Green `378`, Black `0`, Reddish Brown `70`    |
| Accents     | Red `4`, Yellow `14`, White `15`, Pink `13`, Dark Pink `5`, Orange `25`, Pearl Gold `297` |

- Shade by position: darker low down, in recesses and on the shaded side; lighter on tops and
  edges that catch the light. Foliage is darkest inside and below, lightest on top.
- Scatter shades irregularly, never alternating them in a pattern.
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
  timbers, light grey `71` stone ground floor with `72` patches and lighter `151` quoins,
  white `15` lattice windows, green `2` lawn and dark green `288` tree.
- **Landmark**: one colour family (tan `19` with dark tan `28` in the recesses) on a black `0`
  base, with one dark accent (a spire in `72`).
- **Town street**: dark bluish grey `72` road with white `15` markings, light bluish grey `71`
  pavement with tan `19` borders, the building's own palette above it, green only in planters
  and boxes, red `4` or yellow `14` in a post box, an awning or a sign.
- **Western town**: tan `19` and dark tan `28` street, reddish brown `70`, dark brown `308`
  and medium nougat `84` timber, sandstone in dark orange `484` and medium nougat `84` or grey
  rock in `71`/`72`/`151`, olive green `330` and green `2` cacti and scrub, faded paint in
  sand blue `379`, sand green `378`, sand red `335` or dark red `320` on a façade or two,
  black `0` or dark red `320` shingles, white `15` trim and red `4` in small accents.

**How a build comes together.** List what makes the subject recognisable (silhouette,
colours, roof, windows, towers, entrance, props, scenery) and plan the footprint and layers
before placing anything, with the front facing the viewer at high z. Lay the bulk (ground,
floors, walls, roof), then go over every surface with the details above. The detail pass
takes as long as the bulk, and it is where a build becomes good. Rework the model itself
(roof, windows, towers, steps), not just the scenery around it.

**Before calling a build done.**

- Is the subject recognisable from the reference at a glance, from the front and the back?
  Is the back as finished as the front?
- Does every façade have storey bands, framed windows with sills and boxes, and a textured
  roof with a broken roofline?
- Does the base fit the subject's setting (landscape, street, desert, waterfront), with
  height, layered edges and the setting's own ground, props and planting? A landscape or
  desert base has an organic outline; a street base has a layered road, curb and pavement.
- Is the ground calm: a few large areas of one material each, detail gathered at the edges,
  no confetti of single pieces in many colours?
- In a desert or western scene, does a rock landmark tower over the buildings, do the
  buildings differ in plot, height, material and roof, and are there horses, a wagon or a
  railway to make the street live?
- Does anything natural still have a straight edge, a flat top or a hard corner?
- Is there any bare stud field over about 4 x 4, or a blank wall over about 4 studs?
- Does every material use two or three shades, with accents kept small?
