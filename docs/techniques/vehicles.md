# Vehicles

Vehicles are small, so every piece shows. They need a recognisable silhouette, a believable
stance (wheels under the body, ground clearance), colour blocking and a few finishing details.
Engine limits first, because they decide the design.

## What the engine can place

- **Wheels**: `4624c01` (wheel with tyre, rests on the ground), clipped between a pair of
  `4600` pin plates; a 2 x 2 brick on the pin plate carries the body (see the wagon in
  `western-town.ts`). `4600` is 2 wide, so a vehicle axle is 2 studs plus the plate gap.
- **Train**: straight `74746`, curved `74747`, switches `75541-*` / `75542-*`, bogie `2878c01`.
- **Animals for drawn vehicles**: horse `4493c01` and saddle `4491b`.
- **Seats and steering**: not in the catalogue; use 1 x 2 plates with tile or a brick backrest.
- No windscreens, wheel arches, steering wheels or mudguards yet. Part-vocabulary lists the
  ones official car sets use (`3387`, `50745`, `4176`, `4079`); they would be the next
  catalogue additions.

## Silhouette first

| Vehicle      | Silhouette                                                       | Proportions (studs)                     |
| ------------ | ---------------------------------------------------------------- | --------------------------------------- |
| Small car    | low nose, cabin set back, short tail                             | 4 wide x 10-12 long x 5-6 tall          |
| Truck / van  | tall box on a flat bed, cab forward                              | 5 wide x 14-18 long, cargo box 6-8 tall |
| Wagon / cart | flat bed on 4 wheels, a driver's seat, optional hoops and canvas | 4-6 wide x 8-12 long                    |
| Stagecoach   | boxy cabin, luggage rail on top, big rear wheels, horse team     | 6 wide x 12 long + horses               |
| Locomotive   | boiler cylinder, chimney, cab, cowcatcher, tender                | 4-6 wide x 14-24 long                   |
| Boat         | pointed bow, wide beam, low stern, cabin                         | 4-8 wide x 14-30 long                   |
| Bicycle      | two wheels, thin frame, seat, handlebar                          | 1 wide x 6-8 long                       |

Stance: wheels barely clear the ground; body shell sits 1 to 2 plates above the axle line; the
roof is shorter than the body (cabin set back).

## Colour blocking

- Body in one strong colour (`4`, `1`, `14`, `272`, `288`), lower body or bumpers in a dark
  neutral (`0`, `72`), trim in white `15`, tan `19` or `297` gold.
- Roof in a contrast (white on red, black on yellow) or the same as the base with darker
  trim. Avoid three saturated primaries at once.
- Wheels and chassis in `0`; mudguards in body colour.
- Add a stripe: a different colour in a row of tiles along the side.

## Building techniques

- **Shape the sides** with slopes and curved slopes (`3040b`, `4286`, `11477`, `15068`, `24309`,
  `93606`) for bonnet, roof and tail. A lone straight stack of bricks reads as a box.
- **Rounded tops and fenders**: `6091`, `37352`, `6191` curved-top bricks and curved slopes.
- **Windows**: `60592` / `60601` frames as side windows; windscreen from 1 x 4 transparent
  slopes where available; mirror windows on both sides.
- **Details**: headlights as 1 x 1 round tiles or `98138` in `14` / `15` on a headlight
  brick `4070` or side studs; tail lights `4`; bumper plates; grille `2412b` or `2877`;
  door lines made with a different tone strip.
- **Interior**: seats 1 x 2 plates; a steering wheel as a 1 x 1 round tile; a driver.
- **Cargo**: crates, barrels (`3941` + round plates), sacks (`3004` tan), hay (yellow/tan
  slopes), logs (`30137`), a tarp (a flat tile in dark green or white).

## Wagons, carts and carriages

- Chassis: two `4600` + `4624c01` pairs, a 2 x 2 brick on each carrying a plate bed (2 x 8,
  2 x 6, 4 x 8). Bed wider than the wheels is wrong; keep wheels outside the bed.
- Sides: `3633` / `3185` lattice rails or `30055` balusters; boards from 1 x 4 plates.
- Canopy: bows of slopes or arches `3308` / `6182`, a tile canopy in white or tan.
- Seat: a 1 x 2 plate on 1 x 2 bricks, a back, a footboard.
- Harness: the horse `4493c01` with saddle `4491b`, a bar or string
  (`75924`, `71149`) to the wagon pole.
- Details: a lantern on a bracket, a barrel and a crate on the bed, a spare wheel, a brake
  lever (antenna `3957a`).

## Trains

- Locomotive: boiler from round bricks `3941` / `87081` in black `0` with a gold `297` band,
  a chimney of `4589` / `59900` stacked on a `3941` brick, a cab of window frames with a roof
  overhang, steps, a cowcatcher of 45° slopes `3040b` in red, a headlight `98138` in white, a
  bell and a whistle. Running board: a 1 x 8 plate on side studs. Side rods: bars `30374`.
- Tender: a box in black with a coal heap (a few tan/black slopes), rails on top.
- Carriages: 6-8 wide windows `60592` in a row with a roof in a contrasting colour, a
  balcony at each end, a door `3193a` / `3192a`.
- Station: a platform in `71` / `19` tiles, a canopy on posts, a clock, a bench, a sign,
  a signal, luggage on a trolley (see `city-and-props.md`).
- Track: keep track on ballast (`72` gravel) with sleepers (`70` 1 x 8 plates) between rails.
  Add a level crossing with a barrier arm (an antenna on a hinge) and signs.

## Boats

- Hull: a wedge-shaped bow from wedge plates (`41769a` / `41770a`, `43722a` / `43723a`) and
  slopes, a flat middle from plates, a stern slightly raised; lap the hull planks as bricks in
  alternating shades of `70` / `308`.
- Deck: tan `19` or `70` plates, a rail of `3633` / `30055`, a wheel/helm, a mast of a
  `43888` column or `3957a` antenna, a sail `u66` (6 x 12 triangular), rope as strings, an
  anchor, barrels on deck, a flag `44676a`.
- Waterline detail: a band of `272`/`0` below the line, white wave tiles at the bow.
- Small boats: rowing boat, rowlocks, oars as bars; dock them at a jetty with bollards (`3062b`
  round bricks) and ropes.
- Lighthouse tenders and ferries: add a funnel, life rings, and a gangway.

## Vehicle scenes

A parked vehicle alone is a prop; a vehicle with a _reason_ is a scene: a delivery van at a
shop with crates on the pavement, a wagon at the saloon with a horse at the trough, a train at
the platform with luggage and a conductor, a boat at the quay with crates. Always give it
somewhere to stand (road, track, jetty), a purpose (cargo, passengers), and a nearby prop.

## Checklist

- Silhouette is recognisable from the side and the top.
- Wheels under the body; stance is right.
- Colour blocking: body, trim, dark chassis, small accent.
- Windows, lights, grille, bumpers present.
- Not a box: slopes, curves, and a tapered nose or bow.
- Cargo or passengers; a scene around it.

## Measured in official models

38 vehicle sets of 150+ pieces (mean 376 pieces):

- 40% of pieces are 1 x 1 and 1 x 2: details, not bulk.
- 6.3% are built sideways: round plates `6141` for lights, grille tiles `2412b`, curved
  bricks `15068`, cheese slopes `54200`, handled plates `18649` / `48336` for grab rails and
  mirrors.
- 2.0 plates and tiles per brick (thin layers form the shell), 7 main colours.
- 32% of the top fifth is slopes and round pieces: roofs and windscreens are shaped, not boxy.
