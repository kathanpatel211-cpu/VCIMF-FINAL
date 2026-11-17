/* ######################################################################
 *  PPI-SK v2.1 — Plantation Priority Index, Khedbrahma Range
 *  SCRIPT 02_scoring   (build steps 18-25)
 *  ----------------------------------------------------------------------
 *  STAGE 'SCORE'   : loads the raw checkpoint table -> gap fill, CV guard,
 *                    collinearity screen (Spearman + VIF), weight changes,
 *                    theme scores, PPI, categories, prescription, site
 *                    class, Monte Carlo (K = 500), one-at-a-time
 *                    sensitivity, qc_log -> FINAL table asset + CSVs.
 *  STAGE 'PUBLISH' : loads the FINAL asset -> maps on screen with legend,
 *                    GeoTIFFs, SHP, GeoJSON, field-check list.
 *  How to run      : 1) STAGE = 'SCORE'  -> Run -> RUN all tasks.
 *                    2) when PPI02_final_to_asset is done:
 *                       STAGE = 'PUBLISH' -> Run -> RUN all tasks.
 *  Only this script re-runs when weights, thresholds or rules change.
 * ###################################################################### */

var CFG = {
  STAGE: 'SCORE',                // 'SCORE' or 'PUBLISH'
  PUBLISH_NOW: false,            // true = show the final map and create all exports in the SCORE run
  CRS: 'EPSG:32643',             // working CRS of the range (same as script 01)
  RANGE_NAME: 'Khedbrahma',
  AOI_ASSET: 'projects/khedbrahma-range/assets/khedbrahma',
  RAW_ASSET: 'projects/khedbrahma-range/assets/PPI_SK_v21_raw_blocks_Khedbrahma',
  QC01_ASSET: 'projects/khedbrahma-range/assets/PPI_SK_v21_qc01_Khedbrahma',
  FINAL_ASSET: 'projects/khedbrahma-range/assets/PPI_SK_v21_final_blocks_Khedbrahma',
  DRIVE_FOLDER: 'PPI_SK_v21',
  EXPECTED_ANCHOR_ID: null,      // e.g. 'GJ_2026-11_v2.1' to enforce FF-09 match

  // Section 7: sub-weights (points, total 100). Expert point allocation (Section 11.1).
  WEIGHTS: {
    A1: 10, A2: 3, A3: 9, A5: 4,
    B1: 5, B2: 4, B3: 3, B4: 2, B5: 2, B6: 4, B7: 4,
    C1s: 5, C2s: 5, C3s: 2,
    D1: 6, D2: 5, D3: 3, D4: 3, D5: 3, D6: 4,
    E1: 5, E2: 4, E4: 5
  },
  // Section 10.4 prescription thresholds (DFO may change; change is logged)
  RX: {FIRE_E1: 0.55, SMC_A: 0.35, SMC_B: 0.35, INVASIVE_D5: 0.30},
  SITE_SPLITS: [0.33, 0.66],
  // Section 11
  MC_K: 500, MC_SEED: 2026, MC_CONC: 125,
  CV_MIN: 0.05, RHO_MAX: 0.75, VIF_MAX: 5, A3_RHO_MAX: 0.60, OAT_MAX_SHARE: 0.15
};

var THEMES = {
  A: ['A1', 'A2', 'A3', 'A5'],
  B: ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7'],
  C: ['C1s', 'C2s', 'C3s'],
  D: ['D1', 'D2', 'D3', 'D4', 'D5', 'D6'],
  E: ['E1', 'E2', 'E4']
};
var THEME_KEYS = ['A', 'B', 'C', 'D', 'E'];
var PARAMS = [].concat(THEMES.A, THEMES.B, THEMES.C, THEMES.D, THEMES.E);   // 23
var THEME_OF = {};
THEME_KEYS.forEach(function (t) { THEMES[t].forEach(function (k) { THEME_OF[k] = t; }); });
var THEME_PTS = {};
THEME_KEYS.forEach(function (t) {
  THEME_PTS[t] = THEMES[t].reduce(function (s, k) { return s + CFG.WEIGHTS[k]; }, 0);
});
var PALETTE = ['#d73027', '#fc8d59', '#fee08b', '#d9ef8b', '#1a9850'];
var RX_CODES = {
  PROTECT_DENSE: 1, NOT_PLANTABLE: 2, FIRE_PROTECTION_FIRST: 3, SMC_FIRST: 4,
  INVASIVE_CLEAR_THEN_PLANT: 5, GAP_PLANTING_ANR: 6, FULL_PLANTATION: 7
};
var RX_PALETTE = ['#1a9850', '#969696', '#e31a1c', '#8c510a', '#984ea3', '#80cdc1', '#2166ac'];
var AOI_FC = ee.FeatureCollection(CFG.AOI_ASSET);
var AOI = AOI_FC.geometry().dissolve({maxError: 1});

/* ---------- Publishing: maps, legend, GeoTIFF/SHP/GeoJSON, field list ---------- */
function publishAll(fin, mapFC) {
  mapFC = mapFC || fin;
var CRS = CFG.CRS;
print('Working CRS:', CRS, '| recorded in table:', ee.Feature(fin.first()).get('work_crs'));
var tag2 = CFG.RANGE_NAME;

function blockRaster(prop, src) { return (src || mapFC).reduceToImage([prop], ee.Reducer.first()).rename(prop); }
var catImg = blockRaster('category').toByte();
var rxImg = blockRaster('rx_code').toByte();
var stabImg = blockRaster('stability_cat12', fin).toFloat();

/* ---- GeoTIFFs (products 4-7) ---- */
function exportImg(img, name, scale) {
  Export.image.toDrive({image: img.clip(AOI), description: 'PPI02_' + name, folder: CFG.DRIVE_FOLDER,
    fileNamePrefix: 'PPI02_' + name + '_' + tag2, region: AOI, crs: CRS, scale: scale, maxPixels: 1e11});
}
exportImg(catImg, 'category_map', 30);
exportImg(rxImg, 'prescription_map', 30);
exportImg(stabImg, 'stability_map', 30);
THEME_KEYS.forEach(function (t) { exportImg(blockRaster(t).toFloat(), 'theme_' + t + '_map', 30); });

/* ---- Block polygons: GeoJSON (all fields) + SHP (short field names) ---- */
Export.table.toDrive({collection: fin, description: 'PPI02_blocks_geojson', folder: CFG.DRIVE_FOLDER,
  fileNamePrefix: 'PPI02_blocks_' + tag2, fileFormat: 'GeoJSON'});
var SHP_FROM = ['block_id', 'beat_id', 'block_area_ha', 'net_plantable_ha', 'canopy_pct', 'canopy_track',
  'constraint_flag', 'constraint_reason', 'A', 'B', 'C', 'D', 'E', 'PPI_absolute', 'PPI_percentile',
  'category', 'prescription', 'site_class', 'stability_cat12', 'category_modal', 'category_range',
  'b1_sensitive', 'recent_plantation_flag', 'protected_area_flag', 'fire_years', 'advisory_access_km',
  'field_check', 'anchor_id'];
var SHP_TO = ['block_id', 'beat_id', 'area_ha', 'net_ha', 'canopy', 'can_track',
  'cons_flag', 'cons_rsn', 'A', 'B', 'C', 'D', 'E', 'ppi_abs', 'ppi_pct',
  'category', 'rx', 'site_cls', 'stab12', 'cat_modal', 'cat_range',
  'b1_sens', 'f1_plant', 'f2_pa', 'fire_yrs', 'access_km',
  'field_chk', 'anchor_id'];
Export.table.toDrive({collection: fin.select(SHP_FROM, SHP_TO), description: 'PPI02_blocks_shp',
  folder: CFG.DRIVE_FOLDER, fileNamePrefix: 'PPI02_blocks_' + tag2, fileFormat: 'SHP'});

/* ---- Product 10: field-check list, sorted by beat ---- */
var FIELD_COLS = ['beat_id', 'block_id', 'category', 'PPI_absolute', 'stability_cat12', 'stability_reading',
  'prescription', 'site_class', 'net_plantable_ha', 'canopy_pct', 'constraint_reason',
  'recent_plantation_flag', 'protected_area_flag', 'b1_sensitive', 'field_check_reason',
  'fra_rights_check_required', 'staff_rights_FRA_checked', 'staff_encroachment_checked', 'staff_decision', 'staff_remarks'];
var fieldList = fin.filter(ee.Filter.eq('field_check', 'yes'))
  .map(function (f) {
    var c = f.centroid(1).geometry().coordinates();
    return f.set({staff_rights_FRA_checked: '', staff_encroachment_checked: '',
                  staff_decision: '', staff_remarks: '',
                  lon: c.get(0), lat: c.get(1)});
  })
  .sort('category').sort('beat_id');
Export.table.toDrive({collection: fieldList, description: 'PPI02_field_check_list',
  folder: CFG.DRIVE_FOLDER, fileNamePrefix: 'PPI02_field_check_list_' + tag2, fileFormat: 'CSV',
  selectors: FIELD_COLS.concat(['lon', 'lat'])});

/* ---- On-screen maps and legend (for presentation) ---- */
Map.centerObject(AOI, 11);
Map.setOptions('HYBRID');
THEME_KEYS.forEach(function (t) {
  Map.addLayer(blockRaster(t), {min: 0, max: 1, palette: ['#f7fbff', '#08306b']}, 'Theme ' + t, false);
});
Map.addLayer(stabImg, {min: 0, max: 1, palette: ['#d73027', '#ffffbf', '#1a9850']},
             'Stability (share of MC runs in Cat 1-2)', false);
Map.addLayer(rxImg, {min: 1, max: 7, palette: RX_PALETTE}, 'Prescription', false);
Map.addLayer(catImg, {min: 1, max: 5, palette: PALETTE}, 'PPI category 1-5');
Map.addLayer(ee.Image().byte().paint(fin, 1, 0.5), {palette: ['#333333']}, 'Block outlines', false);
Map.addLayer(ee.Image().byte().paint(AOI_FC, 1, 2), {palette: ['black']}, 'Range boundary');

function legendRow(color, label) {
  return ui.Panel([
    ui.Label('', {backgroundColor: color, padding: '8px', margin: '2px 6px 2px 0'}),
    ui.Label(label, {margin: '2px 0', fontSize: '12px'})
  ], ui.Panel.Layout.flow('horizontal'));
}
var legend = ui.Panel({style: {position: 'bottom-left', padding: '8px 12px'}});
legend.add(ui.Label('PPI-SK v2.1 — ' + CFG.RANGE_NAME + ' Range',
                    {fontWeight: 'bold', fontSize: '14px', margin: '0 0 4px 0'}));
legend.add(ui.Label('Plantation priority category', {fontWeight: 'bold', fontSize: '12px'}));
['1  Highest priority', '2  High', '3  Moderate, phased', '4  Low', '5  No plantation / excluded']
  .forEach(function (l, ii) { legend.add(legendRow(PALETTE[ii], l)); });
legend.add(ui.Label('Prescription layer', {fontWeight: 'bold', fontSize: '12px', margin: '6px 0 0 0'}));
Object.keys(RX_CODES).forEach(function (k) { legend.add(legendRow(RX_PALETTE[RX_CODES[k] - 1], k)); });
Map.add(legend);

/* ---- Summary chart and table ---- */
var catChart = ui.Chart.feature.histogram({features: mapFC, property: 'category', minBucketWidth: 1})
  .setOptions({title: 'Blocks per PPI category', hAxis: {title: 'Category'}, vAxis: {title: 'Blocks'},
               colors: ['#d73027'], legend: {position: 'none'}});
print(catChart);
var rxArea = mapFC.reduceColumns(ee.Reducer.sum().group({groupField: 1, groupName: 'prescription'}),
                               ['net_plantable_ha', 'prescription']);
print('Net plantable area (ha) by prescription:', rxArea.get('groups'));
var catArea = mapFC.reduceColumns(ee.Reducer.sum().group({groupField: 1, groupName: 'category'}),
                                ['net_plantable_ha', 'category']);
print('Net plantable area (ha) by category:', catArea.get('groups'));
print('Field-check blocks:', fieldList.size());
}

/* ====================================================================== */
if (CFG.STAGE === 'SCORE') {
/* ====================================================================== */

var raw = ee.FeatureCollection(CFG.RAW_ASSET);
var N_ALL = raw.size();
var FILL_KEYS = PARAMS.concat(['B1_opt', 'B1_pes']);

/* ---------- Step 18a: null shares (FF-06) and gap fill by beat mean ---------- */
var nullShare = ee.Dictionary.fromLists(FILL_KEYS, FILL_KEYS.map(function (k) {
  return ee.Number(1).subtract(raw.filter(ee.Filter.notNull([k])).size().divide(N_ALL));
}));

var BEAT_MEAN = {}, RANGE_MEAN = {};
FILL_KEYS.forEach(function (k) {
  var ok = raw.filter(ee.Filter.notNull([k]));
  var groups = ee.List(ok.reduceColumns(
    ee.Reducer.mean().group({groupField: 1, groupName: 'beat'}), [k, 'beat_id']).get('groups'));
  BEAT_MEAN[k] = ee.Dictionary.fromLists(
    groups.map(function (g) { return ee.String(ee.Dictionary(g).get('beat')); }),
    groups.map(function (g) { return ee.Dictionary(g).get('mean'); }));
  RANGE_MEAN[k] = ee.Algorithms.If(ok.size().gt(0), ok.aggregate_mean(k), 0.5);
});

var filled = raw.map(function (f) {
  var beat = ee.String(f.get('beat_id'));
  var out = f;
  var log = ee.List([]);
  FILL_KEYS.forEach(function (k) {
    var v = f.get(k);
    var isNull = ee.Algorithms.IsEqual(v, null);
    out = out.set(k, ee.Algorithms.If(isNull, BEAT_MEAN[k].get(beat, RANGE_MEAN[k]), v));
    log = ee.List(ee.Algorithms.If(isNull, log.add(k), log));
  });
  return out.set('gapfilled', log.join(','));
});
var retained0 = filled.filter(ee.Filter.eq('excluded', 0));

/* ---------- Step 18b: CV guard statistics (FF-10) ---------- */
var statD = {};
PARAMS.forEach(function (k) {
  statD[k + '_mean'] = retained0.aggregate_mean(k);
  statD[k + '_sd'] = retained0.aggregate_sample_sd(k);
});
print('Computing block statistics in the background ...');
ee.Dictionary({
  N_all: N_ALL, N_ret: retained0.size(), nullShare: nullShare, stats: ee.Dictionary(statD)
}).evaluate(function (STATS, errS) {
if (errS) { print('STOP: could not read the raw block table (has STEP 2 finished?): ' + errS); return; }
print('Blocks: all =', STATS.N_all, ' retained =', STATS.N_ret);
var NR = STATS.N_ret;
if (NR < 10) { print('STOP: fewer than 10 retained blocks — check the raw table.'); return; }

function sdOf(k) { var v = STATS.stats[k + '_sd']; return (typeof v === 'number') ? v : 0; }
function meanOf(k) { var v = STATS.stats[k + '_mean']; return (typeof v === 'number') ? v : 0; }
var VARYING = PARAMS.filter(function (k) { return sdOf(k) > 1e-9; });

/* ---------- Step 18c: Spearman rho for all pairs + VIF (FF-11..14) ---------- */
var PAIRS = [];
for (var i = 0; i < PARAMS.length; i++) {
  for (var j = i + 1; j < PARAMS.length; j++) { PAIRS.push([PARAMS[i], PARAMS[j]]); }
}
PAIRS.push(['A3', 'canopy_pct']);
PAIRS.push(['A3', 'D5_raw']);
var rhoList = ee.List(PAIRS.map(function (p) {
  return ee.Dictionary(retained0.filter(ee.Filter.notNull(p))
                         .reduceColumns(ee.Reducer.spearmansCorrelation(), p))
           .values().get(0);                              // 'correlation' sorts first
}));

// VIF_i = diag(inverse correlation matrix)_i — identical to 1/(1-R2_i) of the regression of
// parameter i on the other 22; pseudo-inverse keeps it defined when columns are collinear.
var zKeys = VARYING.map(function (k) { return 'z_' + k; });
var zTable = retained0.map(function (f) {
  var o = {};
  VARYING.forEach(function (k) {
    o['z_' + k] = ee.Number(f.get(k)).subtract(meanOf(k)).divide(sdOf(k) * Math.sqrt(NR - 1));
  });
  return f.set(o);
});
var X = ee.Array(zTable.reduceColumns(ee.Reducer.toList(zKeys.length), zKeys).get('list'));
var RMAT = X.matrixTranspose().matrixMultiply(X);
var vifList = RMAT.matrixPseudoInverse().matrixDiagonal().project([0]).toList();

print('Computing Spearman correlations and VIF in the background ...');
ee.Dictionary({rho: rhoList, vif: vifList}).evaluate(function (COL, errC) {
if (errC) { print('STOP: collinearity screen failed: ' + errC); return; }
var RHO = {};
PAIRS.forEach(function (p, idx) {
  var v = COL.rho[idx];
  if (sdOf(p[0]) <= 1e-9 || (PARAMS.indexOf(p[1]) >= 0 && sdOf(p[1]) <= 1e-9)) { v = null; }
  RHO[p[0] + '|' + p[1]] = (typeof v === 'number' && isFinite(v)) ? v : null;
});
function rho(a, b) {
  var v = RHO[a + '|' + b];
  if (v === undefined) { v = RHO[b + '|' + a]; }
  return (v === undefined) ? null : v;
}
var VIF = {};
VARYING.forEach(function (k, idx) { VIF[k] = COL.vif[idx]; });

/* ---------- Step 19: apply CV / collinearity weight changes (FF-07) ---------- */
var W = {};
PARAMS.forEach(function (k) { W[k] = CFG.WEIGHTS[k]; });
var CV_LOG = [], COL_LOG = [], DROPPED = {};
function shareWithinTheme(k, pts, exclude) {
  var t = THEME_OF[k];
  var others = THEMES[t].filter(function (o) { return o !== k && !DROPPED[o] && exclude.indexOf(o) < 0 && W[o] > 0; });
  var tot = others.reduce(function (s, o) { return s + W[o]; }, 0);
  if (tot <= 0) { return false; }
  others.forEach(function (o) { W[o] += pts * W[o] / tot; });
  return true;
}
// CV guard (Section 8.3)
PARAMS.forEach(function (k) {
  var m = meanOf(k), sd = sdOf(k);
  var cv = (Math.abs(m) > 1e-12) ? sd / Math.abs(m) : (sd > 0 ? Infinity : 0);
  if (cv < CFG.CV_MIN && W[k] > 0) {
    var pts = W[k];
    DROPPED[k] = true;
    if (shareWithinTheme(k, pts, [])) {
      W[k] = 0;
      CV_LOG.push(k + ' CV=' + cv.toFixed(4) + ' -> ' + pts.toFixed(2) + ' pts shared in theme ' + THEME_OF[k]);
    } else {
      DROPPED[k] = false;
      CV_LOG.push(k + ' CV=' + cv.toFixed(4) + ' but no other parameter in theme — kept');
    }
  }
});
// FF-11 A3 phenology
var rA3c = rho('A3', 'canopy_pct'), rA3d = rho('A3', 'D5_raw');
var FF11 = ((rA3c === null || Math.abs(rA3c) < CFG.A3_RHO_MAX) &&
            (rA3d === null || Math.abs(rA3d) < CFG.A3_RHO_MAX)) ? 'PASS' : 'FAIL';
// FF-12 B1 vs C1s
var r12 = rho('B1', 'C1s');
var FF12 = 'PASS';
if (r12 !== null && Math.abs(r12) >= CFG.RHO_MAX) {
  FF12 = 'ACTION';
  var mv = Math.min(2, W.C1s);
  W.C1s -= mv; W.C2s += mv;
  COL_LOG.push('FF-12 rho(B1,C1s)=' + r12.toFixed(3) + ': C1s -' + mv + ' pts, C2s +' + mv);
}
// FF-13 D1 vs D3
var r13 = rho('D1', 'D3');
var FF13 = 'PASS';
if (r13 !== null && Math.abs(r13) >= CFG.RHO_MAX) {
  FF13 = 'ACTION';
  var d13 = W.D1 + W.D3;
  var comp = Math.max(d13 - 2, 0);
  W.D1 = W.D1 * comp / d13; W.D3 = W.D3 * comp / d13; W.D6 += d13 - comp;
  COL_LOG.push('FF-13 rho(D1,D3)=' + r13.toFixed(3) + ': D1+D3 merged to ' + comp.toFixed(2) +
               ' pts (canopy-biomass deficit), D6 +' + (d13 - comp).toFixed(2));
}
// FF-14 any other pair / VIF
var FF14 = 'PASS';
var FF14_PAIRS = [];
PAIRS.forEach(function (p) {
  if (PARAMS.indexOf(p[1]) < 0) { return; }
  var key = p[0] + '|' + p[1];
  if (key === 'B1|C1s' || key === 'D1|D3') { return; }
  var r = RHO[key];
  if (r === null || Math.abs(r) <= CFG.RHO_MAX) { return; }
  FF14 = 'ACTION';
  FF14_PAIRS.push(key + '=' + r.toFixed(3));
  var a = p[0], b = p[1];
  if (THEME_OF[a] === THEME_OF[b] && W[a] + W[b] > 0) {
    var hi = Math.max(W[a], W[b]), sum = W[a] + W[b], freed = sum - hi;
    W[a] = W[a] * hi / sum; W[b] = W[b] * hi / sum;
    var shared = shareWithinTheme(a, freed, [b]);
    if (!shared) { W[a] += freed * W[a] / hi; W[b] += freed * W[b] / hi; }
    COL_LOG.push('FF-14 ' + key + ' rho=' + r.toFixed(3) + ': merged into composite worth ' +
                 hi.toFixed(2) + ' pts' + (shared ? ', ' + freed.toFixed(2) + ' pts shared in theme' : ''));
  } else {
    COL_LOG.push('FF-14 ' + key + ' rho=' + r.toFixed(3) + ': different themes — REVIEW weights manually');
  }
});
VARYING.forEach(function (k) {
  if (typeof VIF[k] === 'number' && VIF[k] > CFG.VIF_MAX) {
    FF14 = 'ACTION';
    COL_LOG.push('FF-14 VIF(' + k + ')=' + VIF[k].toFixed(2) + ' > ' + CFG.VIF_MAX + ': REVIEW');
  }
});
// FF-07 weight sums
var wSum = PARAMS.reduce(function (s, k) { return s + W[k]; }, 0);
var FF07 = Math.abs(wSum - 100) < 1e-6 ? 'PASS' : 'FAIL';
THEME_KEYS.forEach(function (t) {
  var s = THEMES[t].reduce(function (a, k) { return a + W[k]; }, 0);
  if (Math.abs(s - THEME_PTS[t]) > 1e-6) { FF07 = 'FAIL'; }
});
if (FF07 === 'FAIL') { print('FF-07 STOP: weights do not sum to 100 / theme totals.'); return; }

var CV_REWEIGHT_LOG = CV_LOG.length ? CV_LOG.join(' | ') : 'none';
print('Final sub-weights (after CV guard / collinearity):', W);
print('CV guard log:', CV_REWEIGHT_LOG);
print('Collinearity log:', COL_LOG.length ? COL_LOG : 'none');

/* ---------- Step 20: theme scores and PPI (Section 10) ---------- */
var TW = {};   // theme weights as fractions
THEME_KEYS.forEach(function (t) { TW[t] = THEME_PTS[t] / 100; });
function coefFrom(tw) {
  var ab = tw.A + tw.B, cde = tw.C + tw.D + tw.E;
  return {a: 0.65 * tw.A / ab, b: 0.65 * tw.B / ab,
          cC: 0.45 * tw.C / cde, cD: 0.45 * tw.D / cde, cE: 0.45 * tw.E / cde};
}
var BASE = coefFrom(TW);
print('Exponents a, b:', BASE.a.toFixed(3), BASE.b.toFixed(3));

function themeScore(f, t, swap) {
  var s = ee.Number(0);
  THEMES[t].forEach(function (k) {
    var key = (swap && swap[k]) ? swap[k] : k;
    s = s.add(ee.Number(f.get(key)).multiply(W[k]));
  });
  return s.divide(THEME_PTS[t]);
}
var scored = filled.map(function (f) {
  var A = themeScore(f, 'A'), B = themeScore(f, 'B'), C = themeScore(f, 'C');
  var D = themeScore(f, 'D'), E = themeScore(f, 'E');
  var Bo = themeScore(f, 'B', {B1: 'B1_opt'}), Bp = themeScore(f, 'B', {B1: 'B1_pes'});
  var CDE = C.multiply(12).add(D.multiply(24)).add(E.multiply(14)).divide(50);
  var core = A.max(0.01).pow(BASE.a).multiply(B.max(0.01).pow(BASE.b));
  var ppi = core.multiply(ee.Number(0.55).add(C.multiply(BASE.cC)).add(D.multiply(BASE.cD))
                                          .add(E.multiply(BASE.cE)));
  return f.set({A: A, B: B, C: C, D: D, E: E, B_opt: Bo, B_pes: Bp, CDE: CDE,
                suit_core: core, PPI_raw: ppi});
});

/* ---------- Step 21 + 23: array engine — categories and Monte Carlo ---------- */
var ret = scored.filter(ee.Filter.eq('excluded', 0)).sort('block_id');
var N = ee.Number(NR);
function arr(p) { return ee.Array(ret.aggregate_array(p)); }
function full(v) { return ee.Array(ee.List.repeat(v, N)); }
var AA = arr('A'), BC = arr('B'), BO = arr('B_opt'), BP = arr('B_pes');
var CC = arr('C'), DD = arr('D'), EE = arr('E');
var F001 = full(0.01), F055 = full(0.55);

function ppiOf(Aa, Ba, Ca, Da, Ea, a, b, cC, cD, cE) {
  return Aa.max(F001).pow(full(a)).multiply(Ba.max(F001).pow(full(b)))
    .multiply(F055.add(Ca.multiply(full(cC))).add(Da.multiply(full(cD))).add(Ea.multiply(full(cE))));
}
function cutIdx(p) { return N.multiply(p).ceil().subtract(1).max(0).int(); }   // nearest rank
var I20 = cutIdx(0.2), I40 = cutIdx(0.4), I60 = cutIdx(0.6), I80 = cutIdx(0.8);
function catOf(ppi) {
  var s = ppi.sort();
  return full(5)
    .subtract(ppi.gt(full(s.get([I20]))))
    .subtract(ppi.gt(full(s.get([I40]))))
    .subtract(ppi.gt(full(s.get([I60]))))
    .subtract(ppi.gt(full(s.get([I80]))));
}

var basePPI = ppiOf(AA, BC, CC, DD, EE, BASE.a, BASE.b, BASE.cC, BASE.cD, BASE.cE);
var baseCat = catOf(basePPI);
var IDX = ee.Array(ee.List.sequence(0, N.subtract(1)));
var ORDER = IDX.sort(basePPI);
var RANK = IDX.sort(ORDER);
var PCT = RANK.multiply(full(100)).divide(full(N.subtract(1).max(1)));

// --- Monte Carlo draws, generated client-side with a seeded generator (Section 11.2) ---
function mulberry32(a) {
  return function () {
    a = a | 0; a = (a + 0x6D2B79F5) | 0;
    var t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
var RNG = mulberry32(CFG.MC_SEED);
function rnorm() {
  var u1 = 0, u2 = 0;
  while (u1 === 0) { u1 = RNG(); }
  u2 = RNG();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
function rgamma(alpha) {                       // Marsaglia & Tsang (2000)
  if (alpha < 1) { return rgamma(alpha + 1) * Math.pow(RNG(), 1 / alpha); }
  var d = alpha - 1 / 3, c = 1 / Math.sqrt(9 * d);
  while (true) {
    var x, v;
    do { x = rnorm(); v = 1 + c * x; } while (v <= 0);
    v = v * v * v;
    var u = RNG();
    if (u < 1 - 0.0331 * x * x * x * x) { return d * v; }
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) { return d * v; }
  }
}
var DRAWS = [];
for (var k = 0; k < CFG.MC_K; k++) {
  var g = THEME_KEYS.map(function (t) { return rgamma(CFG.MC_CONC * TW[t]); });
  var gs = g.reduce(function (s, v) { return s + v; }, 0);
  var tw = {};
  THEME_KEYS.forEach(function (t, ii) { tw[t] = g[ii] / gs; });
  var cf = coefFrom(tw);
  DRAWS.push({k: k, wA: tw.A, wB: tw.B, wC: tw.C, wD: tw.D, wE: tw.E,
              a: cf.a, b: cf.b, cC: cf.cC, cD: cf.cD, cE: cf.cE,
              b1_variant: RNG() < 0.5 ? 'pessimistic' : 'optimistic'});
}
var K = CFG.MC_K, KHALF = Math.floor(K / 2);
var DRAW_LIST = ee.List(DRAWS.map(function (d) {
  return [d.k, d.a, d.b, d.cC, d.cD, d.cE, d.b1_variant === 'pessimistic' ? 1 : 0];
}));
var Z = full(0);
var MC = ee.Dictionary(DRAW_LIST.iterate(function (d, st) {
  d = ee.List(d); st = ee.Dictionary(st);
  var kk = ee.Number(d.get(0));
  var a = d.get(1), b = d.get(2), cC = d.get(3), cD = d.get(4), cE = d.get(5);
  var catO = catOf(ppiOf(AA, BO, CC, DD, EE, a, b, cC, cD, cE));
  var catP = catOf(ppiOf(AA, BP, CC, DD, EE, a, b, cC, cD, cE));
  var cat = ee.Array(ee.Algorithms.If(ee.Number(d.get(6)).eq(1), catP, catO));
  var c12 = ee.Array(st.get('c12')).add(cat.lte(full(2)));
  var out = {
    c12: c12,
    cmin: ee.Array(st.get('cmin')).min(cat),
    cmax: ee.Array(st.get('cmax')).max(cat),
    bdiff: ee.Array(st.get('bdiff')).add(catO.neq(catP)),
    half: ee.Algorithms.If(kk.eq(KHALF - 1),
            c12.reduce(ee.Reducer.sum(), [0]).get([0]).divide(N.multiply(KHALF)), st.get('half'))
  };
  [1, 2, 3, 4, 5].forEach(function (c) {
    out['n' + c] = ee.Array(st.get('n' + c)).add(cat.eq(full(c)));
  });
  return ee.Dictionary(out);
}, ee.Dictionary({c12: Z, cmin: full(5), cmax: full(1), bdiff: Z, half: 0,
                  n1: Z, n2: Z, n3: Z, n4: Z, n5: Z})));

var C12 = ee.Array(MC.get('c12'));
var STAB = C12.divide(full(K));
var MEAN_FULL = C12.reduce(ee.Reducer.sum(), [0]).get([0]).divide(N.multiply(K));
var MEAN_HALF = ee.Number(MC.get('half'));
// modal category
var best = ee.Array(MC.get('n1')), modal = full(1);
[2, 3, 4, 5].forEach(function (c) {
  var nc = ee.Array(MC.get('n' + c));
  var gt = nc.gt(best);
  modal = modal.add(gt.multiply(full(c).subtract(modal)));
  best = best.max(nc);
});
var BSENS = ee.Array(MC.get('bdiff')).divide(full(K));

/* ---------- write array results back to the retained blocks ---------- */
var L = {
  ppi: basePPI.toList(), pct: PCT.toList(), cat: baseCat.toList(), stab: STAB.toList(),
  modal: modal.toList(), cmin: ee.Array(MC.get('cmin')).toList(),
  cmax: ee.Array(MC.get('cmax')).toList(), bs: BSENS.toList()
};
var RET_LIST = ret.toList(N);
var retOut = ee.FeatureCollection(ee.List.sequence(0, N.subtract(1)).map(function (ii) {
  ii = ee.Number(ii).int();
  var f = ee.Feature(RET_LIST.get(ii));
  var bs = ee.Number(L.bs.get(ii));
  return f.set({
    PPI_absolute: L.ppi.get(ii),
    PPI_final: L.ppi.get(ii),
    PPI_percentile: L.pct.get(ii),
    category: ee.Number(L.cat.get(ii)).int(),
    stability_cat12: L.stab.get(ii),
    category_modal: ee.Number(L.modal.get(ii)).int(),
    category_range: ee.Number(L.cmin.get(ii)).format('%.0f').cat('-')
                      .cat(ee.Number(L.cmax.get(ii)).format('%.0f')),
    b1_disagree_share: bs,
    b1_sensitive: ee.Algorithms.If(bs.gt(0.20), 'yes', 'no')
  });
}));
var exclOut = scored.filter(ee.Filter.eq('excluded', 1)).map(function (f) {
  return f.set({PPI_absolute: 0, PPI_final: 0, PPI_percentile: 0, category: 5,
                stability_cat12: 0, category_modal: 5, category_range: '5-5',
                b1_disagree_share: 0, b1_sensitive: 'no'});
});

/* ---------- Step 22: prescription (10.4) and site class (10.5) ---------- */
function cls(x) {
  return ee.Algorithms.If(x.lt(CFG.SITE_SPLITS[0]), 'Low',
         ee.Algorithms.If(x.lt(CFG.SITE_SPLITS[1]), 'Med', 'High'));
}
var RXD = ee.Dictionary(RX_CODES);
function rxOf(f) {
  var A = ee.Number(f.get('A')), B = ee.Number(f.get('B'));
  var E1 = ee.Number(f.get('E1')), D5 = ee.Number(f.get('D5'));
  return ee.String(
    ee.Algorithms.If(ee.Number(f.get('excluded_c1')).eq(1), 'PROTECT_DENSE',
    ee.Algorithms.If(ee.Number(f.get('excluded')).eq(1), 'NOT_PLANTABLE',
    ee.Algorithms.If(E1.lt(CFG.RX.FIRE_E1), 'FIRE_PROTECTION_FIRST',
    ee.Algorithms.If(A.lt(CFG.RX.SMC_A).or(B.lt(CFG.RX.SMC_B)), 'SMC_FIRST',
    ee.Algorithms.If(D5.gte(CFG.RX.INVASIVE_D5), 'INVASIVE_CLEAR_THEN_PLANT',
    ee.Algorithms.If(ee.String(f.get('canopy_track')).equals('GAP_ANR'), 'GAP_PLANTING_ANR',
                     'FULL_PLANTATION')))))));
}
// Light copy for the on-screen map: base categories only (no Monte Carlo needed).
var L0 = {ppi: basePPI.toList(), pct: PCT.toList(), cat: baseCat.toList()};
var MAPFC = ee.FeatureCollection(ee.List.sequence(0, N.subtract(1)).map(function (ii) {
  ii = ee.Number(ii).int();
  return ee.Feature(RET_LIST.get(ii)).set({PPI_absolute: L0.ppi.get(ii), PPI_percentile: L0.pct.get(ii),
                                           category: ee.Number(L0.cat.get(ii)).int()});
})).merge(scored.filter(ee.Filter.eq('excluded', 1)).map(function (f) {
  return f.set({PPI_absolute: 0, PPI_percentile: 0, category: 5});
})).map(function (f) {
  var rx = rxOf(f);
  return f.set({prescription: rx, rx_code: RXD.get(rx)});
});

var finalFC = retOut.merge(exclOut).map(function (f) {
  var A = ee.Number(f.get('A')), B = ee.Number(f.get('B'));
  var rx = rxOf(f);
  var cat = ee.Number(f.get('category'));
  var stab = ee.Number(f.get('stability_cat12'));
  var c6 = ee.Number(ee.Algorithms.If(ee.Algorithms.IsEqual(f.get('C6_frac'), null), 0, f.get('C6_frac')));
  var why = ee.List([
    ee.Algorithms.If(cat.lte(2).and(stab.lt(0.80)), 'Cat1-2 stability<0.80', ''),
    ee.Algorithms.If(ee.String(f.get('recent_plantation_flag')).equals('yes'), 'F1 recent plantation?', ''),
    ee.Algorithms.If(ee.String(f.get('protected_area_flag')).equals('yes'), 'F2 protected area', ''),
    ee.Algorithms.If(ee.String(f.get('b1_sensitive')).equals('yes'), 'F3 soil pit', ''),
    ee.Algorithms.If(c6.gt(0), 'C6 cultivation inside forest (rights/encroachment)', '')
  ]).filter(ee.Filter.neq('item', ''));
  var stabRead = ee.Algorithms.If(stab.gt(0.80), 'Robust',
                 ee.Algorithms.If(stab.gte(0.50), 'Moderately stable', 'Marginal'));
  return f.set({
    prescription: rx,
    rx_code: RXD.get(rx),
    site_class: ee.String('A-').cat(cls(A)).cat('/B-').cat(cls(B)),
    stability_reading: ee.Algorithms.If(cat.lte(2), stabRead, ''),
    field_check: ee.Algorithms.If(why.size().gt(0), 'yes', 'no'),
    field_check_reason: why.join('; '),
    fra_rights_check_required: ee.Algorithms.If(cat.lte(2), 'yes', 'no'),   // Section 2 rule
    cv_reweight_log: CV_REWEIGHT_LOG,
    weights_used: JSON.stringify(W)
  });
});

/* ---------- Step 24: one-at-a-time sensitivity (Section 11.3) ---------- */
var SMAT = ee.Array(ret.reduceColumns(ee.Reducer.toList(PARAMS.length), PARAMS).get('list'));
function wMatrix(Wv) {           // 23 x 5, column t = Wv[k] / theme points
  return PARAMS.map(function (k) {
    return THEME_KEYS.map(function (t) { return THEME_OF[k] === t ? Wv[k] / THEME_PTS[t] : 0; });
  });
}
var OAT = [];
PARAMS.forEach(function (k) {
  [0.8, 1.2].forEach(function (m) {
    if (W[k] <= 0) { return; }
    var t = THEME_OF[k];
    var Wv = {};
    PARAMS.forEach(function (p) { Wv[p] = W[p]; });
    var newK = W[k] * m, restOld = THEME_PTS[t] - W[k], restNew = THEME_PTS[t] - newK;
    if (restOld <= 0) { return; }
    THEMES[t].forEach(function (p) { if (p !== k) { Wv[p] = W[p] * restNew / restOld; } });
    Wv[k] = newK;
    OAT.push({param: k, factor: m, wm: wMatrix(Wv)});
  });
});
var oatFeatures = OAT.map(function (o) {
  var TH = SMAT.matrixMultiply(ee.Array(o.wm));
  var col = function (c) { return TH.slice(1, c, c + 1).project([0]); };
  var cat = catOf(ppiOf(col(0), col(1), col(2), col(3), col(4),
                        BASE.a, BASE.b, BASE.cC, BASE.cD, BASE.cE));
  var share = cat.neq(baseCat).reduce(ee.Reducer.sum(), [0]).get([0]).divide(N);
  return ee.Feature(null, {
    parameter: o.param, theme: THEME_OF[o.param], factor: o.factor,
    share_blocks_changed: share,
    over_influential: ee.Algorithms.If(share.gt(CFG.OAT_MAX_SHARE), 'yes', 'no')
  });
});
var OAT_FC = ee.FeatureCollection(oatFeatures).sort('share_blocks_changed', false);

/* ---------- Collinearity table (Section 11.4) ---------- */
var colFeatures = PAIRS.map(function (p) {
  var r = RHO[p[0] + '|' + p[1]];
  return ee.Feature(null, {type: 'spearman', a: p[0], b: p[1], value: r === null ? -999 : r,
                           flag: (r !== null && Math.abs(r) > CFG.RHO_MAX) ? 'yes' : 'no'});
}).concat(VARYING.map(function (k) {
  return ee.Feature(null, {type: 'VIF', a: k, b: '', value: VIF[k],
                           flag: VIF[k] > CFG.VIF_MAX ? 'yes' : 'no'});
}));
var COL_FC = ee.FeatureCollection(colFeatures);

var DRAW_FC = ee.FeatureCollection(DRAWS.map(function (d) { return ee.Feature(null, d); }));

/* ---------- qc_log (Section 12) ---------- */
var HAS_QC = (typeof HAS_QC01 === 'undefined') ? true : HAS_QC01;   // false if the QC01 export failed
var qc01 = HAS_QC ? ee.Feature(ee.FeatureCollection(CFG.QC01_ASSET).first()) : null;
function notRecorded(id, check) {
  return q(id, check, 'not recorded: the QC01 table was not saved (all dataset checks passed in Run 1 console)',
           'NOT RECORDED', 'Re-run RUN 1 (STEP = LAYERS) to regenerate the QC01 table');
}
function st(cond, ok, bad) { return ee.Algorithms.If(cond, ok || 'PASS', bad || 'FAIL'); }
function q(id, check, value, status, action) {
  return ee.Feature(null, {id: id, check: check, value: value, status: status, if_fail: action});
}
var maxNull = ee.List(FILL_KEYS.map(function (k) { return nullShare.get(k); })).reduce(ee.Reducer.max());
var SCORE_KEYS = PARAMS.concat(['A', 'B', 'C', 'D', 'E', 'B1_opt', 'B1_pes']);
var minScore = ee.List(SCORE_KEYS.map(function (k) { return scored.aggregate_min(k); })).reduce(ee.Reducer.min());
var maxScore = ee.List(SCORE_KEYS.map(function (k) { return scored.aggregate_max(k); })).reduce(ee.Reducer.max());
var anchorIds = raw.aggregate_array('anchor_id').distinct();
var anchor0 = ee.String(anchorIds.get(0));
var ff09live = ee.Algorithms.If(anchor0.slice(0, 4).equals('LIVE'), 'WARN (provisional LIVE anchors)',
               ee.Algorithms.If(anchor0.slice(0, 5).equals('LOCAL'),
                 'PASS (local anchors: range + buffer; PPI_absolute comparable within this landscape only)', 'PASS'));
var ff09 = ee.Algorithms.If(anchorIds.size().neq(1), 'FAIL (more than one anchor ID)',
           CFG.EXPECTED_ANCHOR_ID ?
             ee.Algorithms.If(anchor0.equals(CFG.EXPECTED_ANCHOR_ID), ff09live, 'FAIL (anchor ID mismatch)') :
             ff09live);
var ff15bad = scored.filter(ee.Filter.gte('fire_years', 5)).filter(ee.Filter.gte('E1', 0.55)).size();
var ff16bad = scored.filter(ee.Filter.eq('excluded_c1', 1)).filter(ee.Filter.eq('excluded', 0)).size();
var ff17bad = scored.map(function (f) {
  return f.set('d__', ee.Number(f.get('net_plantable_ha')).subtract(ee.Number(f.get('block_area_ha'))));
}).filter(ee.Filter.gt('d__', 1e-9)).size();
var pp = ret.reduceColumns(ee.Reducer.percentile([5, 95]), ['PPI_raw']);
var spread = ee.Number(pp.get('p95')).subtract(ee.Number(pp.get('p5')));
var shares = [1, 2, 3, 4].map(function (c) {
  return baseCat.eq(full(c)).reduce(ee.Reducer.sum(), [0]).get([0]).divide(N);
});
var sharesL = ee.List(shares);
var shareOK = ee.Number(sharesL.reduce(ee.Reducer.min())).gte(0.18)
  .and(ee.Number(sharesL.reduce(ee.Reducer.max())).lte(0.22));
var dMC = MEAN_FULL.subtract(MEAN_HALF).abs();
var nGrid = ee.Number(ee.Feature(raw.first()).get('n_blocks_grid'));
var FIRE_GAP_TEXT = ee.Feature(raw.first()).get('fire_source_gap');
var gapPresent = raw.filter(ee.Filter.notNull(['fire_source_gap'])).size().eq(N_ALL);

var QC_FC = ee.FeatureCollection([
  HAS_QC ? q('FF-01', 'Asset access (22 datasets)', qc01.get('FF01_asset_log'), qc01.get('FF01_status'), 'STOP: re-check ID in Section 5') : notRecorded('FF-01', 'Asset access (22 datasets)'),
  HAS_QC ? q('FF-02', 'Working CRS', qc01.get('FF02_crs'), qc01.get('FF02_status'), 'STOP: fix UTM formula') : notRecorded('FF-02', 'Working CRS'),
  HAS_QC ? q('FF-03', 'Mosaic nominal scales', qc01.get('FF03_scales'), qc01.get('FF03_status'), 'STOP: setDefaultProjection') : notRecorded('FF-03', 'Mosaic nominal scales'),
  HAS_QC ? q('FF-04', 'Interior blocks 9.99-10.01 ha (count outside)', qc01.get('FF04_interior_blocks_out_of_tolerance'),
    st(ee.Number(qc01.get('FF04_interior_blocks_out_of_tolerance')).eq(0)), 'Grid scale wrong') : notRecorded('FF-04', 'Interior blocks 9.99-10.01 ha (count outside)'),
  HAS_QC ? q('FF-05', 'Null beat_id count', qc01.get('FF05_null_beat'),
    st(ee.Number(qc01.get('FF05_null_beat')).eq(0)), "Re-inspect asset; fall back to 'RANGE'") : notRecorded('FF-05', 'Null beat_id count'),
  q('FF-06', 'Max parameter null share (before beat-mean fill)', maxNull,
    st(ee.Number(maxNull).lt(0.02)), 'Check masks; gaps filled with beat mean (gapfilled column)'),
  q('FF-07', 'Sub-weights sum to 100 and theme totals', JSON.stringify(W), FF07, 'Arithmetic error'),
  q('FF-08', 'All scores in [0,1] (min, max)', ee.String(ee.Number(minScore).format('%.4f')).cat(', ')
      .cat(ee.Number(maxScore).format('%.4f')),
    st(ee.Number(minScore).gte(-1e-9).and(ee.Number(maxScore).lte(1 + 1e-9))), 'Anchor or curve error'),
  q('FF-09', 'Single anchor ID', anchorIds.join(','), ff09, 'Re-run Module 0 or fix constant'),
  q('FF-10', 'CV guard (CV < 0.05 reweighted)', CV_REWEIGHT_LOG, CV_LOG.length ? 'APPLIED' : 'PASS', 'Section 8.3'),
  q('FF-11', 'rho(A3,canopy), rho(A3,D5) < 0.60', String(rA3c) + ', ' + String(rA3d), FF11,
    'Set A3_MASK_TREES = true in script 01 and re-run'),
  q('FF-12', 'rho(B1,C1s) < 0.75', String(r12), FF12, 'C1s cut to 3 pts, +2 to C2s (auto)'),
  q('FF-13', 'rho(D1,D3) < 0.75', String(r13), FF13, 'Merged to 7 pts, +2 to D6 (auto)'),
  q('FF-14', 'Other pairs |rho| <= 0.75, VIF <= 5', COL_LOG.length ? COL_LOG.join(' | ') : 'none', FF14,
    'Composite at higher pair weight (auto, same theme) / review'),
  q('FF-15', 'Blocks with >=5 fire years and E1 >= 0.55', ff15bad, st(ff15bad.eq(0), 'PASS', 'STOP'), 'Inversion missing'),
  q('FF-16', 'Blocks excluded by C1 yet ranked', ff16bad, st(ff16bad.eq(0), 'PASS', 'STOP'), 'Threshold coordination'),
  q('FF-17', 'Blocks with net_plantable_ha > block_area_ha', ff17bad, st(ff17bad.eq(0)), 'Fraction error'),
  HAS_QC ? q('FF-18', 'Min clear S2 obs per window-year (5th pct: A3, D5)',
    ee.String(ee.Number(qc01.get('FF18_A3_p5_min_clear_obs')).format('%.0f')).cat(', ')
      .cat(ee.Number(qc01.get('FF18_D5_p5_min_clear_obs')).format('%.0f')),
    st(ee.Number(qc01.get('FF18_A3_p5_min_clear_obs')).gte(3)
         .and(ee.Number(qc01.get('FF18_D5_p5_min_clear_obs')).gte(3))),
    'Set CS_THRESHOLD = 0.50 in 00/01 and log it') : notRecorded('FF-18', 'Min clear S2 obs per window-year (5th pct: A3, D5)'),
  HAS_QC ? q('FF-19', 'Share of pixels with >= 8 Landsat years', qc01.get('FF19_share_pixels_8yrs'),
    st(ee.Number(qc01.get('FF19_share_pixels_8yrs')).gte(0.95)), 'Set D2_MONTHS = [9, 12] and log it') : notRecorded('FF-19', 'Share of pixels with >= 8 Landsat years'),
  q('FF-20', 'PPI_raw p95 - p5 (retained)', spread, st(spread.gte(0.20)), 'Review CV guard and anchors'),
  q('FF-21', 'Category 1-4 shares of retained', sharesL, st(shareOK), 'Percentile transform error'),
  q('FF-22', '|mean stability K=' + K + ' - K=' + KHALF + '|', dMC, st(dMC.lt(0.01)), 'Raise MC_K to 1000'),
  q('FF-23', 'Rows in raw table = grid blocks', ee.String(N_ALL.format('%d')).cat(' / ').cat(nGrid.format('%.0f')),
    st(N_ALL.eq(nGrid)), 'Raise TILE_SCALE in 01 and re-export'),
  q('FF-24', 'fire_source_gap present', FIRE_GAP_TEXT, st(gapPresent), 'Add metadata field'),
  q('INFO', 'OAT parameters moving > 15% of blocks',
    OAT_FC.filter(ee.Filter.eq('over_influential', 'yes')).aggregate_array('parameter').distinct().join(','),
    'INFO', 'Review those weights')
]);

/* ---------- Step 25: exports (SCORE stage) ---------- */
var tag = CFG.RANGE_NAME;
Export.table.toAsset({collection: finalFC, description: 'PPI02_final_to_asset', assetId: CFG.FINAL_ASSET});
Export.table.toDrive({collection: finalFC, description: 'PPI02_final_block_table_csv',
  folder: CFG.DRIVE_FOLDER, fileNamePrefix: 'PPI02_final_block_table_' + tag, fileFormat: 'CSV'});
Export.table.toDrive({collection: raw, description: 'PPI02_raw_checkpoint_csv',
  folder: CFG.DRIVE_FOLDER, fileNamePrefix: 'PPI01_raw_block_table_' + tag, fileFormat: 'CSV'});
Export.table.toDrive({collection: OAT_FC, description: 'PPI02_sensitivity_csv',
  folder: CFG.DRIVE_FOLDER, fileNamePrefix: 'PPI02_sensitivity_OAT_' + tag, fileFormat: 'CSV'});
Export.table.toDrive({collection: COL_FC, description: 'PPI02_collinearity_csv',
  folder: CFG.DRIVE_FOLDER, fileNamePrefix: 'PPI02_collinearity_' + tag, fileFormat: 'CSV'});
Export.table.toDrive({collection: DRAW_FC, description: 'PPI02_montecarlo_draws_csv',
  folder: CFG.DRIVE_FOLDER, fileNamePrefix: 'PPI02_montecarlo_draws_' + tag, fileFormat: 'CSV'});
Export.table.toDrive({collection: QC_FC, description: 'PPI02_qc_log_csv',
  folder: CFG.DRIVE_FOLDER, fileNamePrefix: 'PPI02_qc_log_' + tag, fileFormat: 'CSV'});

print('Collinearity, CV guard and weights are above. Monte Carlo runs inside the export tasks.');
if (CFG.PUBLISH_NOW) {
  publishAll(finalFC, MAPFC);
  print('====================================================================');
  print('FINAL MAP is on screen. To save every result to Google Drive:');
  print('Tasks tab -> RUN ALL (tables, Monte Carlo, QC log, GeoTIFFs, SHP, GeoJSON, field list).');
  print('====================================================================');
  return;
}
print('NEXT: Tasks tab -> RUN all 7 tasks. When PPI02_final_to_asset is done, set');
print("STAGE = 'PUBLISH' and run again for maps, GeoTIFFs, SHP, GeoJSON and the field-check list.");

Map.centerObject(AOI, 11);
Map.addLayer(scored.reduceToImage(['PPI_raw'], ee.Reducer.first()).updateMask(
  scored.reduceToImage(['excluded'], ee.Reducer.first()).eq(0)),
  {min: 0.2, max: 0.8, palette: ['#1a9850', '#fee08b', '#d73027']}, 'PPI_raw (retained, preview)');
Map.addLayer(ee.Image().byte().paint(AOI_FC, 1, 2), {palette: ['black']}, 'Range boundary');

});   // end collinearity callback
});   // end statistics callback

/* ====================================================================== */
} else if (CFG.STAGE === 'PUBLISH') {
/* ====================================================================== */

publishAll(ee.FeatureCollection(CFG.FINAL_ASSET));

/* ====================================================================== */
} else {
  print("STOP: CFG.STAGE must be 'SCORE' or 'PUBLISH'");
}
