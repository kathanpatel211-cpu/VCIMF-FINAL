/* ######################################################################
 *  FRPIM v2.2 — Forest Restoration Priority and Intervention Model
 *  SCORING (build steps 18-26): Restoration Need (RNI) x Restoration
 *  Feasibility (RFI) -> priority class, phase, intervention, Monte Carlo,
 *  sensitivity, collinearity, v2.1 comparison, decision summary, maps.
 * ###################################################################### */

var CFG = {
  STAGE: 'SCORE',                // 'SCORE' or 'PUBLISH'
  PUBLISH_NOW: false,            // true = final map and all exports in the SCORE run
  CRS: 'EPSG:32643',
  RANGE_NAME: 'Khedbrahma',
  AOI_ASSET: 'projects/khedbrahma-range/assets/khedbrahma',
  RAW_ASSET: 'projects/khedbrahma-range/assets/FRPIM_v22_raw_blocks_Khedbrahma',
  QC01_ASSET: 'projects/khedbrahma-range/assets/FRPIM_v22_qc01_Khedbrahma',
  FINAL_ASSET: 'projects/khedbrahma-range/assets/FRPIM_v22_final_blocks_Khedbrahma',
  V21_ASSET: 'projects/khedbrahma-range/assets/PPI_SK_v21_RANGE_final_blocks_Khedbrahma',
  DRIVE_FOLDER: 'FRPIM_v22_Khedbrahma',
  EXPECTED_ANCHOR_ID: null,
  // Section 7.1 / 7.2 weights (points)
  W_N: {N1: 25, N2: 15, N3: 15, N4: 15, N5: 10, N6: 10, N7: 5, N8: 5},
  W_F: {F1: 15, F2: 10, F3: 5, F4: 5, F5: 12, F6: 7, F7: 6, F8: 6, F9: 4,
        F10: 8, F11: 7, F12: 3, F13: 7, F14: 5},
  // Section 10.2: five classes per index. 'quantile' = 20/40/60/80th percentiles of the retained blocks
  // (default); 'fixed' = equal 0.2 intervals (compare ranges/years on one scale).
  CLASS_METHOD: 'quantile',
  FIXED_BREAKS: [0.2, 0.4, 0.6, 0.8],
  BREAK_JITTER: 0.05,            // Monte Carlo jitter of fixed breaks (quantile breaks are recomputed per draw)
  // PHASE[need class - 1][feasibility class - 1]; class 1 = Very Low ... 5 = Very High. A DFO may move a cell (logged).
  PHASE: [[5, 5, 5, 5, 4],       // need Very Low   (feasibility Very Low ... Very High)
          [5, 4, 4, 4, 3],       // need Low
          [4, 3, 3, 3, 2],       // need Moderate
          [3, 2, 2, 2, 1],       // need High
          [2, 2, 1, 1, 1]],      // need Very High
  // Section 10.4 intervention thresholds
  RX: {FIRE_F13: 0.55, STAB_S: 0.45, INVASIVE_N7: 0.30, SMC_M: 0.35, SMC_RESP_M: 0.50},
  SITE_SPLITS: [0.33, 0.66],
  MC_K: 500, MC_SEED: 2026, MC_CONC: 125,
  CV_MIN: 0.05, RHO_MAX: 0.75, VIF_MAX: 5, X1_RHO_MAX: 0.60, INDEP_MAX: 0.60, OAT_MAX_SHARE: 0.15
};

/* ---------- model structure ---------- */
var N_KEYS = ['N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7', 'N8'];
var F_KEYS = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12', 'F13', 'F14'];
var GROUPS = {M: ['F1', 'F2', 'F3', 'F4'], S: ['F5', 'F6', 'F7', 'F8', 'F9'],
              T: ['F10', 'F11', 'F12'], R: ['F13', 'F14']};
var G_KEYS = ['M', 'S', 'T', 'R'];
var GROUP_OF = {};
G_KEYS.forEach(function (g) { GROUPS[g].forEach(function (k) { GROUP_OF[k] = g; }); });
var GP = {};    // group points (fixed 35/35/18/12)
G_KEYS.forEach(function (g) { GP[g] = GROUPS[g].reduce(function (s, k) { return s + CFG.W_F[k]; }, 0); });
var PARAMS = N_KEYS.concat(F_KEYS);
var NAMES = {
  N1: 'Canopy deficit', N2: 'Bare soil at peak greenness', N3: 'NDVI decline (RESTREND)', N4: 'Erosion (RUSLE)',
  N5: 'Biomass deficit', N6: 'Unrecovered tree loss', N7: 'Evergreen shrub invasion', N8: 'Near dense forest',
  F1: 'Wetness (CTI)', F2: 'Soil water capacity', F3: 'Climatic water balance', F4: 'Near seasonal water',
  F5: 'Soil depth proxy', F6: 'Low rockiness', F7: 'Texture', F8: 'Low coarse fragments', F9: 'pH',
  F10: 'Slope', F11: 'Cool aspect (heat load)', F12: 'Concave curvature', F13: 'Low fire frequency',
  F14: 'Low biotic pressure'
};
// Map codes on all three maps (Section 13.3): 1-5 classes / phases, 6 PROTECTED (C1), 7 EXCLUDED (C2-C7)
var PHASE_ORDER = ['PHASE_1', 'PHASE_2', 'PHASE_3', 'PHASE_4', 'PHASE_5', 'PROTECTED', 'EXCLUDED'];
var PRIORITY_NAMES = PHASE_ORDER;
var PAL_PHASE = ['#a50026', '#f46d43', '#fdae61', '#fee08b', '#ffffbf', '#1a9850', '#bdbdbd'];   // Map 3
var PAL_NEED = ['#ffffcc', '#fed976', '#fd8d3c', '#e31a1c', '#800026', '#1a9850', '#bdbdbd'];    // Map 1: VL..VH, Prot, Excl
var PAL_FEAS = ['#8c510a', '#d8b365', '#c7eae5', '#5ab4ac', '#2166ac', '#1a9850', '#bdbdbd'];    // Map 2
var CLASS5 = ['Very Low', 'Low', 'Moderate', 'High', 'Very High'];
var TAIL_LBL = ['Protected (dense, canopy >= 40 %)', 'Excluded (water, drain, rock, built-up, cropland, slope > 45 %)'];
var PHASE_TEXT = {
  PHASE_1: 'Highest priority; first plantation season', PHASE_2: 'Next season; most blocks need SMC alongside planting',
  PHASE_3: 'Third tranche of the annual targets', PHASE_4: 'Fourth tranche; lower need or difficult sites',
  PHASE_5: 'Lowest priority; mostly ANR, gap planting or protection',
  PROTECTED: 'C1: canopy >= 40 %; protection only', EXCLUDED: 'C2-C7: water, drains, slope > 45 %, built-up, cropland, rock'
};
// Section 10.4 (rev. 1): rule order = code 1..11
var RX_ORDER = ['PROTECT_DENSE', 'NOT_PLANTABLE', 'FIRE_PROTECTION_FIRST', 'HYDRO_COMPATIBLE_PLANTING',
                'SOIL_STABILISATION_FIRST', 'ROCKY_MICROSITE', 'INVASIVE_CLEAR_THEN_PLANT', 'SMC_DROUGHT_HARDY',
                'ANR_GAP_PLANTING', 'BLANK_AREA_PLANTATION', 'MIXED_NATIVE_PLANTATION'];
var RX_PAL = ['#00441b', '#bdbdbd', '#e31a1c', '#2171b5', '#8c510a', '#636363',
              '#984ea3', '#fd8d3c', '#a1d99b', '#ffd92f', '#41ab5d'];
var RX_LABELS = {
  PROTECT_DENSE: 'Protect dense forest', NOT_PLANTABLE: 'Not plantable',
  BLANK_AREA_PLANTATION: 'Blank-area plantation (native species)', FIRE_PROTECTION_FIRST: 'Fire protection first',
  HYDRO_COMPATIBLE_PLANTING: 'Hydrology-compatible planting', SOIL_STABILISATION_FIRST: 'Soil stabilisation first',
  ROCKY_MICROSITE: 'Rocky microsite planting', INVASIVE_CLEAR_THEN_PLANT: 'Clear invasives, then plant',
  SMC_DROUGHT_HARDY: 'SMC + drought-hardy natives', ANR_GAP_PLANTING: 'ANR + gap planting',
  MIXED_NATIVE_PLANTATION: 'Mixed native plantation'
};
var CHANGE_ORDER = ['NEWLY_PRIORITISED', 'PRIORITY_RETAINED', 'DEPRIORITISED', 'NO_MAJOR_CHANGE', 'NOT_IN_V21'];
var CHANGE_PAL = ['#d73027', '#fc8d59', '#4575b4', '#e0e0e0', '#ffffff'];
var CHANGE_LABELS = {NEWLY_PRIORITISED: 'Newly prioritised (v2.1 Cat 4-5 -> Phase 1-3)',
                     PRIORITY_RETAINED: 'Priority retained (Cat 1-2 -> Phase 1-3)',
                     DEPRIORITISED: 'De-prioritised (Cat 1-2 -> Phase 4-5 / Prot / Excl)',
                     NO_MAJOR_CHANGE: 'No major change', NOT_IN_V21: 'Not in v2.1 table'};
var AOI_FC = ee.FeatureCollection(CFG.AOI_ASSET);
var AOI = AOI_FC.geometry().dissolve({maxError: 1});

/* ---------- small helpers (ES5 only: the Code Editor has an older JavaScript engine) ---------- */
// evaluate() with up to 2 retries; make() builds a fresh request; retry runs 2 s later, outside
// Earth Engine's reply handler; each callback runs once.
function evalRetry(make, cb, attempt) {
  attempt = attempt || 1;
  var answered = false;
  make().evaluate(function (val, err) {
    if (answered) { return; }
    answered = true;
    if (err && attempt < 3) {
      print('Request failed (' + err + ') - retrying (' + (attempt + 1) + '/3) ...');
      ui.util.setTimeout(function () { evalRetry(make, cb, attempt + 1); }, 2000);
      return;
    }
    cb(val, err);
  });
}
function imul32(a, b) {        // 32-bit integer multiply (Math.imul is missing in the Code Editor)
  var ah = (a >>> 16) & 0xffff, al = a & 0xffff, bh = (b >>> 16) & 0xffff, bl = b & 0xffff;
  return ((al * bl) + (((ah * bl + al * bh) << 16) >>> 0)) | 0;
}
function mulberry32(a) {
  return function () {
    a = a | 0; a = (a + 0x6D2B79F5) | 0;
    var t = imul32(a ^ (a >>> 15), 1 | a);
    t = (t + imul32(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
var RNG = mulberry32(CFG.MC_SEED);
function rnorm() {
  var u1 = 0;
  while (u1 === 0) { u1 = RNG(); }
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * RNG());
}
function rgamma(alpha) {                       // Marsaglia & Tsang (2000)
  if (!(alpha > 0)) { return 0; }
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
function dirichlet(weights) {                  // weights: array of points (any total)
  var tot = weights.reduce(function (s, w) { return s + w; }, 0);
  var g = weights.map(function (w) { return rgamma(CFG.MC_CONC * w / tot); });
  var gs = g.reduce(function (s, v) { return s + v; }, 0);
  return g.map(function (v) { return v / gs; });
}
function avgRanks(x) {
  var idx = x.map(function (v, i) { return i; }).sort(function (a, b) { return x[a] - x[b]; });
  var r = new Array(x.length), i = 0;
  while (i < idx.length) {
    var j = i;
    while (j + 1 < idx.length && x[idx[j + 1]] === x[idx[i]]) { j++; }
    for (var t = i; t <= j; t++) { r[idx[t]] = (i + j) / 2 + 1; }
    i = j + 1;
  }
  return r;
}
function pearson(a, b) {
  var n = a.length, ma = 0, mb = 0, sab = 0, saa = 0, sbb = 0, i;
  for (i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n; mb /= n;
  for (i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) * (a[i] - ma); sbb += (b[i] - mb) * (b[i] - mb); }
  return (saa > 0 && sbb > 0) ? sab / Math.sqrt(saa * sbb) : null;
}
function vifOf(cols) {                         // VIF = diag(inverse correlation matrix)
  var m = cols.length, i, j, k, a = [], out = [];
  for (i = 0; i < m; i++) {
    a.push([]);
    for (j = 0; j < m; j++) { a[i].push(i === j ? 1 : (pearson(cols[i], cols[j]) || 0)); }
    for (j = 0; j < m; j++) { a[i].push(i === j ? 1 : 0); }
  }
  for (i = 0; i < m; i++) {
    var piv = i;
    for (k = i + 1; k < m; k++) { if (Math.abs(a[k][i]) > Math.abs(a[piv][i])) { piv = k; } }
    if (Math.abs(a[piv][i]) < 1e-10) { return cols.map(function () { return Infinity; }); }
    var tmp = a[i]; a[i] = a[piv]; a[piv] = tmp;
    var d = a[i][i];
    for (j = 0; j < 2 * m; j++) { a[i][j] /= d; }
    for (k = 0; k < m; k++) {
      if (k === i) { continue; }
      var f = a[k][i];
      for (j = 0; j < 2 * m; j++) { a[k][j] -= f * a[i][j]; }
    }
  }
  for (i = 0; i < m; i++) { out.push(a[i][m + i]); }
  return out;
}
function b01(x) { return ee.Number(ee.Algorithms.If(x, 1, 0)); }   // Boolean -> 0/1 number (safe .and/.or)
function yes(f, key) { return b01(ee.String(f.get(key)).equals('yes')); }
function fmt(n) { return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
function cls3(x) {
  return ee.Algorithms.If(x.lt(CFG.SITE_SPLITS[0]), 'Low', ee.Algorithms.If(x.lt(CFG.SITE_SPLITS[1]), 'Med', 'High'));
}

/* ---------- Publishing: three maps, area statement, legends, click card, exports (both stages) ---------- */
function publishAll(fin, mapFC) {
  mapFC = mapFC || fin;
  var CRS = CFG.CRS, tag = CFG.RANGE_NAME;
  var scoredFC = mapFC.filter(ee.Filter.neq('RNI', -1));
  function blockRaster(prop, src) { return (src || mapFC).reduceToImage([prop], ee.Reducer.first()).rename(prop); }
  function exportImg(img, name, scale) {
    Export.image.toDrive({image: img.clip(AOI), description: 'FRPIM02_' + name, folder: CFG.DRIVE_FOLDER,
      fileNamePrefix: 'FRPIM02_' + name + '_' + tag, region: AOI, crs: CRS, scale: scale, maxPixels: 1e11});
  }
  /* GeoTIFFs: one per map (Section 13.3), then supporting maps (products 5, 7, 9) */
  [[blockRaster('need_map'), 'Map1_RNI_5class'], [blockRaster('RNI', scoredFC), 'Map1a_RNI_continuous'],
   [blockRaster('feas_map'), 'Map2_RFI_5class'], [blockRaster('RFI', scoredFC), 'Map2a_RFI_continuous'],
   [blockRaster('phase_map'), 'Map3_Priority_Phase']].forEach(function (p) {
    Export.image.toDrive({image: p[0].toFloat().clip(AOI), description: 'FRPIM_v2_2_' + tag + '_' + p[1],
      folder: CFG.DRIVE_FOLDER, fileNamePrefix: 'FRPIM_v2_2_' + tag + '_' + p[1],
      region: AOI, crs: CRS, scale: 30, maxPixels: 1e13});
  });
  exportImg(blockRaster('rx_code').toByte(), 'intervention_map', 30);
  exportImg(blockRaster('stability_p12', fin).toFloat(), 'stability_p12_map', 30);
  exportImg(blockRaster('change_code').toByte(), 'v21_v22_comparison_map', 30);
  /* polygons */
  Export.table.toDrive({collection: fin, description: 'FRPIM02_blocks_geojson', folder: CFG.DRIVE_FOLDER,
    fileNamePrefix: 'FRPIM02_blocks_' + tag, fileFormat: 'GeoJSON'});
  var SHP_FROM = ['block_id', 'beat_id', 'block_area_ha', 'net_plantable_ha', 'canopy_pct', 'canopy_track',
    'constraint_reason', 'degradation_evidence', 'RNI', 'RFI', 'M', 'S', 'T', 'R', 'need_class', 'feasibility_class',
    'priority_class', 'phase_code', 'RPS', 'intervention', 'smc_required', 'site_class', 'stability_p12',
    'phase_modal', 'phase_range', 'b1_sensitive', 'recent_plantation_flag', 'protected_area_flag',
    'waterlogging_flag', 'grassland_option', 'fire_years', 'v21_category', 'change_type', 'field_check', 'anchor_id'];
  var SHP_TO = ['block_id', 'beat_id', 'area_ha', 'net_ha', 'canopy', 'can_track',
    'cons_rsn', 'deg_evid', 'RNI', 'RFI', 'M', 'S', 'T', 'R', 'need_cls', 'feas_cls',
    'priority', 'phase', 'RPS', 'interv', 'smc_req', 'site_cls', 'stab_p12',
    'ph_modal', 'ph_range', 'b1_sens', 'g1_plant', 'g2_pa',
    'g4_wlog', 'g5_grass', 'fire_yrs', 'v21_cat', 'change', 'field_chk', 'anchor_id'];
  Export.table.toDrive({collection: fin.select(SHP_FROM, SHP_TO), description: 'FRPIM02_blocks_shp',
    folder: CFG.DRIVE_FOLDER, fileNamePrefix: 'FRPIM02_blocks_' + tag, fileFormat: 'SHP'});
  /* Product 11: field-check list */
  var FIELD_COLS = ['beat_id', 'block_id', 'priority_class', 'RPS', 'stability_p12', 'stability_reading', 'intervention',
    'smc_required', 'site_class', 'species_group', 'net_plantable_ha', 'canopy_pct', 'degradation_evidence',
    'constraint_reason', 'recent_plantation_flag', 'protected_area_flag', 'waterlogging_flag', 'grassland_option', 'b1_sensitive',
    'field_check_reason', 'fra_rights_check_required', 'staff_rights_FRA_checked', 'staff_encroachment_checked',
    'staff_decision', 'staff_remarks', 'lon', 'lat'];
  var fieldList = fin.filter(ee.Filter.eq('field_check', 'yes')).map(function (f) {
    var c = f.centroid(1).geometry().coordinates();
    return f.set({staff_rights_FRA_checked: '', staff_encroachment_checked: '', staff_decision: '',
                  staff_remarks: '', lon: c.get(0), lat: c.get(1)});
  }).sort('RPS', false).sort('phase_map').sort('beat_id');
  Export.table.toDrive({collection: fieldList, description: 'FRPIM02_field_check_list', folder: CFG.DRIVE_FOLDER,
    fileNamePrefix: 'FRPIM02_field_check_list_' + tag, fileFormat: 'CSV', selectors: FIELD_COLS});

  /* ---- Section 13.4: area statement in hectares (every class on every map) ---- */
  var CLASS_LBL = CLASS5.concat(['Protected (C1)', 'Excluded (C2-C7)']);
  var PHASE_LBL = ['Phase 1', 'Phase 2', 'Phase 3', 'Phase 4', 'Phase 5', 'Protected (C1)', 'Excluded (C2-C7)'];
  function round1(x) { return ee.Number(x).multiply(10).round().divide(10); }
  function areaTable(prop, labels, mapName) {
    var groups = ee.List(mapFC.reduceColumns(
      ee.Reducer.sum().repeat(2).combine({reducer2: ee.Reducer.count(), sharedInputs: false})
        .group({groupField: 3, groupName: 'code'}),
      ['block_area_ha', 'net_plantable_ha', 'block_area_ha', prop]).get('groups'));
    var byCode = ee.Dictionary.fromLists(groups.map(function (gq) { return ee.Number(ee.Dictionary(gq).get('code')).format('%d'); }), groups);
    return ee.FeatureCollection([1, 2, 3, 4, 5, 6, 7].map(function (c) {
      var gq = ee.Dictionary(byCode.get(String(c), ee.Dictionary({sum: [0, 0], count: 0})));
      var sums = ee.List(gq.get('sum'));
      return ee.Feature(null, {map: mapName, code: c, class_name: labels[c - 1], blocks: gq.get('count'),
                               gross_ha: round1(sums.get(0)), net_plantable_ha: round1(sums.get(1))});
    }));
  }
  var retainedFC = mapFC.filter(ee.Filter.eq('excluded', 0));
  var insidePartialHa = round1(ee.Number(retainedFC.aggregate_sum('block_area_ha')).subtract(retainedFC.aggregate_sum('net_plantable_ha')));
  var AREA = areaTable('need_map', CLASS_LBL, 'Map 1 - RNI')
    .merge(areaTable('feas_map', CLASS_LBL, 'Map 2 - RFI'))
    .merge(areaTable('phase_map', PHASE_LBL, 'Map 3 - Priority phase'))
    .merge(ee.FeatureCollection([
      ee.Feature(null, {map: 'All maps', code: 8, class_name: 'Excluded area inside partly constrained blocks', blocks: '',
                        gross_ha: insidePartialHa, net_plantable_ha: ''}),
      ee.Feature(null, {map: 'All maps', code: 9, class_name: 'Total (range area in blocks >= 2 ha)', blocks: mapFC.size(),
                        gross_ha: round1(mapFC.aggregate_sum('block_area_ha')), net_plantable_ha: round1(mapFC.aggregate_sum('net_plantable_ha'))})
    ]));
  Export.table.toDrive({collection: AREA, description: 'FRPIM_v2_2_' + tag + '_AreaStatement', folder: CFG.DRIVE_FOLDER,
    fileNamePrefix: 'FRPIM_v2_2_' + tag + '_AreaStatement', fileFormat: 'CSV',
    selectors: ['map', 'code', 'class_name', 'blocks', 'gross_ha', 'net_plantable_ha']});

  /* ---- Section 13.3: three separate maps, each its own layer ---- */
  function styledBlocks(fc, prop, palette, alpha) {      // codes 1..n -> palette[0..n-1]
    var pal = ee.List(palette.map(function (c) { return c.replace('#', '') + alpha; }));
    return fc.map(function (f) {
      var i = ee.Number(f.get(prop)).int().subtract(1);
      return f.set('style', ee.Dictionary({color: 'ffffffcc', width: 0.6, fillColor: pal.get(i)}));
    }).style({styleProperty: 'style'});
  }
  var outlineVis = ee.Image().byte().paint(mapFC, 1, 0.6).visualize({palette: ['ffffff'], opacity: 0.8});
  var tailVis = styledBlocks(mapFC.filter(ee.Filter.eq('excluded', 1)), 'phase_map', PAL_PHASE, 'e6');   // Prot/Excl on 1a/2a
  function rasterVis(img, palette) {
    return img.visualize({min: 0, max: 1, palette: palette.map(function (c) { return c.replace('#', ''); }), opacity: 0.9})
              .blend(tailVis).blend(outlineVis);
  }
  var map1a = rasterVis(blockRaster('RNI', scoredFC), PAL_NEED.slice(0, 5));
  var map1 = styledBlocks(mapFC, 'need_map', PAL_NEED, 'e6');
  var map2a = rasterVis(blockRaster('RFI', scoredFC), PAL_FEAS.slice(0, 5));
  var map2 = styledBlocks(mapFC, 'feas_map', PAL_FEAS, 'e6');
  var map3 = styledBlocks(mapFC, 'phase_map', PAL_PHASE, 'e6');
  var rxVis = styledBlocks(mapFC, 'rx_code', RX_PAL, 'e6');
  var changeVis = styledBlocks(mapFC, 'change_code', CHANGE_PAL, 'e6');
  var g5Vis = ee.Image().byte().paint(mapFC.filter(ee.Filter.eq('grassland_option', 1)), 1, 2).visualize({palette: ['00ffff']});
  var gridVis = ee.Image().byte().paint(mapFC, 0, 1).visualize({palette: ['333333']});
  var fabCol = ee.ImageCollection('projects/sat-io/open-datasets/FABDEM').filterBounds(AOI);
  var fab = fabCol.mosaic().setDefaultProjection(ee.Image(fabCol.first()).projection()).select([0]);
  var hillshade = ee.Terrain.hillshade(fab, 315, 35).visualize({min: 120, max: 255, palette: ['000000', 'ffffff']});
  var inside = ee.Image(1).clip(AOI).mask();
  var dimOutside = ee.Image(0).updateMask(inside.not()).visualize({palette: ['000000'], opacity: 0.55});
  var boundaryVis = ee.Image().byte().paint(AOI_FC, 1, 2.5).visualize({palette: ['ffff00']});

  Map.clear();
  Map.setOptions('HYBRID');
  Map.setControlVisibility({all: true});
  Map.centerObject(AOI, 12);
  Map.addLayer(hillshade.updateMask(inside), {opacity: 0.45}, 'Relief (FABDEM hillshade)');
  Map.addLayer(dimOutside, {}, 'Outside range (dimmed)');
  Map.addLayer(map1a, {}, 'Map 1a - RNI (continuous)', false);
  Map.addLayer(map1, {}, 'Map 1 - Restoration Need Index (5 classes)', false);
  Map.addLayer(map2a, {}, 'Map 2a - RFI (continuous)', false);
  Map.addLayer(map2, {}, 'Map 2 - Restoration Feasibility Index (5 classes)', false);
  Map.addLayer(map3, {}, 'Map 3 - Restoration Priority (Phase 1-5)', true);
  Map.addLayer(rxVis, {}, 'Optional - Intervention type', false);
  Map.addLayer(g5Vis, {}, 'Optional - grassland note (G5)', false);
  Map.addLayer(changeVis, {}, 'Optional - change from v2.1', false);
  Map.addLayer(blockRaster('stability_p12', fin).visualize({min: 0, max: 1, palette: ['d73027', 'ffffbf', '1a9850']}),
               {}, 'Optional - reliability (share of runs in Phase 1-2)', false);
  Map.addLayer(gridVis, {}, 'Block grid (10 ha)', false);
  Map.addLayer(boundaryVis, {}, 'Range / beat boundary', true);
  var SEL_INDEX = Map.layers().length();
  Map.addLayer(ee.Image(), {}, 'Selected block', false);

  var subtitle = ui.Label('Sabarkantha Division, Gujarat  ·  FRPIM v2.2  ·  10 ha blocks',
                          {fontSize: '12px', color: '#444444', margin: '2px 0 0 0'});
  Map.add(ui.Panel([ui.Label('Forest Restoration Priority — ' + CFG.RANGE_NAME + ' Range',
                             {fontWeight: 'bold', fontSize: '18px', margin: '0'}), subtitle,
                    ui.Label('Layers menu (top right): Map 1 Need · Map 2 Feasibility · Map 3 Priority phase. Click a block for details.',
                             {fontSize: '11px', color: '#666666', margin: '2px 0 0 0'})],
                   ui.Panel.Layout.flow('vertical'), {position: 'top-center', padding: '6px 14px'}));
  Map.add(ui.Panel([ui.Label('▲', {fontSize: '20px', margin: '0 0 -6px 0', textAlign: 'center', stretch: 'horizontal'}),
                    ui.Label('N', {fontWeight: 'bold', fontSize: '14px', margin: '0', textAlign: 'center', stretch: 'horizontal'})],
                   ui.Panel.Layout.flow('vertical'), {position: 'top-left', padding: '2px 8px', width: '44px'}));

  /* legends (Section 13.3 code): Map 3 bottom-left, Map 1 bottom-right, Map 2 middle-right — with hectares */
  var AREA_C = null;   // {map name: {code: {blocks, gross, net}}}
  function swatchRow(color, label, extra) {
    return ui.Panel([
      ui.Label('', {backgroundColor: color, padding: '8px', margin: '2px 6px 2px 0', border: '1px solid #999999'}),
      ui.Label(label, {margin: '2px 0', fontSize: '11px', stretch: 'horizontal'}),
      ui.Label(extra || '', {margin: '2px 0', fontSize: '10px', color: '#555555'})
    ], ui.Panel.Layout.flow('horizontal'));
  }
  function gradientBar(palette, lo, hi) {
    var bar = ui.Thumbnail({image: ee.Image.pixelLonLat().select(0),
      params: {bbox: [0, 0, 1, 0.1], dimensions: '200x10', format: 'png', min: 0, max: 1,
               palette: palette.map(function (c) { return c.replace('#', ''); })},
      style: {stretch: 'horizontal', margin: '2px 0', maxHeight: '14px'}});
    return [bar, ui.Panel([ui.Label(lo, {fontSize: '10px', margin: '0'}),
                           ui.Label(hi, {fontSize: '10px', margin: '0 0 0 auto', textAlign: 'right', stretch: 'horizontal'})],
                          ui.Panel.Layout.flow('horizontal'))];
  }
  function haText(mapName, code) {
    if (!AREA_C || !AREA_C[mapName] || !AREA_C[mapName][code]) { return ''; }
    var a = AREA_C[mapName][code];
    return a.blocks + ' bl · ' + fmt(a.net) + ' ha';
  }
  var legend3 = ui.Panel({style: {position: 'bottom-left', padding: '6px 10px', width: '330px'}});
  var legend1 = ui.Panel({style: {position: 'bottom-right', padding: '6px 10px', width: '260px'}});
  var legend2 = ui.Panel({style: {position: 'middle-right', padding: '6px 10px', width: '260px'}});
  function drawLegends() {
    legend3.clear(); legend1.clear(); legend2.clear();
    legend3.add(ui.Label('Map 3 - Restoration Priority', {fontWeight: 'bold', fontSize: '13px', margin: '0 0 2px 0'}));
    PHASE_LBL.forEach(function (l, i) {
      legend3.add(swatchRow(PAL_PHASE[i], i < 5 ? l : TAIL_LBL[i - 5], haText('Map 3 - Priority phase', i + 1)));
    });
    legend3.add(ui.Label('ha = net plantable area. Breaks: ' + CFG.CLASS_METHOD + '.', {fontSize: '10px', color: '#666666'}));
    [[legend1, 'Map 1 - Restoration Need', 'Map 1 - RNI', PAL_NEED, '0 intact', '1 severely degraded'],
     [legend2, 'Map 2 - Restoration Feasibility', 'Map 2 - RFI', PAL_FEAS, '0 hard site', '1 easy site']].forEach(function (x) {
      x[0].add(ui.Label(x[1], {fontWeight: 'bold', fontSize: '12px', margin: '0'}));
      CLASS5.concat(['Protected', 'Excluded']).forEach(function (l, i) { x[0].add(swatchRow(x[3][i], l, haText(x[2], i + 1))); });
      x[0].add(ui.Label('Continuous layer (' + (x[2] === 'Map 1 - RNI' ? '1a' : '2a') + '):', {fontSize: '10px', color: '#666666', margin: '2px 0 0 0'}));
      gradientBar(x[3].slice(0, 5), x[4], x[5]).forEach(function (w) { x[0].add(w); });
    });
  }
  Map.add(legend3); Map.add(legend1); Map.add(legend2);
  drawLegends();

  evalRetry(function () {
    return ee.Dictionary({area: AREA.toList(30).map(function (f) { return ee.Feature(f).toDictionary(); }),
                          rx: mapFC.reduceColumns(ee.Reducer.sum().group({groupField: 1, groupName: 'k'}),
                                                  ['net_plantable_ha', 'intervention']).get('groups'),
                          g5N: mapFC.filter(ee.Filter.eq('grassland_option', 1)).size(),
                          anchor: ee.Feature(mapFC.first()).get('anchor_id'),
                          br: ee.Feature(mapFC.filter(ee.Filter.eq('excluded', 0)).first()).toDictionary(['rni_breaks', 'rfi_breaks'])});
  }, function (d, err) {
    if (err) { print('Area statement could not be computed: ' + err); return; }
    AREA_C = {};
    (d.area || []).forEach(function (r) {
      AREA_C[r.map] = AREA_C[r.map] || {};
      AREA_C[r.map][r.code] = {blocks: r.blocks, gross: r.gross_ha, net: r.net_plantable_ha};
    });
    subtitle.setValue('Sabarkantha Division, Gujarat  ·  FRPIM v2.2  ·  10 ha blocks  ·  anchors: ' + d.anchor +
                      '  ·  G5 grassland note: ' + d.g5N + ' blocks (stay under plantation)');
    drawLegends();
    print('Class breaks (' + CFG.CLASS_METHOD + ') — RNI: ' + ((d.br || {}).rni_breaks || '-') + ' | RFI: ' + ((d.br || {}).rfi_breaks || '-'));
    var rows = [['Map', 'Class', 'Blocks', 'Gross area (ha)', 'Net plantable area (ha)']];
    (d.area || []).forEach(function (r) { rows.push([r.map, r.class_name, String(r.blocks), r.gross_ha, r.net_plantable_ha === '' ? null : r.net_plantable_ha]); });
    print(ui.Chart(rows, 'Table', {title: 'Section 13.4 — Area statement (hectares)', allowHtml: false}));
    var rowsC = [['Phase', 'Net plantable ha', {role: 'style'}, {role: 'annotation'}]];
    [1, 2, 3, 4, 5].forEach(function (c) {
      var a = (AREA_C['Map 3 - Priority phase'] || {})[c] || {net: 0};
      rowsC.push(['Phase ' + c, a.net, PAL_PHASE[c - 1], fmt(a.net) + ' ha']);
    });
    print(ui.Chart(rowsC, 'BarChart', {title: 'Map 3 - net plantable area by priority phase (ha)', legend: {position: 'none'},
                                       hAxis: {title: 'hectares'}, chartArea: {left: 90}}));
    var rowsR = [['Intervention', 'Net plantable ha', {role: 'style'}, {role: 'annotation'}]];
    (d.rx || []).forEach(function (gq) {
      var i = RX_ORDER.indexOf(gq.k);
      if (i >= 0 && gq.sum > 0) { rowsR.push([RX_LABELS[gq.k], gq.sum, RX_PAL[i], fmt(gq.sum) + ' ha']); }
    });
    print(ui.Chart(rowsR, 'BarChart', {title: 'Net plantable area by intervention (ha)', legend: {position: 'none'},
                                       hAxis: {title: 'hectares'}, chartArea: {left: 230}}));
  });

  /* ---- click a block: info card ---- */
  var card = ui.Panel({style: {position: 'top-right', width: '320px', padding: '8px 10px', shown: false}});
  Map.add(card);
  var clickId = 0;
  function cardRow(label, value) {
    return ui.Panel([ui.Label(label, {fontSize: '11px', color: '#555555', margin: '1px 0', width: '125px'}),
                     ui.Label(String(value), {fontSize: '12px', margin: '1px 0', stretch: 'horizontal'})],
                    ui.Panel.Layout.flow('horizontal'));
  }
  function bar(name, v, good) {
    v = Number(v) || 0;
    var w = Math.max(2, Math.round(v * 140));
    var q2 = good === false ? 1 - v : v;
    var colr = q2 >= 0.66 ? '#1a9850' : (q2 >= 0.33 ? '#fee08b' : '#d73027');
    return ui.Panel([ui.Label(name, {fontSize: '11px', margin: '2px 0', width: '125px'}),
                     ui.Label('', {backgroundColor: colr, padding: '5px ' + (w / 2) + 'px', margin: '4px 6px 0 0'}),
                     ui.Label(v.toFixed(2), {fontSize: '11px', margin: '2px 0'})], ui.Panel.Layout.flow('horizontal'));
  }
  Map.style().set('cursor', 'crosshair');
  Map.onClick(function (c) {
    var my = ++clickId;
    var pt = ee.Geometry.Point([c.lon, c.lat]);
    var hit = mapFC.filterBounds(pt);
    card.clear();
    card.style().set('shown', true);
    card.add(ui.Label('Loading block ...', {fontSize: '12px', color: '#666666'}));
    Map.layers().set(SEL_INDEX, ui.Map.Layer(ee.Image().byte().paint(hit, 1, 3).visualize({palette: ['ff00ff']}), {}, 'Selected block'));
    evalRetry(function () {
      return ee.Dictionary({n: hit.size(), p: ee.Algorithms.If(hit.size().gt(0), ee.Feature(hit.first()).toDictionary(), null)});
    }, function (d, err) {
      if (my !== clickId) { return; }
      card.clear();
      if (err || !d || !d.n) { card.add(ui.Label('No block here. Click inside the range.', {fontSize: '12px'})); return; }
      var p = d.p, code = Number(p.phase_map) || 7;
      card.add(ui.Panel([ui.Label('Block ' + p.block_id, {fontWeight: 'bold', fontSize: '14px', margin: '0 0 4px 0'}),
                         ui.Button({label: '✕', onClick: function () { card.style().set('shown', false); },
                                    style: {margin: '0 0 0 auto', padding: '0'}})], ui.Panel.Layout.flow('horizontal')));
      card.add(swatchRow(PAL_PHASE[code - 1], (code <= 5 ? 'Phase ' + code : (code === 6 ? 'PROTECTED' : 'EXCLUDED')) +
                         ' — ' + PHASE_TEXT[PHASE_ORDER[code - 1]], ''));
      card.add(cardRow('Intervention', (RX_LABELS[p.intervention] || p.intervention) + (p.smc_required === 'yes' ? ' + SMC' : '')));
      card.add(cardRow('Species group', p.species_group || '-'));
      if (code <= 5) {
        card.add(cardRow('Need class (Map 1)', p.need_class_name + '  (RNI ' + Number(p.RNI).toFixed(3) + ')'));
        card.add(cardRow('Feasibility (Map 2)', p.feasibility_class_name + '  (RFI ' + Number(p.RFI).toFixed(3) + ')'));
        card.add(cardRow('Rank within phase', 'RPS ' + Number(p.RPS).toFixed(3)));
      }
      card.add(cardRow('Net plantable', Number(p.net_plantable_ha).toFixed(2) + ' of ' + Number(p.block_area_ha).toFixed(2) + ' ha'));
      card.add(cardRow('Canopy cover', Number(p.canopy_pct).toFixed(1) + ' %'));
      card.add(cardRow('Degradation evidence', p.degradation_evidence + ' of 4 (' +
        ['DE1', 'DE2', 'DE3', 'DE4'].filter(function (k) { return p[k] === 'yes'; }).join(', ') + ')  - confidence only'));
      card.add(cardRow('Constraints', p.constraint_reason || 'none'));
      card.add(cardRow('Flags', [['recent_plantation_flag', 'G1 recent plantation?'], ['protected_area_flag', 'G2 protected area'],
        ['waterlogging_flag', 'G4 waterlogging']].filter(function (k) { return p[k[0]] === 'yes'; })
        .concat(Number(p.grassland_option) === 1 ? [['g5', 'G5 grassland option (optional)']] : [])
        .map(function (k) { return k[1]; }).join(', ') || 'none'));
      if (p.v21_category) { card.add(cardRow('v2.1 category', p.v21_category + '  (' + (p.change_type || '') + ')')); }
      var stabRow = cardRow('Reliability', code <= 5 ? 'computing ...' : '-');
      card.add(stabRow);
      card.add(ui.Label('Group scores', {fontWeight: 'bold', fontSize: '12px', margin: '6px 0 2px 0'}));
      card.add(bar('M moisture', p.M)); card.add(bar('S soil', p.S));
      card.add(bar('T terrain', p.T)); card.add(bar('R low risk', p.R));
      card.add(ui.Label('Location: ' + c.lat.toFixed(5) + ' N, ' + c.lon.toFixed(5) + ' E',
                        {fontSize: '10px', color: '#666666', margin: '6px 0 0 0'}));
      if (code > 5) { return; }
      evalRetry(function () { return ee.Feature(fin.filterBounds(pt).first()).toDictionary(['stability_p12', 'phase_range']); },
        function (s, e2) {
          if (my !== clickId) { return; }
          stabRow.widgets().get(1).setValue((e2 || !s || s.stability_p12 === undefined) ? 'n/a' :
            Math.round(s.stability_p12 * 100) + ' % of runs in Phase 1-2; phase range ' + s.phase_range +
            (code <= 2 ? (s.stability_p12 > 0.8 ? ' (robust)' : (s.stability_p12 >= 0.5 ? ' (moderate)' : ' (marginal)')) : ''));
        });
    });
  });
  print('MAP: tick Map 1, Map 2 or Map 3 in the Layers menu (top right). Click any block for its details.');

  /* ---- print-quality maps (5 m RGB) and a PNG for slides ---- */
  var printRegion = AOI.bounds(1).buffer(1500, 10);
  [['Map3_priority_phase', map3], ['Map1_RNI_5class', map1], ['Map2_RFI_5class', map2], ['intervention', rxVis]].forEach(function (x) {
    Export.image.toDrive({image: hillshade.blend(x[1]).blend(boundaryVis).clip(printRegion),
      description: 'FRPIM02_print_' + x[0] + '_RGB', folder: CFG.DRIVE_FOLDER,
      fileNamePrefix: 'FRPIM02_print_' + x[0] + '_RGB_' + tag, region: printRegion, crs: CRS, scale: 5, maxPixels: 1e11});
  });
  hillshade.blend(map3).blend(boundaryVis).getThumbURL({region: printRegion, dimensions: 2048, format: 'png', crs: CRS},
    function (url, e3) {
      if (!e3 && url) { print(ui.Label('Download Map 3 (priority phase) PNG, 2048 px, for slides', {color: '#1a73e8'}, url)); }
    });
  print('Field-check blocks:', fieldList.size());
}

/* ====================================================================== */
if (CFG.STAGE === 'SCORE') {
/* ====================================================================== */

// Spec rev. 1: C8 is replaced by flag G5 grassland_option, which never excludes a block. A raw table made
// before rev. 1 stores the identical rule as excluded_c8; it is converted here, so RUN 1 need not be repeated.
var raw = ee.FeatureCollection(CFG.RAW_ASSET).map(function (f) {
  var oldC8 = ee.Number(ee.Algorithms.If(ee.Algorithms.IsEqual(f.get('excluded_c8'), null), 0, f.get('excluded_c8')));
  var g5 = ee.Number(ee.Algorithms.If(ee.Algorithms.IsEqual(f.get('grassland_option'), null), oldC8, f.get('grassland_option')));
  var area = ee.Number(f.get('block_area_ha'));
  var fr = ee.Number(ee.Algorithms.If(ee.Algorithms.IsEqual(f.get('constrained_frac'), null), 0, f.get('constrained_frac')));
  var notExcl = ee.Number(f.get('excluded')).eq(0);
  return f.set({
    grassland_option: g5,
    excluded_c8: 0,
    net_plantable_ha: ee.Algorithms.If(notExcl, area.multiply(ee.Number(1).subtract(fr)), 0),
    constraint_reason: ee.String(f.get('constraint_reason')).replace('(^|,)C8$', ''),
    exclusion_reason: ee.Algorithms.If(ee.String(ee.Algorithms.If(ee.Algorithms.IsEqual(f.get('exclusion_reason'), null), '',
                        f.get('exclusion_reason'))).index('C8').gte(0), '', f.get('exclusion_reason'))
  });
});
var N_ALL = raw.size();
var FILL_KEYS = PARAMS.concat(['F5_opt', 'F5_pes']);

/* ---------- Step 18a: null shares (FF-06) and gap fill by beat mean ---------- */
var nullShare = ee.Dictionary.fromLists(FILL_KEYS, FILL_KEYS.map(function (k) {
  return ee.Number(1).subtract(raw.filter(ee.Filter.notNull([k])).size().divide(N_ALL));
}));
var BEAT_MEAN = {}, RANGE_MEAN = {};
FILL_KEYS.forEach(function (k) {
  var ok = raw.filter(ee.Filter.notNull([k]));
  var groups = ee.List(ok.reduceColumns(ee.Reducer.mean().group({groupField: 1, groupName: 'beat'}), [k, 'beat_id']).get('groups'));
  BEAT_MEAN[k] = ee.Dictionary.fromLists(groups.map(function (g) { return ee.String(ee.Dictionary(g).get('beat')); }),
                                         groups.map(function (g) { return ee.Dictionary(g).get('mean'); }));
  RANGE_MEAN[k] = ee.Algorithms.If(ok.size().gt(0), ok.aggregate_mean(k), 0.5);
});
var filled = raw.map(function (f) {
  var beat = ee.String(f.get('beat_id'));
  var out = f, log = ee.List([]);
  FILL_KEYS.forEach(function (k) {
    var v = f.get(k);
    var isNull = ee.Algorithms.IsEqual(v, null);
    out = out.set(k, ee.Algorithms.If(isNull, BEAT_MEAN[k].get(beat, RANGE_MEAN[k]), v));
    log = ee.List(ee.Algorithms.If(isNull, log.add(k), log));
  });
  return out.set('gapfilled', log.join(','));
});
// blocks that enter the need x feasibility matrix: not C1, not C2-C7 > 30 % (G5 never excludes)
var inMatrix0 = filled.filter(ee.Filter.eq('excluded', 0)).filter(ee.Filter.eq('excluded_c8', 0));

/* ---------- Step 18b: statistics for the CV guard ---------- */
var statD = {};
PARAMS.forEach(function (k) {
  statD[k + '_mean'] = inMatrix0.aggregate_mean(k);
  statD[k + '_sd'] = inMatrix0.aggregate_sample_sd(k);
});
print('Computing block statistics in the background ...');
evalRetry(function () {
  return ee.Dictionary({N_all: N_ALL, N_in: inMatrix0.size(), nullShare: nullShare, stats: ee.Dictionary(statD),
                        nC8: filled.filter(ee.Filter.eq('grassland_option', 1)).size(),
                        nExcl: filled.filter(ee.Filter.eq('excluded', 1)).size()});
}, function (STATS, errS) {
if (errS) { print('STOP: could not read the raw block table (has RUN 1 finished?): ' + errS); return; }
print('Blocks: all = ' + STATS.N_all + ' | excluded C1-C7 = ' + STATS.nExcl +
      ' | entering the need x feasibility matrix = ' + STATS.N_in + ' (of which ' + STATS.nC8 +
      ' carry the optional G5 grassland note; they stay under plantation)');
var NR = STATS.N_in;
if (NR < 10) { print('STOP: fewer than 10 blocks enter the matrix — check the raw table.'); return; }
function sdOf(k) { var v = STATS.stats[k + '_sd']; return (typeof v === 'number') ? v : 0; }
function meanOf(k) { var v = STATS.stats[k + '_mean']; return (typeof v === 'number') ? v : 0; }

/* ---------- Step 18c: collinearity (client side, from one table download) ---------- */
var PAIRS_N = [], PAIRS_F = [], i0, j0;
for (i0 = 0; i0 < N_KEYS.length; i0++) { for (j0 = i0 + 1; j0 < N_KEYS.length; j0++) { PAIRS_N.push([N_KEYS[i0], N_KEYS[j0]]); } }
for (i0 = 0; i0 < F_KEYS.length; i0++) { for (j0 = i0 + 1; j0 < F_KEYS.length; j0++) { PAIRS_F.push([F_KEYS[i0], F_KEYS[j0]]); } }
var COLKEYS = PARAMS.concat(['canopy_pct', 'X1']);
print('Computing Spearman correlations and VIF ...');
evalRetry(function () {
  return inMatrix0.filter(ee.Filter.notNull(COLKEYS)).reduceColumns(ee.Reducer.toList(COLKEYS.length), COLKEYS).get('list');
}, function (ROWS, errC) {
if (errC) { print('STOP: could not read the block table for the collinearity screen: ' + errC); return; }
function column(k) { var c = COLKEYS.indexOf(k); return ROWS.map(function (r) { return Number(r[c]); }); }
var RANKS = {};
COLKEYS.forEach(function (k) { RANKS[k] = avgRanks(column(k)); });
var RHO = {};
function setRho(p) {
  var v = (sdOf(p[0]) <= 1e-9 || (PARAMS.indexOf(p[1]) >= 0 && sdOf(p[1]) <= 1e-9)) ? null : pearson(RANKS[p[0]], RANKS[p[1]]);
  RHO[p[0] + '|' + p[1]] = (typeof v === 'number' && isFinite(v)) ? v : null;
}
PAIRS_N.forEach(setRho); PAIRS_F.forEach(setRho);
setRho(['X1', 'canopy_pct']);
function rho(a, b) { var v = RHO[a + '|' + b]; if (v === undefined) { v = RHO[b + '|' + a]; } return v === undefined ? null : v; }
var VIF = {};
[N_KEYS, F_KEYS].forEach(function (keys) {
  var vary = keys.filter(function (k) { return sdOf(k) > 1e-9; });
  var v = vifOf(vary.map(column));
  vary.forEach(function (k, ii) { VIF[k] = v[ii]; });
});
print('Collinearity screen done on ' + ROWS.length + ' blocks.');

/* ---------- Step 19: CV guard and collinearity actions (FF-07, FF-10..14) ---------- */
var W = {};
N_KEYS.forEach(function (k) { W[k] = CFG.W_N[k]; });
F_KEYS.forEach(function (k) { W[k] = CFG.W_F[k]; });
var CV_LOG = [], COL_LOG = [], DROPPED = {};
function peers(k) { return N_KEYS.indexOf(k) >= 0 ? N_KEYS : GROUPS[GROUP_OF[k]]; }   // RNI: whole index; RFI: group
function share(k, pts, exclude) {
  var others = peers(k).filter(function (o) { return o !== k && !DROPPED[o] && exclude.indexOf(o) < 0 && W[o] > 0; });
  var tot = others.reduce(function (s, o) { return s + W[o]; }, 0);
  if (tot <= 0) { return false; }
  others.forEach(function (o) { W[o] += pts * W[o] / tot; });
  return true;
}
PARAMS.forEach(function (k) {
  var m = meanOf(k), sd = sdOf(k);
  var cv = (Math.abs(m) > 1e-12) ? sd / Math.abs(m) : (sd > 0 ? Infinity : 0);
  if (cv < CFG.CV_MIN && W[k] > 0) {
    var pts = W[k];
    DROPPED[k] = true;
    if (share(k, pts, [])) {
      W[k] = 0;
      CV_LOG.push(k + ' CV=' + cv.toFixed(4) + ' -> ' + pts.toFixed(2) + ' pts shared in ' +
                  (N_KEYS.indexOf(k) >= 0 ? 'RNI' : 'group ' + GROUP_OF[k]));
    } else {
      DROPPED[k] = false;
      CV_LOG.push(k + ' CV=' + cv.toFixed(4) + ' but no other parameter to share with — kept');
    }
  }
});
var rX1 = rho('X1', 'canopy_pct');
var FF11 = (rX1 === null || Math.abs(rX1) < CFG.X1_RHO_MAX) ? 'PASS' : 'FAIL';
var r12 = rho('F5', 'F10'), FF12 = 'PASS';
if (r12 !== null && Math.abs(r12) >= CFG.RHO_MAX) {
  FF12 = 'ACTION';
  var mv = Math.min(2, W.F10);
  W.F10 -= mv; W.F11 += mv;
  COL_LOG.push('FF-12 rho(F5,F10)=' + r12.toFixed(3) + ': F10 -' + mv + ' pts, F11 +' + mv);
}
var r13 = rho('N1', 'N5'), FF13 = 'PASS';
if (r13 !== null && Math.abs(r13) >= CFG.RHO_MAX) {
  FF13 = 'ACTION';
  var d13 = W.N1 + W.N5, comp = Math.max(d13 - 5, 0);
  W.N1 = W.N1 * comp / d13; W.N5 = W.N5 * comp / d13; W.N3 += d13 - comp;
  COL_LOG.push('FF-13 rho(N1,N5)=' + r13.toFixed(3) + ': merged into canopy-biomass deficit worth ' + comp.toFixed(2) +
               ' pts, N3 +' + (d13 - comp).toFixed(2));
}
var FF14 = 'PASS';
PAIRS_N.concat(PAIRS_F).forEach(function (p) {
  var key = p[0] + '|' + p[1];
  if (key === 'F5|F10' || key === 'N1|N5') { return; }
  var r = RHO[key];
  if (r === null || Math.abs(r) <= CFG.RHO_MAX) { return; }
  FF14 = 'ACTION';
  var a = p[0], b = p[1];
  var sameUnit = (N_KEYS.indexOf(a) >= 0) || (GROUP_OF[a] === GROUP_OF[b]);
  if (sameUnit && W[a] + W[b] > 0) {
    var hi = Math.max(W[a], W[b]), sum = W[a] + W[b], freed = sum - hi;
    W[a] = W[a] * hi / sum; W[b] = W[b] * hi / sum;
    var shared = share(a, freed, [b]);
    if (!shared) { W[a] += freed * W[a] / hi; W[b] += freed * W[b] / hi; }
    COL_LOG.push('FF-14 ' + key + ' rho=' + r.toFixed(3) + ': merged at the higher weight (' + hi.toFixed(2) + ' pts)');
  } else {
    COL_LOG.push('FF-14 ' + key + ' rho=' + r.toFixed(3) + ': different feasibility groups — REVIEW');
  }
});
Object.keys(VIF).forEach(function (k) {
  if (VIF[k] > CFG.VIF_MAX) { FF14 = 'ACTION'; COL_LOG.push('FF-14 VIF(' + k + ')=' + (isFinite(VIF[k]) ? VIF[k].toFixed(2) : 'singular') + ' > ' + CFG.VIF_MAX + ': REVIEW'); }
});
var sumN = N_KEYS.reduce(function (s, k) { return s + W[k]; }, 0);
var FF07 = Math.abs(sumN - 100) < 1e-6 ? 'PASS' : 'FAIL';
G_KEYS.forEach(function (g) {
  var s = GROUPS[g].reduce(function (a, k) { return a + W[k]; }, 0);
  if (Math.abs(s - GP[g]) > 1e-6) { FF07 = 'FAIL'; }
});
if (FF07 === 'FAIL') { print('FF-07 STOP: weights do not sum to RNI 100 / groups 35-35-18-12.'); return; }
var CV_REWEIGHT_LOG = CV_LOG.length ? CV_LOG.join(' | ') : 'none';
print('Final weights (after CV guard / collinearity):', W);
print('CV guard log:', CV_REWEIGHT_LOG);
print('Collinearity log:', COL_LOG.length ? COL_LOG : 'none');

/* ---------- Step 20: indices RNI and RFI (Section 10.1) ---------- */
var EXP_M = 0.65 * GP.M / (GP.M + GP.S), EXP_S = 0.65 * GP.S / (GP.M + GP.S);
print('Feasibility exponents m, s:', EXP_M.toFixed(3), EXP_S.toFixed(3));
function g(f, k) { return ee.Number(f.get(k)); }
function wsum(f, keys) {
  var s = ee.Number(0);
  keys.forEach(function (k) { s = s.add(g(f, k).multiply(W[k])); });
  return s;
}
function groupScore(f, grp, swap) {
  var s = ee.Number(0);
  GROUPS[grp].forEach(function (k) { s = s.add(g(f, (swap && swap[k]) || k).multiply(W[k])); });
  return s.divide(GP[grp]);
}
function rfiOf(M, S, T, R) {
  var TR = T.multiply(GP.T).add(R.multiply(GP.R)).divide(GP.T + GP.R);
  return M.max(0.01).pow(EXP_M).multiply(S.max(0.01).pow(EXP_S)).multiply(TR.multiply(0.45).add(0.55));
}
var scored0 = filled.map(function (f) {
  var rni = wsum(f, N_KEYS).divide(100);          // no reduction for degradation evidence (Section 6.5)
  var M = groupScore(f, 'M'), S = groupScore(f, 'S'), T = groupScore(f, 'T'), R = groupScore(f, 'R');
  var inM = g(f, 'excluded').eq(0);
  return f.set({
    M: M, S: S, T: T, R: R,
    S_opt: groupScore(f, 'S', {F5: 'F5_opt'}), S_pes: groupScore(f, 'S', {F5: 'F5_pes'}),
    RNI: ee.Algorithms.If(inM, rni, -1), RFI: ee.Algorithms.If(inM, rfiOf(M, S, T, R), -1),   // -1 = not scored
    RFI_core: M.max(0.01).pow(EXP_M).multiply(S.max(0.01).pow(EXP_S)),
    deg_factor: 1
  });
});

/* ---------- Step 21: five classes per index and the 5 x 5 phase matrix (Section 10.2) ---------- */
var ret0 = scored0.filter(ee.Filter.eq('excluded', 0)).sort('block_id');
var N = ee.Number(NR);
function full(v) { return ee.Array(ee.List.repeat(v, N)); }
function cutIdx(p) { return N.multiply(p).ceil().subtract(1).max(0).int(); }   // nearest-rank percentile
var I20 = cutIdx(0.2), I40 = cutIdx(0.4), I60 = cutIdx(0.6), I80 = cutIdx(0.8);
// Quintile breaks: exact 20th/40th/60th/80th percentiles (nearest rank) of the retained blocks.
function breaksOf(a) {
  if (CFG.CLASS_METHOD === 'fixed') { return ee.List(CFG.FIXED_BREAKS); }
  var s = ee.Array(a).sort();
  return ee.List([s.get([I20]), s.get([I40]), s.get([I60]), s.get([I80])]);
}
var BR_RNI = breaksOf(ret0.aggregate_array('RNI'));
var BR_RFI = breaksOf(ret0.aggregate_array('RFI'));
function cls5(v, b) {           // 1 Very Low ... 5 Very High
  v = ee.Number(v); b = ee.List(b);
  return ee.Number(1).add(v.gte(ee.Number(b.get(0)))).add(v.gte(ee.Number(b.get(1))))
                     .add(v.gte(ee.Number(b.get(2)))).add(v.gte(ee.Number(b.get(3))));
}
var PHASE_M = ee.List(CFG.PHASE);                                   // [need-1][feas-1]
var CLASS5_L = ee.List(['', 'Very Low', 'Low', 'Moderate', 'High', 'Very High']);
var PRIORITY_L = ee.List([''].concat(PRIORITY_NAMES));               // code 1..7
var PHASE_TEXT_L = ee.List([''].concat(PHASE_ORDER.map(function (k) { return PHASE_TEXT[k]; })));
function fmtBreaks(b) { return ee.List(b).map(function (x) { return ee.Number(x).format('%.4f'); }).join(', '); }
var BR_TEXT_RNI = fmtBreaks(BR_RNI), BR_TEXT_RFI = fmtBreaks(BR_RFI);
print('Class method: ' + CFG.CLASS_METHOD + ' | RNI class breaks (20/40/60/80):', BR_RNI, '| RFI class breaks:', BR_RFI);

var classed = scored0.map(function (f) {
  var inM = g(f, 'excluded').eq(0);
  var tail = ee.Number(ee.Algorithms.If(g(f, 'excluded_c1').eq(1), 6, 7));     // 6 PROTECTED (C1), 7 EXCLUDED (C2-C7)
  var nc = ee.Number(ee.Algorithms.If(inM, cls5(f.get('RNI'), BR_RNI), 0));
  var fc = ee.Number(ee.Algorithms.If(inM, cls5(f.get('RFI'), BR_RFI), 0));
  var ph = ee.Number(ee.Algorithms.If(inM, ee.List(PHASE_M.get(nc.subtract(1).max(0))).get(fc.subtract(1).max(0)), tail));
  var code = ee.Number(ee.Algorithms.If(inM, ph, tail));
  return f.set({
    need_class: ee.Algorithms.If(inM, nc, -1), need_class_name: ee.Algorithms.If(inM, CLASS5_L.get(nc), ''),
    feasibility_class: ee.Algorithms.If(inM, fc, -1), feasibility_class_name: ee.Algorithms.If(inM, CLASS5_L.get(fc), ''),
    need_map: ee.Algorithms.If(inM, nc, tail), feas_map: ee.Algorithms.If(inM, fc, tail), phase_map: code,  // map codes 1-7
    phase_code: ee.Algorithms.If(inM, ph, 0),
    phase: ee.Algorithms.If(inM, ph.format('%d'), ''),
    priority_class: PRIORITY_L.get(code),
    priority_code_map: code, class_code: code,
    phase_note: PHASE_TEXT_L.get(code),
    RPS: ee.Algorithms.If(inM, g(f, 'RNI').multiply(0.6).add(g(f, 'RFI').multiply(0.4)), 0),   // order within a phase
    class_method: CFG.CLASS_METHOD, rni_breaks: BR_TEXT_RNI, rfi_breaks: BR_TEXT_RFI
  });
});

/* ---------- Step 22: intervention (Section 10.4), smc_required, site class, species group ---------- */
function interventionOf(f) {
  var M = g(f, 'M'), S = g(f, 'S');
  var canopy = g(f, 'canopy_pct');
  return ee.String(
    ee.Algorithms.If(g(f, 'excluded_c1').eq(1), 'PROTECT_DENSE',
    ee.Algorithms.If(g(f, 'excluded').eq(1), 'NOT_PLANTABLE',
    ee.Algorithms.If(g(f, 'F13').lt(CFG.RX.FIRE_F13), 'FIRE_PROTECTION_FIRST',
    ee.Algorithms.If(yes(f, 'waterlogging_flag'), 'HYDRO_COMPATIBLE_PLANTING',
    ee.Algorithms.If(yes(f, 'X5').and(S.lt(CFG.RX.STAB_S)), 'SOIL_STABILISATION_FIRST',
    ee.Algorithms.If(yes(f, 'X4'), 'ROCKY_MICROSITE',
    ee.Algorithms.If(g(f, 'N7').gte(CFG.RX.INVASIVE_N7), 'INVASIVE_CLEAR_THEN_PLANT',
    ee.Algorithms.If(M.lt(CFG.RX.SMC_M).or(yes(f, 'X1_driest_quartile')), 'SMC_DROUGHT_HARDY',
    ee.Algorithms.If(canopy.gte(10).and(canopy.lt(40)).or(g(f, 'need_class').eq(1)), 'ANR_GAP_PLANTING',  // rule 9: need Very Low
    ee.Algorithms.If(canopy.lt(10), 'BLANK_AREA_PLANTATION',
    'MIXED_NATIVE_PLANTATION')))))))))));
}
var RXD = ee.Dictionary.fromLists(RX_ORDER, RX_ORDER.map(function (k, i) { return i + 1; }));
// smc_required adds SMC works to any planting intervention 6-11
var LATE_RX = ee.List(['ROCKY_MICROSITE', 'INVASIVE_CLEAR_THEN_PLANT', 'SMC_DROUGHT_HARDY', 'ANR_GAP_PLANTING',
                       'BLANK_AREA_PLANTATION', 'MIXED_NATIVE_PLANTATION']);
function speciesOf(rx, M, S) {
  var worst = M.min(S);
  return ee.String(
    ee.Algorithms.If(ee.List(['ROCKY_MICROSITE', 'SMC_DROUGHT_HARDY']).contains(rx), 'Drought-hardy: khair, ber, desi babul, guggal, hingor',
    ee.Algorithms.If(ee.String(rx).equals('HYDRO_COMPATIBLE_PLANTING'), 'Riparian: arjun, jambu, karanj',
    ee.Algorithms.If(ee.String(rx).equals('SOIL_STABILISATION_FIRST'), 'Native grasses and shrubs first, then khair and ber',
    ee.Algorithms.If(ee.List(['PROTECT_DENSE', 'NOT_PLANTABLE']).contains(rx), '-',
    ee.Algorithms.If(worst.lt(CFG.SITE_SPLITS[0]), 'Drought-hardy: khair, ber, desi babul, guggal, hingor',
    ee.Algorithms.If(worst.lt(CFG.SITE_SPLITS[1]), 'Medium: teak, dhavdo, timru, khakhro, neem, sadad',
                     'Moist/deep: mahudo, bamboo, jambu, karanj, amla')))))));
}
var withRx = classed.map(function (f) {
  var rx = interventionOf(f);
  var M = g(f, 'M'), S = g(f, 'S');
  var smc = yes(f, 'X3').and(M.lt(CFG.RX.SMC_RESP_M).or(yes(f, 'X1_driest_half'))).and(b01(LATE_RX.contains(rx)));
  return f.set({intervention: rx, rx_code: RXD.get(rx), smc_required: ee.Algorithms.If(smc, 'yes', 'no'),
                site_class: ee.String('M-').cat(cls3(M)).cat('/S-').cat(cls3(S)),
                species_group: speciesOf(rx, M, S)});
});

/* ---------- Step 25 (part): v2.1 comparison join ---------- */
var HAS_V21_TABLE = (typeof HAS_V21 === 'undefined') ? true : HAS_V21;
var V21D = HAS_V21_TABLE ? (function () {
  var v = ee.FeatureCollection(CFG.V21_ASSET);
  return ee.Dictionary.fromLists(v.aggregate_array('block_id'), v.aggregate_array('category'));
})() : ee.Dictionary({});
var CHD = ee.Dictionary.fromLists(CHANGE_ORDER, CHANGE_ORDER.map(function (k, i) { return i + 1; }));
var compared = withRx.map(function (f) {
  var v21 = V21D.get(f.get('block_id'), null);
  var has = b01(ee.Algorithms.IsEqual(v21, null)).eq(0);   // Booleans have no .not(): convert to a number
  var top = g(f, 'phase_code').gte(1).and(g(f, 'phase_code').lte(3));          // Phase 1-3
  var c = ee.Number(ee.Algorithms.If(has, v21, 0));
  var ch = ee.String(ee.Algorithms.If(has.not(), 'NOT_IN_V21',
            ee.Algorithms.If(c.gte(4).and(top), 'NEWLY_PRIORITISED',
            ee.Algorithms.If(c.lte(2).and(top), 'PRIORITY_RETAINED',
            ee.Algorithms.If(c.lte(2), 'DEPRIORITISED', 'NO_MAJOR_CHANGE')))));
  return f.set({v21_category: ee.Algorithms.If(has, v21, null), change_type: ch, change_code: CHD.get(ch)});
});

/* ---------- Step 23: array engine — Monte Carlo (Section 11.2) ---------- */
var ret = compared.filter(ee.Filter.eq('excluded', 0)).sort('block_id');
function arr(p) { return ee.Array(ret.aggregate_array(p)); }
var NMAT = ee.Array(ret.reduceColumns(ee.Reducer.toList(N_KEYS.length), N_KEYS).get('list'));   // N x 8
var FMAT = ee.Array(ret.reduceColumns(ee.Reducer.toList(F_KEYS.length), F_KEYS).get('list'));   // N x 14
var F5O = arr('F5_opt'), F5P = arr('F5_pes'), F5C = arr('F5');
var F001 = full(0.01), F055 = full(0.55);
function col(a) { return ee.Array(a.map(function (v) { return [v]; })); }   // JS list -> k x 1 array
function groupsFrom(wF) {           // wF: JS map of F weights -> server arrays M, S, T, R and group totals
  var out = {}, tot = {};
  G_KEYS.forEach(function (gk) {
    tot[gk] = GROUPS[gk].reduce(function (s, k) { return s + wF[k]; }, 0);
    var v = F_KEYS.map(function (k) { return GROUP_OF[k] === gk && tot[gk] > 0 ? wF[k] / tot[gk] : 0; });
    out[gk] = FMAT.matrixMultiply(col(v)).project([0]);
  });
  out.tot = tot;
  return out;
}
function rfiArr(M, S, T, R, gtot, em, es) {
  var TR = T.multiply(full(gtot.T)).add(R.multiply(full(gtot.R))).divide(full(gtot.T + gtot.R));
  return M.max(F001).pow(full(em)).multiply(S.max(F001).pow(full(es))).multiply(F055.add(TR.multiply(full(0.45))));
}
// array forms of the class and phase rules (identical to cls5 / PHASE_M above)
function breaksArr(a) {
  var s = a.sort();
  return [s.get([I20]), s.get([I40]), s.get([I60]), s.get([I80])];
}
function cls5Arr(a, b) {
  return full(1).add(a.gte(full(b[0]))).add(a.gte(full(b[1]))).add(a.gte(full(b[2]))).add(a.gte(full(b[3])));
}
function phaseArr(nc, fc) {
  var eqF = [1, 2, 3, 4, 5].map(function (j) { return fc.eq(full(j)); });
  var out = full(0);
  CFG.PHASE.forEach(function (row, i) {
    var rv = full(0);
    row.forEach(function (p, j) { rv = rv.add(eqF[j].multiply(full(p))); });
    out = out.add(nc.eq(full(i + 1)).multiply(rv));
  });
  return out;
}
function phaseOf(rni, rfi, bN, bF) {      // bN/bF: JS arrays of 4 breaks, or null = quintiles of this run
  return phaseArr(cls5Arr(rni, bN || breaksArr(rni)), cls5Arr(rfi, bF || breaksArr(rfi)));
}
var BASE_PHASE = arr('phase_code');
var BASEG = groupsFrom(W);
var dS = W.F5 / GP.S;          // S with the F5 variants: S_v = S + w(F5)/GP.S * (F5_v - F5)
var S_OPT = BASEG.S.add(F5O.subtract(F5C).multiply(full(dS)));
var S_PES = BASEG.S.add(F5P.subtract(F5C).multiply(full(dS)));
var QUANT = CFG.CLASS_METHOD !== 'fixed';

var DRAWS = [];
var wNbase = N_KEYS.map(function (k) { return W[k]; });
var gBase = G_KEYS.map(function (gk) { return GP[gk]; });
function jitter(b) { return b.map(function (x) { return x + (RNG() * 2 - 1) * CFG.BREAK_JITTER; }); }
for (var k0 = 0; k0 < CFG.MC_K; k0++) {
  var wn = dirichlet(wNbase), gw = dirichlet(gBase);
  var gm = gw[0], gs = gw[1];
  DRAWS.push({k: k0, wN: wn, gM: gm, gS: gs, gT: gw[2], gR: gw[3],
              m: 0.65 * gm / (gm + gs), s: 0.65 * gs / (gm + gs),
              brN: jitter(CFG.FIXED_BREAKS), brF: jitter(CFG.FIXED_BREAKS),       // used by the fixed method only
              f5: RNG() < 0.5 ? 'pessimistic' : 'optimistic'});
}
var K = CFG.MC_K, KHALF = Math.floor(K / 2);
var DRAW_LIST = ee.List(DRAWS.map(function (d) {
  return [d.k, d.wN, d.m, d.s, d.gT, d.gR, d.brN, d.brF, d.f5 === 'pessimistic' ? 1 : 0];
}));
var Z0 = full(0);
var MC = ee.Dictionary(DRAW_LIST.iterate(function (d, st) {
  d = ee.List(d); st = ee.Dictionary(st);
  var kk = ee.Number(d.get(0));
  var wn = ee.Array(ee.List(d.get(1))).reshape([N_KEYS.length, 1]);
  var em = ee.Number(d.get(2)), es = ee.Number(d.get(3));
  var gT = ee.Number(d.get(4)), gR = ee.Number(d.get(5));
  var rni = NMAT.matrixMultiply(wn).project([0]);
  var TR = BASEG.T.multiply(full(gT)).add(BASEG.R.multiply(full(gR))).divide(full(gT.add(gR)));
  function rfiS(Sv) {
    return BASEG.M.max(F001).pow(full(em)).multiply(Sv.max(F001).pow(full(es))).multiply(F055.add(TR.multiply(full(0.45))));
  }
  var bN = QUANT ? null : [0, 1, 2, 3].map(function (i) { return ee.List(d.get(6)).get(i); });
  var bF = QUANT ? null : [0, 1, 2, 3].map(function (i) { return ee.List(d.get(7)).get(i); });
  var pO = phaseOf(rni, rfiS(S_OPT), bN, bF), pP = phaseOf(rni, rfiS(S_PES), bN, bF);
  var p = ee.Array(ee.Algorithms.If(ee.Number(d.get(8)).eq(1), pP, pO));
  var p12 = ee.Array(st.get('p12')).add(p.lte(full(2)));
  var out = {
    p12: p12,
    pmin: ee.Array(st.get('pmin')).min(p), pmax: ee.Array(st.get('pmax')).max(p),
    bdiff: ee.Array(st.get('bdiff')).add(pO.neq(pP)),
    half: ee.Algorithms.If(kk.eq(KHALF - 1), p12.reduce(ee.Reducer.sum(), [0]).get([0]).divide(N.multiply(KHALF)), st.get('half'))
  };
  [1, 2, 3, 4, 5].forEach(function (c) { out['n' + c] = ee.Array(st.get('n' + c)).add(p.eq(full(c))); });
  return ee.Dictionary(out);
}, ee.Dictionary({p12: Z0, pmin: full(5), pmax: full(1), bdiff: Z0, half: 0, n1: Z0, n2: Z0, n3: Z0, n4: Z0, n5: Z0})));
var P12 = ee.Array(MC.get('p12'));
var STAB = P12.divide(full(K));
var MEAN_FULL = P12.reduce(ee.Reducer.sum(), [0]).get([0]).divide(N.multiply(K));
var MEAN_HALF = ee.Number(MC.get('half'));
var best = ee.Array(MC.get('n1')), modal = full(1);
[2, 3, 4, 5].forEach(function (cc) {
  var nc = ee.Array(MC.get('n' + cc));
  modal = modal.add(nc.gt(best).multiply(full(cc).subtract(modal)));
  best = best.max(nc);
});
var BSENS = ee.Array(MC.get('bdiff')).divide(full(K));
var L = {stab: STAB.toList(), modal: modal.toList(), pmin: ee.Array(MC.get('pmin')).toList(),
         pmax: ee.Array(MC.get('pmax')).toList(), bs: BSENS.toList()};
var RET_LIST = ret.toList(N);
var retOut = ee.FeatureCollection(ee.List.sequence(0, N.subtract(1)).map(function (ii) {
  ii = ee.Number(ii).int();
  var f = ee.Feature(RET_LIST.get(ii));
  var bs = ee.Number(L.bs.get(ii));
  var lo = ee.Number(L.pmin.get(ii)).int(), hi = ee.Number(L.pmax.get(ii)).int();
  return f.set({
    stability_p12: L.stab.get(ii),
    phase_modal: ee.Number(L.modal.get(ii)).int(),
    phase_range: ee.String(ee.Algorithms.If(lo.eq(hi), lo.format('%d'), lo.format('%d').cat('-').cat(hi.format('%d')))),
    b1_disagree_share: bs,
    b1_sensitive: ee.Algorithms.If(bs.gt(0.20), 'yes', 'no')
  });
}));
var outOfMatrix = compared.filter(ee.Filter.eq('excluded', 1)).map(function (f) {
  return f.set({stability_p12: 0, phase_modal: 0, phase_range: f.get('priority_class'),
                b1_disagree_share: 0, b1_sensitive: 'no'});
});
var finalFC = retOut.merge(outOfMatrix).map(function (f) {
  var p12 = g(f, 'phase_code').gte(1).and(g(f, 'phase_code').lte(2));
  var stab = g(f, 'stability_p12');
  var c6 = ee.Number(ee.Algorithms.If(ee.Algorithms.IsEqual(f.get('C6_frac'), null), 0, f.get('C6_frac')));
  var why = ee.List([
    ee.Algorithms.If(p12.and(stab.lt(0.80)), 'Phase 1-2 with reliability < 0.80', ''),
    ee.Algorithms.If(yes(f, 'recent_plantation_flag'), 'G1 recent plantation?', ''),
    ee.Algorithms.If(yes(f, 'protected_area_flag'), 'G2 protected area', ''),
    ee.Algorithms.If(yes(f, 'b1_sensitive'), 'G3 soil pit', ''),
    ee.Algorithms.If(yes(f, 'waterlogging_flag'), 'G4 waterlogging', ''),
    ee.Algorithms.If(g(f, 'grassland_option').eq(1), 'G5 grassland option (optional note; stays under plantation)', ''),
    ee.Algorithms.If(c6.gt(0), 'C6 cultivation inside forest (rights/encroachment)', ''),
    ee.Algorithms.If(p12.and(g(f, 'degradation_evidence').eq(0)), 'Phase 1-2 without degradation evidence', '')
  ]).filter(ee.Filter.neq('item', ''));
  var stabRead = ee.Algorithms.If(stab.gt(0.80), 'Robust', ee.Algorithms.If(stab.gte(0.50), 'Moderately stable', 'Marginal'));
  return f.set({
    stability_reading: ee.Algorithms.If(p12, stabRead, ''),
    field_check: ee.Algorithms.If(why.size().gt(0), 'yes', 'no'),
    field_check_reason: why.join('; '),
    fra_rights_check_required: ee.Algorithms.If(p12, 'yes', 'no'),
    cv_reweight_log: CV_REWEIGHT_LOG,
    weights_used: JSON.stringify(W),
    model_version: 'FRPIM_v2.2'
  });
});
// light copy for the on-screen map (no Monte Carlo)
var MAPFC = compared;

/* ---------- Step 24: one-at-a-time sensitivity (44 runs, phase changes) ---------- */
var OAT = [];
PARAMS.forEach(function (k) {
  [0.8, 1.2].forEach(function (mlt) {
    if (W[k] <= 0) { return; }
    var keys = N_KEYS.indexOf(k) >= 0 ? N_KEYS : F_KEYS;
    var Wv = {};
    PARAMS.forEach(function (p) { Wv[p] = W[p]; });
    var newK = W[k] * mlt, restOld = 100 - W[k], restNew = 100 - newK;
    keys.forEach(function (p) { if (p !== k) { Wv[p] = W[p] * restNew / restOld; } });
    Wv[k] = newK;
    OAT.push({param: k, factor: mlt, W: Wv});
  });
});
var OAT_FC = ee.FeatureCollection(OAT.map(function (o) {
  var rni = NMAT.matrixMultiply(col(N_KEYS.map(function (k) { return o.W[k] / 100; }))).project([0]);
  var gg = groupsFrom(o.W);
  var em = 0.65 * gg.tot.M / (gg.tot.M + gg.tot.S), es = 0.65 * gg.tot.S / (gg.tot.M + gg.tot.S);
  var fixedB = QUANT ? null : CFG.FIXED_BREAKS;
  var ph = phaseOf(rni, rfiArr(gg.M, gg.S, gg.T, gg.R, gg.tot, em, es), fixedB, fixedB);
  var shareCh = ph.neq(BASE_PHASE).reduce(ee.Reducer.sum(), [0]).get([0]).divide(N);
  return ee.Feature(null, {parameter: o.param, name: NAMES[o.param], index: N_KEYS.indexOf(o.param) >= 0 ? 'RNI' : 'RFI',
                           factor: o.factor, share_blocks_phase_changed: shareCh,
                           over_influential: ee.Algorithms.If(shareCh.gt(CFG.OAT_MAX_SHARE), 'yes', 'no')});
})).sort('share_blocks_phase_changed', false);

/* ---------- collinearity table ---------- */
var COL_FC = ee.FeatureCollection(PAIRS_N.map(function (p) { return ['RNI', p]; }).concat(PAIRS_F.map(function (p) { return ['RFI', p]; }))
  .map(function (x) {
    var r = RHO[x[1][0] + '|' + x[1][1]];
    return ee.Feature(null, {type: 'spearman', index: x[0], a: x[1][0], b: x[1][1], value: r === null ? -999 : r,
                             flag: (r !== null && Math.abs(r) > CFG.RHO_MAX) ? 'yes' : 'no'});
  }).concat(Object.keys(VIF).map(function (k) {
    return ee.Feature(null, {type: 'VIF', index: N_KEYS.indexOf(k) >= 0 ? 'RNI' : 'RFI', a: k, b: '',
                             value: isFinite(VIF[k]) ? VIF[k] : -1, flag: VIF[k] > CFG.VIF_MAX ? 'yes' : 'no'});
  })));
var DRAW_FC = ee.FeatureCollection(DRAWS.map(function (d) {
  var o = {k: d.k, m: d.m, s: d.s, gM: d.gM, gS: d.gS, gT: d.gT, gR: d.gR, f5_variant: d.f5,
           class_method: CFG.CLASS_METHOD,
           need_breaks: QUANT ? 'quintiles of this draw' : d.brN.map(function (x) { return x.toFixed(4); }).join(', '),
           feas_breaks: QUANT ? 'quintiles of this draw' : d.brF.map(function (x) { return x.toFixed(4); }).join(', ')};
  N_KEYS.forEach(function (k, i) { o['w_' + k] = d.wN[i]; });
  return ee.Feature(null, o);
}));

/* ---------- transition table (product 9) and decision summary (product 12) ---------- */
var TRANS = ee.FeatureCollection(ee.List(compared.map(function (f) {
  return f.set('tkey', ee.String(ee.Algorithms.If(ee.Algorithms.IsEqual(f.get('v21_category'), null), 'none',
                ee.Number(f.get('v21_category')).format('%.0f'))).cat('|').cat(f.get('priority_class')));
}).reduceColumns(ee.Reducer.sum().repeat(2).group({groupField: 2, groupName: 'k'}),
                 ['block_area_ha', 'net_plantable_ha', 'tkey']).get('groups')).map(function (gq) {
  gq = ee.Dictionary(gq);
  var parts = ee.String(gq.get('k')).split('\\|');
  return ee.Feature(null, {v21_category: parts.get(0), v22_class: parts.get(1),
                           block_area_ha: ee.List(gq.get('sum')).get(0), net_plantable_ha: ee.List(gq.get('sum')).get(1)});
}));
function summaryRows(fc, beatOf) {
  return ee.List(fc.map(function (f) {
    return f.set('skey', ee.String(beatOf(f)).cat('|').cat(f.get('priority_class')).cat('|')
                   .cat(f.get('phase')).cat('|').cat(f.get('intervention')));
  }).reduceColumns(ee.Reducer.sum().combine({reducer2: ee.Reducer.count(), sharedInputs: true})
                   .group({groupField: 1, groupName: 'k'}), ['net_plantable_ha', 'skey']).get('groups'))
    .map(function (gq) {
      gq = ee.Dictionary(gq);
      var p = ee.String(gq.get('k')).split('\\|');
      return ee.Feature(null, {beat: p.get(0), priority_class: p.get(1), phase: p.get(2), intervention: p.get(3),
                               net_plantable_ha: gq.get('sum'), blocks: gq.get('count')});
    });
}
var DECISION = ee.FeatureCollection(summaryRows(withRx, function () { return 'RANGE_TOTAL'; })
  .cat(summaryRows(withRx, function (f) { return f.get('beat_id'); })));

/* ---------- qc_log (Section 12, 28 checks) ---------- */
var HAS_QC = (typeof HAS_QC01 === 'undefined') ? true : HAS_QC01;
var qc01 = HAS_QC ? ee.Feature(ee.FeatureCollection(CFG.QC01_ASSET).first()) : null;
function st(cond, ok, bad) { return ee.Algorithms.If(cond, ok || 'PASS', bad || 'FAIL'); }
function q(id, check, value, status, action) {
  return ee.Feature(null, {id: id, check: check, value: value, status: status, if_fail: action});
}
function notRecorded(id, check) {
  return q(id, check, 'not recorded: the QC01 table was not saved', 'NOT RECORDED', 'Re-run RUN 1 to regenerate QC01');
}
var maxNull = ee.List(FILL_KEYS.map(function (k) { return nullShare.get(k); })).reduce(ee.Reducer.max());
var SCORE_KEYS = PARAMS.concat(['M', 'S', 'T', 'R', 'RNI', 'RFI']);
var inM = compared.filter(ee.Filter.eq('excluded', 0));
var minScore = ee.List(SCORE_KEYS.map(function (k) { return inM.aggregate_min(k); })).reduce(ee.Reducer.min());
var maxScore = ee.List(SCORE_KEYS.map(function (k) { return inM.aggregate_max(k); })).reduce(ee.Reducer.max());
var anchorIds = raw.aggregate_array('anchor_id').distinct();
var anchor0 = ee.String(anchorIds.get(0));
var ff09 = ee.Algorithms.If(anchorIds.size().neq(1), 'FAIL (more than one anchor ID)',
           ee.Algorithms.If(anchor0.slice(0, 5).equals('LOCAL'),
             'PASS (local anchors: range + buffer; RNI/RFI comparable within this landscape only)', 'PASS'));
var ff15bad = compared.filter(ee.Filter.gte('fire_years', 5)).filter(ee.Filter.gte('F13', 0.55)).size();
var ff16bad = compared.filter(ee.Filter.eq('excluded_c1', 1)).filter(ee.Filter.neq('priority_class', 'PROTECTED')).size();
var ff17bad = compared.map(function (f) {
  return f.set('d__', g(f, 'net_plantable_ha').subtract(g(f, 'block_area_ha')));
}).filter(ee.Filter.gt('d__', 1e-9)).size();
function spread(k) {
  var pp = inM.reduceColumns(ee.Reducer.percentile([5, 95]), [k]);
  return ee.Number(pp.get('p95')).subtract(ee.Number(pp.get('p5')));
}
var spRNI = spread('RNI'), spRFI = spread('RFI');
function shares(a) {           // share of retained blocks in codes 1..5
  return ee.List([1, 2, 3, 4, 5].map(function (cc) { return a.eq(full(cc)).reduce(ee.Reducer.sum(), [0]).get([0]).divide(N); }));
}
var phShares = shares(BASE_PHASE), ncShares = shares(arr('need_class')), fcShares = shares(arr('feasibility_class'));
function inRange(l, lo, hi) { return ee.Number(l.reduce(ee.Reducer.min())).gte(lo).and(ee.Number(l.reduce(ee.Reducer.max())).lte(hi)); }
var phaseOK = inRange(phShares, 0.05, 0.40);
var shareOK = QUANT ? phaseOK.and(inRange(ncShares, 0.15, 0.25)).and(inRange(fcShares, 0.15, 0.25)) : phaseOK;
function pctList(l) { return ee.List(l).map(function (x) { return ee.Number(x).multiply(100).format('%.1f'); }).join('/'); }
var dMC = MEAN_FULL.subtract(MEAN_HALF).abs();
var nGrid = ee.Number(ee.Feature(raw.first()).get('n_blocks_grid'));
var FIRE_GAP_TEXT = ee.Feature(raw.first()).get('fire_source_gap');
var gapPresent = raw.filter(ee.Filter.notNull(['fire_source_gap'])).size().eq(N_ALL);
// FF-25: every G5 block is still in a phase (1-5) and given a planting intervention (3-11)
var c8bad = withRx.filter(ee.Filter.eq('grassland_option', 1)).filter(ee.Filter.eq('excluded', 0))
  .filter(ee.Filter.or(ee.Filter.inList('priority_class', ['PROTECTED', 'EXCLUDED']), ee.Filter.lt('rx_code', 3))).size();
var highNoDE = compared.filter(ee.Filter.inList('phase_code', [1, 2])).filter(ee.Filter.eq('degradation_evidence', 0)).size();
var rhoIdx = ee.Number(ee.Dictionary(inM.reduceColumns(ee.Reducer.spearmansCorrelation(), ['RNI', 'RFI'])).values().get(0));
var transHa = TRANS.aggregate_sum('block_area_ha'), allHa = compared.aggregate_sum('block_area_ha');
var notInV21 = compared.filter(ee.Filter.eq('change_type', 'NOT_IN_V21')).size();
var VW = (typeof VERSION_WATCH === 'undefined') ? 'version watch not run' : VERSION_WATCH;

var QC_FC = ee.FeatureCollection([
  HAS_QC ? q('FF-01', 'Asset access (24 datasets)', qc01.get('FF01_asset_log'), qc01.get('FF01_status'), 'STOP: re-check ID in Section 5') : notRecorded('FF-01', 'Asset access (24 datasets)'),
  HAS_QC ? q('FF-02', 'Working CRS', qc01.get('FF02_crs'), qc01.get('FF02_status'), 'STOP: fix UTM formula') : notRecorded('FF-02', 'Working CRS'),
  HAS_QC ? q('FF-03', 'Mosaic nominal scales', qc01.get('FF03_scales'), qc01.get('FF03_status'), 'STOP: setDefaultProjection') : notRecorded('FF-03', 'Mosaic nominal scales'),
  HAS_QC ? q('FF-04', 'Interior blocks outside 9.99-10.01 ha', qc01.get('FF04_interior_blocks_out_of_tolerance'),
    st(ee.Number(qc01.get('FF04_interior_blocks_out_of_tolerance')).eq(0)), 'Grid scale wrong') : notRecorded('FF-04', 'Block area'),
  HAS_QC ? q('FF-05', 'Null beat_id count', qc01.get('FF05_null_beat'), st(ee.Number(qc01.get('FF05_null_beat')).eq(0)),
    "Re-inspect asset; fall back to 'RANGE'") : notRecorded('FF-05', 'Beat field'),
  q('FF-06', 'Max parameter null share (before beat-mean fill)', maxNull, st(ee.Number(maxNull).lt(0.02)), 'Check masks; gaps filled with beat mean'),
  q('FF-07', 'RNI = 100; RFI groups 35/35/18/12', JSON.stringify(W), FF07, 'Arithmetic error'),
  q('FF-08', 'All parameter, group and index scores in [0,1]',
    ee.String(ee.Number(minScore).format('%.4f')).cat(', ').cat(ee.Number(maxScore).format('%.4f')),
    st(ee.Number(minScore).gte(-1e-9).and(ee.Number(maxScore).lte(1 + 1e-9))), 'Anchor or curve error'),
  q('FF-09', 'Single anchor ID', anchorIds.join(','), ff09, 'Re-run anchors'),
  q('FF-10', 'CV guard (CV < 0.05 reweighted)', CV_REWEIGHT_LOG, CV_LOG.length ? 'APPLIED' : 'PASS', 'Section 8.3'),
  q('FF-11', 'rho(X1, canopy) < 0.60', String(rX1), FF11, 'Set A3_MASK_TREES = true and re-run RUN 1'),
  q('FF-12', 'rho(F5, F10) < 0.75', String(r12), FF12, 'F10 cut to 6 pts, +2 to F11 (auto)'),
  q('FF-13', 'rho(N1, N5) < 0.75', String(r13), FF13, 'Merged to 30 pts, +5 to N3 (auto)'),
  q('FF-14', 'Other pairs in an index |rho| <= 0.75, VIF <= 5', COL_LOG.length ? COL_LOG.join(' | ') : 'none', FF14, 'Merge at higher weight / review'),
  q('FF-15', 'Blocks with >= 5 fire years and F13 >= 0.55', ff15bad, st(ff15bad.eq(0), 'PASS', 'STOP'), 'Inversion missing'),
  q('FF-16', 'C1 blocks not PROTECTED', ff16bad, st(ff16bad.eq(0), 'PASS', 'STOP'), 'Threshold coordination'),
  q('FF-17', 'Blocks with net_plantable_ha > block_area_ha', ff17bad, st(ff17bad.eq(0)), 'Fraction error'),
  HAS_QC ? q('FF-18', 'Min clear S2 obs per window-year (5th pct: X1, N7, N2)',
    ee.String(ee.Number(qc01.get('FF18_A3_p5_min_clear_obs')).format('%.0f')).cat(', ')
      .cat(ee.Number(qc01.get('FF18_D5_p5_min_clear_obs')).format('%.0f')).cat(', ')
      .cat(ee.Number(qc01.get('FF18_N2_p5_min_clear_obs')).format('%.0f')),
    st(ee.Number(qc01.get('FF18_A3_p5_min_clear_obs')).gte(3).and(ee.Number(qc01.get('FF18_D5_p5_min_clear_obs')).gte(3))
         .and(ee.Number(qc01.get('FF18_N2_p5_min_clear_obs')).gte(3))), 'Set CS_THRESHOLD = 0.50 and log it') : notRecorded('FF-18', 'S2 scenes'),
  HAS_QC ? q('FF-19', 'Landsat: share of pixels with >= 8 years; 2000-05 clear obs (5th pct)',
    ee.String(ee.Number(qc01.get('FF19_share_pixels_8yrs')).format('%.3f')).cat(', ')
      .cat(ee.Number(qc01.get('FF19_DE4_p5_clear_obs_2000_05')).format('%.0f')),
    st(ee.Number(qc01.get('FF19_share_pixels_8yrs')).gte(0.95).and(ee.Number(qc01.get('FF19_DE4_p5_clear_obs_2000_05')).gte(3))),
    'Widen windows to Sep-Dec and log it') : notRecorded('FF-19', 'Landsat depth'),
  q('FF-20', 'RNI and RFI spread p95 - p5 (>= 0.30 each)', ee.String(spRNI.format('%.3f')).cat(', ').cat(spRFI.format('%.3f')),
    st(spRNI.gte(0.30).and(spRFI.gte(0.30))), 'Review CV guard and anchors'),
  q('FF-21', (QUANT ? 'Each RNI and RFI class 15-25 %; ' : '') + 'no phase > 40 % or < 5 % (% of retained, classes 1..5)',
    ee.String('phases ').cat(pctList(phShares)).cat(' | RNI ').cat(pctList(ncShares)).cat(' | RFI ').cat(pctList(fcShares)),
    st(shareOK), 'Review thresholds / matrix with the DFO; log any change'),
  q('FF-22', '|mean stability_p12 K=' + K + ' - K=' + KHALF + '|', dMC, st(dMC.lt(0.01)), 'Raise MC_K to 1000'),
  q('FF-23', 'Rows in raw table = grid blocks', ee.String(N_ALL.format('%d')).cat(' / ').cat(nGrid.format('%.0f')),
    st(N_ALL.eq(nGrid)), 'Raise TILE_SCALE and re-export'),
  q('FF-24', 'fire_source_gap present', FIRE_GAP_TEXT, st(gapPresent), 'Add metadata field'),
  q('FF-25', 'G5 blocks wrongly excluded or without planting; Phase 1-2 blocks without degradation evidence (listed)',
    ee.String(c8bad.format('%d')).cat('; ').cat(highNoDE.format('%d')), st(c8bad.eq(0), 'PASS', 'STOP'),
    'G5 is wrongly acting as a constraint'),
  q('FF-26', 'Spearman rho(RNI, RFI) within +/- 0.60', rhoIdx, st(rhoIdx.abs().lte(CFG.INDEP_MAX)), 'A parameter leaks between indices; review'),
  q('FF-27', 'v2.1 comparison: hectares match; blocks not in v2.1',
    ee.String(ee.Number(transHa).format('%.1f')).cat(' / ').cat(ee.Number(allHa).format('%.1f')).cat('; ').cat(notInV21.format('%d')),
    HAS_V21_TABLE ? st(ee.Number(transHa).subtract(allHa).abs().lt(0.01).and(notInV21.eq(0)), 'PASS', 'CHECK')
                  : 'NOT AVAILABLE (v2.1 final table not found)', 'Re-join on block_id'),
  q('FF-28', 'Version watch (ESA CCI biomass v7.0, Meta CHMv2)', VW, 'INFO', 'Apply Section 5.3 when they reach GEE'),
  q('INFO', 'OAT parameters changing > 15% of classes',
    OAT_FC.filter(ee.Filter.eq('over_influential', 'yes')).aggregate_array('parameter').distinct().join(','), 'INFO', 'Review those weights')
]);

/* ---------- Step 26: exports ---------- */
var tag = CFG.RANGE_NAME;
Export.table.toAsset({collection: finalFC, description: 'FRPIM02_final_to_asset', assetId: CFG.FINAL_ASSET});
function csv(fc, name) {
  Export.table.toDrive({collection: fc, description: 'FRPIM02_' + name, folder: CFG.DRIVE_FOLDER,
                        fileNamePrefix: 'FRPIM02_' + name + '_' + tag, fileFormat: 'CSV'});
}
csv(finalFC, 'final_block_table');
csv(raw, 'raw_block_table');
csv(OAT_FC, 'sensitivity_OAT');
csv(COL_FC, 'collinearity');
csv(DRAW_FC, 'montecarlo_draws');
csv(QC_FC, 'qc_log');
csv(TRANS, 'v21_v22_transition_table');
csv(DECISION, 'decision_summary');

print('Indices, weights and checks are above. The Monte Carlo runs inside the export tasks.');
if (CFG.PUBLISH_NOW) {
  publishAll(finalFC, MAPFC);
  print('====================================================================');
  print('FINAL MAP is on screen. To save every result to Google Drive:');
  print('Tasks tab -> RUN ALL (tables, decision summary, Monte Carlo, QC log, maps, SHP, field list).');
  print('====================================================================');
  return;
}
print("NEXT: Tasks tab -> RUN ALL. Then set STAGE = 'PUBLISH' for maps and files.");

});   // end collinearity callback
});   // end statistics callback

/* ====================================================================== */
} else if (CFG.STAGE === 'PUBLISH') {
/* ====================================================================== */
publishAll(ee.FeatureCollection(CFG.FINAL_ASSET));
} else {
  print("STOP: CFG.STAGE must be 'SCORE' or 'PUBLISH'");
}
