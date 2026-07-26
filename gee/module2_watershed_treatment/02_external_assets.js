/**
 * 02_external_assets.js
 *
 * Two categories of asset live here:
 *  (1) Public/community catalog assets (✅ verified against the live catalog,
 *      ⚠️ community-catalog or external — verified at runtime, with a
 *      stated fallback per Part 1.1 / Part 3 tables).
 *  (2) Assets that MUST be produced by the external Whitebox/SAGA/GRASS
 *      workflow (Part 2) and uploaded before this script can run. GEE has
 *      no native flow direction/accumulation/watershed delineation — this
 *      is a hard platform limitation, not an oversight. Running Tier 1/2
 *      against the placeholder paths below will fail loudly by design:
 *      that failure is the signal that the external step has not been done.
 */

var config = require('users/<you>/VCIMF-FINAL:gee/module2_watershed_treatment/00_config.js');

// ---------------------------------------------------------------------------
// Generic verify-with-fallback helper (Part 1.1: "verify with print() before use")
// ---------------------------------------------------------------------------
function verifyAsset(assetId, kind, label, fallbackFn) {
  try {
    ee.data.getAsset(assetId);
    print('✓ Verified: ' + label + '  ->  ' + assetId);
    return kind === 'image' ? ee.Image(assetId)
         : kind === 'imageCollection' ? ee.ImageCollection(assetId)
         : ee.FeatureCollection(assetId);
  } catch (e) {
    print('⚠ WARNING: ' + label + ' not found at ' + assetId +
          '. Using stated fallback. (' + e + ')');
    return fallbackFn();
  }
}

// ---------------------------------------------------------------------------
// 1.1 — DEM (do not route flow over a surface model)
// ---------------------------------------------------------------------------
var FABDEM_ID = 'projects/sat-io/open-datasets/FABDEM';     // ⚠️ community catalog, DTM
var GLO30_ID = 'COPERNICUS/DEM/GLO30';                       // ✅ DSM fallback
var MERIT_HYDRO_ID = 'MERIT/Hydro/v1_0_1';                   // ✅ conditioned DTM ~90 m, cross-check + HAND source
var AW3D30_ID = 'JAXA/ALOS/AW3D30/V3_2';                     // ✅ DSM cross-check only

function getDem() {
  return verifyAsset(FABDEM_ID, 'imageCollection', 'FABDEM (preferred DTM)', function () {
    print('⚠ FALLBACK: using COPERNICUS/DEM/GLO30 (DSM). Apply aggressive ' +
          'hydrological conditioning (breach, not fill) and validate the derived ' +
          'stream network in >=5 forested sub-catchments against toposheets before accepting (Part 1.1).');
    return ee.ImageCollection(GLO30_ID).select('DEM').mosaic();
  });
}
// FABDEM on sat-io is published as single mosaicked images/collection depending on version;
// callers should call getDem().mosaic() if an ImageCollection comes back, else use directly.

function getMeritHydro() { return ee.Image(MERIT_HYDRO_ID); }
function getHand() { return getMeritHydro().select('hnd'); }
function getAw3d30() { return ee.ImageCollection(AW3D30_ID).select('DSM').mosaic(); }

// ---------------------------------------------------------------------------
// Soil properties — ⚠️ community catalog (ISRIC SoilGrids mirror)
// ---------------------------------------------------------------------------
var SOILGRIDS = {
  sand: 'projects/soilgrids-isric/sand_mean',
  clay: 'projects/soilgrids-isric/clay_mean',
  silt: 'projects/soilgrids-isric/silt_mean',
  soc:  'projects/soilgrids-isric/soc_mean'
};
function getSoilGrids(prop) {
  return verifyAsset(SOILGRIDS[prop], 'image', 'SoilGrids ' + prop, function () {
    throw 'No stated fallback for SoilGrids ' + prop + ' — see spec Part 1.1/W2. ' +
          'Do not silently substitute; source another texture product and document it.';
  });
}

// ---------------------------------------------------------------------------
// Rainfall
// ---------------------------------------------------------------------------
function getChirps() { return ee.ImageCollection('UCSB-CHG/CHIRPS/DAILY'); }          // ✅
function getImergMonthly() { return ee.ImageCollection('NASA/GPM_L3/IMERG_MONTHLY_V07'); } // ✅ cross-check

// ---------------------------------------------------------------------------
// Land cover
// ---------------------------------------------------------------------------
function getWorldCover() { return ee.ImageCollection('ESA/WorldCover/v200').first(); } // ✅
function getDynamicWorld(start, end, region) {
  return ee.ImageCollection('GOOGLE/DYNAMICWORLD/V1')
    .filterDate(start, end).filterBounds(region);                                     // ✅
}

// ---------------------------------------------------------------------------
// Optical / radar
// ---------------------------------------------------------------------------
function getSentinel2(start, end, region) {
  return ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterDate(start, end).filterBounds(region)
    .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 40));                             // ✅
}
function getSentinel1(start, end, region) {
  return ee.ImageCollection('COPERNICUS/S1_GRD')
    .filterDate(start, end).filterBounds(region)
    .filter(ee.Filter.eq('instrumentMode', 'IW'))
    .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'));         // ✅
}

// ---------------------------------------------------------------------------
// Surface water / structures
// ---------------------------------------------------------------------------
function getGsw() { return ee.Image('JRC/GSW1_4/GlobalSurfaceWater'); }               // ✅

// ---------------------------------------------------------------------------
// Vegetation trend inputs (W4)
// ---------------------------------------------------------------------------
function getLandsat8() { return ee.ImageCollection('LANDSAT/LC08/C02/T1_L2'); }        // ✅
function getLandsat7() { return ee.ImageCollection('LANDSAT/LE07/C02/T1_L2'); }        // ✅
function getModisNdvi() { return ee.ImageCollection('MODIS/061/MOD13Q1'); }            // ✅ alternative, consistent long record

// ---------------------------------------------------------------------------
// Groundwater context (regional narrative only — NOT a scoring input, see W13)
// ---------------------------------------------------------------------------
function getGrace() { return ee.ImageCollection('NASA/GRACE/MASS_GRIDS_V04/LAND'); }  // ⚠️ ~1-3 deg — report text only

// ---------------------------------------------------------------------------
// Tree cover (W11 exclusion)
// ---------------------------------------------------------------------------
function getHansenGfc() { return ee.Image('UMD/hansen/global_forest_change_2023_v1_11'); } // ✅

// ---------------------------------------------------------------------------
// PART 2 — externally derived assets (WhiteboxTools/SAGA/GRASS outputs).
// Fill these in with your real asset IDs once Part 2 preprocessing and the
// Part 2.2/2.3 validation are complete. Left as placeholders on purpose —
// calling code that needs one of these MUST fail, not silently substitute,
// because these layers have no in-GEE equivalent (Part 2 intro).
// ---------------------------------------------------------------------------
var EXTERNAL = {
  CONDITIONED_DEM:        'projects/YOUR_PROJECT/assets/m2_conditioned_dem',
  FLOW_DIRECTION_D8:      'projects/YOUR_PROJECT/assets/m2_flow_direction_d8',
  FLOW_ACCUMULATION_D8:   'projects/YOUR_PROJECT/assets/m2_flow_accumulation_d8',
  STREAM_NETWORK_RASTER:  'projects/YOUR_PROJECT/assets/m2_stream_network_raster',
  STREAM_ORDER_STRAHLER:  'projects/YOUR_PROJECT/assets/m2_stream_order_strahler',
  MICROWATERSHED_POLYGONS:'projects/YOUR_PROJECT/assets/m2_microwatersheds',
  STREAM_LINES:           'projects/YOUR_PROJECT/assets/m2_stream_lines',
  DOWNSLOPE_DIST_TO_STREAM:'projects/YOUR_PROJECT/assets/m2_downslope_dist_to_stream',
  DOWNSLOPE_FLOWPATH_LEN: 'projects/YOUR_PROJECT/assets/m2_downslope_flowpath_length',
  LS_FACTOR:              'projects/YOUR_PROJECT/assets/m2_ls_factor',
  IC_DUP:                 'projects/YOUR_PROJECT/assets/m2_ic_dup',       // optional: pre-computed Dup
  IC_DDN:                 'projects/YOUR_PROJECT/assets/m2_ic_ddn'       // optional: pre-computed Ddn
};

function requireExternal(key, kind) {
  var id = EXTERNAL[key];
  try {
    ee.data.getAsset(id);
  } catch (e) {
    throw 'MISSING EXTERNAL ASSET: ' + key + ' expected at ' + id + '. ' +
          'This layer has no GEE-native equivalent (Part 2). Run the WhiteboxTools ' +
          'pipeline in gee/external_preprocessing/whitebox_pipeline.py, upload the ' +
          'output, update EXTERNAL.' + key + ' in this file, and re-run. Refusing to ' +
          'proceed with a fabricated substitute.';
  }
  return kind === 'image' ? ee.Image(id)
       : kind === 'featureCollection' ? ee.FeatureCollection(id)
       : ee.Image(id);
}

// ---------------------------------------------------------------------------
// Forest jurisdiction boundary (Part 1.3 reporting-stage flag)
// ---------------------------------------------------------------------------
function getJurisdictionBoundary() {
  return verifyAsset(config.JURISDICTION_BOUNDARY_ASSET, 'featureCollection',
    'Forest Dept beat boundary (jurisdiction flag)', function () {
      print('⚠ Jurisdiction boundary asset unavailable — jurisdiction flagging ' +
            '(Part 1.3) and the Forest-land W11 mask will be skipped this run.');
      return null;
    });
}

exports.verifyAsset = verifyAsset;
exports.getDem = getDem;
exports.getMeritHydro = getMeritHydro;
exports.getHand = getHand;
exports.getAw3d30 = getAw3d30;
exports.getSoilGrids = getSoilGrids;
exports.getChirps = getChirps;
exports.getImergMonthly = getImergMonthly;
exports.getWorldCover = getWorldCover;
exports.getDynamicWorld = getDynamicWorld;
exports.getSentinel2 = getSentinel2;
exports.getSentinel1 = getSentinel1;
exports.getGsw = getGsw;
exports.getLandsat8 = getLandsat8;
exports.getLandsat7 = getLandsat7;
exports.getModisNdvi = getModisNdvi;
exports.getGrace = getGrace;
exports.getHansenGfc = getHansenGfc;
exports.EXTERNAL = EXTERNAL;
exports.requireExternal = requireExternal;
exports.getJurisdictionBoundary = getJurisdictionBoundary;
