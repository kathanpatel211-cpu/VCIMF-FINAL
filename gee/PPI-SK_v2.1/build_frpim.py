"""Builds scripts/FRPIM_v22_KHEDBRAHMA_RANGE.js — the FRPIM v2.2 range-only single file."""
import pathlib
from build_all_in_one import body_after_cfg, fn
src = pathlib.Path('src')
cfg01 = """  var CFG = {
    AOI_ASSET: SETTINGS.AOI_ASSET, RANGE_NAME: SETTINGS.RANGE_NAME, ID_PREFIX: SETTINGS.ID_PREFIX,
    MODEL_VERSION: 'FRPIM_v2.2', BLOCK_SIDE: 316.2278, MIN_BLOCK_HA: 2.0,
    BEAT_FIELD: SETTINGS.BEAT_FIELD, CRS: SETTINGS.CRS, STATE_CRS: SETTINGS.CRS,
    ANCHOR_MODE: 'LOCAL', ANCHOR_ASSET: null, STATE_NAME: 'Gujarat', LIVE_ANCHOR_SCALE: 500,
    LOCAL_BUFFER_KM: SETTINGS.LOCAL_BUFFER_KM, LOCAL_ANCHOR_SCALE: SETTINGS.LOCAL_ANCHOR_SCALE,
    CS_THRESHOLD: SETTINGS.CS_THRESHOLD, D2_MONTHS: SETTINGS.D2_MONTHS,
    A3_MASK_TREES: SETTINGS.A3_MASK_TREES, REASON_MIN_FRAC: 0.01, TILE_SCALE: SETTINGS.TILE_SCALE,
    RAW_ASSET: ASSETS.RAW, QC01_ASSET: ASSETS.QC01, DRIVE_FOLDER: SETTINGS.DRIVE_FOLDER, SHOW_MAP: true
  };
"""
cfg02 = """  var CFG = {
    STAGE: 'SCORE', PUBLISH_NOW: true, CRS: SETTINGS.CRS, RANGE_NAME: SETTINGS.RANGE_NAME,
    AOI_ASSET: SETTINGS.AOI_ASSET, RAW_ASSET: ASSETS.RAW, QC01_ASSET: ASSETS.QC01, FINAL_ASSET: ASSETS.FINAL,
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
# Validation (Section 15): v2.2 tests the feasibility index RFI; the sample excludes C8 blocks;
# "no Hansen loss" uses N6 = 0 and F13 / F14 replace E1 / E2.
val = body_after_cfg((src/'03_validation.js').read_text())
for a, b in [("fin.filter(ee.Filter.eq('excluded', 0));", "fin.filter(ee.Filter.eq('excluded', 0)).filter(ee.Filter.eq('excluded_c8', 0));"),
             ("retained.filter(ee.Filter.eq('E1', 1)).filter(ee.Filter.eq('D4', 0))\n                       .filter(ee.Filter.gte('E2', 0.6));",
              "retained.filter(ee.Filter.eq('F13', 1)).filter(ee.Filter.eq('DE2', 'no'))\n                       .filter(ee.Filter.gte('F14', 0.6));"),
             ("'suit_core'", "'RFI'"),
             ("'PPI03_validation_report'", "'FRPIM03_validation_report'"),
             ("'PPI03_validation_report_' + CFG.RANGE_NAME", "'FRPIM03_validation_report_' + CFG.RANGE_NAME")]:
    assert val.count(a) >= 1, a
    val = val.replace(a, b)
out = (src/'frpim_header.js').read_text() + (src/'lib.js').read_text()
out += fn('stepLayers', '', cfg01, (src/'01_frpim.js').read_text(),
          'RUN 1 — RANGE LAYERS -> RAW BLOCK TABLE (FRPIM build steps 3-17)')
out += fn('stepMap', '', cfg02, body_after_cfg((src/'02_frpim.js').read_text()),
          'RUN 2 — NEED x FEASIBILITY, MONTE CARLO, QC, COMPARISON, FINAL MAP (steps 18-26)')
out += fn('stepValidate', '', cfg03, val, 'VALIDATION (Section 15, optional)')
out += (src/'frpim_dispatch.js').read_text()
pathlib.Path('scripts/FRPIM_v22_KHEDBRAHMA_RANGE.js').write_text(out)
