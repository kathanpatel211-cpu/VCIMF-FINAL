/**
 * 20_tier1_scoring.js — Part 5: normalisation & scoring
 *
 * Unlike Module 1 (pixel scoring), Tier 1 operates on a FeatureCollection of
 * ~200-600 micro-watershed polygons. Normalisation is a percentile stretch
 * ACROSS THE WATERSHED POPULATION, not across pixels, and rank-based scoring
 * is offered as an equally defensible alternative given the small population.
 */

var config = require('users/<you>/VCIMF-FINAL:gee/module2_watershed_treatment/00_config.js');

// ---------------------------------------------------------------------------
// Percentile (2nd-98th) stretch across the watershed population for one
// criterion property, applied AFTER direction has already been resolved
// (direction lives only in config.CRITERION_DIRECTION — Part 5 discipline).
// ---------------------------------------------------------------------------
function normaliseCriterion(fc, propertyName, criterionKey) {
  var direction = config.CRITERION_DIRECTION[criterionKey];
  if (direction === undefined) {
    throw 'No direction declared for ' + criterionKey + ' in 00_config.js CRITERION_DIRECTION.';
  }
  var stats = fc.reduceColumns({
    reducer: ee.Reducer.percentile([2, 98]), selectors: [propertyName]
  });
  var p2 = ee.Number(stats.get('p2'));
  var p98 = ee.Number(stats.get('p98'));
  var range = p98.subtract(p2);

  return fc.map(function (f) {
    var raw = ee.Number(f.get(propertyName));
    var clamped = raw.max(p2).min(p98);
    var stretched = range.eq(0) ? ee.Number(0.5) : clamped.subtract(p2).divide(range);
    var directed = direction === -1 ? ee.Number(1).subtract(stretched) : stretched;
    return f.set(criterionKey + '_norm', directed);
  });
}

// Rank-based alternative: convert to a 0-1 percentile rank (direction-resolved).
function rankNormaliseCriterion(fc, propertyName, criterionKey) {
  var direction = config.CRITERION_DIRECTION[criterionKey];
  var sorted = fc.sort(propertyName, direction === 1); // ascending if direction=1 so last=best... see below
  var n = sorted.size();
  var list = sorted.toList(n);
  var ranked = ee.FeatureCollection(ee.List.sequence(0, n.subtract(1)).map(function (i) {
    var f = ee.Feature(list.get(i));
    // ascending order index i=0 is the lowest raw value; convert to a 0-1
    // priority rank where 1.0 = highest priority given the declared direction.
    var priorityRank = ee.Number(i).divide(n.subtract(1).max(1));
    return f.set(criterionKey + '_rank_norm', direction === 1 ? priorityRank : ee.Number(1).subtract(priorityRank));
  }));
  return ranked;
}

// ---------------------------------------------------------------------------
// Weighted linear sum + geometric-mean variant (Part 5: "compute both ... for comparison")
// ---------------------------------------------------------------------------
function weightedSumScore(fc, normSuffix) {
  normSuffix = normSuffix || '_norm';
  var criteria = Object.keys(config.CRITERION_WEIGHTS);
  return fc.map(function (f) {
    f = ee.Feature(f);
    var weightedTerms = criteria.map(function (c) {
      var v = f.get(c + normSuffix);
      var w = config.CRITERION_WEIGHTS[c];
      return ee.Algorithms.If(v, ee.Number(v).multiply(w), 0);
    });
    var total = ee.List(weightedTerms).reduce(ee.Reducer.sum());
    return f.set('tier1_weighted_sum_score', total);
  });
}

function geometricMeanScore(fc, normSuffix) {
  normSuffix = normSuffix || '_norm';
  var criteria = Object.keys(config.CRITERION_WEIGHTS);
  return fc.map(function (f) {
    f = ee.Feature(f);
    var logSum = criteria.map(function (c) {
      var v = f.get(c + normSuffix);
      var w = config.CRITERION_WEIGHTS[c];
      return ee.Algorithms.If(v, ee.Number(v).max(1e-6).log().multiply(w), 0);
    }).reduce(function (a, b) { return ee.Number(a).add(b); }, ee.Number(0));
    return f.set('tier1_geometric_mean_score', ee.Number(logSum).exp());
  });
}

// Which criterion drove each watershed's rank (spec Part 9 export: dominant_criterion).
function dominantCriterion(fc, normSuffix) {
  normSuffix = normSuffix || '_norm';
  var criteria = Object.keys(config.CRITERION_WEIGHTS);
  return fc.map(function (f) {
    f = ee.Feature(f);
    var contributions = criteria.map(function (c) {
      var v = f.get(c + normSuffix);
      var w = config.CRITERION_WEIGHTS[c];
      return ee.Algorithms.If(v, ee.Number(v).multiply(w), 0);
    });
    var maxContribution = ee.List(contributions).reduce(ee.Reducer.max());
    var maxIndex = ee.List(contributions).indexOf(maxContribution);
    var dominant = ee.List(criteria).get(maxIndex);
    return f.set('dominant_criterion', dominant, 'dominant_criterion_contribution', maxContribution);
  });
}

// Priority classification into 5 classes (Very High -> Very Low) for the DPR map.
function classifyPriority(fc, scoreProperty) {
  var stats = fc.reduceColumns({reducer: ee.Reducer.percentile([20, 40, 60, 80]), selectors: [scoreProperty]});
  var p20 = ee.Number(stats.get('p20')), p40 = ee.Number(stats.get('p40'));
  var p60 = ee.Number(stats.get('p60')), p80 = ee.Number(stats.get('p80'));
  return fc.map(function (f) {
    var s = ee.Number(f.get(scoreProperty));
    var cls = ee.Algorithms.If(s.gte(p80), 'Very High',
      ee.Algorithms.If(s.gte(p60), 'High',
        ee.Algorithms.If(s.gte(p40), 'Medium',
          ee.Algorithms.If(s.gte(p20), 'Low', 'Very Low'))));
    return f.set('priority_class', cls);
  });
}

// Compare weighted-sum vs rank-sum top-20 lists (Part 5 recommendation).
function compareTopN(fc, scoreA, scoreB, n) {
  var topA = fc.sort(scoreA, false).limit(n).aggregate_array('system:index');
  var topB = fc.sort(scoreB, false).limit(n).aggregate_array('system:index');
  var overlap = topA.filter(ee.Filter.inList('item', topB));
  print('ℹ Top-' + n + ' overlap between weighted-sum and rank-sum: ' +
        'compare topA/topB lists below. Substantial disagreement means one or ' +
        'two criteria distributions are driving the result, not the underlying ' +
        'signal (Part 5) — investigate before publishing.', {topA: topA, topB: topB});
  return {topA: topA, topB: topB, overlap: overlap};
}

exports.normaliseCriterion = normaliseCriterion;
exports.rankNormaliseCriterion = rankNormaliseCriterion;
exports.weightedSumScore = weightedSumScore;
exports.geometricMeanScore = geometricMeanScore;
exports.dominantCriterion = dominantCriterion;
exports.classifyPriority = classifyPriority;
exports.compareTopN = compareTopN;
