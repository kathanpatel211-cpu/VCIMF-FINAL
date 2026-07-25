/**
 * ============================================================================
 *  BGDSS v1.0 — Beat GIS Decision Support System
 *  Pilot Project : Sabarkantha Forest Division, Gujarat Forest Department
 *  Platform      : Google Earth Engine (JavaScript API)
 * ============================================================================
 *
 *  PURPOSE
 *  -------
 *  BGDSS automatically analyzes a forest Beat / Range / Division boundary
 *  and generates GIS layers, statistics and decision-support outputs from
 *  publicly available Earth Engine datasets: terrain, hydrology, climate,
 *  vegetation, forest cover, carbon/biomass, fire risk, soil erosion,
 *  plantation suitability, wildlife habitat and management decision layers.
 *
 *  HOW TO USE
 *  ----------
 *  1. Edit ONLY the BGDSS.CONFIG block below (roi asset, year, names).
 *  2. Run the script.
 *  3. The last line of this file calls BGDSS.run() which executes every
 *     engine automatically, prints a run log, adds styled layers to the
 *     Map, and registers outputs for export in the Tasks tab.
 *
 *  ARCHITECTURE
 *  ------------
 *  A single global object `BGDSS` namespaces every module:
 *    BGDSS.CONFIG    user-editable configuration (ONLY section to edit)
 *    BGDSS.STATE     internal run-time state (roi geometry, area, flags)
 *    BGDSS.CACHE     memoized intermediate layers (avoids recomputation)
 *    BGDSS.DATA      dataset manager (safe dataset loading + validation)
 *    BGDSS.UTIL      shared utility library (stats, AHP, fuzzy, viz, log)
 *    BGDSS.WORKFLOW  workflow/module runner (error handling, sequencing)
 *    BGDSS.TERRAIN, BGDSS.HYDROLOGY, BGDSS.CLIMATE, BGDSS.VEGETATION,
 *    BGDSS.FOREST, BGDSS.BIOMASS, BGDSS.CARBON, BGDSS.FIRE, BGDSS.SOIL,
 *    BGDSS.PLANTATION, BGDSS.WILDLIFE, BGDSS.DECISION   analysis engines
 *    BGDSS.STATS     cross-engine statistics summary
 *    BGDSS.EXPORT    export manager (GeoTIFF / CSV / SHP / GeoJSON / PNG)
 *    BGDSS.RESULTS   every computed ee.Image / ee.FeatureCollection output
 *
 *  Every engine follows the same internal pipeline:
 *    Initialize -> Load Dataset -> Validate Dataset -> Preprocess ->
 *    Analysis -> Statistics -> Visualization -> Export Registration ->
 *    Finish
 *
 *  ERROR HANDLING
 *  ---------------
 *  If a dataset is unavailable or an engine throws, BGDSS.WORKFLOW.run()
 *  catches the error, prints "Dataset unavailable. Skipping module." (or
 *  the underlying error) and continues with the remaining engines so a
 *  single missing asset never aborts the whole run.
 *
 *  FUTURE VERSION COMPATIBILITY
 *  -----------------------------
 *  New engines can be added as additional BGDSS.<ENGINE> objects and
 *  registered in BGDSS.WORKFLOW.MODULES without touching existing code
 *  (forest health monitoring, change detection, encroachment monitoring,
 *  AI-assisted recommendations, multi-beat/district batch processing,
 *  web application integration).
 * ============================================================================
 */

// ============================================================================
// SECTION: GLOBAL NAMESPACE
// ============================================================================

var BGDSS = {};
BGDSS.VERSION = '1.0.0';

// ============================================================================
// SECTION: CONFIGURATION
// ----------------------------------------------------------------------------
// THIS IS THE ONLY SECTION THE USER SHOULD EDIT.
// Everything downstream (Startup, Dataset Manager, all Engines, Export)
// reads from BGDSS.CONFIG and adapts automatically. No other section
// requires user edits.
// ============================================================================

BGDSS.CONFIG = {

  // ---- Study area -----------------------------------------------------
  // Replace with the Beat / Range / Division boundary asset to analyze.
  // This is the ONLY place a user needs to change to switch study areas.
  roi: ee.FeatureCollection('projects/raygadh-range/assets/BEAT'),

  // ---- Analysis period --------------------------------------------------
  year: 2025,                       // primary analysis year
  fireHistoryYears: 10,             // years of look-back for fire frequency

  // ---- Administrative metadata (used in titles / export names) ---------
  state: 'Gujarat',
  district: 'Sabarkantha',
  unitName: 'BEAT',

  // ---- Processing parameters ---------------------------------------------
  scale: 10,                        // native analysis scale, meters
  coarseScale: 30,                  // scale for coarser datasets (DEM/climate)
  projection: 'EPSG:4326',
  maxPixels: 1e13,
  tileScale: 4,

  // ---- Export ------------------------------------------------------------
  exportFolder: 'BGDSS',
  exportPrefix: 'BGDSS_v1_0',

  // ---- Optional layers (leave null to skip gracefully) -------------------
  villages: null,                   // optional ee.FeatureCollection of villages
  roads: null,                      // optional ee.FeatureCollection of roads

  // ---- Forest type context (Champion & Seth 1968 classification) ---------
  // Sabarkantha's forests fall predominantly under Group 5B - Northern Dry
  // Deciduous Forest (5A/C1a Dry Teak-bearing forest, with 5/E9 dry
  // deciduous scrub in degraded/thorn tracts). This classification drives
  // the forest-type fire-inflammability weighting below. If a Range's
  // working plan documents a different type for a specific beat, adjust
  // forestTypeBaseline accordingly (0-1, higher = more fire-prone).
  // Reference: Champion, H.G. & Seth, S.K. (1968), "A Revised Survey of
  // the Forest Types of India", Manager of Publications, Delhi.
  forestType: {
    championSethGroup: '5B - Northern Dry Deciduous Forest (dry teak/mixed)',
    forestTypeBaseline: 0.75          // 0-1 inflammability baseline for this type
  },

  // ---- Model constants -----------------------------------------------------
  // Every numeric constant used by an engine is listed here, grouped by
  // engine, so a Range/Working-Plan officer can override any of them with
  // locally verified figures WITHOUT touching engine code. Each constant
  // cites the methodology it follows; where Indian forestry practice
  // (FSI/ICFRE/CSWCRTI/NRSC) diverges from the generic international
  // default, the Indian convention is used by default.
  constants: {
    // -- Carbon / Biomass (FSI/ISFR convention; see CARBON ENGINE header) --
    rootShootRatio: 0.28,            // IPCC 2006 AFOLU GL Table 4.4, tropical/
                                      // subtropical dry forest, AGB > ~20 t/ha
    carbonFraction: 0.5,             // FSI India State of Forest Report (ISFR)
                                      // convention (0.5), vs IPCC 2006 Tier-1
                                      // default of 0.47 - set to 0.47 to match
                                      // international reporting instead
    co2Conversion: 3.6663,           // molecular weight ratio CO2/C (44/12)

    // -- Soil / RUSLE (Indian rainfall-erosivity + NRSC C-factor method) ---
    // R-factor: Singh, Babu & Chandra (1981), CSWCRTI Dehradun, developed
    // and validated for Indian rainfall regimes (used in preference to the
    // Renard & Freimund 1994 US-calibrated formula).
    rusleRFormula: 'india_cswcrti',  // 'india_cswcrti' (R = 79 + 0.363*P) or
                                      // 'renard' (R = 0.0483*P^1.61)
    // C-factor: land-cover lookup table per the NRSC/ISRO "Soil Erosion
    // Atlas of India" (2018, Dept. of Land Resources / NRSC Bhuvan) rather
    // than a continuous NDVI function, since it is the nationally accepted
    // reference method; set to 'ndvi' to use the continuous Van der Knijff
    // approach instead.
    rusleCMethod: 'landcover',
    rusleP: 1.0,                     // support practice factor (no local data => 1)

    // -- Fire Risk (Jaiswal, Mukherjee, Krishnamurthy & Saxena, 2002 AHP) --
    // "Forest fire risk zone mapping from satellite imagery and GIS",
    // Int. J. Applied Earth Observation & Geoinformation 4(1). Weights
    // below reproduce the published AHP pairwise-comparison weights for
    // Indian dry-deciduous forest, where human ignition sources (proximity
    // to habitation) dominate over the lightning-driven regimes assumed by
    // most global fire-risk models. Re-run the AHP pairwise comparison
    // locally (with the DFO/Range team) if better judgment is available -
    // these are starting weights, not a fixed law.
    fireWeights: {
      forestType: 0.279,             // fire-proneness of the forest type itself
      settlementProximity: 0.185,    // human ignition source - dominant in India
      slope: 0.148,
      roadProximity: 0.126,          // human ignition / access
      temperature: 0.104,
      rainfall: 0.081,
      aspect: 0.077
    },

    monsoonMonths: [6, 7, 8, 9],
    winterMonths: [10, 11, 12, 1],
    summerMonths: [2, 3, 4, 5]
  }
};

// ============================================================================
// SECTION: STARTUP
// ----------------------------------------------------------------------------
// Resolves the ROI once, derives the working geometry/area/region, and
// exposes them through BGDSS.STATE so every downstream engine reuses the
// same values instead of recomputing them (performance requirement).
// ============================================================================

BGDSS.STATE = {
  startedAt: null,
  roiGeometry: null,
  roiBounds: null,
  areaHa: null,
  areaKm2: null,
  moduleLog: [],
  errors: []
};

BGDSS.STARTUP = {};

/**
 * Purpose : One-time initialization of the run-time state shared by all
 *           engines: dissolved ROI geometry, bounding region, area in
 *           hectares/km2, and the map centering.
 * Input   : none (reads BGDSS.CONFIG.roi)
 * Output  : populates BGDSS.STATE
 * Assumptions : BGDSS.CONFIG.roi is a valid ee.FeatureCollection or ee.Geometry.
 */
BGDSS.STARTUP.init = function () {
  BGDSS.STATE.startedAt = Date.now();

  var roi = BGDSS.CONFIG.roi;
  var geometry;
  try {
    geometry = (roi.geometry) ? roi.geometry() : ee.Geometry(roi);
  } catch (e) {
    throw new Error('BGDSS.CONFIG.roi is not a valid FeatureCollection/Geometry: ' + e.message);
  }

  BGDSS.STATE.roiGeometry = geometry;
  BGDSS.STATE.roiBounds = geometry.bounds();

  var areaM2 = geometry.area({ maxError: 1 });
  BGDSS.STATE.areaHa = ee.Number(areaM2).divide(1e4);
  BGDSS.STATE.areaKm2 = ee.Number(areaM2).divide(1e6);

  try {
    Map.centerObject(roi, 12);
    Map.setOptions('SATELLITE');
  } catch (e) {
    // Map is not available in batch/server contexts - non-fatal.
  }

  BGDSS.UTIL.log('STARTUP', 'BGDSS v' + BGDSS.VERSION + ' initialized for '
    + BGDSS.CONFIG.unitName + ' | ' + BGDSS.CONFIG.district + ', '
    + BGDSS.CONFIG.state + ' | year ' + BGDSS.CONFIG.year, 'ok');

  return BGDSS.STATE;
};

// ============================================================================
// SECTION: DATASET MANAGER
// ----------------------------------------------------------------------------
// Central, defensive access point for every external Earth Engine dataset.
// Every load goes through safeImage()/safeCollection() which validates
// availability with a lightweight synchronous check and returns null (never
// throws) on failure so calling engines can skip gracefully. Loaded
// datasets are memoized in BGDSS.CACHE so no ImageCollection/Image is
// fetched twice (performance requirement).
// ============================================================================

BGDSS.CACHE = {};
BGDSS.DATA = {};

/** Canonical dataset IDs. Centralized so future version upgrades only touch
 *  one place. Some community-hosted assets (marked "verify") occasionally
 *  move; the safe loaders below skip gracefully rather than crash the run
 *  if an ID becomes stale. */
BGDSS.DATA.IDS = {
  demAW3D30: 'JAXA/ALOS/AW3D30/V3_2',
  chirpsDaily: 'UCSB-CHG/CHIRPS/DAILY',
  modisLST: 'MODIS/061/MOD11A2',
  sentinel2Sr: 'COPERNICUS/S2_SR_HARMONIZED',
  s2Clouds: 'COPERNICUS/S2_CLOUD_PROBABILITY',
  worldCover: 'ESA/WorldCover/v200',
  hansenGfc: 'UMD/hansen/global_forest_change_2023_v1_11',
  canopyHeightEth: 'projects/sat-io/open-datasets/ETH_Global_Canopy_Height_2020_10m_v1', // verify
  cciBiomass: 'projects/sat-io/open-datasets/ESA/ESA_CCI_AGB', // verify
  modisBurnedArea: 'MODIS/061/MCD64A1',
  firms: 'FIRMS',
  hydroshedsVfDem: 'WWF/HydroSHEDS/03VFDEM',
  hydroshedsDir: 'WWF/HydroSHEDS/15DIR',       // confirmed vs. earthengine-catalog (image, band b1)
  hydroshedsAcc: 'WWF/HydroSHEDS/15ACC',       // confirmed vs. earthengine-catalog (image, band b1)
  hydroBasinsAsLev08: 'WWF/HydroSHEDS/v1/Basins/hybas_8', // confirmed (table, global level-8 basins)
  smapSoilMoisture: 'NASA/SMAP/SPL4SMGP/007',
  olTexture: 'OpenLandMap/SOL/SOL_TEXTURE-CLASS_USDA-TT_M/v02',
  olOrganicCarbon: 'OpenLandMap/SOL/SOL_ORGANIC-CARBON_USDA-6A1C_M/v02',
  olBulkDensity: 'OpenLandMap/SOL/SOL_BULKDENS-FINEEARTH_USDA-4A1H_M/v02',
  olSand: 'OpenLandMap/SOL/SOL_SAND-WFRACTION_USDA-3A1A1A_M/v02',
  olClay: 'OpenLandMap/SOL/SOL_CLAY-WFRACTION_USDA-3A1A1A_M/v02'
};

/**
 * Purpose : Safely construct + validate an ee.Image, memoized by cache key.
 * Input   : id (string asset id), cacheKey (string), label (string, for logs)
 * Output  : ee.Image on success, null on failure
 * Assumptions : Validity is checked via a cheap synchronous bandNames().getInfo().
 */
BGDSS.DATA.safeImage = function (id, cacheKey, label) {
  if (BGDSS.CACHE.hasOwnProperty(cacheKey)) { return BGDSS.CACHE[cacheKey]; }
  var img = null;
  try {
    img = ee.Image(id);
    img.bandNames().getInfo();
  } catch (e) {
    BGDSS.UTIL.log(label, 'Dataset unavailable (' + id + '). Skipping module.', 'warn');
    img = null;
  }
  BGDSS.CACHE[cacheKey] = img;
  return img;
};

/**
 * Purpose : Safely construct + validate an ee.ImageCollection, memoized.
 * Input   : id, cacheKey, label
 * Output  : ee.ImageCollection on success, null on failure
 */
BGDSS.DATA.safeCollection = function (id, cacheKey, label) {
  if (BGDSS.CACHE.hasOwnProperty(cacheKey)) { return BGDSS.CACHE[cacheKey]; }
  var col = null;
  try {
    col = ee.ImageCollection(id);
    col.first().bandNames().getInfo();
  } catch (e) {
    BGDSS.UTIL.log(label, 'Dataset unavailable (' + id + '). Skipping module.', 'warn');
    col = null;
  }
  BGDSS.CACHE[cacheKey] = col;
  return col;
};

/**
 * Purpose : Safely construct a single mosaicked ee.Image out of a tiled
 *           ee.ImageCollection (several EE datasets - e.g. JAXA AW3D30,
 *           ESA WorldCover - are published as per-tile ImageCollections,
 *           not single Images). Validates availability first; never
 *           throws.
 * Input   : id, cacheKey, label, bandName (optional - selects before mosaic)
 * Output  : ee.Image (single mosaicked band) on success, null on failure
 */
BGDSS.DATA.safeMosaicImage = function (id, cacheKey, label, bandName) {
  if (BGDSS.CACHE.hasOwnProperty(cacheKey)) { return BGDSS.CACHE[cacheKey]; }
  var img = null;
  try {
    var col = ee.ImageCollection(id);
    col.first().bandNames().getInfo();
    img = bandName ? col.select([bandName]).mosaic() : col.mosaic();
  } catch (e) {
    BGDSS.UTIL.log(label, 'Dataset unavailable (' + id + '). Skipping module.', 'warn');
    img = null;
  }
  BGDSS.CACHE[cacheKey] = img;
  return img;
};

/**
 * Purpose : Safely construct + validate an ee.FeatureCollection, memoized.
 */
BGDSS.DATA.safeTable = function (id, cacheKey, label) {
  if (BGDSS.CACHE.hasOwnProperty(cacheKey)) { return BGDSS.CACHE[cacheKey]; }
  var fc = null;
  try {
    fc = ee.FeatureCollection(id);
    fc.first().getInfo();
  } catch (e) {
    BGDSS.UTIL.log(label, 'Dataset unavailable (' + id + '). Skipping module.', 'warn');
    fc = null;
  }
  BGDSS.CACHE[cacheKey] = fc;
  return fc;
};

/* ---- Convenience typed getters used by the engines below ---- */

BGDSS.DATA.getDem = function () {
  // JAXA AW3D30 is published as a tiled ImageCollection (bands DSM/STK/MSK),
  // not a single Image - mosaic the DSM band into one continuous surface.
  return BGDSS.DATA.safeMosaicImage(BGDSS.DATA.IDS.demAW3D30, 'demAW3D30', 'TERRAIN', 'DSM');
};

BGDSS.DATA.getChirps = function () {
  return BGDSS.DATA.safeCollection(BGDSS.DATA.IDS.chirpsDaily, 'chirpsDaily', 'CLIMATE');
};

BGDSS.DATA.getModisLst = function () {
  return BGDSS.DATA.safeCollection(BGDSS.DATA.IDS.modisLST, 'modisLST', 'CLIMATE');
};

BGDSS.DATA.getSentinel2 = function () {
  return BGDSS.DATA.safeCollection(BGDSS.DATA.IDS.sentinel2Sr, 'sentinel2Sr', 'VEGETATION');
};

BGDSS.DATA.getWorldCover = function () {
  // ESA WorldCover v200 is also a tiled ImageCollection (band 'Map') - mosaic
  // it into one continuous land-cover surface before use.
  return BGDSS.DATA.safeMosaicImage(BGDSS.DATA.IDS.worldCover, 'worldCover', 'FOREST', 'Map');
};

BGDSS.DATA.getHansenGfc = function () {
  return BGDSS.DATA.safeImage(BGDSS.DATA.IDS.hansenGfc, 'hansenGfc', 'FOREST');
};

BGDSS.DATA.getCanopyHeight = function () {
  return BGDSS.DATA.safeImage(BGDSS.DATA.IDS.canopyHeightEth, 'canopyHeightEth', 'FOREST');
};

BGDSS.DATA.getCciBiomass = function () {
  return BGDSS.DATA.safeImage(BGDSS.DATA.IDS.cciBiomass, 'cciBiomass', 'BIOMASS');
};

BGDSS.DATA.getModisBurnedArea = function () {
  return BGDSS.DATA.safeCollection(BGDSS.DATA.IDS.modisBurnedArea, 'modisBurnedArea', 'FIRE');
};

BGDSS.DATA.getFirms = function () {
  return BGDSS.DATA.safeCollection(BGDSS.DATA.IDS.firms, 'firms', 'FIRE');
};

BGDSS.DATA.getHydroshedsVfDem = function () {
  return BGDSS.DATA.safeImage(BGDSS.DATA.IDS.hydroshedsVfDem, 'hydroshedsVfDem', 'HYDROLOGY');
};

BGDSS.DATA.getHydroshedsDir = function () {
  return BGDSS.DATA.safeImage(BGDSS.DATA.IDS.hydroshedsDir, 'hydroshedsDir', 'HYDROLOGY');
};

BGDSS.DATA.getHydroshedsAcc = function () {
  return BGDSS.DATA.safeImage(BGDSS.DATA.IDS.hydroshedsAcc, 'hydroshedsAcc', 'HYDROLOGY');
};

BGDSS.DATA.getHydroBasins = function () {
  return BGDSS.DATA.safeTable(BGDSS.DATA.IDS.hydroBasinsAsLev08, 'hydroBasins', 'HYDROLOGY');
};

BGDSS.DATA.getSmapSoilMoisture = function () {
  return BGDSS.DATA.safeCollection(BGDSS.DATA.IDS.smapSoilMoisture, 'smapSoilMoisture', 'SOIL');
};

BGDSS.DATA.getSoilTexture = function () {
  return BGDSS.DATA.safeImage(BGDSS.DATA.IDS.olTexture, 'olTexture', 'SOIL');
};

BGDSS.DATA.getSoilOrganicCarbon = function () {
  return BGDSS.DATA.safeImage(BGDSS.DATA.IDS.olOrganicCarbon, 'olOrganicCarbon', 'SOIL');
};

BGDSS.DATA.getSoilBulkDensity = function () {
  return BGDSS.DATA.safeImage(BGDSS.DATA.IDS.olBulkDensity, 'olBulkDensity', 'SOIL');
};

BGDSS.DATA.getSoilSand = function () {
  return BGDSS.DATA.safeImage(BGDSS.DATA.IDS.olSand, 'olSand', 'SOIL');
};

BGDSS.DATA.getSoilClay = function () {
  return BGDSS.DATA.safeImage(BGDSS.DATA.IDS.olClay, 'olClay', 'SOIL');
};

// ============================================================================
// SECTION: UTILITY LIBRARY
// ----------------------------------------------------------------------------
// Shared helpers used by every engine: logging, statistics, normalization,
// AHP/fuzzy overlay, classification, result/stat registration, map styling
// and legend construction. Centralizing these keeps every engine short and
// consistent, and avoids duplicating the same reducer/visualization code.
// ============================================================================

BGDSS.UTIL = {};

/**
 * Purpose : Uniform console logging with a status glyph, matching the
 *           required run log style (e.g. "✓ DEM Loaded").
 * Input   : module (string), message (string), level ('ok'|'warn'|'error'|'info')
 * Output  : none (prints to console); also appended to BGDSS.STATE.moduleLog
 */
BGDSS.UTIL.log = function (module, message, level) {
  var glyph = { ok: '✓', warn: '⚠', error: '✗', info: 'ℹ' }[level] || 'ℹ';
  var line = glyph + ' [' + module + '] ' + message;
  print(line);
  BGDSS.STATE.moduleLog.push({ module: module, message: message, level: level, t: Date.now() });
  if (level === 'error') { BGDSS.STATE.errors.push({ module: module, message: message }); }
};

/**
 * Purpose : Register a computed layer under BGDSS.RESULTS.<category>.<key>
 *           so all engines share one consistent output structure.
 */
BGDSS.UTIL.registerResult = function (category, key, value) {
  BGDSS.RESULTS[category] = BGDSS.RESULTS[category] || {};
  BGDSS.RESULTS[category][key] = value;
  return value;
};

/**
 * Purpose : Register computed statistics under BGDSS.STATS.<category>.
 */
BGDSS.UTIL.registerStat = function (category, key, value) {
  BGDSS.STATS[category] = BGDSS.STATS[category] || {};
  BGDSS.STATS[category][key] = value;
  return value;
};

/**
 * Purpose : Compute Min/Max/Mean/Median/StdDev for a single band image
 *           over the ROI in one reduceRegion call (combined reducer).
 * Input   : image (ee.Image), band (string|null - first band if null),
 *           opts ({geometry, scale, maxPixels})
 * Output  : ee.Dictionary with keys min/max/mean/median/stdDev
 */
BGDSS.UTIL.computeStats = function (image, band, opts) {
  opts = opts || {};
  var geometry = opts.geometry || BGDSS.STATE.roiGeometry;
  var scale = opts.scale || BGDSS.CONFIG.scale;
  var img = band ? image.select([band]) : image;
  var reducer = ee.Reducer.minMax()
    .combine({ reducer2: ee.Reducer.mean(), sharedInputs: true })
    .combine({ reducer2: ee.Reducer.median(), sharedInputs: true })
    .combine({ reducer2: ee.Reducer.stdDev(), sharedInputs: true });
  var stats = img.reduceRegion({
    reducer: reducer,
    geometry: geometry,
    scale: scale,
    maxPixels: BGDSS.CONFIG.maxPixels,
    tileScale: BGDSS.CONFIG.tileScale,
    bestEffort: true
  });
  return stats;
};

/**
 * Purpose : Compute area (ha) and percentage per class of a classified image.
 * Input   : classifiedImage (ee.Image, integer classes), classDict
 *           ({1:'Very Low', ...}), opts ({geometry, scale})
 * Output  : ee.Dictionary {classLabel: {areaHa, percent}}  (client-safe via
 *           .getInfo() left to the caller/statistics module)
 */
BGDSS.UTIL.computeAreaStats = function (classifiedImage, classDict, opts) {
  opts = opts || {};
  var geometry = opts.geometry || BGDSS.STATE.roiGeometry;
  var scale = opts.scale || BGDSS.CONFIG.scale;
  var pixelArea = ee.Image.pixelArea().divide(1e4); // ha
  var areaImage = pixelArea.addBands(classifiedImage.rename('class'));
  var areas = areaImage.reduceRegion({
    reducer: ee.Reducer.sum().group({ groupField: 1, groupName: 'class' }),
    geometry: geometry,
    scale: scale,
    maxPixels: BGDSS.CONFIG.maxPixels,
    tileScale: BGDSS.CONFIG.tileScale,
    bestEffort: true
  });
  return areas;
};

/**
 * Purpose : Linear min-max normalization of an image to [0,1], clamped.
 */
BGDSS.UTIL.normalize = function (image, min, max, invert) {
  var norm = image.subtract(min).divide(max - min).clamp(0, 1);
  return invert ? ee.Image(1).subtract(norm) : norm;
};

/**
 * Purpose : Fuzzy linear membership function (0 below low, 1 above high,
 *           linear ramp between).
 */
BGDSS.UTIL.fuzzyMembership = function (image, low, high) {
  return image.subtract(low).divide(high - low).clamp(0, 1);
};

/**
 * Purpose : Normalize an AHP/expert weight array so weights sum to 1.
 * Input   : weights (Array<Number>)
 * Output  : Array<Number>
 */
BGDSS.UTIL.normalizeWeights = function (weights) {
  var sum = weights.reduce(function (a, b) { return a + b; }, 0);
  return weights.map(function (w) { return w / sum; });
};

/**
 * Purpose : Weighted linear overlay of pre-normalized (0-1) layers.
 * Input   : layers (Array<ee.Image>, each already normalized 0-1),
 *           weights (Array<Number>, will be normalized to sum 1)
 * Output  : ee.Image single band 'overlay' in range [0,1]
 */
BGDSS.UTIL.weightedOverlay = function (layers, weights) {
  var w = BGDSS.UTIL.normalizeWeights(weights);
  var out = ee.Image(0);
  for (var i = 0; i < layers.length; i++) {
    out = out.add(layers[i].multiply(w[i]));
  }
  return out.rename('overlay');
};

/**
 * Purpose : Classify a continuous 0-1 (or arbitrary) image into 5 classes
 *           (Very Low..Very High) using either quantile breaks (default)
 *           or explicit breaks.
 * Input   : image (ee.Image 1-band), opts ({breaks: [b1,b2,b3,b4], geometry, scale})
 * Output  : ee.Image integer 1-5 ('class' band)
 */
BGDSS.UTIL.CLASS_LABELS_5 = ['Very Low', 'Low', 'Moderate', 'High', 'Very High'];
BGDSS.UTIL.classify5 = function (image, opts) {
  opts = opts || {};
  var breaks = opts.breaks || [0.2, 0.4, 0.6, 0.8];
  var classified = ee.Image(1)
    .where(image.gt(breaks[0]), 2)
    .where(image.gt(breaks[1]), 3)
    .where(image.gt(breaks[2]), 4)
    .where(image.gt(breaks[3]), 5)
    .rename('class')
    .clip(BGDSS.STATE.roiGeometry);
  return classified;
};

/** Standard 5-class Very-Low..Very-High palette (green -> red). */
BGDSS.UTIL.PALETTE_5 = ['1a9850', '91cf60', 'fee08b', 'fc8d59', 'd73027'];

/**
 * Purpose : Add a layer to the Map with defensive error handling so a
 *           missing Map context (batch mode) never breaks a run, and log
 *           the action per the required console style.
 */
BGDSS.UTIL.addLayer = function (image, visParams, name, shown) {
  try {
    Map.addLayer(image.clip(BGDSS.STATE.roiGeometry), visParams, name, shown !== false);
  } catch (e) {
    // Non-fatal: Map not available in this execution context.
  }
};

/**
 * Purpose : Build a simple discrete legend panel (Code Editor UI widget)
 *           for a palette + labels pair. Silently no-ops outside the
 *           Code Editor UI context.
 */
BGDSS.UTIL.addLegend = function (title, palette, labels) {
  try {
    var legend = ui.Panel({ style: { position: 'bottom-left', padding: '8px 15px' } });
    legend.add(ui.Label({ value: title, style: { fontWeight: 'bold', fontSize: '14px', margin: '0 0 4px 0' } }));
    for (var i = 0; i < labels.length; i++) {
      var colorBox = ui.Label('', {
        backgroundColor: palette[i], padding: '8px', margin: '0 0 4px 0'
      });
      var description = ui.Label(labels[i], { margin: '0 0 4px 6px' });
      legend.add(ui.Panel({ widgets: [colorBox, description], layout: ui.Panel.Layout.flow('horizontal') }));
    }
    Map.add(legend);
  } catch (e) {
    // Non-fatal: ui/Map not available in this execution context.
  }
};

/**
 * Purpose : Safe clip helper, guards against null images from a skipped
 *           dataset so callers can chain without extra null-checks.
 */
BGDSS.UTIL.safeClip = function (image) {
  return image ? image.clip(BGDSS.STATE.roiGeometry) : null;
};

/**
 * Purpose : Generate simplified elevation-band contours as vector polygons
 *           at a fixed interval (documented simplification: true isoline
 *           extraction is not natively supported by the EE raster model,
 *           so contour "bands" are produced instead of 1D lines).
 * Input   : dem (ee.Image), interval (Number, meters)
 * Output  : ee.FeatureCollection of banded polygons with a 'band' property
 */
BGDSS.UTIL.generateContourBands = function (dem, interval) {
  var banded = dem.divide(interval).floor().multiply(interval).rename('band').toInt();
  return banded.reduceToVectors({
    geometry: BGDSS.STATE.roiGeometry,
    scale: BGDSS.CONFIG.coarseScale,
    geometryType: 'polygon',
    eightConnected: true,
    labelProperty: 'band',
    maxPixels: BGDSS.CONFIG.maxPixels,
    tileScale: BGDSS.CONFIG.tileScale
  });
};

// ============================================================================
// SECTION: WORKFLOW MANAGER
// ----------------------------------------------------------------------------
// Sequences every engine, wraps each in defensive error handling so a
// single failed/unavailable dataset never stops the overall run, and
// tracks basic timing/telemetry.
// ============================================================================

BGDSS.WORKFLOW = {};
BGDSS.WORKFLOW.MODULES = []; // populated at bottom of file, in run order

/**
 * Purpose : Register an engine module to be executed by BGDSS.run().
 * Input   : name (string), fn (function with no args, the engine's run())
 */
BGDSS.WORKFLOW.register = function (name, fn) {
  BGDSS.WORKFLOW.MODULES.push({ name: name, fn: fn });
};

/**
 * Purpose : Execute all registered modules in order; catches and logs any
 *           exception per module (dataset unavailable, unexpected error)
 *           and continues to the next module (ERROR HANDLING requirement).
 */
BGDSS.WORKFLOW.runAll = function () {
  for (var i = 0; i < BGDSS.WORKFLOW.MODULES.length; i++) {
    var mod = BGDSS.WORKFLOW.MODULES[i];
    var t0 = Date.now();
    try {
      mod.fn();
      BGDSS.UTIL.log(mod.name, 'Completed (' + (Date.now() - t0) + ' ms)', 'ok');
    } catch (e) {
      BGDSS.UTIL.log(mod.name, 'Dataset unavailable or error: ' + e.message + '. Skipping module.', 'error');
    }
  }
};

// ============================================================================
// SECTION: RESULTS / STATS CONTAINERS
// ----------------------------------------------------------------------------
// Declared centrally (before engines run) so BGDSS.RESULTS.<engine>.<layer>
// and BGDSS.STATS.<engine> are always defined, per the required output
// structure, even if an engine is skipped.
// ============================================================================

BGDSS.RESULTS = {
  terrain: {}, hydrology: {}, climate: {}, vegetation: {}, forest: {},
  biomass: {}, carbon: {}, fire: {}, soil: {}, plantation: {}, wildlife: {},
  decision: {}
};

BGDSS.STATS = {
  terrain: {}, hydrology: {}, climate: {}, vegetation: {}, forest: {},
  biomass: {}, carbon: {}, fire: {}, soil: {}, plantation: {}, wildlife: {},
  decision: {}, summary: {}
};

// ============================================================================
// SECTION: TERRAIN ENGINE
// ----------------------------------------------------------------------------
// Dataset  : JAXA ALOS AW3D30 (BGDSS.DATA.IDS.demAW3D30), band 'DSM' (m).
// Produces : DEM, Hillshade, Slope (deg), Aspect (deg), Curvature,
//            TRI (Terrain Ruggedness Index), TPI (Topographic Position
//            Index), simplified contour bands, elevation statistics.
// Units    : elevation in meters; slope/aspect in degrees.
// References: Riley et al. 1999 (TRI); Weiss 2001 (TPI).
// ============================================================================

BGDSS.TERRAIN = {};

BGDSS.TERRAIN.run = function () {
  var LABEL = 'TERRAIN';

  // ---- Load ---------------------------------------------------------------
  var demRaw = BGDSS.DATA.getDem();
  if (!demRaw) { BGDSS.UTIL.log(LABEL, 'Dataset unavailable. Skipping module.', 'warn'); return; }
  BGDSS.UTIL.log(LABEL, 'DEM Loaded', 'ok');

  // ---- Validate / Preprocess -----------------------------------------------
  var dem = demRaw.clip(BGDSS.STATE.roiGeometry).rename('elevation');

  // ---- Analysis -------------------------------------------------------------
  var hillshade = ee.Terrain.hillshade(dem).rename('hillshade');
  var slope = ee.Terrain.slope(dem).rename('slope');       // degrees
  var aspect = ee.Terrain.aspect(dem).rename('aspect');    // degrees

  // Curvature: discrete Laplacian via a 3x3 kernel (positive = convex/ridge,
  // negative = concave/valley).
  var laplacianKernel = ee.Kernel.laplacian8(1, false);
  var curvature = dem.convolve(laplacianKernel).rename('curvature');

  // TRI (Riley et al. 1999): sqrt(mean squared elevation difference to the
  // 8 surrounding cells).
  var meanNeighbor = dem.focal_mean({ radius: 1, kernelType: 'square', units: 'pixels' });
  var tri = dem.subtract(meanNeighbor).pow(2).sqrt().rename('tri');

  // TPI (Weiss 2001): elevation minus the mean elevation of a surrounding
  // neighborhood (positive = ridge/peak, negative = valley/depression).
  var meanNeighborhood = dem.focal_mean({ radius: 5, kernelType: 'circle', units: 'pixels' });
  var tpi = dem.subtract(meanNeighborhood).rename('tpi');

  var contourInterval = 20; // meters, suitable for beat-scale relief
  var contourBands = null;
  try {
    contourBands = BGDSS.UTIL.generateContourBands(dem, contourInterval);
  } catch (e) {
    BGDSS.UTIL.log(LABEL, 'Contour generation skipped: ' + e.message, 'warn');
  }

  // ---- Statistics -------------------------------------------------------------
  var elevStats = BGDSS.UTIL.computeStats(dem, 'elevation', { scale: BGDSS.CONFIG.coarseScale });
  var slopeStats = BGDSS.UTIL.computeStats(slope, 'slope', { scale: BGDSS.CONFIG.coarseScale });
  var aspectStats = BGDSS.UTIL.computeStats(aspect, 'aspect', { scale: BGDSS.CONFIG.coarseScale });
  BGDSS.UTIL.registerStat('terrain', 'elevation', elevStats);
  BGDSS.UTIL.registerStat('terrain', 'slope', slopeStats);
  BGDSS.UTIL.registerStat('terrain', 'aspect', aspectStats);

  // ---- Visualization -------------------------------------------------------------
  BGDSS.UTIL.addLayer(dem, { min: 0, max: 1200, palette: ['0b3d91', '2b8cbe', 'a6d96a', 'fee08b', 'd73027', 'ffffff'] }, 'Terrain: DEM', false);
  BGDSS.UTIL.addLayer(hillshade, { min: 0, max: 255 }, 'Terrain: Hillshade', false);
  BGDSS.UTIL.addLayer(slope, { min: 0, max: 45, palette: BGDSS.UTIL.PALETTE_5 }, 'Terrain: Slope (deg)', false);
  BGDSS.UTIL.addLayer(aspect, { min: 0, max: 360, palette: ['ff0000', 'ffff00', '00ff00', '00ffff', '0000ff', 'ff00ff', 'ff0000'] }, 'Terrain: Aspect (deg)', false);
  BGDSS.UTIL.addLayer(curvature, { min: -5, max: 5, palette: ['2166ac', 'f7f7f7', 'b2182b'] }, 'Terrain: Curvature', false);
  BGDSS.UTIL.addLayer(tri, { min: 0, max: 20, palette: BGDSS.UTIL.PALETTE_5 }, 'Terrain: TRI', false);
  BGDSS.UTIL.addLayer(tpi, { min: -10, max: 10, palette: ['2166ac', 'f7f7f7', 'b2182b'] }, 'Terrain: TPI', false);

  // ---- Registration -------------------------------------------------------------
  BGDSS.UTIL.registerResult('terrain', 'dem', dem);
  BGDSS.UTIL.registerResult('terrain', 'hillshade', hillshade);
  BGDSS.UTIL.registerResult('terrain', 'slope', slope);
  BGDSS.UTIL.registerResult('terrain', 'aspect', aspect);
  BGDSS.UTIL.registerResult('terrain', 'curvature', curvature);
  BGDSS.UTIL.registerResult('terrain', 'tri', tri);
  BGDSS.UTIL.registerResult('terrain', 'tpi', tpi);
  if (contourBands) { BGDSS.UTIL.registerResult('terrain', 'contourBands', contourBands); }
  BGDSS.CACHE.dem = dem; // reused by Hydrology/Fire/Soil/Plantation engines

  BGDSS.EXPORT.registerImage('Terrain_DEM', dem, BGDSS.CONFIG.coarseScale);
  BGDSS.EXPORT.registerImage('Terrain_Slope', slope, BGDSS.CONFIG.coarseScale);
  BGDSS.EXPORT.registerImage('Terrain_Aspect', aspect, BGDSS.CONFIG.coarseScale);
  if (contourBands) { BGDSS.EXPORT.registerTable('Terrain_ContourBands', contourBands); }

  BGDSS.UTIL.log(LABEL, 'Terrain Engine Completed', 'ok');
};

BGDSS.WORKFLOW.register('TERRAIN', BGDSS.TERRAIN.run);

// ============================================================================
// SECTION: HYDROLOGY ENGINE
// ----------------------------------------------------------------------------
// Datasets : WWF HydroSHEDS void-filled DEM, Flow Direction (15 arc-sec),
//            Flow Accumulation (15 arc-sec) — with a DEM/slope-based
//            fallback drainage proxy when HydroSHEDS derivative layers are
//            unavailable in the catalog for the AOI.
// Produces : Drainage network, Flow Direction, Flow Accumulation, micro-
//            watershed boundaries, drainage density, water harvesting
//            suitability (5-class).
// Units    : flow accumulation in contributing cells; drainage density in
//            km of stream per km2 (approximate, see note below).
// Assumptions: True D8 flow tracing / pour-point watershed delineation is
//            not natively available in the EE raster model; this engine
//            uses HydroSHEDS' precomputed direction/accumulation grids
//            where available and documents the fallback approximation
//            otherwise.
// ============================================================================

BGDSS.HYDROLOGY = {};

BGDSS.HYDROLOGY.run = function () {
  var LABEL = 'HYDROLOGY';
  var geometry = BGDSS.STATE.roiGeometry;

  // ---- Load -----------------------------------------------------------------
  var dem = BGDSS.CACHE.dem || BGDSS.UTIL.safeClip(BGDSS.DATA.getDem());
  var flowDir = BGDSS.DATA.getHydroshedsDir();
  var flowAcc = BGDSS.DATA.getHydroshedsAcc();

  if (!dem && !flowDir) {
    BGDSS.UTIL.log(LABEL, 'Dataset unavailable. Skipping module.', 'warn');
    return;
  }
  BGDSS.UTIL.log(LABEL, 'Hydrology datasets loaded', 'ok');

  // ---- Preprocess -------------------------------------------------------------
  var slope = BGDSS.RESULTS.terrain.slope || (dem ? ee.Terrain.slope(dem) : null);
  var usingHydrosheds = !!(flowDir && flowAcc);

  var flowDirection, flowAccumulation;
  if (usingHydrosheds) {
    // WWF/HydroSHEDS/15DIR is a D8 direction code (1=E,2=SE,4=S,8=SW,16=W,
    // 32=NW,64=N,128=NE); 0=ocean outlet and 255=inland sink are nodata.
    flowDirection = flowDir.clip(geometry).updateMask(flowDir.neq(0).and(flowDir.neq(255))).rename('flowDirection');
    flowAccumulation = flowAcc.clip(geometry).rename('flowAccumulation');
  } else {
    // Fallback proxy: aspect-derived 8-direction flow, and a slope-weighted
    // upslope-contribution proxy (NOT a true accumulation trace).
    var aspect = BGDSS.RESULTS.terrain.aspect || ee.Terrain.aspect(dem);
    flowDirection = aspect.divide(45).round().mod(8).add(1).rename('flowDirection');
    flowAccumulation = ee.Image(1).divide(slope.add(1)).multiply(100)
      .focal_sum({ radius: 10, kernelType: 'circle', units: 'pixels' })
      .rename('flowAccumulation');
    BGDSS.UTIL.log(LABEL, 'HydroSHEDS direction/accumulation unavailable - using DEM-derived proxy', 'warn');
  }

  // Drainage network: threshold flow accumulation at its 95th percentile
  // within the ROI to isolate channelized flow paths.
  var accPercentile = flowAccumulation.reduceRegion({
    reducer: ee.Reducer.percentile([90]),
    geometry: geometry,
    scale: BGDSS.CONFIG.coarseScale,
    maxPixels: BGDSS.CONFIG.maxPixels,
    tileScale: BGDSS.CONFIG.tileScale,
    bestEffort: true
  });
  var accThreshold = ee.Number(accPercentile.values().get(0));
  var drainage = flowAccumulation.gt(accThreshold).selfMask().rename('drainage');

  // Micro-watersheds: intersect HydroBASINS (if available) with the ROI;
  // otherwise skip gracefully (documented limitation).
  var watersheds = null;
  var hydroBasins = BGDSS.DATA.getHydroBasins();
  if (hydroBasins) {
    watersheds = hydroBasins.filterBounds(geometry);
  }

  // Drainage density proxy: stream-pixel count * pixel length / ROI area.
  var pixelCount = drainage.reduceRegion({
    reducer: ee.Reducer.count(),
    geometry: geometry,
    scale: BGDSS.CONFIG.coarseScale,
    maxPixels: BGDSS.CONFIG.maxPixels,
    tileScale: BGDSS.CONFIG.tileScale,
    bestEffort: true
  }).get('drainage');
  var streamLengthKm = ee.Number(pixelCount).multiply(BGDSS.CONFIG.coarseScale).divide(1000);
  var drainageDensity = streamLengthKm.divide(BGDSS.STATE.areaKm2); // km/km2

  // Water harvesting suitability: low slope + close to drainage + high flow
  // accumulation are favorable; weighted overlay -> 5-class suitability.
  var distanceToDrainage = drainage.unmask(0).fastDistanceTransform(256).sqrt()
    .multiply(ee.Image.pixelArea().sqrt()).rename('distToDrainage');
  var slopeNorm = BGDSS.UTIL.normalize(slope, 0, 30, true);          // low slope favorable
  var distNorm = BGDSS.UTIL.normalize(distanceToDrainage, 0, 1000, true); // close favorable
  var accNorm = BGDSS.UTIL.normalize(flowAccumulation, 0, accThreshold, false);
  var whOverlay = BGDSS.UTIL.weightedOverlay([slopeNorm, distNorm, accNorm], [0.4, 0.35, 0.25]);
  var waterHarvestSuitability = BGDSS.UTIL.classify5(whOverlay);

  // ---- Statistics -------------------------------------------------------------
  BGDSS.UTIL.registerStat('hydrology', 'drainageDensityKmPerKm2', drainageDensity);
  BGDSS.UTIL.registerStat('hydrology', 'flowAccumulation', BGDSS.UTIL.computeStats(flowAccumulation, 'flowAccumulation', { scale: BGDSS.CONFIG.coarseScale }));
  BGDSS.UTIL.registerStat('hydrology', 'waterHarvestSuitabilityArea', BGDSS.UTIL.computeAreaStats(waterHarvestSuitability, BGDSS.UTIL.CLASS_LABELS_5, { scale: BGDSS.CONFIG.coarseScale }));

  // ---- Visualization -------------------------------------------------------------
  var flowDirVis = usingHydrosheds
    ? { min: 1, max: 128, palette: ['ff0000', 'ff8000', 'ffff00', '80ff00', '00ff00', '00ffff', '0000ff', 'ff00ff'] }
    : { min: 1, max: 8, palette: ['ff0000', 'ff8000', 'ffff00', '80ff00', '00ff00', '00ffff', '0000ff', 'ff00ff'] };
  BGDSS.UTIL.addLayer(flowDirection, flowDirVis, 'Hydrology: Flow Direction', false);
  BGDSS.UTIL.addLayer(flowAccumulation, { min: 0, max: 1000, palette: ['ffffcc', '41b6c4', '253494'] }, 'Hydrology: Flow Accumulation', false);
  BGDSS.UTIL.addLayer(drainage, { palette: ['0000ff'] }, 'Hydrology: Drainage Network', true);
  BGDSS.UTIL.addLayer(waterHarvestSuitability, { min: 1, max: 5, palette: BGDSS.UTIL.PALETTE_5 }, 'Hydrology: Water Harvesting Suitability', false);
  if (watersheds) { BGDSS.UTIL.addLayer(ee.Image().paint(watersheds, 1, 2), { palette: ['ffffff'] }, 'Hydrology: Micro-watersheds', false); }
  BGDSS.UTIL.addLegend('Water Harvesting Suitability', BGDSS.UTIL.PALETTE_5, BGDSS.UTIL.CLASS_LABELS_5);

  // ---- Registration -------------------------------------------------------------
  BGDSS.UTIL.registerResult('hydrology', 'flowDirection', flowDirection);
  BGDSS.UTIL.registerResult('hydrology', 'flowAccumulation', flowAccumulation);
  BGDSS.UTIL.registerResult('hydrology', 'drainage', drainage);
  BGDSS.UTIL.registerResult('hydrology', 'waterHarvestSuitability', waterHarvestSuitability);
  if (watersheds) { BGDSS.UTIL.registerResult('hydrology', 'watersheds', watersheds); }
  BGDSS.CACHE.drainage = drainage;
  BGDSS.CACHE.distanceToDrainage = distanceToDrainage;

  BGDSS.EXPORT.registerImage('Hydrology_FlowAccumulation', flowAccumulation, BGDSS.CONFIG.coarseScale);
  BGDSS.EXPORT.registerImage('Hydrology_Drainage', drainage, BGDSS.CONFIG.coarseScale);
  BGDSS.EXPORT.registerImage('Hydrology_WaterHarvestSuitability', waterHarvestSuitability, BGDSS.CONFIG.coarseScale);
  if (watersheds) { BGDSS.EXPORT.registerTable('Hydrology_Watersheds', watersheds); }

  BGDSS.UTIL.log(LABEL, 'Hydrology Engine Completed', 'ok');
};

BGDSS.WORKFLOW.register('HYDROLOGY', BGDSS.HYDROLOGY.run);

// ============================================================================
// SECTION: CLIMATE ENGINE
// ----------------------------------------------------------------------------
// Datasets : CHIRPS Daily (rainfall, mm/day), MODIS MOD11A2 LST (8-day, K).
// Produces : Annual rainfall, seasonal rainfall (monsoon/winter/summer),
//            monthly rainfall table, mean day/night temperature (°C),
//            simplified PET (Hargreaves), Dryness/Aridity Index.
// Units    : rainfall mm; temperature °C; PET mm.
// References: Hargreaves & Samani 1985 (simplified PET); UNEP aridity index
//            (PET/precipitation).
// ============================================================================

BGDSS.CLIMATE = {};

BGDSS.CLIMATE.run = function () {
  var LABEL = 'CLIMATE';
  var geometry = BGDSS.STATE.roiGeometry;
  var year = BGDSS.CONFIG.year;
  var yearStart = ee.Date.fromYMD(year, 1, 1);
  var yearEnd = yearStart.advance(1, 'year');

  // ---- Load -----------------------------------------------------------------
  var chirps = BGDSS.DATA.getChirps();
  var lst = BGDSS.DATA.getModisLst();
  if (!chirps && !lst) { BGDSS.UTIL.log(LABEL, 'Dataset unavailable. Skipping module.', 'warn'); return; }

  // ---- Analysis: Rainfall -----------------------------------------------------
  var annualRainfall = null, seasonal = {}, monthlyStats = [];
  if (chirps) {
    var yearCol = chirps.filterDate(yearStart, yearEnd);
    annualRainfall = yearCol.sum().clip(geometry).rename('rainfall');
    BGDSS.UTIL.log(LABEL, 'Rainfall Calculated', 'ok');

    var seasonDefs = {
      monsoon: BGDSS.CONFIG.constants.monsoonMonths,
      winter: BGDSS.CONFIG.constants.winterMonths,
      summer: BGDSS.CONFIG.constants.summerMonths
    };
    Object.keys(seasonDefs).forEach(function (seasonName) {
      var months = seasonDefs[seasonName];
      var seasonCol = chirps.filter(ee.Filter.calendarRange(months[0], months[months.length - 1], 'month'))
        .filterDate(yearStart.advance(-1, 'month'), yearEnd.advance(1, 'month'));
      seasonal[seasonName] = seasonCol.sum().clip(geometry).rename(seasonName + 'Rainfall');
    });

    for (var m = 1; m <= 12; m++) {
      var mStart = ee.Date.fromYMD(year, m, 1);
      var mEnd = mStart.advance(1, 'month');
      var monthImg = chirps.filterDate(mStart, mEnd).sum().clip(geometry).rename('m' + m);
      monthlyStats.push(BGDSS.UTIL.computeStats(monthImg, 'm' + m, { scale: BGDSS.CONFIG.coarseScale }));
    }
    BGDSS.UTIL.registerStat('climate', 'monthlyRainfall', monthlyStats);
  }

  // ---- Analysis: Temperature --------------------------------------------------
  var tempDayC = null, tempNightC = null, tempMeanC = null;
  if (lst) {
    var lstYear = lst.filterDate(yearStart, yearEnd);
    tempDayC = lstYear.select('LST_Day_1km').mean().multiply(0.02).subtract(273.15).clip(geometry).rename('tempDay');
    tempNightC = lstYear.select('LST_Night_1km').mean().multiply(0.02).subtract(273.15).clip(geometry).rename('tempNight');
    tempMeanC = tempDayC.add(tempNightC).divide(2).rename('tempMean');
  }

  // ---- Analysis: PET (simplified Hargreaves) & Dryness Index -----------------
  var pet = null, drynessIndex = null;
  if (tempDayC && tempNightC && annualRainfall) {
    // Simplified Hargreaves: PET = 0.0023 * Ra * (Tmean + 17.8) * sqrt(Tmax - Tmin)
    // Ra (extraterrestrial radiation) approximated as a regional constant
    // (mm/day equivalent) for Sabarkantha's latitude (~23.8N), annualized.
    var Ra = 15.5; // documented simplification - regional mean daily Ra proxy
    var tRange = tempDayC.subtract(tempNightC).abs().max(0.1);
    var petDaily = tRange.sqrt().multiply(tempMeanC.add(17.8)).multiply(0.0023 * Ra);
    pet = petDaily.multiply(365).rename('pet'); // annualized, mm/yr

    drynessIndex = pet.divide(annualRainfall.max(1)).rename('drynessIndex');
  }

  // ---- Statistics -------------------------------------------------------------
  if (annualRainfall) { BGDSS.UTIL.registerStat('climate', 'annualRainfall', BGDSS.UTIL.computeStats(annualRainfall, 'rainfall', { scale: BGDSS.CONFIG.coarseScale })); }
  if (tempMeanC) { BGDSS.UTIL.registerStat('climate', 'temperature', BGDSS.UTIL.computeStats(tempMeanC, 'tempMean', { scale: BGDSS.CONFIG.coarseScale })); }
  if (pet) { BGDSS.UTIL.registerStat('climate', 'pet', BGDSS.UTIL.computeStats(pet, 'pet', { scale: BGDSS.CONFIG.coarseScale })); }
  if (drynessIndex) { BGDSS.UTIL.registerStat('climate', 'drynessIndex', BGDSS.UTIL.computeStats(drynessIndex, 'drynessIndex', { scale: BGDSS.CONFIG.coarseScale })); }

  // ---- Visualization -------------------------------------------------------------
  if (annualRainfall) { BGDSS.UTIL.addLayer(annualRainfall, { min: 300, max: 1500, palette: ['ffffcc', 'a1dab4', '41b6c4', '225ea8', '253494'] }, 'Climate: Annual Rainfall (mm)', false); }
  if (tempMeanC) { BGDSS.UTIL.addLayer(tempMeanC, { min: 15, max: 40, palette: ['313695', '74add1', 'fee090', 'f46d43', 'a50026'] }, 'Climate: Mean Temperature (C)', false); }
  if (pet) { BGDSS.UTIL.addLayer(pet, { min: 500, max: 2500, palette: ['f7fcf5', 'a1d99b', '31a354'] }, 'Climate: PET (mm/yr)', false); }
  if (drynessIndex) { BGDSS.UTIL.addLayer(drynessIndex, { min: 0, max: 3, palette: ['1a9850', 'fee08b', 'd73027'] }, 'Climate: Dryness Index', false); }

  // ---- Registration -------------------------------------------------------------
  if (annualRainfall) { BGDSS.UTIL.registerResult('climate', 'annualRainfall', annualRainfall); BGDSS.EXPORT.registerImage('Climate_AnnualRainfall', annualRainfall, BGDSS.CONFIG.coarseScale); }
  Object.keys(seasonal).forEach(function (s) {
    BGDSS.UTIL.registerResult('climate', s + 'Rainfall', seasonal[s]);
    BGDSS.EXPORT.registerImage('Climate_' + s + 'Rainfall', seasonal[s], BGDSS.CONFIG.coarseScale);
  });
  if (tempMeanC) { BGDSS.UTIL.registerResult('climate', 'temperature', tempMeanC); BGDSS.EXPORT.registerImage('Climate_Temperature', tempMeanC, BGDSS.CONFIG.coarseScale); }
  if (pet) { BGDSS.UTIL.registerResult('climate', 'pet', pet); BGDSS.EXPORT.registerImage('Climate_PET', pet, BGDSS.CONFIG.coarseScale); }
  if (drynessIndex) { BGDSS.UTIL.registerResult('climate', 'drynessIndex', drynessIndex); BGDSS.EXPORT.registerImage('Climate_DrynessIndex', drynessIndex, BGDSS.CONFIG.coarseScale); }
  BGDSS.CACHE.annualRainfall = annualRainfall;
  BGDSS.CACHE.tempMeanC = tempMeanC;

  BGDSS.UTIL.log(LABEL, 'Climate Engine Completed', 'ok');
};

BGDSS.WORKFLOW.register('CLIMATE', BGDSS.CLIMATE.run);

// ============================================================================
// SECTION: VEGETATION ENGINE
// ----------------------------------------------------------------------------
// Dataset  : Sentinel-2 SR Harmonized (10-20m).
// Produces : Cloud-masked median composite, NDVI, NDMI, EVI, SAVI, NBR,
//            5-class vegetation health.
// Units    : all indices are unitless ratios, typically in [-1, 1].
// References: Rouse et al. 1974 (NDVI); Gao 1996 (NDMI); Huete et al. 2002
//            (EVI); Huete 1988 (SAVI); Key & Benson 2006 (NBR).
// ============================================================================

BGDSS.VEGETATION = {};

/** Cloud mask using the Sentinel-2 SCL (Scene Classification Layer). */
BGDSS.VEGETATION._maskS2 = function (image) {
  var scl = image.select('SCL');
  var clearMask = scl.neq(3).and(scl.neq(8)).and(scl.neq(9)).and(scl.neq(10)).and(scl.neq(11));
  return image.updateMask(clearMask).divide(10000)
    .copyProperties(image, ['system:time_start']);
};

BGDSS.VEGETATION.run = function () {
  var LABEL = 'VEGETATION';
  var geometry = BGDSS.STATE.roiGeometry;
  var year = BGDSS.CONFIG.year;

  // ---- Load -----------------------------------------------------------------
  var s2 = BGDSS.DATA.getSentinel2();
  if (!s2) { BGDSS.UTIL.log(LABEL, 'Dataset unavailable. Skipping module.', 'warn'); return; }

  // ---- Preprocess -------------------------------------------------------------
  var yearStart = ee.Date.fromYMD(year, 1, 1);
  var yearEnd = yearStart.advance(1, 'year');
  var composite = s2.filterDate(yearStart, yearEnd)
    .filterBounds(geometry)
    .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 40))
    .map(BGDSS.VEGETATION._maskS2)
    .median()
    .clip(geometry);
  BGDSS.UTIL.log(LABEL, 'Sentinel-2 Composite Built', 'ok');

  // ---- Analysis ---------------------------------------------------------------
  var ndvi = composite.normalizedDifference(['B8', 'B4']).rename('ndvi');
  var ndmi = composite.normalizedDifference(['B8', 'B11']).rename('ndmi');
  var nbr = composite.normalizedDifference(['B8', 'B12']).rename('nbr');
  var evi = composite.expression(
    '2.5 * ((NIR - RED) / (NIR + 6 * RED - 7.5 * BLUE + 1))', {
      NIR: composite.select('B8'), RED: composite.select('B4'), BLUE: composite.select('B2')
    }).rename('evi');
  var savi = composite.expression(
    '((NIR - RED) / (NIR + RED + 0.5)) * 1.5', {
      NIR: composite.select('B8'), RED: composite.select('B4')
    }).rename('savi');

  var vegHealth = BGDSS.UTIL.classify5(BGDSS.UTIL.normalize(ndvi, -0.1, 0.9));

  // ---- Statistics -------------------------------------------------------------
  BGDSS.UTIL.registerStat('vegetation', 'ndvi', BGDSS.UTIL.computeStats(ndvi, 'ndvi'));
  BGDSS.UTIL.registerStat('vegetation', 'ndmi', BGDSS.UTIL.computeStats(ndmi, 'ndmi'));
  BGDSS.UTIL.registerStat('vegetation', 'evi', BGDSS.UTIL.computeStats(evi, 'evi'));
  BGDSS.UTIL.registerStat('vegetation', 'savi', BGDSS.UTIL.computeStats(savi, 'savi'));
  BGDSS.UTIL.registerStat('vegetation', 'nbr', BGDSS.UTIL.computeStats(nbr, 'nbr'));
  BGDSS.UTIL.registerStat('vegetation', 'healthArea', BGDSS.UTIL.computeAreaStats(vegHealth, BGDSS.UTIL.CLASS_LABELS_5));

  // ---- Visualization -------------------------------------------------------------
  BGDSS.UTIL.addLayer(composite, { bands: ['B4', 'B3', 'B2'], min: 0, max: 0.3 }, 'Vegetation: True Color', false);
  BGDSS.UTIL.addLayer(ndvi, { min: -0.1, max: 0.9, palette: ['a50026', 'fee08b', '1a9850'] }, 'Vegetation: NDVI', true);
  BGDSS.UTIL.addLayer(ndmi, { min: -0.5, max: 0.5, palette: ['a50026', 'fee08b', '1a9850'] }, 'Vegetation: NDMI', false);
  BGDSS.UTIL.addLayer(evi, { min: -0.1, max: 0.9, palette: ['a50026', 'fee08b', '1a9850'] }, 'Vegetation: EVI', false);
  BGDSS.UTIL.addLayer(savi, { min: -0.1, max: 0.9, palette: ['a50026', 'fee08b', '1a9850'] }, 'Vegetation: SAVI', false);
  BGDSS.UTIL.addLayer(nbr, { min: -0.5, max: 0.5, palette: ['a50026', 'fee08b', '1a9850'] }, 'Vegetation: NBR', false);
  BGDSS.UTIL.addLayer(vegHealth, { min: 1, max: 5, palette: BGDSS.UTIL.PALETTE_5 }, 'Vegetation: Health (5-class)', false);

  // ---- Registration -------------------------------------------------------------
  BGDSS.UTIL.registerResult('vegetation', 'composite', composite);
  BGDSS.UTIL.registerResult('vegetation', 'ndvi', ndvi);
  BGDSS.UTIL.registerResult('vegetation', 'ndmi', ndmi);
  BGDSS.UTIL.registerResult('vegetation', 'evi', evi);
  BGDSS.UTIL.registerResult('vegetation', 'savi', savi);
  BGDSS.UTIL.registerResult('vegetation', 'nbr', nbr);
  BGDSS.UTIL.registerResult('vegetation', 'health', vegHealth);
  BGDSS.CACHE.ndvi = ndvi;
  BGDSS.CACHE.ndmi = ndmi;
  BGDSS.CACHE.nbr = nbr;

  BGDSS.EXPORT.registerImage('Vegetation_NDVI', ndvi, BGDSS.CONFIG.scale);
  BGDSS.EXPORT.registerImage('Vegetation_NDMI', ndmi, BGDSS.CONFIG.scale);
  BGDSS.EXPORT.registerImage('Vegetation_Health', vegHealth, BGDSS.CONFIG.scale);

  BGDSS.UTIL.log(LABEL, 'NDVI Completed', 'ok');
  BGDSS.UTIL.log(LABEL, 'Vegetation Engine Completed', 'ok');
};

BGDSS.WORKFLOW.register('VEGETATION', BGDSS.VEGETATION.run);

// ============================================================================
// SECTION: FOREST RESOURCE ENGINE
// ----------------------------------------------------------------------------
// Datasets : ESA WorldCover v200 (10m land cover), Hansen Global Forest
//            Change (treecover2000, % canopy), ETH Global Canopy Height
//            2020 (10m, m) - community asset, optional.
// Produces : Forest cover mask, forest density (% canopy), canopy cover,
//            canopy height, forest fragmentation (Riitters et al. 2002
//            simplified: core/edge/perforated/transitional/patch).
// Units    : canopy cover %, canopy height m.
// References: Riitters et al. 2002 (fragmentation morphology).
// ============================================================================

BGDSS.FOREST = {};

BGDSS.FOREST.WORLD_COVER_TREE_CLASS = 10; // ESA WorldCover 'Tree cover' class code

BGDSS.FOREST.run = function () {
  var LABEL = 'FOREST';
  var geometry = BGDSS.STATE.roiGeometry;

  // ---- Load -----------------------------------------------------------------
  var worldCover = BGDSS.DATA.getWorldCover();
  var hansen = BGDSS.DATA.getHansenGfc();
  if (!worldCover && !hansen) { BGDSS.UTIL.log(LABEL, 'Dataset unavailable. Skipping module.', 'warn'); return; }

  // ---- Preprocess / Analysis ---------------------------------------------------
  var forestMask = null, canopyDensity = null;
  if (worldCover) {
    var lc = worldCover.select('Map').clip(geometry);
    forestMask = lc.eq(BGDSS.FOREST.WORLD_COVER_TREE_CLASS).rename('forestMask');
  }
  if (hansen) {
    canopyDensity = hansen.select('treecover2000').clip(geometry).rename('canopyDensity');
    if (!forestMask) { forestMask = canopyDensity.gte(30).rename('forestMask'); }
  }

  var canopyHeight = null;
  var canopyHeightImg = BGDSS.DATA.getCanopyHeight();
  if (canopyHeightImg) { canopyHeight = canopyHeightImg.clip(geometry).rename('canopyHeight'); }

  // Fragmentation (simplified Riitters morphology): Pf = forest proportion in
  // a 3x3 window, Pff = proportion of forest-forest adjacent pairs.
  var fragmentation = null;
  if (forestMask) {
    var pf = forestMask.focal_mean({ radius: 1, kernelType: 'square', units: 'pixels' }).rename('pf');
    var pff = forestMask.multiply(
      forestMask.focal_mean({ radius: 1, kernelType: 'square', units: 'pixels' })
    ).rename('pff');
    // classes: 1 Patch, 2 Transitional, 3 Perforated, 4 Edge, 5 Interior/Core
    fragmentation = ee.Image(1)
      .where(pf.gt(0.1), 2)
      .where(pf.gt(0.4), 3)
      .where(pf.gt(0.6).and(pff.lt(pf)), 4)
      .where(pf.gt(0.9), 5)
      .updateMask(forestMask.gt(0).or(pf.gt(0)))
      .rename('fragmentation')
      .clip(geometry);
  }

  // ---- Statistics -------------------------------------------------------------
  if (forestMask) {
    var forestArea = forestMask.multiply(ee.Image.pixelArea()).divide(1e4)
      .reduceRegion({ reducer: ee.Reducer.sum(), geometry: geometry, scale: BGDSS.CONFIG.scale, maxPixels: BGDSS.CONFIG.maxPixels, tileScale: BGDSS.CONFIG.tileScale, bestEffort: true });
    BGDSS.UTIL.registerStat('forest', 'forestAreaHa', forestArea);
  }
  if (canopyDensity) { BGDSS.UTIL.registerStat('forest', 'canopyDensity', BGDSS.UTIL.computeStats(canopyDensity, 'canopyDensity')); }
  if (canopyHeight) { BGDSS.UTIL.registerStat('forest', 'canopyHeight', BGDSS.UTIL.computeStats(canopyHeight, 'canopyHeight')); }
  if (fragmentation) { BGDSS.UTIL.registerStat('forest', 'fragmentationArea', BGDSS.UTIL.computeAreaStats(fragmentation, ['Patch', 'Transitional', 'Perforated', 'Edge', 'Interior/Core'])); }

  // ---- Visualization -------------------------------------------------------------
  if (forestMask) { BGDSS.UTIL.addLayer(forestMask.selfMask(), { palette: ['1a9850'] }, 'Forest: Cover Mask', true); }
  if (canopyDensity) { BGDSS.UTIL.addLayer(canopyDensity, { min: 0, max: 100, palette: ['ffffe5', '78c679', '004529'] }, 'Forest: Canopy Density (%)', false); }
  if (canopyHeight) { BGDSS.UTIL.addLayer(canopyHeight, { min: 0, max: 30, palette: ['ffffcc', '78c679', '004529'] }, 'Forest: Canopy Height (m)', false); }
  if (fragmentation) { BGDSS.UTIL.addLayer(fragmentation, { min: 1, max: 5, palette: ['d73027', 'fc8d59', 'fee08b', '91cf60', '1a9850'] }, 'Forest: Fragmentation', false); }

  // ---- Registration -------------------------------------------------------------
  if (forestMask) { BGDSS.UTIL.registerResult('forest', 'cover', forestMask); BGDSS.EXPORT.registerImage('Forest_Cover', forestMask, BGDSS.CONFIG.scale); }
  if (canopyDensity) { BGDSS.UTIL.registerResult('forest', 'density', canopyDensity); BGDSS.EXPORT.registerImage('Forest_CanopyDensity', canopyDensity, BGDSS.CONFIG.scale); }
  if (canopyHeight) { BGDSS.UTIL.registerResult('forest', 'canopyHeight', canopyHeight); BGDSS.EXPORT.registerImage('Forest_CanopyHeight', canopyHeight, BGDSS.CONFIG.scale); }
  if (fragmentation) { BGDSS.UTIL.registerResult('forest', 'fragmentation', fragmentation); BGDSS.EXPORT.registerImage('Forest_Fragmentation', fragmentation, BGDSS.CONFIG.scale); }
  BGDSS.CACHE.forestMask = forestMask;
  BGDSS.CACHE.canopyDensity = canopyDensity;
  BGDSS.CACHE.fragmentation = fragmentation;

  BGDSS.UTIL.log(LABEL, 'Forest Resource Engine Completed', 'ok');
};

BGDSS.WORKFLOW.register('FOREST', BGDSS.FOREST.run);

// ============================================================================
// SECTION: BIOMASS ENGINE
// ----------------------------------------------------------------------------
// Dataset  : ESA CCI Biomass (AGB, Mg/ha) - community-hosted asset (verify
//            current asset id in the GEE Community Data Catalog; falls back
//            to an NDVI-based allometric proxy if unavailable so the
//            downstream Carbon Engine can still run).
// Produces : Above-Ground Biomass (AGB), Below-Ground Biomass (BGB, via
//            root-shoot ratio), Total Biomass.
// Units    : Mg/ha (megagrams per hectare).
// References: IPCC 2006 Guidelines for National GHG Inventories, Vol. 4,
//            Ch. 4, Table 4.4 (root-shoot ratio for tropical/subtropical
//            dry forest, AGB > ~20 t/ha => default 0.28, set in BGDSS.CONFIG.
//            constants.rootShootRatio - lower-biomass/degraded stands carry
//            a higher ratio in IPCC's table; override locally if ICFRE/FSI
//            Working Plan volume-table data is available for this beat);
//            ESA CCI Biomass v5 handbook.
// ============================================================================

BGDSS.BIOMASS = {};

BGDSS.BIOMASS.run = function () {
  var LABEL = 'BIOMASS';
  var geometry = BGDSS.STATE.roiGeometry;

  // ---- Load -----------------------------------------------------------------
  var cciBiomass = BGDSS.DATA.getCciBiomass();
  var agb;
  if (cciBiomass) {
    agb = cciBiomass.select(0).clip(geometry).rename('agb');
    BGDSS.UTIL.log(LABEL, 'ESA CCI Biomass Loaded', 'ok');
  } else if (BGDSS.CACHE.ndvi) {
    // Documented fallback: simple NDVI-based allometric proxy
    // (AGB[Mg/ha] = 250 * NDVI, calibrated as a coarse dry-forest proxy
    // only - flagged in stats/exports as an estimate).
    agb = BGDSS.CACHE.ndvi.multiply(250).max(0).rename('agb');
    BGDSS.UTIL.log(LABEL, 'ESA CCI Biomass unavailable - using NDVI-based AGB proxy', 'warn');
  } else {
    BGDSS.UTIL.log(LABEL, 'Dataset unavailable. Skipping module.', 'warn');
    return;
  }

  // ---- Analysis ---------------------------------------------------------------
  var rsr = BGDSS.CONFIG.constants.rootShootRatio;
  var bgb = agb.multiply(rsr).rename('bgb');
  var totalBiomass = agb.add(bgb).rename('totalBiomass');

  // ---- Statistics -------------------------------------------------------------
  BGDSS.UTIL.registerStat('biomass', 'agb', BGDSS.UTIL.computeStats(agb, 'agb'));
  BGDSS.UTIL.registerStat('biomass', 'bgb', BGDSS.UTIL.computeStats(bgb, 'bgb'));
  BGDSS.UTIL.registerStat('biomass', 'totalBiomass', BGDSS.UTIL.computeStats(totalBiomass, 'totalBiomass'));

  // ---- Visualization -------------------------------------------------------------
  BGDSS.UTIL.addLayer(agb, { min: 0, max: 250, palette: ['ffffe5', '78c679', '004529'] }, 'Biomass: AGB (Mg/ha)', false);
  BGDSS.UTIL.addLayer(bgb, { min: 0, max: 60, palette: ['ffffe5', '78c679', '004529'] }, 'Biomass: BGB (Mg/ha)', false);
  BGDSS.UTIL.addLayer(totalBiomass, { min: 0, max: 310, palette: ['ffffe5', '78c679', '004529'] }, 'Biomass: Total Biomass (Mg/ha)', false);

  // ---- Registration -------------------------------------------------------------
  BGDSS.UTIL.registerResult('biomass', 'agb', agb);
  BGDSS.UTIL.registerResult('biomass', 'bgb', bgb);
  BGDSS.UTIL.registerResult('biomass', 'totalBiomass', totalBiomass);
  BGDSS.CACHE.agb = agb;
  BGDSS.CACHE.bgb = bgb;
  BGDSS.CACHE.totalBiomass = totalBiomass;

  BGDSS.EXPORT.registerImage('Biomass_AGB', agb, BGDSS.CONFIG.scale);
  BGDSS.EXPORT.registerImage('Biomass_BGB', bgb, BGDSS.CONFIG.scale);
  BGDSS.EXPORT.registerImage('Biomass_Total', totalBiomass, BGDSS.CONFIG.scale);

  BGDSS.UTIL.log(LABEL, 'Biomass Engine Completed', 'ok');
};

BGDSS.WORKFLOW.register('BIOMASS', BGDSS.BIOMASS.run);

// ============================================================================
// SECTION: CARBON ENGINE
// ----------------------------------------------------------------------------
// Input    : BGDSS.CACHE.totalBiomass from the Biomass Engine (re-derived
//            locally if the Biomass Engine was skipped).
// Produces : Carbon Stock (Mg C/ha), Carbon Density, CO2-equivalent.
// Units    : Mg C/ha; CO2-eq in Mg/ha.
// Method   : Carbon fraction of biomass defaults to 0.5 - the convention
//            used by FSI in the India State of Forest Report (ISFR) series
//            - rather than the IPCC 2006 Tier-1 international default of
//            0.47, since a Gujarat Forest Department audience will expect
//            ISFR-consistent numbers. Set BGDSS.CONFIG.constants.
//            carbonFraction = 0.47 to match international/IPCC reporting
//            instead. CO2-equivalent uses the standard 44/12 molecular
//            weight ratio (3.6663), per IPCC/FAO convention.
// ============================================================================

BGDSS.CARBON = {};

BGDSS.CARBON.run = function () {
  var LABEL = 'CARBON';
  var geometry = BGDSS.STATE.roiGeometry;

  // ---- Load / Validate --------------------------------------------------------
  var totalBiomass = BGDSS.CACHE.totalBiomass;
  if (!totalBiomass) {
    BGDSS.UTIL.log(LABEL, 'Dataset unavailable. Skipping module.', 'warn');
    return;
  }

  // ---- Analysis ---------------------------------------------------------------
  var cf = BGDSS.CONFIG.constants.carbonFraction;
  var carbonStock = totalBiomass.multiply(cf).rename('carbonStock');
  var co2eq = carbonStock.multiply(BGDSS.CONFIG.constants.co2Conversion).rename('co2eq');

  // Carbon density expressed per pixel-area-normalized hectare (identical to
  // stock per ha here since inputs are already Mg/ha; kept as a distinct,
  // separately named/exported layer per the spec's output structure).
  var carbonDensity = carbonStock.rename('carbonDensity');

  // ---- Statistics -------------------------------------------------------------
  BGDSS.UTIL.registerStat('carbon', 'carbonStock', BGDSS.UTIL.computeStats(carbonStock, 'carbonStock'));
  BGDSS.UTIL.registerStat('carbon', 'co2eq', BGDSS.UTIL.computeStats(co2eq, 'co2eq'));
  var totalCarbonTons = carbonStock.multiply(ee.Image.pixelArea().divide(1e4))
    .reduceRegion({ reducer: ee.Reducer.sum(), geometry: geometry, scale: BGDSS.CONFIG.scale, maxPixels: BGDSS.CONFIG.maxPixels, tileScale: BGDSS.CONFIG.tileScale, bestEffort: true });
  BGDSS.UTIL.registerStat('carbon', 'totalCarbonTons', totalCarbonTons);

  // ---- Visualization -------------------------------------------------------------
  BGDSS.UTIL.addLayer(carbonStock, { min: 0, max: 150, palette: ['f7fcf5', '74c476', '00441b'] }, 'Carbon: Stock (Mg C/ha)', false);
  BGDSS.UTIL.addLayer(co2eq, { min: 0, max: 550, palette: ['f7fcf5', '74c476', '00441b'] }, 'Carbon: CO2-eq (Mg/ha)', false);

  // ---- Registration -------------------------------------------------------------
  BGDSS.UTIL.registerResult('carbon', 'stock', carbonStock);
  BGDSS.UTIL.registerResult('carbon', 'density', carbonDensity);
  BGDSS.UTIL.registerResult('carbon', 'co2eq', co2eq);
  BGDSS.CACHE.carbonStock = carbonStock;

  BGDSS.EXPORT.registerImage('Carbon_Stock', carbonStock, BGDSS.CONFIG.scale);
  BGDSS.EXPORT.registerImage('Carbon_CO2eq', co2eq, BGDSS.CONFIG.scale);

  BGDSS.UTIL.log(LABEL, 'Carbon Completed', 'ok');
};

BGDSS.WORKFLOW.register('CARBON', BGDSS.CARBON.run);

// ============================================================================
// SECTION: FIRE RISK ENGINE
// ----------------------------------------------------------------------------
// Datasets : MODIS MCD64A1 Burned Area (monthly, 500m) for observed history;
//            Terrain/Climate/Forest layers already cached by earlier
//            engines; optional BGDSS.CONFIG.villages / .roads.
// Produces : Fuel Load, Fuel Moisture, Fire History, Fire Density, Fire
//            Frequency (all descriptive/observational), and the predictive
//            Fire Susceptibility + final 5-class Fire Risk.
// Method   : India-specific AHP (Analytic Hierarchy Process) fire risk
//            zonation, NOT a generic global model. Reproduces the published
//            pairwise-comparison weights of Jaiswal, Mukherjee, Krishnamurthy
//            & Saxena (2002), "Forest fire risk zone mapping from satellite
//            imagery and GIS", Int. J. Applied Earth Observation and
//            Geoinformation 4(1):1-10 - developed and validated for Indian
//            dry-deciduous forest, where human ignition sources dominate
//            (unlike lightning-driven regimes assumed by most global fire
//            models). Forest-type inflammability follows Champion & Seth
//            (1968) classification (see BGDSS.CONFIG.forestType). All seven
//            criterion weights are declared in BGDSS.CONFIG.constants.
//            fireWeights so a Range/DFO team can re-run their own AHP
//            pairwise comparison and override them - this is a starting
//            point calibrated to Indian literature, not a fixed law.
// Units    : fire frequency in years-burned-count; risk is a unitless
//            0-1 overlay score before classification.
// ============================================================================

BGDSS.FIRE = {};

BGDSS.FIRE.run = function () {
  var LABEL = 'FIRE';
  var geometry = BGDSS.STATE.roiGeometry;
  var year = BGDSS.CONFIG.year;
  var lookback = BGDSS.CONFIG.fireHistoryYears;

  // ---- Load -----------------------------------------------------------------
  var burnedAreaCol = BGDSS.DATA.getModisBurnedArea();
  if (!burnedAreaCol) { BGDSS.UTIL.log(LABEL, 'Dataset unavailable. Skipping module.', 'warn'); return; }

  var histStart = ee.Date.fromYMD(year - lookback, 1, 1);
  var histEnd = ee.Date.fromYMD(year, 12, 31);
  var burnedHistory = burnedAreaCol.filterDate(histStart, histEnd).select('BurnDate');

  // ---- Analysis: Fire History / Density / Frequency (observed, from MODIS) --
  var fireHistory = burnedHistory.map(function (img) { return img.gt(0); }).sum().clip(geometry).rename('fireHistory');
  var fireFrequency = fireHistory.rename('fireFrequency'); // count of burned periods, proxy for frequency
  var burnedCells = fireHistory.gt(0);
  var fireDensity = burnedCells
    .focal_mean({ radius: 5, kernelType: 'circle', units: 'pixels' })
    .rename('fireDensity');

  // ---- Fuel Load & Fuel Moisture (descriptive layers, from cached NDVI/Biomass) --
  var ndvi = BGDSS.CACHE.ndvi;
  var ndmi = BGDSS.CACHE.ndmi;
  var totalBiomass = BGDSS.CACHE.totalBiomass;
  var fuelLoad = totalBiomass ? totalBiomass.unitScale(0, 200).clamp(0, 1).rename('fuelLoad')
    : (ndvi ? ndvi.unitScale(-0.1, 0.9).clamp(0, 1).rename('fuelLoad') : null);
  var fuelMoisture = ndmi ? ndmi.unitScale(-0.5, 0.5).clamp(0, 1).rename('fuelMoisture') : null;

  // ---- Criterion 1: Forest-type inflammability (Champion & Seth 1968) --------
  // Baseline inflammability of the beat's forest type (dry deciduous/teak is
  // among India's most fire-prone types), reduced slightly where canopy is
  // denser (better moisture retention) and left at full baseline over
  // open/degraded/non-forest ground.
  var canopyDensity = BGDSS.CACHE.canopyDensity;
  var baseline = BGDSS.CONFIG.forestType.forestTypeBaseline;
  var forestTypeRisk;
  if (canopyDensity) {
    var densityDamping = BGDSS.UTIL.normalize(canopyDensity, 0, 80, false).multiply(0.3);
    forestTypeRisk = ee.Image(baseline).multiply(ee.Image(1).subtract(densityDamping)).rename('forestTypeRisk');
  } else {
    forestTypeRisk = ee.Image(baseline).rename('forestTypeRisk').clip(geometry);
  }

  // ---- Criterion 2: Settlement proximity (dominant human ignition source) ---
  var settlementNorm;
  if (BGDSS.CONFIG.villages) {
    try {
      var villageDistance = BGDSS.CACHE.villageDistance || ee.Image(0).paint(BGDSS.CONFIG.villages, 1).not()
        .fastDistanceTransform(1024).sqrt().multiply(ee.Image.pixelArea().sqrt()).rename('villageDistance');
      BGDSS.CACHE.villageDistance = villageDistance;
      settlementNorm = BGDSS.UTIL.normalize(villageDistance, 0, 3000, true); // closer to village -> higher risk
    } catch (e) {
      settlementNorm = ee.Image(0.5);
      BGDSS.UTIL.log(LABEL, 'Village layer invalid - Settlement Proximity (highest-weighted human factor, 18.5%) defaulted to neutral', 'warn');
    }
  } else {
    settlementNorm = ee.Image(0.5);
    BGDSS.UTIL.log(LABEL, 'BGDSS.CONFIG.villages not provided - Settlement Proximity (18.5% of fire-risk weight) defaulted to neutral (0.5); provide a village FeatureCollection for an accurate score', 'warn');
  }

  // ---- Criterion 3: Slope (steeper -> faster upslope spread) -----------------
  var slope = BGDSS.RESULTS.terrain.slope;
  var slopeNorm = slope ? BGDSS.UTIL.normalize(slope, 0, 35, false) : ee.Image(0.5);

  // ---- Criterion 4: Road proximity (access for graziers/travellers = ignition) --
  var roadNorm;
  if (BGDSS.CONFIG.roads) {
    try {
      var roadDistance = ee.Image(0).paint(BGDSS.CONFIG.roads, 1).not()
        .fastDistanceTransform(1024).sqrt().multiply(ee.Image.pixelArea().sqrt()).rename('roadDistance');
      roadNorm = BGDSS.UTIL.normalize(roadDistance, 0, 2000, true);
    } catch (e) {
      roadNorm = ee.Image(0.5);
      BGDSS.UTIL.log(LABEL, 'Road layer invalid - Road Proximity defaulted to neutral', 'warn');
    }
  } else {
    roadNorm = ee.Image(0.5);
    BGDSS.UTIL.log(LABEL, 'BGDSS.CONFIG.roads not provided - Road Proximity (12.6% of fire-risk weight) defaulted to neutral (0.5); provide a road FeatureCollection for an accurate score', 'warn');
  }

  // ---- Criterion 5: Temperature; Criterion 6: Rainfall; Criterion 7: Aspect --
  var tempMeanC = BGDSS.CACHE.tempMeanC;
  var rainfall = BGDSS.CACHE.annualRainfall;
  var aspect = BGDSS.RESULTS.terrain.aspect;
  var temperatureNorm = tempMeanC ? BGDSS.UTIL.normalize(tempMeanC, 20, 42, false) : ee.Image(0.5);
  var rainfallNorm = rainfall ? BGDSS.UTIL.normalize(rainfall, 300, 1500, true) : ee.Image(0.5); // drier beat -> higher risk
  // South-facing slopes (135-225 deg, N hemisphere - Gujarat) receive more solar load -> drier fuel -> higher risk.
  var aspectNorm = aspect ? aspect.subtract(180).abs().multiply(-1).add(180).divide(180).rename('aspectRisk') : ee.Image(0.5);

  // ---- Fire Susceptibility: Jaiswal et al. (2002) AHP weighted overlay -------
  var w = BGDSS.CONFIG.constants.fireWeights;
  var criteria = [forestTypeRisk, settlementNorm, slopeNorm, roadNorm, temperatureNorm, rainfallNorm, aspectNorm];
  var weights = [w.forestType, w.settlementProximity, w.slope, w.roadProximity, w.temperature, w.rainfall, w.aspect];
  var susceptibility = BGDSS.UTIL.weightedOverlay(criteria, weights).rename('fireSusceptibility');
  var fireRisk = BGDSS.UTIL.classify5(susceptibility);

  // ---- Statistics -------------------------------------------------------------
  BGDSS.UTIL.registerStat('fire', 'fireHistory', BGDSS.UTIL.computeStats(fireHistory, 'fireHistory', { scale: BGDSS.CONFIG.coarseScale }));
  BGDSS.UTIL.registerStat('fire', 'fireDensity', BGDSS.UTIL.computeStats(fireDensity, 'fireDensity', { scale: BGDSS.CONFIG.coarseScale }));
  BGDSS.UTIL.registerStat('fire', 'susceptibility', BGDSS.UTIL.computeStats(susceptibility, 'fireSusceptibility'));
  BGDSS.UTIL.registerStat('fire', 'riskArea', BGDSS.UTIL.computeAreaStats(fireRisk, BGDSS.UTIL.CLASS_LABELS_5));

  // ---- Visualization -------------------------------------------------------------
  BGDSS.UTIL.addLayer(fireHistory.selfMask(), { min: 1, max: lookback, palette: ['fee08b', 'd73027', '7f0000'] }, 'Fire: Observed History (years burned)', false);
  BGDSS.UTIL.addLayer(fireDensity, { min: 0, max: 1, palette: ['ffffcc', 'fc4e2a', '800026'] }, 'Fire: Density', false);
  BGDSS.UTIL.addLayer(forestTypeRisk, { min: 0, max: 1, palette: BGDSS.UTIL.PALETTE_5 }, 'Fire: Forest-Type Inflammability', false);
  BGDSS.UTIL.addLayer(susceptibility, { min: 0, max: 1, palette: BGDSS.UTIL.PALETTE_5 }, 'Fire: Susceptibility (AHP score)', false);
  BGDSS.UTIL.addLayer(fireRisk, { min: 1, max: 5, palette: BGDSS.UTIL.PALETTE_5 }, 'Fire: Risk (5-class, Jaiswal et al. 2002 AHP)', true);
  BGDSS.UTIL.addLegend('Fire Risk (Jaiswal et al. 2002 AHP)', BGDSS.UTIL.PALETTE_5, BGDSS.UTIL.CLASS_LABELS_5);

  // ---- Registration -------------------------------------------------------------
  if (fuelLoad) { BGDSS.UTIL.registerResult('fire', 'fuelLoad', fuelLoad); }
  if (fuelMoisture) { BGDSS.UTIL.registerResult('fire', 'fuelMoisture', fuelMoisture); }
  BGDSS.UTIL.registerResult('fire', 'history', fireHistory);
  BGDSS.UTIL.registerResult('fire', 'density', fireDensity);
  BGDSS.UTIL.registerResult('fire', 'frequency', fireFrequency);
  BGDSS.UTIL.registerResult('fire', 'forestTypeRisk', forestTypeRisk);
  BGDSS.UTIL.registerResult('fire', 'susceptibility', susceptibility);
  BGDSS.UTIL.registerResult('fire', 'risk', fireRisk);
  BGDSS.CACHE.fireRisk = fireRisk;
  BGDSS.CACHE.susceptibility = susceptibility;

  BGDSS.EXPORT.registerImage('Fire_History', fireHistory, BGDSS.CONFIG.coarseScale);
  BGDSS.EXPORT.registerImage('Fire_Susceptibility', susceptibility, BGDSS.CONFIG.scale);
  BGDSS.EXPORT.registerImage('Fire_Risk', fireRisk, BGDSS.CONFIG.scale);

  BGDSS.UTIL.log(LABEL, 'Fire Risk Completed (Jaiswal et al. 2002 India AHP model)', 'ok');
};

BGDSS.WORKFLOW.register('FIRE', BGDSS.FIRE.run);

// ============================================================================
// SECTION: SOIL ENGINE
// ----------------------------------------------------------------------------
// Datasets : NASA SMAP SPL4SMGP (soil moisture, optional), OpenLandMap
//            texture class / organic carbon / bulk density / sand / clay,
//            ESA WorldCover (for the land-cover C-factor lookup).
// Produces : Soil Moisture, Soil Type (texture class), RUSLE Soil Loss
//            (t/ha/yr), Erosion Risk (5-class).
// Units    : soil loss t/ha/yr.
// Method   : RUSLE (Wischmeier & Smith 1978; Renard et al. 1997), adapted
//            to Indian conditions rather than using US-calibrated defaults:
//            - R (rainfall erosivity): Singh, Babu & Chandra (1981), Central
//              Soil & Water Conservation Research and Training Institute
//              (CSWCRTI), Dehradun - derived and validated for Indian
//              rainfall regimes: R = 79 + 0.363*P (P = mean annual rainfall,
//              mm). BGDSS.CONFIG.constants.rusleRFormula can switch back to
//              the generic Renard & Freimund (1994) formula if preferred.
//            - K (soil erodibility): Williams (1995) EPIC nomograph from
//              OpenLandMap sand/clay/organic-carbon fractions.
//            - LS (slope length-steepness): Moore et al. (1991).
//            - C (cover-management): land-cover lookup table following the
//              NRSC/ISRO "Soil Erosion Atlas of India" (2018, Dept. of Land
//              Resources) methodology - the nationally accepted reference
//              method for Indian soil-loss mapping - using ESA WorldCover
//              classes. BGDSS.CONFIG.constants.rusleCMethod can switch to
//              the continuous Van der Knijff et al. (2000) NDVI formula.
//              NOTE: lookup C-values here follow the published literature
//              range for each class; cross-check against the Gujarat-
//              specific atlas sheet if higher precision is required.
// ============================================================================

BGDSS.SOIL = {};

BGDSS.SOIL.run = function () {
  var LABEL = 'SOIL';
  var geometry = BGDSS.STATE.roiGeometry;

  // ---- Load -----------------------------------------------------------------
  var texture = BGDSS.DATA.getSoilTexture();
  var organicCarbon = BGDSS.DATA.getSoilOrganicCarbon();
  var sand = BGDSS.DATA.getSoilSand();
  var clay = BGDSS.DATA.getSoilClay();
  var smapCol = BGDSS.DATA.getSmapSoilMoisture();

  if (!texture && !sand) { BGDSS.UTIL.log(LABEL, 'Dataset unavailable. Skipping module.', 'warn'); return; }

  // ---- Preprocess -------------------------------------------------------------
  var soilType = texture ? texture.select(0).clip(geometry).rename('soilType') : null;

  var soilMoisture = null;
  if (smapCol) {
    soilMoisture = smapCol.filterDate(
      ee.Date.fromYMD(BGDSS.CONFIG.year, 1, 1), ee.Date.fromYMD(BGDSS.CONFIG.year + 1, 1, 1)
    ).select('sm_rootzone').mean().clip(geometry).rename('soilMoisture');
  } else if (BGDSS.CACHE.ndmi) {
    soilMoisture = BGDSS.CACHE.ndmi.unitScale(-0.5, 0.5).clamp(0, 1).rename('soilMoisture');
    BGDSS.UTIL.log(LABEL, 'SMAP soil moisture unavailable - using NDMI-based proxy', 'warn');
  }

  // ---- Analysis: RUSLE ---------------------------------------------------------
  var soilLoss = null, erosionRisk = null;
  var slope = BGDSS.RESULTS.terrain.slope;
  var flowAcc = BGDSS.RESULTS.hydrology ? BGDSS.RESULTS.hydrology.flowAccumulation : null;
  var rainfall = BGDSS.CACHE.annualRainfall;
  var ndvi = BGDSS.CACHE.ndvi;

  if (slope && rainfall && ndvi) {
    // R - rainfall erosivity. Default: Singh, Babu & Chandra (1981, CSWCRTI
    // Dehradun) formula calibrated for Indian rainfall regimes. Switch
    // BGDSS.CONFIG.constants.rusleRFormula to 'renard' for the generic
    // Renard & Freimund (1994) formula instead.
    var R = (BGDSS.CONFIG.constants.rusleRFormula === 'renard')
      ? rainfall.pow(1.61).multiply(0.0483).rename('R')
      : rainfall.multiply(0.363).add(79).rename('R');

    // K - soil erodibility, Williams (1995) EPIC-style approximation using
    // sand/clay/organic-carbon fractions when available, else a constant.
    var K;
    if (sand && clay && organicCarbon) {
      var sandFrac = sand.select(0).divide(100);
      var clayFrac = clay.select(0).divide(100);
      var silt = ee.Image(1).subtract(sandFrac).subtract(clayFrac).max(0);
      var soc = organicCarbon.select(0).divide(10); // dg/kg -> %, approx
      K = sandFrac.multiply(-0.0256).add(silt.multiply(0.0016)).add(clayFrac.multiply(0.0072))
        .add(soc.multiply(-0.0043)).add(0.05).clamp(0.01, 0.65).rename('K');
    } else {
      K = ee.Image(0.28).rename('K'); // documented constant fallback (loam average)
    }

    // LS - topographic factor (Moore et al. 1991), flow accumulation proxy
    // gives upslope contributing area when available, else slope-only proxy.
    var cellSize = BGDSS.CONFIG.coarseScale;
    var slopeRad = slope.multiply(Math.PI / 180);
    var upslopeArea = flowAcc ? flowAcc.multiply(cellSize) : slope.focal_sum({ radius: 10, kernelType: 'circle', units: 'pixels' });
    var LS = upslopeArea.multiply(cellSize).divide(22.13).pow(0.4)
      .multiply(slopeRad.sin().divide(0.0896).pow(1.3)).rename('LS');

    // C - cover management factor. Default: land-cover lookup table per the
    // NRSC/ISRO Soil Erosion Atlas of India methodology (ESA WorldCover
    // classes). Falls back to the continuous Van der Knijff et al. (2000)
    // NDVI formula if WorldCover is unavailable or rusleCMethod = 'ndvi'.
    var C;
    var worldCoverForC = BGDSS.DATA.getWorldCover();
    if (BGDSS.CONFIG.constants.rusleCMethod === 'landcover' && worldCoverForC) {
      // WorldCover classes -> C-factor: 10 Tree cover, 20 Shrubland,
      // 30 Grassland, 40 Cropland, 50 Built-up, 60 Bare/sparse vegetation,
      // 90 Wetland herbaceous, 95 Mangroves, 100 Moss/lichen.
      var lcClasses = [10, 20, 30, 40, 50, 60, 90, 95, 100];
      var lcCValues = [0.01, 0.05, 0.03, 0.28, 0.0, 0.45, 0.02, 0.01, 0.05];
      C = worldCoverForC.select('Map').remap(lcClasses, lcCValues, 0.2).rename('C').clip(geometry);
    } else {
      var alpha = 2, beta = 1;
      C = ndvi.multiply(-1).divide(ee.Image(beta).subtract(ndvi)).multiply(alpha).exp().rename('C');
      if (BGDSS.CONFIG.constants.rusleCMethod === 'landcover') {
        BGDSS.UTIL.log(LABEL, 'WorldCover unavailable for land-cover C-factor - using NDVI-based C-factor instead', 'warn');
      }
    }

    var P = ee.Image(BGDSS.CONFIG.constants.rusleP).rename('P');

    soilLoss = R.multiply(K).multiply(LS).multiply(C).multiply(P).rename('soilLoss').clip(geometry);
    erosionRisk = BGDSS.UTIL.classify5(BGDSS.UTIL.normalize(soilLoss, 0, 40, false));
  } else {
    BGDSS.UTIL.log(LABEL, 'RUSLE inputs incomplete (Terrain/Climate/Vegetation engines skipped) - soil loss skipped', 'warn');
  }

  // ---- Statistics -------------------------------------------------------------
  if (soilMoisture) { BGDSS.UTIL.registerStat('soil', 'moisture', BGDSS.UTIL.computeStats(soilMoisture, 'soilMoisture')); }
  if (soilLoss) { BGDSS.UTIL.registerStat('soil', 'soilLoss', BGDSS.UTIL.computeStats(soilLoss, 'soilLoss')); }
  if (erosionRisk) { BGDSS.UTIL.registerStat('soil', 'erosionRiskArea', BGDSS.UTIL.computeAreaStats(erosionRisk, BGDSS.UTIL.CLASS_LABELS_5)); }

  // ---- Visualization -------------------------------------------------------------
  if (soilType) { BGDSS.UTIL.addLayer(soilType, { min: 1, max: 12, palette: ['a6611a', 'dfc27d', 'f5f5f5', '80cdc1', '018571', '2b83ba', 'd7191c', 'fdae61', 'ffffbf', 'abdda4', '2b83ba', '542788'] }, 'Soil: Type', false); }
  if (soilMoisture) { BGDSS.UTIL.addLayer(soilMoisture, { min: 0, max: 1, palette: ['f6e8c3', 'c7eae5', '01665e'] }, 'Soil: Moisture', false); }
  if (soilLoss) { BGDSS.UTIL.addLayer(soilLoss, { min: 0, max: 40, palette: BGDSS.UTIL.PALETTE_5 }, 'Soil: RUSLE Loss (t/ha/yr)', false); }
  if (erosionRisk) { BGDSS.UTIL.addLayer(erosionRisk, { min: 1, max: 5, palette: BGDSS.UTIL.PALETTE_5 }, 'Soil: Erosion Risk (5-class)', false); }

  // ---- Registration -------------------------------------------------------------
  if (soilType) { BGDSS.UTIL.registerResult('soil', 'type', soilType); BGDSS.EXPORT.registerImage('Soil_Type', soilType, BGDSS.CONFIG.coarseScale); }
  if (soilMoisture) { BGDSS.UTIL.registerResult('soil', 'moisture', soilMoisture); BGDSS.EXPORT.registerImage('Soil_Moisture', soilMoisture, BGDSS.CONFIG.coarseScale); }
  if (soilLoss) { BGDSS.UTIL.registerResult('soil', 'loss', soilLoss); BGDSS.EXPORT.registerImage('Soil_Loss', soilLoss, BGDSS.CONFIG.scale); }
  if (erosionRisk) { BGDSS.UTIL.registerResult('soil', 'erosionRisk', erosionRisk); BGDSS.EXPORT.registerImage('Soil_ErosionRisk', erosionRisk, BGDSS.CONFIG.scale); BGDSS.CACHE.erosionRisk = erosionRisk; }

  BGDSS.UTIL.log(LABEL, 'Soil Engine Completed', 'ok');
};

BGDSS.WORKFLOW.register('SOIL', BGDSS.SOIL.run);

// ============================================================================
// SECTION: PLANTATION SUITABILITY ENGINE
// ----------------------------------------------------------------------------
// Input    : cached Terrain/Climate/Vegetation/Forest/Soil layers.
// Produces : Plantation Suitability, Species Suitability (rule-based per
//            candidate native species rainfall/temperature envelope), ANR
//            (Assisted Natural Regeneration) Priority, Eco-restoration
//            Priority.
// Units    : unitless suitability score [0,1] and 5-class outputs.
// Assumptions: Species envelopes are simplified rainfall/temperature range
//            rules for common Gujarat dry-deciduous species and should be
//            refined with local silvicultural data before operational use.
// ============================================================================

BGDSS.PLANTATION = {};

BGDSS.PLANTATION.SPECIES = [
  { name: 'Tectona grandis (Teak)', rainMin: 900, rainMax: 2500, tempMin: 20, tempMax: 35 },
  { name: 'Azadirachta indica (Neem)', rainMin: 400, rainMax: 1200, tempMin: 21, tempMax: 39 },
  { name: 'Acacia nilotica (Babul)', rainMin: 300, rainMax: 1200, tempMin: 20, tempMax: 40 },
  { name: 'Dendrocalamus strictus (Bamboo)', rainMin: 750, rainMax: 2000, tempMin: 18, tempMax: 36 }
];

BGDSS.PLANTATION.run = function () {
  var LABEL = 'PLANTATION';
  var geometry = BGDSS.STATE.roiGeometry;

  var slope = BGDSS.RESULTS.terrain.slope;
  var rainfall = BGDSS.CACHE.annualRainfall;
  var tempMeanC = BGDSS.CACHE.tempMeanC;
  var erosionRisk = BGDSS.CACHE.erosionRisk;
  var forestMask = BGDSS.CACHE.forestMask;
  var canopyDensity = BGDSS.CACHE.canopyDensity;
  var distanceToDrainage = BGDSS.CACHE.distanceToDrainage;

  if (!slope || !rainfall) {
    BGDSS.UTIL.log(LABEL, 'Dataset unavailable. Skipping module.', 'warn');
    return;
  }

  // ---- Plantation Suitability (weighted overlay) -------------------------------
  var slopeNorm = BGDSS.UTIL.normalize(slope, 0, 30, true);
  var rainfallNorm = BGDSS.UTIL.normalize(rainfall, 300, 1500, false);
  var erosionNorm = erosionRisk ? BGDSS.UTIL.normalize(erosionRisk, 1, 5, true) : ee.Image(0.5);
  var nonForestNorm = forestMask ? ee.Image(1).subtract(forestMask) : ee.Image(0.5);
  var waterProxNorm = distanceToDrainage ? BGDSS.UTIL.normalize(distanceToDrainage, 0, 1500, true) : ee.Image(0.5);

  var suitabilityOverlay = BGDSS.UTIL.weightedOverlay(
    [slopeNorm, rainfallNorm, erosionNorm, nonForestNorm, waterProxNorm],
    [0.25, 0.25, 0.2, 0.15, 0.15]
  );
  var plantationSuitability = BGDSS.UTIL.classify5(suitabilityOverlay);

  // ---- Species Suitability (rule-based rainfall/temperature envelope match) --
  var speciesSuitability = null;
  if (rainfall && tempMeanC) {
    var bestScore = ee.Image(0).rename('bestScore');
    var bestSpeciesIndex = ee.Image(0).rename('speciesIndex');
    BGDSS.PLANTATION.SPECIES.forEach(function (sp, idx) {
      var rainScore = rainfall.gte(sp.rainMin).and(rainfall.lte(sp.rainMax));
      var tempScore = tempMeanC.gte(sp.tempMin).and(tempMeanC.lte(sp.tempMax));
      var score = rainScore.and(tempScore).rename('bestScore');
      bestSpeciesIndex = bestSpeciesIndex.where(score.and(bestScore.not()), idx + 1);
      bestScore = bestScore.max(score);
    });
    speciesSuitability = bestSpeciesIndex.rename('speciesSuitability').clip(geometry);
  }

  // ---- ANR Priority: moderate/degraded canopy + adequate rainfall + gentle slope
  var anrPriority = null;
  if (canopyDensity) {
    var degraded = canopyDensity.gt(10).and(canopyDensity.lt(40));
    var anrOverlay = BGDSS.UTIL.weightedOverlay([degraded, rainfallNorm, slopeNorm], [0.5, 0.3, 0.2]);
    anrPriority = BGDSS.UTIL.classify5(anrOverlay);
  }

  // ---- Eco-restoration priority: high erosion + non-forest + poor vegetation --
  var ecoRestorationPriority = null;
  if (erosionRisk && BGDSS.CACHE.ndvi) {
    var ndviNorm = BGDSS.UTIL.normalize(BGDSS.CACHE.ndvi, -0.1, 0.9, true);
    var restOverlay = BGDSS.UTIL.weightedOverlay([erosionNorm, nonForestNorm, ndviNorm], [0.4, 0.35, 0.25]);
    ecoRestorationPriority = BGDSS.UTIL.classify5(restOverlay);
  }

  // ---- Statistics -------------------------------------------------------------
  BGDSS.UTIL.registerStat('plantation', 'suitabilityArea', BGDSS.UTIL.computeAreaStats(plantationSuitability, BGDSS.UTIL.CLASS_LABELS_5));
  if (anrPriority) { BGDSS.UTIL.registerStat('plantation', 'anrArea', BGDSS.UTIL.computeAreaStats(anrPriority, BGDSS.UTIL.CLASS_LABELS_5)); }
  if (ecoRestorationPriority) { BGDSS.UTIL.registerStat('plantation', 'ecoRestorationArea', BGDSS.UTIL.computeAreaStats(ecoRestorationPriority, BGDSS.UTIL.CLASS_LABELS_5)); }

  // ---- Visualization -------------------------------------------------------------
  BGDSS.UTIL.addLayer(plantationSuitability, { min: 1, max: 5, palette: BGDSS.UTIL.PALETTE_5 }, 'Plantation: Suitability (5-class)', false);
  if (speciesSuitability) { BGDSS.UTIL.addLayer(speciesSuitability, { min: 0, max: BGDSS.PLANTATION.SPECIES.length, palette: ['999999', '1a9850', '91cf60', 'fee08b', 'd73027'] }, 'Plantation: Recommended Species', false); }
  if (anrPriority) { BGDSS.UTIL.addLayer(anrPriority, { min: 1, max: 5, palette: BGDSS.UTIL.PALETTE_5 }, 'Plantation: ANR Priority', false); }
  if (ecoRestorationPriority) { BGDSS.UTIL.addLayer(ecoRestorationPriority, { min: 1, max: 5, palette: BGDSS.UTIL.PALETTE_5 }, 'Plantation: Eco-restoration Priority', false); }

  // ---- Registration -------------------------------------------------------------
  BGDSS.UTIL.registerResult('plantation', 'suitability', plantationSuitability);
  BGDSS.EXPORT.registerImage('Plantation_Suitability', plantationSuitability, BGDSS.CONFIG.scale);
  if (speciesSuitability) { BGDSS.UTIL.registerResult('plantation', 'speciesSuitability', speciesSuitability); BGDSS.EXPORT.registerImage('Plantation_SpeciesSuitability', speciesSuitability, BGDSS.CONFIG.scale); }
  if (anrPriority) { BGDSS.UTIL.registerResult('plantation', 'anrPriority', anrPriority); BGDSS.EXPORT.registerImage('Plantation_ANRPriority', anrPriority, BGDSS.CONFIG.scale); }
  if (ecoRestorationPriority) { BGDSS.UTIL.registerResult('plantation', 'ecoRestorationPriority', ecoRestorationPriority); BGDSS.EXPORT.registerImage('Plantation_EcoRestorationPriority', ecoRestorationPriority, BGDSS.CONFIG.scale); BGDSS.CACHE.ecoRestorationPriority = ecoRestorationPriority; }

  BGDSS.UTIL.log(LABEL, 'Plantation Suitability Engine Completed', 'ok');
};

BGDSS.WORKFLOW.register('PLANTATION', BGDSS.PLANTATION.run);

// ============================================================================
// SECTION: WILDLIFE HABITAT ENGINE
// ----------------------------------------------------------------------------
// Input    : cached Forest/Vegetation/Hydrology layers.
// Produces : Habitat Suitability, Corridors (cost-distance connectivity
//            proxy from core patches), Fragmentation (re-applies the
//            Riitters morphology to the habitat mask), Core Habitat, Edge
//            Habitat.
// Units    : unitless suitability [0,1]; cumulative cost distance unitless.
// Assumptions: True circuit-theory/least-cost corridor modeling (e.g.
//            Circuitscape) is outside EE's raster algebra; this engine
//            uses cumulativeCost from core-habitat seed patches as a
//            documented connectivity proxy.
// ============================================================================

BGDSS.WILDLIFE = {};

BGDSS.WILDLIFE.run = function () {
  var LABEL = 'WILDLIFE';
  var geometry = BGDSS.STATE.roiGeometry;

  var forestMask = BGDSS.CACHE.forestMask;
  var canopyDensity = BGDSS.CACHE.canopyDensity;
  var distanceToDrainage = BGDSS.CACHE.distanceToDrainage;
  var fragmentation = BGDSS.CACHE.fragmentation;

  if (!forestMask) { BGDSS.UTIL.log(LABEL, 'Dataset unavailable. Skipping module.', 'warn'); return; }

  // ---- Habitat Suitability (weighted overlay) ----------------------------------
  var canopyNorm = canopyDensity ? BGDSS.UTIL.normalize(canopyDensity, 0, 100, false) : forestMask;
  var waterProxNorm = distanceToDrainage ? BGDSS.UTIL.normalize(distanceToDrainage, 0, 2000, true) : ee.Image(0.5);
  var fragNorm = fragmentation ? BGDSS.UTIL.normalize(fragmentation, 1, 5, false) : ee.Image(0.5);

  var habitatOverlay = BGDSS.UTIL.weightedOverlay([canopyNorm, waterProxNorm, fragNorm], [0.45, 0.25, 0.3]);
  var habitatSuitability = BGDSS.UTIL.classify5(habitatOverlay);

  // ---- Core / Edge habitat (reuse fragmentation classes if available) --------
  var coreHabitat = fragmentation ? fragmentation.eq(5).and(forestMask).selfMask().rename('coreHabitat') : forestMask.selfMask().rename('coreHabitat');
  var edgeHabitat = fragmentation ? fragmentation.eq(4).and(forestMask).selfMask().rename('edgeHabitat') : null;

  // ---- Habitat fragmentation (Riitters morphology on the habitat mask) --------
  var habitatMask = habitatSuitability.gte(4); // High + Very High suitability
  var pf = habitatMask.focal_mean({ radius: 1, kernelType: 'square', units: 'pixels' });
  var habitatFragmentation = ee.Image(1)
    .where(pf.gt(0.1), 2).where(pf.gt(0.4), 3).where(pf.gt(0.6), 4).where(pf.gt(0.9), 5)
    .updateMask(pf.gt(0)).rename('habitatFragmentation').clip(geometry);

  // ---- Corridors: cumulative cost distance from core-habitat seed patches ----
  var corridors = null;
  try {
    var costSurface = ee.Image(1).subtract(habitatOverlay).multiply(100).add(1); // higher cost where unsuitable
    var cumulativeCost = costSurface.cumulativeCost({
      source: coreHabitat.unmask(0),
      maxDistance: 5000
    }).rename('corridorCost');
    corridors = cumulativeCost.lt(500).and(habitatMask.not()).selfMask().rename('corridors');
  } catch (e) {
    BGDSS.UTIL.log(LABEL, 'Corridor cost-distance computation skipped: ' + e.message, 'warn');
  }

  // ---- Statistics -------------------------------------------------------------
  BGDSS.UTIL.registerStat('wildlife', 'habitatSuitabilityArea', BGDSS.UTIL.computeAreaStats(habitatSuitability, BGDSS.UTIL.CLASS_LABELS_5));
  BGDSS.UTIL.registerStat('wildlife', 'habitatFragmentationArea', BGDSS.UTIL.computeAreaStats(habitatFragmentation, ['Patch', 'Transitional', 'Perforated', 'Edge', 'Interior/Core']));

  // ---- Visualization -------------------------------------------------------------
  BGDSS.UTIL.addLayer(habitatSuitability, { min: 1, max: 5, palette: BGDSS.UTIL.PALETTE_5 }, 'Wildlife: Habitat Suitability', false);
  BGDSS.UTIL.addLayer(coreHabitat, { palette: ['00441b'] }, 'Wildlife: Core Habitat', false);
  if (edgeHabitat) { BGDSS.UTIL.addLayer(edgeHabitat, { palette: ['fdae61'] }, 'Wildlife: Edge Habitat', false); }
  BGDSS.UTIL.addLayer(habitatFragmentation, { min: 1, max: 5, palette: ['d73027', 'fc8d59', 'fee08b', '91cf60', '1a9850'] }, 'Wildlife: Habitat Fragmentation', false);
  if (corridors) { BGDSS.UTIL.addLayer(corridors, { palette: ['fee08b'] }, 'Wildlife: Corridors (proxy)', false); }

  // ---- Registration -------------------------------------------------------------
  BGDSS.UTIL.registerResult('wildlife', 'habitatSuitability', habitatSuitability);
  BGDSS.UTIL.registerResult('wildlife', 'coreHabitat', coreHabitat);
  if (edgeHabitat) { BGDSS.UTIL.registerResult('wildlife', 'edgeHabitat', edgeHabitat); }
  BGDSS.UTIL.registerResult('wildlife', 'fragmentation', habitatFragmentation);
  if (corridors) { BGDSS.UTIL.registerResult('wildlife', 'corridors', corridors); }
  BGDSS.CACHE.coreHabitat = coreHabitat;
  BGDSS.CACHE.habitatSuitability = habitatSuitability;

  BGDSS.EXPORT.registerImage('Wildlife_HabitatSuitability', habitatSuitability, BGDSS.CONFIG.scale);
  BGDSS.EXPORT.registerImage('Wildlife_CoreHabitat', coreHabitat, BGDSS.CONFIG.scale);
  if (corridors) { BGDSS.EXPORT.registerImage('Wildlife_Corridors', corridors, BGDSS.CONFIG.scale); }

  BGDSS.UTIL.log(LABEL, 'Wildlife Habitat Engine Completed', 'ok');
};

BGDSS.WORKFLOW.register('WILDLIFE', BGDSS.WILDLIFE.run);

// ============================================================================
// SECTION: DECISION SUPPORT ENGINE
// ----------------------------------------------------------------------------
// Input    : cached layers from every upstream engine (Fire, Hydrology,
//            Terrain, Wildlife, Plantation, Soil).
// Produces : Fire Line Priority, Patrol Route Priority, Watch Tower
//            Suitability, Water Tank Suitability, Restoration Priority,
//            Village Dependency (optional, requires BGDSS.CONFIG.villages),
//            and integrated Management Zones.
// Units    : unitless suitability/priority scores and 5-class outputs;
//            Management Zones is a categorical 1-5 zone code.
// Assumptions: Road/settlement layers are optional (BGDSS.CONFIG.roads /
//            .villages); when absent, terrain-based accessibility proxies
//            are used and the limitation is logged.
// ============================================================================

BGDSS.DECISION = {};
BGDSS.DECISION.ZONE_LABELS = ['Core Protection', 'Buffer', 'Multiple-use', 'Restoration', 'Fire-Sensitive'];

BGDSS.DECISION.run = function () {
  var LABEL = 'DECISION';
  var geometry = BGDSS.STATE.roiGeometry;

  var fireRisk = BGDSS.CACHE.fireRisk;
  var susceptibility = BGDSS.CACHE.susceptibility;
  var slope = BGDSS.RESULTS.terrain.slope;
  var tpi = BGDSS.RESULTS.terrain.tpi;
  var drainage = BGDSS.CACHE.drainage;
  var distanceToDrainage = BGDSS.CACHE.distanceToDrainage;
  var coreHabitat = BGDSS.CACHE.coreHabitat;
  var ecoRestorationPriority = BGDSS.CACHE.ecoRestorationPriority;
  var erosionRisk = BGDSS.CACHE.erosionRisk;
  var fragmentation = BGDSS.CACHE.fragmentation;
  var forestMask = BGDSS.CACHE.forestMask;

  if (!fireRisk && !slope) { BGDSS.UTIL.log(LABEL, 'Dataset unavailable. Skipping module.', 'warn'); return; }

  var accessibilityNorm = slope ? BGDSS.UTIL.normalize(slope, 0, 30, true) : ee.Image(0.5); // gentler -> more accessible

  // ---- Fire Line Priority: high fire risk + reasonable accessibility ----------
  var fireLinePriority = null;
  if (susceptibility) {
    var flOverlay = BGDSS.UTIL.weightedOverlay([susceptibility, accessibilityNorm], [0.7, 0.3]);
    fireLinePriority = BGDSS.UTIL.classify5(flOverlay);
  }

  // ---- Patrol Route Priority: fire risk + wildlife core habitat + drainage ----
  var patrolRoutePriority = null;
  if (susceptibility) {
    var coreNorm = coreHabitat ? coreHabitat.unmask(0) : ee.Image(0);
    var drainageProxNorm = distanceToDrainage ? BGDSS.UTIL.normalize(distanceToDrainage, 0, 1500, true) : ee.Image(0.5);
    var prOverlay = BGDSS.UTIL.weightedOverlay([susceptibility, coreNorm, drainageProxNorm], [0.5, 0.3, 0.2]);
    patrolRoutePriority = BGDSS.UTIL.classify5(prOverlay);
  }

  // ---- Watch Tower Suitability: high ground (ridge/TPI) + central to fire risk
  var watchTowerSuitability = null;
  if (tpi && susceptibility) {
    var ridgeNorm = BGDSS.UTIL.normalize(tpi, -5, 15, false); // ridgelines favorable (visibility proxy)
    var wtOverlay = BGDSS.UTIL.weightedOverlay([ridgeNorm, susceptibility], [0.6, 0.4]);
    watchTowerSuitability = BGDSS.UTIL.classify5(wtOverlay);
  }

  // ---- Water Tank Suitability: near drainage + gentle slope + high fire risk --
  var waterTankSuitability = null;
  if (distanceToDrainage && slope) {
    var wtDistNorm = BGDSS.UTIL.normalize(distanceToDrainage, 0, 1000, true);
    var wtSlopeNorm = BGDSS.UTIL.normalize(slope, 0, 20, true);
    var fireNorm = susceptibility || ee.Image(0.5);
    var tankOverlay = BGDSS.UTIL.weightedOverlay([wtDistNorm, wtSlopeNorm, fireNorm], [0.4, 0.3, 0.3]);
    waterTankSuitability = BGDSS.UTIL.classify5(tankOverlay);
  }

  // ---- Restoration Priority: erosion + fragmentation + eco-restoration --------
  var restorationPriority = ecoRestorationPriority || null;
  if (!restorationPriority && erosionRisk) {
    var fragNorm = fragmentation ? BGDSS.UTIL.normalize(fragmentation, 1, 5, true) : ee.Image(0.5);
    var erosionNorm2 = BGDSS.UTIL.normalize(erosionRisk, 1, 5, false);
    restorationPriority = BGDSS.UTIL.classify5(BGDSS.UTIL.weightedOverlay([erosionNorm2, fragNorm], [0.6, 0.4]));
  }

  // ---- Village Dependency (optional) -------------------------------------------
  var villageDependency = null;
  if (BGDSS.CONFIG.villages) {
    try {
      var villageDist = ee.Image(0).paint(BGDSS.CONFIG.villages, 1).not()
        .fastDistanceTransform(1024).sqrt().multiply(ee.Image.pixelArea().sqrt()).rename('villageDist');
      villageDependency = BGDSS.UTIL.classify5(BGDSS.UTIL.normalize(villageDist, 0, 3000, true));
    } catch (e) {
      BGDSS.UTIL.log(LABEL, 'Village dependency skipped: ' + e.message, 'warn');
    }
  } else {
    BGDSS.UTIL.log(LABEL, 'BGDSS.CONFIG.villages not provided - Village Dependency skipped', 'info');
  }

  // ---- Management Zones: integrated decision matrix ----------------------------
  // 1 Core Protection (forest + core habitat), 2 Buffer (forest edge),
  // 3 Multiple-use (non-forest, low risk), 4 Restoration (eco-restoration
  // priority high), 5 Fire-Sensitive (high fire risk overriding others).
  var managementZones = null;
  if (forestMask) {
    var zones = ee.Image(3).rename('zone'); // default: multiple-use
    if (restorationPriority) { zones = zones.where(restorationPriority.gte(4), 4); }
    zones = zones.where(forestMask.eq(1), 2); // forest -> buffer baseline
    if (coreHabitat) { zones = zones.where(coreHabitat.unmask(0).eq(1), 1); } // core habitat -> core protection
    if (fireRisk) { zones = zones.where(fireRisk.gte(4), 5); } // high/very-high fire risk overrides -> fire-sensitive
    managementZones = zones.clip(geometry);
  }

  // ---- Statistics -------------------------------------------------------------
  if (fireLinePriority) { BGDSS.UTIL.registerStat('decision', 'fireLinePriorityArea', BGDSS.UTIL.computeAreaStats(fireLinePriority, BGDSS.UTIL.CLASS_LABELS_5)); }
  if (patrolRoutePriority) { BGDSS.UTIL.registerStat('decision', 'patrolRoutePriorityArea', BGDSS.UTIL.computeAreaStats(patrolRoutePriority, BGDSS.UTIL.CLASS_LABELS_5)); }
  if (managementZones) { BGDSS.UTIL.registerStat('decision', 'managementZonesArea', BGDSS.UTIL.computeAreaStats(managementZones, BGDSS.DECISION.ZONE_LABELS)); }

  // ---- Visualization -------------------------------------------------------------
  if (fireLinePriority) { BGDSS.UTIL.addLayer(fireLinePriority, { min: 1, max: 5, palette: BGDSS.UTIL.PALETTE_5 }, 'Decision: Fire Line Priority', false); }
  if (patrolRoutePriority) { BGDSS.UTIL.addLayer(patrolRoutePriority, { min: 1, max: 5, palette: BGDSS.UTIL.PALETTE_5 }, 'Decision: Patrol Route Priority', false); }
  if (watchTowerSuitability) { BGDSS.UTIL.addLayer(watchTowerSuitability, { min: 1, max: 5, palette: BGDSS.UTIL.PALETTE_5 }, 'Decision: Watch Tower Suitability', false); }
  if (waterTankSuitability) { BGDSS.UTIL.addLayer(waterTankSuitability, { min: 1, max: 5, palette: BGDSS.UTIL.PALETTE_5 }, 'Decision: Water Tank Suitability', false); }
  if (restorationPriority) { BGDSS.UTIL.addLayer(restorationPriority, { min: 1, max: 5, palette: BGDSS.UTIL.PALETTE_5 }, 'Decision: Restoration Priority', false); }
  if (villageDependency) { BGDSS.UTIL.addLayer(villageDependency, { min: 1, max: 5, palette: BGDSS.UTIL.PALETTE_5 }, 'Decision: Village Dependency', false); }
  if (managementZones) {
    BGDSS.UTIL.addLayer(managementZones, { min: 1, max: 5, palette: ['00441b', '66c2a4', 'ffffbf', 'fdae61', 'd73027'] }, 'Decision: Management Zones', true);
    BGDSS.UTIL.addLegend('Management Zones', ['00441b', '66c2a4', 'ffffbf', 'fdae61', 'd73027'], BGDSS.DECISION.ZONE_LABELS);
  }

  // ---- Registration -------------------------------------------------------------
  if (fireLinePriority) { BGDSS.UTIL.registerResult('decision', 'fireLinePriority', fireLinePriority); BGDSS.EXPORT.registerImage('Decision_FireLinePriority', fireLinePriority, BGDSS.CONFIG.scale); }
  if (patrolRoutePriority) { BGDSS.UTIL.registerResult('decision', 'patrolRoutePriority', patrolRoutePriority); BGDSS.EXPORT.registerImage('Decision_PatrolRoutePriority', patrolRoutePriority, BGDSS.CONFIG.scale); }
  if (watchTowerSuitability) { BGDSS.UTIL.registerResult('decision', 'watchTowerSuitability', watchTowerSuitability); BGDSS.EXPORT.registerImage('Decision_WatchTowerSuitability', watchTowerSuitability, BGDSS.CONFIG.scale); }
  if (waterTankSuitability) { BGDSS.UTIL.registerResult('decision', 'waterTankSuitability', waterTankSuitability); BGDSS.EXPORT.registerImage('Decision_WaterTankSuitability', waterTankSuitability, BGDSS.CONFIG.scale); }
  if (restorationPriority) { BGDSS.UTIL.registerResult('decision', 'restorationPriority', restorationPriority); BGDSS.EXPORT.registerImage('Decision_RestorationPriority', restorationPriority, BGDSS.CONFIG.scale); }
  if (villageDependency) { BGDSS.UTIL.registerResult('decision', 'villageDependency', villageDependency); BGDSS.EXPORT.registerImage('Decision_VillageDependency', villageDependency, BGDSS.CONFIG.scale); }
  if (managementZones) { BGDSS.UTIL.registerResult('decision', 'managementZones', managementZones); BGDSS.EXPORT.registerImage('Decision_ManagementZones', managementZones, BGDSS.CONFIG.scale); }

  BGDSS.UTIL.log(LABEL, 'Decision Support Engine Completed', 'ok');
};

BGDSS.WORKFLOW.register('DECISION', BGDSS.DECISION.run);

// ============================================================================
// SECTION: STATISTICS
// ----------------------------------------------------------------------------
// Cross-engine summary: consolidates the per-engine BGDSS.STATS entries
// already populated during each engine's own "Statistics" pipeline step
// into a single, FLAT, plain-language Beat Summary Report - one row per
// indicator (Category / Indicator / Value / Unit / % of Area) - so it can
// be read directly by non-technical leadership (Range/DFO/PCCF/Minister
// briefing) without interpreting nested GEE dictionaries. This replaces a
// single-row export of raw ee.Dictionary objects (which printed as an
// unreadable "Object (N properties)" and produced a messy CSV) with a
// readable multi-row table plus qualitative verdict lines.
// ============================================================================

BGDSS.STATISTICS = {};

/** Materialize an ee.ComputedObject to a plain JS value (getInfo), rounding
 *  numbers to `digits` decimal places. Returns null on any failure so a
 *  missing/invalid stat is silently omitted from the report rather than
 *  crashing it. */
BGDSS.STATISTICS._num = function (eeObj, digits) {
  if (eeObj === null || eeObj === undefined) { return null; }
  try {
    var v = eeObj.getInfo ? eeObj.getInfo() : eeObj;
    if (v === null || v === undefined) { return null; }
    if (typeof v === 'number' && digits !== undefined) { return Number(v.toFixed(digits)); }
    return v;
  } catch (e) { return null; }
};

/** Read one named key out of a stats Dictionary (as produced by
 *  BGDSS.UTIL.computeStats/registerStat) and materialize it as a number. */
BGDSS.STATISTICS._dictValue = function (statsDict, key, digits) {
  if (!statsDict) { return null; }
  try { return BGDSS.STATISTICS._num(ee.Dictionary(statsDict).get(key, null), digits); }
  catch (e) { return null; }
};

/** Flatten a BGDSS.UTIL.computeAreaStats() grouped-area Dictionary into one
 *  readable row per class (ha + % of the classified area), and identify the
 *  dominant (largest-area) class for a one-line verdict. */
BGDSS.STATISTICS._classAreaRows = function (category, label, areaStatsDict, classLabels) {
  var result = { rows: [], dominantLabel: null, dominantPercent: null };
  if (!areaStatsDict) { return result; }
  try {
    var info = areaStatsDict.getInfo();
    var groups = (info && info.groups) || [];
    if (!groups.length) { return result; }
    var totalHa = 0;
    groups.forEach(function (g) { totalHa += (g.sum || 0); });
    groups.sort(function (a, b) { return a.class - b.class; });
    var dominantSum = -1, dominantIdx = null;
    groups.forEach(function (g) {
      var idx = Math.round(g.class) - 1;
      var name = (classLabels[idx] !== undefined) ? classLabels[idx] : ('Class ' + g.class);
      var ha = Number((g.sum || 0).toFixed(1));
      var pct = totalHa > 0 ? Number((g.sum / totalHa * 100).toFixed(0)) : 0;
      result.rows.push({ category: category, indicator: label + ' - ' + name, value: ha, unit: 'ha', percent: pct });
      if (g.sum > dominantSum) { dominantSum = g.sum; dominantIdx = idx; }
    });
    if (dominantIdx !== null) {
      result.dominantLabel = (classLabels[dominantIdx] !== undefined) ? classLabels[dominantIdx] : null;
      result.dominantPercent = totalHa > 0 ? Number((dominantSum / totalHa * 100).toFixed(0)) : null;
    }
  } catch (e) { /* leave result at defaults */ }
  return result;
};

BGDSS.STATISTICS.buildSummary = function () {
  var LABEL = 'STATISTICS';
  var num = BGDSS.STATISTICS._num;
  var dictValue = BGDSS.STATISTICS._dictValue;
  var classAreaRows = BGDSS.STATISTICS._classAreaRows;
  var rows = [];

  function add(category, indicator, value, unit, percent) {
    if (value === null || value === undefined) { return; }
    rows.push({ category: category, indicator: indicator, value: value, unit: unit || '', percent: (percent === undefined ? null : percent) });
  }

  // ---- Overview -----------------------------------------------------------
  var areaHa = num(BGDSS.STATE.areaHa, 1);
  add('Overview', 'Beat / Unit Name', BGDSS.CONFIG.unitName, '');
  add('Overview', 'District', BGDSS.CONFIG.district, '');
  add('Overview', 'State', BGDSS.CONFIG.state, '');
  add('Overview', 'Analysis Year', BGDSS.CONFIG.year, '');
  add('Overview', 'Total Area', areaHa, 'ha');
  add('Overview', 'Forest Type (Champion & Seth 1968)', BGDSS.CONFIG.forestType.championSethGroup, '');

  // ---- Terrain --------------------------------------------------------------
  add('Terrain', 'Mean Elevation', dictValue(BGDSS.STATS.terrain.elevation, 'elevation_mean', 0), 'm');
  add('Terrain', 'Mean Slope', dictValue(BGDSS.STATS.terrain.slope, 'slope_mean', 1), 'degrees');

  // ---- Climate --------------------------------------------------------------
  add('Climate', 'Mean Annual Rainfall', dictValue(BGDSS.STATS.climate.annualRainfall, 'rainfall_mean', 0), 'mm/yr');
  add('Climate', 'Mean Temperature', dictValue(BGDSS.STATS.climate.temperature, 'tempMean_mean', 1), 'deg C');

  // ---- Vegetation / Forest ----------------------------------------------------
  var ndvi = dictValue(BGDSS.STATS.vegetation.ndvi, 'ndvi_mean', 2);
  add('Vegetation', 'Mean Greenness Index (NDVI, 0-1 scale)', ndvi, 'index');
  var forestHa = dictValue(BGDSS.STATS.forest.forestAreaHa, 'forestMask', 1);
  add('Forest', 'Forest Cover Area', forestHa, 'ha', (forestHa !== null && areaHa) ? Number((forestHa / areaHa * 100).toFixed(0)) : null);

  // ---- Carbon (FSI/ISFR convention, see CARBON ENGINE header) ----------------
  add('Carbon', 'Mean Carbon Stock', dictValue(BGDSS.STATS.carbon.carbonStock, 'carbonStock_mean', 1), 'tonnes C/ha');
  var totalCarbonTons = dictValue(BGDSS.STATS.carbon.totalCarbonTons, 'carbonStock', 0);
  add('Carbon', 'Total Carbon Stock (whole beat)', totalCarbonTons, 'tonnes C');
  if (totalCarbonTons !== null) {
    add('Carbon', 'Estimated CO2 Sequestered (whole beat)', Number((totalCarbonTons * BGDSS.CONFIG.constants.co2Conversion).toFixed(0)), 'tonnes CO2e');
  }

  // ---- Fire Risk (Jaiswal et al. 2002 India AHP model) - flattened by class --
  var fireResult = classAreaRows('Fire Risk', 'Fire Risk Area', BGDSS.STATS.fire.riskArea, BGDSS.UTIL.CLASS_LABELS_5);
  rows = rows.concat(fireResult.rows);

  // ---- Soil Erosion (RUSLE, Indian R/C factors) -------------------------------
  var soilLossMean = dictValue(BGDSS.STATS.soil.soilLoss, 'soilLoss_mean', 1);
  add('Soil Erosion', 'Mean Soil Loss (RUSLE)', soilLossMean, 'tonnes/ha/yr');

  // ---- Management Zones - flattened by zone -----------------------------------
  var zoneResult = classAreaRows('Management Zones', 'Zone', BGDSS.STATS.decision.managementZonesArea, BGDSS.DECISION.ZONE_LABELS);
  rows = rows.concat(zoneResult.rows);

  // ---- Plain-language verdicts (for a non-technical / leadership audience) --
  if (fireResult.dominantLabel) {
    add('Verdict', 'Overall Fire Risk Rating', fireResult.dominantLabel, '(covers ' + fireResult.dominantPercent + '% of the beat)');
  }
  if (ndvi !== null) {
    var healthLabel = ndvi >= 0.5 ? 'Good' : (ndvi >= 0.3 ? 'Moderate' : 'Poor');
    add('Verdict', 'Overall Vegetation Health', healthLabel, '');
  }
  if (soilLossMean !== null) {
    var erosionLabel = soilLossMean < 5 ? 'Low' : (soilLossMean < 10 ? 'Moderate' : (soilLossMean < 20 ? 'High' : 'Severe'));
    add('Verdict', 'Overall Soil Erosion Severity', erosionLabel, '');
  }

  BGDSS.STATS.summary = rows;

  // ---- Print a readable, plain-language report to the console ---------------
  try {
    var title = 'BGDSS BEAT SUMMARY REPORT - ' + BGDSS.CONFIG.unitName + ', '
      + BGDSS.CONFIG.district + ', ' + BGDSS.CONFIG.state + ' (' + BGDSS.CONFIG.year + ')';
    print('================================================================');
    print(title);
    print('================================================================');
    var lastCategory = null;
    rows.forEach(function (r) {
      if (r.category !== lastCategory) { print('-- ' + r.category + ' --'); lastCategory = r.category; }
      var line = r.indicator + ': ' + r.value + (r.unit ? (' ' + r.unit) : '');
      if (r.percent !== null && r.percent !== undefined && r.percent !== '') { line += ' (' + r.percent + '%)'; }
      print(line);
    });
    print('================================================================');
  } catch (e) {
    // print() unavailable outside Code Editor context - non-fatal.
  }

  BGDSS.UTIL.log(LABEL, 'Beat Summary Report Built (' + rows.length + ' plain-language indicators)', 'ok');
  return rows;
};

// ============================================================================
// SECTION: EXPORT MANAGER
// ----------------------------------------------------------------------------
// Every engine registers its outputs here instead of calling Export.*
// directly, so all export tasks share one consistent folder/naming/scale
// convention and can be listed/queued in one place. GEE requires each
// export to be manually run from the Tasks tab in the Code Editor (the
// API has no "auto-run" for exports); BGDSS.EXPORT.runAll() creates the
// tasks so they appear ready to run.
// ============================================================================

BGDSS.EXPORT = {};
BGDSS.EXPORT.queue = { images: [], tables: [] };

/**
 * Purpose : Register a raster output for GeoTIFF export (and PNG preview).
 * Input   : name (string), image (ee.Image), scale (Number, meters)
 */
BGDSS.EXPORT.registerImage = function (name, image, scale) {
  BGDSS.EXPORT.queue.images.push({ name: name, image: image, scale: scale || BGDSS.CONFIG.scale });
};

/**
 * Purpose : Register a vector/table output for SHP/GeoJSON/CSV export.
 * Input   : name (string), table (ee.FeatureCollection)
 */
BGDSS.EXPORT.registerTable = function (name, table) {
  BGDSS.EXPORT.queue.tables.push({ name: name, table: table });
};

/**
 * Purpose : Create (but not auto-run - GEE Tasks require a manual click)
 *           GeoTIFF export tasks for every registered image, and a PNG
 *           thumbnail-URL log line for each as a quick-look alternative.
 */
BGDSS.EXPORT.exportImages = function () {
  BGDSS.EXPORT.queue.images.forEach(function (item) {
    var fileName = BGDSS.CONFIG.exportPrefix + '_' + item.name;
    try {
      Export.image.toDrive({
        image: item.image.clip(BGDSS.STATE.roiGeometry),
        description: fileName,
        folder: BGDSS.CONFIG.exportFolder,
        fileNamePrefix: fileName,
        region: BGDSS.STATE.roiBounds,
        scale: item.scale,
        crs: BGDSS.CONFIG.projection,
        maxPixels: BGDSS.CONFIG.maxPixels
      });
    } catch (e) {
      BGDSS.UTIL.log('EXPORT', 'GeoTIFF export registration failed for ' + item.name + ': ' + e.message, 'warn');
    }
  });
};

/**
 * Purpose : Create SHP / GeoJSON / CSV export tasks for every registered
 *           table output.
 */
BGDSS.EXPORT.exportTables = function () {
  var formats = ['SHP', 'GeoJSON', 'CSV'];
  BGDSS.EXPORT.queue.tables.forEach(function (item) {
    formats.forEach(function (fmt) {
      var fileName = BGDSS.CONFIG.exportPrefix + '_' + item.name + '_' + fmt;
      try {
        Export.table.toDrive({
          collection: item.table,
          description: fileName,
          folder: BGDSS.CONFIG.exportFolder,
          fileNamePrefix: fileName,
          fileFormat: fmt
        });
      } catch (e) {
        BGDSS.UTIL.log('EXPORT', fmt + ' export registration failed for ' + item.name + ': ' + e.message, 'warn');
      }
    });
  });
};

/**
 * Purpose : Export the Beat Summary Report (BGDSS.STATS.summary) as CSV.
 */
/**
 * Purpose : Export the Beat Summary Report as ONE clean, flat CSV table -
 *           one row per plain-language indicator (Sr No / Category /
 *           Indicator / Value / Unit / % of Area) - readable directly in
 *           Excel/Sheets by a non-technical reviewer (Range/DFO/PCCF/
 *           Minister briefing), instead of a single row of nested
 *           dictionaries.
 */
BGDSS.EXPORT.exportSummaryCsv = function () {
  try {
    var rows = BGDSS.STATS.summary || [];
    var features = rows.map(function (r, i) {
      return ee.Feature(null, {
        'Sr No': i + 1,
        'Category': r.category,
        'Indicator': r.indicator,
        'Value': r.value,
        'Unit': r.unit,
        'Percent of Area': (r.percent === null || r.percent === undefined) ? '' : r.percent
      });
    });
    var fc = ee.FeatureCollection(features);
    Export.table.toDrive({
      collection: fc,
      description: BGDSS.CONFIG.exportPrefix + '_Summary',
      folder: BGDSS.CONFIG.exportFolder,
      fileNamePrefix: BGDSS.CONFIG.exportPrefix + '_Summary',
      fileFormat: 'CSV'
    });
  } catch (e) {
    BGDSS.UTIL.log('EXPORT', 'Summary CSV export registration failed: ' + e.message, 'warn');
  }
};

/**
 * Purpose : Register every queued image/table/summary export as a GEE
 *           Task. Tasks still require a manual "Run" click in the Code
 *           Editor Tasks tab (an Earth Engine platform constraint, not a
 *           BGDSS limitation).
 */
BGDSS.EXPORT.runAll = function () {
  BGDSS.EXPORT.exportImages();
  BGDSS.EXPORT.exportTables();
  BGDSS.EXPORT.exportSummaryCsv();
  BGDSS.UTIL.log('EXPORT', 'Export Ready (' + BGDSS.EXPORT.queue.images.length + ' images, '
    + BGDSS.EXPORT.queue.tables.length + ' tables registered in the Tasks tab)', 'ok');
};

// ============================================================================
// SECTION: MAIN()
// ----------------------------------------------------------------------------
// Single entry point. Running BGDSS.run() executes Startup, every
// registered engine (in the order they were registered above, matching
// the section order of this file), the cross-engine Statistics summary,
// and finally registers all export tasks.
// ============================================================================

BGDSS.run = function () {
  BGDSS.STARTUP.init();
  BGDSS.WORKFLOW.runAll();
  BGDSS.STATISTICS.buildSummary();
  BGDSS.EXPORT.runAll();

  var elapsedSec = ((Date.now() - BGDSS.STATE.startedAt) / 1000).toFixed(1);
  BGDSS.UTIL.log('MAIN', 'BGDSS v' + BGDSS.VERSION + ' run complete in ' + elapsedSec + 's'
    + ' | ' + BGDSS.STATE.errors.length + ' module(s) skipped', 'ok');
};

// ----------------------------------------------------------------------------
// Execute. This is the only line a user needs to run.
// ----------------------------------------------------------------------------
BGDSS.run();

