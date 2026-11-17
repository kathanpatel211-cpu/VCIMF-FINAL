/* ======================================================================
 *  MODULE 0 — STATE ANCHOR TABLE (build steps 1-2, Section 8.1)
 *  Fully asynchronous: the page never freezes. Export tasks appear in
 *  the Tasks tab only after the background dataset check has passed.
 * ====================================================================== */

/* ---------- 1. State boundary and working grid ---------- */
var state = ee.FeatureCollection(LIB.A.GAUL1)
  .filter(ee.Filter.eq('ADM0_NAME', CFG0.COUNTRY))
  .filter(ee.Filter.eq('ADM1_NAME', CFG0.STATE));
var STATE_GEOM = state.geometry().simplify(250);
var STATE_CRS = CFG0.STATE_CRS;
print('State features (GAUL L1):', state.size());
print('Anchor grid CRS:', STATE_CRS, '| state centroid UTM zone:', LIB.utmCrs(STATE_GEOM));

Map.centerObject(state, 7);
Map.addLayer(ee.Image().byte().paint(state, 1, 2), {palette: ['black']}, CFG0.STATE + ' boundary');
if (CFG0.AOI_ASSET) {
  Map.addLayer(ee.Image().byte().paint(ee.FeatureCollection(CFG0.AOI_ASSET), 1, 3), {palette: ['#d7191c']},
               'Your range (' + CFG0.RANGE_NAME + ')');
}
print('STEP 1 works on the whole state: it measures every parameter across ' + CFG0.STATE +
      ' to fix the scoring scale (anchors). Your range, blocks and parameter maps appear from STEP 2.');

/* ---------- 2. Load and print all 22 datasets (FF-01, FF-03), then build ---------- */
LIB.checkAssets(STATE_GEOM, function (CHECK) {
  if (!CHECK.ok) {
    print('FF-01/FF-03 STOP: at least one dataset failed to load (see FAIL lines above). ' +
          'Nothing has been substituted and no task was created.');
    return;
  }
  print('All datasets OK — creating the anchor export tasks.');

  /* ---------- 3. Parameter images over the state ---------- */
  var R_STATE = LIB.layers(STATE_GEOM, STATE_CRS, {
    csThr: CFG0.CS_THRESHOLD, d2Months: CFG0.D2_MONTHS, a3MaskTrees: false
  });
  var LAND = LIB.anchorLandMask();

  /* ---------- 4. Percentiles (2nd, 98th) on the anchor landscape ---------- */
  var ANCH_DICT = LIB.anchors(R_STATE, STATE_GEOM, STATE_CRS, LAND, CFG0.SCALE_OVERRIDE);

  var pasteParts = LIB.ANCHOR_SPEC.map(function (s) {
    var k = s[0];
    return ee.String(k + ': [')
      .cat(ee.Number(ANCH_DICT.get(k + '_p2')).format('%.6g')).cat(', ')
      .cat(ee.Number(ANCH_DICT.get(k + '_p98')).format('%.6g')).cat(']');
  });
  var PASTE = ee.String("var ANCHORS = {id: '" + CFG0.ANCHOR_ID + "', ")
    .cat(ee.List(pasteParts).join(', ')).cat('};');

  var anchorFeature = ee.Feature(STATE_GEOM.centroid(100), ANCH_DICT).set({   // asset tables need a geometry
    anchor_id: CFG0.ANCHOR_ID,
    state: CFG0.STATE,
    state_crs: STATE_CRS,
    model_version: 'PPI-SK_v2.1',
    dem_source: R_STATE.demSource,
    cs_threshold: CFG0.CS_THRESHOLD,
    d2_window: CFG0.D2_MONTHS.join('-'),
    anchor_scales: LIB.ANCHOR_SPEC.map(function (s) {
      return s[0] + '@' + (CFG0.SCALE_OVERRIDE || s[1]) + 'm';
    }).join(';'),
    asset_check: CHECK.log,
    created: ee.Date(Date.now()).format('YYYY-MM-dd'),
    paste_js: PASTE
  });
  var ANCHOR_FC = ee.FeatureCollection([anchorFeature]);

  /* ---------- 5. Freeze: export CSV (Drive) + table asset ---------- */
  var safeId = CFG0.ANCHOR_ID.replace(/[^A-Za-z0-9_]/g, '_');
  Export.table.toDrive({
    collection: ANCHOR_FC,
    description: 'PPI00_anchors_' + safeId,
    folder: CFG0.DRIVE_FOLDER,
    fileNamePrefix: 'PPI00_state_anchors_' + safeId,
    fileFormat: 'CSV'
  });
  Export.table.toAsset({
    collection: ANCHOR_FC,
    description: 'PPI00_anchors_to_asset',
    assetId: CFG0.ANCHOR_ASSET
  });

  print('====================================================================');
  print('NEXT: open the Tasks tab and RUN both tasks (PPI00_...).');
  print('When they finish, script 01 reads the anchors from:', CFG0.ANCHOR_ASSET);
  print('====================================================================');
  Map.addLayer(LAND.selfMask().clip(STATE_GEOM), {palette: ['#4daf4a']},
               'Anchor landscape: tree/shrub/grass/bare land in ' + CFG0.STATE, false);
});
