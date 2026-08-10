/**
 * ============================================================================
 * SPATIAL RUNOFF COEFFICIENT (C) MODEL — CHECK-DAM UPSTREAM CATCHMENT, INDIA
 * ============================================================================
 *
 * SCOPE: This script computes ONLY the spatial runoff coefficient C.
 * It intentionally does NOT compute peak discharge Q, rainfall intensity,
 * time of concentration, IDF curves, return period, SCS-CN runoff, flood
 * routing, or check-dam hydraulics. Those are separate, later modules.
 *
 * METHODOLOGY (verbatim statement — see docs/METHODOLOGY.md for full text):
 * "The spatial runoff coefficient is derived using an Indian Government/
 * WAPCOS land-cover-soil-texture-slope coefficient framework for terrain up
 * to 30% slope, supplemented by source-based Indian IRC surface-condition
 * coefficients for terrain exceeding 30% slope. Remote-sensing datasets are
 * used to identify and validate land and surface conditions but are not
 * applied as arbitrary numerical multipliers to the runoff coefficient.
 * Soil information is incorporated at its native spatial information scale.
 * The catchment-average runoff coefficient is calculated by area-weighting
 * the source-defined spatial coefficients across the delineated upstream
 * catchment. Each coefficient assignment is accompanied by source,
 * confidence and classification-reason metadata, and unresolved areas are
 * explicitly reported rather than artificially filled."
 *
 * HARD RULES ENFORCED BY THIS SCRIPT:
 *  - No unmask(0) / unmask(constant) / unmask(meanC) anywhere. Unresolved
 *    pixels stay unresolved (C_SOURCE = 999) and are reported, not filled.
 *  - No NDVI/slope multiplicative or additive adjustment of table C values.
 *  - Slope is a BRANCH SELECTOR only (<=30% -> WAPCOS table,
 *    >30% -> IRC surface-condition table), never a direct C source.
 *  - Every pixel gets C_VALUE + C_SOURCE + C_CONFIDENCE + C_REASON.
 *
 * Paste this entire script into the GEE Code Editor (code.earthengine.google.com).
 * Sections are numbered 1-19 to match the required modular architecture.
 * Run section-by-section by watching the printed area-reconciliation checks
 * in the Console; each stage must reconcile to 14.07 ha within raster
 * tolerance before moving to the next.
 * ============================================================================
 */

// ============================================================================
// SECTION 1 — CONFIG
// ============================================================================

var CONFIG = {
  // Analysis grid
  ANALYSIS_SCALE_M: 30,
  EXPECTED_AREA_HA: 14.07,
  AREA_TOLERANCE_HA: 0.05, // raster/edge tolerance for reconciliation checks

  // Slope branch selector
  STEEP_SLOPE_THRESHOLD_PCT: 30,
  SLOPE_BAND_1_MAX: 5,   // 0-5%
  SLOPE_BAND_2_MAX: 10,  // 6-10%
  SLOPE_BAND_3_MAX: 30,  // 11-30%

  // Soil texture thresholds (topsoil weight-fraction %, OpenLandMap)
  CLAY_THRESHOLD_PCT: 35, // >= this -> Clayey
  SAND_THRESHOLD_PCT: 70, // >= this (and not clayey) -> Sandy
  // else -> Loamy

  // Vegetation-density thresholds for the IRC surface-condition branch
  NDVI_DENSE: 0.35,   // >= dense vegetation cover
  NDVI_LIGHT: 0.15,   // 0.15-0.35 light/moderate cover; < 0.15 candidate bare

  // Dynamic World probability thresholds
  DW_BUILT_THRESHOLD: 0.50,
  DW_BARE_THRESHOLD: 0.50,

  // Bare-surface rock-vs-soil disambiguation (LOW confidence proxy only)
  BSI_ROCK_THRESHOLD: 0.30,        // Sentinel-2 Bare Soil Index
  RUGGEDNESS_ROCK_THRESHOLD_M: 3,  // elevation stdDev in 3x3 (~90m) window
  TPI_PLATEAU_ABS_THRESHOLD_M: 2,  // |TPI| <= this -> locally flat (plateau)

  // Composite date window (multi-year, cloud-masked median for stability)
  S2_START: '2019-01-01',
  S2_END: '2024-12-31',
  DW_START: '2019-01-01',
  DW_END: '2024-12-31',
  S2_CLOUD_PROB_MAX: 40
};

// C_SOURCE codes (Section 19 of spec)
var SRC = {
  WAPCOS: 101,
  IRC_STEEP_BARE_ROCK: 201,
  IRC_STEEP_ROCK_VEG: 202,
  IRC_PLATEAU_LIGHT: 203,
  IRC_BARE_STIFF_CLAY: 204,
  IRC_STIFF_CLAY_VEG: 205,
  IRC_LOAM_LIGHT: 206,
  IRC_LOAM_TURF: 207,
  IRC_SANDY_LIGHT: 208,
  IRC_SANDY_WOODLAND: 209,
  IRC_IMPERVIOUS: 210,
  FIELD_OVERRIDE: 301,
  UNRESOLVED: 999
};

// C_REASON codes (unresolved-only; 0 = not applicable / resolved)
var REASON = {
  NONE: 0,
  MISSING_LANDCOVER: 1,
  MISSING_SOIL: 2,
  MISSING_SLOPE: 3,
  STEEP_SURFACE_AMBIGUOUS: 4,
  ROCK_BARE_AMBIGUITY: 5,
  WATER_WETLAND: 6,
  OTHER_LANDCOVER_CLASS: 7,
  INSUFFICIENT_EVIDENCE: 8,
  PROJECTION_MASK_ISSUE: 9
};

// C_CONFIDENCE codes
var CONF = { HIGH: 1, MODERATE: 2, LOW: 3, UNRESOLVED: 4 };

// IRC surface-condition C lookup table (Section 6)
var IRC_C_TABLE = {};
IRC_C_TABLE[SRC.IRC_STEEP_BARE_ROCK] = 0.90;
IRC_C_TABLE[SRC.IRC_STEEP_ROCK_VEG] = 0.80;
IRC_C_TABLE[SRC.IRC_PLATEAU_LIGHT] = 0.70;
IRC_C_TABLE[SRC.IRC_BARE_STIFF_CLAY] = 0.60;
IRC_C_TABLE[SRC.IRC_STIFF_CLAY_VEG] = 0.50;
IRC_C_TABLE[SRC.IRC_LOAM_LIGHT] = 0.40;
IRC_C_TABLE[SRC.IRC_LOAM_TURF] = 0.30;
IRC_C_TABLE[SRC.IRC_SANDY_LIGHT] = 0.20;
IRC_C_TABLE[SRC.IRC_SANDY_WOODLAND] = 0.10;
IRC_C_TABLE[SRC.IRC_IMPERVIOUS] = 0.90;

print('SECTION 1 — CONFIG loaded.', CONFIG);

// ============================================================================
// SECTION 2 — STUDY AREA
// ============================================================================

var catchmentFC = ee.FeatureCollection(
  'projects/raygadh-range/assets/catchmentarea'
);
var catchment = catchmentFC.geometry();

var catchmentAreaHa = catchment.area(1).divide(10000);
print('SECTION 2 — Catchment area (ha), computed from asset geometry:', catchmentAreaHa);
print('SECTION 2 — Expected catchment area (ha):', CONFIG.EXPECTED_AREA_HA);

Map.centerObject(catchment, 15);
Map.addLayer(catchment, { color: 'red' }, '01. Catchment boundary', true);

// ============================================================================
// SECTION 3 — DATASETS
// ============================================================================

// 3a. ESA WorldCover v200 (10 m, primary wall-to-wall land-cover backbone)
var worldCover = ee.ImageCollection('ESA/WorldCover/v200').first().clip(catchment);

// 3b. Sentinel-2 SR harmonized (10-20 m) — cloud-masked multi-year median
function maskS2clouds(img) {
  var scl = img.select('SCL');
  // 3=cloud shadow, 8/9=cloud medium/high prob, 10=cirrus, 11=snow
  var mask = scl.neq(3).and(scl.neq(8)).and(scl.neq(9))
    .and(scl.neq(10)).and(scl.neq(11));
  return img.updateMask(mask);
}

// .median() on an ImageCollection strips the per-pixel "default projection"
// metadata (collapses to ungridded WGS84), which reduceResolution() later
// requires. Recover it explicitly from a native Sentinel-2 band (10 m).
var s2Proj = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
  .filterBounds(catchment).limit(1).first().select('B4').projection();

var s2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
  .filterBounds(catchment)
  .filterDate(CONFIG.S2_START, CONFIG.S2_END)
  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', CONFIG.S2_CLOUD_PROB_MAX))
  .map(maskS2clouds)
  .median()
  .setDefaultProjection(s2Proj)
  .clip(catchment);

var ndvi = s2.normalizedDifference(['B8', 'B4']).rename('NDVI');
var evi = s2.expression(
  '2.5 * ((NIR - RED) / (NIR + 6*RED - 7.5*BLUE + 1))', {
    NIR: s2.select('B8'), RED: s2.select('B4'), BLUE: s2.select('B2')
  }).rename('EVI');
// Bare Soil Index (BSI) — standard formulation
var bsi = s2.expression(
  '((SWIR1 + RED) - (NIR + BLUE)) / ((SWIR1 + RED) + (NIR + BLUE))', {
    SWIR1: s2.select('B11'), RED: s2.select('B4'),
    NIR: s2.select('B8'), BLUE: s2.select('B2')
  }).rename('BSI');

// 3c. Dynamic World V1 — mean class-probability composite
// Same projection-loss issue as s2 above (.mean() strips the default
// projection); recover it from a native Dynamic World band (10 m).
var dwProj = ee.ImageCollection('GOOGLE/DYNAMICWORLD/V1')
  .filterBounds(catchment).limit(1).first().select('built').projection();

var dw = ee.ImageCollection('GOOGLE/DYNAMICWORLD/V1')
  .filterBounds(catchment)
  .filterDate(CONFIG.DW_START, CONFIG.DW_END)
  .select(['water', 'trees', 'grass', 'flooded_vegetation', 'crops',
    'shrub_and_scrub', 'built', 'bare', 'snow_and_ice'])
  .mean()
  .setDefaultProjection(dwProj)
  .clip(catchment);

// 3d. DEM — SRTM 30 m (matches the 30-m analysis grid)
var dem = ee.Image('USGS/SRTMGL1_003').clip(catchment.buffer(90));
var slopePct = ee.Terrain.slope(dem).multiply(Math.PI / 180).tan().multiply(100)
  .rename('SLOPE_PCT');
var elevStdDev = dem.reduceNeighborhood({
  reducer: ee.Reducer.stdDev(),
  kernel: ee.Kernel.square(1) // 3x3 -> ~90 m at 30 m grid
}).rename('RUGGEDNESS_M');
var focalMeanElev = dem.reduceNeighborhood({
  reducer: ee.Reducer.mean(),
  kernel: ee.Kernel.circle(3) // ~90 m radius
});
var tpi = dem.subtract(focalMeanElev).rename('TPI_M');

// 3e. OpenLandMap soil — sand & clay weight-fraction (native ~250 m)
var sandImg = ee.Image('OpenLandMap/SOL/SOL_SAND-WFRACTION_USDA-3A1A1A_M/v02')
  .select(['b0', 'b10']).reduce(ee.Reducer.mean()).rename('SAND_PCT').clip(catchment.buffer(300));
var clayImg = ee.Image('OpenLandMap/SOL/SOL_CLAY-WFRACTION_USDA-3A1A1A_M/v02')
  .select(['b0', 'b10']).reduce(ee.Reducer.mean()).rename('CLAY_PCT').clip(catchment.buffer(300));

print('SECTION 3 — Datasets loaded: ESA WorldCover v200 (10m), Sentinel-2 SR ' +
  '(10-20m, cloud-masked multi-year median), Dynamic World V1 (10m probabilities), ' +
  'SRTM 30m DEM, OpenLandMap sand/clay (~250m native).');

// ============================================================================
// SECTION 4 — LAND COVER (resampled honestly from 10 m to the 30 m grid)
// ============================================================================
// WorldCover is finer than the 30-m analysis grid, so we aggregate by MAJORITY
// (mode) within each 30-m cell rather than nearest-neighbor subsampling —
// this preserves information content instead of discarding it.

var worldCover30 = worldCover
  .reduceResolution({ reducer: ee.Reducer.mode(), maxPixels: 1024 })
  .reproject({ crs: dem.projection().atScale(CONFIG.ANALYSIS_SCALE_M) });

// WorldCover codes: 10 Tree cover, 20 Shrubland, 30 Grassland, 40 Cropland,
// 50 Built-up, 60 Bare/sparse veg, 70 Snow/ice, 80 Permanent water,
// 90 Herbaceous wetland, 95 Mangroves, 100 Moss/lichen.
var LC = { FOREST: 1, GRASSLAND: 2, AGRICULTURE: 3, BARE: 4, BUILTUP: 5,
  WATER: 6, WETLAND: 7, OTHER: 8 };

var landCoverClass = ee.Image(0)
  .where(worldCover30.eq(10), LC.FOREST)
  .where(worldCover30.eq(20), LC.GRASSLAND) // shrubland -> grassland/pasture bin (documented assumption)
  .where(worldCover30.eq(30), LC.GRASSLAND)
  .where(worldCover30.eq(40), LC.AGRICULTURE)
  .where(worldCover30.eq(50), LC.BUILTUP)
  .where(worldCover30.eq(60), LC.BARE)
  .where(worldCover30.eq(70), LC.OTHER)   // snow/ice — not expected in this catchment
  .where(worldCover30.eq(80), LC.WATER)
  .where(worldCover30.eq(90), LC.WETLAND)
  .where(worldCover30.eq(95), LC.OTHER)   // mangroves — not covered by source tables
  .where(worldCover30.eq(100), LC.OTHER)  // moss/lichen — not covered by source tables
  .updateMask(worldCover30.mask())
  .rename('LC_CLASS')
  .clip(catchment);

var lcAreaTable = ee.Image.pixelArea().divide(10000).addBands(landCoverClass)
  .reduceRegion({
    reducer: ee.Reducer.sum().group({ groupField: 1, groupName: 'LC_CLASS' }),
    geometry: catchment, scale: CONFIG.ANALYSIS_SCALE_M, maxPixels: 1e9
  });
print('SECTION 4 — Land-cover class area (ha) [1=Forest,2=Grassland,3=Agriculture,' +
  '4=Bare,5=Built-up,6=Water,7=Wetland,8=Other]:', lcAreaTable);

Map.addLayer(landCoverClass.selfMask(),
  { min: 1, max: 8, palette: ['1a7a3a', '9acd32', 'e8b84b', 'c2a878', 'ff0000', '2b6ea8', '5fd0d0', '888888'] },
  '02. Land cover class', false);

// ============================================================================
// SECTION 5 — SOIL (native ~250 m; propagated, not upsampled in information content)
// ============================================================================

var SOIL = { SANDY: 1, LOAMY: 2, CLAYEY: 3 };

var soilClass = ee.Image(SOIL.LOAMY) // default middle texture, overwritten below
  .where(clayImg.gte(CONFIG.CLAY_THRESHOLD_PCT), SOIL.CLAYEY)
  .where(clayImg.lt(CONFIG.CLAY_THRESHOLD_PCT).and(sandImg.gte(CONFIG.SAND_THRESHOLD_PCT)), SOIL.SANDY)
  .updateMask(sandImg.mask().and(clayImg.mask()))
  .rename('SOIL_CLASS')
  .clip(catchment);

// HSG PROXY — diagnostic only, texture-derived screening, NOT confirmed HSG.
var hsgProxy = ee.Image(0)
  .where(soilClass.eq(SOIL.SANDY), 1)   // proxy "A/B"
  .where(soilClass.eq(SOIL.LOAMY), 2)   // proxy "B/C"
  .where(soilClass.eq(SOIL.CLAYEY), 3)  // proxy "C/D"
  .updateMask(soilClass.mask())
  .rename('HSG_PROXY_CLASS');

var soilAreaTable = ee.Image.pixelArea().divide(10000).addBands(soilClass)
  .reduceRegion({
    reducer: ee.Reducer.sum().group({ groupField: 1, groupName: 'SOIL_CLASS' }),
    geometry: catchment, scale: CONFIG.ANALYSIS_SCALE_M, maxPixels: 1e9
  });
print('SECTION 5 — Soil class area (ha) [1=Sandy,2=Loamy,3=Clayey] — ' +
  'evidence at ~250 m native resolution, integrated onto 30 m grid:', soilAreaTable);

Map.addLayer(soilClass.selfMask(),
  { min: 1, max: 3, palette: ['e8d48a', 'b5895a', '6b4226'] }, '03. Soil texture class', false);

// ============================================================================
// SECTION 6 — DEM / SLOPE (branch selector only)
// ============================================================================

var SLOPEBAND = { B1_0_5: 1, B2_6_10: 2, B3_11_30: 3, STEEP: 4 };

var slopeBand = ee.Image(0)
  .where(slopePct.lte(CONFIG.SLOPE_BAND_1_MAX), SLOPEBAND.B1_0_5)
  .where(slopePct.gt(CONFIG.SLOPE_BAND_1_MAX).and(slopePct.lte(CONFIG.SLOPE_BAND_2_MAX)), SLOPEBAND.B2_6_10)
  .where(slopePct.gt(CONFIG.SLOPE_BAND_2_MAX).and(slopePct.lte(CONFIG.SLOPE_BAND_3_MAX)), SLOPEBAND.B3_11_30)
  .where(slopePct.gt(CONFIG.STEEP_SLOPE_THRESHOLD_PCT), SLOPEBAND.STEEP)
  .updateMask(slopePct.mask())
  .rename('SLOPE_BAND')
  .reproject({ crs: dem.projection().atScale(CONFIG.ANALYSIS_SCALE_M) })
  .clip(catchment);

var isSteep = slopeBand.eq(SLOPEBAND.STEEP);

var slopeAreaTable = ee.Image.pixelArea().divide(10000).addBands(slopeBand)
  .reduceRegion({
    reducer: ee.Reducer.sum().group({ groupField: 1, groupName: 'SLOPE_BAND' }),
    geometry: catchment, scale: CONFIG.ANALYSIS_SCALE_M, maxPixels: 1e9
  });
print('SECTION 6 — Slope band area (ha) [1=0-5%,2=6-10%,3=11-30%,4=>30%]:', slopeAreaTable);

Map.addLayer(slopeBand.selfMask(),
  { min: 1, max: 4, palette: ['2ecc71', 'f1c40f', 'e67e22', 'c0392b'] }, '04. Slope band', false);

// ============================================================================
// SECTION 7 — SURFACE CONDITION (evidence-based classification for the
// IRC branch; also used to route Bare/Built-up/Water land cover at ANY
// slope, since the WAPCOS table has no bare/impervious/water entries)
// ============================================================================

var ndvi30 = ndvi.reduceResolution({ reducer: ee.Reducer.mean(), maxPixels: 1024 })
  .reproject({ crs: dem.projection().atScale(CONFIG.ANALYSIS_SCALE_M) });
var bsi30 = bsi.reduceResolution({ reducer: ee.Reducer.mean(), maxPixels: 1024 })
  .reproject({ crs: dem.projection().atScale(CONFIG.ANALYSIS_SCALE_M) });
var dwBuilt30 = dw.select('built').reduceResolution({ reducer: ee.Reducer.mean(), maxPixels: 1024 })
  .reproject({ crs: dem.projection().atScale(CONFIG.ANALYSIS_SCALE_M) });
var dwBare30 = dw.select('bare').reduceResolution({ reducer: ee.Reducer.mean(), maxPixels: 1024 })
  .reproject({ crs: dem.projection().atScale(CONFIG.ANALYSIS_SCALE_M) });

var ruggedness30 = elevStdDev.reproject({ crs: dem.projection().atScale(CONFIG.ANALYSIS_SCALE_M) });
var tpi30 = tpi.reproject({ crs: dem.projection().atScale(CONFIG.ANALYSIS_SCALE_M) });

var isBuiltUp = landCoverClass.eq(LC.BUILTUP).or(dwBuilt30.gte(CONFIG.DW_BUILT_THRESHOLD));
var isWaterWetland = landCoverClass.eq(LC.WATER).or(landCoverClass.eq(LC.WETLAND));
var isBareCandidate = ndvi30.lt(CONFIG.NDVI_LIGHT).and(dwBare30.gte(CONFIG.DW_BARE_THRESHOLD));
var isDenseVeg = ndvi30.gte(CONFIG.NDVI_DENSE);
var isLightVeg = ndvi30.gte(CONFIG.NDVI_LIGHT).and(ndvi30.lt(CONFIG.NDVI_DENSE));

var rockSignature = bsi30.gte(CONFIG.BSI_ROCK_THRESHOLD)
  .and(ruggedness30.gte(CONFIG.RUGGEDNESS_ROCK_THRESHOLD_M));
var plateauSignature = tpi30.abs().lte(CONFIG.TPI_PLATEAU_ABS_THRESHOLD_M);

// SURFACE_CONDITION categorical codes mirror SRC.IRC_* for direct traceability.
// (0 = unclassified/unresolved, real values are the IRC_* codes from SRC.)
var surfaceCondition = ee.Image(0).rename('SURFACE_COND'); // 0 = unclassified/unresolved
var surfConfidence = ee.Image(CONF.UNRESOLVED).rename('SURF_CONF');
var surfReason = ee.Image(REASON.INSUFFICIENT_EVIDENCE).rename('SURF_REASON');

function setSurf(img, confImg, reasonImg, mask, code, conf, reason) {
  return [
    img.where(mask, code),
    confImg.where(mask, conf),
    reasonImg.where(mask, reason)
  ];
}

// 1. Built-up -> impervious (HIGH confidence, any slope)
var r1 = setSurf(surfaceCondition, surfConfidence, surfReason, isBuiltUp,
  SRC.IRC_IMPERVIOUS, CONF.HIGH, REASON.NONE);
surfaceCondition = r1[0]; surfConfidence = r1[1]; surfReason = r1[2];

// 2. Water / wetland -> explicitly unresolved for C, reason = water/wetland
var r2 = setSurf(surfaceCondition, surfConfidence, surfReason,
  isWaterWetland.and(isBuiltUp.not()),
  SRC.UNRESOLVED, CONF.UNRESOLVED, REASON.WATER_WETLAND);
surfaceCondition = r2[0]; surfConfidence = r2[1]; surfReason = r2[2];

var otherLC = landCoverClass.eq(LC.OTHER).and(isBuiltUp.not()).and(isWaterWetland.not());
var r2b = setSurf(surfaceCondition, surfConfidence, surfReason, otherLC,
  SRC.UNRESOLVED, CONF.UNRESOLVED, REASON.OTHER_LANDCOVER_CLASS);
surfaceCondition = r2b[0]; surfConfidence = r2b[1]; surfReason = r2b[2];

var routedMask = isBuiltUp.or(isWaterWetland).or(otherLC);

// 3. Bare candidate pixels: disambiguate clay-bare vs rock-vs-soil ambiguity
var bareClay = isBareCandidate.and(soilClass.eq(SOIL.CLAYEY)).and(routedMask.not());
var r3 = setSurf(surfaceCondition, surfConfidence, surfReason, bareClay,
  SRC.IRC_BARE_STIFF_CLAY, CONF.MODERATE, REASON.NONE);
surfaceCondition = r3[0]; surfConfidence = r3[1]; surfReason = r3[2];

var bareRockLike = isBareCandidate.and(soilClass.eq(SOIL.CLAYEY).not())
  .and(rockSignature).and(routedMask.not());
var r4 = setSurf(surfaceCondition, surfConfidence, surfReason, bareRockLike,
  SRC.IRC_STEEP_BARE_ROCK, CONF.LOW, REASON.NONE);
surfaceCondition = r4[0]; surfConfidence = r4[1]; surfReason = r4[2];

var bareAmbiguous = isBareCandidate.and(soilClass.eq(SOIL.CLAYEY).not())
  .and(rockSignature.not()).and(routedMask.not());
var r5 = setSurf(surfaceCondition, surfConfidence, surfReason, bareAmbiguous,
  SRC.UNRESOLVED, CONF.UNRESOLVED, REASON.ROCK_BARE_AMBIGUITY);
surfaceCondition = r5[0]; surfConfidence = r5[1]; surfReason = r5[2];

var bareHandled = bareClay.or(bareRockLike).or(bareAmbiguous);

// 4. Vegetated pixels (dense or light) -> soil-texture grid, with
//    plateau / steep-rock-with-vegetation overrides from terrain evidence.
var vegMask = (isDenseVeg.or(isLightVeg)).and(routedMask.not()).and(bareHandled.not());

var steepRockVeg = vegMask.and(isSteep).and(rockSignature);
var r6 = setSurf(surfaceCondition, surfConfidence, surfReason, steepRockVeg,
  SRC.IRC_STEEP_ROCK_VEG, CONF.LOW, REASON.NONE);
surfaceCondition = r6[0]; surfConfidence = r6[1]; surfReason = r6[2];

var plateauLight = vegMask.and(isSteep).and(rockSignature.not())
  .and(plateauSignature).and(isLightVeg);
var r7 = setSurf(surfaceCondition, surfConfidence, surfReason, plateauLight,
  SRC.IRC_PLATEAU_LIGHT, CONF.LOW, REASON.NONE);
surfaceCondition = r7[0]; surfConfidence = r7[1]; surfReason = r7[2];

var specialHandled = steepRockVeg.or(plateauLight);
var generalVeg = vegMask.and(specialHandled.not());

// Dense vegetation x soil texture
var denseSandy = generalVeg.and(isDenseVeg).and(soilClass.eq(SOIL.SANDY));
var r8 = setSurf(surfaceCondition, surfConfidence, surfReason, denseSandy,
  SRC.IRC_SANDY_WOODLAND, CONF.MODERATE, REASON.NONE);
surfaceCondition = r8[0]; surfConfidence = r8[1]; surfReason = r8[2];

var denseLoamy = generalVeg.and(isDenseVeg).and(soilClass.eq(SOIL.LOAMY));
var r9 = setSurf(surfaceCondition, surfConfidence, surfReason, denseLoamy,
  SRC.IRC_LOAM_TURF, CONF.MODERATE, REASON.NONE);
surfaceCondition = r9[0]; surfConfidence = r9[1]; surfReason = r9[2];

var denseClayey = generalVeg.and(isDenseVeg).and(soilClass.eq(SOIL.CLAYEY));
var r10 = setSurf(surfaceCondition, surfConfidence, surfReason, denseClayey,
  SRC.IRC_STIFF_CLAY_VEG, CONF.MODERATE, REASON.NONE);
surfaceCondition = r10[0]; surfConfidence = r10[1]; surfReason = r10[2];

// Light/moderate vegetation x soil texture
var lightSandy = generalVeg.and(isLightVeg).and(soilClass.eq(SOIL.SANDY));
var r11 = setSurf(surfaceCondition, surfConfidence, surfReason, lightSandy,
  SRC.IRC_SANDY_LIGHT, CONF.MODERATE, REASON.NONE);
surfaceCondition = r11[0]; surfConfidence = r11[1]; surfReason = r11[2];

var lightLoamy = generalVeg.and(isLightVeg).and(soilClass.eq(SOIL.LOAMY));
var r12 = setSurf(surfaceCondition, surfConfidence, surfReason, lightLoamy,
  SRC.IRC_LOAM_LIGHT, CONF.MODERATE, REASON.NONE);
surfaceCondition = r12[0]; surfConfidence = r12[1]; surfReason = r12[2];

var lightClayey = generalVeg.and(isLightVeg).and(soilClass.eq(SOIL.CLAYEY));
var r13 = setSurf(surfaceCondition, surfConfidence, surfReason, lightClayey,
  SRC.IRC_STIFF_CLAY_VEG, CONF.MODERATE, REASON.NONE);
surfaceCondition = r13[0]; surfConfidence = r13[1]; surfReason = r13[2];

// 5. Anything still unclassified within a valid-input pixel -> insufficient evidence
var stillUnclassified = surfaceCondition.eq(0)
  .and(landCoverClass.mask()).and(soilClass.mask()).and(ndvi30.mask());
var r14 = setSurf(surfaceCondition, surfConfidence, surfReason, stillUnclassified,
  SRC.UNRESOLVED, CONF.UNRESOLVED, REASON.INSUFFICIENT_EVIDENCE);
surfaceCondition = r14[0]; surfConfidence = r14[1]; surfReason = r14[2];

surfaceCondition = surfaceCondition.rename('SURFACE_COND').updateMask(landCoverClass.mask()).clip(catchment);
surfConfidence = surfConfidence.rename('SURF_CONF').updateMask(landCoverClass.mask()).clip(catchment);
surfReason = surfReason.rename('SURF_REASON').updateMask(landCoverClass.mask()).clip(catchment);

print('SECTION 7 — Surface-condition classification built (IRC-category codes; ' +
  '0/999 = unresolved with explicit reason).');

// ============================================================================
// SECTION 8 — PRIMARY WAPCOS C (slope <= 30%, Forest/Grassland/Agriculture only)
// ============================================================================

// 27-entry LUT index = (lcCode-1)*9 + (soilCode-1)*3 + (slopeBandCode-1)
// lcCode: 1=Forest,2=Grassland,3=Agriculture (WAPCOS-eligible only)
// soilCode: 1=Sandy,2=Loamy,3=Clayey ; slopeBandCode: 1,2,3 for 0-5/6-10/11-30
var WAPCOS_LUT = [
  0.10, 0.25, 0.30,  // Forest, Sandy
  0.30, 0.35, 0.50,  // Forest, Loamy
  0.40, 0.50, 0.60,  // Forest, Clayey
  0.10, 0.16, 0.22,  // Grassland, Sandy
  0.30, 0.36, 0.42,  // Grassland, Loamy
  0.40, 0.55, 0.60,  // Grassland, Clayey
  0.30, 0.40, 0.52,  // Agriculture, Sandy
  0.50, 0.60, 0.72,  // Agriculture, Loamy
  0.60, 0.70, 0.72   // Agriculture, Clayey
];

var wapcosEligibleLC = landCoverClass.eq(LC.FOREST)
  .or(landCoverClass.eq(LC.GRASSLAND)).or(landCoverClass.eq(LC.AGRICULTURE));
var wapcosEligible = wapcosEligibleLC.and(isSteep.not())
  .and(slopeBand.gte(SLOPEBAND.B1_0_5)).and(slopeBand.lte(SLOPEBAND.B3_11_30));

var wapcosIndex = landCoverClass.subtract(1).multiply(9)
  .add(soilClass.subtract(1).multiply(3))
  .add(slopeBand.subtract(1))
  .toInt();

// Select the matching LUT value per pixel via a where()-chain lookup.
var wapcosC = ee.Image.constant(0).toFloat();
for (var i = 0; i < WAPCOS_LUT.length; i++) {
  wapcosC = wapcosC.where(wapcosIndex.eq(i), WAPCOS_LUT[i]);
}
wapcosC = wapcosC.updateMask(wapcosEligible).rename('C_WAPCOS');

print('SECTION 8 — WAPCOS-branch C assigned to Forest/Grassland/Agriculture pixels ' +
  'with slope <= 30% and known soil texture.');

// ============================================================================
// SECTION 9 — >30% SLOPE (and Bare/Built-up/Water at ANY slope) — IRC C
// ============================================================================

var ircC = ee.Image.constant(0).toFloat();
Object.keys(IRC_C_TABLE).forEach(function (code) {
  ircC = ircC.where(surfaceCondition.eq(parseInt(code, 10)), IRC_C_TABLE[code]);
});
// IRC branch applies wherever surface-condition resolved to a real IRC code
// (i.e., NOT 0/999): this covers >30% slope pixels AND bare/built pixels at
// any slope, since WAPCOS has no bare/impervious entries.
var ircResolvedMask = surfaceCondition.neq(0).and(surfaceCondition.neq(SRC.UNRESOLVED));
ircC = ircC.updateMask(ircResolvedMask).rename('C_IRC');

print('SECTION 9 — IRC-branch C assigned wherever surface condition resolved ' +
  '(slope > 30%, or bare/built-up land cover at any slope).');

// ============================================================================
// SECTION 10 — C PROVENANCE (merge WAPCOS + IRC + unresolved into final bands)
// ============================================================================

// Start fully unresolved; overwrite with WAPCOS where eligible, then IRC
// where resolved. WAPCOS and IRC domains are mutually exclusive by
// construction (WAPCOS = vegetated/agri <=30%, IRC = steep OR bare/built/water).
var C_VALUE = ee.Image.constant(0).toFloat();
var C_SOURCE = ee.Image.constant(SRC.UNRESOLVED).toInt();
var C_CONFIDENCE = ee.Image.constant(CONF.UNRESOLVED).toInt();
var C_REASON = ee.Image.constant(REASON.INSUFFICIENT_EVIDENCE).toInt();

// Base reason before any classification: distinguish missing land cover / soil / slope
C_REASON = C_REASON.where(landCoverClass.mask().not(), REASON.MISSING_LANDCOVER);
C_REASON = C_REASON.where(landCoverClass.mask().and(soilClass.mask().not()), REASON.MISSING_SOIL);
C_REASON = C_REASON.where(landCoverClass.mask().and(soilClass.mask())
  .and(slopeBand.mask().not()), REASON.MISSING_SLOPE);

// WAPCOS assignment
C_VALUE = C_VALUE.where(wapcosEligible, wapcosC.unmask(0));
C_SOURCE = C_SOURCE.where(wapcosEligible, SRC.WAPCOS);
C_CONFIDENCE = C_CONFIDENCE.where(wapcosEligible, CONF.HIGH);
C_REASON = C_REASON.where(wapcosEligible, REASON.NONE);

// IRC assignment (uses surfConfidence/surfReason computed in Section 7)
C_VALUE = C_VALUE.where(ircResolvedMask, ircC.unmask(0));
C_SOURCE = C_SOURCE.where(ircResolvedMask, surfaceCondition);
C_CONFIDENCE = C_CONFIDENCE.where(ircResolvedMask, surfConfidence);
C_REASON = C_REASON.where(ircResolvedMask, REASON.NONE);

// Explicit unresolved reasons carried over from surface-condition analysis
// (water/wetland, rock/bare ambiguity, other land cover, insufficient evidence)
var explicitUnresolved = surfaceCondition.eq(SRC.UNRESOLVED);
C_SOURCE = C_SOURCE.where(explicitUnresolved, SRC.UNRESOLVED);
C_CONFIDENCE = C_CONFIDENCE.where(explicitUnresolved, CONF.UNRESOLVED);
C_REASON = C_REASON.where(explicitUnresolved, surfReason);

// >30% slope pixels where surface condition is genuinely ambiguous and NOT
// already covered by ircResolvedMask / explicitUnresolved above
var steepAmbiguousLeftover = isSteep
  .and(wapcosEligible.not()).and(ircResolvedMask.not()).and(explicitUnresolved.not())
  .and(landCoverClass.mask());
C_SOURCE = C_SOURCE.where(steepAmbiguousLeftover, SRC.UNRESOLVED);
C_CONFIDENCE = C_CONFIDENCE.where(steepAmbiguousLeftover, CONF.UNRESOLVED);
C_REASON = C_REASON.where(steepAmbiguousLeftover, REASON.STEEP_SURFACE_AMBIGUOUS);

// Mask out true no-data (outside all valid inputs) rather than force values
var anyValidInput = landCoverClass.mask();
C_VALUE = C_VALUE.updateMask(anyValidInput).rename('C_VALUE').clip(catchment);
C_SOURCE = C_SOURCE.updateMask(anyValidInput).rename('C_SOURCE').clip(catchment);
C_CONFIDENCE = C_CONFIDENCE.updateMask(anyValidInput).rename('C_CONFIDENCE').clip(catchment);
C_REASON = C_REASON.updateMask(anyValidInput).rename('C_REASON').clip(catchment);

// A pixel is "valid C" only if C_SOURCE != 999 (unresolved). C_VALUE keeps
// full catchment extent (value=0 on unresolved pixels is a placeholder,
// never treated as a real coefficient); all area/statistics below always
// mask explicitly by isValidC rather than relying on C_VALUE's own mask.
var isValidC = C_SOURCE.neq(SRC.UNRESOLVED);

print('SECTION 10 — C provenance bands assembled: C_VALUE, C_SOURCE, C_CONFIDENCE, C_REASON.');

// ============================================================================
// SECTION 11 — C CONFIDENCE (already embedded above; summary print)
// ============================================================================

var confAreaTable = ee.Image.pixelArea().divide(10000).addBands(C_CONFIDENCE)
  .reduceRegion({
    reducer: ee.Reducer.sum().group({ groupField: 1, groupName: 'C_CONFIDENCE' }),
    geometry: catchment, scale: CONFIG.ANALYSIS_SCALE_M, maxPixels: 1e9
  });
print('SECTION 11 — C confidence area (ha) [1=High,2=Moderate,3=Low,4=Unresolved]:', confAreaTable);

// ============================================================================
// SECTION 12 — C REASON (summary print; every unresolved pixel has a code)
// ============================================================================

var reasonAreaTable = ee.Image.pixelArea().divide(10000).addBands(C_REASON)
  .updateMask(isValidC.not())
  .reduceRegion({
    reducer: ee.Reducer.sum().group({ groupField: 1, groupName: 'C_REASON' }),
    geometry: catchment, scale: CONFIG.ANALYSIS_SCALE_M, maxPixels: 1e9
  });
print('SECTION 12 — Unresolved-area breakdown by reason code (ha) ' +
  '[1=Missing LC,2=Missing soil,3=Missing slope,4=Steep ambiguous,' +
  '5=Rock/bare ambiguity,6=Water/wetland,7=Other LC class,8=Insufficient evidence,' +
  '9=Projection/mask issue]:', reasonAreaTable);

// ============================================================================
// SECTION 13 — C COVERAGE QA (area reconciliation + diagnostic vs prior bug)
// ============================================================================

var validAreaHa = ee.Image.pixelArea().divide(10000).updateMask(isValidC)
  .reduceRegion({ reducer: ee.Reducer.sum(), geometry: catchment,
    scale: CONFIG.ANALYSIS_SCALE_M, maxPixels: 1e9 }).values().get(0);
var unresolvedAreaHa = ee.Image.pixelArea().divide(10000).updateMask(isValidC.not())
  .updateMask(anyValidInput)
  .reduceRegion({ reducer: ee.Reducer.sum(), geometry: catchment,
    scale: CONFIG.ANALYSIS_SCALE_M, maxPixels: 1e9 }).values().get(0);
var totalClassifiedHa = ee.Number(validAreaHa).add(ee.Number(unresolvedAreaHa));

print('SECTION 13 — QA: Valid C area (ha):', validAreaHa);
print('SECTION 13 — QA: Unresolved area (ha):', unresolvedAreaHa);
print('SECTION 13 — QA: Valid + Unresolved (ha), should reconcile to ~14.07 ha:', totalClassifiedHa);
print('SECTION 13 — QA: Difference from catchment geometry area (ha):',
  catchmentAreaHa.subtract(totalClassifiedHa));
print('SECTION 13 — DIAGNOSTIC NOTE: the prior model reported 3.25 ha unresolved ' +
  'while only 0.32 ha was explicit >30% surface ambiguity. This script eliminates ' +
  'the undiagnosed gap by explicitly routing Bare/Built-up/Water/Wetland/Other land ' +
  'cover through the IRC branch or an explicit reason code (6,7) at ANY slope, and by ' +
  'tagging missing-input pixels with reasons 1/2/3 — so every unresolved pixel now ' +
  'carries a specific, auditable C_REASON rather than an unexplained gap.');

// ============================================================================
// SECTION 14 — AREA-WEIGHTED C
// ============================================================================

var pixelAreaHa = ee.Image.pixelArea().divide(10000);
var weightedSumImg = C_VALUE.multiply(pixelAreaHa).updateMask(isValidC);
var weightedSumHa = weightedSumImg.reduceRegion({
  reducer: ee.Reducer.sum(), geometry: catchment,
  scale: CONFIG.ANALYSIS_SCALE_M, maxPixels: 1e9
}).values().get(0);

var Cw = ee.Number(weightedSumHa).divide(ee.Number(validAreaHa));

var CminMax = C_VALUE.updateMask(isValidC).reduceRegion({
  reducer: ee.Reducer.minMax(), geometry: catchment,
  scale: CONFIG.ANALYSIS_SCALE_M, maxPixels: 1e9
});

print('SECTION 14 — AREA-WEIGHTED CATCHMENT C (Cw):', Cw);
print('SECTION 14 — C min / max (valid pixels only):', CminMax);

// Source-specific mean contributions (diagnostic only — not independent Cs)
var wapcosAreaHa = ee.Image.pixelArea().divide(10000).updateMask(C_SOURCE.eq(SRC.WAPCOS))
  .reduceRegion({ reducer: ee.Reducer.sum(), geometry: catchment,
    scale: CONFIG.ANALYSIS_SCALE_M, maxPixels: 1e9 }).values().get(0);
var wapcosWeightedHa = C_VALUE.multiply(pixelAreaHa).updateMask(C_SOURCE.eq(SRC.WAPCOS))
  .reduceRegion({ reducer: ee.Reducer.sum(), geometry: catchment,
    scale: CONFIG.ANALYSIS_SCALE_M, maxPixels: 1e9 }).values().get(0);
var C_WAPCOS_mean = ee.Number(wapcosWeightedHa).divide(ee.Number(wapcosAreaHa));

var ircAreaHa = ee.Image.pixelArea().divide(10000).updateMask(C_SOURCE.gte(201).and(C_SOURCE.lte(210)))
  .reduceRegion({ reducer: ee.Reducer.sum(), geometry: catchment,
    scale: CONFIG.ANALYSIS_SCALE_M, maxPixels: 1e9 }).values().get(0);
var ircWeightedHa = C_VALUE.multiply(pixelAreaHa).updateMask(C_SOURCE.gte(201).and(C_SOURCE.lte(210)))
  .reduceRegion({ reducer: ee.Reducer.sum(), geometry: catchment,
    scale: CONFIG.ANALYSIS_SCALE_M, maxPixels: 1e9 }).values().get(0);
var C_IRC_mean = ee.Number(ircWeightedHa).divide(ee.Number(ircAreaHa));

print('SECTION 14 — Mean C within WAPCOS-sourced area (diagnostic only):', C_WAPCOS_mean);
print('SECTION 14 — Mean C within IRC-sourced area (diagnostic only):', C_IRC_mean);

// ============================================================================
// SECTION 15 — SENSITIVITY (source-category based, not arbitrary +-10%)
// ============================================================================
// Only LOW-confidence / ambiguity-flagged pixels are perturbed, and only to
// neighboring table-defined categories that are physically plausible given
// the same evidence — never to invented values.

// Conservative (higher-runoff) scenario: resolve rock/bare ambiguity (reason 5)
// to the higher-C bound "Steep bare rock" (0.90), and resolve LOW-confidence
// vegetated/plateau proxies to their next-higher IRC category.
var C_conservative = C_VALUE;
C_conservative = C_conservative.where(C_REASON.eq(REASON.ROCK_BARE_AMBIGUITY), IRC_C_TABLE[SRC.IRC_STEEP_BARE_ROCK]);
C_conservative = C_conservative.where(
  C_SOURCE.eq(SRC.IRC_PLATEAU_LIGHT).and(C_CONFIDENCE.eq(CONF.LOW)),
  IRC_C_TABLE[SRC.IRC_STEEP_ROCK_VEG]);
C_conservative = C_conservative.where(
  C_SOURCE.eq(SRC.IRC_STEEP_ROCK_VEG).and(C_CONFIDENCE.eq(CONF.LOW)),
  IRC_C_TABLE[SRC.IRC_STEEP_BARE_ROCK]);
var isValidC_conservative = isValidC.or(C_REASON.eq(REASON.ROCK_BARE_AMBIGUITY));

// Lower-runoff scenario: resolve rock/bare ambiguity to the lower-C bound
// available for bare/sparse conditions "Sandy soil with light growth" (0.20),
// and resolve LOW-confidence proxies to their next-lower IRC category.
var C_lower = C_VALUE;
C_lower = C_lower.where(C_REASON.eq(REASON.ROCK_BARE_AMBIGUITY), IRC_C_TABLE[SRC.IRC_SANDY_LIGHT]);
C_lower = C_lower.where(
  C_SOURCE.eq(SRC.IRC_STEEP_ROCK_VEG).and(C_CONFIDENCE.eq(CONF.LOW)),
  IRC_C_TABLE[SRC.IRC_PLATEAU_LIGHT]);
var isValidC_lower = isValidC_conservative;

function weightedC(cImg, validMask) {
  var wsum = cImg.multiply(pixelAreaHa).updateMask(validMask).reduceRegion({
    reducer: ee.Reducer.sum(), geometry: catchment,
    scale: CONFIG.ANALYSIS_SCALE_M, maxPixels: 1e9 }).values().get(0);
  var a = ee.Image.pixelArea().divide(10000).updateMask(validMask).reduceRegion({
    reducer: ee.Reducer.sum(), geometry: catchment,
    scale: CONFIG.ANALYSIS_SCALE_M, maxPixels: 1e9 }).values().get(0);
  return ee.Number(wsum).divide(ee.Number(a));
}

print('SECTION 15 — Scenario A (Primary) Cw:', Cw);
print('SECTION 15 — Scenario B (Conservative, higher-runoff bound for ambiguous pixels) Cw:',
  weightedC(C_conservative, isValidC_conservative));
print('SECTION 15 — Scenario C (Lower-runoff bound for ambiguous pixels) Cw:',
  weightedC(C_lower, isValidC_lower));

// ============================================================================
// SECTION 16 — FIELD VALIDATION MODULE (manual override, opt-in only)
// ============================================================================
// Field values NEVER auto-overwrite remote-sensing-derived C. They are only
// applied where the user explicitly draws a geometry and submits a value via
// the UI panel in Section 18. C_SOURCE = 301 (field/expert override).

var fieldOverrides = ee.FeatureCollection([]); // grows via UI in Section 18

// ============================================================================
// SECTION 17 — MAPS
// ============================================================================

var cPalette = ['ffffcc', 'ffeda0', 'fed976', 'feb24c', 'fd8d3c', 'fc4e2a',
  'e31a1c', 'bd0026', '800026', '4d0011'];
Map.addLayer(C_VALUE.updateMask(isValidC),
  { min: 0.1, max: 0.9, palette: cPalette }, '05. C value (valid pixels)', true);

// Legend order (for reference): 101, 201, 202, 203, 204, 205, 206, 207, 208,
// 209, 210, 301, 999 — a linear 101-999 palette stretch is a coarse
// quick-look only; for a precise discrete legend, remap C_SOURCE codes to
// sequential indices 0..12 before display.
var sourcePalette = {
  colors: ['1a9850', 'a50026', 'd73027', 'f46d43', 'fdae61', 'fee08b',
    'd9ef8b', 'a6d96a', '66bd63', '1a9850', '4575b4', '9e0142', '888888']
};
Map.addLayer(C_SOURCE,
  { min: 101, max: 999, palette: sourcePalette.colors }, '06. C source', false);

Map.addLayer(C_CONFIDENCE,
  { min: 1, max: 4, palette: ['2166ac', '92c5de', 'f4a582', 'b2182b'] }, '07. C confidence', false);

Map.addLayer(surfaceCondition,
  { min: 0, max: 999, palette: sourcePalette.colors }, '08. Surface condition', false);

Map.addLayer(C_REASON.updateMask(isValidC.not()),
  { min: 1, max: 9, palette: ['e41a1c', '377eb8', '4daf4a', '984ea3', 'ff7f00',
    'ffff33', 'a65628', 'f781bf', '999999'] }, '09. Unresolved reason (diagnostic)', false);

// EVI is provided as supplementary analyst-review evidence only (Section 9
// of the spec lists it as recommended evidence); it is NOT used anywhere in
// the C decision logic above, to avoid double-counting vegetation signal
// already carried by NDVI.
Map.addLayer(evi.reduceResolution({ reducer: ee.Reducer.mean(), maxPixels: 1024 })
  .reproject({ crs: dem.projection().atScale(CONFIG.ANALYSIS_SCALE_M) }),
  { min: 0, max: 1, palette: ['ffffff', '006400'] }, '10. EVI (supplementary evidence)', false);

// ============================================================================
// SECTION 18 — UI (results panel + field-validation override tool)
// ============================================================================

var panel = ui.Panel({ style: { width: '360px', position: 'top-right' } });
panel.add(ui.Label('Runoff Coefficient (C) — Results', { fontWeight: 'bold', fontSize: '16px' }));
panel.add(ui.Label('Catchment: 14.07 ha (upstream of proposed check dam)'));

var resultsLabel = ui.Label('Computing...');
panel.add(resultsLabel);
Cw.evaluate(function (cw) {
  validAreaHa && ee.Number(validAreaHa).evaluate(function (va) {
    ee.Number(unresolvedAreaHa).evaluate(function (ua) {
      resultsLabel.setValue(
        'Weighted C = ' + (cw !== null ? cw.toFixed(3) : 'N/A') +
        '\nValid C area = ' + (va !== null ? va.toFixed(2) : 'N/A') + ' ha' +
        '\nUnresolved area = ' + (ua !== null ? ua.toFixed(2) : 'N/A') + ' ha'
      );
    });
  });
});

panel.add(ui.Label('— Field Validation Override —', { fontWeight: 'bold' }));
panel.add(ui.Label('Draw a geometry with the drawing tools, then fill in below.'));

var fieldLC = ui.Textbox({ placeholder: 'Field land cover' });
var fieldSurface = ui.Textbox({ placeholder: 'Field surface condition' });
var fieldSoil = ui.Textbox({ placeholder: 'Field soil texture' });
var fieldDepth = ui.Textbox({ placeholder: 'Field soil depth (cm)' });
var fieldInfil = ui.Textbox({ placeholder: 'Field infiltration rate (mm/hr)' });
var fieldHSG = ui.Textbox({ placeholder: 'Field HSG (A/B/C/D)' });
var fieldC = ui.Textbox({ placeholder: 'Expert-selected C (0-1)' });
[fieldLC, fieldSurface, fieldSoil, fieldDepth, fieldInfil, fieldHSG, fieldC].forEach(function (w) {
  panel.add(w);
});

var overrideStatus = ui.Label('');
var applyBtn = ui.Button({
  label: 'Apply override to drawn geometry',
  onClick: function () {
    var drawn = Map.drawingTools().layers().length() > 0 ?
      Map.drawingTools().layers().get(0) : null;
    if (!drawn) {
      overrideStatus.setValue('Draw a geometry first.');
      return;
    }
    var cVal = parseFloat(fieldC.getValue());
    if (isNaN(cVal) || cVal < 0 || cVal > 1) {
      overrideStatus.setValue('Enter a valid expert C between 0 and 1.');
      return;
    }
    var geom = ee.FeatureCollection(drawn.getEeObject());
    var overrideImg = ee.Image().paint(geom, 1).rename('mask');
    var mask = overrideImg.mask();
    C_VALUE = C_VALUE.where(mask, cVal);
    C_SOURCE = C_SOURCE.where(mask, SRC.FIELD_OVERRIDE);
    C_CONFIDENCE = C_CONFIDENCE.where(mask, CONF.HIGH);
    C_REASON = C_REASON.where(mask, REASON.NONE);

    // Audit-trail record of this override (Section 16 field-validation module)
    var overrideFeature = geom.map(function (f) {
      return f.set({
        field_land_cover: fieldLC.getValue(),
        field_surface_condition: fieldSurface.getValue(),
        field_soil_texture: fieldSoil.getValue(),
        field_soil_depth_cm: fieldDepth.getValue(),
        field_infiltration_mmhr: fieldInfil.getValue(),
        field_hsg: fieldHSG.getValue(),
        expert_C: cVal,
        c_source: SRC.FIELD_OVERRIDE
      });
    });
    fieldOverrides = fieldOverrides.merge(overrideFeature);
    Map.layers().set(0, ui.Map.Layer(
      C_VALUE.updateMask(C_SOURCE.neq(SRC.UNRESOLVED)),
      { min: 0.1, max: 0.9, palette: cPalette }, '05. C value (valid pixels, incl. overrides)'));
    overrideStatus.setValue('Override applied: C=' + cVal + ' (source=301, field override). ' +
      'Note: catchment-wide Cw in this panel is not auto-recomputed; re-run Section 14 to refresh.');
  }
});
panel.add(applyBtn);
panel.add(overrideStatus);

panel.add(ui.Label('— Quality Control —', { fontWeight: 'bold' }));
var qcLabel = ui.Label('Evaluating coverage...');
panel.add(qcLabel);
ee.Number(validAreaHa).divide(catchmentAreaHa).multiply(100).evaluate(function (covPct) {
  var flag = covPct >= 95 ? 'GREEN' : (covPct >= 90 ? 'AMBER' : 'RED');
  qcLabel.setValue('Valid C coverage = ' + covPct.toFixed(1) + '% -> QC FLAG: ' + flag +
    '\n(GREEN/AMBER/RED reflects coverage + traceability, NOT numerical accuracy.)');
});

Map.add(panel);

print('SECTION 18 — UI panel added (top-right): results, field-validation override, QC flag.');

// ============================================================================
// SECTION 19 — EXPORT
// ============================================================================

var exportImage = C_VALUE.rename('C_VALUE')
  .addBands(C_SOURCE.rename('C_SOURCE'))
  .addBands(C_CONFIDENCE.rename('C_CONFIDENCE'))
  .addBands(C_REASON.rename('C_REASON'))
  .addBands(surfaceCondition.rename('SURFACE_COND'))
  .addBands(landCoverClass.rename('LC_CLASS'))
  .addBands(soilClass.rename('SOIL_CLASS'))
  .addBands(slopeBand.rename('SLOPE_BAND'));

Export.image.toDrive({
  image: exportImage,
  description: 'Runoff_C_Model_Bands_30m',
  folder: 'runoff_C_model',
  region: catchment,
  scale: CONFIG.ANALYSIS_SCALE_M,
  crs: 'EPSG:32643', // adjust UTM zone to the catchment's actual zone if different
  maxPixels: 1e9
});

// Area-accounting summary table export (Section 22)
var areaSummaryFeatures = ee.FeatureCollection([
  ee.Feature(null, { category: 'Valid_C_ha', value: validAreaHa }),
  ee.Feature(null, { category: 'Unresolved_ha', value: unresolvedAreaHa }),
  ee.Feature(null, { category: 'Total_ha', value: totalClassifiedHa }),
  ee.Feature(null, { category: 'Catchment_asset_area_ha', value: catchmentAreaHa }),
  ee.Feature(null, { category: 'Weighted_C_primary', value: Cw }),
  ee.Feature(null, { category: 'Weighted_C_conservative', value: weightedC(C_conservative, isValidC_conservative) }),
  ee.Feature(null, { category: 'Weighted_C_lower', value: weightedC(C_lower, isValidC_lower) })
]);

Export.table.toDrive({
  collection: areaSummaryFeatures,
  description: 'Runoff_C_Model_Summary_Table',
  folder: 'runoff_C_model',
  fileFormat: 'CSV'
});

// Field/expert override audit trail (Section 16) — empty unless overrides
// were applied via the UI panel in this session before running exports.
Export.table.toDrive({
  collection: fieldOverrides,
  description: 'Runoff_C_Model_Field_Overrides',
  folder: 'runoff_C_model',
  fileFormat: 'CSV'
});

print('SECTION 19 — Export tasks created (Tasks tab): multi-band 30 m GeoTIFF ' +
  '(C_VALUE/C_SOURCE/C_CONFIDENCE/C_REASON/SURFACE_COND/LC_CLASS/SOIL_CLASS/SLOPE_BAND) ' +
  'and a CSV summary table. Run them from the Tasks tab in the Code Editor.');

print('============================================================================');
print('C-ONLY MODEL COMPLETE. Review Console output above for area reconciliation ' +
  'at every stage (Sections 4,5,6,13,14,15) before trusting the final Cw.');
print('============================================================================');
