/* ######################################################################
 *  PPI-SK v2.1 — Plantation Priority Index, Khedbrahma Range
 *  SCRIPT 01_range_layers   (build steps 3-17)
 *  ----------------------------------------------------------------------
 *  What it does : 10 ha block grid -> 23 parameters scored per pixel ->
 *                 block reduction -> constraints C1-C7, canopy track,
 *                 fire years, flags F1-F2, advisory access ->
 *                 RAW BLOCK TABLE checkpoint (table asset) + QC01 table
 *                 + constraint map GeoTIFF.
 *  How to run   : run script 00 first (or set ANCHOR_MODE = 'LIVE').
 *                 Paste -> Run -> Tasks tab -> RUN all tasks.
 *  Next script  : 02_scoring (once the RAW asset task has completed)
 * ###################################################################### */

var CFG = {
  AOI_ASSET: 'projects/khedbrahma-range/assets/khedbrahma',
  RANGE_NAME: 'Khedbrahma',
  ID_PREFIX: 'KB_',
  MODEL_VERSION: 'PPI-SK_v2.1',
  BLOCK_SIDE: 316.2278,          // m -> 10.00 ha
  MIN_BLOCK_HA: 2.0,             // drop slivers
  BEAT_FIELD: 'AUTO',            // 'AUTO' = detect a beat/compartment field; or exact name; or null -> 'RANGE'
  EXPECTED_CRS: 'EPSG:32643',    // FF-02 (Khedbrahma = UTM 43N). Set null for other ranges.

  // ---- anchors (Section 8) ----
  //  'ASSET'  : read the anchor table exported by script 00 (recommended)
  //  'FROZEN' : use the ANCHORS constant below (paste the paste_js column of the 00 CSV)
  //  'LIVE'   : compute provisional Gujarat anchors on the fly at LIVE_ANCHOR_SCALE
  //             (QC FF-09 = WARN; use only until script 00 has finished)
  ANCHOR_MODE: 'ASSET',
  ANCHOR_ASSET: 'projects/khedbrahma-range/assets/PPI_SK_v21_anchors_GJ',
  STATE_NAME: 'Gujarat',
  LIVE_ANCHOR_SCALE: 500,

  // ---- processing switches (must match script 00) ----
  CS_THRESHOLD: 0.60,            // FF-18 remedy: 0.50 (logged)
  D2_MONTHS: [9, 11],            // FF-19 remedy: [9, 12] (logged)
  A3_MASK_TREES: false,          // FF-11 remedy: true
  REASON_MIN_FRAC: 0.01,         // a constraint is listed in constraint_reason if >= 1 % of block
  TILE_SCALE: 4,                 // raise to 8 or 16 on a memory error

  // ---- outputs ----
  RAW_ASSET: 'projects/khedbrahma-range/assets/PPI_SK_v21_raw_blocks_Khedbrahma',
  QC01_ASSET: 'projects/khedbrahma-range/assets/PPI_SK_v21_qc01_Khedbrahma',
  DRIVE_FOLDER: 'PPI_SK_v21',
  SHOW_MAP: true
};

// Used only when ANCHOR_MODE = 'FROZEN'. Paste the line produced by script 00 here.
var ANCHORS = {id: 'NOT_SET'};

