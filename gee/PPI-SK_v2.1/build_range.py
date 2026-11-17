"""Builds scripts/PPI_SK_v21_KHEDBRAHMA_RANGE.js — the range-only single file."""
import pathlib
from build_all_in_one import body_after_cfg, indent, fn
src = pathlib.Path('src')
cfg01 = """  var CFG = {
    AOI_ASSET: SETTINGS.AOI_ASSET, RANGE_NAME: SETTINGS.RANGE_NAME, ID_PREFIX: SETTINGS.ID_PREFIX,
    MODEL_VERSION: 'PPI-SK_v2.1', BLOCK_SIDE: 316.2278, MIN_BLOCK_HA: 2.0,
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
    DRIVE_FOLDER: SETTINGS.DRIVE_FOLDER, EXPECTED_ANCHOR_ID: null,
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
out = (src/'range_header.js').read_text() + (src/'lib.js').read_text()
out += fn('stepLayers', '', cfg01, (src/'01_main.js').read_text(),
          'RUN 1 — RANGE LAYERS -> RAW BLOCK TABLE (spec build steps 3-17, local anchors)')
out += fn('stepMap', '', cfg02, body_after_cfg((src/'02_scoring.js').read_text()),
          'RUN 2 — SCORING, MONTE CARLO, QC AND FINAL MAP (spec build steps 18-25)')
out += fn('stepValidate', '', cfg03, body_after_cfg((src/'03_validation.js').read_text()),
          'VALIDATION (spec build steps 26-27, optional)')
out += (src/'range_dispatch.js').read_text()
out = out.replace("run script 02_scoring.", "press Run again (RUN 2: final map).")
out = out.replace("When PPI01_raw_blocks_to_asset');", "When PPI01_raw_blocks_to_asset');", 1)
pathlib.Path('scripts/PPI_SK_v21_KHEDBRAHMA_RANGE.js').write_text(out)
