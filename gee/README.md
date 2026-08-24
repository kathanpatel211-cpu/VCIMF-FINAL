# BGDSS Module 2 — CAMPA Priority Score

Google Earth Engine decision-support model for CAMPA New Plantation site
prioritization. Pilot: Sabarkantha Forest Division, Gujarat Forest Department.

**One deliverable**: a CAMPA Priority Score for every treatable block in the
ROI, classified into five categories — Priority 1 (act first) through
Priority 5 (defer) — each reported with hectares, estimated cost and
estimated carbon sequestration. No optional modules competing for attention or
compute budget.

| File | Purpose |
|---|---|
| `BGDSS_CAMPA_Module2_v5.js` | The model (build v6.0.0). Paste into a new GEE script and run. |
| `test/mcda_math_test.js` | Node regression tests for the client-side scoring/classification logic (`node test/mcda_math_test.js`). |

**Requires no user-supplied layers.** Every input is a public GEE asset.

---

## Running it

1. Open [code.earthengine.google.com](https://code.earthengine.google.com), new script, paste `BGDSS_CAMPA_Module2_v5.js`.
2. Edit `CONFIG` — at minimum `roi` and `targetTreatmentAreaHa` (confirmed CAMPA APO allocation, drives the "selected this cycle" highlight).
3. Run. Read, in order:
   - the ROI size and canopy/slope diagnostic
   - the eligibility funnel
   - the **CRITERION INTEGRITY AUDIT** (which criteria actually informed the score)
   - the **APPLIED WEIGHTS** table
   - the **five-class PRIORITY table** — the deliverable
4. Four exports queue in the Tasks tab: `_PriorityClass` (raster), `_PriorityBlocks` (shapefile), `_PriorityClassSummary` (CSV — the table an APO note quotes), `_RankedBlocks` (CSV — full transparency, one row per block with every criterion score).

---

## Methodology

**Eligibility (Boolean, non-compensatory).** FSI 4-tier canopy classification
(Scrub <10% / Open 10–40% / Moderately Dense 40–70% / Very Dense >70%)
restricts treatment to Scrub + Open, the official India State of Forest Report
convention. Hard constraints — slope, waterlogging (HAND), bare/rock ground,
already-forested — are pass/fail exclusions, never traded off against a good
score elsewhere (Eastman's MCDA framework).

**Thirteen weighted criteria**, each normalized 0–1 and combined by an
AHP-reasoned weight into one CAMPA Priority Score per block (Weighted Linear
Combination):

| Cluster | Criteria | Weight |
|---|---|---|
| Ecological Integrity | Distance to Forest, Hydrological Connectivity, Degradation Priority | 25% |
| Physical Suitability | Soil Suitability, Soil Organic Carbon, Moisture Availability, Workability | 30% |
| Climate | Climate Exposure | 10% |
| Carbon & Restoration | Carbon-Gain Potential, Erosion Risk | 12% |
| Risk & Feasibility | Fire Risk, Phenological Anomaly (invasion proxy) | 13% |
| Human Dimension | Human Dependency | 10% |

**Automatic integrity audit**, run on every criterion on every run, at no
extra cost (derived from the same block aggregation the score itself needs):

- **SPARSE** — dropped if valid data covers <70% of eligible pixels, or <70%
  of blocks.
- **INERT** — dropped if the normalized spread across blocks is near-zero: a
  criterion that cannot change any ranking regardless of its weight.

A dropped criterion has its weight redistributed proportionally across the
survivors, and the drop is printed with its reason. This is what stops a
data-availability gap from silently defaulting to a flat neutral value while
still consuming weight.

**Five priority classes, whole-area coverage.** Every eligible block — not
only the blocks that fit one year's area target — gets a class. Quantile by
default (each class ≈20% of blocks, always usable); `equalInterval` available
via `CONFIG.priorityClassMethod` when the score distribution matters more than
equal class sizes.

**New Plantation only.** ANR is not operational under Gujarat CAMPA
(`CONFIG.anrOperational = false`). Every eligible block is prescribed and
costed as New Plantation. Flip the flag if that changes.

---

## What was removed, and why

A prior version of this model carried three competing aggregation methods
(WLC/TOPSIS/Weighted Geometric Mean), Monte Carlo weight-sensitivity, a
budget-constrained alternate plan, spatial contiguity clustering, a CMIP6
future-climate module, a 25-year Landsat productivity-trend module, and a
satellite-only validation back-test — seventeen criteria in total. Each piece
was individually defensible, but combined they repeatedly exceeded Earth
Engine's per-request memory limit: a model that cannot finish a run is not a
working tool.

v6 keeps one scoring method and thirteen criteria, each backed by a citable
method, chosen because it changes the ranking rather than adding
methodological completeness. Cut: the two extra aggregation methods and
sensitivity analysis (not requested; tripled what needed interrogating when a
ranking looked wrong), the budget/contiguity extras (not requested), CMIP6 (25
km over a Beat-sized ROI, likely dropped by the INERT check anyway), the
productivity trend (by far the single most expensive chain — four Landsat
sensors, one operation per year), the AUC back-test (a second independent
sampling pass the flagship output doesn't need every run), Structural
Connectivity and Edge Density (both required unbounded focal operations that
were a repeated source of memory failures), and WDPA/TPI/roughness/Meta canopy
height (map-layer decoration that never fed the score).

---

## Fixes carried forward from the debugging history

- **Canopy magnitude is post-monsoon (Oct–Dec) Sentinel-2 Fractional
  Vegetation Cover** (Carlson & Ripley 1997), the same season FSI's own State
  of Forest Report methodology uses. Hansen GFC's `treecover2000` was tried
  first and rejected: it's calibrated mainly against humid/evergreen canopy
  and returned a median of ~0% across visibly forested dry-deciduous hills in
  the Aravalli tract. The FVC anchors (`NDVI_SOIL=0.12`, `NDVI_VEG=0.62`) are
  literature-typical for this forest type/season, not locally calibrated —
  field-verify before quoting the absolute percentage; the FSI *class* a pixel
  falls in is far more robust than the exact number.
- **DEM projection.** `mosaic()` discards projection, and slope on a
  projection-less image is meaningless — this previously rejected 100% of the
  ROI on the slope constraint. SRTM (a single properly-projected image) is
  preferred; ALOS is the fallback with its projection explicitly restored.
- **Distance transforms are bounded.** `unmask()` produces an image with
  infinite extent; running a distance transform or focal mean over it costs
  effectively unlimited work regardless of the ROI's real size. Every such
  operation re-clips to the ROI plus the exact halo needed.
- **Area accounting.** `pixelArea` is masked to the eligible set specifically,
  so a block that is mostly untreatable is not credited its full block area.
- **Aggregation runs in small groups**, not one big call, with automatic scale
  coarsening and, on repeated failure, the criterion is dropped rather than
  the run aborting — recorded exactly like a SPARSE or INERT drop.
- **`rows[b.id - 1]` indexing bug** (v6.0.0, caught in review before the first
  run): the per-block cost/carbon lookup indexed a *filtered* array by
  position, which silently pulled the wrong block's phenology/erosion values
  once any block had been skipped earlier in the list. Fixed with a `bid`-keyed
  lookup; regression test in `test/mcda_math_test.js` reproduces the bug and
  proves the fix.

---

## Known limits — state these

- **Weights are a reasoned allocation, not a fresh AHP elicitation.** Re-run
  `BGDSS_AHP_Weighting_Calculator.html` on this 13-criterion list (report the
  Consistency Ratio, must be < 0.10) and paste the export into
  `CONFIG.weights`. The audit and applied-weights table make the model's
  actual behaviour visible in the meantime; they don't substitute for the
  elicitation.
- **Phenological Anomaly (invasion proxy) is unvalidated** — a dry/wet NDVI
  seasonal-amplitude signal, not a trained classifier. Field-verify flagged
  blocks before costing clearance.
- **Cost rates and reference biomass are assumptions** pending Working Plan /
  ISFR figures.
- **Effective resolution** is set by the coarsest criterion actually kept
  (SoilGrids at 250 m, CHIRPS at ~5.6 km), not by `CONFIG.scale`. The
  provenance table prints native resolutions; quote those.

---

## If the page freezes or you hit a memory error

These are different faults. A **freeze** means a blocking `getInfo()` call —
every heavy call here uses `.evaluate()`, so the page stays live; only the
handful of dataset-availability probes at the top are synchronous, and they're
cheap (`limit(1).size()`, not a collection scan). A **memory error** means too
much computation was asked for in one call — the aggregation already runs in
small groups with automatic scale coarsening (30 → 60 → 120 m) and drops a
criterion rather than failing the whole run. If it still exhausts that:

1. `CONFIG.aggGroupSize` — 3 → 1 (one criterion per call, slower but safest)
2. `CONFIG.blockSizeM` — 300 → 500 (fewer, larger blocks)
3. `CONFIG.scale` — 10 → 20 or 30 (output grid only; see Known Limits)

None of these change the method — only the working resolution of the
statistics.

## References

Abatzoglou et al. 2018 (TerraClimate) · Brown et al. 2022 (Dynamic World) ·
Carlson & Ripley 1997 (Fractional Vegetation Cover) · Desmet & Govers 1996 (LS
factor) · Dubayah et al. 2022 (GEDI) · Farr et al. 2007 (SRTM) · Funk et al.
2015 (CHIRPS) · Giglio et al. 2018 (MCD64A1) · Poggio et al. 2021 (SoilGrids
v2) · Renard et al. 1997 (RUSLE) · Schiavina et al. 2023 (GHSL) · Tadono et al.
2014 (ALOS AW3D30) · Williams 1995 (EPIC K-factor) · Yamazaki et al. 2019
(MERIT Hydro) · Zanaga et al. 2022 (ESA WorldCover) · FSI India State of Forest
Report (canopy-density classes and post-monsoon interpretation window) · IPCC
2019 Refinement to the 2006 Guidelines, Vol. 4 Ch. 4 (carbon Tier 1 defaults)
