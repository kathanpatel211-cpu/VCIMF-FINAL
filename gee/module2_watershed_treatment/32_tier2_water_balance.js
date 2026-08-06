/**
 * 32_tier2_water_balance.js — Part 0.3 / 4.5: the water balance check
 *
 * Every upstream storage structure that traps silt also traps water that
 * would otherwise reach the reservoir (Part 0.3). This is not optional
 * accounting — it is the quantitative form of the CAT plan's central
 * internal conflict, and a plan that proposes storage without it is
 * incomplete.
 */

var config = require('users/<you>/VCIMF-FINAL:gee/module2_watershed_treatment/00_config.js');

function meanAnnualRunoffVolume(runoffDepthMmImage, subcatchments) {
  // Volume (m3) = depth (mm) / 1000 * area (m2)
  var depthM = runoffDepthMmImage.divide(1000);
  var pixelAreaM2 = ee.Image.pixelArea();
  var volumeImg = depthM.multiply(pixelAreaM2).rename('runoff_volume_m3');
  return volumeImg.reduceRegions({
    collection: subcatchments, reducer: ee.Reducer.sum(),
    scale: config.SCALE, tileScale: config.TILE_SCALE, crs: config.CRS
  }).map(function (f) {
    return ee.Feature(f).set('mean_annual_runoff_volume_m3', ee.Feature(f).get('sum'));
  });
}

function waterBalanceCheck(subcatchmentsWithRunoff, proposedStorageBySubcatchment, existingStorageBySubcatchment) {
  var proposedJoined = ee.Join.saveFirst('proposed').apply(
    subcatchmentsWithRunoff, proposedStorageBySubcatchment,
    ee.Filter.equals({leftField: 'subcatchment_id', rightField: 'subcatchment_id'})
  );
  var bothJoined = ee.Join.saveFirst('existing').apply(
    proposedJoined, existingStorageBySubcatchment,
    ee.Filter.equals({leftField: 'subcatchment_id', rightField: 'subcatchment_id'})
  );

  return ee.FeatureCollection(bothJoined).map(function (f) {
    f = ee.Feature(f);
    var runoffVol = ee.Number(f.get('mean_annual_runoff_volume_m3'));
    var proposed = ee.Feature(f.get('proposed'));
    var existing = ee.Feature(f.get('existing'));
    var proposedCapacity = ee.Number(ee.Algorithms.If(proposed, proposed.get('total_proposed_capacity_m3'), 0));
    var existingCapacity = ee.Number(ee.Algorithms.If(existing, existing.get('total_existing_capacity_m3'), 0));
    var totalCapacity = proposedCapacity.add(existingCapacity);
    var storageRatio = totalCapacity.divide(runoffVol.max(1));
    var breach = storageRatio.gt(config.POLICY.STORAGE_RATIO_THRESHOLD);

    return f.set({
      proposed_storage_m3: proposedCapacity,
      existing_storage_m3: existingCapacity,
      total_storage_m3: totalCapacity,
      storage_ratio: storageRatio,
      storage_ratio_threshold: config.POLICY.STORAGE_RATIO_THRESHOLD,
      threshold_breached: breach
    });
  });
}

function reportAllSubcatchments(waterBalanceFc) {
  print('ℹ Water balance check (Part 0.3/4.5): reporting storage ratio for ' +
        'EVERY sub-catchment, breached or not — "demonstrating the accounting ' +
        'was done is as valuable as the result." Threshold = ' +
        config.POLICY.STORAGE_RATIO_THRESHOLD + ' (PLACEHOLDER-POLICY — confirm ' +
        'against the CAT plan\'s own Terms of Reference before this is final).');
  return waterBalanceFc;
}

exports.meanAnnualRunoffVolume = meanAnnualRunoffVolume;
exports.waterBalanceCheck = waterBalanceCheck;
exports.reportAllSubcatchments = reportAllSubcatchments;
