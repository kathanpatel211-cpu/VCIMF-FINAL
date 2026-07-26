/**
 * 40_convergence_map.js — Part 8.3: the convergence map
 *
 * Cross-tabulates Module 2 watershed priority against Module 1 plantation
 * suitability. Module 1 does not exist in this repository yet — this
 * function accepts a Module 1 output (pixel suitability image or a
 * per-micro-watershed aggregated suitability property) as a parameter so it
 * can be wired in the moment Module 1 is built, without changing this file.
 */

var config = require('users/<you>/VCIMF-FINAL:gee/module2_watershed_treatment/00_config.js');

// suitabilityByWatershed: FeatureCollection with a 'module1_suitability_class'
// property already aggregated to the same micro-watershed units (mean
// suitability score classified High/Low upstream, in Module 1's own script,
// using Module 1's own thresholds — not reinvented here).
function convergenceMap(prioritisedWatersheds, suitabilityByWatershed) {
  var joined = ee.Join.saveFirst('m1').apply(
    prioritisedWatersheds, suitabilityByWatershed,
    ee.Filter.equals({leftField: 'system:index', rightField: 'system:index'})
  );

  return ee.FeatureCollection(joined).map(function (f) {
    f = ee.Feature(f);
    var m1 = ee.Feature(f.get('m1'));
    var m2PriorityClass = f.get('priority_class'); // Very High/High/Medium/Low/Very Low
    var m2High = ee.List(['Very High', 'High']).contains(m2PriorityClass);
    var m1SuitClass = ee.Algorithms.If(m1, m1.get('module1_suitability_class'), 'Unknown');
    var m1High = ee.String(m1SuitClass).match('High').length().gt(0);

    var prescription = ee.Algorithms.If(m2High,
      ee.Algorithms.If(m1High,
        'Integrated treatment — SMC works + plantation together (highest return per rupee; execute first)',
        'SMC works only — mechanical treatment, minimal planting'),
      ee.Algorithms.If(m1High,
        'Plantation with basic moisture conservation only',
        'Defer'));

    return f.set({
      module1_suitability_class: m1SuitClass,
      module2_priority_class: m2PriorityClass,
      convergence_prescription: prescription,
      is_high_high: m2High.and(m1High)
    });
  });
}

function sequencingNote() {
  return 'Within a convergence High-High block, SMC works precede or accompany ' +
    'planting — trenches dug the same season, before or with monsoon planting, ' +
    'capture that year\'s runoff for the saplings. Trenches dug two years later ' +
    'have already lost two establishment seasons (Part 8.3 sequencing note — must ' +
    'appear in the DPR).';
}

exports.convergenceMap = convergenceMap;
exports.sequencingNote = sequencingNote;
