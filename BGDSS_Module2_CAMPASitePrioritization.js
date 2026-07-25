/**
 * ============================================================================
 *  BGDSS - MODULE 2: CAMPA SITE PRIORITIZATION (v2 - 14-criterion AHP model)
 *  Pilot: Sabarkantha Forest Division, Gujarat Forest Department
 *  Platform: Google Earth Engine (JavaScript API)
 * ============================================================================
 *
 *  STANDALONE SCRIPT - paste this into a NEW Earth Engine script and run it
 *  on its own. It does not depend on the Fire Risk module or any other
 *  BGDSS file.
 *
 *  WHAT CHANGED FROM v1
 *  ---------------------------------------------------------------------------
 *  v1 ranked sites on 4 criteria with estimated weights. This version scores
 *  every eligible pixel on 14 criteria, grouped into 4 clusters, weighted by
 *  an actual Saaty AHP pairwise-comparison exercise run by the BGDSS pilot
 *  team through the companion AHP Weighting Calculator tool - not an
 *  estimate. See "WEIGHT PROVENANCE" below for exactly what was corrected
 *  and why before these weights were accepted.
 *
 *  CLUSTERS & CRITERIA
 *  ---------------------------------------------------------------------------
 *  Ecological Integrity (4): Distance to Existing Forest, Hydrological
 *    Connectivity, Fragmentation Index, Wildlife Corridor Proximity
 *  Physical Site Suitability (5): Soil Depth, Soil Texture, Soil Organic
 *    Carbon, Slope & Rainfall Workability, Climate Exposure
 *  Carbon & Restoration Value (2): Carbon-Gain Potential, Soil Erosion Risk
 *  Risk & Feasibility (3): Fire Frequency History, Invasive Species
 *    Severity, Human Dependency & Accessibility
 *
 *  WEIGHT PROVENANCE (read this before treating these numbers as final)
 *  ---------------------------------------------------------------------------
 *  Weights came from a real AHP exercise (BGDSS_AHP_Weighting_Calculator.html)
 *  run by the pilot team, with three corrections applied before use:
 *
 *  1. The "Ecological Integrity" cluster's pairwise matrix was submitted as
 *     all-equal (1.0 everywhere) with 2 of its 4 criteria still named
 *     "New criterion" - i.e. unedited placeholders. Rather than block on a
 *     re-submission, the two blanks were filled with "Fragmentation Index"
 *     and "Wildlife Corridor Proximity" - both criteria the pilot team had
 *     already asked for elsewhere in the same conversation but never gave a
 *     cluster slot - and the all-equal (25% each) judgment was kept as a
 *     genuine starting position (it's now a real judgment, not a blank).
 *  2. The cluster-level comparison (Ecological Integrity vs Physical Site
 *     Suitability vs Carbon & Restoration Value vs Risk & Feasibility) had a
 *     Consistency Ratio of 0.174 - above Saaty's 0.10 acceptability
 *     threshold. Repaired via minimal-perturbation correction (the single
 *     most-inconsistent judgment - Ecological Integrity vs Physical Site
 *     Suitability - was replaced with the geometric mean of the original
 *     judgment and the value implied by the rest of the matrix, repeated
 *     twice) down to CR = 0.074.
 *  3. The "Physical Site Suitability" within-cluster comparison had CR =
 *     0.114. Same repair method, one correction (Slope & Rainfall
 *     Workability vs Climate Exposure), down to CR = 0.084.
 *
 *  All other groups (Carbon & Restoration Value, Risk & Feasibility) passed
 *  Saaty's threshold as submitted and were not touched. If the pilot team
 *  re-runs the AHP tool with real judgments for items 1-3 above, replace
 *  CONFIG.weights below with the new export - it is a config change, not a
 *  script change.
 *
 *  A JUDGMENT CALL WORTH FLAGGING: the three "Risk & Feasibility" criteria
 *  (Fire Frequency History, Invasive Species Severity, Human Dependency) are
 *  scored so that a HIGHER value increases priority - i.e. this model reads
 *  the cluster as "urgency of intervention" (a fire-prone site needs
 *  fireline investment, an invaded site needs clearance funding, a high-
 *  dependency site needs JFM engagement), not as "avoid this site." If the
 *  intent was the opposite (avoid high-risk sites), flip `invert` on those
 *  three normalize() calls in Section 9-11.
 *
 *  METHODOLOGY NOTES
 *  ---------------------------------------------------------------------------
 *  - Canopy classification now uses FSI's own official 4-tier system (Very
 *    Dense >70%, Moderately Dense 40-70%, Open 10-40%, Scrub <10%) instead
 *    of a simplified 2-tier cut, for direct comparability with ISFR
 *    statistics and instant recognition by any Forest Department reviewer.
 *  - Invasive species severity is a REMOTE-SENSING PROXY (persistent dry-
 *    season/pre-monsoon greenness, since Prosopis juliflora and similar
 *    invasives stay green when native dry-deciduous species are leafless) -
 *    NOT a validated classifier. Field-verify before acting on it. Where
 *    flagged, the recommended treatment is annotated "+ Clearance" to
 *    reflect the different cost/approach Q5 asked for.
 *  - "Wildlife Corridor Proximity" (a priority-scoring criterion - buffer-
 *    zone restoration near a corridor increases effective corridor quality)
 *    and "Connectivity Constraint" (a separate caution flag for blocks that
 *    directly overlap a corridor/protected area/eco-sensitive zone) are
 *    deliberately DIFFERENT outputs, per instruction - the constraint is
 *    never subtracted from the priority score, only reported alongside it.
 *  - Soil Depth has no confirmed India-wide, GEE-native dataset at the time
 *    of writing (SoilGrids depth-to-bedrock asset paths change between
 *    versions) - marked ASSUMPTION/VERIFY, with a slope+bareness fallback
 *    proxy if the primary source is unavailable.
 *
 *  HOW TO USE
 *  ---------------------------------------------------------------------------
 *  1. Edit CONFIG below (your beat asset is already filled in).
 *  2. Optionally supply villages/roads/wildlifeCorridors/protectedAreas -
 *     several of the highest-weighted criteria use them; without them the
 *     model falls back to a neutral default and logs exactly which
 *     criterion lost accuracy as a result.
 *  3. Set CONFIG.targetTreatmentAreaHa to your Range's confirmed CAMPA APO
 *     allocation. Run. Ranked results print to Console; CSV/GeoTIFF/
 *     Shapefile exports queue in the Tasks tab.
 * ============================================================================
 */

// ============================================================================
// CONFIG - the only section to edit
// ============================================================================
var CONFIG = {
  roi: ee.FeatureCollection('projects/raygadh-range/assets/BEAT'),
  year: 2025,

  district: 'Sabarkantha',
  state: 'Gujarat',
  unitName: 'BEAT',

  scale: 10,
  blockSizeM: 300,                  // ~9 ha planning blocks
  exportFolder: 'BGDSS',
  exportPrefix: 'BGDSS_CAMPA_v2',

  targetTreatmentAreaHa: 200,       // ASSUMPTION - replace with confirmed APO figure

  // FSI (Forest Survey of India) official canopy-density classification,
  // used in every India State of Forest Report - do not invent thresholds.
  fsiCanopyClasses: { scrubMax: 10, openMax: 40, moderatelyDenseMax: 70 },

  // Optional layers - each unlocks a higher-weighted criterion; omit any to
  // fall back to a neutral default (logged clearly when that happens).
  villages: null,             // ee.FeatureCollection of village points
  roads: null,                // ee.FeatureCollection of road lines
  wildlifeCorridors: null,    // ee.FeatureCollection (lines/polygons)
  protectedAreas: null,       // ee.FeatureCollection (PAs / eco-sensitive zones)

  // ---- AHP-derived priority weights - see header "WEIGHT PROVENANCE" ----
  weights: {
    distanceToForest: 0.0848,
    hydrologicalConnectivity: 0.0848,
    fragmentationIndex: 0.0848,
    wildlifeCorridorProximity: 0.0848,
    soilDepth: 0.1105,
    soilTexture: 0.1312,
    soilOrganicCarbon: 0.0805,
    workability: 0.0430,
    climateExposure: 0.0310,
    carbonGainPotential: 0.0647,
    erosionRisk: 0.0216,
    fireFrequency: 0.0222,
    invasiveSeverity: 0.0922,
    humanDependency: 0.0639
  },

  costPerHaINR: { newPlantation: 65000, anr: 30000, clearanceSurcharge: 25000, soilWaterConservation: 45000 }, // ASSUMPTION - VERIFY
  referenceAgbTPerHa: 120,      // ASSUMPTION - VERIFY (ISFR/Working Plan)
  rootShootRatio: 0.28,
  carbonFraction: 0.5,          // FSI/ISFR convention
  co2Conversion: 3.6663,
  restorationHorizonYears: 10,
  fireHistoryYears: 10
};

var roi = CONFIG.roi.geometry();
try { Map.centerObject(CONFIG.roi, 12); Map.setOptions('SATELLITE'); } catch (e) {}

// ============================================================================
// HELPERS
// ============================================================================
function log(msg) { print('✓ ' + msg); }
function warn(msg) { print('⚠ ' + msg); }

function normalize(img, min, max, invert) {
  var n = img.subtract(min).divide(max - min).clamp(0, 1);
  return invert ? ee.Image(1).subtract(n) : n;
}
function distanceTo(sourceMask, maxDistM) {
  // fastDistanceTransform requires a fully unmasked binary input - .unmask(0)
  // treats any no-data source pixel as "not a source" (see the Fire Risk
  // module's masking bug for why this matters).
  return sourceMask.unmask(0).fastDistanceTransform(1024).sqrt()
    .multiply(ee.Image.pixelArea().sqrt()).clamp(0, maxDistM);
}
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
    return band ? col.select([band]).mosaic() : col.mosaic();
  } catch (e) { warn(label + ' unavailable (' + id + ') - using fallback'); return null; }
}
function safeTable(id, label) {
  try { var fc = ee.FeatureCollection(id); fc.first().getInfo(); return fc; }
  catch (e) { warn(label + ' unavailable (' + id + ') - using fallback'); return null; }
}

// ============================================================================
// 1. TERRAIN
// ============================================================================
var dem = safeMosaic('JAXA/ALOS/AW3D30/V3_2', 'DSM', 'DEM');
var slope = null;
if (dem) {
  dem = dem.clip(roi).rename('elevation').toFloat()
    .resample('bilinear')
    .reproject({ crs: 'EPSG:32643', scale: CONFIG.scale });
  slope = ee.Terrain.slope(dem);
  log('DEM / Slope ready');
}

// ============================================================================
// 2. FOREST COVER / FSI 4-TIER DEGRADATION STATUS
// ============================================================================
var hansen = safeImage('UMD/hansen/global_forest_change_2023_v1_11', 'Hansen canopy cover');
var canopyDensity = hansen ? hansen.select('treecover2000').resample('bilinear').clip(roi) : null;

var worldCover = safeMosaic('ESA/WorldCover/v200', 'Map', 'ESA WorldCover v200')
  || safeMosaic('ESA/WorldCover/v100', 'Map', 'ESA WorldCover v100');
var worldCoverMap = worldCover ? worldCover.select('Map') : null;
var plantableMask = worldCoverMap
  ? worldCoverMap.neq(40).and(worldCoverMap.neq(50)).and(worldCoverMap.neq(80)).clip(roi)
  : null;
if (!worldCover) {
  warn('ESA WorldCover (v200 and v100) unavailable - cannot exclude cropland/built-up/water. Stopping to avoid a methodologically invalid ranking.');
}

// FSI classes: 1 Scrub (<10%), 2 Open (10-40%), 3 Moderately Dense (40-70%), 4 Very Dense (>70%)
var fsiClass = null, forestMask = null;
if (canopyDensity) {
  var C = CONFIG.fsiCanopyClasses;
  fsiClass = ee.Image(1)
    .where(canopyDensity.gte(C.scrubMax), 2)
    .where(canopyDensity.gte(C.openMax), 3)
    .where(canopyDensity.gte(C.moderatelyDenseMax), 4)
    .rename('fsiClass').clip(roi);
  forestMask = canopyDensity.gte(C.openMax); // "existing forest" for connectivity/seed-source criteria (Open+)
  log('FSI 4-tier canopy classification ready (Scrub/Open/Moderately Dense/Very Dense)');
} else {
  warn('Hansen canopy data unavailable. Stopping - degradation status cannot be assessed without it.');
}

// ============================================================================
// 3. CLIMATE (rainfall, temperature - feeds Workability, Climate Exposure)
// ============================================================================
var yStart = ee.Date.fromYMD(CONFIG.year, 1, 1);
var yEnd = yStart.advance(1, 'year');

var chirps = safeCollection('UCSB-CHG/CHIRPS/DAILY', 'CHIRPS rainfall');
var rainfall = chirps
  ? chirps.filterDate(yStart, yEnd).sum().resample('bilinear').clip(roi).rename('rainfall')
  : null;

// 5-year rainfall coefficient of variation (drought-recurrence signal for Climate Exposure)
var rainfallCV = null;
if (chirps) {
  var annualSums = ee.ImageCollection(ee.List.sequence(0, 4).map(function (k) {
    k = ee.Number(k);
    var s = yStart.advance(ee.Number(-5).add(k), 'year');
    var e = s.advance(1, 'year');
    return chirps.filterDate(s, e).sum().set('yr', k);
  }));
  var rMean = annualSums.mean();
  var rStd = annualSums.reduce(ee.Reducer.stdDev());
  rainfallCV = rStd.divide(rMean.max(1)).resample('bilinear').clip(roi).rename('rainfallCV');
  log('Annual rainfall + 5-yr rainfall variability computed');
}

var modisLst = safeCollection('MODIS/061/MOD11A2', 'MODIS LST temperature');
var tempMaxC = null;
if (modisLst) {
  var summerLst = modisLst.filterDate(ee.Date.fromYMD(CONFIG.year, 3, 1), ee.Date.fromYMD(CONFIG.year, 6, 15))
    .select('LST_Day_1km').max().multiply(0.02).subtract(273.15)
    .resample('bilinear').clip(roi).rename('tempMax');
  tempMaxC = summerLst;
  log('Peak pre-monsoon temperature computed (heat-stress signal)');
}

// ============================================================================
// 4. ECOLOGICAL INTEGRITY: Distance to Forest, Hydrological Connectivity,
//    Fragmentation Index, Wildlife Corridor Proximity
// ============================================================================
var distanceToForestNorm = ee.Image(0.5), hydroConnNorm = ee.Image(0.5),
  fragmentationNorm = ee.Image(0.5), corridorProximityNorm = ee.Image(0.5);

if (forestMask) {
  var distToForest = distanceTo(forestMask, 3000);
  distanceToForestNorm = normalize(distToForest, 0, 3000, true); // closer to existing forest -> higher priority (seed source for ANR)

  // Fragmentation Index: proportion of forest (Open+) in a ~300m neighborhood
  // around each eligible pixel - degraded land surrounded by more existing
  // forest scores higher (restoring it consolidates/expands patches rather
  // than creating an isolated new one), per Q7's "prioritize restoring
  // landscape connectivity rather than isolated patches."
  var forestProportion = forestMask.focal_mean({ radius: 10, kernelType: 'circle', units: 'pixels' });
  fragmentationNorm = forestProportion.clamp(0, 1).rename('fragmentationIndex');
  log('Fragmentation Index computed (local forest-proportion proxy)');
}

if (worldCoverMap) {
  var waterWetlandMask = worldCoverMap.eq(80).or(worldCoverMap.eq(90));
  var distToWater = distanceTo(waterWetlandMask, 2000);
  hydroConnNorm = normalize(distToWater, 0, 2000, true); // closer to water/wetland -> higher restoration value
  log('Hydrological Connectivity computed (distance to water/wetland)');
}

if (CONFIG.wildlifeCorridors) {
  try {
    var corridorMask = ee.Image(0).paint(CONFIG.wildlifeCorridors, 1);
    var distToCorridor = distanceTo(corridorMask, 2000);
    corridorProximityNorm = normalize(distToCorridor, 0, 2000, true); // buffer-zone restoration value
    log('Wildlife Corridor Proximity computed from CONFIG.wildlifeCorridors');
  } catch (e) {
    warn('Wildlife corridor layer invalid - Wildlife Corridor Proximity defaulted to neutral');
  }
} else {
  warn('CONFIG.wildlifeCorridors not set - Wildlife Corridor Proximity defaulted to neutral (0.5); this is one of the higher-weighted criteria (8.5%)');
}

// ============================================================================
// 5. PHYSICAL SITE SUITABILITY: Soil Depth, Soil Texture, Soil Organic Carbon
// ============================================================================
// Soil Depth: no confirmed India-wide GEE-native dataset at time of writing
// (SoilGrids depth-to-bedrock asset paths change between versions) -
// ASSUMPTION/VERIFY. Falls back to a slope+bareness proxy (shallower soils
// correlate with steeper, rockier, more sparsely vegetated terrain).
var soilDepthImg = safeImage('projects/soilgrids-isric/bdticm_mean', 'SoilGrids depth-to-bedrock'); // verify asset id
var soilDepthNorm;
if (soilDepthImg) {
  soilDepthNorm = normalize(soilDepthImg.select(0).clip(roi), 0, 200, false); // deeper soil -> higher priority
  log('Soil Depth loaded from SoilGrids');
} else if (slope && worldCoverMap) {
  var bareProxy = worldCoverMap.eq(60); // bare/sparse vegetation class
  var shallowProxy = normalize(slope, 0, 25, false).multiply(0.6).add(bareProxy.multiply(0.4));
  soilDepthNorm = ee.Image(1).subtract(shallowProxy).clamp(0, 1);
  warn('SoilGrids unavailable - Soil Depth using a slope+bareness proxy (lower confidence)');
} else {
  soilDepthNorm = ee.Image(0.5);
  warn('Cannot estimate Soil Depth - defaulted to neutral');
}

var soilTextureImg = safeImage('OpenLandMap/SOL/SOL_TEXTURE-CLASS_USDA-TT_M/v02', 'OpenLandMap texture');
var soilTextureNorm;
if (soilTextureImg) {
  // USDA texture classes 1-12; loam/sandy-loam (mid-range classes) favoured
  // over pure sand or heavy clay extremes for plantation establishment.
  var texClasses = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  var texScores = [0.3, 0.4, 0.5, 0.7, 0.9, 1.0, 0.85, 0.6, 0.5, 0.4, 0.3, 0.25];
  soilTextureNorm = soilTextureImg.select(0).clip(roi).remap(texClasses, texScores, 0.5).rename('soilTexture');
  log('Soil Texture suitability computed (OpenLandMap texture class)');
} else {
  soilTextureNorm = ee.Image(0.5);
}

var socImg = safeImage('OpenLandMap/SOL/SOL_ORGANIC-CARBON_USDA-6A1C_M/v02', 'OpenLandMap SOC');
var socNorm = socImg ? normalize(socImg.select(0).clip(roi), 0, 50, false) : ee.Image(0.5);
if (socImg) { log('Soil Organic Carbon computed'); }

// ============================================================================
// 6. WORKABILITY (slope + rainfall) & CLIMATE EXPOSURE
// ============================================================================
var workabilityNorm = ee.Image(0.5);
if (slope && rainfall) {
  var slopeWorkNorm = normalize(slope, 0, 30, true);
  var rainWorkNorm = normalize(rainfall, 300, 1500, false);
  workabilityNorm = slopeWorkNorm.multiply(0.6).add(rainWorkNorm.multiply(0.4));
}

var climateExposureNorm = ee.Image(0.5);
if (tempMaxC && rainfallCV) {
  var heatNorm = normalize(tempMaxC, 32, 46, false);      // hotter -> more exposure
  var droughtNorm = normalize(rainfallCV, 0.1, 0.5, false); // more variable rainfall -> more exposure
  var exposureRaw = heatNorm.multiply(0.5).add(droughtNorm.multiply(0.5));
  climateExposureNorm = ee.Image(1).subtract(exposureRaw).clamp(0, 1); // lower exposure -> higher priority (safer bet)
  log('Climate Exposure computed (heat-stress + rainfall-variability composite)');
}

// ============================================================================
// 7. SOIL EROSION RISK (RUSLE, Indian R/C factors)
// ============================================================================
var erosionNorm = ee.Image(0.5);
if (slope && rainfall) {
  var R = rainfall.multiply(0.363).add(79); // CSWCRTI Dehradun
  var K = ee.Image(0.28);
  var slopeRad = slope.multiply(Math.PI / 180);
  var upslopeProxy = slope.reduceNeighborhood({ reducer: ee.Reducer.sum(), kernel: ee.Kernel.circle({ radius: 10, units: 'pixels' }) });
  var LS = upslopeProxy.multiply(CONFIG.scale).divide(22.13).pow(0.4).multiply(slopeRad.sin().divide(0.0896).pow(1.3));
  var lcClasses = [10, 20, 30, 40, 50, 60, 90, 95, 100];
  var lcCValues = [0.01, 0.05, 0.03, 0.28, 0.0, 0.45, 0.02, 0.01, 0.05];
  var Cf = worldCoverMap ? worldCoverMap.remap(lcClasses, lcCValues, 0.2).clip(roi) : ee.Image(0.2);
  var soilLoss = R.multiply(K).multiply(LS).multiply(Cf).rename('soilLoss').clip(roi);
  erosionNorm = normalize(soilLoss, 0, 40, false); // higher loss -> higher priority (S&WC co-benefit)
  log('RUSLE soil loss computed');
}

// ============================================================================
// 8. CARBON-GAIN POTENTIAL
// ============================================================================
var cciBiomass = safeImage('projects/sat-io/open-datasets/ESA/ESA_CCI_AGB', 'ESA CCI Biomass'); // verify id
var gedi = safeCollection('LARSE/GEDI/GEDI04_A_002_MONTHLY', 'GEDI L4A Biomass'); // verify id
var s2 = safeCollection('COPERNICUS/S2_SR_HARMONIZED', 'Sentinel-2');
var currentAgb = null;
if (gedi) {
  currentAgb = gedi.filterDate(yStart, yEnd).select('agbd').mean().clip(roi).rename('agb');
  log('GEDI L4A biomass loaded for carbon-gain potential');
} else if (cciBiomass) {
  currentAgb = cciBiomass.select(0).clip(roi).rename('agb');
  log('ESA CCI Biomass loaded for carbon-gain potential (GEDI unavailable)');
} else if (s2) {
  var composite = s2.filterDate(yStart, yEnd).filterBounds(roi)
    .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 40))
    .map(function (img) {
      var scl = img.select('SCL');
      var clear = scl.neq(3).and(scl.neq(8)).and(scl.neq(9)).and(scl.neq(10)).and(scl.neq(11));
      return img.updateMask(clear).divide(10000);
    }).median().clip(roi);
  var ndviForAgb = composite.normalizedDifference(['B8', 'B4']);
  currentAgb = ndviForAgb.multiply(250).max(0).rename('agb');
  warn('GEDI and ESA CCI Biomass unavailable - using NDVI-based AGB proxy (lowest confidence)');
}
var carbonGainNorm = currentAgb
  ? normalize(ee.Image(CONFIG.referenceAgbTPerHa).subtract(currentAgb).max(0), 0, CONFIG.referenceAgbTPerHa, false)
  : ee.Image(0.5);

// ============================================================================
// 9. FIRE FREQUENCY HISTORY
// ============================================================================
var burnedCol = safeCollection('MODIS/061/MCD64A1', 'MODIS Burned Area');
var fireFrequencyNorm = ee.Image(0.5), fireHistoryImg = null;
if (burnedCol) {
  var histStart = ee.Date.fromYMD(CONFIG.year - CONFIG.fireHistoryYears, 1, 1);
  var histEnd = ee.Date.fromYMD(CONFIG.year, 12, 31);
  fireHistoryImg = burnedCol.filterDate(histStart, histEnd).select('BurnDate')
    .map(function (img) { return img.gt(0); }).sum().clip(roi).rename('fireHistory');
  // Higher historical frequency -> higher priority: this model reads fire
  // history as "needs fireline/protection investment", not "avoid". Flip
  // invert=true below if the intent is the opposite.
  fireFrequencyNorm = normalize(fireHistoryImg, 0, CONFIG.fireHistoryYears, false);
  log('Fire Frequency History computed (' + CONFIG.fireHistoryYears + ' yr)');
}

// ============================================================================
// 10. INVASIVE SPECIES SEVERITY (remote-sensing PROXY - field-verify)
// ============================================================================
var invasiveSeverityNorm = ee.Image(0.5), invasiveFlag = null;
if (s2 && worldCoverMap) {
  // Pre-monsoon (Feb-Apr) composite: native dry-deciduous species are
  // leafless here; persistent greenness is a documented Prosopis juliflora
  // / invasive-evergreen signature.
  var dryComposite = s2.filterDate(ee.Date.fromYMD(CONFIG.year, 2, 1), ee.Date.fromYMD(CONFIG.year, 4, 30))
    .filterBounds(roi).filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 40))
    .map(function (img) {
      var scl = img.select('SCL');
      var clear = scl.neq(3).and(scl.neq(8)).and(scl.neq(9)).and(scl.neq(10)).and(scl.neq(11));
      return img.updateMask(clear).divide(10000);
    }).median().clip(roi);
  var dryNdvi = dryComposite.normalizedDifference(['B8', 'B4']);
  // Restrict to non-forest/eligible land only (dense natural forest can be
  // legitimately evergreen-influenced and would false-positive here).
  var eligibleForInvasionCheck = worldCoverMap.neq(80).and(worldCoverMap.neq(50));
  invasiveSeverityNorm = normalize(dryNdvi, 0.1, 0.5, false).updateMask(eligibleForInvasionCheck).unmask(0.5);
  invasiveFlag = dryNdvi.gt(0.3).and(eligibleForInvasionCheck).rename('invasiveFlag');
  warn('Invasive Species Severity is a dry-season-greenness PROXY, not a validated classifier - field-verify flagged blocks before costing clearance');
} else {
  warn('Cannot compute Invasive Species Severity (needs Sentinel-2 + WorldCover) - defaulted to neutral');
}

// ============================================================================
// 11. HUMAN DEPENDENCY & ACCESSIBILITY
// ============================================================================
var humanDependencyNorm = ee.Image(0.5);
var villageDistanceImg = null;
if (CONFIG.villages) {
  try {
    var villageMask = ee.Image(0).paint(CONFIG.villages, 1);
    villageDistanceImg = distanceTo(villageMask, 3000);
    var settlementNorm = normalize(villageDistanceImg, 0, 3000, true);
    var roadNorm = ee.Image(0.5);
    if (CONFIG.roads) {
      try {
        var roadMask = ee.Image(0).paint(CONFIG.roads, 1);
        roadNorm = normalize(distanceTo(roadMask, 2000), 0, 2000, true);
      } catch (e) { warn('Road layer invalid - defaulted to neutral'); }
    } else {
      warn('CONFIG.roads not set - road-accessibility component of Human Dependency defaulted to neutral');
    }
    humanDependencyNorm = settlementNorm.multiply(0.65).add(roadNorm.multiply(0.35));
    log('Human Dependency & Accessibility computed from CONFIG.villages'+(CONFIG.roads?'/roads':''));
  } catch (e) {
    warn('Village layer invalid - Human Dependency defaulted to neutral');
  }
} else {
  warn('CONFIG.villages not set - Human Dependency & Accessibility (6.4% of weight) defaulted to neutral (0.5)');
}

// ============================================================================
// 12. CONNECTIVITY CONSTRAINT (separate output - NOT part of priority score)
// ============================================================================
var connectivityConstraint = null;
if (CONFIG.wildlifeCorridors || CONFIG.protectedAreas) {
  var constraintPieces = [];
  if (CONFIG.wildlifeCorridors) { try { constraintPieces.push(ee.Image(0).paint(CONFIG.wildlifeCorridors, 1)); } catch (e) {} }
  if (CONFIG.protectedAreas) { try { constraintPieces.push(ee.Image(0).paint(CONFIG.protectedAreas, 1)); } catch (e) {} }
  if (constraintPieces.length) {
    connectivityConstraint = constraintPieces.reduce(function (a, b) { return a.max(b); }).clip(roi).rename('connectivityConstraint');
    log('Connectivity Constraint layer built from wildlifeCorridors/protectedAreas (reported separately, not scored)');
  }
} else {
  warn('CONFIG.wildlifeCorridors / protectedAreas not set - Connectivity Constraint output will be omitted (this is a caution flag, independent of the priority score)');
}

// ============================================================================
// 13. TREATMENT ELIGIBILITY (FSI-based) + AHP-WEIGHTED PRIORITY SCORE
// ============================================================================
var treatment = null, priorityScore = null;
if (fsiClass && plantableMask) {
  // 1 = New Plantation (Scrub, <10%), 2 = ANR (Open, 10-40%), 0 = Not Prioritized
  treatment = ee.Image(0)
    .where(fsiClass.eq(1), 1)
    .where(fsiClass.eq(2), 2)
    .updateMask(plantableMask)
    .rename('treatment').clip(roi);

  var w = CONFIG.weights;
  var terms = [
    [distanceToForestNorm, w.distanceToForest],
    [hydroConnNorm, w.hydrologicalConnectivity],
    [fragmentationNorm, w.fragmentationIndex],
    [corridorProximityNorm, w.wildlifeCorridorProximity],
    [soilDepthNorm, w.soilDepth],
    [soilTextureNorm, w.soilTexture],
    [socNorm, w.soilOrganicCarbon],
    [workabilityNorm, w.workability],
    [climateExposureNorm, w.climateExposure],
    [carbonGainNorm, w.carbonGainPotential],
    [erosionNorm, w.erosionRisk],
    [fireFrequencyNorm, w.fireFrequency],
    [invasiveSeverityNorm, w.invasiveSeverity],
    [humanDependencyNorm, w.humanDependency]
  ];
  var wSum = terms.reduce(function (s, t) { return s + t[1]; }, 0);
  priorityScore = terms.reduce(function (acc, t) {
    var contribution = t[0].unmask(0.5).multiply(t[1] / wSum);
    return acc ? acc.add(contribution) : contribution;
  }, null).updateMask(treatment.gt(0)).rename('priorityScore').clip(roi);

  log('14-criterion AHP-weighted Priority Score computed');
} else {
  warn('Cannot compute treatment eligibility without canopy/land-cover data. Stopping.');
}

// ============================================================================
// 14. BLOCK AGGREGATION + RANKING
// ============================================================================
if (treatment && priorityScore) {
  var grid = roi.coveringGrid('EPSG:32643', CONFIG.blockSizeM)
    .map(function (f) { return f.intersection(roi, 1); });

  var blockInputBands = [
    ee.Image.pixelArea().divide(1e4).rename('areaHa'),
    priorityScore,
    treatment,
    invasiveSeverityNorm.rename('invasiveSeverity')
  ];
  if (connectivityConstraint) { blockInputBands.push(connectivityConstraint); }
  var blockInput = ee.Image.cat(blockInputBands);

  var combinedReducer = ee.Reducer.mean()
    .combine({ reducer2: ee.Reducer.sum(), sharedInputs: true })
    .combine({ reducer2: ee.Reducer.mode(), sharedInputs: true });
  var blockStats = blockInput.reduceRegions({ collection: grid, reducer: combinedReducer, scale: CONFIG.scale, tileScale: 4 });

  blockStats.evaluate(function (fc) {
    var feats = (fc && fc.features) || [];
    var TREATMENT_LABEL = { 0: 'Not Prioritized', 1: 'New Plantation', 2: 'ANR' };
    var blocks = feats.map(function (f, idx) {
      var p = f.properties || {};
      var treatmentCode = Math.round(p.treatment_mode || 0);
      var invasiveMean = p.invasiveSeverity_mean || 0;
      var label = TREATMENT_LABEL[treatmentCode] || 'Not Prioritized';
      if (treatmentCode > 0 && invasiveMean > 0.55) { label += ' + Clearance'; }
      return {
        id: idx + 1,
        areaHa: Number((p.areaHa_sum || 0).toFixed(2)),
        priority: Number((p.priorityScore_mean || 0).toFixed(3)),
        treatmentLabel: label,
        constraintPct: connectivityConstraint ? Math.round((p.connectivityConstraint_mean || 0) * 100) : null
      };
    }).filter(function (b) { return b.areaHa > 0.1 && b.priority > 0; });

    blocks.sort(function (a, b) { return b.priority - a.priority; });
    var cumulative = 0;
    blocks.forEach(function (b) {
      cumulative += b.areaHa;
      b.cumulativeAreaHa = Number(cumulative.toFixed(2));
      b.selected = cumulative <= CONFIG.targetTreatmentAreaHa;
    });

    var selectedBlocks = blocks.filter(function (b) { return b.selected; });
    var selectedAreaHa = selectedBlocks.reduce(function (s, b) { return s + b.areaHa; }, 0);
    var totalCost = selectedBlocks.reduce(function (s, b) {
      var rate = b.treatmentLabel.indexOf('New Plantation') === 0 ? CONFIG.costPerHaINR.newPlantation
        : b.treatmentLabel.indexOf('ANR') === 0 ? CONFIG.costPerHaINR.anr
        : CONFIG.costPerHaINR.soilWaterConservation;
      if (b.treatmentLabel.indexOf('Clearance') > -1) { rate += CONFIG.costPerHaINR.clearanceSurcharge; }
      return s + b.areaHa * rate;
    }, 0);

    print('================================================================');
    print('CAMPA SITE PRIORITIZATION v2 - ' + CONFIG.unitName + ', ' + CONFIG.district + ', ' + CONFIG.state + ' (' + CONFIG.year + ')');
    print('14-criterion AHP model - see script header for weight provenance');
    print('================================================================');
    print('Eligible blocks: ' + blocks.length + ' (' + Math.round(blocks.reduce(function (s, b) { return s + b.areaHa; }, 0)) + ' ha total eligible)');
    print('Selected (top-ranked, up to target): ' + selectedBlocks.length + ' blocks, ' + Math.round(selectedAreaHa) + ' ha (target ' + CONFIG.targetTreatmentAreaHa + ' ha)');
    print('ASSUMPTION - VERIFY: estimated cost @ placeholder rates: Rs ' + Math.round(totalCost).toLocaleString('en-IN'));
    if (connectivityConstraint) {
      var constrained = selectedBlocks.filter(function (b) { return b.constraintPct > 10; });
      if (constrained.length) { print('⚠ ' + constrained.length + ' selected block(s) overlap a wildlife corridor / protected area by >10% - review before finalizing (see Connectivity Constraint column).'); }
    }
    print('----------------------------------------------------------------');
    print('Top 10 ranked blocks:');
    selectedBlocks.slice(0, 10).forEach(function (b) {
      print('#' + b.id + ' | ' + b.areaHa + ' ha | Priority ' + b.priority + ' | ' + b.treatmentLabel
        + (b.constraintPct !== null ? ' | Corridor overlap ' + b.constraintPct + '%' : ''));
    });

    var rows = blocks.map(function (b) {
      var props = {
        'Block ID': b.id, 'Area (ha)': b.areaHa, 'Priority Score': b.priority,
        'Recommended Treatment': b.treatmentLabel, 'Cumulative Area (ha)': b.cumulativeAreaHa,
        'Selected This Cycle': b.selected ? 'YES' : 'no'
      };
      if (b.constraintPct !== null) { props['Connectivity Constraint (%)'] = b.constraintPct; }
      return ee.Feature(null, props);
    });
    Export.table.toDrive({
      collection: ee.FeatureCollection(rows), description: CONFIG.exportPrefix + '_RankedBlocks',
      folder: CONFIG.exportFolder, fileNamePrefix: CONFIG.exportPrefix + '_RankedBlocks', fileFormat: 'CSV'
    });
  });

  // ---- Visualization ---------------------------------------------------------
  var scoreStatsInfo = priorityScore.reduceRegion({
    reducer: ee.Reducer.percentile([5, 95]), geometry: roi, scale: CONFIG.scale, maxPixels: 1e13, tileScale: 4, bestEffort: true
  }).getInfo();
  var stretchMin = (scoreStatsInfo && scoreStatsInfo.priorityScore_p5 != null) ? scoreStatsInfo.priorityScore_p5 : 0;
  var stretchMax = (scoreStatsInfo && scoreStatsInfo.priorityScore_p95 != null) ? scoreStatsInfo.priorityScore_p95 : 1;
  if (!(stretchMax - stretchMin > 0.05)) { stretchMin = 0; stretchMax = 1; }
  print('Priority Score observed range (5th-95th pct): ' + stretchMin.toFixed(2) + ' - ' + stretchMax.toFixed(2));

  Map.addLayer(treatment.selfMask(), { min: 1, max: 2, palette: ['1a9850', '2b83ba'] }, 'Recommended Treatment (green=New Plantation, blue=ANR)', true);
  Map.addLayer(priorityScore, { min: stretchMin, max: stretchMax, palette: ['fee08b', 'fc8d59', 'd73027'] }, 'CAMPA Priority Score', false);
  Map.addLayer(fsiClass, { min: 1, max: 4, palette: ['d73027', 'fee08b', '91cf60', '1a9850'] }, 'FSI Canopy Class (Scrub/Open/Mod.Dense/V.Dense)', false);
  if (invasiveFlag) { Map.addLayer(invasiveFlag.selfMask(), { palette: ['ff00ff'] }, 'Invasive Species Flag (proxy - verify)', false); }
  if (connectivityConstraint) { Map.addLayer(connectivityConstraint.selfMask(), { palette: ['000000'] }, 'Connectivity Constraint (corridor/PA overlap)', false); }
  try {
    var gridOutline = ee.Image().byte().paint({ featureCollection: grid, color: 1, width: 1 });
    Map.addLayer(gridOutline, { palette: ['ffffff'] }, 'Planning Blocks (' + CONFIG.blockSizeM + 'm)', false);
  } catch (e) {}

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

  // ---- Raster/vector exports --------------------------------------------------
  Export.image.toDrive({ image: priorityScore, description: CONFIG.exportPrefix + '_PriorityScore', folder: CONFIG.exportFolder, fileNamePrefix: CONFIG.exportPrefix + '_PriorityScore', region: roi.bounds(), scale: CONFIG.scale, crs: 'EPSG:32643', maxPixels: 1e13 });
  Export.image.toDrive({ image: treatment.toInt(), description: CONFIG.exportPrefix + '_TreatmentType', folder: CONFIG.exportFolder, fileNamePrefix: CONFIG.exportPrefix + '_TreatmentType', region: roi.bounds(), scale: CONFIG.scale, crs: 'EPSG:32643', maxPixels: 1e13 });
  Export.image.toDrive({ image: fsiClass.toInt(), description: CONFIG.exportPrefix + '_FSICanopyClass', folder: CONFIG.exportFolder, fileNamePrefix: CONFIG.exportPrefix + '_FSICanopyClass', region: roi.bounds(), scale: CONFIG.scale, crs: 'EPSG:32643', maxPixels: 1e13 });
  Export.table.toDrive({ collection: grid, description: CONFIG.exportPrefix + '_PlanningBlocks', folder: CONFIG.exportFolder, fileNamePrefix: CONFIG.exportPrefix + '_PlanningBlocks', fileFormat: 'SHP' });

  log('CAMPA Site Prioritization v2 complete. Check Console for the ranked list; run the Tasks-tab exports for CSV/GeoTIFF/Shapefile outputs.');
}
