# Module 2 — Watershed Treatment & SMC Prioritisation

Sabarkantha District, Gujarat — Sabarmati Basin. Catchment Area Treatment
(CAT) objective: sediment control & reservoir protection for Hathmati,
Guhai, Harnav, Majum, Meshwo and Dharoi.

Full specification: [`docs/module2_spec.md`](docs/module2_spec.md). Code
comments cite section numbers from that document (e.g. "Part 0.2", "spec
W5") — read the relevant section before changing the logic it backs.

## Why this isn't a single script

The spec (Part 0.1) is explicit that a watershed treatment model scored at
the pixel level is methodologically wrong. This module runs in two tiers:

- **Tier 1** — micro-watershed (500–1000 ha) prioritisation: *which
  watersheds do we treat, and in what order?*
- **Tier 2** — pixel/stream-segment structure siting, run **only inside**
  watersheds Tier 1 selects: *within a prioritised watershed, which
  structure goes where?*

Ridge-to-valley sequencing (Zone 1 → 2 → 3) is a hard constraint on the
Tier 2 output ordering, not a weighted criterion (Part 0.2).

## Before you run anything

Google Earth Engine has no native flow direction, flow accumulation,
watershed delineation, or stream ordering (Part 2). This is a hard platform
limitation. The external preprocessing step is mandatory and comes first:

1. Run `external_preprocessing/whitebox_pipeline.py` (WhiteboxTools) against
   FABDEM (preferred) or Copernicus GLO-30 for the **full hydrological
   catchment** — not the Sabarkantha district boundary (Part 1.3). The
   catchments feeding Hathmati/Guhai/Harnav extend into Rajasthan.
2. Calibrate the stream-initiation threshold (`STREAM_THRESHOLD_CELLS`,
   starts at 1000 cells / 90 ha) until the median delineated micro-watershed
   falls in the 500–1000 ha band (Part 2.2). Do not accept the first run.
3. **Validate the derived stream network** against Survey of India
   toposheets and imagery in ≥5 sub-catchments spanning hill (Khedbrahma,
   Vijaynagar) and piedmont (Idar, Himatnagar) terrain. This is
   non-negotiable — if it fails, every morphometric parameter, Cluster C,
   and all of Tier 2 downstream is invalid (Part 2.2/2.3).
4. Upload every output listed at the end of `whitebox_pipeline.py` as GEE
   assets, and update the `EXTERNAL` object in
   `module2_watershed_treatment/02_external_assets.js` with the real asset
   IDs. Until you do, `main.js` will fail loudly at
   `assets.requireExternal(...)` calls — that failure is intentional, not a
   bug: it is the signal that step 1–3 has not been done.

## Repository layout

```
gee/
  README.md                          — this file
  docs/module2_spec.md                — full specification (source of truth)
  external_preprocessing/
    whitebox_pipeline.py              — Part 2: DEM conditioning, flow routing,
                                         stream/watershed delineation (outside GEE)
  module2_watershed_treatment/
    00_config.js                      — projection, weights, directions, policy
                                         parameters (single source of truth, Part 5)
    01_shared_layers.js               — Part 8.1 shared layers: DEM/slope, soil,
                                         RUSLE K/C/P, HAND, bare-rock/depth proxies.
                                         Module 1, when built, must import from here.
    02_external_assets.js             — every ✅/⚠️ catalog asset + the Part 2
                                         Whitebox-output placeholders, with a
                                         verify-with-fallback helper
    10_cluster_a_sediment_production.js  — W1 SYI · W2 RUSLE · W3 gully · W4 trend
    11_cluster_b_sediment_delivery.js    — W5 IC · W6 flow-path proximity ·
                                            W7 trapping + structure inventory
    12_cluster_c_runoff_morphometry.js   — W8 SCS-CN · W9 morphometry · W10 erosivity
    13_cluster_d_feasibility.js           — W11 treatable area · W12 siting ·
                                            W13 recharge co-benefit · W14 saturation
                                            + desilting-candidate override
    20_tier1_scoring.js                — Part 5 normalisation, weighted-sum and
                                          geometric-mean scoring, priority classes
    21_correlation_diagnostics.js      — Part 6 correlation matrix + double-count flags
    30_tier2_zonation.js               — Part 4.1 ridge-to-valley zone assignment
    31_tier2_structure_siting.js       — Part 4.2-4.4 structure decision matrix,
                                          spacing/quantity formulas, percolation-tank
                                          geophysical-survey flag
    32_tier2_water_balance.js          — Part 0.3/4.5 storage-ratio check
    40_convergence_map.js              — Part 8.3 Module 1 × Module 2 cross-tab
    50_exports.js                      — Part 9 exports (CSV/GeoJSON/GeoTIFF)
    main.js                            — orchestration entry point
```

## Importing into the GEE Code Editor

This repo can be linked as a read-only GEE script repository (Scripts panel
→ + → "Git Repository"). Once linked, `require()` paths look like:

```js
require('users/<your-gee-username>/<repo-alias>:gee/module2_watershed_treatment/00_config.js')
```

Every `require()` in this codebase uses the placeholder user `<you>` —
find-and-replace it with your actual GEE username/repo alias after linking.

## What this codebase deliberately refuses to do

Per spec Part 0.3/Part 10, several inputs cannot be responsibly filled in
from a coding session and are left as explicit, loud placeholders rather
than invented numbers:

- **W1 SYI weightage table** — not sourced from memory (spec: "a CAT plan
  carrying invented weightage values is worse than one carrying none"). SYI
  is excluded from the composite score until `config.POLICY.SYI_TABLE_SOURCE`
  is set to a real citation.
- **RUSLE R-factor regression coefficients**, **C-factor lookup table**,
  **SDR empirical coefficients** — flagged placeholders; wire in a cited
  regional relation before reporting absolute figures.
- **CGWB groundwater stress data** — W13 runs on recharge *capacity* only
  until the block-level Dynamic Groundwater Resource Assessment is joined in
  (a free download, Part 11 item 4).
- **Reservoir sedimentation survey calibration** (Part 7.1) — without it,
  every absolute sediment-yield number is a relative ranking only, and the
  code prints that limitation; it does not suppress it.

See Part 10 of the spec ("What this model must not claim") for the full
list — it must appear in the DPR verbatim, not just in code comments.
