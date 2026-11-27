// FRPIM v2.2 — copy the Sub-division 2 prepared block table to Google Drive (one light task).
// Paste into a NEW script in the raygadh-range project, press Run, then Tasks -> RUN the one task.
var ID = 'projects/raygadh-range/assets/FRPIM_v22_prepared_blocks_SBK_SD2';
var t = ee.FeatureCollection(ID);
Export.table.toDrive({
  collection: t,
  description: 'SD2_prepared_blocks_to_Drive',
  folder: 'FRPIM_v22_SBK_SD2',
  fileNamePrefix: 'FRPIM_v22_prepared_blocks_SBK_SD2',
  fileFormat: 'GeoJSON'
});
print('One task created: Tasks tab -> RUN "SD2_prepared_blocks_to_Drive".');
print('It writes FRPIM_v22_prepared_blocks_SBK_SD2.geojson to the Drive folder FRPIM_v22_SBK_SD2.');
