/* ######################################################################
 *  PPI-SK v2.1 — Plantation Priority Index, Khedbrahma Range
 *  SCRIPT 03_validation   (optional, build steps 26-27, Section 15)
 *  ----------------------------------------------------------------------
 *  V1  Vegetation as a site gauge : undisturbed retained blocks
 *      (E1 = 1, D4 = 0, E2 >= 0.6). Spearman rho between the suitability
 *      core A^a * B^b and (i) mean Meta canopy height, (ii) Sep-Nov
 *      Landsat NDVI 2021-2025 median.
 *  V2  Recovery after clearing    : Hansen loss 2016-2018 pixels.
 *      Ratio = Sep-Nov NDVI 2023-25 / Sep-Nov NDVI of the 2 years before
 *      the loss year. Spearman rho(core, block mean ratio) and AUC
 *      (Mann-Whitney) for "recovered" = ratio >= 0.80.
 *  Run after 02_scoring (needs the FINAL asset). Paste -> Run -> Tasks.
 * ###################################################################### */

var CFG = {
  RANGE_NAME: 'Khedbrahma',
  AOI_ASSET: 'projects/khedbrahma-range/assets/khedbrahma',
  FINAL_ASSET: 'projects/khedbrahma-range/assets/PPI_SK_v21_final_blocks_Khedbrahma',
  DRIVE_FOLDER: 'PPI_SK_v21',
  MIN_LOSS_PIXELS: 5,            // a block needs >= 5 loss pixels (0.45 ha) for V2
  RECOVERED_RATIO: 0.80,
  TILE_SCALE: 4
};

var AOI = ee.FeatureCollection(CFG.AOI_ASSET).geometry().dissolve({maxError: 1});
var fin = ee.FeatureCollection(CFG.FINAL_ASSET);
var CRS = ee.Feature(fin.first()).get('work_crs').getInfo();

/* ---------- datasets (same IDs as Section 5) ---------- */
var chmCol = ee.ImageCollection('projects/sat-io/open-datasets/facebook/meta-canopy-height').filterBounds(AOI);
var chm = chmCol.mosaic().setDefaultProjection(ee.Image(chmCol.first()).projection()).select([0]);
var chm10 = chm.reduceResolution({reducer: ee.Reducer.mean(), maxPixels: 128}).reproject({crs: CRS, scale: 10});
var lossyear = ee.Image('UMD/hansen/global_forest_change_2025_v1_13').select('lossyear').unmask(0);

function lsCol(start, end) {
  return ee.ImageCollection('LANDSAT/LC08/C02/T1_L2').merge(ee.ImageCollection('LANDSAT/LC09/C02/T1_L2'))
    .filterBounds(AOI).filterDate(start, end)
    .map(function (img) {
      var clear = img.select('QA_PIXEL').bitwiseAnd(63).eq(0);
      var sr = img.select(['SR_B4', 'SR_B5']).multiply(0.0000275).add(-0.2);
      return ee.Image(sr.normalizedDifference(['SR_B5', 'SR_B4']).rename('NDVI').updateMask(clear)
        .copyProperties(img, ['system:time_start']));
    });
}
function sepNov(y1, y2) {           // median of all Sep-Nov scenes in years y1..y2
  var c = ee.ImageCollection([]);
  for (var y = y1; y <= y2; y++) { c = c.merge(lsCol(y + '-09-01', y + '-12-01')); }
  return c.median();
}

/* ---------- block-level suitability core ---------- */
var retained = fin.filter(ee.Filter.eq('excluded', 0));

/* ---------- V1 ---------- */
var v1Sample = retained.filter(ee.Filter.eq('E1', 1)).filter(ee.Filter.eq('D4', 0))
                       .filter(ee.Filter.gte('E2', 0.6));
var v1Img = chm10.rename('chm_mean').addBands(sepNov(2021, 2025).rename('ndvi_sepnov'));
var v1 = v1Img.reduceRegions({collection: v1Sample, reducer: ee.Reducer.mean(), scale: 30, crs: CRS,
                              tileScale: CFG.TILE_SCALE});
function spearman(fc, a, b) {
  fc = fc.filter(ee.Filter.notNull([a, b]));
  return ee.Number(ee.Dictionary(fc.reduceColumns(ee.Reducer.spearmansCorrelation(), [a, b])).values().get(0));
}
var v1n = v1.filter(ee.Filter.notNull(['chm_mean'])).size();
var rhoV1h = spearman(v1, 'suit_core', 'chm_mean');
var rhoV1n = spearman(v1, 'suit_core', 'ndvi_sepnov');

/* ---------- V2 ---------- */
var pre16 = sepNov(2014, 2015), pre17 = sepNov(2015, 2016), pre18 = sepNov(2016, 2017);
var pre = pre16.where(lossyear.eq(17), pre17).where(lossyear.eq(18), pre18);
var post = sepNov(2023, 2025);
var lossMask = lossyear.gte(16).and(lossyear.lte(18));
var ratio = post.divide(pre).updateMask(lossMask).updateMask(pre.gt(0.1)).rename('recovery_ratio');
var v2 = ratio.reduceRegions({collection: retained,
  reducer: ee.Reducer.mean().combine({reducer2: ee.Reducer.count(), sharedInputs: true}),
  scale: 30, crs: CRS, tileScale: CFG.TILE_SCALE})
  .filter(ee.Filter.gte('count', CFG.MIN_LOSS_PIXELS))
  .map(function (f) {
    return f.set('recovered', ee.Number(f.get('mean')).gte(CFG.RECOVERED_RATIO));
  });
var v2n = v2.size();
var rhoV2 = spearman(v2, 'suit_core', 'mean');

// AUC by the Mann-Whitney rank formula, in ee.Array (ties take sequential ranks)
var NV2 = v2n;
var core = ee.Array(v2.aggregate_array('suit_core'));
var rec = ee.Array(v2.aggregate_array('recovered'));
var idx = ee.Array(ee.List.sequence(0, NV2.subtract(1)));
var rank = idx.sort(idx.sort(core)).add(ee.Array(ee.List.repeat(1, NV2)));   // 1-based
var n1 = rec.reduce(ee.Reducer.sum(), [0]).get([0]);
var n0 = NV2.subtract(n1);
var R1 = rank.multiply(rec).reduce(ee.Reducer.sum(), [0]).get([0]);
var AUC = ee.Number(R1).subtract(ee.Number(n1).multiply(ee.Number(n1).add(1)).divide(2))
          .divide(ee.Number(n1).multiply(n0).max(1));

/* ---------- decision rule (Section 15) ---------- */
var minRho = ee.Number(ee.List([rhoV1h, rhoV1n, rhoV2]).reduce(ee.Reducer.min()));
var reading = ee.Algorithms.If(minRho.gte(0.30).and(AUC.gte(0.65)),
  'Suitability core supported - state this in the DPR',
  ee.Algorithms.If(minRho.gte(0.10), 'Weak support - keep as ranking aid, widen field checks',
                   'Re-examine the A and B weights before use'));

var REPORT = ee.FeatureCollection([
  ee.Feature(null, {test: 'V1 canopy height', n_blocks: v1n, spearman_rho: rhoV1h, auc: ''}),
  ee.Feature(null, {test: 'V1 Sep-Nov NDVI', n_blocks: v1n, spearman_rho: rhoV1n, auc: ''}),
  ee.Feature(null, {test: 'V2 recovery ratio', n_blocks: v2n, spearman_rho: rhoV2, auc: AUC,
                    n_recovered: n1, n_not_recovered: n0}),
  ee.Feature(null, {test: 'Decision', n_blocks: '', spearman_rho: minRho, auc: AUC, reading: reading})
]);

Export.table.toDrive({collection: REPORT, description: 'PPI03_validation_report', folder: CFG.DRIVE_FOLDER,
  fileNamePrefix: 'PPI03_validation_report_' + CFG.RANGE_NAME, fileFormat: 'CSV'});
print('Validation report is computed in the export task (Tasks tab -> RUN).');
print('Interactive preview (may time out on large ranges):', REPORT);

Map.centerObject(AOI, 11);
Map.addLayer(ratio.clip(AOI), {min: 0.4, max: 1.2, palette: ['#d73027', '#ffffbf', '#1a9850']},
             'V2 recovery ratio (loss 2016-18)', false);
Map.addLayer(chm10.clip(AOI), {min: 0, max: 15, palette: ['#ffffcc', '#006837']}, 'Meta canopy height (10 m mean)', false);
