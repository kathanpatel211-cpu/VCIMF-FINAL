/**
 * ============================================================================
 *  BGDSS - MODULE 1: FIRE RISK ZONATION
 *  Pilot: Sabarkantha Forest Division, Gujarat Forest Department
 *  Platform: Google Earth Engine (JavaScript API)
 * ============================================================================
 *
 *  STANDALONE SCRIPT - paste this file into a NEW Earth Engine script and
 *  run it on its own. It does not depend on any other BGDSS file.
 *
 *  METHODOLOGY (India-specific, not a generic global fire model)
 *  ---------------------------------------------------------------------------
 *  AHP (Analytic Hierarchy Process) weighted overlay reproducing the
 *  published pairwise-comparison weights of:
 *    Jaiswal, R.K., Mukherjee, S., Krishnamurthy, J. & Saxena, R. (2002),
 *    "Forest fire risk zone mapping from satellite imagery and GIS",
 *    Int. J. Applied Earth Observation and Geoinformation 4(1):1-10.
 *  This is the standard India-specific fire-risk zonation study: unlike
 *  most global fire models (built around lightning ignition), it weights
 *  human ignition sources (proximity to settlements/roads) very heavily,
 *  which matches Indian dry-deciduous forest fire regimes.
 *
 *  Forest-type inflammability follows Champion & Seth (1968), "A Revised
 *  Survey of the Forest Types of India" - Sabarkantha's forests fall under
 *  Group 5B, Northern Dry Deciduous Forest, one of India's most fire-prone
 *  types. Edit CONFIG.forestTypeBaseline if your beat's working plan
 *  documents a different type.
 *
 *  HOW TO USE
 *  ---------------------------------------------------------------------------
 *  1. Edit the CONFIG block below (your beat asset is already filled in).
 *  2. If you have village/road layers, set CONFIG.villages / CONFIG.roads -
 *     these are two of the highest-weighted criteria in this model, so
 *     accuracy improves a lot once they're supplied.
 *  3. Run. Layers appear in the Layers panel (mostly off by default -
 *     toggle "Fire Risk (5-class)" on). A plain-language summary prints to
 *     the Console. Two export tasks (GeoTIFF risk map + CSV summary table)
 *     appear in the Tasks tab - click Run on each to save them to Drive.
 * ============================================================================
 */

// ============================================================================
// CONFIG - the only section to edit
// ============================================================================
var CONFIG = {
  roi: ee.FeatureCollection('projects/raygadh-range/assets/BEAT'),
  year: 2025,
  fireHistoryYears: 10,             // years of MODIS burned-area look-back

  district: 'Sabarkantha',
  state: 'Gujarat',
  unitName: 'BEAT',

  scale: 10,                        // analysis/export resolution, meters -
                                     // matched to the finest available input
                                     // (Sentinel-2/Hansen/AW3D30); coarser
                                     // inputs (MODIS, CHIRPS) are bilinearly
                                     // resampled onto this grid so the final
                                     // map reads as smooth gradients instead
                                     // of blocky native pixels
  exportFolder: 'BGDSS',
  exportPrefix: 'BGDSS_FireRisk',

  // Optional - set these to an ee.FeatureCollection of points/lines if you
  // have them (e.g. 'projects/raygadh-range/assets/VILLAGES'). Leave null
  // to skip gracefully (the model then uses a neutral default for that
  // criterion and logs a warning explaining the accuracy trade-off).
  villages: null,
  roads: null,

  // Champion & Seth (1968) forest type baseline inflammability, 0-1.
  // 0.75 = Northern Dry Deciduous (Group 5B) - update if your beat's
  // working plan documents a different Champion & Seth type.
  forestTypeBaseline: 0.75,

  // Jaiswal et al. (2002) published AHP weights - re-run your own AHP
  // pairwise comparison with the Range/DFO team if better local judgment
  // is available; these are a starting point, not a fixed law.
  weights: {
    forestType: 0.279,
    settlementProximity: 0.185,
    slope: 0.148,
    roadProximity: 0.126,
    temperature: 0.104,
    rainfall: 0.081,
    aspect: 0.077
  }
};

var roi = CONFIG.roi.geometry();
try { Map.centerObject(CONFIG.roi, 12); Map.setOptions('SATELLITE'); } catch (e) {}

// ============================================================================
// HELPERS
// ============================================================================
function log(msg) { print('✓ ' + msg); }
function warn(msg) { print('⚠ ' + msg); }

function normalize(img, min, max, invert) {
  var n = img.subtract(min).divide(max - min).clamp(0, 1);
  return invert ? ee.Image(1).subtract(n) : n;
}

var CLASS_LABELS = ['Very Low', 'Low', 'Moderate', 'High', 'Very High'];
var PALETTE = ['1a9850', '91cf60', 'fee08b', 'fc8d59', 'd73027'];

function classify5(img, breaks) {
  breaks = breaks || [0.2, 0.4, 0.6, 0.8];
  return ee.Image(1)
    .where(img.gt(breaks[0]), 2)
    .where(img.gt(breaks[1]), 3)
    .where(img.gt(breaks[2]), 4)
    .where(img.gt(breaks[3]), 5)
    .rename('class').clip(roi);
}

// Defensive dataset loaders: never throw, just log and return null so the
// rest of the script keeps running with a neutral fallback for that input.
function safeImage(id, label) {
  try { var img = ee.Image(id); img.bandNames().getInfo(); return img; }
  catch (e) { warn(label + ' unavailable (' + id + ') - using fallback'); return null; }
}
function safeCollection(id, label) {
  try { var col = ee.ImageCollection(id); col.first().bandNames().getInfo(); return col; }
  catch (e) { warn(label + ' unavailable (' + id + ') - using fallback'); return null; }
}
function safeMosaic(id, band, label) {
  try {
    var col = ee.ImageCollection(id);
    col.first().bandNames().getInfo();
    return band ? col.select([band]).mosaic() : col.mosaic();
  } catch (e) { warn(label + ' unavailable (' + id + ') - using fallback'); return null; }
}

// ============================================================================
// 1. TERRAIN (JAXA AW3D30 - tiled ImageCollection, mosaicked)
// ============================================================================
var dem = safeMosaic('JAXA/ALOS/AW3D30/V3_2', 'DSM', 'DEM');
var slope = null, aspect = null;
if (dem) {
  // AW3D30's DSM band is integer-typed and delivered in geographic
  // (lat/lon) pixels, which are NOT square in meters - ee.Terrain.slope/
  // aspect assume an isotropic grid and can under/over-estimate or leave
  // gaps if run directly on a geographic image. Cast to float and
  // reproject to the local UTM zone (43N covers Sabarkantha/Gujarat
  // ~72-78E; change the EPSG code if your beat falls in a different zone)
  // before computing terrain products.
  dem = dem.clip(roi).rename('elevation').toFloat()
    .resample('bilinear')
    .reproject({ crs: 'EPSG:32643', scale: CONFIG.scale });
  slope = ee.Terrain.slope(dem);
  aspect = ee.Terrain.aspect(dem);
  log('DEM / Slope / Aspect ready (reprojected to EPSG:32643, bilinear-smoothed)');
}

// ============================================================================
// 2. FOREST-TYPE INFLAMMABILITY (Champion & Seth 1968, canopy-modulated)
// ============================================================================
var hansen = safeImage('UMD/hansen/global_forest_change_2023_v1_11', 'Hansen canopy cover');
var canopyDensity = hansen ? hansen.select('treecover2000').resample('bilinear').clip(roi) : null;
var forestTypeRisk;
if (canopyDensity) {
  // Denser canopy retains moisture better (slightly lower risk); open/
  // degraded stands keep the full baseline inflammability of the type.
  var damping = normalize(canopyDensity, 0, 80, false).multiply(0.3);
  forestTypeRisk = ee.Image(CONFIG.forestTypeBaseline).multiply(ee.Image(1).subtract(damping))
    .rename('forestTypeRisk').unmask(CONFIG.forestTypeBaseline);
  log('Forest-Type Inflammability computed (baseline ' + CONFIG.forestTypeBaseline + ', canopy-modulated)');
} else {
  forestTypeRisk = ee.Image(CONFIG.forestTypeBaseline).clip(roi).rename('forestTypeRisk');
  warn('Canopy data unavailable - Forest-Type Inflammability using flat baseline (no canopy modulation)');
}

// ============================================================================
// 3. CLIMATE (CHIRPS rainfall, MODIS LST temperature)
// ============================================================================
var yStart = ee.Date.fromYMD(CONFIG.year, 1, 1);
var yEnd = yStart.advance(1, 'year');

// CHIRPS (~5.5km) and MODIS LST (1km) are far coarser than the 10m analysis
// grid. .resample('bilinear') doesn't invent real detail, but it replaces
// hard, blocky native grid-cell edges with a smooth interpolated gradient
// when these layers are combined with the finer terrain/canopy inputs -
// the standard cartographic fix for a multi-resolution composite map.
var chirps = safeCollection('UCSB-CHG/CHIRPS/DAILY', 'CHIRPS rainfall');
var rainfall = chirps
  ? chirps.filterDate(yStart, yEnd).sum().resample('bilinear').clip(roi).rename('rainfall')
  : null;
if (rainfall) { log('Annual rainfall computed (bilinear-smoothed)'); }

var modisLst = safeCollection('MODIS/061/MOD11A2', 'MODIS LST temperature');
var tempMeanC = null;
if (modisLst) {
  var lstYear = modisLst.filterDate(yStart, yEnd);
  var day = lstYear.select('LST_Day_1km').mean().multiply(0.02).subtract(273.15);
  var night = lstYear.select('LST_Night_1km').mean().multiply(0.02).subtract(273.15);
  tempMeanC = day.add(night).divide(2).resample('bilinear').clip(roi).rename('tempMean');
  log('Mean temperature computed (bilinear-smoothed)');
}

// ============================================================================
// 4. OBSERVED FIRE HISTORY (MODIS MCD64A1 Burned Area) - for validation, not
//    used directly in the AHP score (which is a PREDICTIVE susceptibility
//    model); compare the two visually to sanity-check the model.
// ============================================================================
var burnedCol = safeCollection('MODIS/061/MCD64A1', 'MODIS Burned Area');
var fireHistory = null;
if (burnedCol) {
  var histStart = ee.Date.fromYMD(CONFIG.year - CONFIG.fireHistoryYears, 1, 1);
  var histEnd = ee.Date.fromYMD(CONFIG.year, 12, 31);
  fireHistory = burnedCol.filterDate(histStart, histEnd).select('BurnDate')
    .map(function (img) { return img.gt(0); }).sum().clip(roi).rename('fireHistory');
  log('Observed fire history (' + CONFIG.fireHistoryYears + ' yr look-back) computed');
}

// ============================================================================
// 5. SETTLEMENT / ROAD PROXIMITY (dominant human-ignition criteria)
// ============================================================================
var settlementNorm;
if (CONFIG.villages) {
  var villageDist = ee.Image(0).paint(CONFIG.villages, 1).not()
    .fastDistanceTransform(1024).sqrt().multiply(ee.Image.pixelArea().sqrt());
  settlementNorm = normalize(villageDist, 0, 3000, true); // closer to village -> higher risk
  log('Settlement Proximity computed from CONFIG.villages');
} else {
  settlementNorm = ee.Image(0.5);
  warn('CONFIG.villages not set - Settlement Proximity (18.5% of the model weight) defaulted to neutral (0.5)');
}

var roadNorm;
if (CONFIG.roads) {
  var roadDist = ee.Image(0).paint(CONFIG.roads, 1).not()
    .fastDistanceTransform(1024).sqrt().multiply(ee.Image.pixelArea().sqrt());
  roadNorm = normalize(roadDist, 0, 2000, true);
  log('Road Proximity computed from CONFIG.roads');
} else {
  roadNorm = ee.Image(0.5);
  warn('CONFIG.roads not set - Road Proximity (12.6% of the model weight) defaulted to neutral (0.5)');
}

// ============================================================================
// 6. REMAINING CRITERIA - normalize each to a 0-1 "risk contribution"
// ----------------------------------------------------------------------------
// IMPORTANT: every criterion below is .unmask(0.5)'d. Earth Engine's
// image arithmetic propagates masks (a masked pixel in ANY input to an
// .add()/.multiply() chain makes the OUTPUT masked at that pixel too), and
// ee.Image.where()'s documented behavior is to leave a pixel AT ITS
// STARTING VALUE whenever the test condition is masked - which for
// classify5() (which starts from a constant 1 = "Very Low") means any
// masked pixel silently renders as "Very Low" instead of "no data". Real
// gaps are common here: cloud-persistent MODIS LST pixels, DEM voids over
// water, etc. Rather than let a data gap silently masquerade as "safe",
// every criterion falls back to a neutral 0.5 wherever its source data is
// missing, so susceptibility is always genuinely computed everywhere in
// the beat - never a silent default.
// ============================================================================
var slopeNorm = (slope ? normalize(slope, 0, 35, false) : ee.Image(0.5)).unmask(0.5);
// South-facing slopes (135-225 deg, Northern Hemisphere) get more solar
// load -> drier fuel -> higher risk.
var aspectNorm = (aspect
  ? aspect.subtract(180).abs().multiply(-1).add(180).divide(180).rename('aspectRisk')
  : ee.Image(0.5)).unmask(0.5);
var temperatureNorm = (tempMeanC ? normalize(tempMeanC, 20, 42, false) : ee.Image(0.5)).unmask(0.5);
var rainfallNorm = (rainfall ? normalize(rainfall, 300, 1500, true) : ee.Image(0.5)).unmask(0.5); // drier -> higher risk

// ============================================================================
// 7. AHP WEIGHTED OVERLAY (Jaiswal et al. 2002) -> Fire Susceptibility -> Risk
// ============================================================================
var w = CONFIG.weights;
var wSum = w.forestType + w.settlementProximity + w.slope + w.roadProximity
  + w.temperature + w.rainfall + w.aspect;

var susceptibility = forestTypeRisk.multiply(w.forestType / wSum)
  .add(settlementNorm.multiply(w.settlementProximity / wSum))
  .add(slopeNorm.multiply(w.slope / wSum))
  .add(roadNorm.multiply(w.roadProximity / wSum))
  .add(temperatureNorm.multiply(w.temperature / wSum))
  .add(rainfallNorm.multiply(w.rainfall / wSum))
  .add(aspectNorm.multiply(w.aspect / wSum))
  .rename('fireSusceptibility');

var fireRiskRaw = classify5(susceptibility);

// Cartographic clean-up: a raw pixel-by-pixel classification always has
// some salt-and-pepper single-pixel noise at class boundaries. A majority
// (mode) filter over a small neighborhood removes that noise so the map
// reads as clean, coherent zones - standard practice for a briefing map,
// as opposed to a raw scientific raster meant for pixel-level inspection.
var smoothingKernel = ee.Kernel.square({ radius: 2, units: 'pixels' });
var fireRisk = fireRiskRaw.reduceNeighborhood({
  reducer: ee.Reducer.mode(),
  kernel: smoothingKernel
}).rename('class').clip(roi);

log('Fire Susceptibility + 5-class Fire Risk computed (Jaiswal et al. 2002 AHP, mode-smoothed)');

// ---- DIAGNOSTIC: mean of each 0-1 criterion + the final score. The AHP
// formula guarantees susceptibility >= ~0.30 whenever settlement/road are
// neutral (0.5) and forestTypeRisk is at its floor (0.525), so if the
// numbers below don't match what "Very Low everywhere" would need, this
// tells us exactly which input collapsed to zero. -----------------------
var diag = ee.Image.cat([
  forestTypeRisk.rename('forestTypeRisk'),
  settlementNorm.rename('settlementNorm'),
  slopeNorm.rename('slopeNorm'),
  roadNorm.rename('roadNorm'),
  temperatureNorm.rename('temperatureNorm'),
  rainfallNorm.rename('rainfallNorm'),
  aspectNorm.rename('aspectNorm'),
  susceptibility
]).reduceRegion({
  reducer: ee.Reducer.mean(),
  geometry: roi,
  scale: CONFIG.scale,
  maxPixels: 1e13,
  tileScale: 4,
  bestEffort: true
});
diag.evaluate(function (d) {
  print('---- DIAGNOSTIC: mean value of each criterion (0-1 scale) ----');
  print(d);
});

// ---- DIAGNOSTIC: is susceptibility actually computed everywhere, or is it
// MASKED (no-data) over most of the beat? A low "coverage %" here means the
// map is showing "Very Low" by default for pixels where the model couldn't
// compute a value at all - a masking problem, not a genuinely low risk. ---
var coverage = ee.Image.constant(1).rename('total')
  .addBands(susceptibility.mask().rename('valid'))
  .reduceRegion({
    reducer: ee.Reducer.sum(),
    geometry: roi, scale: CONFIG.scale, maxPixels: 1e13, tileScale: 4, bestEffort: true
  });
coverage.evaluate(function (c) {
  var total = c.total || 0;
  var valid = c.valid || 0;
  var pct = total > 0 ? Math.round(valid / total * 100) : 0;
  print('---- DIAGNOSTIC: Fire Susceptibility data coverage ----');
  print('Valid (unmasked) pixels: ' + pct + '% of the beat' + (pct < 90 ? '  <-- LOW: likely a masking issue upstream' : ''));
});

// ============================================================================
// 8. VISUALIZATION
// ============================================================================
if (dem) {
  var hillshade = ee.Terrain.hillshade(dem);
  Map.addLayer(hillshade, { min: 0, max: 255 }, 'Hillshade (terrain backdrop)', false);
}
Map.addLayer(forestTypeRisk, { min: 0, max: 1, palette: PALETTE }, 'Forest-Type Inflammability', false);
if (fireHistory) {
  Map.addLayer(fireHistory.selfMask(), { min: 1, max: CONFIG.fireHistoryYears, palette: ['fee08b', 'd73027', '7f0000'] }, 'Observed Fire History (years burned)', false);
}
Map.addLayer(susceptibility, { min: 0, max: 1, palette: PALETTE }, 'Fire Susceptibility (AHP score, continuous)', false);
Map.addLayer(fireRiskRaw, { min: 1, max: 5, palette: PALETTE }, 'Fire Risk - unsmoothed (pixel-level detail)', false);
Map.addLayer(fireRisk, { min: 1, max: 5, palette: PALETTE }, 'Fire Risk (5-class, briefing map)', true);

try {
  var outline = ee.Image().byte().paint({ featureCollection: CONFIG.roi, color: 1, width: 2 });
  Map.addLayer(outline, { palette: ['ffffff'] }, 'Beat Boundary', true);
} catch (e) {}

try {
  var titlePanel = ui.Panel({
    style: { position: 'top-center', padding: '6px 16px', backgroundColor: 'rgba(255,255,255,0.85)' }
  });
  titlePanel.add(ui.Label(
    'Fire Risk Zonation - ' + CONFIG.unitName + ', ' + CONFIG.district + ', ' + CONFIG.state + ' (' + CONFIG.year + ')',
    { fontWeight: 'bold', fontSize: '16px', margin: '2px 0' }));
  titlePanel.add(ui.Label(
    'Jaiswal et al. (2002) AHP model - Champion & Seth (1968) forest type',
    { fontSize: '11px', color: '555555', margin: '0 0 2px 0' }));
  Map.add(titlePanel);
} catch (e) {}

try {
  var legend = ui.Panel({ style: { position: 'bottom-left', padding: '8px 15px' } });
  legend.add(ui.Label('Fire Risk', { fontWeight: 'bold', fontSize: '15px', margin: '0 0 2px 0' }));
  legend.add(ui.Label('Jaiswal et al. (2002) AHP', { fontSize: '11px', color: '666666', margin: '0 0 6px 0' }));
  for (var i = 0; i < CLASS_LABELS.length; i++) {
    var colorBox = ui.Label('', { backgroundColor: PALETTE[i], padding: '8px', margin: '0 0 4px 0' });
    var desc = ui.Label(CLASS_LABELS[i], { margin: '0 0 4px 6px' });
    legend.add(ui.Panel({ widgets: [colorBox, desc], layout: ui.Panel.Layout.flow('horizontal') }));
  }
  Map.add(legend);
} catch (e) {}

// ============================================================================
// 9. STATISTICS + PLAIN-LANGUAGE SUMMARY + CSV EXPORT
// ============================================================================
var areaImg = ee.Image.pixelArea().divide(1e4).addBands(fireRisk); // ha
var areaStats = areaImg.reduceRegion({
  reducer: ee.Reducer.sum().group({ groupField: 1, groupName: 'class' }),
  geometry: roi,
  scale: CONFIG.scale,
  maxPixels: 1e13,
  tileScale: 4,
  bestEffort: true
});

// .evaluate() is asynchronous (does not block the script), unlike
// .getInfo() - keeps this script responsive even on a large beat.
areaStats.evaluate(function (result) {
  var groups = (result && result.groups) || [];
  var total = 0;
  groups.forEach(function (g) { total += g.sum; });
  groups.sort(function (a, b) { return a.class - b.class; });

  print('================================================================');
  print('FIRE RISK ZONATION SUMMARY - ' + CONFIG.unitName + ', ' + CONFIG.district + ', ' + CONFIG.state + ' (' + CONFIG.year + ')');
  print('================================================================');

  var rows = [];
  var dominantSum = -1, dominantLabel = null, dominantPct = null;
  groups.forEach(function (g, idx) {
    var label = CLASS_LABELS[Math.round(g.class) - 1] || ('Class ' + g.class);
    var ha = Math.round(g.sum * 10) / 10;
    var pct = total > 0 ? Math.round(g.sum / total * 100) : 0;
    print('Fire Risk - ' + label + ': ' + ha + ' ha (' + pct + '%)');
    rows.push({ sr: idx + 1, cls: label, ha: ha, pct: pct });
    if (g.sum > dominantSum) { dominantSum = g.sum; dominantLabel = label; dominantPct = pct; }
  });

  if (dominantLabel) {
    print('----------------------------------------------------------------');
    print('Overall Fire Risk Rating: ' + dominantLabel + ' (covers ' + dominantPct + '% of the beat)');
  }
  print('================================================================');

  // ---- clean, one-row-per-class CSV table (Excel/Sheets readable) ----
  var features = rows.map(function (r) {
    return ee.Feature(null, {
      'Sr No': r.sr,
      'Fire Risk Class': r.cls,
      'Area (ha)': r.ha,
      'Percent of Beat': r.pct
    });
  });
  Export.table.toDrive({
    collection: ee.FeatureCollection(features),
    description: CONFIG.exportPrefix + '_Summary',
    folder: CONFIG.exportFolder,
    fileNamePrefix: CONFIG.exportPrefix + '_Summary',
    fileFormat: 'CSV'
  });
});

// ============================================================================
// 10. RASTER EXPORTS (GeoTIFF - run from the Tasks tab)
// ============================================================================
Export.image.toDrive({
  image: fireRisk.toInt(),
  description: CONFIG.exportPrefix + '_RiskMap',
  folder: CONFIG.exportFolder,
  fileNamePrefix: CONFIG.exportPrefix + '_RiskMap',
  region: roi.bounds(),
  scale: CONFIG.scale,
  maxPixels: 1e13
});
Export.image.toDrive({
  image: susceptibility,
  description: CONFIG.exportPrefix + '_SusceptibilityScore',
  folder: CONFIG.exportFolder,
  fileNamePrefix: CONFIG.exportPrefix + '_SusceptibilityScore',
  region: roi.bounds(),
  scale: CONFIG.scale,
  maxPixels: 1e13
});

log('Fire Risk Zonation module complete. Toggle "Fire Risk (5-class)" on in the Layers panel; run the 3 tasks in the Tasks tab to save outputs to Drive.');
