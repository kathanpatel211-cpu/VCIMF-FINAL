/* ======================================================================
 *  FRPIM v2.2 — LAYER MAPS (pixel level, the range only)
 *  Shows every input layer of the model one at a time, with its own
 *  legend, and creates one GeoTIFF export task per layer. The layers are
 *  computed with the same library code as the model (LIB.layers +
 *  LIB.layersV22), so they are exactly what the model used.
 *  Everything runs in the background: the page never freezes.
 * ====================================================================== */

var AOI_FC = ee.FeatureCollection(SETTINGS.AOI_ASSET);
var AOI = AOI_FC.geometry().dissolve({maxError: 1});
var CRS = SETTINGS.CRS;
var LOPT = {csThr: SETTINGS.CS_THRESHOLD, d2Months: SETTINGS.D2_MONTHS, a3MaskTrees: false};
var R = LIB.layersV22(LIB.layers(AOI, CRS, LOPT), AOI, CRS, LOPT);

/* ---------- extra display layers not stored in R ---------- */
var CSP = ee.ImageCollection(LIB.A.CSP);
var trueColour = ee.ImageCollection(LIB.A.S2).filterBounds(AOI).filterDate('2025-10-15', '2025-12-01')
  .linkCollection(CSP, ['cs_cdf'])
  .map(function (img) {
    return img.select(['B4', 'B3', 'B2']).multiply(0.0001).updateMask(img.select('cs_cdf').gte(SETTINGS.CS_THRESHOLD));
  }).median();

var ndmiPeak = ee.ImageCollection([]);
for (var yy = 2021; yy <= 2025; yy++) {
  ndmiPeak = ndmiPeak.merge(LIB.s2(AOI, yy + '-10-15', yy + '-12-01', SETTINGS.CS_THRESHOLD).select('NDMI'));
}
ndmiPeak = ndmiPeak.median();

var hansen = ee.Image(LIB.A.HANSEN);
var lossYear = hansen.select('lossyear').selfMask().add(2000);

// Soil depth proxy (as F5: slope 0.40, TPI 0.30, HAND 0.30, all inverted), scaled within the range.
var PCT = ee.Image.cat([R.slopeDeg, R.tpi, R.hand]).reduceRegion({
  reducer: ee.Reducer.percentile([2, 98]), geometry: AOI, scale: 30, crs: CRS,
  bestEffort: true, maxPixels: 1e9, tileScale: 4
});
function inv01(img, band) {
  var lo = ee.Number(PCT.get(band + '_p2')), hi = ee.Number(PCT.get(band + '_p98'));
  return ee.Image(1).subtract(img.subtract(lo).divide(hi.subtract(lo).max(1e-9)).clamp(0, 1));
}
var soilDepth = inv01(R.slopeDeg, 'slopeDeg').multiply(0.40)
  .add(inv01(R.tpi, 'tpi').multiply(0.30))
  .add(inv01(R.hand, 'hand').multiply(0.30));

// Constraints: first that applies (1 C1 ... 7 C7)
var constraints = ee.Image(0)
  .where(R.C7, 7).where(R.C6, 6).where(R.C5, 5).where(R.C4, 4).where(R.C3, 3).where(R.C2, 2)
  .where(R.canopy30.gte(0.40).unmask(0), 1).selfMask();

var IMG = {
  truecolour: trueColour,
  canopy: R.canopy30.multiply(100),
  chm: R.chm,
  ndvi_peak: R.peakNDVI,
  ndvi_dry: R.ndviDry,
  agb: R.agb,
  landcover: R.wc.remap([10, 20, 30, 40, 50, 60, 80, 90], [1, 2, 3, 4, 5, 6, 7, 8], 0).selfMask(),
  shrub: R.D5mask.selfMask(),
  bsi: R.BSI,
  rusle: R.E4_A,
  restrend: R.D2trend,
  ndvichange: R.ndviRecentL.subtract(R.ndviBase),
  tc2000: R.treecover2000,
  lossyear: lossYear,
  fire: R.fire.reduce(ee.Reducer.sum()),
  cti: R.A1,
  ndmi: ndmiPeak,
  moist: R.A3,
  awc: R.AWC.multiply(100),
  wb: R.A2,
  rain: R.Pann,
  water: R.A5_dist,
  gsw: ee.Image(LIB.A.GSW).select('occurrence').selfMask(),
  elev: R.dem,
  slope: R.slopePct,
  hli: R.hli,
  curv: R.curv,
  tpi: R.tpi,
  hand: R.hand,
  soildepth: soilDepth,
  rough: R.rough,
  clay: R.clay, sand: R.sand, cfvo: R.cfvo, ph: R.ph, soc: R.soc,
  builtdist: R.E2_dist,
  pop: R.E2_pop,
  road: R.access,
  dense: R.D6_dist,
  pa: R.pa.selfMask(),
  constraints: constraints
};

// Every catalogue entry must have an image (and nothing else): stops a silent mismatch.
CATALOGUE.forEach(function (L) {
  if (!IMG[L.key]) { throw new Error('No image for catalogue layer ' + L.id + ' ' + L.key); }
});

function layerImage(L) {
  var img = ee.Image(IMG[L.key]);
  return (L.type === 'rgb' ? img : img.select([0]).rename(L.key)).clip(AOI);
}

function visFor(L, lo, hi) {
  if (L.type === 'rgb') { return {min: L.min, max: L.max, bands: ['B4', 'B3', 'B2'], gamma: 1.2}; }
  return {min: lo, max: hi, palette: L.palette};
}

var OUTLINE = ee.Image().byte().paint(AOI_FC, 1, 2);
var OUTLINE_VIS = OUTLINE.visualize({palette: ['111111']});

/* ---------- export tasks: one GeoTIFF per layer + the range boundary ---------- */
function prefix(L) { return 'FRPIM_v22_' + SETTINGS.RANGE_NAME + '_' + L.id + '_' + L.key; }
if (SETTINGS.MAKE_EXPORT_TASKS) {
  CATALOGUE.forEach(function (L) {
    var img = layerImage(L);
    img = (L.type === 'rgb') ? img.visualize(visFor(L)) : (L.type === 'cat' ? img.toByte() : img.toFloat());
    Export.image.toDrive({
      image: img, description: 'L_' + L.id + '_' + L.key, folder: SETTINGS.DRIVE_FOLDER,
      fileNamePrefix: prefix(L), region: AOI.bounds(1), scale: L.scale, crs: CRS,
      maxPixels: 1e10, fileFormat: 'GeoTIFF',
      formatOptions: L.type === 'cont' ? {cloudOptimized: true, noData: -9999} : {cloudOptimized: true}
    });
  });
  Export.table.toDrive({
    collection: AOI_FC.map(function (f) { return f.select([]); }),
    description: 'L_00_range_boundary', folder: SETTINGS.DRIVE_FOLDER,
    fileNamePrefix: 'FRPIM_v22_' + SETTINGS.RANGE_NAME + '_range_boundary', fileFormat: 'GeoJSON'
  });
}

/* ---------- user interface: layer chooser + legend panel ---------- */
var panel = ui.Panel({style: {width: '380px', padding: '8px'}});
panel.add(ui.Label('FRPIM v2.2 — Layer Maps', {fontSize: '20px', fontWeight: 'bold', margin: '4px 8px 0 8px'}));
panel.add(ui.Label(SETTINGS.RANGE_NAME + ' Range · every input layer of the model',
                   {fontSize: '12px', color: '#55625a', margin: '0 8px 8px 8px'}));
var items = CATALOGUE.map(function (L) { return {label: L.id + '  ' + L.title, value: L.id}; });
var select = ui.Select({items: items, placeholder: 'Choose a layer ...', style: {stretch: 'horizontal'}});
panel.add(select);
var nav = ui.Panel({layout: ui.Panel.Layout.flow('horizontal')});
panel.add(nav);
var legend = ui.Panel();
panel.add(legend);
panel.add(ui.Label('Exports: open the Tasks tab and press RUN on each L_ task (folder ' + SETTINGS.DRIVE_FOLDER +
                   '). Each GeoTIFF is the real value of the layer (not a picture), clipped to the range, UTM 43N.',
                   {fontSize: '11px', color: '#55625a', margin: '10px 8px'}));
ui.root.insert(0, panel);

Map.setOptions('SATELLITE');
Map.centerObject(AOI, 11);
Map.style().set('cursor', 'crosshair');

var BY_ID = {};
CATALOGUE.forEach(function (L, i) { BY_ID[L.id] = i; });
var SEQ = 0;
var CURRENT = 0;

function fmt(v, L) {
  if (v === null || v === undefined || isNaN(v)) { return '-'; }
  var a = Math.abs(v);
  var d = (L.unit === 'year') ? 0 : (a >= 100 ? 0 : (a >= 10 ? 1 : (a >= 1 ? 2 : (a >= 0.01 ? 3 : 4))));
  return v.toFixed(d);
}

function colourBar(palette) {
  return ui.Thumbnail({
    image: ee.Image.pixelLonLat().select(0),
    params: {bbox: [0, 0, 1, 0.1], dimensions: '300x14', format: 'png', min: 0, max: 1, palette: palette},
    style: {stretch: 'horizontal', margin: '4px 8px', maxHeight: '22px'}
  });
}

function row(colour, text) {
  return ui.Panel([
    ui.Label('', {backgroundColor: '#' + colour, padding: '8px', margin: '2px 8px', border: '1px solid #888'}),
    ui.Label(text, {margin: '4px 0', fontSize: '12px'})
  ], ui.Panel.Layout.flow('horizontal'));
}

function buildLegend(L, lo, hi, stretched, token) {
  legend.clear();
  legend.add(ui.Label(L.id + '  ' + L.title, {fontSize: '16px', fontWeight: 'bold', margin: '10px 8px 0 8px'}));
  legend.add(ui.Label(L.sub, {fontSize: '12px', color: '#55625a', margin: '2px 8px 6px 8px'}));
  if (L.type === 'cont') {
    legend.add(colourBar(L.palette));
    legend.add(ui.Panel([
      ui.Label(fmt(lo, L), {margin: '0 8px', fontSize: '12px'}),
      ui.Label('Unit: ' + L.unit + (stretched ? ' (2-98 % stretch)' : ''),
               {margin: '0 8px', fontSize: '11px', color: '#55625a', textAlign: 'center', stretch: 'horizontal'}),
      ui.Label(fmt(hi, L), {margin: '0 8px', fontSize: '12px', textAlign: 'right'})
    ], ui.Panel.Layout.flow('horizontal'), {stretch: 'horizontal'}));
  } else if (L.type === 'cat') {
    L.classes.forEach(function (c) { legend.add(row(c[2], c[1])); });
  } else {
    legend.add(ui.Label('Natural colour (red, green, blue bands)', {fontSize: '12px', margin: '2px 8px'}));
  }
  legend.add(ui.Label(L.about, {fontSize: '12px', margin: '8px 8px 4px 8px', whiteSpace: 'pre-wrap'}));
  legend.add(ui.Label('Data: ' + L.data, {fontSize: '11px', color: '#55625a', margin: '2px 8px'}));
  legend.add(ui.Label('Used in the model: ' + L.used, {fontSize: '11px', color: '#55625a', margin: '2px 8px'}));
  legend.add(ui.Label('Export scale: ' + L.scale + ' m', {fontSize: '11px', color: '#55625a', margin: '2px 8px'}));
  var link = ui.Label('Preparing PNG download link ...', {fontSize: '12px', margin: '8px 8px'});
  legend.add(link);
  var img = layerImage(L);
  var png = img.visualize(visFor(L, lo, hi)).blend(OUTLINE_VIS);
  png.getThumbURL({region: AOI.bounds(1), dimensions: SETTINGS.PNG_PIXELS, format: 'png', crs: CRS},
    function (url, err) {
      if (token !== SEQ) { return; }
      if (err || !url) { link.setValue('PNG link not available (' + (err || 'no url') + '). Use the GeoTIFF export.'); return; }
      link.setValue('Download this map as PNG (' + SETTINGS.PNG_PIXELS + ' px, no legend)');
      link.setUrl(url);
      link.style().set({color: '#1a73e8', textDecoration: 'underline'});
    });
}

function show(id) {
  if (BY_ID[id] === undefined) { return; }
  var L = CATALOGUE[BY_ID[id]];
  CURRENT = BY_ID[id];
  SEQ += 1;
  var token = SEQ;
  legend.clear();
  legend.add(ui.Label('Loading ' + L.title + ' ... (slow layers can take up to a minute)',
                      {margin: '10px 8px', color: '#55625a'}));
  var img = layerImage(L);
  function draw(lo, hi, stretched) {
    if (token !== SEQ) { return; }               // the user already chose another layer
    Map.layers().reset();
    Map.addLayer(img, visFor(L, lo, hi), L.id + ' ' + L.title);
    Map.addLayer(OUTLINE, {palette: ['111111']}, 'Range boundary');
    buildLegend(L, lo, hi, stretched, token);
  }
  if (L.type !== 'cont' || (L.min !== null && L.max !== null)) {
    draw(L.min, L.max, false);
    return;
  }
  var stats = img.reduceRegion({
    reducer: ee.Reducer.percentile([2, 98]), geometry: AOI, scale: Math.max(L.scale, 30), crs: CRS,
    bestEffort: true, maxPixels: 1e9, tileScale: 4
  });
  LIB.evalRetry(stats, function (d, err) {
    var lo = d ? d[L.key + '_p2'] : null, hi = d ? d[L.key + '_p98'] : null;
    if (err || lo === null || hi === null || lo === undefined || hi === undefined || lo === hi) {
      print('Stretch for ' + L.id + ' could not be computed (' + (err || 'no data') + '); using 0-1.');
      lo = 0; hi = 1;
    }
    draw(lo, hi, true);
  });
}

nav.add(ui.Button('◀ Previous', function () { select.setValue(CATALOGUE[(CURRENT + CATALOGUE.length - 1) % CATALOGUE.length].id); }));
nav.add(ui.Button('Next ▶', function () { select.setValue(CATALOGUE[(CURRENT + 1) % CATALOGUE.length].id); }));
select.onChange(show);
select.setValue(SETTINGS.FIRST_LAYER);
print('FRPIM v2.2 Layer Maps: ' + CATALOGUE.length + ' layers. Choose a layer in the left panel. ' +
      (SETTINGS.MAKE_EXPORT_TASKS ? CATALOGUE.length + 1 + ' export tasks are in the Tasks tab.' : 'Export tasks are switched off.'));
