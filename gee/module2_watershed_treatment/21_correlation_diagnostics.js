/**
 * 21_correlation_diagnostics.js — Part 6: correlation & double-counting
 *
 * Mandatory diagnostic. Slope enters >=6 criteria, erosion is measured three
 * times (W1/W2/W3, nominal 36%), the drainage network enters four criteria,
 * rainfall enters four criteria. This must be a stated design decision, not
 * something a reviewer discovers.
 */

var config = require('users/<you>/VCIMF-FINAL:gee/module2_watershed_treatment/00_config.js');

function correlationMatrix(fc, properties) {
  // reduceColumns has no native pairwise-matrix reducer over N columns; build
  // the matrix pairwise, which is the reliable pattern in GEE.
  var rows = properties.map(function (p1) {
    return properties.map(function (p2) {
      var stat = fc.reduceColumns({
        reducer: ee.Reducer.pearsonsCorrelation(), selectors: [p1, p2]
      });
      return ee.Number(stat.get('correlation'));
    });
  });
  return ee.Array(rows);
}

function spearmanMatrix(fc, properties) {
  var rows = properties.map(function (p1) {
    return properties.map(function (p2) {
      var stat = fc.reduceColumns({
        reducer: ee.Reducer.spearmansCorrelation(), selectors: [p1, p2]
      });
      return ee.Number(stat.get('correlation'));
    });
  });
  return ee.Array(rows);
}

function correlationMatrixToTable(matrix, properties) {
  var rowsList = matrix.toList();
  var features = ee.List(properties).map(function (p1) {
    var idx = properties.indexOf(p1);
    var rowVals = ee.List(rowsList.get(idx));
    var props = ee.Dictionary.fromLists(properties, rowVals);
    return ee.Feature(null, props).set('criterion', p1);
  });
  return ee.FeatureCollection(features);
}

function flagDoubleCounting(matrix, properties) {
  var flags = [];
  for (var i = 0; i < properties.length; i++) {
    for (var j = i + 1; j < properties.length; j++) {
      flags.push({pair: [properties[i], properties[j]], indices: [i, j]});
    }
  }
  print('ℹ Correlation thresholds (Part 6): |r|>0.85 = same variable, merge/drop/' +
        'document; |r| 0.65-0.85 = substantial overlap, disclose in methodology; ' +
        'variance≈0 = constant, drop or replace. Inspect the exported CSV against ' +
        'these thresholds for every pair — especially W1×W2 (expected r>0.8, spec ' +
        'says decide in advance: merge into a single 28% sediment-production ' +
        'criterion, OR keep both and state the doubled weight explicitly).');
  return flags;
}

var STANDARD_14_CRITERIA = [
  'W1_SYI_norm', 'W2_RUSLE_norm', 'W3_gully_severity_norm', 'W4_degradation_trend_norm',
  'W5_connectivity_IC_norm', 'W6_flowpath_proximity_norm', 'W7_sediment_trapping_norm',
  'W8_scs_cn_runoff_norm', 'W9_morphometry_norm', 'W10_erosivity_norm',
  'W11_treatable_area_norm', 'W12_siting_feasibility_norm', 'W13_recharge_cobenefit_norm',
  'W14_treatment_saturation_norm'
];

exports.correlationMatrix = correlationMatrix;
exports.spearmanMatrix = spearmanMatrix;
exports.correlationMatrixToTable = correlationMatrixToTable;
exports.flagDoubleCounting = flagDoubleCounting;
exports.STANDARD_14_CRITERIA = STANDARD_14_CRITERIA;
