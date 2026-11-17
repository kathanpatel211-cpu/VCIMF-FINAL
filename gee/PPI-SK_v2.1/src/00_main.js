/* ======================================================================
 *  MODULE 0 — STATE ANCHOR TABLE (build steps 1-2, Section 8.1)
 * ====================================================================== */

/* ---------- 1. State boundary and working grid ---------- */
var state = ee.FeatureCollection(LIB.A.GAUL1)
  .filter(ee.Filter.eq('ADM0_NAME', CFG0.COUNTRY))
  .filter(ee.Filter.eq('ADM1_NAME', CFG0.STATE));
print('State features (GAUL L1):', state.size());
var STATE_GEOM = state.geometry().simplify(250);
var STATE_CRS = LIB.utmCrs(STATE_GEOM);
print('State centroid UTM (used for anchor grid):', STATE_CRS);

/* ---------- 2. Load and print all 22 datasets (FF-01, FF-03) ---------- */
var CHECK = LIB.checkAssets(STATE_GEOM);
if (!CHECK.ok) {
  throw new Error('FF-01/FF-03 STOP: at least one dataset failed to load. ' +
                  'Check the IDs in Section 5. Nothing has been substituted.');
}

/* ---------- 3. Parameter images over the state ---------- */
var R_STATE = LIB.layers(STATE_GEOM, STATE_CRS, {
  csThr: CFG0.CS_THRESHOLD,
  d2Months: CFG0.D2_MONTHS,
  a3MaskTrees: false
});
var LAND = LIB.anchorLandMask();

/* ---------- 4. Percentiles (2nd, 98th) on the anchor landscape ---------- */
var ANCH_DICT = LIB.anchors(R_STATE, STATE_GEOM, STATE_CRS, LAND, CFG0.SCALE_OVERRIDE);

/* A ready-to-paste JavaScript constant for FROZEN mode in script 01. */
var pasteParts = LIB.ANCHOR_SPEC.map(function (s) {
  var k = s[0];
  return ee.String(k + ': [')
    .cat(ee.Number(ANCH_DICT.get(k + '_p2')).format('%.6g')).cat(', ')
    .cat(ee.Number(ANCH_DICT.get(k + '_p98')).format('%.6g')).cat(']');
});
var PASTE = ee.String("var ANCHORS = {id: '" + CFG0.ANCHOR_ID + "', ")
  .cat(ee.List(pasteParts).join(', ')).cat('};');

var anchorFeature = ee.Feature(null, ANCH_DICT).set({
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
Export.table.toDrive({
  collection: ANCHOR_FC,
  description: 'PPI00_anchors_' + CFG0.ANCHOR_ID.replace(/[^A-Za-z0-9_]/g, '_'),
  folder: CFG0.DRIVE_FOLDER,
  fileNamePrefix: 'PPI00_state_anchors_' + CFG0.ANCHOR_ID.replace(/[^A-Za-z0-9_]/g, '_'),
  fileFormat: 'CSV'
});
Export.table.toAsset({
  collection: ANCHOR_FC,
  description: 'PPI00_anchors_to_asset',
  assetId: CFG0.ANCHOR_ASSET
});

print('====================================================================');
print('NEXT: open the Tasks tab and RUN both tasks.');
print('When they finish, script 01 reads the anchors from:', CFG0.ANCHOR_ASSET);
print('(Strict "frozen constant" mode: copy the paste_js column of the CSV');
print(' into the ANCHORS line of script 01 and set ANCHOR_MODE = "FROZEN".)');
print('====================================================================');

if (CFG0.PRINT_INTERACTIVE) {
  // Interactive statewide percentiles normally exceed the 5-minute console limit.
  PASTE.evaluate(function (s, err) { print(err ? ('Interactive print timed out: use the CSV. ' + err) : s); });
}

Map.centerObject(state, 7);
Map.addLayer(ee.Image().byte().paint(state, 1, 2), {palette: ['black']}, CFG0.STATE + ' boundary');
Map.addLayer(LAND.selfMask(), {palette: ['#4daf4a']}, 'Anchor landscape (WC 10/20/30/60)', false);
