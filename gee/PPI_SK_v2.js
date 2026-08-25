/**
 * PLANTATION PRIORITY INDEX — SABARKANTHA PROFILE (PPI-SK v2)
 * Google Earth Engine implementation of PPISK_v2_GEE_Specification.md
 *
 * Study area asset : projects/raygadh-range/assets/BEAT
 * Working CRS       : EPSG:32643 (WGS 1984 / UTM 43N)
 * Decision unit     : 10 ha grid block (316.2278 m square)
 *
 * This script implements spec Sections 1-8 and 11 (Module 1: the
 * deterministic score, constraint mask, aggregation, classification and
 * exports). Section 9 (Monte Carlo rank stability, OAT sensitivity) and the
 * collinearity screening in Section 10 are run on the exported block table
 * in Python — see gee/monte_carlo_sensitivity.py — exactly as the spec's own
 * Section 9.2 "Implementation note" recommends (500 full-resolution GEE
 * reruns exceed compute limits; the reduced block table does not).
 *
 * Paste into the GEE Code Editor (code.earthengine.google.com) and run.
 * Check the CONFIG block below before the first run.
 */

// ============================================================================
// 0. CONFIG — VALUES THAT MUST BE VERIFIED BEFORE THE FIRST FULL RUN
// ============================================================================

// [VERIFY] Run this script once with RUN_SCHEMA_CHECK_ONLY = true, read the
// "Property names" line in the Console, then set BEAT_ID_FIELD below to the
// real beat-name/ID field on the BEAT asset (Section 2.1).
var RUN_SCHEMA_CHECK_ONLY = false;
// Confirmed against the live asset schema (Aug 2026 run): properties are
// FolderPa_1, FolderPath, Shape_Le_1, Join_Count, TARGET_FID, SymbolID_1,
// Name, OID_, Shape_Leng, PopupInfo_, Shape_Area, Name_1, system:index,
// SymbolID. No field is literally named "beat" — 'Name' is used as the beat
// identifier since it's the primary attribute field (Name_1 looks like a
// second field carried over from an ArcGIS table join). If block_id/beat_id
// values in the export don't look like beat names, try 'Name_1' instead.
var BEAT_ID_FIELD = 'Name';

var CRS = 'EPSG:32643';
var BLOCK_SIDE = 316.2278; // metres -> 10.0 ha
var MODEL_VERSION = 'PPI-SK_v2.0';
var RUN_DATE_OBJ = ee.Date(Date.now());
var RUN_DATE = RUN_DATE_OBJ.format('YYYY-MM-dd');

// Export destination
var DRIVE_FOLDER = 'PPI_SK_v2';

// Percentile-clamp scale for building normalisation percentiles (Sec 6.1).
// A single moderate scale keeps ~15 reduceRegion calls tractable; the true
// per-parameter native scale is still used in the block-aggregation pass.
var PCT_SCALE = 100;

// ============================================================================
// 1. STUDY AREA
// ============================================================================

var BEAT = ee.FeatureCollection('projects/raygadh-range/assets/BEAT');

print('--- Section 2.1: asset schema check ---');
print('Beat count:', BEAT.size());
print('Schema (first feature):', BEAT.first());
print('Property names:', BEAT.first().propertyNames());
print('Total area (ha):', BEAT.geometry().area(1).divide(10000));

if (RUN_SCHEMA_CHECK_ONLY) {
  throw new Error('RUN_SCHEMA_CHECK_ONLY is true — read the Console output above, ' +
    'set BEAT_ID_FIELD, then set RUN_SCHEMA_CHECK_ONLY = false and re-run.');
}

// ============================================================================
// 2. AOI & GRID CONSTRUCTION (Section 2.2-2.5)
// ============================================================================

var AOI = BEAT.geometry().dissolve(1);
var AOI_BOUNDS = AOI.bounds();

var grid = AOI.coveringGrid(ee.Projection(CRS).atScale(BLOCK_SIDE));

var gridFiltered = grid.map(function (f) {
  var inter = f.geometry().intersection(AOI, 1);
  var areaHa = inter.area(1).divide(10000);
  return f.set({
    block_area_ha: areaHa,
    geom_full_ha: f.geometry().area(1).divide(10000)
  });
}).filter(ee.Filter.gt('block_area_ha', 2.0)); // Section 2.3 edge-block rule [DO NOT ALTER]

// Block ID (Section 2.4) — stable, centroid-derived, not system:index
gridFiltered = gridFiltered.map(function (f) {
  var c = f.geometry().centroid(1).coordinates();
  var lon = ee.Number(c.get(0)).multiply(10000).round().format('%d');
  var lat = ee.Number(c.get(1)).multiply(10000).round().format('%d');
  return f.set('block_id', ee.String('BLK_').cat(lat).cat('_').cat(lon));
});

// Beat attribution (Section 2.5) — true majority-overlap join, not first-match
var joined = ee.Join.saveAll({ matchesKey: 'matches' }).apply({
  primary: gridFiltered,
  secondary: BEAT,
  condition: ee.Filter.intersects({ leftField: '.geo', rightField: '.geo' })
});

var gridWithBeat = ee.FeatureCollection(joined).map(function (f) {
  f = ee.Feature(f);
  var blockGeom = f.geometry();
  var matches = ee.List(f.get('matches'));
  var withArea = ee.FeatureCollection(matches).map(function (m) {
    m = ee.Feature(m);
    var inter = blockGeom.intersection(m.geometry(), 1).area(1);
    return m.set('overlap_area', inter);
  });
  var hasMatch = matches.size().gt(0);
  var best = ee.Feature(ee.Algorithms.If(
    hasMatch,
    withArea.sort('overlap_area', false).first(),
    ee.Feature(null, {})
  ));
  var beatId = ee.Algorithms.If(hasMatch, best.get(BEAT_ID_FIELD), 'UNASSIGNED');
  return f.set('beat_id', beatId).set('matches', null);
});

// ============================================================================
// 3. TERRAIN BASE LAYERS — DEM, SLOPE, ASPECT, CURVATURE, TPI, ROUGHNESS
// ============================================================================

// Both FABDEM and GLO-30 are tiled ImageCollections in the catalog, not a
// single Image — mosaic them and lock in a real projection before use so
// downstream reduceNeighborhood (focal) calls, which have no crs/scale
// argument of their own, run against a well-defined EPSG:32643 grid
// (Section 0 rule 1: all analysis in EPSG:32643) [DO NOT ALTER].
function loadTiledDEM(assetId, band) {
  var col = ee.ImageCollection(assetId).filterBounds(AOI_BOUNDS);
  return col.mosaic().select(band)
    .reproject(CRS, null, 30)
    .rename('DEM').clip(AOI_BOUNDS);
}

var DEM_SOURCE = 'FABDEM';
var dem;
try {
  dem = loadTiledDEM('projects/sat-io/open-datasets/FABDEM', 'b1');
  dem.getInfo(); // force server-side evaluation so a missing/bad asset throws here, not later
} catch (e) {
  print('FABDEM unavailable — falling back to Copernicus GLO-30 (Section 3.1 fallback rule):', e);
  try {
    dem = loadTiledDEM('COPERNICUS/DEM/GLO30', 'DEM');
    dem.getInfo();
    DEM_SOURCE = 'GLO30';
  } catch (e2) {
    throw new Error('Both FABDEM and GLO-30 failed to load — check asset access/quota: ' + e2);
  }
}
print('DEM source in use:', DEM_SOURCE);

var slopeDeg = ee.Terrain.slope(dem);                       // degrees
var slopeRad = slopeDeg.multiply(Math.PI / 180);
var slopePct = slopeRad.tan().multiply(100).rename('slope_pct');

var aspDeg = ee.Terrain.aspect(dem);
var aspRad = aspDeg.multiply(Math.PI / 180);
var aspSin = aspRad.sin().rename('asp_sin');
var aspCos = aspRad.cos().rename('asp_cos');

// Profile-curvature proxy: focalMean(dem) - dem. Positive => surrounding
// terrain higher than the pixel => concave/valley => should score higher.
var focalMeanKernel30 = ee.Kernel.circle({ radius: 90, units: 'meters' });
var curvatureRaw = dem.reduceNeighborhood({
  reducer: ee.Reducer.mean(),
  kernel: focalMeanKernel30
}).subtract(dem).rename('curvature_raw');

// TPI at 300 m radius (Section 5.2, B1)
var tpi = dem.subtract(
  dem.reduceNeighborhood({
    reducer: ee.Reducer.mean(),
    kernel: ee.Kernel.circle({ radius: 300, units: 'meters' })
  })
).rename('TPI');

// Lithological roughness modifier (Section 5.2, B7)
var roughness = dem.reduceNeighborhood({
  reducer: ee.Reducer.stdDev(),
  kernel: ee.Kernel.square({ radius: 3, units: 'pixels' })
}).rename('roughness');

// ============================================================================
// 4. MERIT HYDRO — TWI & HAND (Section 5.1, A1; Section 5.2, B1)
// ============================================================================

var merit = ee.Image('MERIT/Hydro/v1_0_1').clip(AOI_BOUNDS);
var upaKm2 = merit.select('upa');
var upaM2 = upaKm2.multiply(1e6);
var hnd = merit.select('hnd').rename('HAND');

var tanS = slopeRad.tan().max(0.001); // guard against divide-by-zero on flat ground
var twi = upaM2.divide(90).divide(tanS).log().rename('TWI');

// ============================================================================
// 5. SENTINEL-2 COMPOSITES — NDMI (Apr-May) & NDVI (Sept-Nov, annual + 5yr)
// ============================================================================

function maskS2(img) {
  var cs = img.select('cs_cdf');
  return img.updateMask(cs.gte(0.60))
    .multiply(0.0001)
    .copyProperties(img, ['system:time_start']);
}

var s2Base = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
  .filterBounds(AOI_BOUNDS)
  .linkCollection(ee.ImageCollection('GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED'), ['cs_cdf']);

// A3n: pre-monsoon (Apr 1 - May 31), 5-year median composite 2021-2025 [DO NOT ALTER window]
var s2AprMay = s2Base
  .filterDate('2021-01-01', '2026-01-01')
  .filter(ee.Filter.calendarRange(4, 5, 'month'))
  .map(maskS2);

var ndmi = s2AprMay.map(function (i) {
  return i.normalizedDifference(['B8', 'B11']).rename('NDMI');
}).median().rename('NDMI');

var ndviTrough = s2AprMay.map(function (i) {
  return i.normalizedDifference(['B8', 'B4']).rename('NDVI');
}).median().rename('NDVI_trough'); // D5 dry-season NDVI

// Sept-Nov peak-season NDVI, 5-year median 2021-2025 (D5 amplitude, C7)
var s2SeptNov = s2Base
  .filterDate('2021-01-01', '2026-01-01')
  .filter(ee.Filter.calendarRange(9, 11, 'month'))
  .map(maskS2);

var ndviPeak = s2SeptNov.map(function (i) {
  return i.normalizedDifference(['B8', 'B4']).rename('NDVI');
}).median().rename('NDVI_peak');

var ndviAmplitude = ndviPeak.subtract(ndviTrough).rename('NDVI_amplitude');

// Annual Sept-Nov NDVI series 2018-2025 for Sen's slope trend (D2)
var trendYears = ee.List.sequence(2018, 2025);
var annualNDVI = ee.ImageCollection(trendYears.map(function (y) {
  y = ee.Number(y);
  var yStart = ee.Date.fromYMD(y, 9, 1);
  var yEnd = ee.Date.fromYMD(y, 12, 1);
  var yearCol = s2Base.filterDate(yStart, yEnd).map(maskS2);
  var img = yearCol.map(function (i) {
    return i.normalizedDifference(['B8', 'B4']).rename('NDVI');
  }).median();
  return img.addBands(ee.Image.constant(y).toFloat().rename('year'))
    .select(['year', 'NDVI'])
    .set('year', y);
}));

var sensFit = annualNDVI.select(['year', 'NDVI']).reduce(ee.Reducer.sensSlope());
var ndviTrend = sensFit.select('slope').rename('NDVI_trend');

// General vegetation NDVI reference for constraint C7 (rock-outcrop check)
var ndviGeneral = ndviPeak.rename('NDVI_general');

// ============================================================================
// 6. SOILGRIDS — DEPTH-WEIGHTED 0-30 cm PROPERTIES (Section 3.2)
// ============================================================================

function depthWeight(assetId, prefix, scaleFactor) {
  var img = ee.Image(assetId);
  var v0_5 = img.select(prefix + '_0-5cm_mean');
  var v5_15 = img.select(prefix + '_5-15cm_mean');
  var v15_30 = img.select(prefix + '_15-30cm_mean');
  var weighted = v0_5.multiply(5).add(v5_15.multiply(10)).add(v15_30.multiply(15)).divide(30);
  return weighted.divide(scaleFactor).clip(AOI_BOUNDS);
}

var sandPct = depthWeight('projects/soilgrids-isric/sand_mean', 'sand', 10).rename('sand_pct');
var clayPct = depthWeight('projects/soilgrids-isric/clay_mean', 'clay', 10).rename('clay_pct');
var siltPct = depthWeight('projects/soilgrids-isric/silt_mean', 'silt', 10).rename('silt_pct');
var socVal = depthWeight('projects/soilgrids-isric/soc_mean', 'soc', 10).rename('soc_gkg');
var phVal = depthWeight('projects/soilgrids-isric/phh2o_mean', 'phh2o', 10).rename('ph');
var cecVal = depthWeight('projects/soilgrids-isric/cec_mean', 'cec', 10).rename('cec');
var cfvoVal = depthWeight('projects/soilgrids-isric/cfvo_mean', 'cfvo', 10).rename('cfvo_pct');
var bdodVal = depthWeight('projects/soilgrids-isric/bdod_mean', 'bdod', 100).rename('bdod_gcm3');

// ============================================================================
// 7. RAINFALL & ARIDITY — CHIRPS + MOD16A2GF (Section 5.1, A2/A4)
// ============================================================================

var chirps = ee.ImageCollection('UCSB-CHG/CHIRPS/DAILY').filterBounds(AOI_BOUNDS);
var rainYears = ee.List.sequence(2005, 2024);
var annualRain = ee.ImageCollection(rainYears.map(function (y) {
  y = ee.Number(y);
  return chirps.filter(ee.Filter.calendarRange(y, y, 'year')).sum().set('year', y);
}));
var rainMean = annualRain.mean().rename('rain_mm').clip(AOI_BOUNDS);

var petCol = ee.ImageCollection('MODIS/061/MOD16A2GF').filterBounds(AOI_BOUNDS);
var petYears = ee.List.sequence(2018, 2023); // MOD16A2GF PET climatology window
var annualPET = ee.ImageCollection(petYears.map(function (y) {
  y = ee.Number(y);
  var yCol = petCol.filter(ee.Filter.calendarRange(y, y, 'year'));
  var masked = yCol.map(function (img) {
    var pet = img.select('PET');
    return pet.updateMask(pet.lt(32700)).multiply(0.1);
  });
  return masked.sum().set('year', y);
}));
var petMean = annualPET.mean().rename('pet_mm').clip(AOI_BOUNDS);

var deficit = petMean.subtract(rainMean).rename('deficit_mm'); // A4: PET - P

// ============================================================================
// 8. HANSEN GFC — CANOPY, LOSS, GAIN (Section 4.2; 5.4 D1/D4)
// ============================================================================

var GFC_ASSET = 'UMD/hansen/global_forest_change_2025_v1_13'; // [VERIFY]
var gfc = ee.Image(GFC_ASSET).clip(AOI_BOUNDS);
var tc2000 = gfc.select('treecover2000');
var loss = gfc.select('loss');
var lossyear = gfc.select('lossyear'); // years since 2000 (1 = 2001, ... )
var gain = gfc.select('gain');

var canopyNow = tc2000
  .where(loss.eq(1), 0)
  .where(gain.eq(1).and(tc2000.lt(25)), 25)
  .rename('canopy_pct');

var CURRENT_YEAR = ee.Number(ee.Date(Date.now()).get('year'));
var LOSSYEAR_CUTOFF = CURRENT_YEAR.subtract(10).subtract(2000); // "last 10 years" -> lossyear code
var recentLoss = loss.eq(1).and(lossyear.gte(LOSSYEAR_CUTOFF)).unmask(0).rename('recent_loss');

// ============================================================================
// 9. WORLDCOVER, SURFACE WATER, FIRE, POPULATION, BIOMASS
// ============================================================================

var worldcover = ee.ImageCollection('ESA/WorldCover/v200').first().select('Map').clip(AOI_BOUNDS);
var gsw = ee.Image('JRC/GSW1_4/GlobalSurfaceWater').clip(AOI_BOUNDS);

// E1 fire frequency: distinct burn-years 2015-2025 (Section 5.5) [DO NOT ALTER — inverted]
var fireCol = ee.ImageCollection('MODIS/061/MCD64A1').filterBounds(AOI_BOUNDS);
var fireYearsList = ee.List.sequence(2015, 2025);
var fireYearImgs = fireYearsList.map(function (y) {
  y = ee.Number(y);
  var yCol = fireCol.filter(ee.Filter.calendarRange(y, y, 'year'));
  var burnedThisYear = yCol.select('BurnDate').max().gt(0).unmask(0);
  return burnedThisYear;
});
var fireYearsCount = ee.ImageCollection(fireYearImgs).sum().rename('fire_years');

// GHSL population — most recent epoch that is not a future projection;
// GHS_POP epochs run 1975-2030 in 5-yr steps and .first() on an unfiltered
// sort would otherwise grab the 2030 projected epoch.
var ghslCol = ee.ImageCollection('JRC/GHSL/P2023A/GHS_POP').filterBounds(AOI_BOUNDS);
var ghslPast = ghslCol.filterDate('1975-01-01', RUN_DATE_OBJ);
var ghslPop = ee.Image(ee.Algorithms.If(
  ghslPast.size().gt(0),
  ghslPast.sort('system:time_start', false).first(),
  ghslCol.sort('system:time_start', false).first()
)).select('population_count').unmask(0).clip(AOI_BOUNDS);
var popDensity2km = ghslPop.reduceNeighborhood({
  reducer: ee.Reducer.sum(),
  kernel: ee.Kernel.circle({ radius: 2000, units: 'meters' })
}).rename('pop_2km');

// ESA CCI Above-Ground Biomass — official catalog asset (Section 3.1 fallback rule applies
// only if this is unavailable; the sat-io ImageCollection is the documented fallback)
var AGB_SOURCE = 'ESA_CCI_official';
var agb;
try {
  agb = ee.Image('ESA/CCI/Above_Ground_Biomass/V6_0/2021').select('agb').rename('AGB').clip(AOI_BOUNDS);
  agb.getInfo();
} catch (e) {
  print('Official ESA CCI AGB unavailable — falling back to sat-io mosaic (Section 3.1):', e);
  agb = ee.ImageCollection('projects/sat-io/open-datasets/ESA/ESA_CCI_AGB').mosaic()
    .rename('AGB').clip(AOI_BOUNDS);
  AGB_SOURCE = 'sat-io_mosaic';
}

// Settlement distance for E2 (built-up class 50)
var settlementBinary = worldcover.eq(50).unmask(0).rename('settlement');
var distSettlementPx = settlementBinary
  .reproject(CRS, null, 30)
  .fastDistanceTransform(300, 'pixels', 'squared_euclidean').sqrt();
var distSettlementM = distSettlementPx.multiply(ee.Image.pixelArea().sqrt()).rename('dist_settlement_m');

// ============================================================================
// 10. RUSLE SOIL EROSION (Section 5.5, E4)
// ============================================================================

// R — Indian dryland empirical formula
var rusleR = ee.Image(79).add(rainMean.multiply(0.363)).rename('R');

// K — Williams (1995) EPIC equation, on % units (sand/silt/clay as %, SOC as %)
var sn1 = ee.Image(1).subtract(sandPct.divide(100));
var socPct = socVal.divide(10); // g/kg -> %
var fCsand = ee.Image(0.2).add(
  ee.Image(0.3).multiply(
    sandPct.multiply(-0.0256).multiply(ee.Image(1).subtract(siltPct.divide(100))).exp()
  )
);
var fClSi = siltPct.divide(clayPct.add(siltPct)).pow(0.3);
var fOrgC = ee.Image(1).subtract(
  socPct.multiply(0.25).divide(
    socPct.add(ee.Image(3.72).subtract(socPct.multiply(2.95)).exp())
  )
);
var fHiSand = ee.Image(1).subtract(
  sn1.multiply(0.7).divide(
    sn1.add(ee.Image(-5.51).add(sn1.multiply(22.9)).exp())
  )
);
var rusleK = fCsand.multiply(fClSi).multiply(fOrgC).multiply(fHiSand).rename('K');

// LS — Moore & Burch specific-catchment-area form, reusing the TWI flow-width term
var specificCatchmentArea = upaM2.divide(90);
var rusleLS = specificCatchmentArea.divide(22.13).pow(0.4)
  .multiply(slopeRad.sin().divide(0.0896).pow(1.3)).rename('LS');

// C — Van der Knijff, guarded against NDVI -> 1
var ndviForC = ndviGeneral.clamp(-0.99, 0.99);
var rusleC = ee.Image(-2).multiply(ndviForC).divide(ee.Image(1).subtract(ndviForC)).exp().rename('C');

var rusleP = ee.Image(1.0).rename('P');

var rusleA = rusleR.multiply(rusleK).multiply(rusleLS).multiply(rusleC).multiply(rusleP).rename('A_rusle');
var rusleLogA = rusleA.add(1).log().rename('A_rusle_log'); // log-transform per Section 5.5

// ============================================================================
// 11. HARD CONSTRAINT MASK C1-C7 (Section 4)
// ============================================================================

var c1 = canopyNow.gte(25).unmask(0).rename('C1');
var c2 = gsw.select('occurrence').gte(50).unmask(0).rename('C2');
var streamCore = upaKm2.gte(5).unmask(0);
var c3 = streamCore.reduceNeighborhood({
  reducer: ee.Reducer.max(),
  kernel: ee.Kernel.circle({ radius: 30, units: 'meters' })
}).unmask(0).rename('C3');
var c4 = slopePct.gt(45).unmask(0).rename('C4');
var c5 = worldcover.eq(50).unmask(0).rename('C5');
var c6 = worldcover.eq(40).unmask(0).rename('C6');
var c7 = worldcover.eq(60).and(ndviGeneral.lt(0.10)).unmask(0).rename('C7');

var constraintStack = ee.Image.cat([c1, c2, c3, c4, c5, c6, c7]);
var anyConstraint = c1.or(c2).or(c3).or(c4).or(c5).or(c6).or(c7).rename('constrained_pixel');

// ============================================================================
// 12. PARAMETER NORMALISATION (Section 6)
// ============================================================================

function normLinear(img, geom, scale, invert) {
  // Look up percentile outputs by explicit "<band>_p<N>" key rather than
  // positional Dictionary order, which is not a documented guarantee.
  var bandName = ee.String(img.bandNames().get(0));
  var pct = img.reduceRegion({
    reducer: ee.Reducer.percentile([2, 98]),
    geometry: geom, scale: scale, crs: CRS, maxPixels: 1e13, bestEffort: true, tileScale: 8
  });
  var lo = ee.Number(pct.get(bandName.cat('_p2')));
  var hi = ee.Number(pct.get(bandName.cat('_p98')));
  hi = ee.Number(ee.Algorithms.If(hi.subtract(lo).abs().lt(1e-9), lo.add(1), hi)); // guard equal lo/hi
  var n = img.clamp(lo, hi).subtract(lo).divide(hi.subtract(lo));
  return (invert ? ee.Image(1).subtract(n) : n);
}

function fuzzyTrap(img, a, b, c, d, loVal, hiVal) {
  // a-d may be plain JS numbers or ee.Number (e.g. data-dependent percentiles) —
  // coerce to ee.Number so arithmetic never falls through to raw JS "-" on
  // ee.ComputedObject, which silently produces NaN instead of erroring.
  a = ee.Number(a); b = ee.Number(b); c = ee.Number(c); d = ee.Number(d);
  var rise = img.subtract(a).divide(b.subtract(a)).clamp(0, 1);
  var fall = ee.Image(d).subtract(img).divide(d.subtract(c)).clamp(0, 1);
  var core = rise.min(fall);
  return core.where(img.lt(a), loVal).where(img.gt(d), hiVal);
}

// --- THEME A ---
var A1_norm = normLinear(twi, AOI_BOUNDS, PCT_SCALE, false).rename('A1_norm');
var A2_norm = normLinear(rainMean, AOI_BOUNDS, 5500, false).rename('A2_norm');
var A3n_norm = normLinear(ndmi, AOI_BOUNDS, 20, false).rename('A3n_norm');
var A4_norm = normLinear(deficit, AOI_BOUNDS, 500, true).rename('A4_norm');
// A5 handled after block aggregation (min-distance reducer, then decay formula)

// --- THEME B ---
var slopeNormInv = normLinear(slopePct, AOI_BOUNDS, PCT_SCALE, true);
var curvNorm = normLinear(curvatureRaw, AOI_BOUNDS, PCT_SCALE, false);
var tpiNormInv = normLinear(tpi, AOI_BOUNDS, PCT_SCALE, true);
var handNormInv = normLinear(hnd, AOI_BOUNDS, 90, true);

// B1: weakest input, carried as optimistic/pessimistic pair (Section 5.2)
var B1_optimistic = slopeNormInv.multiply(0.25).add(curvNorm.multiply(0.20))
  .add(tpiNormInv.multiply(0.30)).add(handNormInv.multiply(0.25)).rename('B1_optimistic');
var B1_pessimistic = slopeNormInv.multiply(0.45).add(curvNorm.multiply(0.20))
  .add(tpiNormInv.multiply(0.20)).add(handNormInv.multiply(0.15)).rename('B1_pessimistic');
// Deterministic point-estimate = mean of the two variants; the Monte Carlo
// companion draws B1_optimistic or B1_pessimistic per iteration (Sec 9.2 step 2).
var B1_norm = B1_optimistic.add(B1_pessimistic).divide(2).rename('B1_norm');

// B2: clay trapezoidal optimum + sand penalty [DO NOT ALTER — non-linear]
var B2_core = fuzzyTrap(clayPct, 8, 18, 35, 50, 0.0, 0.2);
var sandPenalty = ee.Image(1).where(sandPct.gt(70), 0.5);
var B2_norm = B2_core.multiply(sandPenalty).rename('B2_norm');

var B3_norm = normLinear(socVal, AOI_BOUNDS, 250, false).rename('B3_norm');

// B4: pH trapezoidal optimum [DO NOT ALTER — non-linear]
var B4_norm = fuzzyTrap(phVal, 5.0, 6.0, 7.5, 8.5, 0.0, 0.1).rename('B4_norm');

var B5_norm = normLinear(cecVal, AOI_BOUNDS, 250, false).rename('B5_norm');
var B6_norm = normLinear(cfvoVal, AOI_BOUNDS, 250, true).rename('B6_norm');
var B7_norm = normLinear(roughness, AOI_BOUNDS, PCT_SCALE, true).rename('B7_norm');

// --- THEME C ---
// C1s: slope optimum, piecewise [DO NOT ALTER — non-linear]
var C1s_norm = ee.Image(0.4)
  .where(slopePct.gte(2).and(slopePct.lt(5)),
    ee.Image(0.4).add(slopePct.subtract(2).divide(3).multiply(0.6)))
  .where(slopePct.gte(5).and(slopePct.lte(20)), 1.0)
  .where(slopePct.gt(20).and(slopePct.lte(35)),
    ee.Image(1.0).subtract(slopePct.subtract(20).divide(15).multiply(0.6)))
  .where(slopePct.gt(35).and(slopePct.lte(45)),
    ee.Image(0.4).subtract(slopePct.subtract(35).divide(10).multiply(0.3)))
  .rename('C1s_norm');

// C2s: aspect, cosine transform — computed per-block after aggregation (circular mean, Sec 7)

// C3s: curvature, concave -> higher (reuse curvNorm from B1)
var C3s_norm = curvNorm.rename('C3s_norm');

// C4s: elevation optimum band, parameterised dynamically from the AOI's own
// 20th/80th percentile elevation distribution (replaces the manual [VERIFY]
// step in Section 5.3 with a computed value).
var elevPct = dem.reduceRegion({
  reducer: ee.Reducer.percentile([2, 20, 80, 98]),
  geometry: AOI_BOUNDS, scale: 30, crs: CRS, maxPixels: 1e13, bestEffort: true, tileScale: 8
});
// Reduce output band names follow "<band>_p<percentile>" (dem is renamed 'DEM'
// at load) — look up explicitly rather than relying on Dictionary key order.
var elevP2 = ee.Number(elevPct.get('DEM_p2'));
var elevP20 = ee.Number(elevPct.get('DEM_p20'));
var elevP80 = ee.Number(elevPct.get('DEM_p80'));
var elevP98 = ee.Number(elevPct.get('DEM_p98'));
var C4s_norm = fuzzyTrap(dem, elevP2, elevP20, elevP80, elevP98, 0.0, 0.0).rename('C4s_norm');

// --- THEME D ---
var D1_norm = ee.Image(25).subtract(canopyNow).divide(25).clamp(0, 1).rename('D1_norm');
var D2_norm = normLinear(ndviTrend, AOI_BOUNDS, 20, true).rename('D2_norm');
var D3_norm = normLinear(agb, AOI_BOUNDS, 100, true).rename('D3_norm');
// D4 handled as fractional area at block aggregation (recentLoss binary)

// D5: Lantana camara proxy — low amplitude AND moderate dry-season NDVI (0.3-0.6)
// [DO NOT ALTER species target]. Combination is an AND (product), not a documented
// spec formula — this is the implementation's interpretation of "combined with".
var ampScore = normLinear(ndviAmplitude, AOI_BOUNDS, 20, true);
var dryBandScore = fuzzyTrap(ndviTrough, 0.20, 0.30, 0.60, 0.70, 0.0, 0.0);
var D5_norm = ampScore.multiply(dryBandScore).rename('D5_norm');

// --- THEME E ---
// E1 handled after block aggregation (mean fire-year count, then inversion formula)
// E2: biotic pressure composite
var distSettleNorm = normLinear(distSettlementM, AOI_BOUNDS, 30, false);
var popNorm = normLinear(popDensity2km, AOI_BOUNDS, 100, false);
var E2_norm = distSettleNorm.multiply(0.6).add(ee.Image(1).subtract(popNorm).multiply(0.4)).rename('E2_norm');
var E4_norm = normLinear(rusleLogA, AOI_BOUNDS, 90, false).rename('E4_norm');

// ============================================================================
// 13. BLOCK AGGREGATION (Section 7 reducer table) [DO NOT ALTER]
// ============================================================================

var fc = gridWithBeat;

// Median group: TWI, slope (raw %, for C1s eval + reporting), curvature, elevation, roughness
var medianStack = ee.Image.cat([
  twi.rename('A1_twi'), slopePct.rename('slope_pct_raw'), curvatureRaw, dem.rename('elev_m'), roughness
]);
fc = medianStack.reduceRegions({ collection: fc, reducer: ee.Reducer.median(), scale: 30, crs: CRS, tileScale: 8 });

// Mean group: most continuous surfaces
var meanStack = ee.Image.cat([
  ndmi.rename('A3n_ndmi'), rainMean.rename('A2_rain'), deficit.rename('A4_deficit'),
  sandPct, clayPct, siltPct, socVal, phVal, cecVal, cfvoVal, bdodVal,
  ndviTrend.rename('D2_trend'), agb.rename('D3_agb'), ndviAmplitude.rename('D5_amp'),
  ndviTrough.rename('D5_dryndvi'), rusleLogA, fireYearsCount, popDensity2km, distSettlementM,
  aspSin, aspCos, hnd, tpi
]);
fc = meanStack.reduceRegions({ collection: fc, reducer: ee.Reducer.mean(), scale: 30, crs: CRS, tileScale: 8 });

// Min-distance group: A5 water proximity — raw distance, decay applied after aggregation
var gswSeasonalBinary = ee.Image(0).where(gsw.select('seasonality').gte(3), 1).rename('gsw_seasonal');
var distWaterPx = gswSeasonalBinary.reproject(CRS, null, 30)
  .fastDistanceTransform(200, 'pixels', 'squared_euclidean').sqrt();
var distWaterM = distWaterPx.multiply(ee.Image.pixelArea().sqrt()).rename('A5_dist_water_m');
fc = distWaterM.reduceRegions({ collection: fc, reducer: ee.Reducer.min(), scale: 30, crs: CRS, tileScale: 8 });

// Fractional-area group: constraints, D1 canopy (report only), D4 loss, E1 base
var fracStack = ee.Image.cat([
  constraintStack, anyConstraint, recentLoss.rename('D4_lossfrac'), canopyNow.rename('D1_canopy_pct')
]);
fc = fracStack.reduceRegions({ collection: fc, reducer: ee.Reducer.mean(), scale: 30, crs: CRS, tileScale: 8 });

// Normalised-parameter group (all pre-normalised 0-1 bands, mean reducer within block)
var normStack = ee.Image.cat([
  A1_norm, A2_norm, A3n_norm, A4_norm,
  B1_optimistic, B1_pessimistic, B1_norm, B2_norm, B3_norm, B4_norm, B5_norm, B6_norm, B7_norm,
  C1s_norm, C3s_norm, C4s_norm,
  D1_norm, D2_norm, D3_norm, D5_norm,
  E2_norm, E4_norm
]);
fc = normStack.reduceRegions({ collection: fc, reducer: ee.Reducer.mean(), scale: 30, crs: CRS, tileScale: 8 });

// ============================================================================
// 14. PER-BLOCK POST-PROCESSING: A5 decay, C2s aspect, E1 inversion, constraints
// ============================================================================

fc = fc.map(function (f) {
  f = ee.Feature(f);

  // A5 — exponential distance decay on the block's minimum distance to water
  var dMin = ee.Number(f.get('A5_dist_water_m'));
  var a5 = dMin.divide(-1500).exp();
  a5 = ee.Number(ee.Algorithms.If(dMin.gt(5000), 0, a5));

  // C2s — circular mean aspect -> cosine transform; flat blocks (median slope < 2%) -> 0.5
  var sMean = ee.Number(f.get('asp_sin'));
  var cMean = ee.Number(f.get('asp_cos'));
  // ee.Number.atan2: a.atan2(b) = atan2(y=b, x=a). Angle from north = atan2(sin, cos),
  // so x-argument must be cMean and y-argument sMean: cMean.atan2(sMean).
  var aspRadMean = cMean.atan2(sMean);
  var aspDegMean = aspRadMean.multiply(180 / Math.PI).add(360).mod(360);
  var cosScore = ee.Number(1).add(
    aspDegMean.subtract(22.5).multiply(Math.PI / 180).cos()
  ).divide(2);
  var slopeMedian = ee.Number(f.get('slope_pct_raw'));
  var c2s = ee.Algorithms.If(slopeMedian.lt(2), 0.5, cosScore);

  // E1 — inverted fire frequency [DO NOT ALTER]
  var fireYears = ee.Number(f.get('fire_years'));
  var e1 = ee.Number(1).subtract(fireYears.divide(10)).clamp(0, 1);

  // Constraint fractional-area aggregation (Section 4.3) [DO NOT ALTER]
  var constrainedFrac = ee.Number(f.get('constrained_pixel'));
  var blockAreaHa = ee.Number(f.get('block_area_ha'));
  var netPlantableHa = blockAreaHa.multiply(ee.Number(1).subtract(constrainedFrac));

  var constraintFlag = ee.Algorithms.If(
    constrainedFrac.gt(0.30), 'excluded',
    ee.Algorithms.If(constrainedFrac.gte(0.10), 'partial', 'none')
  );

  function reasonPart(code, frac) {
    return ee.Algorithms.If(ee.Number(frac).gt(0.01), code, '');
  }
  var reasonList = ee.List([
    reasonPart('C1', f.get('C1')), reasonPart('C2', f.get('C2')), reasonPart('C3', f.get('C3')),
    reasonPart('C4', f.get('C4')), reasonPart('C5', f.get('C5')), reasonPart('C6', f.get('C6')),
    reasonPart('C7', f.get('C7'))
  ]).filter(ee.Filter.neq('item', ''));
  var constraintReason = reasonList.join(',');

  return f.set({
    A5_norm: a5,
    C2s_norm: c2s,
    E1_norm: e1,
    net_plantable_ha: netPlantableHa,
    constrained_frac: constrainedFrac,
    constraint_flag: constraintFlag,
    constraint_reason: constraintReason
  });
});

// ============================================================================
// 15. THEME SCORES & PPI (Section 8) [DO NOT ALTER]
// ============================================================================

fc = fc.map(function (f) {
  f = ee.Feature(f);

  var A_score = ee.Number(f.get('A1_norm')).multiply(9)
    .add(ee.Number(f.get('A2_norm')).multiply(4))
    .add(ee.Number(f.get('A3n_norm')).multiply(7))
    .add(ee.Number(f.get('A4_norm')).multiply(3))
    .add(ee.Number(f.get('A5_norm')).multiply(3))
    .divide(26);

  var B_score = ee.Number(f.get('B1_norm')).multiply(4)
    .add(ee.Number(f.get('B2_norm')).multiply(5))
    .add(ee.Number(f.get('B3_norm')).multiply(4))
    .add(ee.Number(f.get('B4_norm')).multiply(4))
    .add(ee.Number(f.get('B5_norm')).multiply(3))
    .add(ee.Number(f.get('B6_norm')).multiply(2))
    .add(ee.Number(f.get('B7_norm')).multiply(2))
    .divide(24);

  var C_score = ee.Number(f.get('C1s_norm')).multiply(6)
    .add(ee.Number(f.get('C2s_norm')).multiply(4))
    .add(ee.Number(f.get('C3s_norm')).multiply(2))
    .add(ee.Number(f.get('C4s_norm')).multiply(2))
    .divide(14);

  var D_score = ee.Number(f.get('D1_norm')).multiply(6)
    .add(ee.Number(f.get('D2_norm')).multiply(5))
    .add(ee.Number(f.get('D3_norm')).multiply(4))
    .add(ee.Number(f.get('D4_lossfrac')).multiply(4))
    .add(ee.Number(f.get('D5_norm')).multiply(3))
    .divide(22);

  var E_score = ee.Number(f.get('E1_norm')).multiply(6)
    .add(ee.Number(f.get('E2_norm')).multiply(4))
    .add(ee.Number(f.get('E4_norm')).multiply(4))
    .divide(14);

  var CDE = C_score.multiply(14).add(D_score.multiply(22)).add(E_score.multiply(14)).divide(50);

  var Asafe = A_score.max(0.01);
  var Bsafe = B_score.max(0.01);
  var core = Asafe.pow(0.35).multiply(Bsafe.pow(0.30));
  var modifier = ee.Number(0.55).add(CDE.multiply(0.45));
  var ppiRaw = core.multiply(modifier);

  var constrainedOut = ee.Number(f.get('constrained_frac')).gt(0.30);
  var ppiFinal = ee.Algorithms.If(constrainedOut, 0, ppiRaw);

  return f.set({
    A_score: A_score, B_score: B_score, C_score: C_score,
    D_score: D_score, E_score: E_score, CDE: CDE,
    PPI_raw: ppiRaw, PPI_absolute: ppiFinal
  });
});

// ============================================================================
// 16. HYBRID CLASSIFICATION (Section 11.1) [DO NOT ALTER]
// ============================================================================

// Percentile rank via sort + sequential index (O(n)) rather than a per-feature
// indexOf scan over the full sorted list (O(n^2), impractical at range scale).
var n = fc.size();
var sortedFc = fc.sort('PPI_absolute');
var rankIndex = ee.List.sequence(0, n.subtract(1));
var sortedList = sortedFc.toList(n);
var zipped = rankIndex.zip(sortedList);

fc = ee.FeatureCollection(zipped.map(function (pair) {
  pair = ee.List(pair);
  var rank = ee.Number(pair.get(0));
  var f = ee.Feature(pair.get(1));
  var pct = rank.divide(n.subtract(1)).multiply(100);

  var isExcluded = ee.Number(f.get('constrained_frac')).gt(0.30);
  var category = ee.Algorithms.If(isExcluded, 5,
    ee.Algorithms.If(pct.gte(80), 1,
      ee.Algorithms.If(pct.gte(60), 2,
        ee.Algorithms.If(pct.gte(40), 3,
          ee.Algorithms.If(pct.gte(20), 4, 5)))));

  return f.set({
    PPI_percentile: ee.Algorithms.If(isExcluded, 0, pct),
    category: category,
    dem_source: DEM_SOURCE,
    agb_source: AGB_SOURCE,
    gfc_asset: GFC_ASSET,
    model_version: MODEL_VERSION,
    run_date: RUN_DATE
  });
}));

// ============================================================================
// 17. QC PRINTS (Section 10 — checks feasible directly in GEE)
// ============================================================================

print('--- QC ---');
print('FF-02 block count:', fc.size());
print('FF-05 weight sum check: A+B+C+D+E sub-weights =', 26 + 24 + 14 + 22 + 14, '(must be 100)');
print('FF-14 E1 inversion sample (fire_years, E1_norm):',
  fc.limit(5).select(['block_id', 'fire_years', 'E1_norm']));
print('FF-16 net_plantable_ha <= block_area_ha check (min of area - plantable, expect >= 0):',
  fc.map(function (f) {
    return f.set('area_minus_plantable',
      ee.Number(f.get('block_area_ha')).subtract(f.get('net_plantable_ha')));
  }).aggregate_min('area_minus_plantable'));
print('FF-17 category distribution:', fc.aggregate_histogram('category'));
print('FF-18 PPI_absolute range (min, max):',
  fc.aggregate_min('PPI_absolute'), fc.aggregate_max('PPI_absolute'));
print('FF-22 DEM source:', DEM_SOURCE, '| AGB source:', AGB_SOURCE);

// ============================================================================
// 18. RASTER PRODUCTS — block-level attributes burned back onto the grid
// (built once here, reused by both the Map display in Section 19 and the
// Drive exports in Section 20)
// ============================================================================

var burnProps = ['PPI_absolute', 'category', 'A_score', 'B_score', 'C_score', 'D_score', 'E_score'];
var blockRaster = fc.reduceToImage({ properties: ['PPI_absolute'], reducer: ee.Reducer.first() })
  .rename('PPI_absolute');
var catRaster = fc.reduceToImage({ properties: ['category'], reducer: ee.Reducer.first() }).rename('category');
var themeStack = ee.Image.cat(burnProps.slice(2).map(function (p) {
  return fc.reduceToImage({ properties: [p], reducer: ee.Reducer.first() }).rename(p);
}));

// ============================================================================
// 19. MAP DISPLAY — layers + legends in the Code Editor's Map panel
// ============================================================================

var CATEGORY_PALETTE = ['d73027', 'fc8d59', 'fee08b', 'd9ef8b', '1a9850']; // Section 11.3
var CATEGORY_LABELS = [
  '1 — Highest priority (immediate plantation)',
  '2 — High priority',
  '3 — Moderate priority (phased implementation)',
  '4 — Low priority (ANR / soil & moisture works first)',
  '5 — Protection only (excluded or bottom percentile)'
];
var PPI_PALETTE = ['440154', '414487', '2a788e', '22a884', '7ad151', 'fde725']; // viridis, low -> high

Map.setOptions('HYBRID');
Map.centerObject(AOI);

Map.addLayer(catRaster.clip(AOI), { min: 1, max: 5, palette: CATEGORY_PALETTE },
  'PPI priority category (1-5)', true);
Map.addLayer(blockRaster.clip(AOI), { min: 0, max: 1, palette: PPI_PALETTE },
  'PPI score, continuous (0-1)', false);
Map.addLayer(anyConstraint.selfMask().clip(AOI), { palette: ['e31a1c'] },
  'Constraint mask (C1-C7 pixels)', false);
Map.addLayer(themeStack.select('A_score').clip(AOI), { min: 0, max: 1, palette: ['f7fbff', '08306b'] },
  'Theme A score - moisture', false);
Map.addLayer(themeStack.select('B_score').clip(AOI), { min: 0, max: 1, palette: ['ffffe5', '662506'] },
  'Theme B score - soil', false);
Map.addLayer(gridWithBeat.style({ color: '969696', fillColor: '00000000', width: 1 }),
  {}, '10 ha grid blocks', false);
Map.addLayer(BEAT.style({ color: 'ffffff', fillColor: '00000000', width: 2 }),
  {}, 'Beat boundaries', true);

// Generic swatch-legend builder: one titled panel, one row per palette entry.
function addLegend(position, title, palette, labels) {
  var panel = ui.Panel({
    style: { position: position, padding: '8px 12px', backgroundColor: 'rgba(255, 255, 255, 0.88)' }
  });
  panel.add(ui.Label(title, { fontWeight: 'bold', fontSize: '13px', margin: '0 0 6px 0' }));
  for (var i = 0; i < palette.length; i++) {
    var swatch = ui.Label('', {
      backgroundColor: '#' + palette[i], padding: '8px', margin: '0 6px 4px 0'
    });
    var label = ui.Label(labels[i], { margin: '0 0 4px 0', fontSize: '12px' });
    panel.add(ui.Panel([swatch, label], ui.Panel.Layout.flow('horizontal')));
  }
  Map.add(panel);
  return panel;
}

addLegend('bottom-left', 'PPI-SK v2 — Plantation Priority Category', CATEGORY_PALETTE, CATEGORY_LABELS);

var ppiLegendLabels = PPI_PALETTE.map(function (_, i) {
  return (i / (PPI_PALETTE.length - 1)).toFixed(2);
});
addLegend('bottom-right', 'PPI score (continuous, low → high)', PPI_PALETTE, ppiLegendLabels);

// ============================================================================
// 20. EXPORTS (Section 11.3)
// ============================================================================

var OUTPUT_FIELDS = [
  'block_id', 'beat_id', 'block_area_ha', 'net_plantable_ha', 'constrained_frac',
  'constraint_flag', 'constraint_reason',
  'A1_twi', 'A2_rain', 'A3n_ndmi', 'A4_deficit', 'A5_dist_water_m',
  'A1_norm', 'A2_norm', 'A3n_norm', 'A4_norm', 'A5_norm',
  'B1_optimistic', 'B1_pessimistic', 'B1_norm', 'B2_norm', 'B3_norm', 'B4_norm',
  'B5_norm', 'B6_norm', 'B7_norm',
  'C1s_norm', 'C2s_norm', 'C3s_norm', 'C4s_norm',
  'D1_canopy_pct', 'D1_norm', 'D2_trend', 'D2_norm', 'D3_agb', 'D3_norm',
  'D4_lossfrac', 'D5_amp', 'D5_dryndvi', 'D5_norm',
  'fire_years', 'E1_norm', 'E2_norm', 'A_rusle_log', 'E4_norm',
  'A_score', 'B_score', 'C_score', 'D_score', 'E_score', 'CDE',
  'PPI_absolute', 'PPI_percentile', 'category',
  'dist_settlement_m', 'dem_source', 'agb_source', 'gfc_asset', 'model_version', 'run_date'
];

// 1. Block attribute table
Export.table.toDrive({
  collection: fc.select(OUTPUT_FIELDS),
  description: 'PPI_SK_v2_block_table',
  folder: DRIVE_FOLDER,
  fileFormat: 'CSV'
});

// 2. Block polygons
Export.table.toDrive({
  collection: fc.select(OUTPUT_FIELDS.concat(['.geo'])),
  description: 'PPI_SK_v2_block_polygons',
  folder: DRIVE_FOLDER,
  fileFormat: 'SHP'
});
Export.table.toDrive({
  collection: fc.select(OUTPUT_FIELDS.concat(['.geo'])),
  description: 'PPI_SK_v2_block_polygons_geojson',
  folder: DRIVE_FOLDER,
  fileFormat: 'GeoJSON'
});

// 3-7. Rasterised products (built in Section 18, also used for the Map display
// in Section 19). Category raster exported as raw values (1-5), not RGB-
// visualized, so it stays usable for analysis (area-by-category, joins) in
// GIS — apply CATEGORY_PALETTE from Section 19 when symbolising in QGIS/GEE.
Export.image.toDrive({
  image: blockRaster,
  description: 'PPI_SK_v2_PPI_raster',
  folder: DRIVE_FOLDER, region: AOI_BOUNDS, scale: 30, crs: CRS, maxPixels: 1e13
});

Export.image.toDrive({
  image: catRaster,
  description: 'PPI_SK_v2_category_raster',
  folder: DRIVE_FOLDER, region: AOI_BOUNDS, scale: 30, crs: CRS, maxPixels: 1e13
});

Export.image.toDrive({
  image: anyConstraint.rename('constraint_mask'),
  description: 'PPI_SK_v2_constraint_mask',
  folder: DRIVE_FOLDER, region: AOI_BOUNDS, scale: 30, crs: CRS, maxPixels: 1e13
});

Export.image.toDrive({
  image: themeStack,
  description: 'PPI_SK_v2_theme_contribution_maps',
  folder: DRIVE_FOLDER, region: AOI_BOUNDS, scale: 30, crs: CRS, maxPixels: 1e13
});

// Products 7-9 (stability map, sensitivity report, collinearity matrix) are produced
// by gee/monte_carlo_sensitivity.py from the PPI_SK_v2_block_table.csv export above.

print('Exports queued. Open the Tasks tab and click Run on each export.');
