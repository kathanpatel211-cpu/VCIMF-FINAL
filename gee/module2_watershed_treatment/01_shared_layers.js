/**
 * 01_shared_layers.js — Part 8.1 "shared layers, compute once"
 *
 * This is the canonical source for every layer Module 1 (plantation
 * suitability) and Module 2 (this module) both need: DEM/slope, SoilGrids
 * properties, CHIRPS rainfall + R-factor, WorldCover/Dynamic World, Sentinel-2
 * composites, HAND, RUSLE K/C/LS inputs, bare-rock index.
 *
 * Module 1 does not exist yet in this repository. When it is built, it must
 * `require()` this file rather than reimplementing any of these layers —
 * divergent versions of the same layer between the two modules is the most
 * likely source of an embarrassing inconsistency at review (Part 8.1).
 */

var config = require('users/<you>/VCIMF-FINAL:gee/module2_watershed_treatment/00_config.js');
var assets = require('users/<you>/VCIMF-FINAL:gee/module2_watershed_treatment/02_external_assets.js');

// ---------------------------------------------------------------------------
// DEM + slope — always reprojected to EPSG:32643 before any slope/area/LS
// computation (Part 1: "Mandatory for slope, flow length, area and RUSLE LS").
// ---------------------------------------------------------------------------
function getDemUtm(region) {
  var demRaw = assets.getDem();
  var dem = ee.Image(demRaw).reproject({crs: config.CRS, scale: config.SCALE});
  return region ? dem.clip(region) : dem;
}

function getSlopeDegrees(region) {
  var dem = getDemUtm(region);
  return ee.Terrain.slope(dem);           // degrees, computed on the UTM-reprojected DEM
}

function getSlopePercent(region) {
  var slopeDeg = getSlopeDegrees(region);
  return slopeDeg.multiply(Math.PI / 180).tan().multiply(100).rename('slope_pct');
}

// ---------------------------------------------------------------------------
// Soil texture (SoilGrids, 250 m, resampled to 30 m — note the resolution
// mismatch honestly wherever texture-derived layers are reported, per Part 10.4).
// ---------------------------------------------------------------------------
function getSoilTexture(region) {
  var sand = assets.getSoilGrids('sand').divide(10).rename('sand_pct'); // SoilGrids g/kg -> %
  var clay = assets.getSoilGrids('clay').divide(10).rename('clay_pct');
  var silt = assets.getSoilGrids('silt').divide(10).rename('silt_pct');
  var soc  = assets.getSoilGrids('soc').divide(10).rename('soc_pct');   // dg/kg -> %
  var img = sand.addBands(clay).addBands(silt).addBands(soc);
  return region ? img.clip(region) : img;
}

// ---------------------------------------------------------------------------
// Soil-depth proxy composite ("Module 1 C6 composite depth index" equivalent).
// Built here — not in Module 1 — because Module 1 does not exist in this
// repo yet. Combines slope position, relief and a bare-rock proxy; label it
// a proxy everywhere it is used (Part 10.4).
// ---------------------------------------------------------------------------
function getSoilDepthProxy(region) {
  var dem = getDemUtm(region);
  var slopePct = getSlopePercent(region);
  var tpi = dem.subtract(dem.focalMean(5, 'circle', 'pixels')).rename('tpi'); // + = ridge, - = valley
  // Deeper soils expected on gentler slopes and in valley (negative TPI) positions.
  var depthProxy = ee.Image(1)
    .subtract(slopePct.unitScale(0, 60).clamp(0, 1))
    .multiply(0.6)
    .add(tpi.unitScale(-10, 10).clamp(0, 1).multiply(-1).add(1).multiply(0.4))
    .rename('soil_depth_proxy');
  return region ? depthProxy.clip(region) : depthProxy;
}

// Bare-rock index — same proxy used in W3, W11 exclusions, and W13 lineament work.
function getBareRockIndex(s2Composite) {
  // Simple SWIR/NIR/visible ratio proxy for exposed rock vs soil/vegetation;
  // label as a proxy, validate against imagery in the hill talukas.
  var b = s2Composite;
  return b.expression(
    '(SWIR1 - NIR) / (SWIR1 + NIR + 1e-6)',
    {SWIR1: b.select('B11'), NIR: b.select('B8')}
  ).rename('bare_rock_index');
}

// ---------------------------------------------------------------------------
// RUSLE factors — shared with Module 1 C11 / Module 2 W2. Compute once.
// ---------------------------------------------------------------------------

// R-factor: CHIRPS annual rainfall through a published Indian regional
// regression. NO COEFFICIENTS ARE INVENTED HERE (spec: "do not invent
// coefficients"). Wire in the cited regression before use.
function getRFactor(region, startYear, endYear) {
  var chirps = assets.getChirps()
    .filterDate(startYear + '-01-01', (endYear + 1) + '-01-01')
    .filterBounds(region);
  var annualP = ee.ImageCollection(
    ee.List.sequence(startYear, endYear).map(function (y) {
      y = ee.Number(y);
      return chirps.filterDate(
        ee.Date.fromYMD(y, 1, 1), ee.Date.fromYMD(y.add(1), 1, 1)
      ).sum().set('year', y);
    })
  );
  var meanAnnualP = annualP.mean().rename('mean_annual_rainfall_mm');
  print('⚠ R-FACTOR REGRESSION NOT YET WIRED: getRFactor() currently returns ' +
        'mean annual rainfall only. Apply a cited Indian regional R = f(P) ' +
        'regression (e.g. a published Sabarmati/Gujarat-region relation) before ' +
        'using this as the RUSLE R factor. Do not invent coefficients (spec Part W2).');
  return meanAnnualP.clip(region);
}

// K-factor: Williams (EPIC) equation from SoilGrids texture + SOC.
function getKFactorEpic(region) {
  var tex = getSoilTexture(region);
  var sand = tex.select('sand_pct');
  var silt = tex.select('silt_pct');
  var clay = tex.select('clay_pct');
  var soc = tex.select('soc_pct');
  var SN1 = ee.Image(1).subtract(sand.divide(100));
  var orgC = soc; // already expressed as % organic carbon

  var fCsand = ee.Image(0.2).add(
    ee.Image(0.3).multiply(
      ee.Image(-0.0256).multiply(sand).multiply(SN1.subtract(1).multiply(-1)).exp()
    )
  );
  // Williams EPIC K (US customary, converted to SI via 0.1317 in the caller if reporting t.ha.h/(ha.MJ.mm))
  var fClSi = silt.divide(clay.add(silt)).pow(0.3);
  var fOrgC = ee.Image(1).subtract(
    ee.Image(0.25).multiply(orgC).divide(
      orgC.add(ee.Image(Math.E).pow(ee.Image(3.72).subtract(orgC.multiply(2.95))))
    )
  );
  var fHisand = ee.Image(1).subtract(
    ee.Image(0.7).multiply(SN1).divide(
      SN1.add(ee.Image(Math.E).pow(ee.Image(-5.51).add(ee.Image(22.9).multiply(SN1))))
    )
  );
  var K = fCsand.multiply(fClSi).multiply(fOrgC).multiply(fHisand).rename('k_factor');
  return K.multiply(0.1317).rename('k_factor'); // convert to SI t.ha.h / (ha.MJ.mm)
}

// C-factor: WorldCover lookup (state the lookup values used and cite them).
var WORLDCOVER_C_LOOKUP = {
  10: 0.001,  // Tree cover
  20: 0.05,   // Shrubland
  30: 0.03,   // Grassland
  40: 0.30,   // Cropland — highly variable by season; refine with NDVI if possible
  50: 0.0,    // Built-up
  60: 0.45,   // Bare / sparse vegetation
  70: 0.0,    // Snow/ice — not present in study area
  80: 0.0,    // Water
  90: 0.10,   // Herbaceous wetland
  95: 0.10,   // Mangroves — not present in study area
  100: 0.05   // Moss/lichen
};
// PLACEHOLDER lookup values pending a cited regional table — flagged, not hidden.
function getCFactorWorldCover(region) {
  print('⚠ C-FACTOR LOOKUP IS A PLACEHOLDER TABLE (WORLDCOVER_C_LOOKUP in ' +
        '01_shared_layers.js). Replace with a cited regional lookup (e.g. from ' +
        'published RUSLE studies in Gujarat/Aravalli) before reporting absolute ' +
        'soil-loss figures.');
  var wc = assets.getWorldCover().clip(region);
  var c = ee.Image(0);
  Object.keys(WORLDCOVER_C_LOOKUP).forEach(function (code) {
    c = c.where(wc.eq(ee.Image.constant(parseInt(code, 10))), WORLDCOVER_C_LOOKUP[code]);
  });
  return c.rename('c_factor');
}

// P-factor: 1.0 unless conservation structures are mapped (they are not, at present).
function getPFactor(region) {
  return ee.Image(1.0).rename('p_factor').clip(region);
}

exports.getDemUtm = getDemUtm;
exports.getSlopeDegrees = getSlopeDegrees;
exports.getSlopePercent = getSlopePercent;
exports.getSoilTexture = getSoilTexture;
exports.getSoilDepthProxy = getSoilDepthProxy;
exports.getBareRockIndex = getBareRockIndex;
exports.getRFactor = getRFactor;
exports.getKFactorEpic = getKFactorEpic;
exports.getCFactorWorldCover = getCFactorWorldCover;
exports.getPFactor = getPFactor;
exports.WORLDCOVER_C_LOOKUP = WORLDCOVER_C_LOOKUP;
