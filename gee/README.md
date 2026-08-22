# BGDSS Module 2 — CAMPA Site Prioritization

Google Earth Engine decision-support model for CAMPA plantation/ANR site
selection. Pilot: Sabarkantha Forest Division, Gujarat Forest Department.

| File | Purpose |
|---|---|
| `BGDSS_CAMPA_Module2_v5.js` | The model. Paste into a new GEE script and run. |
| `test/mcda_math_test.js` | Node regression tests for the client-side MCDA math (`node test/mcda_math_test.js`). |

**Requires no user-supplied layers.** Every input is a public GEE asset.

---

## Running it

1. Open [code.earthengine.google.com](https://code.earthengine.google.com), new script, paste `BGDSS_CAMPA_Module2_v5.js`.
2. Edit `CONFIG` — at minimum `roi`, `targetTreatmentAreaHa` (confirmed APO allocation) and `budgetINR` (confirmed ceiling).
3. Run. **Read the `CRITERION INTEGRITY AUDIT` block in the Console first** — it tells you which criteria actually informed the ranking and which were dropped, and why.
4. CSV / GeoTIFF / Shapefile exports queue in the Tasks tab.

Runtime is roughly 3–8 minutes depending on which optional modules are enabled
(`runValidation`, `runFutureClimate`, `runProductivityTrend`). Turn all three
off for a fast iteration pass.

### If you hit `User memory limit exceeded`

Every criterion is a *computation chain*, not a stored raster. Any whole-ROI
statistic re-evaluates 25 years of Landsat Theil–Sen, three years of Sentinel-2
compositing, kilometre-scale focal kernels and distance transforms on every
pixel it touches. So the audit **samples** instead of reducing the full ROI, and
the heavy geometric operations run on coarser working grids.

Turn these knobs in order:

| Step | Setting | Change |
|---|---|---|
| 1 | `runProductivityTrend` | `false` — by far the most expensive (25 yr, four Landsat sensors) |
| 2 | `runValidation`, `runFutureClimate` | `false` |
| 3 | `audit.sampleScale` / `audit.samplePixels` | 30 → 60 or 100 / 5000 → 2000 |
| 4 | `blockStatsScale` | 20 → 30 |
| 5 | `perf.patchScale` / `perf.distanceScale` | 60 → 100 / 30 → 60 |
| 6 | `scale` | 10 → 20 or 30 |

None of these change the **method**, only the working resolution of the
statistics. Coarsening the audit sample does not weaken the integrity checks —
a few thousand samples estimate a percentile or standard deviation far more
precisely than the drop thresholds care about. And since half the inputs are
250 m or coarser, dropping `scale` to 20–30 m loses far less than the 10 m
figure implies.

---

## What v5 changes

### Defects fixed from v4

| # | Defect | Consequence in v4 | Fix |
|---|---|---|---|
| 1 | `ee.Image.pixelArea()` was cat'd **unmasked** alongside a `priorityScore` masked to `treatment > 0`. `reduceRegions` reduces each band under its own mask. | `areaHa_sum` reported the **full 9 ha block** while `priorityScore_mean` covered only the eligible sliver. A block 5% treatable but scoring 0.9 on that sliver consumed 9 ha of the APO target and sent a crew to 95% cropland. | pixelArea masked to the eligible set; every block carries `eligibleFraction` with a hard floor (`CONFIG.minEligibleFrac`). |
| 2 | Normalization ranges hardcoded to national spans (SOC 0–50, soil loss 0–40, temp 32–46). | Inside one Beat, SOC might span 8–14 g/kg → a 13.05%-weighted criterion compressed into a 0.12-wide band while Soil Texture spread 0.3–1.0. **The AHP weights were being silently overridden by normalization choices.** | Criteria declare `percentile` (ROI 2nd–98th stretch) or `absolute` (fixed anchors where an external standard exists). A `REALISED INFLUENCE` table prints weight × observed spread next to nominal weight. |
| 3 | "Fragmentation Index" was `focal_mean` of a forest mask — that is local forest *proportion*, near-monotonic with Distance to Forest. | Two criteria at 8.48% each measuring one axis = **16.96% double-counted**. | Replaced with genuine **edge density**. A collinearity matrix now *verifies* independence instead of assuming it. |
| 4 | Hansen `treecover2000` — a **year-2000, 30 m** layer — drove every FSI class and every New-Plantation-vs-ANR decision. | 25 years of regrowth, loss and plantation invisible to the model. | Current canopy = Dynamic World tree probability (10 m, current) fused with Hansen rolled forward through `lossyear`/`gain`. |
| 5 | RUSLE `K` was a fixed `0.28`; `LS` used `slope.reduceNeighborhood(sum)` as an "upslope proxy" — not flow accumulation, no hydrological meaning. | Erosion layer was largely a slope re-skin. | `K` per-pixel via **Williams (1995)** EPIC equation; `LS` via **Desmet & Govers (1996)** using MERIT Hydro `upa` (real upstream drainage area). |
| 6 | `CONFIG` defined `rootShootRatio`, `carbonFraction`, `co2Conversion`, `restorationHorizonYears` — and never used them. | No tCO₂e output at all, which is the number CAMPA reporting asks for. | Actual tCO₂e per block over the horizon (IPCC 2019 Refinement Tier 1), plus cost-per-tCO₂e. |

### The core new idea: the integrity audit

v3 removed Soil Depth and v4 removed Wildlife Corridor Proximity and Human
Dependency, because each carried real AHP weight while contributing no real
information. That was right — but it was done **by hand, after someone
noticed**.

v5 checks every criterion on every run and refuses to let one carry weight it
cannot justify. Three failure modes are caught automatically:

- **SPARSE** — valid data on < 70% of eligible pixels. v4's `unmask(0.5)`
  silently converted these to neutral. GEDI L4A footprint sampling over a
  single Beat was the worst offender: `.mean()` over one year leaves most
  pixels masked, so Carbon-Gain (6.47% weight) was probably flat 0.5 across
  most of the ROI — the exact inert-criterion problem v4 was written to fix,
  hidden one layer deeper.
- **INERT** — normalized standard deviation below threshold. A criterion that
  is ~constant cannot change a ranking regardless of weight. This is what a
  flat 0.5 was, and it is also what any 25 km climate layer degenerates into
  over a 9 km² Beat.
- **REDUNDANT** — |r| > 0.80 against another criterion. Reported with the
  combined weight sitting on that one axis.

Dropped criteria have their weight redistributed proportionally, and every drop
is printed with its reason. **No silent neutrals anywhere.**

### Criteria reinstated without user data

v4 removed both for want of Forest Dept GIS layers. Neither needs them:

| Criterion | Replacement source |
|---|---|
| Human Dependency & Accessibility | JRC **GHSL** population + built-up surface (100 m). A continuous pressure gradient, better than village points. Modelled as an **inverted-U**: very remote = labour/logistics problem; very high pressure = grazing/encroachment. |
| Wildlife Corridor Proximity → **Structural Connectivity** | Patch-connectivity index computed from the model's own forest patch map (`connectedPixelCount`) + WDPA proximity. A corridor polygon would now *refine* this, not enable it. |

### New criteria

- **Land Productivity Trend** — Theil–Sen slope on 25 years of annual peak
  Landsat NDVI. Separates *actively degrading* from *stably poor*; v4 could not
  tell these apart, and they warrant different interventions. With SOC and land
  cover (both already present) this completes the three sub-indicators of
  **UNCCD SDG Indicator 15.3.1**, so the model is now formally aligned with the
  UNCCD Good Practice Guidance rather than merely resembling it.
- **Moisture Availability** — TWI + HAND (MERIT Hydro) + TerraClimate soil moisture.
- **Future Climate Resilience** — NASA NEX-GDDP-CMIP6 SSP2-4.5, delta-downscaled onto the fine baseline.

### Methodology

- **Three aggregations in parallel.** WLC (compensatory — what v4 did),
  Weighted Geometric Mean (non-compensatory: a near-zero on *any* criterion
  drags the whole score down, so good rainfall can no longer mask unplantable
  soil), and TOPSIS. Blocks in the top-N of **all three** are marked `ROBUST`.
  Spearman agreement between methods is reported — low agreement means the
  ranking depends on the aggregation rule rather than the evidence.
- **Monte Carlo weight sensitivity** (1000 draws, ±20%). Every block gets a
  `selectionFrequency`. Selected in 98% of runs is a different proposition from
  selected in 51%.
- **Explainability.** Per-criterion score *and* contribution exported per
  block. A ranking nobody can interrogate does not survive its first review
  meeting.
- **Budget-constrained plan** alongside area-constrained (greedy by score per
  rupee), plus **spatial contiguity** filtering so selections form workable
  compartments instead of scattered 9 ha confetti.
- **Hard constraints separated from scored factors** (Eastman's framework):
  slope ceiling, HAND waterlogging floor, bare-ground/rock screen, already-forested exclusion.

### Validation

Back-tests against sites that measurably gained tree cover 2005–2020 (Hansen
`gain`) as pseudo-positives vs matched controls, and reports **AUC**. Criteria
derived from canopy or NDVI trend are excluded from the validation score to
avoid circularity; caveats print alongside the number.

No comparable Indian CAMPA prioritization tool currently reports a validation
statistic. Read the printed caveats before quoting it.

---

## Known limits — state these, don't let a reviewer find them

- **Effective resolution is not 10 m.** Inputs range from 10 m (Sentinel-2,
  Dynamic World) through 250 m (SoilGrids) and 5566 m (CHIRPS) to 25 km
  (CMIP6). `CONFIG.scale` is the *output grid*, not the information content.
  The console prints a provenance table and the coarsest surviving criterion —
  quote that. The INERT check is what stops a 25 km layer masquerading as 10 m.
- **Weights are PROVISIONAL.** They are reasoned cluster allocations, not a
  fresh AHP elicitation on this 17-criterion list. Re-run the pairwise survey
  (report Consistency Ratio < 0.10; aggregate multiple officers by geometric
  mean) and paste the export into `CONFIG.weights`. Until then the sensitivity
  analysis carries the argument, not the weights.
- **Phenological Anomaly is still an unvalidated invasion proxy.** Now
  phenology-based (Lantana/Prosopis hold green foliage in a deciduous matrix —
  a phenological signature, not a brightness one), which is more defensible
  than v4's dry-season NDVI, but field-verify before costing clearance.
- **Two value judgements changed and need sign-off.** v4 scored high fire
  frequency and high invasion as *higher* priority (treating them as need). v5
  defaults both to *lower* priority (treating them as feasibility risk to a
  young plantation). Both readings are defensible and they produce different
  maps. See `CONFIG.directions` — set to `+1` to restore v4 behaviour. **This
  is a policy choice, not a technical one.**
- **Cost rates and reference biomass remain assumptions** pending Working Plan
  / ISFR figures.

---

## References

Abatzoglou et al. 2018 (TerraClimate) · Brown et al. 2022 (Dynamic World) ·
Desmet & Govers 1996 (LS factor) · Dubayah et al. 2022 (GEDI) ·
Funk et al. 2015 (CHIRPS) · Giglio et al. 2018 (MCD64A1) ·
Hansen et al. 2013 (Global Forest Change) · Poggio et al. 2021 (SoilGrids v2) ·
Renard et al. 1997 (RUSLE) · Schiavina et al. 2023 (GHSL) · Sen 1968 ·
Thrasher et al. 2022 (NEX-GDDP-CMIP6) · Williams 1995 (EPIC K-factor) ·
Yamazaki et al. 2019 (MERIT Hydro) · Zanaga et al. 2022 (ESA WorldCover) ·
UNCCD Good Practice Guidance for SDG Indicator 15.3.1 (2021) ·
FSI India State of Forest Report (canopy-density classes) ·
IPCC 2019 Refinement to the 2006 Guidelines, Vol. 4 Ch. 4
