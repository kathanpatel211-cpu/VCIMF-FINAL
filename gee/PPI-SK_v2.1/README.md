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
