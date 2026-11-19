/* ######################################################################
 *  FRPIM v2.2 — Forest Restoration Priority and Intervention Model
 *  KHEDBRAHMA RANGE — single-file Google Earth Engine script
 *  ----------------------------------------------------------------------
 *  HOW TO USE
 *   RUN 1  Press Run. Checks all 24 datasets, computes the scoring scale
 *          for the range + 20 km landscape (2-4 min, background), builds
 *          the 10 ha blocks and every layer. Then: Tasks tab -> RUN ALL
 *          -> wait until all tasks show a tick (about 40-70 min).
 *   RUN 2  Press Run again. The FINAL MAP appears: restoration priority
 *          (HIGH / MODERATE / LOW / PROTECTED / EXCLUDED), intervention
 *          (11 types), need, feasibility, degradation evidence,
 *          reliability and change from v2.1. Click any block for details.
 *          Tasks tab -> RUN ALL saves every table, map and file to Drive.
 *   Press Run any time after that to see the final map again.
 *  Optional: STEP = 'VALIDATE' for the validation report (V1, V2).
 *
 *  Scoring scale: anchors are the percentiles of each parameter over
 *  tree/shrub/grass/bare land of the range + 20 km landscape, so RNI and
 *  RFI are comparable within this landscape. For Gujarat-wide comparison
 *  a state anchor table is needed (Section 8.1).
 * ###################################################################### */

var STEP = 'AUTO';                 // 'AUTO', 'LAYERS', 'MAP' or 'VALIDATE'

var SETTINGS = {
  AOI_ASSET: 'projects/khedbrahma-range/assets/khedbrahma',
  RANGE_NAME: 'Khedbrahma',
  ID_PREFIX: 'KB_',
  CRS: 'EPSG:32643',               // UTM 43N (checked automatically against the range)
  BEAT_FIELD: 'AUTO',              // 'AUTO', an exact field name, or null (-> 'RANGE')
  ASSET_ROOT: 'projects/khedbrahma-range/assets/',
  DRIVE_FOLDER: 'FRPIM_v22_Khedbrahma',

  LOCAL_BUFFER_KM: 20,             // anchor landscape = range + this buffer
  LOCAL_ANCHOR_SCALE: 100,         // m; set 250 if an anchor times out

  CS_THRESHOLD: 0.60,              // FF-18 remedy: 0.50
  D2_MONTHS: [9, 11],              // FF-19 remedy: [9, 12]
  A3_MASK_TREES: false,            // FF-11 remedy: true
  TILE_SCALE: 4,                   // a task fails with "memory" -> 16

  // Section 7 weights (points) and Section 10 thresholds
  W_N: {N1: 25, N2: 15, N3: 15, N4: 15, N5: 10, N6: 10, N7: 5, N8: 5},
  W_F: {F1: 15, F2: 10, F3: 5, F4: 5, F5: 12, F6: 7, F7: 6, F8: 6, F9: 4,
        F10: 8, F11: 7, F12: 3, F13: 7, F14: 5},
  TH: {needHi: 0.60, needLo: 0.35, feasHi: 0.55, feasLo: 0.35},
  MATRIX_HN_LF: 'MODERATE',        // high need + low feasibility cell; a DFO may set 'HIGH'
  RX: {FIRE_F13: 0.55, STAB_S: 0.45, INVASIVE_N7: 0.30, SMC_M: 0.35, SMC_RESP_M: 0.50}
};

var ASSETS = {
  RAW: SETTINGS.ASSET_ROOT + 'FRPIM_v22_raw_blocks_' + SETTINGS.RANGE_NAME,
  QC01: SETTINGS.ASSET_ROOT + 'FRPIM_v22_qc01_' + SETTINGS.RANGE_NAME,
  FINAL: SETTINGS.ASSET_ROOT + 'FRPIM_v22_final_blocks_' + SETTINGS.RANGE_NAME,
  V21: SETTINGS.ASSET_ROOT + 'PPI_SK_v21_RANGE_final_blocks_' + SETTINGS.RANGE_NAME   // for the comparison
};
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
    // Dataset access is tested anywhere in the archive; coverage over the range is reported separately
    // (Landsat 5 has few or no scenes over India in 2000-05; the DE4 baseline merges Landsat 5 and 7).
    add('D24 Landsat 5 TM', ic(A.L5, '1995-01-01', '2012-01-01'));
    add('D24 Landsat 7 ETM+', ic(A.L7, '2000-01-01', '2006-01-01'));
    add('D24 info: Landsat 5 + 7 scenes over the range, Sep-Nov 2000-05',
        ee.ImageCollection(A.L5).merge(ee.ImageCollection(A.L7)).filterBounds(pt)
          .filter(ee.Filter.calendarRange(9, 11, 'month')).filterDate('2000-01-01', '2006-01-01').size(), false);
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
 *  RUN 1 — RANGE LAYERS -> RAW BLOCK TABLE (FRPIM build steps 3-17)
 * ###################################################################### */
function stepLayers() {
  var CFG = {
    AOI_ASSET: SETTINGS.AOI_ASSET, RANGE_NAME: SETTINGS.RANGE_NAME, ID_PREFIX: SETTINGS.ID_PREFIX,
    MODEL_VERSION: 'FRPIM_v2.2', BLOCK_SIDE: 316.2278, MIN_BLOCK_HA: 2.0,
    BEAT_FIELD: SETTINGS.BEAT_FIELD, CRS: SETTINGS.CRS, STATE_CRS: SETTINGS.CRS,
    ANCHOR_MODE: 'LOCAL', ANCHOR_ASSET: null, STATE_NAME: 'Gujarat', LIVE_ANCHOR_SCALE: 500,
    LOCAL_BUFFER_KM: SETTINGS.LOCAL_BUFFER_KM, LOCAL_ANCHOR_SCALE: SETTINGS.LOCAL_ANCHOR_SCALE,
    CS_THRESHOLD: SETTINGS.CS_THRESHOLD, D2_MONTHS: SETTINGS.D2_MONTHS,
    A3_MASK_TREES: SETTINGS.A3_MASK_TREES, REASON_MIN_FRAC: 0.01, TILE_SCALE: SETTINGS.TILE_SCALE,
    RAW_ASSET: ASSETS.RAW, QC01_ASSET: ASSETS.QC01, DRIVE_FOLDER: SETTINGS.DRIVE_FOLDER, SHOW_MAP: true
  };
  /* ======================================================================
   *  FRPIM v2.2 — RANGE LAYERS (build steps 3-17)
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
        var ROPT = {csThr: CFG.CS_THRESHOLD, d2Months: CFG.D2_MONTHS, a3MaskTrees: false};
        var R_REF = LIB.layersV22(LIB.layers(refGeom, CRS, ROPT), refGeom, CRS, ROPT);
        LIB.anchorsAsync(R_REF, refGeom, CRS, LIB.anchorLandMask(), CFG.LOCAL_ANCHOR_SCALE,
          function (dict, ok, alog) {
            if (!ok) {
              print('STOP: some anchors could not be computed (see FAIL lines). Press Run again; ' +
                    'if it repeats, set LOCAL_ANCHOR_SCALE to 250.');
              return;
            }
            print('Anchors ready — building the range layers and export tasks.');
            runRange(BEAT_FIELD, CHECK, dict, alog);
          }, LIB.ANCHOR_SPEC_V22);
        return;
      }
      print('All datasets OK — building the range layers and export tasks.');
      runRange(BEAT_FIELD, CHECK);
    }, true);   // true = also check the v2.2 datasets D23, D24
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
  } else if (CFG.ANCHOR_MODE === 'FROZEN' || CFG.ANCHOR_MODE === 'LIVE') {
    print('STOP: FRPIM v2.2 needs extra anchor percentiles (CTI 95th, X1 quartiles); use ANCHOR_MODE LOCAL.');
    return;
  } else if (CFG.ANCHOR_MODE === 'FROZEN_V21_UNUSED') {
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
    Export.table.toDrive({collection: anchFC, description: 'FRPIM01_local_anchor_table',
      folder: CFG.DRIVE_FOLDER, fileNamePrefix: 'FRPIM01_local_anchors_' + CFG.RANGE_NAME, fileFormat: 'CSV'});
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

  /* ---------- Steps 5-12: all layers on the range grid (v2.1 layers + v2.2 additions) ---------- */
  var LOPT = {csThr: CFG.CS_THRESHOLD, d2Months: CFG.D2_MONTHS, a3MaskTrees: CFG.A3_MASK_TREES};
  var R = LIB.layersV22(LIB.layers(AOI, CRS, LOPT), AOI, CRS, LOPT);
  print('DEM source:', R.demSource);

  /* ---------- Step 14: per-pixel scores (v2.1 code names inside S; v2.2 names in the table) ---------- */
  var S = LIB.score(R, ANCH);
  var Z = LIB.scoreV22(R, ANCH);

  /* ---------- Step 15: block reduction, one call per reducer group (Section 9) ---------- */
  var MED30 = ee.Image.cat([
    S.A1.rename('F1'), R.A1.rename('F1_raw'),
    S.B1.rename('F5'), S.B1_opt.rename('F5_opt'), S.B1_pes.rename('F5_pes'),
    R.slopeDeg.rename('F5_raw_slope'), R.tpi.rename('F5_raw_tpi'), R.hand.rename('F5_raw_hand'),
    S.B7.rename('F6'), R.rough.rename('F6_raw'),
    S.C1s.rename('F10'), R.slopePct.rename('F10_raw'),
    S.C2s.rename('F11'), R.hli.rename('F11_raw'),
    S.C3s.rename('F12'), R.curv.rename('F12_raw')
  ]).toFloat();

  var MEAN30 = ee.Image.cat([
    Z.F2, R.AWC.rename('F2_raw'),
    S.A2.rename('F3'), R.A2.rename('F3_raw'),
    S.B2.rename('F7'), R.clay.rename('F7_raw_clay'), R.sand.rename('F7_raw_sand'),
    S.B6.rename('F8'), R.cfvo.rename('F8_raw'),
    S.B4.rename('F9'), R.ph.rename('F9_raw'),
    S.D2.rename('N3'), R.D2trend.rename('N3_raw'),
    S.E4.rename('N4'), R.E4.rename('N4_raw'),
    S.D3.rename('N5'), R.agb.rename('N5_raw'),
    S.E2.rename('F14'), R.E2_dist.rename('F14_raw_dist'), R.E2_pop.rename('F14_raw_pop'),
    R.soc.rename('X2'),
    R.N6mask.rename('N6_raw'),
    R.treecover2000.rename('DE1_treecover2000'),
    R.lossAny.rename('DE2_loss_share'),
    R.trendNeg.rename('DE3_neg_share'),
    R.ndviBase.rename('DE4_ndvi_2000_05'), R.ndviRecentL.rename('DE4_ndvi_2021_25'),
    Z.G4.rename('G4_frac')
  ]).toFloat();

  var MEAN10 = ee.Image.cat([
    R.A3.rename('X1'),
    R.canopyPct.rename('canopy_pct'),
    R.D5mask.rename('N7_raw'),
    Z.FVC.rename('N2_fvc'), Z.BSIpos.rename('N2_bsi_share'),
    R.C2.rename('C2_frac'), R.C3.rename('C3_frac'), R.C4.rename('C4_frac'),
    R.C5.rename('C5_frac'), R.C6.rename('C6_frac'), R.C7.rename('C7_frac'),
    R.anyFail.rename('constrained_frac'),
    R.F1mask.rename('G1_frac'),
    R.wcOpen.rename('wc_open_frac')
  ]).toFloat();

  var MAX30 = ee.Image.cat([S.A5.rename('F4'), S.D6.rename('N8'), R.fire, R.pa]).toFloat();
  var MIN30 = ee.Image.cat([R.A5_dist.rename('F4_raw'), R.D6_dist.rename('N8_raw'),
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

  /* ---------- Steps 13 + 16: constraints, canopy track, degradation evidence, C8, flags ---------- */
  function num(f, p, d) {
    var v = f.get(p);
    return ee.Number(ee.Algorithms.If(ee.Algorithms.IsEqual(v, null), d, v));
  }
  var RUN_DATE = ee.Date(Date.now()).format('YYYY-MM-dd');
  var X1_Q25 = ee.Number(ANCH.get('A3_p25')), X1_Q50 = ee.Number(ANCH.get('A3_p50'));

  blocks = blocks.map(function (f) {
    var area = ee.Number(f.get('block_area_ha'));
    var canopyMissing = ee.Algorithms.IsEqual(f.get('canopy_pct'), null);
    var canopy = num(f, 'canopy_pct', 0);
    var fr = num(f, 'constrained_frac', 0);

    var fireYears = ee.Number(0);
    LIB.FIRE_YEARS.forEach(function (y) { fireYears = fireYears.add(num(f, 'fire_' + y, 0)); });

    // Degradation evidence (Section 6.5)
    var de1 = num(f, 'DE1_treecover2000', 0).gte(10);
    var de2 = num(f, 'DE2_loss_share', 0).gte(0.05);
    var de3 = num(f, 'N3_raw', 0).lt(0).and(num(f, 'DE3_neg_share', 0).gte(0.60));
    var de4diff = num(f, 'DE4_ndvi_2000_05', 0).subtract(num(f, 'DE4_ndvi_2021_25', 0));
    var de4 = ee.Number(ee.Algorithms.If(
      ee.Algorithms.IsEqual(f.get('DE4_ndvi_2000_05'), null), 0, de4diff.gte(0.08)));
    var deCount = de1.add(de2).add(de3).add(de4);

    var exC1 = canopy.gte(40);
    var exFr = fr.gt(0.30);
    var excluded = exC1.or(exFr);
    // C8 naturally open ecosystem (Section 6.6), only for blocks not already excluded
    var c8 = excluded.not().and(canopy.lt(10)).and(deCount.eq(0)).and(num(f, 'wc_open_frac', 0).gte(0.50));

    var reasons = ee.List(['C2', 'C3', 'C4', 'C5', 'C6', 'C7'].map(function (c) {
      return ee.Algorithms.If(num(f, c + '_frac', 0).gte(CFG.REASON_MIN_FRAC), c, '');
    }));
    reasons = ee.List(ee.Algorithms.If(exC1, ee.List(['C1']).cat(reasons), reasons));
    reasons = ee.List(ee.Algorithms.If(c8, reasons.add('C8'), reasons)).filter(ee.Filter.neq('item', ''));

    var access = ee.Algorithms.If(ee.Algorithms.IsEqual(f.get('access_m'), null), null,
                                  num(f, 'access_m', 0).divide(1000));
    var F5 = num(f, 'F5', 0), F6 = num(f, 'F6', 0), slopeMed = num(f, 'F10_raw', 0);
    var N4 = num(f, 'N4', 0), x1 = num(f, 'X1', 0);

    return f.set({
      // block-level fixed-formula scores
      N1: ee.Number(40).subtract(canopy).divide(40).max(0).min(1),
      N1_raw: canopy,
      N2: ee.Number(1).subtract(num(f, 'N2_fvc', 0)).multiply(0.5).add(num(f, 'N2_bsi_share', 0).multiply(0.5)).max(0).min(1),
      N6: num(f, 'N6_raw', 0).max(0).min(1),
      N7: num(f, 'N7_raw', 0).max(0).min(1),
      fire_years: fireYears,
      F13_raw: fireYears,
      F13: ee.Number(1).subtract(fireYears.divide(11)).max(0).min(1),
      // degradation evidence
      DE1: ee.Algorithms.If(de1, 'yes', 'no'), DE2: ee.Algorithms.If(de2, 'yes', 'no'),
      DE3: ee.Algorithms.If(de3, 'yes', 'no'), DE4: ee.Algorithms.If(de4, 'yes', 'no'),
      DE4_ndvi_drop: de4diff,
      degradation_evidence: deCount,
      // diagnostics (Section 7.3)
      X3: ee.Algorithms.If(slopeMed.gte(2).and(slopeMed.lte(35)).and(F5.gte(0.35)).and(F6.gte(0.30)), 'yes', 'no'),
      X4: ee.Algorithms.If(num(f, 'F8_raw', 0).gt(35).or(F6.lt(0.25)), 'yes', 'no'),
      X5: ee.Algorithms.If(N4.gte(0.75), 'yes', 'no'),
      X1_driest_quartile: ee.Algorithms.If(x1.lte(X1_Q25), 'yes', 'no'),
      X1_driest_half: ee.Algorithms.If(x1.lte(X1_Q50), 'yes', 'no'),
      // constraints and canopy track (Section 6)
      canopy_missing: ee.Algorithms.If(canopyMissing, 1, 0),
      excluded_c1: exC1,
      excluded: excluded,
      excluded_c8: c8,
      exclusion_reason: ee.Algorithms.If(exC1, 'C1', ee.Algorithms.If(exFr, 'C2-C7 > 30%',
                          ee.Algorithms.If(c8, 'C8 naturally open', ''))),
      constraint_flag: ee.Algorithms.If(exFr, 'excluded',
                         ee.Algorithms.If(fr.gte(0.10), 'partial', 'none')),
      constraint_reason: reasons.join(','),
      canopy_track: ee.Algorithms.If(exC1, 'EXCLUDED_C1',
                      ee.Algorithms.If(canopy.gte(10), 'GAP_ANR', 'FULL')),
      net_plantable_ha: ee.Algorithms.If(excluded.or(c8), 0, area.multiply(ee.Number(1).subtract(fr))),
      // advisory flags (Section 6.4)
      recent_plantation_flag: ee.Algorithms.If(num(f, 'G1_frac', 0).gte(0.30).and(canopy.lt(40)), 'yes', 'no'),
      protected_area_flag: ee.Algorithms.If(num(f, 'pa', 0).gte(1), 'yes', 'no'),
      waterlogging_flag: ee.Algorithms.If(num(f, 'G4_frac', 0).gte(0.30), 'yes', 'no'),
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
  var ff18N2 = pct5(R.N2_minObs.unmask(0));
  var ff19DE4 = pct5(R.base_nObs.unmask(0));

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
    FF18_N2_p5_min_clear_obs: ff18N2,
    FF19_DE4_p5_clear_obs_2000_05: ff19DE4,
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
    description: 'FRPIM01_raw_blocks_to_asset',
    assetId: CFG.RAW_ASSET
  });
  Export.table.toAsset({
    collection: QC01,
    description: 'FRPIM01_qc01_to_asset',
    assetId: CFG.QC01_ASSET
  });
  Export.table.toDrive({
    collection: QC01,
    description: 'FRPIM01_qc01_csv',
    folder: CFG.DRIVE_FOLDER,
    fileNamePrefix: 'FRPIM01_qc01_' + CFG.RANGE_NAME,
    fileFormat: 'CSV'
  });
  // Product 8: constraint map. Bit code: 1 canopy>=40%, 2 C2 water, 4 C3 drain,
  // 8 C4 slope, 16 C5 built, 32 C6 crop, 64 C7 rock (values add up).
  Export.image.toDrive({
    image: R.constraintCode.clip(AOI),
    description: 'FRPIM01_constraint_map',
    folder: CFG.DRIVE_FOLDER,
    fileNamePrefix: 'FRPIM01_constraint_map_' + CFG.RANGE_NAME,
    region: AOI,
    crs: CRS,
    scale: 10,
    maxPixels: 1e11
  });

  print('====================================================================');
  print('NEXT: Tasks tab -> RUN ALL. When FRPIM01_raw_blocks_to_asset');
  print('and FRPIM01_qc01_to_asset have completed, press Run again (RUN 2: final map).');
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
    var sc = {min: 0, max: 1, palette: ['#d73027', '#fee08b', '#1a9850']};   // red = low, green = high
    var preview = [
      [S.A1, 'F1 Wetness (CTI)'], [Z.F2, 'F2 Soil water capacity'], [S.A5, 'F4 Near seasonal water'],
      [S.B1, 'F5 Soil depth proxy'], [S.B7, 'F6 Low rockiness'], [S.C1s, 'F10 Slope'], [S.C2s, 'F11 Cool aspect'],
      [S.E2, 'F14 Low biotic pressure'], [S.D2, 'N3 Degradation trend (need)'], [S.E4, 'N4 Erosion (need)'],
      [S.D3, 'N5 Biomass deficit (need)'], [Z.FVC, 'Vegetation cover at peak (FVC)']];
    preview.forEach(function (p) { Map.addLayer(p[0].clip(AOI), sc, 'Score ' + p[1], false); });
    Map.addLayer(R.BSI.clip(AOI), {min: -0.2, max: 0.2, palette: ['#1a9850', '#ffffbf', '#8c510a']},
                 'Bare soil index at peak greenness (brown = bare)', false);
    print('Map: tick any "Score ..." layer in the Layers menu (top right) to view a parameter. ' +
          'Red = low score, green = high. Final categories appear in the next run, after the tasks finish.');
  }
  }
}

/* ######################################################################
 *  RUN 2 — NEED x FEASIBILITY, MONTE CARLO, QC, COMPARISON, FINAL MAP (steps 18-26)
 * ###################################################################### */
function stepMap() {
  var CFG = {
    STAGE: 'SCORE', PUBLISH_NOW: true, CRS: SETTINGS.CRS, RANGE_NAME: SETTINGS.RANGE_NAME,
    AOI_ASSET: SETTINGS.AOI_ASSET, RAW_ASSET: ASSETS.RAW, QC01_ASSET: ASSETS.QC01, FINAL_ASSET: ASSETS.FINAL,
    V21_ASSET: ASSETS.V21, DRIVE_FOLDER: SETTINGS.DRIVE_FOLDER, EXPECTED_ANCHOR_ID: null,
    W_N: SETTINGS.W_N, W_F: SETTINGS.W_F, TH: SETTINGS.TH, TH_JITTER: 0.05, MATRIX_HN_LF: SETTINGS.MATRIX_HN_LF,
    RX: SETTINGS.RX, SITE_SPLITS: [0.33, 0.66], MC_K: 500, MC_SEED: 2026, MC_CONC: 125,
    CV_MIN: 0.05, RHO_MAX: 0.75, VIF_MAX: 5, X1_RHO_MAX: 0.60, INDEP_MAX: 0.60, OAT_MAX_SHARE: 0.15
  };

  /* ---------- model structure ---------- */
  var N_KEYS = ['N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7', 'N8'];
  var F_KEYS = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12', 'F13', 'F14'];
  var GROUPS = {M: ['F1', 'F2', 'F3', 'F4'], S: ['F5', 'F6', 'F7', 'F8', 'F9'],
                T: ['F10', 'F11', 'F12'], R: ['F13', 'F14']};
  var G_KEYS = ['M', 'S', 'T', 'R'];
  var GROUP_OF = {};
  G_KEYS.forEach(function (g) { GROUPS[g].forEach(function (k) { GROUP_OF[k] = g; }); });
  var GP = {};    // group points (fixed 35/35/18/12)
  G_KEYS.forEach(function (g) { GP[g] = GROUPS[g].reduce(function (s, k) { return s + CFG.W_F[k]; }, 0); });
  var PARAMS = N_KEYS.concat(F_KEYS);
  var NAMES = {
    N1: 'Canopy deficit', N2: 'Bare soil at peak greenness', N3: 'NDVI decline (RESTREND)', N4: 'Erosion (RUSLE)',
    N5: 'Biomass deficit', N6: 'Unrecovered tree loss', N7: 'Evergreen shrub invasion', N8: 'Near dense forest',
    F1: 'Wetness (CTI)', F2: 'Soil water capacity', F3: 'Climatic water balance', F4: 'Near seasonal water',
    F5: 'Soil depth proxy', F6: 'Low rockiness', F7: 'Texture', F8: 'Low coarse fragments', F9: 'pH',
    F10: 'Slope', F11: 'Cool aspect (heat load)', F12: 'Concave curvature', F13: 'Low fire frequency',
    F14: 'Low biotic pressure'
  };
  // priority class display order (map code), spec palette
  var CLASS_ORDER = ['HIGH', 'MODERATE', 'LOW', 'PROTECTED', 'EXCLUDED'];
  var CLASS_PAL = ['#d73027', '#fc8d59', '#fee08b', '#1a9850', '#bdbdbd'];
  var CLASS_TEXT = {HIGH: 'Phase I: restore in year 1', MODERATE: 'Phase II: SMC first / next season',
                    LOW: 'Phase III: ANR, SMC or protection', PROTECTED: 'Dense forest or natural grassland',
                    EXCLUDED: 'Water, drains, steep, built, crop, rock'};
  var RX_ORDER = ['PROTECT_DENSE', 'NOT_PLANTABLE', 'PROTECT_OPEN_ECOSYSTEM', 'FIRE_PROTECTION_FIRST',
                  'HYDRO_COMPATIBLE_PLANTING', 'SOIL_STABILISATION_FIRST', 'ROCKY_MICROSITE',
                  'INVASIVE_CLEAR_THEN_PLANT', 'SMC_DROUGHT_HARDY', 'ANR_GAP_PLANTING', 'MIXED_NATIVE_PLANTATION'];
  var RX_PAL = ['#00441b', '#bdbdbd', '#fff7bc', '#e31a1c', '#2171b5', '#8c510a', '#636363',
                '#984ea3', '#fd8d3c', '#a1d99b', '#41ab5d'];
  var RX_LABELS = {
    PROTECT_DENSE: 'Protect dense forest', NOT_PLANTABLE: 'Not plantable',
    PROTECT_OPEN_ECOSYSTEM: 'Protect open ecosystem (grassland)', FIRE_PROTECTION_FIRST: 'Fire protection first',
    HYDRO_COMPATIBLE_PLANTING: 'Hydrology-compatible planting', SOIL_STABILISATION_FIRST: 'Soil stabilisation first',
    ROCKY_MICROSITE: 'Rocky microsite planting', INVASIVE_CLEAR_THEN_PLANT: 'Clear invasives, then plant',
    SMC_DROUGHT_HARDY: 'SMC + drought-hardy natives', ANR_GAP_PLANTING: 'ANR + gap planting',
    MIXED_NATIVE_PLANTATION: 'Mixed native plantation'
  };
  var CHANGE_ORDER = ['NEWLY_PRIORITISED', 'PRIORITY_RETAINED', 'DEPRIORITISED', 'NO_MAJOR_CHANGE', 'NOT_IN_V21'];
  var CHANGE_PAL = ['#d73027', '#fc8d59', '#4575b4', '#e0e0e0', '#ffffff'];
  var CHANGE_LABELS = {NEWLY_PRIORITISED: 'Newly prioritised (v2.1 Cat 4-5 -> HIGH/MOD)',
                       PRIORITY_RETAINED: 'Priority retained (Cat 1-2 -> HIGH/MOD)',
                       DEPRIORITISED: 'De-prioritised (Cat 1-2 -> LOW/PROT/EXCL)',
                       NO_MAJOR_CHANGE: 'No major change', NOT_IN_V21: 'Not in v2.1 table'};
  var AOI_FC = ee.FeatureCollection(CFG.AOI_ASSET);
  var AOI = AOI_FC.geometry().dissolve({maxError: 1});

  /* ---------- small helpers (ES5 only: the Code Editor has an older JavaScript engine) ---------- */
  // evaluate() with up to 2 retries; make() builds a fresh request; retry runs 2 s later, outside
  // Earth Engine's reply handler; each callback runs once.
  function evalRetry(make, cb, attempt) {
    attempt = attempt || 1;
    var answered = false;
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
    var u1 = 0;
    while (u1 === 0) { u1 = RNG(); }
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * RNG());
  }
  function rgamma(alpha) {                       // Marsaglia & Tsang (2000)
    if (!(alpha > 0)) { return 0; }
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
  function dirichlet(weights) {                  // weights: array of points (any total)
    var tot = weights.reduce(function (s, w) { return s + w; }, 0);
    var g = weights.map(function (w) { return rgamma(CFG.MC_CONC * w / tot); });
    var gs = g.reduce(function (s, v) { return s + v; }, 0);
    return g.map(function (v) { return v / gs; });
  }
  function avgRanks(x) {
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
  function vifOf(cols) {                         // VIF = diag(inverse correlation matrix)
    var m = cols.length, i, j, k, a = [], out = [];
    for (i = 0; i < m; i++) {
      a.push([]);
      for (j = 0; j < m; j++) { a[i].push(i === j ? 1 : (pearson(cols[i], cols[j]) || 0)); }
      for (j = 0; j < m; j++) { a[i].push(i === j ? 1 : 0); }
    }
    for (i = 0; i < m; i++) {
      var piv = i;
      for (k = i + 1; k < m; k++) { if (Math.abs(a[k][i]) > Math.abs(a[piv][i])) { piv = k; } }
      if (Math.abs(a[piv][i]) < 1e-10) { return cols.map(function () { return Infinity; }); }
      var tmp = a[i]; a[i] = a[piv]; a[piv] = tmp;
      var d = a[i][i];
      for (j = 0; j < 2 * m; j++) { a[i][j] /= d; }
      for (k = 0; k < m; k++) {
        if (k === i) { continue; }
        var f = a[k][i];
        for (j = 0; j < 2 * m; j++) { a[k][j] -= f * a[i][j]; }
      }
    }
    for (i = 0; i < m; i++) { out.push(a[i][m + i]); }
    return out;
  }
  function b01(x) { return ee.Number(ee.Algorithms.If(x, 1, 0)); }   // Boolean -> 0/1 number (safe .and/.or)
  function yes(f, key) { return b01(ee.String(f.get(key)).equals('yes')); }
  function fmt(n) { return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function cls3(x) {
    return ee.Algorithms.If(x.lt(CFG.SITE_SPLITS[0]), 'Low', ee.Algorithms.If(x.lt(CFG.SITE_SPLITS[1]), 'Med', 'High'));
  }

  /* ---------- Publishing: maps, legend, click card, exports (used by both stages) ---------- */
  function publishAll(fin, mapFC) {
    mapFC = mapFC || fin;
    var CRS = CFG.CRS, tag = CFG.RANGE_NAME;
    function blockRaster(prop, src) { return (src || mapFC).reduceToImage([prop], ee.Reducer.first()).rename(prop); }
    function exportImg(img, name, scale) {
      Export.image.toDrive({image: img.clip(AOI), description: 'FRPIM02_' + name, folder: CFG.DRIVE_FOLDER,
        fileNamePrefix: 'FRPIM02_' + name + '_' + tag, region: AOI, crs: CRS, scale: scale, maxPixels: 1e11});
    }
    /* GeoTIFFs (products 4-7, 9) */
    exportImg(blockRaster('class_code').toByte(), 'priority_class_map', 30);
    exportImg(blockRaster('rx_code').toByte(), 'intervention_map', 30);
    exportImg(blockRaster('RNI').toFloat(), 'RNI_map', 30);
    exportImg(blockRaster('RFI').toFloat(), 'RFI_map', 30);
    exportImg(blockRaster('stability_high', fin).toFloat(), 'stability_map', 30);
    exportImg(blockRaster('change_code').toByte(), 'v21_v22_comparison_map', 30);
    /* polygons */
    Export.table.toDrive({collection: fin, description: 'FRPIM02_blocks_geojson', folder: CFG.DRIVE_FOLDER,
      fileNamePrefix: 'FRPIM02_blocks_' + tag, fileFormat: 'GeoJSON'});
    var SHP_FROM = ['block_id', 'beat_id', 'block_area_ha', 'net_plantable_ha', 'canopy_pct', 'canopy_track',
      'constraint_reason', 'degradation_evidence', 'RNI', 'RFI', 'M', 'S', 'T', 'R', 'need_class', 'feasibility_class',
      'priority_class', 'phase', 'RPS', 'intervention', 'smc_required', 'site_class', 'stability_high',
      'class_modal', 'class_range', 'b1_sensitive', 'recent_plantation_flag', 'protected_area_flag',
      'waterlogging_flag', 'fire_years', 'v21_category', 'change_type', 'field_check', 'anchor_id'];
    var SHP_TO = ['block_id', 'beat_id', 'area_ha', 'net_ha', 'canopy', 'can_track',
      'cons_rsn', 'deg_evid', 'RNI', 'RFI', 'M', 'S', 'T', 'R', 'need_cls', 'feas_cls',
      'priority', 'phase', 'RPS', 'interv', 'smc_req', 'site_cls', 'stab_high',
      'cls_modal', 'cls_range', 'b1_sens', 'g1_plant', 'g2_pa',
      'g4_wlog', 'fire_yrs', 'v21_cat', 'change', 'field_chk', 'anchor_id'];
    Export.table.toDrive({collection: fin.select(SHP_FROM, SHP_TO), description: 'FRPIM02_blocks_shp',
      folder: CFG.DRIVE_FOLDER, fileNamePrefix: 'FRPIM02_blocks_' + tag, fileFormat: 'SHP'});
    /* Product 11: field-check list */
    var FIELD_COLS = ['beat_id', 'block_id', 'priority_class', 'phase', 'RPS', 'stability_high', 'intervention',
      'smc_required', 'site_class', 'species_group', 'net_plantable_ha', 'canopy_pct', 'degradation_evidence',
      'constraint_reason', 'recent_plantation_flag', 'protected_area_flag', 'waterlogging_flag', 'b1_sensitive',
      'field_check_reason', 'fra_rights_check_required', 'staff_rights_FRA_checked', 'staff_encroachment_checked',
      'staff_decision', 'staff_remarks', 'lon', 'lat'];
    var fieldList = fin.filter(ee.Filter.eq('field_check', 'yes')).map(function (f) {
      var c = f.centroid(1).geometry().coordinates();
      return f.set({staff_rights_FRA_checked: '', staff_encroachment_checked: '', staff_decision: '',
                    staff_remarks: '', lon: c.get(0), lat: c.get(1)});
    }).sort('RPS', false).sort('class_code').sort('beat_id');
    Export.table.toDrive({collection: fieldList, description: 'FRPIM02_field_check_list', folder: CFG.DRIVE_FOLDER,
      fileNamePrefix: 'FRPIM02_field_check_list_' + tag, fileFormat: 'CSV', selectors: FIELD_COLS});

    /* ---- presentation map ---- */
    function styledBlocks(prop, palette, alpha) {
      var pal = ee.List(palette.map(function (c) { return c.replace('#', '') + alpha; }));
      return mapFC.map(function (f) {
        var i = ee.Number(f.get(prop)).int().subtract(1);
        return f.set('style', ee.Dictionary({color: 'ffffffcc', width: 0.6, fillColor: pal.get(i)}));
      }).style({styleProperty: 'style'});
    }
    var outlineVis = ee.Image().byte().paint(mapFC, 1, 0.6).visualize({palette: ['ffffff'], opacity: 0.8});
    function rasterVis(img, palette, lo, hi) {
      return img.visualize({min: lo, max: hi, palette: palette, opacity: 0.9}).blend(outlineVis);
    }
    var classVis = styledBlocks('class_code', CLASS_PAL, 'e6');
    var rxVis = styledBlocks('rx_code', RX_PAL, 'e6');
    var changeVis = styledBlocks('change_code', CHANGE_PAL, 'e6');
    var fabCol = ee.ImageCollection('projects/sat-io/open-datasets/FABDEM').filterBounds(AOI);
    var fab = fabCol.mosaic().setDefaultProjection(ee.Image(fabCol.first()).projection()).select([0]);
    var hillshade = ee.Terrain.hillshade(fab, 315, 35).visualize({min: 120, max: 255, palette: ['000000', 'ffffff']});
    var inside = ee.Image(1).clip(AOI).mask();
    var dimOutside = ee.Image(0).updateMask(inside.not()).visualize({palette: ['000000'], opacity: 0.55});
    var boundaryVis = ee.Image().byte().paint(AOI_FC, 1, 2.5).visualize({palette: ['ffff00']});
    var GRAD = ['7f2704', 'd94801', 'fdae6b', 'fff5eb', 'c7e9c0', '41ab5d', '00441b'];
    var NEED = ['fff5eb', 'fdd0a2', 'fd8d3c', 'd94801', '7f2704'];

    Map.clear();
    Map.setOptions('HYBRID');
    Map.setControlVisibility({all: true});
    Map.centerObject(AOI, 12);
    Map.addLayer(hillshade.updateMask(inside), {opacity: 0.45}, 'Relief (FABDEM hillshade)');
    Map.addLayer(dimOutside, {}, 'Outside range (dimmed)');
    Map.addLayer(classVis, {}, 'Restoration priority class');           // index 2 = main layer
    Map.addLayer(boundaryVis, {}, 'Range boundary');
    Map.addLayer(ee.Image(), {}, 'Selected block', false);               // index 4 = click highlight

    var subtitle = ui.Label('Sabarkantha Division, Gujarat  ·  FRPIM v2.2  ·  10 ha blocks',
                            {fontSize: '12px', color: '#444444', margin: '2px 0 0 0'});
    Map.add(ui.Panel([ui.Label('Forest Restoration Priority — ' + CFG.RANGE_NAME + ' Range',
                               {fontWeight: 'bold', fontSize: '18px', margin: '0'}), subtitle],
                     ui.Panel.Layout.flow('vertical'), {position: 'top-center', padding: '6px 14px'}));
    Map.add(ui.Panel([ui.Label('▲', {fontSize: '20px', margin: '0 0 -6px 0', textAlign: 'center', stretch: 'horizontal'}),
                      ui.Label('N', {fontWeight: 'bold', fontSize: '14px', margin: '0', textAlign: 'center', stretch: 'horizontal'})],
                     ui.Panel.Layout.flow('vertical'), {position: 'top-right', padding: '2px 8px', width: '44px'}));

    var legend = ui.Panel({style: {position: 'bottom-left', padding: '8px 12px', width: '340px'}});
    var STATS = null;
    function swatchRow(color, label, extra) {
      return ui.Panel([
        ui.Label('', {backgroundColor: color, padding: '9px', margin: '2px 8px 2px 0', border: '1px solid #999999'}),
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
      return STATS[group][key].n + ' blocks · ' + fmt(STATS[group][key].ha) + ' ha';
    }
    function head(t) { legend.add(ui.Label(t, {fontWeight: 'bold', fontSize: '13px', margin: '0 0 4px 0'})); }
    var MODES = {
      'Restoration priority class': function () {
        head('Restoration priority (need x feasibility)');
        CLASS_ORDER.forEach(function (k, i) { legend.add(swatchRow(CLASS_PAL[i], k + ' — ' + CLASS_TEXT[k], areaText('cls', k))); });
        legend.add(ui.Label('Hectares = net plantable area (protected/excluded: 0).', {fontSize: '10px', color: '#666666'}));
        return classVis;
      },
      'Intervention (11 types)': function () {
        head('Field intervention');
        RX_ORDER.forEach(function (k, i) { legend.add(swatchRow(RX_PAL[i], RX_LABELS[k], areaText('rx', k))); });
        return rxVis;
      },
      'Restoration need (RNI)': function () {
        head('Restoration Need Index — how degraded');
        gradientBar(NEED, '0 (intact)', '1 (severely degraded)').forEach(function (w) { legend.add(w); });
        return rasterVis(blockRaster('RNI'), NEED, 0, 1);
      },
      'Restoration feasibility (RFI)': function () {
        head('Restoration Feasibility Index — what the site supports');
        gradientBar(GRAD, '0 (hard site)', '1 (easy site)').forEach(function (w) { legend.add(w); });
        return rasterVis(blockRaster('RFI'), GRAD, 0, 1);
      },
      'Degradation evidence (0-4 lines)': function () {
        head('Lines of evidence of past cover (DE1-DE4)');
        gradientBar(['f7f7f7', 'cccccc', '969696', '525252', '252525'], '0 (not proven)', '4 (all lines)').forEach(function (w) { legend.add(w); });
        return rasterVis(blockRaster('degradation_evidence'), ['f7f7f7', 'cccccc', '969696', '525252', '252525'], 0, 4);
      },
      'Reliability (Monte Carlo)': function () {
        head('Share of 500 runs in HIGH (weights + thresholds varied)');
        gradientBar(['d73027', 'ffffbf', '1a9850'], '0 %', '100 % (robust HIGH)').forEach(function (w) { legend.add(w); });
        return rasterVis(blockRaster('stability_high', fin), ['d73027', 'ffffbf', '1a9850'], 0, 1);
      },
      'Change from v2.1': function () {
        head('v2.1 category -> v2.2 class');
        CHANGE_ORDER.forEach(function (k, i) { legend.add(swatchRow(CHANGE_PAL[i], CHANGE_LABELS[k], areaText('chg', k))); });
        return changeVis;
      }
    };
    var currentMode = 'Restoration priority class';
    function showMode(name) {
      currentMode = name;
      legend.clear();
      Map.layers().set(2, ui.Map.Layer(MODES[name](), {}, name));
    }
    Map.add(ui.Panel([ui.Label('Map layer', {fontWeight: 'bold', fontSize: '12px', margin: '4px 0 0 0'}),
                      ui.Select({items: Object.keys(MODES), value: currentMode, onChange: showMode, style: {stretch: 'horizontal'}})],
                     ui.Panel.Layout.flow('vertical'), {position: 'top-left', width: '280px', padding: '4px 8px'}));
    Map.add(legend);
    showMode(currentMode);

    evalRetry(function () {
      function grp(field) {
        return mapFC.reduceColumns(ee.Reducer.sum().group({groupField: 1, groupName: 'k'}),
                                   ['net_plantable_ha', field]).get('groups');
      }
      return ee.Dictionary({cls: grp('priority_class'), rx: grp('intervention'), chg: grp('change_type'),
                            clsN: mapFC.aggregate_histogram('priority_class'), rxN: mapFC.aggregate_histogram('intervention'),
                            chgN: mapFC.aggregate_histogram('change_type'),
                            anchor: ee.Feature(mapFC.first()).get('anchor_id')});
    }, function (d, err) {
      if (err) { print('Area summary could not be computed: ' + err); return; }
      STATS = {cls: {}, rx: {}, chg: {}};
      [['cls', 'clsN'], ['rx', 'rxN'], ['chg', 'chgN']].forEach(function (p) {
        d[p[0]].forEach(function (g) { STATS[p[0]][g.k] = {ha: g.sum, n: d[p[1]][g.k] || 0}; });
        Object.keys(d[p[1]]).forEach(function (k) { if (!STATS[p[0]][k]) { STATS[p[0]][k] = {ha: 0, n: d[p[1]][k]}; } });
      });
      subtitle.setValue('Sabarkantha Division, Gujarat  ·  FRPIM v2.2  ·  10 ha blocks  ·  anchors: ' + d.anchor);
      showMode(currentMode);
      var rowsC = [['Class', 'Net plantable ha', {role: 'style'}, {role: 'annotation'}]];
      CLASS_ORDER.slice(0, 3).forEach(function (k, i) {
        var s = STATS.cls[k] || {ha: 0};
        rowsC.push([k, s.ha, CLASS_PAL[i], fmt(s.ha) + ' ha']);
      });
      print(ui.Chart(rowsC, 'BarChart', {title: 'Net restorable area by priority class (ha)', legend: {position: 'none'},
                                         hAxis: {title: 'hectares'}, chartArea: {left: 110}}));
      var rowsR = [['Intervention', 'Net plantable ha', {role: 'style'}, {role: 'annotation'}]];
      RX_ORDER.forEach(function (k, i) {
        var s = STATS.rx[k] || {ha: 0};
        if (s.ha > 0) { rowsR.push([RX_LABELS[k], s.ha, RX_PAL[i], fmt(s.ha) + ' ha']); }
      });
      print(ui.Chart(rowsR, 'BarChart', {title: 'Net restorable area by intervention (ha)', legend: {position: 'none'},
                                         hAxis: {title: 'hectares'}, chartArea: {left: 230}}));
    });

    /* ---- click a block: info card ---- */
    var card = ui.Panel({style: {position: 'bottom-right', width: '320px', padding: '8px 10px', shown: false}});
    Map.add(card);
    var clickId = 0;
    function cardRow(label, value) {
      return ui.Panel([ui.Label(label, {fontSize: '11px', color: '#555555', margin: '1px 0', width: '125px'}),
                       ui.Label(String(value), {fontSize: '12px', margin: '1px 0', stretch: 'horizontal'})],
                      ui.Panel.Layout.flow('horizontal'));
    }
    function bar(name, v, good) {
      v = Number(v) || 0;
      var w = Math.max(2, Math.round(v * 140));
      var hiGood = good !== false;
      var col = (hiGood ? v : 1 - v) >= 0.66 ? '#1a9850' : ((hiGood ? v : 1 - v) >= 0.33 ? '#fee08b' : '#d73027');
      return ui.Panel([ui.Label(name, {fontSize: '11px', margin: '2px 0', width: '125px'}),
                       ui.Label('', {backgroundColor: col, padding: '5px ' + (w / 2) + 'px', margin: '4px 6px 0 0'}),
                       ui.Label(v.toFixed(2), {fontSize: '11px', margin: '2px 0'})], ui.Panel.Layout.flow('horizontal'));
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
        return ee.Dictionary({n: hit.size(), p: ee.Algorithms.If(hit.size().gt(0), ee.Feature(hit.first()).toDictionary(), null)});
      }, function (d, err) {
        if (my !== clickId) { return; }
        card.clear();
        if (err || !d || !d.n) { card.add(ui.Label('No block here. Click inside the range.', {fontSize: '12px'})); return; }
        var p = d.p, ci = CLASS_ORDER.indexOf(p.priority_class);
        card.add(ui.Label('Block ' + p.block_id, {fontWeight: 'bold', fontSize: '14px', margin: '0 0 4px 0'}));
        card.add(swatchRow(CLASS_PAL[ci < 0 ? 4 : ci], p.priority_class + (p.phase ? '  ·  Phase ' + p.phase : ''), ''));
        card.add(cardRow('Intervention', (RX_LABELS[p.intervention] || p.intervention) + (p.smc_required === 'yes' ? ' + SMC' : '')));
        card.add(cardRow('Species group', p.species_group || '-'));
        card.add(cardRow('Need / feasibility', (p.need_label || '-') + ' / ' + (p.feas_label || '-')));
        card.add(cardRow('Rank score (RPS)', p.RPS === undefined || p.RPS === null ? '-' : Number(p.RPS).toFixed(3)));
        card.add(cardRow('Net restorable', Number(p.net_plantable_ha).toFixed(2) + ' of ' + Number(p.block_area_ha).toFixed(2) + ' ha'));
        card.add(cardRow('Canopy cover', Number(p.canopy_pct).toFixed(1) + ' %'));
        card.add(cardRow('Degradation evidence', p.degradation_evidence + ' of 4 (' +
          ['DE1', 'DE2', 'DE3', 'DE4'].filter(function (k) { return p[k] === 'yes'; }).join(', ') + ')'));
        card.add(cardRow('Constraints', p.constraint_reason || 'none'));
        card.add(cardRow('Flags', [['recent_plantation_flag', 'G1 recent plantation?'], ['protected_area_flag', 'G2 protected area'],
          ['waterlogging_flag', 'G4 waterlogging']].filter(function (k) { return p[k[0]] === 'yes'; })
          .map(function (k) { return k[1]; }).join(', ') || 'none'));
        if (p.v21_category) { card.add(cardRow('v2.1 category', p.v21_category + '  (' + (p.change_type || '') + ')')); }
        var stabRow = cardRow('Reliability (HIGH)', 'computing ...');
        card.add(stabRow);
        card.add(ui.Label('Index and group scores', {fontWeight: 'bold', fontSize: '12px', margin: '6px 0 2px 0'}));
        card.add(bar('RNI need', p.RNI, false));
        card.add(bar('RFI feasibility', p.RFI));
        card.add(bar('M moisture', p.M)); card.add(bar('S soil', p.S));
        card.add(bar('T terrain', p.T)); card.add(bar('R low risk', p.R));
        card.add(ui.Label('Location: ' + c.lat.toFixed(5) + ' N, ' + c.lon.toFixed(5) + ' E',
                          {fontSize: '10px', color: '#666666', margin: '6px 0 0 0'}));
        evalRetry(function () { return ee.Feature(fin.filterBounds(pt).first()).get('stability_high'); }, function (s, e2) {
          if (my !== clickId) { return; }
          stabRow.widgets().get(1).setValue((e2 || s === null || s === undefined) ? 'n/a' :
            Math.round(s * 100) + ' % of runs' + (p.priority_class === 'HIGH' ? (s > 0.8 ? ' (robust)' : (s >= 0.5 ? ' (moderate)' : ' (marginal)')) : ''));
        });
      });
    });
    print('MAP: choose a layer in "Map layer" (top left). Click any block for its details.');

    /* ---- print-quality maps ---- */
    var printRegion = AOI.bounds(1).buffer(1500, 10);
    [['priority_class', classVis], ['intervention', rxVis]].forEach(function (x) {
      Export.image.toDrive({image: hillshade.blend(x[1]).blend(boundaryVis).clip(printRegion),
        description: 'FRPIM02_print_' + x[0] + '_RGB', folder: CFG.DRIVE_FOLDER,
        fileNamePrefix: 'FRPIM02_print_' + x[0] + '_RGB_' + tag, region: printRegion, crs: CRS, scale: 5, maxPixels: 1e11});
    });
    hillshade.blend(classVis).blend(boundaryVis).getThumbURL({region: printRegion, dimensions: 2048, format: 'png', crs: CRS},
      function (url, e3) {
        if (!e3 && url) { print(ui.Label('Download priority map PNG (2048 px) for slides', {color: '#1a73e8'}, url)); }
      });
    print('Field-check blocks:', fieldList.size());
  }

  /* ====================================================================== */
  if (CFG.STAGE === 'SCORE') {
  /* ====================================================================== */

  var raw = ee.FeatureCollection(CFG.RAW_ASSET);
  var N_ALL = raw.size();
  var FILL_KEYS = PARAMS.concat(['F5_opt', 'F5_pes']);

  /* ---------- Step 18a: null shares (FF-06) and gap fill by beat mean ---------- */
  var nullShare = ee.Dictionary.fromLists(FILL_KEYS, FILL_KEYS.map(function (k) {
    return ee.Number(1).subtract(raw.filter(ee.Filter.notNull([k])).size().divide(N_ALL));
  }));
  var BEAT_MEAN = {}, RANGE_MEAN = {};
  FILL_KEYS.forEach(function (k) {
    var ok = raw.filter(ee.Filter.notNull([k]));
    var groups = ee.List(ok.reduceColumns(ee.Reducer.mean().group({groupField: 1, groupName: 'beat'}), [k, 'beat_id']).get('groups'));
    BEAT_MEAN[k] = ee.Dictionary.fromLists(groups.map(function (g) { return ee.String(ee.Dictionary(g).get('beat')); }),
                                           groups.map(function (g) { return ee.Dictionary(g).get('mean'); }));
    RANGE_MEAN[k] = ee.Algorithms.If(ok.size().gt(0), ok.aggregate_mean(k), 0.5);
  });
  var filled = raw.map(function (f) {
    var beat = ee.String(f.get('beat_id'));
    var out = f, log = ee.List([]);
    FILL_KEYS.forEach(function (k) {
      var v = f.get(k);
      var isNull = ee.Algorithms.IsEqual(v, null);
      out = out.set(k, ee.Algorithms.If(isNull, BEAT_MEAN[k].get(beat, RANGE_MEAN[k]), v));
      log = ee.List(ee.Algorithms.If(isNull, log.add(k), log));
    });
    return out.set('gapfilled', log.join(','));
  });
  // blocks that enter the need x feasibility matrix: not C1, not C2-C7 > 30 %, not C8
  var inMatrix0 = filled.filter(ee.Filter.eq('excluded', 0)).filter(ee.Filter.eq('excluded_c8', 0));

  /* ---------- Step 18b: statistics for the CV guard ---------- */
  var statD = {};
  PARAMS.forEach(function (k) {
    statD[k + '_mean'] = inMatrix0.aggregate_mean(k);
    statD[k + '_sd'] = inMatrix0.aggregate_sample_sd(k);
  });
  print('Computing block statistics in the background ...');
  evalRetry(function () {
    return ee.Dictionary({N_all: N_ALL, N_in: inMatrix0.size(), nullShare: nullShare, stats: ee.Dictionary(statD),
                          nC8: filled.filter(ee.Filter.eq('excluded_c8', 1)).size(),
                          nExcl: filled.filter(ee.Filter.eq('excluded', 1)).size()});
  }, function (STATS, errS) {
  if (errS) { print('STOP: could not read the raw block table (has RUN 1 finished?): ' + errS); return; }
  print('Blocks: all = ' + STATS.N_all + ' | excluded C1-C7 = ' + STATS.nExcl + ' | protected C8 (open ecosystem) = ' +
        STATS.nC8 + ' | entering the need x feasibility matrix = ' + STATS.N_in);
  var NR = STATS.N_in;
  if (NR < 10) { print('STOP: fewer than 10 blocks enter the matrix — check the raw table.'); return; }
  function sdOf(k) { var v = STATS.stats[k + '_sd']; return (typeof v === 'number') ? v : 0; }
  function meanOf(k) { var v = STATS.stats[k + '_mean']; return (typeof v === 'number') ? v : 0; }

  /* ---------- Step 18c: collinearity (client side, from one table download) ---------- */
  var PAIRS_N = [], PAIRS_F = [], i0, j0;
  for (i0 = 0; i0 < N_KEYS.length; i0++) { for (j0 = i0 + 1; j0 < N_KEYS.length; j0++) { PAIRS_N.push([N_KEYS[i0], N_KEYS[j0]]); } }
  for (i0 = 0; i0 < F_KEYS.length; i0++) { for (j0 = i0 + 1; j0 < F_KEYS.length; j0++) { PAIRS_F.push([F_KEYS[i0], F_KEYS[j0]]); } }
  var COLKEYS = PARAMS.concat(['canopy_pct', 'X1']);
  print('Computing Spearman correlations and VIF ...');
  evalRetry(function () {
    return inMatrix0.filter(ee.Filter.notNull(COLKEYS)).reduceColumns(ee.Reducer.toList(COLKEYS.length), COLKEYS).get('list');
  }, function (ROWS, errC) {
  if (errC) { print('STOP: could not read the block table for the collinearity screen: ' + errC); return; }
  function column(k) { var c = COLKEYS.indexOf(k); return ROWS.map(function (r) { return Number(r[c]); }); }
  var RANKS = {};
  COLKEYS.forEach(function (k) { RANKS[k] = avgRanks(column(k)); });
  var RHO = {};
  function setRho(p) {
    var v = (sdOf(p[0]) <= 1e-9 || (PARAMS.indexOf(p[1]) >= 0 && sdOf(p[1]) <= 1e-9)) ? null : pearson(RANKS[p[0]], RANKS[p[1]]);
    RHO[p[0] + '|' + p[1]] = (typeof v === 'number' && isFinite(v)) ? v : null;
  }
  PAIRS_N.forEach(setRho); PAIRS_F.forEach(setRho);
  setRho(['X1', 'canopy_pct']);
  function rho(a, b) { var v = RHO[a + '|' + b]; if (v === undefined) { v = RHO[b + '|' + a]; } return v === undefined ? null : v; }
  var VIF = {};
  [N_KEYS, F_KEYS].forEach(function (keys) {
    var vary = keys.filter(function (k) { return sdOf(k) > 1e-9; });
    var v = vifOf(vary.map(column));
    vary.forEach(function (k, ii) { VIF[k] = v[ii]; });
  });
  print('Collinearity screen done on ' + ROWS.length + ' blocks.');

  /* ---------- Step 19: CV guard and collinearity actions (FF-07, FF-10..14) ---------- */
  var W = {};
  N_KEYS.forEach(function (k) { W[k] = CFG.W_N[k]; });
  F_KEYS.forEach(function (k) { W[k] = CFG.W_F[k]; });
  var CV_LOG = [], COL_LOG = [], DROPPED = {};
  function peers(k) { return N_KEYS.indexOf(k) >= 0 ? N_KEYS : GROUPS[GROUP_OF[k]]; }   // RNI: whole index; RFI: group
  function share(k, pts, exclude) {
    var others = peers(k).filter(function (o) { return o !== k && !DROPPED[o] && exclude.indexOf(o) < 0 && W[o] > 0; });
    var tot = others.reduce(function (s, o) { return s + W[o]; }, 0);
    if (tot <= 0) { return false; }
    others.forEach(function (o) { W[o] += pts * W[o] / tot; });
    return true;
  }
  PARAMS.forEach(function (k) {
    var m = meanOf(k), sd = sdOf(k);
    var cv = (Math.abs(m) > 1e-12) ? sd / Math.abs(m) : (sd > 0 ? Infinity : 0);
    if (cv < CFG.CV_MIN && W[k] > 0) {
      var pts = W[k];
      DROPPED[k] = true;
      if (share(k, pts, [])) {
        W[k] = 0;
        CV_LOG.push(k + ' CV=' + cv.toFixed(4) + ' -> ' + pts.toFixed(2) + ' pts shared in ' +
                    (N_KEYS.indexOf(k) >= 0 ? 'RNI' : 'group ' + GROUP_OF[k]));
      } else {
        DROPPED[k] = false;
        CV_LOG.push(k + ' CV=' + cv.toFixed(4) + ' but no other parameter to share with — kept');
      }
    }
  });
  var rX1 = rho('X1', 'canopy_pct');
  var FF11 = (rX1 === null || Math.abs(rX1) < CFG.X1_RHO_MAX) ? 'PASS' : 'FAIL';
  var r12 = rho('F5', 'F10'), FF12 = 'PASS';
  if (r12 !== null && Math.abs(r12) >= CFG.RHO_MAX) {
    FF12 = 'ACTION';
    var mv = Math.min(2, W.F10);
    W.F10 -= mv; W.F11 += mv;
    COL_LOG.push('FF-12 rho(F5,F10)=' + r12.toFixed(3) + ': F10 -' + mv + ' pts, F11 +' + mv);
  }
  var r13 = rho('N1', 'N5'), FF13 = 'PASS';
  if (r13 !== null && Math.abs(r13) >= CFG.RHO_MAX) {
    FF13 = 'ACTION';
    var d13 = W.N1 + W.N5, comp = Math.max(d13 - 5, 0);
    W.N1 = W.N1 * comp / d13; W.N5 = W.N5 * comp / d13; W.N3 += d13 - comp;
    COL_LOG.push('FF-13 rho(N1,N5)=' + r13.toFixed(3) + ': merged into canopy-biomass deficit worth ' + comp.toFixed(2) +
                 ' pts, N3 +' + (d13 - comp).toFixed(2));
  }
  var FF14 = 'PASS';
  PAIRS_N.concat(PAIRS_F).forEach(function (p) {
    var key = p[0] + '|' + p[1];
    if (key === 'F5|F10' || key === 'N1|N5') { return; }
    var r = RHO[key];
    if (r === null || Math.abs(r) <= CFG.RHO_MAX) { return; }
    FF14 = 'ACTION';
    var a = p[0], b = p[1];
    var sameUnit = (N_KEYS.indexOf(a) >= 0) || (GROUP_OF[a] === GROUP_OF[b]);
    if (sameUnit && W[a] + W[b] > 0) {
      var hi = Math.max(W[a], W[b]), sum = W[a] + W[b], freed = sum - hi;
      W[a] = W[a] * hi / sum; W[b] = W[b] * hi / sum;
      var shared = share(a, freed, [b]);
      if (!shared) { W[a] += freed * W[a] / hi; W[b] += freed * W[b] / hi; }
      COL_LOG.push('FF-14 ' + key + ' rho=' + r.toFixed(3) + ': merged at the higher weight (' + hi.toFixed(2) + ' pts)');
    } else {
      COL_LOG.push('FF-14 ' + key + ' rho=' + r.toFixed(3) + ': different feasibility groups — REVIEW');
    }
  });
  Object.keys(VIF).forEach(function (k) {
    if (VIF[k] > CFG.VIF_MAX) { FF14 = 'ACTION'; COL_LOG.push('FF-14 VIF(' + k + ')=' + (isFinite(VIF[k]) ? VIF[k].toFixed(2) : 'singular') + ' > ' + CFG.VIF_MAX + ': REVIEW'); }
  });
  var sumN = N_KEYS.reduce(function (s, k) { return s + W[k]; }, 0);
  var FF07 = Math.abs(sumN - 100) < 1e-6 ? 'PASS' : 'FAIL';
  G_KEYS.forEach(function (g) {
    var s = GROUPS[g].reduce(function (a, k) { return a + W[k]; }, 0);
    if (Math.abs(s - GP[g]) > 1e-6) { FF07 = 'FAIL'; }
  });
  if (FF07 === 'FAIL') { print('FF-07 STOP: weights do not sum to RNI 100 / groups 35-35-18-12.'); return; }
  var CV_REWEIGHT_LOG = CV_LOG.length ? CV_LOG.join(' | ') : 'none';
  print('Final weights (after CV guard / collinearity):', W);
  print('CV guard log:', CV_REWEIGHT_LOG);
  print('Collinearity log:', COL_LOG.length ? COL_LOG : 'none');

  /* ---------- Step 20-22: indices, classes, phase, intervention ---------- */
  var EXP_M = 0.65 * GP.M / (GP.M + GP.S), EXP_S = 0.65 * GP.S / (GP.M + GP.S);
  print('Feasibility exponents m, s:', EXP_M.toFixed(3), EXP_S.toFixed(3));
  var HNLF = CFG.MATRIX_HN_LF === 'HIGH' ? 3 : 2;
  var MATRIX = ee.List([[1, 1, 1], [1, 2, 2], [HNLF, 3, 3]]);   // [need][feas]: 1 LOW, 2 MODERATE, 3 HIGH
  var CELL_TEXT = ee.List([
    ['Phase III: protection', 'Phase III: ANR', 'Phase III: ANR'],
    ['Phase III: SMC and ANR', 'Phase II', 'Phase II'],
    [HNLF === 3 ? 'Phase I (DFO override)' : 'Phase II: SMC in year 1, planting in year 2',
     'Phase I: restore with SMC in year 1', 'Phase I: restore in year 1']]);
  var CLASS_NAMES = ee.List(['', 'LOW', 'MODERATE', 'HIGH']);
  var PHASES = ee.List(['', 'III', 'II', 'I']);
  var LEVEL = ee.List(['Low', 'Medium', 'High']);
  function g(f, k) { return ee.Number(f.get(k)); }
  function wsum(f, keys) {
    var s = ee.Number(0);
    keys.forEach(function (k) { s = s.add(g(f, k).multiply(W[k])); });
    return s;
  }
  function groupScore(f, grp, swap) {
    var s = ee.Number(0);
    GROUPS[grp].forEach(function (k) { s = s.add(g(f, (swap && swap[k]) || k).multiply(W[k])); });
    return s.divide(GP[grp]);
  }
  function rfiOf(M, S, T, R) {
    var TR = T.multiply(GP.T).add(R.multiply(GP.R)).divide(GP.T + GP.R);
    return M.max(0.01).pow(EXP_M).multiply(S.max(0.01).pow(EXP_S)).multiply(TR.multiply(0.45).add(0.55));
  }
  var scored = filled.map(function (f) {
    var deF = ee.Number(ee.Algorithms.If(g(f, 'degradation_evidence').gt(0), 1, 0.5));
    var rni = wsum(f, N_KEYS).divide(100).multiply(deF);
    var M = groupScore(f, 'M'), S = groupScore(f, 'S'), T = groupScore(f, 'T'), R = groupScore(f, 'R');
    var So = groupScore(f, 'S', {F5: 'F5_opt'}), Sp = groupScore(f, 'S', {F5: 'F5_pes'});
    var rfi = rfiOf(M, S, T, R);
    var nc = ee.Number(ee.Algorithms.If(rni.gte(CFG.TH.needHi), 2, ee.Algorithms.If(rni.gte(CFG.TH.needLo), 1, 0)));
    var fc = ee.Number(ee.Algorithms.If(rfi.gte(CFG.TH.feasHi), 2, ee.Algorithms.If(rfi.gte(CFG.TH.feasLo), 1, 0)));
    var code = ee.Number(ee.List(MATRIX.get(nc)).get(fc));
    var exC1 = g(f, 'excluded_c1').eq(1), exAny = g(f, 'excluded').eq(1), c8 = g(f, 'excluded_c8').eq(1);
    var pclass = ee.String(ee.Algorithms.If(exC1.or(c8), 'PROTECTED', ee.Algorithms.If(exAny, 'EXCLUDED', CLASS_NAMES.get(code))));
    var inM = exAny.or(c8).not();
    return f.set({
      M: M, S: S, T: T, R: R, S_opt: So, S_pes: Sp, RNI: rni, RFI: rfi, RFI_core: M.max(0.01).pow(EXP_M).multiply(S.max(0.01).pow(EXP_S)),
      deg_factor: deF,
      need_class: ee.Algorithms.If(inM, nc, null), feasibility_class: ee.Algorithms.If(inM, fc, null),
      need_label: ee.Algorithms.If(inM, LEVEL.get(nc), ''), feas_label: ee.Algorithms.If(inM, LEVEL.get(fc), ''),
      priority_code: ee.Algorithms.If(inM, code, 0),
      priority_class: pclass,
      class_code: ee.List(CLASS_ORDER).indexOf(pclass).add(1),
      phase: ee.Algorithms.If(inM, PHASES.get(code), ''),
      phase_note: ee.Algorithms.If(inM, ee.List(CELL_TEXT.get(nc)).get(fc), ee.Algorithms.If(exAny, 'Excluded', 'Protected')),
      RPS: ee.Algorithms.If(inM, rni.multiply(0.6).add(rfi.multiply(0.4)), 0)
    });
  });

  function interventionOf(f) {
    var M = g(f, 'M'), S = g(f, 'S');
    var canopy = g(f, 'canopy_pct');
    return ee.String(
      ee.Algorithms.If(g(f, 'excluded_c1').eq(1), 'PROTECT_DENSE',
      ee.Algorithms.If(g(f, 'excluded').eq(1), 'NOT_PLANTABLE',
      ee.Algorithms.If(g(f, 'excluded_c8').eq(1), 'PROTECT_OPEN_ECOSYSTEM',
      ee.Algorithms.If(g(f, 'F13').lt(CFG.RX.FIRE_F13), 'FIRE_PROTECTION_FIRST',
      ee.Algorithms.If(ee.String(f.get('waterlogging_flag')).equals('yes'), 'HYDRO_COMPATIBLE_PLANTING',
      ee.Algorithms.If(yes(f, 'X5').and(S.lt(CFG.RX.STAB_S)), 'SOIL_STABILISATION_FIRST',
      ee.Algorithms.If(ee.String(f.get('X4')).equals('yes'), 'ROCKY_MICROSITE',
      ee.Algorithms.If(g(f, 'N7').gte(CFG.RX.INVASIVE_N7), 'INVASIVE_CLEAR_THEN_PLANT',
      ee.Algorithms.If(M.lt(CFG.RX.SMC_M).or(yes(f, 'X1_driest_quartile')), 'SMC_DROUGHT_HARDY',
      ee.Algorithms.If(canopy.gte(10).and(canopy.lt(40)).or(ee.Number(ee.Algorithms.If(
          ee.Algorithms.IsEqual(f.get('need_class'), null), -1, f.get('need_class'))).eq(0)), 'ANR_GAP_PLANTING',
      'MIXED_NATIVE_PLANTATION')))))))))));
  }
  var RXD = ee.Dictionary.fromLists(RX_ORDER, RX_ORDER.map(function (k, i) { return i + 1; }));
  var LATE_RX = ee.List(['INVASIVE_CLEAR_THEN_PLANT', 'SMC_DROUGHT_HARDY', 'ANR_GAP_PLANTING', 'MIXED_NATIVE_PLANTATION']);
  function speciesOf(rx, M, S) {
    var worst = M.min(S);
    return ee.String(
      ee.Algorithms.If(ee.List(['ROCKY_MICROSITE', 'SMC_DROUGHT_HARDY']).contains(rx), 'Drought-hardy: khair, ber, desi babul, guggal, hingor',
      ee.Algorithms.If(ee.String(rx).equals('HYDRO_COMPATIBLE_PLANTING'), 'Riparian: arjun, jambu, karanj',
      ee.Algorithms.If(ee.String(rx).equals('SOIL_STABILISATION_FIRST'), 'Native grasses and shrubs first, then khair and ber',
      ee.Algorithms.If(ee.List(['PROTECT_DENSE', 'NOT_PLANTABLE', 'PROTECT_OPEN_ECOSYSTEM']).contains(rx), '-',
      ee.Algorithms.If(worst.lt(CFG.SITE_SPLITS[0]), 'Drought-hardy: khair, ber, desi babul, guggal, hingor',
      ee.Algorithms.If(worst.lt(CFG.SITE_SPLITS[1]), 'Medium: teak, dhavdo, timru, khakhro, neem, sadad',
                       'Moist/deep: mahudo, bamboo, jambu, karanj, amla')))))));
  }
  var withRx = scored.map(function (f) {
    var rx = interventionOf(f);
    var M = g(f, 'M'), S = g(f, 'S');
    var smc = yes(f, 'X3')
      .and(M.lt(CFG.RX.SMC_RESP_M).or(yes(f, 'X1_driest_half')))
      .and(b01(LATE_RX.contains(rx)));
    return f.set({intervention: rx, rx_code: RXD.get(rx), smc_required: ee.Algorithms.If(smc, 'yes', 'no'),
                  site_class: ee.String('M-').cat(cls3(M)).cat('/S-').cat(cls3(S)),
                  species_group: speciesOf(rx, M, S)});
  });

  /* ---------- Step 25 (part): v2.1 comparison join ---------- */
  var HAS_V21_TABLE = (typeof HAS_V21 === 'undefined') ? true : HAS_V21;
  var V21D = HAS_V21_TABLE ? (function () {
    var v = ee.FeatureCollection(CFG.V21_ASSET);
    return ee.Dictionary.fromLists(v.aggregate_array('block_id'), v.aggregate_array('category'));
  })() : ee.Dictionary({});
  var CHD = ee.Dictionary.fromLists(CHANGE_ORDER, CHANGE_ORDER.map(function (k, i) { return i + 1; }));
  var compared = withRx.map(function (f) {
    var v21 = V21D.get(f.get('block_id'), null);
    var has = b01(ee.Algorithms.IsEqual(v21, null)).eq(0);   // Booleans have no .not(): convert to a number
    var pc = ee.String(f.get('priority_class'));
    var hiMod = b01(pc.equals('HIGH')).or(b01(pc.equals('MODERATE')));
    var c = ee.Number(ee.Algorithms.If(has, v21, 0));
    var ch = ee.String(ee.Algorithms.If(has.not(), 'NOT_IN_V21',
              ee.Algorithms.If(c.gte(4).and(hiMod), 'NEWLY_PRIORITISED',
              ee.Algorithms.If(c.lte(2).and(hiMod), 'PRIORITY_RETAINED',
              ee.Algorithms.If(c.lte(2), 'DEPRIORITISED', 'NO_MAJOR_CHANGE')))));
    return f.set({v21_category: ee.Algorithms.If(has, v21, null), change_type: ch, change_code: CHD.get(ch)});
  });

  /* ---------- Step 21 + 23: array engine — base classes and Monte Carlo ---------- */
  var ret = compared.filter(ee.Filter.eq('excluded', 0)).filter(ee.Filter.eq('excluded_c8', 0)).sort('block_id');
  var N = ee.Number(NR);
  function full(v) { return ee.Array(ee.List.repeat(v, N)); }
  function arr(p) { return ee.Array(ret.aggregate_array(p)); }
  var NMAT = ee.Array(ret.reduceColumns(ee.Reducer.toList(N_KEYS.length), N_KEYS).get('list'));   // N x 8
  var FMAT = ee.Array(ret.reduceColumns(ee.Reducer.toList(F_KEYS.length), F_KEYS).get('list'));   // N x 14
  var F5O = arr('F5_opt'), F5P = arr('F5_pes'), F5C = arr('F5');
  var DEF = arr('deg_factor');
  var F001 = full(0.01), F055 = full(0.55);
  function col(a) { return ee.Array(a.map(function (v) { return [v]; })); }   // JS list -> k x 1 array
  function groupsFrom(wF) {           // wF: JS map of F weights -> server arrays M, S, T, R and group totals
    var out = {}, tot = {};
    G_KEYS.forEach(function (gk) {
      tot[gk] = GROUPS[gk].reduce(function (s, k) { return s + wF[k]; }, 0);
      var v = F_KEYS.map(function (k) { return GROUP_OF[k] === gk && tot[gk] > 0 ? wF[k] / tot[gk] : 0; });
      out[gk] = FMAT.matrixMultiply(col(v)).project([0]);
    });
    out.tot = tot;
    return out;
  }
  function classCodes(rni, rfi, th) {
    var nc = rni.gte(full(th.needHi)).add(rni.gte(full(th.needLo)));
    var fc = rfi.gte(full(th.feasHi)).add(rfi.gte(full(th.feasLo)));
    var fge1 = fc.gte(full(1));
    var hnlf = full(HNLF === 3 ? 1 : 0);
    return full(1).add(nc.eq(full(1)).multiply(fge1))
                  .add(nc.eq(full(2)).multiply(full(1).add(fge1.max(hnlf))));
  }
  function rfiArr(M, S, T, R, gtot, em, es) {
    var TR = T.multiply(full(gtot.T)).add(R.multiply(full(gtot.R))).divide(full(gtot.T + gtot.R));
    return M.max(F001).pow(full(em)).multiply(S.max(F001).pow(full(es))).multiply(F055.add(TR.multiply(full(0.45))));
  }
  var BASEG = groupsFrom(W);
  var BASE_RNI = NMAT.matrixMultiply(col(N_KEYS.map(function (k) { return W[k] / 100; }))).project([0]).multiply(DEF);
  var BASE_RFI = rfiArr(BASEG.M, BASEG.S, BASEG.T, BASEG.R, GP, EXP_M, EXP_S);
  var BASE_CODE = classCodes(BASE_RNI, BASE_RFI, CFG.TH);
  // S with the F5 variants: S_v = S + w(F5)/GP.S * (F5_v - F5)
  var dS = W.F5 / GP.S;
  var S_OPT = BASEG.S.add(F5O.subtract(F5C).multiply(full(dS)));
  var S_PES = BASEG.S.add(F5P.subtract(F5C).multiply(full(dS)));

  // --- Monte Carlo draws (Section 11.2) ---
  var DRAWS = [];
  var wNbase = N_KEYS.map(function (k) { return W[k]; });
  var gBase = G_KEYS.map(function (gk) { return GP[gk]; });
  for (var k0 = 0; k0 < CFG.MC_K; k0++) {
    var wn = dirichlet(wNbase), gw = dirichlet(gBase);
    var gm = gw[0], gs = gw[1], gt = gw[2], gr = gw[3];
    var jit = function () { return (RNG() * 2 - 1) * CFG.TH_JITTER; };
    DRAWS.push({k: k0, wN: wn, gM: gm, gS: gs, gT: gt, gR: gr,
                m: 0.65 * gm / (gm + gs), s: 0.65 * gs / (gm + gs),
                needHi: CFG.TH.needHi + jit(), needLo: CFG.TH.needLo + jit(),
                feasHi: CFG.TH.feasHi + jit(), feasLo: CFG.TH.feasLo + jit(),
                f5: RNG() < 0.5 ? 'pessimistic' : 'optimistic'});
  }
  var K = CFG.MC_K, KHALF = Math.floor(K / 2);
  var DRAW_LIST = ee.List(DRAWS.map(function (d) {
    return [d.k, d.wN, d.m, d.s, d.gT, d.gR, d.needHi, d.needLo, d.feasHi, d.feasLo, d.f5 === 'pessimistic' ? 1 : 0];
  }));
  var Z0 = full(0);
  var MC = ee.Dictionary(DRAW_LIST.iterate(function (d, st) {
    d = ee.List(d); st = ee.Dictionary(st);
    var kk = ee.Number(d.get(0));
    var wn = ee.Array(ee.List(d.get(1))).reshape([N_KEYS.length, 1]);
    var em = ee.Number(d.get(2)), es = ee.Number(d.get(3));
    var gT = ee.Number(d.get(4)), gR = ee.Number(d.get(5));
    var th = {needHi: d.get(6), needLo: d.get(7), feasHi: d.get(8), feasLo: d.get(9)};
    var rni = NMAT.matrixMultiply(wn).project([0]).multiply(DEF);
    var TR = BASEG.T.multiply(ee.Array(ee.List.repeat(gT, N))).add(BASEG.R.multiply(ee.Array(ee.List.repeat(gR, N))))
               .divide(ee.Array(ee.List.repeat(gT.add(gR), N)));
    function rfiS(Sv) {
      return BASEG.M.max(F001).pow(ee.Array(ee.List.repeat(em, N)))
        .multiply(Sv.max(F001).pow(ee.Array(ee.List.repeat(es, N))))
        .multiply(F055.add(TR.multiply(full(0.45))));
    }
    var cO = classCodes(rni, rfiS(S_OPT), th), cP = classCodes(rni, rfiS(S_PES), th);
    var c = ee.Array(ee.Algorithms.If(ee.Number(d.get(10)).eq(1), cP, cO));
    var hi = ee.Array(st.get('hi')).add(c.eq(full(3)));
    return ee.Dictionary({
      hi: hi,
      n1: ee.Array(st.get('n1')).add(c.eq(full(1))),
      n2: ee.Array(st.get('n2')).add(c.eq(full(2))),
      n3: ee.Array(st.get('n3')).add(c.eq(full(3))),
      cmin: ee.Array(st.get('cmin')).min(c), cmax: ee.Array(st.get('cmax')).max(c),
      bdiff: ee.Array(st.get('bdiff')).add(cO.neq(cP)),
      half: ee.Algorithms.If(kk.eq(KHALF - 1), hi.reduce(ee.Reducer.sum(), [0]).get([0]).divide(N.multiply(KHALF)), st.get('half'))
    });
  }, ee.Dictionary({hi: Z0, n1: Z0, n2: Z0, n3: Z0, cmin: full(3), cmax: full(1), bdiff: Z0, half: 0})));
  var HI = ee.Array(MC.get('hi'));
  var STAB = HI.divide(full(K));
  var MEAN_FULL = HI.reduce(ee.Reducer.sum(), [0]).get([0]).divide(N.multiply(K));
  var MEAN_HALF = ee.Number(MC.get('half'));
  var best = ee.Array(MC.get('n1')), modal = full(1);
  [2, 3].forEach(function (cc) {
    var nc = ee.Array(MC.get('n' + cc));
    modal = modal.add(nc.gt(best).multiply(full(cc).subtract(modal)));
    best = best.max(nc);
  });
  var BSENS = ee.Array(MC.get('bdiff')).divide(full(K));
  var L = {stab: STAB.toList(), modal: modal.toList(), cmin: ee.Array(MC.get('cmin')).toList(),
           cmax: ee.Array(MC.get('cmax')).toList(), bs: BSENS.toList()};
  var RET_LIST = ret.toList(N);
  var retOut = ee.FeatureCollection(ee.List.sequence(0, N.subtract(1)).map(function (ii) {
    ii = ee.Number(ii).int();
    var f = ee.Feature(RET_LIST.get(ii));
    var bs = ee.Number(L.bs.get(ii));
    return f.set({
      stability_high: L.stab.get(ii),
      class_modal: CLASS_NAMES.get(ee.Number(L.modal.get(ii)).int()),
      class_range: ee.String(CLASS_NAMES.get(ee.Number(L.cmin.get(ii)).int())).cat('-')
                     .cat(CLASS_NAMES.get(ee.Number(L.cmax.get(ii)).int())),
      b1_disagree_share: bs,
      b1_sensitive: ee.Algorithms.If(bs.gt(0.20), 'yes', 'no')
    });
  }));
  var outOfMatrix = compared.filter(ee.Filter.or(ee.Filter.eq('excluded', 1), ee.Filter.eq('excluded_c8', 1))).map(function (f) {
    return f.set({stability_high: 0, class_modal: f.get('priority_class'), class_range: f.get('priority_class'),
                  b1_disagree_share: 0, b1_sensitive: 'no'});
  });
  var finalFC = retOut.merge(outOfMatrix).map(function (f) {
    var pc = ee.String(f.get('priority_class'));
    var stab = g(f, 'stability_high');
    var c6 = ee.Number(ee.Algorithms.If(ee.Algorithms.IsEqual(f.get('C6_frac'), null), 0, f.get('C6_frac')));
    var why = ee.List([
      ee.Algorithms.If(b01(pc.equals('HIGH')).and(stab.lt(0.80)), 'HIGH with reliability < 0.80', ''),
      ee.Algorithms.If(ee.String(f.get('recent_plantation_flag')).equals('yes'), 'G1 recent plantation?', ''),
      ee.Algorithms.If(ee.String(f.get('protected_area_flag')).equals('yes'), 'G2 protected area', ''),
      ee.Algorithms.If(ee.String(f.get('b1_sensitive')).equals('yes'), 'G3 soil pit', ''),
      ee.Algorithms.If(ee.String(f.get('waterlogging_flag')).equals('yes'), 'G4 waterlogging', ''),
      ee.Algorithms.If(c6.gt(0), 'C6 cultivation inside forest (rights/encroachment)', ''),
      ee.Algorithms.If(g(f, 'excluded_c8').eq(1), 'C8 confirm natural grassland (re-score if past forest found)', ''),
      ee.Algorithms.If(b01(pc.equals('HIGH')).and(g(f, 'degradation_evidence').eq(0)), 'HIGH without degradation evidence', '')
    ]).filter(ee.Filter.neq('item', ''));
    var stabRead = ee.Algorithms.If(stab.gt(0.80), 'Robust', ee.Algorithms.If(stab.gte(0.50), 'Moderately stable', 'Marginal'));
    return f.set({
      stability_reading: ee.Algorithms.If(pc.equals('HIGH'), stabRead, ''),
      field_check: ee.Algorithms.If(why.size().gt(0), 'yes', 'no'),
      field_check_reason: why.join('; '),
      fra_rights_check_required: ee.Algorithms.If(b01(pc.equals('HIGH')).or(b01(pc.equals('MODERATE'))), 'yes', 'no'),
      cv_reweight_log: CV_REWEIGHT_LOG,
      weights_used: JSON.stringify(W),
      model_version: 'FRPIM_v2.2'
    });
  });
  // light copy for the on-screen map (no Monte Carlo)
  var MAPFC = compared;

  /* ---------- Step 24: one-at-a-time sensitivity (44 runs) ---------- */
  var OAT = [];
  PARAMS.forEach(function (k) {
    [0.8, 1.2].forEach(function (mlt) {
      if (W[k] <= 0) { return; }
      var keys = N_KEYS.indexOf(k) >= 0 ? N_KEYS : F_KEYS;
      var Wv = {};
      PARAMS.forEach(function (p) { Wv[p] = W[p]; });
      var newK = W[k] * mlt, restOld = 100 - W[k], restNew = 100 - newK;
      keys.forEach(function (p) { if (p !== k) { Wv[p] = W[p] * restNew / restOld; } });
      Wv[k] = newK;
      OAT.push({param: k, factor: mlt, W: Wv});
    });
  });
  var OAT_FC = ee.FeatureCollection(OAT.map(function (o) {
    var rni = NMAT.matrixMultiply(col(N_KEYS.map(function (k) { return o.W[k] / 100; }))).project([0]).multiply(DEF);
    var gg = groupsFrom(o.W);
    var em = 0.65 * gg.tot.M / (gg.tot.M + gg.tot.S), es = 0.65 * gg.tot.S / (gg.tot.M + gg.tot.S);
    var c = classCodes(rni, rfiArr(gg.M, gg.S, gg.T, gg.R, gg.tot, em, es), CFG.TH);
    var shareCh = c.neq(BASE_CODE).reduce(ee.Reducer.sum(), [0]).get([0]).divide(N);
    return ee.Feature(null, {parameter: o.param, name: NAMES[o.param], index: N_KEYS.indexOf(o.param) >= 0 ? 'RNI' : 'RFI',
                             factor: o.factor, share_blocks_changed: shareCh,
                             over_influential: ee.Algorithms.If(shareCh.gt(CFG.OAT_MAX_SHARE), 'yes', 'no')});
  })).sort('share_blocks_changed', false);

  /* ---------- collinearity table ---------- */
  var COL_FC = ee.FeatureCollection(PAIRS_N.map(function (p) { return ['RNI', p]; }).concat(PAIRS_F.map(function (p) { return ['RFI', p]; }))
    .map(function (x) {
      var r = RHO[x[1][0] + '|' + x[1][1]];
      return ee.Feature(null, {type: 'spearman', index: x[0], a: x[1][0], b: x[1][1], value: r === null ? -999 : r,
                               flag: (r !== null && Math.abs(r) > CFG.RHO_MAX) ? 'yes' : 'no'});
    }).concat(Object.keys(VIF).map(function (k) {
      return ee.Feature(null, {type: 'VIF', index: N_KEYS.indexOf(k) >= 0 ? 'RNI' : 'RFI', a: k, b: '',
                               value: isFinite(VIF[k]) ? VIF[k] : -1, flag: VIF[k] > CFG.VIF_MAX ? 'yes' : 'no'});
    })));
  var DRAW_FC = ee.FeatureCollection(DRAWS.map(function (d) {
    var o = {k: d.k, m: d.m, s: d.s, gM: d.gM, gS: d.gS, gT: d.gT, gR: d.gR, needHi: d.needHi, needLo: d.needLo,
             feasHi: d.feasHi, feasLo: d.feasLo, f5_variant: d.f5};
    N_KEYS.forEach(function (k, i) { o['w_' + k] = d.wN[i]; });
    return ee.Feature(null, o);
  }));

  /* ---------- transition table (product 9) and decision summary (product 12) ---------- */
  var TRANS = ee.FeatureCollection(ee.List(compared.map(function (f) {
    return f.set('tkey', ee.String(ee.Algorithms.If(ee.Algorithms.IsEqual(f.get('v21_category'), null), 'none',
                  ee.Number(f.get('v21_category')).format('%.0f'))).cat('|').cat(f.get('priority_class')));
  }).reduceColumns(ee.Reducer.sum().repeat(2).group({groupField: 2, groupName: 'k'}),
                   ['block_area_ha', 'net_plantable_ha', 'tkey']).get('groups')).map(function (gq) {
    gq = ee.Dictionary(gq);
    var parts = ee.String(gq.get('k')).split('\\|');
    return ee.Feature(null, {v21_category: parts.get(0), v22_class: parts.get(1),
                             block_area_ha: ee.List(gq.get('sum')).get(0), net_plantable_ha: ee.List(gq.get('sum')).get(1)});
  }));
  function summaryRows(fc, beatOf) {
    return ee.List(fc.map(function (f) {
      return f.set('skey', ee.String(beatOf(f)).cat('|').cat(f.get('priority_class')).cat('|')
                     .cat(f.get('phase')).cat('|').cat(f.get('intervention')));
    }).reduceColumns(ee.Reducer.sum().combine({reducer2: ee.Reducer.count(), sharedInputs: true})
                     .group({groupField: 1, groupName: 'k'}), ['net_plantable_ha', 'skey']).get('groups'))
      .map(function (gq) {
        gq = ee.Dictionary(gq);
        var p = ee.String(gq.get('k')).split('\\|');
        return ee.Feature(null, {beat: p.get(0), priority_class: p.get(1), phase: p.get(2), intervention: p.get(3),
                                 net_plantable_ha: gq.get('sum'), blocks: gq.get('count')});
      });
  }
  var DECISION = ee.FeatureCollection(summaryRows(withRx, function () { return 'RANGE_TOTAL'; })
    .cat(summaryRows(withRx, function (f) { return f.get('beat_id'); })));

  /* ---------- qc_log (Section 12, 28 checks) ---------- */
  var HAS_QC = (typeof HAS_QC01 === 'undefined') ? true : HAS_QC01;
  var qc01 = HAS_QC ? ee.Feature(ee.FeatureCollection(CFG.QC01_ASSET).first()) : null;
  function st(cond, ok, bad) { return ee.Algorithms.If(cond, ok || 'PASS', bad || 'FAIL'); }
  function q(id, check, value, status, action) {
    return ee.Feature(null, {id: id, check: check, value: value, status: status, if_fail: action});
  }
  function notRecorded(id, check) {
    return q(id, check, 'not recorded: the QC01 table was not saved', 'NOT RECORDED', 'Re-run RUN 1 to regenerate QC01');
  }
  var maxNull = ee.List(FILL_KEYS.map(function (k) { return nullShare.get(k); })).reduce(ee.Reducer.max());
  var SCORE_KEYS = PARAMS.concat(['M', 'S', 'T', 'R', 'RNI', 'RFI']);
  var inM = compared.filter(ee.Filter.eq('excluded', 0)).filter(ee.Filter.eq('excluded_c8', 0));
  var minScore = ee.List(SCORE_KEYS.map(function (k) { return inM.aggregate_min(k); })).reduce(ee.Reducer.min());
  var maxScore = ee.List(SCORE_KEYS.map(function (k) { return inM.aggregate_max(k); })).reduce(ee.Reducer.max());
  var anchorIds = raw.aggregate_array('anchor_id').distinct();
  var anchor0 = ee.String(anchorIds.get(0));
  var ff09 = ee.Algorithms.If(anchorIds.size().neq(1), 'FAIL (more than one anchor ID)',
             ee.Algorithms.If(anchor0.slice(0, 5).equals('LOCAL'),
               'PASS (local anchors: range + buffer; RNI/RFI comparable within this landscape only)', 'PASS'));
  var ff15bad = compared.filter(ee.Filter.gte('fire_years', 5)).filter(ee.Filter.gte('F13', 0.55)).size();
  var ff16bad = compared.filter(ee.Filter.eq('excluded_c1', 1)).filter(ee.Filter.neq('priority_class', 'PROTECTED')).size();
  var ff17bad = compared.map(function (f) {
    return f.set('d__', g(f, 'net_plantable_ha').subtract(g(f, 'block_area_ha')));
  }).filter(ee.Filter.gt('d__', 1e-9)).size();
  function spread(k) {
    var pp = inM.reduceColumns(ee.Reducer.percentile([5, 95]), [k]);
    return ee.Number(pp.get('p95')).subtract(ee.Number(pp.get('p5')));
  }
  var spRNI = spread('RNI'), spRFI = spread('RFI');
  var clsShares = ee.List([1, 2, 3].map(function (cc) {
    return BASE_CODE.eq(full(cc)).reduce(ee.Reducer.sum(), [0]).get([0]).divide(N);
  }));
  var shareOK = ee.Number(clsShares.reduce(ee.Reducer.max())).lte(0.70).and(ee.Number(clsShares.reduce(ee.Reducer.min())).gte(0.05));
  var dMC = MEAN_FULL.subtract(MEAN_HALF).abs();
  var nGrid = ee.Number(ee.Feature(raw.first()).get('n_blocks_grid'));
  var FIRE_GAP_TEXT = ee.Feature(raw.first()).get('fire_source_gap');
  var gapPresent = raw.filter(ee.Filter.notNull(['fire_source_gap'])).size().eq(N_ALL);
  var c8bad = compared.filter(ee.Filter.eq('excluded_c8', 1))
    .filter(ee.Filter.or(ee.Filter.gte('canopy_pct', 10), ee.Filter.gt('degradation_evidence', 0))).size();
  var highNoDE = compared.filter(ee.Filter.eq('priority_class', 'HIGH')).filter(ee.Filter.eq('degradation_evidence', 0)).size();
  var rhoIdx = ee.Number(ee.Dictionary(inM.reduceColumns(ee.Reducer.spearmansCorrelation(), ['RNI', 'RFI'])).values().get(0));
  var transHa = TRANS.aggregate_sum('block_area_ha'), allHa = compared.aggregate_sum('block_area_ha');
  var notInV21 = compared.filter(ee.Filter.eq('change_type', 'NOT_IN_V21')).size();
  var VW = (typeof VERSION_WATCH === 'undefined') ? 'version watch not run' : VERSION_WATCH;

  var QC_FC = ee.FeatureCollection([
    HAS_QC ? q('FF-01', 'Asset access (24 datasets)', qc01.get('FF01_asset_log'), qc01.get('FF01_status'), 'STOP: re-check ID in Section 5') : notRecorded('FF-01', 'Asset access (24 datasets)'),
    HAS_QC ? q('FF-02', 'Working CRS', qc01.get('FF02_crs'), qc01.get('FF02_status'), 'STOP: fix UTM formula') : notRecorded('FF-02', 'Working CRS'),
    HAS_QC ? q('FF-03', 'Mosaic nominal scales', qc01.get('FF03_scales'), qc01.get('FF03_status'), 'STOP: setDefaultProjection') : notRecorded('FF-03', 'Mosaic nominal scales'),
    HAS_QC ? q('FF-04', 'Interior blocks outside 9.99-10.01 ha', qc01.get('FF04_interior_blocks_out_of_tolerance'),
      st(ee.Number(qc01.get('FF04_interior_blocks_out_of_tolerance')).eq(0)), 'Grid scale wrong') : notRecorded('FF-04', 'Block area'),
    HAS_QC ? q('FF-05', 'Null beat_id count', qc01.get('FF05_null_beat'), st(ee.Number(qc01.get('FF05_null_beat')).eq(0)),
      "Re-inspect asset; fall back to 'RANGE'") : notRecorded('FF-05', 'Beat field'),
    q('FF-06', 'Max parameter null share (before beat-mean fill)', maxNull, st(ee.Number(maxNull).lt(0.02)), 'Check masks; gaps filled with beat mean'),
    q('FF-07', 'RNI = 100; RFI groups 35/35/18/12', JSON.stringify(W), FF07, 'Arithmetic error'),
    q('FF-08', 'All parameter, group and index scores in [0,1]',
      ee.String(ee.Number(minScore).format('%.4f')).cat(', ').cat(ee.Number(maxScore).format('%.4f')),
      st(ee.Number(minScore).gte(-1e-9).and(ee.Number(maxScore).lte(1 + 1e-9))), 'Anchor or curve error'),
    q('FF-09', 'Single anchor ID', anchorIds.join(','), ff09, 'Re-run anchors'),
    q('FF-10', 'CV guard (CV < 0.05 reweighted)', CV_REWEIGHT_LOG, CV_LOG.length ? 'APPLIED' : 'PASS', 'Section 8.3'),
    q('FF-11', 'rho(X1, canopy) < 0.60', String(rX1), FF11, 'Set A3_MASK_TREES = true and re-run RUN 1'),
    q('FF-12', 'rho(F5, F10) < 0.75', String(r12), FF12, 'F10 cut to 6 pts, +2 to F11 (auto)'),
    q('FF-13', 'rho(N1, N5) < 0.75', String(r13), FF13, 'Merged to 30 pts, +5 to N3 (auto)'),
    q('FF-14', 'Other pairs in an index |rho| <= 0.75, VIF <= 5', COL_LOG.length ? COL_LOG.join(' | ') : 'none', FF14, 'Merge at higher weight / review'),
    q('FF-15', 'Blocks with >= 5 fire years and F13 >= 0.55', ff15bad, st(ff15bad.eq(0), 'PASS', 'STOP'), 'Inversion missing'),
    q('FF-16', 'C1 blocks not PROTECTED', ff16bad, st(ff16bad.eq(0), 'PASS', 'STOP'), 'Threshold coordination'),
    q('FF-17', 'Blocks with net_plantable_ha > block_area_ha', ff17bad, st(ff17bad.eq(0)), 'Fraction error'),
    HAS_QC ? q('FF-18', 'Min clear S2 obs per window-year (5th pct: X1, N7, N2)',
      ee.String(ee.Number(qc01.get('FF18_A3_p5_min_clear_obs')).format('%.0f')).cat(', ')
        .cat(ee.Number(qc01.get('FF18_D5_p5_min_clear_obs')).format('%.0f')).cat(', ')
        .cat(ee.Number(qc01.get('FF18_N2_p5_min_clear_obs')).format('%.0f')),
      st(ee.Number(qc01.get('FF18_A3_p5_min_clear_obs')).gte(3).and(ee.Number(qc01.get('FF18_D5_p5_min_clear_obs')).gte(3))
           .and(ee.Number(qc01.get('FF18_N2_p5_min_clear_obs')).gte(3))), 'Set CS_THRESHOLD = 0.50 and log it') : notRecorded('FF-18', 'S2 scenes'),
    HAS_QC ? q('FF-19', 'Landsat: share of pixels with >= 8 years; 2000-05 clear obs (5th pct)',
      ee.String(ee.Number(qc01.get('FF19_share_pixels_8yrs')).format('%.3f')).cat(', ')
        .cat(ee.Number(qc01.get('FF19_DE4_p5_clear_obs_2000_05')).format('%.0f')),
      st(ee.Number(qc01.get('FF19_share_pixels_8yrs')).gte(0.95).and(ee.Number(qc01.get('FF19_DE4_p5_clear_obs_2000_05')).gte(3))),
      'Widen windows to Sep-Dec and log it') : notRecorded('FF-19', 'Landsat depth'),
    q('FF-20', 'RNI and RFI spread p95 - p5 (>= 0.30 each)', ee.String(spRNI.format('%.3f')).cat(', ').cat(spRFI.format('%.3f')),
      st(spRNI.gte(0.30).and(spRFI.gte(0.30))), 'Review CV guard and anchors'),
    q('FF-21', 'Class shares HIGH/MODERATE/LOW within 5-70 %', clsShares.reverse(), st(shareOK), 'Review thresholds with the DFO; log'),
    q('FF-22', '|mean stability_high K=' + K + ' - K=' + KHALF + '|', dMC, st(dMC.lt(0.01)), 'Raise MC_K to 1000'),
    q('FF-23', 'Rows in raw table = grid blocks', ee.String(N_ALL.format('%d')).cat(' / ').cat(nGrid.format('%.0f')),
      st(N_ALL.eq(nGrid)), 'Raise TILE_SCALE and re-export'),
    q('FF-24', 'fire_source_gap present', FIRE_GAP_TEXT, st(gapPresent), 'Add metadata field'),
    q('FF-25', 'C8 logic violations; HIGH blocks without degradation evidence (listed for staff)',
      ee.String(c8bad.format('%d')).cat('; ').cat(highNoDE.format('%d')), st(c8bad.eq(0), 'PASS', 'STOP'), 'Fix C8 logic'),
    q('FF-26', 'Spearman rho(RNI, RFI) within +/- 0.60', rhoIdx, st(rhoIdx.abs().lte(CFG.INDEP_MAX)), 'A parameter leaks between indices; review'),
    q('FF-27', 'v2.1 comparison: hectares match; blocks not in v2.1',
      ee.String(ee.Number(transHa).format('%.1f')).cat(' / ').cat(ee.Number(allHa).format('%.1f')).cat('; ').cat(notInV21.format('%d')),
      HAS_V21_TABLE ? st(ee.Number(transHa).subtract(allHa).abs().lt(0.01).and(notInV21.eq(0)), 'PASS', 'CHECK')
                    : 'NOT AVAILABLE (v2.1 final table not found)', 'Re-join on block_id'),
    q('FF-28', 'Version watch (ESA CCI biomass v7.0, Meta CHMv2)', VW, 'INFO', 'Apply Section 5.3 when they reach GEE'),
    q('INFO', 'OAT parameters changing > 15% of classes',
      OAT_FC.filter(ee.Filter.eq('over_influential', 'yes')).aggregate_array('parameter').distinct().join(','), 'INFO', 'Review those weights')
  ]);

  /* ---------- Step 26: exports ---------- */
  var tag = CFG.RANGE_NAME;
  Export.table.toAsset({collection: finalFC, description: 'FRPIM02_final_to_asset', assetId: CFG.FINAL_ASSET});
  function csv(fc, name) {
    Export.table.toDrive({collection: fc, description: 'FRPIM02_' + name, folder: CFG.DRIVE_FOLDER,
                          fileNamePrefix: 'FRPIM02_' + name + '_' + tag, fileFormat: 'CSV'});
  }
  csv(finalFC, 'final_block_table');
  csv(raw, 'raw_block_table');
  csv(OAT_FC, 'sensitivity_OAT');
  csv(COL_FC, 'collinearity');
  csv(DRAW_FC, 'montecarlo_draws');
  csv(QC_FC, 'qc_log');
  csv(TRANS, 'v21_v22_transition_table');
  csv(DECISION, 'decision_summary');

  print('Indices, weights and checks are above. The Monte Carlo runs inside the export tasks.');
  if (CFG.PUBLISH_NOW) {
    publishAll(finalFC, MAPFC);
    print('====================================================================');
    print('FINAL MAP is on screen. To save every result to Google Drive:');
    print('Tasks tab -> RUN ALL (tables, decision summary, Monte Carlo, QC log, maps, SHP, field list).');
    print('====================================================================');
    return;
  }
  print("NEXT: Tasks tab -> RUN ALL. Then set STAGE = 'PUBLISH' for maps and files.");

  });   // end collinearity callback
  });   // end statistics callback

  /* ====================================================================== */
  } else if (CFG.STAGE === 'PUBLISH') {
  /* ====================================================================== */
  publishAll(ee.FeatureCollection(CFG.FINAL_ASSET));
  } else {
    print("STOP: CFG.STAGE must be 'SCORE' or 'PUBLISH'");
  }
}

/* ######################################################################
 *  VALIDATION (Section 15, optional)
 * ###################################################################### */
function stepValidate() {
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
  var retained = fin.filter(ee.Filter.eq('excluded', 0)).filter(ee.Filter.eq('excluded_c8', 0));

  /* ---------- V1 ---------- */
  var v1Sample = retained.filter(ee.Filter.eq('F13', 1)).filter(ee.Filter.eq('DE2', 'no'))
                         .filter(ee.Filter.gte('F14', 0.6));
  var v1Img = chm10.rename('chm_mean').addBands(sepNov(2021, 2025).rename('ndvi_sepnov'));
  var v1 = v1Img.reduceRegions({collection: v1Sample, reducer: ee.Reducer.mean(), scale: 30, crs: CRS,
                                tileScale: CFG.TILE_SCALE});
  function spearman(fc, a, b) {
    fc = fc.filter(ee.Filter.notNull([a, b]));
    return ee.Number(ee.Dictionary(fc.reduceColumns(ee.Reducer.spearmansCorrelation(), [a, b])).values().get(0));
  }
  var v1n = v1.filter(ee.Filter.notNull(['chm_mean'])).size();
  var rhoV1h = spearman(v1, 'RFI', 'chm_mean');
  var rhoV1n = spearman(v1, 'RFI', 'ndvi_sepnov');

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
  var rhoV2 = spearman(v2, 'RFI', 'mean');

  // AUC by the Mann-Whitney rank formula, in ee.Array (ties take sequential ranks)
  var NV2 = v2n;
  var core = ee.Array(v2.aggregate_array('RFI'));
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

  Export.table.toDrive({collection: REPORT, description: 'FRPIM03_validation_report', folder: CFG.DRIVE_FOLDER,
    fileNamePrefix: 'FRPIM03_validation_report_' + CFG.RANGE_NAME, fileFormat: 'CSV'});
  print('Validation report is computed in the export task (Tasks tab -> RUN).');
  print('Interactive preview (may time out on large ranges):', REPORT);

  Map.centerObject(AOI, 11);
  Map.addLayer(ratio.clip(AOI), {min: 0.4, max: 1.2, palette: ['#d73027', '#ffffbf', '#1a9850']},
               'V2 recovery ratio (loss 2016-18)', false);
  Map.addLayer(chm10.clip(AOI), {min: 0, max: 15, palette: ['#ffffcc', '#006837']}, 'Meta canopy height (10 m mean)', false);
}

/* ======================================================================
 *  DISPATCH — RUN 1 (layers + block table) or RUN 2 (final map)
 * ====================================================================== */
var HAS_QC01 = true, HAS_V21 = false, VERSION_WATCH = 'not checked';
function runFrpimStep(n) {
  var names = {
    LAYERS: 'RUN 1 — datasets, scoring scale, 10 ha blocks, all layers. Then Tasks -> RUN ALL.',
    MAP: 'RUN 2 — FINAL RESTORATION MAP for ' + SETTINGS.RANGE_NAME + '. Tasks -> RUN ALL saves all outputs.',
    VALIDATE: 'Validation report (V1, V2). Tasks -> RUN.'
  };
  print('==================================================================');
  print('FRPIM v2.2 | ' + SETTINGS.RANGE_NAME + ' range | ' + names[n]);
  print('==================================================================');
  if (n === 'LAYERS') { stepLayers(); }
  else if (n === 'MAP') { stepMap(); }
  else if (n === 'VALIDATE') { stepValidate(); }
  else { print("STOP: STEP must be 'AUTO', 'LAYERS', 'MAP' or 'VALIDATE'"); }
}
// Section 5.3 version watch (FF-28): newer releases to adopt the day they reach the GEE catalog
var WATCH = [['ESA CCI biomass v7.0', 'ESA/CCI/Above_Ground_Biomass/V7_0']];
var ids = [ASSETS.RAW, ASSETS.QC01, ASSETS.V21].concat(WATCH.map(function (w) { return w[1]; }));
var found = {}, waiting = ids.length;
print('Looking for saved results and checking the dataset version watch ...');
ids.forEach(function (id) {
  var done = function (ok) {
    found[id] = ok;
    waiting -= 1;
    if (waiting > 0) { return; }
    HAS_QC01 = found[ASSETS.QC01];
    HAS_V21 = found[ASSETS.V21];
    VERSION_WATCH = WATCH.map(function (w) { return w[0] + ': ' + (found[w[1]] ? 'NOW IN GEE - switch (Section 5.3)' : 'not yet in GEE'); })
      .concat(['Meta CHMv2: no public GEE asset path published; check the catalog']).join('; ');
    print('FF-28 version watch: ' + VERSION_WATCH);
    if (STEP !== 'AUTO') { runFrpimStep(STEP); return; }
    if (found[ASSETS.RAW] && !HAS_QC01) {
      print('Note: the QC01 table is missing; the map is not affected, the QC log marks those checks NOT RECORDED.');
    }
    if (found[ASSETS.RAW]) {
      print(HAS_V21 ? 'v2.1 results found: the change-from-v2.1 layer and transition table will be produced.'
                    : 'v2.1 final table not found: the comparison (FF-27) will be marked NOT AVAILABLE.');
    }
    runFrpimStep(found[ASSETS.RAW] ? 'MAP' : 'LAYERS');
  };
  try { ee.data.getAsset(id, function (a, err) { done(!!a && !err); }); } catch (e) { done(false); }
});
