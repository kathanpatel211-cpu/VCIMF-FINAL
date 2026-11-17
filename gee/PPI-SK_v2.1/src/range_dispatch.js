
/* ======================================================================
 *  DISPATCH — RUN 1 (layers + block table) or RUN 2 (final map)
 * ====================================================================== */
function runRangeStep(n) {
  var names = {
    LAYERS: 'RUN 1 — datasets, scoring scale, 10 ha blocks, parameter maps. Then Tasks -> RUN ALL.',
    MAP: 'RUN 2 — FINAL MAP for ' + SETTINGS.RANGE_NAME + '. Tasks -> RUN ALL saves all outputs.',
    VALIDATE: 'Validation report. Tasks -> RUN.'
  };
  print('==================================================================');
  print('PPI-SK v2.1 | ' + SETTINGS.RANGE_NAME + ' range | ' + names[n]);
  print('==================================================================');
  if (n === 'LAYERS') { stepLayers(); }
  else if (n === 'MAP') { stepMap(); }
  else if (n === 'VALIDATE') { stepValidate(); }
  else { print("STOP: STEP must be 'AUTO', 'LAYERS', 'MAP' or 'VALIDATE'"); }
}

var HAS_QC01 = true;
if (STEP === 'AUTO') {
  print('Looking for the saved block table of RUN 1 ...');
  var found = {}, waiting = 2;
  [ASSETS.RAW, ASSETS.QC01].forEach(function (id) {
    var done = function (ok) {
      found[id] = ok;
      waiting -= 1;
      if (waiting === 0) {
        HAS_QC01 = found[ASSETS.QC01];
        if (found[ASSETS.RAW] && !HAS_QC01) {
          print('Note: the QC01 table is missing (its task failed). The final map is not affected; ' +
                'the QC log marks those checks as NOT RECORDED.');
        }
        runRangeStep(found[ASSETS.RAW] ? 'MAP' : 'LAYERS');
      }
    };
    try { ee.data.getAsset(id, function (a, err) { done(!!a && !err); }); } catch (e) { done(false); }
  });
} else {
  runRangeStep(STEP);
}
