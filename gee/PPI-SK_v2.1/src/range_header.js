/* ######################################################################
 *  PPI-SK v2.1 — Plantation Priority Index — KHEDBRAHMA RANGE ONLY
 *  Google Earth Engine (Code Editor) — single file, range-only version
 *  ----------------------------------------------------------------------
 *  HOW TO USE
 *   RUN 1  Press Run. The script checks all datasets and computes the
 *          scoring scale for your range + 20 km landscape (1-3 min, in
 *          the background). Your range, its 10 ha blocks and every
 *          parameter score appear on the map. Then: Tasks tab ->
 *          RUN ALL -> wait until all tasks show a tick (about 30-60 min).
 *   RUN 2  Press Run again. The FINAL MAP appears straight away:
 *          priority category 1-5, treatment (prescription), theme maps,
 *          area summaries and legend. Tasks tab -> RUN ALL saves every
 *          table, map, shapefile and the field-check list to Drive.
 *   Press Run any time after that to see the final map again.
 *  Optional: set STEP = 'VALIDATE' for the validation report.
 *
 *  Scoring scale: anchors are the 2nd/98th percentiles of each parameter
 *  over tree/shrub/grass/bare land of the range + 20 km landscape. PPI is
 *  therefore comparable within this landscape. (For a state-wide
 *  comparable scale use the full PPI_SK_v21_ALL_IN_ONE.js with Gujarat
 *  anchors.)
 * ###################################################################### */

var STEP = 'AUTO';                 // 'AUTO', 'LAYERS', 'MAP' or 'VALIDATE'

var SETTINGS = {
  AOI_ASSET: 'projects/khedbrahma-range/assets/khedbrahma',
  RANGE_NAME: 'Khedbrahma',
  ID_PREFIX: 'KB_',
  CRS: 'EPSG:32643',               // UTM 43N (checked automatically against the range)
  BEAT_FIELD: 'AUTO',              // 'AUTO', an exact field name, or null (-> 'RANGE')
  ASSET_ROOT: 'projects/khedbrahma-range/assets/',
  DRIVE_FOLDER: 'PPI_SK_v21_Khedbrahma',

  LOCAL_BUFFER_KM: 20,             // anchor landscape = range + this buffer
  LOCAL_ANCHOR_SCALE: 100,         // m; set 250 if an anchor times out

  CS_THRESHOLD: 0.60,              // FF-18 remedy: 0.50
  D2_MONTHS: [9, 11],              // FF-19 remedy: [9, 12]
  A3_MASK_TREES: false,            // FF-11 remedy: true
  TILE_SCALE: 4,                   // a task fails with "memory" -> 16

  WEIGHTS: {
    A1: 10, A2: 3, A3: 9, A5: 4,
    B1: 5, B2: 4, B3: 3, B4: 2, B5: 2, B6: 4, B7: 4,
    C1s: 5, C2s: 5, C3s: 2,
    D1: 6, D2: 5, D3: 3, D4: 3, D5: 3, D6: 4,
    E1: 5, E2: 4, E4: 5
  },
  RX: {FIRE_E1: 0.55, SMC_A: 0.35, SMC_B: 0.35, INVASIVE_D5: 0.30}
};

var ASSETS = {
  RAW: SETTINGS.ASSET_ROOT + 'PPI_SK_v21_RANGE_raw_blocks_' + SETTINGS.RANGE_NAME,
  QC01: SETTINGS.ASSET_ROOT + 'PPI_SK_v21_RANGE_qc01_' + SETTINGS.RANGE_NAME,
  FINAL: SETTINGS.ASSET_ROOT + 'PPI_SK_v21_RANGE_final_blocks_' + SETTINGS.RANGE_NAME
};
var ANCHORS = {id: 'NOT_SET'};

