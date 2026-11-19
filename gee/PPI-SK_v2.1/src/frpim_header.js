/* ######################################################################
 *  FRPIM v2.2 — Forest Restoration Priority and Intervention Model
 *  KHEDBRAHMA RANGE — single-file Google Earth Engine script
 *  ----------------------------------------------------------------------
 *  HOW TO USE
 *   RUN 1  Press Run. Checks all 24 datasets, computes the scoring scale
 *          for the range + 20 km landscape (2-4 min, background), builds
 *          the 10 ha blocks and every layer. Then: Tasks tab -> RUN ALL
 *          -> wait until all tasks show a tick (about 40-70 min).
 *   RUN 2  Press Run again. The FINAL MAP appears: restoration priority
 *          (HIGH / MODERATE / LOW / PROTECTED / EXCLUDED), intervention
 *          (11 types), need, feasibility, degradation evidence,
 *          reliability and change from v2.1. Click any block for details.
 *          Tasks tab -> RUN ALL saves every table, map and file to Drive.
 *   Press Run any time after that to see the final map again.
 *  Optional: STEP = 'VALIDATE' for the validation report (V1, V2).
 *
 *  Scoring scale: anchors are the percentiles of each parameter over
 *  tree/shrub/grass/bare land of the range + 20 km landscape, so RNI and
 *  RFI are comparable within this landscape. For Gujarat-wide comparison
 *  a state anchor table is needed (Section 8.1).
 * ###################################################################### */

var STEP = 'AUTO';                 // 'AUTO', 'LAYERS', 'MAP' or 'VALIDATE'

var SETTINGS = {
  AOI_ASSET: 'projects/khedbrahma-range/assets/khedbrahma',
  RANGE_NAME: 'Khedbrahma',
  ID_PREFIX: 'KB_',
  CRS: 'EPSG:32643',               // UTM 43N (checked automatically against the range)
  BEAT_FIELD: 'AUTO',              // 'AUTO', an exact field name, or null (-> 'RANGE')
  ASSET_ROOT: 'projects/khedbrahma-range/assets/',
  DRIVE_FOLDER: 'FRPIM_v22_Khedbrahma',

  LOCAL_BUFFER_KM: 20,             // anchor landscape = range + this buffer
  LOCAL_ANCHOR_SCALE: 100,         // m; set 250 if an anchor times out

  CS_THRESHOLD: 0.60,              // FF-18 remedy: 0.50
  D2_MONTHS: [9, 11],              // FF-19 remedy: [9, 12]
  A3_MASK_TREES: false,            // FF-11 remedy: true
  TILE_SCALE: 4,                   // a task fails with "memory" -> 16

  // Section 7 weights (points) and Section 10 thresholds
  W_N: {N1: 25, N2: 15, N3: 15, N4: 15, N5: 10, N6: 10, N7: 5, N8: 5},
  W_F: {F1: 15, F2: 10, F3: 5, F4: 5, F5: 12, F6: 7, F7: 6, F8: 6, F9: 4,
        F10: 8, F11: 7, F12: 3, F13: 7, F14: 5},
  TH: {needHi: 0.60, needLo: 0.35, feasHi: 0.55, feasLo: 0.35},
  MATRIX_HN_LF: 'MODERATE',        // high need + low feasibility cell; a DFO may set 'HIGH'
  RX: {FIRE_F13: 0.55, STAB_S: 0.45, INVASIVE_N7: 0.30, SMC_M: 0.35, SMC_RESP_M: 0.50}
};

var ASSETS = {
  RAW: SETTINGS.ASSET_ROOT + 'FRPIM_v22_raw_blocks_' + SETTINGS.RANGE_NAME,
  QC01: SETTINGS.ASSET_ROOT + 'FRPIM_v22_qc01_' + SETTINGS.RANGE_NAME,
  FINAL: SETTINGS.ASSET_ROOT + 'FRPIM_v22_final_blocks_' + SETTINGS.RANGE_NAME,
  V21: SETTINGS.ASSET_ROOT + 'PPI_SK_v21_RANGE_final_blocks_' + SETTINGS.RANGE_NAME   // for the comparison
};
var ANCHORS = {id: 'NOT_SET'};

