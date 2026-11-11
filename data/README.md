# Local LDraw Library

`pnpm ldraw:fetch` downloads the official library here, or extract it yourself so
the structure is:

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
rather than creating `data/ldraw/ldraw`. Keep the whole library, including its
licence and attribution files: parts reference subparts and shared primitives.

To use a library elsewhere, set `LDRAW_LIBRARY_PATH` in the repo root's `.env` to
its absolute path and restart the dev server. Restart also after changing the
library or the engine's part catalogue.

The library and downloads here are Git-ignored; commit import code and small
configuration files only. The dev and preview servers serve the supported parts
and their dependencies under `/ldraw/` on demand, and the full-library browser
indexes every top-level part (excluding minifigure, DUPLO and electrical parts).
In development, unsupported parts can also be placed by their measured envelope,
but their connector fit is unknown and builds using them are reported as such.
A production build
packages only the supported parts, with the library's attribution and licences.

Rebrickable bulk downloads (`inventory_parts.csv.gz`) also go here for
`pnpm colors:inventory`; see the root README.
