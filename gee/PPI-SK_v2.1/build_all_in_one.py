"""Builds scripts/PPI_SK_v21_ALL_IN_ONE.js from src/ (one copy-paste file)."""
import re, pathlib
src = pathlib.Path('src')
def body_after_cfg(text):
    # drop everything up to and including the first top-level 'var CFG = {...};'
    i = text.index('var CFG = {')
    j = text.index('\n};\n', i) + 4
    return text[j:]
def indent(t): return ''.join('  ' + l if l.strip() else l for l in t.splitlines(True))

cfg00 = """  var CFG0 = {
    COUNTRY: SETTINGS.COUNTRY, STATE: SETTINGS.STATE, ANCHOR_ID: SETTINGS.ANCHOR_ID,
    ANCHOR_ASSET: ASSETS.ANCHORS, DRIVE_FOLDER: SETTINGS.DRIVE_FOLDER,
    CS_THRESHOLD: SETTINGS.CS_THRESHOLD, D2_MONTHS: SETTINGS.D2_MONTHS,
    STATE_CRS: SETTINGS.STATE_CRS, SCALE_OVERRIDE: null
  };
"""
cfg01 = """  var CFG = {
    AOI_ASSET: SETTINGS.AOI_ASSET, RANGE_NAME: SETTINGS.RANGE_NAME, ID_PREFIX: SETTINGS.ID_PREFIX,
    MODEL_VERSION: 'PPI-SK_v2.1', BLOCK_SIDE: 316.2278, MIN_BLOCK_HA: 2.0,
    BEAT_FIELD: SETTINGS.BEAT_FIELD, CRS: SETTINGS.CRS, STATE_CRS: SETTINGS.STATE_CRS,
    ANCHOR_MODE: SETTINGS.ANCHOR_MODE, ANCHOR_ASSET: ASSETS.ANCHORS, STATE_NAME: SETTINGS.STATE,
    LIVE_ANCHOR_SCALE: SETTINGS.LIVE_ANCHOR_SCALE,
    CS_THRESHOLD: SETTINGS.CS_THRESHOLD, D2_MONTHS: SETTINGS.D2_MONTHS,
    A3_MASK_TREES: SETTINGS.A3_MASK_TREES, REASON_MIN_FRAC: 0.01, TILE_SCALE: SETTINGS.TILE_SCALE,
    RAW_ASSET: ASSETS.RAW, QC01_ASSET: ASSETS.QC01, DRIVE_FOLDER: SETTINGS.DRIVE_FOLDER, SHOW_MAP: true
  };
"""
cfg02 = """  var CFG = {
    STAGE: stage, CRS: SETTINGS.CRS, RANGE_NAME: SETTINGS.RANGE_NAME, AOI_ASSET: SETTINGS.AOI_ASSET,
    RAW_ASSET: ASSETS.RAW, QC01_ASSET: ASSETS.QC01, FINAL_ASSET: ASSETS.FINAL,
    DRIVE_FOLDER: SETTINGS.DRIVE_FOLDER,
    EXPECTED_ANCHOR_ID: SETTINGS.ANCHOR_MODE === 'ASSET' ? SETTINGS.ANCHOR_ID : null,
    WEIGHTS: SETTINGS.WEIGHTS, RX: SETTINGS.RX, SITE_SPLITS: [0.33, 0.66],
    MC_K: 500, MC_SEED: 2026, MC_CONC: 125,
    CV_MIN: 0.05, RHO_MAX: 0.75, VIF_MAX: 5, A3_RHO_MAX: 0.60, OAT_MAX_SHARE: 0.15
  };
"""
cfg03 = """  var CFG = {
    RANGE_NAME: SETTINGS.RANGE_NAME, CRS: SETTINGS.CRS, AOI_ASSET: SETTINGS.AOI_ASSET, FINAL_ASSET: ASSETS.FINAL,
    DRIVE_FOLDER: SETTINGS.DRIVE_FOLDER, MIN_LOSS_PIXELS: 5, RECOVERED_RATIO: 0.80,
    TILE_SCALE: SETTINGS.TILE_SCALE
  };
"""
def fn(name, args, cfg, body, title):
    return ('\n/* ######################################################################\n'
            ' *  ' + title + '\n'
            ' * ###################################################################### */\n'
            'function ' + name + '(' + args + ') {\n' + cfg + indent(body) + '}\n')
out = (src/'all_header.js').read_text() + (src/'lib.js').read_text()
out += fn('step1_stateAnchors', '', cfg00, (src/'00_main.js').read_text(),
          'STEP 1 — STATE ANCHOR TABLE (spec build steps 1-2)')
out += fn('step2_rangeLayers', '', cfg01, (src/'01_main.js').read_text(),
          'STEP 2 — RANGE LAYERS -> RAW BLOCK TABLE (spec build steps 3-17)')
out += fn('step3_scoring', 'stage', cfg02, body_after_cfg((src/'02_scoring.js').read_text()),
          'STEP 3 / 4 — SCORING, MONTE CARLO, QC, PUBLISH (spec build steps 18-25)')
out += fn('step5_validation', '', cfg03, body_after_cfg((src/'03_validation.js').read_text()),
          'STEP 5 — VALIDATION (spec build steps 26-27, optional)')
out += (src/'all_dispatch.js').read_text()
# the separate-script hints ("run script 02" etc.) -> step wording
out = out.replace("run script 02_scoring.", "press Run again (STEP 3).")
out = out.replace("When they finish, script 01 reads the anchors from:", "When they finish, press Run again (STEP 2). Anchors saved to:")
pathlib.Path('scripts/PPI_SK_v21_ALL_IN_ONE.js').write_text(out)
