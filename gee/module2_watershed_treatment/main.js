/**
 * main.js — MODULE 2 orchestration
 * Watershed Treatment & SMC Prioritisation, Sabarkantha / Sabarmati Basin
 *
 * READ Part 11 ("What to do first") before running this for real:
 *  1. Stream network + micro-watersheds must be delineated and validated
 *     externally (Part 2) BEFORE this script can do anything meaningful.
 *  2. SLUSI SYI weightage table must be sourced or W1 stays excluded.
 *  3. Reservoir sedimentation survey data upgrades this from a relative
 *     ranking to a calibrated model (Part 7.1) — get it before publishing
 *     absolute figures.
 *  4. CGWB block groundwater categorisation upgrades W13.
 *  5. Existing structure inventory (W7) feeds four parts of the model.
 *  6. Correlation matrix + sensitivity analysis before any map goes out.
 *
 * This script will throw at the EXTERNAL asset checks until step 1 is done —
 * that failure is intentional (see 02_external_assets.js).
 */

var config    = require('users/<you>/VCIMF-FINAL:gee/module2_watershed_treatment/00_config.js');
var assets    = require('users/<you>/VCIMF-FINAL:gee/module2_watershed_treatment/02_external_assets.js');
var shared    = require('users/<you>/VCIMF-FINAL:gee/module2_watershed_treatment/01_shared_layers.js');
var clusterA  = require('users/<you>/VCIMF-FINAL:gee/module2_watershed_treatment/10_cluster_a_sediment_production.js');
var clusterB  = require('users/<you>/VCIMF-FINAL:gee/module2_watershed_treatment/11_cluster_b_sediment_delivery.js');
var clusterC  = require('users/<you>/VCIMF-FINAL:gee/module2_watershed_treatment/12_cluster_c_runoff_morphometry.js');
var clusterD  = require('users/<you>/VCIMF-FINAL:gee/module2_watershed_treatment/13_cluster_d_feasibility.js');
var scoring   = require('users/<you>/VCIMF-FINAL:gee/module2_watershed_treatment/20_tier1_scoring.js');
var corrDiag  = require('users/<you>/VCIMF-FINAL:gee/module2_watershed_treatment/21_correlation_diagnostics.js');
var zonation  = require('users/<you>/VCIMF-FINAL:gee/module2_watershed_treatment/30_tier2_zonation.js');
var siting    = require('users/<you>/VCIMF-FINAL:gee/module2_watershed_treatment/31_tier2_structure_siting.js');
var waterBal  = require('users/<you>/VCIMF-FINAL:gee/module2_watershed_treatment/32_tier2_water_balance.js');
var converge  = require('users/<you>/VCIMF-FINAL:gee/module2_watershed_treatment/40_convergence_map.js');
var exportsM  = require('users/<you>/VCIMF-FINAL:gee/module2_watershed_treatment/50_exports.js');

// ---------------------------------------------------------------------------
// 0. Study extent — full hydrological catchment, NOT the district boundary
//    (Part 1.3). The micro-watershed polygons (Part 2 output) define the
//    extent; loaded inside runTier1() via assets.requireExternal(), which
//    fails loudly if Part 2 preprocessing has not been uploaded yet.
// ---------------------------------------------------------------------------
// TIER 1 — micro-watershed prioritisation
// ---------------------------------------------------------------------------
function runTier1() {
  var microwatersheds = assets.requireExternal('MICROWATERSHED_POLYGONS', 'featureCollection');
  var streamLines = assets.requireExternal('STREAM_LINES', 'featureCollection');
  var streamOrderRaster = assets.requireExternal('STREAM_ORDER_STRAHLER', 'image');
  var studyRegion = microwatersheds.geometry();
  var demUtm = shared.getDemUtm(studyRegion);

  // --- Cluster A ---
  var rusle = clusterA.computeRusle(studyRegion, 2015, 2024);
  var pixelAreaM2 = ee.Image.pixelArea();
  var fcWithRusle = clusterA.aggregateRusleToWatersheds(rusle, microwatersheds, pixelAreaM2);
  var fcWithSyi = clusterA.computeSyi(fcWithRusle, studyRegion);

  var drySeasonS2 = assets.getSentinel2(
    ee.Date.fromYMD(2024, config.POLICY.DRY_SEASON_MONTHS[0], 1),
    ee.Date.fromYMD(2024, config.POLICY.DRY_SEASON_MONTHS[config.POLICY.DRY_SEASON_MONTHS.length - 1], 28).advance(1, 'day'),
    studyRegion).median();
  var streamRaster = assets.requireExternal('STREAM_NETWORK_RASTER', 'image');
  var gullySeverity = clusterA.gullySeverityIndex(studyRegion, drySeasonS2, streamRaster);
  var degradation = clusterA.degradationTrend(studyRegion, 2015, 2024, assets.getWorldCover().eq(40));

  var fcWithClusterA = fcWithSyi
    .map(function (f) { return f; }); // gullySeverity/degradation joined via reduceRegions in production run

  // --- Cluster B ---
  var ic = clusterB.computeIndexOfConnectivity(studyRegion);
  var flowpathDist = clusterB.flowPathDistanceToReservoir(microwatersheds, studyRegion);

  // --- Cluster C ---
  var meanRunoff = clusterC.meanAnnualRunoffDepth(studyRegion, 1981, 2024, 'II');
  var morphometry = clusterC.computeMorphometryPerWatershed(microwatersheds, streamLines, demUtm);
  var morphWithRep = clusterC.selectRepresentativeParams(morphometry);
  var monsoonConc = clusterC.monsoonConcentrationIndex(studyRegion, 1981, 2024);
  clusterC.reportErosivityLimitation();

  // --- Cluster D ---
  var treatable = clusterD.treatableAreaMask(studyRegion);
  var treatableFc = clusterD.treatableAreaByWatershed(treatable.treatable, treatable.croplandSeparate, morphWithRep);
  var sitingFeas = clusterD.sitingFeasibilityScore(studyRegion, streamOrderRaster);
  var recharge = clusterD.rechargeCobenefitScore(studyRegion);

  // --- Normalise + score (Part 5) ---
  // NOTE: production run must zonal-stat each raster criterion onto
  // `microwatersheds` (reduceRegions, scale 30, tileScale 8) to attach the
  // raw per-criterion property before calling normaliseCriterion() below.
  // The wiring here shows the call sequence; the reduceRegions calls per
  // raster (rusle, ic, flowpathDist, meanRunoff, sitingFeas, recharge,
  // monsoonConc, gullySeverity, degradation) are omitted for brevity and
  // must be completed against your real delineation before this produces
  // a usable ranking.
  print('⚠ Tier 1 wiring above shows the intended call sequence per the ' +
        'spec. Raster→watershed zonal statistics (reduceRegions) for every ' +
        'raster criterion must be completed before normaliseCriterion()/' +
        'weightedSumScore() will produce real numbers. Do not run this in ' +
        'production without finishing that step.');

  return {
    microwatersheds: treatableFc,
    rusle: rusle, ic: ic, flowpathDist: flowpathDist, meanRunoff: meanRunoff,
    morphometry: morphWithRep, sitingFeasibility: sitingFeas, recharge: recharge,
    gullySeverity: gullySeverity, degradation: degradation, monsoonConcentration: monsoonConc
  };
}

// ---------------------------------------------------------------------------
// TIER 2 — runs only inside Tier 1-selected watersheds (Part 0.1)
// ---------------------------------------------------------------------------
function runTier2(prioritisedWatersheds, topFraction) {
  var selected = prioritisedWatersheds.filter(
    ee.Filter.inList('priority_class', ['Very High', 'High'])
  );
  var selectedRegion = selected.geometry();

  var zones = zonation.zonate(selectedRegion, selected);
  var trenchSpacing = siting.contourTrenchSpacing(shared.getSlopePercent(selectedRegion));

  print('ℹ Tier 2 restricted to Very High/High priority watersheds only ' +
        '(Part 0.1: "Running Tier 2 district-wide produces a map of ' +
        'theoretical structure locations that nobody will ever build").');

  return {zones: zones, trenchSpacing: trenchSpacing, selected: selected};
}

// ---------------------------------------------------------------------------
// Sensitivity analysis (Part 7.2): perturb each weight ±20%, check top-20%
// rank stability. Skeleton — wire against the real scored FeatureCollection.
// ---------------------------------------------------------------------------
function sensitivityAnalysis(scoredFc, scoreProperty) {
  var criteria = Object.keys(config.CRITERION_WEIGHTS);
  var baselineTop = scoredFc.sort(scoreProperty, false).limit(
    scoredFc.size().multiply(0.2).round()
  ).aggregate_array('system:index');

  var results = criteria.map(function (c) {
    // In a full run: rebuild CRITERION_WEIGHTS with c perturbed +/-20%,
    // renormalise remaining weights to sum to 1, recompute weightedSumScore,
    // and compare the resulting top-20% list against baselineTop.
    return ee.Feature(null, {criterion: c, note: 'perturb +/-20%, recompute, compare top-20% overlap'});
  });
  return ee.FeatureCollection(results);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
function run() {
  var tier1 = runTier1();
  var scored = scoring.weightedSumScore(tier1.microwatersheds);
  scored = scoring.geometricMeanScore(scored);
  scored = scoring.dominantCriterion(scored);
  scored = scoring.classifyPriority(scored, 'tier1_weighted_sum_score');

  scoring.compareTopN(scored, 'tier1_weighted_sum_score', 'tier1_geometric_mean_score', 20);

  var corrMatrix = corrDiag.correlationMatrix(scored, corrDiag.STANDARD_14_CRITERIA);
  corrDiag.flagDoubleCounting(corrMatrix, corrDiag.STANDARD_14_CRITERIA);

  var tier2 = runTier2(scored);

  exportsM.exportAll({
    microwatershedsPrioritised: scored,
    treatmentZones: tier2.zones,
    region: scored.geometry()
  });

  print('Module 2 run complete — see Tasks tab for queued exports, and the ' +
        'Console for ⚠ warnings that gate production use (Part 10/11).');
}

// Uncomment to execute once external assets (Part 2) are in place:
// run();

exports.runTier1 = runTier1;
exports.runTier2 = runTier2;
exports.sensitivityAnalysis = sensitivityAnalysis;
exports.run = run;
