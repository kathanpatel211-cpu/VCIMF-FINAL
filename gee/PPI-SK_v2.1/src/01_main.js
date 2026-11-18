/* ======================================================================
 *  SCRIPT 01 — MAIN (build steps 3-17)
 *  Fully asynchronous: all server questions run in the background, so
 *  the page never freezes. Export tasks appear only after every check
 *  (FF-01, FF-02, FF-03, anchors) has passed.
 * ====================================================================== */

/* ---------- Step 3: range asset, UTM zone, beat field (FF-02, FF-05) ---------- */
var AOI_FC = ee.FeatureCollection(CFG.AOI_ASSET);
var AOI = AOI_FC.geometry().dissolve({maxError: 1});
var CRS = CFG.CRS;

var PRE = {
  n: AOI_FC.size(),
  props: ee.Feature(AOI_FC.first()).propertyNames(),
  utm: LIB.utmCrs(AOI)
};
if (CFG.ANCHOR_MODE === 'ASSET') {
  var af0 = ee.Feature(ee.FeatureCollection(CFG.ANCHOR_ASSET).first());
  PRE.anchor = ee.Dictionary({id: af0.get('anchor_id'), cs: af0.get('cs_threshold'), d2: af0.get('d2_window')});
}
print('Reading the range asset and checking datasets in the background ...');
LIB.evalRetry(ee.Dictionary(PRE), function (info, err) {
  if (err) {
    print('STOP: could not read the range asset' +
          (CFG.ANCHOR_MODE === 'ASSET' ? ' or the anchor table (run STEP 1 first, or set ANCHOR_MODE = LIVE)' : '') +
          ': ' + err);
    return;
  }
  print('AOI features:', info.n);
  print('AOI property names:', info.props);
  print('UTM zone of AOI centroid:', info.utm, '| working CRS:', CRS);
  if (info.utm !== CRS) {
    print('FF-02 STOP: the AOI centroid is in ' + info.utm + ' but CRS is set to ' + CRS +
          '. Set CRS to ' + info.utm + ' at the top of the script.');
    return;
  }
  if (info.anchor) {
    if (info.anchor.cs !== CFG.CS_THRESHOLD || info.anchor.d2 !== CFG.D2_MONTHS.join('-')) {
      print('WARNING: CS_THRESHOLD / D2_MONTHS differ from the anchor run (' + info.anchor.cs + ', ' +
            info.anchor.d2 + '). Anchors stay valid but log this in the DPR.');
    }
  }
  var BEAT_FIELD = null;
  if (CFG.BEAT_FIELD === 'AUTO') {
    for (var i = 0; i < info.props.length; i++) {
      if (/beat|compart|compt/i.test(info.props[i])) { BEAT_FIELD = info.props[i]; break; }
    }
  } else if (CFG.BEAT_FIELD) {
    BEAT_FIELD = CFG.BEAT_FIELD;
  }
  print('Beat field used:', BEAT_FIELD === null ? "none -> beat_id = 'RANGE'" : BEAT_FIELD);

  /* ---------- FF-01 / FF-03: load and print every dataset ---------- */
  LIB.checkAssets(AOI, function (CHECK) {
    if (!CHECK.ok) {
      print('FF-01/FF-03 STOP: a dataset failed to load or a mosaic lost its projection ' +
            '(see FAIL lines above). Nothing has been substituted and no task was created.');
      return;
    }
    if (CFG.ANCHOR_MODE === 'LOCAL') {
      var refGeom = AOI.buffer(CFG.LOCAL_BUFFER_KM * 1000, 200);
      print('All datasets OK. Computing the scoring scale (anchors) for ' + CFG.RANGE_NAME +
            ' + ' + CFG.LOCAL_BUFFER_KM + ' km landscape in the background (1-3 minutes) ...');
      Map.addLayer(ee.Image().byte().paint(ee.FeatureCollection([ee.Feature(refGeom)]), 1, 1),
                   {palette: ['#2b83ba']}, 'Anchor landscape (range + ' + CFG.LOCAL_BUFFER_KM + ' km)', false);
      var R_REF = LIB.layers(refGeom, CRS,
        {csThr: CFG.CS_THRESHOLD, d2Months: CFG.D2_MONTHS, a3MaskTrees: false});
      LIB.anchorsAsync(R_REF, refGeom, CRS, LIB.anchorLandMask(), CFG.LOCAL_ANCHOR_SCALE,
        function (dict, ok, alog) {
          if (!ok) {
            print('STOP: some anchors could not be computed (see FAIL lines). Press Run again; ' +
                  'if it repeats, set LOCAL_ANCHOR_SCALE to 250.');
            return;
          }
          print('Anchors ready — building the range layers and export tasks.');
          runRange(BEAT_FIELD, CHECK, dict, alog);
        });
      return;
    }
    print('All datasets OK — building the range layers and export tasks.');
    runRange(BEAT_FIELD, CHECK);
  });
});

function runRange(BEAT_FIELD, CHECK, LOCAL_ANCH, LOCAL_LOG) {
var FF02 = 'PASS';
/* ---------- Step 4: 10 ha grid, stable block ID, beat join (FF-04) ---------- */
var proj = ee.Projection(CRS).atScale(CFG.BLOCK_SIDE);
var grid = AOI.coveringGrid(proj).map(function (f) {
  var inter = f.geometry().intersection(AOI, 1);
  var a = inter.area(1).divide(1e4);
  var full = f.geometry().area(1).divide(1e4);
  return f.set({
    block_area_ha: a,
    geom_full_ha: full,
    is_interior: a.gte(full.multiply(0.9999))
  }).setGeometry(inter);
}).filter(ee.Filter.gte('block_area_ha', CFG.MIN_BLOCK_HA));

grid = grid.map(function (f) {
  var c = f.geometry().centroid(1).transform(CRS, 1).coordinates();
  var e = ee.Number(c.get(0)).round().format('%.0f');
  var n = ee.Number(c.get(1)).round().format('%.0f');
  return f.set('block_id', ee.String(CFG.ID_PREFIX).cat(e).cat('_').cat(n));
});

function toStr(v) {
  return ee.Algorithms.If(ee.Algorithms.IsEqual(v, null), 'RANGE',
         ee.Algorithms.If(ee.Algorithms.IsEqual(ee.Algorithms.ObjectType(v), 'String'), v,
                          ee.Number(v).format('%.0f')));
}
if (BEAT_FIELD !== null) {
  grid = grid.map(function (f) {
    var g = f.geometry();
    var cands = AOI_FC.filterBounds(g).map(function (b) {
      return b.set('ov__', b.geometry().intersection(g, 1).area(1));
    });
    var best = ee.Feature(cands.sort('ov__', false).first());
    var v = ee.Algorithms.If(cands.size().gt(0), best.get(BEAT_FIELD), null);
    return f.set('beat_id', toStr(v));
  });
} else {
  grid = grid.map(function (f) { return f.set('beat_id', 'RANGE'); });
}
var N_GRID = grid.size();
print('Blocks in grid (>= ' + CFG.MIN_BLOCK_HA + ' ha):', N_GRID);

/* ---------- Anchors (Section 8, FF-09) ---------- */
var ANCH, ANCHOR_ID;
if (CFG.ANCHOR_MODE === 'ASSET') {
  var af = ee.Feature(ee.FeatureCollection(CFG.ANCHOR_ASSET).first());
  ANCH = af.toDictionary();
  ANCHOR_ID = ee.String(af.get('anchor_id'));
  print('Anchor table loaded:', ANCHOR_ID);
} else if (CFG.ANCHOR_MODE === 'FROZEN') {
  if (!ANCHORS || ANCHORS.id === 'NOT_SET') {
    print('FF-09 STOP: ANCHOR_MODE = FROZEN but the ANCHORS constant is not pasted.'); return;
  }
  var ad = {};
  LIB.ANCHOR_SPEC.forEach(function (s) {
    if (!ANCHORS[s[0]]) { ad.__missing = s[0]; return; }
    ad[s[0] + '_p2'] = ANCHORS[s[0]][0];
    ad[s[0] + '_p98'] = ANCHORS[s[0]][1];
  });
  if (ad.__missing) { print('FF-09 STOP: ANCHORS has no entry for ' + ad.__missing); return; }
  ANCH = ee.Dictionary(ad);
  ANCHOR_ID = ee.String(ANCHORS.id);
} else if (CFG.ANCHOR_MODE === 'LOCAL') {
  ANCH = ee.Dictionary(LOCAL_ANCH);
  var today = new Date().toISOString().slice(0, 10);
  ANCHOR_ID = ee.String('LOCAL_' + CFG.RANGE_NAME + '+' + CFG.LOCAL_BUFFER_KM + 'km_' + today);
  var anchFC = ee.FeatureCollection([ee.Feature(null, LOCAL_ANCH).set({
    anchor_id: ANCHOR_ID, anchor_landscape: CFG.RANGE_NAME + ' + ' + CFG.LOCAL_BUFFER_KM + ' km buffer',
    anchor_scales: LOCAL_LOG, land_mask: 'WorldCover 10/20/30/60', created: today})]);
  Export.table.toDrive({collection: anchFC, description: 'PPI01_local_anchor_table',
    folder: CFG.DRIVE_FOLDER, fileNamePrefix: 'PPI01_local_anchors_' + CFG.RANGE_NAME, fileFormat: 'CSV'});
} else if (CFG.ANCHOR_MODE === 'LIVE') {
  print('WARNING: LIVE anchors at ' + CFG.LIVE_ANCHOR_SCALE + ' m — provisional (FF-09 = WARN).');
  var stateFC = ee.FeatureCollection(LIB.A.GAUL1)
    .filter(ee.Filter.eq('ADM0_NAME', 'India')).filter(ee.Filter.eq('ADM1_NAME', CFG.STATE_NAME));
  var stateGeom = stateFC.geometry().simplify(250);
  var stateCrs = CFG.STATE_CRS;
  var R_STATE = LIB.layers(stateGeom, stateCrs,
    {csThr: CFG.CS_THRESHOLD, d2Months: CFG.D2_MONTHS, a3MaskTrees: false});
  ANCH = LIB.anchors(R_STATE, stateGeom, stateCrs, LIB.anchorLandMask(), CFG.LIVE_ANCHOR_SCALE);
  ANCHOR_ID = ee.String('LIVE_' + CFG.LIVE_ANCHOR_SCALE + 'm_').cat(ee.Date(Date.now()).format('YYYY-MM-dd'));
} else {
  print('STOP: ANCHOR_MODE must be LOCAL, ASSET, FROZEN or LIVE'); return;
}

/* ---------- Steps 5-12: all layers on the range grid ---------- */
var R = LIB.layers(AOI, CRS, {
  csThr: CFG.CS_THRESHOLD, d2Months: CFG.D2_MONTHS, a3MaskTrees: CFG.A3_MASK_TREES
});
print('DEM source:', R.demSource);

/* ---------- Step 14: per-pixel scores ---------- */
var S = LIB.score(R, ANCH);

/* ---------- Step 15: block reduction, one call per reducer group (Section 9) ---------- */
var MED30 = ee.Image.cat([
  S.A1.rename('A1'), R.A1.rename('A1_raw'),
  S.B1.rename('B1'), S.B1_opt.rename('B1_opt'), S.B1_pes.rename('B1_pes'),
  R.slopeDeg.rename('B1_raw_slope'), R.tpi.rename('B1_raw_tpi'), R.hand.rename('B1_raw_hand'),
  S.B7.rename('B7'), R.rough.rename('B7_raw'),
  S.C1s.rename('C1s'), R.slopePct.rename('C1s_raw'),
  S.C2s.rename('C2s'), R.hli.rename('C2s_raw'),
  S.C3s.rename('C3s'), R.curv.rename('C3s_raw')
]).toFloat();

var MEAN30 = ee.Image.cat([
  S.A2.rename('A2'), R.A2.rename('A2_raw'),
  S.B2.rename('B2'), R.clay.rename('B2_raw_clay'), R.sand.rename('B2_raw_sand'),
  S.B3.rename('B3'), R.soc.rename('B3_raw'),
  S.B4.rename('B4'), R.ph.rename('B4_raw'),
  S.B5.rename('B5'), R.cec.rename('B5_raw'),
  S.B6.rename('B6'), R.cfvo.rename('B6_raw'),
  S.D2.rename('D2'), R.D2trend.rename('D2_raw'),
  S.D3.rename('D3'), R.agb.rename('D3_raw'),
  S.E2.rename('E2'), R.E2_dist.rename('E2_raw_dist'), R.E2_pop.rename('E2_raw_pop'),
  S.E4.rename('E4'), R.E4.rename('E4_raw'),
  R.D4mask.rename('D4_raw')
]).toFloat();

var MEAN10 = ee.Image.cat([
  S.A3.rename('A3'), R.A3.rename('A3_raw'),
  R.canopyPct.rename('canopy_pct'),
  R.D5mask.rename('D5_raw'),
  R.C2.rename('C2_frac'), R.C3.rename('C3_frac'), R.C4.rename('C4_frac'),
  R.C5.rename('C5_frac'), R.C6.rename('C6_frac'), R.C7.rename('C7_frac'),
  R.anyFail.rename('constrained_frac'),
  R.F1mask.rename('F1_frac')
]).toFloat();

var MAX30 = ee.Image.cat([S.A5.rename('A5'), S.D6.rename('D6'), R.fire, R.pa]).toFloat();
var MIN30 = ee.Image.cat([R.A5_dist.rename('A5_raw'), R.D6_dist.rename('D6_raw'),
                          R.access.rename('access_m')]).toFloat();

function reduceGroup(img, fc, reducer, scale) {
  return img.reduceRegions({collection: fc, reducer: reducer, scale: scale, crs: CRS,
                            tileScale: CFG.TILE_SCALE});
}
var blocks = reduceGroup(MED30, grid, ee.Reducer.median(), 30);
blocks = reduceGroup(MEAN30, blocks, ee.Reducer.mean(), 30);
blocks = reduceGroup(MEAN10, blocks, ee.Reducer.mean(), 10);
blocks = reduceGroup(MAX30, blocks, ee.Reducer.max(), 30);
blocks = reduceGroup(MIN30, blocks, ee.Reducer.min(), 30);

/* ---------- Steps 13 + 16: constraints, canopy track, fire years, flags ---------- */
function num(f, p, d) {
  var v = f.get(p);
  return ee.Number(ee.Algorithms.If(ee.Algorithms.IsEqual(v, null), d, v));
}
var RUN_DATE = ee.Date(Date.now()).format('YYYY-MM-dd');

blocks = blocks.map(function (f) {
  var area = ee.Number(f.get('block_area_ha'));
  var canopyMissing = ee.Algorithms.IsEqual(f.get('canopy_pct'), null);
  var canopy = num(f, 'canopy_pct', 0);
  var fr = num(f, 'constrained_frac', 0);

  var fireYears = ee.Number(0);
  LIB.FIRE_YEARS.forEach(function (y) { fireYears = fireYears.add(num(f, 'fire_' + y, 0)); });

  var exC1 = canopy.gte(40);
  var exFr = fr.gt(0.30);
  var excluded = exC1.or(exFr);

  var reasons = ee.List(['C2', 'C3', 'C4', 'C5', 'C6', 'C7'].map(function (c) {
    return ee.Algorithms.If(num(f, c + '_frac', 0).gte(CFG.REASON_MIN_FRAC), c, '');
  }));
  reasons = ee.List(ee.Algorithms.If(exC1, ee.List(['C1']).cat(reasons), reasons))
              .filter(ee.Filter.neq('item', ''));

  var access = ee.Algorithms.If(ee.Algorithms.IsEqual(f.get('access_m'), null), null,
                                num(f, 'access_m', 0).divide(1000));

  return f.set({
    // block-level fixed-formula scores (Section 7.4 / 7.5)
    D1: ee.Number(40).subtract(canopy).divide(40).max(0).min(1),
    D1_raw: canopy,
    D4: num(f, 'D4_raw', 0).max(0).min(1),
    D5: num(f, 'D5_raw', 0).max(0).min(1),
    fire_years: fireYears,
    E1_raw: fireYears,
    E1: ee.Number(1).subtract(fireYears.divide(11)).max(0).min(1),
    // constraints and canopy track (Section 6)
    canopy_missing: ee.Algorithms.If(canopyMissing, 1, 0),
    excluded_c1: exC1,
    excluded: excluded,
    exclusion_reason: ee.Algorithms.If(exC1, 'C1', ee.Algorithms.If(exFr, 'C2-C7 > 30%', '')),
    constraint_flag: ee.Algorithms.If(exFr, 'excluded',
                       ee.Algorithms.If(fr.gte(0.10), 'partial', 'none')),
    constraint_reason: reasons.join(','),
    canopy_track: ee.Algorithms.If(exC1, 'EXCLUDED_C1',
                    ee.Algorithms.If(canopy.gte(10), 'GAP_ANR', 'FULL')),
    net_plantable_ha: ee.Algorithms.If(excluded, 0, area.multiply(ee.Number(1).subtract(fr))),
    // advisory flags (Section 6.4)
    recent_plantation_flag: ee.Algorithms.If(num(f, 'F1_frac', 0).gte(0.30).and(canopy.lt(40)), 'yes', 'no'),
    protected_area_flag: ee.Algorithms.If(num(f, 'pa', 0).gte(1), 'yes', 'no'),
    advisory_access_km: access,
    // audit trail
    anchor_id: ANCHOR_ID,
    dem_source: R.demSource,
    fire_source_gap: LIB.FIRE_SOURCE_GAP,
    model_version: CFG.MODEL_VERSION,
    range_name: CFG.RANGE_NAME,
    run_date: RUN_DATE,
    work_crs: CRS,
    n_blocks_grid: N_GRID,
    cs_threshold: CFG.CS_THRESHOLD,
    d2_window: CFG.D2_MONTHS.join('-'),
    a3_mask_trees: CFG.A3_MASK_TREES ? 'yes' : 'no',
    beat_field: BEAT_FIELD === null ? 'none' : BEAT_FIELD
  });
});

/* ---------- QC from script 01 (FF-01..05, FF-18, FF-19) ---------- */
var ff04Bad = grid.filter(ee.Filter.eq('is_interior', 1))
  .filter(ee.Filter.or(ee.Filter.lt('block_area_ha', 9.99), ee.Filter.gt('block_area_ha', 10.01))).size();
var ff05Null = N_GRID.subtract(grid.filter(ee.Filter.notNull(['beat_id'])).size());
var pct5 = function (img) {
  return ee.Dictionary(img.reduceRegion({reducer: ee.Reducer.percentile([5]), geometry: AOI,
    scale: 100, crs: CRS, maxPixels: 1e10, tileScale: 4})).values().get(0);
};
var ff18A3 = pct5(R.A3_minObs.unmask(0));
var ff18D5 = pct5(R.D5_minObs.unmask(0));
var ff19 = ee.Dictionary(R.D2n.unmask(0).gte(8).reduceRegion({reducer: ee.Reducer.mean(),
  geometry: AOI, scale: 30, crs: CRS, maxPixels: 1e10, tileScale: 4})).values().get(0);

var QC01 = ee.FeatureCollection([ee.Feature(AOI.centroid(1), {
  FF01_asset_log: CHECK.log,
  FF01_status: CHECK.ok ? 'PASS' : 'STOP',
  FF02_crs: CRS,
  FF02_status: FF02,
  FF03_scales: JSON.stringify(CHECK.scales),
  FF03_status: CHECK.ok ? 'PASS' : 'STOP',
  FF04_interior_blocks_out_of_tolerance: ff04Bad,
  FF05_null_beat: ff05Null,
  FF05_beat_field: BEAT_FIELD === null ? 'none (RANGE)' : BEAT_FIELD,
  FF18_A3_p5_min_clear_obs: ff18A3,
  FF18_D5_p5_min_clear_obs: ff18D5,
  FF18_cs_threshold: CFG.CS_THRESHOLD,
  FF19_share_pixels_8yrs: ff19,
  FF19_window: CFG.D2_MONTHS.join('-'),
  n_blocks_grid: N_GRID,
  anchor_id: ANCHOR_ID,
  anchor_mode: CFG.ANCHOR_MODE,
  dem_source: R.demSource,
  run_date: RUN_DATE
})]);

/* ---------- Step 17: EXPORT the raw block table — mandatory checkpoint ---------- */
Export.table.toAsset({
  collection: blocks,
  description: 'PPI01_raw_blocks_to_asset',
  assetId: CFG.RAW_ASSET
});
Export.table.toAsset({
  collection: QC01,
  description: 'PPI01_qc01_to_asset',
  assetId: CFG.QC01_ASSET
});
Export.table.toDrive({
  collection: QC01,
  description: 'PPI01_qc01_csv',
  folder: CFG.DRIVE_FOLDER,
  fileNamePrefix: 'PPI01_qc01_' + CFG.RANGE_NAME,
  fileFormat: 'CSV'
});
// Product 8: constraint map. Bit code: 1 canopy>=40%, 2 C2 water, 4 C3 drain,
// 8 C4 slope, 16 C5 built, 32 C6 crop, 64 C7 rock (values add up).
Export.image.toDrive({
  image: R.constraintCode.clip(AOI),
  description: 'PPI01_constraint_map',
  folder: CFG.DRIVE_FOLDER,
  fileNamePrefix: 'PPI01_constraint_map_' + CFG.RANGE_NAME,
  region: AOI,
  crs: CRS,
  scale: 10,
  maxPixels: 1e11
});

print('====================================================================');
print('NEXT: Tasks tab -> RUN ALL. When PPI01_raw_blocks_to_asset');
print('and PPI01_qc01_to_asset have completed, run script 02_scoring.');
print('Raw block asset:', CFG.RAW_ASSET);
print('====================================================================');

/* ---------- Map preview (tiles are computed on demand) ---------- */
if (CFG.SHOW_MAP) {
  Map.centerObject(AOI, 11);
  // Layers are computed on fixed 10-30 m grids; zooming out further than level 10 would ask
  // the preview for > 16,000 px per tile ("Reprojection output too large"). Exports are unaffected.
  Map.setLocked(false, 10, 22);
  Map.addLayer(ee.Image().byte().paint(AOI_FC, 1, 2), {palette: ['black']}, 'Range boundary');
  Map.addLayer(ee.Image().byte().paint(grid, 1, 1), {palette: ['#555555']}, '10 ha blocks', true);
  // Preview layers avoid the 1.2 m canopy-height aggregation (too many pixels for a map tile);
  // the exports and block table use the full-resolution canopy.
  Map.addLayer(R.chm.gte(5).selfMask().clip(AOI), {palette: ['#1a9850']},
               'Trees >= 5 m tall (Meta canopy height)', false);
  var consPreview = R.C2.multiply(2).add(R.C3.multiply(4)).add(R.C4.multiply(8))
    .add(R.C5.multiply(16)).add(R.C6.multiply(32)).add(R.C7.multiply(64)).selfMask();
  Map.addLayer(consPreview.clip(AOI), {min: 2, max: 64,
               palette: ['#08519c', '#9e9ac8', '#e6550d', '#636363', '#fdae6b', '#8c510a']},
               'Constraints C2-C7 (water, drain, steep, built, crop, rock)', false);
  var sc = {min: 0, max: 1, palette: ['#d73027', '#fee08b', '#1a9850']};   // red = low score, green = high
  [['A1', 'A1 Topographic wetness (CTI)'], ['A3', 'A3 Post-monsoon moisture'], ['A5', 'A5 Near seasonal water'],
   ['B1', 'B1 Soil depth proxy'], ['B2', 'B2 Soil texture'], ['B4', 'B4 Soil pH'], ['B7', 'B7 Rockiness (inverse)'],
   ['C1s', 'C1s Slope'], ['C2s', 'C2s Heat load (inverse)'], ['D2', 'D2 Degradation trend'],
   ['D3', 'D3 Biomass deficit'], ['E2', 'E2 Low biotic pressure'],
   ['E4', 'E4 Erosion risk']].forEach(function (p) {
    Map.addLayer(S[p[0]].clip(AOI), sc, 'Score ' + p[1], false);
  });
  print('Map: tick any "Score ..." layer in the Layers menu (top right) to view a parameter. ' +
        'Red = low score, green = high. Final categories appear in the next run, after the tasks finish.');
}
}
