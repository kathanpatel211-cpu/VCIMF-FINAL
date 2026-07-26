/**
 * MODULE 2 — Watershed Treatment & SMC Prioritisation
 * Sabarkantha District, Gujarat — Sabarmati Basin
 *
 * 00_config.js — single source of truth for projection, weights, directions
 * and policy parameters. Nothing downstream should hard-code a weight,
 * a direction, or a threshold outside this file (Part 5 / Part 9 discipline,
 * carried over from Module 1 Part 9 item 10).
 *
 * Import path (once this repo is linked as a GEE script repository):
 *   require('users/<you>/VCIMF-FINAL:gee/module2_watershed_treatment/00_config.js')
 */

// ---------------------------------------------------------------------------
// PART 1 — GLOBAL ANALYSIS PARAMETERS
// ---------------------------------------------------------------------------
var CRS = 'EPSG:32643';           // WGS84 / UTM 43N — mandatory, shared with Module 1
var SCALE = 30;                    // metres, matches DEM and Module 1
var TILE_SCALE = 8;                // for reduceRegions() over ~200-600 polygons

var TIER1_TARGET_AREA_HA = {min: 500, max: 1000};   // SLUSI micro-watershed convention
var STREAM_INITIATION_THRESHOLD_CELLS = 1000;        // starting point — Part 2.2, CALIBRATE, do not accept first run
var CELL_AREA_HA = (SCALE * SCALE) / 10000;          // 0.09 ha at 30 m

var STUDY_RESERVOIRS = ['Hathmati', 'Guhai', 'Harnav', 'Majum', 'Meshwo', 'Dharoi'];

// Jurisdiction boundary used only for reporting-stage flagging (Part 1.3):
// the full hydrological catchment is always analysed; this asset marks which
// micro-watersheds fall inside the implementing jurisdiction (Forest Dept
// beat boundary) and therefore inside the treatable-area accounting (W11).
// Verify with print() before use — see 02_external_assets.js.
var JURISDICTION_BOUNDARY_ASSET = 'projects/raygadh-range/assets/BEAT';

// ---------------------------------------------------------------------------
// POLICY PARAMETERS — these are NOT technical constants. Each must be
// confirmed against the CAT plan's own Terms of Reference / state technical
// manual before the model output is used in a DPR. Defaults below are
// conservative placeholders so the script runs end-to-end; treat every
// PLACEHOLDER-POLICY flag as an open item in Part 11.
// ---------------------------------------------------------------------------
var POLICY = {
  // 0.3 — cumulative proposed+existing storage as a fraction of mean annual
  // runoff volume, above which a sub-catchment is flagged as over-storing
  // relative to the reservoir it is meant to protect.
  STORAGE_RATIO_THRESHOLD: 0.30,          // PLACEHOLDER-POLICY — confirm against CAT plan ToR

  // W8 — SCS-CN initial abstraction ratio. 0.2 is the SCS standard; 0.3 is
  // also used in Indian practice. State explicitly (spec Part W8).
  SCS_CN_LAMBDA: 0.2,                      // DECLARED, not silent — run both if sensitivity matters
  SCS_CN_LAMBDA_ALT: 0.3,

  // W10 — standard erosive-event cutoff (mm/day). State the threshold used.
  EROSIVE_EVENT_THRESHOLD_MM: 12.7,

  // W4 — significance level for Mann-Kendall trend test.
  DEGRADATION_TREND_PVALUE: 0.05,

  // Monsoon window used throughout (rainfall concentration, NDVI peak season).
  MONSOON_MONTHS: [6, 7, 8, 9],
  PEAK_NDVI_MONTHS: [9, 10, 11],
  DRY_SEASON_MONTHS: [2, 3, 4, 5],          // for BSI / structure water-persistence detection

  // W1 SYI — until the official SLUSI/AIS&LUS weightage table is obtained,
  // SYI must run on a placeholder table and be EXCLUDED from the composite
  // score (spec W1: "a CAT plan carrying invented weightage values is worse
  // than one carrying none"). Flip this to false only after the real table
  // (with source cited below) replaces SYI_PLACEHOLDER_WEIGHTAGE.
  SYI_TABLE_IS_PLACEHOLDER: true,
  SYI_TABLE_SOURCE: null // e.g. 'SLUSI Watershed Atlas methodology doc, dated <>, obtained <>' — fill in once sourced
};

// ---------------------------------------------------------------------------
// PART 3 — WEIGHTING VECTOR (CAT / sediment-control objective)
// This vector is CONDITIONAL on the CAT objective (0.3, Part 3 rationale).
// If the objective changes (e.g. to groundwater recharge), re-derive this
// object — do not nudge individual numbers.
// ---------------------------------------------------------------------------
var CLUSTER_WEIGHTS = {
  A_sediment_production: 0.42,
  B_sediment_delivery: 0.22,
  C_runoff_morphometry: 0.18,
  D_feasibility_response: 0.18
};

var CRITERION_WEIGHTS = {
  W1_SYI: 0.16,
  W2_RUSLE: 0.12,
  W3_gully_severity: 0.08,
  W4_degradation_trend: 0.06,
  W5_connectivity_IC: 0.11,
  W6_flowpath_proximity: 0.07,
  W7_sediment_trapping: 0.04,
  W8_scs_cn_runoff: 0.07,
  W9_morphometry: 0.07,
  W10_erosivity: 0.04,
  W11_treatable_area: 0.06,
  W12_siting_feasibility: 0.05,
  W13_recharge_cobenefit: 0.04,
  W14_treatment_saturation: 0.03
};

// Sanity check — must total 1.00. Run once at script load.
(function checkWeights() {
  var total = 0;
  for (var k in CRITERION_WEIGHTS) { total += CRITERION_WEIGHTS[k]; }
  if (Math.abs(total - 1.0) > 1e-6) {
    print('⚠ WARNING: CRITERION_WEIGHTS sum to ' + total + ', expected 1.00');
  }
})();

// Direction of scoring — the ONLY place direction is declared (Part 5).
// +1 : higher raw value = higher priority
// -1 : lower raw value = higher priority (inverted before combining)
var CRITERION_DIRECTION = {
  W1_SYI: 1,
  W2_RUSLE: 1,
  W3_gully_severity: 1,
  W4_degradation_trend: 1,
  W5_connectivity_IC: 1,
  W6_flowpath_proximity: -1,   // distance — closer to reservoir = higher priority
  W7_sediment_trapping: -1,    // more intervening trapping = lower priority
  W8_scs_cn_runoff: 1,
  W9_morphometry: 1,           // AFTER Cp inversion (low Cp = high priority) is already applied upstream
  W10_erosivity: 1,
  W11_treatable_area: 1,
  W12_siting_feasibility: 1,
  W13_recharge_cobenefit: 1,
  W14_treatment_saturation: -1 // higher existing saturation = lower priority (subject to desilting override, W14 module)
};

// ---------------------------------------------------------------------------
// PART 4 — ZONATION (ridge-to-valley, Tier 2)
// ---------------------------------------------------------------------------
var ZONE_RULES = {
  ZONE1_RIDGE:  {streamOrderMax: 1, slopePctMin: 15, yearRange: '1-2'},
  ZONE2_GULLY:  {streamOrderMin: 2, streamOrderMax: 3, slopePctMin: 5, slopePctMax: 15, yearRange: '2-3'},
  ZONE3_VALLEY: {streamOrderMin: 3, streamOrderMax: 5, slopePctMax: 5, yearRange: '3-4'}
};

// ---------------------------------------------------------------------------
// EXPORTS
// ---------------------------------------------------------------------------
exports.CRS = CRS;
exports.SCALE = SCALE;
exports.TILE_SCALE = TILE_SCALE;
exports.TIER1_TARGET_AREA_HA = TIER1_TARGET_AREA_HA;
exports.STREAM_INITIATION_THRESHOLD_CELLS = STREAM_INITIATION_THRESHOLD_CELLS;
exports.CELL_AREA_HA = CELL_AREA_HA;
exports.STUDY_RESERVOIRS = STUDY_RESERVOIRS;
exports.JURISDICTION_BOUNDARY_ASSET = JURISDICTION_BOUNDARY_ASSET;
exports.POLICY = POLICY;
exports.CLUSTER_WEIGHTS = CLUSTER_WEIGHTS;
exports.CRITERION_WEIGHTS = CRITERION_WEIGHTS;
exports.CRITERION_DIRECTION = CRITERION_DIRECTION;
exports.ZONE_RULES = ZONE_RULES;
