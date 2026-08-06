/**
 * 11_cluster_b_sediment_delivery.js — Cluster B (22%)
 * W5 Index of Connectivity · W6 Flow-path proximity to reservoir ·
 * W7 Intervening sediment trapping (+ the satellite-derived structure inventory)
 *
 * Part 0.4: this cluster is what separates a CAT plan that treats the right
 * watersheds from one that treats the wrong ones thoroughly.
 */

var config = require('users/<you>/VCIMF-FINAL:gee/module2_watershed_treatment/00_config.js');
var assets = require('users/<you>/VCIMF-FINAL:gee/module2_watershed_treatment/02_external_assets.js');
var shared = require('users/<you>/VCIMF-FINAL:gee/module2_watershed_treatment/01_shared_layers.js');

// ---------------------------------------------------------------------------
// W5 — Index of Connectivity (Borselli/Cavalli)
// IC = log10( Dup / Ddn )
// Dup = W̄ · S̄ · sqrt(A)      Ddn = Σ ( di / (Wi·Si) )
//
// Dup/Ddn require flow routing (flow accumulation for A, and flow-path
// weighted length for Ddn) — both are external Whitebox outputs (Part 2).
// This function assembles IC from those outputs plus the RUSLE C-factor as
// the impedance/roughness weight, exactly as specified.
// ---------------------------------------------------------------------------
function computeIndexOfConnectivity(region) {
  var flowAcc = assets.requireExternal('FLOW_ACCUMULATION_D8', 'image').clip(region);
  var upslopeAreaM2 = flowAcc.multiply(config.SCALE * config.SCALE).rename('upslope_area_m2');

  var slope = shared.getSlopeDegrees(region).multiply(Math.PI / 180).tan().rename('slope_mm'); // m/m
  var cFactor = shared.getCFactorWorldCover(region); // used as the weighting/impedance factor W

  // Dup: mean W and mean S over the upslope contributing area. Precise
  // upslope-mean requires a cumulative (flow-accumulated) average of W·S,
  // which Whitebox computes directly (weighted flow accumulation). If a
  // precomputed IC_DUP asset exists, prefer it; otherwise approximate with
  // local W, S, and sqrt(upslope area) as a coarse stand-in and say so.
  var dup;
  try {
    dup = assets.requireExternal('IC_DUP', 'image').clip(region);
  } catch (e) {
    print('⚠ IC_DUP not precomputed externally — approximating Dup = W·S·sqrt(A) ' +
          'using LOCAL (not upslope-mean) W and S. This understates Dup accuracy; ' +
          'compute true upslope-weighted means in WhiteboxTools (weighted flow ' +
          'accumulation of C-factor and slope) for the production run.');
    dup = cFactor.multiply(slope).multiply(upslopeAreaM2.sqrt()).rename('dup_approx');
  }

  var ddn;
  try {
    ddn = assets.requireExternal('IC_DDN', 'image').clip(region);
  } catch (e2) {
    print('⚠ IC_DDN not precomputed externally — Ddn (Σ di/(Wi·Si) along the ' +
          'downslope flow path to the stream) needs DownslopeFlowpathLength / ' +
          'DownslopeDistanceToStream from WhiteboxTools (Part 2 step 8). ' +
          'Falling back to downslope distance-to-stream divided by local W·S ' +
          'as a coarse stand-in.');
    var distToStream = assets.requireExternal('DOWNSLOPE_DIST_TO_STREAM', 'image').clip(region);
    ddn = distToStream.divide(cFactor.multiply(slope).max(1e-6)).rename('ddn_approx');
  }

  var ic = dup.divide(ddn.max(1e-6)).log10().rename('index_of_connectivity');
  return ic;
}

// Empirical SDR fallback if IC proves impractical in the pilot timeframe (spec W5).
// SDR = a * A^(-b), A in km^2. Coefficients MUST be cited — placeholders here.
var SDR_COEFFICIENTS_PLACEHOLDER = {a: null, b: null, source: null};
function empiricalSdr(areaKm2) {
  if (SDR_COEFFICIENTS_PLACEHOLDER.a === null) {
    throw 'SDR_COEFFICIENTS_PLACEHOLDER not set. Select a published SDR relation ' +
          '(Vanoni or a regional Indian relation), cite it, and set a/b/source ' +
          'before using this fallback (spec W5).';
  }
  var a = SDR_COEFFICIENTS_PLACEHOLDER.a, b = SDR_COEFFICIENTS_PLACEHOLDER.b;
  return ee.Image(a).multiply(areaKm2.pow(-b)).rename('sdr_empirical');
}

// ---------------------------------------------------------------------------
// W6 — Flow-path proximity to reservoir (routed distance, NOT Euclidean)
// ---------------------------------------------------------------------------
function reservoirExtents(region) {
  var gsw = assets.getGsw().select('occurrence');
  var occMask = gsw.gte(75);
  var wcWater = assets.getWorldCover().eq(80);
  return occMask.and(wcWater).selfMask().clip(region);
}

function flowPathDistanceToReservoir(microwatershedOutlets, region) {
  // Routed distance requires the externally computed flow-path length grid
  // (Part 2 step 8) combined with the reservoir mask as the cost-distance
  // target. Cumulative-cost distance along the D8 network from each pixel to
  // the nearest reservoir cell is best computed in WhiteboxTools
  // (DownslopeDistanceToStream targeted at the reservoir mask) or via
  // ee.Image.cumulativeCost() seeded at the reservoir mask, weighted by a
  // large penalty off-channel so the path is forced onto the stream network.
  var streamOrder = assets.requireExternal('STREAM_ORDER_STRAHLER', 'image').clip(region);
  var reservoirs = reservoirExtents(region);
  var friction = ee.Image(1).where(streamOrder.gte(1), 1).where(streamOrder.mask().not(), 1e6);
  var cost = friction.cumulativeCost({
    source: reservoirs.unmask(0),
    maxDistance: 100000
  }).rename('flowpath_dist_to_reservoir_m');
  return cost;
}

// ---------------------------------------------------------------------------
// W7 — Intervening sediment trapping + satellite-derived structure inventory
// This inventory also feeds W14 (saturation), Tier 2 siting exclusions, and
// the water-balance check (0.3 / 4.5) — build it properly (spec W7).
// ---------------------------------------------------------------------------
function monthlyMndwi(year, month, region) {
  var start = ee.Date.fromYMD(year, month, 1);
  var end = start.advance(1, 'month');
  var s2 = assets.getSentinel2(start, end, region).median();
  return s2.normalizedDifference(['B3', 'B11']).rename('mndwi').set('year', year, 'month', month);
}

function candidateStructureWaterBodies(region, wetYear) {
  // Oct-Dec (holds water) vs Mar-May (dries) persistence contrast — spec W7.
  var wetSeason = ee.ImageCollection([
    monthlyMndwi(wetYear, 10, region), monthlyMndwi(wetYear, 11, region), monthlyMndwi(wetYear, 12, region)
  ]).mean().rename('mndwi_wet');
  var drySeason = ee.ImageCollection([
    monthlyMndwi(wetYear + 1, 3, region), monthlyMndwi(wetYear + 1, 4, region), monthlyMndwi(wetYear + 1, 5, region)
  ]).mean().rename('mndwi_dry');

  var holdsThenDries = wetSeason.gt(0.1).and(drySeason.lt(-0.05));

  var jrcSeasonality = assets.getGsw().select('seasonality'); // months of water/year
  var seasonalPattern = jrcSeasonality.gte(2).and(jrcSeasonality.lte(8)); // a few months only, not permanent

  var streamRaster = assets.requireExternal('STREAM_NETWORK_RASTER', 'image').clip(region);
  var onStream = streamRaster.focalMax(15, 'circle', 'meters').mask();

  var candidateMask = holdsThenDries.and(seasonalPattern).and(onStream);
  return candidateMask.selfMask().rename('candidate_structure');
}

function vectoriseAndFilterStructures(candidateMask, region, minHa, maxHa) {
  var vectors = candidateMask.reduceToVectors({
    geometry: region, scale: config.SCALE, geometryType: 'polygon',
    eightConnected: true, maxPixels: 1e13, crs: config.CRS
  });
  var withArea = vectors.map(function (f) {
    var areaHa = f.geometry().area(1).divide(10000);
    return f.set('area_ha', areaHa);
  });
  var filtered = withArea.filter(ee.Filter.and(
    ee.Filter.gte('area_ha', minHa), ee.Filter.lte('area_ha', maxHa)
  ));
  print('ℹ Structure inventory is a CANDIDATE list from remote sensing. Manual ' +
        'verification against high-resolution basemap imagery is required (spec W7) — ' +
        'expect to confirm/reject a few hundred candidates. Do not treat unverified ' +
        'candidates as a confirmed inventory in the DPR.');
  return filtered;
}

// Cumulative trapping capacity on the flow path between a watershed outlet
// and its receiving reservoir — assumes a simple surface-area × depth
// capacity estimate; state the depth assumption explicitly wherever quoted.
var ASSUMED_STRUCTURE_DEPTH_M = 1.5; // PLACEHOLDER — replace with local survey data if available
function estimateStructureCapacity(structureFeatureCollection) {
  return structureFeatureCollection.map(function (f) {
    var volumeM3 = ee.Number(f.get('area_ha')).multiply(10000).multiply(ASSUMED_STRUCTURE_DEPTH_M);
    return f.set('estimated_capacity_m3', volumeM3, 'assumed_depth_m', ASSUMED_STRUCTURE_DEPTH_M);
  });
}

exports.computeIndexOfConnectivity = computeIndexOfConnectivity;
exports.empiricalSdr = empiricalSdr;
exports.SDR_COEFFICIENTS_PLACEHOLDER = SDR_COEFFICIENTS_PLACEHOLDER;
exports.reservoirExtents = reservoirExtents;
exports.flowPathDistanceToReservoir = flowPathDistanceToReservoir;
exports.candidateStructureWaterBodies = candidateStructureWaterBodies;
exports.vectoriseAndFilterStructures = vectoriseAndFilterStructures;
exports.estimateStructureCapacity = estimateStructureCapacity;
exports.ASSUMED_STRUCTURE_DEPTH_M = ASSUMED_STRUCTURE_DEPTH_M;
