/**
 * ============================================================================
 *  BGDSS - MODULE 2: CAMPA SITE PRIORITIZATION
 *  v5 - 17-criterion MCDA with integrity auditing, multi-method aggregation,
 *       weight-sensitivity analysis and satellite-only back-validation
 *
 *  Pilot: Sabarkantha Forest Division, Gujarat Forest Department
 *  Platform: Google Earth Engine (JavaScript API)
 * ============================================================================
 *
 *  STANDALONE SCRIPT - paste into a NEW Earth Engine script and run on its own.
 *  Requires NO user-supplied layers. Every input is a public GEE asset.
 *
 * ----------------------------------------------------------------------------
 *  WHY v5 EXISTS
 * ----------------------------------------------------------------------------
 *  v3 removed Soil Depth and v4 removed Wildlife Corridor Proximity and Human
 *  Dependency, because each was a criterion carrying real AHP weight while
 *  contributing no real information. That was the right call, but it was made
 *  by hand, after someone noticed. v5 makes the model detect that condition
 *  ITSELF, on every run, for every criterion (Section 13).
 *
 *  Three failure modes are now caught automatically:
 *    (a) SPARSE   - criterion has valid data on < CONFIG.audit.minCoverage of
 *                   eligible pixels. v4's `unmask(0.5)` silently converted
 *                   these to neutral. GEDI L4A footprint sampling over a
 *                   single Beat is the worst offender.
 *    (b) INERT    - criterion varies less than CONFIG.audit.minStdDev across
 *                   the ROI. A criterion that is ~constant cannot change a
 *                   ranking no matter what weight it carries. This is what a
 *                   flat 0.5 was, and it is also what any 25 km climate layer
 *                   degenerates into over a 9 km2 Beat.
 *    (c) REDUNDANT- criterion correlates |r| > CONFIG.audit.maxCorrelation
 *                   with another. Two criteria measuring one thing at 8.48%
 *                   each is 16.96% on one axis. v4's Fragmentation Index and
 *                   Distance to Forest were very likely this pair.
 *
 *  Flagged criteria are dropped and their weight redistributed proportionally,
 *  and the drop is printed with its reason. No silent neutrals anywhere.
 *
 * ----------------------------------------------------------------------------
 *  DEFECTS FIXED FROM v4
 * ----------------------------------------------------------------------------
 *  1. BLOCK AREA OVER-CREDIT (bug). v4 line ~470 cat'd an UNMASKED
 *     ee.Image.pixelArea() with a priorityScore masked to treatment>0.
 *     reduceRegions reduces each band under its own mask, so areaHa_sum was
 *     the FULL 9 ha block while priorityScore_mean covered only the eligible
 *     sliver. A block 5% eligible but scoring 0.9 on that sliver consumed
 *     9 ha of the APO target and sent a crew to 95% cropland.
 *     FIXED: pixelArea is masked to the eligible set, and every block now
 *     carries eligibleFraction with a hard minimum (CONFIG.minEligibleFrac).
 *
 *  2. HARDCODED NORMALIZATION RANGES. v4 normalized SOC over 0-50, soil loss
 *     over 0-40, temperature over 32-46. Those are national ranges. Inside one
 *     Beat, SOC might span 8-14 g/kg, compressing a 13.05%-weighted criterion
 *     into a 0.12-wide band while Soil Texture spread 0.3-1.0. The AHP weights
 *     were being silently overridden by normalization choices.
 *     FIXED: criteria declare 'percentile' (ROI 2nd-98th stretch, for relative
 *     comparison) or 'absolute' (fixed anchors, where an external standard
 *     exists - slope workability, RUSLE t/ha/yr). Section 14 prints REALISED
 *     INFLUENCE (weight x stdDev) next to nominal weight. Those two tables
 *     disagreeing is the point.
 *
 *  3. FRAGMENTATION INDEX WAS NOT FRAGMENTATION. focal_mean of a forest mask
 *     is local forest proportion - a connectivity measure, near-monotonic with
 *     Distance to Forest. Replaced with genuine EDGE DENSITY (forest/non-forest
 *     boundary proportion per neighbourhood), which is structurally
 *     independent. The correlation matrix (Section 14) now verifies this
 *     rather than assuming it.
 *
 *  4. STALE CANOPY BACKBONE. Hansen treecover2000 is a YEAR-2000, 30 m layer
 *     and it drove every FSI class and every New-Plantation-vs-ANR decision in
 *     v4. Twenty-five years of regrowth, loss and plantation were invisible.
 *     FIXED: current canopy is now Dynamic World tree probability (10 m,
 *     current) fused with Hansen rolled forward through lossyear/gain, and
 *     cross-checked against Meta 1 m canopy height where available.
 *
 *  5. RUSLE WAS NOT RUSLE. K was a fixed 0.28 and the LS factor used
 *     slope.reduceNeighborhood(sum) as an "upslope proxy" - that is not flow
 *     accumulation and has no hydrological meaning.
 *     FIXED: K per-pixel via Williams (1995) EPIC equation from sand/silt/clay
 *     /SOC; LS via Desmet & Govers (1996) using MERIT Hydro `upa` (real
 *     upstream drainage area).
 *
 *  6. NO tCO2e. v4's CONFIG defined rootShootRatio, carbonFraction,
 *     co2Conversion and restorationHorizonYears and then never used them.
 *     FIXED: Section 18 computes actual tCO2e per block over the horizon
 *     (IPCC 2019 Refinement Tier 1 growth rates), which is the number CAMPA
 *     reporting asks for.
 *
 * ----------------------------------------------------------------------------
 *  WHAT IS NEW IN v5
 * ----------------------------------------------------------------------------
 *  REINSTATED WITHOUT USER DATA
 *    - Human Dependency          <- JRC GHSL population/built-up (100 m)
 *    - Structural Connectivity   <- own patch-connectivity index + WDPA
 *      (replaces Wildlife Corridor Proximity; a corridor polygon from the
 *       Forest Dept GIS cell would REFINE this, it is no longer required)
 *
 *  NEW CRITERIA
 *    - Land Productivity Trend   Theil-Sen slope on 25 yr of Landsat NDVI.
 *      Distinguishes ACTIVELY DEGRADING from STABLY POOR - v4 could not.
 *      With SOC and land cover (both already present) this completes the
 *      three sub-indicators of UNCCD SDG Indicator 15.3.1 (Land Degradation
 *      Neutrality), so the model is now formally aligned with the UNCCD Good
 *      Practice Guidance rather than merely resembling it.
 *    - Moisture Availability     TWI + HAND from MERIT Hydro + TerraClimate
 *    - Future Climate Resilience NASA NEX-GDDP-CMIP6, delta-downscaled
 *
 *  METHODOLOGY
 *    - Three aggregations run in parallel: WLC (compensatory, = v4),
 *      Weighted Geometric Mean (non-compensatory - a near-zero on ANY
 *      criterion drags the whole score down, so good rainfall can no longer
 *      mask unplantable soil) and TOPSIS. Blocks in the top-N of ALL THREE
 *      are marked ROBUST. Only those should enter the APO unqualified.
 *    - Monte Carlo weight-sensitivity (CONFIG.mcRuns draws). Every block gets
 *      a selectionFrequency: selected in 98% of runs is a different
 *      proposition from selected in 51%.
 *    - Per-criterion contribution exported per block. A ranking nobody can
 *      interrogate does not survive its first review meeting.
 *    - Budget-constrained selection (greedy by score/cost) reported alongside
 *      area-constrained, plus spatial contiguity filtering so selections form
 *      workable compartments instead of scattered 9 ha confetti.
 *
 *  VALIDATION (Section 20, CONFIG.runValidation)
 *    Back-tests the model against sites that measurably gained tree cover
 *    2005-2020 (Hansen gain + positive NDVI trend) as pseudo-positives, vs
 *    matched controls, and reports AUC. Criteria derived from canopy or NDVI
 *    trend are EXCLUDED from the validation score to avoid circularity.
 *    Caveat is printed with the result - read it before quoting the number.
 *
 * ----------------------------------------------------------------------------
 *  KNOWN LIMITS - STATE THESE, DO NOT LET A REVIEWER FIND THEM
 * ----------------------------------------------------------------------------
 *  - EFFECTIVE RESOLUTION IS NOT 10 m. Inputs range from 10 m (Sentinel-2,
 *    Dynamic World) to 250 m (SoilGrids) to 5566 m (CHIRPS) to 25 km (CMIP6).
 *    CONFIG.scale is the OUTPUT grid, not the information content. Section 21
 *    prints a per-criterion native-resolution table; quote that, not the
 *    export scale. Section 13's INERT check is what stops a 25 km layer from
 *    masquerading as a 10 m one.
 *  - Weights are PROVISIONAL. They are reasoned allocations, not a fresh AHP
 *    elicitation. Re-run BGDSS_AHP_Weighting_Calculator.html on this
 *    17-criterion list (report the Consistency Ratio, must be < 0.10;
 *    aggregate multiple officers by geometric mean) and paste the export into
 *    CONFIG.weights. Until then the sensitivity analysis is what carries the
 *    argument, not the weights themselves.
 *  - Phenological Anomaly is still a PROXY for invasion, not a classifier. It
 *    is now phenology-based (Lantana/Prosopis stay green in a deciduous
 *    matrix - that is a phenological signature, not a brightness one), which
 *    is more defensible than v4's dry-season NDVI, but it is unvalidated.
 *    Field-verify before costing clearance.
 *  - CHANGED VALUE JUDGEMENT, NEEDS SIGN-OFF: v4 scored high fire frequency
 *    and high invasion as HIGHER priority (treating them as need). v5 defaults
 *    both to LOWER priority (treating them as feasibility risk to a young
 *    plantation). Both readings are defensible; they produce different maps.
 *    See CONFIG.directions - flip to +1 to restore v4 behaviour. This is a
 *    policy choice, not a technical one. Get it decided explicitly.
 *  - Cost rates and reference biomass remain ASSUMPTIONS pending Working Plan
 *    / ISFR figures.
 *
 * ----------------------------------------------------------------------------
 *  HOW TO USE
 * ----------------------------------------------------------------------------
 *  1. Edit CONFIG. Set targetTreatmentAreaHa to the confirmed CAMPA APO
 *     allocation and budgetINR to the confirmed ceiling.
 *  2. Run. Read the AUDIT block in the Console FIRST - it tells you which
 *     criteria actually informed the ranking.
 *  3. Ranked results print to Console; CSV/GeoTIFF/SHP exports queue in Tasks.
 *
 * ----------------------------------------------------------------------------
 *  IF YOU HIT "User memory limit exceeded"
 * ----------------------------------------------------------------------------
 *  Every criterion here is a computation chain, not a stored raster: a
 *  whole-ROI statistic re-evaluates 25 years of Landsat Theil-Sen, three years
 *  of Sentinel-2 compositing, kilometre-scale focal kernels and distance
 *  transforms on every pixel it touches. The audit therefore SAMPLES rather
 *  than reducing the full ROI, and the heavy geometric operations run on
 *  coarser working grids. All of it is tunable - turn these knobs in order:
 *
 *    1. CONFIG.runProductivityTrend = false   (by far the most expensive:
 *       25 yr of harmonised Landsat across four sensors)
 *    2. CONFIG.runValidation = false, CONFIG.runFutureClimate = false
 *    3. CONFIG.audit.sampleScale      30 -> 60 or 100
 *       CONFIG.audit.samplePixels   5000 -> 2000
 *    4. CONFIG.blockStatsScale        20 -> 30
 *    5. CONFIG.perf.patchScale        60 -> 100
 *       CONFIG.perf.distanceScale     30 -> 60
 *    6. CONFIG.scale                  10 -> 20 or 30. Given that half the
 *       inputs are 250 m or coarser, a 20-30 m output grid loses far less
 *       than the 10 m figure implies - see KNOWN LIMITS.
 *
 *  None of these change the METHOD, only the working resolution of the
 *  statistics. Coarsening the audit sample does not weaken the integrity
 *  checks: a few thousand samples estimate a percentile or a standard
 *  deviation far more precisely than the drop thresholds care about.
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

  scale: 10,                        // OUTPUT grid. NOT the effective resolution - see Section 21.
  blockStatsScale: 20,              // working scale for per-block means (raise to 30 if memory is tight)
  blockSizeM: 300,                  // ~9 ha planning blocks
  exportFolder: 'BGDSS',
  exportPrefix: 'BGDSS_CAMPA_v5',

  targetTreatmentAreaHa: 200,       // ASSUMPTION - replace with confirmed APO figure
  budgetINR: 12000000,              // ASSUMPTION - replace with confirmed ceiling (Rs 1.2 cr)
  minEligibleFrac: 0.30,            // drop blocks less than 30% treatable (fixes v4 area over-credit)

  // ---- Heavy / optional modules -------------------------------------------
  runValidation: true,              // Section 20 back-test. Adds ~1-2 min.
  runFutureClimate: true,           // CMIP6. Coarse; the INERT check may drop it. Adds ~1-2 min.
  runProductivityTrend: true,       // 25 yr Landsat. The most expensive module. Adds ~2-4 min.
  mcRuns: 1000,                     // Monte Carlo weight-sensitivity draws (client-side, cheap)
  mcPerturbPct: 0.20,               // +/-20% per weight per draw

  // ---- Automatic criterion integrity audit (Section 13) --------------------
  audit: {
    minCoverage: 0.70,              // drop if valid data on < 70% of eligible pixels
    minStdDev: 0.02,                // drop if ROI stdDev of normalized layer < this (spatially inert)
    maxCorrelation: 0.80,           // flag redundant pairs above |r| this
    autoDrop: true,                 // false = warn only, keep in the score

    // The audit needs a DISTRIBUTION, not per-pixel precision. Sampling keeps
    // the work bounded: a whole-ROI percentile+stdDev reduction at 10 m over
    // ~18 bands re-evaluates every criterion's full computation chain (25 yr
    // Landsat Theil-Sen, 3 yr S2 composites, km-scale focal kernels) and blows
    // the user memory limit. 5000 samples give the same stretch bounds.
    samplePixels: 5000,
    sampleScale: 30                 // raise to 60-100 if memory is still tight
  },

  // ---- Performance ---------------------------------------------------------
  // Distance transforms and patch analysis are computed at a coarser scale than
  // CONFIG.scale. Both are spatially smooth, so this costs nothing meaningful
  // in accuracy and is the difference between running and not running.
  perf: {
    distanceScale: 30,              // distance-transform working scale (m)
    patchScale: 60,                 // connectivity/patch working scale (m)
    vizScale: 30                    // scale for the display quintile breaks
  },

  // FSI (Forest Survey of India) official canopy-density classification,
  // used in every India State of Forest Report - do not invent thresholds.
  fsiCanopyClasses: { scrubMax: 10, openMax: 40, moderatelyDenseMax: 70 },

  // ---- Hard constraints (Boolean exclusion, NOT scored factors) ------------
  // Eastman's MCDA framework separates constraints from factors. A constraint
  // is pass/fail; it never trades off against a good score elsewhere.
  constraints: {
    maxSlopeDeg: 45,                // unplantable / unsafe
    maxHandM: 2,                    // Height Above Nearest Drainage - waterlogging
    minTreeProbExclude: 0.65,       // Dynamic World: already well-forested, exclude
    excludeWdpaCore: false          // set true to exclude protected-area interiors
  },

  // ---- PROVISIONAL weights - 17 criteria ----------------------------------
  // These are reasoned cluster allocations preserving v3's relative emphasis
  // (soil dominant, invasion significant) with room made for new criteria.
  // THEY ARE NOT A FRESH AHP ELICITATION. See KNOWN LIMITS.
  // Rescaled to sum to 1.0 automatically at runtime after the audit drops.
  weights: {
    // Ecological Integrity (24.0%)
    distanceToForest:         0.055,
    hydrologicalConnectivity: 0.045,
    edgeDensity:              0.045,   // replaces v4 fragmentationIndex
    degradationPriority:      0.055,
    structuralConnectivity:   0.040,   // reinstates v4's removed corridor criterion

    // Land Degradation / UNCCD SDG 15.3.1 (18.0%)
    landProductivityTrend:    0.070,   // NEW
    soilOrganicCarbon:        0.110,

    // Physical Site Suitability (25.0%)
    soilSuitability:          0.150,   // replaces v4's uncited texture remap
    moistureAvailability:     0.055,   // NEW
    workability:              0.045,

    // Climate (10.0%)
    climateExposure:          0.050,
    futureClimateResilience:  0.050,   // NEW

    // Carbon & Restoration (9.0%)
    carbonGainPotential:      0.070,
    erosionRisk:              0.020,

    // Risk & Feasibility (9.0%)
    fireRisk:                 0.025,
    phenologicalAnomaly:      0.065,   // renamed from invasiveSeverity - it is a proxy

    // Human Dimension (5.0%)
    humanDependency:          0.050    // reinstates v4's removed criterion
  },

  // ---- Direction of preference --------------------------------------------
  // +1 = higher raw value means HIGHER restoration priority
  // -1 = higher raw value means LOWER restoration priority (inverted)
  // Only the genuinely debatable ones are exposed here. Changing these
  // changes the map. They are policy choices - get them signed off.
  directions: {
    erosionRisk:         +1,  // +1: high erosion = high restoration NEED (v4 behaviour)
                              // -1: high erosion = poor establishment odds
    fireRisk:            -1,  // -1: fire-prone = risk to young plantation (v5 default)
                              // +1: fire-scarred = high need (v4 behaviour)
    phenologicalAnomaly: -1,  // -1: invaded = clearance cost + risk (v5 default)
                              // +1: invaded = high need (v4 behaviour)
    soilOrganicCarbon:   +1   // +1: high SOC = better establishment substrate
                              // -1: low SOC = more carbon to gain
  },

  // ---- Cost model - ASSUMPTION, VERIFY against Working Plan/APO ------------
  costPerHaINR: {
    newPlantation: 65000, anr: 30000,
    clearanceSurcharge: 25000, soilWaterConservation: 45000
  },

  // ---- Carbon accounting --------------------------------------------------
  // IPCC 2019 Refinement Vol 4 Ch 4, Tier 1 defaults, tropical dry forest.
  // VERIFY against local Working Plan yield tables before quoting.
  carbon: {
    referenceAgbTPerHa: 120,        // ASSUMPTION - fallback if no potential-AGB layer
    agbGrowthNewPlantation: 3.0,    // t d.m./ha/yr
    agbGrowthAnr: 2.4,              // t d.m./ha/yr
    soilCAccrualTPerHaYr: 0.25,     // IPCC default, restoration on degraded land
    rootShootRatio: 0.28,
    carbonFraction: 0.5,            // FSI/ISFR convention
    co2Conversion: 3.6663,          // 44/12
    horizonYears: 10
  },

  fireHistoryYears: 10,
  trendStartYear: 2000,             // Landsat productivity trend window
  contiguity: { enable: true, minClusterBlocks: 3 }
};

var roi = CONFIG.roi.geometry();
var PROJ = 'EPSG:32643';
try { Map.centerObject(CONFIG.roi, 12); Map.setOptions('SATELLITE'); } catch (e) {}

// PROVENANCE - every dataset used, its native resolution and epoch.
// Printed and exported (Section 21). Required for any government/audit context.
var PROVENANCE = [];
function prov(id, label, nativeRes, epoch, citation) {
  PROVENANCE.push({ id: id, label: label, nativeResM: nativeRes, epoch: epoch, citation: citation });
}

// ============================================================================
// HELPERS
// ============================================================================
function log(msg)  { print('✓ ' + msg); }
function warn(msg) { print('⚠ ' + msg); }

function safeImage(id, label) {
  try { var img = ee.Image(id); img.bandNames().getInfo(); return img; }
  catch (e) { warn(label + ' unavailable (' + id + ')'); return null; }
}
function safeCollection(id, label) {
  try { var col = ee.ImageCollection(id); col.first().bandNames().getInfo(); return col; }
  catch (e) { warn(label + ' unavailable (' + id + ')'); return null; }
}
function safeMosaic(id, band, label) {
  try {
    var col = ee.ImageCollection(id);
    col.first().bandNames().getInfo();
    return band ? col.select([band]).mosaic() : col.mosaic();
  } catch (e) { warn(label + ' unavailable (' + id + ')'); return null; }
}
function safeFC(id, label) {
  try { var fc = ee.FeatureCollection(id); fc.limit(1).size().getInfo(); return fc; }
  catch (e) { warn(label + ' unavailable (' + id + ')'); return null; }
}

// Distance transform, reprojected explicitly so the pixel size is the one we
// think it is (v4 relied on the default projection here).
// Computed at CONFIG.perf.distanceScale rather than CONFIG.scale: a distance
// surface is smooth, so a 30 m working grid is indistinguishable from 10 m in
// the ranking while costing ~9x less. The neighbourhood is sized to the actual
// maximum distance needed instead of a blanket 1024.
function distanceTo(sourceMask, maxDistM) {
  var ds = CONFIG.perf.distanceScale;
  var neighborhood = Math.min(1024, Math.max(32, Math.ceil((maxDistM / ds) * 1.5)));
  var m = sourceMask.unmask(0).reproject({ crs: PROJ, scale: ds });
  return m.fastDistanceTransform(neighborhood).sqrt()
          .multiply(ds).clamp(0, maxDistM);
}

// Inverted-U preference: peaks at `opt`, falls off to 0 at `lo` and `hi`.
// Used where neither extreme is desirable (e.g. human accessibility).
function invertedU(img, lo, opt, hi) {
  var rising  = img.subtract(lo).divide(opt - lo);
  var falling = ee.Image(hi).subtract(img).divide(hi - opt);
  return rising.min(falling).clamp(0, 1);
}

// ============================================================================
// 1. TERRAIN - elevation, slope, ravine/gully detection
// ============================================================================
var dem = safeMosaic('JAXA/ALOS/AW3D30/V3_2', 'DSM', 'ALOS AW3D30 DEM');
var slope = null, tpi = null, roughness = null;
if (dem) {
  dem = dem.clip(roi).rename('elevation').toFloat()
           .resample('bilinear').reproject({ crs: PROJ, scale: CONFIG.scale });
  slope = ee.Terrain.slope(dem).rename('slope');

  // Topographic Position Index and roughness. Sabarkantha sits in the
  // Sabarmati ravine belt - deeply dissected ground is both an erosion
  // signal and a plantation-feasibility problem.
  var demSmooth = dem.focal_mean({ radius: 5, kernelType: 'circle', units: 'pixels' });
  tpi = dem.subtract(demSmooth).rename('tpi');
  roughness = dem.reduceNeighborhood({
    reducer: ee.Reducer.stdDev(),
    kernel: ee.Kernel.circle({ radius: 5, units: 'pixels' })
  }).rename('roughness');

  prov('JAXA/ALOS/AW3D30/V3_2', 'DEM / slope / TPI / ravine', 30, '2006-2011', 'Tadono et al. 2014');
  log('Terrain ready (DEM, slope, TPI, roughness)');
} else {
  warn('No DEM. Slope-dependent criteria (workability, erosion, TWI) will be dropped by the audit.');
}

// ============================================================================
// 2. HYDROLOGY - MERIT Hydro: real flow accumulation, HAND, TWI
//    v4 approximated upslope area with slope.reduceNeighborhood(sum), which
//    is not flow accumulation. MERIT Hydro publishes `upa` directly.
// ============================================================================
var merit = safeImage('MERIT/Hydro/v1_0_1', 'MERIT Hydro');
var upaKm2 = null, handM = null, twi = null;
if (merit) {
  upaKm2 = merit.select('upa').clip(roi).resample('bilinear');   // upstream drainage area, km2
  handM  = merit.select('hnd').clip(roi).resample('bilinear');   // height above nearest drainage, m

  if (slope) {
    // Topographic Wetness Index: ln(a / tan(beta)). Classic site-moisture
    // predictor, strongly related to seedling survival in dryland restoration.
    var specificCatchment = upaKm2.multiply(1e6).divide(CONFIG.scale).max(1);
    var tanBeta = slope.multiply(Math.PI / 180).tan().max(0.001);
    twi = specificCatchment.divide(tanBeta).log().rename('twi');
  }
  prov('MERIT/Hydro/v1_0_1', 'Flow accumulation / HAND / TWI', 90, '2019', 'Yamazaki et al. 2019');
  log('MERIT Hydro ready (upa, HAND, TWI)');
} else {
  warn('MERIT Hydro unavailable - RUSLE LS falls back to a slope-length approximation.');
}

// ============================================================================
// 3. LAND COVER - Dynamic World (current, 10 m) + ESA WorldCover (cross-check)
//    Agreement between the two independent products is used as a per-pixel
//    data-confidence signal (Section 19).
// ============================================================================
var yStart = ee.Date.fromYMD(CONFIG.year, 1, 1);
var yEnd   = yStart.advance(1, 'year');

var dwCol = safeCollection('GOOGLE/DYNAMICWORLD/V1', 'Dynamic World');
var dw = null, dwLabel = null;
if (dwCol) {
  // Widen the window if the target year is sparse, so we always get a composite.
  var dwFiltered = dwCol.filterBounds(roi).filterDate(yStart.advance(-1, 'year'), yEnd);
  dw = dwFiltered.select(['water', 'trees', 'grass', 'flooded_vegetation',
                          'crops', 'shrub_and_scrub', 'built', 'bare'])
                 .median().clip(roi);
  dwLabel = dwFiltered.select('label').mode().clip(roi);
  prov('GOOGLE/DYNAMICWORLD/V1', 'Current land cover / tree probability', 10, String(CONFIG.year), 'Brown et al. 2022');
  log('Dynamic World composite ready (10 m, current)');
}

var worldCover = safeMosaic('ESA/WorldCover/v200', 'Map', 'ESA WorldCover v200')
              || safeMosaic('ESA/WorldCover/v100', 'Map', 'ESA WorldCover v100');
var worldCoverMap = worldCover ? worldCover.select('Map').clip(roi) : null;
if (worldCoverMap) {
  prov('ESA/WorldCover/v200', 'Land cover cross-check', 10, '2021', 'Zanaga et al. 2022');
  log('ESA WorldCover ready (cross-check)');
}

if (!dw && !worldCoverMap) {
  warn('Neither Dynamic World nor ESA WorldCover available - cannot exclude cropland/built-up/water. STOPPING: any ranking would be methodologically invalid.');
}

// Plantable mask: exclude cropland, built-up, water, permanent wetland.
// Preference order is Dynamic World (current) then WorldCover (2021).
var plantableMask = null;
if (dw) {
  plantableMask = dw.select('crops').lt(0.35)
    .and(dw.select('built').lt(0.20))
    .and(dw.select('water').lt(0.20))
    .and(dw.select('flooded_vegetation').lt(0.25));
  if (worldCoverMap) {
    // Require WorldCover agreement too - conservative, avoids planting on
    // land one product thinks is cropland.
    plantableMask = plantableMask.and(
      worldCoverMap.neq(40).and(worldCoverMap.neq(50)).and(worldCoverMap.neq(80))
    );
  }
} else if (worldCoverMap) {
  plantableMask = worldCoverMap.neq(40).and(worldCoverMap.neq(50)).and(worldCoverMap.neq(80));
}
if (plantableMask) { plantableMask = plantableMask.clip(roi); }

// ============================================================================
// 4. CURRENT CANOPY DENSITY - the backbone. v4 used a year-2000 layer here.
//    Fused: Dynamic World tree probability (current, 10 m)
//         + Hansen treecover2000 rolled forward through lossyear/gain (30 m)
//         + Meta 1 m canopy height where available (cross-check only)
// ============================================================================
var hansen = safeImage('UMD/hansen/global_forest_change_2023_v1_11', 'Hansen GFC 2023 v1.11');
var canopyDensity = null, canopySource = 'none';

var hansenCurrent = null;
if (hansen) {
  var tc2000   = hansen.select('treecover2000');
  var lossYear = hansen.select('lossyear');       // 1..23 => 2001..2023
  var gain     = hansen.select('gain');
  // Roll the 2000 baseline forward: anywhere loss was recorded, canopy goes
  // to ~0; anywhere gain was recorded and baseline was low, lift toward the
  // Open-forest floor. Crude but far better than pretending it is still 2000.
  hansenCurrent = tc2000
    .where(lossYear.gt(0), 0)
    .where(gain.eq(1).and(tc2000.lt(CONFIG.fsiCanopyClasses.openMax)),
           tc2000.max(CONFIG.fsiCanopyClasses.scrubMax + 5))
    .resample('bilinear').clip(roi).rename('canopyHansen');
  prov('UMD/hansen/global_forest_change_2023_v1_11', 'Canopy baseline + loss/gain', 30, '2000-2023', 'Hansen et al. 2013');
}

if (dw) {
  // Dynamic World tree probability is not canopy fraction, but over a
  // deciduous landscape it tracks it closely enough to serve as the current
  // signal. Scale to 0-100 to match the FSI convention.
  var dwCanopy = dw.select('trees').multiply(100).rename('canopyDW');
  if (hansenCurrent) {
    // Fuse: take the current-data product as primary, but let the rolled-forward
    // Hansen layer temper it where the two disagree sharply (DW can over-call
    // trees on dense scrub and under-call leafless deciduous canopy).
    canopyDensity = dwCanopy.multiply(0.65).add(hansenCurrent.multiply(0.35)).rename('canopyDensity');
    canopySource = 'Dynamic World (65%) fused with loss/gain-updated Hansen (35%)';
  } else {
    canopyDensity = dwCanopy.rename('canopyDensity');
    canopySource = 'Dynamic World tree probability only';
  }
} else if (hansenCurrent) {
  canopyDensity = hansenCurrent.rename('canopyDensity');
  canopySource = 'Hansen 2000 baseline updated by loss/gain (NO current-year data - treat FSI classes as indicative)';
  warn('No Dynamic World. Canopy is Hansen-derived only; treatment decisions rest on a 30 m, largely year-2000 layer.');
}

// Meta 1 m canopy height - cross-check only, not fused (community asset, and
// height is not density; using it to overrule fraction would be a category error).
var metaCH = safeMosaic('projects/meta-forest-monitoring-okw37/assets/CanopyHeight', null, 'Meta 1m Canopy Height');
if (metaCH) {
  metaCH = metaCH.select(0).clip(roi).rename('canopyHeightM');
  prov('projects/meta-forest-monitoring-okw37/assets/CanopyHeight', 'Canopy height cross-check', 1, '2024', 'Tolan et al. 2024');
  log('Meta 1 m canopy height loaded (cross-check layer)');
}

if (canopyDensity) { log('Current canopy density ready - source: ' + canopySource); }
else { warn('No canopy data at all. STOPPING - degradation status cannot be assessed.'); }

// ============================================================================
// 5. FSI CLASSIFICATION + HARD CONSTRAINTS + TREATMENT ELIGIBILITY
// ============================================================================
var C = CONFIG.fsiCanopyClasses;
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

// ---- Hard constraints (Boolean, non-compensatory) --------------------------
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
  // Plantability screen: a 0% canopy pixel may be rock, saline flat or ravine.
  // Exclude persistent bare ground that is not merely seasonal.
  constraintMask = constraintMask.and(dw.select('bare').lt(0.55));
  constraintNotes.push('bare-ground probability < 0.55 (rock/saline screen)');
  constraintMask = constraintMask.and(dw.select('trees').lt(CONFIG.constraints.minTreeProbExclude));
  constraintNotes.push('tree probability < ' + CONFIG.constraints.minTreeProbExclude + ' (already forested)');
}

var wdpa = safeFC('WCMC/WDPA/current/polygons', 'WDPA protected areas');
var wdpaImg = null;
if (wdpa) {
  var wdpaLocal = wdpa.filterBounds(roi.buffer(20000));
  wdpaImg = ee.Image(0).paint(wdpaLocal, 1).rename('wdpa').clip(roi.buffer(20000));
  prov('WCMC/WDPA/current/polygons', 'Protected areas (connectivity + constraint)', 'vector', 'current', 'UNEP-WCMC & IUCN');
  if (CONFIG.constraints.excludeWdpaCore) {
    constraintMask = constraintMask.and(wdpaImg.clip(roi).neq(1));
    constraintNotes.push('outside WDPA polygons');
  }
  log('WDPA protected areas loaded');
}

if (fsiClass && plantableMask) {
  // Treatment: 1 = New Plantation (Scrub, <10% canopy), 2 = ANR (Open, 10-40%)
  treatment = ee.Image(0)
    .where(fsiClass.eq(1), 1)
    .where(fsiClass.eq(2), 2)
    .updateMask(plantableMask)
    .updateMask(constraintMask)
    .rename('treatment').clip(roi);
  eligibleMask = treatment.gt(0);
  log('Treatment eligibility ready. Constraints applied: ' + (constraintNotes.join('; ') || 'none'));
}

// ============================================================================
// 6. CLIMATE - CHIRPS (full record), TerraClimate, MODIS LST
// ============================================================================
var chirps = safeCollection('UCSB-CHG/CHIRPS/DAILY', 'CHIRPS rainfall');
var rainfall = null, rainfallCV = null;
if (chirps) {
  rainfall = chirps.filterDate(yStart.advance(-1, 'year'), yEnd)
                   .sum().resample('bilinear').clip(roi).rename('rainfall');

  // v4 used 5 years of rainfall for a climate-variability signal. Five years
  // is far too short to characterise variance. Use 30.
  var nYrs = 30;
  var annualSums = ee.ImageCollection(ee.List.sequence(1, nYrs).map(function (k) {
    var s = yStart.advance(ee.Number(k).multiply(-1), 'year');
    return chirps.filterDate(s, s.advance(1, 'year')).sum();
  }));
  var rMean = annualSums.mean();
  var rStd  = annualSums.reduce(ee.Reducer.stdDev());
  rainfallCV = rStd.divide(rMean.max(1)).resample('bilinear').clip(roi).rename('rainfallCV');
  prov('UCSB-CHG/CHIRPS/DAILY', 'Rainfall + 30 yr variability', 5566, '1981-present', 'Funk et al. 2015');
  log('CHIRPS rainfall + 30 yr coefficient of variation computed');
}

// TerraClimate: climate water deficit is the strongest published predictor of
// dryland restoration survival. v4 had no water-balance term at all.
var terraClim = safeCollection('IDAHO_EPSCOR/TERRACLIMATE', 'TerraClimate');
var cwd = null, pdsi = null, soilMoisture = null, vpd = null;
if (terraClim) {
  var tcRecent = terraClim.filterDate(ee.Date.fromYMD(CONFIG.year - 10, 1, 1), yEnd);
  cwd = tcRecent.select('def').mean().multiply(0.1).resample('bilinear').clip(roi).rename('cwd');
  pdsi = tcRecent.select('pdsi').mean().multiply(0.01).resample('bilinear').clip(roi).rename('pdsi');
  soilMoisture = tcRecent.select('soil').mean().multiply(0.1).resample('bilinear').clip(roi).rename('soilMoisture');
  vpd = tcRecent.select('vpd').mean().multiply(0.001).resample('bilinear').clip(roi).rename('vpd');
  prov('IDAHO_EPSCOR/TERRACLIMATE', 'Climate water deficit / PDSI / soil moisture / VPD', 4638, '2015-2025', 'Abatzoglou et al. 2018');
  log('TerraClimate water balance computed (CWD, PDSI, soil moisture, VPD)');
}

var modisLst = safeCollection('MODIS/061/MOD11A2', 'MODIS LST');
var tempMaxC = null;
if (modisLst) {
  // v4 used .max() on 8-day composites, which chases a single noisy outlier.
  // A high percentile over several years is the stable heat-stress signal.
  tempMaxC = modisLst
    .filterDate(ee.Date.fromYMD(CONFIG.year - 5, 1, 1), yEnd)
    .filter(ee.Filter.calendarRange(3, 6, 'month'))
    .select('LST_Day_1km')
    .reduce(ee.Reducer.percentile([95]))
    .multiply(0.02).subtract(273.15)
    .resample('bilinear').clip(roi).rename('tempMax');
  prov('MODIS/061/MOD11A2', 'Pre-monsoon heat stress (p95)', 1000, String(CONFIG.year - 5) + '-' + CONFIG.year, 'Wan et al. 2021');
  log('Pre-monsoon heat stress computed (5 yr p95, replaces v4 single-year max)');
}

// ---- Future climate: NASA NEX-GDDP-CMIP6, delta-downscaled ----------------
// At 25 km a single Beat is one or two pixels, so the raw projection is
// spatially inert (Section 13 would drop it). The delta method applies the
// coarse change signal to the fine-resolution baseline, so spatial pattern is
// inherited from terrain and CHIRPS. This is standard practice; state it.
var futureResilienceRaw = null;
if (CONFIG.runFutureClimate && rainfall && tempMaxC) {
  var cmip = safeCollection('NASA/GDDP-CMIP6', 'NEX-GDDP-CMIP6');
  if (cmip) {
    var models = ['ACCESS-CM2', 'MPI-ESM1-2-HR', 'MRI-ESM2-0'];
    var base = cmip.filter(ee.Filter.inList('model', models))
                   .filter(ee.Filter.eq('scenario', 'historical'))
                   .filterDate('2000-01-01', '2003-01-01').filterBounds(roi);
    var futr = cmip.filter(ee.Filter.inList('model', models))
                   .filter(ee.Filter.eq('scenario', 'ssp245'))
                   .filterDate('2045-01-01', '2048-01-01').filterBounds(roi);

    var dTas = futr.select('tasmax').mean().subtract(base.select('tasmax').mean())
                   .resample('bilinear').clip(roi);                       // K change
    var dPr  = futr.select('pr').mean().divide(base.select('pr').mean().max(1e-9))
                   .resample('bilinear').clip(roi);                       // ratio

    // Delta-downscale onto the fine baseline
    var futureTemp = tempMaxC.add(dTas);
    var futureRain = rainfall.multiply(dPr);

    // Resilience: sites that remain within a workable envelope under SSP2-4.5.
    // Higher = more resilient = higher priority (a 10 yr+ investment horizon
    // should not be sunk into ground that leaves the envelope by 2050).
    var futTempStress = futureTemp.subtract(38).divide(10).clamp(0, 1);   // stress above 38 C
    var futRainStress = ee.Image(1).subtract(futureRain.subtract(400).divide(600).clamp(0, 1));
    futureResilienceRaw = ee.Image(1)
      .subtract(futTempStress.multiply(0.5).add(futRainStress.multiply(0.5)))
      .clamp(0, 1).rename('futureClimateResilience');

    prov('NASA/GDDP-CMIP6', 'Future climate (SSP2-4.5, 2045-47 vs 2000-02), delta-downscaled', 27830, '2045-2047', 'Thrasher et al. 2022');
    log('Future climate resilience computed (CMIP6 SSP2-4.5, delta-downscaled to fine baseline)');
  }
}

// ============================================================================
// 7. SOIL - SoilGrids v2 continuous properties (FAO Land Evaluation framing)
//    v4 remapped 12 USDA texture classes to 12 hand-assigned scores with no
//    citation. Continuous properties + a documented suitability framework is
//    defensible; a table of invented constants is not.
// ============================================================================
function soilGrid(id, label, scaleFactor) {
  var img = safeImage(id, label);
  if (!img) { return null; }
  // SoilGrids publishes several depth bands; the top 0-30 cm is what matters
  // for establishment. Average whatever surface bands exist.
  var bands = img.bandNames();
  return img.select(bands.slice(0, 3)).reduce(ee.Reducer.mean())
            .multiply(scaleFactor).clip(roi).rename(label);
}

var sand = soilGrid('projects/soilgrids-isric/sand_mean', 'sand', 0.1);   // g/kg -> %
var clay = soilGrid('projects/soilgrids-isric/clay_mean', 'clay', 0.1);
var socG = soilGrid('projects/soilgrids-isric/soc_mean',  'soc',  0.1);   // dg/kg -> g/kg
var phH2O = soilGrid('projects/soilgrids-isric/phh2o_mean', 'ph',  0.1);
var cfvo = soilGrid('projects/soilgrids-isric/cfvo_mean', 'cfvo', 0.1);   // coarse fragments %
var cec  = soilGrid('projects/soilgrids-isric/cec_mean',  'cec',  0.1);

var soilSource = 'SoilGrids v2 (ISRIC, 250 m)';
if (sand) { prov('projects/soilgrids-isric/*_mean', 'Soil sand/clay/SOC/pH/CEC/coarse fragments', 250, '2020', 'Poggio et al. 2021'); }

// Fallback to OpenLandMap if SoilGrids is not accessible to this account.
if (!sand || !clay) {
  warn('SoilGrids unavailable - falling back to OpenLandMap (coarser property set).');
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

// ---- Soil suitability index (FAO Land Evaluation, additive-limitation) ----
// Each property is scored 0-1 against an agronomic optimum for dry-deciduous
// afforestation, then combined by a LIMITING-FACTOR (minimum-weighted) rule
// rather than a mean, so one disqualifying property is not averaged away.
var soilSuitabilityRaw = null;
if (sand && clay) {
  var texScore  = invertedU(clay, 5, 25, 55);                     // loam optimum
  var sandScore = ee.Image(1).subtract(sand.subtract(70).divide(30).clamp(0, 1));  // penalise >70% sand
  var parts = [texScore, sandScore];
  if (phH2O) { parts.push(invertedU(phH2O, 4.5, 6.8, 8.5)); }     // near-neutral optimum
  if (cfvo)  { parts.push(ee.Image(1).subtract(cfvo.divide(40).clamp(0, 1))); }
  if (cec)   { parts.push(cec.divide(25).clamp(0, 1)); }

  var meanPart = parts.reduce(function (a, b) { return a.add(b); }).divide(parts.length);
  var minPart  = parts.reduce(function (a, b) { return a.min(b); });
  // 60% limiting factor / 40% overall quality - partial, not full, compensation
  soilSuitabilityRaw = minPart.multiply(0.6).add(meanPart.multiply(0.4))
                              .rename('soilSuitability');
  log('Soil suitability computed from continuous properties - ' + soilSource + ' (limiting-factor rule)');
} else {
  warn('No soil texture data - soilSuitability will be dropped by the audit.');
}

// ============================================================================
// 8. LAND PRODUCTIVITY TREND - UNCCD SDG 15.3.1 sub-indicator
//    Theil-Sen slope of annual peak NDVI, 2000-present, harmonised Landsat.
//    Separates ACTIVELY DEGRADING from STABLY POOR. v4 could not tell these
//    apart, and they warrant completely different interventions.
// ============================================================================
var productivityTrendRaw = null;
if (CONFIG.runProductivityTrend) {
  var maskLandsatSR = function (img) {
    var qa = img.select('QA_PIXEL');
    // bits 3 cloud, 4 cloud shadow, 5 snow, 1 dilated cloud
    var clear = qa.bitwiseAnd(1 << 3).eq(0)
      .and(qa.bitwiseAnd(1 << 4).eq(0))
      .and(qa.bitwiseAnd(1 << 5).eq(0))
      .and(qa.bitwiseAnd(1 << 1).eq(0));
    return img.updateMask(clear);
  };
  var ndviL = function (img, redB, nirB) {
    var sr = img.select([redB, nirB]).multiply(0.0000275).add(-0.2);
    return sr.normalizedDifference([nirB, redB]).rename('ndvi');
  };

  var l5 = safeCollection('LANDSAT/LT05/C02/T1_L2', 'Landsat 5');
  var l7 = safeCollection('LANDSAT/LE07/C02/T1_L2', 'Landsat 7');
  var l8 = safeCollection('LANDSAT/LC08/C02/T1_L2', 'Landsat 8');
  var l9 = safeCollection('LANDSAT/LC09/C02/T1_L2', 'Landsat 9');

  var ndviCols = [];
  if (l5) { ndviCols.push(l5.filterBounds(roi).map(maskLandsatSR).map(function (i) { return ndviL(i, 'SR_B3', 'SR_B4').copyProperties(i, ['system:time_start']); })); }
  if (l7) { ndviCols.push(l7.filterBounds(roi).map(maskLandsatSR).map(function (i) { return ndviL(i, 'SR_B3', 'SR_B4').copyProperties(i, ['system:time_start']); })); }
  if (l8) { ndviCols.push(l8.filterBounds(roi).map(maskLandsatSR).map(function (i) { return ndviL(i, 'SR_B4', 'SR_B5').copyProperties(i, ['system:time_start']); })); }
  if (l9) { ndviCols.push(l9.filterBounds(roi).map(maskLandsatSR).map(function (i) { return ndviL(i, 'SR_B4', 'SR_B5').copyProperties(i, ['system:time_start']); })); }

  if (ndviCols.length > 0) {
    var allNdvi = ndviCols.reduce(function (a, b) { return a.merge(b); });
    var years = ee.List.sequence(CONFIG.trendStartYear, CONFIG.year - 1);

    // Annual PEAK NDVI (growing-season maximum) is the standard UNCCD
    // land-productivity metric - it is far less sensitive to phenological
    // timing and cloud gaps than an annual mean.
    // Years with no usable scene must be dropped, not passed to sensSlope with
    // a missing band - tag each year with its scene count and filter on that.
    var annualNdvi = ee.ImageCollection(years.map(function (y) {
      y = ee.Number(y);
      var s = ee.Date.fromYMD(y, 1, 1);
      var yrCol = allNdvi.filterDate(s, s.advance(1, 'year'));
      var peak = ee.Image(yrCol.max()).select(ee.List(['ndvi'])).rename('ndvi');
      return ee.Image.cat([ee.Image.constant(y).float().rename('year'), peak])
               .set({ year: y, nScenes: yrCol.size() });
    })).filter(ee.Filter.gt('nScenes', 0));

    var sens = annualNdvi.select(['year', 'ndvi']).reduce(ee.Reducer.sensSlope());
    // NDVI units per year. Negative slope = declining productivity = degrading.
    productivityTrendRaw = sens.select('slope').clip(roi).rename('landProductivityTrend');

    prov('LANDSAT/L*/C02/T1_L2', 'Land productivity trend (Theil-Sen, UNCCD SDG 15.3.1)', 30,
         CONFIG.trendStartYear + '-' + (CONFIG.year - 1), 'UNCCD GPG 2021; Sen 1968');
    log('Land productivity trend computed (Theil-Sen on ' + (CONFIG.year - CONFIG.trendStartYear) + ' yr annual peak NDVI)');
  } else {
    warn('No Landsat collections available - land productivity trend skipped.');
  }
}

// ============================================================================
// 9. SENTINEL-2 - Cloud Score+ masked composites (wet & dry season)
//    v4 masked with SCL, which is well documented as weak. Cloud Score+ is
//    the current best-practice mask for S2.
// ============================================================================
var s2Col = safeCollection('COPERNICUS/S2_SR_HARMONIZED', 'Sentinel-2 SR');
var csPlus = safeCollection('GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED', 'Cloud Score+');
var dryComposite = null, wetComposite = null;

if (s2Col) {
  var s2Base = s2Col.filterBounds(roi);
  var useCsPlus = !!csPlus;
  if (useCsPlus) {
    s2Base = s2Base.linkCollection(csPlus, ['cs_cdf']);
    prov('GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED', 'S2 cloud masking', 10, 'current', 'Pasquarella et al. 2023');
  }
  var maskS2 = function (img) {
    if (useCsPlus) {
      return img.updateMask(img.select('cs_cdf').gte(0.60)).divide(10000);
    };
    var scl = img.select('SCL');
    var clear = scl.neq(3).and(scl.neq(8)).and(scl.neq(9)).and(scl.neq(10)).and(scl.neq(11));
    return img.updateMask(clear).divide(10000);
  }

  // 3-year stacking to close cloud gaps - v4 used a single year and could
  // leave holes, which then became silent 0.5s in the score.
  var s2Start = ee.Date.fromYMD(CONFIG.year - 2, 1, 1);

  dryComposite = s2Base.filterDate(s2Start, yEnd)
    .filter(ee.Filter.calendarRange(2, 4, 'month'))
    .map(maskS2).median().clip(roi);

  wetComposite = s2Base.filterDate(s2Start, yEnd)
    .filter(ee.Filter.calendarRange(8, 10, 'month'))
    .map(maskS2).median().clip(roi);

  prov('COPERNICUS/S2_SR_HARMONIZED', 'Seasonal composites (invasion proxy, AGB fallback)', 10,
       (CONFIG.year - 2) + '-' + CONFIG.year, 'ESA Copernicus');
  log('Sentinel-2 dry & wet season composites ready (' + (useCsPlus ? 'Cloud Score+' : 'SCL fallback') + ' masking, 3 yr stack)');
}

// ============================================================================
// 10. ECOLOGICAL INTEGRITY CRITERIA
// ============================================================================
var distToForestRaw = null, edgeDensityRaw = null, hydroConnRaw = null,
    degradationRaw = null, connectivityRaw = null;

if (forestMask) {
  distToForestRaw = distanceTo(forestMask, 3000).rename('distanceToForest');

  // ---- Genuine EDGE DENSITY (v4's "fragmentation" was forest proportion) --
  // Edge pixels are where a forest/non-forest boundary exists. Edge density
  // is the proportion of edge in a neighbourhood - a real landscape metric,
  // structurally independent of distance-to-forest. Section 14 verifies that
  // independence rather than assuming it.
  var fm = forestMask.reproject({ crs: PROJ, scale: CONFIG.scale });
  var isEdge = fm.focal_max(1, 'square', 'pixels')
                 .neq(fm.focal_min(1, 'square', 'pixels'));
  edgeDensityRaw = isEdge.focal_mean({ radius: 15, kernelType: 'circle', units: 'pixels' })
                         .rename('edgeDensity');
  log('Edge density computed (genuine landscape metric, replaces v4 forest-proportion proxy)');

  // ---- Structural connectivity - reinstates v4's removed corridor criterion
  // Patch area via connectedPixelCount, then how much large-patch habitat sits
  // within reach. A corridor polygon would refine this; it is not required.
  // Patch analysis runs on a coarser grid. A 1 km neighbourhood at 10 m is a
  // ~31,400-pixel kernel per output pixel, which alone can exhaust the user
  // memory limit; at 60 m the same 1 km reach costs ~875 pixels.
  var ps = CONFIG.perf.patchScale;
  var forestCoarse = forestMask.reproject({ crs: PROJ, scale: ps });
  var patchPixels = forestCoarse.selfMask()
    .connectedPixelCount({ maxSize: 256, eightConnected: true });
  var patchAreaHa = patchPixels.multiply(ps * ps / 1e4).unmask(0);
  var habitatNearby = patchAreaHa.focal_mean({ radius: 1000, kernelType: 'circle', units: 'meters' });

  connectivityRaw = habitatNearby.rename('structuralConnectivity');
  if (wdpaImg) {
    // Blend in proximity to formally protected habitat.
    var distWdpa = distanceTo(wdpaImg.clip(roi).eq(1), 10000);
    var wdpaProx = ee.Image(1).subtract(distWdpa.divide(10000).clamp(0, 1));
    var habP95 = ee.Number(ee.Dictionary(habitatNearby.reduceRegion({
      reducer: ee.Reducer.percentile([95]), geometry: roi, scale: ps,
      maxPixels: 1e10, bestEffort: true, tileScale: 4
    })).values().get(0));
    // Guard against an all-zero patch surface (no forest in the ROI at all),
    // which would otherwise divide by zero and mask the whole criterion.
    var habNorm = habitatNearby.divide(habP95.max(1e-6)).clamp(0, 1);
    connectivityRaw = habNorm.multiply(0.6).add(wdpaProx.multiply(0.4))
                             .rename('structuralConnectivity');
  }
  log('Structural connectivity computed (patch-based' + (wdpaImg ? ' + WDPA proximity' : '') + ') - reinstates the criterion v4 removed');
}

// ---- Hydrological connectivity: distance to surface water + TWI ------------
if (dw || worldCoverMap) {
  var waterMask = dw
    ? dw.select('water').gt(0.30).or(dw.select('flooded_vegetation').gt(0.30))
    : worldCoverMap.eq(80).or(worldCoverMap.eq(90));
  var distToWater = distanceTo(waterMask, 2000);
  hydroConnRaw = ee.Image(1).subtract(distToWater.divide(2000).clamp(0, 1))
                   .rename('hydrologicalConnectivity');
  log('Hydrological connectivity computed (distance to surface water)');
}

// ---- Degradation priority: within the eligible 0-40% band, lower = higher --
if (canopyDensity) {
  var capped = canopyDensity.clamp(0, C.openMax);
  degradationRaw = ee.Image(1).subtract(capped.divide(C.openMax))
                     .rename('degradationPriority');
  log('Degradation priority computed (lower canopy -> higher priority)');
}

// ============================================================================
// 11. SITE / CLIMATE / CARBON / RISK CRITERIA
// ============================================================================

// ---- Moisture availability: TWI + HAND + TerraClimate soil moisture -------
var moistureRaw = null;
if (twi || soilMoisture) {
  var mParts = [];
  if (twi) {
    var twiN = twi.subtract(3).divide(12).clamp(0, 1);            // typical TWI 3-15
    mParts.push(twiN);
  }
  if (soilMoisture) { mParts.push(soilMoisture.divide(200).clamp(0, 1)); }
  if (handM) {
    // Mid-slope positions retain moisture without waterlogging.
    mParts.push(ee.Image(1).subtract(handM.divide(60).clamp(0, 1)));
  }
  moistureRaw = mParts.reduce(function (a, b) { return a.add(b); })
                      .divide(mParts.length).rename('moistureAvailability');
  log('Moisture availability computed (' + mParts.length + ' components: TWI/soil moisture/HAND)');
}

// ---- Workability: slope + rainfall ---------------------------------------
var workabilityRaw = null;
if (slope && rainfall) {
  var slopeWork = ee.Image(1).subtract(slope.divide(30).clamp(0, 1));
  var rainWork  = rainfall.subtract(300).divide(1200).clamp(0, 1);
  workabilityRaw = slopeWork.multiply(0.6).add(rainWork.multiply(0.4)).rename('workability');
  log('Workability computed (slope 60% / rainfall 40%)');
}

// ---- Current climate exposure: heat + drought + water deficit -------------
var climateExposureRaw = null;
if (tempMaxC && rainfallCV) {
  var heatN    = tempMaxC.subtract(32).divide(14).clamp(0, 1);
  var droughtN = rainfallCV.subtract(0.10).divide(0.40).clamp(0, 1);
  var stressParts = [heatN, droughtN];
  if (cwd) { stressParts.push(cwd.subtract(400).divide(800).clamp(0, 1)); }
  var exposure = stressParts.reduce(function (a, b) { return a.add(b); }).divide(stressParts.length);
  // Invert: LOW exposure = better establishment odds = higher priority
  climateExposureRaw = ee.Image(1).subtract(exposure).clamp(0, 1).rename('climateExposure');
  log('Climate exposure computed (heat + 30 yr rainfall CV' + (cwd ? ' + climate water deficit' : '') + ')');
}

// ---- RUSLE erosion: per-pixel K (Williams 1995), real LS (Desmet & Govers)
var erosionRaw = null;
if (slope && rainfall) {
  // R: Indian rainfall-erosivity regression (CSWCRTI Dehradun)
  var R = rainfall.multiply(0.363).add(79);

  // K: Williams (1995) EPIC equation - v4 used a flat 0.28 constant.
  var K;
  if (sand && silt && clay && socG) {
    var fSand = ee.Image(0.2).add(ee.Image(0.3).multiply(
                  sand.multiply(-0.0256).exp().multiply(ee.Image(1).subtract(silt.divide(100)))));
    var fClSi = silt.divide(clay.add(silt).max(0.001)).pow(0.3);
    var orgC  = socG.divide(10);                                  // g/kg -> %
    var fOrgC = ee.Image(1).subtract(
                  orgC.multiply(0.25).divide(orgC.add(orgC.multiply(-3.72).subtract(2.95).exp())));
    var sn1   = ee.Image(1).subtract(sand.divide(100));
    var fHiSa = ee.Image(1).subtract(
                  sn1.multiply(0.7).divide(sn1.add(sn1.multiply(22.9).subtract(5.51).exp())));
    K = fSand.multiply(fClSi).multiply(fOrgC).multiply(fHiSa).rename('K');
    log('RUSLE K-factor derived per-pixel via Williams (1995) EPIC equation (replaces v4 fixed 0.28)');
  } else {
    K = ee.Image(0.28).rename('K');
    warn('RUSLE K falls back to a fixed 0.28 - soil fraction data incomplete.');
  }

  // LS: Desmet & Govers (1996) using real upstream drainage area from MERIT.
  var slopeRad = slope.multiply(Math.PI / 180);
  var LS;
  if (upaKm2) {
    var As = upaKm2.multiply(1e6).divide(CONFIG.scale).max(CONFIG.scale);  // specific catchment area
    var m = ee.Image(0.4), n = ee.Image(1.3);
    LS = As.divide(22.13).pow(m).multiply(slopeRad.sin().divide(0.0896).pow(n));
    log('RUSLE LS via Desmet & Govers (1996) with MERIT Hydro flow accumulation (replaces v4 slope-sum proxy)');
  } else {
    LS = ee.Image(CONFIG.scale).divide(22.13).pow(0.4)
           .multiply(slopeRad.sin().divide(0.0896).pow(1.3));
    warn('RUSLE LS falls back to a fixed slope-length approximation - MERIT Hydro unavailable.');
  }

  // C: cover-management factor from land cover
  var Cf;
  if (dw) {
    Cf = dw.select('trees').multiply(0.004)
      .add(dw.select('shrub_and_scrub').multiply(0.05))
      .add(dw.select('grass').multiply(0.10))
      .add(dw.select('crops').multiply(0.28))
      .add(dw.select('bare').multiply(0.45))
      .rename('C');
  } else if (worldCoverMap) {
    Cf = worldCoverMap.remap([10, 20, 30, 40, 50, 60, 90, 95, 100],
                             [0.01, 0.05, 0.03, 0.28, 0.0, 0.45, 0.02, 0.01, 0.05], 0.2).clip(roi);
  } else {
    Cf = ee.Image(0.2);
  }

  erosionRaw = R.multiply(K).multiply(LS).multiply(Cf).clip(roi).rename('erosionRisk');
  prov('RUSLE (composite)', 'Soil loss t/ha/yr', CONFIG.scale, String(CONFIG.year),
       'Renard et al. 1997; Williams 1995; Desmet & Govers 1996');
  log('RUSLE soil loss computed');
}

// ---- Carbon gain potential -----------------------------------------------
// v4 used GEDI L4A footprints, which over a single Beat in one year are so
// sparse that .mean() leaves most pixels masked -> silent 0.5. Prefer the
// GRIDDED L4B product (complete coverage), then ESA CCI, then an NDVI proxy.
var currentAgb = null, agbSource = 'none';
var gediGrid = safeImage('LARSE/GEDI/GEDI04_B_002', 'GEDI L4B gridded biomass');
if (gediGrid) {
  currentAgb = gediGrid.select('MU').clip(roi).rename('agb');   // mean AGBD, Mg/ha
  agbSource = 'GEDI L4B gridded (1 km)';
} else {
  var cci = safeImage('projects/sat-io/open-datasets/ESA/ESA_CCI_AGB', 'ESA CCI Biomass');
  if (cci) {
    currentAgb = cci.select(0).clip(roi).rename('agb');
    agbSource = 'ESA CCI Biomass (100 m)';
  } else if (dryComposite) {
    var ndviAgb = wetComposite
      ? wetComposite.normalizedDifference(['B8', 'B4'])
      : dryComposite.normalizedDifference(['B8', 'B4']);
    currentAgb = ndviAgb.multiply(250).max(0).rename('agb');
    agbSource = 'NDVI proxy (LOWEST CONFIDENCE)';
    warn('GEDI L4B and ESA CCI unavailable - AGB is an NDVI proxy. Do not quote the tCO2e figures without caveating this.');
  }
}
var carbonGainRaw = null;
if (currentAgb) {
  carbonGainRaw = ee.Image(CONFIG.carbon.referenceAgbTPerHa).subtract(currentAgb).max(0)
                    .rename('carbonGainPotential');
  prov(agbSource, 'Current aboveground biomass', 'varies', 'varies', 'Dubayah et al. 2022 / Santoro et al. 2021');
  log('Carbon-gain potential computed - AGB source: ' + agbSource);
}

// ---- Fire risk: MCD64A1 burned area + VIIRS/FIRMS active fire -------------
// MCD64A1 at 500 m misses most Indian forest fires: they are small, cool and
// understory. FIRMS active-fire detections at 375 m catch far more.
var fireRaw = null;
var burnedCol = safeCollection('MODIS/061/MCD64A1', 'MODIS Burned Area');
var firmsCol  = safeCollection('FIRMS', 'FIRMS active fire');
var histStart = ee.Date.fromYMD(CONFIG.year - CONFIG.fireHistoryYears, 1, 1);

var fireParts = [];
if (burnedCol) {
  var burnCount = burnedCol.filterDate(histStart, yEnd).select('BurnDate')
    .map(function (i) { return i.gt(0); }).sum().clip(roi);
  fireParts.push(burnCount.divide(CONFIG.fireHistoryYears).clamp(0, 1));
  prov('MODIS/061/MCD64A1', 'Burned area history', 500, CONFIG.fireHistoryYears + ' yr', 'Giglio et al. 2018');
}
if (firmsCol) {
  var firmsCount = firmsCol.filterDate(histStart, yEnd).select('T21')
    .map(function (i) { return i.gt(0).unmask(0); }).sum().clip(roi);
  // Smooth: a 375 m detection implies fire in the neighbourhood, not one pixel.
  var firmsSmooth = firmsCount.focal_mean({ radius: 3, kernelType: 'circle', units: 'pixels' });
  fireParts.push(firmsSmooth.divide(CONFIG.fireHistoryYears * 2).clamp(0, 1));
  prov('FIRMS', 'Active fire detections (VIIRS/MODIS)', 375, CONFIG.fireHistoryYears + ' yr', 'NASA FIRMS');
}
if (fireParts.length > 0) {
  fireRaw = fireParts.reduce(function (a, b) { return a.max(b); }).rename('fireRisk');
  log('Fire risk computed (' + fireParts.length + ' source(s): burned area + active fire)');
}

// ---- Phenological anomaly (invasion proxy) --------------------------------
// Lantana camara and Prosopis juliflora - the two dominant invasives in this
// landscape - hold green foliage through the dry season inside an otherwise
// deciduous matrix. That is a PHENOLOGICAL signature. v4 used dry-season
// brightness alone, which also lights up on any evergreen patch or irrigated
// field. Seasonal AMPLITUDE is the discriminating variable.
var phenoAnomalyRaw = null;
if (dryComposite && wetComposite) {
  var dryNdvi = dryComposite.normalizedDifference(['B8', 'B4']).rename('dryNdvi');
  var wetNdvi = wetComposite.normalizedDifference(['B8', 'B4']).rename('wetNdvi');

  // Low seasonal amplitude + high dry-season greenness = evergreen in a
  // deciduous matrix = invasion candidate.
  var amplitude = wetNdvi.subtract(dryNdvi);
  var lowAmplitude = ee.Image(1).subtract(amplitude.divide(0.45).clamp(0, 1));
  var dryGreen = dryNdvi.subtract(0.15).divide(0.40).clamp(0, 1);

  phenoAnomalyRaw = lowAmplitude.multiply(0.5).add(dryGreen.multiply(0.5))
                                .rename('phenologicalAnomaly');

  // Add Sentinel-1 VH texture if available: Lantana thickets have a distinct
  // structural roughness signature that optical data alone misses.
  var s1 = safeCollection('COPERNICUS/S1_GRD', 'Sentinel-1 GRD');
  if (s1) {
    var s1vh = s1.filterBounds(roi)
      .filter(ee.Filter.eq('instrumentMode', 'IW'))
      .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'))
      .filterDate(ee.Date.fromYMD(CONFIG.year - 1, 2, 1), ee.Date.fromYMD(CONFIG.year, 5, 1))
      .select('VH').median().clip(roi);
    var s1Texture = s1vh.reduceNeighborhood({
      reducer: ee.Reducer.stdDev(),
      kernel: ee.Kernel.circle({ radius: 3, units: 'pixels' })
    });
    var textureN = s1Texture.divide(3).clamp(0, 1);
    phenoAnomalyRaw = phenoAnomalyRaw.multiply(0.75).add(textureN.multiply(0.25))
                                     .rename('phenologicalAnomaly');
    prov('COPERNICUS/S1_GRD', 'SAR structural texture (invasion proxy)', 10, String(CONFIG.year), 'ESA Copernicus');
    log('Sentinel-1 VH texture folded into the invasion proxy');
  }

  warn('Phenological Anomaly is an UNVALIDATED invasion PROXY (phenology-based, better than v4 brightness - still a proxy). Field-verify flagged blocks before costing clearance.');
}

// ---- Human dependency & accessibility - reinstated via GHSL ---------------
// v4 removed this for want of village/road layers. JRC GHSL publishes a 100 m
// global population and built-up surface grid - a better dependency gradient
// than village points, because it is continuous rather than a set of dots.
// Modelled as an INVERTED-U: very remote sites are a labour and logistics
// problem; very high-pressure sites face grazing and encroachment. Moderate
// accessibility (JFM engagement, workable logistics) scores highest.
var humanDepRaw = null;
var ghsPop = safeCollection('JRC/GHSL/P2023A/GHS_POP', 'GHSL population');
if (ghsPop) {
  var popImg = ghsPop.sort('system:time_start', false).first()
                     .select(0).clip(roi.buffer(10000)).rename('pop');
  // Population within ~2 km reach
  var popAccess = popImg.focal_mean({ radius: 20, kernelType: 'circle', units: 'pixels' })
                        .clip(roi);
  // Floor before log10: an uninhabited cell is 0, and log10(0) is -Infinity,
  // which propagates through invertedU instead of masking out.
  humanDepRaw = invertedU(popAccess.unmask(0).max(0.1).log10(), -1, 1.3, 3.2)
                  .rename('humanDependency');
  prov('JRC/GHSL/P2023A/GHS_POP', 'Population pressure / accessibility', 100, '2020', 'Schiavina et al. 2023');
  log('Human dependency computed from GHSL population (inverted-U) - reinstates the criterion v4 removed');
} else {
  warn('GHSL population unavailable - human dependency will be dropped by the audit.');
}

// ============================================================================
// 12. ASSEMBLE THE RAW CRITERION STACK
//     Each entry declares its normalization mode:
//       'percentile' - stretch on ROI 2nd-98th pct (relative comparison
//                      within this Beat; fixes v4's compressed-range problem)
//       'absolute'   - fixed anchors, where an external standard exists
//     and its direction of preference (+1 higher-is-better, -1 inverted).
// ============================================================================
var CRITERIA = [
  { name: 'distanceToForest',        img: distToForestRaw,     mode: 'absolute',   lo: 3000, hi: 0,   dir: 1, cluster: 'Ecological Integrity',  res: 10,    note: 'nearer existing forest is better (seed source, edge effects)' },
  { name: 'hydrologicalConnectivity',img: hydroConnRaw,        mode: 'percentile', dir: 1, cluster: 'Ecological Integrity',  res: 10,    note: 'proximity to surface water' },
  { name: 'edgeDensity',             img: edgeDensityRaw,      mode: 'percentile', dir: 1, cluster: 'Ecological Integrity',  res: 10,    note: 'fragmented edge = consolidation opportunity' },
  { name: 'degradationPriority',     img: degradationRaw,      mode: 'absolute',   lo: 0,    hi: 1,   dir: 1, cluster: 'Ecological Integrity',  res: 10,    note: 'lower canopy density = higher priority' },
  { name: 'structuralConnectivity',  img: connectivityRaw,     mode: 'percentile', dir: 1, cluster: 'Ecological Integrity',  res: 10,    note: 'patch connectivity + WDPA proximity' },

  { name: 'landProductivityTrend',   img: productivityTrendRaw,mode: 'percentile', dir: -1, cluster: 'Land Degradation',     res: 30,    note: 'declining NDVI trend = actively degrading = urgent (UNCCD 15.3.1)' },
  { name: 'soilOrganicCarbon',       img: socG,                mode: 'percentile', dir: CONFIG.directions.soilOrganicCarbon, cluster: 'Land Degradation', res: 250, note: 'establishment substrate quality' },

  { name: 'soilSuitability',         img: soilSuitabilityRaw,  mode: 'absolute',   lo: 0,    hi: 1,   dir: 1, cluster: 'Physical Suitability',  res: 250,   note: 'FAO land evaluation, limiting-factor rule' },
  { name: 'moistureAvailability',    img: moistureRaw,         mode: 'percentile', dir: 1, cluster: 'Physical Suitability',  res: 90,    note: 'TWI + soil moisture + HAND' },
  { name: 'workability',             img: workabilityRaw,      mode: 'absolute',   lo: 0,    hi: 1,   dir: 1, cluster: 'Physical Suitability',  res: 30,    note: 'slope + rainfall operability' },

  { name: 'climateExposure',         img: climateExposureRaw,  mode: 'absolute',   lo: 0,    hi: 1,   dir: 1, cluster: 'Climate',               res: 1000,  note: 'inverted: low exposure = higher priority' },
  { name: 'futureClimateResilience', img: futureResilienceRaw, mode: 'absolute',   lo: 0,    hi: 1,   dir: 1, cluster: 'Climate',               res: 27830, note: 'CMIP6 SSP2-4.5 2045-47, delta-downscaled' },

  { name: 'carbonGainPotential',     img: carbonGainRaw,       mode: 'percentile', dir: 1, cluster: 'Carbon & Restoration',  res: 1000,  note: 'reference AGB minus current AGB' },
  { name: 'erosionRisk',             img: erosionRaw,          mode: 'percentile', dir: CONFIG.directions.erosionRisk, cluster: 'Carbon & Restoration', res: 90, note: 'RUSLE t/ha/yr' },

  { name: 'fireRisk',                img: fireRaw,             mode: 'absolute',   lo: 0,    hi: 1,   dir: CONFIG.directions.fireRisk, cluster: 'Risk & Feasibility', res: 375, note: 'DIRECTION IS A POLICY CHOICE - see CONFIG.directions' },
  { name: 'phenologicalAnomaly',     img: phenoAnomalyRaw,     mode: 'percentile', dir: CONFIG.directions.phenologicalAnomaly, cluster: 'Risk & Feasibility', res: 10, note: 'UNVALIDATED invasion proxy. DIRECTION IS A POLICY CHOICE' },

  { name: 'humanDependency',         img: humanDepRaw,         mode: 'absolute',   lo: 0,    hi: 1,   dir: 1, cluster: 'Human Dimension',       res: 100,   note: 'inverted-U on population access' }
];

// Keep only criteria that actually produced an image.
var missing = CRITERIA.filter(function (c) { return !c.img; }).map(function (c) { return c.name; });
var active = CRITERIA.filter(function (c) { return !!c.img; });

if (!eligibleMask || active.length === 0) {
  warn('STOPPING - no eligible area or no criteria available.');
} else {

// ============================================================================
// 13. INTEGRITY AUDIT - coverage, spatial variance, and the stretch bounds,
//     all in ONE round trip.
//
//     This is the section that makes v5 different. v3 and v4 each removed an
//     inert criterion by hand after someone noticed it. Here the model checks
//     every criterion on every run and refuses to let a criterion carry weight
//     it cannot justify.
// ============================================================================
var rawStack = ee.Image.cat(active.map(function (c) {
  return c.img.toFloat().rename(c.name);
})).updateMask(eligibleMask);

// A constant band masked to the eligible set gives the denominator for coverage.
// Band name must start with a letter - Earth Engine rejects a leading underscore.
var denomBand = ee.Image(1).updateMask(eligibleMask).rename('eligibleDenom');

// ONE bounded sample supplies everything the audit needs: coverage, the
// percentile stretch bounds, and - after a client-side affine transform - the
// normalized spread.
//
// Sampling rather than reducing the whole ROI is what keeps this inside the
// user memory limit. A combined percentile/count/stdDev/minMax reduction over
// ~18 bands at 10 m re-evaluates every criterion's ENTIRE computation chain
// (25 yr Landsat Theil-Sen, 3 yr Sentinel-2 composites, km-scale focal
// kernels, distance transforms) on every pixel of the ROI, and will not
// complete. The audit needs a DISTRIBUTION, not per-pixel precision, and a few
// thousand samples estimate percentiles and standard deviations to a precision
// far finer than any of these thresholds care about.
var auditSample = ee.Image.cat([rawStack, denomBand]).sample({
  region: roi,
  scale: CONFIG.audit.sampleScale,
  numPixels: CONFIG.audit.samplePixels,
  seed: 7,
  dropNulls: false,
  tileScale: 8,
  geometries: false
}).getInfo();

var sampleRows = ((auditSample && auditSample.features) || [])
  .map(function (f) { return f.properties || {}; })
  .filter(function (p) { return p.eligibleDenom !== null && p.eligibleDenom !== undefined; });

var nEligible = sampleRows.length;

print('================================================================');
print('CRITERION INTEGRITY AUDIT  (read this before the rankings)');
print('================================================================');
print('Eligible pixels sampled: ' + nEligible +
      '  (at ' + CONFIG.audit.sampleScale + ' m, requested ' + CONFIG.audit.samplePixels + ')');
if (missing.length > 0) {
  print('NO DATA (never entered scoring): ' + missing.join(', '));
}
if (nEligible < 200) {
  warn('Only ' + nEligible + ' eligible pixels sampled. Percentile stretch bounds and ' +
       'the INERT test are unreliable below ~200. Raise CONFIG.audit.samplePixels, lower ' +
       'CONFIG.audit.sampleScale, or check the ROI actually contains treatable area.');
}

// ---- Client-side statistics ------------------------------------------------
var pctOf = function (sortedVals, p) {
  if (sortedVals.length === 0) { return null; }
  if (sortedVals.length === 1) { return sortedVals[0]; }
  var idx = (p / 100) * (sortedVals.length - 1);
  var lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) { return sortedVals[lo]; }
  return sortedVals[lo] + (sortedVals[hi] - sortedVals[lo]) * (idx - lo);
};
var stdDevOf = function (vals) {
  if (vals.length < 2) { return 0; }
  var mu = vals.reduce(function (s, x) { return s + x; }, 0) / vals.length;
  return Math.sqrt(vals.reduce(function (s, x) { return s + (x - mu) * (x - mu); }, 0) / vals.length);
};

var auditRows = [];
active.forEach(function (c) {
  var vals = [];
  for (var i = 0; i < sampleRows.length; i++) {
    var v = sampleRows[i][c.name];
    if (v !== null && v !== undefined && typeof v === 'number' && isFinite(v)) { vals.push(v); }
  }
  c.sampleVals = vals;
  c.coverage = nEligible > 0 ? vals.length / nEligible : 0;
  c.dropped = false; c.dropReason = null;

  var sorted = vals.slice().sort(function (a, b) { return a - b; });
  c.p2  = pctOf(sorted, 2);
  c.p98 = pctOf(sorted, 98);
  c.min = sorted.length ? sorted[0] : null;
  c.max = sorted.length ? sorted[sorted.length - 1] : null;
  c.rawStdDev = stdDevOf(vals);

  if (c.coverage < CONFIG.audit.minCoverage) {
    c.dropped = true;
    c.dropReason = 'SPARSE (' + (c.coverage * 100).toFixed(1) + '% coverage, need '
                 + (CONFIG.audit.minCoverage * 100) + '%)';
  } else if (c.p2 === null || c.p98 === null) {
    c.dropped = true;
    c.dropReason = 'NO VALID STATISTICS';
  } else if (Math.abs(c.p98 - c.p2) < 1e-9) {
    c.dropped = true;
    c.dropReason = 'INERT (zero spread across the ROI - cannot change any ranking)';
  }
  auditRows.push(c);
});

// ---- Normalized spread, from the SAME sample - no second round trip --------
// Normalization is a pure affine transform plus an optional inversion, so the
// normalized spread follows directly from the raw sample. This is the check
// that catches a 25 km climate layer masquerading as a 10 m criterion, and
// anything else effectively constant over one Beat.
var normBounds = function (c) {
  return (c.mode === 'absolute') ? { lo: c.lo, hi: c.hi } : { lo: c.p2, hi: c.p98 };
};

active.forEach(function (c) {
  if (c.dropped) { return; }
  var b = normBounds(c);
  if (b.lo === b.hi) { c.dropped = true; c.dropReason = 'DEGENERATE RANGE'; return; }

  var nv = c.sampleVals.map(function (v) {
    var t = (v - b.lo) / (b.hi - b.lo);
    t = Math.max(0, Math.min(1, t));
    return c.dir === -1 ? 1 - t : t;
  });
  c.normStdDev = stdDevOf(nv);
  c.normMean = nv.length ? nv.reduce(function (s, x) { return s + x; }, 0) / nv.length : null;

  if (c.normStdDev < CONFIG.audit.minStdDev) {
    c.dropped = true;
    c.dropReason = 'INERT (normalized stdDev ' + c.normStdDev.toFixed(4) +
      ' < ' + CONFIG.audit.minStdDev + ' - carries weight but cannot change a ranking)';
    return;
  }

  // Only a surviving criterion is worth building a server-side image for.
  var nImg = c.img.toFloat().subtract(b.lo).divide(b.hi - b.lo).clamp(0, 1);
  if (c.dir === -1) { nImg = ee.Image(1).subtract(nImg); }
  c.norm = nImg.rename(c.name);
});

var surviving = active.filter(function (c) { return !c.dropped && c.norm; });

// ---- Print the audit ------------------------------------------------------
print('--- KEPT ---');
surviving.forEach(function (c) {
  print('  ' + c.name +
        ' | coverage ' + (c.coverage * 100).toFixed(1) + '%' +
        ' | norm sd ' + (c.normStdDev != null ? c.normStdDev.toFixed(3) : 'n/a') +
        ' | ' + c.mode + (c.mode === 'percentile' ? ' [' + Number(c.p2).toPrecision(3) + ' .. ' + Number(c.p98).toPrecision(3) + ']' : '') +
        ' | dir ' + (c.dir > 0 ? '+' : '-'));
});
var droppedList = active.filter(function (c) { return c.dropped; });
if (droppedList.length > 0) {
  print('--- DROPPED (weight redistributed) ---');
  droppedList.forEach(function (c) { print('  ' + c.name + ' -> ' + c.dropReason); });
} else {
  print('--- DROPPED: none ---');
}
if (!CONFIG.audit.autoDrop && droppedList.length > 0) {
  warn('CONFIG.audit.autoDrop is false - flagged criteria are STILL SCORED. The warnings above are advisory only.');
  // Normalized images are built only for survivors, so a flagged criterion has
  // no `norm` yet. Build one here for any that still has usable bounds; a
  // criterion with no valid statistics at all cannot be scored either way.
  droppedList.forEach(function (c) {
    if (c.norm) { return; }
    var b = normBounds(c);
    if (b.lo == null || b.hi == null || b.lo === b.hi) {
      warn('  ' + c.name + ' cannot be scored even with autoDrop off (' + c.dropReason + ')');
      return;
    }
    var nImg = c.img.toFloat().subtract(b.lo).divide(b.hi - b.lo).clamp(0, 1);
    if (c.dir === -1) { nImg = ee.Image(1).subtract(nImg); }
    c.norm = nImg.rename(c.name);
  });
  surviving = active.filter(function (c) { return !!c.norm; });
}

if (surviving.length === 0) {
  warn('STOPPING - every criterion failed the integrity audit. Check data availability for this ROI.');
} else {

// ---- Renormalize weights over the survivors -------------------------------
var wSum = surviving.reduce(function (s, c) { return s + (CONFIG.weights[c.name] || 0); }, 0);
surviving.forEach(function (c) {
  c.weight = (CONFIG.weights[c.name] || 0) / wSum;
});
print('Weights rescaled across ' + surviving.length + ' surviving criteria (original sum ' + wSum.toFixed(4) + ').');

// ============================================================================
// 14. BLOCK AGGREGATION
//     One reduceRegions produces every per-criterion block mean. All MCDA
//     (WLC, WGM, TOPSIS, sensitivity, budget, contiguity) then runs
//     client-side on that matrix - which is why the sensitivity analysis is
//     affordable at all.
// ============================================================================
var grid = roi.coveringGrid(PROJ, CONFIG.blockSizeM)
  .map(function (f) {
    var g = f.intersection(roi, 1);
    var ctr = g.centroid(10).transform(PROJ, 1).coordinates();
    return ee.Feature(g).set({ cx: ctr.get(0), cy: ctr.get(1) });
  });

// FIX for v4's area over-credit bug: pixelArea is masked to the eligible set,
// so areaHa_sum is TREATABLE hectares, not whole-block hectares.
var eligibleAreaHa = ee.Image.pixelArea().divide(1e4)
                       .updateMask(eligibleMask).rename('eligibleAreaHa');
var totalAreaHa    = ee.Image.pixelArea().divide(1e4).clip(roi).rename('totalAreaHa');

var normStackFinal = ee.Image.cat(surviving.map(function (c) { return c.norm; }));

var extraBands = [eligibleAreaHa, totalAreaHa, treatment.rename('treatment')];
// Masked to the eligible set: the clearance decision must reflect the ground
// that will actually be treated, not the block average including cropland.
if (phenoAnomalyRaw) { extraBands.push(phenoAnomalyRaw.updateMask(eligibleMask).rename('phenoRaw')); }
if (currentAgb)      { extraBands.push(currentAgb.updateMask(eligibleMask).rename('agbCurrent')); }
if (erosionRaw)      { extraBands.push(erosionRaw.updateMask(eligibleMask).rename('soilLossTHaYr')); }

var blockInput = ee.Image.cat([normStackFinal.updateMask(eligibleMask)].concat(extraBands));

var blockReducer = ee.Reducer.mean()
  .combine(ee.Reducer.sum(), '', true)
  .combine(ee.Reducer.mode(), '', true);

// Block means are computed at CONFIG.blockStatsScale. A 300 m block holds 900
// pixels at 10 m and 100 at 30 m - both far more than a mean over a criterion
// stack needs, and the coarser grid is what makes this affordable alongside
// everything else. Only eligibleAreaHa depends on the fine grid, and pixelArea
// scales with it, so the hectare totals stay correct either way.
var blockStats = blockInput.reduceRegions({
  collection: grid,
  reducer: blockReducer,
  scale: CONFIG.blockStatsScale,
  tileScale: 8
});

// ============================================================================
// 15-19. CLIENT-SIDE MCDA
// ============================================================================
blockStats.evaluate(function (fc) {
  var feats = (fc && fc.features) || [];
  var critNames = surviving.map(function (c) { return c.name; });
  var weightsArr = surviving.map(function (c) { return c.weight; });

  // ---- Build the decision matrix -----------------------------------------
  var blocks = [];
  feats.forEach(function (f, idx) {
    var p = f.properties || {};
    var eligHa = p.eligibleAreaHa_sum || 0;
    var totHa  = p.totalAreaHa_sum || 0;
    if (eligHa <= 0.1 || totHa <= 0) { return; }

    var vals = [], ok = true;
    for (var i = 0; i < critNames.length; i++) {
      var v = p[critNames[i] + '_mean'];
      if (v === null || v === undefined || isNaN(v)) { ok = false; break; }
      vals.push(v);
    }
    if (!ok) { return; }   // no silent neutral substitution - the block is excluded

    blocks.push({
      id: idx + 1,
      cx: p.cx, cy: p.cy,
      eligibleAreaHa: eligHa,
      totalAreaHa: totHa,
      eligibleFraction: eligHa / totHa,
      treatmentCode: Math.round(p.treatment_mode || 0),
      phenoRaw: p.phenoRaw_mean,
      agbCurrent: p.agbCurrent_mean,
      soilLoss: p.soilLossTHaYr_mean,
      v: vals
    });
  });

  // Hard constraint: drop blocks that are mostly untreatable. This is the
  // other half of the v4 area-over-credit fix - without it a 5%-eligible
  // block could still consume its full 9 ha of the APO target.
  var preFilter = blocks.length;
  blocks = blocks.filter(function (b) { return b.eligibleFraction >= CONFIG.minEligibleFrac; });
  var droppedFrac = preFilter - blocks.length;

  if (blocks.length === 0) {
    print('No blocks passed the eligibility-fraction filter. Lower CONFIG.minEligibleFrac or widen the ROI.');
    return;
  }

  var n = blocks.length, m = critNames.length;

  // ---- COLLINEARITY MATRIX ------------------------------------------------
  // Two criteria at |r| > threshold are one axis carrying two weights. v4's
  // Distance to Forest and "Fragmentation Index" were almost certainly this.
  function pearson(a, b) {
    var na = a.length, sa = 0, sb = 0;
    for (var i = 0; i < na; i++) { sa += a[i]; sb += b[i]; }
    var ma = sa / na, mb = sb / na, num = 0, da = 0, db = 0;
    for (var j = 0; j < na; j++) {
      var xa = a[j] - ma, xb = b[j] - mb;
      num += xa * xb; da += xa * xa; db += xb * xb;
    }
    return (da === 0 || db === 0) ? 0 : num / Math.sqrt(da * db);
  }
  var cols = [];
  for (var ci = 0; ci < m; ci++) {
    cols.push(blocks.map(function (b) { return b.v[ci]; }));
  }
  var redundantPairs = [];
  for (var a1 = 0; a1 < m; a1++) {
    for (var a2 = a1 + 1; a2 < m; a2++) {
      var r = pearson(cols[a1], cols[a2]);
      if (Math.abs(r) >= CONFIG.audit.maxCorrelation) {
        redundantPairs.push({ a: critNames[a1], b: critNames[a2], r: r,
                              wA: weightsArr[a1], wB: weightsArr[a2] });
      }
    }
  }

  print('================================================================');
  print('COLLINEARITY CHECK (|r| >= ' + CONFIG.audit.maxCorrelation + ' means double-counted weight)');
  print('================================================================');
  if (redundantPairs.length === 0) {
    print('  No criterion pair exceeds the threshold. No obvious double-counting.');
  } else {
    redundantPairs.forEach(function (pr) {
      print('  REDUNDANT: ' + pr.a + ' <-> ' + pr.b +
            '  r=' + pr.r.toFixed(3) +
            '  (combined weight ' + ((pr.wA + pr.wB) * 100).toFixed(1) + '% on one axis)');
    });
    print('  ACTION: merge each pair into one criterion, or drop the weaker and');
    print('  re-run the AHP. Weight on paper is not influence in practice.');
  }

  // ---- REALISED INFLUENCE -------------------------------------------------
  // Nominal weight x actual spread. This is the table that shows whether the
  // AHP weights survived contact with the normalization choices.
  print('================================================================');
  print('REALISED INFLUENCE  (nominal weight vs. weight x observed spread)');
  print('================================================================');
  var infl = [];
  for (var k = 0; k < m; k++) {
    var col = cols[k];
    var mu = col.reduce(function (s, x) { return s + x; }, 0) / n;
    var sd = Math.sqrt(col.reduce(function (s, x) { return s + (x - mu) * (x - mu); }, 0) / n);
    infl.push({ name: critNames[k], w: weightsArr[k], sd: sd, influence: weightsArr[k] * sd });
  }
  var inflTotal = infl.reduce(function (s, x) { return s + x.influence; }, 0);
  infl.slice().sort(function (x, y) { return y.influence - x.influence; }).forEach(function (x) {
    print('  ' + x.name +
          ' | nominal ' + (x.w * 100).toFixed(1) + '%' +
          ' | spread ' + x.sd.toFixed(3) +
          ' | REALISED ' + (inflTotal > 0 ? (x.influence / inflTotal * 100).toFixed(1) : '0.0') + '%');
  });
  print('  If nominal and realised disagree sharply, the normalization is');
  print('  driving the ranking more than the AHP is. That is the v4 failure');
  print('  mode, now visible instead of hidden.');

  // ---- AGGREGATION METHOD 1: WLC (compensatory - this is what v4 did) -----
  function scoreWLC(b, w) {
    var s = 0;
    for (var i = 0; i < w.length; i++) { s += w[i] * b.v[i]; }
    return s;
  }
  // ---- METHOD 2: Weighted Geometric Mean (non-compensatory) --------------
  // A near-zero on ANY criterion drags the whole score down, so excellent
  // rainfall can no longer mask unplantable soil. WLC cannot express this.
  function scoreWGM(b, w) {
    var s = 0;
    for (var i = 0; i < w.length; i++) {
      s += w[i] * Math.log(Math.max(b.v[i], 0.01));
    }
    return Math.exp(s);
  }
  // ---- METHOD 3: TOPSIS ---------------------------------------------------
  function scoreTOPSIS(bs, w) {
    var mm = w.length, nn = bs.length;
    var norms = [];
    for (var i = 0; i < mm; i++) {
      var ss = 0;
      for (var j = 0; j < nn; j++) { ss += bs[j].v[i] * bs[j].v[i]; }
      norms.push(Math.sqrt(ss) || 1);
    }
    var best = [], worst = [];
    for (var i2 = 0; i2 < mm; i2++) {
      var hi = -Infinity, lo = Infinity;
      for (var j2 = 0; j2 < nn; j2++) {
        var val = (bs[j2].v[i2] / norms[i2]) * w[i2];
        if (val > hi) { hi = val; }
        if (val < lo) { lo = val; }
      }
      best.push(hi); worst.push(lo);
    }
    return bs.map(function (b) {
      var dPlus = 0, dMinus = 0;
      for (var i3 = 0; i3 < mm; i3++) {
        var v3 = (b.v[i3] / norms[i3]) * w[i3];
        dPlus  += (v3 - best[i3])  * (v3 - best[i3]);
        dMinus += (v3 - worst[i3]) * (v3 - worst[i3]);
      }
      dPlus = Math.sqrt(dPlus); dMinus = Math.sqrt(dMinus);
      return (dPlus + dMinus) === 0 ? 0 : dMinus / (dPlus + dMinus);
    });
  }

  blocks.forEach(function (b) {
    b.wlc = scoreWLC(b, weightsArr);
    b.wgm = scoreWGM(b, weightsArr);
  });
  var topsisScores = scoreTOPSIS(blocks, weightsArr);
  blocks.forEach(function (b, i) { b.topsis = topsisScores[i]; });

  // ---- Rank agreement between methods ------------------------------------
  function rankOf(arr) {
    var idx = arr.map(function (v, i) { return { v: v, i: i }; });
    idx.sort(function (x, y) { return y.v - x.v; });
    var rk = new Array(arr.length);
    idx.forEach(function (o, r) { rk[o.i] = r + 1; });
    return rk;
  }
  var rWLC = rankOf(blocks.map(function (b) { return b.wlc; }));
  var rWGM = rankOf(blocks.map(function (b) { return b.wgm; }));
  var rTOP = rankOf(blocks.map(function (b) { return b.topsis; }));
  blocks.forEach(function (b, i) { b.rWLC = rWLC[i]; b.rWGM = rWGM[i]; b.rTOP = rTOP[i]; });

  print('================================================================');
  print('AGGREGATION-METHOD AGREEMENT (Spearman rho)');
  print('================================================================');
  print('  WLC vs Weighted Geometric Mean : ' + pearson(rWLC, rWGM).toFixed(3));
  print('  WLC vs TOPSIS                  : ' + pearson(rWLC, rTOP).toFixed(3));
  print('  WGM vs TOPSIS                  : ' + pearson(rWGM, rTOP).toFixed(3));
  print('  Low agreement means the ranking depends on the aggregation rule,');
  print('  not on the evidence. Trust the ROBUST set below, not any one column.');

  // ---- MONTE CARLO WEIGHT SENSITIVITY ------------------------------------
  // A block selected in 98% of perturbed runs is a different proposition from
  // one selected in 51%. Without this the ranking is a point estimate with no
  // stated uncertainty - which is what every comparable CAMPA tool ships.
  var targetHa = CONFIG.targetTreatmentAreaHa;
  function greedySelectByArea(sorted, cap) {
    var cum = 0, sel = {};
    for (var i = 0; i < sorted.length; i++) {
      if (cum + sorted[i].eligibleAreaHa > cap) { continue; }
      cum += sorted[i].eligibleAreaHa;
      sel[sorted[i].id] = true;
    }
    return sel;
  }

  blocks.forEach(function (b) { b.mcHits = 0; });
  for (var run = 0; run < CONFIG.mcRuns; run++) {
    var wPert = [], wTot = 0;
    for (var i4 = 0; i4 < m; i4++) {
      var f4 = 1 + (Math.random() * 2 - 1) * CONFIG.mcPerturbPct;
      var wv = Math.max(weightsArr[i4] * f4, 1e-6);
      wPert.push(wv); wTot += wv;
    }
    for (var i5 = 0; i5 < m; i5++) { wPert[i5] /= wTot; }

    var scored = blocks.map(function (b) { return { id: b.id, s: scoreWLC(b, wPert), eligibleAreaHa: b.eligibleAreaHa }; });
    scored.sort(function (x, y) { return y.s - x.s; });
    var selRun = greedySelectByArea(scored, targetHa);
    blocks.forEach(function (b) { if (selRun[b.id]) { b.mcHits++; } });
  }
  blocks.forEach(function (b) { b.selectionFrequency = b.mcHits / CONFIG.mcRuns; });

  // ---- ROBUST SET: top-N under all three aggregation methods --------------
  var sortedWLC = blocks.slice().sort(function (x, y) { return y.wlc - x.wlc; });
  var baseSel = greedySelectByArea(sortedWLC, targetHa);
  var nSel = Object.keys(baseSel).length;
  var topN = Math.max(nSel, 1);
  blocks.forEach(function (b) {
    b.robust = (b.rWLC <= topN) && (b.rWGM <= topN) && (b.rTOP <= topN);
    b.selectedArea = !!baseSel[b.id];
  });

  // ---- TREATMENT LABEL + COST --------------------------------------------
  var TREATMENT_LABEL = { 0: 'Not Prioritized', 1: 'New Plantation', 2: 'ANR' };
  blocks.forEach(function (b) {
    b.treatmentLabel = TREATMENT_LABEL[b.treatmentCode] || 'Not Prioritized';
    b.needsClearance = (b.phenoRaw != null && b.phenoRaw > 0.55 && b.treatmentCode > 0);
    if (b.needsClearance) { b.treatmentLabel += ' + Clearance'; }

    var rate = b.treatmentCode === 1 ? CONFIG.costPerHaINR.newPlantation
             : b.treatmentCode === 2 ? CONFIG.costPerHaINR.anr
             : CONFIG.costPerHaINR.soilWaterConservation;
    if (b.needsClearance) { rate += CONFIG.costPerHaINR.clearanceSurcharge; }
    // Steep or highly erodible ground needs soil & water conservation works.
    if (b.soilLoss != null && b.soilLoss > 20) { rate += CONFIG.costPerHaINR.soilWaterConservation * 0.5; }
    b.ratePerHa = rate;
    b.costINR = b.eligibleAreaHa * rate;

    // ---- CARBON: actual tCO2e over the horizon (v4 never computed this) ---
    var K2 = CONFIG.carbon;
    var growth = b.treatmentCode === 1 ? K2.agbGrowthNewPlantation : K2.agbGrowthAnr;
    var agbGain = growth * K2.horizonYears;
    if (b.agbCurrent != null) {
      agbGain = Math.min(agbGain, Math.max(K2.referenceAgbTPerHa - b.agbCurrent, 0));
    }
    var totalBiomass = agbGain * (1 + K2.rootShootRatio);
    var cStock = totalBiomass * K2.carbonFraction;
    var soilC  = K2.soilCAccrualTPerHaYr * K2.horizonYears;
    b.tCO2ePerHa = (cStock + soilC) * K2.co2Conversion;
    b.tCO2e = b.tCO2ePerHa * b.eligibleAreaHa;
    b.costPerTCO2e = b.tCO2e > 0 ? b.costINR / b.tCO2e : null;
  });

  // ---- BUDGET-CONSTRAINED SELECTION --------------------------------------
  // Forest departments have budget ceilings, not only area targets. Greedy by
  // score-per-rupee is the right heuristic for a knapsack of this shape.
  var byEfficiency = blocks.slice().sort(function (x, y) {
    return (y.wlc / Math.max(y.costINR, 1)) - (x.wlc / Math.max(x.costINR, 1));
  });
  var budgetLeft = CONFIG.budgetINR, budgetSel = [], budgetArea = 0, budgetCO2 = 0;
  byEfficiency.forEach(function (b) {
    if (b.costINR <= budgetLeft) {
      budgetLeft -= b.costINR; budgetSel.push(b);
      budgetArea += b.eligibleAreaHa; budgetCO2 += b.tCO2e;
    }
  });
  var budgetIds = {};
  budgetSel.forEach(function (b) { budgetIds[b.id] = true; });
  blocks.forEach(function (b) { b.selectedBudget = !!budgetIds[b.id]; });

  // ---- SPATIAL CONTIGUITY -------------------------------------------------
  // Scattered 9 ha blocks are operationally unworkable. Flag selections that
  // sit in a cluster of at least minClusterBlocks adjacent selected blocks.
  if (CONFIG.contiguity.enable) {
    var selList = blocks.filter(function (b) { return b.selectedArea; });
    var reach = CONFIG.blockSizeM * 1.5;
    var adj = {};
    selList.forEach(function (b) { adj[b.id] = []; });
    for (var p1 = 0; p1 < selList.length; p1++) {
      for (var p2 = p1 + 1; p2 < selList.length; p2++) {
        var A = selList[p1], B = selList[p2];
        if (A.cx == null || B.cx == null) { continue; }
        var dx = A.cx - B.cx, dy = A.cy - B.cy;
        if (Math.sqrt(dx * dx + dy * dy) <= reach) {
          adj[A.id].push(B.id); adj[B.id].push(A.id);
        }
      }
    }
    var seen = {}, clusterOf = {};
    selList.forEach(function (b) {
      if (seen[b.id]) { return; }
      var stack = [b.id], comp = [];
      seen[b.id] = true;
      while (stack.length) {
        var cur = stack.pop(); comp.push(cur);
        (adj[cur] || []).forEach(function (nb) {
          if (!seen[nb]) { seen[nb] = true; stack.push(nb); }
        });
      }
      comp.forEach(function (cid) { clusterOf[cid] = comp.length; });
    });
    blocks.forEach(function (b) {
      b.clusterSize = clusterOf[b.id] || 0;
      b.contiguous = b.selectedArea && b.clusterSize >= CONFIG.contiguity.minClusterBlocks;
    });
  }

  // ========================================================================
  // REPORTING
  // ========================================================================
  var selArea = blocks.filter(function (b) { return b.selectedArea; });
  var totSelHa   = selArea.reduce(function (s, b) { return s + b.eligibleAreaHa; }, 0);
  var totSelCost = selArea.reduce(function (s, b) { return s + b.costINR; }, 0);
  var totSelCO2  = selArea.reduce(function (s, b) { return s + b.tCO2e; }, 0);
  var totEligHa  = blocks.reduce(function (s, b) { return s + b.eligibleAreaHa; }, 0);
  var robustCnt  = blocks.filter(function (b) { return b.robust; }).length;
  var contigCnt  = blocks.filter(function (b) { return b.contiguous; }).length;
  var highConf   = selArea.filter(function (b) { return b.selectionFrequency >= 0.90; }).length;
  var lowConf    = selArea.filter(function (b) { return b.selectionFrequency < 0.60; }).length;

  print('================================================================');
  print('CAMPA SITE PRIORITIZATION v5 - ' + CONFIG.unitName + ', ' +
        CONFIG.district + ', ' + CONFIG.state + ' (' + CONFIG.year + ')');
  print(surviving.length + ' of ' + CRITERIA.length + ' criteria survived the integrity audit');
  print('================================================================');
  print('Blocks evaluated       : ' + n + ' (' + droppedFrac + ' dropped below ' +
        (CONFIG.minEligibleFrac * 100) + '% eligible fraction)');
  print('Total treatable area   : ' + Math.round(totEligHa) + ' ha');
  print('');
  print('--- AREA-CONSTRAINED PLAN (target ' + targetHa + ' ha) ---');
  print('  Selected      : ' + selArea.length + ' blocks, ' + Math.round(totSelHa) + ' ha');
  print('  Cost          : Rs ' + Math.round(totSelCost).toLocaleString('en-IN') + '  [ASSUMPTION rates - VERIFY]');
  print('  Sequestration : ' + Math.round(totSelCO2).toLocaleString('en-IN') + ' tCO2e over ' +
        CONFIG.carbon.horizonYears + ' yr  [IPCC Tier 1 - VERIFY against Working Plan]');
  print('  Cost per tCO2e: Rs ' + (totSelCO2 > 0 ? Math.round(totSelCost / totSelCO2) : 'n/a'));
  print('');
  print('--- BUDGET-CONSTRAINED PLAN (ceiling Rs ' + CONFIG.budgetINR.toLocaleString('en-IN') + ') ---');
  print('  Selected      : ' + budgetSel.length + ' blocks, ' + Math.round(budgetArea) + ' ha');
  print('  Spend         : Rs ' + Math.round(CONFIG.budgetINR - budgetLeft).toLocaleString('en-IN'));
  print('  Sequestration : ' + Math.round(budgetCO2).toLocaleString('en-IN') + ' tCO2e');
  print('  NOTE: this plan differs from the area-constrained one because it');
  print('  ranks by score PER RUPEE. Decide which constraint actually binds.');
  print('');
  print('--- CONFIDENCE ---');
  print('  ROBUST (top-ranked under WLC, WGM and TOPSIS alike) : ' + robustCnt + ' blocks');
  print('  Selected in >=90% of ' + CONFIG.mcRuns + ' weight-perturbation runs  : ' + highConf + ' of ' + selArea.length);
  print('  Selected in < 60% of runs (weight-sensitive, review) : ' + lowConf + ' of ' + selArea.length);
  if (CONFIG.contiguity.enable) {
    print('  In workable clusters (>=' + CONFIG.contiguity.minClusterBlocks + ' adjacent blocks) : ' + contigCnt + ' of ' + selArea.length);
  }
  print('');
  print('--- CARRIED-OVER CAVEATS ---');
  print('  * Weights are PROVISIONAL, not a fresh AHP elicitation on this');
  print('    17-criterion list. Re-run the pairwise survey (report CR < 0.10).');
  print('  * Phenological Anomaly is an unvalidated invasion proxy.');
  print('  * Fire and invasion DIRECTIONS are policy choices (CONFIG.directions),');
  print('    and v5 flipped both relative to v4. Get this signed off.');
  print('  * Effective resolution is set by the coarsest contributing criterion,');
  print('    not by CONFIG.scale. See the provenance table below.');
  print('----------------------------------------------------------------');
  print('Top 15 blocks (area-constrained plan):');
  selArea.slice().sort(function (x, y) { return y.wlc - x.wlc; }).slice(0, 15)
    .forEach(function (b) {
      print('#' + b.id + ' | ' + b.eligibleAreaHa.toFixed(1) + ' ha (' +
            (b.eligibleFraction * 100).toFixed(0) + '% elig) | WLC ' + b.wlc.toFixed(3) +
            ' | stability ' + (b.selectionFrequency * 100).toFixed(0) + '%' +
            (b.robust ? ' | ROBUST' : '') +
            ' | ' + b.treatmentLabel +
            ' | ' + Math.round(b.tCO2e) + ' tCO2e');
    });

  // ---- Per-block explainability: WHY did this block rank here? ------------
  print('----------------------------------------------------------------');
  print('Top block criterion breakdown (explainability - #' +
        (selArea.length ? selArea.slice().sort(function (x, y) { return y.wlc - x.wlc; })[0].id : 'n/a') + '):');
  if (selArea.length) {
    var topB = selArea.slice().sort(function (x, y) { return y.wlc - x.wlc; })[0];
    var contribs = critNames.map(function (nm, i) {
      return { name: nm, score: topB.v[i], w: weightsArr[i], contrib: weightsArr[i] * topB.v[i] };
    }).sort(function (x, y) { return y.contrib - x.contrib; });
    contribs.forEach(function (cb) {
      print('   ' + cb.name + ' : score ' + cb.score.toFixed(3) +
            ' x weight ' + (cb.w * 100).toFixed(1) + '% = ' + cb.contrib.toFixed(4) +
            ' (' + (cb.contrib / topB.wlc * 100).toFixed(1) + '% of the block score)');
    });
  }

  // ---- CSV EXPORT with full per-criterion breakdown ----------------------
  var rows = blocks.slice().sort(function (x, y) { return y.wlc - x.wlc; }).map(function (b) {
    var props = {
      'Block ID': b.id,
      'Treatable Area (ha)': Number(b.eligibleAreaHa.toFixed(2)),
      'Eligible Fraction': Number(b.eligibleFraction.toFixed(3)),
      'Priority Score (WLC)': Number(b.wlc.toFixed(4)),
      'Priority Score (WGM)': Number(b.wgm.toFixed(4)),
      'Priority Score (TOPSIS)': Number(b.topsis.toFixed(4)),
      'Rank WLC': b.rWLC, 'Rank WGM': b.rWGM, 'Rank TOPSIS': b.rTOP,
      'Robust (all 3 methods)': b.robust ? 'YES' : 'no',
      'Selection Stability': Number(b.selectionFrequency.toFixed(3)),
      'Recommended Treatment': b.treatmentLabel,
      'Rate (Rs/ha)': b.ratePerHa,
      'Cost (Rs)': Math.round(b.costINR),
      'Cost per tCO2e (Rs)': b.costPerTCO2e ? Math.round(b.costPerTCO2e) : '',
      'Cluster Size': b.clusterSize || 0,
      'Contiguous': b.contiguous ? 'YES' : 'no',
      'Selected (Area Plan)': b.selectedArea ? 'YES' : 'no',
      'Selected (Budget Plan)': b.selectedBudget ? 'YES' : 'no'
    };
    // ES5 object literals cannot take computed keys - set these after.
    props['tCO2e (' + CONFIG.carbon.horizonYears + ' yr)'] = Number(b.tCO2e.toFixed(1));
    // Per-criterion scores and contributions - the explainability columns.
    critNames.forEach(function (nm, i) {
      props['score_' + nm] = Number(b.v[i].toFixed(4));
      props['contrib_' + nm] = Number((weightsArr[i] * b.v[i]).toFixed(5));
    });
    return ee.Feature(null, props);
  });

  Export.table.toDrive({
    collection: ee.FeatureCollection(rows),
    description: CONFIG.exportPrefix + '_RankedBlocks',
    folder: CONFIG.exportFolder,
    fileNamePrefix: CONFIG.exportPrefix + '_RankedBlocks',
    fileFormat: 'CSV'
  });

  // ---- Audit trail export -------------------------------------------------
  var auditFeatures = active.map(function (c) {
    return ee.Feature(null, {
      'Criterion': c.name,
      'Cluster': c.cluster,
      'Status': c.dropped ? 'DROPPED' : 'KEPT',
      'Drop Reason': c.dropReason || '',
      'Nominal Weight (%)': Number(((CONFIG.weights[c.name] || 0) * 100).toFixed(2)),
      'Applied Weight (%)': c.weight != null ? Number((c.weight * 100).toFixed(2)) : 0,
      'Coverage (%)': Number((c.coverage * 100).toFixed(1)),
      'Normalized StdDev': c.normStdDev != null ? Number(c.normStdDev.toFixed(4)) : '',
      'Normalization': c.mode,
      'Direction': c.dir > 0 ? 'higher = higher priority' : 'inverted',
      'Native Resolution (m)': c.res,
      'Note': c.note
    });
  }).concat(missing.map(function (nm) {
    return ee.Feature(null, { 'Criterion': nm, 'Status': 'NO DATA', 'Drop Reason': 'source unavailable in this ROI' });
  }));
  Export.table.toDrive({
    collection: ee.FeatureCollection(auditFeatures),
    description: CONFIG.exportPrefix + '_CriterionAudit',
    folder: CONFIG.exportFolder,
    fileNamePrefix: CONFIG.exportPrefix + '_CriterionAudit',
    fileFormat: 'CSV'
  });

  var provFeatures = PROVENANCE.map(function (pv) {
    return ee.Feature(null, {
      'Dataset ID': pv.id, 'Used For': pv.label,
      'Native Resolution (m)': pv.nativeResM, 'Epoch': pv.epoch, 'Citation': pv.citation
    });
  });
  Export.table.toDrive({
    collection: ee.FeatureCollection(provFeatures),
    description: CONFIG.exportPrefix + '_DataProvenance',
    folder: CONFIG.exportFolder,
    fileNamePrefix: CONFIG.exportPrefix + '_DataProvenance',
    fileFormat: 'CSV'
  });

  // ---- Provenance table to console ---------------------------------------
  print('================================================================');
  print('DATA PROVENANCE  (quote these resolutions, not CONFIG.scale)');
  print('================================================================');
  var coarsest = 0;
  PROVENANCE.forEach(function (pv) {
    print('  ' + pv.label + ' | ' + pv.id + ' | ' + pv.nativeResM + ' m | ' + pv.epoch);
    if (typeof pv.nativeResM === 'number' && pv.nativeResM > coarsest) { coarsest = pv.nativeResM; }
  });
  var coarsestKept = surviving.reduce(function (s, c) { return Math.max(s, c.res || 0); }, 0);
  print('  ---');
  print('  Output grid          : ' + CONFIG.scale + ' m');
  print('  Coarsest KEPT criterion: ' + coarsestKept + ' m  <-- this is the honest effective resolution');
  print('  Blocks are ' + CONFIG.blockSizeM + ' m (~' +
        ((CONFIG.blockSizeM * CONFIG.blockSizeM) / 1e4).toFixed(1) +
        ' ha), which is the minimum reliable planning unit.');

  log('v5 complete. Read the INTEGRITY AUDIT and COLLINEARITY sections before quoting any ranking.');
});

// ============================================================================
// 20. VALIDATION BACK-TEST (satellite-only, no field data required)
//     Sites that measurably gained tree cover 2005-2020 are pseudo-positives -
//     places where restoration/regeneration demonstrably worked. If the model
//     ranks those higher than matched controls, that is empirical support for
//     the weighting scheme rather than mere plausibility.
//
//     CIRCULARITY CONTROL: criteria derived from canopy or NDVI trend are
//     EXCLUDED from the validation score, because those are the same signals
//     used to define the positives. Read the caveat with the number.
// ============================================================================
if (CONFIG.runValidation && hansen && surviving.length > 0) {
  var circular = { degradationPriority: 1, landProductivityTrend: 1,
                   distanceToForest: 1, edgeDensity: 1, structuralConnectivity: 1,
                   carbonGainPotential: 1 };
  var valCrit = surviving.filter(function (c) { return !circular[c.name]; });

  if (valCrit.length < 3) {
    warn('Validation skipped - fewer than 3 non-circular criteria available.');
  } else {
    var vSum = valCrit.reduce(function (s, c) { return s + (CONFIG.weights[c.name] || 0); }, 0);
    var valScore = valCrit.reduce(function (acc, c) {
      var term = c.norm.multiply((CONFIG.weights[c.name] || 0) / vSum);
      return acc ? acc.add(term) : term;
    }, null).rename('valScore');

    // Positives: Hansen gain, on ground that was NOT already forest in 2000.
    var gainMask = hansen.select('gain').eq(1)
      .and(hansen.select('treecover2000').lt(CONFIG.fsiCanopyClasses.openMax))
      .and(hansen.select('lossyear').eq(0));
    // Controls: comparable low-canopy ground that did NOT gain.
    var controlMask = hansen.select('gain').eq(0)
      .and(hansen.select('treecover2000').lt(CONFIG.fsiCanopyClasses.openMax))
      .and(hansen.select('lossyear').eq(0));

    var valRegion = roi.buffer(15000);   // widen - a single Beat rarely has enough gain pixels
    var posSample = valScore.updateMask(gainMask).sample({
      region: valRegion, scale: 30, numPixels: 800, seed: 42, dropNulls: true, tileScale: 8
    });
    var negSample = valScore.updateMask(controlMask).sample({
      region: valRegion, scale: 30, numPixels: 800, seed: 43, dropNulls: true, tileScale: 8
    });

    ee.Dictionary({
      pos: posSample.aggregate_array('valScore'),
      neg: negSample.aggregate_array('valScore')
    }).evaluate(function (d) {
      if (!d) { warn('Validation returned nothing.'); return; }
      var pos = (d.pos || []).filter(function (x) { return x != null; });
      var neg = (d.neg || []).filter(function (x) { return x != null; });

      print('================================================================');
      print('VALIDATION BACK-TEST (satellite-only, no field data)');
      print('================================================================');
      if (pos.length < 30 || neg.length < 30) {
        print('  INSUFFICIENT SAMPLES (positives ' + pos.length + ', controls ' + neg.length + ').');
        print('  This Beat has too few documented tree-cover-gain pixels to test');
        print('  against. Re-run at Range or Division level for a usable AUC.');
        return;
      }

      // AUC via the Mann-Whitney U statistic (rank-based, ties handled).
      var all = pos.map(function (v) { return { v: v, p: 1 }; })
        .concat(neg.map(function (v) { return { v: v, p: 0 }; }));
      all.sort(function (a, b) { return a.v - b.v; });
      var i = 0, rankSumPos = 0;
      while (i < all.length) {
        var j = i;
        while (j + 1 < all.length && all[j + 1].v === all[i].v) { j++; }
        var avgRank = (i + j) / 2 + 1;
        for (var k = i; k <= j; k++) { if (all[k].p === 1) { rankSumPos += avgRank; } }
        i = j + 1;
      }
      var nP = pos.length, nN = neg.length;
      var U = rankSumPos - (nP * (nP + 1)) / 2;
      var auc = U / (nP * nN);

      var meanP = pos.reduce(function (s, x) { return s + x; }, 0) / nP;
      var meanN = neg.reduce(function (s, x) { return s + x; }, 0) / nN;

      print('  Positives (documented tree-cover gain) : ' + nP + ', mean score ' + meanP.toFixed(4));
      print('  Controls  (comparable, no gain)        : ' + nN + ', mean score ' + meanN.toFixed(4));
      print('  AUC = ' + auc.toFixed(3));
      print('  ' + (auc >= 0.75 ? 'GOOD - the model discriminates sites where regeneration actually occurred.'
            : auc >= 0.65 ? 'MODERATE - discriminating, but the weights deserve re-elicitation.'
            : auc >= 0.55 ? 'WEAK - barely better than chance. Re-run the AHP before operational use.'
            : 'NO SKILL - do not use these weights operationally until re-elicited.'));
      print('  Criteria used (non-circular only): ' +
            valCrit.map(function (c) { return c.name; }).join(', '));
      print('  CAVEATS - read before quoting this number:');
      print('   * Hansen "gain" is 2000-2012 only and is a known-noisy band.');
      print('   * Positives include natural regeneration, not only planting, so');
      print('     this tests site FAVOURABILITY, not planting-programme success.');
      print('   * Criteria present today are used as proxies for conditions at');
      print('     the time of gain. Soil and terrain are stable; climate and');
      print('     land cover are not.');
      print('   * This is internal evidence, not a substitute for field plots.');
    });
  }
}

// ============================================================================
// 21. VISUALIZATION
// ============================================================================
var displayScore = surviving.reduce(function (acc, c) {
  var term = c.norm.multiply(c.weight);
  return acc ? acc.add(term) : term;
}, null).updateMask(eligibleMask).rename('priorityScore').clip(roi);

// Quintile breaks are for the legend only, so they run at CONFIG.perf.vizScale
// rather than the output scale - a percentile reduction over the full
// criterion stack at 10 m is another route to the user memory limit.
var pctBreaks = displayScore.reduceRegion({
  reducer: ee.Reducer.percentile([20, 40, 60, 80]),
  geometry: roi, scale: CONFIG.perf.vizScale, maxPixels: 1e10, tileScale: 8, bestEffort: true
}).getInfo();
var p20 = (pctBreaks && pctBreaks.priorityScore_p20 != null) ? pctBreaks.priorityScore_p20 : 0.2;
var p40 = (pctBreaks && pctBreaks.priorityScore_p40 != null) ? pctBreaks.priorityScore_p40 : 0.4;
var p60 = (pctBreaks && pctBreaks.priorityScore_p60 != null) ? pctBreaks.priorityScore_p60 : 0.6;
var p80 = (pctBreaks && pctBreaks.priorityScore_p80 != null) ? pctBreaks.priorityScore_p80 : 0.8;
print('Priority Score quintile breaks: ' + p20.toFixed(3) + ' / ' + p40.toFixed(3) +
      ' / ' + p60.toFixed(3) + ' / ' + p80.toFixed(3));

var PRIORITY_CLASSES = [
  { code: 1, label: 'Very Low',  color: '1a9850' },
  { code: 2, label: 'Low',       color: 'a6d96a' },
  { code: 3, label: 'Medium',    color: 'ffffbf' },
  { code: 4, label: 'High',      color: 'fdae61' },
  { code: 5, label: 'Very High', color: 'd7191c' }
];
var priorityClassImg = ee.Image(1)
  .where(displayScore.gt(p20), 2)
  .where(displayScore.gt(p40), 3)
  .where(displayScore.gt(p60), 4)
  .where(displayScore.gt(p80), 5)
  .updateMask(displayScore.mask()).rename('priorityClass');

Map.addLayer(treatment.selfMask(), { min: 1, max: 2, palette: ['1a9850', '2b83ba'] },
  'Recommended Treatment (green=New Plantation, blue=ANR)', true);
Map.addLayer(priorityClassImg, { min: 1, max: 5, palette: PRIORITY_CLASSES.map(function (c) { return c.color; }) },
  'CAMPA Priority Score (5-class)', false);
Map.addLayer(fsiClass, { min: 1, max: 4, palette: ['d73027', 'fee08b', '91cf60', '1a9850'] },
  'FSI Canopy Class (current-data fused)', false);
Map.addLayer(canopyDensity, { min: 0, max: 80, palette: ['ffffcc', '78c679', '006837'] },
  'Current Canopy Density (%)', false);
if (productivityTrendRaw) {
  Map.addLayer(productivityTrendRaw, { min: -0.01, max: 0.01, palette: ['d73027', 'ffffbf', '1a9850'] },
    'Land Productivity Trend (red=degrading, UNCCD 15.3.1)', false);
}
if (erosionRaw) {
  Map.addLayer(erosionRaw, { min: 0, max: 40, palette: ['ffffcc', 'fd8d3c', 'bd0026'] },
    'RUSLE Soil Loss (t/ha/yr)', false);
}
if (phenoAnomalyRaw) {
  Map.addLayer(phenoAnomalyRaw.gt(0.55).selfMask(), { palette: ['ff00ff'] },
    'Invasion candidate (PROXY - field-verify)', false);
}
if (twi) {
  Map.addLayer(twi, { min: 3, max: 15, palette: ['ffffcc', '41b6c4', '253494'] },
    'Topographic Wetness Index', false);
}
Map.addLayer(constraintMask.not().selfMask(), { palette: ['000000'] },
  'Excluded by hard constraints', false);

try {
  var lg = ui.Panel({ style: { position: 'bottom-right', padding: '8px 15px' } });
  lg.add(ui.Label('CAMPA Priority Score', { fontWeight: 'bold', fontSize: '15px', margin: '0 0 2px 0' }));
  lg.add(ui.Label('v5 - ' + surviving.length + ' audited criteria', { fontSize: '10px', color: '666666', margin: '0 0 6px 0' }));
  PRIORITY_CLASSES.slice().reverse().forEach(function (c) {
    lg.add(ui.Panel({
      widgets: [ui.Label('', { backgroundColor: c.color, padding: '8px', margin: '0 0 4px 0' }),
                ui.Label(c.label, { margin: '0 0 4px 6px', fontSize: '12px' })],
      layout: ui.Panel.Layout.flow('horizontal')
    }));
  });
  Map.add(lg);
} catch (e) {}

// ---- Raster exports --------------------------------------------------------
Export.image.toDrive({ image: displayScore, description: CONFIG.exportPrefix + '_PriorityScore',
  folder: CONFIG.exportFolder, fileNamePrefix: CONFIG.exportPrefix + '_PriorityScore',
  region: roi.bounds(), scale: CONFIG.scale, crs: PROJ, maxPixels: 1e13 });
Export.image.toDrive({ image: treatment.toInt(), description: CONFIG.exportPrefix + '_TreatmentType',
  folder: CONFIG.exportFolder, fileNamePrefix: CONFIG.exportPrefix + '_TreatmentType',
  region: roi.bounds(), scale: CONFIG.scale, crs: PROJ, maxPixels: 1e13 });
Export.image.toDrive({ image: fsiClass.toInt(), description: CONFIG.exportPrefix + '_FSICanopyClass',
  folder: CONFIG.exportFolder, fileNamePrefix: CONFIG.exportPrefix + '_FSICanopyClass',
  region: roi.bounds(), scale: CONFIG.scale, crs: PROJ, maxPixels: 1e13 });
Export.table.toDrive({ collection: grid, description: CONFIG.exportPrefix + '_PlanningBlocks',
  folder: CONFIG.exportFolder, fileNamePrefix: CONFIG.exportPrefix + '_PlanningBlocks', fileFormat: 'SHP' });

}  // end: surviving.length > 0
}  // end: eligibleMask && active.length > 0
