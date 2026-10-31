# Local LDraw Library

Extract your complete LDraw download here so the structure is:

```text
data/ldraw/
  LDConfig.ldr
  parts/
    3001.dat
    s/
  p/
    48/
```

If the archive already contains an `ldraw` directory, use that directory directly
rather than creating `data/ldraw/ldraw`. Keep the entire library intact, including
its license and attribution files. Parts reference subparts and shared primitives.

The library and ZIP archives are Git-ignored. Commit import code and small
configuration files, not the downloaded library or generated geometry caches.

An existing library outside the repo can also be used: set `LDRAW_LIBRARY_PATH`
in the repo root's local `.env` to its absolute path, then restart the dev server.
The viewer loads 108 engine-supported bricks, plates, tiles, tall bricks,
45-degree slopes, round parts, arches, baseplates, cones, doors and windows
with Three.js's LDrawLoader.
Its geometry status reports loading, real LDraw geometry, or procedural fallback.

The full-library browser indexes top-level part IDs, names, categories, and
keywords. It labels engine-supported designs separately from preview-only parts.
The local development and preview servers load arbitrary part geometry and its
dependency closure on demand under `/ldraw/`; internal subparts and primitives
are not standalone search results. Restart after changing the library or the
engine's supported catalog. The 1 x 2 plate uses canonical LDraw ID `3023b`, not
the moved `3023` alias.
The original tiles retain grooved IDs `3070b`, `3069b`, `3068b`, plus `63864`,
`2431`, and `87079`; additional rectangular and round tiles also have smooth
tops and do not support studs above. Slopes expose only their high rear stud
row. The shared transform corrects their off-centre native origin. Installed
mesh tests check all 108 supported native models, including containment inside
reserved hardware/sill envelopes. Procedural fallback distinguishes rectangular,
sloped, round and conical bodies, open arches/frames, and closed integral doors, while
collision checks deliberately reserve their full rectangular envelopes.
Shaped-part and thin-baseplate gravity/contact assessments remain unknown.
Baseplates have real half-plate height and no underside receivers; half-unit
placements, static hinges and reserved aperture space follow the engine contract.

A production build includes the full metadata index, supported geometry subset,
and the library's attribution/license files, not the entire download. Arbitrary
previews need `pnpm dev` or `pnpm preview` with the library installed; a static-only
host can preview only the packaged supported designs. Builds without a local
library still work using the procedural fallback. An incomplete installed library
must be fixed before building. Geometry support does not expand the placement
catalog or establish real part/color availability.

Before redistributing meshes, preserve applicable LDraw licenses and attribution.
The official LDraw library is community-maintained, not LEGO-authored, and does
not establish current part/color availability or legal connection behavior.

## Color And Inventory Imports

The committed engine palette is generated from `LDConfig.ldr` with
`pnpm colors:import`; it works even when the ignored library is absent. The
configuration's version, source URL, and checksum are recorded alongside it.
Preserve LDraw.org attribution and the applicable library licensing.

Rebrickable public bulk files can be downloaded locally for
`pnpm colors:inventory`. CSV/gzip downloads and custom `part-colors*.json` files
are ignored. The compact starter evidence snapshot contains only observed
basic/architectural combinations under 106 explicitly reviewed mappings, with
562 observations and provenance. Legacy doors 801a/802a remain inventory-unmapped
because native handle labels disagree with inventory names.
See the root README for schema, source terms, refresh commands, and the separate
rendering/manufacturing/stock statuses. Missing observations remain unknown.
