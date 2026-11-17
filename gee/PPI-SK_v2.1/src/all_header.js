/* ######################################################################
 *  PPI-SK v2.1 — Plantation Priority Index, Khedbrahma Range
 *  ALL-IN-ONE Google Earth Engine script (Code Editor)
 *  ----------------------------------------------------------------------
 *  HOW TO USE — paste this whole file once, then just press RUN:
 *
 *    Press Run -> the script detects which results already exist and
 *    runs the NEXT step automatically. It prints "STEP n" in the Console.
 *    Then open the Tasks tab, click RUN on every task, and wait for the
 *    tasks to finish (blue -> done). Then press Run again.
 *
 *      STEP 1  State anchors (Gujarat)          -> once only, a few hours
 *      STEP 2  Range layers + raw block table   -> once per range
 *      STEP 3  Scoring, Monte Carlo, QC log     -> whenever weights change
 *      STEP 4  Final maps + legend on screen, GeoTIFF/SHP/field list
 *      STEP 5  Validation report (optional: set STEP = 5)
 *
 *  Do NOT press Run again while tasks of the current step are still
 *  running — wait until they are finished.
 *  To force a step (e.g. re-score after changing weights) set STEP below.
 * ###################################################################### */

var STEP = 'AUTO';                 // 'AUTO' or 1, 2, 3, 4, 5

var SETTINGS = {
  // ---- your range ----
  AOI_ASSET: 'projects/khedbrahma-range/assets/khedbrahma',
  RANGE_NAME: 'Khedbrahma',
  ID_PREFIX: 'KB_',
  CRS: 'EPSG:32643',               // UTM 43N for Khedbrahma (FF-02 checks it and tells you if wrong)
  STATE_CRS: 'EPSG:32642',         // anchor grid: UTM zone of the Gujarat centroid
  BEAT_FIELD: 'AUTO',              // 'AUTO', an exact field name, or null (-> 'RANGE')

  // ---- where results are saved ----
  ASSET_ROOT: 'projects/khedbrahma-range/assets/',
  DRIVE_FOLDER: 'PPI_SK_v21',

  // ---- state anchors ----
  COUNTRY: 'India',
  STATE: 'Gujarat',
  ANCHOR_ID: 'GJ_2026-11_v2.1',
  // 'ASSET' = use anchors from STEP 1 (final, recommended)
  // 'LIVE'  = skip STEP 1 and use provisional anchors at 500 m (quick demo; QC FF-09 = WARN)
  ANCHOR_MODE: 'ASSET',
  LIVE_ANCHOR_SCALE: 500,

  // ---- processing switches (QC remedies) ----
  CS_THRESHOLD: 0.60,              // FF-18 remedy: 0.50
  D2_MONTHS: [9, 11],              // FF-19 remedy: [9, 12]
  A3_MASK_TREES: false,            // FF-11 remedy: true
  TILE_SCALE: 4,                   // memory error -> 8 or 16

  // ---- weights (Section 7, total 100) ----
  WEIGHTS: {
    A1: 10, A2: 3, A3: 9, A5: 4,
    B1: 5, B2: 4, B3: 3, B4: 2, B5: 2, B6: 4, B7: 4,
    C1s: 5, C2s: 5, C3s: 2,
    D1: 6, D2: 5, D3: 3, D4: 3, D5: 3, D6: 4,
    E1: 5, E2: 4, E4: 5
  },
  RX: {FIRE_E1: 0.55, SMC_A: 0.35, SMC_B: 0.35, INVASIVE_D5: 0.30}
};

/* ---- asset names (derived; no need to edit) ---- */
var ASSETS = {
  ANCHORS: SETTINGS.ASSET_ROOT + 'PPI_SK_v21_anchors_' + SETTINGS.STATE.replace(/\W/g, ''),
  RAW: SETTINGS.ASSET_ROOT + 'PPI_SK_v21_raw_blocks_' + SETTINGS.RANGE_NAME,
  QC01: SETTINGS.ASSET_ROOT + 'PPI_SK_v21_qc01_' + SETTINGS.RANGE_NAME,
  FINAL: SETTINGS.ASSET_ROOT + 'PPI_SK_v21_final_blocks_' + SETTINGS.RANGE_NAME
};

// FROZEN-constant anchor mode is not needed in the all-in-one file (anchors are read from the asset).
var ANCHORS = {id: 'NOT_SET'};

