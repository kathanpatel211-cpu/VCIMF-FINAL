/**
 * Module 3 - Check-dam catchment runoff coefficient DSS (C-only + SCS-CN cross-check)
 * Google Earth Engine Code Editor (JavaScript)
 *
 * The user-supplied catchment is the complete upstream contributing area for
 * the proposed check-dam outlet. It is the only spatial analysis boundary in
 * this application.
 *
 * SCOPE NOTE: The hydraulic-path / time-of-concentration / Rational-Method
 * peak-discharge (Q) subsystem that was previously in this file has been
 * REMOVED. It traced the longest flow path over MERIT Hydro (~90 m) using
 * two 150-step iterative D8 neighborhood searches, and Earth Engine
 * consistently rejected the resulting expression graph with "Computation is
 * too complex" once the outlet/path stats were actually evaluated. That is
 * a hard platform limit on this iterative approach, not a fixable bug in the
 * graph itself, so it has been removed rather than patched again. This also
 * brings the script back in line with the original C-only development
 * phase: no peak discharge, rainfall intensity, time of concentration, IDF,
 * return period, or check-dam hydraulic design here. Those remain a later,
 * separate module (built with a non-iterative flow-path method, e.g. a
 * pre-conditioned/validated stream network or a bounded-step approach).
 *
 * IMPORTANT ENGINEERING LIMITATION
 * ---------------------------------
 * This application produces a GIS-derived preliminary/design-support runoff
 * coefficient. It is not a substitute for an approved local C table, IDF
 * analysis, hydrologic calibration, field survey, hydraulic design or DPR
 * review.
 *
 * Official Earth Engine catalog references used by this script:
 * - https://developers.google.com/earth-engine/datasets/catalog/COPERNICUS_DEM_GLO30_2024_1
 * - https://developers.google.com/earth-engine/datasets/catalog/USGS_SRTMGL1_003
 * - https://developers.google.com/earth-engine/datasets/catalog/ESA_WorldCover_v200
 * - https://developers.google.com/earth-engine/datasets/catalog/OpenLandMap_SOL_SOL_TEXTURE-CLASS_USDA-TT_M_v02
 */

// ==========================================================================
// 1. USER CONFIGURATION
// ==========================================================================

var CONFIG = {
  // This is the only user-specific spatial input required by the application.
  CATCHMENT_ASSET: 'projects/raygadh-range/assets/catchmentarea',
  CATCHMENT_ID: 'raygadh-range-catchmentarea',

  // DEM_SOURCE can be 'COPERNICUS' or 'SRTM'. Copernicus is a DSM; SRTM is
  // provided as a configurable alternative for terrain/slope sensitivity.
  DEM_SOURCE: 'COPERNICUS',
  COPERNICUS_DEM_ID: 'COPERNICUS/DEM/GLO30_2024_1',
  SRTM_DEM_ID: 'USGS/SRTMGL1_003',

  WORLD_COVER_ID: 'ESA/WorldCover/v200',
  SOIL_TEXTURE_ID: 'OpenLandMap/SOL/SOL_TEXTURE-CLASS_USDA-TT_M/v02',
  SOIL_TEXTURE_BAND: 'b0',
  SOIL_SAND_ID: 'OpenLandMap/SOL/SOL_SAND-WFRACTION_USDA-3A1A1A_M/v02',
  SOIL_CLAY_ID: 'OpenLandMap/SOL/SOL_CLAY-WFRACTION_USDA-3A1A1A_M/v02',
  SOIL_BULK_DENSITY_ID: 'OpenLandMap/SOL/SOL_BULKDENS-FINEEARTH_USDA-4A1H_M/v02',
  SOIL_WATER_ID: 'OpenLandMap/SOL/SOL_WATERCONTENT-33KPA_USDA-4B1C_M/v01',
  SOIL_PROPERTY_BAND: 'b0',
  S2_SR_ID: 'COPERNICUS/S2_SR_HARMONIZED',
  S2_START_DATE: '2021-01-01',
  S2_END_DATE: '2022-01-01',
  S2_MAX_CLOUD_PCT: 60,
  DYNAMIC_WORLD_ID: 'GOOGLE/DYNAMICWORLD/V1',
  DYNAMIC_WORLD_START_DATE: '2021-01-01',
  DYNAMIC_WORLD_END_DATE: '2022-01-01',
  S1_ID: 'COPERNICUS/S1_GRD',
  S1_START_DATE: '2021-01-01',
  S1_END_DATE: '2022-01-01',

  // Terrain-aware correction for WorldCover grassland pixels that are
  // actually exposed steep rock/bare slope. These are editable screening
  // thresholds, not a universal land-cover rule.
  BARE_ROCK_CORRECTION_ENABLED: true,
  BARE_ROCK_MIN_SLOPE_PCT: 15,
  BARE_ROCK_MAX_NDVI: 0.35,
  BARE_ROCK_MIN_BSI: -0.05,
  DYNAMIC_WORLD_MIN_BARE_PROBABILITY: 0.35,
  DYNAMIC_WORLD_BARE_MARGIN_OVER_GRASS: 0.05,
  // Optional local override for a field-confirmed exposed rock area. This is
  // false by default because steepness alone is not evidence of bare rock.
  FORCE_BARE_ROCK_ON_VERY_STEEP_GRASSLAND: false,
  VERY_STEEP_SLOPE_PCT: 45,
  // IRC steep-surface screening thresholds. These are evidence thresholds,
  // not calibrated land-cover classifiers.
  IRC_ROCK_MIN_BSI: 0.10,
  IRC_ROCK_MIN_BARE_PROBABILITY: 0.55,
  IRC_STRONG_VEGETATION_NDVI: 0.45,
  IRC_LIGHT_VEGETATION_NDVI: 0.20,
  IRC_STRONG_VEGETATION_EVI: 0.25,
  IRC_LIGHT_VEGETATION_EVI: 0.10,
  IRC_STRONG_TREE_PROBABILITY: 0.45,
  IRC_STRONG_GRASS_PROBABILITY: 0.45,
  IRC_LIGHT_VEGETATION_PROBABILITY: 0.25,
  IRC_PLATEAU_MIN_ELEVATION_FRACTION: 0.65,
  CHIRPS_ID: 'UCSB-CHG/CHIRPS/DAILY',
  CHIRPS_CONTEXT_START_YEAR: 2001,
  CHIRPS_CONTEXT_END_YEAR: 2020,

  // Optional user-supplied stream asset. Leave blank until a validated stream
  // layer is available. The script does not infer drainage from an unconditioned
  // DSM because that would create false precision.
  STREAM_ASSET: '',

  // Native/source-analysis scales. These are deliberately kept visible so the
  // output cannot be mistaken for a single-resolution observation.
  LULC_SCALE_M: 10,
  TERRAIN_SCALE_M: 30,
  SOIL_SCALE_M: 250,
  C_SCALE_M: 30,
  MAX_PIXELS: 1e13,

  // Slope thresholds are percent slope and are editable.
  SLOPE_BREAKS_PCT: [3, 8, 15, 30],

  // Field HSG override for the whole catchment. Use 'NONE' to use the
  // texture-derived proxy. This affects SCS-CN/diagnostics, not the primary
  // Indian Government land-cover/soil-texture/slope C table.
  FIELD_CONFIRMED_HSG: 'NONE',

  // The primary Indian Government/WAPCOS C table is land-cover + soil-texture
  // + slope based and does not publish an intensity-dependent C range.
  C_COMPLETE_COVERAGE_TARGET_PCT: 99.0,

  // Separate SCS-CN cross-check inputs. It is never mixed with Rational C.
  SCS_CN_STORM_DEPTH_MM: 170,
  SCS_CN_AMC: 'II',
  SCS_CN_INITIAL_ABSTRACTION_RATIO: 0.20,

  // Kept for the independent SCS-CN agriculture cross-check only.
  AGRICULTURE_COVER_KEY: 'ROW_CROP_POOR',

  // Optional expert overrides for primary cover codes 6=Water/Wetland and
  // 7=Other. Keep null until the team records value, source, reference and
  // reason. The QC gate will keep those pixels invalid.
  C_EXPERT_OVERRIDES: {
    6: {value: null, source: '', reference: '', reason: ''},
    7: {value: null, source: '', reference: '', reason: ''}
  },

  EXPORT_FOLDER: 'GEE_CheckDam_Catchment_Runoff_DSS',
  EXPORT_PREFIX: 'raygadh_catchment_runoff',

  QUALITY: {
    // A 250 m soil pixel covers about 6.25 ha. This warning threshold is four
    // nominal soil pixels, not a claim that four pixels make the soil estimate
    // reliable.
    SMALL_CATCHMENT_WARNING_HA: 25,
    COVERAGE_WARNING_PCT: 99.0
  }
};

// --------------------------------------------------------------------------
// Indian Government / WAPCOS runoff-coefficient guidance for the primary C
// --------------------------------------------------------------------------
//
// The primary table is the Indian Government/WAPCOS-style runoff-coefficient
// table supplied for this project. It uses land cover, soil texture and slope:
// 0-5%, 6-10% and 11-30%. It is not extrapolated above 30%.
// Official Government of India source link supplied with the project:
// https://mowr.nic.in/core/WebsiteUpload/2023/Guidelines-DecliningGWTable_1.pdf
//
// The source table contains Forest, Grass/Pasture and Cultivated/Agriculture
// rows for Sandy-loam, Loamy and Clay soils. The values below are preserved as
// supplied. The project engineer should confirm the exact adopted government
// edition/reference before final design.
//
// For surfaces not covered by the primary 0-30% table, the separate IRC
// surface categories are used only when the physical evidence matches:
// steep bare rock 0.90, steep rock with vegetation 0.80, bare stiff clay
// 0.60, loam lightly covered 0.40, sandy soil/light growth 0.20 and
// effectively impervious pavement 0.90. The exact numeric surface table was
// verified in an official NHAI DPR as IRC:SP-13 Table 3.4; confirm the adopted
// IRC edition for the final check-dam design:
// https://nhai.gov.in/nhai/sites/default/files/tender/OtherDocuments/18_Main_Report_uploaded_.pdf
//
// NDVI, BSI, Dynamic World and Sentinel-1 are evidence/validation layers. They
// do not numerically multiply C. HSG remains separate for SCS-CN and soil
// diagnostics; it is not used by this primary texture/slope C lookup.
var C_LOOKUP_SOURCE =
  'Primary: Indian Government/WAPCOS runoff-coefficient table supplied for this project, by vegetation/land cover, soil texture and slope; >30% and named surface categories: IRC:SP:13-2022 / IRC:SP:42-2014 guidance, cross-checked in an official NHAI DPR; confirm adopted government/IRC edition for final design';
var C_LOOKUP_NOTE =
  'Primary C is selected directly from the Indian Government/WAPCOS land-cover + soil-texture + slope table for 0-30% slope. No rainfall-intensity interpolation, HSG conversion or arbitrary >30% slope extrapolation is applied. IRC values are suggested surface coefficients selected only when the named surface condition is screened.';

var GOVERNMENT_C_TABLE = {
  FOREST: {
    label: 'Forest',
    values: {
      SANDY: [0.10, 0.25, 0.30],
      LOAMY: [0.30, 0.35, 0.50],
      CLAYEY: [0.40, 0.50, 0.60]
    }
  },
  GRASSLAND: {
    label: 'Grassland/pasture',
    values: {
      SANDY: [0.10, 0.16, 0.22],
      LOAMY: [0.30, 0.36, 0.42],
      CLAYEY: [0.40, 0.55, 0.60]
    }
  },
  AGRICULTURE: {
    label: 'Agriculture/cultivated',
    values: {
      SANDY: [0.30, 0.40, 0.52],
      LOAMY: [0.50, 0.60, 0.72],
      CLAYEY: [0.60, 0.70, 0.72]
    }
  }
};

var IRC_SP13_FIXED_C = {
  ROCK_STEEP_WOODED: 0.80,
  PLATEAU_LIGHT_COVER: 0.70,
  STEEP_BARE_ROCK: 0.90,
  CITY_PAVEMENT: 0.90,
  BARE_STIFF_CLAY: 0.60,
  STIFF_CLAY_VEGETATED: 0.50,
  LOAM_LIGHT_COVER: 0.40,
  LOAM_COVERED: 0.30,
  SANDY_LIGHT_GROWTH: 0.20,
  SANDY_WOODLAND: 0.10
};

// Separate SCS-CN cross-check. These values are from the Indian watershed
// guidance/NRCS-CN example categories (MANAGE) and the official CGWB manual's
// hydrologic soil-cover table. They do not replace or modify Rational C.
var SCS_CN_SOURCE =
  'Independent SCS-CN cross-check: MANAGE watershed guidance example and CGWB Manual on Artificial Recharge, Table 4.14 hydrologic soil-cover complexes; AMC II unless changed in configuration.';
var SCS_CN_TABLE = {
  WOODLAND_GOOD: [25, 55, 70, 77],
  PASTURE_GOOD: [39, 61, 74, 80],
  ROW_CROP_POOR: [72, 81, 88, 91],
  ROW_CROP_GOOD: [67, 78, 85, 89]
};

var LULC_CLASSES = [
  {code: 1, label: 'Forest', field: 'forest', color: '1b7837'},
  {code: 2, label: 'Shrub/Scrub', field: 'shrub_scrub', color: '762a83'},
  {code: 3, label: 'Grassland', field: 'grassland', color: 'a6d96a'},
  {code: 4, label: 'Agriculture', field: 'agriculture', color: 'fdae61'},
  {code: 5, label: 'Built-up', field: 'built_up', color: 'd7191c'},
  {code: 6, label: 'Bare/Rocky', field: 'bare_rocky', color: '969696'},
  {code: 7, label: 'Water/Wetland', field: 'water_wetland', color: '2c7bb6'},
  {code: 8, label: 'Other', field: 'other', color: 'ffffbf'}
];

// Supporting surface-condition evidence categories. These are not the
// primary C lookup classes and are not numerically combined with C.
var C_COVER_CLASSES = [
  {code: 1, label: 'Woodland - good', field: 'woodland_good', color: '1b7837'},
  {code: 2, label: 'Steep rock - wooded', field: 'rock_steep_wooded', color: '4d9221'},
  {code: 3, label: 'Plateau/light cover', field: 'plateau_light_cover', color: 'a6d96a'},
  {code: 4, label: 'Pasture - good', field: 'pasture_good', color: '66bd63'},
  {code: 5, label: 'Agriculture - configured practice', field: 'agriculture', color: 'fdae61'},
  {code: 6, label: 'Steep bare rock', field: 'steep_bare_rock', color: 'd73027'},
  {code: 7, label: 'Bare stiff clay', field: 'bare_stiff_clay', color: 'b2182b'},
  {code: 8, label: 'Loam, lightly covered', field: 'loam_light_cover', color: 'ef8a62'},
  {code: 9, label: 'Sandy soil/light growth', field: 'sandy_light_growth', color: '67a9cf'},
  {code: 10, label: 'Built-up/impervious', field: 'built_up', color: '762a83'},
  {code: 11, label: 'Water/Wetland - unassigned', field: 'water_wetland', color: '2c7bb6'},
  {code: 12, label: 'Other - unassigned', field: 'other', color: 'ffffbf'}
];

// IRC:SP:13/IRC:SP:42 suggested surface-condition categories used only for
// the >30% branch or for named non-table surfaces. They are not a new slope
// extrapolation curve.
var IRC_SURFACE_CLASSES = [
  {code: 1, label: 'Steep bare rock / watertight surface', field: 'steep_bare_rock', color: 'd73027', c: 0.90},
  {code: 2, label: 'Steep rock with vegetation', field: 'steep_rock_vegetated', color: 'a50026', c: 0.80},
  {code: 3, label: 'Plateau/light vegetative cover', field: 'plateau_light_cover', color: 'fdae61', c: 0.70},
  {code: 4, label: 'Bare stiff clayey/impervious soil', field: 'bare_stiff_clay', color: 'b2182b', c: 0.60},
  {code: 5, label: 'Stiff clayey soil with vegetation', field: 'stiff_clay_vegetated', color: 'ef8a62', c: 0.50},
  {code: 6, label: 'Loam lightly covered', field: 'loam_light_cover', color: 'fddbc7', c: 0.40},
  {code: 7, label: 'Loam largely covered/turfed', field: 'loam_covered', color: '91cf60', c: 0.30},
  {code: 8, label: 'Sandy soil with light growth', field: 'sandy_light_growth', color: '67a9cf', c: 0.20},
  {code: 9, label: 'Sandy soil with heavy bush/woodland/forest', field: 'sandy_woodland', color: '2166ac', c: 0.10},
  {code: 10, label: 'Effectively impervious pavement/built-up', field: 'impervious', color: '762a83', c: 0.90}
];

var C_SOURCE_CLASSES = [
  {code: 999, label: 'Unresolved / no source-backed C', field: 'unresolved', color: 'd73027'},
  {code: 101, label: 'Indian Government/WAPCOS 0-30% table', field: 'government_wapcos', color: '1a9850'},
  {code: 201, label: 'IRC steep bare rock', field: 'irc_steep_bare_rock', color: 'd73027'},
  {code: 202, label: 'IRC steep rock with vegetation', field: 'irc_steep_rock_vegetated', color: 'a50026'},
  {code: 203, label: 'IRC plateau/light cover', field: 'irc_plateau_light_cover', color: 'fdae61'},
  {code: 204, label: 'IRC bare stiff clay', field: 'irc_bare_stiff_clay', color: 'b2182b'},
  {code: 205, label: 'IRC stiff clay with vegetation', field: 'irc_stiff_clay_vegetated', color: 'ef8a62'},
  {code: 206, label: 'IRC loam lightly covered', field: 'irc_loam_light_cover', color: 'fddbc7'},
  {code: 207, label: 'IRC loam largely covered/turfed', field: 'irc_loam_covered', color: '91cf60'},
  {code: 208, label: 'IRC sandy light growth', field: 'irc_sandy_light_growth', color: '67a9cf'},
  {code: 209, label: 'IRC sandy woodland/forest', field: 'irc_sandy_woodland', color: '2166ac'},
  {code: 210, label: 'IRC impervious surface', field: 'irc_impervious', color: '762a83'},
  {code: 301, label: 'Approved expert/field override', field: 'expert_override', color: '000000'}
];

var C_CONFIDENCE_CLASSES = [
  {code: 0, label: 'Unresolved', field: 'unresolved', color: 'd73027'},
  {code: 1, label: 'Low / proxy classification', field: 'low_proxy', color: 'fdae61'},
  {code: 2, label: 'Moderate / source-backed screening', field: 'moderate', color: '91cf60'},
  {code: 3, label: 'High / field or strong evidence', field: 'high', color: '1a9850'}
];

var C_REASON_CLASSES = [
  {code: 1, label: 'Missing land cover', field: 'missing_land_cover', color: '542788'},
  {code: 2, label: 'Missing soil', field: 'missing_soil', color: 'fc8d59'},
  {code: 3, label: 'Missing slope/terrain', field: 'missing_slope', color: '91cf60'},
  {code: 4, label: '>30% surface unresolved', field: 'gt30_surface_unresolved', color: 'fee08b'},
  {code: 5, label: 'Bare/rock ambiguity', field: 'bare_rock_ambiguity', color: 'f46d43'},
  {code: 6, label: 'Water/wetland', field: 'water_wetland', color: '2c7bb6'},
  {code: 7, label: 'Other land cover', field: 'other_land_cover', color: 'ffffbf'},
  {code: 8, label: 'Projection/mask issue', field: 'projection_mask_issue', color: '984ea3'},
  {code: 9, label: 'Other technical reason', field: 'other_technical', color: 'd73027'}
];

// Primary C classes for the Indian Government/WAPCOS table. Shrub/scrub is
// grouped with grassland/pasture as a transparent proxy because the supplied
// table has no separate shrub row. Water/Wetland and Other remain unresolved
// unless the team supplies a documented expert override.
var PRIMARY_COVER_CLASSES = [
  {code: 1, label: 'Forest', field: 'forest', color: '1b7837'},
  {code: 2, label: 'Grassland/shrub (pasture proxy)', field: 'grassland_shrub', color: 'a6d96a'},
  {code: 3, label: 'Agriculture/cultivated', field: 'agriculture', color: 'fdae61'},
  {code: 4, label: 'Bare/Rocky', field: 'bare_rocky', color: '969696'},
  {code: 5, label: 'Built-up/impervious', field: 'built_up', color: 'd7191c'},
  {code: 6, label: 'Water/Wetland', field: 'water_wetland', color: '2c7bb6'},
  {code: 7, label: 'Other', field: 'other', color: 'ffffbf'}
];

var PRIMARY_COVER_RULES = {
  1: {tableKey: 'FOREST', note: 'Indian Government/WAPCOS forest row.'},
  2: {tableKey: 'GRASSLAND', note: 'Grassland/pasture row; shrub/scrub is a documented proxy.'},
  3: {tableKey: 'AGRICULTURE', note: 'Indian Government/WAPCOS cultivated/agriculture row.'},
  4: {tableKey: null, note: 'IRC surface categories are used only when bare/rock evidence matches.'},
  5: {tableKey: null, note: 'IRC effectively impervious/city pavement value.'},
  6: {tableKey: null, note: 'Water/Wetland requires a project-specific treatment or expert override.'},
  7: {tableKey: null, note: 'Other requires an approved project-specific mapping or expert override.'}
};

var C_SOIL_TEXTURE_CLASSES = [
  {code: 1, key: 'SANDY', label: 'Sandy / high infiltration', field: 'sandy', color: '67a9cf'},
  {code: 2, key: 'LOAMY', label: 'Loamy / moderate infiltration', field: 'loamy', color: 'fdae61'},
  {code: 3, key: 'CLAYEY', label: 'Clayey / low infiltration', field: 'clayey', color: 'd73027'}
];

var C_SLOPE_CLASSES = [
  {code: 1, label: '0-5%', field: 'c_slope_0_5', color: '1a9850'},
  {code: 2, label: '6-10%', field: 'c_slope_6_10', color: '91cf60'},
  {code: 3, label: '11-30%', field: 'c_slope_11_30', color: 'fee08b'},
  {code: 4, label: '>30% - IRC surface branch', field: 'c_slope_gt_30', color: 'd73027'}
];

var SOIL_TEXTURE_CLASSES = [
  {code: 1, label: 'Clay', response: 1, hsg: 'D'},
  {code: 2, label: 'Silty clay', response: 1, hsg: 'D'},
  {code: 3, label: 'Sandy clay', response: 1, hsg: 'D'},
  {code: 4, label: 'Clay loam', response: 1, hsg: 'C'},
  {code: 5, label: 'Silty clay loam', response: 1, hsg: 'C'},
  {code: 6, label: 'Sandy clay loam', response: 2, hsg: 'C'},
  {code: 7, label: 'Loam', response: 2, hsg: 'B'},
  {code: 8, label: 'Silt loam', response: 2, hsg: 'B'},
  {code: 9, label: 'Sandy loam', response: 3, hsg: 'B'},
  {code: 10, label: 'Silt', response: 1, hsg: 'C'},
  {code: 11, label: 'Loamy sand', response: 3, hsg: 'A'},
  {code: 12, label: 'Sand', response: 3, hsg: 'A'}
];

var SOIL_RESPONSE_CLASSES = [
  {code: 1, label: 'Low infiltration proxy', field: 'low_infiltration', color: 'b2182b'},
  {code: 2, label: 'Moderate infiltration proxy', field: 'moderate_infiltration', color: 'fddbc7'},
  {code: 3, label: 'High infiltration proxy', field: 'high_infiltration', color: '2166ac'}
];

var SOIL_HSG_CLASSES = [
  {code: 1, group: 'A', label: 'HSG A (texture proxy)', field: 'hsg_a', color: '2166ac'},
  {code: 2, group: 'B', label: 'HSG B (texture proxy)', field: 'hsg_b', color: '67a9cf'},
  {code: 3, group: 'C', label: 'HSG C (texture proxy)', field: 'hsg_c', color: 'fdae61'},
  {code: 4, group: 'D', label: 'HSG D (texture proxy)', field: 'hsg_d', color: 'd7191c'}
];

var SLOPE_CLASSES = [
  {code: 1, label: '0-3%', field: 'slope_0_3', color: '1a9850'},
  {code: 2, label: '3-8%', field: 'slope_3_8', color: '91cf60'},
  {code: 3, label: '8-15%', field: 'slope_8_15', color: 'd9ef8b'},
  {code: 4, label: '15-30%', field: 'slope_15_30', color: 'fee08b'},
  {code: 5, label: '>30%', field: 'slope_gt_30', color: 'd73027'}
];

var C_CLASSES = [
  {code: 1, label: 'C < 0.20', field: 'c_lt_020', color: '2c7bb6'},
  {code: 2, label: '0.20-0.30', field: 'c_020_030', color: 'abd9e9'},
  {code: 3, label: '0.30-0.40', field: 'c_030_040', color: 'ffffbf'},
  {code: 4, label: '0.40-0.50', field: 'c_040_050', color: 'fdae61'},
  {code: 5, label: '0.50-0.60', field: 'c_050_060', color: 'f46d43'},
  {code: 6, label: 'C > 0.60', field: 'c_gt_060', color: 'd7191c'}
];

// ==========================================================================
// 2. HELPERS
// ==========================================================================

function dictionaryNumber(dictionary, key, fallback) {
  var d = ee.Dictionary(dictionary);
  // reduceRegion() over a fully-masked image returns the key present but set
  // to null, not omitted, so d.contains(key) alone can't be trusted. Guard
  // against both "key missing" and "key present but null" in one pass.
  var rawValue = ee.Algorithms.If(d.contains(key), d.get(key), null);
  return ee.Number(ee.Algorithms.If(rawValue, rawValue, fallback));
}

function clampC(value) {
  return Math.max(0, Math.min(1, value));
}

function hasExpertOverride(coverCode) {
  var override = CONFIG.C_EXPERT_OVERRIDES[coverCode];
  return override && typeof override.value === 'number' &&
    override.value >= 0 && override.value <= 1 &&
    override.source !== '' && override.reference !== '' &&
    override.reason !== '';
}

function validateExpertOverrides() {
  var problems = [];
  Object.keys(CONFIG.C_EXPERT_OVERRIDES).forEach(function(key) {
    var override = CONFIG.C_EXPERT_OVERRIDES[key];
    if (override.value !== null && !hasExpertOverride(Number(key))) {
      problems.push('Override for cover code ' + key +
        ' must contain value 0-1, source, reference and reason.');
    }
  });
  return problems;
}

var expertOverrideProblems = validateExpertOverrides();

function governmentC(coverKey, soilKey, slopeCode) {
  var table = GOVERNMENT_C_TABLE[coverKey];
  if (!table || !table.values[soilKey] || slopeCode < 1 || slopeCode > 3) {
    return null;
  }
  return clampC(table.values[soilKey][slopeCode - 1]);
}

function makeLookupRows() {
  var rows = [];
  [1, 2, 3].forEach(function(coverCode) {
    var cover = PRIMARY_COVER_CLASSES[coverCode - 1];
    var coverRule = PRIMARY_COVER_RULES[coverCode];
    [1, 2, 3].forEach(function(soilCode) {
      var soil = C_SOIL_TEXTURE_CLASSES[soilCode - 1];
      [1, 2, 3].forEach(function(slopeCode) {
        var slope = C_SLOPE_CLASSES[slopeCode - 1];
        rows.push({
          cover_code: coverCode,
          cover_label: cover.label,
          soil_texture_code: String(soilCode),
          soil_texture: soil.label,
          slope_class_code: String(slopeCode),
          slope_class: slope.label,
        c_value: governmentC(coverRule.tableKey, soil.key, slopeCode),
        c_value_status: 'published Indian Government/WAPCOS table value',
        source_code: 101,
        source_label: 'Indian Government/WAPCOS 0-30% table',
        source: C_LOOKUP_SOURCE,
          source_reference: 'https://mowr.nic.in/core/WebsiteUpload/2023/Guidelines-DecliningGWTable_1.pdf',
          source_mapping: coverRule.note,
          notes: C_LOOKUP_NOTE
        });
      });
    });
  });

  var bareSurfaceBySoil = {
    SANDY: IRC_SP13_FIXED_C.SANDY_LIGHT_GROWTH,
    LOAMY: IRC_SP13_FIXED_C.LOAM_LIGHT_COVER,
    CLAYEY: IRC_SP13_FIXED_C.BARE_STIFF_CLAY
  };
  C_SOIL_TEXTURE_CLASSES.forEach(function(soil) {
    rows.push({
      cover_code: 4,
      cover_label: 'Bare/Rocky, non-steep surface proxy',
      soil_texture_code: soil.code,
      soil_texture: soil.label,
      slope_class_code: '1-3',
      slope_class: '0-30%',
      c_value: bareSurfaceBySoil[soil.key],
      c_value_status: 'IRC named surface category applied by soil-texture proxy',
      source_code: soil.key === 'SANDY' ? 208 : soil.key === 'LOAMY' ? 206 : 204,
      source_label: soil.key === 'SANDY' ? 'IRC sandy light growth' :
        soil.key === 'LOAMY' ? 'IRC loam lightly covered' :
          'IRC bare stiff clay',
      source: C_LOOKUP_SOURCE,
      source_reference: 'https://nhai.gov.in/nhai/sites/default/files/tender/OtherDocuments/18_Main_Report_uploaded_.pdf',
      source_mapping: 'Sandy/light growth, loam/light cover or bare stiff clay category; review imagery and field condition.',
      notes: C_LOOKUP_NOTE
    });
  });
  rows.push({
    cover_code: 4,
    cover_label: 'Steep bare rock',
    soil_texture_code: 'all',
    soil_texture: 'not required for named surface',
    slope_class_code: 4,
    slope_class: '>30%',
    c_value: IRC_SP13_FIXED_C.STEEP_BARE_ROCK,
    c_value_status: 'IRC named steep-surface value',
    source_code: 201,
    source_label: 'IRC steep bare rock',
    source: C_LOOKUP_SOURCE,
    source_reference: 'https://nhai.gov.in/nhai/sites/default/files/tender/OtherDocuments/18_Main_Report_uploaded_.pdf',
    source_mapping: 'Applied only when steep bare-rock evidence is present.',
    notes: C_LOOKUP_NOTE
  });
  rows.push({
    cover_code: 4,
    cover_label: 'Steep rock with vegetation',
    soil_texture_code: 'all',
    soil_texture: 'not required for named surface',
    slope_class_code: 4,
    slope_class: '>30%',
    c_value: IRC_SP13_FIXED_C.ROCK_STEEP_WOODED,
    c_value_status: 'IRC named steep-surface value',
    source_code: 202,
    source_label: 'IRC steep rock with vegetation',
    source: C_LOOKUP_SOURCE,
    source_reference: 'https://nhai.gov.in/nhai/sites/default/files/tender/OtherDocuments/18_Main_Report_uploaded_.pdf',
    source_mapping: 'Applied only when steep rock has substantial vegetation evidence.',
    notes: C_LOOKUP_NOTE
  });
  [
    {code: 3, label: 'Plateau/light vegetative cover', value: IRC_SP13_FIXED_C.PLATEAU_LIGHT_COVER},
    {code: 4, label: 'Bare stiff clayey/impervious soil', value: IRC_SP13_FIXED_C.BARE_STIFF_CLAY},
    {code: 5, label: 'Stiff clayey soil with vegetative cover', value: IRC_SP13_FIXED_C.STIFF_CLAY_VEGETATED},
    {code: 6, label: 'Loam lightly cultivated/covered', value: IRC_SP13_FIXED_C.LOAM_LIGHT_COVER},
    {code: 7, label: 'Loam largely cultivated/turfed', value: IRC_SP13_FIXED_C.LOAM_COVERED},
    {code: 8, label: 'Sandy soil with light growth', value: IRC_SP13_FIXED_C.SANDY_LIGHT_GROWTH},
    {code: 9, label: 'Sandy soil with heavy bush/woodland/forest', value: IRC_SP13_FIXED_C.SANDY_WOODLAND}
  ].forEach(function(surface) {
    rows.push({
      cover_code: 4,
      cover_label: surface.label,
      soil_texture_code: 'condition-dependent',
      soil_texture: 'see IRC surface rule',
      slope_class_code: 4,
      slope_class: '>30%',
      c_value: surface.value,
      c_value_status: 'IRC suggested surface-condition value',
      source_code: 200 + surface.code,
      source_label: IRC_SURFACE_CLASSES[surface.code - 1].label,
      source: C_LOOKUP_SOURCE,
      source_reference: 'https://nhai.gov.in/nhai/sites/default/files/tender/OtherDocuments/18_Main_Report_uploaded_.pdf',
      source_mapping: 'Applied only when the remotely sensed/field surface condition matches this named category; slope alone is insufficient.',
      notes: 'Suggested IRC value, not a measured catchment-specific coefficient.'
    });
  });
  rows.push({
    cover_code: 5,
    cover_label: 'Built-up/impervious',
    soil_texture_code: 'all',
    soil_texture: 'not required for impervious surface',
    slope_class_code: 'all',
    slope_class: 'all',
    c_value: IRC_SP13_FIXED_C.CITY_PAVEMENT,
    c_value_status: 'IRC named impervious-surface value',
    source_code: 210,
    source_label: 'IRC impervious surface',
    source: C_LOOKUP_SOURCE,
    source_reference: 'https://nhai.gov.in/nhai/sites/default/files/tender/OtherDocuments/18_Main_Report_uploaded_.pdf',
    source_mapping: 'Applied only to effectively impervious mapped built-up pixels.',
    notes: C_LOOKUP_NOTE
  });
  [6, 7].forEach(function(coverCode) {
    if (!hasExpertOverride(coverCode)) return;
    var cover = PRIMARY_COVER_CLASSES[coverCode - 1];
    var override = CONFIG.C_EXPERT_OVERRIDES[coverCode];
    rows.push({
      cover_code: coverCode,
      cover_label: cover.label,
      soil_texture_code: 'all',
      soil_texture: 'user-defined',
      slope_class_code: 'all',
      slope_class: 'all',
      c_value: clampC(override.value),
      c_value_status: 'expert/user override',
      source_code: 301,
      source_label: 'Approved expert override',
      source: override.source,
      source_mapping: override.reason,
      source_reference: override.reference,
      notes: 'Override is not part of the Government/WAPCOS table and requires project approval.'
    });
  });
  return rows;
}

var C_LOOKUP_ROWS = makeLookupRows();

function validateLookupRows() {
  var problems = [];
  C_LOOKUP_ROWS.forEach(function(row) {
    if (row.c_value === null || row.c_value === undefined) {
      problems.push(row.cover_label + ' / ' + row.soil_texture +
        ' has no configured source value');
    } else if (row.c_value < 0 || row.c_value > 1) {
      problems.push(row.cover_label + ' / ' + row.soil_texture +
        ' has C outside 0-1');
    }
  });
  return problems;
}

function calculateAreaTable(classImage, classDefinitions, scale, tableName) {
  var pixelArea = ee.Image.pixelArea().rename('area_m2');
  var features = classDefinitions.map(function(definition) {
    var areaDictionary = pixelArea
      .updateMask(classImage.eq(definition.code))
      .reduceRegion({
        reducer: ee.Reducer.sum(),
        geometry: catchmentGeometry,
        scale: scale,
        maxPixels: CONFIG.MAX_PIXELS,
        bestEffort: true,
        tileScale: 4
      });
    var classAreaM2 = dictionaryNumber(areaDictionary, 'area_m2', 0);
    return ee.Feature(null, {
      table: tableName,
      code: definition.code,
      label: definition.label,
      field: definition.field || ('class_' + definition.code),
      area_m2: classAreaM2,
      area_ha: classAreaM2.divide(10000),
      percent: classAreaM2.divide(areaM2.max(1)).multiply(100)
    });
  });
  return ee.FeatureCollection(features);
}

function tableValue(table, code, property) {
  var matching = table.filter(ee.Filter.eq('code', code));
  return ee.Number(ee.Algorithms.If(
    matching.size().gt(0),
    matching.first().get(property),
    0
  ));
}

function reduceStat(image, reducer, bandName, scale, fallback) {
  var dictionary = image.reduceRegion({
    reducer: reducer,
    geometry: catchmentGeometry,
    scale: scale,
    maxPixels: CONFIG.MAX_PIXELS,
    bestEffort: true,
    tileScale: 4
  });
  return dictionaryNumber(dictionary, bandName, fallback);
}

function makeMeanAnnualRainfallContext(chirps, startYear, endYear) {
  var years = ee.List.sequence(startYear, endYear);
  var annualImages = years.map(function(year) {
    year = ee.Number(year);
    var start = ee.Date.fromYMD(year, 1, 1);
    var end = start.advance(1, 'year');
    return chirps.filterDate(start, end).sum()
      .rename('annual_rainfall_mm')
      .set('year', year);
  });
  return ee.ImageCollection.fromImages(annualImages)
    .mean()
    .rename('mean_annual_rainfall_mm')
    .clip(catchmentGeometry);
}

function maskSentinel2(image) {
  var scl = image.select('SCL');
  var clear = scl.neq(1)  // saturated or defective
    .and(scl.neq(3))      // cloud shadow
    .and(scl.neq(7))      // low probability cloud / unclassified
    .and(scl.neq(8))      // medium probability cloud
    .and(scl.neq(9))      // high probability cloud
    .and(scl.neq(10))     // cirrus
    .and(scl.neq(11));    // snow/ice
  return image.updateMask(clear).divide(10000);
}

function calculateWeightedC(cImage) {
  var validAreaImage = ee.Image.pixelArea()
    .rename('valid_area_m2')
    .updateMask(cImage.mask());
  var weightedAreaImage = cImage.multiply(validAreaImage).rename('c_area_m2');
  var numerator = reduceStat(weightedAreaImage, ee.Reducer.sum(), 'c_area_m2',
    CONFIG.C_SCALE_M, 0);
  var denominator = reduceStat(validAreaImage, ee.Reducer.sum(), 'valid_area_m2',
    CONFIG.C_SCALE_M, 0);
  return numerator.divide(denominator.max(1));
}

function makeCNImage(coverCondition, soilHsg) {
  var cn = ee.Image(0).rename('CN');
  var assigned = ee.Image(0).byte().rename('cn_assigned');
  var sourceByCover = {
    1: 'WOODLAND_GOOD',
    4: 'PASTURE_GOOD',
    5: CONFIG.AGRICULTURE_COVER_KEY
  };
  [1, 4, 5].forEach(function(coverCode) {
    var sourceKey = sourceByCover[coverCode];
    var values = SCS_CN_TABLE[sourceKey];
    if (!values) return;
    [1, 2, 3, 4].forEach(function(hsgCode) {
      var condition = coverCondition.eq(coverCode)
        .and(soilHsg.eq(hsgCode));
      cn = cn.where(condition, values[hsgCode - 1]);
      assigned = assigned.where(condition, 1);
    });
  });
  return cn.updateMask(assigned.eq(1)).clip(catchmentGeometry);
}

function calculateSCSRunoffDepth(cnImage, rainfallDepthMm) {
  var s = ee.Image(25400).divide(cnImage).subtract(254).rename('S_mm');
  var ia = s.multiply(CONFIG.SCS_CN_INITIAL_ABSTRACTION_RATIO);
  var excess = ee.Image(rainfallDepthMm).subtract(ia);
  return excess.pow(2).divide(excess.add(s).max(0.001))
    .where(excess.lte(0), 0)
    .updateMask(cnImage.mask())
    .rename('scs_cn_runoff_depth_mm')
    .clip(catchmentGeometry);
}

function makePrimaryCProducts(primaryCover, soilTextureClass, cSlopeClass,
                              ircSurfaceClass, strongRockEvidence) {
  var c = ee.Image(0).rename('C_primary');
  var assigned = ee.Image(0).byte().rename('lookup_assigned');
  var source = ee.Image(999).byte().rename('C_source');
  var confidence = ee.Image(0).byte().rename('C_confidence');

  function assign(condition, value, sourceCode, confidenceCode) {
    c = c.where(condition, value);
    assigned = assigned.where(condition, 1);
    source = source.where(condition, sourceCode);
    confidence = confidence.where(condition, confidenceCode);
  }

  [1, 2, 3].forEach(function(coverCode) {
    var coverRule = PRIMARY_COVER_RULES[coverCode];
    [1, 2, 3].forEach(function(soilCode) {
      var soilKey = C_SOIL_TEXTURE_CLASSES[soilCode - 1].key;
      [1, 2, 3].forEach(function(slopeCode) {
        var value = governmentC(coverRule.tableKey, soilKey, slopeCode);
        var condition = primaryCover.eq(coverCode)
          .and(soilTextureClass.eq(soilCode))
          .and(cSlopeClass.eq(slopeCode));
        assign(condition, value, 101, 2);
      });
    });
  });

  // Bare/rock below 30% has no row in the Government/WAPCOS table. Apply the
  // named IRC surface class that matches the soil-texture proxy, with the
  // limitation explicitly recorded in the source table.
  var bareNonSteep = primaryCover.eq(4).and(cSlopeClass.lte(3));
  assign(bareNonSteep.and(soilTextureClass.eq(1)),
    IRC_SP13_FIXED_C.SANDY_LIGHT_GROWTH, 208, 1);
  assign(bareNonSteep.and(soilTextureClass.eq(2)),
    IRC_SP13_FIXED_C.LOAM_LIGHT_COVER, 206, 1);
  assign(bareNonSteep.and(soilTextureClass.eq(3)),
    IRC_SP13_FIXED_C.BARE_STIFF_CLAY, 204, 1);

  // Above 30% slope, use only the separately classified IRC surface branch.
  // The IRC values are suggested surface coefficients; slope alone never
  // selects a value.
  [1, 2, 3, 4, 5, 6, 7, 8, 9].forEach(function(surfaceCode) {
    var surface = IRC_SURFACE_CLASSES[surfaceCode - 1];
    var condition = ircSurfaceClass.eq(surfaceCode);
    var surfaceConfidence = surfaceCode === 1 ?
      ee.Image(0).where(strongRockEvidence, 2).where(strongRockEvidence.not(), 1) : 1;
    c = c.where(condition, surface.c);
    assigned = assigned.where(condition, 1);
    source = source.where(condition, 200 + surfaceCode);
    confidence = confidence.where(condition, surfaceConfidence);
  });

  var builtUp = primaryCover.eq(5);
  assign(builtUp, IRC_SP13_FIXED_C.CITY_PAVEMENT, 210, 2);

  [6, 7].forEach(function(coverCode) {
    if (!hasExpertOverride(coverCode)) return;
    assign(primaryCover.eq(coverCode),
      clampC(CONFIG.C_EXPERT_OVERRIDES[coverCode].value), 301, 3);
  });

  return {
    c: c.updateMask(assigned.eq(1)).clip(catchmentGeometry),
    source: source.clip(catchmentGeometry),
    confidence: confidence.clip(catchmentGeometry)
  };
}

function makeCClassImage(cImage) {
  return ee.Image(0).byte()
    .where(cImage.lt(0.20), 1)
    .where(cImage.gte(0.20).and(cImage.lt(0.30)), 2)
    .where(cImage.gte(0.30).and(cImage.lt(0.40)), 3)
    .where(cImage.gte(0.40).and(cImage.lt(0.50)), 4)
    .where(cImage.gte(0.50).and(cImage.lt(0.60)), 5)
    .where(cImage.gte(0.60), 6)
    .updateMask(cImage.mask())
    .rename('C_class')
    .clip(catchmentGeometry);
}

function makeResultsFeature(weightedC) {
  var feature = ee.Feature(null, {
    catchment_id: CONFIG.CATCHMENT_ID,
    catchment_asset: CONFIG.CATCHMENT_ASSET,
    catchment_source_crs: catchmentSourceCrs,
    area_m2: areaM2,
    area_ha: areaHa,
    area_km2: areaKm2,
    mean_elevation_m: meanElevation,
    min_elevation_m: minElevation,
    max_elevation_m: maxElevation,
    mean_slope_pct: meanSlopePct,
    max_slope_pct: maxSlopePct,
    selected_dem_source: CONFIG.DEM_SOURCE,
    mean_soil_sand_pct: meanSandPct,
    mean_soil_clay_pct: meanClayPct,
    mean_soil_water_33kpa_pct: meanSoilWater33kPa,
    mean_hsg_proxy_confidence: meanHsgProxyConfidence,
    raw_worldcover_grassland_ha: tableValue(rawLulcAreaTable, 3, 'area_ha'),
    raw_worldcover_bare_rocky_ha: tableValue(rawLulcAreaTable, 6, 'area_ha'),
    terrain_corrected_grassland_to_bare_rock_ha: bareRockCorrectionAreaHa,
    terrain_corrected_grassland_to_bare_rock_pct: bareRockCorrectionAreaHa
      .divide(areaHa.max(1)).multiply(100),
    bare_rock_correction_enabled: CONFIG.BARE_ROCK_CORRECTION_ENABLED,
    bare_rock_correction_rule: 'WorldCover grassland + slope >= ' +
      CONFIG.BARE_ROCK_MIN_SLOPE_PCT + '% + (Sentinel-2 NDVI <= ' +
      CONFIG.BARE_ROCK_MAX_NDVI + ' and BSI >= ' + CONFIG.BARE_ROCK_MIN_BSI +
      ' OR Dynamic World bare probability >= ' +
      CONFIG.DYNAMIC_WORLD_MIN_BARE_PROBABILITY + ' and bare > grass + ' +
      CONFIG.DYNAMIC_WORLD_BARE_MARGIN_OVER_GRASS + ')',
    dynamic_world_scene_count: dynamicWorldCollection.size(),
    sentinel1_scene_count: sentinel1Collection.size(),
    force_bare_rock_on_very_steep_grassland:
      CONFIG.FORCE_BARE_ROCK_ON_VERY_STEEP_GRASSLAND,
    very_steep_slope_threshold_pct: CONFIG.VERY_STEEP_SLOPE_PCT,
    chirps_mean_annual_rainfall_mm: meanAnnualRainfall,
    rainfall_context_source: CONFIG.CHIRPS_ID + ' (' +
      CONFIG.CHIRPS_CONTEXT_START_YEAR + '-' + CONFIG.CHIRPS_CONTEXT_END_YEAR +
      '); context only',
    weighted_c_primary: weightedC,
    c_primary_method: 'Indian Government/WAPCOS land-cover + soil-texture + slope table for 0-30%; independent IRC:SP:13/IRC:SP:42 surface-condition branch for >30% and named non-table surfaces.',
    c_valid_coverage_pct: validCoveragePct,
    c_valid_area_ha: validAreaM2.divide(10000),
    c_unresolved_area_ha: unresolvedAreaM2.divide(10000),
    c_unresolved_coverage_pct: unresolvedCoveragePct,
    c_raster_area_ha: cRasterAreaM2.divide(10000),
    c_area_closure_error_pct: coverageClosureErrorPct,
    c_reason_closure_error_pct: reasonClosureErrorPct,
    c_raster_vs_geodesic_area_error_pct: rasterVsGeodesicAreaErrorPct,
    c_coverage_target_pct: CONFIG.C_COMPLETE_COVERAGE_TARGET_PCT,
    c_source_map: 'C_source: 101 Government/WAPCOS; 201-210 named IRC surface category; 301 approved expert/field override; 999 unresolved.',
    c_confidence_map: 'C_confidence: 3 high/field or strong evidence; 2 moderate/source-backed screening; 1 low/proxy; 0 unresolved.',
    confidence_basis: 'High only when C coverage target is met and source categories are traceable.',
    c_missing_reason_source: 'C_missing_reason image/table; inspect before design use.',
    c_source_provenance: 'C_source image/table identifies Government/WAPCOS, each IRC surface category, expert override or unresolved.',
    c_confidence_provenance: 'C_confidence image/table identifies high/strong, moderate/source-backed, low/proxy and unresolved pixels.',
    c_surface_condition_evidence: 'C_source_cover_condition image/table; supporting evidence for special IRC surface categories, not a numerical multiplier.',
    bare_rock_high_confidence_area_ha: bareHighConfidenceAreaHa,
    bare_rock_moderate_confidence_area_ha: bareModerateConfidenceAreaHa,
    agriculture_cover_key: CONFIG.AGRICULTURE_COVER_KEY,
    c_numeric_uncertainty_range: 'Not supplied by the adopted Indian Government/WAPCOS table; unresolved >30% surfaces and field validation are reported instead.',
    weighted_cn_crosscheck: weightedCN,
    scs_cn_storm_depth_mm: CONFIG.SCS_CN_STORM_DEPTH_MM,
    scs_cn_runoff_depth_mm: weightedSCSRunoffDepthMm,
    scs_cn_runoff_volume_m3: scsRunoffVolumeM3,
    scs_cn_valid_coverage_pct: cnCoveragePct,
    scs_cn_source: SCS_CN_SOURCE,
    observed_rainfall_intensity_mmhr: observedRainfallClient === null ? -9999 : observedRainfallClient,
    observed_peak_discharge_m3s: observedDischargeClient === null ? -9999 : observedDischargeClient,
    observed_runoff_volume_m3: observedVolumeClient === null ? -9999 : observedVolumeClient,
    observed_C_from_peak_discharge: observedCClient === null ? -9999 : observedCClient,
    observed_C_model_bias: observedCModelBiasClient === null ? -9999 : observedCModelBiasClient,
    observed_C_model_MAE: observedCModelMaeClient === null ? -9999 : observedCModelMaeClient,
    observed_C_model_RMSE: observedCModelRmseClient === null ? -9999 : observedCModelRmseClient,
    observed_C_model_percentage_error: observedCModelErrorPctClient === null ? -9999 : observedCModelErrorPctClient,
    observed_validation_note: 'Observed C = Q_observed * 360 / (I_observed * A_ha); field observations are independent validation data supplied by the user, not computed by this script.',
    c_lookup_source: C_LOOKUP_SOURCE,
    c_lookup_notes: C_LOOKUP_NOTE,
    c_expert_overrides_json: JSON.stringify(CONFIG.C_EXPERT_OVERRIDES),
    c_unresolved_primary_area_ha: unsupportedCLulcAreaHa,
    c_unsupported_lulc_area_ha: unsupportedCLulcAreaHa,
    soil_resolution_m: CONFIG.SOIL_SCALE_M,
    lulc_resolution_m: CONFIG.LULC_SCALE_M,
    terrain_resolution_m: CONFIG.TERRAIN_SCALE_M,
    methodology_status: 'Preliminary/design-support C only; peak discharge/Tc module not included in this phase; validate against applicable standards and observations'
  });

  LULC_CLASSES.forEach(function(definition) {
    feature = feature.set(
      'lulc_' + definition.field + '_ha',
      tableValue(lulcAreaTable, definition.code, 'area_ha')
    );
  });
  LULC_CLASSES.forEach(function(definition) {
    feature = feature.set(
      'raw_worldcover_' + definition.field + '_ha',
      tableValue(rawLulcAreaTable, definition.code, 'area_ha')
    );
  });
  SOIL_RESPONSE_CLASSES.forEach(function(definition) {
    feature = feature.set(
      'soil_response_' + definition.field + '_ha',
      tableValue(soilResponseAreaTable, definition.code, 'area_ha')
    );
  });
  SOIL_HSG_CLASSES.forEach(function(definition) {
    feature = feature.set(
      'soil_' + definition.field + '_ha',
      tableValue(soilHsgAreaTable, definition.code, 'area_ha')
    );
    feature = feature.set(
      'soil_used_for_SCS_CN_' + definition.field + '_ha',
      tableValue(soilHsgUsedAreaTable, definition.code, 'area_ha')
    );
  });
  C_SOIL_TEXTURE_CLASSES.forEach(function(definition) {
    feature = feature.set(
      'C_soil_' + definition.field + '_ha',
      tableValue(soilCTextureAreaTable, definition.code, 'area_ha')
    );
  });
  PRIMARY_COVER_CLASSES.forEach(function(definition) {
    feature = feature.set(
      'C_land_cover_' + definition.field + '_ha',
      tableValue(primaryCoverAreaTable, definition.code, 'area_ha')
    );
  });
  C_SLOPE_CLASSES.forEach(function(definition) {
    feature = feature.set(
      'C_slope_' + definition.field + '_ha',
      tableValue(cSlopeAreaTable, definition.code, 'area_ha')
    );
  });
  IRC_SURFACE_CLASSES.forEach(function(definition) {
    feature = feature.set(
      'IRC_surface_' + definition.field + '_ha',
      tableValue(ircSurfaceAreaTable, definition.code, 'area_ha')
    );
  });
  C_SOURCE_CLASSES.forEach(function(definition) {
    feature = feature.set(
      'C_source_' + definition.field + '_ha',
      tableValue(cSourceAreaTable, definition.code, 'area_ha')
    );
  });
  C_CONFIDENCE_CLASSES.forEach(function(definition) {
    feature = feature.set(
      'C_confidence_' + definition.field + '_ha',
      tableValue(cConfidenceAreaTable, definition.code, 'area_ha')
    );
  });
  C_COVER_CLASSES.forEach(function(definition) {
    feature = feature.set(
      'cover_condition_' + definition.field + '_ha',
      tableValue(coverConditionAreaTable, definition.code, 'area_ha')
    );
  });
  C_CLASSES.forEach(function(definition) {
    feature = feature.set(
      'c_class_' + definition.field + '_ha',
      tableValue(cClassAreaTable, definition.code, 'area_ha')
    );
  });
  cMissingReasonClasses.forEach(function(definition) {
    feature = feature.set(
      'c_missing_' + definition.field + '_ha',
      tableValue(cMissingReasonAreaTable, definition.code, 'area_ha')
    );
  });
  return feature;
}

function addLayerToggle(panel, label, layer) {
  var checkbox = ui.Checkbox({
    label: label,
    value: layer.getShown(),
    onChange: function(checked) {
      layer.setShown(checked);
    }
  });
  panel.add(checkbox);
}

function addLegend(panel, title, definitions) {
  panel.add(ui.Label(title, {
    fontWeight: 'bold', color: '#555555', margin: '6px 0 2px 0'
  }));
  definitions.forEach(function(definition) {
    panel.add(ui.Panel([
      ui.Label('', {
        backgroundColor: '#' + definition.color,
        padding: '8px',
        margin: '1px 5px 1px 0'
      }),
      ui.Label(definition.label, {fontSize: '11px'})
    ], ui.Panel.Layout.flow('horizontal')));
  });
}

function makeMetricRow(panel, key, label, unit) {
  var valueLabel = ui.Label('computing...', {color: '#333333'});
  var row = ui.Panel([
    ui.Label(label, {width: '155px', color: '#555555'}),
    valueLabel,
    ui.Label(unit || '', {color: '#777777', margin: '0 0 0 4px'})
  ], ui.Panel.Layout.flow('horizontal'), {stretch: 'horizontal'});
  panel.add(row);
  metricLabels[key] = valueLabel;
}

function setMetric(key, value, decimals) {
  if (metricLabels[key]) {
    var number = Number(value);
    metricLabels[key].setValue(isFinite(number) ? number.toFixed(decimals) : 'n/a');
  }
}

function deriveConfidence() {
  if (cCoverageClient !== null && cCoverageClient >= CONFIG.C_COMPLETE_COVERAGE_TARGET_PCT) {
    return 'High (source-backed primary C, complete coverage)';
  }
  if (cCoverageClient !== null && cCoverageClient >= 90) {
    return 'Moderate (C coverage below target; review unresolved-reason map)';
  }
  return 'Low (C coverage below 90%; review unresolved-reason map before use)';
}

function calculateObservedValidation() {
  var observedIntensity = parseFloat(observedRainfallInput.getValue());
  var observedDischarge = parseFloat(observedDischargeInput.getValue());
  var observedVolume = parseFloat(observedVolumeInput.getValue());
  if (areaHaClient === null || !isFinite(areaHaClient) || areaHaClient <= 0) {
    validationResultLabel.setValue('Catchment area is still computing.');
    return;
  }
  observedRainfallClient = isFinite(observedIntensity) ? observedIntensity : null;
  observedDischargeClient = isFinite(observedDischarge) ? observedDischarge : null;
  observedVolumeClient = isFinite(observedVolume) ? observedVolume : null;
  observedCClient = null;
  observedCModelBiasClient = null;
  observedCModelMaeClient = null;
  observedCModelRmseClient = null;
  observedCModelErrorPctClient = null;
  if (observedRainfallClient !== null && observedDischargeClient !== null) {
    observedCClient = observedDischargeClient * 360 /
      (observedRainfallClient * areaHaClient);
    observedCModelBiasClient = weightedCClient === null ? null :
      weightedCClient - observedCClient;
    observedCModelMaeClient = observedCModelBiasClient === null ? null :
      Math.abs(observedCModelBiasClient);
    observedCModelRmseClient = observedCModelBiasClient === null ? null :
      Math.sqrt(observedCModelBiasClient * observedCModelBiasClient);
    var errorPct = weightedCClient !== null && observedCClient !== 0 ?
      Math.abs(weightedCClient - observedCClient) /
      Math.abs(observedCClient) * 100 : null;
    observedCModelErrorPctClient = errorPct;
    setMetric('observed_c_model_bias', observedCModelBiasClient, 3);
    setMetric('observed_c_model_mae', observedCModelMaeClient, 3);
    setMetric('observed_c_model_rmse', observedCModelRmseClient, 3);
    setMetric('observed_c_model_error_pct', observedCModelErrorPctClient, 1);
    validationResultLabel.setValue(
      'Observed C = ' + observedCClient.toFixed(3) +
      (errorPct === null ? '' : '; model-vs-observed C error = ' +
        errorPct.toFixed(1) + '%')
    );
  } else if (observedVolumeClient !== null) {
    var runoffDepth = observedVolumeClient * 1000 /
      (areaHaClient * 10000);
    validationResultLabel.setValue(
      'Observed runoff depth = ' + runoffDepth.toFixed(2) +
      ' mm. Peak C requires observed intensity and peak discharge.'
    );
  } else {
    validationResultLabel.setValue(
      'Enter observed intensity + peak discharge, or observed runoff volume.'
    );
  }
}

function updateSCSCrosscheck() {
  var depth = parseFloat(scsDepthInput.getValue());
  if (!isFinite(depth) || depth <= 0 || weightedCNClient === null) {
    scsUpdateStatus.setValue('Enter a positive storm depth after CN statistics finish computing.');
    return;
  }
  var retention = 25400 / weightedCNClient - 254;
  var initialAbstraction = CONFIG.SCS_CN_INITIAL_ABSTRACTION_RATIO * retention;
  var excess = Math.max(0, depth - initialAbstraction);
  var runoffDepth = excess <= 0 ? 0 : excess * excess /
    (excess + retention);
  var validAreaHa = areaHaClient * (cnCoverageClient / 100);
  var runoffVolume = runoffDepth * validAreaHa * 10;
  setMetric('scs_runoff_depth_mm', runoffDepth, 2);
  setMetric('scs_runoff_volume_m3', runoffVolume, 1);
  scsUpdateStatus.setValue(
    'CN summary updated for ' + depth + ' mm. Rerun to update the spatial map/export.'
  );
}

function createExportTasks() {
  if (weightedCClient === null || cCoverageClient === null ||
      cCoverageClient < CONFIG.C_COMPLETE_COVERAGE_TARGET_PCT) {
    inputStatus.setValue(
      'Exports are blocked until valid C coverage reaches ' +
      CONFIG.C_COMPLETE_COVERAGE_TARGET_PCT + '%. Inspect the C missing-reason map/table and resolve the gap.'
    );
    return;
  }

  var results = makeResultsFeature(weightedC);

  var region = catchmentGeometry.bounds(1);
  function exportImageToDrive(image, description, scale) {
    Export.image.toDrive({
      image: image.unmask(-9999),
      description: CONFIG.EXPORT_PREFIX + '_' + description,
      folder: CONFIG.EXPORT_FOLDER,
      fileNamePrefix: CONFIG.EXPORT_PREFIX + '_' + description,
      region: region,
      scale: scale,
      maxPixels: CONFIG.MAX_PIXELS,
      fileFormat: 'GeoTIFF',
      formatOptions: {cloudOptimized: true, noData: -9999}
    });
  }

  exportImageToDrive(cCentral, 'C_map_primary_government_table', CONFIG.C_SCALE_M);
  exportImageToDrive(lulcHydro, 'LULC', CONFIG.LULC_SCALE_M);
  exportImageToDrive(lulcHydroRaw, 'LULC_raw_WorldCover', CONFIG.LULC_SCALE_M);
  exportImageToDrive(
    bareRockCorrectionMask.byte(),
    'grassland_to_bare_rock_correction',
    CONFIG.LULC_SCALE_M
  );
  exportImageToDrive(slopePct, 'slope_pct', CONFIG.TERRAIN_SCALE_M);
  exportImageToDrive(soilHsg, 'soil_hsg_proxy_scs_cn', CONFIG.SOIL_SCALE_M);
  exportImageToDrive(soilCTexture, 'C_soil_texture_class', CONFIG.SOIL_SCALE_M);
  exportImageToDrive(primaryCover, 'C_primary_land_cover', CONFIG.LULC_SCALE_M);
  exportImageToDrive(cSlopeClass, 'C_slope_class', CONFIG.TERRAIN_SCALE_M);
  exportImageToDrive(hsgProbabilityImage, 'hsg_probability_proxy', CONFIG.SOIL_SCALE_M);
  exportImageToDrive(soilSandPct, 'soil_sand_pct', CONFIG.SOIL_SCALE_M);
  exportImageToDrive(soilClayPct, 'soil_clay_pct', CONFIG.SOIL_SCALE_M);
  exportImageToDrive(soilBulkDensity, 'soil_bulk_density', CONFIG.SOIL_SCALE_M);
  exportImageToDrive(soilWater33kPa, 'soil_water_33kpa', CONFIG.SOIL_SCALE_M);
  exportImageToDrive(coverCondition, 'C_source_cover_condition', CONFIG.LULC_SCALE_M);
  exportImageToDrive(s2Evi, 'sentinel2_evi_validation', CONFIG.LULC_SCALE_M);
  exportImageToDrive(ircSurfaceClass, 'IRC_surface_class', CONFIG.LULC_SCALE_M);
  exportImageToDrive(cSource, 'C_source', CONFIG.C_SCALE_M);
  exportImageToDrive(cConfidence, 'C_confidence', CONFIG.C_SCALE_M);
  exportImageToDrive(cCentral.rename('C_VALUE'), 'C_VALUE', CONFIG.C_SCALE_M);
  exportImageToDrive(cReasonBand, 'C_reason', CONFIG.C_SCALE_M);
  exportImageToDrive(
    cCentral.rename('C_VALUE').addBands(cSource).addBands(cConfidence)
      .addBands(cReasonBand),
    'C_final_provenance_stack',
    CONFIG.C_SCALE_M
  );
  exportImageToDrive(bareRockConfidence, 'bare_rock_confidence', CONFIG.LULC_SCALE_M);
  exportImageToDrive(sentinel1VvLayer, 'sentinel1_vv_validation', CONFIG.LULC_SCALE_M);
  exportImageToDrive(sentinel1VhLayer, 'sentinel1_vh_validation', CONFIG.LULC_SCALE_M);
  exportImageToDrive(cMissingReason, 'C_missing_reason', CONFIG.C_SCALE_M);
  exportImageToDrive(cnImage, 'SCS_CN_crosscheck', CONFIG.C_SCALE_M);
  exportImageToDrive(scsRunoffDepthImage, 'SCS_CN_runoff_depth', CONFIG.C_SCALE_M);
  Export.table.toDrive({
    collection: ee.FeatureCollection([results]),
    description: CONFIG.EXPORT_PREFIX + '_results',
    folder: CONFIG.EXPORT_FOLDER,
    fileNamePrefix: CONFIG.EXPORT_PREFIX + '_results',
    fileFormat: 'CSV'
  });
  Export.table.toDrive({
    collection: lulcAreaTable,
    description: CONFIG.EXPORT_PREFIX + '_LULC_composition',
    folder: CONFIG.EXPORT_FOLDER,
    fileNamePrefix: CONFIG.EXPORT_PREFIX + '_LULC_composition',
    fileFormat: 'CSV'
  });
  Export.table.toDrive({
    collection: rawLulcAreaTable,
    description: CONFIG.EXPORT_PREFIX + '_LULC_raw_composition',
    folder: CONFIG.EXPORT_FOLDER,
    fileNamePrefix: CONFIG.EXPORT_PREFIX + '_LULC_raw_composition',
    fileFormat: 'CSV'
  });
  Export.table.toDrive({
    collection: soilTextureAreaTable,
    description: CONFIG.EXPORT_PREFIX + '_soil_texture_composition',
    folder: CONFIG.EXPORT_FOLDER,
    fileNamePrefix: CONFIG.EXPORT_PREFIX + '_soil_texture_composition',
    fileFormat: 'CSV'
  });
  Export.table.toDrive({
    collection: soilHsgAreaTable,
    description: CONFIG.EXPORT_PREFIX + '_soil_hsg_proxy_composition',
    folder: CONFIG.EXPORT_FOLDER,
    fileNamePrefix: CONFIG.EXPORT_PREFIX + '_soil_hsg_proxy_composition',
    fileFormat: 'CSV'
  });
  Export.table.toDrive({
    collection: soilHsgUsedAreaTable,
    description: CONFIG.EXPORT_PREFIX + '_soil_hsg_used_for_SCS_CN',
    folder: CONFIG.EXPORT_FOLDER,
    fileNamePrefix: CONFIG.EXPORT_PREFIX + '_soil_hsg_used_for_SCS_CN',
    fileFormat: 'CSV'
  });
  Export.table.toDrive({
    collection: soilCTextureAreaTable,
    description: CONFIG.EXPORT_PREFIX + '_C_soil_texture_composition',
    folder: CONFIG.EXPORT_FOLDER,
    fileNamePrefix: CONFIG.EXPORT_PREFIX + '_C_soil_texture_composition',
    fileFormat: 'CSV'
  });
  Export.table.toDrive({
    collection: primaryCoverAreaTable,
    description: CONFIG.EXPORT_PREFIX + '_C_primary_land_cover_composition',
    folder: CONFIG.EXPORT_FOLDER,
    fileNamePrefix: CONFIG.EXPORT_PREFIX + '_C_primary_land_cover_composition',
    fileFormat: 'CSV'
  });
  Export.table.toDrive({
    collection: cSlopeAreaTable,
    description: CONFIG.EXPORT_PREFIX + '_C_slope_composition',
    folder: CONFIG.EXPORT_FOLDER,
    fileNamePrefix: CONFIG.EXPORT_PREFIX + '_C_slope_composition',
    fileFormat: 'CSV'
  });
  Export.table.toDrive({
    collection: ircSurfaceAreaTable,
    description: CONFIG.EXPORT_PREFIX + '_IRC_surface_composition',
    folder: CONFIG.EXPORT_FOLDER,
    fileNamePrefix: CONFIG.EXPORT_PREFIX + '_IRC_surface_composition',
    fileFormat: 'CSV'
  });
  Export.table.toDrive({
    collection: cSourceAreaTable,
    description: CONFIG.EXPORT_PREFIX + '_C_source_composition',
    folder: CONFIG.EXPORT_FOLDER,
    fileNamePrefix: CONFIG.EXPORT_PREFIX + '_C_source_composition',
    fileFormat: 'CSV'
  });
  Export.table.toDrive({
    collection: cConfidenceAreaTable,
    description: CONFIG.EXPORT_PREFIX + '_C_confidence_composition',
    folder: CONFIG.EXPORT_FOLDER,
    fileNamePrefix: CONFIG.EXPORT_PREFIX + '_C_confidence_composition',
    fileFormat: 'CSV'
  });
  Export.table.toDrive({
    collection: cLookupTable,
    description: CONFIG.EXPORT_PREFIX + '_C_source_lookup_table',
    folder: CONFIG.EXPORT_FOLDER,
    fileNamePrefix: CONFIG.EXPORT_PREFIX + '_C_source_lookup_table',
    fileFormat: 'CSV'
  });
  Export.table.toDrive({
    collection: cClassAreaTable,
    description: CONFIG.EXPORT_PREFIX + '_C_class_areas',
    folder: CONFIG.EXPORT_FOLDER,
    fileNamePrefix: CONFIG.EXPORT_PREFIX + '_C_class_areas',
    fileFormat: 'CSV'
  });
  Export.table.toDrive({
    collection: coverConditionAreaTable,
    description: CONFIG.EXPORT_PREFIX + '_C_source_cover_condition_areas',
    folder: CONFIG.EXPORT_FOLDER,
    fileNamePrefix: CONFIG.EXPORT_PREFIX + '_C_source_cover_condition_areas',
    fileFormat: 'CSV'
  });
  Export.table.toDrive({
    collection: cMissingReasonAreaTable,
    description: CONFIG.EXPORT_PREFIX + '_C_missing_reason_areas',
    folder: CONFIG.EXPORT_FOLDER,
    fileNamePrefix: CONFIG.EXPORT_PREFIX + '_C_missing_reason_areas',
    fileFormat: 'CSV'
  });

  inputStatus.setValue(
    'Export tasks created. Review the Tasks tab.'
  );
}

// ==========================================================================
// 3. INPUT VALIDATION AND DATA LOADING
// ==========================================================================

var catchment = ee.FeatureCollection(CONFIG.CATCHMENT_ASSET);
var catchmentFeatureCount = catchment.size();
var polygonFeatureCount = catchment.filter(
  ee.Filter.hasType('.geo', 'Polygon')
).size();
var multiPolygonFeatureCount = catchment.filter(
  ee.Filter.hasType('.geo', 'MultiPolygon')
).size();
var unsupportedOrNullGeometryCount = catchmentFeatureCount
  .subtract(polygonFeatureCount)
  .subtract(multiPolygonFeatureCount);
var catchmentGeometry = catchment.geometry();
var catchmentIsUnbounded = catchmentGeometry.isUnbounded();
var catchmentSourceCrs = ee.Algorithms.If(
  catchmentFeatureCount.gt(0),
  catchment.first().geometry().projection().crs(),
  'unavailable: empty FeatureCollection'
);
var areaM2 = catchmentGeometry.area();
var areaHa = areaM2.divide(10000);
var areaKm2 = areaM2.divide(1e6);
var catchmentBounds = catchmentGeometry.bounds(1);

// A FeatureCollection.geometry() dissolves/combines the input features into a
// single analysis geometry. This honors the requirement that multiple uploaded
// polygons are treated as one contributing catchment.
print('--- Check-dam catchment runoff DSS ---');
print('Catchment asset', CONFIG.CATCHMENT_ASSET);
print('Feature count', catchmentFeatureCount);
print('Polygon feature count', polygonFeatureCount);
print('MultiPolygon feature count', multiPolygonFeatureCount);
print('Unsupported/null/empty geometry count', unsupportedOrNullGeometryCount);
print('Analysis geometry is unbounded', catchmentIsUnbounded);
print('Catchment source CRS', catchmentSourceCrs);
print('Dissolved analysis geometry type', catchmentGeometry.type());
print('Catchment bounding box', catchmentBounds);
print('Catchment area (m2)', areaM2);
print('Catchment area (ha)', areaHa);
print('Catchment area (km2)', areaKm2);
print('First feature geometry projection / CRS metadata', ee.Algorithms.If(
  catchmentFeatureCount.gt(0),
  catchment.first().geometry().projection(),
  'unavailable: empty FeatureCollection'
));

var lookupProblems = validateLookupRows();
if (lookupProblems.length > 0) {
  print('ERROR: runoff coefficient lookup validation failed', lookupProblems);
} else {
  print('C lookup validation', 'All configured C values are within 0-1.');
}
print('C source lookup table rows', C_LOOKUP_ROWS.length);
print('C source lookup table', C_LOOKUP_ROWS);
print('C expert overrides', CONFIG.C_EXPERT_OVERRIDES);

var copernicusCollection = ee.ImageCollection(CONFIG.COPERNICUS_DEM_ID)
  .filterBounds(catchmentGeometry);
var copernicusProjection = copernicusCollection.first().projection();
var demCopernicus = copernicusCollection.mosaic()
  .setDefaultProjection(copernicusProjection)
  .select('DEM')
  .rename('elevation_m')
  .clip(catchmentGeometry);
var demSrtm = ee.Image(CONFIG.SRTM_DEM_ID).select('elevation')
  .rename('elevation_m').clip(catchmentGeometry);
var dem = CONFIG.DEM_SOURCE === 'SRTM' ? demSrtm : demCopernicus;

var slopeDegrees = ee.Terrain.slope(dem).rename('slope_degrees');
var slopePct = slopeDegrees.multiply(Math.PI / 180).tan()
  .multiply(100).rename('slope_pct').clip(catchmentGeometry);
var hillshade = ee.Terrain.hillshade(dem).rename('hillshade');

var worldCover = ee.ImageCollection(CONFIG.WORLD_COVER_ID).first()
  .select('Map').clip(catchmentGeometry);
var lulcHydroRaw = worldCover.remap(
  [10, 20, 30, 40, 50, 60, 70, 80, 90, 95, 100],
  [1,  2,  3,  4,  5,  6,  8,  7,  7,  7,  8],
  8
).rename('hydrologic_lulc_raw').clip(catchmentGeometry);

// WorldCover's class 30 can include open grassy surfaces and can also label
// exposed steep rock as grassland. Recheck only those pixels with terrain and
// Sentinel-2 surface evidence. This is a transparent correction layer, not an
// attempt to replace a field-validated land-cover map.
var s2Collection = ee.ImageCollection(CONFIG.S2_SR_ID)
  .filterBounds(catchmentGeometry)
  .filterDate(CONFIG.S2_START_DATE, CONFIG.S2_END_DATE)
  .filter(ee.Filter.lte('CLOUDY_PIXEL_PERCENTAGE', CONFIG.S2_MAX_CLOUD_PCT))
  .map(maskSentinel2)
  .select(['B2', 'B3', 'B4', 'B8', 'B11']);
var s2Composite = ee.Image(ee.Algorithms.If(
  s2Collection.size().gt(0),
  s2Collection.median(),
  ee.Image.constant(0).rename('B2')
    .addBands(ee.Image.constant(0).rename('B3'))
    .addBands(ee.Image.constant(0).rename('B4'))
    .addBands(ee.Image.constant(0).rename('B8'))
    .addBands(ee.Image.constant(0).rename('B11'))
)).clip(catchmentGeometry);
var s2Ndvi = s2Composite.normalizedDifference(['B8', 'B4'])
  .rename('s2_ndvi').unmask(0);
var s2Evi = s2Composite.expression(
  '2.5 * ((NIR - RED) / (NIR + 6 * RED - 7.5 * BLUE + 1))',
  {
    NIR: s2Composite.select('B8'),
    RED: s2Composite.select('B4'),
    BLUE: s2Composite.select('B2')
  }
).rename('s2_evi').unmask(0);
var s2Bsi = s2Composite.expression(
  '((SWIR + RED) - (NIR + BLUE)) / ((SWIR + RED) + (NIR + BLUE))',
  {
    SWIR: s2Composite.select('B11'),
    RED: s2Composite.select('B4'),
    NIR: s2Composite.select('B8'),
    BLUE: s2Composite.select('B2')
  }
).rename('s2_bsi').unmask(0);

var dynamicWorldCollection = ee.ImageCollection(CONFIG.DYNAMIC_WORLD_ID)
  .filterBounds(catchmentGeometry)
  .filterDate(CONFIG.DYNAMIC_WORLD_START_DATE, CONFIG.DYNAMIC_WORLD_END_DATE)
  .select(['bare', 'grass', 'trees']);
var dynamicWorldComposite = ee.Image(ee.Algorithms.If(
  dynamicWorldCollection.size().gt(0),
  dynamicWorldCollection.median(),
  ee.Image.constant(0).rename('bare')
    .addBands(ee.Image.constant(0).rename('grass'))
    .addBands(ee.Image.constant(0).rename('trees'))
)).clip(catchmentGeometry);
var dynamicWorldBareProbability = dynamicWorldComposite.select('bare')
  .rename('dynamic_world_bare_probability').unmask(0);
var dynamicWorldGrassProbability = dynamicWorldComposite.select('grass')
  .rename('dynamic_world_grass_probability').unmask(0);
var dynamicWorldTreeProbability = dynamicWorldComposite.select('trees')
  .rename('dynamic_world_tree_probability').unmask(0);

// Sentinel-1 is supporting evidence only. It is not converted directly into
// a runoff coefficient because backscatter is affected by moisture, geometry,
// incidence angle, roughness and vegetation structure.
var sentinel1Collection = ee.ImageCollection(CONFIG.S1_ID)
  .filterBounds(catchmentGeometry)
  .filterDate(CONFIG.S1_START_DATE, CONFIG.S1_END_DATE)
  .filter(ee.Filter.eq('instrumentMode', 'IW'))
  .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
  .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'))
  .select(['VV', 'VH']);
var sentinel1Composite = ee.Image(ee.Algorithms.If(
  sentinel1Collection.size().gt(0),
  sentinel1Collection.median(),
  ee.Image.constant(0).rename('VV')
    .addBands(ee.Image.constant(0).rename('VH'))
)).clip(catchmentGeometry);
var sentinel1VvLayer = sentinel1Composite.select('VV').rename('sentinel1_vv_db');
var sentinel1VhLayer = sentinel1Composite.select('VH').rename('sentinel1_vh_db');
var sentinel1VvVhDifference = sentinel1VvLayer.subtract(sentinel1VhLayer)
  .rename('sentinel1_vv_minus_vh_db');

// The OR is intentional: shaded rock can have a weak spectral BSI signal, and
// a single classifier should not be allowed to veto a second independent clue.
var spectralBareEvidence = s2Ndvi.lte(CONFIG.BARE_ROCK_MAX_NDVI)
  .and(s2Bsi.gte(CONFIG.BARE_ROCK_MIN_BSI))
  .unmask(0);
var dynamicWorldBareEvidence = dynamicWorldBareProbability
  .gte(CONFIG.DYNAMIC_WORLD_MIN_BARE_PROBABILITY)
  .and(dynamicWorldBareProbability.gt(
    dynamicWorldGrassProbability.add(CONFIG.DYNAMIC_WORLD_BARE_MARGIN_OVER_GRASS)
  ))
  .unmask(0);

var verySteepGrasslandEvidence = ee.Image(0).byte()
  .where(slopePct.gte(CONFIG.VERY_STEEP_SLOPE_PCT), 1)
  .eq(1);
if (!CONFIG.FORCE_BARE_ROCK_ON_VERY_STEEP_GRASSLAND) {
  verySteepGrasslandEvidence = ee.Image(0).byte();
}

var bareRockCorrectionMask = worldCover.eq(30)
  .and(slopePct.gte(CONFIG.BARE_ROCK_MIN_SLOPE_PCT))
  .and(spectralBareEvidence.or(dynamicWorldBareEvidence)
    .or(verySteepGrasslandEvidence))
  .rename('grassland_to_bare_rock_correction');
if (!CONFIG.BARE_ROCK_CORRECTION_ENABLED) {
  bareRockCorrectionMask = ee.Image(0).byte()
    .rename('grassland_to_bare_rock_correction')
    .updateMask(worldCover.mask());
}

var lulcHydro = lulcHydroRaw
  .where(bareRockCorrectionMask, 6)
  .rename('hydrologic_lulc')
  .clip(catchmentGeometry);

var soilTexture = ee.Image(CONFIG.SOIL_TEXTURE_ID)
  .select(CONFIG.SOIL_TEXTURE_BAND)
  .rename('soil_texture_class')
  .clip(catchmentGeometry);
var soilResponse = soilTexture.remap(
  SOIL_TEXTURE_CLASSES.map(function(definition) { return definition.code; }),
  SOIL_TEXTURE_CLASSES.map(function(definition) { return definition.response; }),
  0
).rename('soil_response_group').clip(catchmentGeometry);
var soilHsg = soilTexture.remap(
  SOIL_TEXTURE_CLASSES.map(function(definition) { return definition.code; }),
  SOIL_TEXTURE_CLASSES.map(function(definition) {
    return ['A', 'B', 'C', 'D'].indexOf(definition.hsg) + 1;
  }),
  0
).rename('soil_hsg_proxy').clip(catchmentGeometry);
var fieldHsgCode = CONFIG.FIELD_CONFIRMED_HSG === 'A' ? 1 :
  CONFIG.FIELD_CONFIRMED_HSG === 'B' ? 2 :
  CONFIG.FIELD_CONFIRMED_HSG === 'C' ? 3 :
  CONFIG.FIELD_CONFIRMED_HSG === 'D' ? 4 : 0;
var soilHsgForC = fieldHsgCode > 0 ?
  ee.Image.constant(fieldHsgCode).rename('soil_hsg_used')
    .clip(catchmentGeometry) : soilHsg.rename('soil_hsg_used');

// Primary C soil class: direct texture/infiltration grouping used by the
// Indian Government/WAPCOS table. HSG is intentionally not used here.
var soilCTexture = soilTexture.remap(
  SOIL_TEXTURE_CLASSES.map(function(definition) { return definition.code; }),
  [3, 3, 3, 3, 3, 3, 2, 2, 1, 2, 1, 1],
  0
).rename('C_soil_texture_class').clip(catchmentGeometry);

var primaryCover = ee.Image(0).byte()
  .where(lulcHydro.eq(1), 1)
  .where(lulcHydro.eq(2).or(lulcHydro.eq(3)), 2)
  .where(lulcHydro.eq(4), 3)
  .where(lulcHydro.eq(6), 4)
  .where(lulcHydro.eq(5), 5)
  .where(lulcHydro.eq(7), 6)
  .where(lulcHydro.eq(8), 7)
  .rename('C_primary_land_cover')
  .clip(catchmentGeometry);

// Additional native 250-m soil properties are reported as evidence only.
// They help expose why a texture-only HSG proxy is uncertain; they do not
// silently replace a field-verified HSG.
var soilSandPct = ee.Image(CONFIG.SOIL_SAND_ID).select(CONFIG.SOIL_PROPERTY_BAND)
  .rename('soil_sand_pct').clip(catchmentGeometry);
var soilClayPct = ee.Image(CONFIG.SOIL_CLAY_ID).select(CONFIG.SOIL_PROPERTY_BAND)
  .rename('soil_clay_pct').clip(catchmentGeometry);
var soilBulkDensity = ee.Image(CONFIG.SOIL_BULK_DENSITY_ID)
  .select(CONFIG.SOIL_PROPERTY_BAND).rename('soil_bulk_density_native')
  .clip(catchmentGeometry);
var soilWater33kPa = ee.Image(CONFIG.SOIL_WATER_ID)
  .select(CONFIG.SOIL_PROPERTY_BAND).rename('soil_water_33kpa_pct')
  .clip(catchmentGeometry);

// Transparent screening probabilities based on sand/clay evidence. These are
// not field-calibrated USDA HSG probabilities and are never treated as such.
var sandFraction = soilSandPct.divide(100).clamp(0, 1);
var clayFraction = soilClayPct.divide(100).clamp(0, 1);
var hsgScoreA = sandFraction.multiply(ee.Image(1).subtract(clayFraction));
var hsgScoreD = clayFraction;
var hsgScoreB = sandFraction.multiply(0.5)
  .add(ee.Image(1).subtract(clayFraction).multiply(0.2));
var hsgScoreC = clayFraction.multiply(0.6)
  .add(ee.Image(1).subtract(sandFraction).multiply(0.4));
var hsgScoreSum = hsgScoreA.add(hsgScoreB).add(hsgScoreC).add(hsgScoreD)
  .max(0.001);
var hsgProbabilityA = hsgScoreA.divide(hsgScoreSum).rename('hsg_A_probability');
var hsgProbabilityB = hsgScoreB.divide(hsgScoreSum).rename('hsg_B_probability');
var hsgProbabilityC = hsgScoreC.divide(hsgScoreSum).rename('hsg_C_probability');
var hsgProbabilityD = hsgScoreD.divide(hsgScoreSum).rename('hsg_D_probability');
var hsgProbabilityMax = hsgProbabilityA.max(hsgProbabilityB)
  .max(hsgProbabilityC).max(hsgProbabilityD)
  .rename('hsg_probability_max');
var hsgProbabilityImage = hsgProbabilityA.addBands(hsgProbabilityB)
  .addBands(hsgProbabilityC).addBands(hsgProbabilityD)
  .addBands(hsgProbabilityMax).clip(catchmentGeometry);

// Supporting cover/surface-condition classification. This is deliberately
// separate from raw WorldCover and is used to justify/validate special IRC
// surface categories; the primary C lookup uses primaryCover, soilCTexture
// and cSlopeClass instead.
var forestGoodEvidence = worldCover.eq(10)
  .and(dynamicWorldTreeProbability.gte(0.45))
  .and(s2Ndvi.gte(0.45));
var steepWoodedEvidence = worldCover.eq(10)
  .and(slopePct.gte(CONFIG.BARE_ROCK_MIN_SLOPE_PCT))
  .and(dynamicWorldTreeProbability.gte(0.35))
  .and(s2Ndvi.gte(0.35));
var grassGoodEvidence = worldCover.eq(30)
  .and(dynamicWorldGrassProbability.gte(0.45))
  .and(s2Ndvi.gte(0.45));
var bareSteepEvidence = lulcHydro.eq(6)
  .and(slopePct.gte(CONFIG.BARE_ROCK_MIN_SLOPE_PCT))
  .and(spectralBareEvidence.or(dynamicWorldBareEvidence)
    .or(bareRockCorrectionMask));
var rockVegetatedEvidence = lulcHydro.eq(6)
  .and(slopePct.gte(CONFIG.BARE_ROCK_MIN_SLOPE_PCT))
  .and(s2Ndvi.gt(CONFIG.BARE_ROCK_MAX_NDVI)
    .or(dynamicWorldTreeProbability.gte(0.25)));

var coverCondition = ee.Image(0).byte()
  .where(forestGoodEvidence, 1)
  .where(steepWoodedEvidence.and(forestGoodEvidence.not()), 2)
  .where(worldCover.eq(10).and(forestGoodEvidence.not())
    .and(steepWoodedEvidence.not()), 3)
  .where(grassGoodEvidence.and(bareRockCorrectionMask.not()), 4)
  .where(worldCover.eq(30).and(grassGoodEvidence.not())
    .and(bareRockCorrectionMask.not()), 3)
  .where(lulcHydro.eq(4), 5)
  .where(bareSteepEvidence, 6)
  .where(rockVegetatedEvidence.and(bareSteepEvidence.not()), 2)
  .where(lulcHydro.eq(6).and(bareSteepEvidence.not())
    .and(rockVegetatedEvidence.not()).and(soilHsgForC.eq(4).or(soilHsgForC.eq(3))), 7)
  .where(lulcHydro.eq(6).and(bareSteepEvidence.not())
    .and(rockVegetatedEvidence.not()).and(soilHsgForC.eq(2)), 8)
  .where(lulcHydro.eq(6).and(bareSteepEvidence.not())
    .and(rockVegetatedEvidence.not()).and(soilHsgForC.eq(1)), 9)
  .where(lulcHydro.eq(2), 3)
  .where(lulcHydro.eq(5), 10)
  .where(lulcHydro.eq(7), 11)
  .where(lulcHydro.eq(8), 12)
  .rename('C_source_cover_condition')
  .clip(catchmentGeometry);

var bareRockConfidence = ee.Image(0).byte()
  .where(bareRockCorrectionMask
    .and(spectralBareEvidence.and(dynamicWorldBareEvidence)), 3)
  .where(bareRockCorrectionMask
    .and(spectralBareEvidence.or(dynamicWorldBareEvidence)), 2)
  .where(bareRockCorrectionMask, 1)
  .rename('bare_rock_confidence')
  .clip(catchmentGeometry);

var chirps = ee.ImageCollection(CONFIG.CHIRPS_ID)
  .filterBounds(catchmentGeometry)
  .select('precipitation');
var meanAnnualRainfallImage = makeMeanAnnualRainfallContext(
  chirps,
  CONFIG.CHIRPS_CONTEXT_START_YEAR,
  CONFIG.CHIRPS_CONTEXT_END_YEAR
);

var slopeClass = ee.Image(0).byte()
  .where(slopePct.lt(CONFIG.SLOPE_BREAKS_PCT[0]), 1)
  .where(slopePct.gte(CONFIG.SLOPE_BREAKS_PCT[0])
    .and(slopePct.lt(CONFIG.SLOPE_BREAKS_PCT[1])), 2)
  .where(slopePct.gte(CONFIG.SLOPE_BREAKS_PCT[1])
    .and(slopePct.lt(CONFIG.SLOPE_BREAKS_PCT[2])), 3)
  .where(slopePct.gte(CONFIG.SLOPE_BREAKS_PCT[2])
    .and(slopePct.lt(CONFIG.SLOPE_BREAKS_PCT[3])), 4)
  .where(slopePct.gte(CONFIG.SLOPE_BREAKS_PCT[3]), 5)
  .updateMask(slopePct.mask())
  .rename('slope_class')
  .clip(catchmentGeometry);

var cSlopeClass = ee.Image(0).byte()
  .where(slopePct.lt(6), 1)
  .where(slopePct.gte(6).and(slopePct.lt(11)), 2)
  .where(slopePct.gte(11).and(slopePct.lte(30)), 3)
  .where(slopePct.gt(30), 4)
  .updateMask(slopePct.mask())
  .rename('C_slope_class')
  .clip(catchmentGeometry);

// --------------------------------------------------------------------------
// IRC steep-surface decision tree
// --------------------------------------------------------------------------
// Slope >30% only activates this branch. It does not itself imply C=0.90.
// The categories are source-named IRC surface conditions, screened with
// remote-sensing evidence. They remain proxies until field checked.
var ircElevationMin = reduceStat(dem, ee.Reducer.min(), 'elevation_m',
  CONFIG.TERRAIN_SCALE_M, 0);
var ircElevationMax = reduceStat(dem, ee.Reducer.max(), 'elevation_m',
  CONFIG.TERRAIN_SCALE_M, 0);
var ircElevationFraction = dem.subtract(ircElevationMin)
  .divide(ircElevationMax.subtract(ircElevationMin).max(1))
  .rename('irc_elevation_fraction');
var upperTerrainEvidence = ircElevationFraction.gte(
  CONFIG.IRC_PLATEAU_MIN_ELEVATION_FRACTION);

var ircStrongVegetation = s2Ndvi.gte(CONFIG.IRC_STRONG_VEGETATION_NDVI)
  .or(s2Evi.gte(CONFIG.IRC_STRONG_VEGETATION_EVI))
  .or(dynamicWorldTreeProbability.gte(CONFIG.IRC_STRONG_TREE_PROBABILITY))
  .or(dynamicWorldGrassProbability.gte(CONFIG.IRC_STRONG_GRASS_PROBABILITY));
var ircLightVegetation = s2Ndvi.gte(CONFIG.IRC_LIGHT_VEGETATION_NDVI)
  .or(s2Evi.gte(CONFIG.IRC_LIGHT_VEGETATION_EVI))
  .or(dynamicWorldTreeProbability.gte(CONFIG.IRC_LIGHT_VEGETATION_PROBABILITY))
  .or(dynamicWorldGrassProbability.gte(CONFIG.IRC_LIGHT_VEGETATION_PROBABILITY));
var ircBareSurfaceEvidence = spectralBareEvidence.or(dynamicWorldBareEvidence);
var ircRockSpecificEvidence = s2Bsi.gte(CONFIG.IRC_ROCK_MIN_BSI)
  .and(s2Ndvi.lte(CONFIG.BARE_ROCK_MAX_NDVI))
  .or(dynamicWorldBareProbability.gte(CONFIG.IRC_ROCK_MIN_BARE_PROBABILITY)
    .and(dynamicWorldBareProbability.gt(dynamicWorldGrassProbability.add(0.15))));
var ircStrongRockEvidence = s2Bsi.gte(CONFIG.IRC_ROCK_MIN_BSI)
  .and(s2Ndvi.lte(CONFIG.BARE_ROCK_MAX_NDVI))
  .and(dynamicWorldBareProbability.gte(CONFIG.IRC_ROCK_MIN_BARE_PROBABILITY))
  .or(verySteepGrasslandEvidence);
var ircRockSurfaceCandidate = cSlopeClass.eq(4)
  .and(worldCover.eq(60).or(bareRockCorrectionMask))
  .and(ircRockSpecificEvidence.or(verySteepGrasslandEvidence));

var steepBareRockSurface = ircRockSurfaceCandidate
  .and(ircStrongVegetation.not());
var steepRockVegetatedSurface = ircRockSurfaceCandidate
  .and(ircStrongVegetation)
  .and(steepBareRockSurface.not());
var plateauLightCoverSurface = cSlopeClass.eq(4)
  .and(primaryCover.eq(2))
  .and(upperTerrainEvidence)
  .and(ircLightVegetation)
  .and(ircStrongVegetation.not())
  .and(ircRockSurfaceCandidate.not());
var bareStiffClaySurface = cSlopeClass.eq(4)
  .and(primaryCover.eq(4))
  .and(soilCTexture.eq(3))
  .and(ircBareSurfaceEvidence)
  .and(ircRockSurfaceCandidate.not());
var stiffClayVegetatedSurface = cSlopeClass.eq(4)
  .and(soilCTexture.eq(3))
  .and(primaryCover.eq(1).or(primaryCover.eq(2)).or(primaryCover.eq(3)))
  .and(ircStrongVegetation)
  .and(ircRockSurfaceCandidate.not());
var loamLightCoverSurface = cSlopeClass.eq(4)
  .and(soilCTexture.eq(2))
  .and(primaryCover.eq(2).or(primaryCover.eq(3)))
  .and(ircLightVegetation)
  .and(ircStrongVegetation.not())
  .and(ircRockSurfaceCandidate.not())
  .and(plateauLightCoverSurface.not());
var loamCoveredSurface = cSlopeClass.eq(4)
  .and(soilCTexture.eq(2))
  .and(primaryCover.eq(2).or(primaryCover.eq(3)))
  .and(ircStrongVegetation)
  .and(ircRockSurfaceCandidate.not())
  .and(plateauLightCoverSurface.not());
var sandyLightGrowthSurface = cSlopeClass.eq(4)
  .and(soilCTexture.eq(1))
  .and(primaryCover.eq(2).or(primaryCover.eq(3)))
  .and(ircLightVegetation)
  .and(ircRockSurfaceCandidate.not())
  .and(plateauLightCoverSurface.not());
var sandyWoodlandSurface = cSlopeClass.eq(4)
  .and(soilCTexture.eq(1))
  .and(primaryCover.eq(1))
  .and(ircStrongVegetation)
  .and(ircRockSurfaceCandidate.not());

var ircSurfaceClass = ee.Image(0).byte()
  .where(steepBareRockSurface, 1)
  .where(steepRockVegetatedSurface, 2)
  .where(bareStiffClaySurface, 4)
  .where(stiffClayVegetatedSurface, 5)
  .where(loamLightCoverSurface, 6)
  .where(loamCoveredSurface, 7)
  .where(sandyLightGrowthSurface, 8)
  .where(sandyWoodlandSurface, 9)
  .where(plateauLightCoverSurface, 3)
  .rename('IRC_surface_class')
  .clip(catchmentGeometry);

var cProducts = makePrimaryCProducts(
  primaryCover,
  soilCTexture,
  cSlopeClass,
  ircSurfaceClass,
  ircStrongRockEvidence
);
var cCentral = cProducts.c;
var cSource = cProducts.source;
var cConfidence = cProducts.confidence;
var cSourceDisplay = cSource.remap(
  C_SOURCE_CLASSES.map(function(definition) { return definition.code; }),
  C_SOURCE_CLASSES.map(function(definition, index) { return index; }),
  0
).rename('C_source_display').clip(catchmentGeometry);
var cClassImage = makeCClassImage(cCentral);
var cnImage = makeCNImage(coverCondition, soilHsgForC);
var scsRunoffDepthImage = calculateSCSRunoffDepth(
  cnImage, CONFIG.SCS_CN_STORM_DEPTH_MM
);

// ==========================================================================
// 4. STATISTICS AND RESULTS TABLES
// ==========================================================================

var minElevation = reduceStat(dem, ee.Reducer.min(), 'elevation_m',
  CONFIG.TERRAIN_SCALE_M, 0);
var maxElevation = reduceStat(dem, ee.Reducer.max(), 'elevation_m',
  CONFIG.TERRAIN_SCALE_M, 0);
var meanElevation = reduceStat(dem, ee.Reducer.mean(), 'elevation_m',
  CONFIG.TERRAIN_SCALE_M, 0);
var meanSlopePct = reduceStat(slopePct, ee.Reducer.mean(), 'slope_pct',
  CONFIG.TERRAIN_SCALE_M, 0);
var maxSlopePct = reduceStat(slopePct, ee.Reducer.max(), 'slope_pct',
  CONFIG.TERRAIN_SCALE_M, 0);
var meanAnnualRainfall = reduceStat(
  meanAnnualRainfallImage,
  ee.Reducer.mean(),
  'mean_annual_rainfall_mm',
  5566,
  0
);
var meanSandPct = reduceStat(soilSandPct, ee.Reducer.mean(), 'soil_sand_pct',
  CONFIG.SOIL_SCALE_M, 0);
var meanClayPct = reduceStat(soilClayPct, ee.Reducer.mean(), 'soil_clay_pct',
  CONFIG.SOIL_SCALE_M, 0);
var meanSoilWater33kPa = reduceStat(soilWater33kPa, ee.Reducer.mean(),
  'soil_water_33kpa_pct', CONFIG.SOIL_SCALE_M, 0);
var meanHsgProxyConfidence = reduceStat(
  hsgProbabilityMax, ee.Reducer.mean(), 'hsg_probability_max',
  CONFIG.SOIL_SCALE_M, 0
);
var bareRockCorrectionAreaHa = reduceStat(
  ee.Image.pixelArea().rename('correction_area_m2')
    .updateMask(bareRockCorrectionMask),
  ee.Reducer.sum(),
  'correction_area_m2',
  CONFIG.LULC_SCALE_M,
  0
).divide(10000);

var lulcAreaTable = calculateAreaTable(lulcHydro, LULC_CLASSES,
  CONFIG.LULC_SCALE_M, 'hydrologic_lulc');
var rawLulcAreaTable = calculateAreaTable(lulcHydroRaw, LULC_CLASSES,
  CONFIG.LULC_SCALE_M, 'hydrologic_lulc_raw');
var soilTextureAreaTable = calculateAreaTable(soilTexture, SOIL_TEXTURE_CLASSES,
  CONFIG.SOIL_SCALE_M, 'soil_texture');
var soilResponseAreaTable = calculateAreaTable(soilResponse, SOIL_RESPONSE_CLASSES,
  CONFIG.SOIL_SCALE_M, 'soil_response');
var soilHsgAreaTable = calculateAreaTable(soilHsg, SOIL_HSG_CLASSES,
  CONFIG.SOIL_SCALE_M, 'soil_hsg_proxy');
var soilHsgUsedAreaTable = calculateAreaTable(soilHsgForC, SOIL_HSG_CLASSES,
  CONFIG.SOIL_SCALE_M, 'soil_hsg_used_for_SCS_CN');
var soilCTextureAreaTable = calculateAreaTable(soilCTexture,
  C_SOIL_TEXTURE_CLASSES, CONFIG.SOIL_SCALE_M, 'C_soil_texture');
var primaryCoverAreaTable = calculateAreaTable(primaryCover,
  PRIMARY_COVER_CLASSES, CONFIG.LULC_SCALE_M, 'C_primary_land_cover');
var slopeAreaTable = calculateAreaTable(slopeClass, SLOPE_CLASSES,
  CONFIG.TERRAIN_SCALE_M, 'slope_class');
var cSlopeAreaTable = calculateAreaTable(cSlopeClass, C_SLOPE_CLASSES,
  CONFIG.TERRAIN_SCALE_M, 'C_slope_class');
var ircSurfaceAreaTable = calculateAreaTable(ircSurfaceClass,
  IRC_SURFACE_CLASSES, CONFIG.LULC_SCALE_M, 'IRC_surface_class');
var cSourceAreaTable = calculateAreaTable(cSource, C_SOURCE_CLASSES,
  CONFIG.C_SCALE_M, 'C_source');
var cConfidenceAreaTable = calculateAreaTable(cConfidence,
  C_CONFIDENCE_CLASSES, CONFIG.C_SCALE_M, 'C_confidence');
var coverConditionAreaTable = calculateAreaTable(coverCondition, C_COVER_CLASSES,
  CONFIG.LULC_SCALE_M, 'C_source_cover_condition');
var cClassAreaTable = calculateAreaTable(cClassImage, C_CLASSES,
  CONFIG.C_SCALE_M, 'C_class');

var cAnalysisDomainMask = ee.Image(1).byte()
  .clip(catchmentGeometry).mask();
var validC = cCentral.mask().and(cAnalysisDomainMask)
  .rename('valid_C_mask');
var unresolvedCMask = cAnalysisDomainMask.and(validC.not())
  .rename('unresolved_C_mask');
var unsupportedCLulcMask = unresolvedCMask.rename(
  'unresolved_C_primary_assignment');
var cRasterAreaM2 = reduceStat(
  ee.Image.pixelArea().rename('c_raster_area_m2')
    .updateMask(cAnalysisDomainMask),
  ee.Reducer.sum(), 'c_raster_area_m2', CONFIG.C_SCALE_M, 0
);
var unsupportedCLulcAreaHa = reduceStat(
  ee.Image.pixelArea().rename('unsupported_area_m2')
    .updateMask(unresolvedCMask),
  ee.Reducer.sum(), 'unsupported_area_m2', CONFIG.C_SCALE_M, 0
).divide(10000);

var cLookupTable = ee.FeatureCollection(C_LOOKUP_ROWS.map(function(row) {
  return ee.Feature(null, row);
}));

var weightedC = calculateWeightedC(cCentral);
var cMinimum = reduceStat(cCentral, ee.Reducer.min(), 'C_primary',
  CONFIG.C_SCALE_M, 0);
var cMaximum = reduceStat(cCentral, ee.Reducer.max(), 'C_primary',
  CONFIG.C_SCALE_M, 0);

var validAreaM2 = reduceStat(
  ee.Image.pixelArea().rename('valid_area_m2').updateMask(validC),
  ee.Reducer.sum(), 'valid_area_m2', CONFIG.C_SCALE_M, 0
);
var unresolvedAreaM2 = reduceStat(
  ee.Image.pixelArea().rename('unresolved_area_m2').updateMask(unresolvedCMask),
  ee.Reducer.sum(), 'unresolved_area_m2', CONFIG.C_SCALE_M, 0
);
var validCoveragePct = validAreaM2.divide(cRasterAreaM2.max(1)).multiply(100);
var unresolvedCoveragePct = unresolvedAreaM2
  .divide(cRasterAreaM2.max(1)).multiply(100);
var coverageClosureM2 = validAreaM2.add(unresolvedAreaM2);
var coverageClosureErrorPct = coverageClosureM2.subtract(cRasterAreaM2).abs()
  .divide(cRasterAreaM2.max(1)).multiply(100);
var rasterVsGeodesicAreaErrorPct = cRasterAreaM2.subtract(areaM2).abs()
  .divide(areaM2.max(1)).multiply(100);

// Every unresolved C pixel receives an explicit diagnostic reason. Valid C
// pixels are kept at reason code 0 and are masked from the reason table/map.
var reasonWater = primaryCover.eq(6);
var reasonOther = primaryCover.eq(7);
var reasonNoLandCover = primaryCover.eq(0);
var reasonMissingSoil = soilCTexture.eq(0)
  .and(primaryCover.neq(6)).and(primaryCover.neq(7));
var reasonMissingSlope = cSlopeClass.mask().not();
var reasonGt30Unresolved = cSlopeClass.eq(4).and(ircSurfaceClass.eq(0))
  .and(primaryCover.neq(0)).and(primaryCover.neq(6)).and(primaryCover.neq(7));
var reasonBareRockAmbiguity = primaryCover.eq(4).and(cSlopeClass.eq(4))
  .and(ircSurfaceClass.eq(0));
var reasonMaskIssue = primaryCover.mask().not()
  .or(soilCTexture.mask().not()).or(cSlopeClass.mask().not());
var reasonKnown = reasonWater.or(reasonOther).or(reasonNoLandCover)
  .or(reasonMissingSoil).or(reasonMissingSlope)
  .or(reasonGt30Unresolved).or(reasonBareRockAmbiguity);
var cReason = ee.Image(0).byte()
  .where(unresolvedCMask, 9)
  .where(reasonWater.and(unresolvedCMask), 6)
  .where(reasonOther.and(unresolvedCMask), 7)
  .where(reasonNoLandCover.and(unresolvedCMask), 1)
  .where(reasonMissingSoil.and(unresolvedCMask), 2)
  .where(reasonMissingSlope.and(unresolvedCMask), 3)
  .where(reasonGt30Unresolved.and(unresolvedCMask), 4)
  .where(reasonBareRockAmbiguity.and(unresolvedCMask), 5)
  .where(reasonMaskIssue.and(unresolvedCMask).and(reasonKnown.not()), 8)
  .updateMask(unresolvedCMask)
  .rename('C_reason')
  .clip(catchmentGeometry);
var cReasonBand = cReason.unmask(0).rename('C_REASON')
  .clip(catchmentGeometry);
var cMissingReason = cReason.rename('C_missing_reason');
var cMissingReasonClasses = C_REASON_CLASSES;
var cMissingReasonAreaTable = calculateAreaTable(cMissingReason,
  cMissingReasonClasses, CONFIG.C_SCALE_M, 'C_reason');
var cReasonTotalAreaHa = reduceStat(
  ee.Image.pixelArea().rename('c_reason_area_m2')
    .updateMask(cReason.mask()),
  ee.Reducer.sum(), 'c_reason_area_m2', CONFIG.C_SCALE_M, 0
).divide(10000);
var reasonClosureErrorPct = cReasonTotalAreaHa
  .subtract(unresolvedAreaM2.divide(10000)).abs()
  .divide(unresolvedAreaM2.divide(10000).max(0.0001)).multiply(100);

var weightedCN = calculateWeightedC(cnImage);
var cnValidAreaM2 = reduceStat(
  ee.Image.pixelArea().rename('cn_valid_area_m2').updateMask(cnImage.mask()),
  ee.Reducer.sum(), 'cn_valid_area_m2', CONFIG.C_SCALE_M, 0
);
var cnCoveragePct = cnValidAreaM2.divide(areaM2.max(1)).multiply(100);
var weightedSCSRunoffDepthMm = calculateWeightedC(scsRunoffDepthImage);
var scsRunoffVolumeM3 = weightedSCSRunoffDepthMm
  .multiply(cnValidAreaM2).divide(1000);
var bareHighConfidenceAreaHa = reduceStat(
  ee.Image.pixelArea().rename('bare_high_confidence_area_m2')
    .updateMask(bareRockConfidence.eq(3)),
  ee.Reducer.sum(), 'bare_high_confidence_area_m2', CONFIG.LULC_SCALE_M, 0
).divide(10000);
var bareModerateConfidenceAreaHa = reduceStat(
  ee.Image.pixelArea().rename('bare_moderate_confidence_area_m2')
    .updateMask(bareRockConfidence.eq(2)),
  ee.Reducer.sum(), 'bare_moderate_confidence_area_m2', CONFIG.LULC_SCALE_M, 0
).divide(10000);

print('Catchment area result', ee.Dictionary({
  area_m2: areaM2,
  area_ha: areaHa,
  area_km2: areaKm2
}));
print('Terrain statistics', ee.Dictionary({
  minimum_elevation_m: minElevation,
  maximum_elevation_m: maxElevation,
  mean_elevation_m: meanElevation,
  mean_slope_pct: meanSlopePct,
  maximum_slope_pct: maxSlopePct
}));
print('Rainfall climatology context only', ee.Dictionary({
  mean_annual_rainfall_mm: meanAnnualRainfall,
  source: CONFIG.CHIRPS_ID,
  period: CONFIG.CHIRPS_CONTEXT_START_YEAR + '-' + CONFIG.CHIRPS_CONTEXT_END_YEAR,
  note: 'Context/diagnostic layer only; this phase does not compute design rainfall intensity or peak discharge.'
}));
print('Terrain-aware grassland correction', ee.Dictionary({
  enabled: CONFIG.BARE_ROCK_CORRECTION_ENABLED,
  sentinel2_scene_count: s2Collection.size(),
  dynamic_world_scene_count: dynamicWorldCollection.size(),
  corrected_area_ha: bareRockCorrectionAreaHa,
  corrected_area_percent: bareRockCorrectionAreaHa.divide(areaHa.max(1)).multiply(100),
  rule: 'WorldCover grassland + slope >= ' + CONFIG.BARE_ROCK_MIN_SLOPE_PCT +
    '% + (Sentinel-2 spectral evidence OR Dynamic World bare probability OR forced very-steep rule)',
  note: 'Review the correction mask against imagery and field observations.'
}));
print('LULC composition table', lulcAreaTable);
print('Raw WorldCover composition table', rawLulcAreaTable);
print('Soil texture composition table', soilTextureAreaTable);
print('Soil response group table', soilResponseAreaTable);
print('Texture-derived hydrologic soil group proxy table', soilHsgAreaTable);
print('HSG used for SCS-CN/diagnostics table', soilHsgUsedAreaTable);
print('Primary C soil-texture table', soilCTextureAreaTable);
print('Primary C land-cover table', primaryCoverAreaTable);
print('IRC >30% surface-condition table', ircSurfaceAreaTable);
print('C source table', cSourceAreaTable);
print('C confidence table', cConfidenceAreaTable);
print('C source cover-condition table', coverConditionAreaTable);
print('C missing-reason table', cMissingReasonAreaTable);
print('Slope class table', slopeAreaTable);
print('C slope class table', cSlopeAreaTable);
print('Unresolved primary C area', unsupportedCLulcAreaHa);
print('Indian C source tables', {
  government_wapcos: GOVERNMENT_C_TABLE,
  irc_sp13_fixed: IRC_SP13_FIXED_C,
  primary_method: '0-30% Government/WAPCOS table; >30% independent IRC surface-condition branch; no arbitrary slope extrapolation'
});
print('Independent SCS-CN cross-check', ee.Dictionary({
  weighted_cn: weightedCN,
  storm_depth_mm: CONFIG.SCS_CN_STORM_DEPTH_MM,
  runoff_depth_mm: weightedSCSRunoffDepthMm,
  runoff_volume_m3: scsRunoffVolumeM3,
  valid_cn_coverage_pct: cnCoveragePct,
  source: SCS_CN_SOURCE
}));
print('SCS-CN source table', SCS_CN_TABLE);
print('C class area table', cClassAreaTable);
print('Primary runoff coefficient result', ee.Dictionary({
  C_primary: weightedC,
  C_minimum: cMinimum,
  C_maximum: cMaximum,
  valid_C_coverage_percent: validCoveragePct,
  valid_C_area_ha: validAreaM2.divide(10000),
  unresolved_C_area_ha: unresolvedAreaM2.divide(10000),
  coverage_closure_error_percent: coverageClosureErrorPct
}));
print('FINAL CHECK-DAM CATCHMENT C REPORT', ee.Dictionary({
  catchment_area_ha: areaHa,
  valid_c_area_ha: validAreaM2.divide(10000),
  unresolved_c_area_ha: unresolvedAreaM2.divide(10000),
  valid_c_coverage_percent: validCoveragePct,
  wapcos_c_area_ha: tableValue(cSourceAreaTable, 101, 'area_ha'),
  irc_c_area_ha: tableValue(cSourceAreaTable, 201, 'area_ha')
    .add(tableValue(cSourceAreaTable, 202, 'area_ha'))
    .add(tableValue(cSourceAreaTable, 203, 'area_ha'))
    .add(tableValue(cSourceAreaTable, 204, 'area_ha'))
    .add(tableValue(cSourceAreaTable, 205, 'area_ha'))
    .add(tableValue(cSourceAreaTable, 206, 'area_ha'))
    .add(tableValue(cSourceAreaTable, 207, 'area_ha'))
    .add(tableValue(cSourceAreaTable, 208, 'area_ha'))
    .add(tableValue(cSourceAreaTable, 209, 'area_ha'))
    .add(tableValue(cSourceAreaTable, 210, 'area_ha')),
  field_override_c_area_ha: tableValue(cSourceAreaTable, 301, 'area_ha'),
  unresolved_source_area_ha: tableValue(cSourceAreaTable, 999, 'area_ha'),
  weighted_c: weightedC,
  minimum_c: cMinimum,
  maximum_c: cMaximum,
  scs_cn_runoff_depth_mm: weightedSCSRunoffDepthMm,
  scs_cn_runoff_volume_m3: scsRunoffVolumeM3,
  coverage_target_met: validCoveragePct.gte(CONFIG.C_COMPLETE_COVERAGE_TARGET_PCT)
    .and(coverageClosureErrorPct.lte(1))
}));

// ==========================================================================
// 5. MAP LAYERS
// ==========================================================================

Map.centerObject(catchmentGeometry, 12);
Map.setOptions('SATELLITE');

var boundaryLayer = Map.addLayer(
  catchment.style({color: '00ffff', fillColor: '00000000', width: 3}),
  {}, 'Catchment boundary (always visible)', true
);
var demLayer = Map.addLayer(dem, {
  min: 0,
  max: 1500,
  palette: ['081d58', '225ea8', '41b6c4', 'a1dab4', 'ffffcc']
}, 'Elevation / DEM', false);
var hillshadeLayer = Map.addLayer(hillshade, {
  min: 0,
  max: 255,
  palette: ['000000', 'ffffff']
}, 'Hillshade', false);
var slopeLayer = Map.addLayer(slopePct, {
  min: 0,
  max: 60,
  palette: ['1a9850', '91cf60', 'd9ef8b', 'fee08b', 'f46d43', 'd73027']
}, 'Slope (%)', false);
var lulcLayer = Map.addLayer(lulcHydro, {
  min: 1,
  max: 8,
  palette: LULC_CLASSES.map(function(definition) { return definition.color; })
}, 'Hydrologic LULC', true);
var lulcRawLayer = Map.addLayer(lulcHydroRaw, {
  min: 1,
  max: 8,
  palette: LULC_CLASSES.map(function(definition) { return definition.color; })
}, 'Hydrologic LULC before terrain correction', false);
var primaryCoverLayer = Map.addLayer(primaryCover, {
  min: 1,
  max: 7,
  palette: PRIMARY_COVER_CLASSES.map(function(definition) { return definition.color; })
}, 'Primary C land-cover class', false);
var worldCoverLayer = Map.addLayer(worldCover, {
  min: 10,
  max: 100,
  palette: ['006400', 'ffbb22', 'ffff4c', 'f096ff', 'fa0000', 'b4b4b4',
    'f0f0f0', '0064c8', '0096a0', '00cf75', 'fae6a0']
}, 'ESA WorldCover raw classes', false);
var s2RgbLayer = Map.addLayer(s2Composite, {
  bands: ['B4', 'B3', 'B2'],
  min: 0.02,
  max: 0.30
}, 'Sentinel-2 RGB used for correction', false);
var s2NdviLayer = Map.addLayer(s2Ndvi, {
  min: 0,
  max: 0.80,
  palette: ['8c510a', 'd8b365', 'f6e8c3', 'c7eae5', '5ab4ac', '01665e']
}, 'Sentinel-2 NDVI', false);
var s2EviLayer = Map.addLayer(s2Evi, {
  min: 0,
  max: 0.80,
  palette: ['8c510a', 'd8b365', 'f6e8c3', 'c7eae5', '5ab4ac', '01665e']
}, 'Sentinel-2 EVI', false);
var s2BsiLayer = Map.addLayer(s2Bsi, {
  min: -0.30,
  max: 0.40,
  palette: ['2166ac', '67a9cf', 'd1e5f0', 'fddbc7', 'ef8a62', 'b2182b']
}, 'Sentinel-2 bare-surface index', false);
var dynamicWorldBareLayer = Map.addLayer(dynamicWorldBareProbability, {
  min: 0,
  max: 1,
  palette: ['ffffff', 'fddbc7', 'ef8a62', 'b2182b']
}, 'Dynamic World bare probability', false);
var dynamicWorldGrassLayer = Map.addLayer(dynamicWorldGrassProbability, {
  min: 0,
  max: 1,
  palette: ['ffffff', 'd9f0a3', '78c679', '238443']
}, 'Dynamic World grass probability', false);
var dynamicWorldTreeLayer = Map.addLayer(dynamicWorldTreeProbability, {
  min: 0,
  max: 1,
  palette: ['ffffff', 'c7e9c0', '74c476', '238b45']
}, 'Dynamic World tree probability', false);
var sentinel1VvMapLayer = Map.addLayer(sentinel1VvLayer, {
  min: -25,
  max: 5,
  palette: ['081d58', '225ea8', '41b6c4', 'a1dab4', 'ffffcc']
}, 'Sentinel-1 VV (validation)', false);
var sentinel1VhMapLayer = Map.addLayer(sentinel1VhLayer, {
  min: -30,
  max: 0,
  palette: ['081d58', '225ea8', '41b6c4', 'a1dab4', 'ffffcc']
}, 'Sentinel-1 VH (validation)', false);
var sentinel1DifferenceMapLayer = Map.addLayer(sentinel1VvVhDifference, {
  min: 0,
  max: 15,
  palette: ['ffffff', 'fddbc7', 'ef8a62', 'b2182b']
}, 'Sentinel-1 VV-VH (validation)', false);
var bareRockCorrectionLayer = Map.addLayer(bareRockCorrectionMask.selfMask(), {
  palette: ['ff00ff']
}, 'Grassland to Bare/Rocky correction mask', false);
var bareRockConfidenceLayer = Map.addLayer(bareRockConfidence, {
  min: 1,
  max: 3,
  palette: ['fee08b', 'fdae61', 'd73027']
}, 'Bare-rock confidence (1 low, 3 high)', false);
var coverConditionLayer = Map.addLayer(coverCondition, {
  min: 1,
  max: 12,
  palette: C_COVER_CLASSES.map(function(definition) { return definition.color; })
}, 'C source cover condition', false);
var soilLayer = Map.addLayer(soilResponse, {
  min: 1,
  max: 3,
  palette: SOIL_RESPONSE_CLASSES.map(function(definition) { return definition.color; })
}, 'Soil response proxy (250 m)', false);
var soilHsgLayer = Map.addLayer(soilHsg, {
  min: 1,
  max: 4,
  palette: SOIL_HSG_CLASSES.map(function(definition) { return definition.color; })
}, 'Hydrologic soil group proxy (250 m)', false);
var hsgProbabilityLayer = Map.addLayer(hsgProbabilityMax, {
  min: 0.25,
  max: 1,
  palette: ['d73027', 'fdae61', 'ffffbf', 'a6d96a', '1a9850']
}, 'HSG proxy confidence (texture/property screening)', false);
var soilSandLayer = Map.addLayer(soilSandPct, {
  min: 0,
  max: 100,
  palette: ['d73027', 'fdae61', 'ffffbf', 'a6d96a', '1a9850']
}, 'Soil sand % (250 m)', false);
var soilClayLayer = Map.addLayer(soilClayPct, {
  min: 0,
  max: 100,
  palette: ['ffffcc', 'c2e699', '78c679', '238443', '004529']
}, 'Soil clay % (250 m)', false);
var soilWaterLayer = Map.addLayer(soilWater33kPa, {
  min: 0,
  max: 50,
  palette: ['ffffcc', 'c7e9b4', '7fcdbb', '2c7fb8', '253494']
}, 'Soil water at 33 kPa (250 m)', false);
var soilBulkDensityLayer = Map.addLayer(soilBulkDensity, {
  min: 5,
  max: 185,
  palette: ['2166ac', '67a9cf', 'ffffbf', 'fdae61', 'd73027']
}, 'Soil bulk density native units (250 m)', false);
var soilTextureLayer = Map.addLayer(soilTexture, {
  min: 1,
  max: 12,
  palette: ['d5c36b', 'b96947', '9d3706', 'ae868f', 'f86714', '46d143',
    '368f20', '3e5a14', 'ffd557', 'fff72e', 'ff5a9d', 'ff005b']
}, 'Soil texture class (250 m)', false);
var cSoilTextureLayer = Map.addLayer(soilCTexture, {
  min: 1,
  max: 3,
  palette: C_SOIL_TEXTURE_CLASSES.map(function(definition) { return definition.color; })
}, 'Primary C soil texture/infiltration class (250 m)', false);
var cSlopeClassLayer = Map.addLayer(cSlopeClass, {
  min: 1,
  max: 4,
  palette: C_SLOPE_CLASSES.map(function(definition) { return definition.color; })
}, 'Primary C slope class', false);
var ircSurfaceClassLayer = Map.addLayer(ircSurfaceClass, {
  min: 0,
  max: 10,
  palette: ['ffffff'].concat(IRC_SURFACE_CLASSES.map(function(definition) {
    return definition.color;
  }))
}, 'IRC >30% surface class', false);
var cSourceLayer = Map.addLayer(cSourceDisplay, {
  min: 0,
  max: C_SOURCE_CLASSES.length - 1,
  palette: C_SOURCE_CLASSES.map(function(definition) { return definition.color; })
}, 'C source map (legend order; export retains 101/201/.../999 codes)', false);
var cConfidenceLayer = Map.addLayer(cConfidence, {
  min: 0,
  max: 3,
  palette: ['d73027', 'fdae61', '91cf60', '1a9850']
}, 'C confidence map (0 unresolved, 1 low, 2 moderate, 3 high)', false);
var cnLayer = Map.addLayer(cnImage, {
  min: 0,
  max: 100,
  palette: ['2166ac', '67a9cf', 'ffffbf', 'fdae61', 'd73027']
}, 'SCS-CN cross-check map', false);
var scsRunoffDepthLayer = Map.addLayer(scsRunoffDepthImage, {
  min: 0,
  max: 150,
  palette: ['ffffff', 'c7e9b4', '7fcdbb', '2c7fb8', '253494']
}, 'SCS-CN runoff depth cross-check', false);
var cLayer = Map.addLayer(cCentral, {
  min: 0,
  max: 1.0,
  palette: ['2c7bb6', 'abd9e9', 'ffffbf', 'fdae61', 'f46d43', 'd7191c']
}, 'C map (Government table + named IRC surfaces)', true);
var cClassLayer = Map.addLayer(cClassImage, {
  min: 1,
  max: 6,
  palette: C_CLASSES.map(function(definition) { return definition.color; })
}, 'C classes', false);
var rainfallContextLayer = Map.addLayer(meanAnnualRainfallImage, {
  min: 400,
  max: 1200,
  palette: ['fff7bc', 'fec44f', 'fe9929', 'ec7014', 'cc4c02', '993404']
}, 'CHIRPS mean annual rainfall (context only)', false);

var optionalStreamLayer = null;
if (CONFIG.STREAM_ASSET !== '') {
  var streams = ee.FeatureCollection(CONFIG.STREAM_ASSET)
    .filterBounds(catchmentGeometry);
  optionalStreamLayer = Map.addLayer(
    streams.style({color: '00bfff', width: 2}), {}, 'Optional validated streams', false
  );
  print('Optional stream asset', CONFIG.STREAM_ASSET);
} else {
  print('Drainage/streams',
    'No stream asset supplied; this C-only phase does not infer drainage from the DSM.');
}

// ==========================================================================
// 6. DASHBOARD / UI
// ==========================================================================

var metricLabels = {};
var weightedCClient = null;
var areaHaClient = null;
var cCoverageClient = null;
var cnCoverageClient = null;
var weightedCNClient = null;
var scsRunoffDepthClient = null;
var scsRunoffVolumeClient = null;
var observedCClient = null;
var observedRainfallClient = null;
var observedDischargeClient = null;
var observedVolumeClient = null;
var observedCModelBiasClient = null;
var observedCModelMaeClient = null;
var observedCModelRmseClient = null;
var observedCModelErrorPctClient = null;

var dashboard = ui.Panel({
  style: {
    width: '390px',
    padding: '10px',
    backgroundColor: '#f7f7f7'
  }
});

dashboard.add(ui.Label('CHECK-DAM CATCHMENT', {
  fontSize: '20px', fontWeight: 'bold', color: '#124559'
}));
dashboard.add(ui.Label('RUNOFF COEFFICIENT DSS (C-ONLY)', {
  fontSize: '15px', fontWeight: 'bold', color: '#124559', margin: '0 0 8px 0'
}));
dashboard.add(ui.Label(
  'Analysis boundary: the uploaded upstream contributing catchment only. ' +
  'Peak discharge / time of concentration are a separate later module.',
  {fontSize: '12px', color: '#555555', margin: '0 0 8px 0'}
));

var summaryPanel = ui.Panel({style: {margin: '4px 0 8px 0'}});
summaryPanel.add(ui.Label('CATCHMENT SUMMARY', {
  fontWeight: 'bold', color: '#124559'
}));
makeMetricRow(summaryPanel, 'area_ha', 'Catchment area', 'ha');
makeMetricRow(summaryPanel, 'area_km2', 'Catchment area', 'km2');
makeMetricRow(summaryPanel, 'mean_elevation_m', 'Mean elevation', 'm');
makeMetricRow(summaryPanel, 'mean_slope_pct', 'Mean slope', '%');
makeMetricRow(summaryPanel, 'max_slope_pct', 'Maximum slope', '%');
makeMetricRow(summaryPanel, 'c_raster_area_ha', '30-m C-grid area', 'ha');
makeMetricRow(summaryPanel, 'coverage_closure_error_pct', 'C area closure error', '%');
makeMetricRow(summaryPanel, 'reason_closure_error_pct', 'C reason closure error', '%');
makeMetricRow(summaryPanel, 'raster_vs_geodesic_error_pct', 'Raster vs geodesic area difference', '%');
dashboard.add(summaryPanel);

var lulcPanel = ui.Panel({style: {margin: '4px 0 8px 0'}});
lulcPanel.add(ui.Label('LAND-USE / LAND-COVER COMPOSITION', {
  fontWeight: 'bold', color: '#124559'
}));
LULC_CLASSES.forEach(function(definition) {
  makeMetricRow(lulcPanel, 'lulc_' + definition.field + '_ha', definition.label, 'ha');
});
makeMetricRow(lulcPanel, 'bare_rock_correction_ha',
  'Terrain correction added', 'ha');
dashboard.add(lulcPanel);

var coverConditionPanel = ui.Panel({style: {margin: '4px 0 8px 0'}});
coverConditionPanel.add(ui.Label('SURFACE CONDITION EVIDENCE / VALIDATION', {
  fontWeight: 'bold', color: '#124559'
}));
C_COVER_CLASSES.forEach(function(definition) {
  makeMetricRow(coverConditionPanel, 'cover_' + definition.field + '_ha',
    definition.label, 'ha');
});
coverConditionPanel.add(ui.Label(
  'These are supporting surface-condition categories used to justify special IRC surfaces. They do not numerically multiply the primary Government land-cover/soil-texture/slope C table.',
  {fontSize: '11px', color: '#666666', margin: '4px 0 0 0'}
));
dashboard.add(coverConditionPanel);

var primaryCPanel = ui.Panel({style: {margin: '4px 0 8px 0'}});
primaryCPanel.add(ui.Label('PRIMARY C INPUT CLASSES', {
  fontWeight: 'bold', color: '#124559'
}));
PRIMARY_COVER_CLASSES.forEach(function(definition) {
  makeMetricRow(primaryCPanel, 'primary_cover_' + definition.field + '_ha',
    definition.label, 'ha');
});
C_SLOPE_CLASSES.forEach(function(definition) {
  makeMetricRow(primaryCPanel, 'cslope_' + definition.field + '_ha',
    definition.label, 'ha');
});
var missingCReasonClassesForUi = C_REASON_CLASSES.map(function(definition) {
  return {
    code: definition.code,
    field: definition.field,
    label: 'Missing: ' + definition.label
  };
});
missingCReasonClassesForUi.forEach(function(definition) {
  makeMetricRow(primaryCPanel, 'c_missing_' + definition.field + '_ha',
    definition.label, 'ha');
});
primaryCPanel.add(ui.Label(
  'The Government/WAPCOS table is applied only to 0-30% slope. >30% pixels enter the IRC surface-condition branch; slope alone never assigns C. The missing-C rows explain the coverage gate.',
  {fontSize: '11px', color: '#8a5a00', margin: '4px 0 0 0'}
));
dashboard.add(primaryCPanel);

var ircPanel = ui.Panel({style: {margin: '4px 0 8px 0'}});
ircPanel.add(ui.Label('IRC >30% SURFACE-CONDITION BRANCH', {
  fontWeight: 'bold', color: '#124559'
}));
IRC_SURFACE_CLASSES.forEach(function(definition) {
  makeMetricRow(ircPanel, 'irc_surface_' + definition.field + '_ha',
    definition.label + ' (C=' + definition.c.toFixed(2) + ')', 'ha');
});
C_SOURCE_CLASSES.forEach(function(definition) {
  makeMetricRow(ircPanel, 'c_source_' + definition.field + '_ha',
    'Source: ' + definition.label, 'ha');
});
C_CONFIDENCE_CLASSES.forEach(function(definition) {
  makeMetricRow(ircPanel, 'c_confidence_' + definition.field + '_ha',
    'Confidence: ' + definition.label, 'ha');
  makeMetricRow(ircPanel, 'c_confidence_' + definition.field + '_pct',
    'Confidence: ' + definition.label, '% of C grid');
});
ircPanel.add(ui.Label(
  'IRC coefficients are suggested surface-condition values. They are not measured catchment-specific coefficients, and no value is assigned from slope alone.',
  {fontSize: '11px', color: '#8a5a00', margin: '4px 0 0 0'}
));
dashboard.add(ircPanel);

var soilPanel = ui.Panel({style: {margin: '4px 0 8px 0'}});
soilPanel.add(ui.Label('SOIL RESPONSE SUMMARY', {
  fontWeight: 'bold', color: '#124559'
}));
SOIL_RESPONSE_CLASSES.forEach(function(definition) {
  makeMetricRow(soilPanel, 'soil_' + definition.field + '_ha', definition.label, 'ha');
});
SOIL_HSG_CLASSES.forEach(function(definition) {
  makeMetricRow(soilPanel, 'soil_' + definition.field + '_ha', definition.label, 'ha');
});
C_SOIL_TEXTURE_CLASSES.forEach(function(definition) {
  makeMetricRow(soilPanel, 'csoil_' + definition.field + '_ha',
    definition.label, 'ha');
});
makeMetricRow(soilPanel, 'mean_sand_pct', 'Mean sand evidence', '%');
makeMetricRow(soilPanel, 'mean_clay_pct', 'Mean clay evidence', '%');
makeMetricRow(soilPanel, 'mean_hsg_proxy_confidence', 'Mean HSG proxy confidence', '');
soilPanel.add(ui.Label(
  'HSG is inferred from texture/property evidence only. Native soil information remains 250 m; it is not 10 m soil accuracy.',
  {fontSize: '11px', color: '#666666', margin: '4px 0 0 0'}
));
var fieldHsgInput = ui.Select({
  items: ['NONE', 'A', 'B', 'C', 'D'],
  value: CONFIG.FIELD_CONFIRMED_HSG,
  onChange: function(value) {
    inputStatus.setValue(
      'Field HSG selection changed to ' + value + '. Update CONFIG.FIELD_CONFIRMED_HSG and rerun the script to apply it to SCS-CN/diagnostics; primary C uses soil texture.'
    );
  },
  style: {width: '95px'}
});
soilPanel.add(ui.Panel([
  ui.Label('Field HSG override', {width: '155px'}), fieldHsgInput
], ui.Panel.Layout.flow('horizontal')));
soilPanel.add(ui.Label(
  'Select a field-confirmed catchment-wide HSG and rerun the script. The field value overrides the remote-sensing proxy for SCS-CN and HSG diagnostics; it does not replace the primary texture/slope C table.',
  {fontSize: '11px', color: '#8a5a00', margin: '4px 0 0 0'}
));
dashboard.add(soilPanel);

var runoffPanel = ui.Panel({style: {margin: '4px 0 8px 0'}});
runoffPanel.add(ui.Label('RUNOFF COEFFICIENT RESULT', {
  fontWeight: 'bold', color: '#124559'
}));
makeMetricRow(runoffPanel, 'weighted_c', 'Weighted C (primary)', '');
makeMetricRow(runoffPanel, 'c_min', 'Minimum C', '');
makeMetricRow(runoffPanel, 'c_max', 'Maximum C', '');
makeMetricRow(runoffPanel, 'valid_c_area_ha', 'Valid C area', 'ha');
makeMetricRow(runoffPanel, 'unresolved_c_area_ha', 'Unresolved C area', 'ha');
makeMetricRow(runoffPanel, 'c_coverage_pct', 'Valid C coverage', '%');
var confidenceUiLabel = ui.Label('Confidence: computing...', {
  fontSize: '12px', color: '#555555'
});
runoffPanel.add(confidenceUiLabel);
runoffPanel.add(ui.Label(
  'Primary C uses the Indian Government/WAPCOS land-cover + soil-texture + slope table. No peak discharge or rainfall intensity is computed in this phase.',
  {fontSize: '11px', color: '#666666', margin: '4px 0 0 0'}
));
var inputStatus = ui.Label('', {
  fontSize: '11px', color: '#9b2226', margin: '4px 0 0 0'
});
runoffPanel.add(inputStatus);
dashboard.add(runoffPanel);

var scsPanel = ui.Panel({style: {margin: '4px 0 8px 0'}});
scsPanel.add(ui.Label('INDEPENDENT SCS-CN CROSS-CHECK', {
  fontWeight: 'bold', color: '#124559'
}));
scsPanel.add(ui.Label(
  'This estimates runoff depth/volume only. It is not converted into Rational-Method C or Q.',
  {fontSize: '11px', color: '#666666', margin: '2px 0 5px 0'}
));
makeMetricRow(scsPanel, 'weighted_cn', 'Weighted CN', '');
makeMetricRow(scsPanel, 'cn_coverage_pct', 'Valid CN coverage', '%');
makeMetricRow(scsPanel, 'scs_runoff_depth_mm', 'Runoff depth', 'mm');
makeMetricRow(scsPanel, 'scs_runoff_volume_m3', 'Runoff volume', 'm3');
var scsDepthInput = ui.Textbox({
  value: String(CONFIG.SCS_CN_STORM_DEPTH_MM),
  placeholder: 'storm depth mm',
  style: {width: '95px'}
});
scsPanel.add(ui.Panel([
  ui.Label('Storm depth (mm)', {width: '115px'}), scsDepthInput
], ui.Panel.Layout.flow('horizontal')));
var scsUpdateStatus = ui.Label('Spatial CN map uses the configured depth.', {
  fontSize: '11px', color: '#555555'
});
scsPanel.add(ui.Button({
  label: 'Update CN summary',
  onClick: updateSCSCrosscheck,
  style: {stretch: 'horizontal', margin: '5px 0 2px 0'}
}));
scsPanel.add(scsUpdateStatus);
scsPanel.add(ui.Label(
  'The map/export cross-check uses CONFIG.SCS_CN_STORM_DEPTH_MM. Change it there and rerun for a new spatial CN result.',
  {fontSize: '11px', color: '#8a5a00', margin: '4px 0 0 0'}
));
dashboard.add(scsPanel);

var validationPanel = ui.Panel({style: {margin: '4px 0 8px 0'}});
validationPanel.add(ui.Label('FIELD VALIDATION / CALIBRATION', {
  fontWeight: 'bold', color: '#124559'
}));
validationPanel.add(ui.Label(
  'Optional: enter independently observed rainfall + peak discharge (or runoff volume) to back-calculate an observed C and compare it against the modeled weighted C.',
  {fontSize: '11px', color: '#666666', margin: '2px 0 5px 0'}
));
var observedRainfallInput = ui.Textbox({placeholder: 'mm/hr', style: {width: '85px'}});
var observedDischargeInput = ui.Textbox({placeholder: 'm3/s', style: {width: '85px'}});
var observedVolumeInput = ui.Textbox({placeholder: 'm3', style: {width: '85px'}});
validationPanel.add(ui.Panel([
  ui.Label('Observed intensity', {width: '125px'}), observedRainfallInput
], ui.Panel.Layout.flow('horizontal')));
validationPanel.add(ui.Panel([
  ui.Label('Observed peak Q', {width: '125px'}), observedDischargeInput
], ui.Panel.Layout.flow('horizontal')));
validationPanel.add(ui.Panel([
  ui.Label('Observed volume', {width: '125px'}), observedVolumeInput
], ui.Panel.Layout.flow('horizontal')));
var validationResultLabel = ui.Label('Observed C = not calculated', {
  fontSize: '12px', color: '#555555'
});
validationPanel.add(ui.Button({
  label: 'Calculate observed validation',
  onClick: calculateObservedValidation,
  style: {stretch: 'horizontal', margin: '5px 0 2px 0'}
}));
validationPanel.add(validationResultLabel);
makeMetricRow(validationPanel, 'observed_c_model_bias', 'C model bias', 'C');
makeMetricRow(validationPanel, 'observed_c_model_mae', 'C model MAE', 'C');
makeMetricRow(validationPanel, 'observed_c_model_rmse', 'C model RMSE', 'C');
makeMetricRow(validationPanel, 'observed_c_model_error_pct', 'C percentage error', '%');
dashboard.add(validationPanel);

var layersPanel = ui.Panel({style: {margin: '4px 0 8px 0'}});
layersPanel.add(ui.Label('MAP LAYERS', {fontWeight: 'bold', color: '#124559'}));
addLayerToggle(layersPanel, 'Elevation / DEM', demLayer);
addLayerToggle(layersPanel, 'Hillshade', hillshadeLayer);
addLayerToggle(layersPanel, 'Slope', slopeLayer);
addLayerToggle(layersPanel, 'LULC', lulcLayer);
addLayerToggle(layersPanel, 'LULC before terrain correction', lulcRawLayer);
addLayerToggle(layersPanel, 'Primary C land cover', primaryCoverLayer);
addLayerToggle(layersPanel, 'WorldCover raw classes', worldCoverLayer);
addLayerToggle(layersPanel, 'Sentinel-2 RGB', s2RgbLayer);
addLayerToggle(layersPanel, 'Sentinel-2 NDVI', s2NdviLayer);
addLayerToggle(layersPanel, 'Sentinel-2 EVI', s2EviLayer);
addLayerToggle(layersPanel, 'Sentinel-2 bare-surface index', s2BsiLayer);
addLayerToggle(layersPanel, 'Dynamic World bare probability', dynamicWorldBareLayer);
addLayerToggle(layersPanel, 'Dynamic World grass probability', dynamicWorldGrassLayer);
addLayerToggle(layersPanel, 'Dynamic World tree probability', dynamicWorldTreeLayer);
addLayerToggle(layersPanel, 'Sentinel-1 VV validation', sentinel1VvMapLayer);
addLayerToggle(layersPanel, 'Sentinel-1 VH validation', sentinel1VhMapLayer);
addLayerToggle(layersPanel, 'Sentinel-1 VV-VH validation', sentinel1DifferenceMapLayer);
addLayerToggle(layersPanel, 'Grassland-to-bare correction', bareRockCorrectionLayer);
addLayerToggle(layersPanel, 'Bare-rock confidence', bareRockConfidenceLayer);
addLayerToggle(layersPanel, 'Surface-condition evidence', coverConditionLayer);
addLayerToggle(layersPanel, 'C missing reason', Map.addLayer(cMissingReason, {
  min: 1,
  max: C_REASON_CLASSES.length,
  palette: cMissingReasonClasses.map(function(definition) { return definition.color; })
}, 'C missing reason', false));
addLayerToggle(layersPanel, 'Soil response', soilLayer);
addLayerToggle(layersPanel, 'Hydrologic soil group proxy', soilHsgLayer);
addLayerToggle(layersPanel, 'HSG proxy confidence', hsgProbabilityLayer);
addLayerToggle(layersPanel, 'Soil sand %', soilSandLayer);
addLayerToggle(layersPanel, 'Soil clay %', soilClayLayer);
addLayerToggle(layersPanel, 'Soil water at 33 kPa', soilWaterLayer);
addLayerToggle(layersPanel, 'Soil bulk density', soilBulkDensityLayer);
addLayerToggle(layersPanel, 'Soil texture', soilTextureLayer);
addLayerToggle(layersPanel, 'Primary C soil texture', cSoilTextureLayer);
addLayerToggle(layersPanel, 'Primary C slope class', cSlopeClassLayer);
addLayerToggle(layersPanel, 'IRC >30% surface class', ircSurfaceClassLayer);
addLayerToggle(layersPanel, 'C source map', cSourceLayer);
addLayerToggle(layersPanel, 'C confidence map', cConfidenceLayer);
addLayerToggle(layersPanel, 'SCS-CN map', cnLayer);
addLayerToggle(layersPanel, 'SCS-CN runoff depth', scsRunoffDepthLayer);
addLayerToggle(layersPanel, 'C map', cLayer);
addLayerToggle(layersPanel, 'C classes', cClassLayer);
addLayerToggle(layersPanel, 'CHIRPS rainfall context', rainfallContextLayer);
if (optionalStreamLayer !== null) {
  addLayerToggle(layersPanel, 'Validated streams', optionalStreamLayer);
}
addLegend(layersPanel, 'C MAP LEGEND', C_CLASSES);
addLegend(layersPanel, 'PRIMARY C LAND-COVER LEGEND', PRIMARY_COVER_CLASSES);
addLegend(layersPanel, 'PRIMARY C SOIL LEGEND', C_SOIL_TEXTURE_CLASSES);
addLegend(layersPanel, 'PRIMARY C SLOPE LEGEND', C_SLOPE_CLASSES);
addLegend(layersPanel, 'IRC >30% SURFACE LEGEND', IRC_SURFACE_CLASSES);
addLegend(layersPanel, 'C SOURCE LEGEND', C_SOURCE_CLASSES);
addLegend(layersPanel, 'C CONFIDENCE LEGEND', C_CONFIDENCE_CLASSES);
addLegend(layersPanel, 'SURFACE-CONDITION EVIDENCE LEGEND', C_COVER_CLASSES);
dashboard.add(layersPanel);

var exportButton = ui.Button({
  label: 'Create export tasks',
  onClick: createExportTasks,
  style: {stretch: 'horizontal', margin: '4px 0 8px 0'}
});
dashboard.add(exportButton);

var warningPanel = ui.Panel({style: {margin: '4px 0 8px 0'}});
warningPanel.add(ui.Label('QUALITY-CONTROL WARNINGS', {
  fontWeight: 'bold', color: '#9b2226'
}));
warningPanel.add(ui.Label(
  'Final C analysis grid is 30 m: WorldCover provides 10-m land-cover evidence, terrain is approximately 30 m, and OpenLandMap soil retains approximately 250-m native information content. Resampling soil does not create 10-m/30-m soil observations.',
  {fontSize: '11px', color: '#9b2226', whiteSpace: 'pre-wrap'}
));
warningPanel.add(ui.Label(
  'C source: Indian Government/WAPCOS land-cover + soil-texture + slope table for 0-30% slope, plus an independent IRC:SP:13/IRC:SP:42 surface-condition branch above 30%. Slope alone never assigns an IRC value. Confirm the adopted project edition for final design.',
  {fontSize: '11px', color: '#9b2226', whiteSpace: 'pre-wrap'}
));
warningPanel.add(ui.Label(
  'Terrain-aware LULC correction: WorldCover grassland is reclassified as Bare/Rocky when slope >= ' +
    CONFIG.BARE_ROCK_MIN_SLOPE_PCT + '% plus either Sentinel-2 low-vegetation/bare evidence or Dynamic World bare probability. At slope >= ' +
    CONFIG.VERY_STEEP_SLOPE_PCT + '%, an optional field-confirmed local override is ' +
    (CONFIG.FORCE_BARE_ROCK_ON_VERY_STEEP_GRASSLAND ? 'enabled' : 'disabled') +
    '. Validate all corrections against imagery and field observations.',
  {fontSize: '11px', color: '#9b2226', whiteSpace: 'pre-wrap'}
));
warningPanel.add(ui.Label(
  'C_confidence is evidence strength, not accuracy: high = field/strong evidence; moderate = source-backed screening; low = proxy classification; unresolved = no C. Sentinel-1 is supporting validation only.',
  {fontSize: '11px', color: '#9b2226', whiteSpace: 'pre-wrap'}
));
warningPanel.add(ui.Label(
  'Exports are blocked unless valid C coverage reaches ' + CONFIG.C_COMPLETE_COVERAGE_TARGET_PCT + '%. Missing-C reasons are exported and mapped; no average C is used to fill gaps.',
  {fontSize: '11px', color: '#9b2226', whiteSpace: 'pre-wrap'}
));
warningPanel.add(ui.Label(
  'SCOPE: peak discharge, rainfall intensity, time of concentration, IDF, return period and check-dam hydraulic design are NOT part of this phase. A prior attempt at a MERIT-Hydro-based hydraulic path/Tc module was removed because Earth Engine rejected its iterative expression graph as "too complex" to evaluate; that will need a different (non-iterative) approach in a later module.',
  {fontSize: '11px', color: '#9b2226', whiteSpace: 'pre-wrap'}
));
dashboard.add(warningPanel);

var methodologyPanel = ui.Panel({style: {margin: '4px 0 8px 0'}});
methodologyPanel.add(ui.Label('METHODOLOGY / ASSUMPTIONS', {
  fontWeight: 'bold', color: '#124559'
}));
var methodologyText = [
  'Catchment: user-provided upstream contributing watershed, dissolved when multiple features exist.',
  'LULC: ESA WorldCover 2021 v200, 10 m.',
  'LULC correction: WorldCover grassland is screened with Sentinel-2 NDVI/BSI and Dynamic World bare probability. The optional very-steep local override is disabled by default because slope alone is not bare-rock evidence.',
  'Terrain: configurable Copernicus GLO-30 DSM or SRTM, approximately 30 m; used for slope classification only in this phase.',
  'Soil: OpenLandMap texture, sand, clay, bulk density and water-content evidence at native 250 m; HSG is a proxy unless field-confirmed.',
  'Rainfall context: CHIRPS mean annual rainfall for a fixed climatology period; context/diagnostic layer only, not used in the C computation.',
  'Runoff coefficient: 0-30% uses the Indian Government/WAPCOS land-cover + soil-texture + slope table. >30% activates an IRC:SP:13/IRC:SP:42 surface-condition branch: steep bare rock 0.90, rock with vegetation 0.80, plateau/light cover 0.70, bare stiff clay 0.60, stiff clay with vegetation 0.50, loam lightly covered 0.40, loam covered/turfed 0.30, sandy light growth 0.20 and sandy woodland/forest 0.10. These are suggested surface coefficients, not exact measured C values. NDVI/BSI/Dynamic World/Sentinel-1 are evidence only.',
  'Analysis grid: 30-m hydrological C grid using 10-m land-cover evidence and 250-m native soil evidence.',
  'Independent cross-check: SCS-CN reports runoff depth/volume only and is never mixed with Rational-Method C.',
  'Out of scope this phase: peak discharge Q, rainfall intensity I, time of concentration Tc, IDF curves, return period, flood routing, check-dam hydraulic design.',
  'Final methodology statement: The spatial runoff coefficient is derived using an Indian Government/WAPCOS land-cover-soil-texture-slope framework up to 30% slope, supplemented by source-based IRC surface-condition coefficients for steeper terrain. Remote-sensing datasets classify and validate conditions but do not arbitrarily multiply C. Soil retains native spatial resolution. C is area-weighted over the delineated upstream catchment.',
  'Final design requires applicable standards, field validation and competent review.'
].join('\n');
methodologyPanel.add(ui.Label(
  methodologyText,
  {fontSize: '11px', color: '#555555', whiteSpace: 'pre-wrap'}
));
dashboard.add(methodologyPanel);

ui.root.insert(0, dashboard);

// ==========================================================================
// 7. UI ASYNCHRONOUS RESULTS AND WARNINGS
// ==========================================================================

var uiSummaryValues = {
  area_ha: areaHa,
  area_km2: areaKm2,
  mean_elevation_m: meanElevation,
  mean_slope_pct: meanSlopePct,
  max_slope_pct: maxSlopePct,
  c_raster_area_ha: cRasterAreaM2.divide(10000),
  valid_c_area_ha: validAreaM2.divide(10000),
  unresolved_c_area_ha: unresolvedAreaM2.divide(10000),
  unresolved_c_coverage_pct: unresolvedCoveragePct,
  coverage_closure_error_pct: coverageClosureErrorPct,
  reason_closure_error_pct: reasonClosureErrorPct,
  raster_vs_geodesic_error_pct: rasterVsGeodesicAreaErrorPct,
  mean_annual_rainfall_mm: meanAnnualRainfall,
  weighted_c: weightedC,
  c_min: cMinimum,
  c_max: cMaximum,
  c_coverage_pct: validCoveragePct,
  bare_rock_correction_ha: bareRockCorrectionAreaHa,
  weighted_cn: weightedCN,
  cn_coverage_pct: cnCoveragePct,
  scs_runoff_depth_mm: weightedSCSRunoffDepthMm,
  scs_runoff_volume_m3: scsRunoffVolumeM3,
  mean_sand_pct: meanSandPct,
  mean_clay_pct: meanClayPct,
  mean_hsg_proxy_confidence: meanHsgProxyConfidence
};

LULC_CLASSES.forEach(function(definition) {
  uiSummaryValues['lulc_' + definition.field + '_ha'] =
    tableValue(lulcAreaTable, definition.code, 'area_ha');
});
SOIL_RESPONSE_CLASSES.forEach(function(definition) {
  uiSummaryValues['soil_' + definition.field + '_ha'] =
    tableValue(soilResponseAreaTable, definition.code, 'area_ha');
});
SOIL_HSG_CLASSES.forEach(function(definition) {
  uiSummaryValues['soil_' + definition.field + '_ha'] =
    tableValue(soilHsgAreaTable, definition.code, 'area_ha');
});
C_SOIL_TEXTURE_CLASSES.forEach(function(definition) {
  uiSummaryValues['csoil_' + definition.field + '_ha'] =
    tableValue(soilCTextureAreaTable, definition.code, 'area_ha');
});
PRIMARY_COVER_CLASSES.forEach(function(definition) {
  uiSummaryValues['primary_cover_' + definition.field + '_ha'] =
    tableValue(primaryCoverAreaTable, definition.code, 'area_ha');
});
C_SLOPE_CLASSES.forEach(function(definition) {
  uiSummaryValues['cslope_' + definition.field + '_ha'] =
    tableValue(cSlopeAreaTable, definition.code, 'area_ha');
});
IRC_SURFACE_CLASSES.forEach(function(definition) {
  uiSummaryValues['irc_surface_' + definition.field + '_ha'] =
    tableValue(ircSurfaceAreaTable, definition.code, 'area_ha');
});
C_SOURCE_CLASSES.forEach(function(definition) {
  uiSummaryValues['c_source_' + definition.field + '_ha'] =
    tableValue(cSourceAreaTable, definition.code, 'area_ha');
});
C_CONFIDENCE_CLASSES.forEach(function(definition) {
  uiSummaryValues['c_confidence_' + definition.field + '_ha'] =
    tableValue(cConfidenceAreaTable, definition.code, 'area_ha');
  uiSummaryValues['c_confidence_' + definition.field + '_pct'] =
    tableValue(cConfidenceAreaTable, definition.code, 'area_ha')
      .divide(cRasterAreaM2.divide(10000).max(0.0001)).multiply(100);
});
missingCReasonClassesForUi.forEach(function(definition) {
  uiSummaryValues['c_missing_' + definition.field + '_ha'] =
    tableValue(cMissingReasonAreaTable, definition.code, 'area_ha');
});
C_COVER_CLASSES.forEach(function(definition) {
  uiSummaryValues['cover_' + definition.field + '_ha'] =
    tableValue(coverConditionAreaTable, definition.code, 'area_ha');
});

ee.Dictionary(uiSummaryValues).evaluate(function(values, error) {
  if (error || !values) {
    print('Dashboard statistics evaluation failed', error);
    inputStatus.setValue(
      'ERROR: dashboard statistics could not be evaluated. See the Console for the server message.'
    );
    return;
  }
  areaHaClient = Number(values.area_ha);
  cCoverageClient = Number(values.c_coverage_pct);
  cnCoverageClient = Number(values.cn_coverage_pct);
  weightedCNClient = Number(values.weighted_cn);
  scsRunoffDepthClient = Number(values.scs_runoff_depth_mm);
  scsRunoffVolumeClient = Number(values.scs_runoff_volume_m3);
  weightedCClient = Number(values.weighted_c);

  setMetric('area_ha', values.area_ha, 2);
  setMetric('area_km2', values.area_km2, 3);
  setMetric('mean_elevation_m', values.mean_elevation_m, 1);
  setMetric('mean_slope_pct', values.mean_slope_pct, 2);
  setMetric('max_slope_pct', values.max_slope_pct, 2);
  setMetric('c_raster_area_ha', values.c_raster_area_ha, 2);
  setMetric('coverage_closure_error_pct', values.coverage_closure_error_pct, 3);
  setMetric('reason_closure_error_pct', values.reason_closure_error_pct, 3);
  setMetric('raster_vs_geodesic_error_pct', values.raster_vs_geodesic_error_pct, 2);
  confidenceUiLabel.setValue('Confidence: ' + deriveConfidence());
  setMetric('mean_annual_rainfall_mm', values.mean_annual_rainfall_mm, 1);
  setMetric('weighted_c', values.weighted_c, 3);
  setMetric('c_min', values.c_min, 3);
  setMetric('c_max', values.c_max, 3);
  setMetric('valid_c_area_ha', values.valid_c_area_ha, 2);
  setMetric('unresolved_c_area_ha', values.unresolved_c_area_ha, 2);
  setMetric('c_coverage_pct', values.c_coverage_pct, 2);
  setMetric('bare_rock_correction_ha', values.bare_rock_correction_ha, 2);
  setMetric('weighted_cn', values.weighted_cn, 1);
  setMetric('cn_coverage_pct', values.cn_coverage_pct, 2);
  setMetric('scs_runoff_depth_mm', values.scs_runoff_depth_mm, 2);
  setMetric('scs_runoff_volume_m3', values.scs_runoff_volume_m3, 1);
  setMetric('mean_sand_pct', values.mean_sand_pct, 1);
  setMetric('mean_clay_pct', values.mean_clay_pct, 1);
  setMetric('mean_hsg_proxy_confidence', values.mean_hsg_proxy_confidence, 2);

  LULC_CLASSES.forEach(function(definition) {
    setMetric('lulc_' + definition.field + '_ha',
      values['lulc_' + definition.field + '_ha'], 2);
  });
  SOIL_RESPONSE_CLASSES.forEach(function(definition) {
    setMetric('soil_' + definition.field + '_ha',
      values['soil_' + definition.field + '_ha'], 2);
  });
  SOIL_HSG_CLASSES.forEach(function(definition) {
    setMetric('soil_' + definition.field + '_ha',
      values['soil_' + definition.field + '_ha'], 2);
  });
  C_SOIL_TEXTURE_CLASSES.forEach(function(definition) {
    setMetric('csoil_' + definition.field + '_ha',
      values['csoil_' + definition.field + '_ha'], 2);
  });
  PRIMARY_COVER_CLASSES.forEach(function(definition) {
    setMetric('primary_cover_' + definition.field + '_ha',
      values['primary_cover_' + definition.field + '_ha'], 2);
  });
  C_SLOPE_CLASSES.forEach(function(definition) {
    setMetric('cslope_' + definition.field + '_ha',
      values['cslope_' + definition.field + '_ha'], 2);
  });
  IRC_SURFACE_CLASSES.forEach(function(definition) {
    setMetric('irc_surface_' + definition.field + '_ha',
      values['irc_surface_' + definition.field + '_ha'], 2);
  });
  C_SOURCE_CLASSES.forEach(function(definition) {
    setMetric('c_source_' + definition.field + '_ha',
      values['c_source_' + definition.field + '_ha'], 2);
  });
  C_CONFIDENCE_CLASSES.forEach(function(definition) {
    setMetric('c_confidence_' + definition.field + '_ha',
      values['c_confidence_' + definition.field + '_ha'], 2);
    setMetric('c_confidence_' + definition.field + '_pct',
      values['c_confidence_' + definition.field + '_pct'], 2);
  });
  missingCReasonClassesForUi.forEach(function(definition) {
    setMetric('c_missing_' + definition.field + '_ha',
      values['c_missing_' + definition.field + '_ha'], 2);
  });
  C_COVER_CLASSES.forEach(function(definition) {
    setMetric('cover_' + definition.field + '_ha',
      values['cover_' + definition.field + '_ha'], 2);
  });
});

ee.Dictionary({
  feature_count: catchmentFeatureCount,
  unsupported_or_null_geometry_count: unsupportedOrNullGeometryCount,
  is_unbounded: catchmentIsUnbounded,
  source_crs: catchmentSourceCrs,
  geometry_type: catchmentGeometry.type(),
  area_ha: areaHa,
  c_raster_area_ha: cRasterAreaM2.divide(10000),
  valid_c_area_ha: validAreaM2.divide(10000),
  unresolved_c_area_ha: unresolvedAreaM2.divide(10000),
  valid_c_coverage_pct: validCoveragePct,
  unresolved_c_coverage_pct: unresolvedCoveragePct,
  c_area_closure_error_pct: coverageClosureErrorPct,
  reason_closure_error_pct: reasonClosureErrorPct,
  raster_vs_geodesic_area_error_pct: rasterVsGeodesicAreaErrorPct,
  sentinel2_scene_count: s2Collection.size(),
  dynamic_world_scene_count: dynamicWorldCollection.size(),
  sentinel1_scene_count: sentinel1Collection.size(),
  bare_rock_correction_area_ha: bareRockCorrectionAreaHa,
  unsupported_c_lulc_area_ha: unsupportedCLulcAreaHa,
  cn_coverage_pct: cnCoveragePct,
  lookup_row_count: C_LOOKUP_ROWS.length
}).evaluate(function(checks, error) {
  if (error || !checks) {
    print('Quality-control evaluation failed', error);
    warningPanel.add(ui.Label(
      'ERROR: QC statistics could not be evaluated. See the Console for the server message.',
      {fontSize: '11px', color: '#9b2226', margin: '3px 0 0 0'}
    ));
    return;
  }
  var messages = [];
  if (Number(checks.feature_count) === 0) {
    messages.push('ERROR: catchment FeatureCollection is empty.');
  } else if (Number(checks.feature_count) > 1) {
    messages.push('NOTICE: multiple features were dissolved into one analysis geometry.');
  }
  if (checks.geometry_type !== 'Polygon' && checks.geometry_type !== 'MultiPolygon') {
    messages.push('ERROR: catchment geometry is not Polygon/MultiPolygon.');
  }
  if (Number(checks.unsupported_or_null_geometry_count) > 0) {
    messages.push('ERROR: one or more input features have null/empty/unsupported geometry.');
  }
  if (checks.is_unbounded === true) {
    messages.push('ERROR: catchment geometry is unbounded.');
  }
  if (checks.source_crs !== 'EPSG:4326') {
    messages.push('NOTICE: source CRS is ' + checks.source_crs + '. Confirm the uploaded vector CRS; WGS84/EPSG:4326 is recommended for table uploads.');
  }
  if (Number(checks.area_ha) <= 0) {
    messages.push('ERROR: catchment geometry is empty or has zero area.');
  } else if (Number(checks.area_ha) < CONFIG.QUALITY.SMALL_CATCHMENT_WARNING_HA) {
    messages.push('WARNING: catchment is small relative to the 250 m soil source; soil-derived C may have significant uncertainty.');
  }
  if (Number(checks.valid_c_coverage_pct) < CONFIG.C_COMPLETE_COVERAGE_TARGET_PCT) {
    messages.push('ERROR: valid C coverage is below ' + CONFIG.C_COMPLETE_COVERAGE_TARGET_PCT + '%. Exports are blocked; inspect the C missing-reason image/table.');
  }
  if (Number(checks.valid_c_coverage_pct) < 90) {
    messages.push('NOT DESIGN READY: valid C coverage is below 90%.');
  } else if (Number(checks.valid_c_coverage_pct) < 95) {
    messages.push('WARNING: valid C coverage is 90-95%; the model is not design-ready.');
  } else if (Number(checks.valid_c_coverage_pct) < 99) {
    messages.push('ACCEPTABLE WITH REVIEW: valid C coverage is 95-99%; all unresolved pixels must be documented.');
  } else {
    messages.push('GREEN COVERAGE GATE: valid C coverage is >=99%, subject to source and field review.');
  }
  if (Number(checks.c_area_closure_error_pct) > 1) {
    messages.push('ERROR: valid C area + unresolved C area does not close to the 30-m C-grid area within 1%.');
  }
  if (Number(checks.reason_closure_error_pct) > 1) {
    messages.push('ERROR: unresolved C area is not fully explained by the C_REASON diagnostic categories.');
  }
  if (Number(checks.raster_vs_geodesic_area_error_pct) > 5) {
    messages.push('WARNING: rasterized 30-m C-grid area differs from geodesic polygon area by more than 5%; inspect grid tolerance.');
  }
  if (Number(checks.unsupported_c_lulc_area_ha) > 0.01) {
    messages.push('ERROR: ' + Number(checks.unsupported_c_lulc_area_ha).toFixed(2) +
      ' ha has no primary source-backed C value. Inspect C_missing_reason; do not extrapolate the 0-30% table above 30% slope.');
  }
  if (Number(checks.sentinel2_scene_count) === 0) {
    messages.push('WARNING: no Sentinel-2 scenes were found; remote-sensing surface evidence is reduced, but the supporting layer is not a mandatory C mask.');
  }
  if (Number(checks.dynamic_world_scene_count) === 0) {
    messages.push('WARNING: no Dynamic World scenes were found; remote-sensing surface evidence is reduced, but the supporting layer is not a mandatory C mask.');
  }
  if (Number(checks.sentinel1_scene_count) === 0) {
    messages.push('WARNING: no Sentinel-1 VV/VH scenes were found; radar validation evidence is unavailable.');
  }
  if (Number(checks.cn_coverage_pct) < CONFIG.C_COMPLETE_COVERAGE_TARGET_PCT) {
    messages.push('WARNING: SCS-CN cross-check coverage is below the target; it is not a complete catchment cross-check.');
  }
  if (lookupProblems.length > 0) {
    messages.push('ERROR: one or more C lookup entries fall outside 0-1.');
  }
  if (expertOverrideProblems.length > 0) {
    expertOverrideProblems.forEach(function(problem) {
      messages.push('ERROR: ' + problem);
    });
  }
  if (['NONE', 'A', 'B', 'C', 'D'].indexOf(CONFIG.FIELD_CONFIRMED_HSG) < 0) {
    messages.push('ERROR: FIELD_CONFIRMED_HSG must be NONE, A, B, C or D.');
  }
  if (CONFIG.SCS_CN_AMC !== 'II') {
    messages.push('ERROR: the configured SCS-CN table is AMC II only; supply an AMC conversion table before using AMC I or III.');
  }
  if (messages.length === 0) messages.push('No configured QC warnings were triggered.');
  messages.forEach(function(message) {
    warningPanel.add(ui.Label(message, {
      fontSize: '11px',
      color: message.indexOf('ERROR') === 0 ? '#9b2226' : '#8a5a00',
      margin: '3px 0 0 0',
      whiteSpace: 'pre-wrap'
    }));
  });
});

print('Ready: use the dashboard to create exports.');
