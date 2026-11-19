/* ######################################################################
 *  PPI-SK v2.1 — Plantation Priority Index, Khedbrahma Range
 *  ALL-IN-ONE Google Earth Engine script (Code Editor)
 *  ----------------------------------------------------------------------
 *  HOW TO USE — paste this whole file once, then just press RUN:
 *
 *    Press Run -> the script detects which results already exist and
 *    runs the NEXT step automatically. It prints "STEP n" in the Console.
 *    Then open the Tasks tab, click RUN on every task, and wait for the
 *    tasks to finish (blue -> done). Then press Run again.
 *
 *      STEP 1  State anchors (Gujarat)          -> once only, a few hours
 *      STEP 2  Range layers + raw block table   -> once per range
 *      STEP 3  Scoring, Monte Carlo, QC log     -> whenever weights change
 *      STEP 4  Final maps + legend on screen, GeoTIFF/SHP/field list
 *      STEP 5  Validation report (optional: set STEP = 5)
 *
 *  Do NOT press Run again while tasks of the current step are still
 *  running — wait until they are finished.
 *  To force a step (e.g. re-score after changing weights) set STEP below.
 * ###################################################################### */

var STEP = 'AUTO';                 // 'AUTO' or 1, 2, 3, 4, 5

var SETTINGS = {
  // ---- your range ----
  AOI_ASSET: 'projects/khedbrahma-range/assets/khedbrahma',
  RANGE_NAME: 'Khedbrahma',
  ID_PREFIX: 'KB_',
  CRS: 'EPSG:32643',               // UTM 43N for Khedbrahma (FF-02 checks it and tells you if wrong)
  STATE_CRS: 'EPSG:32642',         // anchor grid: UTM zone of the Gujarat centroid
  BEAT_FIELD: 'AUTO',              // 'AUTO', an exact field name, or null (-> 'RANGE')

  // ---- where results are saved ----
  ASSET_ROOT: 'projects/khedbrahma-range/assets/',
  DRIVE_FOLDER: 'PPI_SK_v21',

  // ---- state anchors ----
  COUNTRY: 'India',
  STATE: 'Gujarat',
  ANCHOR_ID: 'GJ_2026-11_v2.1',
  // 'ASSET' = use anchors from STEP 1 (final, recommended)
  // 'LIVE'  = skip STEP 1 and use provisional anchors at 500 m (quick demo; QC FF-09 = WARN)
  ANCHOR_MODE: 'LIVE',             // QUICK DEMO MODE. For the final DPR set 'ASSET'.
  LIVE_ANCHOR_SCALE: 500,

  // ---- processing switches (QC remedies) ----
  CS_THRESHOLD: 0.60,              // FF-18 remedy: 0.50
  D2_MONTHS: [9, 11],              // FF-19 remedy: [9, 12]
  A3_MASK_TREES: false,            // FF-11 remedy: true
  TILE_SCALE: 4,                   // memory error -> 8 or 16

  // ---- weights (Section 7, total 100) ----
  WEIGHTS: {
    A1: 10, A2: 3, A3: 9, A5: 4,
    B1: 5, B2: 4, B3: 3, B4: 2, B5: 2, B6: 4, B7: 4,
    C1s: 5, C2s: 5, C3s: 2,
    D1: 6, D2: 5, D3: 3, D4: 3, D5: 3, D6: 4,
    E1: 5, E2: 4, E4: 5
  },
  RX: {FIRE_E1: 0.55, SMC_A: 0.35, SMC_B: 0.35, INVASIVE_D5: 0.30}
};

/* ---- asset names (derived; no need to edit) ---- */
var ASSETS = {
  ANCHORS: SETTINGS.ASSET_ROOT + 'PPI_SK_v21_anchors_' + SETTINGS.STATE.replace(/\W/g, ''),
  RAW: SETTINGS.ASSET_ROOT + 'PPI_SK_v21_raw_blocks_' + SETTINGS.RANGE_NAME,
  QC01: SETTINGS.ASSET_ROOT + 'PPI_SK_v21_qc01_' + SETTINGS.RANGE_NAME,
  FINAL: SETTINGS.ASSET_ROOT + 'PPI_SK_v21_final_blocks_' + SETTINGS.RANGE_NAME
};

// FROZEN-constant anchor mode is not needed in the all-in-one file (anchors are read from the asset).
var ANCHORS = {id: 'NOT_SET'};

/* ======================================================================
 *  PPI-SK v2.1 — SHARED LAYER LIBRARY
 *  ----------------------------------------------------------------------
 *  This block is IDENTICAL in 00_state_anchors and 01_range_layers.
 *  State anchors are only valid if the parameter images are built by
 *  exactly the same code, so never edit one copy without the other.
 * ====================================================================== */

var LIB = {};

/* ---------- Section 5: master dataset register (22 datasets) ---------- */
LIB.A = {
  FABDEM:      'projects/sat-io/open-datasets/FABDEM',                         // D01
  GLO30:       'COPERNICUS/DEM/GLO30',                                         // D02
  MERIT:       'MERIT/Hydro/v1_0_1',                                           // D03
  CTI:         'projects/sat-io/open-datasets/HYDROGRAPHY90/flow_index/cti',   // D04
  CHIRPS:      'UCSB-CHG/CHIRPS/DAILY',                                        // D05
  MOD16:       'MODIS/061/MOD16A2GF',                                          // D06
  S2:          'COPERNICUS/S2_SR_HARMONIZED',                                  // D07
  CSP:         'GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED',                     // D08
  L8:          'LANDSAT/LC08/C02/T1_L2',                                       // D09
  L9:          'LANDSAT/LC09/C02/T1_L2',                                       // D09
  GSW:         'JRC/GSW1_4/GlobalSurfaceWater',                                // D10
  SOIL:        'projects/soilgrids-isric/',                                    // D11
  CHM:         'projects/sat-io/open-datasets/facebook/meta-canopy-height',    // D12
  HANSEN:      'UMD/hansen/global_forest_change_2025_v1_13',                   // D13
  DW:          'GOOGLE/DYNAMICWORLD/V1',                                       // D14
  WC:          'ESA/WorldCover/v200',                                          // D15
  AGB:         'ESA/CCI/Above_Ground_Biomass/V6_0',                            // D16
  MCD64:       'MODIS/061/MCD64A1',                                            // D17
  VIIRS_ARCH:  'projects/sat-io/open-datasets/VIIRS/VNP14IMGTDL_NRT_',         // D18a + YYYY
  VIIRS_LANCE: 'NASA/LANCE/SNPP_VIIRS/C2',                                     // D18b
  GHSL:        'JRC/GHSL/P2023A/GHS_POP',                                      // D19
  WDPA:        'WCMC/WDPA/current/polygons',                                   // D20
  GRIP_SEA:    'projects/sat-io/open-datasets/GRIP4/South-East-Asia',          // D21
  GRIP_MECA:   'projects/sat-io/open-datasets/GRIP4/Middle-East-Central-Asia', // D21
  GAUL1:       'FAO/GAUL/2015/level1',                                         // D22
  SOILWV:      'ISRIC/SoilGrids250m/v2_0/',                                    // D23 (v2.2) wv0033, wv1500
  L5:          'LANDSAT/LT05/C02/T1_L2',                                       // D24 (v2.2)
  L7:          'LANDSAT/LE07/C02/T1_L2'                                        // D24 (v2.2)
};

LIB.FIRE_YEARS = [2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
LIB.FIRE_SOURCE_GAP = 'VIIRS 375 m not available 2022-01-01 to 2023-09-02; ' +
                      'MODIS MCD64A1 500 m burned area only for 2022-Aug 2023';

/* UTM zone from a geometry centroid (Rule 2). Server-side ee.String 'EPSG:326zz'.
   (Checked asynchronously against the configured CRS — no blocking getInfo.) */
LIB.utmCrs = function (geom) {
  var lon = ee.Number(ee.Geometry(geom).centroid(100).coordinates().get(0));
  var zone = lon.add(180).divide(6).floor().add(1);
  return ee.String('EPSG:326').cat(zone.format('%02d'));
};

/* evaluate() with up to 2 retries (Earth Engine sometimes refuses a request transiently). */
LIB.evalRetry = function (obj, cb, attempt) {
  // Retries are scheduled 2 s later, outside Earth Engine's reply handler (retrying inside it
  // crashes the Code Editor with "Cannot read properties of null (reading 'headerMap')").
  attempt = attempt || 1;
  var answered = false;          // the Code Editor can call a callback twice after an error
  obj.evaluate(function (val, err) {
    if (answered) { return; }
    answered = true;
    if (err && attempt < 3) {
      print('Request failed (' + err + ') - retrying (' + (attempt + 1) + '/3) ...');
      ui.util.setTimeout(function () { LIB.evalRetry(obj, cb, attempt + 1); }, 2000);
      return;
    }
    cb(val, err);
  });
};

/* Mosaic rule: mosaic() drops the native projection — always restore it. */
LIB.mosaicNative = function (col) {
  col = ee.ImageCollection(col);
  return col.mosaic().setDefaultProjection(ee.Image(col.first()).projection());
};

/* Max-composite that never fails on an empty collection. */
LIB.safeMax = function (col, band, fallback) {
  col = ee.ImageCollection(col).select(band);
  return ee.Image(ee.Algorithms.If(col.size().gt(0), col.max(),
                                   ee.Image.constant(fallback).rename(band)));
};

/* ---------- DEM selection (FABDEM, else GLO-30 — logged in dem_source) ---------- */
LIB.dem = function (region) {
  // Decided on the server (no blocking request): FABDEM if it covers the region, else GLO-30.
  var fab = ee.ImageCollection(LIB.A.FABDEM).filterBounds(region);
  var glo = ee.ImageCollection(LIB.A.GLO30).filterBounds(region);
  var hasFab = fab.size().gt(0);
  var img = ee.Image(ee.Algorithms.If(hasFab,
    LIB.mosaicNative(fab).select([0]).rename('elev'),
    LIB.mosaicNative(glo).select('DEM').rename('elev')));
  return {img: img, source: ee.String(ee.Algorithms.If(hasFab, 'FABDEM_v1-2', 'GLO30_fallback'))};
};

/* ---------- Sentinel-2 + Cloud Score+ ---------- */
LIB.s2 = function (region, start, end, csThr) {
  var csp = ee.ImageCollection(LIB.A.CSP);
  return ee.ImageCollection(LIB.A.S2)
    .filterBounds(region)
    .filterDate(start, end)
    .linkCollection(csp, ['cs_cdf'])
    .map(function (img) {
      var clear = img.select('cs_cdf').gte(csThr);
      var sr = img.select(['B3', 'B4', 'B8', 'B11', 'B12']).multiply(0.0001);
      var ndvi = sr.normalizedDifference(['B8', 'B4']).rename('NDVI');
      var ndmi = sr.normalizedDifference(['B8', 'B11']).rename('NDMI');
      return ee.Image(ndvi.addBands(ndmi).updateMask(clear)
        .copyProperties(img, ['system:time_start']));
    });
};

/* ---------- Landsat 8/9 C2 L2 NDVI, clear pixels from QA_PIXEL ---------- */
LIB.landsatNDVI = function (region, start, end) {
  return ee.ImageCollection(LIB.A.L8).merge(ee.ImageCollection(LIB.A.L9))
    .filterBounds(region)
    .filterDate(start, end)
    .map(function (img) {
      // bits 0 fill, 1 dilated cloud, 2 cirrus, 3 cloud, 4 shadow, 5 snow -> all must be 0
      var clear = img.select('QA_PIXEL').bitwiseAnd(63).eq(0);
      var sr = img.select(['SR_B4', 'SR_B5']).multiply(0.0000275).add(-0.2);
      return ee.Image(sr.normalizedDifference(['SR_B5', 'SR_B4']).rename('NDVI')
        .updateMask(clear).copyProperties(img, ['system:time_start']));
    });
};

/* ---------- SoilGrids 0-30 cm thickness-weighted mean, converted units ---------- */
LIB.soil = function (prop) {
  var img = ee.Image(LIB.A.SOIL + prop + '_mean');
  var v = img.select(prop + '_0-5cm_mean').multiply(5)
    .add(img.select(prop + '_5-15cm_mean').multiply(10))
    .add(img.select(prop + '_15-30cm_mean').multiply(15))
    .divide(30).divide(10);
  return v.rename(prop);
};

/* ---------- Fixed-normalisation helpers (Section 8.2) ---------- */
LIB.norm = function (img, ANCH, key, invert) {
  var lo = ee.Number(ANCH.get(key + '_p2'));
  var hi = ee.Number(ANCH.get(key + '_p98'));
  var n = img.subtract(lo).divide(hi.subtract(lo).max(1e-9)).clamp(0, 1);
  return invert ? ee.Image(1).subtract(n) : n;
};

LIB.piecewise = function (img, xs, ys) {
  var out = ee.Image.constant(ys[0]).where(img.gte(xs[xs.length - 1]), ys[ys.length - 1]);
  for (var i = 0; i < xs.length - 1; i++) {
    var seg = img.subtract(xs[i]).multiply((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i])).add(ys[i]);
    out = out.where(img.gte(xs[i]).and(img.lt(xs[i + 1])), seg);
  }
  return out.updateMask(img.mask());
};

/* ======================================================================
 *  LIB.layers — all RAW parameter images (unscored), on the working CRS.
 *  region : ee.Geometry (range AOI, or the state for Module 0)
 *  crs    : 'EPSG:326zz'
 *  opt    : {csThr, d2Months:[m1,m2], a3MaskTrees, demInfo}
 * ====================================================================== */
LIB.layers = function (region, crs, opt) {
  var A = LIB.A, R = {};
  region = ee.Geometry(region);
  var g30 = {crs: crs, scale: 30};
  var g10 = {crs: crs, scale: 10};
  var regionBuf = region.buffer(5000, 100);

  /* ---- Terrain (D01/D02) on a fixed 30 m UTM grid ---- */
  var demInfo = opt.demInfo || LIB.dem(region);
  R.demSource = demInfo.source;
  var dem30 = demInfo.img.resample('bilinear').reproject(g30);
  var slopeDeg = ee.Terrain.slope(dem30).reproject(g30);
  var aspect = ee.Terrain.aspect(dem30).reproject(g30);
  R.dem = dem30;
  R.slopeDeg = slopeDeg.rename('slopeDeg');
  R.slopePct = slopeDeg.multiply(Math.PI / 180).tan().multiply(100).reproject(g30).rename('slopePct');
  R.tpi = dem30.subtract(dem30.focalMean({radius: 300, kernelType: 'circle', units: 'meters'}))
               .reproject(g30).rename('tpi');
  R.curv = dem30.convolve(ee.Kernel.laplacian8(1, false)).reproject(g30).rename('curv');
  R.rough = dem30.reduceNeighborhood({
      reducer: ee.Reducer.stdDev(),
      kernel: ee.Kernel.square({radius: 3, units: 'pixels'})
    }).reproject(g30).rename('rough');

  // McCune & Keon (2002) heat load index, eq. 3; folded aspect |180 - |aspect - 225||
  var L = ee.Image.pixelLonLat().select('latitude').multiply(Math.PI / 180);
  var S = slopeDeg.multiply(Math.PI / 180);
  var Af = ee.Image(180).subtract(aspect.subtract(225).abs()).abs().multiply(Math.PI / 180);
  var lnH = ee.Image(-1.467)
    .add(L.cos().multiply(S.cos()).multiply(1.582))
    .subtract(Af.cos().multiply(S.sin()).multiply(L.sin()).multiply(1.5))
    .subtract(L.sin().multiply(S.sin()).multiply(0.262))
    .add(Af.sin().multiply(S.sin()).multiply(0.607));
  R.hli = lnH.exp().reproject(g30).rename('hli');

  /* ---- MERIT Hydro (D03) and Hydrography90m CTI (D04) ---- */
  var merit = ee.Image(A.MERIT);
  var mProj = merit.select('elv').projection();
  R.hand = merit.select('hnd').rename('hand');
  R.upa = merit.select('upa');
  var chan = merit.select('upa').gte(5).unmask(0).reproject(g30);
  R.C3 = chan.focalMax({radius: 30, kernelType: 'circle', units: 'meters'})
             .reproject(g30).rename('C3');
  R.A1 = LIB.mosaicNative(ee.ImageCollection(A.CTI).filterBounds(region))
            .select([0]).divide(1e8).rename('cti');

  /* ---- Climate: CHIRPS (D05) and MOD16A2GF PET (D06), 2005-2024 ---- */
  var chirps = ee.ImageCollection(A.CHIRPS).select('precipitation');
  var mod16 = ee.ImageCollection(A.MOD16).select('PET');
  var annual = ee.ImageCollection.fromImages(ee.List.sequence(2005, 2024).map(function (y) {
    var s = ee.Date.fromYMD(y, 1, 1), e = s.advance(1, 'year');
    var p = chirps.filterDate(s, e).sum().rename('P');
    var pet = mod16.filterDate(s, e).map(function (i) {
      return i.updateMask(i.lt(32700)).multiply(0.1);       // drop fill values, kg/m2 = mm
    }).sum().rename('PET');
    return p.addBands(pet).addBands(p.subtract(pet).rename('WB'));
  }));
  R.A2 = annual.select('WB').mean().rename('wb');
  R.Pann = annual.select('P').mean().rename('Pann');

  /* ---- Sentinel-2 (D07, D08) ---- */
  var thr = opt.csThr;
  var dN = [], cntA3 = [], cntD5 = [], ann = [];
  for (var y = 2021; y <= 2025; y++) {
    var w1 = LIB.s2(region, y + '-09-15', y + '-10-16', thr).select('NDMI');
    var w2 = LIB.s2(region, y + '-11-15', y + '-12-16', thr).select('NDMI');
    dN.push(w2.median().subtract(w1.median()).rename('dNDMI'));
    cntA3.push(w1.count().min(w2.count()).rename('n'));
    cntD5.push(LIB.s2(region, y + '-04-01', y + '-06-01', thr).select('NDVI').count().rename('n'));
    ann.push(LIB.s2(region, y + '-01-01', (y + 1) + '-01-01', thr).select('NDVI').median().rename('NDVI'));
  }
  R.A3 = ee.ImageCollection(dN).median().rename('dNDMI');
  R.A3_minObs = ee.ImageCollection(cntA3).min().rename('n');
  R.D5_minObs = ee.ImageCollection(cntD5).min().rename('n');
  R.ndviAnnual = ee.ImageCollection(ann).median().rename('NDVI');

  var s2ndvi = LIB.s2(region, '2021-01-01', '2026-01-01', thr).select('NDVI');
  R.ndviDry = s2ndvi.filter(ee.Filter.calendarRange(4, 5, 'month')).median();
  R.ndviPeak = s2ndvi.filter(ee.Filter.calendarRange(9, 11, 'month')).median();
  R.ndviSepOct = s2ndvi.filter(ee.Filter.calendarRange(9, 10, 'month')).median();
  var f1early = LIB.s2(region, '2019-09-01', '2019-12-01', thr)
    .merge(LIB.s2(region, '2020-09-01', '2020-12-01', thr)).select('NDVI').median();
  var f1late = LIB.s2(region, '2024-09-01', '2024-12-01', thr)
    .merge(LIB.s2(region, '2025-09-01', '2025-12-01', thr)).select('NDVI').median();
  R.F1mask = f1late.subtract(f1early).gte(0.15).unmask(0).rename('F1');

  /* ---- RESTREND (D09 + D05), Section 7.4 D2 ---- */
  var m1 = opt.d2Months[0], m2 = opt.d2Months[1];
  var chirpsBil = chirps.map(function (i) { return i.resample('bilinear'); });
  var stack = ee.ImageCollection.fromImages(ee.List.sequence(2013, 2025).map(function (yy) {
    yy = ee.Number(yy);
    var ndvi = LIB.landsatNDVI(region, ee.Date.fromYMD(yy, m1, 1),
                               ee.Date.fromYMD(yy, m2, 1).advance(1, 'month')).median().rename('NDVI');
    var rain = chirpsBil.filterDate(ee.Date.fromYMD(yy, 6, 1), ee.Date.fromYMD(yy, 10, 1))
                        .sum().rename('rain').updateMask(ndvi.mask());
    var yr = ee.Image.constant(yy).float().rename('year').updateMask(ndvi.mask());
    return rain.addBands(ndvi).addBands(yr);
  }));
  var fit = stack.select(['rain', 'NDVI']).reduce(ee.Reducer.linearFit());   // scale, offset
  var resid = stack.map(function (img) {
    var r = img.select('NDVI').subtract(fit.select('offset')
              .add(fit.select('scale').multiply(img.select('rain')))).rename('resid');
    return img.select('year').addBands(r);
  });
  var trend = resid.select(['year', 'resid']).reduce(ee.Reducer.sensSlope()).select('slope');
  R.D2n = stack.select('NDVI').count().rename('n');
  R.D2trend = trend.updateMask(R.D2n.gte(8)).rename('D2trend');

  /* ---- Surface water (D10) ---- */
  var gsw = ee.Image(A.GSW);
  R.C2 = gsw.select('occurrence').unmask(0).gte(50).rename('C2');
  var seas = gsw.select('seasonality').unmask(0).gte(3).reproject(g30);
  R.A5_dist = seas.fastDistanceTransform(256, 'pixels', 'squared_euclidean')
    .unmask(256 * 256).sqrt().multiply(30).reproject(g30).rename('A5_dist');

  /* ---- SoilGrids (D11) ---- */
  R.sand = LIB.soil('sand'); R.silt = LIB.soil('silt'); R.clay = LIB.soil('clay');
  R.soc = LIB.soil('soc');   R.ph = LIB.soil('phh2o');  R.cec = LIB.soil('cec');
  R.cfvo = LIB.soil('cfvo');

  /* ---- RUSLE (E4): R x K x LS x C x P ---- */
  var one = ee.Image(1);
  var san = R.sand, sil = R.silt, cla = R.clay, oc = R.soc.divide(10);  // OC %
  var fcsand = ee.Image(0.2).add(san.multiply(-0.256).multiply(one.subtract(sil.divide(100))).exp().multiply(0.3));
  var fclsi = sil.divide(cla.add(sil)).pow(0.3);
  var forgc = one.subtract(oc.multiply(0.25).divide(oc.add(ee.Image(3.72).subtract(oc.multiply(2.95)).exp())));
  var sn1 = one.subtract(san.divide(100));
  var fhisand = one.subtract(sn1.multiply(0.7).divide(sn1.add(ee.Image(-5.51).add(sn1.multiply(22.9)).exp())));
  R.K = fcsand.multiply(fclsi).multiply(forgc).multiply(fhisand).multiply(0.1317).rename('K');
  var Rf = R.Pann.multiply(0.363).add(79);                                   // Singh et al. 1981
  var As = R.upa.multiply(1e6).divide(90).min(300);                          // m2 per m width, capped
  var mSlope = ee.Terrain.slope(merit.select('elv')).reproject(mProj);
  var LS = As.divide(22.13).pow(0.4)
    .multiply(mSlope.multiply(Math.PI / 180).sin().divide(0.0896).pow(1.3)); // Moore & Burch 1986
  var nd = R.ndviAnnual.clamp(-0.99, 0.95);
  var Cf = nd.multiply(-2).divide(one.subtract(nd)).exp().clamp(0, 1);       // Van der Knijff 1999
  R.E4_A = Rf.multiply(R.K).multiply(LS).multiply(Cf).rename('E4_A');        // P = 1
  R.E4 = R.E4_A.add(1).log10().rename('E4');

  /* ---- Current canopy: Meta CHM (D12) minus Hansen loss 2019+ (D13) ---- */
  var gfc = ee.Image(A.HANSEN);
  var lossyear = gfc.select('lossyear').unmask(0);
  var loss19 = lossyear.gte(19);
  R.D4mask = lossyear.gte(16).and(lossyear.lte(25)).rename('D4');
  var chmCol = ee.ImageCollection(A.CHM).filterBounds(region);
  var chm = LIB.mosaicNative(chmCol).select([0]);
  R.chm = chm;
  var tree1m = chm.gte(5);                                                    // FAO tree height
  var canopy10 = tree1m.reduceResolution({reducer: ee.Reducer.mean(), maxPixels: 128}).reproject(g10);
  R.canopy10 = canopy10.where(loss19.reproject(g10), 0).rename('canopy_frac');
  R.canopyPct = R.canopy10.multiply(100).rename('canopy_pct');
  // D6 dense-forest mask (30 m cells with canopy >= 40 %). The distance transform reads a wide
  // window around every tile, so at 1.2 m this would exceed Earth Engine's reprojection limit
  // ("Reprojection output too large"). The tree mask for D6 is therefore read from the CHM's
  // 4.8 m pyramid level (16x fewer pixels); block canopy %, C1 and D5 keep the full 1.2 m data.
  var chmD6 = chm.setDefaultProjection(chm.projection().atScale(4.8));
  var canopy30 = chmD6.gte(5).reduceResolution({reducer: ee.Reducer.mean(), maxPixels: 256}).reproject(g30)
                       .where(loss19.reproject(g30), 0);
  R.canopy30 = canopy30;
  var near = ee.Image(1).clip(regionBuf).unmask(0);
  var dense = canopy30.gte(0.40).unmask(0).multiply(near).reproject(g30);
  var D6N = 167;                                   // 167 px x 30 m = 5 km search (score exp(-5) ~ 0 beyond)
  R.D6_dist = dense.fastDistanceTransform(D6N, 'pixels', 'squared_euclidean')
    .unmask(D6N * D6N).sqrt().multiply(30).min(D6N * 30).reproject(g30).rename('D6_dist');
  if (opt.a3MaskTrees) { R.A3 = R.A3.updateMask(R.canopy10.lt(0.5)); }     // FF-11 remedy

  /* ---- D5 evergreen shrub proxy ---- */
  var amp = R.ndviPeak.subtract(R.ndviDry);
  R.D5mask = R.ndviDry.gte(0.30).and(R.ndviDry.lte(0.60)).and(amp.lt(0.15))
    .and(R.canopy10.lt(0.20)).unmask(0).rename('D5');

  /* ---- ESA CCI AGB 2022 (D16) ---- */
  var agbCol = ee.ImageCollection(A.AGB).filterDate('2022-01-01', '2023-01-01');
  R.agb = LIB.mosaicNative(agbCol).select('(?i)agb').rename('agb');

  /* ---- Land cover (D14, D15) and constraints C4-C7 ---- */
  var wc = ee.ImageCollection(A.WC).first().select('Map');
  R.wc = wc;
  var dw = ee.ImageCollection(A.DW).filterBounds(region)
             .filterDate('2024-01-01', '2026-01-01').select('label').mode();
  R.C4 = R.slopePct.gt(45).unmask(0).rename('C4');
  R.C5 = wc.eq(50).unmask(0).or(dw.eq(6).unmask(0)).rename('C5');
  R.C6 = wc.eq(40).unmask(0).and(dw.eq(4).unmask(0)).rename('C6');
  R.C7 = wc.eq(60).unmask(0).and(R.ndviSepOct.lt(0.20).unmask(0)).rename('C7');
  R.anyFail = R.C2.or(R.C3).or(R.C4).or(R.C5).or(R.C6).or(R.C7).rename('anyFail');
  R.constraintCode = R.canopy10.gte(0.40).unmask(0)
    .add(R.C2.multiply(2)).add(R.C3.multiply(4)).add(R.C4.multiply(8))
    .add(R.C5.multiply(16)).add(R.C6.multiply(32)).add(R.C7.multiply(64))
    .toByte().rename('constraint_code');

  /* ---- E2 biotic pressure: built-up distance (D15) + GHSL 2020 population (D19) ---- */
  var built = wc.eq(50).reduceResolution({reducer: ee.Reducer.max(), maxPixels: 64})
                .reproject(g30).unmask(0);
  R.E2_dist = built.fastDistanceTransform(512, 'pixels', 'squared_euclidean')
    .unmask(512 * 512).sqrt().multiply(30).reproject(g30).rename('E2_dist');
  var popImg = ee.Image(ee.ImageCollection(A.GHSL).filterDate('2020-01-01', '2021-01-01').first())
                 .select('population_count');
  var popProj = popImg.projection();
  R.E2_pop = popImg.unmask(0).reduceNeighborhood({
      reducer: ee.Reducer.sum(),
      kernel: ee.Kernel.circle({radius: 2000, units: 'meters'})
    }).reproject(popProj).rename('E2_pop');

  /* ---- E1 fire stack 2015-2025 (D17, D18a, D18b), range use only ---- */
  var fireBands = [];
  LIB.FIRE_YEARS.forEach(function (yr) {
    var s = yr + '-01-01', e = (yr + 1) + '-01-01';
    var img = LIB.safeMax(ee.ImageCollection(A.MCD64).filterDate(s, e), 'BurnDate', 0)
                 .gt(0).unmask(0);
    if (yr <= 2021) {
      var pts = ee.FeatureCollection(A.VIIRS_ARCH + yr).filterBounds(regionBuf)
        .filter(ee.Filter.neq('confidence', 'l'))
        .map(function (f) { return f.buffer(187.5); });          // half a 375 m pixel
      img = img.max(ee.Image(0).byte().paint(pts, 1));
    }
    if (yr >= 2023) {
      var ls = (yr === 2023) ? '2023-09-03' : s;
      var lance = LIB.safeMax(ee.ImageCollection(A.VIIRS_LANCE).filterBounds(regionBuf)
                                .filterDate(ls, e), 'confidence', 0);
      img = img.max(lance.gte(1).unmask(0));
    }
    fireBands.push(img.toByte().rename('fire_' + yr));
  });
  R.fire = ee.Image.cat(fireBands);

  /* ---- F2 protected areas (D20) and advisory road access (D21) ---- */
  var wdpa = ee.FeatureCollection(A.WDPA).filterBounds(regionBuf);
  R.pa = ee.Image(0).byte().paint(wdpa, 1).rename('pa');
  var roads = ee.FeatureCollection(A.GRIP_SEA).merge(ee.FeatureCollection(A.GRIP_MECA))
                .filterBounds(region.buffer(30000, 100));
  R.access = roads.distance(30000, 10).rename('access_m');

  return R;
};

/* ======================================================================
 *  State anchors (Module 0, Section 8.1). Native scale per parameter.
 * ====================================================================== */
LIB.ANCHOR_SPEC = [
  ['A1', 90], ['A2', 500], ['A3', 20], ['B1_slope', 30], ['B1_tpi', 30], ['B1_hand', 90],
  ['B3', 250], ['B5', 250], ['B6', 250], ['B7', 30], ['C2s', 30], ['C3s', 30],
  ['D2', 30], ['D3', 100], ['E2_dist', 30], ['E2_pop', 100], ['E4', 90]
];

LIB.anchorImage = function (R, key) {
  var m = {
    A1: R.A1, A2: R.A2, A3: R.A3,
    B1_slope: R.slopeDeg, B1_tpi: R.tpi, B1_hand: R.hand,
    B3: R.soc, B5: R.cec, B6: R.cfvo, B7: R.rough,
    C2s: R.hli, C3s: R.curv,
    D2: R.D2trend.multiply(-1),               // score is normalised (-trend)
    D3: R.agb, E2_dist: R.E2_dist, E2_pop: R.E2_pop, E4: R.E4,
    N2_ndvi: R.peakNDVI, F2: R.AWC                // FRPIM v2.2
  };
  return ee.Image(m[key]);
};

LIB.anchors = function (R, geom, crs, landMask, scaleOverride) {
  var d = ee.Dictionary({});
  LIB.ANCHOR_SPEC.forEach(function (s) {
    var key = s[0];
    var sc = scaleOverride || s[1];
    var img = LIB.anchorImage(R, key).rename(key).updateMask(landMask);
    var r = img.reduceRegion({
      reducer: ee.Reducer.percentile([2, 98]), geometry: geom, scale: sc, crs: crs,
      maxPixels: 1e13, tileScale: 16
    });
    d = d.combine(r);
  });
  return d;
};

/* Anchor landscape: WorldCover tree, shrub, grass, bare (Section 8.1 step 2). */
LIB.anchorLandMask = function () {
  return ee.ImageCollection(LIB.A.WC).first().select('Map').remap([10, 20, 30, 60], [1, 1, 1, 1], 0);
};

/* ======================================================================
 *  LIB.score — per-pixel 0-1 scores (Section 8). Block-level formulas
 *  (D1, D4, D5, E1) are applied after reduction in script 01.
 * ====================================================================== */
LIB.score = function (R, ANCH) {
  var n = function (img, key, inv) { return LIB.norm(img, ANCH, key, inv); };
  var S = {};
  S.A1 = n(R.A1, 'A1', false);
  S.A2 = n(R.A2, 'A2', false);
  S.A3 = n(R.A3, 'A3', false);
  S.A5 = R.A5_dist.divide(-1500).exp().multiply(R.A5_dist.lte(5000));

  var b1s = n(R.slopeDeg, 'B1_slope', true);
  var b1t = n(R.tpi, 'B1_tpi', true);
  var b1h = n(R.hand, 'B1_hand', true);
  var b1 = function (w) { return b1s.multiply(w[0]).add(b1t.multiply(w[1])).add(b1h.multiply(w[2])); };
  S.B1 = b1([0.40, 0.30, 0.30]);
  S.B1_opt = b1([0.30, 0.35, 0.35]);
  S.B1_pes = b1([0.55, 0.25, 0.20]);
  S.B2 = LIB.piecewise(R.clay, [8, 18, 35, 50], [0, 1, 1, 0.2])
           .multiply(ee.Image(1).where(R.sand.gt(70), 0.5));
  S.B3 = n(R.soc, 'B3', false);
  S.B4 = LIB.piecewise(R.ph, [5.0, 6.0, 7.5, 8.5], [0, 1, 1, 0.3]).where(R.ph.gt(8.5), 0.1);
  S.B5 = n(R.cec, 'B5', false);
  S.B6 = n(R.cfvo, 'B6', true);
  S.B7 = n(R.rough, 'B7', true);

  S.C1s = LIB.piecewise(R.slopePct, [2, 5, 20, 35, 45], [0.4, 1, 1, 0.4, 0.1]);
  S.C2s = n(R.hli, 'C2s', true);
  S.C3s = n(R.curv, 'C3s', false);

  S.D2 = n(R.D2trend.multiply(-1), 'D2', false);
  S.D3 = n(R.agb, 'D3', true);
  S.D6 = R.D6_dist.divide(-1000).exp();

  S.E2 = n(R.E2_dist, 'E2_dist', false).multiply(0.6)
           .add(ee.Image(1).subtract(n(R.E2_pop, 'E2_pop', false)).multiply(0.4));
  S.E4 = n(R.E4, 'E4', false);
  return S;
};

/* ======================================================================
 *  FF-01 / FF-03: load and print every dataset — ASYNCHRONOUS.
 *  All requests run in parallel in the background (the page never
 *  freezes). done({ok, log, scales}) is called once all have answered.
 * ====================================================================== */
LIB.checkAssets = function (region, done, v22) {
  var A = LIB.A;
  region = ee.Geometry(region);
  var pt = region.centroid(100);
  var tests = [];   // [id, eeObject, critical, validator]
  function ic(path, s, e, bounds) {
    var c = ee.ImageCollection(path);
    if (s) { c = c.filterDate(s, e); }
    if (bounds) { c = c.filterBounds(bounds); }
    return ee.Dictionary({images: c.limit(500).size(), bands: ee.Image(c.first()).bandNames()});
  }
  function im(path) { return ee.Image(path).bandNames(); }
  function fc(path, bounds) {
    var c = ee.FeatureCollection(path);
    if (bounds) { c = c.filterBounds(bounds); }
    return ee.Dictionary({features: c.limit(5000).size()});
  }
  function scale(col) {
    return LIB.mosaicNative(ee.ImageCollection(col).filterBounds(pt)).projection().nominalScale();
  }
  function add(id, obj, critical, validator) { tests.push([id, obj, critical !== false, validator]); }
  add('D01 FABDEM', ic(A.FABDEM, null, null, pt), false);
  add('D02 GLO-30', ic(A.GLO30, null, null, pt), false);
  add('D03 MERIT Hydro', im(A.MERIT));
  add('D04 Hydrography90m CTI', ic(A.CTI, null, null, pt));
  add('D05 CHIRPS daily', ic(A.CHIRPS, '2024-07-01', '2024-07-05'));
  add('D06 MOD16A2GF', ic(A.MOD16, '2024-01-01', '2024-02-01'));
  add('D07 Sentinel-2 SR', ic(A.S2, '2025-10-01', '2025-11-01', pt));
  add('D08 Cloud Score+', ic(A.CSP, '2025-10-01', '2025-11-01', pt));
  add('D09 Landsat 8', ic(A.L8, '2024-10-01', '2024-12-01', pt));
  add('D09 Landsat 9', ic(A.L9, '2024-10-01', '2024-12-01', pt));
  add('D10 JRC GSW 1.4', im(A.GSW));
  ['sand', 'silt', 'clay', 'soc', 'phh2o', 'cec', 'cfvo'].forEach(function (p) {
    add('D11 SoilGrids ' + p, im(A.SOIL + p + '_mean'));
  });
  add('D12 Meta canopy height', ic(A.CHM, null, null, pt));
  add('D13 Hansen GFC v1.13', im(A.HANSEN));
  add('D14 Dynamic World', ic(A.DW, '2025-01-01', '2025-02-01', pt));
  add('D15 WorldCover v200', ic(A.WC));
  add('D16 ESA CCI AGB 2022', ic(A.AGB, '2022-01-01', '2023-01-01'));
  add('D17 MCD64A1', ic(A.MCD64, '2024-01-01', '2025-01-01'));
  for (var y = 2015; y <= 2021; y++) {
    add('D18a VIIRS archive ' + y, fc(A.VIIRS_ARCH + y, pt.buffer(50000)));
  }
  add('D18b VIIRS LANCE', ic(A.VIIRS_LANCE, '2024-03-01', '2024-03-10'));
  add('D19 GHSL POP 2020', ic(A.GHSL, '2020-01-01', '2021-01-01'));
  add('D20 WDPA', fc(A.WDPA, pt.buffer(100000)));
  add('D21 GRIP4 SE Asia', fc(A.GRIP_SEA, pt.buffer(20000)));
  add('D21 GRIP4 ME-C Asia', fc(A.GRIP_MECA));
  add('D22 FAO GAUL L1', fc(A.GAUL1));
  if (v22) {
    add('D23 SoilGrids wv0033 (field capacity)', im(A.SOILWV + 'wv0033'));
    add('D23 SoilGrids wv1500 (wilting point)', im(A.SOILWV + 'wv1500'));
    add('D24 Landsat 5 TM', ic(A.L5, '2003-09-01', '2003-12-01', pt));
    add('D24 Landsat 7 ETM+', ic(A.L7, '2003-09-01', '2003-12-01', pt));
  }
  var inRange = function (lo, hi) { return function (v) { return v >= lo && v <= hi; }; };
  add('FF-03 DEM mosaic scale (m)',
      ee.Number(ee.Algorithms.If(ee.ImageCollection(A.FABDEM).filterBounds(pt).size().gt(0),
                                 scale(A.FABDEM), scale(A.GLO30))), true, inRange(20, 40));
  add('FF-03 CTI mosaic scale (m)', scale(A.CTI), true, inRange(60, 120));
  add('FF-03 CHM mosaic scale (m)', scale(A.CHM), true, inRange(0.3, 3));

  print('Checking ' + tests.length + ' datasets in the background (FF-01, FF-03) ...');
  // At most 6 requests at a time; a request that errors is retried up to 2 times
  // (Earth Engine sometimes refuses bursts with "Too many concurrent aggregations").
  var res = {}, pending = tests.length, next = 0, MAX_PAR = 6;
  function finish() {
    var ok = true, log = [], scales = {};
    tests.forEach(function (u) {
      var r = res[u[0]];
      log.push(u[0] + ':' + (r.pass ? 'OK' : 'FAIL'));
      if (u[0].indexOf('FF-03') === 0) { scales[u[0]] = r.val; }
      if (!r.pass && r.critical) { ok = false; }
    });
    if (!res['D01 FABDEM'].pass && !res['D02 GLO-30'].pass) { ok = false; }
    if (!ok) {
      var failed = tests.filter(function (u) { return !res[u[0]].pass && res[u[0]].critical; })
                        .map(function (u) { return u[0] + ' (' + (res[u[0]].err || 'value ' + res[u[0]].val) + ')'; });
      print('FAILED CHECKS: ' + failed.join(' | '));
    }
    done({ok: ok, log: log.join(';'), scales: scales});
  }
  function runOne(t, attempt) {
    t[1].evaluate(function (val, err) {
      if (err && attempt < 3) {                                    // transient error: retry later
        ui.util.setTimeout(function () { runOne(t, attempt + 1); }, 2000);
        return;
      }
      var pass = !err && (!t[3] || t[3](val));
      res[t[0]] = {pass: pass, critical: t[2], val: val, err: err};
      print((pass ? 'OK   ' : 'FAIL ') + t[0] + (attempt > 1 ? ' (attempt ' + attempt + ')' : ''),
            err ? String(err) : val);
      pending -= 1;
      if (pending === 0) { finish(); return; }
      if (next < tests.length) { runOne(tests[next++], 1); }
    });
  }
  while (next < Math.min(MAX_PAR, tests.length)) { runOne(tests[next++], 1); }
};

/* ======================================================================
 *  Local anchors, computed in the background (range-only mode).
 *  One request per parameter, in parallel; a parameter that times out
 *  is retried once at a coarser scale. done(dict, ok, log).
 * ====================================================================== */
LIB.anchorsAsync = function (R, geom, crs, landMask, minScale, done, spec) {
  // spec rows: [key, nativeScale, percentiles (default [2, 98])]. At most 6 requests at a time.
  // An error is retried twice at the same scale, then once more at a coarser scale (max 1000 m).
  spec = spec || LIB.ANCHOR_SPEC;
  var res = {}, log = [], pending = spec.length, ok = true, next = 0, MAX_PAR = 6;
  function one(row, sc, attempt) {
    var key = row[0], pcts = row[2] || [2, 98];
    var img = LIB.anchorImage(R, key).rename(key).updateMask(landMask);
    img.reduceRegion({reducer: ee.Reducer.percentile(pcts), geometry: geom, scale: sc, crs: crs,
                      maxPixels: 1e13, tileScale: 16, bestEffort: true})
      .evaluate(function (d, err) {
        var vals = pcts.map(function (p) { return d ? d[key + '_p' + p] : null; });
        var bad = err || vals.some(function (v) { return typeof v !== 'number'; });
        if (bad) {
          if (attempt < 3) { ui.util.setTimeout(function () { one(row, sc, attempt + 1); }, 2000); return; }
          if (attempt === 3 && sc < 1000) {
            ui.util.setTimeout(function () { one(row, Math.min(sc * 2.5, 1000), 4); }, 2000);
            return;
          }
          ok = false;
          log.push(key + ':FAIL');
          print('FAIL anchor ' + key + ' -> ' + (err || 'no valid pixels'));
        } else {
          pcts.forEach(function (p, ii) { res[key + '_p' + p] = vals[ii]; });
          log.push(key + '@' + sc + 'm');
          print('OK   anchor ' + key + '  [' + pcts.map(function (p) { return p + 'th'; }).join(', ') + ' pct] = [' +
                vals.map(function (v) { return v.toPrecision(5); }).join(', ') + ']  @' + sc + ' m');
        }
        pending -= 1;
        if (pending === 0) { done(res, ok, log.join(';')); return; }
        if (next < spec.length) { start(spec[next++]); }
      });
  }
  function start(row) { one(row, Math.max(row[1], minScale), 1); }
  while (next < Math.min(MAX_PAR, spec.length)) { start(spec[next++]); }
};

/* ======================================================================
 *  FRPIM v2.2 additions
 * ====================================================================== */
// Anchor keys keep their v2.1 names where the parameter carried over (traceability):
// A1=F1 (CTI; + 95th pct for G4), A2=F3, A3=X1 (quartiles), B1_*=F5, B6=F8, B7=F6, C2s=F11,
// C3s=F12, D2=N3, D3=N5, E2_*=F14, E4=N4; new: N2_ndvi (NDVIs/NDVIv for FVC), F2 (AWC).
LIB.ANCHOR_SPEC_V22 = [
  ['A1', 90, [2, 95, 98]], ['A2', 500], ['A3', 20, [2, 25, 50, 98]],
  ['B1_slope', 30], ['B1_tpi', 30], ['B1_hand', 90], ['B6', 250], ['B7', 30],
  ['C2s', 30], ['C3s', 30], ['D2', 30], ['D3', 100], ['E2_dist', 30], ['E2_pop', 100], ['E4', 90],
  ['N2_ndvi', 20], ['F2', 250]
];

/* Sentinel-2 reflectance (B2, B4, B8, B11) with Cloud Score+ mask. */
LIB.s2refl = function (region, start, end, csThr) {
  var csp = ee.ImageCollection(LIB.A.CSP);
  return ee.ImageCollection(LIB.A.S2).filterBounds(region).filterDate(start, end)
    .linkCollection(csp, ['cs_cdf'])
    .map(function (img) {
      return ee.Image(img.select(['B2', 'B4', 'B8', 'B11']).multiply(0.0001)
        .updateMask(img.select('cs_cdf').gte(csThr)).copyProperties(img, ['system:time_start']));
    });
};

/* Landsat 5 TM + 7 ETM+ C2 L2 NDVI (red = SR_B3, NIR = SR_B4), clear pixels only. */
LIB.landsat57NDVI = function (region, start, end) {
  return ee.ImageCollection(LIB.A.L5).merge(ee.ImageCollection(LIB.A.L7))
    .filterBounds(region).filterDate(start, end)
    .map(function (img) {
      var clear = img.select('QA_PIXEL').bitwiseAnd(63).eq(0);
      var sr = img.select(['SR_B3', 'SR_B4']).multiply(0.0000275).add(-0.2);
      return ee.Image(sr.normalizedDifference(['SR_B4', 'SR_B3']).rename('NDVI')
        .updateMask(clear).copyProperties(img, ['system:time_start']));
    });
};

/* Adds the v2.2 layers to an existing LIB.layers() result R. */
LIB.layersV22 = function (R, region, crs, opt) {
  region = ee.Geometry(region);
  var thr = opt.csThr;
  // N2: peak-greenness (15 Oct - 30 Nov) reflectance median 2021-2025 -> BSI and NDVI
  var peakCol = ee.ImageCollection([]), cntN2 = [];
  for (var y = 2021; y <= 2025; y++) {
    var c = LIB.s2refl(region, y + '-10-15', y + '-12-01', thr);
    peakCol = peakCol.merge(c);
    cntN2.push(c.select('B8').count().rename('n'));
  }
  var pk = peakCol.median();
  R.peakNDVI = pk.normalizedDifference(['B8', 'B4']).rename('peakNDVI');
  var sw = pk.select('B11').add(pk.select('B4')), vn = pk.select('B8').add(pk.select('B2'));
  R.BSI = sw.subtract(vn).divide(sw.add(vn)).rename('BSI');
  R.N2_minObs = ee.ImageCollection(cntN2).min().rename('n');
  // F2: available water capacity, 0-30 cm (wv0033 - wv1500), thickness-weighted
  function wv(name) {
    var img = ee.Image(LIB.A.SOILWV + name);
    return img.select('val_0_5cm_mean').multiply(5).add(img.select('val_5_15cm_mean').multiply(10))
              .add(img.select('val_15_30cm_mean').multiply(15)).divide(30);
  }
  R.AWC = wv('wv0033').subtract(wv('wv1500')).rename('AWC');
  // Degradation evidence layers
  var gfc = ee.Image(LIB.A.HANSEN);
  var ly = gfc.select('lossyear').unmask(0);
  R.treecover2000 = gfc.select('treecover2000').rename('treecover2000');            // DE1
  R.lossAny = ly.gte(1).and(ly.lte(25)).rename('lossAny');                           // DE2
  R.N6mask = R.lossAny.and(R.canopy30.lt(0.5).unmask(1)).rename('N6');               // N6: lost, not regrown
  R.trendNeg = R.D2trend.lt(0).rename('trendNeg');                                   // DE3 (valid pixels only)
  var base = ee.ImageCollection([]), recent = ee.ImageCollection([]);
  for (var b = 2000; b <= 2005; b++) { base = base.merge(LIB.landsat57NDVI(region, b + '-09-01', b + '-12-01')); }
  for (var r2 = 2021; r2 <= 2025; r2++) { recent = recent.merge(LIB.landsatNDVI(region, r2 + '-09-01', r2 + '-12-01')); }
  R.ndviBase = base.median().rename('ndviBase');                                     // DE4
  R.ndviRecentL = recent.median().rename('ndviRecent');
  R.base_nObs = base.count().rename('n');
  // C8: WorldCover grassland (30) + bare (60)
  R.wcOpen = R.wc.eq(30).or(R.wc.eq(60)).unmask(0).rename('wcOpen');
  return R;
};

/* v2.2 per-pixel scores that are new or renamed (others come from LIB.score). */
LIB.scoreV22 = function (R, ANCH) {
  var Z = {};
  var lo = ee.Number(ANCH.get('N2_ndvi_p2')), hi = ee.Number(ANCH.get('N2_ndvi_p98'));
  Z.FVC = R.peakNDVI.subtract(lo).divide(hi.subtract(lo).max(1e-9)).clamp(0, 1).pow(2).rename('FVC');  // Gutman & Ignatov 1998
  Z.BSIpos = R.BSI.gt(0).rename('BSIpos');
  Z.F2 = LIB.norm(R.AWC, ANCH, 'F2', false).rename('F2');
  Z.G4 = R.A1.gte(ee.Number(ANCH.get('A1_p95'))).and(R.slopePct.lt(2)).unmask(0).rename('G4');
  return Z;
};

/* ######################################################################
 *  STEP 1 — STATE ANCHOR TABLE (spec build steps 1-2)
 * ###################################################################### */
function step1_stateAnchors() {
  var CFG0 = {
    COUNTRY: SETTINGS.COUNTRY, STATE: SETTINGS.STATE, ANCHOR_ID: SETTINGS.ANCHOR_ID,
    ANCHOR_ASSET: ASSETS.ANCHORS, DRIVE_FOLDER: SETTINGS.DRIVE_FOLDER,
    CS_THRESHOLD: SETTINGS.CS_THRESHOLD, D2_MONTHS: SETTINGS.D2_MONTHS,
    STATE_CRS: SETTINGS.STATE_CRS, SCALE_OVERRIDE: null,
    AOI_ASSET: SETTINGS.AOI_ASSET, RANGE_NAME: SETTINGS.RANGE_NAME
  };
  /* ======================================================================
   *  MODULE 0 — STATE ANCHOR TABLE (build steps 1-2, Section 8.1)
   *  Fully asynchronous: the page never freezes. Export tasks appear in
   *  the Tasks tab only after the background dataset check has passed.
   * ====================================================================== */

  /* ---------- 1. State boundary and working grid ---------- */
  var state = ee.FeatureCollection(LIB.A.GAUL1)
    .filter(ee.Filter.eq('ADM0_NAME', CFG0.COUNTRY))
    .filter(ee.Filter.eq('ADM1_NAME', CFG0.STATE));
  var STATE_GEOM = state.geometry().simplify(250);
  var STATE_CRS = CFG0.STATE_CRS;
  print('State features (GAUL L1):', state.size());
  print('Anchor grid CRS:', STATE_CRS, '| state centroid UTM zone:', LIB.utmCrs(STATE_GEOM));

  Map.centerObject(state, 7);
  Map.addLayer(ee.Image().byte().paint(state, 1, 2), {palette: ['black']}, CFG0.STATE + ' boundary');
  if (CFG0.AOI_ASSET) {
    Map.addLayer(ee.Image().byte().paint(ee.FeatureCollection(CFG0.AOI_ASSET), 1, 3), {palette: ['#d7191c']},
                 'Your range (' + CFG0.RANGE_NAME + ')');
  }
  print('STEP 1 works on the whole state: it measures every parameter across ' + CFG0.STATE +
        ' to fix the scoring scale (anchors). Your range, blocks and parameter maps appear from STEP 2.');

  /* ---------- 2. Load and print all 22 datasets (FF-01, FF-03), then build ---------- */
  LIB.checkAssets(STATE_GEOM, function (CHECK) {
    if (!CHECK.ok) {
      print('FF-01/FF-03 STOP: at least one dataset failed to load (see FAIL lines above). ' +
            'Nothing has been substituted and no task was created.');
      return;
    }
    print('All datasets OK — creating the anchor export tasks.');

    /* ---------- 3. Parameter images over the state ---------- */
    var R_STATE = LIB.layers(STATE_GEOM, STATE_CRS, {
      csThr: CFG0.CS_THRESHOLD, d2Months: CFG0.D2_MONTHS, a3MaskTrees: false
    });
    var LAND = LIB.anchorLandMask();

    /* ---------- 4. Percentiles (2nd, 98th) on the anchor landscape ---------- */
    var ANCH_DICT = LIB.anchors(R_STATE, STATE_GEOM, STATE_CRS, LAND, CFG0.SCALE_OVERRIDE);

    var pasteParts = LIB.ANCHOR_SPEC.map(function (s) {
      var k = s[0];
      return ee.String(k + ': [')
        .cat(ee.Number(ANCH_DICT.get(k + '_p2')).format('%.6g')).cat(', ')
        .cat(ee.Number(ANCH_DICT.get(k + '_p98')).format('%.6g')).cat(']');
    });
    var PASTE = ee.String("var ANCHORS = {id: '" + CFG0.ANCHOR_ID + "', ")
      .cat(ee.List(pasteParts).join(', ')).cat('};');

    var anchorFeature = ee.Feature(STATE_GEOM.centroid(100), ANCH_DICT).set({   // asset tables need a geometry
      anchor_id: CFG0.ANCHOR_ID,
      state: CFG0.STATE,
      state_crs: STATE_CRS,
      model_version: 'PPI-SK_v2.1',
      dem_source: R_STATE.demSource,
      cs_threshold: CFG0.CS_THRESHOLD,
      d2_window: CFG0.D2_MONTHS.join('-'),
      anchor_scales: LIB.ANCHOR_SPEC.map(function (s) {
        return s[0] + '@' + (CFG0.SCALE_OVERRIDE || s[1]) + 'm';
      }).join(';'),
      asset_check: CHECK.log,
      created: ee.Date(Date.now()).format('YYYY-MM-dd'),
      paste_js: PASTE
    });
    var ANCHOR_FC = ee.FeatureCollection([anchorFeature]);

    /* ---------- 5. Freeze: export CSV (Drive) + table asset ---------- */
    var safeId = CFG0.ANCHOR_ID.replace(/[^A-Za-z0-9_]/g, '_');
    Export.table.toDrive({
      collection: ANCHOR_FC,
      description: 'PPI00_anchors_' + safeId,
      folder: CFG0.DRIVE_FOLDER,
      fileNamePrefix: 'PPI00_state_anchors_' + safeId,
      fileFormat: 'CSV'
    });
    Export.table.toAsset({
      collection: ANCHOR_FC,
      description: 'PPI00_anchors_to_asset',
      assetId: CFG0.ANCHOR_ASSET
    });

    print('====================================================================');
    print('NEXT: open the Tasks tab and RUN both tasks (PPI00_...).');
    print('When they finish, press Run again (STEP 2). Anchors saved to:', CFG0.ANCHOR_ASSET);
    print('====================================================================');
    Map.addLayer(LAND.selfMask().clip(STATE_GEOM), {palette: ['#4daf4a']},
                 'Anchor landscape: tree/shrub/grass/bare land in ' + CFG0.STATE, false);
  });
}

/* ######################################################################
 *  STEP 2 — RANGE LAYERS -> RAW BLOCK TABLE (spec build steps 3-17)
 * ###################################################################### */
function step2_rangeLayers() {
  var CFG = {
    AOI_ASSET: SETTINGS.AOI_ASSET, RANGE_NAME: SETTINGS.RANGE_NAME, ID_PREFIX: SETTINGS.ID_PREFIX,
    MODEL_VERSION: 'PPI-SK_v2.1', BLOCK_SIDE: 316.2278, MIN_BLOCK_HA: 2.0,
    BEAT_FIELD: SETTINGS.BEAT_FIELD, CRS: SETTINGS.CRS, STATE_CRS: SETTINGS.STATE_CRS,
    ANCHOR_MODE: SETTINGS.ANCHOR_MODE, ANCHOR_ASSET: ASSETS.ANCHORS, STATE_NAME: SETTINGS.STATE,
    LIVE_ANCHOR_SCALE: SETTINGS.LIVE_ANCHOR_SCALE,
    CS_THRESHOLD: SETTINGS.CS_THRESHOLD, D2_MONTHS: SETTINGS.D2_MONTHS,
    A3_MASK_TREES: SETTINGS.A3_MASK_TREES, REASON_MIN_FRAC: 0.01, TILE_SCALE: SETTINGS.TILE_SCALE,
    RAW_ASSET: ASSETS.RAW, QC01_ASSET: ASSETS.QC01, DRIVE_FOLDER: SETTINGS.DRIVE_FOLDER, SHOW_MAP: true
  };
  /* ======================================================================
   *  SCRIPT 01 — MAIN (build steps 3-17)
   *  Fully asynchronous: all server questions run in the background, so
   *  the page never freezes. Export tasks appear only after every check
   *  (FF-01, FF-02, FF-03, anchors) has passed.
   * ====================================================================== */

  /* ---------- Step 3: range asset, UTM zone, beat field (FF-02, FF-05) ---------- */
  var AOI_FC = ee.FeatureCollection(CFG.AOI_ASSET);
  var AOI = AOI_FC.geometry().dissolve({maxError: 1});
  var CRS = CFG.CRS;

  var PRE = {
    n: AOI_FC.size(),
    props: ee.Feature(AOI_FC.first()).propertyNames(),
    utm: LIB.utmCrs(AOI)
  };
  if (CFG.ANCHOR_MODE === 'ASSET') {
    var af0 = ee.Feature(ee.FeatureCollection(CFG.ANCHOR_ASSET).first());
    PRE.anchor = ee.Dictionary({id: af0.get('anchor_id'), cs: af0.get('cs_threshold'), d2: af0.get('d2_window')});
  }
  print('Reading the range asset and checking datasets in the background ...');
  LIB.evalRetry(ee.Dictionary(PRE), function (info, err) {
    if (err) {
      print('STOP: could not read the range asset' +
            (CFG.ANCHOR_MODE === 'ASSET' ? ' or the anchor table (run STEP 1 first, or set ANCHOR_MODE = LIVE)' : '') +
            ': ' + err);
      return;
    }
    print('AOI features:', info.n);
    print('AOI property names:', info.props);
    print('UTM zone of AOI centroid:', info.utm, '| working CRS:', CRS);
    if (info.utm !== CRS) {
      print('FF-02 STOP: the AOI centroid is in ' + info.utm + ' but CRS is set to ' + CRS +
            '. Set CRS to ' + info.utm + ' at the top of the script.');
      return;
    }
    if (info.anchor) {
      if (info.anchor.cs !== CFG.CS_THRESHOLD || info.anchor.d2 !== CFG.D2_MONTHS.join('-')) {
        print('WARNING: CS_THRESHOLD / D2_MONTHS differ from the anchor run (' + info.anchor.cs + ', ' +
              info.anchor.d2 + '). Anchors stay valid but log this in the DPR.');
      }
    }
    var BEAT_FIELD = null;
    if (CFG.BEAT_FIELD === 'AUTO') {
      for (var i = 0; i < info.props.length; i++) {
        if (/beat|compart|compt/i.test(info.props[i])) { BEAT_FIELD = info.props[i]; break; }
      }
    } else if (CFG.BEAT_FIELD) {
      BEAT_FIELD = CFG.BEAT_FIELD;
    }
    print('Beat field used:', BEAT_FIELD === null ? "none -> beat_id = 'RANGE'" : BEAT_FIELD);

    /* ---------- FF-01 / FF-03: load and print every dataset ---------- */
    LIB.checkAssets(AOI, function (CHECK) {
      if (!CHECK.ok) {
        print('FF-01/FF-03 STOP: a dataset failed to load or a mosaic lost its projection ' +
              '(see FAIL lines above). Nothing has been substituted and no task was created.');
        return;
      }
      if (CFG.ANCHOR_MODE === 'LOCAL') {
        var refGeom = AOI.buffer(CFG.LOCAL_BUFFER_KM * 1000, 200);
        print('All datasets OK. Computing the scoring scale (anchors) for ' + CFG.RANGE_NAME +
              ' + ' + CFG.LOCAL_BUFFER_KM + ' km landscape in the background (1-3 minutes) ...');
        Map.addLayer(ee.Image().byte().paint(ee.FeatureCollection([ee.Feature(refGeom)]), 1, 1),
                     {palette: ['#2b83ba']}, 'Anchor landscape (range + ' + CFG.LOCAL_BUFFER_KM + ' km)', false);
        var R_REF = LIB.layers(refGeom, CRS,
          {csThr: CFG.CS_THRESHOLD, d2Months: CFG.D2_MONTHS, a3MaskTrees: false});
        LIB.anchorsAsync(R_REF, refGeom, CRS, LIB.anchorLandMask(), CFG.LOCAL_ANCHOR_SCALE,
          function (dict, ok, alog) {
            if (!ok) {
              print('STOP: some anchors could not be computed (see FAIL lines). Press Run again; ' +
                    'if it repeats, set LOCAL_ANCHOR_SCALE to 250.');
              return;
            }
            print('Anchors ready — building the range layers and export tasks.');
            runRange(BEAT_FIELD, CHECK, dict, alog);
          });
        return;
      }
      print('All datasets OK — building the range layers and export tasks.');
      runRange(BEAT_FIELD, CHECK);
    });
  });

  function runRange(BEAT_FIELD, CHECK, LOCAL_ANCH, LOCAL_LOG) {
  var FF02 = 'PASS';
  /* ---------- Step 4: 10 ha grid, stable block ID, beat join (FF-04) ---------- */
  var proj = ee.Projection(CRS).atScale(CFG.BLOCK_SIDE);
  var grid = AOI.coveringGrid(proj).map(function (f) {
    var inter = f.geometry().intersection(AOI, 1);
    var a = inter.area(1).divide(1e4);
    var full = f.geometry().area(1).divide(1e4);
    return f.set({
      block_area_ha: a,
      geom_full_ha: full,
      is_interior: a.gte(full.multiply(0.9999))
    }).setGeometry(inter);
  }).filter(ee.Filter.gte('block_area_ha', CFG.MIN_BLOCK_HA));

  grid = grid.map(function (f) {
    var c = f.geometry().centroid(1).transform(CRS, 1).coordinates();
    var e = ee.Number(c.get(0)).round().format('%.0f');
    var n = ee.Number(c.get(1)).round().format('%.0f');
    return f.set('block_id', ee.String(CFG.ID_PREFIX).cat(e).cat('_').cat(n));
  });

  function toStr(v) {
    return ee.Algorithms.If(ee.Algorithms.IsEqual(v, null), 'RANGE',
           ee.Algorithms.If(ee.Algorithms.IsEqual(ee.Algorithms.ObjectType(v), 'String'), v,
                            ee.Number(v).format('%.0f')));
  }
  if (BEAT_FIELD !== null) {
    grid = grid.map(function (f) {
      var g = f.geometry();
      var cands = AOI_FC.filterBounds(g).map(function (b) {
        return b.set('ov__', b.geometry().intersection(g, 1).area(1));
      });
      var best = ee.Feature(cands.sort('ov__', false).first());
      var v = ee.Algorithms.If(cands.size().gt(0), best.get(BEAT_FIELD), null);
      return f.set('beat_id', toStr(v));
    });
  } else {
    grid = grid.map(function (f) { return f.set('beat_id', 'RANGE'); });
  }
  var N_GRID = grid.size();
  print('Blocks in grid (>= ' + CFG.MIN_BLOCK_HA + ' ha):', N_GRID);

  /* ---------- Anchors (Section 8, FF-09) ---------- */
  var ANCH, ANCHOR_ID;
  if (CFG.ANCHOR_MODE === 'ASSET') {
    var af = ee.Feature(ee.FeatureCollection(CFG.ANCHOR_ASSET).first());
    ANCH = af.toDictionary();
    ANCHOR_ID = ee.String(af.get('anchor_id'));
    print('Anchor table loaded:', ANCHOR_ID);
  } else if (CFG.ANCHOR_MODE === 'FROZEN') {
    if (!ANCHORS || ANCHORS.id === 'NOT_SET') {
      print('FF-09 STOP: ANCHOR_MODE = FROZEN but the ANCHORS constant is not pasted.'); return;
    }
    var ad = {};
    LIB.ANCHOR_SPEC.forEach(function (s) {
      if (!ANCHORS[s[0]]) { ad.__missing = s[0]; return; }
      ad[s[0] + '_p2'] = ANCHORS[s[0]][0];
      ad[s[0] + '_p98'] = ANCHORS[s[0]][1];
    });
    if (ad.__missing) { print('FF-09 STOP: ANCHORS has no entry for ' + ad.__missing); return; }
    ANCH = ee.Dictionary(ad);
    ANCHOR_ID = ee.String(ANCHORS.id);
  } else if (CFG.ANCHOR_MODE === 'LOCAL') {
    ANCH = ee.Dictionary(LOCAL_ANCH);
    var today = new Date().toISOString().slice(0, 10);
    ANCHOR_ID = ee.String('LOCAL_' + CFG.RANGE_NAME + '+' + CFG.LOCAL_BUFFER_KM + 'km_' + today);
    var anchFC = ee.FeatureCollection([ee.Feature(null, LOCAL_ANCH).set({
      anchor_id: ANCHOR_ID, anchor_landscape: CFG.RANGE_NAME + ' + ' + CFG.LOCAL_BUFFER_KM + ' km buffer',
      anchor_scales: LOCAL_LOG, land_mask: 'WorldCover 10/20/30/60', created: today})]);
    Export.table.toDrive({collection: anchFC, description: 'PPI01_local_anchor_table',
      folder: CFG.DRIVE_FOLDER, fileNamePrefix: 'PPI01_local_anchors_' + CFG.RANGE_NAME, fileFormat: 'CSV'});
  } else if (CFG.ANCHOR_MODE === 'LIVE') {
    print('WARNING: LIVE anchors at ' + CFG.LIVE_ANCHOR_SCALE + ' m — provisional (FF-09 = WARN).');
    var stateFC = ee.FeatureCollection(LIB.A.GAUL1)
      .filter(ee.Filter.eq('ADM0_NAME', 'India')).filter(ee.Filter.eq('ADM1_NAME', CFG.STATE_NAME));
    var stateGeom = stateFC.geometry().simplify(250);
    var stateCrs = CFG.STATE_CRS;
    var R_STATE = LIB.layers(stateGeom, stateCrs,
      {csThr: CFG.CS_THRESHOLD, d2Months: CFG.D2_MONTHS, a3MaskTrees: false});
    ANCH = LIB.anchors(R_STATE, stateGeom, stateCrs, LIB.anchorLandMask(), CFG.LIVE_ANCHOR_SCALE);
    ANCHOR_ID = ee.String('LIVE_' + CFG.LIVE_ANCHOR_SCALE + 'm_').cat(ee.Date(Date.now()).format('YYYY-MM-dd'));
  } else {
    print('STOP: ANCHOR_MODE must be LOCAL, ASSET, FROZEN or LIVE'); return;
  }

  /* ---------- Steps 5-12: all layers on the range grid ---------- */
  var R = LIB.layers(AOI, CRS, {
    csThr: CFG.CS_THRESHOLD, d2Months: CFG.D2_MONTHS, a3MaskTrees: CFG.A3_MASK_TREES
  });
  print('DEM source:', R.demSource);

  /* ---------- Step 14: per-pixel scores ---------- */
  var S = LIB.score(R, ANCH);

  /* ---------- Step 15: block reduction, one call per reducer group (Section 9) ---------- */
  var MED30 = ee.Image.cat([
    S.A1.rename('A1'), R.A1.rename('A1_raw'),
    S.B1.rename('B1'), S.B1_opt.rename('B1_opt'), S.B1_pes.rename('B1_pes'),
    R.slopeDeg.rename('B1_raw_slope'), R.tpi.rename('B1_raw_tpi'), R.hand.rename('B1_raw_hand'),
    S.B7.rename('B7'), R.rough.rename('B7_raw'),
    S.C1s.rename('C1s'), R.slopePct.rename('C1s_raw'),
    S.C2s.rename('C2s'), R.hli.rename('C2s_raw'),
    S.C3s.rename('C3s'), R.curv.rename('C3s_raw')
  ]).toFloat();

  var MEAN30 = ee.Image.cat([
    S.A2.rename('A2'), R.A2.rename('A2_raw'),
    S.B2.rename('B2'), R.clay.rename('B2_raw_clay'), R.sand.rename('B2_raw_sand'),
    S.B3.rename('B3'), R.soc.rename('B3_raw'),
    S.B4.rename('B4'), R.ph.rename('B4_raw'),
    S.B5.rename('B5'), R.cec.rename('B5_raw'),
    S.B6.rename('B6'), R.cfvo.rename('B6_raw'),
    S.D2.rename('D2'), R.D2trend.rename('D2_raw'),
    S.D3.rename('D3'), R.agb.rename('D3_raw'),
    S.E2.rename('E2'), R.E2_dist.rename('E2_raw_dist'), R.E2_pop.rename('E2_raw_pop'),
    S.E4.rename('E4'), R.E4.rename('E4_raw'),
    R.D4mask.rename('D4_raw')
  ]).toFloat();

  var MEAN10 = ee.Image.cat([
    S.A3.rename('A3'), R.A3.rename('A3_raw'),
    R.canopyPct.rename('canopy_pct'),
    R.D5mask.rename('D5_raw'),
    R.C2.rename('C2_frac'), R.C3.rename('C3_frac'), R.C4.rename('C4_frac'),
    R.C5.rename('C5_frac'), R.C6.rename('C6_frac'), R.C7.rename('C7_frac'),
    R.anyFail.rename('constrained_frac'),
    R.F1mask.rename('F1_frac')
  ]).toFloat();

  var MAX30 = ee.Image.cat([S.A5.rename('A5'), S.D6.rename('D6'), R.fire, R.pa]).toFloat();
  var MIN30 = ee.Image.cat([R.A5_dist.rename('A5_raw'), R.D6_dist.rename('D6_raw'),
                            R.access.rename('access_m')]).toFloat();

  function reduceGroup(img, fc, reducer, scale) {
    return img.reduceRegions({collection: fc, reducer: reducer, scale: scale, crs: CRS,
                              tileScale: CFG.TILE_SCALE});
  }
  var blocks = reduceGroup(MED30, grid, ee.Reducer.median(), 30);
  blocks = reduceGroup(MEAN30, blocks, ee.Reducer.mean(), 30);
  blocks = reduceGroup(MEAN10, blocks, ee.Reducer.mean(), 10);
  blocks = reduceGroup(MAX30, blocks, ee.Reducer.max(), 30);
  blocks = reduceGroup(MIN30, blocks, ee.Reducer.min(), 30);

  /* ---------- Steps 13 + 16: constraints, canopy track, fire years, flags ---------- */
  function num(f, p, d) {
    var v = f.get(p);
    return ee.Number(ee.Algorithms.If(ee.Algorithms.IsEqual(v, null), d, v));
  }
  var RUN_DATE = ee.Date(Date.now()).format('YYYY-MM-dd');

  blocks = blocks.map(function (f) {
    var area = ee.Number(f.get('block_area_ha'));
    var canopyMissing = ee.Algorithms.IsEqual(f.get('canopy_pct'), null);
    var canopy = num(f, 'canopy_pct', 0);
    var fr = num(f, 'constrained_frac', 0);

    var fireYears = ee.Number(0);
    LIB.FIRE_YEARS.forEach(function (y) { fireYears = fireYears.add(num(f, 'fire_' + y, 0)); });

    var exC1 = canopy.gte(40);
    var exFr = fr.gt(0.30);
    var excluded = exC1.or(exFr);

    var reasons = ee.List(['C2', 'C3', 'C4', 'C5', 'C6', 'C7'].map(function (c) {
      return ee.Algorithms.If(num(f, c + '_frac', 0).gte(CFG.REASON_MIN_FRAC), c, '');
    }));
    reasons = ee.List(ee.Algorithms.If(exC1, ee.List(['C1']).cat(reasons), reasons))
                .filter(ee.Filter.neq('item', ''));

    var access = ee.Algorithms.If(ee.Algorithms.IsEqual(f.get('access_m'), null), null,
                                  num(f, 'access_m', 0).divide(1000));

    return f.set({
      // block-level fixed-formula scores (Section 7.4 / 7.5)
      D1: ee.Number(40).subtract(canopy).divide(40).max(0).min(1),
      D1_raw: canopy,
      D4: num(f, 'D4_raw', 0).max(0).min(1),
      D5: num(f, 'D5_raw', 0).max(0).min(1),
      fire_years: fireYears,
      E1_raw: fireYears,
      E1: ee.Number(1).subtract(fireYears.divide(11)).max(0).min(1),
      // constraints and canopy track (Section 6)
      canopy_missing: ee.Algorithms.If(canopyMissing, 1, 0),
      excluded_c1: exC1,
      excluded: excluded,
      exclusion_reason: ee.Algorithms.If(exC1, 'C1', ee.Algorithms.If(exFr, 'C2-C7 > 30%', '')),
      constraint_flag: ee.Algorithms.If(exFr, 'excluded',
                         ee.Algorithms.If(fr.gte(0.10), 'partial', 'none')),
      constraint_reason: reasons.join(','),
      canopy_track: ee.Algorithms.If(exC1, 'EXCLUDED_C1',
                      ee.Algorithms.If(canopy.gte(10), 'GAP_ANR', 'FULL')),
      net_plantable_ha: ee.Algorithms.If(excluded, 0, area.multiply(ee.Number(1).subtract(fr))),
      // advisory flags (Section 6.4)
      recent_plantation_flag: ee.Algorithms.If(num(f, 'F1_frac', 0).gte(0.30).and(canopy.lt(40)), 'yes', 'no'),
      protected_area_flag: ee.Algorithms.If(num(f, 'pa', 0).gte(1), 'yes', 'no'),
      advisory_access_km: access,
      // audit trail
      anchor_id: ANCHOR_ID,
      dem_source: R.demSource,
      fire_source_gap: LIB.FIRE_SOURCE_GAP,
      model_version: CFG.MODEL_VERSION,
      range_name: CFG.RANGE_NAME,
      run_date: RUN_DATE,
      work_crs: CRS,
      n_blocks_grid: N_GRID,
      cs_threshold: CFG.CS_THRESHOLD,
      d2_window: CFG.D2_MONTHS.join('-'),
      a3_mask_trees: CFG.A3_MASK_TREES ? 'yes' : 'no',
      beat_field: BEAT_FIELD === null ? 'none' : BEAT_FIELD
    });
  });

  /* ---------- QC from script 01 (FF-01..05, FF-18, FF-19) ---------- */
  var ff04Bad = grid.filter(ee.Filter.eq('is_interior', 1))
    .filter(ee.Filter.or(ee.Filter.lt('block_area_ha', 9.99), ee.Filter.gt('block_area_ha', 10.01))).size();
  var ff05Null = N_GRID.subtract(grid.filter(ee.Filter.notNull(['beat_id'])).size());
  var pct5 = function (img) {
    return ee.Dictionary(img.reduceRegion({reducer: ee.Reducer.percentile([5]), geometry: AOI,
      scale: 100, crs: CRS, maxPixels: 1e10, tileScale: 4})).values().get(0);
  };
  var ff18A3 = pct5(R.A3_minObs.unmask(0));
  var ff18D5 = pct5(R.D5_minObs.unmask(0));
  var ff19 = ee.Dictionary(R.D2n.unmask(0).gte(8).reduceRegion({reducer: ee.Reducer.mean(),
    geometry: AOI, scale: 30, crs: CRS, maxPixels: 1e10, tileScale: 4})).values().get(0);

  var QC01 = ee.FeatureCollection([ee.Feature(AOI.centroid(1), {
    FF01_asset_log: CHECK.log,
    FF01_status: CHECK.ok ? 'PASS' : 'STOP',
    FF02_crs: CRS,
    FF02_status: FF02,
    FF03_scales: JSON.stringify(CHECK.scales),
    FF03_status: CHECK.ok ? 'PASS' : 'STOP',
    FF04_interior_blocks_out_of_tolerance: ff04Bad,
    FF05_null_beat: ff05Null,
    FF05_beat_field: BEAT_FIELD === null ? 'none (RANGE)' : BEAT_FIELD,
    FF18_A3_p5_min_clear_obs: ff18A3,
    FF18_D5_p5_min_clear_obs: ff18D5,
    FF18_cs_threshold: CFG.CS_THRESHOLD,
    FF19_share_pixels_8yrs: ff19,
    FF19_window: CFG.D2_MONTHS.join('-'),
    n_blocks_grid: N_GRID,
    anchor_id: ANCHOR_ID,
    anchor_mode: CFG.ANCHOR_MODE,
    dem_source: R.demSource,
    run_date: RUN_DATE
  })]);

  /* ---------- Step 17: EXPORT the raw block table — mandatory checkpoint ---------- */
  Export.table.toAsset({
    collection: blocks,
    description: 'PPI01_raw_blocks_to_asset',
    assetId: CFG.RAW_ASSET
  });
  Export.table.toAsset({
    collection: QC01,
    description: 'PPI01_qc01_to_asset',
    assetId: CFG.QC01_ASSET
  });
  Export.table.toDrive({
    collection: QC01,
    description: 'PPI01_qc01_csv',
    folder: CFG.DRIVE_FOLDER,
    fileNamePrefix: 'PPI01_qc01_' + CFG.RANGE_NAME,
    fileFormat: 'CSV'
  });
  // Product 8: constraint map. Bit code: 1 canopy>=40%, 2 C2 water, 4 C3 drain,
  // 8 C4 slope, 16 C5 built, 32 C6 crop, 64 C7 rock (values add up).
  Export.image.toDrive({
    image: R.constraintCode.clip(AOI),
    description: 'PPI01_constraint_map',
    folder: CFG.DRIVE_FOLDER,
    fileNamePrefix: 'PPI01_constraint_map_' + CFG.RANGE_NAME,
    region: AOI,
    crs: CRS,
    scale: 10,
    maxPixels: 1e11
  });

  print('====================================================================');
  print('NEXT: Tasks tab -> RUN ALL. When PPI01_raw_blocks_to_asset');
  print('and PPI01_qc01_to_asset have completed, press Run again (STEP 3).');
  print('Raw block asset:', CFG.RAW_ASSET);
  print('====================================================================');

  /* ---------- Map preview (tiles are computed on demand) ---------- */
  if (CFG.SHOW_MAP) {
    Map.centerObject(AOI, 11);
    // Layers are computed on fixed 10-30 m grids; zooming out further than level 10 would ask
    // the preview for > 16,000 px per tile ("Reprojection output too large"). Exports are unaffected.
    Map.setLocked(false, 10, 22);
    Map.addLayer(ee.Image().byte().paint(AOI_FC, 1, 2), {palette: ['black']}, 'Range boundary');
    Map.addLayer(ee.Image().byte().paint(grid, 1, 1), {palette: ['#555555']}, '10 ha blocks', true);
    // Preview layers avoid the 1.2 m canopy-height aggregation (too many pixels for a map tile);
    // the exports and block table use the full-resolution canopy.
    Map.addLayer(R.chm.gte(5).selfMask().clip(AOI), {palette: ['#1a9850']},
                 'Trees >= 5 m tall (Meta canopy height)', false);
    var consPreview = R.C2.multiply(2).add(R.C3.multiply(4)).add(R.C4.multiply(8))
      .add(R.C5.multiply(16)).add(R.C6.multiply(32)).add(R.C7.multiply(64)).selfMask();
    Map.addLayer(consPreview.clip(AOI), {min: 2, max: 64,
                 palette: ['#08519c', '#9e9ac8', '#e6550d', '#636363', '#fdae6b', '#8c510a']},
                 'Constraints C2-C7 (water, drain, steep, built, crop, rock)', false);
    var sc = {min: 0, max: 1, palette: ['#d73027', '#fee08b', '#1a9850']};   // red = low score, green = high
    [['A1', 'A1 Topographic wetness (CTI)'], ['A3', 'A3 Post-monsoon moisture'], ['A5', 'A5 Near seasonal water'],
     ['B1', 'B1 Soil depth proxy'], ['B2', 'B2 Soil texture'], ['B4', 'B4 Soil pH'], ['B7', 'B7 Rockiness (inverse)'],
     ['C1s', 'C1s Slope'], ['C2s', 'C2s Heat load (inverse)'], ['D2', 'D2 Degradation trend'],
     ['D3', 'D3 Biomass deficit'], ['E2', 'E2 Low biotic pressure'],
     ['E4', 'E4 Erosion risk']].forEach(function (p) {
      Map.addLayer(S[p[0]].clip(AOI), sc, 'Score ' + p[1], false);
    });
    print('Map: tick any "Score ..." layer in the Layers menu (top right) to view a parameter. ' +
          'Red = low score, green = high. Final categories appear in the next run, after the tasks finish.');
  }
  }
}

/* ######################################################################
 *  STEP 3 / 4 — SCORING, MONTE CARLO, QC, PUBLISH (spec build steps 18-25)
 * ###################################################################### */
function step3_scoring(stage) {
  var CFG = {
    STAGE: stage, CRS: SETTINGS.CRS, RANGE_NAME: SETTINGS.RANGE_NAME, AOI_ASSET: SETTINGS.AOI_ASSET,
    RAW_ASSET: ASSETS.RAW, QC01_ASSET: ASSETS.QC01, FINAL_ASSET: ASSETS.FINAL,
    DRIVE_FOLDER: SETTINGS.DRIVE_FOLDER,
    EXPECTED_ANCHOR_ID: SETTINGS.ANCHOR_MODE === 'ASSET' ? SETTINGS.ANCHOR_ID : null,
    WEIGHTS: SETTINGS.WEIGHTS, RX: SETTINGS.RX, SITE_SPLITS: [0.33, 0.66],
    MC_K: 500, MC_SEED: 2026, MC_CONC: 125,
    CV_MIN: 0.05, RHO_MAX: 0.75, VIF_MAX: 5, A3_RHO_MAX: 0.60, OAT_MAX_SHARE: 0.15
  };

  var THEMES = {
    A: ['A1', 'A2', 'A3', 'A5'],
    B: ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7'],
    C: ['C1s', 'C2s', 'C3s'],
    D: ['D1', 'D2', 'D3', 'D4', 'D5', 'D6'],
    E: ['E1', 'E2', 'E4']
  };
  var THEME_KEYS = ['A', 'B', 'C', 'D', 'E'];
  // evaluate() with up to 2 retries. make() builds a fresh request each time; the retry is
  // scheduled 2 s later, outside Earth Engine's reply handler (retrying inside it crashes the
  // Code Editor with "Cannot read properties of null (reading 'headerMap')").
  function evalRetry(make, cb, attempt) {
    attempt = attempt || 1;
    var answered = false;          // the Code Editor can call a callback twice after an error
    make().evaluate(function (val, err) {
      if (answered) { return; }
      answered = true;
      if (err && attempt < 3) {
        print('Request failed (' + err + ') - retrying (' + (attempt + 1) + '/3) ...');
        ui.util.setTimeout(function () { evalRetry(make, cb, attempt + 1); }, 2000);
        return;
      }
      cb(val, err);
    });
  }
  var PARAMS = [].concat(THEMES.A, THEMES.B, THEMES.C, THEMES.D, THEMES.E);   // 23
  var THEME_OF = {};
  THEME_KEYS.forEach(function (t) { THEMES[t].forEach(function (k) { THEME_OF[k] = t; }); });
  var THEME_PTS = {};
  THEME_KEYS.forEach(function (t) {
    THEME_PTS[t] = THEMES[t].reduce(function (s, k) { return s + CFG.WEIGHTS[k]; }, 0);
  });
  var PALETTE = ['#d73027', '#fc8d59', '#fee08b', '#d9ef8b', '#1a9850'];
  var RX_CODES = {
    PROTECT_DENSE: 1, NOT_PLANTABLE: 2, FIRE_PROTECTION_FIRST: 3, SMC_FIRST: 4,
    INVASIVE_CLEAR_THEN_PLANT: 5, GAP_PLANTING_ANR: 6, FULL_PLANTATION: 7
  };
  var RX_PALETTE = ['#1a9850', '#969696', '#e31a1c', '#8c510a', '#984ea3', '#80cdc1', '#2166ac'];
  var AOI_FC = ee.FeatureCollection(CFG.AOI_ASSET);
  var AOI = AOI_FC.geometry().dissolve({maxError: 1});

  /* ---------- Publishing: maps, legend, GeoTIFF/SHP/GeoJSON, field list ---------- */
  function publishAll(fin, mapFC) {
    mapFC = mapFC || fin;
  var CRS = CFG.CRS;
  print('Working CRS:', CRS, '| recorded in table:', ee.Feature(fin.first()).get('work_crs'));
  var tag2 = CFG.RANGE_NAME;

  function blockRaster(prop, src) { return (src || mapFC).reduceToImage([prop], ee.Reducer.first()).rename(prop); }
  var catImg = blockRaster('category').toByte();
  var rxImg = blockRaster('rx_code').toByte();
  var stabImg = blockRaster('stability_cat12', fin).toFloat();

  /* ---- GeoTIFFs (products 4-7) ---- */
  function exportImg(img, name, scale) {
    Export.image.toDrive({image: img.clip(AOI), description: 'PPI02_' + name, folder: CFG.DRIVE_FOLDER,
      fileNamePrefix: 'PPI02_' + name + '_' + tag2, region: AOI, crs: CRS, scale: scale, maxPixels: 1e11});
  }
  exportImg(catImg, 'category_map', 30);
  exportImg(rxImg, 'prescription_map', 30);
  exportImg(stabImg, 'stability_map', 30);
  THEME_KEYS.forEach(function (t) { exportImg(blockRaster(t).toFloat(), 'theme_' + t + '_map', 30); });

  /* ---- Block polygons: GeoJSON (all fields) + SHP (short field names) ---- */
  Export.table.toDrive({collection: fin, description: 'PPI02_blocks_geojson', folder: CFG.DRIVE_FOLDER,
    fileNamePrefix: 'PPI02_blocks_' + tag2, fileFormat: 'GeoJSON'});
  var SHP_FROM = ['block_id', 'beat_id', 'block_area_ha', 'net_plantable_ha', 'canopy_pct', 'canopy_track',
    'constraint_flag', 'constraint_reason', 'A', 'B', 'C', 'D', 'E', 'PPI_absolute', 'PPI_percentile',
    'category', 'prescription', 'site_class', 'stability_cat12', 'category_modal', 'category_range',
    'b1_sensitive', 'recent_plantation_flag', 'protected_area_flag', 'fire_years', 'advisory_access_km',
    'field_check', 'anchor_id'];
  var SHP_TO = ['block_id', 'beat_id', 'area_ha', 'net_ha', 'canopy', 'can_track',
    'cons_flag', 'cons_rsn', 'A', 'B', 'C', 'D', 'E', 'ppi_abs', 'ppi_pct',
    'category', 'rx', 'site_cls', 'stab12', 'cat_modal', 'cat_range',
    'b1_sens', 'f1_plant', 'f2_pa', 'fire_yrs', 'access_km',
    'field_chk', 'anchor_id'];
  Export.table.toDrive({collection: fin.select(SHP_FROM, SHP_TO), description: 'PPI02_blocks_shp',
    folder: CFG.DRIVE_FOLDER, fileNamePrefix: 'PPI02_blocks_' + tag2, fileFormat: 'SHP'});

  /* ---- Product 10: field-check list, sorted by beat ---- */
  var FIELD_COLS = ['beat_id', 'block_id', 'category', 'PPI_absolute', 'stability_cat12', 'stability_reading',
    'prescription', 'site_class', 'net_plantable_ha', 'canopy_pct', 'constraint_reason',
    'recent_plantation_flag', 'protected_area_flag', 'b1_sensitive', 'field_check_reason',
    'fra_rights_check_required', 'staff_rights_FRA_checked', 'staff_encroachment_checked', 'staff_decision', 'staff_remarks'];
  var fieldList = fin.filter(ee.Filter.eq('field_check', 'yes'))
    .map(function (f) {
      var c = f.centroid(1).geometry().coordinates();
      return f.set({staff_rights_FRA_checked: '', staff_encroachment_checked: '',
                    staff_decision: '', staff_remarks: '',
                    lon: c.get(0), lat: c.get(1)});
    })
    .sort('category').sort('beat_id');
  Export.table.toDrive({collection: fieldList, description: 'PPI02_field_check_list',
    folder: CFG.DRIVE_FOLDER, fileNamePrefix: 'PPI02_field_check_list_' + tag2, fileFormat: 'CSV',
    selectors: FIELD_COLS.concat(['lon', 'lat'])});

  /* ---- Presentation map: styled blocks, relief, layer switcher, legend with areas,
          click-to-inspect block card, print-quality exports ---- */
  var CAT_LABELS = ['Highest priority', 'High priority', 'Moderate (phased)', 'Low priority',
                    'No plantation / excluded'];
  var RX_ORDER = ['FULL_PLANTATION', 'GAP_PLANTING_ANR', 'INVASIVE_CLEAR_THEN_PLANT', 'SMC_FIRST',
                  'FIRE_PROTECTION_FIRST', 'PROTECT_DENSE', 'NOT_PLANTABLE'];
  var RX_LABELS = {
    FULL_PLANTATION: 'Full plantation', GAP_PLANTING_ANR: 'Gap planting + ANR',
    INVASIVE_CLEAR_THEN_PLANT: 'Clear invasives, then plant', SMC_FIRST: 'Soil & moisture works first',
    FIRE_PROTECTION_FIRST: 'Fire protection first', PROTECT_DENSE: 'Protect (dense forest)',
    NOT_PLANTABLE: 'Not plantable'
  };
  var THEME_NAMES = {A: 'A  Moisture', B: 'B  Soil', C: 'C  Terrain', D: 'D  Restoration need', E: 'E  Risk (high = low risk)'};
  var GRAD = ['#7f2704', '#d94801', '#fdae6b', '#fff5eb', '#c7e9c0', '#41ab5d', '#00441b'];   // low -> high score

  // Block polygons filled by a palette; white outlines keep every 10 ha block readable.
  function styledBlocks(prop, palette, alpha) {
    var pal = ee.List(palette.map(function (c) { return c.replace('#', '') + alpha; }));
    return mapFC.map(function (f) {
      var i = ee.Number(f.get(prop)).int().subtract(1);
      return f.set('style', ee.Dictionary({color: 'ffffffcc', width: 0.6, fillColor: pal.get(i)}));
    }).style({styleProperty: 'style'});
  }
  var catVis = styledBlocks('category', PALETTE, 'e6');
  var rxVis = styledBlocks('rx_code', RX_PALETTE, 'e6');
  var outlineVis = ee.Image().byte().paint(mapFC, 1, 0.6).visualize({palette: ['ffffff'], opacity: 0.8});
  function rasterVis(img, palette) {
    return img.visualize({min: 0, max: 1, palette: palette, opacity: 0.9}).blend(outlineVis);
  }

  // Relief and focus: hillshade from FABDEM, everything outside the range dimmed.
  var fabCol = ee.ImageCollection('projects/sat-io/open-datasets/FABDEM').filterBounds(AOI);
  var fab = fabCol.mosaic().setDefaultProjection(ee.Image(fabCol.first()).projection()).select([0]);
  var hillshade = ee.Terrain.hillshade(fab, 315, 35).visualize({min: 120, max: 255, palette: ['000000', 'ffffff']});
  var inside = ee.Image(1).clip(AOI).mask();
  var dimOutside = ee.Image(0).updateMask(inside.not()).visualize({palette: ['000000'], opacity: 0.55});
  var boundaryVis = ee.Image().byte().paint(AOI_FC, 1, 2.5).visualize({palette: ['ffff00']});

  Map.clear();
  Map.setOptions('HYBRID');
  Map.setControlVisibility({all: true});
  Map.centerObject(AOI, 12);
  Map.addLayer(hillshade.updateMask(inside), {opacity: 0.45}, 'Relief (FABDEM hillshade)');
  Map.addLayer(dimOutside, {}, 'Outside range (dimmed)');
  Map.addLayer(catVis, {}, 'PPI category 1-5');                       // layer index 2: main layer
  Map.addLayer(boundaryVis, {}, 'Range boundary');
  Map.addLayer(ee.Image(), {}, 'Selected block', false);               // index 4: click highlight

  /* ---- Title, north arrow ---- */
  var subtitle = ui.Label('Sabarkantha Division, Gujarat  ·  PPI-SK v2.1  ·  10 ha blocks',
                          {fontSize: '12px', color: '#444444', margin: '2px 0 0 0'});
  Map.add(ui.Panel([
    ui.Label('Plantation Priority Index — ' + CFG.RANGE_NAME + ' Range',
             {fontWeight: 'bold', fontSize: '18px', margin: '0'}),
    subtitle
  ], ui.Panel.Layout.flow('vertical'), {position: 'top-center', padding: '6px 14px'}));
  Map.add(ui.Panel([ui.Label('▲', {fontSize: '20px', margin: '0 0 -6px 0', textAlign: 'center', stretch: 'horizontal'}),
                    ui.Label('N', {fontWeight: 'bold', fontSize: '14px', margin: '0', textAlign: 'center', stretch: 'horizontal'})],
                   ui.Panel.Layout.flow('vertical'), {position: 'top-right', padding: '2px 8px', width: '44px'}));

  /* ---- Legend (rebuilt when the layer changes), with blocks and hectares per class ---- */
  var legend = ui.Panel({style: {position: 'bottom-left', padding: '8px 12px', width: '330px'}});
  var STATS = null;   // filled asynchronously
  function fmt(n) { return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function swatchRow(color, label, extra) {
    return ui.Panel([
      ui.Label('', {backgroundColor: color, padding: '9px', margin: '2px 8px 2px 0', border: '1px solid #ffffff'}),
      ui.Label(label, {margin: '3px 0', fontSize: '12px', stretch: 'horizontal'}),
      ui.Label(extra || '', {margin: '3px 0', fontSize: '11px', color: '#555555'})
    ], ui.Panel.Layout.flow('horizontal'));
  }
  function gradientBar(palette, lo, hi) {
    var bar = ui.Thumbnail({image: ee.Image.pixelLonLat().select(0),
      params: {bbox: [0, 0, 1, 0.1], dimensions: '260x14', format: 'png', min: 0, max: 1, palette: palette},
      style: {stretch: 'horizontal', margin: '4px 0', maxHeight: '18px'}});
    return [bar, ui.Panel([ui.Label(lo, {fontSize: '11px', margin: '0'}),
                           ui.Label(hi, {fontSize: '11px', margin: '0 0 0 auto', textAlign: 'right', stretch: 'horizontal'})],
                          ui.Panel.Layout.flow('horizontal'))];
  }
  function areaText(group, key) {
    if (!STATS || !STATS[group][key]) { return ''; }
    var s = STATS[group][key];
    return s.n + ' blocks · ' + fmt(s.ha) + ' ha';
  }
  var MODES = {
    'Priority category (1-5)': function () {
      legend.add(ui.Label('Plantation priority category', {fontWeight: 'bold', fontSize: '13px', margin: '0 0 4px 0'}));
      CAT_LABELS.forEach(function (l, i) { legend.add(swatchRow(PALETTE[i], (i + 1) + '  ' + l, areaText('cat', String(i + 1)))); });
      legend.add(ui.Label('Hectares = net plantable area after constraints.', {fontSize: '10px', color: '#666666'}));
      return catVis;
    },
    'Treatment prescription': function () {
      legend.add(ui.Label('Treatment prescription', {fontWeight: 'bold', fontSize: '13px', margin: '0 0 4px 0'}));
      RX_ORDER.forEach(function (k) { legend.add(swatchRow(RX_PALETTE[RX_CODES[k] - 1], RX_LABELS[k], areaText('rx', k))); });
      return rxVis;
    },
    'Reliability (Monte Carlo stability)': function () {
      legend.add(ui.Label('Share of 500 weight draws in Category 1-2', {fontWeight: 'bold', fontSize: '13px'}));
      gradientBar(['#d73027', '#ffffbf', '#1a9850'], '0 % (marginal)', '100 % (robust)').forEach(function (w) { legend.add(w); });
      return rasterVis(blockRaster('stability_cat12', fin), ['d73027', 'ffffbf', '1a9850']);
    }
  };
  THEME_KEYS.forEach(function (t) {
    MODES['Theme ' + THEME_NAMES[t]] = function () {
      legend.add(ui.Label('Theme score ' + THEME_NAMES[t], {fontWeight: 'bold', fontSize: '13px'}));
      gradientBar(GRAD, 'Low (0)', 'High (1)').forEach(function (w) { legend.add(w); });
      return rasterVis(blockRaster(t), GRAD.map(function (c) { return c.replace('#', ''); }));
    };
  });
  var currentMode = 'Priority category (1-5)';
  function showMode(name) {
    currentMode = name;
    legend.clear();
    var img = MODES[name]();
    Map.layers().set(2, ui.Map.Layer(img, {}, name));
  }
  var selector = ui.Select({items: Object.keys(MODES), value: currentMode, onChange: showMode,
                            style: {stretch: 'horizontal'}});
  Map.add(ui.Panel([ui.Label('Map layer', {fontWeight: 'bold', fontSize: '12px', margin: '4px 0 0 0'}), selector],
                   ui.Panel.Layout.flow('vertical'), {position: 'top-left', width: '270px', padding: '4px 8px'}));
  Map.add(legend);
  showMode(currentMode);

  /* ---- Area statistics (async) -> legend numbers + coloured chart in the Console ---- */
  evalRetry(function () {
    var byCat = mapFC.reduceColumns(ee.Reducer.sum().repeat(2).group({groupField: 2, groupName: 'k'}),
                                    ['net_plantable_ha', 'block_area_ha', 'category']);
    var byRx = mapFC.reduceColumns(ee.Reducer.sum().repeat(2).group({groupField: 2, groupName: 'k'}),
                                   ['net_plantable_ha', 'block_area_ha', 'prescription']);
    return ee.Dictionary({cat: byCat.get('groups'), rx: byRx.get('groups'),
                          catN: mapFC.aggregate_histogram('category'), rxN: mapFC.aggregate_histogram('prescription'),
                          anchor: ee.Feature(mapFC.first()).get('anchor_id')});
  }, function (d, err) {
    if (err) { print('Area summary could not be computed: ' + err); return; }
    STATS = {cat: {}, rx: {}};
    d.cat.forEach(function (g) { STATS.cat[String(g.k)] = {ha: g.sum[0], area: g.sum[1], n: d.catN[String(g.k)] || 0}; });
    d.rx.forEach(function (g) { STATS.rx[g.k] = {ha: g.sum[0], area: g.sum[1], n: d.rxN[g.k] || 0}; });
    subtitle.setValue('Sabarkantha Division, Gujarat  ·  PPI-SK v2.1  ·  10 ha blocks  ·  anchors: ' + d.anchor);
    showMode(currentMode);
    var rowsC = [['Category', 'Net plantable ha', {role: 'style'}, {role: 'annotation'}]];
    [1, 2, 3, 4, 5].forEach(function (c) {
      var s = STATS.cat[String(c)] || {ha: 0, n: 0};
      rowsC.push([c + ' ' + CAT_LABELS[c - 1], s.ha, PALETTE[c - 1], fmt(s.ha) + ' ha']);
    });
    print(ui.Chart(rowsC, 'BarChart', {title: 'Net plantable area by priority category (ha)', legend: {position: 'none'},
                                       hAxis: {title: 'hectares'}, chartArea: {left: 170}}));
    var rowsR = [['Treatment', 'Net plantable ha', {role: 'style'}, {role: 'annotation'}]];
    RX_ORDER.forEach(function (k) {
      var s = STATS.rx[k] || {ha: 0, n: 0};
      rowsR.push([RX_LABELS[k], s.ha, RX_PALETTE[RX_CODES[k] - 1], fmt(s.ha) + ' ha']);
    });
    print(ui.Chart(rowsR, 'BarChart', {title: 'Net plantable area by treatment (ha)', legend: {position: 'none'},
                                       hAxis: {title: 'hectares'}, chartArea: {left: 190}}));
  });

  /* ---- Click a block: info card + highlight ---- */
  var card = ui.Panel({style: {position: 'bottom-right', width: '300px', padding: '8px 10px', shown: false}});
  Map.add(card);
  var clickId = 0;
  function cardRow(label, value) {
    return ui.Panel([ui.Label(label, {fontSize: '11px', color: '#555555', margin: '1px 0', width: '120px'}),
                     ui.Label(String(value), {fontSize: '12px', margin: '1px 0', stretch: 'horizontal'})],
                    ui.Panel.Layout.flow('horizontal'));
  }
  function themeBar(name, v) {
    var w = Math.max(2, Math.round((v || 0) * 150));
    var col = v >= 0.66 ? '#1a9850' : (v >= 0.33 ? '#fee08b' : '#d73027');
    return ui.Panel([ui.Label(name, {fontSize: '11px', margin: '2px 0', width: '120px'}),
                     ui.Label('', {backgroundColor: col, padding: '5px ' + (w / 2) + 'px', margin: '4px 6px 0 0'}),
                     ui.Label((v || 0).toFixed(2), {fontSize: '11px', margin: '2px 0'})],
                    ui.Panel.Layout.flow('horizontal'));
  }
  Map.style().set('cursor', 'crosshair');
  Map.onClick(function (c) {
    var my = ++clickId;
    var pt = ee.Geometry.Point([c.lon, c.lat]);
    var hit = mapFC.filterBounds(pt);
    card.clear();
    card.style().set('shown', true);
    card.add(ui.Label('Loading block ...', {fontSize: '12px', color: '#666666'}));
    Map.layers().set(4, ui.Map.Layer(ee.Image().byte().paint(hit, 1, 3).visualize({palette: ['00ffff']}), {}, 'Selected block'));
    evalRetry(function () {
      var f = ee.Feature(hit.first());
      return ee.Dictionary({n: hit.size(), p: ee.Algorithms.If(hit.size().gt(0), f.toDictionary(), null)});
    }, function (d, err) {
      if (my !== clickId) { return; }
      card.clear();
      if (err || !d || !d.n) { card.add(ui.Label('No block here. Click inside the range.', {fontSize: '12px'})); return; }
      var p = d.p;
      var cat = p.category;
      card.add(ui.Label('Block ' + p.block_id, {fontWeight: 'bold', fontSize: '14px', margin: '0 0 4px 0'}));
      card.add(swatchRow(PALETTE[cat - 1], 'Category ' + cat + ' — ' + CAT_LABELS[cat - 1], ''));
      card.add(cardRow('Treatment', RX_LABELS[p.prescription] || p.prescription));
      card.add(cardRow('PPI (absolute)', p.excluded === 1 ? 'excluded' : Number(p.PPI_absolute).toFixed(3)));
      card.add(cardRow('Percentile in range', p.excluded === 1 ? '-' : Math.round(p.PPI_percentile) + ' %'));
      card.add(cardRow('Net plantable', Number(p.net_plantable_ha).toFixed(2) + ' of ' + Number(p.block_area_ha).toFixed(2) + ' ha'));
      card.add(cardRow('Canopy cover', Number(p.canopy_pct).toFixed(1) + ' %  (' + p.canopy_track + ')'));
      card.add(cardRow('Site class', p.site_class || '-'));
      card.add(cardRow('Constraints', p.constraint_reason || 'none'));
      card.add(cardRow('Fire years 2015-25', p.fire_years));
      card.add(cardRow('Flags', ['recent_plantation_flag', 'protected_area_flag'].filter(function (k) { return p[k] === 'yes'; })
                                 .map(function (k) { return k === 'recent_plantation_flag' ? 'F1 recent plantation?' : 'F2 protected area'; })
                                 .join(', ') || 'none'));
      var stabRow = cardRow('Reliability', 'computing ...');
      card.add(stabRow);
      card.add(ui.Label('Theme scores', {fontWeight: 'bold', fontSize: '12px', margin: '6px 0 2px 0'}));
      THEME_KEYS.forEach(function (t) { card.add(themeBar(THEME_NAMES[t], p[t])); });
      card.add(ui.Label('Location: ' + c.lat.toFixed(5) + ' N, ' + c.lon.toFixed(5) + ' E',
                        {fontSize: '10px', color: '#666666', margin: '6px 0 0 0'}));
      // Monte Carlo stability comes from the full table (may take a few seconds in the scoring run)
      evalRetry(function () { return ee.Feature(fin.filterBounds(pt).first()).get('stability_cat12'); }, function (s, e2) {
        if (my !== clickId) { return; }
        var txt = (e2 || s === null || s === undefined) ? 'n/a' :
          Math.round(s * 100) + ' % of runs in Cat 1-2' + (p.category <= 2 ? (s > 0.8 ? ' (robust)' : (s >= 0.5 ? ' (moderate)' : ' (marginal)')) : '');
        stabRow.widgets().get(1).setValue(txt);
      });
    });
  });
  print('MAP: choose a layer in "Map layer" (top left). Click any block for its details.');

  /* ---- Print-quality maps (5 m RGB GeoTIFF, block polygons over relief) ---- */
  var printRegion = AOI.bounds(1).buffer(1500, 10);
  [['category', catVis], ['prescription', rxVis]].forEach(function (x) {
    var img = hillshade.blend(x[1]).blend(boundaryVis).clip(printRegion);
    Export.image.toDrive({image: img, description: 'PPI02_print_' + x[0] + '_RGB', folder: CFG.DRIVE_FOLDER,
      fileNamePrefix: 'PPI02_print_' + x[0] + '_RGB_' + tag2, region: printRegion, crs: CRS, scale: 5, maxPixels: 1e11});
  });
  // Instant PNG download link for slides
  hillshade.blend(catVis).blend(boundaryVis).getThumbURL({region: printRegion, dimensions: 2048, format: 'png', crs: CRS},
    function (url, e3) {
      if (!e3 && url) { print(ui.Label('Download category map PNG (2048 px) for slides', {color: '#1a73e8'}, url)); }
    });
  print('Field-check blocks:', fieldList.size());
  }

  /* ====================================================================== */
  if (CFG.STAGE === 'SCORE') {
  /* ====================================================================== */

  var raw = ee.FeatureCollection(CFG.RAW_ASSET);
  var N_ALL = raw.size();
  var FILL_KEYS = PARAMS.concat(['B1_opt', 'B1_pes']);

  /* ---------- Step 18a: null shares (FF-06) and gap fill by beat mean ---------- */
  var nullShare = ee.Dictionary.fromLists(FILL_KEYS, FILL_KEYS.map(function (k) {
    return ee.Number(1).subtract(raw.filter(ee.Filter.notNull([k])).size().divide(N_ALL));
  }));

  var BEAT_MEAN = {}, RANGE_MEAN = {};
  FILL_KEYS.forEach(function (k) {
    var ok = raw.filter(ee.Filter.notNull([k]));
    var groups = ee.List(ok.reduceColumns(
      ee.Reducer.mean().group({groupField: 1, groupName: 'beat'}), [k, 'beat_id']).get('groups'));
    BEAT_MEAN[k] = ee.Dictionary.fromLists(
      groups.map(function (g) { return ee.String(ee.Dictionary(g).get('beat')); }),
      groups.map(function (g) { return ee.Dictionary(g).get('mean'); }));
    RANGE_MEAN[k] = ee.Algorithms.If(ok.size().gt(0), ok.aggregate_mean(k), 0.5);
  });

  var filled = raw.map(function (f) {
    var beat = ee.String(f.get('beat_id'));
    var out = f;
    var log = ee.List([]);
    FILL_KEYS.forEach(function (k) {
      var v = f.get(k);
      var isNull = ee.Algorithms.IsEqual(v, null);
      out = out.set(k, ee.Algorithms.If(isNull, BEAT_MEAN[k].get(beat, RANGE_MEAN[k]), v));
      log = ee.List(ee.Algorithms.If(isNull, log.add(k), log));
    });
    return out.set('gapfilled', log.join(','));
  });
  var retained0 = filled.filter(ee.Filter.eq('excluded', 0));

  /* ---------- Step 18b: CV guard statistics (FF-10) ---------- */
  var statD = {};
  PARAMS.forEach(function (k) {
    statD[k + '_mean'] = retained0.aggregate_mean(k);
    statD[k + '_sd'] = retained0.aggregate_sample_sd(k);
  });
  print('Computing block statistics in the background ...');
  evalRetry(function () {
    return ee.Dictionary({N_all: N_ALL, N_ret: retained0.size(), nullShare: nullShare,
                          stats: ee.Dictionary(statD)});
  }, function (STATS, errS) {
  if (errS) { print('STOP: could not read the raw block table (has STEP 2 finished?): ' + errS); return; }
  print('Blocks: all =', STATS.N_all, ' retained =', STATS.N_ret);
  var NR = STATS.N_ret;
  if (NR < 10) { print('STOP: fewer than 10 retained blocks — check the raw table.'); return; }

  function sdOf(k) { var v = STATS.stats[k + '_sd']; return (typeof v === 'number') ? v : 0; }
  function meanOf(k) { var v = STATS.stats[k + '_mean']; return (typeof v === 'number') ? v : 0; }
  var VARYING = PARAMS.filter(function (k) { return sdOf(k) > 1e-9; });

  /* ---------- Step 18c: Spearman rho for all pairs + VIF (FF-11..14) ---------- */
  var PAIRS = [];
  for (var i = 0; i < PARAMS.length; i++) {
    for (var j = i + 1; j < PARAMS.length; j++) { PAIRS.push([PARAMS[i], PARAMS[j]]); }
  }
  PAIRS.push(['A3', 'canopy_pct']);
  PAIRS.push(['A3', 'D5_raw']);
  // One small download of the block table (retained blocks x 25 values); Spearman rho (average
  // ranks for ties) and VIF are then computed here in the Code Editor. 255 server-side
  // reductions in one request were too heavy and timed out.
  var COLKEYS = PARAMS.concat(['canopy_pct', 'D5_raw']);
  print('Computing Spearman correlations and VIF ...');
  evalRetry(function () {
    return retained0.filter(ee.Filter.notNull(COLKEYS))
      .reduceColumns(ee.Reducer.toList(COLKEYS.length), COLKEYS).get('list');
  }, function (ROWS, errC) {
  if (errC) { print('STOP: could not read the block table for the collinearity screen: ' + errC); return; }
  function column(k) { var c = COLKEYS.indexOf(k); return ROWS.map(function (r) { return Number(r[c]); }); }
  function avgRanks(x) {                  // ranks 1..n, ties get their average rank
    var idx = x.map(function (v, i) { return i; }).sort(function (a, b) { return x[a] - x[b]; });
    var r = new Array(x.length), i = 0;
    while (i < idx.length) {
      var j = i;
      while (j + 1 < idx.length && x[idx[j + 1]] === x[idx[i]]) { j++; }
      for (var t = i; t <= j; t++) { r[idx[t]] = (i + j) / 2 + 1; }
      i = j + 1;
    }
    return r;
  }
  function pearson(a, b) {
    var n = a.length, ma = 0, mb = 0, sab = 0, saa = 0, sbb = 0, i;
    for (i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
    ma /= n; mb /= n;
    for (i = 0; i < n; i++) { sab += (a[i] - ma) * (b[i] - mb); saa += (a[i] - ma) * (a[i] - ma); sbb += (b[i] - mb) * (b[i] - mb); }
    return (saa > 0 && sbb > 0) ? sab / Math.sqrt(saa * sbb) : null;
  }
  var RANKS = {};
  COLKEYS.forEach(function (k) { RANKS[k] = avgRanks(column(k)); });
  var RHO = {};
  PAIRS.forEach(function (p) {
    var v = (sdOf(p[0]) <= 1e-9 || (PARAMS.indexOf(p[1]) >= 0 && sdOf(p[1]) <= 1e-9)) ? null
            : pearson(RANKS[p[0]], RANKS[p[1]]);
    RHO[p[0] + '|' + p[1]] = (typeof v === 'number' && isFinite(v)) ? v : null;
  });
  function rho(a, b) {
    var v = RHO[a + '|' + b];
    if (v === undefined) { v = RHO[b + '|' + a]; }
    return (v === undefined) ? null : v;
  }
  // VIF_i = diag(inverse correlation matrix)_i = 1/(1-R2_i) of parameter i regressed on the others.
  var VIF = {};
  (function () {
    var cols = VARYING.map(column), m = cols.length, a, i, j, k;
    var Rm = [];
    for (i = 0; i < m; i++) { Rm.push([]); for (j = 0; j < m; j++) { Rm[i].push(i === j ? 1 : (pearson(cols[i], cols[j]) || 0)); } }
    a = Rm.map(function (row, r) { return row.concat(Rm.map(function (x, c) { return c === r ? 1 : 0; })); });
    var singular = false;
    for (i = 0; i < m; i++) {                               // Gauss-Jordan with partial pivoting
      var piv = i;
      for (k = i + 1; k < m; k++) { if (Math.abs(a[k][i]) > Math.abs(a[piv][i])) { piv = k; } }
      if (Math.abs(a[piv][i]) < 1e-10) { singular = true; break; }
      var tmp = a[i]; a[i] = a[piv]; a[piv] = tmp;
      var d = a[i][i];
      for (j = 0; j < 2 * m; j++) { a[i][j] /= d; }
      for (k = 0; k < m; k++) {
        if (k === i) { continue; }
        var f = a[k][i];
        for (j = 0; j < 2 * m; j++) { a[k][j] -= f * a[i][j]; }
      }
    }
    VARYING.forEach(function (key, ii) { VIF[key] = singular ? Infinity : a[ii][m + ii]; });
  })();
  print('Collinearity screen done on ' + ROWS.length + ' blocks.');

  /* ---------- Step 19: apply CV / collinearity weight changes (FF-07) ---------- */
  var W = {};
  PARAMS.forEach(function (k) { W[k] = CFG.WEIGHTS[k]; });
  var CV_LOG = [], COL_LOG = [], DROPPED = {};
  function shareWithinTheme(k, pts, exclude) {
    var t = THEME_OF[k];
    var others = THEMES[t].filter(function (o) { return o !== k && !DROPPED[o] && exclude.indexOf(o) < 0 && W[o] > 0; });
    var tot = others.reduce(function (s, o) { return s + W[o]; }, 0);
    if (tot <= 0) { return false; }
    others.forEach(function (o) { W[o] += pts * W[o] / tot; });
    return true;
  }
  // CV guard (Section 8.3)
  PARAMS.forEach(function (k) {
    var m = meanOf(k), sd = sdOf(k);
    var cv = (Math.abs(m) > 1e-12) ? sd / Math.abs(m) : (sd > 0 ? Infinity : 0);
    if (cv < CFG.CV_MIN && W[k] > 0) {
      var pts = W[k];
      DROPPED[k] = true;
      if (shareWithinTheme(k, pts, [])) {
        W[k] = 0;
        CV_LOG.push(k + ' CV=' + cv.toFixed(4) + ' -> ' + pts.toFixed(2) + ' pts shared in theme ' + THEME_OF[k]);
      } else {
        DROPPED[k] = false;
        CV_LOG.push(k + ' CV=' + cv.toFixed(4) + ' but no other parameter in theme — kept');
      }
    }
  });
  // FF-11 A3 phenology
  var rA3c = rho('A3', 'canopy_pct'), rA3d = rho('A3', 'D5_raw');
  var FF11 = ((rA3c === null || Math.abs(rA3c) < CFG.A3_RHO_MAX) &&
              (rA3d === null || Math.abs(rA3d) < CFG.A3_RHO_MAX)) ? 'PASS' : 'FAIL';
  // FF-12 B1 vs C1s
  var r12 = rho('B1', 'C1s');
  var FF12 = 'PASS';
  if (r12 !== null && Math.abs(r12) >= CFG.RHO_MAX) {
    FF12 = 'ACTION';
    var mv = Math.min(2, W.C1s);
    W.C1s -= mv; W.C2s += mv;
    COL_LOG.push('FF-12 rho(B1,C1s)=' + r12.toFixed(3) + ': C1s -' + mv + ' pts, C2s +' + mv);
  }
  // FF-13 D1 vs D3
  var r13 = rho('D1', 'D3');
  var FF13 = 'PASS';
  if (r13 !== null && Math.abs(r13) >= CFG.RHO_MAX) {
    FF13 = 'ACTION';
    var d13 = W.D1 + W.D3;
    var comp = Math.max(d13 - 2, 0);
    W.D1 = W.D1 * comp / d13; W.D3 = W.D3 * comp / d13; W.D6 += d13 - comp;
    COL_LOG.push('FF-13 rho(D1,D3)=' + r13.toFixed(3) + ': D1+D3 merged to ' + comp.toFixed(2) +
                 ' pts (canopy-biomass deficit), D6 +' + (d13 - comp).toFixed(2));
  }
  // FF-14 any other pair / VIF
  var FF14 = 'PASS';
  var FF14_PAIRS = [];
  PAIRS.forEach(function (p) {
    if (PARAMS.indexOf(p[1]) < 0) { return; }
    var key = p[0] + '|' + p[1];
    if (key === 'B1|C1s' || key === 'D1|D3') { return; }
    var r = RHO[key];
    if (r === null || Math.abs(r) <= CFG.RHO_MAX) { return; }
    FF14 = 'ACTION';
    FF14_PAIRS.push(key + '=' + r.toFixed(3));
    var a = p[0], b = p[1];
    if (THEME_OF[a] === THEME_OF[b] && W[a] + W[b] > 0) {
      var hi = Math.max(W[a], W[b]), sum = W[a] + W[b], freed = sum - hi;
      W[a] = W[a] * hi / sum; W[b] = W[b] * hi / sum;
      var shared = shareWithinTheme(a, freed, [b]);
      if (!shared) { W[a] += freed * W[a] / hi; W[b] += freed * W[b] / hi; }
      COL_LOG.push('FF-14 ' + key + ' rho=' + r.toFixed(3) + ': merged into composite worth ' +
                   hi.toFixed(2) + ' pts' + (shared ? ', ' + freed.toFixed(2) + ' pts shared in theme' : ''));
    } else {
      COL_LOG.push('FF-14 ' + key + ' rho=' + r.toFixed(3) + ': different themes — REVIEW weights manually');
    }
  });
  VARYING.forEach(function (k) {
    if (typeof VIF[k] === 'number' && VIF[k] > CFG.VIF_MAX) {
      FF14 = 'ACTION';
      COL_LOG.push('FF-14 VIF(' + k + ')=' + VIF[k].toFixed(2) + ' > ' + CFG.VIF_MAX + ': REVIEW');
    }
  });
  // FF-07 weight sums
  var wSum = PARAMS.reduce(function (s, k) { return s + W[k]; }, 0);
  var FF07 = Math.abs(wSum - 100) < 1e-6 ? 'PASS' : 'FAIL';
  THEME_KEYS.forEach(function (t) {
    var s = THEMES[t].reduce(function (a, k) { return a + W[k]; }, 0);
    if (Math.abs(s - THEME_PTS[t]) > 1e-6) { FF07 = 'FAIL'; }
  });
  if (FF07 === 'FAIL') { print('FF-07 STOP: weights do not sum to 100 / theme totals.'); return; }

  var CV_REWEIGHT_LOG = CV_LOG.length ? CV_LOG.join(' | ') : 'none';
  print('Final sub-weights (after CV guard / collinearity):', W);
  print('CV guard log:', CV_REWEIGHT_LOG);
  print('Collinearity log:', COL_LOG.length ? COL_LOG : 'none');

  /* ---------- Step 20: theme scores and PPI (Section 10) ---------- */
  var TW = {};   // theme weights as fractions
  THEME_KEYS.forEach(function (t) { TW[t] = THEME_PTS[t] / 100; });
  function coefFrom(tw) {
    var ab = tw.A + tw.B, cde = tw.C + tw.D + tw.E;
    return {a: 0.65 * tw.A / ab, b: 0.65 * tw.B / ab,
            cC: 0.45 * tw.C / cde, cD: 0.45 * tw.D / cde, cE: 0.45 * tw.E / cde};
  }
  var BASE = coefFrom(TW);
  print('Exponents a, b:', BASE.a.toFixed(3), BASE.b.toFixed(3));

  function themeScore(f, t, swap) {
    var s = ee.Number(0);
    THEMES[t].forEach(function (k) {
      var key = (swap && swap[k]) ? swap[k] : k;
      s = s.add(ee.Number(f.get(key)).multiply(W[k]));
    });
    return s.divide(THEME_PTS[t]);
  }
  var scored = filled.map(function (f) {
    var A = themeScore(f, 'A'), B = themeScore(f, 'B'), C = themeScore(f, 'C');
    var D = themeScore(f, 'D'), E = themeScore(f, 'E');
    var Bo = themeScore(f, 'B', {B1: 'B1_opt'}), Bp = themeScore(f, 'B', {B1: 'B1_pes'});
    var CDE = C.multiply(12).add(D.multiply(24)).add(E.multiply(14)).divide(50);
    var core = A.max(0.01).pow(BASE.a).multiply(B.max(0.01).pow(BASE.b));
    var ppi = core.multiply(ee.Number(0.55).add(C.multiply(BASE.cC)).add(D.multiply(BASE.cD))
                                            .add(E.multiply(BASE.cE)));
    return f.set({A: A, B: B, C: C, D: D, E: E, B_opt: Bo, B_pes: Bp, CDE: CDE,
                  suit_core: core, PPI_raw: ppi});
  });

  /* ---------- Step 21 + 23: array engine — categories and Monte Carlo ---------- */
  var ret = scored.filter(ee.Filter.eq('excluded', 0)).sort('block_id');
  var N = ee.Number(NR);
  function arr(p) { return ee.Array(ret.aggregate_array(p)); }
  function full(v) { return ee.Array(ee.List.repeat(v, N)); }
  var AA = arr('A'), BC = arr('B'), BO = arr('B_opt'), BP = arr('B_pes');
  var CC = arr('C'), DD = arr('D'), EE = arr('E');
  var F001 = full(0.01), F055 = full(0.55);

  function ppiOf(Aa, Ba, Ca, Da, Ea, a, b, cC, cD, cE) {
    return Aa.max(F001).pow(full(a)).multiply(Ba.max(F001).pow(full(b)))
      .multiply(F055.add(Ca.multiply(full(cC))).add(Da.multiply(full(cD))).add(Ea.multiply(full(cE))));
  }
  function cutIdx(p) { return N.multiply(p).ceil().subtract(1).max(0).int(); }   // nearest rank
  var I20 = cutIdx(0.2), I40 = cutIdx(0.4), I60 = cutIdx(0.6), I80 = cutIdx(0.8);
  function catOf(ppi) {
    var s = ppi.sort();
    return full(5)
      .subtract(ppi.gt(full(s.get([I20]))))
      .subtract(ppi.gt(full(s.get([I40]))))
      .subtract(ppi.gt(full(s.get([I60]))))
      .subtract(ppi.gt(full(s.get([I80]))));
  }

  var basePPI = ppiOf(AA, BC, CC, DD, EE, BASE.a, BASE.b, BASE.cC, BASE.cD, BASE.cE);
  var baseCat = catOf(basePPI);
  var IDX = ee.Array(ee.List.sequence(0, N.subtract(1)));
  var ORDER = IDX.sort(basePPI);
  var RANK = IDX.sort(ORDER);
  var PCT = RANK.multiply(full(100)).divide(full(N.subtract(1).max(1)));

  // --- Monte Carlo draws, generated client-side with a seeded generator (Section 11.2) ---
  function imul32(a, b) {        // 32-bit integer multiply (Math.imul is missing in the Code Editor)
    var ah = (a >>> 16) & 0xffff, al = a & 0xffff, bh = (b >>> 16) & 0xffff, bl = b & 0xffff;
    return ((al * bl) + (((ah * bl + al * bh) << 16) >>> 0)) | 0;
  }
  function mulberry32(a) {
    return function () {
      a = a | 0; a = (a + 0x6D2B79F5) | 0;
      var t = imul32(a ^ (a >>> 15), 1 | a);
      t = (t + imul32(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  var RNG = mulberry32(CFG.MC_SEED);
  function rnorm() {
    var u1 = 0, u2 = 0;
    while (u1 === 0) { u1 = RNG(); }
    u2 = RNG();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }
  function rgamma(alpha) {                       // Marsaglia & Tsang (2000)
    if (alpha < 1) { return rgamma(alpha + 1) * Math.pow(RNG(), 1 / alpha); }
    var d = alpha - 1 / 3, c = 1 / Math.sqrt(9 * d);
    while (true) {
      var x, v;
      do { x = rnorm(); v = 1 + c * x; } while (v <= 0);
      v = v * v * v;
      var u = RNG();
      if (u < 1 - 0.0331 * x * x * x * x) { return d * v; }
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) { return d * v; }
    }
  }
  var DRAWS = [];
  for (var k = 0; k < CFG.MC_K; k++) {
    var g = THEME_KEYS.map(function (t) { return rgamma(CFG.MC_CONC * TW[t]); });
    var gs = g.reduce(function (s, v) { return s + v; }, 0);
    var tw = {};
    THEME_KEYS.forEach(function (t, ii) { tw[t] = g[ii] / gs; });
    var cf = coefFrom(tw);
    DRAWS.push({k: k, wA: tw.A, wB: tw.B, wC: tw.C, wD: tw.D, wE: tw.E,
                a: cf.a, b: cf.b, cC: cf.cC, cD: cf.cD, cE: cf.cE,
                b1_variant: RNG() < 0.5 ? 'pessimistic' : 'optimistic'});
  }
  var K = CFG.MC_K, KHALF = Math.floor(K / 2);
  var DRAW_LIST = ee.List(DRAWS.map(function (d) {
    return [d.k, d.a, d.b, d.cC, d.cD, d.cE, d.b1_variant === 'pessimistic' ? 1 : 0];
  }));
  var Z = full(0);
  var MC = ee.Dictionary(DRAW_LIST.iterate(function (d, st) {
    d = ee.List(d); st = ee.Dictionary(st);
    var kk = ee.Number(d.get(0));
    var a = d.get(1), b = d.get(2), cC = d.get(3), cD = d.get(4), cE = d.get(5);
    var catO = catOf(ppiOf(AA, BO, CC, DD, EE, a, b, cC, cD, cE));
    var catP = catOf(ppiOf(AA, BP, CC, DD, EE, a, b, cC, cD, cE));
    var cat = ee.Array(ee.Algorithms.If(ee.Number(d.get(6)).eq(1), catP, catO));
    var c12 = ee.Array(st.get('c12')).add(cat.lte(full(2)));
    var out = {
      c12: c12,
      cmin: ee.Array(st.get('cmin')).min(cat),
      cmax: ee.Array(st.get('cmax')).max(cat),
      bdiff: ee.Array(st.get('bdiff')).add(catO.neq(catP)),
      half: ee.Algorithms.If(kk.eq(KHALF - 1),
              c12.reduce(ee.Reducer.sum(), [0]).get([0]).divide(N.multiply(KHALF)), st.get('half'))
    };
    [1, 2, 3, 4, 5].forEach(function (c) {
      out['n' + c] = ee.Array(st.get('n' + c)).add(cat.eq(full(c)));
    });
    return ee.Dictionary(out);
  }, ee.Dictionary({c12: Z, cmin: full(5), cmax: full(1), bdiff: Z, half: 0,
                    n1: Z, n2: Z, n3: Z, n4: Z, n5: Z})));

  var C12 = ee.Array(MC.get('c12'));
  var STAB = C12.divide(full(K));
  var MEAN_FULL = C12.reduce(ee.Reducer.sum(), [0]).get([0]).divide(N.multiply(K));
  var MEAN_HALF = ee.Number(MC.get('half'));
  // modal category
  var best = ee.Array(MC.get('n1')), modal = full(1);
  [2, 3, 4, 5].forEach(function (c) {
    var nc = ee.Array(MC.get('n' + c));
    var gt = nc.gt(best);
    modal = modal.add(gt.multiply(full(c).subtract(modal)));
    best = best.max(nc);
  });
  var BSENS = ee.Array(MC.get('bdiff')).divide(full(K));

  /* ---------- write array results back to the retained blocks ---------- */
  var L = {
    ppi: basePPI.toList(), pct: PCT.toList(), cat: baseCat.toList(), stab: STAB.toList(),
    modal: modal.toList(), cmin: ee.Array(MC.get('cmin')).toList(),
    cmax: ee.Array(MC.get('cmax')).toList(), bs: BSENS.toList()
  };
  var RET_LIST = ret.toList(N);
  var retOut = ee.FeatureCollection(ee.List.sequence(0, N.subtract(1)).map(function (ii) {
    ii = ee.Number(ii).int();
    var f = ee.Feature(RET_LIST.get(ii));
    var bs = ee.Number(L.bs.get(ii));
    return f.set({
      PPI_absolute: L.ppi.get(ii),
      PPI_final: L.ppi.get(ii),
      PPI_percentile: L.pct.get(ii),
      category: ee.Number(L.cat.get(ii)).int(),
      stability_cat12: L.stab.get(ii),
      category_modal: ee.Number(L.modal.get(ii)).int(),
      category_range: ee.Number(L.cmin.get(ii)).format('%.0f').cat('-')
                        .cat(ee.Number(L.cmax.get(ii)).format('%.0f')),
      b1_disagree_share: bs,
      b1_sensitive: ee.Algorithms.If(bs.gt(0.20), 'yes', 'no')
    });
  }));
  var exclOut = scored.filter(ee.Filter.eq('excluded', 1)).map(function (f) {
    return f.set({PPI_absolute: 0, PPI_final: 0, PPI_percentile: 0, category: 5,
                  stability_cat12: 0, category_modal: 5, category_range: '5-5',
                  b1_disagree_share: 0, b1_sensitive: 'no'});
  });

  /* ---------- Step 22: prescription (10.4) and site class (10.5) ---------- */
  function cls(x) {
    return ee.Algorithms.If(x.lt(CFG.SITE_SPLITS[0]), 'Low',
           ee.Algorithms.If(x.lt(CFG.SITE_SPLITS[1]), 'Med', 'High'));
  }
  var RXD = ee.Dictionary(RX_CODES);
  function rxOf(f) {
    var A = ee.Number(f.get('A')), B = ee.Number(f.get('B'));
    var E1 = ee.Number(f.get('E1')), D5 = ee.Number(f.get('D5'));
    return ee.String(
      ee.Algorithms.If(ee.Number(f.get('excluded_c1')).eq(1), 'PROTECT_DENSE',
      ee.Algorithms.If(ee.Number(f.get('excluded')).eq(1), 'NOT_PLANTABLE',
      ee.Algorithms.If(E1.lt(CFG.RX.FIRE_E1), 'FIRE_PROTECTION_FIRST',
      ee.Algorithms.If(A.lt(CFG.RX.SMC_A).or(B.lt(CFG.RX.SMC_B)), 'SMC_FIRST',
      ee.Algorithms.If(D5.gte(CFG.RX.INVASIVE_D5), 'INVASIVE_CLEAR_THEN_PLANT',
      ee.Algorithms.If(ee.String(f.get('canopy_track')).equals('GAP_ANR'), 'GAP_PLANTING_ANR',
                       'FULL_PLANTATION')))))));
  }
  // Light copy for the on-screen map: base categories only (no Monte Carlo needed).
  var L0 = {ppi: basePPI.toList(), pct: PCT.toList(), cat: baseCat.toList()};
  var MAPFC = ee.FeatureCollection(ee.List.sequence(0, N.subtract(1)).map(function (ii) {
    ii = ee.Number(ii).int();
    return ee.Feature(RET_LIST.get(ii)).set({PPI_absolute: L0.ppi.get(ii), PPI_percentile: L0.pct.get(ii),
                                             category: ee.Number(L0.cat.get(ii)).int()});
  })).merge(scored.filter(ee.Filter.eq('excluded', 1)).map(function (f) {
    return f.set({PPI_absolute: 0, PPI_percentile: 0, category: 5});
  })).map(function (f) {
    var rx = rxOf(f);
    return f.set({prescription: rx, rx_code: RXD.get(rx),
                  site_class: ee.String('A-').cat(cls(ee.Number(f.get('A')))).cat('/B-').cat(cls(ee.Number(f.get('B'))))});
  });

  var finalFC = retOut.merge(exclOut).map(function (f) {
    var A = ee.Number(f.get('A')), B = ee.Number(f.get('B'));
    var rx = rxOf(f);
    var cat = ee.Number(f.get('category'));
    var stab = ee.Number(f.get('stability_cat12'));
    var c6 = ee.Number(ee.Algorithms.If(ee.Algorithms.IsEqual(f.get('C6_frac'), null), 0, f.get('C6_frac')));
    var why = ee.List([
      ee.Algorithms.If(cat.lte(2).and(stab.lt(0.80)), 'Cat1-2 stability<0.80', ''),
      ee.Algorithms.If(ee.String(f.get('recent_plantation_flag')).equals('yes'), 'F1 recent plantation?', ''),
      ee.Algorithms.If(ee.String(f.get('protected_area_flag')).equals('yes'), 'F2 protected area', ''),
      ee.Algorithms.If(ee.String(f.get('b1_sensitive')).equals('yes'), 'F3 soil pit', ''),
      ee.Algorithms.If(c6.gt(0), 'C6 cultivation inside forest (rights/encroachment)', '')
    ]).filter(ee.Filter.neq('item', ''));
    var stabRead = ee.Algorithms.If(stab.gt(0.80), 'Robust',
                   ee.Algorithms.If(stab.gte(0.50), 'Moderately stable', 'Marginal'));
    return f.set({
      prescription: rx,
      rx_code: RXD.get(rx),
      site_class: ee.String('A-').cat(cls(A)).cat('/B-').cat(cls(B)),
      stability_reading: ee.Algorithms.If(cat.lte(2), stabRead, ''),
      field_check: ee.Algorithms.If(why.size().gt(0), 'yes', 'no'),
      field_check_reason: why.join('; '),
      fra_rights_check_required: ee.Algorithms.If(cat.lte(2), 'yes', 'no'),   // Section 2 rule
      cv_reweight_log: CV_REWEIGHT_LOG,
      weights_used: JSON.stringify(W)
    });
  });

  /* ---------- Step 24: one-at-a-time sensitivity (Section 11.3) ---------- */
  var SMAT = ee.Array(ret.reduceColumns(ee.Reducer.toList(PARAMS.length), PARAMS).get('list'));
  function wMatrix(Wv) {           // 23 x 5, column t = Wv[k] / theme points
    return PARAMS.map(function (k) {
      return THEME_KEYS.map(function (t) { return THEME_OF[k] === t ? Wv[k] / THEME_PTS[t] : 0; });
    });
  }
  var OAT = [];
  PARAMS.forEach(function (k) {
    [0.8, 1.2].forEach(function (m) {
      if (W[k] <= 0) { return; }
      var t = THEME_OF[k];
      var Wv = {};
      PARAMS.forEach(function (p) { Wv[p] = W[p]; });
      var newK = W[k] * m, restOld = THEME_PTS[t] - W[k], restNew = THEME_PTS[t] - newK;
      if (restOld <= 0) { return; }
      THEMES[t].forEach(function (p) { if (p !== k) { Wv[p] = W[p] * restNew / restOld; } });
      Wv[k] = newK;
      OAT.push({param: k, factor: m, wm: wMatrix(Wv)});
    });
  });
  var oatFeatures = OAT.map(function (o) {
    var TH = SMAT.matrixMultiply(ee.Array(o.wm));
    var col = function (c) { return TH.slice(1, c, c + 1).project([0]); };
    var cat = catOf(ppiOf(col(0), col(1), col(2), col(3), col(4),
                          BASE.a, BASE.b, BASE.cC, BASE.cD, BASE.cE));
    var share = cat.neq(baseCat).reduce(ee.Reducer.sum(), [0]).get([0]).divide(N);
    return ee.Feature(null, {
      parameter: o.param, theme: THEME_OF[o.param], factor: o.factor,
      share_blocks_changed: share,
      over_influential: ee.Algorithms.If(share.gt(CFG.OAT_MAX_SHARE), 'yes', 'no')
    });
  });
  var OAT_FC = ee.FeatureCollection(oatFeatures).sort('share_blocks_changed', false);

  /* ---------- Collinearity table (Section 11.4) ---------- */
  var colFeatures = PAIRS.map(function (p) {
    var r = RHO[p[0] + '|' + p[1]];
    return ee.Feature(null, {type: 'spearman', a: p[0], b: p[1], value: r === null ? -999 : r,
                             flag: (r !== null && Math.abs(r) > CFG.RHO_MAX) ? 'yes' : 'no'});
  }).concat(VARYING.map(function (k) {
    return ee.Feature(null, {type: 'VIF', a: k, b: '', value: isFinite(VIF[k]) ? VIF[k] : -1,
                             note: isFinite(VIF[k]) ? '' : 'singular (exactly collinear)',
                             flag: VIF[k] > CFG.VIF_MAX ? 'yes' : 'no'});
  }));
  var COL_FC = ee.FeatureCollection(colFeatures);

  var DRAW_FC = ee.FeatureCollection(DRAWS.map(function (d) { return ee.Feature(null, d); }));

  /* ---------- qc_log (Section 12) ---------- */
  var HAS_QC = (typeof HAS_QC01 === 'undefined') ? true : HAS_QC01;   // false if the QC01 export failed
  var qc01 = HAS_QC ? ee.Feature(ee.FeatureCollection(CFG.QC01_ASSET).first()) : null;
  function notRecorded(id, check) {
    return q(id, check, 'not recorded: the QC01 table was not saved (all dataset checks passed in Run 1 console)',
             'NOT RECORDED', 'Re-run RUN 1 (STEP = LAYERS) to regenerate the QC01 table');
  }
  function st(cond, ok, bad) { return ee.Algorithms.If(cond, ok || 'PASS', bad || 'FAIL'); }
  function q(id, check, value, status, action) {
    return ee.Feature(null, {id: id, check: check, value: value, status: status, if_fail: action});
  }
  var maxNull = ee.List(FILL_KEYS.map(function (k) { return nullShare.get(k); })).reduce(ee.Reducer.max());
  var SCORE_KEYS = PARAMS.concat(['A', 'B', 'C', 'D', 'E', 'B1_opt', 'B1_pes']);
  var minScore = ee.List(SCORE_KEYS.map(function (k) { return scored.aggregate_min(k); })).reduce(ee.Reducer.min());
  var maxScore = ee.List(SCORE_KEYS.map(function (k) { return scored.aggregate_max(k); })).reduce(ee.Reducer.max());
  var anchorIds = raw.aggregate_array('anchor_id').distinct();
  var anchor0 = ee.String(anchorIds.get(0));
  var ff09live = ee.Algorithms.If(anchor0.slice(0, 4).equals('LIVE'), 'WARN (provisional LIVE anchors)',
                 ee.Algorithms.If(anchor0.slice(0, 5).equals('LOCAL'),
                   'PASS (local anchors: range + buffer; PPI_absolute comparable within this landscape only)', 'PASS'));
  var ff09 = ee.Algorithms.If(anchorIds.size().neq(1), 'FAIL (more than one anchor ID)',
             CFG.EXPECTED_ANCHOR_ID ?
               ee.Algorithms.If(anchor0.equals(CFG.EXPECTED_ANCHOR_ID), ff09live, 'FAIL (anchor ID mismatch)') :
               ff09live);
  var ff15bad = scored.filter(ee.Filter.gte('fire_years', 5)).filter(ee.Filter.gte('E1', 0.55)).size();
  var ff16bad = scored.filter(ee.Filter.eq('excluded_c1', 1)).filter(ee.Filter.eq('excluded', 0)).size();
  var ff17bad = scored.map(function (f) {
    return f.set('d__', ee.Number(f.get('net_plantable_ha')).subtract(ee.Number(f.get('block_area_ha'))));
  }).filter(ee.Filter.gt('d__', 1e-9)).size();
  var pp = ret.reduceColumns(ee.Reducer.percentile([5, 95]), ['PPI_raw']);
  var spread = ee.Number(pp.get('p95')).subtract(ee.Number(pp.get('p5')));
  var shares = [1, 2, 3, 4].map(function (c) {
    return baseCat.eq(full(c)).reduce(ee.Reducer.sum(), [0]).get([0]).divide(N);
  });
  var sharesL = ee.List(shares);
  var shareOK = ee.Number(sharesL.reduce(ee.Reducer.min())).gte(0.18)
    .and(ee.Number(sharesL.reduce(ee.Reducer.max())).lte(0.22));
  var dMC = MEAN_FULL.subtract(MEAN_HALF).abs();
  var nGrid = ee.Number(ee.Feature(raw.first()).get('n_blocks_grid'));
  var FIRE_GAP_TEXT = ee.Feature(raw.first()).get('fire_source_gap');
  var gapPresent = raw.filter(ee.Filter.notNull(['fire_source_gap'])).size().eq(N_ALL);

  var QC_FC = ee.FeatureCollection([
    HAS_QC ? q('FF-01', 'Asset access (22 datasets)', qc01.get('FF01_asset_log'), qc01.get('FF01_status'), 'STOP: re-check ID in Section 5') : notRecorded('FF-01', 'Asset access (22 datasets)'),
    HAS_QC ? q('FF-02', 'Working CRS', qc01.get('FF02_crs'), qc01.get('FF02_status'), 'STOP: fix UTM formula') : notRecorded('FF-02', 'Working CRS'),
    HAS_QC ? q('FF-03', 'Mosaic nominal scales', qc01.get('FF03_scales'), qc01.get('FF03_status'), 'STOP: setDefaultProjection') : notRecorded('FF-03', 'Mosaic nominal scales'),
    HAS_QC ? q('FF-04', 'Interior blocks 9.99-10.01 ha (count outside)', qc01.get('FF04_interior_blocks_out_of_tolerance'),
      st(ee.Number(qc01.get('FF04_interior_blocks_out_of_tolerance')).eq(0)), 'Grid scale wrong') : notRecorded('FF-04', 'Interior blocks 9.99-10.01 ha (count outside)'),
    HAS_QC ? q('FF-05', 'Null beat_id count', qc01.get('FF05_null_beat'),
      st(ee.Number(qc01.get('FF05_null_beat')).eq(0)), "Re-inspect asset; fall back to 'RANGE'") : notRecorded('FF-05', 'Null beat_id count'),
    q('FF-06', 'Max parameter null share (before beat-mean fill)', maxNull,
      st(ee.Number(maxNull).lt(0.02)), 'Check masks; gaps filled with beat mean (gapfilled column)'),
    q('FF-07', 'Sub-weights sum to 100 and theme totals', JSON.stringify(W), FF07, 'Arithmetic error'),
    q('FF-08', 'All scores in [0,1] (min, max)', ee.String(ee.Number(minScore).format('%.4f')).cat(', ')
        .cat(ee.Number(maxScore).format('%.4f')),
      st(ee.Number(minScore).gte(-1e-9).and(ee.Number(maxScore).lte(1 + 1e-9))), 'Anchor or curve error'),
    q('FF-09', 'Single anchor ID', anchorIds.join(','), ff09, 'Re-run Module 0 or fix constant'),
    q('FF-10', 'CV guard (CV < 0.05 reweighted)', CV_REWEIGHT_LOG, CV_LOG.length ? 'APPLIED' : 'PASS', 'Section 8.3'),
    q('FF-11', 'rho(A3,canopy), rho(A3,D5) < 0.60', String(rA3c) + ', ' + String(rA3d), FF11,
      'Set A3_MASK_TREES = true in script 01 and re-run'),
    q('FF-12', 'rho(B1,C1s) < 0.75', String(r12), FF12, 'C1s cut to 3 pts, +2 to C2s (auto)'),
    q('FF-13', 'rho(D1,D3) < 0.75', String(r13), FF13, 'Merged to 7 pts, +2 to D6 (auto)'),
    q('FF-14', 'Other pairs |rho| <= 0.75, VIF <= 5', COL_LOG.length ? COL_LOG.join(' | ') : 'none', FF14,
      'Composite at higher pair weight (auto, same theme) / review'),
    q('FF-15', 'Blocks with >=5 fire years and E1 >= 0.55', ff15bad, st(ff15bad.eq(0), 'PASS', 'STOP'), 'Inversion missing'),
    q('FF-16', 'Blocks excluded by C1 yet ranked', ff16bad, st(ff16bad.eq(0), 'PASS', 'STOP'), 'Threshold coordination'),
    q('FF-17', 'Blocks with net_plantable_ha > block_area_ha', ff17bad, st(ff17bad.eq(0)), 'Fraction error'),
    HAS_QC ? q('FF-18', 'Min clear S2 obs per window-year (5th pct: A3, D5)',
      ee.String(ee.Number(qc01.get('FF18_A3_p5_min_clear_obs')).format('%.0f')).cat(', ')
        .cat(ee.Number(qc01.get('FF18_D5_p5_min_clear_obs')).format('%.0f')),
      st(ee.Number(qc01.get('FF18_A3_p5_min_clear_obs')).gte(3)
           .and(ee.Number(qc01.get('FF18_D5_p5_min_clear_obs')).gte(3))),
      'Set CS_THRESHOLD = 0.50 in 00/01 and log it') : notRecorded('FF-18', 'Min clear S2 obs per window-year (5th pct: A3, D5)'),
    HAS_QC ? q('FF-19', 'Share of pixels with >= 8 Landsat years', qc01.get('FF19_share_pixels_8yrs'),
      st(ee.Number(qc01.get('FF19_share_pixels_8yrs')).gte(0.95)), 'Set D2_MONTHS = [9, 12] and log it') : notRecorded('FF-19', 'Share of pixels with >= 8 Landsat years'),
    q('FF-20', 'PPI_raw p95 - p5 (retained)', spread, st(spread.gte(0.20)), 'Review CV guard and anchors'),
    q('FF-21', 'Category 1-4 shares of retained', sharesL, st(shareOK), 'Percentile transform error'),
    q('FF-22', '|mean stability K=' + K + ' - K=' + KHALF + '|', dMC, st(dMC.lt(0.01)), 'Raise MC_K to 1000'),
    q('FF-23', 'Rows in raw table = grid blocks', ee.String(N_ALL.format('%d')).cat(' / ').cat(nGrid.format('%.0f')),
      st(N_ALL.eq(nGrid)), 'Raise TILE_SCALE in 01 and re-export'),
    q('FF-24', 'fire_source_gap present', FIRE_GAP_TEXT, st(gapPresent), 'Add metadata field'),
    q('INFO', 'OAT parameters moving > 15% of blocks',
      OAT_FC.filter(ee.Filter.eq('over_influential', 'yes')).aggregate_array('parameter').distinct().join(','),
      'INFO', 'Review those weights')
  ]);

  /* ---------- Step 25: exports (SCORE stage) ---------- */
  var tag = CFG.RANGE_NAME;
  Export.table.toAsset({collection: finalFC, description: 'PPI02_final_to_asset', assetId: CFG.FINAL_ASSET});
  Export.table.toDrive({collection: finalFC, description: 'PPI02_final_block_table_csv',
    folder: CFG.DRIVE_FOLDER, fileNamePrefix: 'PPI02_final_block_table_' + tag, fileFormat: 'CSV'});
  Export.table.toDrive({collection: raw, description: 'PPI02_raw_checkpoint_csv',
    folder: CFG.DRIVE_FOLDER, fileNamePrefix: 'PPI01_raw_block_table_' + tag, fileFormat: 'CSV'});
  Export.table.toDrive({collection: OAT_FC, description: 'PPI02_sensitivity_csv',
    folder: CFG.DRIVE_FOLDER, fileNamePrefix: 'PPI02_sensitivity_OAT_' + tag, fileFormat: 'CSV'});
  Export.table.toDrive({collection: COL_FC, description: 'PPI02_collinearity_csv',
    folder: CFG.DRIVE_FOLDER, fileNamePrefix: 'PPI02_collinearity_' + tag, fileFormat: 'CSV'});
  Export.table.toDrive({collection: DRAW_FC, description: 'PPI02_montecarlo_draws_csv',
    folder: CFG.DRIVE_FOLDER, fileNamePrefix: 'PPI02_montecarlo_draws_' + tag, fileFormat: 'CSV'});
  Export.table.toDrive({collection: QC_FC, description: 'PPI02_qc_log_csv',
    folder: CFG.DRIVE_FOLDER, fileNamePrefix: 'PPI02_qc_log_' + tag, fileFormat: 'CSV'});

  print('Collinearity, CV guard and weights are above. Monte Carlo runs inside the export tasks.');
  if (CFG.PUBLISH_NOW) {
    publishAll(finalFC, MAPFC);
    print('====================================================================');
    print('FINAL MAP is on screen. To save every result to Google Drive:');
    print('Tasks tab -> RUN ALL (tables, Monte Carlo, QC log, GeoTIFFs, SHP, GeoJSON, field list).');
    print('====================================================================');
    return;
  }
  print('NEXT: Tasks tab -> RUN all 7 tasks. When PPI02_final_to_asset is done, set');
  print("STAGE = 'PUBLISH' and run again for maps, GeoTIFFs, SHP, GeoJSON and the field-check list.");

  Map.centerObject(AOI, 11);
  Map.addLayer(scored.reduceToImage(['PPI_raw'], ee.Reducer.first()).updateMask(
    scored.reduceToImage(['excluded'], ee.Reducer.first()).eq(0)),
    {min: 0.2, max: 0.8, palette: ['#1a9850', '#fee08b', '#d73027']}, 'PPI_raw (retained, preview)');
  Map.addLayer(ee.Image().byte().paint(AOI_FC, 1, 2), {palette: ['black']}, 'Range boundary');

  });   // end collinearity callback
  });   // end statistics callback

  /* ====================================================================== */
  } else if (CFG.STAGE === 'PUBLISH') {
  /* ====================================================================== */

  publishAll(ee.FeatureCollection(CFG.FINAL_ASSET));

  /* ====================================================================== */
  } else {
    print("STOP: CFG.STAGE must be 'SCORE' or 'PUBLISH'");
  }
}

/* ######################################################################
 *  STEP 5 — VALIDATION (spec build steps 26-27, optional)
 * ###################################################################### */
function step5_validation() {
  var CFG = {
    RANGE_NAME: SETTINGS.RANGE_NAME, CRS: SETTINGS.CRS, AOI_ASSET: SETTINGS.AOI_ASSET, FINAL_ASSET: ASSETS.FINAL,
    DRIVE_FOLDER: SETTINGS.DRIVE_FOLDER, MIN_LOSS_PIXELS: 5, RECOVERED_RATIO: 0.80,
    TILE_SCALE: SETTINGS.TILE_SCALE
  };

  var AOI = ee.FeatureCollection(CFG.AOI_ASSET).geometry().dissolve({maxError: 1});
  var fin = ee.FeatureCollection(CFG.FINAL_ASSET);
  var CRS = CFG.CRS;

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
}

/* ======================================================================
 *  STEP DISPATCH — decides which step to run (asynchronous: the page
 *  stays responsive while Earth Engine looks up the saved results).
 * ====================================================================== */
var STEP_NAMES = {
  1: 'STEP 1 — State anchors (' + SETTINGS.STATE + '). Run both tasks; takes a few hours.',
  2: 'STEP 2 — Range layers and raw block table. Run all 4 tasks.',
  3: 'STEP 3 — Scoring, Monte Carlo, sensitivity, QC log. Run all 7 tasks.',
  4: 'STEP 4 — Final maps on screen. Run the 11 tasks to save maps/SHP/field list.',
  5: 'STEP 5 — Validation report. Run the task.'
};

function runStep(n) {
  print('==================================================================');
  print('PPI-SK v2.1 | ' + SETTINGS.RANGE_NAME + ' | running ' + STEP_NAMES[n]);
  print('Tasks appear in the Tasks tab after the checks below finish (about 1 minute).');
  print('After the tasks have FINISHED, press Run again for the next step.');
  print('==================================================================');
  if (n === 1) { step1_stateAnchors(); }
  else if (n === 2) { step2_rangeLayers(); }
  else if (n === 3) { step3_scoring('SCORE'); }
  else if (n === 4) { step3_scoring('PUBLISH'); }
  else if (n === 5) { step5_validation(); }
  else { print('STOP: STEP must be AUTO, 1, 2, 3, 4 or 5'); }
}

function assetExists(id, cb) {
  try {
    ee.data.getAsset(id, function (a, err) { cb(!!a && !err); });
  } catch (e) { cb(false); }
}

var HAS_QC01 = true;
if (STEP === 'AUTO') {
  print('Looking for results of earlier steps ...');
  var ids = [ASSETS.FINAL, ASSETS.RAW, ASSETS.QC01, ASSETS.ANCHORS];
  var found = {}, waiting = ids.length;
  ids.forEach(function (id) {
    assetExists(id, function (ok) {
      found[id] = ok;
      waiting -= 1;
      if (waiting === 0) {
        var n;
        if (found[ASSETS.FINAL]) { n = 4; }
        else if (found[ASSETS.RAW]) { n = 3; HAS_QC01 = found[ASSETS.QC01]; }
        else if (found[ASSETS.ANCHORS] || SETTINGS.ANCHOR_MODE === 'LIVE') { n = 2; }
        else { n = 1; }
        runStep(n);
      }
    });
  });
} else {
  runStep(STEP);
}
