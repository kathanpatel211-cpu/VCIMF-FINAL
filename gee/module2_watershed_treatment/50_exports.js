/**
 * 50_exports.js — Part 9: exports
 * crs: EPSG:32643, scale: 30, maxPixels: 1e13 — enforced here, not left to caller defaults.
 */

var config = require('users/<you>/VCIMF-FINAL:gee/module2_watershed_treatment/00_config.js');

var EXPORT_DEFAULTS = {crs: config.CRS, scale: config.SCALE, maxPixels: 1e13};

function exportWatershedTable(fc, description, folder) {
  Export.table.toDrive({
    collection: fc, description: description, folder: folder || 'Module2_CAT',
    fileFormat: 'CSV'
  });
  Export.table.toDrive({
    collection: fc, description: description + '_geojson', folder: folder || 'Module2_CAT',
    fileFormat: 'GeoJSON'
  });
}

function exportRaster(image, description, region, folder, scaleOverride) {
  Export.image.toDrive({
    image: image, description: description, folder: folder || 'Module2_CAT',
    region: region, crs: EXPORT_DEFAULTS.crs, scale: scaleOverride || EXPORT_DEFAULTS.scale,
    maxPixels: EXPORT_DEFAULTS.maxPixels
  });
}

function exportAll(outputs) {
  // outputs: {
  //   microwatershedsPrioritised, priorityClassMap, criterionNormalisedTable,
  //   syiByWatershed, treatmentZones (image), structureSites, quantityEstimates,
  //   waterBalanceCheck, existingStructures, desiltingCandidates, convergenceMap,
  //   correlationMatrix, sensitivityResults, region
  // }
  if (outputs.microwatershedsPrioritised) exportWatershedTable(outputs.microwatershedsPrioritised, 'microwatersheds_prioritised');
  if (outputs.priorityClassMap) exportWatershedTable(outputs.priorityClassMap, 'priority_class_map');
  if (outputs.criterionNormalisedTable) exportWatershedTable(outputs.criterionNormalisedTable, 'criterion_normalised_audit_trail');
  if (outputs.syiByWatershed) exportWatershedTable(outputs.syiByWatershed, 'SYI_by_watershed');
  if (outputs.treatmentZones) exportRaster(outputs.treatmentZones, 'treatment_zones', outputs.region);
  if (outputs.structureSites) exportWatershedTable(outputs.structureSites, 'structure_sites');
  if (outputs.quantityEstimates) exportWatershedTable(outputs.quantityEstimates, 'quantity_estimates');
  if (outputs.waterBalanceCheck) exportWatershedTable(outputs.waterBalanceCheck, 'water_balance_check');
  if (outputs.existingStructures) exportWatershedTable(outputs.existingStructures, 'existing_structures');
  if (outputs.desiltingCandidates) exportWatershedTable(outputs.desiltingCandidates, 'desilting_candidates');
  if (outputs.convergenceMap) exportWatershedTable(outputs.convergenceMap, 'convergence_map');
  if (outputs.correlationMatrix) exportWatershedTable(outputs.correlationMatrix, 'correlation_matrix');
  if (outputs.sensitivityResults) exportWatershedTable(outputs.sensitivityResults, 'sensitivity_results');

  print('ℹ All exports queued to Tasks tab. Nothing runs until each task is ' +
        'manually started (or batch-started) in the GEE Code Editor.');
}

exports.EXPORT_DEFAULTS = EXPORT_DEFAULTS;
exports.exportWatershedTable = exportWatershedTable;
exports.exportRaster = exportRaster;
exports.exportAll = exportAll;
