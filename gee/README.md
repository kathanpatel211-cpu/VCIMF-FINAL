# PPI-SK v2 — Google Earth Engine implementation

Implements `PPISK_v2_GEE_Specification.md` against the study-area asset
`projects/raygadh-range/assets/BEAT`.

## Files

| File | Purpose |
|---|---|
| `PPI_SK_v2.js` | Full GEE Code Editor script: grid construction, constraint mask, all 24 scored parameters, theme aggregation, geometric PPI core, percentile classification, and exports. Spec Sections 1-8, 11. |
| `monte_carlo_sensitivity.py` | Reads the exported block table and runs the Monte Carlo rank-stability analysis, one-at-a-time sensitivity, and the FF-07..FF-11 collinearity screen. Spec Sections 9-10. |

## Running it

1. Open [code.earthengine.google.com](https://code.earthengine.google.com), paste in `PPI_SK_v2.js`.
2. **First run only**: set `RUN_SCHEMA_CHECK_ONLY = true` at the top of the
   script, run it, and read the "Property names" line in the Console. Find
   the field on the BEAT asset that holds the beat name/ID (e.g.
   `BEAT_NAME`, `Beat`, `NAME`).
3. Set `BEAT_ID_FIELD` at the top of the script to that field name, set
   `RUN_SCHEMA_CHECK_ONLY = false`, and run again.
4. Open the **Tasks** tab and run each queued export (block table CSV, block
   polygons, PPI raster, category raster, constraint mask, theme contribution
   maps). They land in a Google Drive folder named `PPI_SK_v2`.
5. Download `PPI_SK_v2_block_table.csv` and run:
   ```
   pip install pandas numpy scipy
   python monte_carlo_sensitivity.py --input PPI_SK_v2_block_table.csv --outdir out/
   ```
   This produces `stability_table.csv` (Section 11.3 product 7),
   `sensitivity_report.csv` (product 8), `collinearity_matrix.csv`
   (product 9), and `ff_checks.json` (FF-07..FF-11 pass/fail).
6. If any FF check in `ff_checks.json` fails, apply the documented action
   (Section 10 table) to the relevant sub-weight in `PPI_SK_v2.js`
   (`SUBWEIGHTS`-equivalent literals in Sections 8.1/15) and re-run from
   step 4 — per the spec's Build Order (Section 12), only steps 19-26 need
   re-running once weights change, not the full pipeline.

## Why the Monte Carlo/sensitivity/collinearity steps are in Python

Spec Section 9.2's own "Implementation note" says 500 full-resolution GEE
reruns exceed compute limits, and recommends exporting the reduced block
table once and running the Monte Carlo in Python/pandas. This is exactly
what `monte_carlo_sensitivity.py` does — it never touches raster data, only
the one-row-per-block CSV.

## Verified dataset IDs (checked against the live GEE catalog, Aug 2026)

A few asset IDs in the original spec draft either drift with catalog
versions or had a more current/official replacement available; the script
uses the following, each noted inline with `[VERIFY]` where it can still
change:

- **FABDEM**: `projects/sat-io/open-datasets/FABDEM` is an `ImageCollection`
  of tiles (band `b1`), not a single `Image` — the script mosaics it and
  sets a default projection before use.
- **Hansen GFC**: pinned to `UMD/hansen/global_forest_change_2025_v1_13`
  (the current release as of Aug 2026, superseding the `2024_v1_12` the
  original spec named). `[VERIFY]` — update if a newer version has since
  shipped.
- **ESA CCI Above-Ground Biomass**: the spec's `[VERIFY]` sat-io asset is now
  also available as an official catalog dataset,
  `ESA/CCI/Above_Ground_Biomass/V6_0/2021` (band `agb`). The script uses the
  official asset first and falls back to the sat-io mosaic
  (`projects/sat-io/open-datasets/ESA/ESA_CCI_AGB`) if it's unreachable, per
  the spec's own Section 3.1 fallback rule.
- **GHSL population**: `JRC/GHSL/P2023A/GHS_POP`, band `population_count`,
  100 m. It is an `ImageCollection` of 5-year epochs running through a 2030
  *projection* — the script filters to epochs on or before the run date so
  it doesn't pick up a future-projected population figure.
- **DEM fallback**: the script actually attempts to load FABDEM and falls
  back to `COPERNICUS/DEM/GLO30` on failure (a real try/catch around a
  forced `.getInfo()` call), rather than requiring a manual toggle.

## Where the spec was implemented literally vs. where a gap required a call

The spec is explicit and `[DO NOT ALTER]`-tagged for the model's core
structure (geometric A×B combination, fire inversion, constraint fractional
thresholds, non-linear membership curves, hybrid percentile classification)
— all of that is implemented exactly as written. A handful of points were
described conceptually but not fully formula-specified; each is marked with
a comment in `PPI_SK_v2.js` at the point it's used:

- **B1 soil-depth point estimate**: the spec defines `B1_optimistic` and
  `B1_pessimistic` variants and says to "carry both into the Monte Carlo,"
  but doesn't say which feeds the single deterministic score. The script
  uses their mean for `PPI_absolute`, and exports both variants so the
  Monte Carlo companion draws between them per Section 9.2 step 2.
- **D5 Lantana proxy**: the spec asks for "low amplitude combined with
  moderate absolute NDVI" — read as an AND condition and implemented as the
  product of the two component scores, not a documented spec formula. State
  this in the DPR alongside the existing "probabilistic proxy" caveat
  (Section 5.4).
- **C4s elevation optimum band**: the spec flags this `[VERIFY] —
  parameterise after inspecting the actual elevation distribution.` The
  script computes the AOI's own 2nd/20th/80th/98th elevation percentiles at
  run time and builds the trapezoid from them, removing the manual step.
- **RUSLE K-factor**: the spec names "Williams (1995) EPIC equation" without
  reproducing it; the script implements the standard published form on
  percent sand/silt/clay and percent organic carbon.
- **Aspect flat-block override (C2s)**: the spec's per-pixel "flat pixels
  get 0.5" rule is applied here at the block level (median block slope
  &lt; 2%), since C2s is computed from the block's circular-mean aspect, not
  per-pixel.

## Known engineering fixes applied beyond the literal spec pseudocode

The spec's own inline JS snippets are illustrative, not all directly
runnable. Three correctness issues were fixed while implementing:

1. **Percentile-rank classification**: a per-feature `list.indexOf(value)`
   scan (as sketched in Section 11.1) is O(n²) across the block collection
   — impractical at full range scale (thousands of blocks). Replaced with an
   O(n) sort + sequential-index zip.
2. **Circular-mean aspect**: `ee.Number.atan2` takes `x.atan2(y)` (i.e. the
   receiver is the x-component), so the call must be `cosMean.atan2(sinMean)`,
   not `sinMean.atan2(cosMean)` — the reversed order silently computes the
   complementary angle.
3. **`fuzzyTrap` with data-dependent breakpoints**: when the trapezoid
   corners are computed values (as in C4s, drawn from the AOI's own
   elevation percentiles) rather than literals, plain JS `-` on two
   `ee.Number` objects doesn't error, it silently returns `NaN` client-side
   before ever reaching the server. Fixed to use `.subtract()` throughout.
