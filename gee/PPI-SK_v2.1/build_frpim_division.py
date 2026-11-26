"""Builds scripts/FRPIM_v22_SABARKANTHA_DIVISION.js — FRPIM v2.2 for a whole forest division.

Same model, indicators, weights, matrix and QC as the range script (src/01_frpim.js, src/02_frpim.js);
this builder applies the division changes as checked text edits, so the range script stays untouched:
  * every 10 ha block gets its RANGE and BEAT from the division asset (majority overlap; a border
    block belongs to one range only), and beat_id = "<range> / <beat>" so equal beat names never mix;
  * RUN 1 exports one raw block table per range (smaller tasks, no memory limits);
  * the scoring scale (anchors) is the division + 20 km landscape, so all ranges share one scale;
  * RUN 2 merges the range tables, scores and classes all blocks together, and adds a
    range x phase area table and range rows in the decision summary.
"""
import pathlib
from build_all_in_one import body_after_cfg, fn

src = pathlib.Path('src')


def edit(text, pairs, label):
    for a, b in pairs:
        n = text.count(a)
        assert n == 1, f'{label}: expected 1 match, found {n}: {a[:80]!r}'
        text = text.replace(a, b)
    return text


HEADER = r'''/* ######################################################################
 *  FRPIM v2.2 — Forest Restoration Priority and Intervention Model
 *  SABARKANTHA FOREST DIVISION — single-file Google Earth Engine script
 *  7 ranges, ~81,000 ha of forest, ~8,000 blocks of 10 ha
 *  ----------------------------------------------------------------------
 *  HOW TO USE
 *   RUN 1  Press Run. Checks all 24 datasets, computes ONE scoring scale
 *          for the whole division + 20 km landscape (3-8 min, background),
 *          then creates ONE export task per range (7 tasks) plus the QC
 *          table and constraint map. Tasks tab -> RUN ALL. The range
 *          tasks run in parallel; allow several hours in total.
 *   RUN 2  When ALL range tasks show a tick, press Run again. All blocks
 *          of the division are scored and classed together. Three maps
 *          appear (Need, Feasibility, Priority Phase) with the area
 *          statement; Tasks -> RUN ALL saves the tables, the range x phase
 *          table, maps, shapefile and field-check list to Google Drive.
 *   If one range task fails ("memory" or "timed out"), set TILE_SCALE
 *   to 16 and re-run only that task (or press Run and start it again).
 *
 *  Scoring scale: anchors are the percentiles of each parameter over
 *  natural vegetation of the division + 20 km landscape, so blocks in
 *  different ranges are directly comparable.
 * ###################################################################### */

var STEP = 'AUTO';                 // 'AUTO', 'LAYERS', 'MAP' or 'VALIDATE'

var SETTINGS = {
  AOI_ASSET: 'projects/khedbrahma-range/assets/Sbk_division',
  RANGE_NAME: 'Sabarkantha',         // used in file and asset names
  DIVISION_NAME: 'Sabarkantha Forest Division',
  RANGE_FIELD: 'RANGE',              // field of the division asset holding the range name
  BEAT_FIELD: 'BEAT',                // field holding the beat name
  // the ranges of the division, exactly as written in RANGE_FIELD, with a short code for asset names
  RANGES: [
    {name: 'Dholwani', code: 'DHO'}, {name: 'Poshina', code: 'POS'}, {name: 'Raigadh', code: 'RAI'},
    {name: 'Rdf Khedbrahma', code: 'KHE'}, {name: 'Rdf Poshina', code: 'RPO'}, {name: 'Vadali', code: 'VAD'},
    {name: 'Vijaynagar', code: 'VIJ'}
  ],
  // re-run only some ranges: their short codes, e.g. ['RPO', 'POS']. Empty [] = all ranges (normal RUN 1).
  // With codes here, RUN 1 creates only those range tasks (no QC, anchor or constraint-map tasks again).
  ONLY_RANGES: [],
  // true = run RUN 2 now with the ranges whose tables are ready (outputs are tagged '_partial'; classes and
  // phases are then relative to those ranges only). Set back to false for the final all-range RUN 2.
  RUN2_WITH_AVAILABLE: false,
  ID_PREFIX: 'SBK_',
  CRS: 'EPSG:32643',               // UTM 43N (checked automatically against the division)
  ASSET_ROOT: 'projects/khedbrahma-range/assets/',
  DRIVE_FOLDER: 'FRPIM_v22_Sabarkantha',

  LOCAL_BUFFER_KM: 20,             // anchor landscape = division + this buffer
  LOCAL_ANCHOR_SCALE: 250,         // m; division-size landscape: 250 m keeps the anchors fast

  CS_THRESHOLD: 0.60,              // FF-18 remedy: 0.50
  D2_MONTHS: [9, 11],              // FF-19 remedy: [9, 12]
  A3_MASK_TREES: false,            // FF-11 remedy: true
  TILE_SCALE: 8,                   // a task fails with "memory" -> 16

  // Section 7 weights (points)
  W_N: {N1: 25, N2: 15, N3: 15, N4: 15, N5: 10, N6: 10, N7: 5, N8: 5},
  W_F: {F1: 15, F2: 10, F3: 5, F4: 5, F5: 12, F6: 7, F7: 6, F8: 6, F9: 4,
        F10: 8, F11: 7, F12: 3, F13: 7, F14: 5},
  CLASS_METHOD: 'quantile',        // 'quantile' (20/40/60/80th percentiles of the division, default) or 'fixed'
  // PHASE[need class - 1][feasibility class - 1]; class 1 = Very Low ... 5 = Very High (DFO may edit; logged)
  PHASE: [[5, 5, 5, 5, 4],
          [5, 4, 4, 4, 3],
          [4, 3, 3, 3, 2],
          [3, 2, 2, 2, 1],
          [2, 2, 1, 1, 1]],
  RX: {FIRE_F13: 0.55, STAB_S: 0.45, INVASIVE_N7: 0.30, SMC_M: 0.35, SMC_RESP_M: 0.50}
};

var ASSETS = {
  RAW_PREFIX: SETTINGS.ASSET_ROOT + 'FRPIM_v22_raw_blocks_' + SETTINGS.RANGE_NAME + '_',
  QC01: SETTINGS.ASSET_ROOT + 'FRPIM_v22_qc01_' + SETTINGS.RANGE_NAME,
  FINAL: SETTINGS.ASSET_ROOT + 'FRPIM_v22_final_blocks_' + SETTINGS.RANGE_NAME,
  V21: SETTINGS.ASSET_ROOT + 'PPI_SK_v21_RANGE_final_blocks_' + SETTINGS.RANGE_NAME   // none for the division
};
ASSETS.RAW_PARTS = SETTINGS.RANGES.map(function (r) { return ASSETS.RAW_PREFIX + r.code; });
ASSETS.RAW = ASSETS.RAW_PARTS[0];
var ANCHORS = {id: 'NOT_SET'};

'''

DISPATCH = r'''/* ======================================================================
 *  DISPATCH — RUN 1 (layers + one block table per range) or RUN 2 (division map)
 * ====================================================================== */
var HAS_QC01 = true, HAS_V21 = false, VERSION_WATCH = 'not checked';
function runFrpimStep(n) {
  var names = {
    LAYERS: 'RUN 1 — datasets, division scoring scale, 10 ha blocks per range. Then Tasks -> RUN ALL.',
    MAP: 'RUN 2 — FINAL RESTORATION MAP for ' + SETTINGS.DIVISION_NAME + '. Tasks -> RUN ALL saves all outputs.',
    VALIDATE: 'Validation report (V1, V2). Tasks -> RUN.'
  };
  print('==================================================================');
  print('FRPIM v2.2 | ' + SETTINGS.DIVISION_NAME + ' (' + SETTINGS.RANGES.length + ' ranges) | ' + names[n]);
  print('==================================================================');
  if (n === 'LAYERS') { stepLayers(); }
  else if (n === 'MAP') { stepMap(); }
  else if (n === 'VALIDATE') { stepValidate(); }
  else { print("STOP: STEP must be 'AUTO', 'LAYERS', 'MAP' or 'VALIDATE'"); }
}
var WATCH = [['ESA CCI biomass v7.0', 'ESA/CCI/Above_Ground_Biomass/V7_0']];
var ids = ASSETS.RAW_PARTS.concat([ASSETS.QC01]).concat(WATCH.map(function (w) { return w[1]; }));
var found = {}, waiting = ids.length;
print('Script: FRPIM v2.2 division, build 6 (partial RUN 2 option)');
print('Looking for saved range tables and checking the dataset version watch ...');
ids.forEach(function (id) {
  var done = function (ok) {
    found[id] = ok;
    waiting -= 1;
    if (waiting > 0) { return; }
    HAS_QC01 = found[ASSETS.QC01];
    HAS_V21 = false;
    VERSION_WATCH = WATCH.map(function (w) { return w[0] + ': ' + (found[w[1]] ? 'NOW IN GEE - switch (Section 5.3)' : 'not yet in GEE'); })
      .concat(['Meta CHMv2: no public GEE asset path published; check the catalog']).join('; ');
    print('FF-28 version watch: ' + VERSION_WATCH);
    var have = SETTINGS.RANGES.filter(function (r, i) { return found[ASSETS.RAW_PARTS[i]]; });
    var missing = SETTINGS.RANGES.filter(function (r, i) { return !found[ASSETS.RAW_PARTS[i]]; });
    if (STEP !== 'AUTO') { runFrpimStep(STEP); return; }
    if (have.length === 0) { runFrpimStep('LAYERS'); return; }
    if ((SETTINGS.ONLY_RANGES || []).length) { runFrpimStep('LAYERS'); return; }
    if (missing.length > 0 && SETTINGS.RUN2_WITH_AVAILABLE) {
      // partial RUN 2: score only the ranges whose tables exist; separate names so the final run is not blocked
      ASSETS.RAW_PARTS = SETTINGS.RANGES.map(function (r, i) { return ASSETS.RAW_PARTS[i]; })
        .filter(function (id) { return found[id]; });
      ASSETS.FINAL = ASSETS.FINAL + '_partial_' + have.map(function (r) { return r.code; }).join('');
      SETTINGS.RANGE_NAME = SETTINGS.RANGE_NAME + '_partial_' + have.length + 'ranges';
      SETTINGS.DIVISION_NAME = SETTINGS.DIVISION_NAME + ' (' + have.length + ' of ' + SETTINGS.RANGES.length + ' ranges: ' +
                               have.map(function (r) { return r.name; }).join(', ') + ')';
      print('PARTIAL RUN 2 with ' + have.length + ' ranges: ' + have.map(function (r) { return r.name; }).join(', ') +
            '. Not included: ' + missing.map(function (r) { return r.name; }).join(', ') + '.');
      print('Classes and phases are relative to these ranges only. Repeat RUN 2 with all ranges when the rest are ready.');
      runFrpimStep('MAP');
      return;
    }
    if (missing.length > 0) {
      print('WAIT: range tables saved for ' + have.map(function (r) { return r.name; }).join(', ') +
            '; still missing: ' + missing.map(function (r) { return r.name; }).join(', ') + '.');
      print('If those tasks are still running, wait and press Run again. If they FAILED, set ONLY_RANGES: ' +
            JSON.stringify(missing.map(function (r) { return r.code; })) + ' (and TILE_SCALE: 16 for a memory error), ' +
            'press Run, and run just those tasks. Then set ONLY_RANGES back to [] and press Run.');
      return;
    }
    if (!HAS_QC01) { print('Note: the QC01 table is missing; the map is not affected, the QC log marks those checks NOT RECORDED.'); }
    print('All ' + have.length + ' range tables found: scoring the whole division together.');
    runFrpimStep('MAP');
  };
  try { ee.data.getAsset(id, function (a, err) { done(!!a && !err); }); } catch (e) { done(false); }
});
'''

# ------------------------------------------------------------------ RUN 1
r1 = (src / '01_frpim.js').read_text()
i = r1.index('var proj = ee.Projection(CRS).atScale(CFG.BLOCK_SIDE);')
j = r1.index("  grid = grid.map(function (f) { return f.set('beat_id', 'RANGE'); });\n}\n") + len("  grid = grid.map(function (f) { return f.set('beat_id', 'RANGE'); });\n}\n")
GRID = r'''var proj = ee.Projection(CRS).atScale(CFG.BLOCK_SIDE);
function toStr(v, d) {
  return ee.String(ee.Algorithms.If(ee.Algorithms.IsEqual(v, null), d,
         ee.Algorithms.If(ee.Algorithms.IsEqual(ee.Algorithms.ObjectType(v), 'String'), v, ee.Number(v).format('%.0f'))));
}
// Division grid: built range by range. A cell is cut to the whole forest boundary and belongs to the
// range (and beat) covering most of it, so a block on a range border is counted once, in one range.
function gridFor(rangeName) {
  var rFC = AOI_FC.filter(ee.Filter.eq(CFG.RANGE_FIELD, rangeName));
  return rFC.geometry().coveringGrid(proj).map(function (f) {
    var cell = f.geometry();
    var local = AOI_FC.filterBounds(cell).map(function (b) {
      return b.set('ov__', b.geometry().intersection(cell, 1).area(1));
    });
    var inter = local.geometry().intersection(cell, 1);
    // the forest polygon covering most of the cell gives the block its range and beat. A placeholder
    // (overlap -1, range NONE) answers for edge cells that touch no polygon; they have zero area and
    // are dropped by the minimum-area filter below.
    var none = ee.Feature(null, {ov__: -1}).set(CFG.RANGE_FIELD, 'NONE').set(CFG.BEAT_FIELD, '');
    var top = ee.Feature(local.merge(ee.FeatureCollection([none])).sort('ov__', false).first());
    var rng = toStr(top.get(CFG.RANGE_FIELD), 'NONE');
    var beat = toStr(top.get(CFG.BEAT_FIELD), 'Unassigned');
    beat = ee.String(ee.Algorithms.If(beat.length().eq(0), 'Unassigned', beat));
    var a = inter.area(1).divide(1e4), full = cell.area(1).divide(1e4);
    return ee.Feature(inter, {block_area_ha: a, geom_full_ha: full, is_interior: a.gte(full.multiply(0.9999)),
                              range: rng, beat: beat, beat_id: rng.cat(' / ').cat(beat)});
  }).filter(ee.Filter.gte('block_area_ha', CFG.MIN_BLOCK_HA)).filter(ee.Filter.eq('range', rangeName))
    .map(function (f) {
      var c = f.geometry().centroid(1).transform(CRS, 1).coordinates();
      var e = ee.Number(c.get(0)).round().format('%.0f');
      var n = ee.Number(c.get(1)).round().format('%.0f');
      return f.set('block_id', ee.String(CFG.ID_PREFIX).cat(e).cat('_').cat(n));
    });
}
var grid = ee.FeatureCollection(CFG.RANGES.map(function (r) { return gridFor(r.name); })).flatten();
'''
r1 = r1[:i] + GRID + r1[j:]
r1 = edit(r1, [
    ("print('Blocks in grid (>= ' + CFG.MIN_BLOCK_HA + ' ha):', N_GRID);",
     "print('Blocks per range are counted inside the export tasks (a division-size grid is too large for the Console).');"),
    ("    n_blocks_grid: N_GRID,", "    n_blocks_grid: blocksIn.size(),        // blocks in this range's grid; RUN 2 adds the ranges"),
    ("if (CFG.SHOW_MAP) {",
     "Map.centerObject(AOI, 9);\nMap.addLayer(ee.Image().byte().paint(AOI_FC, 1, 2), {palette: ['black']}, 'Division forest boundary');\n"
     "print('Map: the division forest boundary is shown. Parameter previews are off for a division-size run (they exceed the Console memory); the export tasks are not affected.');\n"
     "if (CFG.SHOW_MAP) {"),
    ("  Export.table.toDrive({collection: anchFC, description: 'FRPIM01_local_anchor_table',",
     "  if (!CFG.ONLY.length) Export.table.toDrive({collection: anchFC, description: 'FRPIM01_local_anchor_table',"),
    ("Export.table.toAsset({\n  collection: QC01,", "if (!CFG.ONLY.length) {\nExport.table.toAsset({\n  collection: QC01,"),
    ("  maxPixels: 1e11\n});\n", "  maxPixels: 1e11\n});\n}   // end of the shared tasks (skipped when ONLY_RANGES is set)\n"),
    ("print('NEXT: Tasks tab -> RUN ALL. When FRPIM01_raw_blocks_to_asset');\nprint('and FRPIM01_qc01_to_asset",
     "if (CFG.ONLY.length) { print('RE-RUN of ranges ' + CFG.ONLY.join(', ') + ' only: Tasks tab -> RUN those tasks. Then set ONLY_RANGES back to [] and press Run for RUN 2.'); }\nprint('NEXT: Tasks tab -> RUN ALL. When FRPIM01_raw_blocks_to_asset');\nprint('and FRPIM01_qc01_to_asset"),
    ("  utm: LIB.utmCrs(AOI)\n};", "  utm: LIB.utmCrs(AOI),\n  ranges: AOI_FC.aggregate_array(CFG.RANGE_FIELD).distinct().sort(),\n  n_range_field: AOI_FC.filter(ee.Filter.notNull([CFG.RANGE_FIELD])).size()\n};"),
    ("  print('UTM zone of AOI centroid:', info.utm, '| working CRS:', CRS);",
     "  print('UTM zone of AOI centroid:', info.utm, '| working CRS:', CRS);\n"
     "  var expected = CFG.RANGES.map(function (r) { return r.name; });\n"
     "  var unknown = (info.ranges || []).filter(function (x) { return expected.indexOf(x) < 0; });\n"
     "  var absent = expected.filter(function (x) { return (info.ranges || []).indexOf(x) < 0; });\n"
     "  print('Ranges in the division asset (' + CFG.RANGE_FIELD + '):', info.ranges);\n"
     "  if (unknown.length || absent.length || info.n_range_field !== info.n) {\n"
     "    print('STOP: the range names in the asset do not match SETTINGS.RANGES. In the asset but not in SETTINGS: ' +\n"
     "          JSON.stringify(unknown) + '; in SETTINGS but not in the asset: ' + JSON.stringify(absent) +\n"
     "          '; polygons without a range: ' + (info.n - info.n_range_field) + '. Correct SETTINGS.RANGES (names must match exactly) and press Run again.');\n"
     "    return;\n"
     "  }"),
    ("var refGeom = AOI.buffer(CFG.LOCAL_BUFFER_KM * 1000, 200);",
     "var refGeom = AOI.simplify(250).buffer(CFG.LOCAL_BUFFER_KM * 1000, 500);"),
    ("'Anchor landscape (range + ' + CFG.LOCAL_BUFFER_KM + ' km)'", "'Anchor landscape (division + ' + CFG.LOCAL_BUFFER_KM + ' km)'"),
    ("""var blocks = reduceGroup(MED30, grid, ee.Reducer.median(), 30);
blocks = reduceGroup(MEAN30, blocks, ee.Reducer.mean(), 30);
blocks = reduceGroup(MEAN10, blocks, ee.Reducer.mean(), 10);
blocks = reduceGroup(MAX30, blocks, ee.Reducer.max(), 30);
blocks = reduceGroup(MIN30, blocks, ee.Reducer.min(), 30);""",
     """function reduceAll(g) {
  var b = reduceGroup(MED30, g, ee.Reducer.median(), 30);
  b = reduceGroup(MEAN30, b, ee.Reducer.mean(), 30);
  b = reduceGroup(MEAN10, b, ee.Reducer.mean(), 10);
  b = reduceGroup(MAX30, b, ee.Reducer.max(), 30);
  return reduceGroup(MIN30, b, ee.Reducer.min(), 30);
}"""),
    ("blocks = blocks.map(function (f) {\n  var area = ee.Number(f.get('block_area_ha'));",
     "function finishBlocks(blocksIn) { return blocksIn.map(function (f) {\n  var area = ee.Number(f.get('block_area_ha'));"),
    ("    beat_field: BEAT_FIELD === null ? 'none' : BEAT_FIELD\n  });\n});\n",
     "    beat_field: BEAT_FIELD === null ? 'none' : BEAT_FIELD\n  });\n}); }\n"),
    ("    range_name: CFG.RANGE_NAME,", "    range_name: f.get('range'),\n    division_name: CFG.DIVISION_NAME,"),
    ("""Export.table.toAsset({
  collection: blocks,
  description: 'FRPIM01_raw_blocks_to_asset',
  assetId: CFG.RAW_ASSET
});""",
     """// one raw block table per range: smaller, independent tasks for a division-size run
CFG.RANGES.filter(function (r) { return !CFG.ONLY.length || CFG.ONLY.indexOf(r.code) >= 0; }).forEach(function (r) {
  Export.table.toAsset({
    collection: finishBlocks(reduceAll(gridFor(r.name))),
    description: 'FRPIM01_raw_blocks_' + r.code,
    assetId: CFG.RAW_PREFIX + r.code
  });
});"""),
    ("print('NEXT: Tasks tab -> RUN ALL. When FRPIM01_raw_blocks_to_asset');\nprint('and FRPIM01_qc01_to_asset have completed, press Run again (RUN 2: final map).');\nprint('Raw block asset:', CFG.RAW_ASSET);",
     "print('NEXT: Tasks tab -> RUN ALL. When all ' + CFG.RANGES.length + ' FRPIM01_raw_blocks_<range> tasks');\nprint('and FRPIM01_qc01_to_asset have completed, press Run again (RUN 2: division map).');\nprint('Range tables:', CFG.RAW_PREFIX + '<DHO, POS, RAI, KHE, RPO, VAD, VIJ>');"),
    ("  Map.centerObject(AOI, 11);", "  Map.centerObject(AOI, 10);"),
    ("{palette: ['black']}, 'Range boundary');", "{palette: ['black']}, 'Division forest boundary');"),
    ("Map.addLayer(ee.Image().byte().paint(grid, 1, 1), {palette: ['#555555']}, '10 ha blocks', true);",
     "Map.addLayer(ee.Image().byte().paint(grid, 1, 1), {palette: ['#555555']}, '10 ha blocks (slow at division size)', false);"),
], 'RUN 1')
assert 'collection: blocks,' not in r1

cfg01 = """  var CFG = {
    AOI_ASSET: SETTINGS.AOI_ASSET, RANGE_NAME: SETTINGS.RANGE_NAME, ID_PREFIX: SETTINGS.ID_PREFIX,
    DIVISION_NAME: SETTINGS.DIVISION_NAME, RANGE_FIELD: SETTINGS.RANGE_FIELD, RANGES: SETTINGS.RANGES, ONLY: SETTINGS.ONLY_RANGES || [],
    MODEL_VERSION: 'FRPIM_v2.2', BLOCK_SIDE: 316.2278, MIN_BLOCK_HA: 2.0,
    BEAT_FIELD: SETTINGS.BEAT_FIELD, CRS: SETTINGS.CRS, STATE_CRS: SETTINGS.CRS,
    ANCHOR_MODE: 'LOCAL', ANCHOR_ASSET: null, STATE_NAME: 'Gujarat', LIVE_ANCHOR_SCALE: 500,
    LOCAL_BUFFER_KM: SETTINGS.LOCAL_BUFFER_KM, LOCAL_ANCHOR_SCALE: SETTINGS.LOCAL_ANCHOR_SCALE,
    CS_THRESHOLD: SETTINGS.CS_THRESHOLD, D2_MONTHS: SETTINGS.D2_MONTHS,
    A3_MASK_TREES: SETTINGS.A3_MASK_TREES, REASON_MIN_FRAC: 0.01, TILE_SCALE: SETTINGS.TILE_SCALE,
    RAW_PREFIX: ASSETS.RAW_PREFIX, QC01_ASSET: ASSETS.QC01, DRIVE_FOLDER: SETTINGS.DRIVE_FOLDER, SHOW_MAP: false
  };
"""

# ------------------------------------------------------------------ RUN 2
r2 = body_after_cfg((src / '02_frpim.js').read_text())
r2 = edit(r2, [
    ("var raw = ee.FeatureCollection(CFG.RAW_ASSET).map(function (f) {",
     "var raw = ee.FeatureCollection(CFG.RAW_PARTS.map(function (id) { return ee.FeatureCollection(id); })).flatten().map(function (f) {"),
    ("var DECISION = ee.FeatureCollection(summaryRows(withRx, function () { return 'RANGE_TOTAL'; })\n  .cat(summaryRows(withRx, function (f) { return f.get('beat_id'); })));",
     "var DECISION = ee.FeatureCollection(summaryRows(withRx, function () { return 'DIVISION_TOTAL'; })\n"
     "  .cat(summaryRows(withRx, function (f) { return ee.String('RANGE: ').cat(f.get('range')); }))\n"
     "  .cat(summaryRows(withRx, function (f) { return f.get('beat_id'); })));"),
    ("  var SHP_FROM = ['block_id', 'beat_id',", "  var SHP_FROM = ['block_id', 'range', 'beat_id',"),
    ("  var SHP_TO = ['block_id', 'beat_id',", "  var SHP_TO = ['block_id', 'range', 'beat_id',"),
    ("  var FIELD_COLS = ['beat_id', 'block_id',", "  var FIELD_COLS = ['range', 'beat_id', 'block_id',"),
    ("}).sort('RPS', false).sort('phase_map').sort('beat_id');", "}).sort('RPS', false).sort('phase_map').sort('beat_id').sort('range');"),
    ("  /* ---- Section 13.4: area statement in hectares (every class on every map) ---- */",
     """  /* ---- Division: hectares by range x priority phase (range comparison) ---- */
  var PH_NAMES = ee.List(['Phase 1', 'Phase 2', 'Phase 3', 'Phase 4', 'Phase 5', 'Protected (C1)', 'Excluded (C2-C7)']);
  var RANGE_PHASE = ee.FeatureCollection(ee.List(mapFC.map(function (f) {
    return f.set({rkey: ee.String(f.get('range')).cat('|').cat(ee.Number(f.get('phase_map')).format('%d')), one__: 1});
  }).reduceColumns(ee.Reducer.sum().repeat(3).group({groupField: 3, groupName: 'k'}),
                   ['block_area_ha', 'net_plantable_ha', 'one__', 'rkey']).get('groups')).map(function (g) {
    g = ee.Dictionary(g);
    var p = ee.String(g.get('k')).split('\\\\|'), s = ee.List(g.get('sum')), code = ee.Number.parse(p.get(1));
    return ee.Feature(null, {range: p.get(0), phase_code: code, phase: PH_NAMES.get(code.subtract(1)),
                             blocks: s.get(2), gross_ha: s.get(0), net_plantable_ha: s.get(1)});
  })).sort('phase_code').sort('range');
  Export.table.toDrive({collection: RANGE_PHASE, description: 'FRPIM_v2_2_' + tag + '_Range_x_Phase', folder: CFG.DRIVE_FOLDER,
    fileNamePrefix: 'FRPIM_v2_2_' + tag + '_Range_x_Phase', fileFormat: 'CSV',
    selectors: ['range', 'phase_code', 'phase', 'blocks', 'gross_ha', 'net_plantable_ha']});

  /* ---- Section 13.4: area statement in hectares (every class on every map) ---- */"""),
    ("  Map.centerObject(AOI, 12);", "  Map.centerObject(AOI, 9);"),
    ("var nGrid = ee.Number(ee.Feature(raw.first()).get('n_blocks_grid'));",
     "var nGrid = ee.Number(raw.distinct('range').aggregate_sum('n_blocks_grid'));   // division = sum of the range grids"),
    ("ui.Label('Forest Restoration Priority — ' + CFG.RANGE_NAME + ' Range',", "ui.Label('Forest Restoration Priority — ' + CFG.DIVISION_NAME,"),
], 'RUN 2')

cfg02 = """  var CFG = {
    STAGE: 'SCORE', PUBLISH_NOW: true, CRS: SETTINGS.CRS, RANGE_NAME: SETTINGS.RANGE_NAME, DIVISION_NAME: SETTINGS.DIVISION_NAME,
    AOI_ASSET: SETTINGS.AOI_ASSET, RAW_PARTS: ASSETS.RAW_PARTS, QC01_ASSET: ASSETS.QC01, FINAL_ASSET: ASSETS.FINAL,
    V21_ASSET: ASSETS.V21, DRIVE_FOLDER: SETTINGS.DRIVE_FOLDER, EXPECTED_ANCHOR_ID: null,
    W_N: SETTINGS.W_N, W_F: SETTINGS.W_F, CLASS_METHOD: SETTINGS.CLASS_METHOD, FIXED_BREAKS: [0.2, 0.4, 0.6, 0.8],
    BREAK_JITTER: 0.05, PHASE: SETTINGS.PHASE,
    RX: SETTINGS.RX, SITE_SPLITS: [0.33, 0.66], MC_K: 500, MC_SEED: 2026, MC_CONC: 125,
    CV_MIN: 0.05, RHO_MAX: 0.75, VIF_MAX: 5, X1_RHO_MAX: 0.60, INDEP_MAX: 0.60, OAT_MAX_SHARE: 0.15
  };
"""
cfg03 = """  var CFG = {
    RANGE_NAME: SETTINGS.RANGE_NAME, CRS: SETTINGS.CRS, AOI_ASSET: SETTINGS.AOI_ASSET, FINAL_ASSET: ASSETS.FINAL,
    DRIVE_FOLDER: SETTINGS.DRIVE_FOLDER, MIN_LOSS_PIXELS: 5, RECOVERED_RATIO: 0.80,
    TILE_SCALE: SETTINGS.TILE_SCALE
  };
"""
val = body_after_cfg((src / '03_validation.js').read_text())
for a, b in [("fin.filter(ee.Filter.eq('excluded', 0));", "fin.filter(ee.Filter.eq('excluded', 0)).filter(ee.Filter.eq('excluded_c8', 0));"),
             ("retained.filter(ee.Filter.eq('E1', 1)).filter(ee.Filter.eq('D4', 0))\n                       .filter(ee.Filter.gte('E2', 0.6));",
              "retained.filter(ee.Filter.eq('F13', 1)).filter(ee.Filter.eq('DE2', 'no'))\n                       .filter(ee.Filter.gte('F14', 0.6));"),
             ("'suit_core'", "'RFI'"),
             ("'PPI03_validation_report'", "'FRPIM03_validation_report'"),
             ("'PPI03_validation_report_' + CFG.RANGE_NAME", "'FRPIM03_validation_report_' + CFG.RANGE_NAME")]:
    assert val.count(a) >= 1, a
    val = val.replace(a, b)

out = HEADER + (src / 'lib.js').read_text()
out += fn('stepLayers', '', cfg01, r1, 'RUN 1 — DIVISION LAYERS -> ONE RAW BLOCK TABLE PER RANGE')
out += fn('stepMap', '', cfg02, r2, 'RUN 2 — NEED x FEASIBILITY FOR THE WHOLE DIVISION, MONTE CARLO, QC, MAPS')
out += fn('stepValidate', '', cfg03, val, 'VALIDATION (Section 15, optional)')
out += DISPATCH
pathlib.Path('scripts/FRPIM_v22_SABARKANTHA_DIVISION.js').write_text(out)
print('scripts/FRPIM_v22_SABARKANTHA_DIVISION.js', out.count('\n'), 'lines')
