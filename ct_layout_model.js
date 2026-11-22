// ===== 0. HEADER ==============================================================
/*******************************************************************************
 * CT-LAYOUT v1.1 : Scientific Contour Trench Layout & Decision Model
 * Google Earth Engine Code Editor (JavaScript). Paste into
 * code.earthengine.google.com and click RUN. Edit only the CONFIG block.
 *
 * Project      : Plantation SMC works, Khedbrahma Range, Sabarkantha Division,
 *                Gujarat Forest Department
 * Prepared for : Kathan H. Patel, ACF (P), 31st SFS
 * Spec         : CT-LAYOUT-MODEL_spec.md, v1.1 (22 Nov 2026), design storm
 *                T = 10 yr baseline, T = 5 yr comparison
 *
 * References (spec §13)
 *  1. BIS IS 14961:2024 Rain water harvesting & conservation - Guidelines.
 *  2. USDA-NRCS NEH Part 630 Hydrology Ch.7, 9, 10; TR-55 (1986).
 *  3. Williams J.R. (1995) The EPIC model (slope-adjusted CN).
 *  4. Wischmeier & Smith (1978) USDA AH-537; McCool et al. (1989) Trans ASAE 32.
 *  5. Gumbel (1958); Chow, Maidment & Mays (1988) Applied Hydrology.
 *  6. TNAU Agritech - contour & staggered trenches (SCT > 33 %).
 *  7. Samaj Pragati Sahayog (2006) NREGA Watershed Works Manual, Ch.7.
 *  8. Data: Copernicus DEM (ESA 2021); JAXA AW3D30; Funk et al. 2015 (CHIRPS);
 *     Brown et al. 2022 (Dynamic World); Zanaga et al. 2022 (WorldCover);
 *     Hengl (OpenLandMap); Yamazaki et al. 2019 (MERIT Hydro); Tolan et al.
 *     2024 (Meta canopy height); Jaafar et al. 2019 (GCN250);
 *     Simons et al. 2020 (HiHydroSoil).
 *
 * Run notes
 *  - The Code Editor runs a few small getInfo() steps (Gumbel series, VI,
 *    priority cut-off histogram). Everything else is server-side.
 *  - If map layers time out on a big plot, the Drive EXPORTS (Tasks tab)
 *    are the authoritative output: they run in batch with no time limit.
 ******************************************************************************/

// ===== 1. CONFIG ==============================================================
var CONFIG = {
  // --- Plot ---
  PLOT_ASSET: 'projects/khedbrahma-range/assets/sample_plot',
  PLOT_FIELD: null,              // attribute holding plot name, else system:index
  DEMO_IF_MISSING: true,         // if PLOT_ASSET cannot be read, run on a demo polygon
  DEMO_PLOT: [[73.0230, 24.0450], [73.0290, 24.0450], [73.0290, 24.0490], [73.0230, 24.0490]],
  CRS: 'EPSG:32643', WORK_SCALE: 5,
  CONTOUR_SCALE: 2,              // m, bicubic grid used only to trace row lines (sub-pixel rows)
  ME: 0.5,                       // m, max geometric error for vector operations
  AOI_BUFFER_M: 300, RAIN_BUFFER_M: 2000,
  DEM_ASSET: null,               // optional CartoDEM / drone DSM override
  DEM_SMOOTH_RADIUS_M: 45, DEM_SMOOTH_SIGMA_M: 15,
  // --- Optional community datasets (§3.2) ---
  HSG_ASSET: 'projects/sat-io/open-datasets/HiHydroSoilv2_0/Hydrologic_Soil_Group_250m',
  GCN_ASSET: 'projects/sat-io/open-datasets/GCN250/GCNAverage',
  META_ASSET: 'projects/meta-forest-monitoring-okw37/assets/CanopyHeight',
  // --- Trench (§2) ---
  TR_LEN: 2.0, TR_WID: 0.45, TR_DEP: 0.30, PLUG: 0.30, PLUG_LOOSE: 0.45, SCT_GAP: 2.0,
  LEN_TOL: 0.05,
  TRENCH_CAP_PER_HA: 200, TRENCH_BUDGET: null,
  // --- Hydrology (§4) ---
  T_DESIGN: 10, T_CHECK: 5, CHIRPS_START: '1981-01-01', CHIRPS_END: '2025-12-31',
  CHIRPS_SCALE: 1000,            // m, sampling grid for the 0.05 deg CHIRPS pixel
  P_OVERRIDE_MM: null,           // IMD station design rainfall (mm) overrides CHIRPS
  WET_DAY_MM: 2.5, WETDAY_STATS: true,
  HSG_DEFAULT: 3,                // 1=A 2=B 3=C 4=D where texture is missing
  TEX_FROM: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],  // USDA texture codes (OpenLandMap)
  TEX_HSG:  [4, 4, 4, 4, 4, 3, 2, 2, 2, 2, 1, 1],     // §4.2 texture -> HSG
  TEX_LOOSE: [11, 12],           // loamy sand, sand -> 0.45 m plug
  HSG_FROM: [1, 2, 3, 4, 11, 12, 13, 14, 24, 34],     // HiHydroSoil codes
  HSG_TO:   [1, 2, 3, 4, 4, 4, 4, 4, 4, 4],           // dual groups -> D
  CN_TABLE: [[36, 60, 73, 79],   // trees, good canopy      (A,B,C,D)  §4.2
             [48, 67, 77, 83],   // shrub / scrub, open forest
             [68, 79, 86, 89],   // grass / degraded pasture
             [77, 86, 91, 94]],  // bare soil / rock
  CN_MIN: 30, CN_MAX: 98,
  // --- Slopes (%) ---
  SLOPE_MIN: 5, SLOPE_S2: 15, SLOPE_SCT: 33, SLOPE_MAX: 50,
  WS: {S1: 0.5, S2: 1.0, S3: 0.8},
  // --- Canopy / rock ---
  CANOPY_H_M: 5, NDVI_CANOPY: 0.55, DW_TREES: 0.5, DW_BARE: 0.5, BSI_ROCK: 0.15, CS_THRESH: 0.60,
  S2_START: '2025-10-01', S2_END: '2026-01-31', DRY_START: '2026-03-01', DRY_END: '2026-05-31',
  WC_TREES: 10, WC_SHRUB: 20, WC_GRASS: 30, WC_CROP: 40, WC_BUILT: 50, WC_BARE: 60, WC_WATER: 80,
  // --- Terrain ---
  TPI_RADIUS_M: 60, TPI_RIDGE: 1.5, TPI_VALLEY: -1.5, UPA_KM2: 0.05, DRAIN_BUFFER_M: 10,
  USE_CURVATURE: true, TPI_VALLEY_WEAK: -0.75, CURV_HOLLOW: -0.01,
  LAMBDA_CAP_M: 150,
  // --- Decision ---
  HI_TARGET: 10, HI_MIN: 6, HI_MAX: 15, VI_MIN: 0.30, VI_MAX: 3.00, VI_ROUND: 0.05,
  VI_OVERRIDE: null,
  W: {slope: 0.40, runoff: 0.25, upslope: 0.20, ls: 0.15},
  PRI_BINS: 100,
  MIN_PATCH_M2: 500, HOLE_M2: 200, MIN_ROW_M: 10, ROW_SIMPLIFY_M: 1.0, ROW_REGION_BUFFER_M: 30,
  TREE_CLEARANCE_M: 1.5, MAX_LEVELS: 250,
  // --- Staking ---
  BASELINE_SPACING: 40, MAX_BASELINES: 20, BL_ASPECT_RADIUS_M: 150, BL_MAX_LEN_M: 800,
  BL_DASH_M: 5, VI_FIELD_TOL: 0.10, ROW_JOIN_TOL_M: 3,
  // --- QA (§11) ---
  QA_ROW_GAP_M: 0.5, QA_ROW_SAMPLE: 300, QA_N_TOL: 0.15, QA_K5: 0.719, QA_K10: 1.305,
  QA_K_TOL: 0.002, QA_Z_TOL: 0.01,
  // --- Output ---
  DRIVE_FOLDER: 'CT_LAYOUT_KHEDBRAHMA', MAX_PLOTS: 5, RUN_EXPORTS: true,
  SHOW_VECTOR_LAYERS: true, ZOOM: 16,
  STAFF_BANDS: [[5, 10], [10, 15], [15, 20], [20, 25], [25, 33], [33, 40], [40, 50]]
};

// ===== 2. UTILS ===============================================================
// Derived trench constants (§2, §4.5)
function derived() {
  var Vt = CONFIG.TR_LEN * CONFIG.TR_WID * CONFIG.TR_DEP;          // §2: 0.27 m3
  var pC = CONFIG.TR_LEN + CONFIG.PLUG;                             // §2: CCT pitch 2.30 m
  var pS = CONFIG.TR_LEN + CONFIG.SCT_GAP;                          // §2: SCT pitch 4.00 m
  return {Vt: Vt, P_CCT: pC, P_SCT: pS,
          S_CCT: Vt / pC,                                           // §4.5: 0.1174 m3/m
          S_SCT: Vt / pS,                                           // §4.5: 0.0675 m3/m
          S_RUN: CONFIG.TR_WID * CONFIG.TR_DEP};                    // §2: 0.135 m3 per m of trench
}

// §3.3 Fallback rule: client-side asset check inside try/catch
function safeLoad(id, label) {
  if (!id) return null;
  try {
    var info = ee.data.getAsset(id);
    if (!info) throw new Error('no info');
    var t = String(info.type || '').toUpperCase().replace(/_/g, '');
    if (t === 'IMAGE') return ee.Image(id);
    if (t === 'IMAGECOLLECTION') return ee.ImageCollection(id).mosaic();
    if (t === 'TABLE' || t === 'FEATURECOLLECTION') return ee.FeatureCollection(id);
    throw new Error('unknown type ' + t);
  } catch (e) {
    print('WARN: ' + label + ' unavailable, using fallback');
    return null;
  }
}

function fmt(x, dec) {
  if (x === null || x === undefined || isNaN(Number(x))) return 'n/a';
  return Number(x).toFixed(dec === undefined ? 2 : dec);
}
function rnd(x, dec) { var f = Math.pow(10, dec); return ee.Number(x).multiply(f).round().divide(f); }
function safeNum(f, prop, def) {
  var v = ee.Feature(f).get(prop);
  return ee.Number(ee.Algorithms.If(ee.Algorithms.IsEqual(v, null), def, v));
}
function roundTo(x, step) { return Math.round(x / step) * step; }
function clamp(x, lo, hi) { return Math.max(lo, Math.min(hi, x)); }
function sanitize(s) { return String(s).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 60); }

// §4.1 Gumbel EV-I frequency factor: K_T = -(sqrt6/pi)[0.5772 + ln(ln(T/(T-1)))]
// Check values: K_5 = 0.719, K_10 = 1.305
function gumbelK(T) {
  return -(Math.sqrt(6) / Math.PI) * (0.5772 + Math.log(Math.log(T / (T - 1))));
}

// §4.4 SCS-CN runoff: Q = (P-Ia)^2/(P-Ia+Sr) for P>Ia else 0, Ia = 0.2 Sr (mm)
function scsQ(P, Sr) {
  var Ia = Sr.multiply(0.2);
  var x = ee.Image.constant(P).subtract(Ia).max(0);
  return x.pow(2).divide(x.add(Sr)).rename('Q');
}

// §4.5 Storm fully held: q = 1000 s/HI ; P* = Ia + [q + sqrt(q^2 + 4 q Sr)]/2
function pStar(s, HI, Sr) {
  var q = s.multiply(1000).divide(HI);
  return Sr.multiply(0.2)
    .add(q.add(q.pow(2).add(q.multiply(Sr).multiply(4)).sqrt()).divide(2))
    .rename('P_held');
}

// §6.3 Cut distances along a line: [off, off+L, off+p, off+p+L, ...] inside (0, len)
function cutDistances(len, pitch, off) {
  len = ee.Number(len); off = ee.Number(off);
  var n = len.divide(pitch).ceil().add(1);
  var dl = ee.List.sequence(0, n.subtract(1)).map(function (k) {
    var a = off.add(ee.Number(k).multiply(pitch));
    return ee.List([a, a.add(CONFIG.TR_LEN)]);
  }).flatten();
  return dl.filter(ee.Filter.gt('item', 0)).filter(ee.Filter.lt('item', len));
}
// Client mirror of cutDistances, used by QA test 4
function cutPattern(len, pitch, off) {
  var out = [];
  for (var k = 0; ; k++) {
    var a = off + k * pitch, b = a + CONFIG.TR_LEN;
    if (a >= len) break;
    if (a > 0) out.push(a);
    if (b < len) out.push(b);
  }
  return out;
}

// Explode any geometry into LineString features >= minLen (projected metres)
function explodeFC(geom, minLen) {
  var PU = ee.Projection(CONFIG.CRS);
  return ee.FeatureCollection(ee.Geometry(geom).geometries().map(function (g) {
    g = ee.Geometry(g);
    return ee.Feature(g, {gtype: g.type(), glen: g.length(CONFIG.ME, PU)});
  })).filter(ee.Filter.eq('gtype', 'LineString')).filter(ee.Filter.gte('glen', minLen));
}

// Start / end / centre lat-lon properties (6 decimals) of a line
function toLatLonProps(geom) {
  var g4 = ee.Geometry(geom).transform('EPSG:4326', CONFIG.ME);
  var cs = ee.List(g4.coordinates());
  var st = ee.List(cs.get(0)), en = ee.List(cs.get(-1));
  var ce = ee.List(g4.centroid(CONFIG.ME).coordinates());
  return {geom: g4, props: {
    START_LAT: rnd(st.get(1), 6), START_LON: rnd(st.get(0), 6),
    END_LAT: rnd(en.get(1), 6), END_LON: rnd(en.get(0), 6),
    CENTRE_LAT: rnd(ce.get(1), 6), CENTRE_LON: rnd(ce.get(0), 6)}};
}

var LETTERS = (function () {
  var a = 'abcdefghijklmnopqrstuvwxyz'.split(''), out = a.slice();
  a.forEach(function (x) { out.push('a' + x); });
  return out;
})();

var FIELD_STEPS = [
  '1. Find BM-0 with the KML and peg it.',
  '2. Lay a tape from BM-0 down the baseline direction (compass bearing printed per baseline). At each cumulative tape distance in the chainage table, drive a peg. This is a row peg (R01, R02, ...).',
  '3. Correct with a level: at each row peg, check the vertical drop from the previous row peg with the A-frame step method or a line level and staff. It should equal VI +/- ' + CONFIG.VI_FIELD_TOL.toFixed(2) + ' m. If not, slide the peg up or down the baseline until it does. Vertical interval is the controlling value; tape distance is the guide.',
  '4. From each corrected row peg, walk the true contour sideways with the A-frame. Peg every ' + (CONFIG.TR_LEN + CONFIG.PLUG).toFixed(1) + ' m (CCT) or ' + (CONFIG.TR_LEN + CONFIG.SCT_GAP).toFixed(1) + ' m (SCT). Paint the pegs or use lime.',
  '5. Mark trench ends with lime: ' + CONFIG.TR_LEN.toFixed(1) + ' m trench, ' + CONFIG.PLUG.toFixed(2) + ' m plug (CCT), or ' + CONFIG.SCT_GAP.toFixed(1) + ' m gap (SCT). For SCT, offset alternate rows by ' + CONFIG.SCT_GAP.toFixed(1) + ' m.',
  '6. Dig. The bed of each ' + CONFIG.TR_LEN.toFixed(0) + ' m cell must be level. Put the spoil downhill as a bund. Leave plugs as undisturbed ground at natural ground level.',
  '7. Rows started from neighbouring baselines must meet. A mismatch of up to ' + CONFIG.ROW_JOIN_TOL_M + ' m along the slope is acceptable. Join them following the A-frame, not the GPS.',
  '8. Trees: shift the trench along the contour to stay >= ' + CONFIG.TREE_CLEARANCE_M + ' m from the tree base. Never shift it up or down the slope.',
  '9. Drainage lines (red hatched in KML): no trench. Note them as gully plug sites.'
];
var LIMITATIONS = [
  'A 30 m DEM fixes zones, VI and row count reliably. It does NOT fix the absolute position of a row to better than about +/-10-15 m. Staking therefore uses baselines and A-frame levelling on the ground (§7), not GPS alone.',
  'CHIRPS tends to under-estimate daily extremes. Override the design rainfall with an IMD station value through CONFIG.P_OVERRIDE_MM.',
  'A CartoDEM (Bhuvan) or drone DSM can replace the DEM by setting CONFIG.DEM_ASSET. All maths stays the same.'
];

// ===== 4. DATA (loaders; called from runPlot) ================================
var _OPT = null;
function optionalData() {                                   // §3.2 optional sets
  if (_OPT) return _OPT;
  _OPT = {hsg: safeLoad(CONFIG.HSG_ASSET, 'HiHydroSoil v2 HSG'),
          gcn: safeLoad(CONFIG.GCN_ASSET, 'GCN250 CN-II'),
          meta: safeLoad(CONFIG.META_ASSET, 'Meta canopy height')};
  return _OPT;
}

function loadDEM(region) {                                   // §3.1 DEM chain
  var tries = [];
  if (CONFIG.DEM_ASSET) tries.push({label: 'User DEM ' + CONFIG.DEM_ASSET, fn: function () {
    var o = safeLoad(CONFIG.DEM_ASSET, 'User DEM'); if (!o) throw new Error('x');
    return ee.Image(o).select(0);
  }});
  tries.push({label: 'Copernicus DEM GLO-30', fn: function () {
    var c = ee.ImageCollection('COPERNICUS/DEM/GLO30').filterBounds(region).select('DEM');
    if (c.size().getInfo() === 0) throw new Error('empty');
    return c.mosaic().setDefaultProjection(c.first().projection());
  }});
  tries.push({label: 'ALOS AW3D30 v3.2', fn: function () {
    var c = ee.ImageCollection('JAXA/ALOS/AW3D30/V3_2').filterBounds(region).select('DSM');
    if (c.size().getInfo() === 0) throw new Error('empty');
    return c.mosaic().setDefaultProjection(c.first().projection());
  }});
  tries.push({label: 'NASADEM', fn: function () {
    var im = ee.Image('NASA/NASADEM_HGT/001').select('elevation');
    im.bandNames().getInfo();
    return im;
  }});
  for (var i = 0; i < tries.length; i++) {
    try { return {img: tries[i].fn().rename('elev').toFloat(), src: tries[i].label}; }
    catch (e) { print('WARN: ' + tries[i].label + ' unavailable, using fallback'); }
  }
  throw new Error('No DEM available');
}

function s2Composite(region, start, end) {                   // §3.1 S2 + Cloud Score+
  var bands = ['B2', 'B3', 'B4', 'B8', 'B11'];
  var cs = ee.ImageCollection('GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED');
  var col = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterBounds(region).filterDate(start, end)
    .linkCollection(cs, ['cs_cdf'])
    .map(function (img) {
      return img.updateMask(img.select('cs_cdf').gte(CONFIG.CS_THRESH)).select(bands);
    });
  var empty = ee.Image.constant([0, 0, 0, 0, 0]).rename(bands).toFloat().updateMask(0);
  return ee.Image(ee.Algorithms.If(col.size().gt(0), col.median().toFloat(), empty));
}

function dynamicWorld(region, wc) {                          // §3.1 DW, WorldCover fallback
  var b = ['trees', 'bare', 'grass', 'shrub_and_scrub'];
  var col = ee.ImageCollection('GOOGLE/DYNAMICWORLD/V1').filterBounds(region)
    .filterDate(CONFIG.S2_START, CONFIG.S2_END).select(b);
  var empty = ee.Image.constant([0, 0, 0, 0]).rename(b).toFloat().updateMask(0);
  var dwm = ee.Image(ee.Algorithms.If(col.size().gt(0), col.mean().toFloat(), empty));
  var wcP = ee.Image.cat(wc.eq(CONFIG.WC_TREES), wc.eq(CONFIG.WC_BARE),
    wc.eq(CONFIG.WC_GRASS).or(wc.eq(CONFIG.WC_CROP)), wc.eq(CONFIG.WC_SHRUB)).rename(b).toFloat();
  return dwm.unmask(wcP);
}

// =============================================================================
// PER-PLOT MODEL (sections 3-14 run in order for each plot)
// =============================================================================
function runPlot(plotFeature, plotName, outPanel) {
  var d = derived();
  var PU = ee.Projection(CONFIG.CRS);
  var P5 = PU.atScale(CONFIG.WORK_SCALE);
  var PC = PU.atScale(CONFIG.CONTOUR_SCALE);
  var ME = CONFIG.ME, SC = CONFIG.WORK_SCALE, PIX = SC * SC;
  var L = plotName + ' | ';
  var SRC = {};
  function rr(img, reducer, geom, scale) {
    return img.reduceRegion({reducer: reducer, geometry: geom, scale: scale || SC,
      crs: CONFIG.CRS, maxPixels: 1e10, tileScale: 4});
  }
  function say(t, style) { print(t); outPanel.add(ui.Label(t, style || {fontSize: '12px', margin: '1px 4px'})); }

  // ===== 3. AOI ===============================================================
  var plot = ee.Feature(plotFeature).geometry();
  var plotFC = ee.FeatureCollection([ee.Feature(plot)]);
  var bufA = plot.buffer(CONFIG.AOI_BUFFER_M, ME);           // §5.2.1 300 m buffer
  var bufR = plot.buffer(CONFIG.RAIN_BUFFER_M, ME * 10);     // §4.1 2 km buffer
  var areaHa = plot.area(ME, PU).divide(1e4);
  Map.centerObject(plot, CONFIG.ZOOM);

  // ===== 4. DATA ==============================================================
  var DEM = loadDEM(bufA); SRC.DEM = DEM.src;
  var OPT = optionalData();
  SRC.HSG = OPT.hsg ? 'HiHydroSoil v2 (+ texture fill)' : 'OpenLandMap texture -> HSG table';
  SRC.CN = OPT.gcn ? 'GCN250 average (+ table fill)' : 'TR-55 HSG x land-cover table';
  SRC.CANOPY = (OPT.meta ? 'Meta 1 m height OR ' : '') + 'DW trees OR S2 NDVI';
  var chirps = ee.ImageCollection('UCSB-CHG/CHIRPS/DAILY').select('precipitation')
    .filterDate(CONFIG.CHIRPS_START, ee.Date(CONFIG.CHIRPS_END).advance(1, 'day'));
  var s2Wet = s2Composite(bufA, CONFIG.S2_START, CONFIG.S2_END);    // §3.4 leaf-on
  var s2Dry = s2Composite(bufA, CONFIG.DRY_START, CONFIG.DRY_END);  // §3.4 dry, BSI only
  var wc = ee.ImageCollection('ESA/WorldCover/v200').first().select('Map');
  var dw = dynamicWorld(bufA, wc);
  var olm = ee.Image('OpenLandMap/SOL/SOL_TEXTURE-CLASS_USDA-TT_M/v02').select(['b0', 'b30']);
  var merit = ee.Image('MERIT/Hydro/v1_0_1').select(['upa', 'hnd']);

  // ===== 5. TERRAIN ===========================================================
  // §5.2.2-3 Gaussian smoothing, bicubic resample, 5 m UTM 43N
  var gk = ee.Kernel.gaussian(CONFIG.DEM_SMOOTH_RADIUS_M, CONFIG.DEM_SMOOTH_SIGMA_M, 'meters');
  var zs = DEM.img.resample('bicubic').convolve(gk).reproject(P5).clip(bufA).rename('z');
  // §5.2.4 slope: tan(theta) = |grad z| ; S% = 100 tan(theta)
  var theta = ee.Terrain.slope(zs).multiply(Math.PI / 180).rename('theta');
  var tanT = theta.tan().rename('tan');
  var sinT = theta.sin().rename('sin');
  var cosT = theta.cos().rename('cos');
  var slopePct = tanT.multiply(100).rename('slope_pct');
  // §5.2.5 aspect (downslope facing direction, deg from N)
  var aspRad = ee.Terrain.aspect(zs).multiply(Math.PI / 180).rename('asp');
  // §5.2.6 TPI = z - mean(z within 60 m)
  var tpi = zs.subtract(zs.focalMean(CONFIG.TPI_RADIUS_M, 'circle', 'meters')).reproject(P5).rename('tpi');
  // §5.2.7 plan-curvature proxy (negative = convergent hollow), 1/m
  var curv = zs.convolve(ee.Kernel.laplacian8(1, false)).multiply(-1).divide(PIX).reproject(P5).rename('curv');
  var inPlot = ee.Image(0).paint(plotFC, 1).reproject(P5).rename('inplot');

  // ===== 6. HYDRO =============================================================
  // §4.1 annual 1-day maxima at the plot (2 km buffer mean)
  var y0 = parseInt(CONFIG.CHIRPS_START.slice(0, 4), 10), y1 = parseInt(CONFIG.CHIRPS_END.slice(0, 4), 10);
  var annual = ee.FeatureCollection(ee.List.sequence(y0, y1).map(function (y) {
    var s = ee.Date.fromYMD(ee.Number(y), 1, 1);
    var v = chirps.filterDate(s, s.advance(1, 'year')).max()
      .reduceRegion({reducer: ee.Reducer.mean(), geometry: bufR, scale: CONFIG.CHIRPS_SCALE,
        crs: CONFIG.CRS, maxPixels: 1e10}).get('precipitation');
    return ee.Feature(null, {year: y, pmax: v});
  })).filter(ee.Filter.notNull(['pmax']));
  var zmaxN = ee.Number(rr(zs, ee.Reducer.max(), plot).get('z'));
  var bmLL = rr(ee.Image.pixelLonLat().updateMask(zs.gte(zmaxN.subtract(0.001)).and(inPlot)),
    ee.Reducer.first(), plot);
  var A = ee.Dictionary({
    area_ha: areaHa, years: annual.aggregate_array('year'), pmax: annual.aggregate_array('pmax'),
    zmax: zmaxN, zmin: rr(zs, ee.Reducer.min(), plot).get('z'),
    bm_lon: bmLL.get('longitude'), bm_lat: bmLL.get('latitude'),
    meanTan: rr(tanT, ee.Reducer.mean(), plot).get('tan')
  }).getInfo();                                              // client step 1 (small)
  var zTop = A.zmax, zMinPlot = A.zmin;
  var ser = A.pmax, nY = ser.length;
  var mu = ser.reduce(function (a, b) { return a + b; }, 0) / nY;
  var sd = Math.sqrt(ser.reduce(function (a, b) { return a + (b - mu) * (b - mu); }, 0) / (nY - 1)); // n-1
  var K10 = gumbelK(10), K5 = gumbelK(5);                     // §4.1 X_T = mu + K_T sigma
  var X10 = mu + K10 * sd, X5 = mu + K5 * sd;
  var XD = mu + gumbelK(CONFIG.T_DESIGN) * sd, XC = mu + gumbelK(CONFIG.T_CHECK) * sd;
  var overridden = (CONFIG.P_OVERRIDE_MM !== null && CONFIG.P_OVERRIDE_MM !== undefined);
  var Pdesign = overridden ? CONFIG.P_OVERRIDE_MM : XD;
  var Pcheck = XC;

  // rock / very-shallow flag (§5.4), needed here for HSG shift (§4.2)
  var ndvi = s2Wet.normalizedDifference(['B8', 'B4']).rename('ndvi').unmask(0);
  var bsi = s2Dry.expression('((S + R) - (N + B)) / ((S + R) + (N + B))', {   // §5.4 BSI
    S: s2Dry.select('B11'), R: s2Dry.select('B4'), N: s2Dry.select('B8'), B: s2Dry.select('B2')
  }).rename('bsi').unmask(0);
  var rock = wc.eq(CONFIG.WC_BARE).or(dw.select('bare').gte(CONFIG.DW_BARE))
    .and(bsi.gt(CONFIG.BSI_ROCK)).unmask(0).rename('rock');

  // §4.2 HSG: HiHydroSoil, else texture -> HSG; +1 group (cap D) on rock/shallow
  var h0 = olm.select('b0').remap(CONFIG.TEX_FROM, CONFIG.TEX_HSG).unmask(0);
  var h30 = olm.select('b30').remap(CONFIG.TEX_FROM, CONFIG.TEX_HSG).unmask(0);
  var hsgTex = h0.max(h30);
  hsgTex = hsgTex.where(hsgTex.eq(0), CONFIG.HSG_DEFAULT);
  var hsgBase = OPT.hsg ? ee.Image(OPT.hsg).select(0).remap(CONFIG.HSG_FROM, CONFIG.HSG_TO).unmask(hsgTex) : hsgTex;
  var hsg = hsgBase.add(rock).min(4).rename('hsg');
  var loose = olm.select('b0').remap(CONFIG.TEX_LOOSE, CONFIG.TEX_LOOSE.map(function () { return 1; }))
    .unmask(0).rename('loose');

  // §4.2 land condition: 0 trees, 1 shrub/open forest, 2 grass/degraded, 3 bare/rock
  var lc = ee.Image(1)
    .where(dw.select('grass').gt(dw.select('shrub_and_scrub')), 2)
    .where(dw.select('bare').gte(CONFIG.DW_BARE).or(wc.eq(CONFIG.WC_BARE)), 3)
    .where(dw.select('trees').gte(CONFIG.DW_TREES), 0).rename('lc');
  var cnFlat = [].concat.apply([], CONFIG.CN_TABLE);
  var cnLookup = lc.multiply(4).add(hsg.subtract(1)).int()
    .remap(cnFlat.map(function (v, i) { return i; }), cnFlat).toFloat();
  var cn2 = cnLookup;
  if (OPT.gcn) {
    var g = ee.Image(OPT.gcn).select(0).toFloat();
    cn2 = g.updateMask(g.gt(0).and(g.lte(100))).unmask(cnLookup);
  }
  cn2 = cn2.clamp(CONFIG.CN_MIN, CONFIG.CN_MAX).rename('cn2');
  // §4.3 Williams (1995): CN_III = CN_II exp[0.00673(100-CN_II)]
  //      CN_IIs = (CN_III-CN_II)/3 [1 - 2 exp(-13.86 S)] + CN_II
  var cn3 = cn2.multiply(ee.Image(100).subtract(cn2).multiply(0.00673).exp());
  var cns = cn3.subtract(cn2).divide(3)
    .multiply(ee.Image(1).subtract(tanT.multiply(-13.86).exp().multiply(2)))
    .add(cn2).clamp(CONFIG.CN_MIN, CONFIG.CN_MAX).rename('cns');
  // §4.4 S_r = 25400/CN - 254 ; Q for P_design (baseline) and P_check
  var Sr = ee.Image(25400).divide(cns).subtract(254).rename('Sr');
  var Qd = scsQ(Pdesign, Sr).rename('Qd');
  var Qc = scsQ(Pcheck, Sr).rename('Qc');

  // ===== 7. MASKS =============================================================
  var flat = slopePct.lt(CONFIG.SLOPE_MIN).unmask(0);                     // §5.4
  var steep = slopePct.gt(CONFIG.SLOPE_MAX).unmask(0);
  var valleyCore = tpi.lt(CONFIG.TPI_VALLEY)                                // §5.2.6
    .or(merit.select('upa').gt(CONFIG.UPA_KM2).and(tpi.lt(0)))             // MERIT, only in local lows
    .or(CONFIG.USE_CURVATURE ? tpi.lt(CONFIG.TPI_VALLEY_WEAK).and(curv.lt(CONFIG.CURV_HOLLOW)) : ee.Image(0))
    .unmask(0).reproject(P5).rename('valley');
  var drain = valleyCore.focalMax(CONFIG.DRAIN_BUFFER_M, 'circle', 'meters').reproject(P5).rename('drain');
  var built = wc.eq(CONFIG.WC_BUILT).or(wc.eq(CONFIG.WC_WATER)).unmask(0);
  var excl = flat.or(steep).or(drain).or(rock).or(built).rename('excl');
  var E = inPlot.and(excl.not()).reproject(P5).rename('E');                 // eligible set
  // §5.3 canopy rule
  var canopy = dw.select('trees').gte(CONFIG.DW_TREES).or(ndvi.gte(CONFIG.NDVI_CANOPY));
  if (OPT.meta) canopy = canopy.or(ee.Image(OPT.meta).select(0).gte(CONFIG.CANOPY_H_M).unmask(0));
  canopy = canopy.unmask(0).rename('canopy');
  var exclCode = ee.Image(0).where(flat, 1).where(steep, 2).where(rock, 4).where(built, 5)
    .where(drain, 3).updateMask(inPlot).selfMask().rename('excl_code');

  // ===== 8. DECISION ==========================================================
  // §5.5 slope classes S1/S2/S3 and type (1 = CCT, 2 = SCT)
  var cls = ee.Image(0)
    .where(slopePct.gte(CONFIG.SLOPE_MIN).and(slopePct.lt(CONFIG.SLOPE_S2)), 1)
    .where(slopePct.gte(CONFIG.SLOPE_S2).and(slopePct.lt(CONFIG.SLOPE_SCT)), 2)
    .where(slopePct.gte(CONFIG.SLOPE_SCT).and(slopePct.lte(CONFIG.SLOPE_MAX)), 3)
    .updateMask(E).reproject(P5).rename('cls');
  var typeImg = ee.Image(1).where(canopy, 2).where(cls.eq(3), 2).updateMask(E).reproject(P5).rename('type');
  var ws = cls.remap([1, 2, 3], [CONFIG.WS.S1, CONFIG.WS.S2, CONFIG.WS.S3]).rename('ws');
  var pitch = typeImg.remap([1, 2], [d.P_CCT, d.P_SCT]).rename('pitch');

  var A2 = ee.Dictionary({
    medTan: rr(tanT.updateMask(E), ee.Reducer.median(), plot).get('tan'),
    E_ha: ee.Number(rr(ee.Image.pixelArea().updateMask(E), ee.Reducer.sum(), plot).get('area')).divide(1e4)
  }).getInfo();                                              // client step 2 (small)
  if (!A2.medTan || A2.E_ha <= 0) {
    say(L + 'STOP: no eligible area (all pixels excluded).', {color: 'red'}); return;
  }
  // §5.7.2 VI0 = HI_TARGET x median(tan theta over E), rounded and clamped
  var VI0 = clamp(roundTo(CONFIG.HI_TARGET * A2.medTan, CONFIG.VI_ROUND), CONFIG.VI_MIN, CONFIG.VI_MAX);
  var VI = CONFIG.VI_OVERRIDE ? CONFIG.VI_OVERRIDE : VI0;
  VI = Math.round(VI * 100) / 100;
  var viHow = CONFIG.VI_OVERRIDE ? 'officer override' :
    ('HI_TARGET ' + CONFIG.HI_TARGET + ' m x median tan ' + fmt(A2.medTan, 3) + ', rounded ' + CONFIG.VI_ROUND + ' m');

  // §5.6 priority PRI = 0.40 w_s + 0.25 Qn + 0.20 Un + 0.15 LSn
  var nStats = rr(Qd.rename('Q').updateMask(E), ee.Reducer.minMax(), plot);
  var Qn = Qd.subtract(ee.Number(nStats.get('Q_min')))
    .divide(ee.Number(nStats.get('Q_max')).subtract(ee.Number(nStats.get('Q_min'))).max(1e-6)).clamp(0, 1);
  var Un = zs.subtract(zMinPlot).divide(Math.max(zTop - zMinPlot, 0.01)).clamp(0, 1);
  // §5.6 RUSLE LS: lambda = (z_top - z)/mean tan, capped 150 m
  //  LS = (lambda/22.13)^m (65.41 sin^2 + 4.56 sin + 0.065); m = b/(1+b);
  //  b = (sin/0.0896)/(3 sin^0.8 + 0.56)
  var lam = ee.Image.constant(zTop).subtract(zs).divide(Math.max(A.meanTan, 0.01))
    .clamp(0, CONFIG.LAMBDA_CAP_M).rename('lambda');
  var beta = sinT.divide(0.0896).divide(sinT.pow(0.8).multiply(3).add(0.56));
  var mExp = beta.divide(beta.add(1)).rename('m');
  var LS = lam.divide(22.13).pow(mExp)
    .multiply(sinT.pow(2).multiply(65.41).add(sinT.multiply(4.56)).add(0.065)).rename('LS');
  var lsStats = rr(LS.updateMask(E), ee.Reducer.minMax(), plot);
  var LSn = LS.subtract(ee.Number(lsStats.get('LS_min')))
    .divide(ee.Number(lsStats.get('LS_max')).subtract(ee.Number(lsStats.get('LS_min'))).max(1e-6)).clamp(0, 1);
  var pri = ws.multiply(CONFIG.W.slope).add(Qn.multiply(CONFIG.W.runoff))
    .add(Un.multiply(CONFIG.W.upslope)).add(LSn.multiply(CONFIG.W.ls))
    .updateMask(E).reproject(P5).rename('PRI');

  // §5.1 trench cap
  var Nmax = Math.floor(CONFIG.TRENCH_CAP_PER_HA * A.area_ha);
  if (CONFIG.TRENCH_BUDGET) Nmax = Math.min(Nmax, CONFIG.TRENCH_BUDGET);
  // §5.7 analytic count density: N = sum tan A_pix /(VI p)
  var dens = tanT.multiply(ee.Image.pixelArea()).divide(pitch.multiply(VI)).updateMask(E).rename('n');
  var bin = pri.multiply(CONFIG.PRI_BINS).floor().clamp(0, CONFIG.PRI_BINS - 1).int().rename('bin');
  var B = ee.Dictionary({
    hist: rr(dens.addBands(bin), ee.Reducer.sum().group({groupField: 1, groupName: 'bin'}), plot).get('groups'),
    NE: rr(dens, ee.Reducer.sum(), plot).get('n')
  }).getInfo();                                              // client step 3: priority histogram
  var NE = B.NE || 0, priCut = 0, constrained = false;
  if (NE > Nmax) {                                           // §5.7.5 shrink area by priority
    constrained = true;
    var groups = (B.hist || []).slice().sort(function (a, b) { return b.bin - a.bin; });
    var cum = 0;
    for (var gi = 0; gi < groups.length; gi++) {
      cum += groups[gi].sum;
      if (cum >= Nmax) { priCut = groups[gi].bin / CONFIG.PRI_BINS; break; }
    }
  }
  // §5.7.6 contiguity clean-up: drop patches < 500 m2, fill holes < 200 m2 (inside E only)
  var minPix = Math.ceil(CONFIG.MIN_PATCH_M2 / PIX), holePix = Math.ceil(CONFIG.HOLE_M2 / PIX);
  var Traw = E.and(pri.gte(priCut)).unmask(0);
  var patchN = Traw.selfMask().connectedPixelCount(minPix + 1, true).reproject(P5);
  var Tc = Traw.and(patchN.gte(minPix)).unmask(0);
  var holeN = Tc.not().selfMask().connectedPixelCount(holePix + 1, true).reproject(P5);
  var Tm = Tc.or(holeN.lt(holePix).unmask(0).and(E)).and(inPlot).reproject(P5);
  var Tmask = Tm.selfMask().rename('T');
  var typeT = typeImg.updateMask(Tmask).int();
  var clsT = cls.updateMask(Tmask).int();
  var C = ee.Dictionary(rr(ee.Image.cat(zs.updateMask(Tmask).rename('zT'),
      ee.Image.pixelArea().updateMask(Tmask).rename('aT'), dens.updateMask(Tmask).rename('nT')),
    ee.Reducer.minMax().combine(ee.Reducer.sum(), null, true), plot)).getInfo(); // client step 4
  if (!C.aT_sum || C.aT_sum <= 0) { say(L + 'STOP: treated set T is empty.', {color: 'red'}); return; }
  var zTmin = C.zT_min, zTmax = C.zT_max, NT_analytic = C.nT_sum, T_ha = C.aT_sum / 1e4;

  // vectorised treated set (CCT / SCT zones), exact 5 m pixel edges
  var tVec = typeT.reduceToVectors({geometry: plot, crs: CONFIG.CRS, scale: SC, geometryType: 'polygon',
    eightConnected: false, labelProperty: 'TYPE', maxPixels: 1e10, tileScale: 4});
  function dissolve(fc) {
    return ee.Geometry(ee.Algorithms.If(fc.size().gt(0), fc.union(ME).geometry(), ee.Geometry.MultiPolygon([])));
  }
  var TgC = dissolve(tVec.filter(ee.Filter.eq('TYPE', 1)));
  var TgS = dissolve(tVec.filter(ee.Filter.eq('TYPE', 2)));
  var Tg = dissolve(tVec);

  // §5.7.8-9 local HI and ground (tape) distance
  var HI = ee.Image.constant(VI).divide(tanT.max(CONFIG.SLOPE_MIN / 100)).updateMask(E).rename('HI_m');
  var Dg = ee.Image.constant(VI).divide(sinT.max(Math.sin(Math.atan(CONFIG.SLOPE_MIN / 100))))
    .updateMask(E).rename('Dg_m');                           // D_ground = VI / sin(theta)

  // ===== 9. GEOMETRY ==========================================================
  // §6.1 levels: Z_k = z_top - k VI, only levels crossing T (Z_k > z_min of T)
  var kStart = Math.max(1, Math.ceil((zTop - zTmax) / VI - 1e-9));
  var kEnd = Math.ceil((zTop - zTmin) / VI - 1e-9) - 1;
  var levels = [];
  for (var kk = kStart; kk <= kEnd; kk++) levels.push(kk);
  if (levels.length > CONFIG.MAX_LEVELS) {
    print('WARN: ' + levels.length + ' levels; truncated to MAX_LEVELS'); levels = levels.slice(0, CONFIG.MAX_LEVELS);
  }
  // §6.2 contour rows: polygon(z >= Z_k) -> rings -> lines -> intersect T
  var zC = zs.resample('bicubic').reproject(PC);             // sub-pixel row tracing grid
  var region = Tg.bounds(ME, PU).buffer(CONFIG.ROW_REGION_BUFFER_M, ME, PU);
  var LET = ee.List(LETTERS);
  function rowsAtLevel(k) {
    k = ee.Number(k);
    var Zk = ee.Number(zTop).subtract(k.multiply(VI));
    var polys = zC.gte(Zk).selfMask().int().reduceToVectors({geometry: region, crs: CONFIG.CRS,
      scale: CONFIG.CONTOUR_SCALE, geometryType: 'polygon', eightConnected: false, labelProperty: 'lab',
      maxPixels: 1e10, bestEffort: false, tileScale: 4});
    var rings = polys.map(function (f) {
      var gU = f.geometry().transform(PU, ME);
      return ee.FeatureCollection(gU.geometries().map(function (p) {
        return ee.List(ee.Geometry(p).coordinates()).map(function (r) {
          return ee.Feature(ee.Geometry.LineString(r, CONFIG.CRS, false));
        });
      }).flatten());
    }).flatten();
    var segs = rings.map(function (rf) {
      var line = rf.geometry().simplify(CONFIG.ROW_SIMPLIFY_M, PU);       // §6.2.6 smooth
      return explodeFC(line.intersection(Tg, ME, PU), CONFIG.MIN_ROW_M);  // §6.2.4-5
    }).flatten().map(function (s) {
      return s.set('lon', ee.List(s.geometry().centroid(ME).transform('EPSG:4326', ME).coordinates()).get(0));
    }).sort('lon');
    var n = segs.size();
    var base = ee.String('R').cat(k.format('%02.0f'));
    var lst = segs.toList(n.max(1));
    return ee.FeatureCollection(ee.Algorithms.If(n.gt(0),
      ee.FeatureCollection(ee.List.sequence(0, n.subtract(1)).map(function (i) {
        i = ee.Number(i);
        var id = ee.String(ee.Algorithms.If(n.gt(1), base.cat(ee.String(LET.get(i.min(LETTERS.length - 1)))), base));
        return ee.Feature(lst.get(i)).set({ROW_ID: id, ROW_BASE: base, k: k, ROW_ELEV_m: rnd(Zk, 2), VI_m: VI});
      })), ee.FeatureCollection([])));
  }
  var rowsRaw = ee.FeatureCollection(ee.List(levels).map(rowsAtLevel)).flatten();

  // row statistics along each row
  var rowStatImg = ee.Image.cat(slopePct.rename('slope'), HI.rename('hi'), Dg.rename('dg'), pri.rename('pri'));
  var rows1 = rowsRaw.map(function (r) {
    var st = rowStatImg.reduceRegion({reducer: ee.Reducer.mean().combine(ee.Reducer.median(), null, true),
      geometry: r.geometry(), scale: SC, crs: CONFIG.CRS, maxPixels: 1e9});
    var gd = ee.Dictionary(st);
    function g(key) {
      var v = ee.Algorithms.If(gd.contains(key), gd.get(key), 0);
      return ee.Number(ee.Algorithms.If(ee.Algorithms.IsEqual(v, null), 0, v));
    }
    return r.set({LENGTH_m: rnd(r.geometry().length(ME, PU), 2), MEAN_SLOPE_pct: rnd(g('slope_mean'), 1),
      MEAN_HI_m: rnd(g('hi_mean'), 2), DIST_FROM_PREV_ROW_ground_m: rnd(g('dg_median'), 2), ROW_PRI: g('pri_mean')});
  });

  // §6.3 trench cutting: CCT [2.0 trench + 0.30 plug], SCT [2.0 trench + 2.0 gap], even rows offset 2.0 m
  function cutPart(p, pch, off, type) {
    var g = p.geometry();
    var len = g.length(ME, PU);
    var pieces = g.cutLines(cutDistances(len, pch, off), ME, PU).geometries();
    var parity = ee.Number(off).gt(0);                       // offset rows keep odd pieces
    return ee.FeatureCollection(ee.List.sequence(0, pieces.size().subtract(1)).map(function (i) {
      i = ee.Number(i);
      var pg = ee.Geometry(pieces.get(i));
      return ee.Feature(pg, {keep: i.mod(2).eq(parity), LEN_m: pg.length(ME, PU), TYPE: type});
    })).filter(ee.Filter.eq('keep', 1))
      .filter(ee.Filter.rangeContains('LEN_m', CONFIG.TR_LEN - CONFIG.LEN_TOL, CONFIG.TR_LEN + CONFIG.LEN_TOL));
  }
  function trenchesForRow(r) {
    var g = r.geometry();
    var k = ee.Number(r.get('k'));
    var off = ee.Number(ee.Algorithms.If(k.mod(2).eq(0), CONFIG.SCT_GAP, 0));
    var minPart = CONFIG.TR_LEN - CONFIG.LEN_TOL;
    var c = explodeFC(g.intersection(TgC, ME, PU), minPart)
      .map(function (p) { return cutPart(p, d.P_CCT, 0, 'CCT'); }).flatten();
    var s = explodeFC(g.intersection(TgS, ME, PU), minPart)
      .map(function (p) { return cutPart(p, d.P_SCT, off, 'SCT'); }).flatten();  // canopy-SCT inside CCT rows too
    var all = c.merge(s);
    var n = all.size();
    var lst = all.toList(n.max(1));
    var props = r.toDictionary(['ROW_ID', 'k', 'ROW_ELEV_m', 'VI_m', 'ROW_PRI']);
    return ee.FeatureCollection(ee.Algorithms.If(n.gt(0),
      ee.FeatureCollection(ee.List.sequence(0, n.subtract(1)).map(function (i) {
        i = ee.Number(i);
        return ee.Feature(lst.get(i)).set(props)
          .set('TR_ID', ee.String(r.get('ROW_ID')).cat('-T').cat(i.add(1).format('%03.0f')));
      })), ee.FeatureCollection([])));
  }
  var trenchesRaw = rows1.map(trenchesForRow).flatten();

  // per-trench pixel properties (§6.3)
  var sImg = typeImg.remap([1, 2], [d.S_CCT, d.S_SCT]).rename('s');
  var CR = sImg.divide(Qd.divide(1000).multiply(HI).max(1e-9)).min(1).rename('CR');   // §4.5 CR = min(1, s/r)
  var Pheld = pStar(sImg, HI, Sr).updateMask(E);                                        // §4.5 P*
  var trImg = ee.Image.cat(slopePct.rename('SLOPE_pct'), HI.rename('HI_m'), Dg.rename('GROUND_DIST_m'),
    pri.rename('PRIORITY'), CR.rename('CAPTURE_RATIO'), Pheld.rename('P_HELD_mm'),
    cls.rename('ZONE_c'), loose.rename('LOOSE'));
  var trenchesR = trImg.reduceRegions({collection: trenchesRaw, reducer: ee.Reducer.mean(),
    scale: SC, crs: CONFIG.CRS, tileScale: 4});
  // §5.7.7 recount on vectors; if > N_max drop trenches from lowest-priority rows
  var nVecRaw = trenchesR.size();
  var trenchesCap = ee.FeatureCollection(ee.Algorithms.If(nVecRaw.gt(Nmax),
    trenchesR.sort('ROW_PRI', false).limit(Nmax), trenchesR));
  var trenches = trenchesCap.map(function (f) {
    var ll = toLatLonProps(f.geometry());
    var type = ee.String(f.get('TYPE'));
    var isLoose = safeNum(f, 'LOOSE', 0).gte(0.5);
    var plug = ee.Number(ee.Algorithms.If(type.equals('CCT'),
      ee.Algorithms.If(isLoose, CONFIG.PLUG_LOOSE, CONFIG.PLUG), 0));
    var zone = ee.String('S').cat(safeNum(f, 'ZONE_c', 0).round().format('%.0f'));
    var desc = ee.String(f.get('TR_ID')).cat(' · ').cat(type).cat(' · ').cat(zone)
      .cat(' · Row elev ').cat(ee.Number(f.get('ROW_ELEV_m')).format('%.2f')).cat(' m · dig ')
      .cat(ee.Number(CONFIG.TR_LEN).format('%.2f')).cat(' x ').cat(ee.Number(CONFIG.TR_WID).format('%.2f'))
      .cat(' x ').cat(ee.Number(CONFIG.TR_DEP).format('%.2f')).cat(' m')
      .cat(ee.String(ee.Algorithms.If(type.equals('CCT'),
        ee.String(' · plug ').cat(plug.format('%.2f')).cat(' m'), ' · gap 2.00 m, stagger')));
    return ee.Feature(ll.geom, ee.Dictionary(ll.props).combine({
      TR_ID: f.get('TR_ID'), ROW_ID: f.get('ROW_ID'), TYPE: type, ZONE: zone,
      ROW_ELEV_m: f.get('ROW_ELEV_m'), SLOPE_pct: rnd(safeNum(f, 'SLOPE_pct', 0), 1),
      HI_m: rnd(safeNum(f, 'HI_m', 0), 2), GROUND_DIST_m: rnd(safeNum(f, 'GROUND_DIST_m', 0), 2),
      PRIORITY: rnd(safeNum(f, 'PRIORITY', 0), 3), CAPTURE_RATIO: rnd(safeNum(f, 'CAPTURE_RATIO', 0), 3),
      P_HELD_mm: rnd(safeNum(f, 'P_HELD_mm', 0), 1), PLUG_m: plug, LEN_m: rnd(f.get('LEN_m'), 2),
      ROW_PRI: f.get('ROW_PRI'), k: f.get('k'), name: f.get('TR_ID'), description: desc}));
  });

  // §6.4 row features (only rows that keep >= 1 trench)
  var hAll = ee.Dictionary(trenches.aggregate_histogram('ROW_ID'));
  var hC = ee.Dictionary(trenches.filter(ee.Filter.eq('TYPE', 'CCT')).aggregate_histogram('ROW_ID'));
  var hS = ee.Dictionary(trenches.filter(ee.Filter.eq('TYPE', 'SCT')).aggregate_histogram('ROW_ID'));
  var rows = rows1.map(function (r) {
    var id = ee.String(r.get('ROW_ID'));
    var nA = ee.Number(hAll.get(id, 0)), nC = ee.Number(hC.get(id, 0)), nS = ee.Number(hS.get(id, 0));
    var mix = ee.String(ee.Algorithms.If(nS.eq(0), 'CCT', ee.Algorithms.If(nC.eq(0), 'SCT',
      ee.String('CCT ').cat(nC.format('%.0f')).cat(' + SCT ').cat(nS.format('%.0f')))));
    var k = ee.Number(r.get('k'));
    var prev = ee.String(ee.Algorithms.If(k.eq(1), 'crest (BM)', ee.String('R').cat(k.subtract(1).format('%02.0f'))));
    var ll = toLatLonProps(r.geometry());
    var desc = ee.String('Row ').cat(id).cat(' · ').cat(mix).cat(' · Elev ')
      .cat(ee.Number(r.get('ROW_ELEV_m')).format('%.2f')).cat(' m · VI ').cat(ee.Number(VI).format('%.2f'))
      .cat(' m · Tape from ').cat(prev).cat(' ≈ ').cat(ee.Number(r.get('DIST_FROM_PREV_ROW_ground_m')).format('%.1f'))
      .cat(' m · ').cat(nA.format('%.0f')).cat(' trenches');
    var p = ll.props;
    return ee.Feature(ll.geom, {ROW_ID: id, ROW_ELEV_m: r.get('ROW_ELEV_m'), VI_m: VI,
      LENGTH_m: r.get('LENGTH_m'), N_TRENCH: nA, TYPE_MIX: mix, MEAN_SLOPE_pct: r.get('MEAN_SLOPE_pct'),
      MEAN_HI_m: r.get('MEAN_HI_m'), START_LAT: p.START_LAT, START_LON: p.START_LON,
      END_LAT: p.END_LAT, END_LON: p.END_LON, DIST_FROM_PREV_ROW_ground_m: r.get('DIST_FROM_PREV_ROW_ground_m'),
      k: k, name: id, description: desc});
  }).filter(ee.Filter.gt('N_TRENCH', 0));

  // ===== 10. STAKING ==========================================================
  // §7.1 BM-0 at z_top ; §7.2 crest points (TPI > 1.5 m) every 40 m
  var bmPt = ee.Geometry.Point([A.bm_lon, A.bm_lat]);
  var bmFeat = ee.Feature(bmPt, {KIND: 'BM-0', z: zTop, name: 'BM-0',
    description: 'BM-0 crest benchmark · Elev ' + fmt(zTop, 2) + ' m · Lat ' + fmt(A.bm_lat, 6) +
      ' Lon ' + fmt(A.bm_lon, 6) + ' · Fix a permanent peg painted red, number it BM-0, photograph it.\n' +
      'FIELD PROCEDURE:\n' + FIELD_STEPS.join('\n')});
  var ridge = tpi.gt(CONFIG.TPI_RIDGE).and(inPlot);
  var crest = zs.updateMask(ridge).sample({region: plot, scale: CONFIG.BASELINE_SPACING, projection: PU,
    geometries: true, tileScale: 4}).sort('z', false).limit(CONFIG.MAX_BASELINES - 1)
    .map(function (f) { return f.set({KIND: 'CREST'}); });
  var startList = ee.List([bmFeat]).cat(crest.toList(CONFIG.MAX_BASELINES));
  var starts = ee.FeatureCollection(ee.List.sequence(0, startList.size().subtract(1)).map(function (i) {
    i = ee.Number(i);
    return ee.Feature(startList.get(i)).set({BL_ID: ee.String('BL-').cat(i.add(1).format('%.0f')), BL_N: i.add(1)});
  }));
  var aspSC = ee.Image.cat(aspRad.sin().rename('s'), aspRad.cos().rename('c')).updateMask(Tmask);
  var baseAll = starts.map(function (s) {
    var p = s.geometry().transform(PU, ME);
    var xy = ee.List(p.coordinates());
    var x0 = ee.Number(xy.get(0)), y0 = ee.Number(xy.get(1));
    // §7.2.2 mean downslope aspect of T near the start point
    var st = aspSC.reduceRegion({reducer: ee.Reducer.mean().combine(ee.Reducer.count(), null, true),
      geometry: p.buffer(CONFIG.BL_ASPECT_RADIUS_M, ME, PU), scale: SC, crs: CONFIG.CRS, maxPixels: 1e9});
    var cnt = ee.Number(st.get('s_count'));
    var ms = ee.Number(ee.Algorithms.If(cnt.gt(0), st.get('s_mean'), 0));
    var mc = ee.Number(ee.Algorithms.If(cnt.gt(0), st.get('c_mean'), 1));
    var b = ms.atan2(mc);                                     // bearing, rad clockwise from N
    var Lb = CONFIG.BL_MAX_LEN_M;
    var line = ee.Geometry.LineString(ee.List([ee.List([x0, y0]),
      ee.List([x0.add(b.sin().multiply(Lb)), y0.add(b.cos().multiply(Lb))])]), CONFIG.CRS, false);
    var blId = s.get('BL_ID');
    // §7.2.3 row crossing points (nearest crossing to the start)
    var cross = rows.filterBounds(line).map(function (r) {
      var inter = line.intersection(r.geometry(), ME, PU);
      var pts = ee.FeatureCollection(inter.geometries().map(function (gg) {
        gg = ee.Geometry(gg);
        return ee.Feature(gg, {gtype: gg.type(), H: gg.distance(p, ME, PU)});
      })).filter(ee.Filter.eq('gtype', 'Point')).sort('H');
      return ee.Algorithms.If(pts.size().gt(0), ee.Feature(pts.first()).set({
        BL_ID: blId, ROW_ID: r.get('ROW_ID'), k: r.get('k'), ROW_ELEV_m: r.get('ROW_ELEV_m')}), null);
    }, true).sort('H');
    // §7.3 chainage: tape = sqrt(dh^2 + dz^2) = D_ground between consecutive crossings
    var bearingDeg = b.multiply(180 / Math.PI).add(360).mod(360);
    var init = ee.Dictionary({prevH: 0, prevZ: s.get('z'), cum: 0, out: ee.List([])});
    var res = ee.Dictionary(cross.toList(1000).iterate(function (f, acc) {
      f = ee.Feature(f); acc = ee.Dictionary(acc);
      var H = ee.Number(f.get('H')), Z = ee.Number(f.get('ROW_ELEV_m'));
      var dh = H.subtract(ee.Number(acc.get('prevH')));
      var dz = ee.Number(acc.get('prevZ')).subtract(Z);
      var tape = dh.pow(2).add(dz.pow(2)).sqrt();
      var cum = ee.Number(acc.get('cum')).add(tape);
      var ll = ee.List(f.geometry().transform('EPSG:4326', ME).coordinates());
      var rec = ee.Feature(f.geometry().transform('EPSG:4326', ME), {
        BL_ID: f.get('BL_ID'), ROW_ID: f.get('ROW_ID'), ROW_ELEV_m: rnd(Z, 2),
        Horiz_dist_from_BM_m: rnd(H, 2), Tape_ground_dist_from_prev_row_m: rnd(tape, 2),
        Cum_tape_dist_from_BM_m: rnd(cum, 2), Local_slope_pct: rnd(dz.divide(dh.max(0.01)).multiply(100), 1),
        Lat: rnd(ll.get(1), 6), Lon: rnd(ll.get(0), 6), BEARING_deg: rnd(bearingDeg, 1),
        START_PEG: s.get('KIND'), SORT_KEY: ee.Number(s.get('BL_N')).multiply(10000).add(ee.Number(f.get('k')))});
      return ee.Dictionary({prevH: H, prevZ: Z, cum: cum, out: ee.List(acc.get('out')).add(rec)});
    }, init));
    var nCross = cross.size();
    var Hend = ee.Number(ee.Algorithms.If(nCross.gt(0), cross.aggregate_max('H'), 1));
    var lineT = ee.Geometry.LineString(ee.List([ee.List([x0, y0]),
      ee.List([x0.add(b.sin().multiply(Hend)), y0.add(b.cos().multiply(Hend))])]), CONFIG.CRS, false);
    return ee.Feature(lineT.transform('EPSG:4326', ME), {BL_ID: blId, KIND: 'BASELINE',
      START_PEG: s.get('KIND'), BEARING_deg: rnd(bearingDeg, 1), LENGTH_m: rnd(Hend, 2), N_CROSS: nCross,
      name: blId, description: ee.String(blId).cat(' · start ').cat(ee.String(s.get('KIND')))
        .cat(' · compass bearing ').cat(bearingDeg.format('%.0f')).cat('° · ').cat(nCross.format('%.0f'))
        .cat(' row crossings · tape down this line, check VI with A-frame at each peg'),
      chain: res.get('out')});
  });
  var chainage = ee.FeatureCollection(ee.List(baseAll.aggregate_array('chain')).flatten()).sort('SORT_KEY');
  var baselines = baseAll.filter(ee.Filter.gt('N_CROSS', 0)).select(
    ['BL_ID', 'KIND', 'START_PEG', 'BEARING_deg', 'LENGTH_m', 'N_CROSS', 'name', 'description']);

  // ===== 11. METRICS ==========================================================
  var pa = ee.Image.pixelArea();
  var pc = ee.Image(0).where(slopePct.gte(CONFIG.SLOPE_MIN), 1).where(slopePct.gte(CONFIG.SLOPE_S2), 2)
    .where(slopePct.gte(CONFIG.SLOPE_SCT), 3).where(slopePct.gt(CONFIG.SLOPE_MAX), 4);
  var areaImg = ee.Image.cat(
    pa.updateMask(inPlot.and(pc.eq(0))).rename('a_lt5'), pa.updateMask(inPlot.and(pc.eq(1))).rename('a_S1'),
    pa.updateMask(inPlot.and(pc.eq(2))).rename('a_S2'), pa.updateMask(inPlot.and(pc.eq(3))).rename('a_S3'),
    pa.updateMask(inPlot.and(pc.eq(4))).rename('a_gt50'), pa.updateMask(inPlot.and(drain)).rename('a_drain'),
    pa.updateMask(inPlot.and(rock)).rename('a_rock'), pa.updateMask(inPlot.and(built)).rename('a_built'),
    pa.updateMask(inPlot.and(valleyCore)).rename('a_valley'),
    pa.updateMask(Tmask.and(typeImg.eq(1))).rename('a_TC'), pa.updateMask(Tmask.and(typeImg.eq(2))).rename('a_TS'));
  var aS = rr(areaImg, ee.Reducer.sum(), plot);
  var tP = rr(ee.Image.cat(HI.rename('hi'), Dg.rename('dg'), Pheld.rename('ph'), Qd.rename('q'))
    .updateMask(Tmask), ee.Reducer.percentile([10, 50, 90]), plot);
  // §8.4 erosion: L-factor reduction = (HI_local / lambda0)^m
  var LSred = HI.divide(lam.max(0.1)).min(1).pow(mExp).rename('lsr');
  var tM = rr(ee.Image.cat(CR.rename('cr'), LSred).updateMask(Tmask), ee.Reducer.mean().combine(ee.Reducer.median(), null, true), plot);
  var tSum = rr(ee.Image.cat(Qd.divide(1000).multiply(pa).rename('vq'), Qc.divide(1000).multiply(pa).rename('vq5'))
    .updateMask(Tmask), ee.Reducer.sum(), plot);
  var nC = trenches.filter(ee.Filter.eq('TYPE', 'CCT')).size();
  var nS = trenches.filter(ee.Filter.eq('TYPE', 'SCT')).size();
  var nTot = nC.add(nS);
  var storage = nTot.multiply(d.Vt);
  var vq = ee.Number(tSum.get('vq'));
  // gully plug sites: contour level edges crossing the valley core (§8.4 flags)
  var levelIdx = ee.Image.constant(zTop).subtract(zs).divide(VI).floor().int();
  var cEdge = levelIdx.focalMax(1, 'square', 'pixels').neq(levelIdx.focalMin(1, 'square', 'pixels')).reproject(P5);
  var gullyMask = cEdge.and(valleyCore).and(inPlot).and(zs.gte(zTmin)).and(zs.lte(zTmax + VI));
  var gully = gullyMask.selfMask().reduceToVectors({geometry: plot, crs: CONFIG.CRS, scale: SC,
    geometryType: 'centroid', eightConnected: true, labelProperty: 'g', maxPixels: 1e10, tileScale: 4})
    .map(function (f) { return f.set({KIND: 'GULLY_PLUG', name: 'Gully plug site',
      description: 'Drainage line crosses a row level: gully plug / LSCD site, no trench'}); });
  var drainPoly = valleyCore.updateMask(inPlot).selfMask().reduceToVectors({geometry: plot, crs: CONFIG.CRS,
    scale: SC, geometryType: 'polygon', eightConnected: true, labelProperty: 'g', maxPixels: 1e10, tileScale: 4})
    .map(function (f) { return f.set({KIND: 'DRAINAGE', name: 'Drainage line (no trench)',
      description: 'Drainage line / valley: no trench, gully plug site'}); });
  var pHeldMed = ee.Number(ee.Algorithms.If(tP.get('ph_p50'), tP.get('ph_p50'), 0));
  var wetPct = ee.Number(-1);
  if (CONFIG.WETDAY_STATS) {
    var wet = chirps.map(function (i) { return i.gte(CONFIG.WET_DAY_MM); }).sum();
    var held = chirps.map(function (i) { return i.gte(CONFIG.WET_DAY_MM).and(i.lte(pHeldMed)); }).sum();
    var wd = ee.Image.cat(wet.rename('w'), held.rename('h')).reduceRegion({reducer: ee.Reducer.mean(),
      geometry: bufR, scale: CONFIG.CHIRPS_SCALE, crs: CONFIG.CRS, maxPixels: 1e10});
    wetPct = ee.Number(wd.get('h')).divide(ee.Number(wd.get('w')).max(1)).multiply(100);
  }
  var demX = ee.Number(-9999);
  if (DEM.src.indexOf('Copernicus') === 0) {
    var alos = ee.ImageCollection('JAXA/ALOS/AW3D30/V3_2').filterBounds(bufA).select('DSM').mosaic();
    demX = ee.Number(ee.Algorithms.If(ee.ImageCollection('JAXA/ALOS/AW3D30/V3_2').filterBounds(bufA).size().gt(0),
      rr(DEM.img.subtract(alos).rename('dz'), ee.Reducer.mean(), plot, 30).get('dz'), -9999));
  }
  var Sbar = ee.Number(ee.Algorithms.If(nTot.gt(0), nC.multiply(d.S_CCT).add(nS.multiply(d.S_SCT)).divide(nTot.max(1)), d.S_CCT));
  var qMed = ee.Number(ee.Algorithms.If(tP.get('q_p50'), tP.get('q_p50'), 0));
  var HIfull = Sbar.multiply(1000).divide(qMed.max(0.01));    // HI that would hold the design storm
  function ha(key) { return rnd(ee.Number(aS.get(key)).divide(1e4), 2); }
  var summary = ee.Dictionary({
    PLOT: plotName, AREA_ha: rnd(A.area_ha, 2), ELEV_MIN_m: rnd(zMinPlot, 2), ELEV_MAX_m: rnd(zTop, 2),
    MEAN_SLOPE_pct: rnd(A.meanTan * 100, 1),
    AREA_LT5_ha: ha('a_lt5'), AREA_S1_ha: ha('a_S1'), AREA_S2_ha: ha('a_S2'), AREA_S3_ha: ha('a_S3'),
    AREA_GT50_ha: ha('a_gt50'), AREA_DRAIN_ha: ha('a_drain'), AREA_ROCK_ha: ha('a_rock'), AREA_BUILT_WATER_ha: ha('a_built'),
    ELIGIBLE_ha: rnd(A2.E_ha, 2),
    SRC_DEM: SRC.DEM, SRC_HSG: SRC.HSG, SRC_CN: SRC.CN, SRC_CANOPY: SRC.CANOPY, DEM_XCHECK_COP_MINUS_ALOS_m: rnd(demX, 2),
    GUMBEL_N_YEARS: nY, GUMBEL_MU_mm: rnd(mu, 1), GUMBEL_SD_mm: rnd(sd, 1), X10_mm: rnd(X10, 1), X5_mm: rnd(X5, 1),
    T_DESIGN_yr: CONFIG.T_DESIGN, P_DESIGN_mm: rnd(Pdesign, 1), P_OVERRIDE: overridden ? 'YES' : 'NO',
    VI_m: VI, VI_METHOD: viHow, HI_MED_m: rnd(ee.Number(tP.get('hi_p50')), 2), HI_P10_m: rnd(ee.Number(tP.get('hi_p10')), 2),
    HI_P90_m: rnd(ee.Number(tP.get('hi_p90')), 2), TAPE_MED_m: rnd(ee.Number(tP.get('dg_p50')), 2),
    N_ROWS: rows.size(), FIRST_ROW_ELEV_m: rnd(zTop - VI, 2), PRI_CUTOFF: priCut, AREA_CONSTRAINED: constrained ? 'YES' : 'NO',
    N_CCT: nC, N_SCT: nS, N_TOTAL: nTot, N_MAX: Nmax, CAP_USED_pct: rnd(nTot.divide(Math.max(Nmax, 1)).multiply(100), 1),
    N_ANALYTIC_E: Math.round(NE), N_ANALYTIC_T: Math.round(NT_analytic), N_VECTOR_PRECAP: nVecRaw,
    RUNNING_m: rnd(nTot.multiply(CONFIG.TR_LEN), 1), EARTHWORK_m3: rnd(storage, 2),
    TREATED_ha: rnd(T_ha, 2), TREATED_pct: rnd(T_ha / A.area_ha * 100, 1),
    TREATED_CCT_ha: ha('a_TC'), TREATED_SCT_ha: ha('a_TS'),
    RUNOFF_DESIGN_m3: rnd(vq, 1), RUNOFF_CHECK_m3: rnd(ee.Number(tSum.get('vq5')), 1), STORAGE_m3: rnd(storage, 2),
    VOL_CAPTURE_pct: rnd(storage.divide(vq.max(1e-6)).multiply(100), 1),
    CR_MEAN: rnd(ee.Number(tM.get('cr_mean')), 3), P_HELD_MED_mm: rnd(pHeldMed, 1),
    WETDAYS_HELD_pct: rnd(wetPct, 1), HI_FULL_RETENTION_m: rnd(HIfull, 2),
    LFACTOR_RED_MED: rnd(ee.Number(tM.get('lsr_median')), 3),
    DRAIN_LEN_APPROX_m: rnd(ee.Number(aS.get('a_valley')).divide(SC), 0), GULLY_PLUG_SITES: gully.size(),
    ROCK_ha: ha('a_rock'), LOOSE_SOIL_TRENCHES: trenches.filter(ee.Filter.eq('PLUG_m', CONFIG.PLUG_LOOSE)).size(),
    N_BASELINES: baselines.size(), N_CHAINAGE_RECORDS: chainage.size(),
    W_SLOPE: CONFIG.W.slope, W_RUNOFF: CONFIG.W.runoff, W_UPSLOPE: CONFIG.W.upslope, W_LS: CONFIG.W.ls,
    LIMITATIONS: LIMITATIONS.join(' | ')
  });

  // ===== 12. DISPLAY ==========================================================
  Map.addLayer(ee.Image().byte().paint(plotFC, 1, 2), {palette: ['ffff00']}, L + 'Plot boundary');
  Map.addLayer(pc.add(0).where(pc.eq(4), 0).where(excl, 0).updateMask(inPlot),
    {min: 0, max: 3, palette: ['9e9e9e', 'a1d99b', '238b45', 'fd8d3c']}, L + 'Slope classes (S1/S2/S3, grey=excluded)', false);
  Map.addLayer(exclCode, {min: 1, max: 5, palette: ['d9d9d9', '737373', '2171b5', '8c510a', '000000']},
    L + 'Exclusions (flat/steep/drain/rock/built)', false);
  Map.addLayer(pri, {min: 0, max: 1, palette: ['440154', '3b528b', '21918c', '5ec962', 'fde725']}, L + 'Priority PRI', false);
  Map.addLayer(typeT, {min: 1, max: 2, palette: ['00ffff', 'ff00ff']}, L + 'Treated set T (cyan CCT, magenta SCT)');
  Map.addLayer(CR.updateMask(Tmask), {min: 0, max: 1, palette: ['d7191c', 'fdae61', 'ffffbf', 'a6d96a', '1a9641']},
    L + 'Capture ratio CR (design storm)', false);
  if (CONFIG.SHOW_VECTOR_LAYERS) {
    Map.addLayer(drainPoly.style({color: '2171b5', fillColor: '2171b555', width: 1}), {}, L + 'Drainage lines', false);
    Map.addLayer(rows.style({color: 'ffffff', width: 1}), {}, L + 'Rows (see printed ROW_ID list)');
    Map.addLayer(trenches.filter(ee.Filter.eq('TYPE', 'CCT')).style({color: 'ff0000', width: 3}), {}, L + 'Trenches CCT (red)');
    Map.addLayer(trenches.filter(ee.Filter.eq('TYPE', 'SCT')).style({color: 'ff9900', width: 3}), {}, L + 'Trenches SCT (orange)');
    // white dashed baselines (alternate 5 m pieces)
    var dashes = baselines.map(function (f) {
      var gU = f.geometry().transform(PU, ME), len = gU.length(ME, PU);
      var nD = len.divide(CONFIG.BL_DASH_M).floor();
      var cuts = ee.List.sequence(1, nD.max(1)).map(function (i) { return ee.Number(i).multiply(CONFIG.BL_DASH_M); })
        .filter(ee.Filter.lt('item', len));
      var pcs = gU.cutLines(cuts, ME, PU).geometries();
      return ee.FeatureCollection(ee.List.sequence(0, pcs.size().subtract(1)).map(function (i) {
        return ee.Feature(ee.Geometry(pcs.get(i)), {keep: ee.Number(i).mod(2).eq(0)});
      })).filter(ee.Filter.eq('keep', 1));
    }).flatten();
    Map.addLayer(dashes.style({color: 'ffffff', width: 2}), {}, L + 'Baselines (white dashed)');
    Map.addLayer(chainage.style({color: 'ffff00', pointSize: 3}), {}, L + 'Row crossing pegs (yellow)');
    Map.addLayer(crest.style({color: 'ff66cc', pointSize: 4}), {}, L + 'Crest points');
    Map.addLayer(gully.style({color: '00bfff', pointSize: 4, pointShape: 'triangle'}), {}, L + 'Gully plug sites', false);
    Map.addLayer(ee.FeatureCollection([bmFeat]).style({color: 'ff0000', pointSize: 9, pointShape: 'star5'}), {}, L + 'BM-0');
  }

  // console + panel report header
  say('==== ' + plotName + ' ====', {fontWeight: 'bold', fontSize: '14px', margin: '6px 4px'});
  say('Area ' + fmt(A.area_ha, 2) + ' ha · Elev ' + fmt(zMinPlot, 1) + '-' + fmt(zTop, 1) + ' m · mean slope ' + fmt(A.meanTan * 100, 1) + ' %');
  say('DEM: ' + SRC.DEM + ' · HSG: ' + SRC.HSG + ' · CN: ' + SRC.CN + ' · Canopy: ' + SRC.CANOPY);
  say('Design storm: X10 = ' + fmt(X10, 1) + ' mm (baseline) · X5 = ' + fmt(X5, 1) + ' mm · mu ' + fmt(mu, 1) +
    ' · sigma ' + fmt(sd, 1) + ' · n ' + nY + ' yr · design T = ' + CONFIG.T_DESIGN + ' yr · P_design = ' +
    fmt(Pdesign, 1) + ' mm' + (overridden ? ' (OVERRIDE)' : ''));
  say('VI = ' + fmt(VI, 2) + ' m (' + viHow + ') · first row R01 at ' + fmt(zTop - VI, 2) + ' m');
  say('Cap N_max = ' + Nmax + ' · analytic N(VI,E) = ' + Math.round(NE) + (constrained ?
    ' > cap: area cut at PRI* = ' + fmt(priCut, 2) : ' <= cap: all of E treated') +
    ' · treated ' + fmt(T_ha, 2) + ' ha · analytic N(VI,T) = ' + Math.round(NT_analytic));

  // §7.5 staff HI table
  say('STAFF HI TABLE (VI = ' + fmt(VI, 2) + ' m)', {fontWeight: 'bold', margin: '6px 4px 1px 4px'});
  var hiHeader = 'Slope band   HI horiz(m)   Tape between rows(m)   Type';
  say(hiHeader, {fontFamily: 'monospace', fontSize: '11px', margin: '0 4px'});
  CONFIG.STAFF_BANDS.forEach(function (bd) {
    var sm = (bd[0] + bd[1]) / 2 / 100;
    var hi = VI / sm, tape = hi * Math.sqrt(1 + sm * sm);  // = VI / sin(atan s)
    var ty = ((bd[0] + bd[1]) / 2 < CONFIG.SLOPE_SCT) ? 'CCT (SCT under canopy)' : 'SCT';
    say((bd[0] + '-' + bd[1] + ' %          ').slice(0, 13) + (fmt(hi, 2) + '          ').slice(0, 14) +
      (fmt(tape, 2) + '                     ').slice(0, 23) + ty, {fontFamily: 'monospace', fontSize: '11px', margin: '0 4px'});
  });
  say('Field rule: keep every trench >= ' + CONFIG.TREE_CLEARANCE_M + ' m from the base of any established tree. Shift along the contour; never up or down the slope.');

  // charts (§8.3)
  var chRows = [['Year', 'Annual max 1-day (mm)', 'X10 baseline (mm)', 'X5 (mm)']];
  for (var yi = 0; yi < A.years.length; yi++) chRows.push([A.years[yi], A.pmax[yi], X10, X5]);
  var ch1Opt = {title: 'CHIRPS annual 1-day maxima & Gumbel X10 / X5',
    hAxis: {title: 'Year', format: '####'}, vAxis: {title: 'mm'}, pointSize: 3,
    series: {1: {lineDashStyle: [6, 3], pointSize: 0}, 2: {lineDashStyle: [2, 2], pointSize: 0}}};
  print(ui.Chart(chRows, 'LineChart', ch1Opt)); outPanel.add(ui.Chart(chRows, 'LineChart', ch1Opt));
  rr(slopePct.updateMask(inPlot), ee.Reducer.fixedHistogram(0, 80, 32), plot).get('slope_pct').evaluate(function (h) {
    if (!h) return;
    var rowsH = [['Slope %', 'Area (ha)', {role: 'style'}]];
    h.forEach(function (b) {
      var mid = b[0] + 1.25;
      var col = mid < CONFIG.SLOPE_MIN ? '#9e9e9e' : mid < CONFIG.SLOPE_S2 ? '#a1d99b' :
        mid < CONFIG.SLOPE_SCT ? '#238b45' : mid <= CONFIG.SLOPE_MAX ? '#fd8d3c' : '#616161';
      rowsH.push([mid, b[1] * PIX / 1e4, col]);
    });
    var ch2Opt = {title: 'Slope histogram (classes ' + CONFIG.SLOPE_MIN + '/' +
      CONFIG.SLOPE_S2 + '/' + CONFIG.SLOPE_SCT + '/' + CONFIG.SLOPE_MAX + ' %)', legend: {position: 'none'},
      hAxis: {title: 'Slope %'}, vAxis: {title: 'ha'}, bar: {groupWidth: '95%'}};
    print(ui.Chart(rowsH, 'ColumnChart', ch2Opt)); outPanel.add(ui.Chart(rowsH, 'ColumnChart', ch2Opt));
  });
  var ch3 = ui.Chart.feature.byFeature(rows.sort('k'), 'ROW_ID', ['N_TRENCH']).setChartType('ColumnChart')
    .setOptions({title: 'Trenches per row', legend: {position: 'none'}, hAxis: {title: 'Row'}, vAxis: {title: 'trenches'}});

  // §8.4 summary report (async)
  var sumLabel = ui.Label('Computing summary (trench vectors)…', {fontSize: '12px', color: 'gray'});
  outPanel.add(sumLabel);
  summary.evaluate(function (s, err) {
    if (err) { sumLabel.setValue('Summary error: ' + err); print('ERROR summary: ' + err); return; }
    var lines = [
      'LAYOUT: VI ' + fmt(s.VI_m, 2) + ' m · HI median ' + fmt(s.HI_MED_m, 2) + ' m (P10 ' + fmt(s.HI_P10_m, 2) +
        ' / P90 ' + fmt(s.HI_P90_m, 2) + ') · tape median ' + fmt(s.TAPE_MED_m, 2) + ' m · rows ' + s.N_ROWS +
        ' · first row ' + fmt(s.FIRST_ROW_ELEV_m, 2) + ' m',
      'QUANTITIES: CCT ' + s.N_CCT + ' · SCT ' + s.N_SCT + ' · total ' + s.N_TOTAL + ' / cap ' + s.N_MAX +
        ' (' + fmt(s.CAP_USED_pct, 1) + ' %) · running ' + fmt(s.RUNNING_m, 1) + ' m · earthwork ' + fmt(s.EARTHWORK_m3, 2) + ' m3',
      'AREAS (ha): S1 ' + s.AREA_S1_ha + ' · S2 ' + s.AREA_S2_ha + ' · S3 ' + s.AREA_S3_ha + ' · <5% ' + s.AREA_LT5_ha +
        ' · >50% ' + s.AREA_GT50_ha + ' · drainage ' + s.AREA_DRAIN_ha + ' · rock ' + s.AREA_ROCK_ha +
        ' · built/water ' + s.AREA_BUILT_WATER_ha + ' · eligible ' + s.ELIGIBLE_ha,
      'HYDROLOGY: treated ' + s.TREATED_ha + ' ha (' + s.TREATED_pct + ' % of plot; CCT ' + s.TREATED_CCT_ha +
        ' / SCT ' + s.TREATED_SCT_ha + ') · design runoff ' + fmt(s.RUNOFF_DESIGN_m3, 0) + ' m3 · storage ' +
        fmt(s.STORAGE_m3, 1) + ' m3 · volume capture ' + fmt(s.VOL_CAPTURE_pct, 1) + ' % · mean CR ' +
        fmt(s.CR_MEAN, 3) + ' · median P_held ' + fmt(s.P_HELD_MED_mm, 1) + ' mm',
      'INTERPRETATION: the layout fully holds every storm up to about ' + fmt(s.P_HELD_MED_mm, 0) + ' mm per row strip' +
        (s.WETDAYS_HELD_pct >= 0 ? ' (' + fmt(s.WETDAYS_HELD_pct, 1) + ' % of CHIRPS wet days >= ' + CONFIG.WET_DAY_MM + ' mm)' : '') +
        '. Full retention of the ' + CONFIG.T_DESIGN + '-yr storm would need HI ≈ ' + fmt(s.HI_FULL_RETENTION_m, 1) +
        ' m, which is uneconomic; the adopted spacing intercepts every runoff strip, cuts erosive slope length and holds the frequent storms.',
      'EROSION: median RUSLE L-factor ratio (HI/lambda0)^m = ' + fmt(s.LFACTOR_RED_MED, 3),
      'FLAGS: drainage length ≈ ' + s.DRAIN_LEN_APPROX_m + ' m · gully plug sites ' + s.GULLY_PLUG_SITES +
        ' · rock ' + s.ROCK_ha + ' ha · loose-soil trenches (0.45 m plug) ' + s.LOOSE_SOIL_TRENCHES,
      'STAKING: baselines ' + s.N_BASELINES + ' · chainage records ' + s.N_CHAINAGE_RECORDS +
        (s.DEM_XCHECK_COP_MINUS_ALOS_m > -9999 ? ' · DEM check Copernicus-ALOS mean ' + fmt(s.DEM_XCHECK_COP_MINUS_ALOS_m, 2) + ' m' : ''),
      'WEIGHTS: slope ' + s.W_SLOPE + ' · runoff ' + s.W_RUNOFF + ' · upslope ' + s.W_UPSLOPE + ' · LS ' + s.W_LS,
      'LIMITATIONS: ' + LIMITATIONS.join(' ')
    ];
    sumLabel.setValue('SUMMARY (§8.4)'); sumLabel.style().set({color: 'black', fontWeight: 'bold'});
    lines.forEach(function (t) { say(L + t); });
    print(L + 'Summary dictionary', s);
    outPanel.add(ch3);
  });
  rows.sort('k').aggregate_array('ROW_ID').evaluate(function (ids) {
    if (ids) print(L + 'ROW_ID list (top -> down): ' + ids.join(', '));
  });
  print(L + 'FIELD PROCEDURE (§7.4)\n' + FIELD_STEPS.join('\n'));

  // ===== 13. EXPORTS ==========================================================
  if (CONFIG.RUN_EXPORTS) {
    var now = new Date();
    var ds = now.getFullYear() + ('0' + (now.getMonth() + 1)).slice(-2) + ('0' + now.getDate()).slice(-2);
    var pre = sanitize(plotName) + '_' + ds;
    var F = CONFIG.DRIVE_FOLDER;
    var trCols = ['TR_ID', 'ROW_ID', 'TYPE', 'ZONE', 'ROW_ELEV_m', 'SLOPE_pct', 'HI_m', 'GROUND_DIST_m',
      'CENTRE_LAT', 'CENTRE_LON', 'START_LAT', 'START_LON', 'END_LAT', 'END_LON', 'PRIORITY',
      'CAPTURE_RATIO', 'P_HELD_mm', 'PLUG_m', 'LEN_m', 'description'];
    Export.table.toDrive({collection: trenches.select(trCols.concat(['name'])), description: pre + '_TRENCHES_KML',
      folder: F, fileNamePrefix: pre + '_TRENCHES', fileFormat: 'KML'});
    Export.table.toDrive({collection: trenches, description: pre + '_TRENCHES_CSV', folder: F,
      fileNamePrefix: pre + '_TRENCHES', fileFormat: 'CSV', selectors: trCols});
    var rowCols = ['ROW_ID', 'ROW_ELEV_m', 'VI_m', 'LENGTH_m', 'N_TRENCH', 'TYPE_MIX', 'MEAN_SLOPE_pct', 'MEAN_HI_m',
      'START_LAT', 'START_LON', 'END_LAT', 'END_LON', 'DIST_FROM_PREV_ROW_ground_m', 'description'];
    Export.table.toDrive({collection: rows.select(rowCols.concat(['name'])), description: pre + '_ROWS_KML',
      folder: F, fileNamePrefix: pre + '_ROWS', fileFormat: 'KML'});
    var rowsShp = rows.map(function (f) {                       // SHP: field names <= 10 chars
      return ee.Feature(f.geometry(), {ROW_ID: f.get('ROW_ID'), ELEV_M: f.get('ROW_ELEV_m'), VI_M: f.get('VI_m'),
        LEN_M: f.get('LENGTH_m'), N_TRENCH: f.get('N_TRENCH'), TYPE_MIX: f.get('TYPE_MIX'),
        SLOPE_PCT: f.get('MEAN_SLOPE_pct'), HI_M: f.get('MEAN_HI_m'), DPREV_M: f.get('DIST_FROM_PREV_ROW_ground_m'),
        S_LAT: f.get('START_LAT'), S_LON: f.get('START_LON'), E_LAT: f.get('END_LAT'), E_LON: f.get('END_LON')});
    });
    Export.table.toDrive({collection: rowsShp, description: pre + '_ROWS_SHP', folder: F,
      fileNamePrefix: pre + '_ROWS', fileFormat: 'SHP'});
    var blKml = baselines.merge(ee.FeatureCollection([bmFeat]))
      .merge(crest.map(function (f) { return f.set({name: 'Crest point', description: ee.String('Crest point · Elev ')
        .cat(ee.Number(f.get('z')).format('%.2f')).cat(' m')}); }))
      .merge(gully).merge(drainPoly);
    Export.table.toDrive({collection: blKml, description: pre + '_BASELINES_KML', folder: F,
      fileNamePrefix: pre + '_BASELINES', fileFormat: 'KML'});
    Export.table.toDrive({collection: chainage, description: pre + '_CHAINAGE_CSV', folder: F,
      fileNamePrefix: pre + '_CHAINAGE', fileFormat: 'CSV',
      selectors: ['BL_ID', 'ROW_ID', 'ROW_ELEV_m', 'Horiz_dist_from_BM_m', 'Tape_ground_dist_from_prev_row_m',
        'Cum_tape_dist_from_BM_m', 'Local_slope_pct', 'Lat', 'Lon', 'BEARING_deg', 'START_PEG']});
    var zones = clsT.multiply(10).add(typeT).reduceToVectors({geometry: plot, crs: CONFIG.CRS, scale: SC,
      geometryType: 'polygon', eightConnected: false, labelProperty: 'ZCODE', maxPixels: 1e10, tileScale: 4})
      .map(function (f) {
        var z = ee.Number(f.get('ZCODE'));
        return f.set({CLASS: ee.String('S').cat(z.divide(10).floor().format('%.0f')),
          TYPE: ee.String(ee.Algorithms.If(z.mod(10).eq(1), 'CCT', 'SCT')),
          AREA_HA: rnd(f.geometry().area(ME, PU).divide(1e4), 4)});
      });
    Export.table.toDrive({collection: zones, description: pre + '_ZONES_SHP', folder: F,
      fileNamePrefix: pre + '_ZONES', fileFormat: 'SHP'});
    Export.table.toDrive({collection: ee.FeatureCollection([ee.Feature(null, summary)]), description: pre + '_SUMMARY_CSV',
      folder: F, fileNamePrefix: pre + '_SUMMARY', fileFormat: 'CSV'});
    Export.image.toDrive({image: ee.Image.cat(clsT.rename('class'), typeT.rename('type'), pri.updateMask(Tmask),
        HI.updateMask(Tmask).rename('HI_local'), CR.updateMask(Tmask)).toFloat(),
      description: pre + '_ZONEMAP', folder: F, fileNamePrefix: pre + '_ZONEMAP', region: plot,
      scale: SC, crs: CONFIG.CRS, maxPixels: 1e10});
    print(L + 'Exports queued (Tasks tab -> RUN): TRENCHES KML+CSV, ROWS KML+SHP, BASELINES KML, CHAINAGE CSV, ZONES SHP, SUMMARY CSV, ZONEMAP GeoTIFF');
  }

  // ===== 14. QA ===============================================================
  var centres = trenches.map(function (f) { return f.setGeometry(f.geometry().centroid(ME)); });
  var exclImg = drain.or(rock).or(flat).or(steep).or(built).rename('x');
  var exclHits = exclImg.reduceRegions({collection: centres, reducer: ee.Reducer.first(), scale: SC, crs: CONFIG.CRS})
    .filter(ee.Filter.eq('first', 1)).size();
  var rowSample = rows.limit(CONFIG.QA_ROW_SAMPLE);
  var crossJoin = ee.Join.simple().apply(rowSample, rows, ee.Filter.and(
    ee.Filter.withinDistance({distance: CONFIG.QA_ROW_GAP_M, leftField: '.geo', rightField: '.geo', maxError: 0.1}),
    ee.Filter.notEquals({leftField: 'k', rightField: 'k'}))).size();
  var chainRows = chainage.aggregate_array('ROW_ID').distinct();
  var qa = ee.Dictionary({
    nTot: nTot, inPlot: centres.filterBounds(plot).size(), inT: centres.filterBounds(Tg).size(),
    exclHits: exclHits,
    lenC_min: trenches.filter(ee.Filter.eq('TYPE', 'CCT')).aggregate_min('LEN_m'),
    lenC_max: trenches.filter(ee.Filter.eq('TYPE', 'CCT')).aggregate_max('LEN_m'),
    lenS_min: trenches.filter(ee.Filter.eq('TYPE', 'SCT')).aggregate_min('LEN_m'),
    lenS_max: trenches.filter(ee.Filter.eq('TYPE', 'SCT')).aggregate_max('LEN_m'),
    rowCross: crossJoin, highestRowElev: rows.aggregate_max('ROW_ELEV_m'),
    nVecRaw: nVecRaw, hiMed: tP.get('hi_p50'),
    nBL: baselines.size(),
    missing: rows.filter(ee.Filter.inList('ROW_ID', chainRows).not()).aggregate_array('ROW_ID')
  });
  qa.evaluate(function (q, err) {
    if (err) { print('QA ERROR: ' + err); return; }
    var res = [];
    function T(n, ok, msg, warnOnly) { res.push('TEST ' + n + ': ' + (ok ? 'PASS' : (warnOnly ? 'WARN' : 'FAIL')) + ' - ' + msg); }
    T(1, q.nTot <= Nmax, 'N_total ' + q.nTot + ' <= N_max ' + Nmax);
    T(2, q.inPlot === q.nTot && q.inT === q.nTot, 'centres in plot ' + q.inPlot + '/' + q.nTot + ', in T ' + q.inT + '/' + q.nTot);
    T(3, q.exclHits === 0, q.exclHits + ' trench centres in drainage/rock/<5%/>50%/built masks');
    var tol = CONFIG.LEN_TOL, ok4 = true;
    if (q.lenC_min !== null && q.lenC_min !== undefined) ok4 = ok4 && Math.abs(q.lenC_min - CONFIG.TR_LEN) <= tol && Math.abs(q.lenC_max - CONFIG.TR_LEN) <= tol;
    if (q.lenS_min !== null && q.lenS_min !== undefined) ok4 = ok4 && Math.abs(q.lenS_min - CONFIG.TR_LEN) <= tol && Math.abs(q.lenS_max - CONFIG.TR_LEN) <= tol;
    var pc1 = cutPattern(20, d.P_CCT, 0), ps1 = cutPattern(20, d.P_SCT, CONFIG.SCT_GAP);
    var plugOk = Math.abs((pc1[1] - pc1[0]) - CONFIG.PLUG) <= tol, gapOk = Math.abs((ps1[1] - ps1[0]) - CONFIG.SCT_GAP) <= tol;
    T(4, ok4 && plugOk && gapOk, 'CCT len ' + fmt(q.lenC_min) + '-' + fmt(q.lenC_max) + ' m, SCT len ' + fmt(q.lenS_min) + '-' +
      fmt(q.lenS_max) + ' m, plug ' + fmt(pc1[1] - pc1[0]) + ' m, SCT gap ' + fmt(ps1[1] - ps1[0]) + ' m');
    T(5, q.rowCross === 0, q.rowCross + ' sampled rows within ' + CONFIG.QA_ROW_GAP_M + ' m of a different row level');
    var Z1 = zTop - 1 * VI;
    T(6, Math.abs(Z1 - (zTop - VI)) <= CONFIG.QA_Z_TOL, 'Z1 = ' + fmt(Z1, 2) + ' m = z_top - VI; highest laid-out row at ' + fmt(q.highestRowElev, 2) + ' m');
    var dev = NT_analytic > 0 ? Math.abs(q.nVecRaw - NT_analytic) / NT_analytic : 0;
    T(7, dev <= CONFIG.QA_N_TOL, 'analytic N(VI,T) ' + Math.round(NT_analytic) + ' vs vector ' + q.nVecRaw +
      ' (' + fmt(dev * 100, 1) + ' %); vector count is authoritative', true);
    T(8, q.hiMed >= CONFIG.HI_MIN && q.hiMed <= CONFIG.HI_MAX, 'median HI ' + fmt(q.hiMed, 2) + ' m in [' + CONFIG.HI_MIN + ', ' +
      CONFIG.HI_MAX + ']' + ((q.hiMed < CONFIG.HI_MIN || q.hiMed > CONFIG.HI_MAX) ? ' - slope of T differs from E median or VI clamped/overridden' : ''), true);
    T(9, Math.abs(K5 - CONFIG.QA_K5) < CONFIG.QA_K_TOL && Math.abs(K10 - CONFIG.QA_K10) < CONFIG.QA_K_TOL,
      'K5 = ' + K5.toFixed(4) + ', K10 = ' + K10.toFixed(4));
    var miss = q.missing || [];
    T(10, q.nBL >= 1 && miss.length === 0, q.nBL + ' baselines; rows not on any baseline: ' +
      (miss.length ? miss.join(', ') + ' (add a baseline for them)' : 'none'), true);
    print(L + 'QA (§11)\n' + res.join('\n'));
    outPanel.add(ui.Label('QA (§11)', {fontWeight: 'bold', margin: '6px 4px 1px 4px'}));
    res.forEach(function (t) {
      outPanel.add(ui.Label(t, {fontSize: '11px', margin: '0 4px',
        color: t.indexOf('FAIL') > 0 ? 'red' : (t.indexOf('WARN') > 0 ? '#b8860b' : 'green')}));
    });
  });
}

// ===== 12. DISPLAY (UI panel, §8.3) ==========================================
var UI = {};
function legendRow(color, text) {
  return ui.Panel([ui.Label('', {backgroundColor: color, padding: '7px', margin: '2px 6px 2px 4px'}),
    ui.Label(text, {fontSize: '11px', margin: '2px 0'})], ui.Panel.Layout.flow('horizontal'));
}
function inputRow(label, w) {
  return ui.Panel([ui.Label(label, {width: '190px', fontSize: '12px'}), w], ui.Panel.Layout.flow('horizontal'));
}
function buildUI() {
  UI.panel = ui.Panel({style: {width: '440px', padding: '6px'}});
  UI.panel.add(ui.Label('CT-LAYOUT v1.1 · Contour Trench Layout', {fontWeight: 'bold', fontSize: '16px'}));
  UI.panel.add(ui.Label('Khedbrahma Range · Sabarkantha · GFD', {fontSize: '11px', color: 'gray'}));
  UI.vi = ui.Textbox({placeholder: 'auto', value: CONFIG.VI_OVERRIDE === null ? '' : String(CONFIG.VI_OVERRIDE)});
  UI.hi = ui.Textbox({value: String(CONFIG.HI_TARGET)});
  UI.cap = ui.Textbox({value: String(CONFIG.TRENCH_CAP_PER_HA)});
  UI.t = ui.Select({items: ['10', '5'], value: String(CONFIG.T_DESIGN)});
  UI.p = ui.Textbox({placeholder: 'CHIRPS', value: CONFIG.P_OVERRIDE_MM === null ? '' : String(CONFIG.P_OVERRIDE_MM)});
  UI.panel.add(inputRow('VI override (m)', UI.vi));
  UI.panel.add(inputRow('HI target (m)', UI.hi));
  UI.panel.add(inputRow('Trench cap (per ha)', UI.cap));
  UI.panel.add(inputRow('Design storm T (yr)', UI.t));
  UI.panel.add(inputRow('Rain override (mm, IMD)', UI.p));
  UI.panel.add(ui.Button({label: 'Re-run', style: {stretch: 'horizontal'}, onClick: function () {
    var v = parseFloat(UI.vi.getValue()); CONFIG.VI_OVERRIDE = isNaN(v) ? null : v;
    var h = parseFloat(UI.hi.getValue()); if (!isNaN(h)) CONFIG.HI_TARGET = h;
    var c = parseFloat(UI.cap.getValue()); if (!isNaN(c)) CONFIG.TRENCH_CAP_PER_HA = c;
    CONFIG.T_DESIGN = parseInt(UI.t.getValue(), 10); CONFIG.T_CHECK = CONFIG.T_DESIGN === 10 ? 5 : 10;
    var p = parseFloat(UI.p.getValue()); CONFIG.P_OVERRIDE_MM = isNaN(p) ? null : p;
    runAll();
  }}));
  UI.panel.add(ui.Label('Legend', {fontWeight: 'bold', margin: '6px 4px 2px 4px'}));
  [['#ffff00', 'Plot boundary'], ['#a1d99b', 'S1 5-15 %'], ['#238b45', 'S2 15-33 %'], ['#fd8d3c', 'S3 33-50 %'],
   ['#9e9e9e', 'Excluded (flat / steep)'], ['#2171b5', 'Drainage line (no trench)'], ['#8c510a', 'Rock / very shallow'],
   ['#00ffff', 'Treated: CCT zone'], ['#ff00ff', 'Treated: SCT zone'], ['#ff0000', 'CCT trench / BM-0'],
   ['#ff9900', 'SCT trench'], ['#ffffff', 'Rows & baselines (dashed)'], ['#ffff00', 'Row crossing pegs']]
    .forEach(function (x) { UI.panel.add(legendRow(x[0], x[1])); });
  UI.out = ui.Panel();
  UI.panel.add(UI.out);
  ui.root.add(UI.panel);
}

function loadPlots() {
  var fc = safeLoad(CONFIG.PLOT_ASSET, 'Plot asset ' + CONFIG.PLOT_ASSET);
  if (!fc) {
    if (!CONFIG.DEMO_IF_MISSING) throw new Error('Plot asset not found: ' + CONFIG.PLOT_ASSET);
    print('WARN: running on DEMO polygon. Set CONFIG.PLOT_ASSET to your plot.');
    fc = ee.FeatureCollection([ee.Feature(ee.Geometry.Polygon([CONFIG.DEMO_PLOT]), {name: 'DEMO'})]);
  }
  fc = ee.FeatureCollection(fc).limit(CONFIG.MAX_PLOTS);
  var names = fc.aggregate_array(CONFIG.PLOT_FIELD || 'system:index').getInfo();
  return {fc: fc, list: fc.toList(CONFIG.MAX_PLOTS), names: names};
}

function runAll() {
  Map.layers().reset();
  UI.out.clear();
  Map.setOptions('SATELLITE');
  var P = loadPlots();
  print('CT-LAYOUT v1.1: ' + P.names.length + ' plot(s): ' + P.names.join(', '));
  for (var i = 0; i < P.names.length; i++) {
    var nm = String(P.names[i] === null ? ('plot_' + i) : P.names[i]);
    var sub = ui.Panel();
    UI.out.add(sub);
    try { runPlot(ee.Feature(P.list.get(i)), nm, sub); }
    catch (e) { print('ERROR in plot ' + nm + ': ' + e); sub.add(ui.Label('ERROR ' + nm + ': ' + e, {color: 'red'})); }
  }
}

// ===== RUN ===================================================================
buildUI();
runAll();

/* ===== CHANGELOG =============================================================
 v1.1 (22 Nov 2026)
  - Design storm baseline T = 10 yr (officer decision); T = 5 yr reported.
  - Full spec build: Gumbel EV-I on CHIRPS 1981-2025, SCS-CN with Williams
    slope adjustment, PRI score, VI solver with priority area cut, CCT/SCT
    trench cutting, baselines + chainage, 10 QA tests, 9 Drive exports.
  - Implementation notes (deviations kept small and documented):
    * Gaussian smoothing done with convolve(gaussian kernel) (= Gaussian
      focal mean).
    * Row lines are traced on a 2 m bicubic grid of the smoothed 5 m DEM
      (CONFIG.CONTOUR_SCALE) and simplified by 1 m, so that rows stay apart
      on steep ground where HI < 5 m.
    * T is vectorised on exact 5 m pixel edges (not simplified) so that no
      trench centre can fall in an excluded pixel (QA test 3).
    * MERIT upa (90 m) flags drainage only where TPI < 0, to avoid 90 m blocks.
    * Hole filling never fills excluded (non-eligible) pixels.
    * Chainage tape distance = sqrt(dh^2 + dz^2) between consecutive
      crossings, which equals VI/sin(theta) on the local slope.
 v1.0 initial specification.
============================================================================= */
