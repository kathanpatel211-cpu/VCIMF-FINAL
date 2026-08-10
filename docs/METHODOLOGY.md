# Spatial Runoff Coefficient (C) Model — Methodology

**Scope:** This document and the accompanying script (`gee/runoff_coefficient_model.js`)
cover **only** the spatial runoff coefficient C for the upstream contributing
catchment of the proposed check dam. Peak discharge (Q), rainfall intensity,
time of concentration, IDF curves, return period, SCS-CN runoff, flood
routing, and check-dam hydraulic design are explicitly **out of scope** and
are not computed anywhere in this script.

## Study area

```javascript
var catchment = ee.FeatureCollection('projects/raygadh-range/assets/catchmentarea');
```
Asset ID: `YXMV4HWVQVTVKURIZ6H42NBF`
Catchment area: **14.07 ha (0.1407 km²)**. All calculations are clipped to this polygon.

## Methodology statement (verbatim)

> "The spatial runoff coefficient is derived using an Indian Government/WAPCOS
> land-cover–soil-texture–slope coefficient framework for terrain up to 30%
> slope, supplemented by source-based Indian IRC surface-condition
> coefficients for terrain exceeding 30% slope. Remote-sensing datasets are
> used to identify and validate land and surface conditions but are not
> applied as arbitrary numerical multipliers to the runoff coefficient. Soil
> information is incorporated at its native spatial information scale. The
> catchment-average runoff coefficient is calculated by area-weighting the
> source-defined spatial coefficients across the delineated upstream
> catchment. Each coefficient assignment is accompanied by source, confidence
> and classification-reason metadata, and unresolved areas are explicitly
> reported rather than artificially filled."

## Core formula

```
Cw = Σ(Ci · Ai) / Σ(Ai)
```

C is calculated per 30-m spatial unit first; Cw is the area-weighted
catchment aggregate — never the reverse.

## Classification hierarchy (implemented exactly)

1. **LEVEL 1 — WAPCOS/Indian table.** Applies when slope ≤ 30% **and** land
   cover is Forest, Grassland/Pasture, or Agriculture **and** soil texture
   (Sandy/Loamy/Clayey) is known. Assigns the exact tabulated coefficient
   (Section 4 tables below). Source code `101`.
2. **LEVEL 2 — IRC steep-surface branch.** Applies when slope > 30%, **or**
   at any slope for land cover the WAPCOS table does not define (Bare/sparse
   vegetation, Built-up). Actual surface condition is classified from
   remote-sensing evidence first; the corresponding IRC coefficient (Section
   6 table) is then assigned. Source codes `201–210`. Slope is a **branch
   selector only** — it never sets C directly.
3. **LEVEL 3 — documented fallback.** Not currently populated by an
   additional source; reserved for future authoritative additions.
4. **LEVEL 4 — unresolved.** If land cover, soil, or slope is missing, or
   surface condition cannot be defensibly classified (e.g. rock vs. bare
   soil ambiguity with no lithology layer available), the pixel is left
   **unresolved** (`C_SOURCE = 999`) with an explicit reason code. No value
   is ever invented or filled in.

## WAPCOS coefficient table (slope ≤ 30%)

**Forest**

| Soil | 0–5% | 6–10% | 11–30% |
|---|---:|---:|---:|
| Sandy | 0.10 | 0.25 | 0.30 |
| Loamy | 0.30 | 0.35 | 0.50 |
| Clayey | 0.40 | 0.50 | 0.60 |

**Grassland/Pasture**

| Soil | 0–5% | 6–10% | 11–30% |
|---|---:|---:|---:|
| Sandy | 0.10 | 0.16 | 0.22 |
| Loamy | 0.30 | 0.36 | 0.42 |
| Clayey | 0.40 | 0.55 | 0.60 |

**Agriculture**

| Soil | 0–5% | 6–10% | 11–30% |
|---|---:|---:|---:|
| Sandy | 0.30 | 0.40 | 0.52 |
| Loamy | 0.50 | 0.60 | 0.72 |
| Clayey | 0.60 | 0.70 | 0.72 |

## IRC surface-condition table (slope > 30%, and Bare/Built-up at any slope)

Labelled **"IRC suggested/source-based surface runoff coefficients"** —
never presented as measured/field-confirmed values for this catchment.

| Surface condition | C | Source code |
|---|---:|---|
| Steep bare rock / watertight surface | 0.90 | 201 |
| Steep rock with vegetation | 0.80 | 202 |
| Plateau with light vegetation | 0.70 | 203 |
| Bare stiff clayey/impervious soil | 0.60 | 204 |
| Stiff clayey soil with vegetation | 0.50 | 205 |
| Loam lightly covered | 0.40 | 206 |
| Loam largely covered/turfed | 0.30 | 207 |
| Sandy soil with light growth | 0.20 | 208 |
| Sandy soil with heavy bush/woodland/forest | 0.10 | 209 |
| Impervious built-up/pavement | 0.90 | 210 |

## Surface-condition classification logic (Section 7 of the script)

Slope alone never selects an IRC category. The script classifies the actual
physical surface condition using layered remote-sensing evidence, then maps
that condition to the nearest documented IRC category:

1. **Built-up** (ESA WorldCover = Built-up, or Dynamic World `built`
   probability ≥ 0.50) → Impervious (210), any slope, HIGH confidence.
2. **Water / wetland** (WorldCover = Permanent water or Herbaceous wetland)
   → unresolved, reason = water/wetland (6). No coefficient is defined for
   open water/wetland in either source table.
3. **Other land-cover classes** not covered by either table (snow/ice,
   mangroves, moss/lichen) → unresolved, reason = other land-cover class (7).
4. **Bare candidate** (NDVI < 0.15 and Dynamic World `bare` probability ≥
   0.50):
   - Clayey soil → Bare stiff clayey soil (204), MODERATE confidence
     (soil-supported).
   - Non-clayey **and** rock signature present (Sentinel-2 BSI ≥ 0.30 **and**
     local elevation ruggedness ≥ 3 m) → Steep bare rock (201), **LOW**
     confidence — flagged explicitly as a remote-sensing proxy, since no
     lithology/geology layer is used.
   - Non-clayey, no clear rock signature → **unresolved**, reason = rock/bare
     ambiguity (5). This is the scientifically honest outcome when optical
     evidence cannot distinguish exposed rock from bare soil.
5. **Vegetated pixels** (NDVI ≥ 0.15), split into terrain-driven special
   cases and a general vegetation-density × soil-texture grid:
   - Steep + rock signature → Steep rock with vegetation (202), LOW
     confidence.
   - Steep + locally flat (|TPI| ≤ 2 m, i.e. a bench/plateau within a
     steep-classified cell) + light cover → Plateau with light vegetation
     (203), LOW confidence.
   - Otherwise, dense cover (NDVI ≥ 0.35) × soil texture → Sandy
     woodland/forest (209) / Loam turfed (207) / Stiff clay + vegetation
     (205), MODERATE confidence.
   - Light/moderate cover (0.15 ≤ NDVI < 0.35) × soil texture → Sandy light
     growth (208) / Loam lightly covered (206) / Stiff clay + vegetation
     (205 — the table has no separate "lightly covered" clayey entry), all
     MODERATE confidence.
6. Any pixel with valid inputs that still falls outside all of the above →
   unresolved, reason = insufficient evidence (8).

No NDVI/BSI/slope value is ever multiplied or added to a table C value —
they are used only to select which documented category applies.

## Data sources and resolution honesty

| Layer | Dataset | Native resolution | Role |
|---|---|---|---|
| Land cover | ESA WorldCover v200 | 10 m | Primary backbone, aggregated to 30 m by **majority (mode)**, not nearest-neighbor subsampling |
| Vegetation/bare evidence | Sentinel-2 SR harmonized (NDVI, EVI, BSI), cloud-masked multi-year median | 10–20 m | Surface-condition evidence |
| Dynamic World V1 | probability bands (bare, trees, grass, shrub, built) | 10 m | Surface-condition evidence, corroborates NDVI/BSI |
| Terrain | SRTM 30 m (slope, ruggedness, TPI) | ~30 m | Branch selector (≤30% vs >30%), plateau/rock-signature evidence |
| Soil | OpenLandMap sand/clay weight-fraction | **~250 m native** | Texture class (Sandy/Loamy/Clayey); explicitly **not** claimed at 10 m or 30 m accuracy — the same 250-m value is honestly propagated across all 30-m cells it covers |

Final analysis grid: **30 m**, matching the terrain layer and reflecting the
coarsest layer that materially constrains resolution (soil).

## Soil texture thresholds

- Clay weight-fraction ≥ 35% → **Clayey**
- Clay < 35% and sand weight-fraction ≥ 70% → **Sandy**
- Otherwise → **Loamy**

An **HSG proxy** (Sandy→A/B, Loamy→B/C, Clayey→C/D) is produced as a
separate diagnostic layer only, explicitly labelled "HSG proxy /
texture-derived screening" — never presented as confirmed SCS-CN Hydrologic
Soil Group, and never mixed into the WAPCOS/IRC C calculation.

## Provenance, confidence, and reason bands

Every pixel in the exported raster carries four bands:

- **C_VALUE** — the assigned coefficient (0 on unresolved pixels; never
  treated as a real coefficient there).
- **C_SOURCE** — `101` WAPCOS, `201–210` IRC categories (see table above),
  `301` field/expert override, `999` unresolved.
- **C_CONFIDENCE** — `1` High, `2` Moderate, `3` Low, `4` Unresolved. High
  coverage (≥95%) is never reported as "high confidence" on its own — the
  confidence band is independent of coverage.
- **C_REASON** — populated only for unresolved pixels: `1` missing land
  cover, `2` missing soil, `3` missing slope, `4` steep surface ambiguous
  (uncaught general case), `5` rock/bare ambiguity, `6` water/wetland, `7`
  other land-cover class, `8` insufficient evidence, `9` projection/mask
  issue.

## Diagnosing the prior 3.25 ha unresolved-area bug

The prior model reported 14.07 ha catchment, 76.45% valid C, and 3.25 ha
unresolved — while the explicit >30%-slope unresolved area was only 0.32 ha,
leaving ~2.93 ha unexplained. This script's Section 13 QA block prints a
full reason-code breakdown of every unresolved pixel specifically to prevent
that gap from recurring. The design change responsible for closing it:
Bare/sparse-vegetation, Built-up, Water, Wetland, and "other" land-cover
classes are now **explicitly routed** through either the IRC branch or a
named reason code **at any slope**, not only above 30% — the WAPCOS table
never covered these classes at any slope, so under the prior design they may
have fallen through without a traceable reason. Any genuinely missing
land-cover/soil/slope input is now tagged with reason 1/2/3 rather than
silently contributing to an unexplained gap.

## Area accounting

The script enforces, and prints for verification:

```
Valid_C_area + Unresolved_area ≈ 14.07 ha   (within raster tolerance)
```

and reports source totals (WAPCOS / IRC / Field override / Unresolved) that
must reconcile to the same total.

## Sensitivity analysis (source-category based, not ± percentages)

- **Scenario A — Primary:** best-supported classification per pixel (as
  described above).
- **Scenario B — Conservative (higher runoff):** rock/bare-ambiguous pixels
  (reason 5) are resolved to the higher documented bound, "Steep bare rock"
  (0.90); LOW-confidence vegetated/plateau proxies are shifted to their
  next-higher IRC category.
- **Scenario C — Lower runoff:** rock/bare-ambiguous pixels are resolved to
  the lower documented bound relevant to bare/sparse conditions, "Sandy soil
  with light growth" (0.20); LOW-confidence proxies shifted to their
  next-lower IRC category.

Every alternative value used in B/C already exists in the IRC table — no
arbitrary ±10% multiplier is applied anywhere.

## Quality-control flags

- **RED:** coverage < 90%, unexplained missing pixels, soil completely
  missing, or invalid classification.
- **AMBER:** coverage 90–95%, high proxy (LOW-confidence) dependence, no
  field validation performed.
- **GREEN:** coverage ≥ 95%, all sources traceable, unresolved pixels
  explicitly mapped, no major classification contradiction.

GREEN reflects coverage and traceability — **it is not a claim of 95%
numerical accuracy.**

## Field validation module

Optional field inputs (land cover, surface condition, soil texture, soil
depth, infiltration rate, HSG, expert-selected C) are available in the
script's UI panel. They **only** override the remote-sensing-derived C where
a user explicitly draws a geometry and submits a value (`C_SOURCE = 301`).
Nothing is auto-overwritten. If/when reference C observations become
available, MAE / RMSE / Bias / MAPE can be computed against them — no
accuracy is claimed in their absence.

## What this script deliberately does NOT do

- Does not use `unmask(0)`, `unmask(constant)`, or any catchment-mean
  fallback for missing pixels.
- Does not multiply or add NDVI/slope factors onto table C values.
- Does not extrapolate the WAPCOS table beyond 30% slope, and does not
  invent a `C = a + b·slope` relationship above 30%.
- Does not classify a pixel into a WAPCOS/IRC category from land cover or
  slope alone without corroborating surface-condition evidence.
- Does not report numerical accuracy without reference/field observations.

## Known limitations (read before treating outputs as final)

- **Rock vs. bare-soil disambiguation is a spectral/terrain proxy only.**
  No lithology or exposed-rock inventory layer is used, so this is
  explicitly the weakest link in the >30% branch — hence its LOW confidence
  rating and the deliberate UNRESOLVED outcome (reason 5) wherever the proxy
  itself is ambiguous.
- **Soil texture thresholds (35% clay, 70% sand)** are a standard simplified
  split, not a formal USDA texture-triangle classifier; documented here so
  they can be revisited with field pedon data.
- **Shrubland (WorldCover class 20)** is binned with Grassland/Pasture since
  the WAPCOS table has no separate shrubland row — a documented assumption,
  not a silent one.
- This script was authored and reviewed for logical/methodological
  correctness but has **not been executed inside the Earth Engine Code
  Editor** in this environment (no Earth Engine runtime/credentials
  available here). Run it in the GEE Code Editor and verify the Section
  4/5/6/13/14/15 console output reconciles to 14.07 ha before relying on the
  resulting Cw. If the catchment's actual UTM zone differs from EPSG:32643,
  update the `Export.image.toDrive` `crs` parameter accordingly.
