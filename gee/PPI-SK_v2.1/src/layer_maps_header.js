/* ######################################################################
 *  FRPIM v2.2 — LAYER MAPS for presentation
 *  KHEDBRAHMA RANGE — single-file Google Earth Engine script
 *  ----------------------------------------------------------------------
 *  WHAT IT DOES
 *   Shows every input layer of the FRPIM model (42 layers: satellite
 *   image, canopy, NDVI, bare soil, erosion, degradation trend, fire,
 *   moisture, water, terrain, soil depth, soil, biotic pressure,
 *   constraints), one at a time, each with its own legend.
 *
 *  HOW TO USE
 *   1. Paste this whole file into a new Code Editor script and press Run.
 *   2. Choose a layer in the left panel (or use Previous / Next).
 *      The legend, an explanation and a "Download PNG" link appear.
 *   3. For full-quality presentation maps: Tasks tab -> RUN each L_ task.
 *      GeoTIFFs go to Google Drive, folder FRPIM_v22_Khedbrahma_LAYERS.
 *      These are turned into A3 maps with legend, scale bar and north
 *      arrow by tools/frpim_raster_atlas.py.
 *   No other script has to be run first: this one reads only the range
 *   boundary and the open datasets.
 * ###################################################################### */

var SETTINGS = {
  AOI_ASSET: 'projects/khedbrahma-range/assets/khedbrahma',
  RANGE_NAME: 'Khedbrahma',
  CRS: 'EPSG:32643',                     // UTM 43N
  DRIVE_FOLDER: 'FRPIM_v22_Khedbrahma_LAYERS',
  CS_THRESHOLD: 0.60,                    // same as the model run
  D2_MONTHS: [9, 11],                    // same as the model run
  MAKE_EXPORT_TASKS: true,               // false = only view the layers
  PNG_PIXELS: 2400,                      // width of the quick PNG download
  FIRST_LAYER: 'A0'                      // layer shown when the script starts
};

