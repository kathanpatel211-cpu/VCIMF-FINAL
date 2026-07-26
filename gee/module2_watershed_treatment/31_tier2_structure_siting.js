/**
 * 31_tier2_structure_siting.js — Part 4.2-4.4: structure decision matrix,
 * spacing/quantity computation, percolation tank siting flag.
 *
 * All ranges below are indicative planning norms per the spec. They MUST be
 * confirmed against the Gujarat Forest Dept / GWRD technical manual, Schedule
 * of Rates, relevant IS codes and MoRD/NABARD watershed manuals before
 * entering a BoQ (Part 4.2 closing note). Rupee rates are never hard-coded
 * here — quantities only (Part 4.3 closing note).
 */

var config = require('users/<you>/VCIMF-FINAL:gee/module2_watershed_treatment/00_config.js');
var assets = require('users/<you>/VCIMF-FINAL:gee/module2_watershed_treatment/02_external_assets.js');
var shared = require('users/<you>/VCIMF-FINAL:gee/module2_watershed_treatment/01_shared_layers.js');

// ---------------------------------------------------------------------------
// 4.2 — Structure decision matrix (indicative norms — confirm against state manual)
// ---------------------------------------------------------------------------
var STRUCTURE_MATRIX = [
  {name: 'Continuous Contour Trench (CCT)', zone: 1, slopePctMin: 15, slopePctMax: 33,
    condition: 'rainfall < 800mm; stable soils; adequate soil depth for excavation'},
  {name: 'Staggered Contour Trench (SCT)', zone: 1, slopePctMin: 15, slopePctMax: 33,
    condition: 'rainfall > 800mm, or unstable/shallow soils, or slip risk'},
  {name: 'Water Absorption Trench', zone: 1, slopePctMin: 5, slopePctMax: 15,
    condition: 'gentler upper slopes'},
  {name: 'Gradoni / bench terrace', zone: 1, slopePctMin: 15, slopePctMax: 30,
    condition: 'plantation/horticulture intended — links to Module 1'},
  {name: 'Vegetative / live barrier', zone: [1, 2], slopePctMin: 5, slopePctMax: 25,
    condition: 'supplementary to mechanical measures'},
  {name: 'Gully plug', zone: 2, streamOrder: [1], catchmentHaMax: 10, condition: 'gully depth < 1 m'},
  {name: 'Loose Boulder Check Dam (LBCD)', zone: 2, streamOrder: [1, 2], catchmentHaMax: 40,
    condition: 'gully depth < 1 m; boulder available locally'},
  {name: 'Gabion structure', zone: 2, streamOrder: [2, 3], catchmentHaMin: 40, catchmentHaMax: 100,
    condition: 'higher discharge; where LBCD would wash out'},
  {name: 'Earthen check dam / nala bund', zone: 3, streamOrder: [3, 4], bedSlopePctMax: 5,
    catchmentHaMin: 40, catchmentHaMax: 200, condition: 'stable banks; suitable foundation'},
  {name: 'Masonry / cement check dam', zone: 3, streamOrder: [3, 4], bedSlopePctMax: 3,
    catchmentHaMin: 100, catchmentHaMax: 400, condition: 'channel width < 20 m; sound foundation'},
  {name: 'Percolation tank', zone: 3, streamOrder: [3, 4], bedSlopePctMax: 3,
    catchmentKm2Min: 2.5, catchmentKm2Max: 4, condition: 'PERMEABLE BED ESSENTIAL — see 4.4', mandatoryGeophysicalSurvey: true},
  {name: 'Farm pond', zone: 3, slopePctMax: 5, condition: 'on/adjacent to treatable land'},
  {name: 'Subsurface dyke', zone: 3, bedSlopePctMax: 3, condition: 'weathered zone 5-15 m over fresh rock; across nala', mandatoryGeophysicalSurvey: true},
  {name: 'Desilting (existing)', zone: [2, 3], condition: 'existing structure with high upstream sediment yield'}
];

// ---------------------------------------------------------------------------
// 4.3 — Spacing & quantity computation
// ---------------------------------------------------------------------------
function contourTrenchSpacing(slopePctImage) {
  print('⚠ Confirm VI formula against the state technical manual — several ' +
        'variants are in use for bunding vs trenching (spec 4.3).');
  var vi = slopePctImage.divide(3).add(2).multiply(0.3).rename('vertical_interval_m');
  var horizontalSpacing = vi.divide(slopePctImage.divide(100)).rename('horizontal_spacing_m');
  return {vi: vi, horizontalSpacing: horizontalSpacing};
}

function trenchQuantityPerHa(horizontalSpacingM, trenchCrossSectionAreaM2, staggeredGapRatio) {
  var runningMetresPerHa = ee.Image(10000).divide(horizontalSpacingM).rename('running_m_per_ha');
  var adjustedRunningMetres = staggeredGapRatio ? runningMetresPerHa.multiply(staggeredGapRatio) : runningMetresPerHa;
  var earthworkVolumeM3 = adjustedRunningMetres.multiply(trenchCrossSectionAreaM2).rename('earthwork_m3_per_ha');
  return {runningMetresPerHa: adjustedRunningMetres, earthworkVolumeM3: earthworkVolumeM3};
}

function checkDamSpacing(effectiveHeightM, channelBedSlope) {
  // Spacing (m) = effective height / bed slope (m/m); toe of upper meets crest of lower.
  return ee.Image(effectiveHeightM).divide(channelBedSlope).rename('check_dam_spacing_m');
}

function structuresPerKmChannel(spacingM) {
  return ee.Image(1000).divide(spacingM).rename('structures_per_km');
}

// ---------------------------------------------------------------------------
// 4.4 — Percolation tank siting (mandatory geophysical survey flag)
// ---------------------------------------------------------------------------
function percolationTankCandidates(region, catchmentYieldImage, minCatchmentYieldM3) {
  var dem = shared.getDemUtm(region);
  var slopePct = shared.getSlopePercent(region);
  var gentleValleyFloor = slopePct.lt(3);

  var streamOrder = assets.requireExternal('STREAM_ORDER_STRAHLER', 'image').clip(region);
  var order34 = streamOrder.gte(3).and(streamOrder.lte(4));

  var sufficientYield = catchmentYieldImage.gte(minCatchmentYieldM3);

  var candidates = gentleValleyFloor.and(order34).and(sufficientYield).selfMask();

  print('⚠ MANDATORY: every percolation tank candidate site carries a ' +
        '"geophysical_survey_required" flag. Remote sensing CANNOT confirm ' +
        'subsurface permeability (spec 4.4) — an impermeable-bed tank is an ' +
        'evaporation pond, not a recharge structure, and Gujarat pan evaporation ' +
        'substantially exceeds annual rainfall. Do not construct without a ' +
        'resistivity survey at each site.');

  return candidates.rename('percolation_tank_candidate');
}

function flagStructuresRequiringGeophysics(structureFeatureCollection) {
  return structureFeatureCollection.map(function (f) {
    f = ee.Feature(f);
    var name = f.get('structure_type');
    var needsSurvey = ee.List(['Percolation tank', 'Subsurface dyke']).contains(name);
    return f.set('geophysical_survey_required', needsSurvey);
  });
}

exports.STRUCTURE_MATRIX = STRUCTURE_MATRIX;
exports.contourTrenchSpacing = contourTrenchSpacing;
exports.trenchQuantityPerHa = trenchQuantityPerHa;
exports.checkDamSpacing = checkDamSpacing;
exports.structuresPerKmChannel = structuresPerKmChannel;
exports.percolationTankCandidates = percolationTankCandidates;
exports.flagStructuresRequiringGeophysics = flagStructuresRequiringGeophysics;
