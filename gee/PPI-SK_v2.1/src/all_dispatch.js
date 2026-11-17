
/* ======================================================================
 *  STEP DISPATCH — decides which step to run (asynchronous: the page
 *  stays responsive while Earth Engine looks up the saved results).
 * ====================================================================== */
var STEP_NAMES = {
  1: 'STEP 1 — State anchors (' + SETTINGS.STATE + '). Run both tasks; takes a few hours.',
  2: 'STEP 2 — Range layers and raw block table. Run all 4 tasks.',
  3: 'STEP 3 — Scoring, Monte Carlo, sensitivity, QC log. Run all 7 tasks.',
  4: 'STEP 4 — Final maps on screen. Run the 11 tasks to save maps/SHP/field list.',
  5: 'STEP 5 — Validation report. Run the task.'
};

function runStep(n) {
  print('==================================================================');
  print('PPI-SK v2.1 | ' + SETTINGS.RANGE_NAME + ' | running ' + STEP_NAMES[n]);
  print('Tasks appear in the Tasks tab after the checks below finish (about 1 minute).');
  print('After the tasks have FINISHED, press Run again for the next step.');
  print('==================================================================');
  if (n === 1) { step1_stateAnchors(); }
  else if (n === 2) { step2_rangeLayers(); }
  else if (n === 3) { step3_scoring('SCORE'); }
  else if (n === 4) { step3_scoring('PUBLISH'); }
  else if (n === 5) { step5_validation(); }
  else { print('STOP: STEP must be AUTO, 1, 2, 3, 4 or 5'); }
}

function assetExists(id, cb) {
  try {
    ee.data.getAsset(id, function (a, err) { cb(!!a && !err); });
  } catch (e) { cb(false); }
}

if (STEP === 'AUTO') {
  print('Looking for results of earlier steps ...');
  var ids = [ASSETS.FINAL, ASSETS.RAW, ASSETS.QC01, ASSETS.ANCHORS];
  var found = {}, waiting = ids.length;
  ids.forEach(function (id) {
    assetExists(id, function (ok) {
      found[id] = ok;
      waiting -= 1;
      if (waiting === 0) {
        var n;
        if (found[ASSETS.FINAL]) { n = 4; }
        else if (found[ASSETS.RAW] && found[ASSETS.QC01]) { n = 3; }
        else if (found[ASSETS.ANCHORS] || SETTINGS.ANCHOR_MODE === 'LIVE') { n = 2; }
        else { n = 1; }
        runStep(n);
      }
    });
  });
} else {
  runStep(STEP);
}
