/**
 * 10_cluster_a_sediment_production.js — Cluster A (42%)
 * W1 Sediment Yield Index · W2 RUSLE gross soil loss ·
 * W3 Gully/ravine severity · W4 Land degradation trend
 */

var config = require('users/<you>/VCIMF-FINAL:gee/module2_watershed_treatment/00_config.js');
var assets = require('users/<you>/VCIMF-FINAL:gee/module2_watershed_treatment/02_external_assets.js');
var shared = require('users/<you>/VCIMF-FINAL:gee/module2_watershed_treatment/01_shared_layers.js');

// ---------------------------------------------------------------------------
// W1 — Sediment Yield Index (SYI)
// SYI = [ Σ (Ai × Wi × Di) ] / Aw × 100
// ---------------------------------------------------------------------------

// PLACEHOLDER weightage table — see spec W1: "I am not going to state numeric
// values for these from memory." Obtain the real SLUSI/AIS&LUS table
// (phone call / email to SLUSI, Gujarat State Land Use Board, or Watershed
// Atlas methodology docs) and replace this object, updating
// config.POLICY.SYI_TABLE_SOURCE and setting SYI_TABLE_IS_PLACEHOLDER = false.
var SYI_PLACEHOLDER_WEIGHTAGE = null; // intentionally null — do not invent values

function buildEimu(region) {
  var slopePct = shared.getSlopePercent(region);
  var slopeClass = ee.Image(1)
    .where(slopePct.gt(3), 2).where(slopePct.gt(8), 3)
    .where(slopePct.gt(15), 4).where(slopePct.gt(33), 5)
    .rename('slope_class');

  var tex = shared.getSoilTexture(region);
  var textureClass = tex.select('clay_pct').gt(35).rename('texture_class'); // coarse placeholder split

  var depthClass = shared.getSoilDepthProxy(region).multiply(3).round().rename('depth_class');

  var wc = assets.getWorldCover().clip(region).rename('lulc_class');

  // W3 gully severity layer feeds in as "observed erosion status" once computed below.
  return slopeClass.addBands(textureClass).addBands(depthClass).addBands(wc)
    .rename(['slope_class', 'texture_class', 'depth_class', 'lulc_class']);
}

function computeSyi(microwatersheds, region) {
  if (config.POLICY.SYI_TABLE_SOURCE === null || SYI_PLACEHOLDER_WEIGHTAGE === null) {
    print('⚠ SYI (W1) SKIPPED / EXCLUDED FROM COMPOSITE: no sourced SLUSI/AIS&LUS ' +
          'weightage table available. Running with a placeholder table would ' +
          'produce an indefensible CAT metric (spec W1). This is Part 11, item 2 — ' +
          'a phone call, not a research task.');
    return microwatersheds.map(function (f) {
      return f.set('W1_SYI_raw', null, 'W1_SYI_excluded', true);
    });
  }
  // Real computation, once SYI_PLACEHOLDER_WEIGHTAGE is replaced with the sourced table:
  var eimu = buildEimu(region);
  // Ai × Wi × Di aggregation would be implemented here against the real table.
  throw 'SYI table present but aggregation logic not yet wired — implement ' +
        'Ai×Wi×Di lookup against SYI_PLACEHOLDER_WEIGHTAGE once sourced.';
}

// ---------------------------------------------------------------------------
// W2 — RUSLE gross soil loss (A = R × K × LS × C × P)
// Shares components with Module 1 C11 — compute once via 01_shared_layers.js.
// ---------------------------------------------------------------------------
function computeRusle(region, startYear, endYear) {
  var R = shared.getRFactor(region, startYear, endYear);
  var K = shared.getKFactorEpic(region);
  var C = shared.getCFactorWorldCover(region);
  var P = shared.getPFactor(region);
  var LS = assets.requireExternal('LS_FACTOR', 'image').clip(region); // Part 2 step 9 output

  var A = R.multiply(K).multiply(LS).multiply(C).multiply(P).rename('rusle_soil_loss_t_ha_yr');
  return A;
}

function aggregateRusleToWatersheds(rusleImage, microwatersheds, areaImageM2) {
  var withTotal = rusleImage.addBands(
    rusleImage.multiply(areaImageM2.divide(10000)).rename('total_loss_t_yr')
  );
  return withTotal.reduceRegions({
    collection: microwatersheds,
    reducer: ee.Reducer.mean().combine({reducer2: ee.Reducer.sum(), sharedInputs: false}),
    scale: config.SCALE,
    tileScale: config.TILE_SCALE,
    crs: config.CRS
  });
}

// ---------------------------------------------------------------------------
// W3 — Gully & ravine erosion severity (derived proxy — no global dataset exists)
// ---------------------------------------------------------------------------
function bareSoilIndex(s2Image) {
  var b11 = s2Image.select('B11'), b4 = s2Image.select('B4');
  var b8 = s2Image.select('B8'), b2 = s2Image.select('B2');
  return b11.add(b4).subtract(b8.add(b2))
    .divide(b11.add(b4).add(b8).add(b2))
    .rename('bsi');
}

function gullySeverityIndex(region, drySeasonS2Median, streamNetworkRaster) {
  var dem = shared.getDemUtm(region);
  var localRelief = dem.focalMax(100, 'square', 'meters')
    .subtract(dem.focalMin(100, 'square', 'meters')).rename('local_relief');
  var roughness = dem.reduceNeighborhood({
    reducer: ee.Reducer.stdDev(), kernel: ee.Kernel.circle(100, 'meters')
  }).rename('roughness');
  var bsi = bareSoilIndex(drySeasonS2Median);

  var streamBuffer = streamNetworkRaster.focalMax(60, 'circle', 'meters').selfMask();
  var bsiNearChannel = bsi.updateMask(streamBuffer).unmask(0).rename('bsi_near_channel');

  var severity = localRelief.unitScale(0, 30).clamp(0, 1).multiply(0.3)
    .add(roughness.unitScale(0, 10).clamp(0, 1).multiply(0.3))
    .add(bsiNearChannel.unitScale(-0.3, 0.3).clamp(0, 1).multiply(0.4))
    .rename('gully_severity_index');

  print('ℹ W3 is a derived proxy (spec: "should be labelled as such"). ' +
        'Validate against 20-30 digitised gully systems before use (spec W3).');
  return severity;
}

// ---------------------------------------------------------------------------
// W4 — Land degradation trend (Theil-Sen slope of peak-season NDVI, 2015-2025)
// ---------------------------------------------------------------------------
function annualPeakNdvi(year, region) {
  var start = ee.Date.fromYMD(year, config.POLICY.PEAK_NDVI_MONTHS[0], 1);
  var end = ee.Date.fromYMD(year, config.POLICY.PEAK_NDVI_MONTHS[config.POLICY.PEAK_NDVI_MONTHS.length - 1], 30);
  var l8 = assets.getLandsat8().filterDate(start, end).filterBounds(region);
  var ndvi = l8.map(function (img) {
    var optical = img.select('SR_B.').multiply(0.0000275).add(-0.2);
    return optical.normalizedDifference(['SR_B5', 'SR_B4']).rename('ndvi').set('year', year);
  });
  return ndvi.median().set('year', year);
}

function degradationTrend(region, startYear, endYear, cropMask) {
  var years = ee.List.sequence(startYear, endYear);
  var series = ee.ImageCollection(years.map(function (y) { return annualPeakNdvi(ee.Number(y), region); }));

  // Theil-Sen via Sen's slope estimator (Kendall's robust regression):
  var sensSlope = series.reduce(ee.Reducer.sensSlope());
  var slopeBand = sensSlope.select('slope').rename('ndvi_trend_slope');

  var maskedSlope = cropMask ? slopeBand.updateMask(cropMask.not()) : slopeBand;

  print('ℹ Cropland masked out before trend computation (spec W4: "the ' +
        'Sabarmati valley agricultural belt will otherwise dominate this layer").');
  print('ℹ Mann-Kendall significance not evaluated client-side by ee.Reducer.sensSlope() ' +
        'alone — pair with ee.Reducer.kendallsCorrelation() over the same series ' +
        'and threshold at p < ' + config.POLICY.DEGRADATION_TREND_PVALUE + ' before ' +
        'computing the "significant negative trend" proportion (spec W4).');
  return maskedSlope;
}

exports.computeSyi = computeSyi;
exports.buildEimu = buildEimu;
exports.computeRusle = computeRusle;
exports.aggregateRusleToWatersheds = aggregateRusleToWatersheds;
exports.bareSoilIndex = bareSoilIndex;
exports.gullySeverityIndex = gullySeverityIndex;
exports.degradationTrend = degradationTrend;
