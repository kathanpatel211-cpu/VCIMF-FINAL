/**
 * ============================================================================
 *  BGDSS - MODULE 2: CAMPA SITE PRIORITIZATION
 *  v6.0.0 - Single-purpose rebuild: ONE CAMPA Priority Score, FIVE classes,
 *           covering the whole treatable area, with hectares/cost/carbon per
 *           class. New Plantation only (ANR is not operational under Gujarat
 *           CAMPA). No user-supplied layers required.
 *
 *  Pilot: Sabarkantha Forest Division, Gujarat Forest Department
 *  Platform: Google Earth Engine (JavaScript API)
 * ============================================================================
 *
 *  STANDALONE SCRIPT - paste into a NEW Earth Engine script and run on its own.
 *
 * ----------------------------------------------------------------------------
 *  WHY v6 IS A REWRITE, NOT A PATCH
 * ----------------------------------------------------------------------------
 *  v5 accumulated three competing MCDA methods (WLC/TOPSIS/Weighted Geometric
 *  Mean), Monte Carlo weight-sensitivity, a budget-constrained alternate plan,
 *  spatial contiguity clustering, a CMIP6 future-climate module, a 25-year
 *  Landsat productivity-trend module, and a satellite-only validation back-
 *  test. Each was defensible on its own, and each added server calls. Combined
 *  across 17 criteria, the aggregation repeatedly exceeded Earth Engine's
 *  per-request memory limit - a model that is theoretically comprehensive but
 *  cannot finish a run is not a working decision-support tool.
 *
 *  v6 keeps exactly one thing: a scientifically grounded CAMPA Priority Score,
 *  classified into five categories covering the WHOLE treatable area, with
 *  hectares, cost and carbon sequestration reported per category. That is the
 *  flagship output the pilot team asked for, and everything in this script
 *  serves it directly. Thirteen criteria survive - each backed by a citable,
 *  published method - down from seventeen; every criterion whose main
 *  contribution was methodological completeness rather than ranking accuracy
 *  was cut. See "WHAT WAS REMOVED AND WHY" below.
 *
 * ----------------------------------------------------------------------------
 *  METHODOLOGY
 * ----------------------------------------------------------------------------
 *  1. ELIGIBILITY (Boolean, non-compensatory - Eastman's MCDA framework).
 *     FSI 4-tier canopy classification (Scrub <10% / Open 10-40% / Moderately
 *     Dense 40-70% / Very Dense >70%) restricts treatment to Scrub + Open,
 *     matching the official India State of Forest Report convention. Hard
 *     constraints (slope, waterlogging, bare/rock ground, already-forested)
 *     are applied as pass/fail exclusions, not scored factors: a good score
 *     elsewhere cannot buy back an unsafe or already-forested site.
 *
 *  2. THIRTEEN WEIGHTED CRITERIA (Weighted Linear Combination). Each criterion
 *     is normalized 0-1 (fixed FSI-style anchors where an external standard
 *     exists; ROI-relative percentile stretch otherwise) and combined by its
 *     AHP-reasoned weight into one CAMPA Priority Score per block.
 *
 *  3. AUTOMATIC INTEGRITY AUDIT. Every criterion is checked, on every run, for
 *     SPARSE data (<70% pixel coverage) and INERT signal (near-zero spread
 *     across blocks - a criterion that cannot change any ranking regardless of
 *     its weight). A criterion that fails is dropped and its weight
 *     redistributed proportionally, with the reason printed. This is what
 *     stops a data-availability gap from silently defaulting to a flat neutral
 *     value while still consuming weight - the single most important integrity
 *     property a government decision-support tool can have, and it costs
 *     nothing extra: it is derived from the same block aggregation the score
 *     itself needs, not a separate pass over the data.
 *
 *  4. FIVE PRIORITY CLASSES, PLUS THE REST OF THE ROI. Every block with real
 *     treatable ground - not only the blocks that fit one year's area target -
 *     is assigned to one of five classes by its Priority Score (quantile by
 *     default: each class holds ~20% of scoreable blocks). Class 1 is "act
 *     first"; Class 5 is "defer". Each class is reported with block count,
 *     hectares, estimated cost and estimated tCO2e sequestered - the table a
 *     multi-year CAMPA programme phases directly off.
 *
 *     The REMAINING land - already forest, cropland/built-up/water, too
 *     steep, waterlogged, or rock/saline ground - is NOT folded into the five
 *     classes as if it were "low priority": a priority score answers "where
 *     should we plant", which is meaningless on a lake or a stand of existing
 *     dense forest. It is instead classified as NOT APPLICABLE, with its
 *     reason, and shown on the same map (grey) and in the same area table, so
 *     the WHOLE ROI is accounted for - Priority 1-5 hectares plus Not
 *     Applicable hectares sum to the total ROI area. Nothing is left blank.
 *
 * ----------------------------------------------------------------------------
 *  WHAT WAS REMOVED AND WHY
 * ----------------------------------------------------------------------------
 *  - TOPSIS, Weighted Geometric Mean, "robust set". Three aggregation methods
 *    voting on a ranking is good practice but not what was asked for, and it
 *    triples the criteria that must be interrogated whenever the ranking looks
 *    wrong. One well-audited WLC score is the deliverable.
 *  - Monte Carlo weight-sensitivity (1000 draws). Useful for a peer-reviewed
 *    paper, not for a Forest Division reading a priority map.
 *  - Budget-constrained alternate plan, spatial contiguity clustering. Neither
 *    was requested; both add output the pilot team now has to reconcile
 *    against the area-based plan.
 *  - CMIP6 future-climate resilience. Coarse (25 km) over a Beat-sized ROI, a
 *    materially heavy fetch, and its INERT check was likely to drop it anyway.
 *  - 25-year Landsat land-productivity trend (Theil-Sen). By far the single
 *    most expensive chain in v5 - four Landsat sensors, one image operation
 *    per year - for one criterion.
 *  - Satellite-only AUC validation back-test. Scientifically interesting, but
 *    a second independent sampling pass the flagship output does not need to
 *    run every time.
 *  - Structural Connectivity, Edge Density. Both required unbounded focal
 *    operations that were a repeated source of memory failures, and both were
 *    reinstated/added criteria of secondary importance next to soil, canopy,
 *    climate and carbon.
 *  - WDPA protected-area fetch, DEM-derived TPI/roughness, Meta 1 m canopy
 *    height. None fed the score; each was map-layer or cross-check
 *    decoration only.
 *
 * ----------------------------------------------------------------------------
 *  DEFECTS CARRIED FORWARD AS FIXES FROM THE v4/v5 DEBUGGING HISTORY
 * ----------------------------------------------------------------------------
 *  - CANOPY MAGNITUDE is post-monsoon (Oct-Dec) Sentinel-2 Fractional
 *    Vegetation Cover (Carlson & Ripley 1997), the same season FSI's own State
 *    of Forest Report methodology uses. Hansen GFC's treecover2000 was tried
 *    first and rejected: it is calibrated mainly against humid/evergreen
 *    canopy and returned a median of ~0% across visibly forested dry-deciduous
 *    hills in the Aravalli tract. FVC anchors (NDVI_SOIL=0.12, NDVI_VEG=0.62)
 *    are literature-typical for this forest type/season, not locally
 *    calibrated - field-verify before quoting the absolute percentage; the FSI
 *    CLASS a pixel falls in is far more robust than the exact number.
 *  - DEM PROJECTION. mosaic() discards projection, and slope computed on a
 *    projection-less image is meaningless - this previously rejected 100% of
 *    the ROI on the slope constraint. SRTM (a single properly-projected image)
 *    is now preferred; ALOS is the fallback with its projection explicitly
 *    restored before any terrain operation.
 *  - DISTANCE TRANSFORMS are bounded. unmask() produces an UNBOUNDED image
 *    (infinite extent); running fastDistanceTransform or a focal mean over it
 *    costs effectively unlimited work regardless of the ROI's real size. Every
 *    such operation here re-clips to the ROI plus the exact halo needed.
 *  - AREA ACCOUNTING. pixelArea is masked to the eligible set specifically, so
 *    a block that is mostly untreatable is not credited its full block area -
 *    the original v4 bug that silently over-stated available land.
 *  - AGGREGATION runs in small groups (not one 13-criterion call, not one
 *    call per criterion) with automatic scale coarsening and, on repeated
 *    failure, a criterion is dropped rather than the run aborting. A criterion
 *    dropped for cost is recorded exactly like one dropped for sparse or inert
 *    data - it did not inform the plan, and that has to be on the record.
 *
 * ----------------------------------------------------------------------------
 *  KNOWN LIMITS - STATE THESE
 * ----------------------------------------------------------------------------
 *  - WEIGHTS ARE A REASONED ALLOCATION, NOT A FRESH AHP ELICITATION. Re-run
 *    BGDSS_AHP_Weighting_Calculator.html on this 13-criterion list (report the
 *    Consistency Ratio, must be < 0.10) and paste the export into
 *    CONFIG.weights. The integrity audit and the applied-weights table make
 *    the model's actual behaviour visible in the meantime; they do not
 *    substitute for the elicitation.
 *  - Phenological Anomaly (invasion proxy) is UNVALIDATED - a dry/wet NDVI
 *    seasonal-amplitude signal, not a trained classifier. Field-verify flagged
 *    blocks before costing clearance.
 *  - ANR is treated as non-operational by default (CONFIG.anrOperational =
 *    false), per the pilot team: Gujarat CAMPA currently executes New
 *    Plantation only. Every eligible block is prescribed and costed as New
 *    Plantation. Set the flag true if that changes.
 *  - Cost rates and reference biomass are ASSUMPTIONS pending Working Plan /
 *    ISFR figures - marked as such in the code and the output.
 *  - Effective resolution is set by the coarsest criterion actually kept
 *    (SoilGrids at 250 m, CHIRPS at ~5.6 km), not by CONFIG.scale. The
 *    provenance table prints native resolutions; quote those.
 *
 * ----------------------------------------------------------------------------
 *  HOW TO USE
 * ----------------------------------------------------------------------------
 *  1. Edit CONFIG - at minimum `roi` and `targetTreatmentAreaHa` (confirmed
 *     CAMPA APO allocation for the "selected this cycle" highlight).
 *  2. Run. Read, in order: the ROI size line, the canopy/slope percentile
 *     diagnostic, the eligibility funnel, the INTEGRITY AUDIT, the APPLIED
 *     WEIGHTS table, then the five-class PRIORITY table.
 *  3. The block shapefile, the class-summary CSV and the full ranked CSV queue
 *     in the Tasks tab once the run completes.
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

  scale: 10,                        // OUTPUT grid. NOT the effective resolution - see header.
  blockSizeM: 300,                  // ~9 ha planning blocks - the minimum reliable planning unit
  blockStatsScale: 30,              // working scale for per-block means
  aggGroupSize: 3,                  // criteria aggregated per server call - lower first if a run fails
  exportFolder: 'BGDSS',
  exportPrefix: 'BGDSS_CAMPA_v6',

  targetTreatmentAreaHa: 200,       // ASSUMPTION - confirmed APO allocation, drives the "selected this cycle" highlight
  minEligibleFrac: 0.30,            // a block below this treatable-fraction is dropped (area-accounting fix)

  // ANR (Assisted Natural Regeneration) is NOT operational under CAMPA in
  // Gujarat - only New Plantation is executed in the field. false prescribes
  // and costs every eligible block as New Plantation. Set true if that changes.
  anrOperational: false,

  // 'quantile'      - each class holds ~20% of blocks (default; always usable)
  // 'equalInterval' - each class spans an equal slice of the score range
  priorityClassMethod: 'quantile',

  // FSI (Forest Survey of India) official canopy-density classification.
  fsiCanopyClasses: { scrubMax: 10, openMax: 40, moderatelyDenseMax: 70 },

  // Hard constraints - Boolean exclusion, never traded off against a score.
  constraints: {
    maxSlopeDeg: 45,
    maxHandM: 2,                    // MERIT Hydro Height Above Nearest Drainage - waterlogging
    minTreeProbExclude: 0.65,       // Dynamic World: already well-forested, exclude
    maxBareProb: 0.55               // Dynamic World: rock/saline screen
  },

  // ---- Automatic criterion integrity audit -----------------------------
  audit: {
    minCoverage: 0.70,   // drop if valid data on < 70% of eligible pixels, OR < 70% of blocks
    minStdDev: 0.02,     // drop if normalized spread ACROSS BLOCKS is below this (cannot change a ranking)
    maxCorrelation: 0.80,// flag (not auto-drop) criterion pairs above |r| this - reported only
    autoDrop: true        // false = warn only, keep flagged criteria in the score
  },

  // ---- PROVISIONAL weights - 13 criteria, reasoned AHP-style allocation ---
  // NOT a fresh AHP elicitation - see header KNOWN LIMITS. Rescaled to sum to
  // 1.0 automatically after the audit drops anything.
  weights: {
    distanceToForest:          0.10,   // Ecological Integrity
    hydrologicalConnectivity:  0.07,
    degradationPriority:       0.08,
    soilSuitability:           0.14,   // Physical Suitability
    soilOrganicCarbon:         0.08,
    moistureAvailability:      0.05,
    workability:               0.03,
    climateExposure:           0.10,   // Climate
    carbonGainPotential:       0.09,   // Carbon & Restoration
    erosionRisk:               0.03,
    fireRisk:                  0.04,   // Risk & Feasibility
    phenologicalAnomaly:       0.09,
    humanDependency:           0.10    // Human Dimension
  },

  // Direction of preference for the two genuinely debatable criteria.
  // +1: higher raw value = higher restoration priority (need)
  // -1: higher raw value = LOWER priority (feasibility risk to a young stand)
  directions: {
    fireRisk:             -1,  // fire-prone = risk to a young plantation (default)
    phenologicalAnomaly:  -1   // invaded = clearance cost + risk (default)
  },

  // ---- Cost model - ASSUMPTION, VERIFY against Working Plan/APO ----------
  costPerHaINR: { newPlantation: 65000, clearanceSurcharge: 25000, erosionSurcharge: 32500 },

  // ---- Carbon accounting - IPCC 2019 Refinement Vol 4 Ch 4, Tier 1 --------
  carbon: {
    referenceAgbTPerHa: 120,       // ASSUMPTION - VERIFY against local Working Plan yield tables
    agbGrowthTPerHaYr: 3.0,        // New Plantation, dry tropical forest, Tier 1 default
    soilCAccrualTPerHaYr: 0.25,
    rootShootRatio: 0.28,
    carbonFraction: 0.5,           // FSI/ISFR convention
    co2Conversion: 3.6663,         // 44/12
    horizonYears: 10
  },

  fireHistoryYears: 10,

  perf: {
    demScale: 30,           // ALOS/SRTM native resolution - never pin finer
    distanceScale: 30       // distance-transform working scale
  }
};

var SCRIPT_BUILD = 'v6.1.0  (whole-ROI coverage: Priority 1-5 + explicit Not Applicable, every hectare accounted for)';
var roi = CONFIG.roi.geometry();
var PROJ = 'EPSG:32643';
try { Map.centerObject(CONFIG.roi, 12); Map.setOptions('SATELLITE'); } catch (e) {}
print('BGDSS CAMPA Module 2 - build ' + SCRIPT_BUILD);

var C = CONFIG.fsiCanopyClasses;

var PROVENANCE = [];
function prov(id, label, nativeRes, epoch, citation) {
  PROVENANCE.push({ id: id, label: label, nativeResM: nativeRes, epoch: epoch, citation: citation });
}

// ============================================================================
// HELPERS
// ============================================================================
function log(msg)  { print('OK  ' + msg); }
function warn(msg) { print('!!  ' + msg); }

// Availability probes - the only remaining BLOCKING calls. They must be
// synchronous because several fallback chains (soil, land cover, biomass)
// branch on the answer before the rest of the graph can be built.
// limit(1).size() rather than first().bandNames(): first() on an unfiltered
// global collection has to scan it, which is seconds per probe.
function safeImage(id, label) {
  try { var img = ee.Image(id); img.bandNames().getInfo(); return img; }
  catch (e) { warn(label + ' unavailable (' + id + ')'); return null; }
}
function safeCollection(id, label) {
  try { var col = ee.ImageCollection(id); col.limit(1).size().getInfo(); return col; }
  catch (e) { warn(label + ' unavailable (' + id + ')'); return null; }
}
function safeMosaic(id, band, label) {
  try {
    var col = ee.ImageCollection(id);
    col.limit(1).size().getInfo();
    return band ? col.select([band]).mosaic() : col.mosaic();
  } catch (e) { warn(label + ' unavailable (' + id + ')'); return null; }
}

// Distance transform, bounded. unmask() strips the mask, and an unmasked
// Earth Engine image has INFINITE extent - a transform over it costs
// effectively unlimited work regardless of the ROI's real size. Re-clipping to
// the ROI plus the exact halo needed restores a finite, cheap footprint.
function distanceTo(sourceMask, maxDistM) {
  var ds = CONFIG.perf.distanceScale;
  var halo = roi.bounds().buffer(maxDistM + ds * 4);
  var needed = Math.ceil(maxDistM / ds);
  var neighborhood = 32;
  while (neighborhood < needed && neighborhood < 1024) { neighborhood *= 2; }
  var m = sourceMask.unmask(0).clip(halo).reproject({ crs: PROJ, scale: ds });
  return m.fastDistanceTransform(neighborhood).sqrt()
          .multiply(ds).clamp(0, maxDistM).clip(roi);
}

// Inverted-U preference: peaks at `opt`, falls to 0 at `lo` and `hi`. Used
// where neither extreme is desirable (human accessibility).
function invertedU(img, lo, opt, hi) {
  var rising  = img.subtract(lo).divide(opt - lo);
  var falling = ee.Image(hi).subtract(img).divide(hi - opt);
  return rising.min(falling).clamp(0, 1);
}

// ============================================================================
// 1. TERRAIN
// ============================================================================
// mosaic() DISCARDS the projection, and slope on a projection-less image is
// meaningless - it has no pixel size to turn an elevation difference into a
// gradient. SRTM is a single ee.Image with a proper 30 m projection, so
// nothing can be lost; ALOS (a collection) has its projection restored
// explicitly before any terrain operation touches it.
var demSource = 'none';
var dem = safeImage('USGS/SRTMGL1_003', 'SRTM 30 m DEM');
if (dem) {
  dem = dem.rename('elevation');
  demSource = 'SRTM GL1 (30 m)';
} else {
  var alosCol = safeCollection('JAXA/ALOS/AW3D30/V3_2', 'ALOS AW3D30');
  if (alosCol) {
    dem = alosCol.select('DSM').mosaic()
            .setDefaultProjection(alosCol.first().projection())
            .rename('elevation');
    demSource = 'ALOS AW3D30 (30 m, projection restored)';
  }
}

var slope = null;
if (dem) {
  dem = dem.toFloat();
  slope = ee.Terrain.slope(dem).rename('slope').clip(roi);
  dem = dem.clip(roi);
  prov(demSource, 'DEM / slope', 30, '2000-2011', 'Farr et al. 2007 / Tadono et al. 2014');
  log('Terrain ready - source: ' + demSource);
} else {
  warn('No DEM available. Slope constraint and slope-dependent criteria will be unavailable.');
}

// ============================================================================
// 2. HYDROLOGY - MERIT Hydro: real flow accumulation, HAND, TWI
// ============================================================================
var merit = safeImage('MERIT/Hydro/v1_0_1', 'MERIT Hydro');
var upaKm2 = null, handM = null, twi = null;
if (merit) {
  upaKm2 = merit.select('upa').clip(roi).resample('bilinear');
  handM  = merit.select('hnd').clip(roi).resample('bilinear');
  if (slope) {
    var specificCatchment = upaKm2.multiply(1e6).divide(CONFIG.scale).max(1);
    var tanBeta = slope.multiply(Math.PI / 180).tan().max(0.001);
    twi = specificCatchment.divide(tanBeta).log().rename('twi');
  }
  prov('MERIT/Hydro/v1_0_1', 'Flow accumulation / HAND / TWI', 90, '2019', 'Yamazaki et al. 2019');
  log('MERIT Hydro ready (upa, HAND, TWI)');
} else {
  warn('MERIT Hydro unavailable - HAND constraint, moisture and erosion-LS criteria will be affected.');
}

// ============================================================================
// 3. LAND COVER - Dynamic World (current) + ESA WorldCover (cross-check)
// ============================================================================
var yStart = ee.Date.fromYMD(CONFIG.year, 1, 1);
var yEnd   = yStart.advance(1, 'year');

var dwCol = safeCollection('GOOGLE/DYNAMICWORLD/V1', 'Dynamic World');
var dw = null;
if (dwCol) {
  var dwFiltered = dwCol.filterBounds(roi).filterDate(yStart.advance(-1, 'year'), yEnd);
  dw = dwFiltered.select(['water', 'trees', 'grass', 'flooded_vegetation',
                          'crops', 'shrub_and_scrub', 'built', 'bare'])
                 .median().clip(roi);
  prov('GOOGLE/DYNAMICWORLD/V1', 'Current land cover / tree probability', 10, String(CONFIG.year), 'Brown et al. 2022');
  log('Dynamic World composite ready');
}

var worldCover = safeMosaic('ESA/WorldCover/v200', 'Map', 'ESA WorldCover v200')
              || safeMosaic('ESA/WorldCover/v100', 'Map', 'ESA WorldCover v100');
var worldCoverMap = worldCover ? worldCover.select('Map').clip(roi) : null;
if (worldCoverMap) {
  prov('ESA/WorldCover/v200', 'Land cover cross-check', 10, '2021', 'Zanaga et al. 2022');
  log('ESA WorldCover ready (cross-check)');
}

if (!dw && !worldCoverMap) {
  warn('Neither Dynamic World nor ESA WorldCover available - cannot exclude cropland/built-up/water. STOPPING.');
}

var plantableMask = null;
if (dw) {
  plantableMask = dw.select('crops').lt(0.35)
    .and(dw.select('built').lt(0.20))
    .and(dw.select('water').lt(0.20))
    .and(dw.select('flooded_vegetation').lt(0.25));
  if (worldCoverMap) {
    plantableMask = plantableMask.and(
      worldCoverMap.neq(40).and(worldCoverMap.neq(50)).and(worldCoverMap.neq(80))
    );
  }
} else if (worldCoverMap) {
  plantableMask = worldCoverMap.neq(40).and(worldCoverMap.neq(50)).and(worldCoverMap.neq(80));
}
if (plantableMask) { plantableMask = plantableMask.clip(roi); }

// ============================================================================
// 4. SENTINEL-2 - one fetch, reused for canopy (post-monsoon), invasion proxy
//    (dry/wet amplitude) and the AGB fallback.
// ============================================================================
var s2Col  = safeCollection('COPERNICUS/S2_SR_HARMONIZED', 'Sentinel-2 SR');
var csPlus = safeCollection('GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED', 'Cloud Score+');
var s2Base = null, useCsPlus = false;
if (s2Col) {
  s2Base = s2Col.filterBounds(roi).filterDate(ee.Date.fromYMD(CONFIG.year - 3, 1, 1), yEnd);
  useCsPlus = !!csPlus;
  if (useCsPlus) {
    s2Base = s2Base.linkCollection(csPlus, ['cs_cdf']);
    prov('GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED', 'S2 cloud masking', 10, 'current', 'Pasquarella et al. 2023');
  }
}
function maskS2(img) {
  if (useCsPlus) { return img.updateMask(img.select('cs_cdf').gte(0.60)).divide(10000); }
  var scl = img.select('SCL');
  var clear = scl.neq(3).and(scl.neq(8)).and(scl.neq(9)).and(scl.neq(10)).and(scl.neq(11));
  return img.updateMask(clear).divide(10000);
}

var postMonsoonComposite = null, dryComposite = null, wetComposite = null;
if (s2Base) {
  // Post-monsoon (Oct-Dec): the FSI State of Forest Report canopy-density
  // interpretation window - fullest, most separable canopy signal in a
  // deciduous landscape.
  postMonsoonComposite = s2Base.filter(ee.Filter.calendarRange(10, 12, 'month'))
    .map(maskS2).median().clip(roi);
  // Dry (Feb-Apr) vs wet (Aug-Oct): seasonal NDVI amplitude for the invasion
  // proxy, and AGB NDVI fallback if GEDI/CCI are unavailable.
  dryComposite = s2Base.filter(ee.Filter.calendarRange(2, 4, 'month')).map(maskS2).median().clip(roi);
  wetComposite = s2Base.filter(ee.Filter.calendarRange(8, 10, 'month')).map(maskS2).median().clip(roi);
  prov('COPERNICUS/S2_SR_HARMONIZED', 'Post-monsoon canopy, seasonal composites', 10,
       (CONFIG.year - 3) + '-' + CONFIG.year, 'ESA Copernicus');
  log('Sentinel-2 composites ready (post-monsoon / dry / wet, 3 yr stack, ' +
      (useCsPlus ? 'Cloud Score+' : 'SCL') + ' masking)');
}

// ============================================================================
// 5. CURRENT CANOPY DENSITY - FSI-consistent post-monsoon fractional
//    vegetation cover. See header for why Hansen was rejected as the
//    magnitude source for this forest type.
// ============================================================================
var canopyDensity = null, canopySource = 'none';
var NDVI_SOIL = 0.12, NDVI_VEG = 0.62;   // literature-typical, post-monsoon, semi-arid dry-deciduous

if (postMonsoonComposite) {
  var pmNdvi = postMonsoonComposite.normalizedDifference(['B8', 'B4']).rename('pmNdvi');
  var fvc = pmNdvi.subtract(NDVI_SOIL).divide(NDVI_VEG - NDVI_SOIL).clamp(0, 1).pow(2);
  canopyDensity = fvc.multiply(100).rename('canopyDensity');
  canopySource = 'Post-monsoon (Oct-Dec) Sentinel-2 fractional vegetation cover - FSI-consistent season';
  log('Canopy density computed from post-monsoon NDVI (Carlson & Ripley 1997 FVC)');
  prov('derived', 'Canopy % (FVC from post-monsoon NDVI)', 10, String(CONFIG.year), 'Carlson & Ripley 1997; FSI SFR methodology');
} else {
  var hansen = safeImage('UMD/hansen/global_forest_change_2023_v1_11', 'Hansen GFC 2023 v1.11');
  if (hansen) {
    var tc2000 = hansen.select('treecover2000'), lossYear = hansen.select('lossyear'), gain = hansen.select('gain');
    canopyDensity = tc2000.where(lossYear.gt(0), 0)
      .where(gain.eq(1).and(tc2000.lt(C.openMax)), tc2000.max(C.scrubMax + 5))
      .resample('bilinear').clip(roi).rename('canopyDensity');
    canopySource = 'Hansen treecover2000 (loss/gain updated) - FALLBACK, documented poor fit for dry-deciduous forest, VERIFY';
    warn('No Sentinel-2 - falling back to Hansen, which under-reports canopy in dry-deciduous forest.');
    prov('UMD/hansen/global_forest_change_2023_v1_11', 'Canopy fallback', 30, '2000-2023', 'Hansen et al. 2013');
  } else if (dw) {
    var dwT = dw.select('trees');
    canopyDensity = ee.Image(0)
      .where(dwT.gte(0.20), C.scrubMax + 5).where(dwT.gte(0.40), C.openMax + 10)
      .where(dwT.gte(0.70), C.moderatelyDenseMax + 10).rename('canopyDensity');
    canopySource = 'Dynamic World class bands only - indicative';
    warn('Neither Sentinel-2 nor Hansen available. Canopy is indicative Dynamic World bands only.');
  }
}
if (!canopyDensity) { warn('No canopy data at all. STOPPING - degradation status cannot be assessed.'); }

// ============================================================================
// 6. FSI CLASSIFICATION + HARD CONSTRAINTS + TREATMENT ELIGIBILITY
// ============================================================================
var fsiClass = null, forestMask = null, treatment = null, eligibleMask = null;
if (canopyDensity) {
  fsiClass = ee.Image(1)
    .where(canopyDensity.gte(C.scrubMax), 2)
    .where(canopyDensity.gte(C.openMax), 3)
    .where(canopyDensity.gte(C.moderatelyDenseMax), 4)
    .rename('fsiClass').clip(roi);
  forestMask = canopyDensity.gte(C.openMax);
  log('FSI 4-tier classification ready (Scrub <10 / Open 10-40 / Mod.Dense 40-70 / V.Dense >=70)');
}

var constraintMask = ee.Image(1);
var constraintNotes = [];
if (slope) {
  constraintMask = constraintMask.and(slope.lte(CONFIG.constraints.maxSlopeDeg));
  constraintNotes.push('slope <= ' + CONFIG.constraints.maxSlopeDeg + ' deg');
}
if (handM) {
  constraintMask = constraintMask.and(handM.gte(CONFIG.constraints.maxHandM));
  constraintNotes.push('HAND >= ' + CONFIG.constraints.maxHandM + ' m (waterlogging)');
}
if (dw) {
  constraintMask = constraintMask.and(dw.select('bare').lt(CONFIG.constraints.maxBareProb));
  constraintNotes.push('bare-ground probability < ' + CONFIG.constraints.maxBareProb + ' (rock/saline screen)');
  constraintMask = constraintMask.and(dw.select('trees').lt(CONFIG.constraints.minTreeProbExclude));
  constraintNotes.push('tree probability < ' + CONFIG.constraints.minTreeProbExclude + ' (already forested)');
}

if (fsiClass && plantableMask) {
  treatment = ee.Image(0)
    .where(fsiClass.eq(1), 1).where(fsiClass.eq(2), 1)   // both eligible classes -> New Plantation only
    .updateMask(plantableMask).updateMask(constraintMask)
    .rename('treatment').clip(roi);
  eligibleMask = treatment.gt(0);
  log('Treatment eligibility ready (New Plantation only). Constraints: ' + (constraintNotes.join('; ') || 'none'));
}

// ---- EXCLUSION REASON - so the WHOLE ROI is accounted for, not just the
// eligible slice. A priority score answers "where should we plant", which is
// meaningless on land that is already forest, cropland, water, too steep, or
// waterlogged - that land is NOT "low priority", it is NOT APPLICABLE, and it
// needs to be shown as such rather than left blank on the map. Reasons are
// computed in priority order so every non-eligible pixel gets exactly one:
//   1 = eligible (has a Priority Score)
//   2 = already forest (FSI Moderately Dense / Very Dense)
//   3 = non-plantable land use (cropland / built-up / water / wetland)
//   4 = too steep
//   5 = waterlogged (HAND)
//   6 = rock/saline ground or already well-forested by Dynamic World's screen
// Value 1 = eligible (has a Priority Score); 2-6 = the reason it does not.
var exclusionReason = null;
if (fsiClass && plantableMask) {
  var notEligible = eligibleMask.not();
  var reasonImg = ee.Image(0)
    .where(notEligible.and(fsiClass.gte(3)), 2)
    .where(notEligible.and(fsiClass.lte(2)).and(plantableMask.not()), 3);
  if (slope) {
    reasonImg = reasonImg.where(notEligible.and(fsiClass.lte(2)).and(plantableMask)
      .and(slope.gt(CONFIG.constraints.maxSlopeDeg)), 4);
  }
  if (handM) {
    reasonImg = reasonImg.where(notEligible.and(fsiClass.lte(2)).and(plantableMask)
      .and(slope ? slope.lte(CONFIG.constraints.maxSlopeDeg) : ee.Image(1))
      .and(handM.lt(CONFIG.constraints.maxHandM)), 5);
  }
  if (dw) {
    var stillUnexplained = notEligible.and(fsiClass.lte(2)).and(plantableMask)
      .and(slope ? slope.lte(CONFIG.constraints.maxSlopeDeg) : ee.Image(1))
      .and(handM ? handM.gte(CONFIG.constraints.maxHandM) : ee.Image(1));
    reasonImg = reasonImg.where(stillUnexplained, 6);
  }
  exclusionReason = ee.Image(1).where(notEligible, reasonImg).clip(roi).rename('exclusionReason');
}

// ---- Eligibility funnel + canopy/slope diagnostic --------------------------
// Reported before the heavy aggregation, so an empty or tiny eligible area is
// diagnosed immediately instead of discovered after a long run.
(function () {
  if (!fsiClass) { return; }
  var haImg = ee.Image.pixelArea().divide(1e4);
  var bands = [
    haImg.updateMask(fsiClass.eq(1)).rename('fsi1_scrub'),
    haImg.updateMask(fsiClass.eq(2)).rename('fsi2_open'),
    haImg.updateMask(fsiClass.eq(3)).rename('fsi3_modDense'),
    haImg.updateMask(fsiClass.eq(4)).rename('fsi4_veryDense'),
    haImg.updateMask(fsiClass.lte(2)).rename('inEligibleBand'),
    haImg.updateMask(fsiClass.lte(2).and(plantableMask)).rename('alsoPlantable')
  ];
  if (eligibleMask) { bands.push(haImg.updateMask(eligibleMask).rename('finalEligible')); }
  var distBands = [canopyDensity.rename('canopyPct')];
  if (slope) { distBands.push(slope.rename('slopeDeg')); }

  var areaStats = ee.Image.cat(bands).reduceRegion({
    reducer: ee.Reducer.sum(), geometry: roi, scale: 60, maxPixels: 1e10, bestEffort: true, tileScale: 8 });
  var distStats = ee.Image.cat(distBands).reduceRegion({
    reducer: ee.Reducer.percentile([5, 25, 50, 75, 95]), geometry: roi, scale: 60, maxPixels: 1e10, bestEffort: true, tileScale: 8 });

  ee.Dictionary({ roiHa: roi.area(100).divide(1e4), area: areaStats, dist: distStats }).evaluate(function (d, err) {
    if (err || !d) { warn('Diagnostic unavailable (' + err + ').'); return; }
    print('ROI: ' + Math.round(d.roiHa).toLocaleString('en-IN') + ' ha (' + (d.roiHa / 100).toFixed(1) + ' km2)');
    print('---- CANOPY / SLOPE DIAGNOSTIC (source: ' + canopySource + ') ----');
    var a = d.area || {}, dd = d.dist || {};
    var pct = function (k) { return (dd[k] === null || dd[k] === undefined) ? 'n/a' : Number(dd[k]).toFixed(1); };
    print('  canopy % at 5/25/50/75/95th pct: ' + [5,25,50,75,95].map(function(q){return pct('canopyPct_p'+q);}).join(' / '));
    if (slope) { print('  slope deg at 5/50/95th pct: ' + [5,50,95].map(function(q){return pct('slopeDeg_p'+q);}).join(' / ')); }
    var r = function (k) { return Math.round(a[k] || 0).toLocaleString('en-IN') + ' ha'; };
    print('---- ELIGIBILITY FUNNEL ----');
    print('  FSI 1 Scrub        (<10% canopy) : ' + r('fsi1_scrub'));
    print('  FSI 2 Open       (10-40% canopy) : ' + r('fsi2_open'));
    print('  FSI 3 Mod.Dense  (40-70% canopy) : ' + r('fsi3_modDense') + '   [not eligible]');
    print('  FSI 4 V.Dense      (>70% canopy) : ' + r('fsi4_veryDense') + '   [not eligible]');
    print('  -> in eligible canopy band       : ' + r('inEligibleBand'));
    print('     of which plantable land use   : ' + r('alsoPlantable'));
    print('  == FINAL ELIGIBLE (after all constraints) : ' + r('finalEligible'));
    if ((a.finalEligible || 0) < 1) {
      warn('NOTHING is eligible. Compare the funnel stages above to find where it collapsed.');
    }
  });
})();

// ============================================================================
// 7. CLIMATE - CHIRPS (pentad, cheap), MODIS LST, TerraClimate soil moisture/CWD
// ============================================================================
var chirps = safeCollection('UCSB-CHG/CHIRPS/PENTAD', 'CHIRPS rainfall (pentad)')
          || safeCollection('UCSB-CHG/CHIRPS/DAILY', 'CHIRPS rainfall (daily fallback)');
var rainfall = null, rainfallCV = null;
if (chirps) {
  rainfall = chirps.filterDate(yStart.advance(-1, 'year'), yEnd).sum().resample('bilinear').clip(roi).rename('rainfall');
  var nYrs = 30;
  var annualSums = ee.ImageCollection(ee.List.sequence(1, nYrs).map(function (k) {
    var s = yStart.advance(ee.Number(k).multiply(-1), 'year');
    return chirps.filterDate(s, s.advance(1, 'year')).sum();
  }));
  var rMean = annualSums.mean(), rStd = annualSums.reduce(ee.Reducer.stdDev());
  rainfallCV = rStd.divide(rMean.max(1)).resample('bilinear').clip(roi).rename('rainfallCV');
  prov('UCSB-CHG/CHIRPS/PENTAD', 'Rainfall + 30 yr variability', 5566, '1981-present', 'Funk et al. 2015');
  log('CHIRPS rainfall + 30 yr coefficient of variation computed');
}

var terraClim = safeCollection('IDAHO_EPSCOR/TERRACLIMATE', 'TerraClimate');
var cwd = null, soilMoisture = null;
if (terraClim) {
  var tcRecent = terraClim.filterDate(ee.Date.fromYMD(CONFIG.year - 10, 1, 1), yEnd);
  cwd = tcRecent.select('def').mean().multiply(0.1).resample('bilinear').clip(roi).rename('cwd');
  soilMoisture = tcRecent.select('soil').mean().multiply(0.1).resample('bilinear').clip(roi).rename('soilMoisture');
  prov('IDAHO_EPSCOR/TERRACLIMATE', 'Climate water deficit / soil moisture', 4638, '2015-2025', 'Abatzoglou et al. 2018');
  log('TerraClimate water balance computed (CWD, soil moisture)');
}

var modisLst = safeCollection('MODIS/061/MOD11A2', 'MODIS LST');
var tempMaxC = null;
if (modisLst) {
  tempMaxC = modisLst.filterDate(ee.Date.fromYMD(CONFIG.year - 5, 1, 1), yEnd)
    .filter(ee.Filter.calendarRange(3, 6, 'month')).select('LST_Day_1km')
    .reduce(ee.Reducer.percentile([95])).multiply(0.02).subtract(273.15)
    .resample('bilinear').clip(roi).rename('tempMax');
  prov('MODIS/061/MOD11A2', 'Pre-monsoon heat stress (p95)', 1000, (CONFIG.year - 5) + '-' + CONFIG.year, 'Wan et al. 2021');
  log('Pre-monsoon heat stress computed (5 yr p95)');
}

// ============================================================================
// 8. SOIL - SoilGrids v2 continuous properties, OpenLandMap fallback
// ============================================================================
function soilGrid(id, label, scaleFactor) {
  var img = safeImage(id, label);
  if (!img) { return null; }
  var bands = img.bandNames();
  return img.select(bands.slice(0, 3)).reduce(ee.Reducer.mean()).multiply(scaleFactor).clip(roi).rename(label);
}
var sand = soilGrid('projects/soilgrids-isric/sand_mean', 'sand', 0.1);
var clay = soilGrid('projects/soilgrids-isric/clay_mean', 'clay', 0.1);
var socG = soilGrid('projects/soilgrids-isric/soc_mean',  'soc',  0.1);
var phH2O = soilGrid('projects/soilgrids-isric/phh2o_mean', 'ph', 0.1);
var cfvo = soilGrid('projects/soilgrids-isric/cfvo_mean', 'cfvo', 0.1);
var cec  = soilGrid('projects/soilgrids-isric/cec_mean',  'cec',  0.1);
var soilSource = 'SoilGrids v2 (ISRIC, 250 m)';
if (sand) { prov('projects/soilgrids-isric/*_mean', 'Soil sand/clay/SOC/pH/CEC/coarse fragments', 250, '2020', 'Poggio et al. 2021'); }

if (!sand || !clay) {
  warn('SoilGrids unavailable - falling back to OpenLandMap.');
  var olmSand = safeImage('OpenLandMap/SOL/SOL_SAND-WFRACTION_USDA-3A1A1A_M/v02', 'OpenLandMap sand');
  var olmClay = safeImage('OpenLandMap/SOL/SOL_CLAY-WFRACTION_USDA-3A1A1A_M/v02', 'OpenLandMap clay');
  if (olmSand) { sand = olmSand.select(0).clip(roi).rename('sand'); }
  if (olmClay) { clay = olmClay.select(0).clip(roi).rename('clay'); }
  soilSource = 'OpenLandMap (250 m)';
  if (olmSand) { prov('OpenLandMap/SOL/*', 'Soil texture fractions (fallback)', 250, '2018', 'Hengl et al. 2018'); }
}
if (!socG) {
  var olmSoc = safeImage('OpenLandMap/SOL/SOL_ORGANIC-CARBON_USDA-6A1C_M/v02', 'OpenLandMap SOC');
  if (olmSoc) { socG = olmSoc.select(0).clip(roi).rename('soc'); }
}
var silt = (sand && clay) ? ee.Image(100).subtract(sand).subtract(clay).clamp(0, 100).rename('silt') : null;

// FAO Land Evaluation, limiting-factor rule: one disqualifying property is not
// averaged away by good scores elsewhere (60% limiting factor / 40% mean).
var soilSuitabilityRaw = null;
if (sand && clay) {
  var texScore  = invertedU(clay, 5, 25, 55);
  var sandScore = ee.Image(1).subtract(sand.subtract(70).divide(30).clamp(0, 1));
  var parts = [texScore, sandScore];
  if (phH2O) { parts.push(invertedU(phH2O, 4.5, 6.8, 8.5)); }
  if (cfvo)  { parts.push(ee.Image(1).subtract(cfvo.divide(40).clamp(0, 1))); }
  if (cec)   { parts.push(cec.divide(25).clamp(0, 1)); }
  var meanPart = parts.reduce(function (a, b) { return a.add(b); }).divide(parts.length);
  var minPart  = parts.reduce(function (a, b) { return a.min(b); });
  soilSuitabilityRaw = minPart.multiply(0.6).add(meanPart.multiply(0.4)).rename('soilSuitability');
  log('Soil suitability computed (' + soilSource + ', FAO limiting-factor rule)');
}

// ============================================================================
// 9. ECOLOGICAL INTEGRITY - distance to forest, hydrological connectivity,
//    degradation priority
// ============================================================================
var distToForestRaw = null, hydroConnRaw = null, degradationRaw = null;
if (forestMask) {
  distToForestRaw = distanceTo(forestMask, 3000).rename('distanceToForest');
  log('Distance to forest computed');
}
if (dw || worldCoverMap) {
  var waterMask = dw ? dw.select('water').gt(0.30).or(dw.select('flooded_vegetation').gt(0.30))
                     : worldCoverMap.eq(80).or(worldCoverMap.eq(90));
  var distToWater = distanceTo(waterMask, 2000);
  hydroConnRaw = ee.Image(1).subtract(distToWater.divide(2000).clamp(0, 1)).rename('hydrologicalConnectivity');
  log('Hydrological connectivity computed');
}
if (canopyDensity) {
  degradationRaw = ee.Image(1).subtract(canopyDensity.clamp(0, C.openMax).divide(C.openMax)).rename('degradationPriority');
  log('Degradation priority computed (lower canopy -> higher priority)');
}

// ============================================================================
// 10. PHYSICAL SITE SUITABILITY - moisture availability, workability
// ============================================================================
var moistureRaw = null;
if (twi || soilMoisture) {
  var mParts = [];
  if (twi) { mParts.push(twi.subtract(3).divide(12).clamp(0, 1)); }
  if (soilMoisture) { mParts.push(soilMoisture.divide(200).clamp(0, 1)); }
  if (handM) { mParts.push(ee.Image(1).subtract(handM.divide(60).clamp(0, 1))); }
  moistureRaw = mParts.reduce(function (a, b) { return a.add(b); }).divide(mParts.length).rename('moistureAvailability');
  log('Moisture availability computed');
}
var workabilityRaw = null;
if (slope && rainfall) {
  var slopeWork = ee.Image(1).subtract(slope.divide(30).clamp(0, 1));
  var rainWork  = rainfall.subtract(300).divide(1200).clamp(0, 1);
  workabilityRaw = slopeWork.multiply(0.6).add(rainWork.multiply(0.4)).rename('workability');
  log('Workability computed');
}

// ============================================================================
// 11. CLIMATE EXPOSURE
// ============================================================================
var climateExposureRaw = null;
if (tempMaxC && rainfallCV) {
  var heatN = tempMaxC.subtract(32).divide(14).clamp(0, 1);
  var droughtN = rainfallCV.subtract(0.10).divide(0.40).clamp(0, 1);
  var stressParts = [heatN, droughtN];
  if (cwd) { stressParts.push(cwd.subtract(400).divide(800).clamp(0, 1)); }
  var exposure = stressParts.reduce(function (a, b) { return a.add(b); }).divide(stressParts.length);
  climateExposureRaw = ee.Image(1).subtract(exposure).clamp(0, 1).rename('climateExposure');
  log('Climate exposure computed (heat + rainfall CV' + (cwd ? ' + climate water deficit' : '') + ')');
}

// ============================================================================
// 12. CARBON-GAIN POTENTIAL & EROSION RISK
// ============================================================================
var currentAgb = null, agbSource = 'none';
var gediGrid = safeImage('LARSE/GEDI/GEDI04_B_002', 'GEDI L4B gridded biomass');
if (gediGrid) { currentAgb = gediGrid.select('MU').clip(roi).rename('agb'); agbSource = 'GEDI L4B gridded (1 km)'; }
else {
  var cci = safeImage('projects/sat-io/open-datasets/ESA/ESA_CCI_AGB', 'ESA CCI Biomass');
  if (cci) { currentAgb = cci.select(0).clip(roi).rename('agb'); agbSource = 'ESA CCI Biomass (100 m)'; }
  else if (dryComposite) {
    var ndviAgb = wetComposite ? wetComposite.normalizedDifference(['B8', 'B4']) : dryComposite.normalizedDifference(['B8', 'B4']);
    currentAgb = ndviAgb.multiply(250).max(0).rename('agb');
    agbSource = 'NDVI proxy (LOWEST CONFIDENCE)';
    warn('GEDI/ESA CCI unavailable - AGB is an NDVI proxy.');
  }
}
var carbonGainRaw = null;
if (currentAgb) {
  carbonGainRaw = ee.Image(CONFIG.carbon.referenceAgbTPerHa).subtract(currentAgb).max(0).rename('carbonGainPotential');
  prov(agbSource, 'Current aboveground biomass', 'varies', 'varies', 'Dubayah et al. 2022 / Santoro et al. 2021');
  log('Carbon-gain potential computed - AGB source: ' + agbSource);
}

var erosionRaw = null;
if (slope && rainfall) {
  var R = rainfall.multiply(0.363).add(79);   // CSWCRTI Dehradun
  var K;
  if (sand && silt && clay && socG) {
    var fSand = ee.Image(0.2).add(ee.Image(0.3).multiply(sand.multiply(-0.0256).exp().multiply(ee.Image(1).subtract(silt.divide(100)))));
    var fClSi = silt.divide(clay.add(silt).max(0.001)).pow(0.3);
    var orgC  = socG.divide(10);
    var fOrgC = ee.Image(1).subtract(orgC.multiply(0.25).divide(orgC.add(orgC.multiply(-3.72).subtract(2.95).exp())));
    var sn1   = ee.Image(1).subtract(sand.divide(100));
    var fHiSa = ee.Image(1).subtract(sn1.multiply(0.7).divide(sn1.add(sn1.multiply(22.9).subtract(5.51).exp())));
    K = fSand.multiply(fClSi).multiply(fOrgC).multiply(fHiSa).rename('K');
  } else { K = ee.Image(0.28).rename('K'); }

  var slopeRad = slope.multiply(Math.PI / 180);
  var LS;
  if (upaKm2) {
    var As = upaKm2.multiply(1e6).divide(CONFIG.scale).max(CONFIG.scale);
    LS = As.divide(22.13).pow(0.4).multiply(slopeRad.sin().divide(0.0896).pow(1.3));
  } else {
    LS = ee.Image(CONFIG.scale).divide(22.13).pow(0.4).multiply(slopeRad.sin().divide(0.0896).pow(1.3));
  }
  var Cf = dw
    ? dw.select('trees').multiply(0.004).add(dw.select('shrub_and_scrub').multiply(0.05))
        .add(dw.select('grass').multiply(0.10)).add(dw.select('crops').multiply(0.28)).add(dw.select('bare').multiply(0.45))
    : (worldCoverMap ? worldCoverMap.remap([10,20,30,40,50,60,90,95,100], [0.01,0.05,0.03,0.28,0.0,0.45,0.02,0.01,0.05], 0.2).clip(roi) : ee.Image(0.2));

  erosionRaw = R.multiply(K).multiply(LS).multiply(Cf).clip(roi).rename('erosionRisk');
  prov('RUSLE (composite)', 'Soil loss t/ha/yr', CONFIG.scale, String(CONFIG.year), 'Renard et al. 1997; Williams 1995; Desmet & Govers 1996');
  log('RUSLE soil loss computed (Williams 1995 K-factor, Desmet & Govers 1996 LS-factor)');
}

// ============================================================================
// 13. FIRE RISK & INVASION PROXY
// ============================================================================
var burnedCol = safeCollection('MODIS/061/MCD64A1', 'MODIS Burned Area');
var firmsCol  = safeCollection('FIRMS', 'FIRMS active fire');
var fireRaw = null;
var histStart = ee.Date.fromYMD(CONFIG.year - CONFIG.fireHistoryYears, 1, 1);
var fireParts = [];
if (burnedCol) {
  var burnCount = burnedCol.filterDate(histStart, yEnd).select('BurnDate').map(function (i) { return i.gt(0); }).sum().clip(roi);
  fireParts.push(burnCount.divide(CONFIG.fireHistoryYears).clamp(0, 1));
  prov('MODIS/061/MCD64A1', 'Burned area history', 500, CONFIG.fireHistoryYears + ' yr', 'Giglio et al. 2018');
}
if (firmsCol) {
  var firmsCount = firmsCol.filterDate(histStart, yEnd).select('T21').map(function (i) { return i.gt(0).unmask(0).clip(roi); }).sum().clip(roi);
  var firmsSmooth = firmsCount.focal_mean({ radius: 3, kernelType: 'circle', units: 'pixels' });
  fireParts.push(firmsSmooth.divide(CONFIG.fireHistoryYears * 2).clamp(0, 1));
  prov('FIRMS', 'Active fire detections', 375, CONFIG.fireHistoryYears + ' yr', 'NASA FIRMS');
}
if (fireParts.length > 0) {
  fireRaw = fireParts.reduce(function (a, b) { return a.max(b); }).rename('fireRisk');
  log('Fire risk computed (' + fireParts.length + ' source(s))');
}

// Invasion proxy: low seasonal NDVI amplitude + high dry-season greenness.
// Lantana/Prosopis hold green foliage through the dry season inside an
// otherwise deciduous matrix - a phenological signature, not a brightness one.
var phenoAnomalyRaw = null;
if (dryComposite && wetComposite) {
  var dryNdvi = dryComposite.normalizedDifference(['B8', 'B4']).rename('dryNdvi');
  var wetNdvi = wetComposite.normalizedDifference(['B8', 'B4']).rename('wetNdvi');
  var amplitude = wetNdvi.subtract(dryNdvi);
  var lowAmplitude = ee.Image(1).subtract(amplitude.divide(0.45).clamp(0, 1));
  var dryGreen = dryNdvi.subtract(0.15).divide(0.40).clamp(0, 1);
  phenoAnomalyRaw = lowAmplitude.multiply(0.5).add(dryGreen.multiply(0.5)).rename('phenologicalAnomaly');
  warn('Phenological Anomaly is an UNVALIDATED invasion proxy. Field-verify flagged blocks before costing clearance.');
}

// ============================================================================
// 14. HUMAN DEPENDENCY - JRC GHSL population, inverted-U
// ============================================================================
var humanDepRaw = null;
var ghsPop = safeCollection('JRC/GHSL/P2023A/GHS_POP', 'GHSL population');
if (ghsPop) {
  var popImg = ghsPop.sort('system:time_start', false).first().select(0).clip(roi.buffer(10000)).rename('pop');
  var popAccess = popImg.focal_mean({ radius: 2000, kernelType: 'circle', units: 'meters' }).clip(roi);
  humanDepRaw = invertedU(popAccess.unmask(0).clip(roi).max(0.1).log10(), -1, 1.3, 3.2).rename('humanDependency');
  prov('JRC/GHSL/P2023A/GHS_POP', 'Population pressure / accessibility', 100, '2020', 'Schiavina et al. 2023');
  log('Human dependency computed (GHSL population, inverted-U)');
}

// ============================================================================
// 15. ASSEMBLE THE CRITERION STACK
// ============================================================================
var CRITERIA = [
  { name: 'distanceToForest',        img: distToForestRaw,    mode: 'absolute',   lo: 3000, hi: 0, dir: 1, cluster: 'Ecological Integrity', res: 10 },
  { name: 'hydrologicalConnectivity',img: hydroConnRaw,       mode: 'percentile', dir: 1, cluster: 'Ecological Integrity', res: 10 },
  { name: 'degradationPriority',     img: degradationRaw,     mode: 'absolute',   lo: 0, hi: 1, dir: 1, cluster: 'Ecological Integrity', res: 10 },
  { name: 'soilSuitability',         img: soilSuitabilityRaw, mode: 'absolute',   lo: 0, hi: 1, dir: 1, cluster: 'Physical Suitability', res: 250 },
  { name: 'soilOrganicCarbon',       img: socG,               mode: 'percentile', dir: 1, cluster: 'Physical Suitability', res: 250 },
  { name: 'moistureAvailability',    img: moistureRaw,        mode: 'percentile', dir: 1, cluster: 'Physical Suitability', res: 90 },
  { name: 'workability',             img: workabilityRaw,     mode: 'absolute',   lo: 0, hi: 1, dir: 1, cluster: 'Physical Suitability', res: 30 },
  { name: 'climateExposure',         img: climateExposureRaw, mode: 'absolute',   lo: 0, hi: 1, dir: 1, cluster: 'Climate', res: 1000 },
  { name: 'carbonGainPotential',     img: carbonGainRaw,      mode: 'percentile', dir: 1, cluster: 'Carbon & Restoration', res: 1000 },
  { name: 'erosionRisk',             img: erosionRaw,         mode: 'percentile', dir: 1, cluster: 'Carbon & Restoration', res: 90 },
  { name: 'fireRisk',                img: fireRaw,            mode: 'absolute',   lo: 0, hi: 1, dir: CONFIG.directions.fireRisk, cluster: 'Risk & Feasibility', res: 375 },
  { name: 'phenologicalAnomaly',     img: phenoAnomalyRaw,    mode: 'percentile', dir: CONFIG.directions.phenologicalAnomaly, cluster: 'Risk & Feasibility', res: 10 },
  { name: 'humanDependency',         img: humanDepRaw,        mode: 'absolute',   lo: 0, hi: 1, dir: 1, cluster: 'Human Dimension', res: 100 }
];

var missing = CRITERIA.filter(function (c) { return !c.img; }).map(function (c) { return c.name; });
var active = CRITERIA.filter(function (c) { return !!c.img; });

if (!eligibleMask || active.length === 0) {
  warn('STOPPING - no eligible area or no criteria available.');
} else {

// ============================================================================
// 16. BLOCK AGGREGATION - the model's only heavy server work, grouped with
//     automatic scale coarsening and graded degradation on failure.
// ============================================================================
var grid = roi.coveringGrid(PROJ, CONFIG.blockSizeM).filterBounds(roi)
  .map(function (f) { return f.set({ bid: f.get('system:index') }); });

// Reason labels for the exclusionReason codes, so the whole ROI - not only
// the eligible slice - is accounted for in the output. Reason-area bands
// (added per-group in makeGroupStats below) are cheap: each is just a
// pixelArea sum masked to one reason, no new heavy chains.
var REASON_LABELS = { 2: 'Already Forest', 3: 'Non-Plantable Land Use', 4: 'Too Steep', 5: 'Waterlogged', 6: 'Rock/Saline or Forested (DW screen)' };

var blockReducer = ee.Reducer.mean().combine(ee.Reducer.count(), '', true).combine(ee.Reducer.sum(), '', true);

function makeGroupStats(crits, includeExtras, scale) {
  // Criterion bands and the eligible-area/isEligible extras are masked to
  // eligibleMask (they describe the plantable slice only). The reason-area
  // bands are the opposite: each is already self-masked to ONE exclusion
  // reason, which by definition lies OUTSIDE eligibleMask - applying
  // eligibleMask to them again would zero every one of them out, since a
  // pixel cannot be both eligible and excluded. They are added separately,
  // unmasked by eligibleMask, alongside the always-unmasked totalAreaHa.
  var eligibleParts = crits.map(function (c) { return c.img.toFloat().rename(c.name); });
  if (includeExtras) {
    eligibleParts.push(ee.Image.pixelArea().divide(1e4).rename('eligibleAreaHa'));
    eligibleParts.push(ee.Image(1).rename('eligibleDenom'));
    eligibleParts.push(treatment.gt(0).rename('isEligible'));
  }
  var img = ee.Image.cat(eligibleParts).updateMask(eligibleMask);
  if (includeExtras) {
    img = img.addBands(ee.Image.pixelArea().divide(1e4).clip(roi).rename('totalAreaHa'));
    if (exclusionReason) {
      [2, 3, 4, 5, 6].forEach(function (rc) {
        img = img.addBands(ee.Image.pixelArea().divide(1e4).updateMask(exclusionReason.eq(rc)).rename('reason' + rc + 'Ha'));
      });
    }
  }
  return img.reduceRegions({ collection: grid, reducer: blockReducer, scale: scale, tileScale: 8 });
}

var aggGroups = [];
for (var agi = 0; agi < active.length; agi += CONFIG.aggGroupSize) {
  aggGroups.push(active.slice(agi, agi + CONFIG.aggGroupSize));
}

var blockData = {};
var aggFailed = [];
function mergeRows(fc) {
  ((fc && fc.features) || []).forEach(function (f) {
    var p = f.properties || {};
    if (p.bid === undefined || p.bid === null) { return; }
    if (!blockData[p.bid]) { blockData[p.bid] = {}; }
    var target = blockData[p.bid];
    for (var k in p) { if (Object.prototype.hasOwnProperty.call(p, k)) { target[k] = p[k]; } }
  });
}
function labelFor(crits) {
  return crits.length ? crits.map(function (c) { return c.name; }).join(', ') : 'block areas & eligibility';
}
function runSingle(c, scale, attempt, done) {
  makeGroupStats([c], false, scale).evaluate(function (fc, err) {
    if (!err && fc) { mergeRows(fc); print('    ' + c.name + ' OK at ' + scale + ' m'); done(); return; }
    if (attempt < 3) { runSingle(c, scale * 2, attempt + 1, done); return; }
    c.aggFailed = true; aggFailed.push(c.name);
    warn('    ' + c.name + ' could not be aggregated even alone - dropping it.');
    done();
  });
}
function runSingles(crits, i, scale, done) {
  if (i >= crits.length) { done(); return; }
  runSingle(crits[i], scale, 1, function () { runSingles(crits, i + 1, scale, done); });
}
function runGroup(crits, includeExtras, scale, attempt, done) {
  print('Aggregating [' + labelFor(crits) + '] at ' + scale + ' m' + (attempt > 1 ? '  (attempt ' + attempt + ')' : '') + ' ...');
  makeGroupStats(crits, includeExtras, scale).evaluate(function (fc, err) {
    if (!err && fc) { mergeRows(fc); done(true); return; }
    if (attempt < 3) { warn('  failed at ' + scale + ' m - retrying at ' + (scale * 2) + ' m.'); runGroup(crits, includeExtras, scale * 2, attempt + 1, done); return; }
    if (includeExtras) { done(false); return; }
    warn('  group still failing - splitting it and retrying each criterion alone.');
    runSingles(crits, 0, CONFIG.blockStatsScale, function () { done(true); });
  });
}
function runAllGroups(i, done) {
  if (i >= aggGroups.length) { done(); return; }
  runGroup(aggGroups[i], false, CONFIG.blockStatsScale, 1, function () { runAllGroups(i + 1, done); });
}

print('Aggregating ' + active.length + ' criteria in ' + aggGroups.length + ' group(s) of up to ' + CONFIG.aggGroupSize + ', plus one call for block areas.');

runGroup([], true, CONFIG.blockStatsScale, 1, function (extrasOk) {
  if (!extrasOk) {
    warn('Could not compute block areas and eligibility. Raise CONFIG.blockSizeM or CONFIG.blockStatsScale.');
    return;
  }
  runAllGroups(0, function () {
    if (aggFailed.length > 0) {
      warn('DROPPED - could not be aggregated: ' + aggFailed.join(', '));
      aggFailed.forEach(function (nm) { missing.push(nm); });
    }
    var merged = [];
    for (var k in blockData) { if (Object.prototype.hasOwnProperty.call(blockData, k)) { merged.push({ properties: blockData[k] }); } }
    active = active.filter(function (c) { return !c.aggFailed; });
    processBlocks(merged);
  });
});

// ============================================================================
// 17. AUDIT + SCORE + FIVE-CLASS PRIORITY - runs once aggregation completes
// ============================================================================
function pctOf(sorted, q) {
  if (sorted.length === 0) { return null; }
  if (sorted.length === 1) { return sorted[0]; }
  var idx = (q / 100) * (sorted.length - 1), lo = Math.floor(idx), hi = Math.ceil(idx);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}
function stdDevOf(vals) {
  if (vals.length < 2) { return 0; }
  var mu = vals.reduce(function (s, x) { return s + x; }, 0) / vals.length;
  return Math.sqrt(vals.reduce(function (s, x) { return s + (x - mu) * (x - mu); }, 0) / vals.length);
}
function normBounds(c) { return (c.mode === 'absolute') ? { lo: c.lo, hi: c.hi } : { lo: c.p2, hi: c.p98 }; }
function normOne(c, v, b) {
  var t = Math.max(0, Math.min(1, (v - b.lo) / (b.hi - b.lo)));
  return c.dir === -1 ? 1 - t : t;
}
function pearson(a, b) {
  var n = a.length, sa = 0, sb = 0;
  for (var i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
  var ma = sa / n, mb = sb / n, num = 0, da = 0, db = 0;
  for (var j = 0; j < n; j++) { var xa = a[j] - ma, xb = b[j] - mb; num += xa * xb; da += xa * xa; db += xb * xb; }
  return (da === 0 || db === 0) ? 0 : num / Math.sqrt(da * db);
}

function processBlocks(feats) {
  // allRows: EVERY block in the ROI (whole-area accounting). rows: only blocks
  // with real treatable ground (the population that gets a Priority Score -
  // scoring a block with zero eligible hectares is meaningless, there is
  // nothing there to prioritise for planting).
  var allRows = [], rows = [];
  feats.forEach(function (f, idx) {
    var p = f.properties || {};
    var eligHa = p.eligibleAreaHa_sum || 0, totHa = p.totalAreaHa_sum || 0;
    if (totHa <= 0) { return; }   // genuinely outside the ROI - not a real block
    allRows.push({ idx: idx, p: p, eligHa: eligHa, totHa: totHa });
    if (eligHa > 0.1) { rows.push({ idx: idx, p: p, eligHa: eligHa, totHa: totHa }); }
  });

  print('================================================================');
  print('CAMPA PRIORITY SCORE - ' + CONFIG.unitName + ', ' + CONFIG.district + ', ' + CONFIG.state + ' (' + CONFIG.year + ')');
  print('================================================================');
  print('Blocks in ROI: ' + allRows.length + '  |  with treatable ground: ' + rows.length);
  if (missing.length > 0) { print('NO DATA / DROPPED (never entered scoring): ' + missing.join(', ')); }

  // ---- WHOLE-ROI AREA ACCOUNTING - every hectare, not only the eligible slice
  var roiTotalHa = allRows.reduce(function (s, r) { return s + r.totHa; }, 0);
  var roiEligHa  = allRows.reduce(function (s, r) { return s + r.eligHa; }, 0);
  var reasonTotals = {};
  [2, 3, 4, 5, 6].forEach(function (rc) {
    reasonTotals[rc] = allRows.reduce(function (s, r) { return s + (r.p['reason' + rc + 'Ha_sum'] || 0); }, 0);
  });
  var reasonSum = [2, 3, 4, 5, 6].reduce(function (s, rc) { return s + reasonTotals[rc]; }, 0);
  print('---- WHOLE-ROI AREA ACCOUNTING ----');
  print('  Total ROI area              : ' + Math.round(roiTotalHa).toLocaleString('en-IN') + ' ha');
  print('  Eligible for New Plantation  : ' + Math.round(roiEligHa).toLocaleString('en-IN') + ' ha  (' +
        (roiTotalHa > 0 ? (roiEligHa / roiTotalHa * 100).toFixed(1) : '0') + '%) -> gets a Priority Score below');
  print('  Not Applicable (see reasons) : ' + Math.round(reasonSum).toLocaleString('en-IN') + ' ha  (' +
        (roiTotalHa > 0 ? (reasonSum / roiTotalHa * 100).toFixed(1) : '0') + '%)');
  [2, 3, 4, 5, 6].forEach(function (rc) {
    if (reasonTotals[rc] > 0.5) { print('    ' + REASON_LABELS[rc] + ' : ' + Math.round(reasonTotals[rc]).toLocaleString('en-IN') + ' ha'); }
  });
  if (Math.abs((roiEligHa + reasonSum) - roiTotalHa) > roiTotalHa * 0.02) {
    print('  (eligible + not-applicable does not exactly sum to the ROI total - a small');
    print('   residual is expected from reprojection/edge effects at the block boundary.)');
  }

  if (rows.length === 0) { warn('No block contains treatable ground.'); return; }

  var totalEligPx = rows.reduce(function (s, r) { return s + (r.p.eligibleDenom_count || 0); }, 0);

  print('---- CRITERION INTEGRITY AUDIT ----');
  active.forEach(function (c) {
    c.dropped = false; c.dropReason = null;
    var validPx = rows.reduce(function (s, r) { return s + (r.p[c.name + '_count'] || 0); }, 0);
    c.coverage = totalEligPx > 0 ? validPx / totalEligPx : 0;
    var means = [];
    rows.forEach(function (r) { var v = r.p[c.name + '_mean']; if (typeof v === 'number' && isFinite(v)) { means.push(v); } });
    c.blockMeans = means;
    c.blockCoverage = means.length / rows.length;
    var sorted = means.slice().sort(function (a, b) { return a - b; });
    c.p2 = pctOf(sorted, 2); c.p98 = pctOf(sorted, 98);
    if (c.coverage < CONFIG.audit.minCoverage) { c.dropped = true; c.dropReason = 'SPARSE (' + (c.coverage * 100).toFixed(1) + '% pixel coverage)'; }
    else if (c.blockCoverage < CONFIG.audit.minCoverage) { c.dropped = true; c.dropReason = 'SPARSE ACROSS BLOCKS (' + (c.blockCoverage * 100).toFixed(1) + '%)'; }
    else if (c.p2 === null || c.p98 === null) { c.dropped = true; c.dropReason = 'NO VALID STATISTICS'; }
    else if (Math.abs(c.p98 - c.p2) < 1e-12) { c.dropped = true; c.dropReason = 'INERT (identical across every block)'; }
  });
  active.forEach(function (c) {
    if (c.dropped) { return; }
    var b = normBounds(c);
    if (b.lo === b.hi) { c.dropped = true; c.dropReason = 'DEGENERATE RANGE'; return; }
    var nv = c.blockMeans.map(function (v) { return normOne(c, v, b); });
    c.normStdDev = stdDevOf(nv);
    if (c.normStdDev < CONFIG.audit.minStdDev) { c.dropped = true; c.dropReason = 'INERT (normalized spread ' + c.normStdDev.toFixed(4) + ' < ' + CONFIG.audit.minStdDev + ')'; return; }
    var nImg = c.img.toFloat().subtract(b.lo).divide(b.hi - b.lo).clamp(0, 1);
    if (c.dir === -1) { nImg = ee.Image(1).subtract(nImg); }
    c.norm = nImg.rename(c.name);
  });
  var surviving = active.filter(function (c) { return !c.dropped && c.norm; });
  surviving.forEach(function (c) { print('  KEPT    ' + c.name + '  |  coverage ' + (c.coverage * 100).toFixed(1) + '%  |  spread ' + c.normStdDev.toFixed(3)); });
  var droppedList = active.filter(function (c) { return c.dropped; });
  droppedList.forEach(function (c) { print('  DROPPED ' + c.name + '  ->  ' + c.dropReason); });
  if (!CONFIG.audit.autoDrop && droppedList.length > 0) {
    warn('CONFIG.audit.autoDrop is false - flagged criteria are STILL SCORED where possible.');
    droppedList.forEach(function (c) {
      if (c.norm) { return; }
      var b = normBounds(c);
      if (b.lo == null || b.hi == null || b.lo === b.hi) { return; }
      var nImg = c.img.toFloat().subtract(b.lo).divide(b.hi - b.lo).clamp(0, 1);
      if (c.dir === -1) { nImg = ee.Image(1).subtract(nImg); }
      c.norm = nImg.rename(c.name);
    });
    surviving = active.filter(function (c) { return !!c.norm; });
  }
  if (surviving.length === 0) { warn('STOPPING - every criterion failed the integrity audit.'); return; }

  var wSum = surviving.reduce(function (s, c) { return s + (CONFIG.weights[c.name] || 0); }, 0);
  surviving.forEach(function (c) { c.weight = (CONFIG.weights[c.name] || 0) / wSum; });

  print('---- APPLIED WEIGHTS (what the score is actually built from) ----');
  var byCluster = {};
  surviving.forEach(function (c) { (byCluster[c.cluster] = byCluster[c.cluster] || []).push(c); });
  Object.keys(byCluster).forEach(function (cl) {
    var tot = byCluster[cl].reduce(function (t, c) { return t + c.weight; }, 0);
    print('  ' + cl + '  [' + (tot * 100).toFixed(1) + '%]');
    byCluster[cl].sort(function (x, y) { return y.weight - x.weight; }).forEach(function (c) {
      print('      ' + (c.weight * 100).toFixed(2) + '%  ' + c.name + '  (nominal ' + ((CONFIG.weights[c.name] || 0) * 100).toFixed(2) + '%)');
    });
  });

  // ---- Collinearity check (client-side, free - uses data already in memory)
  var critNames = surviving.map(function (c) { return c.name; });
  var weightsArr = surviving.map(function (c) { return c.weight; });
  var blocks = [];
  rows.forEach(function (r) {
    var p = r.p, vals = [], ok = true;
    for (var i = 0; i < surviving.length; i++) {
      var c = surviving[i], v = p[c.name + '_mean'];
      if (typeof v !== 'number' || !isFinite(v)) { ok = false; break; }
      vals.push(normOne(c, v, normBounds(c)));
    }
    if (!ok) { return; }
    blocks.push({
      id: r.idx + 1, bid: p.bid,
      eligibleAreaHa: r.eligHa, totalAreaHa: r.totHa, eligibleFraction: r.eligHa / r.totHa,
      // Flagged, not dropped: eligibleAreaHa already counts only the real
      // treatable hectares (the v4 area-over-credit bug is fixed at the mask
      // level, not by excluding the block), so a fragmented block's cost and
      // carbon figures are already correct. Dropping it would leave real,
      // scoreable hectares off the whole-area map. The flag exists because
      // mobilising a planting crew for a scattered sliver inside an otherwise
      // unplantable block is a genuine operational cost worth knowing about.
      fragmented: (r.eligHa / r.totHa) < CONFIG.minEligibleFrac,
      v: vals
    });
  });
  if (blocks.length === 0) { print('No block with treatable ground survived scoring.'); return; }
  var fragmentedCount = blocks.filter(function (b) { return b.fragmented; }).length;
  if (fragmentedCount > 0) {
    print('  ' + fragmentedCount + ' of ' + blocks.length + ' scored blocks are FRAGMENTED (< ' +
          (CONFIG.minEligibleFrac * 100) + '% of the block is treatable) - still scored and mapped,');
    print('  flagged in the export, since mobilising a crew for a scattered sliver is a real cost.');
  }

  var m = surviving.length;
  var cols = [];
  for (var ci = 0; ci < m; ci++) { cols.push(blocks.map(function (b) { return b.v[ci]; })); }
  var redundant = [];
  for (var a1 = 0; a1 < m; a1++) {
    for (var a2 = a1 + 1; a2 < m; a2++) {
      var r2 = pearson(cols[a1], cols[a2]);
      if (Math.abs(r2) >= CONFIG.audit.maxCorrelation) { redundant.push(critNames[a1] + ' <-> ' + critNames[a2] + ' (r=' + r2.toFixed(2) + ')'); }
    }
  }
  if (redundant.length > 0) {
    print('---- COLLINEARITY WARNING (|r| >= ' + CONFIG.audit.maxCorrelation + ') ----');
    redundant.forEach(function (x) { print('  ' + x); });
  }

  // ---- THE SCORE: Weighted Linear Combination ------------------------------
  blocks.forEach(function (b) {
    var s = 0;
    for (var i2 = 0; i2 < weightsArr.length; i2++) { s += weightsArr[i2] * b.v[i2]; }
    b.score = s;
  });

  // ---- FIVE PRIORITY CLASSES - the whole treatable area ---------------------
  var PRIORITY_LABELS = { 1: 'Priority 1 - IMMEDIATE', 2: 'Priority 2 - High', 3: 'Priority 3 - Medium', 4: 'Priority 4 - Low', 5: 'Priority 5 - Deferred' };
  var byScoreDesc = blocks.slice().sort(function (x, y) { return y.score - x.score; });
  if (CONFIG.priorityClassMethod === 'equalInterval') {
    var sMin = byScoreDesc[byScoreDesc.length - 1].score, sMax = byScoreDesc[0].score, span = (sMax - sMin) || 1;
    blocks.forEach(function (b) { var t = (b.score - sMin) / span; b.priorityClass = 5 - Math.min(4, Math.floor(t * 5)); });
  } else {
    byScoreDesc.forEach(function (b, i) { b.priorityClass = Math.min(5, Math.floor(i / (byScoreDesc.length / 5)) + 1); });
  }

  // ---- Cost + carbon per block (New Plantation only) ------------------------
  // Looked up by bid, not by array position: `rows` is FILTERED (blocks below
  // the treatable-ground floor are dropped before this point), so rows[k].idx
  // is not k, and b.id (= original feats index + 1) does not correspond to a
  // position in the filtered array once any block has been skipped. Indexing
  // by position silently pulled the wrong block's phenology/erosion values for
  // every block after the first skip.
  var rowsByBid = {};
  rows.forEach(function (r) { rowsByBid[r.p.bid] = r; });
  var K2 = CONFIG.carbon;
  blocks.forEach(function (b) {
    var rate = CONFIG.costPerHaINR.newPlantation;
    var matchedRow = rowsByBid[b.bid];
    var phenoV = matchedRow ? matchedRow.p.phenologicalAnomaly_mean : null;
    var erosionV = matchedRow ? matchedRow.p.erosionRisk_mean : null;
    var needsClearance = (typeof phenoV === 'number' && phenoV > 0.55);
    if (needsClearance) { rate += CONFIG.costPerHaINR.clearanceSurcharge; }
    if (typeof erosionV === 'number' && erosionV > 20) { rate += CONFIG.costPerHaINR.erosionSurcharge; }
    b.ratePerHa = rate;
    b.costINR = b.eligibleAreaHa * rate;
    b.treatmentLabel = 'New Plantation' + (needsClearance ? ' + Clearance' : '');

    var agbGain = K2.agbGrowthTPerHaYr * K2.horizonYears;
    var totalBiomass = agbGain * (1 + K2.rootShootRatio);
    var cStock = totalBiomass * K2.carbonFraction;
    var soilC  = K2.soilCAccrualTPerHaYr * K2.horizonYears;
    b.tCO2ePerHa = (cStock + soilC) * K2.co2Conversion;
    b.tCO2e = b.tCO2ePerHa * b.eligibleAreaHa;
  });

  var classStats = {};
  [1,2,3,4,5].forEach(function (k) { classStats[k] = { n: 0, ha: 0, cost: 0, co2: 0, scoreMin: Infinity, scoreMax: -Infinity }; });
  var grandHa = blocks.reduce(function (t, b) { return t + b.eligibleAreaHa; }, 0);
  blocks.forEach(function (b) {
    var cs = classStats[b.priorityClass];
    cs.n += 1; cs.ha += b.eligibleAreaHa; cs.cost += b.costINR; cs.co2 += b.tCO2e;
    cs.scoreMin = Math.min(cs.scoreMin, b.score); cs.scoreMax = Math.max(cs.scoreMax, b.score);
    b.priorityLabel = PRIORITY_LABELS[b.priorityClass];
  });

  // ---- "Selected this cycle" - simple greedy by score, up to the area target
  byScoreDesc = blocks.slice().sort(function (x, y) { return y.score - x.score; });
  var cum = 0;
  byScoreDesc.forEach(function (b) {
    if (cum + b.eligibleAreaHa <= CONFIG.targetTreatmentAreaHa) { cum += b.eligibleAreaHa; b.selected = true; } else { b.selected = false; }
  });

  print('================================================================');
  print('CAMPA PRIORITY CLASSES - whole treatable area (' + Math.round(grandHa).toLocaleString('en-IN') + ' ha, ' + blocks.length + ' blocks)');
  print('Treatment: New Plantation only' + (CONFIG.anrOperational ? '' : ' (ANR non-operational under Gujarat CAMPA)'));
  print('================================================================');
  print('  Class                      Blocks      Area(ha)   % of area        Cost(Rs)        tCO2e');
  function padL(v, w) { v = String(v); while (v.length < w) { v = ' ' + v; } return v; }
  function padR(v, w) { v = String(v); while (v.length < w) { v = v + ' '; } return v; }
  [1,2,3,4,5].forEach(function (k) {
    var cs = classStats[k];
    print('  ' + padR(PRIORITY_LABELS[k], 24) + padL(cs.n, 7) + padL(cs.ha.toFixed(1), 14) +
          padL(grandHa > 0 ? (cs.ha / grandHa * 100).toFixed(1) + '%' : '-', 12) +
          padL(Math.round(cs.cost).toLocaleString('en-IN'), 18) + padL(Math.round(cs.co2).toLocaleString('en-IN'), 13));
  });
  print('  ' + padR('TOTAL TREATABLE', 24) + padL(blocks.length, 7) + padL(grandHa.toFixed(1), 14) + padL('100.0%', 12) +
        padL(Math.round(blocks.reduce(function (t,b){return t+b.costINR;},0)).toLocaleString('en-IN'), 18) +
        padL(Math.round(blocks.reduce(function (t,b){return t+b.tCO2e;},0)).toLocaleString('en-IN'), 13));
  print('');
  print('  Score range per class:');
  [1,2,3,4,5].forEach(function (k) {
    var cs = classStats[k];
    print('    ' + PRIORITY_LABELS[k] + ' : ' + (cs.n ? cs.scoreMin.toFixed(4) + ' - ' + cs.scoreMax.toFixed(4) : '(no blocks)'));
  });
  print('');
  print('  Priority 1 = act first. Cost and tCO2e are per class for phasing a multi-year');
  print('  programme. Rates are ASSUMPTIONS pending confirmed APO figures.');
  print('----------------------------------------------------------------');
  print('Top 15 blocks by score:');
  byScoreDesc.slice(0, 15).forEach(function (b) {
    print('#' + b.id + ' | ' + b.eligibleAreaHa.toFixed(1) + ' ha | score ' + b.score.toFixed(4) +
          ' | ' + b.priorityLabel + ' | ' + b.treatmentLabel + ' | ' + Math.round(b.tCO2e) + ' tCO2e' +
          (b.selected ? '  [selected this cycle]' : ''));
  });

  // ============================================================================
  // MAP + EXPORTS
  // ============================================================================
  var bidList = blocks.map(function (b) { return b.bid; });
  var scoreDict = ee.Dictionary.fromLists(bidList, blocks.map(function (b) { return b.score; }));
  var clsDict   = ee.Dictionary.fromLists(bidList, blocks.map(function (b) { return b.priorityClass; }));
  var selDict   = ee.Dictionary.fromLists(bidList, blocks.map(function (b) { return b.selected ? 1 : 0; }));
  var fragDict  = ee.Dictionary.fromLists(bidList, blocks.map(function (b) { return b.fragmented ? 1 : 0; }));
  var scoredGrid = grid.filter(ee.Filter.inList('bid', bidList)).map(function (f) {
    var k = f.get('bid');
    return f.set({ priority: ee.Number(scoreDict.get(k)), priorityClass: ee.Number(clsDict.get(k)),
                   selected: ee.Number(selDict.get(k)), fragmented: ee.Number(fragDict.get(k)) });
  });

  // Class 0 = Not Applicable (grey), 1-5 = Priority (red = act first, green =
  // defer). ONE map layer covers the WHOLE ROI: every pixel is either a
  // priority class or explicitly Not Applicable, never blank.
  var CLASS_PALETTE = ['9e9e9e', 'd7191c', 'fdae61', 'ffffbf', 'a6d96a', '1a9850'];
  var priorityFromBlocks = scoredGrid.reduceToImage(['priorityClass'], ee.Reducer.first()).rename('priorityClass');
  var wholeAreaClassImg = exclusionReason
    ? ee.Image(0).where(exclusionReason.eq(1), priorityFromBlocks).clip(roi).rename('wholeAreaClass')
    : priorityFromBlocks;
  Map.addLayer(wholeAreaClassImg, { min: 0, max: 5, palette: CLASS_PALETTE },
    'CAMPA PRIORITY - whole ROI (grey = Not Applicable)', true);
  Map.addLayer(scoredGrid.filter(ee.Filter.eq('selected', 1)), { color: '00ffff' },
    'Selected this cycle (' + CONFIG.targetTreatmentAreaHa + ' ha target)', true);
  if (exclusionReason) {
    Map.addLayer(exclusionReason.updateMask(exclusionReason.gt(1)),
      { min: 2, max: 6, palette: ['795548', 'ffeb3b', 'e91e63', '2196f3', '9e9e9e'] },
      'Not Applicable - reason breakdown', false);
  }

  try {
    var lg = ui.Panel({ style: { position: 'bottom-right', padding: '8px 15px' } });
    lg.add(ui.Label('CAMPA Priority - whole ROI', { fontWeight: 'bold', fontSize: '15px', margin: '0 0 2px 0' }));
    lg.add(ui.Label(surviving.length + ' criteria, ' + Math.round(roiTotalHa) + ' ha total ROI', { fontSize: '10px', color: '666666', margin: '0 0 6px 0' }));
    [1,2,3,4,5].forEach(function (k) {
      lg.add(ui.Panel({
        widgets: [ui.Label('', { backgroundColor: CLASS_PALETTE[k], padding: '8px', margin: '0 0 4px 0' }),
                  ui.Label(PRIORITY_LABELS[k] + '  (' + classStats[k].ha.toFixed(0) + ' ha)', { margin: '0 0 4px 6px', fontSize: '12px' })],
        layout: ui.Panel.Layout.flow('horizontal')
      }));
    });
    lg.add(ui.Panel({
      widgets: [ui.Label('', { backgroundColor: CLASS_PALETTE[0], padding: '8px', margin: '0 0 4px 0' }),
                ui.Label('Not Applicable  (' + Math.round(reasonSum) + ' ha)', { margin: '0 0 4px 6px', fontSize: '12px' })],
      layout: ui.Panel.Layout.flow('horizontal')
    }));
    Map.add(lg);
  } catch (eLg) {}

  Export.image.toDrive({ image: wholeAreaClassImg.toInt(), description: CONFIG.exportPrefix + '_PriorityClass',
    folder: CONFIG.exportFolder, fileNamePrefix: CONFIG.exportPrefix + '_PriorityClass',
    region: roi.bounds(), scale: CONFIG.scale, crs: PROJ, maxPixels: 1e13 });

  Export.table.toDrive({ collection: scoredGrid, description: CONFIG.exportPrefix + '_PriorityBlocks',
    folder: CONFIG.exportFolder, fileNamePrefix: CONFIG.exportPrefix + '_PriorityBlocks', fileFormat: 'SHP' });

  // Summary rows cover the WHOLE ROI: Priority 1-5 (scored) plus Not
  // Applicable (with its reason breakdown), so the hectares in this table sum
  // to the ROI total - the table an APO note or DPR quotes directly.
  var summaryRows = [1,2,3,4,5].map(function (k) {
    var cs = classStats[k];
    return ee.Feature(null, {
      'Priority Class': k, 'Label': PRIORITY_LABELS[k], 'Blocks': cs.n,
      'Treatable Area (ha)': Number(cs.ha.toFixed(2)),
      'Share of ROI (%)': roiTotalHa > 0 ? Number((cs.ha / roiTotalHa * 100).toFixed(2)) : 0,
      'Estimated Cost (Rs)': Math.round(cs.cost), 'Sequestration (tCO2e)': Number(cs.co2.toFixed(1)),
      'Score Min': cs.n ? Number(cs.scoreMin.toFixed(4)) : '', 'Score Max': cs.n ? Number(cs.scoreMax.toFixed(4)) : '',
      'Treatment': 'New Plantation only'
    });
  });
  summaryRows.push(ee.Feature(null, {
    'Priority Class': 0, 'Label': 'Not Applicable', 'Blocks': allRows.length - rows.length,
    'Treatable Area (ha)': Number(reasonSum.toFixed(2)),
    'Share of ROI (%)': roiTotalHa > 0 ? Number((reasonSum / roiTotalHa * 100).toFixed(2)) : 0,
    'Estimated Cost (Rs)': '', 'Sequestration (tCO2e)': '', 'Score Min': '', 'Score Max': '',
    'Treatment': [2,3,4,5,6].filter(function(rc){return reasonTotals[rc]>0.5;})
      .map(function(rc){ return REASON_LABELS[rc] + ' (' + Math.round(reasonTotals[rc]) + ' ha)'; }).join('; ')
  }));
  Export.table.toDrive({
    collection: ee.FeatureCollection(summaryRows),
    description: CONFIG.exportPrefix + '_PriorityClassSummary', folder: CONFIG.exportFolder,
    fileNamePrefix: CONFIG.exportPrefix + '_PriorityClassSummary', fileFormat: 'CSV'
  });

  var rankedRows = byScoreDesc.map(function (b) {
    var props = {
      'Block ID': b.id, 'Priority Class': b.priorityClass, 'Priority Label': b.priorityLabel,
      'Treatable Area (ha)': Number(b.eligibleAreaHa.toFixed(2)), 'Eligible Fraction': Number(b.eligibleFraction.toFixed(3)),
      'Fragmented': b.fragmented ? 'YES' : 'no',
      'CAMPA Priority Score': Number(b.score.toFixed(4)), 'Treatment': b.treatmentLabel,
      'Rate (Rs/ha)': b.ratePerHa, 'Cost (Rs)': Math.round(b.costINR),
      'Selected This Cycle': b.selected ? 'YES' : 'no'
    };
    props['tCO2e (' + K2.horizonYears + ' yr)'] = Number(b.tCO2e.toFixed(1));
    critNames.forEach(function (nm, i3) { props['score_' + nm] = Number(b.v[i3].toFixed(4)); });
    return ee.Feature(null, props);
  });
  Export.table.toDrive({ collection: ee.FeatureCollection(rankedRows), description: CONFIG.exportPrefix + '_RankedBlocks',
    folder: CONFIG.exportFolder, fileNamePrefix: CONFIG.exportPrefix + '_RankedBlocks', fileFormat: 'CSV' });

  print('----------------------------------------------------------------');
  print('DATA PROVENANCE');
  PROVENANCE.forEach(function (pv) { print('  ' + pv.label + ' | ' + pv.id + ' | ' + pv.nativeResM + ' m | ' + pv.epoch); });

  log('v6 complete. Exports (PriorityClass raster, PriorityBlocks shapefile, ' +
      'PriorityClassSummary CSV, RankedBlocks CSV) are queued in the Tasks tab.');
}

}  // end: eligibleMask && active.length > 0
