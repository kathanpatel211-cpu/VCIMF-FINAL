// Extracted verbatim from BGDSS_CAMPA_Module2_v5.js Sections 15-19 and 20.
// Verifies the client-side MCDA math against cases with known answers.

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
function scoreWLC(b, w) { var s = 0; for (var i = 0; i < w.length; i++) { s += w[i] * b.v[i]; } return s; }
function scoreWGM(b, w) {
  var s = 0;
  for (var i = 0; i < w.length; i++) { s += w[i] * Math.log(Math.max(b.v[i], 0.01)); }
  return Math.exp(s);
}
function scoreTOPSIS(bs, w) {
  var mm = w.length, nn = bs.length, norms = [];
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
      dPlus += (v3 - best[i3]) * (v3 - best[i3]);
      dMinus += (v3 - worst[i3]) * (v3 - worst[i3]);
    }
    dPlus = Math.sqrt(dPlus); dMinus = Math.sqrt(dMinus);
    return (dPlus + dMinus) === 0 ? 0 : dMinus / (dPlus + dMinus);
  });
}
function rankOf(arr) {
  var idx = arr.map(function (v, i) { return { v: v, i: i }; });
  idx.sort(function (x, y) { return y.v - x.v; });
  var rk = new Array(arr.length);
  idx.forEach(function (o, r) { rk[o.i] = r + 1; });
  return rk;
}
function greedySelectByArea(sorted, cap) {
  var cum = 0, sel = {};
  for (var i = 0; i < sorted.length; i++) {
    if (cum + sorted[i].eligibleAreaHa > cap) { continue; }
    cum += sorted[i].eligibleAreaHa;
    sel[sorted[i].id] = true;
  }
  return sel;
}
function auc(pos, neg) {
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
  return (rankSumPos - (nP * (nP + 1)) / 2) / (nP * nN);
}

var fails = 0;
function ok(name, cond, detail) {
  if (cond) { console.log('  PASS  ' + name); }
  else { console.log('  FAIL  ' + name + (detail ? '  -> ' + detail : '')); fails++; }
}
function close(a, b, tol) { return Math.abs(a - b) <= (tol || 1e-9); }

console.log('\n== pearson ==');
ok('perfect positive', close(pearson([1,2,3,4],[2,4,6,8]), 1, 1e-12));
ok('perfect negative', close(pearson([1,2,3,4],[8,6,4,2]), -1, 1e-12));
ok('constant input -> 0 (no NaN)', pearson([1,1,1,1],[1,2,3,4]) === 0);

console.log('\n== WLC vs WGM: non-compensation is the whole point ==');
// Block A: uniformly mediocre. Block B: excellent everywhere but one fatal zero.
var w4 = [0.25,0.25,0.25,0.25];
var A = { v: [0.55,0.55,0.55,0.55] };
var B = { v: [0.95,0.95,0.95,0.01] };
var wlcA = scoreWLC(A,w4), wlcB = scoreWLC(B,w4);
var wgmA = scoreWGM(A,w4), wgmB = scoreWGM(B,w4);
console.log('   WLC  A=' + wlcA.toFixed(4) + '  B=' + wlcB.toFixed(4));
console.log('   WGM  A=' + wgmA.toFixed(4) + '  B=' + wgmB.toFixed(4));
ok('WLC lets B compensate its fatal flaw and win', wlcB > wlcA);
ok('WGM correctly penalises B for the fatal flaw', wgmA > wgmB,
   'this is the disagreement that makes the ROBUST set meaningful');
ok('WGM of a uniform vector == that value', close(scoreWGM({v:[0.5,0.5,0.5,0.5]}, w4), 0.5, 1e-12));

console.log('\n== TOPSIS ==');
var bs = [ {v:[1.0,1.0]}, {v:[0.0,0.0]}, {v:[0.5,0.5]} ];
var t = scoreTOPSIS(bs, [0.5,0.5]);
console.log('   scores: ' + t.map(function(x){return x.toFixed(4);}).join(', '));
ok('ideal block scores 1', close(t[0], 1, 1e-9));
ok('anti-ideal block scores 0', close(t[1], 0, 1e-9));
ok('midpoint block is between', t[2] > 0 && t[2] < 1);
ok('all scores within [0,1]', t.every(function(x){ return x >= 0 && x <= 1; }));

console.log('\n== rankOf ==');
var rk = rankOf([0.1, 0.9, 0.5]);
ok('highest value gets rank 1', rk[1] === 1);
ok('lowest value gets rank 3', rk[0] === 3);
ok('middle gets rank 2', rk[2] === 2);

console.log('\n== greedy area selection (the v4 area-over-credit fix depends on this) ==');
var sorted = [
  { id: 1, eligibleAreaHa: 9 },
  { id: 2, eligibleAreaHa: 9 },
  { id: 3, eligibleAreaHa: 5 },
  { id: 4, eligibleAreaHa: 9 }
];
var sel = greedySelectByArea(sorted, 20);
var selHa = sorted.filter(function(b){return sel[b.id];}).reduce(function(s,b){return s+b.eligibleAreaHa;},0);
console.log('   cap 20: selected ids ' + Object.keys(sel).join(',') + ' = ' + selHa + ' ha');
ok('never exceeds the cap', selHa <= 20, 'got ' + selHa);
ok('takes the two top blocks (9+9=18; the 5 ha would overflow to 23)',
   sel[1] && sel[2] && !sel[3] && !sel[4]);

// Backfill: it must CONTINUE past an oversized block, not break, so a smaller
// lower-ranked block can still use the remaining capacity.
var sel2 = greedySelectByArea(sorted, 23);
var selHa2 = sorted.filter(function(b){return sel2[b.id];}).reduce(function(s,b){return s+b.eligibleAreaHa;},0);
console.log('   cap 23: selected ids ' + Object.keys(sel2).join(',') + ' = ' + selHa2 + ' ha');
ok('backfills a smaller block after skipping an oversized one',
   sel2[1] && sel2[2] && sel2[3] && !sel2[4], 'expected 1,2,3 = 23 ha exactly');
ok('backfill still respects the cap', selHa2 <= 23, 'got ' + selHa2);

console.log('\n== AUC (Mann-Whitney) ==');
ok('perfect separation -> 1.0', close(auc([5,6,7],[1,2,3]), 1, 1e-12));
ok('reversed separation -> 0.0', close(auc([1,2,3],[5,6,7]), 0, 1e-12));
ok('identical distributions -> 0.5 (ties handled)', close(auc([1,2,3],[1,2,3]), 0.5, 1e-12));
ok('all-tied -> 0.5', close(auc([2,2,2],[2,2,2]), 0.5, 1e-12));
var randP = [], randN = [];
for (var q = 0; q < 500; q++) { randP.push(Math.random()); randN.push(Math.random()); }
var ra = auc(randP, randN);
ok('random data ~0.5', Math.abs(ra - 0.5) < 0.08, 'got ' + ra.toFixed(3));

console.log('\n== Monte Carlo weight perturbation ==');
var mcBlocks = [];
for (var z = 0; z < 40; z++) {
  mcBlocks.push({ id: z, eligibleAreaHa: 9,
    v: [Math.random(), Math.random(), Math.random(), Math.random()] });
}
// one deliberately dominant block
mcBlocks.push({ id: 999, eligibleAreaHa: 9, v: [0.99,0.99,0.99,0.99] });
mcBlocks.forEach(function(b){ b.mcHits = 0; });
var RUNS = 1000, PERT = 0.20;
for (var run = 0; run < RUNS; run++) {
  var wP = [], wT = 0;
  for (var i4 = 0; i4 < 4; i4++) {
    var wv = Math.max(0.25 * (1 + (Math.random()*2-1)*PERT), 1e-6);
    wP.push(wv); wT += wv;
  }
  for (var i5 = 0; i5 < 4; i5++) { wP[i5] /= wT; }
  var scored = mcBlocks.map(function(b){ return { id:b.id, s:scoreWLC(b,wP), eligibleAreaHa:b.eligibleAreaHa }; });
  scored.sort(function(x,y){ return y.s - x.s; });
  var s2 = greedySelectByArea(scored, 90);
  mcBlocks.forEach(function(b){ if (s2[b.id]) { b.mcHits++; } });
}
var dom = mcBlocks.filter(function(b){ return b.id === 999; })[0];
ok('dominant block selected in ~100% of runs', dom.mcHits / RUNS > 0.99,
   'got ' + (dom.mcHits/RUNS).toFixed(3));
var freqs = mcBlocks.map(function(b){ return b.mcHits/RUNS; });
ok('frequencies all within [0,1]', freqs.every(function(f){ return f >= 0 && f <= 1; }));
var marginal = freqs.filter(function(f){ return f > 0.05 && f < 0.95; }).length;
ok('some blocks are genuinely weight-sensitive', marginal > 0,
   'got ' + marginal + ' marginal blocks -- these are the ones needing review');

console.log('\n== carbon accounting ==');
var K = { agbGrowthNewPlantation:3.0, agbGrowthAnr:2.4, soilCAccrualTPerHaYr:0.25,
          rootShootRatio:0.28, carbonFraction:0.5, co2Conversion:3.6663,
          horizonYears:10, referenceAgbTPerHa:120 };
function tco2e(treatmentCode, agbCurrent) {
  var growth = treatmentCode === 1 ? K.agbGrowthNewPlantation : K.agbGrowthAnr;
  var agbGain = growth * K.horizonYears;
  if (agbCurrent != null) { agbGain = Math.min(agbGain, Math.max(K.referenceAgbTPerHa - agbCurrent, 0)); }
  var cStock = agbGain * (1 + K.rootShootRatio) * K.carbonFraction;
  return (cStock + K.soilCAccrualTPerHaYr * K.horizonYears) * K.co2Conversion;
}
var npVal = tco2e(1, 10), anrVal = tco2e(2, 10);
console.log('   New Plantation: ' + npVal.toFixed(1) + ' tCO2e/ha over 10 yr');
console.log('   ANR           : ' + anrVal.toFixed(1) + ' tCO2e/ha over 10 yr');
ok('new plantation sequesters more than ANR', npVal > anrVal);
ok('per-ha values are in a plausible dry-deciduous range (30-120)',
   npVal > 30 && npVal < 120, 'got ' + npVal.toFixed(1));
ok('near-saturated site yields little additional gain',
   tco2e(1, 118) < tco2e(1, 10) * 0.2, 'cap by reference AGB works');
ok('gain is capped, never negative', tco2e(1, 200) > 0 && tco2e(1,200) < 15,
   'soil carbon only, got ' + tco2e(1,200).toFixed(1));

console.log('\n== eligible-fraction filter (the v4 bug fix) ==');
var raw = [
  { id:1, eligibleAreaHa:0.45, totalAreaHa:9 },   // 5% eligible -- v4 credited all 9 ha
  { id:2, eligibleAreaHa:7.2,  totalAreaHa:9 }    // 80% eligible
];
raw.forEach(function(b){ b.eligibleFraction = b.eligibleAreaHa / b.totalAreaHa; });
var kept = raw.filter(function(b){ return b.eligibleFraction >= 0.30; });
ok('5%-eligible block is rejected', kept.length === 1 && kept[0].id === 2);
ok('area counted is treatable ha, not block ha', kept[0].eligibleAreaHa === 7.2);

console.log('\n' + (fails === 0 ? 'ALL TESTS PASSED' : fails + ' TEST(S) FAILED'));
process.exit(fails === 0 ? 0 : 1);
