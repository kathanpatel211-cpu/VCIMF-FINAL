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

### If the page freezes ("Page Unresponsive")

A frozen tab and a memory error are **different faults**. A freeze means
something is calling `getInfo()` and blocking the Code Editor's UI thread —
which happens regardless of how little memory the call uses, because the browser
simply cannot repaint while it waits.

Every heavy call in this script uses `.evaluate()` instead, so the page stays
live while work runs and results appear in the Console as each stage returns.
The only blocking calls left are the ~20 cheap dataset availability probes near
the top, which have to be synchronous because the graph is built differently
depending on which datasets exist.

**If you extend this script, never put `getInfo()` in a loop.**

### If you hit `User memory limit exceeded`

The model makes **one** server call: a single `reduceRegions` over the planning
block grid, which returns each criterion's mean and valid-pixel count per block.
The integrity audit is derived from that same call, so it costs nothing extra.

If the call exceeds the limit, the script **coarsens the block-statistics scale
automatically** (30 → 60 → 120 → 240 m) and retries before giving up. Coarsening
that scale changes how finely each block's mean is estimated — it does not drop
a criterion or alter a weight — so the model stays whole. A 300 m block still
holds 100 samples at 30 m and 25 at 60 m.

If it exhausts those retries:

| Step | Setting | Change |
|---|---|---|
| 1 | `runProductivityTrend` | `false` — the most expensive single chain |
| 2 | `runFutureClimate`, `runValidation` | `false` |
| 3 | `blockSizeM` | 300 → 500 (fewer, larger blocks) |
| 4 | `perf.patchScale` / `perf.distanceScale` | 60 → 100 / 30 → 60 |
| 5 | `scale` | 10 → 20 or 30 |

Note what is **not** on that list: dropping criteria or changing weights. Every
knob changes the working resolution of a statistic, never the model's content.

### `unmask()` unbounds an image — always re-clip

The fault that made `distanceToForest`, `hydrologicalConnectivity` and
`structuralConnectivity` fail no matter how coarsely they were sampled.
`unmask()` strips the mask, and an unmasked image in Earth Engine has **infinite
extent**. A distance transform or a kilometre-scale focal mean over an unbounded
image does not cost "one Beat's worth" of work — it costs effectively a planet's
worth, and no sampling scale rescues it.

Every `unmask()` in this script is followed by a `.clip()` to the ROI plus
whatever halo the operation needs to reach. If you add one, do the same.

### Canopy density: post-monsoon Sentinel-2, not Hansen

The primary run against Sabarkantha returned canopy at the 5/25/50/75/95th
percentile of **0.0 / 0.0 / 0.0 / 1.0 / 4.0 %** — across hills visibly under
dense tree cover in the basemap. That is not a real forest condition. Hansen
GFC's `treecover2000` is calibrated primarily against humid/evergreen canopy
and is a documented poor fit for Indian dry-deciduous/thorn forest (the
Aravalli tract this pilot sits in): the same canopy that reads as dense on
optical imagery in the post-monsoon season reads as sparse to Hansen's
classifier.

FSI's own methodology doesn't use Hansen at all — the India State of Forest
Report interprets **post-monsoon** satellite imagery (roughly October–December),
the one window in this deciduous landscape where canopy is fullest and most
separable from bare ground. Canopy density is now built the same way: Fractional
Vegetation Cover (Carlson & Ripley 1997) from post-monsoon Sentinel-2 NDVI,

```
FVC = ((NDVI - NDVI_soil) / (NDVI_veg - NDVI_soil))^2
```

with fixed anchors (`NDVI_SOIL = 0.12`, `NDVI_VEG = 0.62`) typical of semi-arid
dry-deciduous forest in this season — not a per-ROI stretch, so the % is
comparable across Beats on an FSI-style absolute scale. **Field-verify a handful
of plots against these anchors before quoting the absolute percentage**; the FSI
*class boundary* a pixel falls in is far more robust than the exact number,
since the classes are wide (0–10 / 10–40 / 40–70 / 70+%).

Hansen remains in use for the satellite-only validation back-test's gain/loss
signal — a different, more robust use of the same dataset than reading its
canopy fraction directly. If Sentinel-2 is unavailable for an ROI, the script
falls back to Hansen (with an explicit reliability warning), then to Dynamic
World class bands as a last resort.

### Land productivity trend window

Defaults to **Landsat 8/9, 2013–present**. This is both far cheaper and
arguably cleaner than the full record: Landsat 7's scan-line corrector failed in
2003, so every post-2003 L7 scene carries wedge-shaped data gaps that bias an
annual-maximum composite. UNCCD guidance asks for a 10–15 year baseline, which
2013–present satisfies.

Set `trendIncludeLegacy: true` and `trendStartYear: 2000` for the full 25-year
record via L5/L7 — a longer trend, at materially higher compute cost and with
the SLC-off gaps.

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

### A note on `reproject()`

The single biggest cost lever in Earth Engine. It **pins** computation to the
scale you give it, everywhere downstream, *overriding* the scale a reducer or
`sample` asks for. Reprojecting anything to 10 m forces its entire upstream
chain to run at 10 m however coarsely you later sample it.

Every `reproject()` in this script is set at or near its source data's **native**
resolution (see `CONFIG.perf`) — never finer, which would only invent detail
that isn't in the data while multiplying the work. ALOS is 30 m, so the DEM is
pinned at 30 m; the canopy fusion drives the forest mask at 30 m; patch
connectivity runs at 60 m. If you add a `reproject()`, do the same.
