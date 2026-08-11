/**
 * PROPOSED WATERSHED TREATMENT & STREAM ENGINEERING PLAN
 * KUPPANUR WATERSHED — CATCHMENT A
 *
 * Google Earth Engine (Code Editor, JavaScript) script.
 *
 * PURPOSE
 * This script produces a location / planning map for ~14 proposed gully-plugging
 * and stream-engineering interventions supplied by the user (GPS-surveyed
 * coordinates). It shows WHERE the interventions are, WHAT type of work is
 * proposed at each location, and their relationship to the drainage network,
 * the existing surveyed gully-training layer, and the surrounding terrain.
 *
 * It does NOT assign priority, risk, suitability, or ranking scores, and it
 * does NOT fabricate any structural dimensions (dam height, wall length, apron
 * size, discharge, design flood, etc.). Those must come from a separate
 * structural design exercise.
 *
 * Run this script in https://code.earth.google.com (Code Editor). Paste the
 * whole file into a new script and click "Run".
 *
 * ---------------------------------------------------------------------------
 * CODE MAP
 *   01 — PROJECT CONFIGURATION
 *   02 — INTERVENTION DATA
 *   03 — USER ASSETS
 *   04 — SATELLITE BASEMAP
 *   05 — DEM
 *   06 — HILLSHADE
 *   07 — CONTOURS
 *   08 — HYDROLOGY / DRAINAGE
 *   09 — GULLY TRAINING ASSET
 *   10 — PROPOSED INTERVENTIONS
 *   11 — INTERVENTION SYMBOLS
 *   12 — LABELS
 *   13 — LEGEND
 *   14 — MAP VIEW
 *   15 — INTERVENTION TABLE
 *   16 — EXPORTS
 * ---------------------------------------------------------------------------
 */

// =============================================================================
// 01 — PROJECT CONFIGURATION
// Everything a user is likely to need to change lives in this section.
// =============================================================================

var projectName    = 'KUPPANUR WATERSHED';
var catchmentName  = 'CATCHMENT A';
var mapTitle       = 'PROPOSED WATERSHED TREATMENT & STREAM ENGINEERING PLAN';

// --- DEM -------------------------------------------------------------------
// Public 30 m SRTM DEM used for hillshade, contours and the local drainage
// derivation below. Replace with a project-specific DEM asset ID if/when one
// is supplied (keep demBandName in sync with that asset's elevation band).
var demAssetId  = 'USGS/SRTMGL1_003';
var demBandName = 'elevation';

// --- Terrain derivatives -----------------------------------------------------
var contourInterval = 10;     // metres, per spec section 4 default
var hillshadeAzimuth = 315;   // degrees
var hillshadeElevation = 45;  // degrees
var hillshadeOpacity = 0.30;  // kept subtle — reveals terrain form without competing with imagery

// --- Local analysis extent --------------------------------------------------
// The intervention cluster spans only ~350 m. Hillshade / contours / drainage
// are computed over a small buffer around it (not the whole SRTM tile) so the
// map stays focused on local context and the drainage computation below stays
// fast and reliable.
var aoiBufferMeters = 450; // metres, buffer around the intervention bounding box

// --- Drainage / stream extraction ------------------------------------------
// See section 08 for the full derivation. These two values are the only
// "knobs" a user should need to turn to tune the extracted stream network.
var flowAccumIterations = 45;        // propagation steps of the local D8 accumulation
var streamAccumThresholdKm2 = 0.01;  // upstream contributing area (km^2) that qualifies as "stream"

// --- Satellite basemap -------------------------------------------------------
var sentinel2StartDate = '2023-01-01';
var sentinel2EndDate   = '2026-08-11';
var cloudScoreThreshold = 0.60; // Cloud Score+ 'cs_cdf' band, higher = stricter (clearer) pixels only

// --- User assets --------------------------------------------------------------
var gullyTrainingAssetId = 'projects/raygadh-range/assets/gully_tr';
// Set to a Catchment A boundary FeatureCollection asset ID once one is
// supplied. Leave null until then — no catchment boundary is fabricated.
var catchmentAssetId = null;

// --- Labels ------------------------------------------------------------------
// Earth Engine's Map view has no native way to draw floating vector text tied
// to a geographic coordinate. This script uses the widely-used community text
// package (users/gena/packages:text) to burn ID/type labels as a raster layer.
// If that module is unavailable in your environment, set showLabels = false —
// every other layer (symbols, table, exports) works independently of it.
var showLabels = true;
var labelRenderScale = 1; // metres/pixel used only for rendering label glyphs

// --- Exports -------------------------------------------------------------------
var exportFolder = 'Kuppanur_Watershed_Export';
var exportScale = 10; // metres/pixel for the final map image export


// =============================================================================
// 02 — INTERVENTION DATA
// Single source of truth for both the map symbols and the intervention table.
// Replace/extend this array to update the whole map + table together.
//
// Longitude MUST be listed before latitude when building geometry:
//   ee.Geometry.Point([longitude, latitude])
//
// Source: gully_plugging_treatment.kml (GPS survey, Kuppanur village,
// Tamil Nadu) — "I Series Points" (14 GPS-surveyed intervention points).
// Elevation values below are the surveyed GPS elevations from that source;
// no structural dimensions have been added or assumed.
// =============================================================================

var interventions = [
  { id: 'I1',   latitude: 10.923057, longitude: 76.878832, elevation: 512.26, type: 'Apron' },
  { id: 'I2',   latitude: 10.922992, longitude: 76.878861, elevation: 514.91, type: 'Gabion structure' },
  { id: 'I3',   latitude: 10.923003, longitude: 76.878852, elevation: 517.31, type: 'River training structure' },
  { id: 'I4',   latitude: 10.922960, longitude: 76.878852, elevation: 518.03, type: 'Apron' },
  { id: 'I4A',  latitude: 10.922909, longitude: 76.878946, elevation: 519.47, type: 'Apron' },
  { id: 'I6',   latitude: 10.922772, longitude: 76.878945, elevation: 519.95, type: 'Retaining wall LBCD' },
  { id: 'I7',   latitude: 10.922767, longitude: 76.879019, elevation: 519.71, type: 'Brushwood dam' },
  { id: 'I8',   latitude: 10.922599, longitude: 76.879078, elevation: 524.52, type: 'Masonry check dam' },
  { id: 'I9',   latitude: 10.922508, longitude: 76.879109, elevation: 524.76, type: 'Retaining wall LBCD' },
  { id: 'I9AP', latitude: 10.922513, longitude: 76.879096, elevation: 524.76, type: 'Brushwood dam' },
  { id: 'I10',  latitude: 10.922358, longitude: 76.879212, elevation: 529.57, type: 'Brushwood dam' },
  { id: 'I10A', latitude: 10.922315, longitude: 76.879180, elevation: 528.61, type: 'Retaining wall LBCD' },
  { id: 'I11',  latitude: 10.922207, longitude: 76.879292, elevation: 529.09, type: 'Retaining wall LBCD' },
  { id: 'I12',  latitude: 10.922010, longitude: 76.879404, elevation: 534.37, type: 'Gabion structure' }
];

// Note: source spreadsheet lists point IDs I1-I12 with I4A and I9AP as
// additional points and I5 absent (14 points total, not 15) — preserved as
// surveyed, not renumbered.

interventions.forEach(function(item) {
  item.description = item.type + ' — GPS-surveyed point ' + item.id +
    ', elevation ' + item.elevation.toFixed(2) + ' m (surveyed, WGS 84).';
});

function validateInterventions(list) {
  var ids = {};
  list.forEach(function(item) {
    if (ids[item.id]) {
      print('WARNING: duplicate intervention ID found:', item.id);
    }
    ids[item.id] = true;
    if (item.latitude < -90 || item.latitude > 90) {
      print('WARNING: invalid latitude for', item.id, item.latitude);
    }
    if (item.longitude < -180 || item.longitude > 180) {
      print('WARNING: invalid longitude for', item.id, item.longitude);
    }
  });
  print('Interventions loaded:', list.length);
}
validateInterventions(interventions);


// =============================================================================
// 03 — USER ASSETS
// =============================================================================

var gullyTraining = ee.FeatureCollection(gullyTrainingAssetId);

// Required inspection per project spec — do NOT assume geometry type.
print('Gully Training Asset', gullyTraining);
print('First Feature', gullyTraining.first());
print('Geometry Type', gullyTraining.geometry().type());

// Client-side geometry type, used below to choose an appropriate visual style.
var gullyGeomType = gullyTraining.first().geometry().type().getInfo();
print('Gully Training Asset — geometry type used for styling:', gullyGeomType);

var catchment = null;
if (catchmentAssetId) {
  catchment = ee.FeatureCollection(catchmentAssetId);
  print('Catchment Asset', catchment);
}


// =============================================================================
// AOI (used by sections 04-08) — small buffer around the intervention cluster
// =============================================================================

function computeAOI(list, bufferMeters) {
  var points = list.map(function(item) {
    return ee.Feature(ee.Geometry.Point([item.longitude, item.latitude]));
  });
  var bounds = ee.FeatureCollection(points).geometry().bounds();
  return bounds.buffer(bufferMeters).bounds();
}

var aoi = computeAOI(interventions, aoiBufferMeters);


// =============================================================================
// 04 — SATELLITE BASEMAP
// Sentinel-2 surface reflectance, cloud-masked with Cloud Score+ (the current
// recommended masking approach — more robust across processing baselines
// than the older QA60 bitmask), natural-colour composite.
// =============================================================================

function createSatelliteComposite(aoiGeom) {
  var s2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterBounds(aoiGeom)
    .filterDate(sentinel2StartDate, sentinel2EndDate);

  var csPlus = ee.ImageCollection('GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED');
  var withCs = s2.linkCollection(csPlus, ['cs_cdf']);

  var cloudFree = withCs.map(function(img) {
    return img.updateMask(img.select('cs_cdf').gte(cloudScoreThreshold));
  });

  return cloudFree.median().clip(aoiGeom);
}

var satelliteComposite = createSatelliteComposite(aoi);
var satelliteVis = { bands: ['B4', 'B3', 'B2'], min: 300, max: 2800 };
Map.addLayer(satelliteComposite, satelliteVis, 'Satellite Imagery (Sentinel-2, cloud-masked)', true);


// =============================================================================
// 05 — DEM
// =============================================================================

var demSource = ee.Image(demAssetId).select(demBandName).clip(aoi);


// =============================================================================
// 06 — HILLSHADE
// =============================================================================

function createHillshade(demImg, aoiGeom) {
  return ee.Terrain.hillshade(demImg, hillshadeAzimuth, hillshadeElevation).clip(aoiGeom);
}

var hillshade = createHillshade(demSource, aoi);
Map.addLayer(hillshade, { min: 150, max: 255 }, 'Hillshade (terrain form)', true, hillshadeOpacity);


// =============================================================================
// 07 — CONTOURS
// Elevation banded into contourInterval classes; contour lines are the pixel
// boundaries where the class changes. Simple, robust, single-pass technique.
// =============================================================================

function createContours(demImg, aoiGeom, interval) {
  var zones = demImg.divide(interval).floor();
  var edges = zones.focal_max(1, 'square', 'pixels').neq(zones.focal_min(1, 'square', 'pixels'));
  return edges.selfMask().clip(aoiGeom);
}

var contours = createContours(demSource, aoi, contourInterval);
Map.addLayer(contours, { palette: ['8C6D46'] }, 'Contours (' + contourInterval + ' m interval)', true, 0.55);


// =============================================================================
// 08 — HYDROLOGY / DRAINAGE
//
// DEM -> hydrologically corrected DEM -> flow direction -> flow accumulation
// -> stream extraction, computed locally over the small AOI defined above.
//
// This is a simplified, self-contained D8 implementation intended for local
// context at the scale of this intervention cluster (a few hundred metres),
// not a full watershed hydrological model:
//   - "Hydrological conditioning" here is an iterative morphological fill of
//     minor pits (image.max(image.focal_min)), not a full priority-flood fill.
//   - Flow direction is steepest-descent D8 among the 8 neighbours.
//   - Flow accumulation is computed by level-synchronous propagation: at each
//     iteration, every cell passes its current wavefront value to its
//     downstream neighbour and that is summed into a running total. After
//     enough iterations (>= the longest flow path across the AOI, in pixels)
//     the running total converges to the true D8 flow accumulation for this
//     clipped area. flowAccumIterations in section 01 controls this.
//   - Only the resulting stream network (thresholded accumulation) is shown
//     on the map — the flow accumulation raster itself is an analytical
//     intermediate and is not displayed.
// =============================================================================

function computeDrainageNetwork(demImg, aoiGeom) {
  var scale = 30;
  var proj = demImg.projection();

  var demClip = demImg.reproject(proj, null, scale);

  // Simplified hydrological conditioning (iterative minor-pit fill)
  var filled = demClip;
  var fillPasses = 8;
  for (var p = 0; p < fillPasses; p++) {
    filled = filled.max(filled.focal_min({ radius: 1, kernelType: 'square', units: 'pixels' }));
  }
  filled = filled.reproject(proj, null, scale).rename('e');

  // 3x3 kernel, anchor at centre (1,1). neighborhoodToBands() output band
  // order follows the row-major order of the weights matrix supplied here,
  // so rather than depend on Earth Engine's internal auto-generated band
  // name string, every neighborhoodToBands() call below is immediately
  // re-named with our own explicit, known-order list (gridNames). That
  // removes any dependency on that internal naming convention.
  var kernel = ee.Kernel.fixed(3, 3, [[1, 1, 1], [1, 1, 1], [1, 1, 1]], 1, 1, false);
  var gridNames = ['nw', 'n', 'ne', 'w', 'c', 'e', 'sw', 's', 'se'];

  // 8 compass directions, deliberately ordered so index k and index (7 - k)
  // are always opposite directions: nw<->se, n<->s, ne<->sw, w<->e.
  var dirNames = ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'];
  var dirOffsets = {
    nw: [-1, -1], n: [0, -1], ne: [1, -1],
    w:  [-1, 0],               e: [1, 0],
    sw: [-1, 1],  s: [0, 1],   se: [1, 1]
  };

  var eN = filled.neighborhoodToBands(kernel).rename(gridNames);

  // --- D8 flow direction: index (0..7 into dirNames) of steepest-descent neighbour ---
  var dirCode = ee.Image.constant(0).byte(); // placeholder; masked out below wherever no downslope neighbour exists
  var maxDrop = ee.Image.constant(0).float();
  for (var i = 0; i < dirNames.length; i++) {
    var name = dirNames[i];
    var off = dirOffsets[name];
    var dist = Math.sqrt(off[0] * off[0] + off[1] * off[1]) * scale;
    var drop = eN.select('c').subtract(eN.select(name)).divide(dist);
    var better = drop.gt(maxDrop);
    dirCode = dirCode.where(better, ee.Image.constant(i));
    maxDrop = maxDrop.max(drop);
  }
  dirCode = dirCode.updateMask(maxDrop.gt(0)).rename('d').reproject(proj, null, scale);

  // Static across iterations (flow direction does not change), so computed once.
  var dN = dirCode.rename('d').neighborhoodToBands(kernel).rename(gridNames);

  // --- Iterative level-propagation flow accumulation ---
  var cellAreaKm2 = ee.Image.pixelArea().divide(1e6).clip(aoiGeom).reproject(proj, null, scale);
  var wavefront = cellAreaKm2.rename('w');
  var total = cellAreaKm2.rename('acc');

  for (var it = 0; it < flowAccumIterations; it++) {
    var wN = wavefront.rename('w').neighborhoodToBands(kernel).rename(gridNames);
    var received = ee.Image.constant(0).float();
    for (var k = 0; k < dirNames.length; k++) {
      var dName = dirNames[k];
      // The neighbour at this compass position flows into the centre cell
      // only if ITS OWN direction code equals the opposite compass index,
      // i.e. it points back at the centre.
      var neighborFlowsIn = dN.select(dName).eq(7 - k);
      var contribution = wN.select(dName).updateMask(neighborFlowsIn).unmask(0);
      received = received.add(contribution);
    }
    received = received.reproject(proj, null, scale);
    total = total.add(received).rename('acc');
    wavefront = received.rename('w');
  }

  var streamMask = total.gte(streamAccumThresholdKm2).selfMask().clip(aoiGeom).rename('stream');

  return { accumulation: total.clip(aoiGeom), streams: streamMask };
}

var drainage = computeDrainageNetwork(demSource, aoi);
// drainage.accumulation is analytical only and is intentionally NOT added to the map.
Map.addLayer(drainage.streams, { palette: ['1F5FA8'] }, 'Drainage / Stream Network (derived)', true);


// =============================================================================
// 09 — GULLY TRAINING ASSET
// Styled according to the geometry type actually found on the asset above —
// never assumed. Kept as a distinct existing/surveyed engineering layer,
// separate from the proposed interventions.
// =============================================================================

function addGullyTraining(fc, geomType) {
  var layerName = 'Gully / Stream Training (Existing / Surveyed)';
  var styled;
  if (geomType === 'Point' || geomType === 'MultiPoint') {
    styled = fc.style({ color: '2E7D6E', pointShape: 'circle', pointSize: 5, width: 2, fillColor: '2E7D6E' });
  } else if (geomType === 'LineString' || geomType === 'MultiLineString') {
    styled = fc.style({ color: '2E7D6E', width: 3 });
  } else if (geomType === 'Polygon' || geomType === 'MultiPolygon') {
    styled = fc.style({ color: '2E7D6E', fillColor: '2E7D6E33', width: 2 });
  } else {
    styled = fc.style({ color: '2E7D6E', width: 2, pointSize: 5 });
  }
  Map.addLayer(styled, {}, layerName, true);
}

addGullyTraining(gullyTraining, gullyGeomType);

if (catchment) {
  var catchmentVis = catchment.style({ color: 'FFFFFF', fillColor: '00000000', width: 2.5 });
  Map.addLayer(catchmentVis, {}, catchmentName + ' Boundary', true);
}


// =============================================================================
// 10 — PROPOSED INTERVENTIONS
// One FeatureCollection built directly from the `interventions` array — the
// same array used later for the table and the exports (section 09 spec:
// "the map and table must use the SAME source data").
// =============================================================================

function categorize(typeText) {
  var t = typeText.toLowerCase();
  if (t.indexOf('apron') !== -1 || t.indexOf('energy dissipation') !== -1 ||
      t.indexOf('sudden drop') !== -1 || t.indexOf('bed level drop') !== -1) {
    return 'apron';
  }
  if (t.indexOf('brushwood') !== -1) return 'brushwoodCheckDam';
  if (t.indexOf('masonry') !== -1) return 'masonryCheckDam';
  if (t.indexOf('retaining wall') !== -1 || t.indexOf('retaining') !== -1) return 'gabionRetainingWall';
  if (t.indexOf('river training') !== -1 || t.indexOf('stream training') !== -1) return 'streamTraining';
  if (t.indexOf('bank protection') !== -1) return 'bankProtection';
  if (t.indexOf('gabion') !== -1 && t.indexOf('check dam') !== -1) return 'gabionCheckDam';
  if (t.indexOf('gabion') !== -1) return 'gabionStructure';
  if (t.indexOf('check dam') !== -1) return 'gabionCheckDam';
  return 'other';
}

function createInterventionFeatures(list) {
  var features = list.map(function(item) {
    var geom = ee.Geometry.Point([item.longitude, item.latitude]);
    return ee.Feature(geom, {
      id: item.id,
      type: item.type,
      category: categorize(item.type),
      elevation_m: item.elevation,
      description: item.description
    });
  });
  return ee.FeatureCollection(features);
}

var interventionFC = createInterventionFeatures(interventions);


// =============================================================================
// 11 — INTERVENTION SYMBOLS
// Restrained, professional palette. Shape + colour differentiate categories;
// only categories actually present in `interventions` are drawn / legended.
// =============================================================================

var categoryStyles = {
  gabionCheckDam:      { color: 'B03A2E', pointShape: 'square',   pointSize: 9, width: 2, fillColor: 'B03A2E' },
  brushwoodCheckDam:    { color: '8B5A2B', pointShape: 'triangle', pointSize: 9, width: 2, fillColor: '8B5A2B' },
  masonryCheckDam:      { color: '5D4037', pointShape: 'diamond',  pointSize: 9, width: 2, fillColor: '5D4037' },
  gabionStructure:      { color: '5B7C99', pointShape: 'square',   pointSize: 8, width: 2, fillColor: '5B7C99' },
  gabionRetainingWall:  { color: '2C4A6B', pointShape: 'cross',    pointSize: 9, width: 3 },
  streamTraining:       { color: '2E7D6E', pointShape: 'plus',     pointSize: 9, width: 3 },
  bankProtection:       { color: '6B7A3A', pointShape: 'star5',    pointSize: 9, width: 2, fillColor: '6B7A3A' },
  apron:                { color: 'C08A2E', pointShape: 'circle',   pointSize: 8, width: 2, fillColor: 'C08A2E' },
  other:                { color: '707070', pointShape: 'diamond',  pointSize: 8, width: 2, fillColor: '707070' }
};

var categoryLabels = {
  gabionCheckDam:      'Gabion Check Dam',
  brushwoodCheckDam:    'Brushwood Check Dam',
  masonryCheckDam:      'Masonry Check Dam',
  gabionStructure:      'Gabion Structure',
  gabionRetainingWall:  'Retaining Wall',
  streamTraining:       'Stream Training / River Training Structure',
  bankProtection:       'Stream Bank Protection',
  apron:                'Apron / Energy Dissipation',
  other:                'Other Intervention'
};

var presentCategories = {};
interventions.forEach(function(item) { presentCategories[categorize(item.type)] = true; });

var interventionsByCategory = {};

function addInterventions(fc) {
  Object.keys(categoryStyles).forEach(function(cat) {
    if (!presentCategories[cat]) return;
    var subset = fc.filter(ee.Filter.eq('category', cat));
    interventionsByCategory[cat] = subset;
    var styled = subset.style(categoryStyles[cat]);
    Map.addLayer(styled, {}, 'Intervention: ' + categoryLabels[cat], true);
  });
}

addInterventions(interventionFC);


// =============================================================================
// 12 — LABELS
// See the note in section 01 (showLabels). Uses the community text-rendering
// package to burn "ID / TYPE" labels near each point, as a single combined
// raster layer.
// =============================================================================

function addLabels(list) {
  if (!showLabels) return;
  var textPkg;
  try {
    textPkg = require('users/gena/packages:text');
  } catch (e) {
    print('Label package (users/gena/packages:text) could not be loaded — ' +
      'set showLabels = false in section 01 to suppress this, or add labels ' +
      'manually downstream. All other layers are unaffected.', e);
    return;
  }
  var labelImages = list.map(function(item) {
    var pt = ee.Geometry.Point([item.longitude, item.latitude]);
    var labelStr = item.id + ' ' + item.type.toUpperCase();
    return textPkg.draw(labelStr, pt, labelRenderScale, {
      fontSize: 12,
      textColor: '1a1a1a'
    });
  });
  var combined = ee.ImageCollection(labelImages).mosaic();
  Map.addLayer(combined, {}, 'Intervention Labels', true);
}

addLabels(interventions);


// =============================================================================
// 13 — LEGEND
// Only sections/rows for layers actually displayed are included.
// =============================================================================

function createLegendRow(color, label) {
  var colorBox = ui.Label({
    style: { backgroundColor: '#' + color, padding: '7px', margin: '2px 6px 2px 0', border: '1px solid #999' }
  });
  var description = ui.Label({ value: label, style: { margin: '2px 0', fontSize: '11px', color: '222222' } });
  return ui.Panel({ widgets: [colorBox, description], layout: ui.Panel.Layout.Flow('horizontal') });
}

function createLegend() {
  var legendPanel = ui.Panel({
    style: {
      position: 'bottom-right',
      padding: '10px 12px',
      backgroundColor: 'rgba(255,255,255,0.94)',
      width: '250px'
    }
  });

  legendPanel.add(ui.Label('LEGEND', { fontWeight: 'bold', fontSize: '13px', margin: '0 0 6px 0' }));

  legendPanel.add(ui.Label('PROPOSED INTERVENTIONS', { fontWeight: 'bold', fontSize: '11px', margin: '2px 0 2px 0' }));
  Object.keys(categoryStyles).forEach(function(cat) {
    if (presentCategories[cat]) {
      legendPanel.add(createLegendRow(categoryStyles[cat].color, categoryLabels[cat]));
    }
  });

  legendPanel.add(ui.Label('HYDROLOGY', { fontWeight: 'bold', fontSize: '11px', margin: '8px 0 2px 0' }));
  legendPanel.add(createLegendRow('1F5FA8', 'Drainage / Stream (derived from DEM)'));
  legendPanel.add(createLegendRow('2E7D6E', 'Gully / Stream Training (existing / surveyed)'));

  if (catchment) {
    legendPanel.add(ui.Label('CATCHMENT', { fontWeight: 'bold', fontSize: '11px', margin: '8px 0 2px 0' }));
    legendPanel.add(createLegendRow('FFFFFF', catchmentName + ' Boundary'));
  }

  legendPanel.add(ui.Label('TERRAIN', { fontWeight: 'bold', fontSize: '11px', margin: '8px 0 2px 0' }));
  legendPanel.add(createLegendRow('8C6D46', 'Contours (' + contourInterval + ' m interval)'));
  legendPanel.add(createLegendRow('999999', 'Hillshade'));

  var noteText =
    'Source: Google Earth Engine | Sentinel-2 SR Harmonized | DEM: USGS SRTM GL1 (30 m)\n' +
    'Coordinate Reference System: WGS 84\n' +
    'Intervention locations: user-supplied GPS-surveyed coordinates\n' +
    'Gully/stream-training layer: user-uploaded GEE asset (gully_tr)\n' +
    'Location/planning map only — not a structural design drawing.';
  legendPanel.add(ui.Label(noteText, { fontSize: '8.5px', color: '555555', margin: '10px 0 0 0' }));

  Map.add(legendPanel);
}

createLegend();


// =============================================================================
// 14 — MAP VIEW
// Title block, north arrow (Earth Engine's Map never rotates, so a fixed
// arrow is always correctly oriented), and centring. The Code Editor Map
// widget already shows a live, auto-updating scale bar at bottom-left by
// default, so no custom scale bar is built here.
// =============================================================================

function addTitleBlock() {
  var titlePanel = ui.Panel({
    style: { position: 'top-left', padding: '10px 14px', backgroundColor: 'rgba(255,255,255,0.94)' }
  });
  titlePanel.add(ui.Label(mapTitle, { fontWeight: 'bold', fontSize: '16px', margin: '0 0 2px 0' }));
  titlePanel.add(ui.Label(projectName + ' — ' + catchmentName, { fontSize: '12px', color: '333333', margin: '0' }));
  Map.add(titlePanel);
}

function addNorthArrow() {
  var northArrow = ui.Label('N ▲', {
    fontWeight: 'bold',
    fontSize: '18px',
    position: 'top-right',
    backgroundColor: 'rgba(255,255,255,0.88)',
    padding: '6px 10px',
    margin: '8px'
  });
  Map.add(northArrow);
}

addTitleBlock();
addNorthArrow();

Map.setOptions('HYBRID');
Map.centerObject(aoi, 18);


// =============================================================================
// 15 — INTERVENTION TABLE
// Built from the same `interventions` array as the map symbols. Printed to
// the Console (via print()) so it sits alongside the asset-inspection output
// from section 03 without disturbing the Map layout.
// =============================================================================

function createInterventionTable(list) {
  var colWidths = { id: '55px', work: '190px', lat: '90px', lon: '90px', desc: '300px' };

  var headerRow = ui.Panel({
    layout: ui.Panel.Layout.Flow('horizontal'),
    widgets: [
      ui.Label('ID', { width: colWidths.id, fontWeight: 'bold', fontSize: '11px' }),
      ui.Label('Proposed Work', { width: colWidths.work, fontWeight: 'bold', fontSize: '11px' }),
      ui.Label('Latitude', { width: colWidths.lat, fontWeight: 'bold', fontSize: '11px' }),
      ui.Label('Longitude', { width: colWidths.lon, fontWeight: 'bold', fontSize: '11px' }),
      ui.Label('Work Description', { width: colWidths.desc, fontWeight: 'bold', fontSize: '11px' })
    ]
  });

  var tablePanel = ui.Panel({ widgets: [headerRow], style: { margin: '4px 0' } });

  list.forEach(function(item) {
    var row = ui.Panel({
      layout: ui.Panel.Layout.Flow('horizontal'),
      widgets: [
        ui.Label(item.id, { width: colWidths.id, fontSize: '11px' }),
        ui.Label(item.type, { width: colWidths.work, fontSize: '11px' }),
        ui.Label(item.latitude.toFixed(6), { width: colWidths.lat, fontSize: '11px' }),
        ui.Label(item.longitude.toFixed(6), { width: colWidths.lon, fontSize: '11px' }),
        ui.Label(item.description, { width: colWidths.desc, fontSize: '11px' })
      ]
    });
    tablePanel.add(row);
  });

  return tablePanel;
}

print('=== INTERVENTION SCHEDULE — ' + projectName + ' / ' + catchmentName + ' ===');
print(createInterventionTable(interventions));


// =============================================================================
// 16 — EXPORTS
// =============================================================================

function exportInterventions(fc) {
  Export.table.toDrive({
    collection: fc, description: 'Kuppanur_Interventions_SHP',
    folder: exportFolder, fileNamePrefix: 'kuppanur_interventions', fileFormat: 'SHP'
  });
  Export.table.toDrive({
    collection: fc, description: 'Kuppanur_Interventions_CSV',
    folder: exportFolder, fileNamePrefix: 'kuppanur_interventions', fileFormat: 'CSV'
  });
  Export.table.toDrive({
    collection: fc, description: 'Kuppanur_Interventions_GeoJSON',
    folder: exportFolder, fileNamePrefix: 'kuppanur_interventions', fileFormat: 'GeoJSON'
  });
}
exportInterventions(interventionFC);

function exportGullyTraining(fc) {
  Export.table.toDrive({
    collection: fc, description: 'Kuppanur_GullyTraining_SHP',
    folder: exportFolder, fileNamePrefix: 'kuppanur_gully_training', fileFormat: 'SHP'
  });
  Export.table.toDrive({
    collection: fc, description: 'Kuppanur_GullyTraining_GeoJSON',
    folder: exportFolder, fileNamePrefix: 'kuppanur_gully_training', fileFormat: 'GeoJSON'
  });
}
exportGullyTraining(gullyTraining);

// Final map image: satellite + subtle hillshade blended, with contours,
// drainage, gully-training and all intervention categories painted on top in
// the same visual hierarchy used on the interactive map (highest importance
// last / on top): interventions > drainage > gully training > contours >
// hillshade > satellite. Title, legend, north arrow and the intervention
// table are Code Editor UI panels (sections 13-15) and are not baked into
// this raster — for a print-ready A3 layout, compose this exported image
// with those elements in a GIS/desktop-publishing tool, or take a
// screenshot of the annotated Code Editor Map view directly.
function buildExportComposite(aoiGeom) {
  var rgbVis = satelliteComposite.visualize({ bands: ['B4', 'B3', 'B2'], min: 300, max: 2800 });
  var hsVis = hillshade.visualize({ min: 150, max: 255, opacity: hillshadeOpacity });
  var contourVis = contours.visualize({ palette: ['8C6D46'], opacity: 0.55 });
  var streamVis = drainage.streams.visualize({ palette: ['1F5FA8'], opacity: 0.9 });

  var composite = rgbVis.blend(hsVis).blend(contourVis).blend(streamVis);

  var gullyVis = gullyTraining.style({ color: '2E7D6E', width: 3, pointSize: 5, fillColor: '2E7D6E33' });
  composite = composite.blend(gullyVis);

  Object.keys(interventionsByCategory).forEach(function(cat) {
    var styled = interventionsByCategory[cat].style(categoryStyles[cat]);
    composite = composite.blend(styled);
  });

  return composite.clip(aoiGeom);
}

function exportFinalMapImage(aoiGeom) {
  var composite = buildExportComposite(aoiGeom);
  Export.image.toDrive({
    image: composite,
    description: 'Kuppanur_Watershed_Map_Export',
    folder: exportFolder,
    fileNamePrefix: 'kuppanur_watershed_intervention_map',
    region: aoiGeom,
    scale: exportScale,
    crs: 'EPSG:4326',
    maxPixels: 1e9
  });
}
exportFinalMapImage(aoi);

print('All export tasks have been queued in the Tasks tab (top-right). ' +
  'Click "Run" next to each task to start it.');
