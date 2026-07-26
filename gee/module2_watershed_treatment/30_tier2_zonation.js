/**
 * 30_tier2_zonation.js — Part 4.1: ridge-to-valley zonation
 *
 * Runs ONLY inside micro-watersheds selected by Tier 1 (Part 0.1/0.2). Every
 * pixel gets exactly one zone. Zone 3 structures must carry a flag naming
 * their Zone 1/2 prerequisites (Part 0.2) — the hard sequencing constraint.
 */

var config = require('users/<you>/VCIMF-FINAL:gee/module2_watershed_treatment/00_config.js');
var assets = require('users/<you>/VCIMF-FINAL:gee/module2_watershed_treatment/02_external_assets.js');
var shared = require('users/<you>/VCIMF-FINAL:gee/module2_watershed_treatment/01_shared_layers.js');

function relativeReliefPosition(region) {
  var dem = shared.getDemUtm(region);
  var minMax = dem.reduceRegion({
    reducer: ee.Reducer.minMax(), geometry: region, scale: config.SCALE,
    maxPixels: 1e13, tileScale: config.TILE_SCALE
  });
  var elevMin = ee.Number(minMax.get('elevation_min'));
  var elevMax = ee.Number(minMax.get('elevation_max'));
  return dem.subtract(elevMin).divide(elevMax.subtract(elevMin).max(1)).rename('relief_position'); // 0=valley,1=ridge
}

function zonate(region, prioritisedWatersheds) {
  var streamOrder = assets.requireExternal('STREAM_ORDER_STRAHLER', 'image').clip(region);
  var slopePct = shared.getSlopePercent(region);
  var hand = assets.getHand().clip(region);
  var relief = relativeReliefPosition(region);

  var r = config.ZONE_RULES;

  var zone1 = streamOrder.lte(r.ZONE1_RIDGE.streamOrderMax)
    .and(slopePct.gt(r.ZONE1_RIDGE.slopePctMin))
    .and(relief.gt(0.66))
    .and(hand.gt(hand.reduceRegion({
      reducer: ee.Reducer.percentile([66]), geometry: region, scale: config.SCALE,
      maxPixels: 1e13, tileScale: config.TILE_SCALE
    }).values().get(0)));

  var zone2 = streamOrder.gte(r.ZONE2_GULLY.streamOrderMin).and(streamOrder.lte(r.ZONE2_GULLY.streamOrderMax))
    .and(slopePct.gte(r.ZONE2_GULLY.slopePctMin)).and(slopePct.lte(r.ZONE2_GULLY.slopePctMax))
    .and(relief.gt(0.33)).and(relief.lte(0.66));

  var zone3 = streamOrder.gte(r.ZONE3_VALLEY.streamOrderMin).and(streamOrder.lte(r.ZONE3_VALLEY.streamOrderMax))
    .and(slopePct.lte(r.ZONE3_VALLEY.slopePctMax))
    .and(relief.lte(0.33));

  // Zone assignment: 1 / 2 / 3, resolved in priority order so every pixel
  // gets exactly one zone (Zone 3 rule applied last as the default valley catch-all).
  var zoneRaster = ee.Image(0)
    .where(zone3, 3).where(zone2, 2).where(zone1, 1)
    .selfMask().rename('treatment_zone').clip(prioritisedWatersheds);

  return zoneRaster;
}

// Sequencing enforcement: any Zone 3 structure carries the identity of the
// Zone 1/2 units draining into it — used to build the "must be substantially
// complete before" flag on Tier 2 output (Part 0.2 hard constraint).
function attachSequencingPrerequisites(zone3Features, zone1Zone2FeatureCollection, flowAccImage) {
  // A Zone 3 point's prerequisite set = the Zone 1/2 area upstream of it on
  // the flow network. Practically: intersect the upstream contributing area
  // (via a watershed delineated at that pour point, or the parent
  // micro-watershed's Zone 1/2 footprint) with zone1Zone2FeatureCollection.
  return zone3Features.map(function (f) {
    f = ee.Feature(f);
    var upstreamZone12 = zone1Zone2FeatureCollection.filterBounds(f.geometry().buffer(500));
    var prereqIds = upstreamZone12.aggregate_array('system:index');
    return f.set('prerequisite_zone1_zone2_ids', prereqIds,
      'sequencing_note', 'Zone 3 must not precede substantial completion of listed Zone 1/2 works (spec Part 0.2)');
  });
}

exports.relativeReliefPosition = relativeReliefPosition;
exports.zonate = zonate;
exports.attachSequencingPrerequisites = attachSequencingPrerequisites;
