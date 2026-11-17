
/* ======================================================================
 *  STEP DISPATCH — decides which step to run
 * ====================================================================== */
function assetExists(id) {
  try { return !!ee.data.getAsset(id); } catch (e) { return false; }
}

var RUN_STEP = STEP;
if (STEP === 'AUTO') {
  var hasFinal = assetExists(ASSETS.FINAL);
  var hasRaw = assetExists(ASSETS.RAW) && assetExists(ASSETS.QC01);
  var hasAnch = assetExists(ASSETS.ANCHORS);
  if (hasFinal) { RUN_STEP = 4; }
  else if (hasRaw) { RUN_STEP = 3; }
  else if (hasAnch || SETTINGS.ANCHOR_MODE === 'LIVE') { RUN_STEP = 2; }
  else { RUN_STEP = 1; }
}

var STEP_NAMES = {
  1: 'STEP 1 — State anchors (' + SETTINGS.STATE + '). Run both tasks; takes a few hours.',
  2: 'STEP 2 — Range layers and raw block table. Run all 4 tasks.',
  3: 'STEP 3 — Scoring, Monte Carlo, sensitivity, QC log. Run all 7 tasks.',
  4: 'STEP 4 — Final maps on screen. Run the 11 tasks to save maps/SHP/field list.',
  5: 'STEP 5 — Validation report. Run the task.'
};
print('==================================================================');
print('PPI-SK v2.1 | ' + SETTINGS.RANGE_NAME + ' | running ' + STEP_NAMES[RUN_STEP]);
print('After the tasks finish, press Run again for the next step.');
print('==================================================================');

if (RUN_STEP === 1) { step1_stateAnchors(); }
else if (RUN_STEP === 2) { step2_rangeLayers(); }
else if (RUN_STEP === 3) { step3_scoring('SCORE'); }
else if (RUN_STEP === 4) { step3_scoring('PUBLISH'); }
else if (RUN_STEP === 5) { step5_validation(); }
else { throw new Error('STEP must be AUTO, 1, 2, 3, 4 or 5'); }
