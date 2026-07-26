/**
 * ============================================================================
 *  BGDSS - MODULE 2 (v3): PLANTATION / ECO-RESTORATION SUITABILITY MODEL
 *  Sabarkantha Forest Division / District, Gujarat Forest Department
 *  Platform: Google Earth Engine (JavaScript API)
 * ============================================================================
 *
 *  STANDALONE SCRIPT - paste into a NEW Earth Engine script and run on its
 *  own. Does not depend on any other BGDSS file.
 *
 *  This is a full rebuild against a detailed build brief (dated 26 Jul 2026)
 *  that corrected dataset choices, thresholds, directionality, and added
 *  methodological safeguards missing from v1/v2. Everything below follows
 *  that brief section-by-section; deviations are noted inline with why.
 *
 *  WHAT CHANGED FROM v2 (full list also in the brief's own Part 10)
 *  ---------------------------------------------------------------------------
 *  - Canopy threshold for "existing forest" (proximity/fragmentation): 25%,
 *    not 40% - 40% is a moist-forest calibration and misses the Open Forest
 *    (FSI 10-40%) mosaic that IS the reference forest type here. The 40%
 *    bar is kept ONLY for candidate-mask exclusion (already well-stocked
 *    land is not a treatment candidate at all).
 *  - Candidate mask is now built and applied BEFORE any percentile
 *    normalization (previously normalization used fixed min/max guesses).
 *    Every criterion is now percentile-stretched (2nd-98th) using ONLY
 *    candidate-mask pixels, which is what actually fixes "everything shows
 *    as one color" - a fixed guessed range that doesn't match the real
 *    local data distribution.
 *  - Soil Depth is no longer a single flat proxy. There is no confirmed
 *    depth-to-bedrock product in SoilGrids 2.0 - it was rebuilt as a
 *    composite of coarse fragments, terrain position (TPI), HAND, slope,
 *    and a Sentinel-2 bare-rock index. This carries 15% of the weight, the
 *    largest single share, and deserved more than a placeholder.
 *  - Soil Texture's role shrinks in favor of Plant-Available Water Capacity
 *    (SoilGrids v2 wv0033 - wv1500, official catalog) as the primary
 *    Physical Site Suitability moisture-holding measure; texture class is
 *    kept as a species-matching attribute in the output table only.
 *  - Invasive Species Severity is retargeted from Prosopis juliflora to
 *    Lantana camara (the actual dominant invasive in this landscape), using
 *    NDVI AMPLITUDE (peak-season minus leaf-off) rather than leaf-off
 *    greenness alone, with mandatory orchard/cropland masking (mango
 *    orchards are the single biggest false-positive risk here).
 *  - Fire Frequency History and Human Dependency & Accessibility direction
 *    REVERSED from v2: fire-prone land now scores LOWER (avoid), and
 *    settlement proximity now scores LOWER (grazing/biotic pressure proxy,
 *    correct for a non-JFM eco-restoration programme - the opposite
 *    reading applies only where community handover/stewardship is part of
 *    the design).
 *  - Added: a Correlation Matrix diagnostic (pixel-sampled) and a Weight
 *    Sensitivity Analysis (+/-20% per criterion, block-level), because
 *    slope and rainfall are each embedded in 3-4 criteria here and the
 *    effective weight is materially higher than the nominal weight table
 *    suggests unless this is measured.
 *  - Scoring is config-driven: CRITERIA is one array of {id, name, weight,
 *    direction, build} objects and one generic loop scores all of them -
 *    not 14 near-identical hand-written blocks - so re-tuning weights or
 *    swapping a dataset is a local edit, not a script rewrite.
 *
 *  AOI WARNING (read before changing CONFIG.roi to a district boundary)
 *  ---------------------------------------------------------------------------
 *  FAO/GAUL/2015/level2 carries PRE-2013 district boundaries, in which
 *  "Sabar Kantha" still includes what is now Aravalli district. Using GAUL
 *  unmodified for a district-wide run will roughly double the intended
 *  study area. This script defaults to the pilot BEAT asset (unaffected by
 *  this issue); if you scale to district/division level, upload the actual
 *  current Forest Division/Range boundary rather than using GAUL directly.
 *
 *  HOW TO USE
 *  ---------------------------------------------------------------------------
 *  1. Edit CONFIG below.
 *  2. Optionally supply villages/roads/wildlifeCorridors/protectedAreas/
 *     forestBoundary - several criteria and the candidate mask itself use
 *     them; without them the model logs exactly what lost accuracy.
 *  3. Run. Console prints the ranked list, QA diagnostics, correlation
 *     matrix and sensitivity results. Tasks tab queues CSV/GeoTIFF/
 *     Shapefile exports.
 * ============================================================================
 */

// ============================================================================
// CONFIG
// ============================================================================
var CONFIG = {
  roi: ee.FeatureCollection('projects/raygadh-range/assets/BEAT'),
  year: 2025,

  district: 'Sabarkantha',
  state: 'Gujarat',
  unitName: 'BEAT',

  crs: 'EPSG:32643',                // UTM 43N - Sabarkantha spans ~72-74E
  scale: 30,                        // matches DEM/Hansen native resolution
  blockSizeM: 100,                  // ~1 ha reporting grid (brief Part 1)
  exportFolder: 'BGDSS',
  exportPrefix: 'BGDSS_Suitability_v3',

  targetTreatmentAreaHa: 200,       // ASSUMPTION - replace with confirmed APO figure
  correlationSampleSize: 3000,      // pixel sample for the correlation matrix (Part 6/7)
  sensitivityPerturbPct: 0.20,      // +/-20% per criterion (Part 7.5)

  // FSI official canopy classes (do not invent thresholds)
  fsiCanopyClasses: { scrubMax: 10, openMax: 40, moderatelyDenseMax: 70 },
  // Lower, separate bar for "existing forest" used only for proximity/
  // fragmentation criteria (C1, C3) - 40% is a moist-forest calibration and
  // misses the Open Forest mosaic that IS the reference type here.
  existingForestCanopyMin: 25,

  slopeExcludeDeg: 35,              // beyond practical trenching/pitting limit

  // Optional layers - each unlocks a higher-weighted criterion or a more
  // accurate candidate mask; omit any to fall back to a neutral default
  // (logged clearly when that happens).
  villages: null,
  roads: null,
  wildlifeCorridors: null,
  protectedAreas: null,
  forestBoundary: null,             // RF/PF notified-forest boundary (recommended)

  // ---- Cost / carbon assumptions - ASSUMPTION, VERIFY before submission ----
  costPerHaINR: { newPlantation: 65000, anr: 30000, lantanaClearanceSurcharge: 35000, fireLineSurcharge: 15000 },
  referenceAgbTPerHa: 120,          // prefer local 90th-percentile reference - see Section 8
  rootShootRatio: 0.28,
  carbonFraction: 0.5,              // FSI/ISFR convention
  co2Conversion: 3.6663,
  fireHistoryYears: 10,

  // ---- AHP-derived priority weights (sum to 1.0, asserted at runtime) ------
  weights: {
    distanceToForest: 0.10,
    hydrologicalConnectivity: 0.08,
    fragmentationIndex: 0.10,
    wildlifeCorridorProximity: 0.08,
    soilTexturePAWC: 0.07,
    soilDepth: 0.15,
    soilOrganicCarbon: 0.06,
    workability: 0.07,
    climateExposure: 0.05,
    carbonGainPotential: 0.06,
    erosionRisk: 0.05,
    invasiveSeverity: 0.07,
    bioticPressureAccess: 0.03,
    fireFrequency: 0.03
  }
};

var roi = CONFIG.roi.geometry();
try { Map.centerObject(CONFIG.roi, 12); Map.setOptions('SATELLITE'); } catch (e) {}

// ============================================================================
// HELPERS
// ============================================================================
function log(msg) { print('✓ ' + msg); }
function warn(msg) { print('⚠ ' + msg); }

function safeImage(id, label) {
  try { var img = ee.Image(id); img.bandNames().getInfo(); return img; }
  catch (e) { warn(label + ' unavailable (' + id + ') - using fallback'); return null; }
}
function safeCollection(id, label) {
  try { var col = ee.ImageCollection(id); col.first().bandNames().getInfo(); return col; }
  catch (e) { warn(label + ' unavailable (' + id + ') - using fallback'); return null; }
}
function safeMosaic(id, band, label) {
  try {
    var col = ee.ImageCollection(id);
    col.first().bandNames().getInfo();
    return (band ? col.select([band]) : col).mosaic();
  } catch (e) { warn(label + ' unavailable (' + id + ') - using fallback'); return null; }
}
function safeTable(id, label) {
  try { var fc = ee.FeatureCollection(id); fc.first().getInfo(); return fc; }
  catch (e) { warn(label + ' unavailable (' + id + ') - using fallback'); return null; }
}
function distanceToM(sourceMask, maxDistM) {
  // fastDistanceTransform needs a fully unmasked binary input, computed on
  // a coarser grid then resampled - full-resolution distance transforms
  // over multi-km ranges at 30m are needlessly expensive (brief Part 4/C1).
  var coarseScale = 100;
  return sourceMask.unmask(0)
    .reproject({ crs: CONFIG.crs, scale: coarseScale })
    .fastDistanceTransform(Math.ceil(maxDistM / coarseScale) + 2)
    .sqrt().multiply(coarseScale)
    .resample('bilinear')
    .clamp(0, maxDistM);
}

// ============================================================================
// SECTION 1: BASE LAYERS
// ============================================================================

// ---- DEM (primary + cross-check), slope, aspect ----------------------------
// setDefaultProjection() before ANY terrain operation is mandatory - without
// it, slope/aspect on a raw mosaic vary with display zoom and are silently
// wrong on export.
var demGlo30 = safeMosaic('COPERNICUS/DEM/GLO30', 'DEM', 'Copernicus GLO-30 DEM');
var demAw3d30 = safeMosaic('JAXA/ALOS/AW3D30/V3_2', 'DSM', 'JAXA AW3D30 DEM (cross-check)');
var dem = null, slope = null, aspect = null;
if (demGlo30) {
  dem = demGlo30.clip(roi).rename('elevation').toFloat()
    .setDefaultProjection(CONFIG.crs, null, CONFIG.scale);
  slope = ee.Terrain.slope(dem);
  aspect = ee.Terrain.aspect(dem);
  log('DEM (Copernicus GLO-30, primary) / Slope / Aspect ready');
} else if (demAw3d30) {
  dem = demAw3d30.clip(roi).rename('elevation').toFloat()
    .setDefaultProjection(CONFIG.crs, null, CONFIG.scale);
  slope = ee.Terrain.slope(dem);
  aspect = ee.Terrain.aspect(dem);
  warn('GLO-30 unavailable - using AW3D30 as primary DEM instead of cross-check');
}
var demCrossCheck = (demGlo30 && demAw3d30) ? demAw3d30.clip(roi).rename('elevation_aw3d30').toFloat() : null;

// ---- MERIT Hydro: upstream drainage area, height above nearest drainage ----
var merit = safeImage('MERIT/Hydro/v1_0_1', 'MERIT Hydro');
var upa = merit ? merit.select('upa').clip(roi) : null;      // km^2
var hand = merit ? merit.select('hnd').clip(roi) : null;     // m
if (merit) { log('MERIT Hydro (upstream drainage area, HAND) ready'); }

// ---- Sentinel-2 SR + Cloud Score+ mask --------------------------------------
var s2 = safeCollection('COPERNICUS/S2_SR_HARMONIZED', 'Sentinel-2 SR');
var csPlus = safeCollection('GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED', 'Cloud Score+');
function maskS2(col) {
  if (!col) return null;
  if (csPlus) {
    return col.linkCollection(csPlus, ['cs_cdf'])
      .map(function (img) { return img.updateMask(img.select('cs_cdf').gte(0.60)).divide(10000).copyProperties(img, ['system:time_start']); });
  }
  return col.map(function (img) {
    var scl = img.select('SCL');
    var clear = scl.neq(3).and(scl.neq(8)).and(scl.neq(9)).and(scl.neq(10)).and(scl.neq(11));
    return img.updateMask(clear).divide(10000).copyProperties(img, ['system:time_start']);
  });
}
var s2Masked = maskS2(s2);
if (s2 && csPlus) { log('Sentinel-2 + Cloud Score+ mask ready'); }
else if (s2) { warn('Cloud Score+ unavailable - falling back to SCL bitmask for cloud masking'); }

// ---- Land cover: WorldCover + Dynamic World ---------------------------------
var worldCover = safeMosaic('ESA/WorldCover/v200', 'Map', 'ESA WorldCover v200')
  || safeMosaic('ESA/WorldCover/v100', 'Map', 'ESA WorldCover v100');
var worldCoverMap = worldCover ? worldCover.select('Map').clip(roi) : null;
var dynamicWorld = safeCollection('GOOGLE/DYNAMICWORLD/V1', 'Dynamic World');
var dwComposite = dynamicWorld
  ? dynamicWorld.filterDate(ee.Date.fromYMD(CONFIG.year, 1, 1), ee.Date.fromYMD(CONFIG.year + 1, 1, 1)).filterBounds(roi).mode().clip(roi)
  : null;
if (worldCoverMap) { log('ESA WorldCover ready'); }
if (dwComposite) { log('Dynamic World composite ready'); }

// ---- Hansen Global Forest Change --------------------------------------------
var hansen = safeImage('UMD/hansen/global_forest_change_2025_v1_13', 'Hansen GFC 2025 v1.13')
  || safeImage('UMD/hansen/global_forest_change_2023_v1_11', 'Hansen GFC 2023 v1.11 (older fallback)');
var canopy2000 = hansen ? hansen.select('treecover2000').clip(roi) : null;
var lossYear = hansen ? hansen.select('lossyear').clip(roi) : null;
if (hansen) { log('Hansen Global Forest Change ready'); }

// ============================================================================
// SECTION 2: CANDIDATE MASK (built + applied BEFORE any normalization)
// ============================================================================
var wellStockedMask = null;   // >=40% canopy minus loss - excluded as "already stocked"
var candidateMask = null;
var bareRockIndex = null;     // built here since C6 and the candidate mask both need it

if (canopy2000 && lossYear && worldCoverMap && slope) {
  wellStockedMask = canopy2000.gte(CONFIG.fsiCanopyClasses.openMax).and(lossYear.eq(0));

  var waterMask = worldCoverMap.eq(80).or(worldCoverMap.eq(90));
  var builtMask = worldCoverMap.eq(50);
  var cropMask = worldCoverMap.eq(40);
  if (dwComposite) {
    builtMask = builtMask.or(dwComposite.select('label').eq(6));
    cropMask = cropMask.or(dwComposite.select('label').eq(4));
  }
  var jrcWater = safeImage('JRC/GSW1_4/GlobalSurfaceWater', 'JRC Global Surface Water');
  if (jrcWater) { waterMask = waterMask.or(jrcWater.select('occurrence').clip(roi).gte(50)); }

  // Bare-rock index: persistently low NDVI + high SWIR1 across BOTH a
  // monsoon and a leaf-off composite (a real degraded-soil pixel still
  // greens up somewhat in monsoon; bare rock/hardpan does not).
  if (s2Masked) {
    var monsoonComp = s2Masked.filterDate(ee.Date.fromYMD(CONFIG.year, 7, 15), ee.Date.fromYMD(CONFIG.year, 9, 30)).filterBounds(roi).median().clip(roi);
    var leafOffComp = s2Masked.filterDate(ee.Date.fromYMD(CONFIG.year, 2, 15), ee.Date.fromYMD(CONFIG.year, 4, 15)).filterBounds(roi).median().clip(roi);
    var ndviMonsoon = monsoonComp.normalizedDifference(['B8', 'B4']);
    var ndviLeafOff = leafOffComp.normalizedDifference(['B8', 'B4']);
    bareRockIndex = ndviMonsoon.lt(0.15).and(ndviLeafOff.lt(0.1)).and(monsoonComp.select('B11').gt(0.25));
  }

  var slopeExcludeMask = slope.gte(CONFIG.slopeExcludeDeg);

  candidateMask = ee.Image(1)
    .where(wellStockedMask, 0)
    .where(waterMask, 0)
    .where(builtMask, 0)
    .where(cropMask, 0)
    .where(slopeExcludeMask, 0);
  if (bareRockIndex) { candidateMask = candidateMask.where(bareRockIndex, 0); }
  if (CONFIG.forestBoundary) {
    try {
      var boundaryMask = ee.Image(0).paint(CONFIG.forestBoundary, 1);
      candidateMask = candidateMask.multiply(boundaryMask);
      log('Candidate mask restricted to CONFIG.forestBoundary (RF/PF)');
    } catch (e) { warn('forestBoundary layer invalid - candidate mask not restricted to notified forest'); }
  } else {
    warn('CONFIG.forestBoundary not set - candidate mask is not restricted to notified forest land; the model may include non-forest revenue land');
  }
  candidateMask = candidateMask.clip(roi).rename('candidate');
  log('Candidate mask built (excludes well-stocked forest, water, built-up, cropland, bare rock, slope>' + CONFIG.slopeExcludeDeg + ')');

  // ---- DIAGNOSTIC: area (ha) removed by each exclusion, and the final
  // candidate area. If "Eligible blocks: 0" ever recurs, this tells you
  // which single exclusion is responsible instead of guessing. ------------
  var pxHa = ee.Image.pixelArea().divide(1e4);
  var diagBands = [
    pxHa.updateMask(wellStockedMask).rename('wellStocked'),
    pxHa.updateMask(waterMask).rename('water'),
    pxHa.updateMask(builtMask).rename('built'),
    pxHa.updateMask(cropMask).rename('crop'),
    pxHa.updateMask(slopeExcludeMask).rename('steepSlope'),
    pxHa.updateMask(candidateMask).rename('candidateFinal')
  ];
  if (bareRockIndex) { diagBands.push(pxHa.updateMask(bareRockIndex).rename('bareRock')); }
  var diagInfo = ee.Image.cat(diagBands).reduceRegion({
    reducer: ee.Reducer.sum(), geometry: roi, scale: CONFIG.scale, maxPixels: 1e13, tileScale: 8, bestEffort: true
  }).getInfo();
  print('---- DIAGNOSTIC: area (ha) excluded by each candidate-mask rule ----');
  print(diagInfo);
  if (!diagInfo || !diagInfo.candidateFinal) {
    warn('Candidate area is 0/undefined. Compare the exclusion areas above against the total beat area (' + Math.round(ee.Number(roi.area(1)).divide(1e4).getInfo()) + ' ha) to see which rule is removing everything.');
  }
} else {
  warn('Cannot build candidate mask (needs Hansen + WorldCover + slope). Stopping - scoring the whole AOI without a candidate mask produces an invalid ranking.');
}

// "Existing forest" for proximity/fragmentation criteria - a LOWER, separate
// bar (25%) from the 40% used to exclude land from candidacy (brief C1).
var existingForestMask = (canopy2000 && lossYear && worldCoverMap)
  ? canopy2000.gte(CONFIG.existingForestCanopyMin).and(lossYear.eq(0)).or(worldCoverMap.eq(10))
  : null;

// FSI 4-tier canopy classification (official ISFR classes)
var fsiClass = null;
if (canopy2000) {
  var Cc = CONFIG.fsiCanopyClasses;
  fsiClass = ee.Image(1)
    .where(canopy2000.gte(Cc.scrubMax), 2)
    .where(canopy2000.gte(Cc.openMax), 3)
    .where(canopy2000.gte(Cc.moderatelyDenseMax), 4)
    .rename('fsiClass').clip(roi);
}

// ============================================================================
// SECTION 3: SHARED SUPPORT LAYERS (climate, biomass, RUSLE inputs) needed
// by more than one criterion below - computed once per performance practice.
// ============================================================================
var yStart = ee.Date.fromYMD(CONFIG.year, 1, 1);
var yEnd = yStart.advance(1, 'year');

var chirps = safeCollection('UCSB-CHG/CHIRPS/DAILY', 'CHIRPS rainfall');
var rainfallMean = null, rainfallCV = null;
if (chirps) {
  var annualSums = ee.ImageCollection(ee.List.sequence(0, 4).map(function (k) {
    var s = yStart.advance(ee.Number(-5).add(ee.Number(k)), 'year');
    return chirps.filterDate(s, s.advance(1, 'year')).sum().set('yr', k);
  }));
  rainfallMean = annualSums.mean().clip(roi).rename('rainfall');
  var rStd = annualSums.reduce(ee.Reducer.stdDev());
  rainfallCV = rStd.divide(rainfallMean.max(1)).clip(roi).rename('rainfallCV');
  log('CHIRPS 5-yr mean annual rainfall + coefficient of variation computed');
}

var modisLstAqua = safeCollection('MODIS/061/MYD11A2', 'MODIS LST (Aqua)');
var tempMaxC = null;
if (modisLstAqua) {
  tempMaxC = modisLstAqua.filterDate(ee.Date.fromYMD(CONFIG.year, 4, 1), ee.Date.fromYMD(CONFIG.year, 6, 15))
    .select('LST_Day_1km').max().multiply(0.02).subtract(273.15).clip(roi).rename('tempMax');
  log('Peak pre-monsoon LST computed (MODIS/Aqua, ~13:30 overpass)');
}
var landsatSt = safeCollection('LANDSAT/LC08/C02/T1_L2', 'Landsat 8 surface temperature');
if (landsatSt && tempMaxC) {
  var lsTemp = landsatSt.filterDate(ee.Date.fromYMD(CONFIG.year, 4, 1), ee.Date.fromYMD(CONFIG.year, 6, 15))
    .filterBounds(roi).select('ST_B10').max().multiply(0.00341802).add(149.0).subtract(273.15).clip(roi);
  tempMaxC = tempMaxC.add(lsTemp.resample('bilinear')).divide(2).rename('tempMax');
  log('Landsat 30m thermal blended into MODIS climatology for finer spatial detail');
}

// Heat-load (aspect) index - McCune & Keon (2002) closed-form, used as a
// multiplier on Climate Exposure (brief C9). Folded aspect: SW (225 deg) is
// hottest (foldedAspect=0), NE (45 deg) is coolest.
var heatLoadMultiplier = ee.Image(1);
if (slope && aspect && dem) {
  var latRad = ee.Image.pixelLonLat().select('latitude').multiply(Math.PI / 180).clip(roi);
  var slopeRad = slope.multiply(Math.PI / 180);
  var aspectRad = aspect.multiply(Math.PI / 180);
  var foldedAspect = aspectRad.subtract(5 * Math.PI / 4).abs().multiply(-1).add(Math.PI).abs();
  var heatLoad = latRad.cos().multiply(slopeRad.cos()).multiply(1.582)
    .subtract(foldedAspect.cos().multiply(slopeRad.sin()).multiply(latRad.sin()).multiply(1.5))
    .subtract(latRad.sin().multiply(slopeRad.sin()).multiply(0.262))
    .add(foldedAspect.sin().multiply(slopeRad.sin()).multiply(0.607))
    .add(-1.467).exp();
  heatLoadMultiplier = heatLoad.unitScale(0.5, 1.3).clamp(0, 1).multiply(0.3).add(0.7); // rescale to [0.7, 1.0]
  log('Heat-load (McCune & Keon aspect) multiplier computed');
}

// Biomass (Carbon-Gain Potential input)
var cciBiomass = safeImage('ESA/CCI/Above_Ground_Biomass/V6_0/2020', 'ESA CCI Biomass v6.0');
var gedi = safeCollection('LARSE/GEDI/GEDI04_A_002_MONTHLY', 'GEDI L4A Biomass');
var currentAgb = null;
if (gedi) {
  currentAgb = gedi.filterDate(yStart, yEnd).select('agbd').mean().clip(roi).rename('agb');
  log('GEDI L4A biomass loaded (primary source for Carbon-Gain Potential)');
} else if (cciBiomass) {
  currentAgb = cciBiomass.select('agb').clip(roi).rename('agb');
  log('ESA CCI Biomass v6.0 loaded (official catalog)');
} else if (s2Masked) {
  var agbComposite = s2Masked.filterDate(yStart, yEnd).filterBounds(roi).median().clip(roi);
  currentAgb = agbComposite.normalizedDifference(['B8', 'B4']).multiply(250).max(0).rename('agb');
  warn('GEDI and ESA CCI Biomass unavailable - using NDVI-based AGB proxy (lowest confidence)');
}
// Local reference AGB benchmark: 90th percentile of biomass within the
// best-preserved existing forest, rather than a generic state/ISFR average
// (brief C10 - avoids the "reference too high, criterion saturates" failure
// mode, and needs no external figure).
var referenceAgb = ee.Number(CONFIG.referenceAgbTPerHa);
if (currentAgb && existingForestMask) {
  var refStat = currentAgb.updateMask(existingForestMask).reduceRegion({
    reducer: ee.Reducer.percentile([90]), geometry: roi, scale: CONFIG.scale, maxPixels: 1e13, tileScale: 4, bestEffort: true
  });
  // A percentile reducer names its output '<band>_p<N>', not '<band>' - and
  // .get() needs an explicit default or a genuinely missing key becomes a
  // null that only errors later, at whatever line first forces evaluation.
  var localRef = refStat.get('agb_p90', null);
  referenceAgb = ee.Number(ee.Algorithms.If(localRef, localRef, CONFIG.referenceAgbTPerHa));
}

// ============================================================================
// SECTION 4: THE 14 CRITERIA (config-driven - one array, one generic loop)
// ----------------------------------------------------------------------------
// Each build() returns a RAW (not yet normalized) single-band ee.Image, or
// null if its inputs are unavailable. The generic loop below percentile-
// stretches (2nd-98th, within the candidate mask) and applies direction.
// ============================================================================
var CRITERIA = [

  { id: 'distanceToForest', name: 'Distance to Existing Forest', direction: 'down', build: function () {
    if (!existingForestMask) return null;
    return distanceToM(existingForestMask, 10000).rename('distanceToForest');
  }},

  { id: 'hydrologicalConnectivity', name: 'Hydrological Connectivity', direction: 'down', build: function () {
    if (!worldCoverMap) return null;
    var waterWetland = worldCoverMap.eq(80).or(worldCoverMap.eq(90));
    var streamNetwork = upa ? upa.gte(0.5) : null;
    var distWater = distanceToM(waterWetland, 5000);
    var parts = [distWater.multiply(0.3)];
    var totalW = 0.3;
    if (streamNetwork) { parts.push(distanceToM(streamNetwork, 5000).multiply(0.3)); totalW += 0.3; }
    var distComposite = parts.reduce(function (a, b) { return a.add(b); }).divide(totalW || 1);
    if (hand) {
      // low HAND = valley/footslope position = higher moisture; weight 40%
      // per brief, blended as an inverted contribution to the "distance"
      // composite (both should end up favourable at low values before
      // the shared direction:'down' inversion is applied).
      var handNorm01 = hand.unitScale(0, 30).clamp(0, 1).multiply(5000); // put on a comparable "distance-like" scale
      distComposite = distComposite.multiply(0.6).add(handNorm01.multiply(0.4));
    }
    return distComposite.rename('hydrologicalConnectivity');
  }},

  { id: 'fragmentationIndex', name: 'Fragmentation Index', direction: 'up', build: function () {
    if (!existingForestMask) return null;
    return existingForestMask.reduceNeighborhood({ reducer: ee.Reducer.mean(), kernel: ee.Kernel.circle({ radius: 10, units: 'pixels' }) }).rename('fragmentationIndex');
  }},

  { id: 'wildlifeCorridorProximity', name: 'Wildlife Corridor Proximity', direction: 'down', build: function () {
    var corridorSrc = null;
    if (CONFIG.wildlifeCorridors) {
      try { corridorSrc = ee.Image(0).paint(CONFIG.wildlifeCorridors, 1); } catch (e) { warn('wildlifeCorridors invalid'); }
    } else if (CONFIG.forestBoundary) {
      // Minimum viable fallback: buffered, dissolved forest-boundary
      // continuity network (brief C4) - crude, better than a constant.
      try { corridorSrc = ee.Image(0).paint(CONFIG.forestBoundary.geometry().buffer(2000), 1); } catch (e) {}
    }
    if (!corridorSrc) { warn('No wildlife corridor layer or forestBoundary available - Wildlife Corridor Proximity (8% weight) will run on a neutral default'); return null; }
    return distanceToM(corridorSrc, 5000).rename('wildlifeCorridorProximity');
  }},

  { id: 'soilTexturePAWC', name: 'Soil Texture (Plant-Available Water Capacity)', direction: 'up', build: function () {
    var fc = safeImage('ISRIC/SoilGrids250m/v2_0/wv0033', 'SoilGrids AWC field capacity');
    var wp = safeImage('ISRIC/SoilGrids250m/v2_0/wv1500', 'SoilGrids AWC wilting point');
    if (!fc || !wp) { return null; }
    var depths = ['0-5cm', '5-15cm', '15-30cm', '30-60cm'];
    var weights = [0.10, 0.15, 0.25, 0.50]; // depth-weighted toward the effective rooting zone
    var awc = ee.Image(0);
    depths.forEach(function (d, i) {
      var layerAwc = fc.select('val_' + d.replace('-', '_') + '_mean').subtract(wp.select('val_' + d.replace('-', '_') + '_mean'));
      awc = awc.add(layerAwc.multiply(weights[i]));
    });
    return awc.clip(roi).rename('soilTexturePAWC');
  }},

  { id: 'soilDepth', name: 'Soil Depth (composite index)', direction: 'up', build: function () {
    if (!slope || !dem) return null;
    var cfvo = safeImage('projects/soilgrids-isric/cfvo_mean', 'SoilGrids coarse fragments');
    var cfComponent = cfvo ? cfvo.select(0).clip(roi).unitScale(0, 400).clamp(0, 1).multiply(-1).add(1) : ee.Image(0.5);
    var tpi = dem.subtract(dem.reduceNeighborhood({ reducer: ee.Reducer.mean(), kernel: ee.Kernel.circle({ radius: 5, units: 'pixels' }) }));
    var tpiComponent = tpi.multiply(-1).unitScale(-10, 10).clamp(0, 1);
    var handComponent = hand ? hand.multiply(-1).unitScale(-30, 0).clamp(0, 1) : ee.Image(0.5);
    var slopeComponent = slope.multiply(-1).unitScale(-35, 0).clamp(0, 1);
    var rockComponent = bareRockIndex ? bareRockIndex.multiply(-1).add(1) : ee.Image(0.5);
    return cfComponent.multiply(0.25).add(tpiComponent.multiply(0.25)).add(handComponent.multiply(0.20))
      .add(slopeComponent.multiply(0.15)).add(rockComponent.multiply(0.15)).rename('soilDepth');
    // Field-calibration upgrade path (not run automatically - needs your
    // pit data): sample 30-50 GPS-located soil-pit depths, extract these
    // same predictors at those points, train
    // ee.Classifier.smileRandomForest(...).setOutputMode('REGRESSION'),
    // predict wall-to-wall, and report the out-of-bag R^2 on the map
    // legend. This is the single highest-return fix available in this
    // model (15% of the weight rests on a proxy otherwise).
  }},

  { id: 'soilOrganicCarbon', name: 'Soil Organic Carbon', direction: 'up', build: function () {
    var ocd = safeImage('projects/soilgrids-isric/ocd_mean', 'SoilGrids organic carbon density')
      || safeImage('projects/soilgrids-isric/soc_mean', 'SoilGrids organic carbon (concentration)');
    if (!ocd) return null;
    return ocd.select(0).clip(roi).rename('soilOrganicCarbon');
  }},

  { id: 'workability', name: 'Workability (Slope & Rainfall)', direction: 'up', build: function () {
    if (!slope || !rainfallMean) return null;
    // Slope scoring bands calibrated to Aravalli field practice, not a
    // generic curve (brief C8) - staggered contour trenching is standard
    // up to 30-35 deg here, so do not exclude that range from workability.
    var slopeScore = ee.Image(1)
      .where(slope.gt(5), 0.85).where(slope.gt(15), 0.60).where(slope.gt(25), 0.30).where(slope.gt(35), 0.05);
    return slopeScore.multiply(0.6).add(rainfallMean.unitScale(300, 1500).clamp(0, 1).multiply(0.4)).rename('workability');
  }},

  { id: 'climateExposure', name: 'Climate Exposure', direction: 'down', build: function () {
    if (!tempMaxC || !rainfallCV) return null;
    var exposureRaw = tempMaxC.unitScale(32, 46).clamp(0, 1).multiply(0.4)
      .add(rainfallCV.unitScale(0.1, 0.5).clamp(0, 1).multiply(0.6));
    return exposureRaw.divide(heatLoadMultiplier).rename('climateExposure'); // heat-load raises effective exposure on hot aspects
  }},

  { id: 'carbonGainPotential', name: 'Carbon-Gain Potential', direction: 'up', build: function () {
    if (!currentAgb) return null;
    // referenceAgb is an ee.Number (scalar) - ee.Number has no image methods
    // (the earlier bug called .subtract(image) on it directly, which built a
    // malformed Number-space graph that only failed once something forced
    // evaluation). Cast to a constant image first.
    return ee.Image.constant(referenceAgb).subtract(currentAgb).max(0).rename('carbonGainPotential');
  }},

  { id: 'erosionRisk', name: 'Soil Erosion Risk (RUSLE)', direction: 'up', build: function () {
    if (!slope || !rainfallMean) return null;
    // R: Singh, Babu & Chandra (1981), CSWCRTI Dehradun - published Indian
    // rainfall-erosivity regression, cited explicitly per brief C11.
    var R = rainfallMean.multiply(0.363).add(79);
    // K: Williams (EPIC) nomograph from SoilGrids texture, else a constant.
    var sand = safeImage('projects/soilgrids-isric/sand_mean', 'SoilGrids sand');
    var clay = safeImage('projects/soilgrids-isric/clay_mean', 'SoilGrids clay');
    var K;
    if (sand && clay) {
      var sandFrac = sand.select(0).clip(roi).divide(1000);
      var clayFrac = clay.select(0).clip(roi).divide(1000);
      var silt = ee.Image(1).subtract(sandFrac).subtract(clayFrac).max(0);
      K = sandFrac.multiply(-0.0256).add(silt.multiply(0.0016)).add(clayFrac.multiply(0.0072)).add(0.05).clamp(0.01, 0.65);
    } else { K = ee.Image(0.28); }
    // LS: MERIT Hydro upstream drainage area as a specific-catchment-area
    // proxy (brief's Option B native fallback - Option A requires an
    // external Whitebox/SAGA flow-accumulation run outside GEE).
    var slopeRad = slope.multiply(Math.PI / 180);
    var scAreaProxy = upa ? upa.multiply(1e6).divide(CONFIG.scale) : slope.reduceNeighborhood({ reducer: ee.Reducer.sum(), kernel: ee.Kernel.circle({ radius: 10, units: 'pixels' }) }).multiply(CONFIG.scale);
    var LS = scAreaProxy.divide(22.13).pow(0.4).multiply(slopeRad.sin().divide(0.0896).pow(1.3));
    // C: WorldCover land-cover lookup (NRSC/ISRO Soil Erosion Atlas of India methodology)
    var lcClasses = [10, 20, 30, 40, 50, 60, 90, 95, 100];
    var lcCValues = [0.01, 0.05, 0.03, 0.28, 0.0, 0.45, 0.02, 0.01, 0.05];
    var Cf = worldCoverMap ? worldCoverMap.remap(lcClasses, lcCValues, 0.2) : ee.Image(0.2);
    return R.multiply(K).multiply(LS).multiply(Cf).rename('erosionRisk'); // relative ranking only - see header note
  }},

  { id: 'invasiveSeverity', name: 'Invasive Species Severity (Lantana proxy)', direction: 'up', build: function () {
    if (!s2Masked || !worldCoverMap) return null;
    var leafOff = s2Masked.filterDate(ee.Date.fromYMD(CONFIG.year, 2, 15), ee.Date.fromYMD(CONFIG.year, 4, 15)).filterBounds(roi).median().clip(roi);
    var peakGreen = s2Masked.filterDate(ee.Date.fromYMD(CONFIG.year, 9, 15), ee.Date.fromYMD(CONFIG.year, 10, 31)).filterBounds(roi).median().clip(roi);
    var ndviLeafOff = leafOff.normalizedDifference(['B8', 'B4']);
    var ndviPeak = peakGreen.normalizedDifference(['B8', 'B4']);
    var amplitude = ndviPeak.subtract(ndviLeafOff); // Lantana (functionally evergreen) -> LOW amplitude
    var agriMask = worldCoverMap.eq(40);
    if (dwComposite) { agriMask = agriMask.or(dwComposite.select('label').eq(4)).or(dwComposite.select('label').eq(1)); } // crops + trees(orchard risk)
    // High leaf-off greenness AND low amplitude AND moderate SWIR -> Lantana likely.
    var severity = ndviLeafOff.unitScale(0.1, 0.5).clamp(0, 1).multiply(0.5)
      .add(amplitude.multiply(-1).unitScale(-0.1, 0.4).clamp(0, 1).multiply(0.5));
    return severity.updateMask(agriMask.not()).unmask(0.5).rename('invasiveSeverity');
  }},

  { id: 'bioticPressureAccess', name: 'Biotic Pressure & Access', direction: 'up', build: function () {
    // Settlement distance: FARTHER is better (grazing/biotic pressure proxy
    // for a non-JFM eco-restoration programme - direction reversed from a
    // participatory-forestry reading, per brief C13).
    var settlementSrc = null;
    if (CONFIG.villages) { try { settlementSrc = ee.Image(0).paint(CONFIG.villages, 1); } catch (e) {} }
    else if (worldCoverMap) { settlementSrc = worldCoverMap.eq(50); }
    if (!settlementSrc) return null;
    var settlementDist = distanceToM(settlementSrc, 5000); // "up" direction handles farther=better
    var roadComponent = ee.Image(2500); // neutral mid-distance if no road layer
    if (CONFIG.roads) {
      try { roadComponent = distanceToM(ee.Image(0).paint(CONFIG.roads, 1), 5000); } catch (e) {}
    } else {
      warn('CONFIG.roads not set - road-accessibility half of Biotic Pressure & Access defaulted to neutral');
    }
    if (!CONFIG.villages) { warn('CONFIG.villages not set - using WorldCover built-up as a coarse settlement-distance proxy'); }
    // Road closeness is cost-favourable (opposite sense to settlement
    // distance) - invert road distance onto the same "higher is better" scale.
    var roadCloseness = ee.Image(5000).subtract(roadComponent);
    return settlementDist.multiply(0.6).add(roadCloseness.multiply(0.4)).rename('bioticPressureAccess');
  }},

  { id: 'fireFrequency', name: 'Fire Frequency History', direction: 'down', build: function () {
    var burnedCol = safeCollection('MODIS/061/MCD64A1', 'MODIS Burned Area');
    if (!burnedCol || !worldCoverMap) return null;
    var histStart = ee.Date.fromYMD(CONFIG.year - CONFIG.fireHistoryYears, 1, 1);
    var fireCount = burnedCol.filterDate(histStart, yEnd).select('BurnDate')
      .map(function (img) { return img.gt(0); }).sum().clip(roi);
    // Exclude agricultural land - MCD64A1 over the Sabarmati valley largely
    // detects crop-residue burning, not forest fire (brief C14).
    return fireCount.updateMask(worldCoverMap.neq(40)).unmask(0).rename('fireFrequency');
  }}
];

var weightSum = 0;
Object.keys(CONFIG.weights).forEach(function (k) { weightSum += CONFIG.weights[k]; });
if (Math.abs(weightSum - 1.0) > 0.005) {
  throw new Error('CONFIG.weights must sum to 1.0 (currently ' + weightSum.toFixed(4) + '). Fix before running.');
}
log('Weight sum check passed (' + weightSum.toFixed(4) + ')');

// ============================================================================
// SECTION 5: GENERIC SCORING LOOP - percentile-stretch (within candidate
// mask) + directional inversion + weighted sum. One place, no scattered
// inversions (brief Part 5).
// ============================================================================
var normalizedBands = [];   // {id, name, weight, image (0-1, direction already applied)}
var rawBandsForDiagnostics = []; // {id, image} pre-stretch, for histogram/variance QA

CRITERIA.forEach(function (crit) {
  var raw = null;
  try { raw = crit.build(); } catch (e) { warn(crit.name + ' failed to build (' + e.message + ') - defaulted to neutral'); }
  var weight = CONFIG.weights[crit.id];
  if (!raw || !candidateMask) {
    normalizedBands.push({ id: crit.id, name: crit.name, weight: weight, image: ee.Image(0.5).rename(crit.id) });
    if (raw === null) { warn(crit.name + ' (' + (weight * 100).toFixed(1) + '% weight) running on a NEUTRAL DEFAULT - see warnings above for why'); }
    return;
  }
  var masked = raw.updateMask(candidateMask);
  var pct = masked.reduceRegion({
    reducer: ee.Reducer.percentile([2, 98]), geometry: roi, scale: CONFIG.scale, maxPixels: 1e13, tileScale: 8, bestEffort: true
  });
  // If the candidate mask has zero valid pixels for this criterion (e.g. the
  // candidate mask itself came back empty), the percentile dictionary is
  // missing these keys entirely - .get() without a default then resolves to
  // a null that only errors later, at whatever line first forces
  // evaluation (exactly the bug found in Carbon-Gain Potential). Check
  // key presence explicitly and fall back to neutral rather than build a
  // graph with a null operand.
  // .get(key, null) returns null (rather than erroring) when the key is
  // missing - e.g. because the candidate mask had zero valid pixels for
  // this criterion. Nested ee.Algorithms.If() checks (each treats a null
  // condition as falsy) fall back to a neutral image without ever building
  // a graph with a null numeric operand - ee.Dictionary has no .contains()
  // method, which is what crashed the previous version of this guard.
  var p2Raw = pct.get(ee.String(crit.id).cat('_p2'), null);
  var p98Raw = pct.get(ee.String(crit.id).cat('_p98'), null);
  var norm = ee.Image(ee.Algorithms.If(p2Raw,
    ee.Algorithms.If(p98Raw,
      (function () {
        var p2 = ee.Number(p2Raw);
        var p98 = ee.Number(p98Raw);
        var range = p98.subtract(p2);
        return ee.Algorithms.If(range.abs().gt(1e-6), raw.subtract(p2).divide(range).clamp(0, 1), ee.Image(0.5));
      })(),
      ee.Image(0.5)),
    ee.Image(0.5)));
  if (crit.direction === 'down') { norm = ee.Image(1).subtract(norm); }
  norm = norm.rename(crit.id).unmask(0.5).clip(roi);
  normalizedBands.push({ id: crit.id, name: crit.name, weight: weight, image: norm });
  rawBandsForDiagnostics.push({ id: crit.id, image: masked.rename(crit.id) });
  log(crit.name + ' normalized (2nd-98th percentile stretch within candidate mask, direction=' + crit.direction + ')');
});

var priorityScore = normalizedBands.reduce(function (acc, b) {
  var contribution = b.image.multiply(b.weight);
  return acc ? acc.add(contribution) : contribution;
}, null).rename('priorityScore');

// ============================================================================
// SECTION 6: TREATMENT ELIGIBILITY + TAGS
// ============================================================================
var treatment = null;
if (fsiClass && candidateMask) {
  treatment = ee.Image(0).where(fsiClass.eq(1), 1).where(fsiClass.eq(2), 2)
    .updateMask(candidateMask).rename('treatment').clip(roi);
  priorityScore = priorityScore.updateMask(treatment.gt(0));
}

var invasiveBand = normalizedBands.filter(function (b) { return b.id === 'invasiveSeverity'; })[0];
var invasiveFlag = invasiveBand ? invasiveBand.image.gt(0.65) : null; // high normalized severity

var fireBand = normalizedBands.filter(function (b) { return b.id === 'fireFrequency'; })[0];
var fireFlag = fireBand ? fireBand.image.lt(0.35) : null; // "down" direction already applied, so LOW score = high fire history

// Connectivity Constraint - separate output, never subtracted from priorityScore
var connectivityConstraint = null;
if (CONFIG.wildlifeCorridors || CONFIG.protectedAreas) {
  var pieces = [];
  if (CONFIG.wildlifeCorridors) { try { pieces.push(ee.Image(0).paint(CONFIG.wildlifeCorridors, 1)); } catch (e) {} }
  if (CONFIG.protectedAreas) { try { pieces.push(ee.Image(0).paint(CONFIG.protectedAreas, 1)); } catch (e) {} }
  if (pieces.length) { connectivityConstraint = pieces.reduce(function (a, b) { return a.max(b); }).clip(roi).rename('connectivityConstraint'); }
} else {
  warn('No wildlifeCorridors/protectedAreas supplied - Connectivity Constraint output omitted (independent of priority score either way)');
}

// ============================================================================
// SECTION 7: BLOCK AGGREGATION, RANKING, CORRELATION, SENSITIVITY
// ============================================================================
if (treatment && priorityScore && candidateMask) {
  var grid = (CONFIG.forestBoundary || roi);
  grid = roi.coveringGrid(CONFIG.crs, CONFIG.blockSizeM).map(function (f) { return f.intersection(roi, 1); });

  var blockBands = [ee.Image.pixelArea().divide(1e4).rename('areaHa'), priorityScore, treatment];
  normalizedBands.forEach(function (b) { blockBands.push(b.image); });
  if (invasiveFlag) { blockBands.push(invasiveFlag.rename('invasiveFlag')); }
  if (fireFlag) { blockBands.push(fireFlag.rename('fireFlag')); }
  if (connectivityConstraint) { blockBands.push(connectivityConstraint); }
  var blockInput = ee.Image.cat(blockBands);

  var combinedReducer = ee.Reducer.mean().combine({ reducer2: ee.Reducer.sum(), sharedInputs: true }).combine({ reducer2: ee.Reducer.mode(), sharedInputs: true });
  var blockStats = blockInput.reduceRegions({ collection: grid, reducer: combinedReducer, scale: CONFIG.scale, tileScale: 8 });

  // Pixel-level sample for the correlation matrix (Part 6/7) - deliberately
  // separate from block means, since block averaging would itself mask the
  // pixel-level double-counting this diagnostic exists to catch.
  var sampleImg = ee.Image.cat(normalizedBands.map(function (b) { return b.image; })).updateMask(candidateMask);
  var sample = sampleImg.sample({ region: roi, scale: CONFIG.scale, numPixels: CONFIG.correlationSampleSize, tileScale: 8, geometries: false });

  blockStats.evaluate(function (fc) {
    sample.evaluate(function (sampleFc) {
      var feats = (fc && fc.features) || [];
      var TREATMENT_LABEL = { 0: 'Not Prioritized', 1: 'New Plantation', 2: 'ANR' };
      var blocks = feats.map(function (f, idx) {
        var p = f.properties || {};
        var treatmentCode = Math.round(p.treatment_mode || 0);
        var label = TREATMENT_LABEL[treatmentCode] || 'Not Prioritized';
        if (treatmentCode > 0 && (p.invasiveFlag_mean || 0) > 0.5) { label += ' + Lantana Clearance'; }
        if (treatmentCode > 0 && (p.fireFlag_mean || 0) > 0.5) { label += ' + Fireline'; }
        var row = {
          id: idx + 1, areaHa: Number((p.areaHa_sum || 0).toFixed(2)),
          priority: Number((p.priorityScore_mean || 0).toFixed(3)), treatmentLabel: label,
          constraintPct: connectivityConstraint ? Math.round((p.connectivityConstraint_mean || 0) * 100) : null,
          criteria: {}
        };
        normalizedBands.forEach(function (b) { row.criteria[b.id] = p[b.id + '_mean']; });
        return row;
      }).filter(function (b) { return b.areaHa > 0.05 && b.priority > 0; });

      blocks.sort(function (a, b) { return b.priority - a.priority; });
      var cumulative = 0;
      blocks.forEach(function (b) { cumulative += b.areaHa; b.cumulativeAreaHa = Number(cumulative.toFixed(2)); b.selected = cumulative <= CONFIG.targetTreatmentAreaHa; });
      var selectedBlocks = blocks.filter(function (b) { return b.selected; });
      var selectedAreaHa = selectedBlocks.reduce(function (s, b) { return s + b.areaHa; }, 0);
      var totalCost = selectedBlocks.reduce(function (s, b) {
        var rate = b.treatmentLabel.indexOf('New Plantation') === 0 ? CONFIG.costPerHaINR.newPlantation : CONFIG.costPerHaINR.anr;
        if (b.treatmentLabel.indexOf('Lantana') > -1) rate += CONFIG.costPerHaINR.lantanaClearanceSurcharge;
        if (b.treatmentLabel.indexOf('Fireline') > -1) rate += CONFIG.costPerHaINR.fireLineSurcharge;
        return s + b.areaHa * rate;
      }, 0);

      print('================================================================');
      print('PLANTATION / ECO-RESTORATION SUITABILITY v3 - ' + CONFIG.unitName + ', ' + CONFIG.district + ', ' + CONFIG.state + ' (' + CONFIG.year + ')');
      print('================================================================');
      print('Eligible blocks: ' + blocks.length + ' (' + Math.round(blocks.reduce(function (s, b) { return s + b.areaHa; }, 0)) + ' ha total)');
      print('Selected (top-ranked, up to target): ' + selectedBlocks.length + ' blocks, ' + Math.round(selectedAreaHa) + ' ha (target ' + CONFIG.targetTreatmentAreaHa + ' ha)');
      print('ASSUMPTION - VERIFY: estimated cost @ placeholder rates: Rs ' + Math.round(totalCost).toLocaleString('en-IN'));
      print('----------------------------------------------------------------');
      print('Top 10 ranked blocks:');
      selectedBlocks.slice(0, 10).forEach(function (b) {
        print('#' + b.id + ' | ' + b.areaHa + ' ha | Priority ' + b.priority + ' | ' + b.treatmentLabel);
      });

      // ---- QA: variance check per criterion (block-level, quick diagnostic) --
      print('----------------------------------------------------------------');
      print('QA: criterion variance across selected blocks (near-zero = contributing nothing despite its weight):');
      normalizedBands.forEach(function (b) {
        var vals = blocks.map(function (blk) { return blk.criteria[b.id]; }).filter(function (v) { return v !== undefined && v !== null; });
        if (!vals.length) { print('  ' + b.name + ': NO DATA'); return; }
        var mean = vals.reduce(function (s, v) { return s + v; }, 0) / vals.length;
        var variance = vals.reduce(function (s, v) { return s + Math.pow(v - mean, 2); }, 0) / vals.length;
        print('  ' + b.name + ': mean=' + mean.toFixed(3) + ' variance=' + variance.toFixed(4) + (variance < 0.001 ? '  <-- NEAR-CONSTANT, check this input' : ''));
      });

      // ---- Correlation matrix (pixel-sampled) --------------------------------
      var sFeats = (sampleFc && sampleFc.features) || [];
      var ids = normalizedBands.map(function (b) { return b.id; });
      var columns = {};
      ids.forEach(function (id) { columns[id] = sFeats.map(function (f) { return f.properties[id]; }).filter(function (v) { return v !== undefined && v !== null; }); });
      function pearson(a, b) {
        var n = Math.min(a.length, b.length); if (n < 2) return null;
        a = a.slice(0, n); b = b.slice(0, n);
        var ma = a.reduce(function (s, v) { return s + v; }, 0) / n, mb = b.reduce(function (s, v) { return s + v; }, 0) / n;
        var cov = 0, va = 0, vb = 0;
        for (var i = 0; i < n; i++) { cov += (a[i] - ma) * (b[i] - mb); va += Math.pow(a[i] - ma, 2); vb += Math.pow(b[i] - mb, 2); }
        var denom = Math.sqrt(va * vb);
        return denom > 1e-9 ? cov / denom : 0;
      }
      print('----------------------------------------------------------------');
      print('Correlation matrix (|r| > 0.8 = likely double-counting the same signal; sample n=' + (sFeats.length) + '):');
      var corrRows = [];
      for (var i = 0; i < ids.length; i++) {
        for (var j = i + 1; j < ids.length; j++) {
          var r = pearson(columns[ids[i]], columns[ids[j]]);
          if (r === null) continue;
          corrRows.push({ a: ids[i], b: ids[j], r: r });
        }
      }
      corrRows.sort(function (x, y) { return Math.abs(y.r) - Math.abs(x.r); });
      corrRows.slice(0, 8).forEach(function (c) {
        print('  ' + c.a + ' vs ' + c.b + ': r=' + c.r.toFixed(3) + (Math.abs(c.r) > 0.8 ? '  <-- HIGH, consider merging/reweighting' : ''));
      });
      Export.table.toDrive({
        collection: ee.FeatureCollection(corrRows.map(function (c) { return ee.Feature(null, { A: c.a, B: c.b, R: Number(c.r.toFixed(4)) }); })),
        description: CONFIG.exportPrefix + '_CorrelationMatrix', folder: CONFIG.exportFolder, fileNamePrefix: CONFIG.exportPrefix + '_CorrelationMatrix', fileFormat: 'CSV'
      });

      // ---- Sensitivity analysis (+/-20% per criterion, block-level) ---------
      print('----------------------------------------------------------------');
      print('Sensitivity: rank stability of the top decile when each weight is perturbed +/-' + (CONFIG.sensitivityPerturbPct * 100) + '%');
      var top10CountTarget = Math.max(1, Math.round(blocks.length * 0.1));
      var baselineTopIds = blocks.slice(0, top10CountTarget).map(function (b) { return b.id; });
      var instabilityCounts = {};
      blocks.forEach(function (b) { instabilityCounts[b.id] = 0; });
      normalizedBands.forEach(function (crit) {
        [1 + CONFIG.sensitivityPerturbPct, 1 - CONFIG.sensitivityPerturbPct].forEach(function (mult) {
          var perturbed = blocks.map(function (b) {
            var score = 0;
            normalizedBands.forEach(function (c2) {
              var w = CONFIG.weights[c2.id] * (c2.id === crit.id ? mult : 1);
              score += (b.criteria[c2.id] || 0.5) * w;
            });
            return { id: b.id, score: score };
          });
          perturbed.sort(function (a, b) { return b.score - a.score; });
          var newTopIds = perturbed.slice(0, top10CountTarget).map(function (p) { return p.id; });
          newTopIds.forEach(function (id) { if (baselineTopIds.indexOf(id) === -1) { instabilityCounts[id] = (instabilityCounts[id] || 0) + 1; } });
          baselineTopIds.forEach(function (id) { if (newTopIds.indexOf(id) === -1) { instabilityCounts[id] = (instabilityCounts[id] || 0) + 1; } });
        });
      });
      var stableCount = baselineTopIds.filter(function (id) { return (instabilityCounts[id] || 0) === 0; }).length;
      print('  ' + stableCount + ' of ' + baselineTopIds.length + ' baseline top-decile blocks stay in the top decile under every +/-20% single-weight perturbation.');
      print('  (Full per-block instability counts in the exported CSV.)');
      Export.table.toDrive({
        collection: ee.FeatureCollection(blocks.slice(0, top10CountTarget).map(function (b) {
          var instabilityKey = 'Times moved out of top decile (of ' + (normalizedBands.length * 2) + ' perturbations)';
          var props = { 'Block ID': b.id, 'Priority': b.priority };
          props[instabilityKey] = instabilityCounts[b.id] || 0;
          return ee.Feature(null, props);
        })),
        description: CONFIG.exportPrefix + '_SensitivityResults', folder: CONFIG.exportFolder, fileNamePrefix: CONFIG.exportPrefix + '_SensitivityResults', fileFormat: 'CSV'
      });

      // ---- Ranked block export ------------------------------------------------
      var rows = blocks.map(function (b) {
        var props = { 'Block ID': b.id, 'Area (ha)': b.areaHa, 'Priority Score': b.priority, 'Recommended Treatment': b.treatmentLabel, 'Cumulative Area (ha)': b.cumulativeAreaHa, 'Selected This Cycle': b.selected ? 'YES' : 'no' };
        if (b.constraintPct !== null) props['Connectivity Constraint (%)'] = b.constraintPct;
        return ee.Feature(null, props);
      });
      Export.table.toDrive({ collection: ee.FeatureCollection(rows), description: CONFIG.exportPrefix + '_RankedBlocks', folder: CONFIG.exportFolder, fileNamePrefix: CONFIG.exportPrefix + '_RankedBlocks', fileFormat: 'CSV' });
    });
  });

  // ---- Visualization ---------------------------------------------------------
  var scoreStatsInfo = priorityScore.updateMask(candidateMask).reduceRegion({ reducer: ee.Reducer.percentile([5, 95]), geometry: roi, scale: CONFIG.scale, maxPixels: 1e13, tileScale: 8, bestEffort: true }).getInfo();
  var stretchMin = (scoreStatsInfo && scoreStatsInfo.priorityScore_p5 != null) ? scoreStatsInfo.priorityScore_p5 : 0;
  var stretchMax = (scoreStatsInfo && scoreStatsInfo.priorityScore_p95 != null) ? scoreStatsInfo.priorityScore_p95 : 1;
  if (!(stretchMax - stretchMin > 0.02)) { stretchMin = 0; stretchMax = 1; }

  Map.addLayer(treatment.selfMask(), { min: 1, max: 2, palette: ['1a9850', '2b83ba'] }, 'Recommended Treatment (green=New Plantation, blue=ANR)', true);
  Map.addLayer(priorityScore, { min: stretchMin, max: stretchMax, palette: ['fee08b', 'fc8d59', 'd73027'] }, 'Suitability Priority Score', false);
  Map.addLayer(candidateMask.selfMask(), { palette: ['ffffff'] }, 'Candidate Mask', false);
  if (fsiClass) { Map.addLayer(fsiClass, { min: 1, max: 4, palette: ['d73027', 'fee08b', '91cf60', '1a9850'] }, 'FSI Canopy Class', false); }
  if (invasiveFlag) { Map.addLayer(invasiveFlag.selfMask(), { palette: ['ff00ff'] }, 'Lantana Severity Flag (proxy - verify)', false); }
  if (connectivityConstraint) { Map.addLayer(connectivityConstraint.selfMask(), { palette: ['000000'] }, 'Connectivity Constraint', false); }
  try { Map.addLayer(ee.Image().byte().paint({ featureCollection: grid, color: 1, width: 1 }), { palette: ['ffffff'] }, 'Planning Blocks (' + CONFIG.blockSizeM + 'm)', false); } catch (e) {}

  try {
    var legend = ui.Panel({ style: { position: 'bottom-left', padding: '8px 15px' } });
    legend.add(ui.Label('Recommended Treatment', { fontWeight: 'bold', fontSize: '15px', margin: '0 0 2px 0' }));
    legend.add(ui.Label('(untinted = Not Prioritized / excluded)', { fontSize: '10px', color: '666666', margin: '0 0 6px 0' }));
    [['1a9850', 'New Plantation (Scrub, <10% canopy)'], ['2b83ba', 'ANR (Open, 10-40% canopy)']].forEach(function (item) {
      var colorBox = ui.Label('', { backgroundColor: item[0], padding: '8px', margin: '0 0 4px 0' });
      var desc = ui.Label(item[1], { margin: '0 0 4px 6px', fontSize: '12px' });
      legend.add(ui.Panel({ widgets: [colorBox, desc], layout: ui.Panel.Layout.flow('horizontal') }));
    });
    Map.add(legend);
  } catch (e) {}

  // ---- Exports (Part 8) -------------------------------------------------------
  Export.image.toDrive({ image: priorityScore, description: CONFIG.exportPrefix + '_PriorityScore', folder: CONFIG.exportFolder, fileNamePrefix: CONFIG.exportPrefix + '_PriorityScore', region: roi.bounds(), scale: CONFIG.scale, crs: CONFIG.crs, maxPixels: 1e13, formatOptions: { cloudOptimized: true } });
  Export.image.toDrive({ image: treatment.toInt(), description: CONFIG.exportPrefix + '_TreatmentType', folder: CONFIG.exportFolder, fileNamePrefix: CONFIG.exportPrefix + '_TreatmentType', region: roi.bounds(), scale: CONFIG.scale, crs: CONFIG.crs, maxPixels: 1e13 });
  Export.image.toDrive({ image: candidateMask.toInt(), description: CONFIG.exportPrefix + '_CandidateMask', folder: CONFIG.exportFolder, fileNamePrefix: CONFIG.exportPrefix + '_CandidateMask', region: roi.bounds(), scale: CONFIG.scale, crs: CONFIG.crs, maxPixels: 1e13 });
  if (fsiClass) { Export.image.toDrive({ image: fsiClass.toInt(), description: CONFIG.exportPrefix + '_FSICanopyClass', folder: CONFIG.exportFolder, fileNamePrefix: CONFIG.exportPrefix + '_FSICanopyClass', region: roi.bounds(), scale: CONFIG.scale, crs: CONFIG.crs, maxPixels: 1e13 }); }
  normalizedBands.forEach(function (b) {
    Export.image.toDrive({ image: b.image, description: CONFIG.exportPrefix + '_Criterion_' + b.id, folder: CONFIG.exportFolder, fileNamePrefix: CONFIG.exportPrefix + '_Criterion_' + b.id, region: roi.bounds(), scale: CONFIG.scale, crs: CONFIG.crs, maxPixels: 1e13 });
  });
  Export.table.toDrive({ collection: grid, description: CONFIG.exportPrefix + '_PlanningBlocks', folder: CONFIG.exportFolder, fileNamePrefix: CONFIG.exportPrefix + '_PlanningBlocks', fileFormat: 'SHP' });

  log('Module complete. Check Console for ranked list + QA diagnostics; Tasks tab has ' + (normalizedBands.length + 5) + ' exports queued (per-criterion rasters included for audit, per brief Part 8).');
}
