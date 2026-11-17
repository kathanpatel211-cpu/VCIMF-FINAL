/* ######################################################################
 *  PPI-SK v2.1 — Plantation Priority Index, Khedbrahma Range
 *  SCRIPT 00_state_anchors   (run ONCE per state; build steps 1-2)
 *  ----------------------------------------------------------------------
 *  What it does : builds every anchored parameter image over the whole
 *                 state, restricted to tree/shrub/grass/bare land
 *                 (WorldCover 10/20/30/60), takes the 2nd and 98th
 *                 percentile of each, and freezes them in a version-
 *                 tagged anchor table (CSV in Drive + table asset).
 *  How to run   : paste into the Code Editor -> Run -> Tasks tab ->
 *                 RUN both tasks. Batch time: typically a few hours.
 *  Next script  : 01_range_layers
 * ###################################################################### */

var CFG0 = {
  COUNTRY: 'India',
  STATE: 'Gujarat',                         // FAO GAUL ADM1_NAME
  ANCHOR_ID: 'GJ_2026-11_v2.1',             // new ID whenever anchors are recomputed
  ANCHOR_ASSET: 'projects/khedbrahma-range/assets/PPI_SK_v21_anchors_GJ',
  DRIVE_FOLDER: 'PPI_SK_v21',
  AOI_ASSET: 'projects/khedbrahma-range/assets/khedbrahma',   // shown on the map only
  RANGE_NAME: 'Khedbrahma',
  STATE_CRS: 'EPSG:32642',                 // UTM zone of the Gujarat centroid (42N); anchor grid only
  CS_THRESHOLD: 0.60,                       // Cloud Score+ cs_cdf; must equal script 01
  D2_MONTHS: [9, 11],                       // RESTREND NDVI window; must equal script 01
  SCALE_OVERRIDE: null,                     // null = native scale per parameter (spec).
                                            // e.g. 100 only if a task runs out of memory.
  _end: true
};

