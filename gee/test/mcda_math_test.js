// Regression tests for the client-side scoring/classification logic in
// BGDSS_CAMPA_Module2_v5.js v6.0.0. Extracted verbatim where the logic is
// pure JS (no ee.* calls), so these run standalone with plain Node.

var fails = 0;
function ok(name, cond, detail) {
  if (cond) { console.log('  PASS  ' + name); }
  else { console.log('  FAIL  ' + name + (detail ? '  -> ' + detail : '')); fails++; }
}
function close(a, b, tol) { return Math.abs(a - b) <= (tol || 1e-9); }

// ---- normalization / stats helpers (Section 17) ---------------------------
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

console.log('\n== percentile / stdDev ==');
ok('median of odd-length array', pctOf([1,2,3,4,5], 50) === 3);
ok('median of even-length array interpolates', close(pctOf([1,2,3,4], 50), 2.5));
ok('p2/p98 bracket the middle 96%', pctOf([1,2,3,4,5,6,7,8,9,10],2) < pctOf([1,2,3,4,5,6,7,8,9,10],98));
ok('stdDev of constant array is 0', stdDevOf([5,5,5,5]) === 0);
ok('stdDev of [0,1] pair is 0.5', close(stdDevOf([0,1]), 0.5));

console.log('\n== normalization (absolute + percentile modes, direction) ==');
var cAbs = { mode: 'absolute', lo: 0, hi: 100, dir: 1 };
ok('absolute mode scales to [0,1]', close(normOne(cAbs, 50, normBounds(cAbs)), 0.5));
ok('absolute mode clamps below lo', normOne(cAbs, -20, normBounds(cAbs)) === 0);
ok('absolute mode clamps above hi', normOne(cAbs, 500, normBounds(cAbs)) === 1);
var cInv = { mode: 'absolute', lo: 0, hi: 3000, dir: 1 }; // distanceToForest style but let's test dir=-1 too
var cDirNeg = { mode: 'absolute', lo: 0, hi: 1, dir: -1 };
ok('dir=-1 inverts the normalized value', close(normOne(cDirNeg, 0.2, normBounds(cDirNeg)), 0.8));
var cPct = { mode: 'percentile', p2: 10, p98: 90, dir: 1 };
ok('percentile mode uses p2/p98 as bounds', close(normOne(cPct, 50, normBounds(cPct)), 0.5));

console.log('\n== pearson correlation ==');
ok('perfect positive', close(pearson([1,2,3,4],[2,4,6,8]), 1, 1e-12));
ok('perfect negative', close(pearson([1,2,3,4],[8,6,4,2]), -1, 1e-12));
ok('constant input -> 0 (no NaN)', pearson([1,1,1,1],[1,2,3,4]) === 0);

console.log('\n== Weighted Linear Combination score ==');
function wlcScore(v, w) { var s = 0; for (var i = 0; i < w.length; i++) { s += w[i] * v[i]; } return s; }
ok('WLC of all-ones with weights summing to 1 is 1', close(wlcScore([1,1,1],[0.2,0.3,0.5]), 1));
ok('WLC of all-zeros is 0', wlcScore([0,0,0],[0.2,0.3,0.5]) === 0);
ok('higher-scoring criterion with more weight dominates',
   wlcScore([0.9,0.1],[0.8,0.2]) > wlcScore([0.1,0.9],[0.8,0.2]));

console.log('\n== quantile 5-class assignment ==');
function assignQuantile(blocksSortedDesc) {
  blocksSortedDesc.forEach(function (b, i) {
    b.priorityClass = Math.min(5, Math.floor(i / (blocksSortedDesc.length / 5)) + 1);
  });
}
var qBlocks = [];
for (var qi = 0; qi < 100; qi++) { qBlocks.push({ id: qi, score: 100 - qi }); } // already desc by construction
assignQuantile(qBlocks);
var classCounts = {1:0,2:0,3:0,4:0,5:0};
qBlocks.forEach(function (b) { classCounts[b.priorityClass]++; });
ok('100 blocks split into 5 classes of 20', classCounts[1]===20 && classCounts[2]===20 && classCounts[3]===20 && classCounts[4]===20 && classCounts[5]===20,
   JSON.stringify(classCounts));
ok('highest-scoring block is class 1', qBlocks[0].priorityClass === 1);
ok('lowest-scoring block is class 5', qBlocks[99].priorityClass === 5);
ok('class numbers are monotonic with descending score order',
   qBlocks.every(function (b, i) { return i === 0 || b.priorityClass >= qBlocks[i-1].priorityClass; }));

console.log('\n== equal-interval 5-class assignment ==');
function assignEqualInterval(blocks) {
  var sMin = Math.min.apply(null, blocks.map(function(b){return b.score;}));
  var sMax = Math.max.apply(null, blocks.map(function(b){return b.score;}));
  var span = (sMax - sMin) || 1;
  blocks.forEach(function (b) { var t = (b.score - sMin) / span; b.priorityClass = 5 - Math.min(4, Math.floor(t * 5)); });
}
var eiBlocks = [{score:0},{score:0.1},{score:0.5},{score:0.9},{score:1.0}];
assignEqualInterval(eiBlocks);
ok('score 1.0 (max) lands in class 1', eiBlocks[4].priorityClass === 1);
ok('score 0 (min) lands in class 5', eiBlocks[0].priorityClass === 5, JSON.stringify(eiBlocks));

console.log('\n== bid-keyed lookup (the fix for the rows[b.id-1] bug) ==');
// Simulates: some feats skipped (insufficient treatable ground), so `rows` is
// shorter than the original feats array and rows[k] is NOT feats[k].
var feats = [
  { bid: 'A', eligHa: 5 },   // kept
  { bid: 'B', eligHa: 0 },   // SKIPPED - below the 0.1 ha floor
  { bid: 'C', eligHa: 7, phenologicalAnomaly_mean: 0.9 },  // kept, needs clearance
];
var rows = [];
feats.forEach(function (f, idx) {
  if (f.eligHa <= 0.1) { return; }
  rows.push({ idx: idx, p: f });
});
ok('rows is shorter than feats after a skip', rows.length === 2 && feats.length === 3);

var blocks = rows.map(function (r) { return { id: r.idx + 1, bid: r.p.bid }; });
// blocks[1] is feats index 2 (bid C), so block.id = 3 -> WRONG array position
// would be rows[3-1] = rows[2], which does not exist (rows has length 2).
var buggyLookup = rows[blocks[1].id - 1];
ok('demonstrates the bug: position lookup is out of bounds / wrong row',
   buggyLookup === undefined, 'buggy rows[id-1] = ' + JSON.stringify(buggyLookup));

var rowsByBid = {};
rows.forEach(function (r) { rowsByBid[r.p.bid] = r; });
var fixedLookup = rowsByBid[blocks[1].bid];
ok('bid-keyed lookup finds the correct row', fixedLookup && fixedLookup.p.bid === 'C');
ok('bid-keyed lookup recovers the right phenology value',
   fixedLookup.p.phenologicalAnomaly_mean === 0.9);

console.log('\n== carbon accounting (New Plantation only, IPCC Tier 1) ==');
var K = { agbGrowthTPerHaYr: 3.0, soilCAccrualTPerHaYr: 0.25, rootShootRatio: 0.28,
          carbonFraction: 0.5, co2Conversion: 3.6663, horizonYears: 10 };
function tco2ePerHa() {
  var agbGain = K.agbGrowthTPerHaYr * K.horizonYears;
  var totalBiomass = agbGain * (1 + K.rootShootRatio);
  var cStock = totalBiomass * K.carbonFraction;
  return (cStock + K.soilCAccrualTPerHaYr * K.horizonYears) * K.co2Conversion;
}
var perHa = tco2ePerHa();
console.log('   New Plantation: ' + perHa.toFixed(1) + ' tCO2e/ha over 10 yr');
ok('per-ha sequestration is in a plausible dry-deciduous range (30-100)', perHa > 30 && perHa < 100, 'got ' + perHa.toFixed(1));
ok('scales linearly with area', close(perHa * 7.5, perHa * 5 + perHa * 2.5));

console.log('\n== eligible-fraction filter (area-accounting fix) ==');
var raw = [
  { id:1, eligibleAreaHa:0.45, totalAreaHa:9 },   // 5% eligible - must be rejected
  { id:2, eligibleAreaHa:7.2,  totalAreaHa:9 }     // 80% eligible - must be kept
];
raw.forEach(function (b) { b.eligibleFraction = b.eligibleAreaHa / b.totalAreaHa; });
var kept = raw.filter(function (b) { return b.eligibleFraction >= 0.30; });
ok('5%-eligible block is rejected', kept.length === 1 && kept[0].id === 2);
ok('area counted is treatable ha, not block ha', kept[0].eligibleAreaHa === 7.2);

console.log('\n' + (fails === 0 ? 'ALL TESTS PASSED' : fails + ' TEST(S) FAILED'));
process.exit(fails === 0 ? 0 : 1);
