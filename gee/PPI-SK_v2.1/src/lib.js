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
