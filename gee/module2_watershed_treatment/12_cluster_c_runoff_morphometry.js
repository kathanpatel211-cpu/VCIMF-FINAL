/**
 * 12_cluster_c_runoff_morphometry.js — Cluster C (18%)
 * W8 SCS-CN runoff depth · W9 Morphometric compound parameter ·
 * W10 Rainfall erosivity
 */

var config = require('users/<you>/VCIMF-FINAL:gee/module2_watershed_treatment/00_config.js');
var assets = require('users/<you>/VCIMF-FINAL:gee/module2_watershed_treatment/02_external_assets.js');
var shared = require('users/<you>/VCIMF-FINAL:gee/module2_watershed_treatment/01_shared_layers.js');

// ---------------------------------------------------------------------------
// W8 — SCS-CN runoff depth
// ---------------------------------------------------------------------------

// Hydrologic Soil Group derived directly from texture + soil-depth proxy
// using USDA HSG criteria — RECOMMENDED for this terrain (spec W8 warning:
// global HYSOGs250m/GCN250 misclassify hard-rock Aravalli terrain as A/B).
function deriveHsgFromTexture(region) {
  var tex = shared.getSoilTexture(region);
  var clay = tex.select('clay_pct');
  var sand = tex.select('sand_pct');
  var depthProxy = shared.getSoilDepthProxy(region); // 0 (shallow) - 1 (deep)

  // USDA-style HSG classification, coded 1=A .. 4=D.
  // High clay + shallow soil over fractured/impermeable gneiss -> C/D, per spec.
  var hsg = ee.Image(1)
    .where(sand.gt(70).and(depthProxy.gt(0.6)), 1)                       // A: deep, sandy
    .where(sand.lte(70).and(sand.gt(50)).and(depthProxy.gt(0.4)), 2)     // B
    .where(clay.gt(20).or(depthProxy.lte(0.4)), 3)                       // C: moderate clay or shallow
    .where(clay.gt(35).or(depthProxy.lte(0.2)), 4)                      // D: high clay or very shallow (thin soils over gneiss/quartzite)
    .rename('hsg');
  return hsg;
}

function checkHsgPlausibility(hsgImage, hillTalukaBoundary) {
  var hist = hsgImage.reduceRegion({
    reducer: ee.Reducer.frequencyHistogram(), geometry: hillTalukaBoundary,
    scale: config.SCALE, maxPixels: 1e13, tileScale: config.TILE_SCALE
  });
  print('⚠ MANDATORY CHECK (spec W8): HSG distribution over hill talukas ' +
        '(Khedbrahma, Vijaynagar). Expect predominantly C/D (codes 3-4). If A/B ' +
        '(codes 1-2) dominate, HSG derivation is wrong and runoff is underestimated.', hist);
  return hist;
}

var CN_LOOKUP_AMC_II = {
  // [HSG A, B, C, D] by WorldCover class — SCS standard table values, cite the
  // specific table edition used in the DPR methodology annex.
  10: [30, 55, 70, 77],  // Tree cover
  20: [35, 56, 70, 77],  // Shrubland
  30: [49, 69, 79, 84],  // Grassland (fair condition)
  40: [67, 78, 85, 89],  // Cropland (row crop, straight row, poor)
  50: [77, 85, 90, 92],  // Built-up
  60: [72, 82, 88, 90],  // Bare / sparse
  80: [100, 100, 100, 100], // Water
  90: [78, 85, 89, 91],  // Wetland herbaceous
  100: [45, 66, 77, 83]  // Moss/lichen
};

function curveNumberAmcII(region) {
  var hsg = deriveHsgFromTexture(region);
  var wc = assets.getWorldCover().clip(region);
  var cn = ee.Image(80); // default
  Object.keys(CN_LOOKUP_AMC_II).forEach(function (code) {
    var vals = CN_LOOKUP_AMC_II[code];
    [1, 2, 3, 4].forEach(function (hsgClass, idx) {
      cn = cn.where(wc.eq(parseInt(code, 10)).and(hsg.eq(hsgClass)), vals[idx]);
    });
  });
  return cn.rename('cn_amc_ii');
}

function convertCnAmc(cnII, targetAmc) {
  if (targetAmc === 'I') {
    return cnII.multiply(4.2).divide(ee.Image(10).subtract(cnII.multiply(0.058))).rename('cn_amc_i');
  } else if (targetAmc === 'III') {
    return cnII.multiply(23).divide(ee.Image(10).add(cnII.multiply(0.13))).rename('cn_amc_iii');
  }
  return cnII;
}

function scsRunoff(rainfallMm, cn, lambda) {
  lambda = lambda === undefined ? config.POLICY.SCS_CN_LAMBDA : lambda;
  var S = ee.Image(25400).divide(cn).subtract(254);
  var Ia = S.multiply(lambda);
  var excess = rainfallMm.subtract(Ia);
  var Q = excess.pow(2).divide(excess.add(S)).max(0);
  return Q.rename('runoff_depth_mm');
}

function meanAnnualRunoffDepth(region, startYear, endYear, amc) {
  amc = amc || 'II';
  var cnII = curveNumberAmcII(region);
  var cn = amc === 'II' ? cnII : convertCnAmc(cnII, amc);
  var chirps = assets.getChirps().filterBounds(region);
  var years = ee.List.sequence(startYear, endYear);
  var annualQ = ee.ImageCollection(years.map(function (y) {
    y = ee.Number(y);
    var annualP = chirps.filterDate(ee.Date.fromYMD(y, 1, 1), ee.Date.fromYMD(y.add(1), 1, 1)).sum();
    return scsRunoff(annualP, cn, config.POLICY.SCS_CN_LAMBDA).set('year', y);
  }));
  print('ℹ SCS-CN lambda = ' + config.POLICY.SCS_CN_LAMBDA + ' (declared explicitly, ' +
        'spec W8). Re-run with POLICY.SCS_CN_LAMBDA_ALT = ' + config.POLICY.SCS_CN_LAMBDA_ALT +
        ' if a sensitivity range is required for the DPR.');
  return annualQ.mean().rename('mean_annual_runoff_mm');
}

// ---------------------------------------------------------------------------
// W9 — Morphometric compound parameter
// Computed entirely from the externally derived stream network + watershed
// polygons. Direction table per spec (Lo and the four shape parameters are
// INVERSE — low value = high erosion priority = rank 1, per the spec's
// explicit correction of the common published-literature error).
// ---------------------------------------------------------------------------
var MORPHOMETRY_PARAMS = {
  Dd: 'direct', Fs: 'direct', Rb: 'direct', T: 'direct',
  Lo: 'inverse',            // 1/(2Dd) — spec: commonly mis-ranked, must be LOW=priority
  Rh: 'direct', Rn: 'direct',
  Rf: 'inverse', Rc: 'inverse', Re: 'inverse', Cc: 'inverse'
};

function computeMorphometryPerWatershed(microwatersheds, streamLines, demUtm) {
  return microwatersheds.map(function (ws) {
    ws = ee.Feature(ws);
    var geom = ws.geometry();
    var areaM2 = geom.area(1);
    var areaKm2 = areaM2.divide(1e6);
    var perimeterM = geom.perimeter(1);

    var streamsHere = streamLines.filterBounds(geom).map(function (s) {
      return ee.Feature(s).intersection(geom, 1);
    }).filter(ee.Filter.notNull(['order']));

    var totalStreamLenM = streamsHere.geometry().length(1);
    var Dd = ee.Number(totalStreamLenM).divide(1000).divide(areaKm2); // km/km^2

    var streamCount = streamsHere.size();
    var Fs = ee.Number(streamCount).divide(areaKm2);

    // Bifurcation ratio: Nu / Nu+1, averaged across consecutive orders present.
    var maxOrder = ee.Number(streamsHere.aggregate_max('order'));
    var orders = ee.List.sequence(1, maxOrder);
    var countsByOrder = orders.map(function (o) {
      return streamsHere.filter(ee.Filter.eq('order', o)).size();
    });
    var rbList = ee.List.sequence(0, orders.length().subtract(2)).map(function (i) {
      i = ee.Number(i);
      var nu = ee.Number(countsByOrder.get(i));
      var nu1 = ee.Number(countsByOrder.get(i.add(1)));
      return nu1.eq(0) ? null : nu.divide(nu1);
    });
    var Rb = ee.Number(ee.List(rbList).reduce(ee.Reducer.mean()));

    var T = ee.Number(streamCount).divide(ee.Number(perimeterM).divide(1000)); // per km perimeter

    var Lo = ee.Number(1).divide(Dd.multiply(2));

    var elevMinMax = demUtm.reduceRegion({
      reducer: ee.Reducer.minMax(), geometry: geom, scale: config.SCALE,
      maxPixels: 1e9, tileScale: config.TILE_SCALE
    });
    var H = ee.Number(elevMinMax.get('elevation_max')).subtract(ee.Number(elevMinMax.get('elevation_min')));

    // Basin length Lb — coarse proxy (sqrt(area) scaled by an elongation
    // constant) pending the true basin-length-along-thalweg (max flow length,
    // Part 2 step 8 DownslopeFlowpathLength max per watershed), which should
    // replace this once that raster is available.
    var Lb = ee.Number(areaM2).sqrt().multiply(1.5);

    var Rh = H.divide(Lb);
    var Rn = H.multiply(Dd);
    var Rf = areaM2.divide(Lb.pow(2));
    var Rc = ee.Number(4 * Math.PI).multiply(areaM2).divide(ee.Number(perimeterM).pow(2));
    var Re = ee.Number(2).divide(Lb).multiply(areaM2.divide(Math.PI).sqrt());
    var Cc = ee.Number(0.2821).multiply(perimeterM).divide(areaM2.sqrt());

    return ws.set({
      area_km2: areaKm2, perimeter_m: perimeterM,
      Dd: Dd, Fs: Fs, Rb: Rb, T: T, Lo: Lo, H_relief_m: H, Lb_m: Lb,
      Rh: Rh, Rn: Rn, Rf: Rf, Rc: Rc, Re: Re, Cc: Cc,
      W9_Lb_is_coarse_proxy: true
    });
  });
}

// Rank-based compound parameter (classical method) — kept for the audit trail,
// but NOT what feeds the composite score (spec Part 6: averaging all 11 ranks
// equally double/quadruple-counts density and shape). See selectRepresentativeParams().
function rankCompoundParameter(fc) {
  var params = Object.keys(MORPHOMETRY_PARAMS);
  var withRanks = fc;
  params.forEach(function (p) {
    var direction = MORPHOMETRY_PARAMS[p];
    var sorted = withRanks.sort(p, direction === 'inverse'); // ascending if inverse (lowest=rank1)
    var list = sorted.toList(sorted.size());
    withRanks = ee.FeatureCollection(ee.List.sequence(0, list.size().subtract(1)).map(function (i) {
      var f = ee.Feature(list.get(i));
      return f.set('rank_' + p, ee.Number(i).add(1));
    }));
  });
  return withRanks.map(function (f) {
    var rankSum = params.map(function (p) { return ee.Number(f.get('rank_' + p)); })
      .reduce(function (a, b) { return ee.Number(a).add(b); });
    return f.set('Cp_compound_rank', ee.Number(rankSum).divide(params.length));
  });
}

// Recommended fix (b): one representative parameter per correlated cluster
// (spec Part 6 / W9): Dd for density, Rc for shape, Rn for relief.
// Report the correlation matrix regardless (21_correlation_diagnostics.js).
function selectRepresentativeParams(fc) {
  return fc.map(function (f) {
    f = ee.Feature(f);
    var ddNorm = f.get('Dd');   // density representative (direct)
    var rcNorm = f.get('Rc');   // shape representative (inverse)
    var rnNorm = f.get('Rn');   // relief representative (direct)
    return f.set('W9_representative_params', ee.List([ddNorm, rcNorm, rnNorm]));
  });
}

// ---------------------------------------------------------------------------
// W10 — Rainfall erosivity
// ---------------------------------------------------------------------------
function monsoonConcentrationIndex(region, startYear, endYear) {
  var chirps = assets.getChirps().filterBounds(region);
  var years = ee.List.sequence(startYear, endYear);
  var ratios = years.map(function (y) {
    y = ee.Number(y);
    var annual = chirps.filterDate(ee.Date.fromYMD(y, 1, 1), ee.Date.fromYMD(y.add(1), 1, 1)).sum();
    var monsoon = chirps.filterDate(
      ee.Date.fromYMD(y, config.POLICY.MONSOON_MONTHS[0], 1),
      ee.Date.fromYMD(y, config.POLICY.MONSOON_MONTHS[config.POLICY.MONSOON_MONTHS.length - 1], 30).advance(1, 'day')
    ).sum();
    return monsoon.divide(annual.max(1)).rename('monsoon_fraction').set('year', y);
  });
  return ee.ImageCollection(ratios).mean();
}

function erosiveEventFrequency(region, startYear, endYear) {
  var chirps = assets.getChirps().filterBounds(region)
    .filterDate(startYear + '-01-01', (endYear + 1) + '-01-01');
  var erosiveDays = chirps.map(function (img) {
    return img.gt(config.POLICY.EROSIVE_EVENT_THRESHOLD_MM).rename('erosive_day');
  });
  var totalEvents = erosiveDays.sum();
  var nYears = endYear - startYear + 1;
  print('ℹ Erosive-event threshold = ' + config.POLICY.EROSIVE_EVENT_THRESHOLD_MM +
        ' mm/day (spec W10, standard cutoff, stated explicitly).');
  return totalEvents.divide(nYears).rename('mean_annual_erosive_event_count');
}

function reportErosivityLimitation() {
  print('⚠ CHIRPS is ~5.5 km resolution — across the Sabarmati catchments in ' +
        'Sabarkantha this is a few hundred pixels. Erosivity/R-factor and this ' +
        'criterion vary as a smooth regional gradient with NO micro-watershed-scale ' +
        'detail; adjacent watersheds will often share an identical value. This is ' +
        'why W10 carries only 4% weight — do not raise it, and do not present this ' +
        'layer as resolving at watershed scale (spec W10).');
}

exports.deriveHsgFromTexture = deriveHsgFromTexture;
exports.checkHsgPlausibility = checkHsgPlausibility;
exports.CN_LOOKUP_AMC_II = CN_LOOKUP_AMC_II;
exports.curveNumberAmcII = curveNumberAmcII;
exports.convertCnAmc = convertCnAmc;
exports.scsRunoff = scsRunoff;
exports.meanAnnualRunoffDepth = meanAnnualRunoffDepth;
exports.MORPHOMETRY_PARAMS = MORPHOMETRY_PARAMS;
exports.computeMorphometryPerWatershed = computeMorphometryPerWatershed;
exports.rankCompoundParameter = rankCompoundParameter;
exports.selectRepresentativeParams = selectRepresentativeParams;
exports.monsoonConcentrationIndex = monsoonConcentrationIndex;
exports.erosiveEventFrequency = erosiveEventFrequency;
exports.reportErosivityLimitation = reportErosivityLimitation;
