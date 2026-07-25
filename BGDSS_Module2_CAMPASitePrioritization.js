/**
 * ============================================================================
 *  BGDSS - MODULE 2: CAMPA SITE PRIORITIZATION
 *  Pilot: Sabarkantha Forest Division, Gujarat Forest Department
 *  Platform: Google Earth Engine (JavaScript API)
 * ============================================================================
 *
 *  STANDALONE SCRIPT - paste this into a NEW Earth Engine script and run it
 *  on its own. It does not depend on the Fire Risk module or any other
 *  BGDSS file.
 *
 *  PURPOSE
 *  ---------------------------------------------------------------------------
 *  Ranks every block of the beat by its priority for CAMPA-fundable
 *  treatment (New Plantation / Assisted Natural Regeneration (ANR) / Soil &
 *  Water Conservation works), then proposes the highest-ranked blocks up to
 *  a target treatment area - i.e. the GIS ranks the sites; the DPR narrates
 *  and justifies the ranking. This is the evidentiary backbone for the
 *  companion CAMPA DPR document.
 *
 *  METHODOLOGY
 *  ---------------------------------------------------------------------------
 *  1. TREATMENT ELIGIBILITY (pixel level): canopy density from Hansen Global
 *     Forest Change classifies each pixel as a New Plantation candidate
 *     (<10% canopy, non-forest/degraded per ESA WorldCover), an ANR
 *     candidate (10-40% canopy - already has root stock/coppice potential,
 *     the standard Indian JFM/working-plan threshold for regeneration over
 *     planting), or Not Prioritized (>40% canopy - already reasonably
 *     stocked, or cropland/built-up/water per WorldCover, which CAMPA does
 *     not plant on).
 *  2. PRIORITY SCORE (0-1, weighted overlay of, per eligible pixel):
 *       - Degradation severity (lower canopy = higher priority)
 *       - Soil erosion risk (RUSLE, India R/C factors - see SOIL section)
 *       - Carbon-gain potential (reference dry-deciduous AGB benchmark
 *         minus current biomass - see CARBON section for the stated
 *         assumption this depends on)
 *       - Site workability (gentler slope, adequate rainfall favoured -
 *         same logic as the BGDSS Plantation Suitability engine)
 *  3. BLOCK AGGREGATION: pixels are grouped into a regular grid of
 *     CONFIG.blockSizeM blocks (a practical fencing/protection-unit size,
 *     not a single pixel) - CAMPA site-specific schemes are planned and
 *     costed at the block/compartment level, not the pixel level.
 *  4. RANKING: blocks are sorted by mean priority score, and the top blocks
 *     are selected by CUMULATIVE AREA until CONFIG.targetTreatmentAreaHa is
 *     reached - the ranked table this produces is exactly the "why these
 *     hectares and not others" evidence a CAMPA APO submission needs.
 *
 *  COST AND CARBON FIGURES ARE NOT INVENTED. Every rupee or tonne figure
 *  this script prints is clearly labelled as an ASSUMPTION with its basis
 *  stated in CONFIG - replace with your Range's current CAMPA APO per-
 *  hectare rate and your Working Plan's local volume-table/ISFR figures
 *  before this leaves draft status.
 *
 *  HOW TO USE
 *  ---------------------------------------------------------------------------
 *  1. Edit CONFIG below (your beat asset is already filled in).
 *  2. Set CONFIG.targetTreatmentAreaHa to however many hectares this CAMPA
 *     cycle can actually fund (ask your Range's APO figure) - the script
 *     will propose exactly that much area, in the best-ranked blocks.
 *  3. Run. A ranked block table prints to Console; a CSV of every block
 *     (selected and not) and GeoTIFF/Shapefile outputs are queued in the
 *     Tasks tab.
 * ============================================================================
 */

// ============================================================================
// CONFIG - the only section to edit
// ============================================================================
var CONFIG = {
  roi: ee.FeatureCollection('projects/raygadh-range/assets/BEAT'),
  year: 2025,

  district: 'Sabarkantha',
  state: 'Gujarat',
  unitName: 'BEAT',

  scale: 10,                        // analysis resolution, meters
  blockSizeM: 300,                  // ~9 ha planning blocks (fencing/protection
                                     // unit size) - reduce for finer ranking,
                                     // increase if the beat is very large and
                                     // reduceRegions runs slowly
  exportFolder: 'BGDSS',
  exportPrefix: 'BGDSS_CAMPA',

  // How many hectares this CAMPA cycle can actually fund. ASSUMPTION -
  // replace with your Range's approved APO (Annual Plan of Operation)
  // figure. The script proposes exactly this much area, best-ranked first.
  targetTreatmentAreaHa: 200,

  // Eligibility thresholds (Hansen treecover2000, %)
  newPlantationCanopyMax: 10,       // below this = New Plantation candidate
  anrCanopyMax: 40,                 // 10-40% = ANR candidate; above = not prioritized

  // Priority-score weights (edit with your Range/DFO team's judgment -
  // these are a defensible starting point, not a fixed rule)
  weights: {
    degradation: 0.35,              // lower canopy -> higher priority
    erosionRisk: 0.30,               // RUSLE soil loss -> S&WC co-benefit
    carbonGainPotential: 0.20,       // AGB deficit vs reference benchmark
    workability: 0.15                // gentler slope + adequate rainfall
  },

  // ---- COST ASSUMPTION (ASSUMPTION - VERIFY) ------------------------------
  // CAMPA per-hectare cost varies by treatment and state; this range
  // reflects commonly cited Indian CAMPA/afforestation planning figures
  // (block plantation with 3-year maintenance, fencing, and beat-guard
  // protection) and is NOT a Gujarat-specific rate. Replace with the
  // current Gujarat Forest Department / State CAMPA APO Schedule of Rates
  // figure for your Range before quoting this in a funding submission.
  costPerHaINR: { newPlantation: 65000, anr: 30000, soilWaterConservation: 45000 },

  // ---- CARBON ASSUMPTION (ASSUMPTION - VERIFY) ----------------------------
  // Reference AGB benchmark for a well-stocked Northern Dry Deciduous
  // (Champion & Seth Group 5B) stand. ASSUMPTION pending your Working
  // Plan's local volume-table figures or the Gujarat-specific value in the
  // current ISFR (India State of Forest Report, FSI) - substitute the real
  // figure once available; this is a planning-stage placeholder.
  referenceAgbTPerHa: 120,
  rootShootRatio: 0.28,             // IPCC 2006 Table 4.4, tropical/subtropical
                                     // dry forest, AGB > ~20 t/ha
  carbonFraction: 0.5,              // FSI/ISFR convention (vs IPCC 0.47)
  co2Conversion: 3.6663,
  restorationHorizonYears: 10       // years over which the AGB deficit is
                                     // assumed to close (planning horizon,
                                     // not a growth-curve model)
};

var roi = CONFIG.roi.geometry();
try { Map.centerObject(CONFIG.roi, 12); Map.setOptions('SATELLITE'); } catch (e) {}

// ============================================================================
// HELPERS (same defensive pattern as Module 1 - every criterion below is
// .unmask()'d before combining, so a real data gap falls back to a stated
// neutral value instead of silently defaulting a pixel's priority to zero)
// ============================================================================
function log(msg) { print('✓ ' + msg); }
function warn(msg) { print('⚠ ' + msg); }

function normalize(img, min, max, invert) {
  var n = img.subtract(min).divide(max - min).clamp(0, 1);
  return invert ? ee.Image(1).subtract(n) : n;
}

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
// 1. TERRAIN (slope - workability criterion)
// ============================================================================
var dem = safeMosaic('JAXA/ALOS/AW3D30/V3_2', 'DSM', 'DEM');
var slope = null;
if (dem) {
  dem = dem.clip(roi).rename('elevation').toFloat()
    .resample('bilinear')
    .reproject({ crs: 'EPSG:32643', scale: CONFIG.scale });
  slope = ee.Terrain.slope(dem);
  log('DEM / Slope ready');
}

// ============================================================================
// 2. FOREST COVER / DEGRADATION STATUS (Hansen canopy + ESA WorldCover mask)
// ============================================================================
var hansen = safeImage('UMD/hansen/global_forest_change_2023_v1_11', 'Hansen canopy cover');
var canopyDensity = hansen ? hansen.select('treecover2000').resample('bilinear').clip(roi) : null;

var worldCover = safeMosaic('ESA/WorldCover/v200', 'Map', 'ESA WorldCover');
// CAMPA does not plant on cropland (40), built-up (50), or water (80) -
// exclude those classes from eligibility regardless of canopy reading.
var plantableMask = worldCover
  ? worldCover.neq(40).and(worldCover.neq(50)).and(worldCover.neq(80)).clip(roi)
  : ee.Image(1).clip(roi);
if (!worldCover) { warn('ESA WorldCover unavailable - cropland/built-up/water cannot be excluded from eligibility; verify manually'); }

if (!canopyDensity) {
  warn('Hansen canopy data unavailable. Skipping module - degradation status cannot be assessed without it.');
} else {
  log('Canopy density / plantable-land mask ready');
}

// ============================================================================
// 3. CLIMATE (annual rainfall - workability criterion)
// ============================================================================
var yStart = ee.Date.fromYMD(CONFIG.year, 1, 1);
var yEnd = yStart.advance(1, 'year');
var chirps = safeCollection('UCSB-CHG/CHIRPS/DAILY', 'CHIRPS rainfall');
var rainfall = chirps
  ? chirps.filterDate(yStart, yEnd).sum().resample('bilinear').clip(roi).rename('rainfall')
  : null;
if (rainfall) { log('Annual rainfall computed'); }

// ============================================================================
// 4. SOIL EROSION RISK (RUSLE, Indian R/C factors - same method as the full
//    BGDSS Soil Engine: Singh/Babu/Chandra 1981 CSWCRTI rainfall erosivity,
//    NRSC/ISRO Soil Erosion Atlas land-cover cover-factor lookup)
// ============================================================================
var soilLoss = null;
if (slope && rainfall) {
  var R = rainfall.multiply(0.363).add(79); // CSWCRTI Dehradun, Indian rainfall regimes
  var K = ee.Image(0.28); // documented constant fallback (loam average) -
                           // replace with OpenLandMap-derived K if higher
                           // precision is needed (see full BGDSS Soil Engine)
  var slopeRad = slope.multiply(Math.PI / 180);
  var LS = slope.focal_sum({ radius: 10, kernelType: 'circle', units: 'pixels' })
    .multiply(CONFIG.scale).divide(22.13).pow(0.4)
    .multiply(slopeRad.sin().divide(0.0896).pow(1.3));
  var lcClasses = [10, 20, 30, 40, 50, 60, 90, 95, 100];
  var lcCValues = [0.01, 0.05, 0.03, 0.28, 0.0, 0.45, 0.02, 0.01, 0.05];
  var C = worldCover
    ? worldCover.select('Map').remap(lcClasses, lcCValues, 0.2).clip(roi)
    : ee.Image(0.2);
  soilLoss = R.multiply(K).multiply(LS).multiply(C).rename('soilLoss').clip(roi);
  log('RUSLE soil loss computed (Indian R/C factors)');
} else {
  warn('Slope/rainfall unavailable - Soil Erosion Risk criterion defaulted to neutral');
}

// ============================================================================
// 5. CARBON-GAIN POTENTIAL (ESA CCI Biomass if available, else NDVI proxy -
//    same fallback as the full BGDSS Biomass Engine)
// ============================================================================
var cciBiomass = safeImage('projects/sat-io/open-datasets/ESA/ESA_CCI_AGB', 'ESA CCI Biomass'); // verify id
var s2 = safeCollection('COPERNICUS/S2_SR_HARMONIZED', 'Sentinel-2');
var currentAgb = null;
if (cciBiomass) {
  currentAgb = cciBiomass.select(0).clip(roi).rename('agb');
  log('ESA CCI Biomass loaded for carbon-gain potential');
} else if (s2) {
  var composite = s2.filterDate(yStart, yEnd).filterBounds(roi)
    .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 40))
    .map(function (img) {
      var scl = img.select('SCL');
      var clear = scl.neq(3).and(scl.neq(8)).and(scl.neq(9)).and(scl.neq(10)).and(scl.neq(11));
      return img.updateMask(clear).divide(10000);
    }).median().clip(roi);
  var ndvi = composite.normalizedDifference(['B8', 'B4']);
  currentAgb = ndvi.multiply(250).max(0).rename('agb');
  warn('ESA CCI Biomass unavailable - using NDVI-based AGB proxy for carbon-gain potential');
} else {
  warn('No biomass or Sentinel-2 data available - Carbon-Gain Potential criterion defaulted to neutral');
}

// ============================================================================
// 6. TREATMENT ELIGIBILITY + PRIORITY SCORE (pixel level)
// ----------------------------------------------------------------------------
// treatment: 1 = New Plantation, 2 = ANR, 0 = Not Prioritized
// ============================================================================
var treatment = null, priorityScore = null;
if (canopyDensity) {
  treatment = ee.Image(0)
    .where(canopyDensity.lt(CONFIG.newPlantationCanopyMax), 1)
    .where(canopyDensity.gte(CONFIG.newPlantationCanopyMax).and(canopyDensity.lt(CONFIG.anrCanopyMax)), 2)
    .updateMask(plantableMask)
    .rename('treatment').clip(roi);

  var degradationNorm = normalize(canopyDensity, 0, CONFIG.anrCanopyMax, true).unmask(0.5);
  var erosionNorm = soilLoss ? normalize(soilLoss, 0, 40, false).unmask(0.5) : ee.Image(0.5);
  var carbonGainNorm = currentAgb
    ? normalize(ee.Image(CONFIG.referenceAgbTPerHa).subtract(currentAgb).max(0), 0, CONFIG.referenceAgbTPerHa, false).unmask(0.5)
    : ee.Image(0.5);
  var slopeWorkNorm = slope ? normalize(slope, 0, 30, true).unmask(0.5) : ee.Image(0.5);
  var rainWorkNorm = rainfall ? normalize(rainfall, 300, 1500, false).unmask(0.5) : ee.Image(0.5);
  var workabilityNorm = slopeWorkNorm.multiply(0.6).add(rainWorkNorm.multiply(0.4));

  var w = CONFIG.weights;
  var wSum = w.degradation + w.erosionRisk + w.carbonGainPotential + w.workability;
  priorityScore = degradationNorm.multiply(w.degradation / wSum)
    .add(erosionNorm.multiply(w.erosionRisk / wSum))
    .add(carbonGainNorm.multiply(w.carbonGainPotential / wSum))
    .add(workabilityNorm.multiply(w.workability / wSum))
    .updateMask(treatment.gt(0))
    .rename('priorityScore').clip(roi);

  log('Treatment eligibility + Priority Score computed');
} else {
  warn('Cannot compute treatment eligibility without canopy data. Stopping.');
}

// ============================================================================
// 7. BLOCK AGGREGATION + RANKING
// ============================================================================
if (treatment && priorityScore) {
  // Clip each grid cell to the beat boundary so edge blocks don't extend
  // past it; degenerate slivers are dropped client-side below (areaHa > 0.1).
  var grid = roi.coveringGrid('EPSG:32643', CONFIG.blockSizeM)
    .map(function (f) { return f.intersection(roi, 1); });

  var blockInput = ee.Image.pixelArea().divide(1e4).rename('areaHa')
    .addBands(priorityScore)
    .addBands(treatment)
    .addBands(soilLoss ? soilLoss.rename('soilLoss') : ee.Image(0).rename('soilLoss'))
    .addBands(currentAgb ? ee.Image(CONFIG.referenceAgbTPerHa).subtract(currentAgb).max(0).rename('agbDeficit') : ee.Image(0).rename('agbDeficit'));

  // Per block: computes BOTH mean and sum for every band (sharedInputs:true)
  // so areaHa_sum (total block area), priorityScore_mean/soilLoss_mean/
  // agbDeficit_mean (zonal averages) and treatment_mode (the DOMINANT
  // treatment type in the block, not an averaged/rounded code, which would
  // mislabel a mixed block) are all available; unused combinations
  // (areaHa_mean, priorityScore_sum, etc.) are ignored.
  var combinedReducer = ee.Reducer.mean()
    .combine({ reducer2: ee.Reducer.sum(), sharedInputs: true })
    .combine({ reducer2: ee.Reducer.mode(), sharedInputs: true });
  var blockStats = blockInput.reduceRegions({
    collection: grid,
    reducer: combinedReducer,
    scale: CONFIG.scale,
    tileScale: 4
  });

  blockStats.evaluate(function (fc) {
    var feats = (fc && fc.features) || [];
    var blocks = feats.map(function (f, idx) {
      var p = f.properties || {};
      return {
        id: idx + 1,
        areaHa: Number((p.areaHa_sum || 0).toFixed(2)),
        priority: Number((p.priorityScore_mean || 0).toFixed(3)),
        treatmentCode: Math.round(p.treatment_mode || 0),
        soilLoss: Number((p.soilLoss_mean || 0).toFixed(1)),
        agbDeficit: Number((p.agbDeficit_mean || 0).toFixed(1))
      };
    }).filter(function (b) { return b.areaHa > 0.1 && b.priority > 0; });

    blocks.sort(function (a, b) { return b.priority - a.priority; });

    var cumulative = 0;
    var TREATMENT_LABEL = { 0: 'Not Prioritized', 1: 'New Plantation', 2: 'ANR' };
    blocks.forEach(function (b) {
      cumulative += b.areaHa;
      b.cumulativeAreaHa = Number(cumulative.toFixed(2));
      b.selected = cumulative <= CONFIG.targetTreatmentAreaHa;
      b.treatmentLabel = TREATMENT_LABEL[b.treatmentCode] || 'Not Prioritized';
    });

    var selectedBlocks = blocks.filter(function (b) { return b.selected; });
    var selectedAreaHa = selectedBlocks.reduce(function (s, b) { return s + b.areaHa; }, 0);
    var totalCost = selectedBlocks.reduce(function (s, b) {
      var rate = b.treatmentCode === 1 ? CONFIG.costPerHaINR.newPlantation
        : b.treatmentCode === 2 ? CONFIG.costPerHaINR.anr
        : CONFIG.costPerHaINR.soilWaterConservation;
      return s + b.areaHa * rate;
    }, 0);
    var totalCarbonGainTonnes = selectedBlocks.reduce(function (s, b) {
      return s + b.areaHa * b.agbDeficit * (1 + CONFIG.rootShootRatio) * CONFIG.carbonFraction;
    }, 0);

    print('================================================================');
    print('CAMPA SITE PRIORITIZATION - ' + CONFIG.unitName + ', ' + CONFIG.district + ', ' + CONFIG.state + ' (' + CONFIG.year + ')');
    print('================================================================');
    print('Eligible blocks found: ' + blocks.length + ' (' + Math.round(blocks.reduce(function (s, b) { return s + b.areaHa; }, 0)) + ' ha total eligible)');
    print('Selected (top-ranked, up to target): ' + selectedBlocks.length + ' blocks, ' + Math.round(selectedAreaHa) + ' ha (target was ' + CONFIG.targetTreatmentAreaHa + ' ha)');
    print('----------------------------------------------------------------');
    print('ASSUMPTION - VERIFY before submission:');
    print('Estimated cost @ stated placeholder rates: Rs ' + Math.round(totalCost).toLocaleString('en-IN'));
    print('Estimated carbon gain over ' + CONFIG.restorationHorizonYears + ' yr horizon: ' + Math.round(totalCarbonGainTonnes) + ' tonnes C ('
      + Math.round(totalCarbonGainTonnes * CONFIG.co2Conversion) + ' tonnes CO2e)');
    print('================================================================');
    print('Top 10 ranked blocks:');
    selectedBlocks.slice(0, 10).forEach(function (b) {
      print('#' + b.id + ' | ' + b.areaHa + ' ha | Priority ' + b.priority + ' | ' + b.treatmentLabel + ' | Soil loss ' + b.soilLoss + ' t/ha/yr');
    });

    // ---- Export ranked block table (every block, selected flag included) --
    var rows = blocks.map(function (b) {
      return ee.Feature(null, {
        'Block ID': b.id,
        'Area (ha)': b.areaHa,
        'Priority Score': b.priority,
        'Recommended Treatment': b.treatmentLabel,
        'Soil Loss (t/ha/yr)': b.soilLoss,
        'AGB Deficit (t/ha)': b.agbDeficit,
        'Cumulative Area (ha)': b.cumulativeAreaHa,
        'Selected This Cycle': b.selected ? 'YES' : 'no'
      });
    });
    Export.table.toDrive({
      collection: ee.FeatureCollection(rows),
      description: CONFIG.exportPrefix + '_RankedBlocks',
      folder: CONFIG.exportFolder,
      fileNamePrefix: CONFIG.exportPrefix + '_RankedBlocks',
      fileFormat: 'CSV'
    });
  });

  // ---- Visualization ---------------------------------------------------------
  Map.addLayer(priorityScore, { min: 0, max: 1, palette: ['fee08b', 'fc8d59', 'd73027'] }, 'CAMPA Priority Score', true);
  Map.addLayer(treatment.selfMask(), { min: 1, max: 2, palette: ['1a9850', '2b83ba'] }, 'Recommended Treatment (1=New Plantation, 2=ANR)', false);
  try {
    var gridOutline = ee.Image().byte().paint({ featureCollection: grid, color: 1, width: 1 });
    Map.addLayer(gridOutline, { palette: ['ffffff'] }, 'Planning Blocks (' + CONFIG.blockSizeM + 'm)', false);
  } catch (e) {}

  try {
    var legend = ui.Panel({ style: { position: 'bottom-left', padding: '8px 15px' } });
    legend.add(ui.Label('CAMPA Site Priority', { fontWeight: 'bold', fontSize: '15px', margin: '0 0 4px 0' }));
    legend.add(ui.Label('Higher = higher priority for CAMPA-funded treatment', { fontSize: '11px', color: '666666', margin: '0 0 4px 0' }));
    Map.add(legend);
  } catch (e) {}

  // ---- Raster exports ---------------------------------------------------------
  Export.image.toDrive({
    image: priorityScore,
    description: CONFIG.exportPrefix + '_PriorityScore',
    folder: CONFIG.exportFolder,
    fileNamePrefix: CONFIG.exportPrefix + '_PriorityScore',
    region: roi.bounds(), scale: CONFIG.scale, crs: 'EPSG:32643', maxPixels: 1e13
  });
  Export.image.toDrive({
    image: treatment.toInt(),
    description: CONFIG.exportPrefix + '_TreatmentType',
    folder: CONFIG.exportFolder,
    fileNamePrefix: CONFIG.exportPrefix + '_TreatmentType',
    region: roi.bounds(), scale: CONFIG.scale, crs: 'EPSG:32643', maxPixels: 1e13
  });
  Export.table.toDrive({
    collection: grid,
    description: CONFIG.exportPrefix + '_PlanningBlocks',
    folder: CONFIG.exportFolder,
    fileNamePrefix: CONFIG.exportPrefix + '_PlanningBlocks',
    fileFormat: 'SHP'
  });

  log('CAMPA Site Prioritization module complete. Check Console for the ranked list; run the 3 tasks in the Tasks tab for CSV/GeoTIFF/Shapefile outputs.');
}
