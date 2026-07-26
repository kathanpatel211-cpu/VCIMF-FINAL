/**
 * 13_cluster_d_feasibility.js — Cluster D (18%)
 * W11 Treatable area availability · W12 Structure siting feasibility ·
 * W13 Recharge co-benefit · W14 Existing treatment saturation
 * (+ the desilting-candidate override described under W14)
 */

var config = require('users/<you>/VCIMF-FINAL:gee/module2_watershed_treatment/00_config.js');
var assets = require('users/<you>/VCIMF-FINAL:gee/module2_watershed_treatment/02_external_assets.js');
var shared = require('users/<you>/VCIMF-FINAL:gee/module2_watershed_treatment/01_shared_layers.js');

// ---------------------------------------------------------------------------
// W11 — Treatable area availability
// Treatable = total watershed area minus exclusions.
// ---------------------------------------------------------------------------
function treatableAreaMask(region) {
  var wc = assets.getWorldCover().clip(region);
  var gfc = assets.getHansenGfc().clip(region);
  var denseForest = gfc.select('treecover2000').gte(40)
    .and(gfc.select('lossyear').unmask(0).eq(0)); // dense forest, not subsequently lost

  var water = assets.getGsw().select('occurrence').gte(50).or(wc.eq(80));
  var builtUp = wc.eq(50);
  var bareRockThreshold = 0.15; // PLACEHOLDER — calibrate bare-rock index cutoff against imagery
  var s2 = assets.getSentinel2(ee.Date('2024-02-01'), ee.Date('2024-05-31'), region).median();
  var rockOutcrop = shared.getBareRockIndex(s2).gt(bareRockThreshold);

  var slopePct = shared.getSlopePercent(region);
  var steepSlope = shared.getSlopeDegrees(region).gt(35); // >35 degrees per spec (note: degrees, not %)

  var cropland = wc.eq(40);

  var exclusion = denseForest.or(water).or(builtUp).or(rockOutcrop).or(steepSlope);
  var treatableForestLand = exclusion.not().and(cropland.not());

  print('ℹ Cropland excluded from treatable area (Forest Dept programme scope, ' +
        'spec W11) but reported separately below as a convergence flag for RDD/' +
        'watershed-agency programmes.');
  return {
    treatable: treatableForestLand.selfMask().rename('treatable'),
    croplandSeparate: cropland.selfMask().rename('cropland_separate'),
    exclusionLayers: {denseForest: denseForest, water: water, builtUp: builtUp,
      rockOutcrop: rockOutcrop, steepSlope: steepSlope}
  };
}

function treatableAreaByWatershed(treatableMask, croplandMask, microwatersheds) {
  var pixelAreaHa = ee.Image.pixelArea().divide(10000);
  var withArea = treatableMask.multiply(pixelAreaHa).rename('treatable_ha')
    .addBands(croplandMask.multiply(pixelAreaHa).rename('cropland_ha'));
  return withArea.reduceRegions({
    collection: microwatersheds, reducer: ee.Reducer.sum(),
    scale: config.SCALE, tileScale: config.TILE_SCALE, crs: config.CRS
  }).map(function (f) {
    f = ee.Feature(f);
    var totalAreaHa = ee.Number(f.get('area_km2')).multiply(100);
    var treatableProp = ee.Number(f.get('treatable_ha')).divide(totalAreaHa.max(1));
    return f.set('treatable_area_proportion', treatableProp);
  });
}

// ---------------------------------------------------------------------------
// W12 — Structure siting feasibility (coarse Tier-1 screen; full detail in Tier 2)
// ---------------------------------------------------------------------------
function sitingFeasibilityScore(region, streamOrderRaster) {
  var slopePct = shared.getSlopePercent(region);
  var trenchTerrain = slopePct.gte(15).and(slopePct.lte(33));

  var lowOrder = streamOrderRaster.lte(2);
  var checkDamOrder = streamOrderRaster.gte(3).and(streamOrderRaster.lte(4));

  var dem = shared.getDemUtm(region);
  var bedSlopeProxy = dem.focalMax(90, 'square', 'meters')
    .subtract(dem.focalMin(90, 'square', 'meters')).divide(90).rename('bed_slope_proxy');
  var gentleChannel = bedSlopeProxy.lt(0.03);

  var s2 = assets.getSentinel2(ee.Date('2024-02-01'), ee.Date('2024-05-31'), region).median();
  var boulderProxy = shared.getBareRockIndex(s2).gt(0.1); // material-availability proxy

  var feasible = ee.Image(0)
    .add(trenchTerrain.multiply(0.35))
    .add(lowOrder.multiply(0.25))
    .add(checkDamOrder.and(gentleChannel).multiply(0.25))
    .add(boulderProxy.multiply(0.15))
    .rename('siting_feasibility_score');
  return feasible;
}

// ---------------------------------------------------------------------------
// W13 — Recharge co-benefit (physical CAPACITY only — no groundwater-stress
// data available; state this limitation on every output, spec W13/Part 10.6).
// ---------------------------------------------------------------------------
function lineamentDensityProxy(region) {
  var dem = shared.getDemUtm(region);
  var hillshadeAz = [0, 45, 90, 135, 180, 225, 270, 315];
  var edges = ee.ImageCollection(hillshadeAz.map(function (az) {
    return ee.Terrain.hillshade(dem, az, 45).convolve(ee.Kernel.laplacian8()).abs();
  })).max().rename('lineament_edge_strength');
  return edges;
}

function rechargeCobenefitScore(region) {
  var depthProxy = shared.getSoilDepthProxy(region); // weathered-zone thickness stand-in
  var lineament = lineamentDensityProxy(region).unitScale(0, 50).clamp(0, 1);
  var slopePct = shared.getSlopePercent(region);
  var gentleSlope = ee.Image(1).subtract(slopePct.unitScale(0, 30).clamp(0, 1));

  var score = depthProxy.multiply(0.4).add(lineament.multiply(0.35)).add(gentleSlope.multiply(0.25))
    .rename('recharge_cobenefit_score');

  print('⚠ W13 reflects physical recharge CAPACITY only — CGWB Dynamic ' +
        'Groundwater Resource block categorisation is not wired in (Part 11 item 4: ' +
        'a free download from CGWB/India-WRIS that upgrades this from proxy to ' +
        'measurement). The model can say "good recharge capacity", not "needs ' +
        'recharge most", until that data is joined in. GRACE TWS anomaly is ~1-3 ' +
        'degree resolution — regional narrative only, never a scoring input (spec W13).');
  return score;
}

// Join point for CGWB data once obtained (Part 11 item 4) — table join, not a
// research task. Left unimplemented until the CSV/shapefile is in hand.
function joinCgwbBlockCategory(microwatersheds, cgwbBlockFeatureCollection) {
  if (!cgwbBlockFeatureCollection) {
    print('⚠ joinCgwbBlockCategory() called without CGWB data — skipping join.');
    return microwatersheds;
  }
  var spatialFilter = ee.Filter.intersects({leftField: '.geo', rightField: '.geo'});
  var saveFirst = ee.Join.saveFirst('cgwb_match').apply(microwatersheds, cgwbBlockFeatureCollection, spatialFilter);
  return ee.FeatureCollection(saveFirst).map(function (f) {
    var match = ee.Feature(f.get('cgwb_match'));
    return f.set('cgwb_category', match.get('category'));
  });
}

// ---------------------------------------------------------------------------
// W14 — Existing treatment saturation + desilting-candidate override
// ---------------------------------------------------------------------------
function saturationByWatershed(structureInventory, microwatersheds, streamLengthByWatershed) {
  var joined = ee.Join.saveAll('structures_in').apply(
    microwatersheds, structureInventory,
    ee.Filter.intersects({leftField: '.geo', rightField: '.geo'})
  );
  return ee.FeatureCollection(joined).map(function (f) {
    f = ee.Feature(f);
    var structs = ee.List(f.get('structures_in'));
    var n = structs.size();
    var areaKm2 = ee.Number(f.get('area_km2'));
    var streamKm = ee.Number(f.get('Dd')).multiply(areaKm2); // Dd(km/km2) * area(km2) = total stream km
    var capacitySum = ee.FeatureCollection(structs).aggregate_sum('estimated_capacity_m3');
    return f.set({
      existing_structure_count: n,
      structures_per_km2: ee.Number(n).divide(areaKm2.max(0.01)),
      structures_per_km_drainage: ee.Number(n).divide(streamKm.max(0.01)),
      existing_storage_m3: capacitySum
    });
  });
}

// Desilting override: high existing structure density AND high W1/W2 sediment
// score => flag as desilting candidate instead of naively down-ranking on W14
// (spec W14: "losing these watersheds to a naive saturation penalty would be
// a significant missed opportunity").
function applyDesiltingOverride(fc, structureDensityHighThreshold, sedimentScoreHighPercentile) {
  return fc.map(function (f) {
    f = ee.Feature(f);
    var highDensity = ee.Number(f.get('structures_per_km2')).gte(structureDensityHighThreshold);
    var highSediment = ee.Number(f.get('sediment_production_score_percentile')).gte(sedimentScoreHighPercentile);
    var isDesiltingCandidate = highDensity.and(highSediment);
    return f.set('desilting_candidate', isDesiltingCandidate);
  });
}

exports.treatableAreaMask = treatableAreaMask;
exports.treatableAreaByWatershed = treatableAreaByWatershed;
exports.sitingFeasibilityScore = sitingFeasibilityScore;
exports.lineamentDensityProxy = lineamentDensityProxy;
exports.rechargeCobenefitScore = rechargeCobenefitScore;
exports.joinCgwbBlockCategory = joinCgwbBlockCategory;
exports.saturationByWatershed = saturationByWatershed;
exports.applyDesiltingOverride = applyDesiltingOverride;
