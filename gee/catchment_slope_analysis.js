/**
 * =============================================================================
 *  CATCHMENT AREA SLOPE ANALYSIS  —  DEGREES + PERCENTAGE
 *  Google Earth Engine (JavaScript API)
 * =============================================================================
 *
 *  Asset      : projects/raygadh-range/assets/catchmentarea
 *  Asset ID   : YXMV4HWVQVTVKURIZ6H42NBF
 *
 *  DEM SOURCE : Copernicus GLO-30 DEM  ->  COPERNICUS/DEM/GLO30
 *    - Derived from the TanDEM-X mission (Airbus/ESA), released 2021-2023
 *    - ~30 m (1 arc-second) global coverage, void-filled & edited
 *    - Vertical accuracy ~2 m RMSE (vs. SRTM ~5-6 m, ASTER GDEM ~8-17 m)
 *    - Currently the most accurate freely available GLOBAL open DEM,
 *      making it the best choice for slope derivation worldwide.
 *
 *  An optional bare-earth alternative (FABDEM, forests & buildings removed
 *  from Copernicus GLO-30) is included below (commented out) since it can
 *  be more representative of true ground slope for hydrology / catchment
 *  studies in forested terrain.
 * =============================================================================
 */

// -----------------------------------------------------------------------------
// 1. LOAD THE CATCHMENT BOUNDARY
// -----------------------------------------------------------------------------
var catchment = ee.FeatureCollection('projects/raygadh-range/assets/catchmentarea');
var geometry  = catchment.geometry();

// -----------------------------------------------------------------------------
// 2. LOAD & MOSAIC THE COPERNICUS GLO-30 DEM OVER THE AOI
// -----------------------------------------------------------------------------
var demCollection = ee.ImageCollection('COPERNICUS/DEM/GLO30')
  .filterBounds(geometry)
  .select('DEM');

var dem = demCollection.mosaic()
  .setDefaultProjection('EPSG:3857', null, 30)   // native ~30 m resolution
  .clip(geometry);

// --- Optional: FABDEM (bare-earth, forest/building corrected) -----------------
// var dem = ee.ImageCollection('projects/sat-io/open-datasets/FABDEM')
//   .filterBounds(geometry)
//   .mosaic()
//   .setDefaultProjection('EPSG:4326', null, 30)
//   .clip(geometry);
// -------------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// 3. DERIVE SLOPE — BOTH IN DEGREES AND IN PERCENTAGE
// -----------------------------------------------------------------------------
var slopeDeg = ee.Terrain.slope(dem).clip(geometry).rename('slope_deg');

// Percentage slope = tan(slope_in_radians) * 100
var slopePct = slopeDeg
  .multiply(Math.PI).divide(180)   // degrees -> radians
  .tan()
  .multiply(100)
  .rename('slope_pct');

// -----------------------------------------------------------------------------
// 4. COMPUTE MEAN / MIN / MAX SLOPE (DEGREES + PERCENTAGE) OVER THE CATCHMENT
// -----------------------------------------------------------------------------
var combinedReducer = ee.Reducer.mean().combine({
  reducer2: ee.Reducer.minMax(),
  sharedInputs: true
});

var slopeDegStats = slopeDeg.reduceRegion({
  reducer: combinedReducer,
  geometry: geometry,
  scale: 30,
  maxPixels: 1e13,
  bestEffort: true,
  tileScale: 4
});

var slopePctStats = slopePct.reduceRegion({
  reducer: combinedReducer,
  geometry: geometry,
  scale: 30,
  maxPixels: 1e13,
  bestEffort: true,
  tileScale: 4
});

print('----------------------------------------------------');
print('CATCHMENT SLOPE STATISTICS — DEGREES (°)');
print('----------------------------------------------------');
print('Mean Slope (°):', slopeDegStats.get('slope_deg_mean'));
print('Min  Slope (°):', slopeDegStats.get('slope_deg_min'));
print('Max  Slope (°):', slopeDegStats.get('slope_deg_max'));

print('----------------------------------------------------');
print('CATCHMENT SLOPE STATISTICS — PERCENTAGE (%)');
print('----------------------------------------------------');
print('Mean Slope (%):', slopePctStats.get('slope_pct_mean'));
print('Min  Slope (%):', slopePctStats.get('slope_pct_min'));
print('Max  Slope (%):', slopePctStats.get('slope_pct_max'));

// -----------------------------------------------------------------------------
// 5. (OPTIONAL) PER-FEATURE STATISTICS — useful if the asset has multiple
//    sub-catchments/polygons and you want stats for each one individually
// -----------------------------------------------------------------------------
var slopeBoth = slopeDeg.addBands(slopePct);

var perFeatureStats = slopeBoth.reduceRegions({
  collection: catchment,
  reducer: combinedReducer,
  scale: 30,
  tileScale: 4
});
print('Per-feature slope statistics (degrees + percentage):', perFeatureStats);

// -----------------------------------------------------------------------------
// 6. SLOPE CLASSIFICATION (for clean, labeled map layers)
// -----------------------------------------------------------------------------

// --- Degree classes: standard terrain/erosion classification -----------------
var degBreaks  = [0, 5, 10, 15, 25, 35, 90];
var degLabels  = ['0-5° (Flat)', '5-10° (Gentle)', '10-15° (Moderate)',
                   '15-25° (Strong)', '25-35° (Steep)', '>35° (Very Steep)'];
var degPalette = ['1a9850', '91cf60', 'd9ef8b', 'fee08b', 'fc8d59', 'd73027'];

var slopeDegClass = ee.Image(0);
for (var i = 0; i < degPalette.length; i++) {
  slopeDegClass = slopeDegClass.where(
    slopeDeg.gte(degBreaks[i]).and(slopeDeg.lt(degBreaks[i + 1])), i);
}
slopeDegClass = slopeDegClass.clip(geometry);

// --- Percentage classes: standard USDA/FAO land-slope classification ---------
var pctBreaks  = [0, 3, 8, 15, 30, 45, 1000];
var pctLabels  = ['0-3% (Flat)', '3-8% (Gentle)', '8-15% (Moderate)',
                   '15-30% (Strong)', '30-45% (Steep)', '>45% (Very Steep)'];
var pctPalette = ['1a9850', '91cf60', 'd9ef8b', 'fee08b', 'fc8d59', 'd73027'];

var slopePctClass = ee.Image(0);
for (var j = 0; j < pctPalette.length; j++) {
  slopePctClass = slopePctClass.where(
    slopePct.gte(pctBreaks[j]).and(slopePct.lt(pctBreaks[j + 1])), j);
}
slopePctClass = slopePctClass.clip(geometry);

// -----------------------------------------------------------------------------
// 7. MAP VISUALIZATION — layered & labeled
// -----------------------------------------------------------------------------
Map.centerObject(geometry, 12);
Map.setOptions('HYBRID');

Map.addLayer(dem, {
  min: 0, max: 3000,
  palette: ['0000ff', '00ff00', 'ffff00', 'ff0000']
}, 'Elevation - DEM (Copernicus GLO-30)', false);

Map.addLayer(slopeDeg, {
  min: 0, max: 60,
  palette: ['ffffff', 'ffe066', 'ff8c00', 'ff0000', '800080']
}, 'Slope - Continuous (Degrees)', false);

Map.addLayer(slopePct, {
  min: 0, max: 150,
  palette: ['ffffff', 'ffe066', 'ff8c00', 'ff0000', '800080']
}, 'Slope - Continuous (Percentage)', false);

Map.addLayer(slopeDegClass, {min: 0, max: degPalette.length - 1, palette: degPalette},
  'Slope Classes (Degrees)', true);

Map.addLayer(slopePctClass, {min: 0, max: pctPalette.length - 1, palette: pctPalette},
  'Slope Classes (Percentage)', false);

Map.addLayer(
  catchment.style({color: 'black', fillColor: '00000000', width: 2}),
  {},
  'Catchment Boundary'
);

// -----------------------------------------------------------------------------
// 8. MAP LABEL / LEGEND PANEL (Degree + Percentage slope classes)
// -----------------------------------------------------------------------------
function buildLegend(title, labels, palette) {
  var panel = ui.Panel({
    style: {padding: '6px 8px', backgroundColor: 'white'}
  });

  panel.add(ui.Label({
    value: title,
    style: {fontWeight: 'bold', fontSize: '13px', margin: '0 0 4px 0'}
  }));

  for (var k = 0; k < labels.length; k++) {
    var colorBox = ui.Label({
      style: {
        backgroundColor: '#' + palette[k],
        padding: '8px',
        margin: '0 6px 2px 0'
      }
    });
    var description = ui.Label({
      value: labels[k],
      style: {margin: '0 0 2px 0', fontSize: '12px'}
    });
    panel.add(ui.Panel({
      widgets: [colorBox, description],
      layout: ui.Panel.Layout.Flow('horizontal')
    }));
  }
  return panel;
}

var legendPanel = ui.Panel({
  style: {position: 'bottom-left', padding: '8px'}
});
legendPanel.add(buildLegend('Slope Class (Degrees)', degLabels, degPalette));
legendPanel.add(buildLegend('Slope Class (Percentage)', pctLabels, pctPalette));
Map.add(legendPanel);

// Title label on the map
var titleLabel = ui.Label({
  value: 'Catchment Slope Analysis (Copernicus GLO-30 DEM)',
  style: {
    position: 'top-center',
    fontWeight: 'bold',
    fontSize: '16px',
    backgroundColor: 'white',
    padding: '6px 10px'
  }
});
Map.add(titleLabel);

// -----------------------------------------------------------------------------
// 9. (OPTIONAL) EXPORT RASTERS TO GOOGLE DRIVE
// -----------------------------------------------------------------------------
Export.image.toDrive({
  image: slopeDeg,
  description: 'Catchment_Slope_Degrees_GLO30',
  folder: 'GEE_exports',
  fileNamePrefix: 'catchment_slope_degrees',
  region: geometry,
  scale: 30,
  maxPixels: 1e13
});

Export.image.toDrive({
  image: slopePct,
  description: 'Catchment_Slope_Percentage_GLO30',
  folder: 'GEE_exports',
  fileNamePrefix: 'catchment_slope_percentage',
  region: geometry,
  scale: 30,
  maxPixels: 1e13
});

// -----------------------------------------------------------------------------
// 10. (OPTIONAL) EXPORT PER-FEATURE STATISTICS TABLE TO GOOGLE DRIVE
// -----------------------------------------------------------------------------
Export.table.toDrive({
  collection: perFeatureStats,
  description: 'Catchment_Slope_Stats_Table',
  folder: 'GEE_exports',
  fileNamePrefix: 'catchment_slope_stats',
  fileFormat: 'CSV'
});
