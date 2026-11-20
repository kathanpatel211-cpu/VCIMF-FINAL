# PPI-SK v2.1 — Google Earth Engine scripts (Khedbrahma Range)

Four scripts that implement the *PPI-SK v2.1 Plantation Priority Index* specification (17 Nov 2026).
They run entirely in the Earth Engine Code Editor. The only division input is the range asset
`projects/khedbrahma-range/assets/khedbrahma`.

**Easiest:** paste the single file `scripts/PPI_SK_v21_ALL_IN_ONE.js` into one Code Editor script and
press *Run* repeatedly. Each press detects which results already exist and runs the next step
(1 anchors → 2 range layers → 3 scoring → 4 maps/exports; 5 validation by setting `STEP = 5`).
After each press: *Tasks* tab → *RUN* every task → wait until they finish → press *Run* again.

The same model is also available as four separate scripts:

| Copy-paste this file | Spec steps | Runs | Produces |
| --- | --- | --- | --- |
| `scripts/00_state_anchors.js` | 1–2 (Module 0) | Once per state | Frozen Gujarat anchor table (asset + CSV) |
| `scripts/01_range_layers.js` | 3–17 | Once per range per data version | Raw block table checkpoint (asset), QC01, constraint map |
| `scripts/02_scoring.js` | 18–25 | Whenever weights/rules change | Final table, Monte Carlo, sensitivity, collinearity, `qc_log`, maps, SHP/GeoJSON, field-check list |
| `scripts/03_validation.js` | 26–27 (optional) | After 02 | V1/V2 validation report (Spearman ρ, AUC) |

`src/` holds the source. Scripts 00 and 01 contain an **identical** copy of the shared layer
library (`src/lib.js`), so the state anchors and the range scores are always built by the same code.
`bash build.sh` re-assembles `scripts/` and checks the syntax.

## How to run (Code Editor)

1. **00_state_anchors** → paste → *Run* → open the *Tasks* tab → *RUN* both tasks.
   The statewide percentile task is heavy (typically a few hours).
2. **01_range_layers** → paste → *Run*. The console prints the 22-dataset check (FF-01), the
   working CRS (`EPSG:32643`, FF-02), the mosaic scales (FF-03), the beat field and the block count.
   *Tasks* → *RUN* all 4 tasks.
   - Need a result before script 00 finishes? Set `ANCHOR_MODE: 'LIVE'` (provisional anchors at
     500 m; `qc_log` marks FF-09 as WARN). Re-run with `'ASSET'` for the final DPR numbers.
3. **02_scoring** with `STAGE: 'SCORE'` → *Run* → *RUN* all 7 tasks. The CV guard, Spearman/VIF
   screen and final weights print in the console. The Monte Carlo (K = 500, seed 2026) runs
   inside the export tasks.
4. **02_scoring** with `STAGE: 'PUBLISH'` (once `PPI02_final_to_asset` is done) → *Run*. The map
   shows the category, prescription, stability and theme layers with a legend, plus area-by-category
   and area-by-prescription summaries. *RUN* the 11 tasks for the GeoTIFFs, SHP, GeoJSON and the
   field-check list.
5. *(Optional)* **03_validation** → *Run* → *RUN* the report task.

All outputs go to the Drive folder `PPI_SK_v21`. All assets go to `projects/khedbrahma-range/assets/`.

## Other ranges / states (Section 16)

- **Another range:** in 01, 02 and 03 change `AOI_ASSET`, `RANGE_NAME`, `ID_PREFIX` and the asset
  names; set `EXPECTED_CRS: null` if the range is not in UTM 43N. Reuse the Gujarat anchors.
- **Another state:** in 00 change `STATE` and `ANCHOR_ID`; point `ANCHOR_ASSET` in 01 to the new table.

## If a QC check fails (Section 12)

| Check | Switch to change |
| --- | --- |
| FF-11 A3 phenology | 01: `A3_MASK_TREES: true` |
| FF-18 too few clear S2 scenes | 00 + 01: `CS_THRESHOLD: 0.50` |
| FF-19 too few Landsat years | 00 + 01: `D2_MONTHS: [9, 12]` |
| Memory error in an export | 01: `TILE_SCALE: 8` or `16`; 00: `SCALE_OVERRIDE: 100` |
| FF-12/13/14, FF-10 | Applied automatically in 02 and logged in `qc_log` / `cv_reweight_log` |

## Implementation choices to record in the DPR

1. **Heat load index:** folded aspect is `|180 − |aspect − 225||`, the published McCune & Keon (2002)
   form. The spec omits the outer absolute value. Without it, aspects between 0° and 45° would get a
   negative angle.
2. **VIF** is the diagonal of the inverse Pearson correlation matrix of the block scores, which is
   algebraically equal to 1/(1 − R²) from regressing each parameter on the other 22. A
   pseudo-inverse keeps it defined if two columns are exactly collinear.
3. **Anchor percentiles** are taken on the state-centroid UTM grid (43N for Gujarat) at each
   parameter's native resolution. Percentiles are insensitive to this choice.
4. **Excluded blocks** get `net_plantable_ha = 0`. `constraint_reason` lists a constraint when it
   covers ≥ 1 % of the block (`REASON_MIN_FRAC`).
5. **Raw-table CSV** (product 1) is exported in 02 from the checkpoint asset, so the heavy satellite
   processing in 01 runs only once.
6. **FF-18** uses the 5th percentile of the per-pixel minimum clear-scene count, so one cloudy
   pixel does not fail the range.
7. **FF-14:** pairs inside the same theme are merged automatically. Pairs across themes and
   VIF > 5 are logged as REVIEW, because merging across themes would change the theme totals.
8. **Field-check list (product 10)** follows Section 13.2. Separately, every Category 1–2 block carries
   `fra_rights_check_required = yes` (Section 2 rule).

## FRPIM v2.2 (Forest Restoration Priority and Intervention Model)

`scripts/FRPIM_v22_KHEDBRAHMA_RANGE.js` is the single-file, range-only implementation of the FRPIM v2.2
specification. Paste it into one Code Editor script and press *Run* twice:

1. **RUN 1** checks all 24 datasets (including D23 SoilGrids water content and D24 Landsat 5/7), computes
   local anchors (range + 20 km), builds the 10 ha blocks and every v2.2 layer, and creates the raw-table
   tasks. *Tasks* → *RUN ALL*.
2. **RUN 2** (after the tasks finish) scores Restoration Need (RNI, N1–N8) and Feasibility (RFI, F1–F14),
   applies the 3 × 3 matrix, phase, RPS, the 11 intervention rules, `smc_required`, the site class and the
   species group. It then runs the Monte Carlo (weights and thresholds), the one-at-a-time sensitivity, the
   collinearity screen per index, the RNI–RFI independence check, the v2.1 comparison and the decision
   summary, and shows the final map with a layer switcher and a click card.

Implementation notes for the DPR:
- Anchors are local (range + 20 km), not Gujarat-wide, so RNI and RFI are comparable within that
  landscape. FF-09 records this.
- Spearman ρ and VIF are computed in the Code Editor from one download of the block table (average
  ranks for ties; VIF = diagonal of the inverse correlation matrix). This is mathematically identical
  to the spec's `linearRegression` VIF.
- D6 / N8 reads the canopy-height data at its 4.8 m pyramid level and searches 5 km, to stay under Earth
  Engine's reprojection limit.
- FF-28: the ESA CCI biomass v7.0 asset path is checked on every run. Meta CHMv2 has no public GEE path
  yet, and the script says so.

### FRPIM v2.2 spec revision 1 (implemented)
- C8 removed. Flag **G5 `grassland_option`** (1/0) marks blocks that could also be developed as grassland;
  it never excludes a block or changes its class or intervention. FF-25 checks this.
- Degradation evidence (DE1–DE4) is a confidence score only. RNI is no longer halved when it is 0.
- New intervention `BLANK_AREA_PLANTATION` (canopy < 10 %). `smc_required` applies to interventions 6–11.
- Section 13.3: three separate maps, each its own Code Editor layer and GeoTIFF: Map 1 RNI (+ 1b class),
  Map 2 RFI (+ 2b class), Map 3 priority class (codes 1 LOW, 2 MODERATE, 3 HIGH, 4 PROTECTED, 5 EXCLUDED).
- A raw table saved before revision 1 is converted in RUN 2 (`excluded_c8` becomes `grassland_option`,
  and net area is restored), so RUN 1 does not need to be repeated.

### FRPIM v2.2 spec revision 2 (implemented)
- RNI and RFI each in **five classes** (1 Very Low ... 5 Very High). Breaks are `CLASS_METHOD` 'quantile'
  (default: exact nearest-rank 20/40/60/80th percentiles of the retained blocks, printed and stored per block
  as `rni_breaks`, `rfi_breaks`) or 'fixed' (0.2 steps).
- **5 x 5 phase matrix** (`PHASE`, editable) gives **Phase 1-5**; priority_class = PHASE_1..PHASE_5 / PROTECTED / EXCLUDED;
  RPS orders blocks within a phase; ANR rule 9 uses need class Very Low.
- Monte Carlo recomputes the quintile breaks in every draw (fixed method: breaks jittered +/- 0.05);
  outputs `stability_p12`, `phase_modal`, `phase_range`, `b1_sensitive`. OAT counts phase changes.
- Map codes 1-7 on all three maps (6 Protected, 7 Excluded): Map 1 / 1a (RNI 5-class / continuous),
  Map 2 / 2a (RFI), Map 3 (phase), each its own layer, legend (with hectares) and GeoTIFF.
- **Section 13.4 area statement**: blocks, gross ha and net plantable ha for every class on every map, the
  excluded area inside partly constrained blocks and the total; printed as a table and exported as CSV.
- QC FF-21 (quintile classes 15-25 %, no phase > 40 % or < 5 %) and FF-22 (stability_p12) updated.
