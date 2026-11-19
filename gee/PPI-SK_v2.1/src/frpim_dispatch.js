
/* ======================================================================
 *  DISPATCH — RUN 1 (layers + block table) or RUN 2 (final map)
 * ====================================================================== */
var HAS_QC01 = true, HAS_V21 = false, VERSION_WATCH = 'not checked';
function runFrpimStep(n) {
  var names = {
    LAYERS: 'RUN 1 — datasets, scoring scale, 10 ha blocks, all layers. Then Tasks -> RUN ALL.',
    MAP: 'RUN 2 — FINAL RESTORATION MAP for ' + SETTINGS.RANGE_NAME + '. Tasks -> RUN ALL saves all outputs.',
    VALIDATE: 'Validation report (V1, V2). Tasks -> RUN.'
  };
  print('==================================================================');
  print('FRPIM v2.2 | ' + SETTINGS.RANGE_NAME + ' range | ' + names[n]);
  print('==================================================================');
  if (n === 'LAYERS') { stepLayers(); }
  else if (n === 'MAP') { stepMap(); }
  else if (n === 'VALIDATE') { stepValidate(); }
  else { print("STOP: STEP must be 'AUTO', 'LAYERS', 'MAP' or 'VALIDATE'"); }
}
// Section 5.3 version watch (FF-28): newer releases to adopt the day they reach the GEE catalog
var WATCH = [['ESA CCI biomass v7.0', 'ESA/CCI/Above_Ground_Biomass/V7_0']];
var ids = [ASSETS.RAW, ASSETS.QC01, ASSETS.V21].concat(WATCH.map(function (w) { return w[1]; }));
var found = {}, waiting = ids.length;
print('Looking for saved results and checking the dataset version watch ...');
ids.forEach(function (id) {
  var done = function (ok) {
    found[id] = ok;
    waiting -= 1;
    if (waiting > 0) { return; }
    HAS_QC01 = found[ASSETS.QC01];
    HAS_V21 = found[ASSETS.V21];
    VERSION_WATCH = WATCH.map(function (w) { return w[0] + ': ' + (found[w[1]] ? 'NOW IN GEE - switch (Section 5.3)' : 'not yet in GEE'); })
      .concat(['Meta CHMv2: no public GEE asset path published; check the catalog']).join('; ');
    print('FF-28 version watch: ' + VERSION_WATCH);
    if (STEP !== 'AUTO') { runFrpimStep(STEP); return; }
    if (found[ASSETS.RAW] && !HAS_QC01) {
      print('Note: the QC01 table is missing; the map is not affected, the QC log marks those checks NOT RECORDED.');
    }
    if (found[ASSETS.RAW]) {
      print(HAS_V21 ? 'v2.1 results found: the change-from-v2.1 layer and transition table will be produced.'
                    : 'v2.1 final table not found: the comparison (FF-27) will be marked NOT AVAILABLE.');
    }
    runFrpimStep(found[ASSETS.RAW] ? 'MAP' : 'LAYERS');
  };
  try { ee.data.getAsset(id, function (a, err) { done(!!a && !err); }); } catch (e) { done(false); }
});
