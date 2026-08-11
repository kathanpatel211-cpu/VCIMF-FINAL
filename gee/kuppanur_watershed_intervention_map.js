/**
 * PROPOSED INTERVENTIONS — KUPPANUR WATERSHED / CATCHMENT A
 *
 * Google Earth Engine (Code Editor, JavaScript) script.
 *
 * Minimal, lightweight version: shows ONLY the 14 proposed intervention
 * locations, properly marked and labelled with their type. All the
 * DEM-derived layers (satellite composite, hillshade, contours, drainage
 * network) and the gully-training asset overlay have been removed — they
 * were pushing the Code Editor's per-tile computation past Earth Engine's
 * memory limit ("Tile error: Earth Engine memory capacity exceeded"),
 * especially the label layer, which was neither clipped nor reprojected to
 * a fixed grid and so got recomputed at unbounded cost on every pan/zoom.
 *
 * If you want the terrain/hydrology/gully-training layers back later, ask
 * for them again — they can be re-added as separate, individually toggled
 * layers so a problem in one doesn't take down the whole map.
 *
 * ---------------------------------------------------------------------------
 * CODE MAP
 *   01 — PROJECT CONFIGURATION
 *   02 — INTERVENTION DATA
 *   03 — PROPOSED INTERVENTIONS
 *   04 — INTERVENTION SYMBOLS
 *   05 — LABELS
 *   06 — LEGEND
 *   07 — MAP VIEW
 *   08 — INTERVENTION TABLE
 *   09 — EXPORTS
 * ---------------------------------------------------------------------------
 */

// =============================================================================
// 01 — PROJECT CONFIGURATION
// =============================================================================

var projectName   = 'KUPPANUR WATERSHED';
var catchmentName = 'CATCHMENT A';
var mapTitle       = 'PROPOSED INTERVENTIONS';

// Basemap: Google's own HYBRID (satellite + labels) basemap. This is NOT an
// Earth Engine computed layer, so it costs nothing and cannot trigger a
// "memory capacity exceeded" tile error.
var basemapStyle = 'HYBRID';

// --- Labels ------------------------------------------------------------------
// Earth Engine has no native floating vector text on the Map. This uses the
// community text package (users/gena/packages:text) to burn a short ID label
// next to each point, tightly clipped and reprojected to a fixed grid so it
// renders cheaply at any zoom. Set to false if it ever causes trouble again —
// every other layer (symbols, legend, table, exports) is unaffected.
var showLabels = true;
var labelRenderScale = 3;   // metres/pixel — coarser than before, cheaper to render
var labelClipRadiusMeters = 30; // each label glyph is clipped to this radius around its point

// --- Exports -------------------------------------------------------------------
var exportFolder = 'Kuppanur_Watershed_Export';


// =============================================================================
// 02 — INTERVENTION DATA
// Single source of truth for the map symbols, labels and the table below.
//
// Longitude MUST be listed before latitude when building geometry:
//   ee.Geometry.Point([longitude, latitude])
//
// Source: gully_plugging_treatment.kml (GPS survey, Kuppanur village,
// Tamil Nadu) — "I Series Points" (14 GPS-surveyed intervention points).
// Elevation values are the surveyed GPS elevations from that source; no
// structural dimensions have been added or assumed.
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

function computeAOI(list, bufferMeters) {
  var points = list.map(function(item) {
    return ee.Feature(ee.Geometry.Point([item.longitude, item.latitude]));
  });
  var bounds = ee.FeatureCollection(points).geometry().bounds();
  return bounds.buffer(bufferMeters).bounds();
}
var aoi = computeAOI(interventions, 100);


// =============================================================================
// 03 — PROPOSED INTERVENTIONS
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
// 04 — INTERVENTION SYMBOLS
// Restrained, professional palette. Shape + colour differentiate categories;
// only categories actually present in `interventions` are drawn / legended.
// Point size is intentionally large since this is now the only map layer.
// =============================================================================

var categoryStyles = {
  gabionCheckDam:      { color: 'B03A2E', pointShape: 'square',   pointSize: 12, width: 2, fillColor: 'B03A2E' },
  brushwoodCheckDam:    { color: '8B5A2B', pointShape: 'triangle', pointSize: 12, width: 2, fillColor: '8B5A2B' },
  masonryCheckDam:      { color: '5D4037', pointShape: 'diamond',  pointSize: 12, width: 2, fillColor: '5D4037' },
  gabionStructure:      { color: '5B7C99', pointShape: 'square',   pointSize: 11, width: 2, fillColor: '5B7C99' },
  gabionRetainingWall:  { color: '2C4A6B', pointShape: 'cross',    pointSize: 12, width: 3 },
  streamTraining:       { color: '2E7D6E', pointShape: 'plus',     pointSize: 12, width: 3 },
  bankProtection:       { color: '6B7A3A', pointShape: 'star5',    pointSize: 12, width: 2, fillColor: '6B7A3A' },
  apron:                { color: 'C08A2E', pointShape: 'circle',   pointSize: 11, width: 2, fillColor: 'C08A2E' },
  other:                { color: '707070', pointShape: 'diamond',  pointSize: 11, width: 2, fillColor: '707070' }
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
// 05 — LABELS
// Each glyph is clipped to a small radius around its own point BEFORE the
// mosaic, and the combined result is reprojected to a fixed grid and clipped
// to the small local AOI. That keeps the per-tile computation bounded no
// matter how far the map is zoomed or panned — this is what was missing
// before and caused the "memory capacity exceeded" tile error.
// =============================================================================

function addLabels(list, aoiGeom) {
  if (!showLabels) return;
  var textPkg;
  try {
    textPkg = require('users/gena/packages:text');
  } catch (e) {
    print('Label package (users/gena/packages:text) could not be loaded — ' +
      'set showLabels = false in section 01 to suppress this. All other ' +
      'layers (symbols, legend, table, exports) are unaffected.', e);
    return;
  }
  var labelImages = list.map(function(item) {
    var pt = ee.Geometry.Point([item.longitude, item.latitude]);
    var glyph = textPkg.draw(item.id, pt, labelRenderScale, {
      fontSize: 11,
      textColor: '1a1a1a'
    });
    return glyph.clip(pt.buffer(labelClipRadiusMeters));
  });
  var combined = ee.ImageCollection(labelImages).mosaic()
    .reproject('EPSG:4326', null, labelRenderScale)
    .clip(aoiGeom);
  Map.addLayer(combined, {}, 'Intervention Labels (ID)', true);
}

addLabels(interventions, aoi);


// =============================================================================
// 06 — LEGEND
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

  var noteText =
    'Coordinate Reference System: WGS 84\n' +
    'Intervention locations: user-supplied GPS-surveyed coordinates\n' +
    'Location/planning map only — not a structural design drawing.';
  legendPanel.add(ui.Label(noteText, { fontSize: '8.5px', color: '555555', margin: '10px 0 0 0' }));

  Map.add(legendPanel);
}

createLegend();


// =============================================================================
// 07 — MAP VIEW
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

Map.setOptions(basemapStyle);
Map.centerObject(aoi, 18);


// =============================================================================
// 08 — INTERVENTION TABLE
// Built from the same `interventions` array as the map symbols. Printed to
// the Console via print() so it sits alongside the validation output above.
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
// 09 — EXPORTS
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

print('Export tasks have been queued in the Tasks tab (top-right). ' +
  'Click "Run" next to each task to start it.');
