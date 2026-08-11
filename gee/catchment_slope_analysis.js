/**
 * =============================================================================
 *  CATCHMENT AREA SLOPE STATISTICS (Mean / Min / Max)
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
// 3. DERIVE SLOPE (in degrees) USING EARTH ENGINE TERRAIN ALGORITHMS
// -----------------------------------------------------------------------------
var slope = ee.Terrain.slope(dem).clip(geometry);

// -----------------------------------------------------------------------------
// 4. COMPUTE MEAN / MIN / MAX SLOPE OVER THE CATCHMENT
// -----------------------------------------------------------------------------
var slopeStats = slope.reduceRegion({
  reducer: ee.Reducer.mean().combine({
    reducer2: ee.Reducer.minMax(),
    sharedInputs: true
  }),
  geometry: geometry,
  scale: 30,          // matches native DEM resolution
  maxPixels: 1e13,
  bestEffort: true,   // auto-adjusts scale if AOI is very large
  tileScale: 4         // reduces memory/timeout errors on large areas
});

print('----------------------------------------------------');
print('CATCHMENT SLOPE STATISTICS (degrees)');
print('----------------------------------------------------');
print('Mean Slope (°):', slopeStats.get('slope_mean'));
print('Min  Slope (°):', slopeStats.get('slope_min'));
print('Max  Slope (°):', slopeStats.get('slope_max'));
print('Full stats object:', slopeStats);

// -----------------------------------------------------------------------------
// 5. (OPTIONAL) PER-FEATURE STATISTICS — useful if the asset has multiple
//    sub-catchments/polygons and you want stats for each one individually
// -----------------------------------------------------------------------------
var perFeatureStats = slope.reduceRegions({
  collection: catchment,
  reducer: ee.Reducer.mean().combine({
    reducer2: ee.Reducer.minMax(),
    sharedInputs: true
  }),
  scale: 30,
  tileScale: 4
});
print('Per-feature slope statistics:', perFeatureStats);

// -----------------------------------------------------------------------------
// 6. VISUALIZATION
// -----------------------------------------------------------------------------
Map.centerObject(geometry, 12);

Map.addLayer(dem, {
  min: 0, max: 3000,
  palette: ['0000ff', '00ff00', 'ffff00', 'ff0000']
}, 'DEM (Copernicus GLO-30)');

Map.addLayer(slope, {
  min: 0, max: 60,
  palette: ['ffffff', 'ffe066', 'ff8c00', 'ff0000', '800080']
}, 'Slope (degrees)');

Map.addLayer(
  catchment.style({color: 'black', fillColor: '00000000', width: 2}),
  {},
  'Catchment Boundary'
);

// -----------------------------------------------------------------------------
// 7. (OPTIONAL) EXPORT SLOPE RASTER TO GOOGLE DRIVE
// -----------------------------------------------------------------------------
Export.image.toDrive({
  image: slope,
  description: 'Catchment_Slope_GLO30',
  folder: 'GEE_exports',
  fileNamePrefix: 'catchment_slope_glo30',
  region: geometry,
  scale: 30,
  maxPixels: 1e13
});

// -----------------------------------------------------------------------------
// 8. (OPTIONAL) EXPORT PER-FEATURE STATISTICS TABLE TO GOOGLE DRIVE
// -----------------------------------------------------------------------------
Export.table.toDrive({
  collection: perFeatureStats,
  description: 'Catchment_Slope_Stats_Table',
  folder: 'GEE_exports',
  fileNamePrefix: 'catchment_slope_stats',
  fileFormat: 'CSV'
});
