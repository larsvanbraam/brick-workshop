# Technique notes

Short, topic-by-topic notes that sit under the [build standard](../build-standard.md). The
standard says _what a good build looks like_; these notes say _how to get there_ for one
subject at a time, with the engine's part IDs.

| Note                                               | Covers                                                                                |
| -------------------------------------------------- | ------------------------------------------------------------------------------------- |
| [walls.md](walls.md)                               | stone, brick, half-timber, siding, log, render; depth levels; arches; quoins          |
| [facades-and-openings.md](facades-and-openings.md) | storeys and bands, windows, doors, bays, awnings, balconies, signs                    |
| [roofs-and-rooflines.md](roofs-and-rooflines.md)   | roof types, texture, chimneys, dormers, towers, spires, skyline                       |
| [flora-and-terrain.md](flora-and-terrain.md)       | ground, trees by species, bushes, flowers, rocks, water, paths, base outlines         |
| [vehicles.md](vehicles.md)                         | cars, wagons, trains, boats: silhouette, colour, wheels, scenes                       |
| [fauna.md](fauna.md)                               | animals from catalogue parts, posture, habitat, groups                                |
| [city-and-props.md](city-and-props.md)             | street cross-section, furniture, signs, interiors, market stalls, infrastructure      |
| [part-vocabulary.md](part-vocabulary.md)           | generated: which parts official sets of each topic lean on, and what the engine lacks |

## Where this comes from

- **Part vocabulary** is mined from Rebrickable's bulk downloads (the sanctioned data export;
  `pnpm rebrickable:vocabulary`). They list parts per official set, not positions.
- **Placement statistics** are measured from LDraw models of official sets in the LDraw
  Official Model Repository (library.ldraw.org/omr; models carry attribution licences, CCAL 2.0
  or CC BY 4.0). `pnpm omr:fetch topics` downloads them (1 request a second, into the
  Git-ignored `data/omr/`) and `pnpm omr:analyse` keeps statistics only, with every model's
  author and licence credited in the output. No geometry is stored or reproduced.
- **The technique text** is written from established LEGO building practice, checked against
  the engine's catalogue and calibrated with the numbers above ("Measured in official models"
  at the end of each note). It does not reproduce any individual MOC.
- No Rebrickable pages are scraped: the site's robots rules opt out of AI training.

## Using them

- **Building an example by hand**: read the notes for the subject's topics before the
  "Detail" step in CLAUDE.md, and tick each note's checklist at the end.
- **In the workshop's generate panel**: `packages/claude-adapter` loads the standard; the
  notes load the same way (see `runner.ts`).
- **Adding a part**: look at the _signature parts the engine cannot place yet_ tables in
  `part-vocabulary.md`, then follow "adding a part" in the engine README.

## Regenerating

```sh
pnpm rebrickable:vocabulary   # writes docs/techniques/part-vocabulary.md
pnpm omr:fetch index          # list the OMR's sets (about 60 requests)
pnpm omr:fetch topics         # download the sets the topics sample
pnpm omr:analyse              # writes docs/techniques/placement-statistics.md
```

The vocabulary script reuses the CSVs in `data/` (Git-ignored) and downloads any that are
missing; the analyser also needs `parts.csv.gz` and `part_categories.csv.gz` there.
