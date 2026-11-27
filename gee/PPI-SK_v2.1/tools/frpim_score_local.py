"""
FRPIM v2.2 RUN 2 scoring, ported line by line from src/02_frpim.js, for running off Earth Engine.

Input : a GeoJSON of prepared (merged, gap-filled) blocks, as exported from FRPIM_v22_prepared_blocks_*
        (or any FRPIM02 block GeoJSON: its RUN 1 fields are the inputs; earlier outputs are overwritten).
Output: the same block GeoJSON with every RUN 2 field (RNI, RFI, M/S/T/R, classes, phase, map codes,
        intervention, SMC, species, Monte Carlo reliability, field-check list), plus a JSON log with
        weights, CV guard, collinearity, class breaks and the Range x Phase table.

Same constants, same rule order, same nearest-rank quintiles and the same mulberry32 random stream
(seed 2026), so results match RUN 2 in Earth Engine. Validate with --compare on a block file that
Earth Engine has already scored.

Usage : python frpim_score_local.py IN.geojson OUT.geojson [--compare GEE_SCORED.geojson]
"""
import json
import math
import sys
from collections import Counter, defaultdict

import numpy as np

CFG = dict(
    W_N={'N1': 25, 'N2': 15, 'N3': 15, 'N4': 15, 'N5': 10, 'N6': 10, 'N7': 5, 'N8': 5},
    W_F={'F1': 15, 'F2': 10, 'F3': 5, 'F4': 5, 'F5': 12, 'F6': 7, 'F7': 6, 'F8': 6, 'F9': 4,
         'F10': 8, 'F11': 7, 'F12': 3, 'F13': 7, 'F14': 5},
    PHASE=[[5, 5, 5, 5, 4], [5, 4, 4, 4, 3], [4, 3, 3, 3, 2], [3, 2, 2, 2, 1], [2, 2, 1, 1, 1]],
    RX=dict(FIRE_F13=0.55, STAB_S=0.45, INVASIVE_N7=0.30, SMC_M=0.35, SMC_RESP_M=0.50),
    SITE_SPLITS=[0.33, 0.66], MC_K=500, MC_SEED=2026, MC_CONC=125,
    CV_MIN=0.05, RHO_MAX=0.75, VIF_MAX=5, X1_RHO_MAX=0.60)
N_KEYS = ['N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7', 'N8']
F_KEYS = ['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12', 'F13', 'F14']
GROUPS = {'M': ['F1', 'F2', 'F3', 'F4'], 'S': ['F5', 'F6', 'F7', 'F8', 'F9'], 'T': ['F10', 'F11', 'F12'], 'R': ['F13', 'F14']}
G_KEYS = ['M', 'S', 'T', 'R']
GROUP_OF = {k: g for g in G_KEYS for k in GROUPS[g]}
GP = {g: sum(CFG['W_F'][k] for k in GROUPS[g]) for g in G_KEYS}
PARAMS = N_KEYS + F_KEYS
PHASE_ORDER = ['PHASE_1', 'PHASE_2', 'PHASE_3', 'PHASE_4', 'PHASE_5', 'PROTECTED', 'EXCLUDED']
PHASE_TEXT = {
    'PHASE_1': 'Highest priority; first plantation season', 'PHASE_2': 'Next season; most blocks need SMC alongside planting',
    'PHASE_3': 'Third tranche of the annual targets', 'PHASE_4': 'Fourth tranche; lower need or difficult sites',
    'PHASE_5': 'Lowest priority; mostly ANR, gap planting or protection',
    'PROTECTED': 'C1: canopy >= 40 %; protection only', 'EXCLUDED': 'C2-C7: water, drains, slope > 45 %, built-up, cropland, rock'}
CLASS5 = ['', 'Very Low', 'Low', 'Moderate', 'High', 'Very High']
RX_ORDER = ['PROTECT_DENSE', 'NOT_PLANTABLE', 'FIRE_PROTECTION_FIRST', 'HYDRO_COMPATIBLE_PLANTING',
            'SOIL_STABILISATION_FIRST', 'ROCKY_MICROSITE', 'INVASIVE_CLEAR_THEN_PLANT', 'SMC_DROUGHT_HARDY',
            'ANR_GAP_PLANTING', 'BLANK_AREA_PLANTATION', 'MIXED_NATIVE_PLANTATION']
LATE_RX = RX_ORDER[5:]
DROUGHT = 'Drought-hardy: khair, ber, desi babul, guggal, hingor'
MEDIUM = 'Medium: teak, dhavdo, timru, khakhro, neem, sadad'
MOIST = 'Moist/deep: mahudo, bamboo, jambu, karanj, amla'


# ------------------------------------------------------------------ JS-identical random stream
def mulberry32(seed):
    st = [seed & 0xFFFFFFFF]

    def i32(x):
        x &= 0xFFFFFFFF
        return x - 0x100000000 if x & 0x80000000 else x

    def imul(a, b):
        return i32((a & 0xFFFFFFFF) * (b & 0xFFFFFFFF))

    def nxt():
        a = i32(st[0])
        a = i32(a + 0x6D2B79F5)
        st[0] = a & 0xFFFFFFFF
        t = imul(a ^ ((a & 0xFFFFFFFF) >> 15), 1 | a)
        t = i32((i32(t + imul(t ^ ((t & 0xFFFFFFFF) >> 7), 61 | t))) ^ t)
        return ((t ^ ((t & 0xFFFFFFFF) >> 14)) & 0xFFFFFFFF) / 4294967296
    return nxt


class Draws:
    def __init__(self, seed):
        self.rng = mulberry32(seed)

    def rnorm(self):
        u1 = 0.0
        while u1 == 0:
            u1 = self.rng()
        return math.sqrt(-2 * math.log(u1)) * math.cos(2 * math.pi * self.rng())

    def rgamma(self, alpha):
        if not alpha > 0:
            return 0.0
        if alpha < 1:
            return self.rgamma(alpha + 1) * math.pow(self.rng(), 1 / alpha)
        d = alpha - 1 / 3
        c = 1 / math.sqrt(9 * d)
        while True:
            while True:
                x = self.rnorm()
                v = 1 + c * x
                if v > 0:
                    break
            v = v * v * v
            u = self.rng()
            if u < 1 - 0.0331 * x * x * x * x:
                return d * v
            if math.log(u) < 0.5 * x * x + d * (1 - v + math.log(v)):
                return d * v

    def dirichlet(self, weights):
        tot = sum(weights)
        g = [self.rgamma(CFG['MC_CONC'] * w / tot) for w in weights]
        gs = sum(g)
        return [v / gs for v in g]


# ------------------------------------------------------------------ statistics helpers (as in the JS)
def avg_ranks(x):
    idx = sorted(range(len(x)), key=lambda i: x[i])
    r = [0.0] * len(x)
    i = 0
    while i < len(idx):
        j = i
        while j + 1 < len(idx) and x[idx[j + 1]] == x[idx[i]]:
            j += 1
        for t in range(i, j + 1):
            r[idx[t]] = (i + j) / 2 + 1
        i = j + 1
    return r


def pearson(a, b):
    a = np.asarray(a, float); b = np.asarray(b, float)
    da, db = a - a.mean(), b - b.mean()
    saa, sbb = (da * da).sum(), (db * db).sum()
    return float((da * db).sum() / math.sqrt(saa * sbb)) if saa > 0 and sbb > 0 else None


def vif_of(cols):
    m = len(cols)
    if m == 0:
        return []
    a = [[1.0 if i == j else (pearson(cols[i], cols[j]) or 0.0) for j in range(m)] + [1.0 if i == j else 0.0 for j in range(m)] for i in range(m)]
    for i in range(m):
        piv = max(range(i, m), key=lambda k: abs(a[k][i]))
        if abs(a[piv][i]) < 1e-10:
            return [math.inf] * m
        a[i], a[piv] = a[piv], a[i]
        d = a[i][i]
        a[i] = [v / d for v in a[i]]
        for k in range(m):
            if k != i:
                f = a[k][i]
                a[k] = [a[k][j] - f * a[i][j] for j in range(2 * m)]
    return [a[i][m + i] for i in range(m)]


def num(p, k, d=0.0):
    v = p.get(k)
    return d if v is None else float(v)


def yes(p, k):
    return str(p.get(k, '')) == 'yes'


def cls3(x):
    return 'Low' if x < CFG['SITE_SPLITS'][0] else ('Med' if x < CFG['SITE_SPLITS'][1] else 'High')


# ------------------------------------------------------------------ RUN 2
def score(features):
    P = [f['properties'] for f in features]
    n_all = len(P)
    in_m = [p for p in P if int(num(p, 'excluded')) == 0 and int(num(p, 'excluded_c8')) == 0]
    # CV guard statistics (aggregate_mean, aggregate_sample_sd over the matrix blocks)
    stats = {}
    for k in PARAMS:
        v = np.array([num(p, k) for p in in_m if p.get(k) is not None], float)
        stats[k] = (float(v.mean()) if len(v) else 0.0, float(v.std(ddof=1)) if len(v) > 1 else 0.0)
    mean_of = lambda k: stats.get(k, (0.0, 0.0))[0]
    sd_of = lambda k: stats.get(k, (0.0, 0.0))[1]
    # collinearity: rows with all COLKEYS present
    colkeys = PARAMS + ['canopy_pct', 'X1']
    rows = [p for p in in_m if all(p.get(k) is not None for k in colkeys)]
    column = lambda k: [float(p[k]) for p in rows]
    ranks = {k: avg_ranks(column(k)) for k in colkeys}
    pairs_n = [(N_KEYS[i], N_KEYS[j]) for i in range(len(N_KEYS)) for j in range(i + 1, len(N_KEYS))]
    pairs_f = [(F_KEYS[i], F_KEYS[j]) for i in range(len(F_KEYS)) for j in range(i + 1, len(F_KEYS))]
    rho_d = {}

    def set_rho(a, b):
        v = None if (sd_of(a) <= 1e-9 or (b in PARAMS and sd_of(b) <= 1e-9)) else pearson(ranks[a], ranks[b])
        rho_d[a + '|' + b] = v if (v is not None and math.isfinite(v)) else None
    for a, b in pairs_n + pairs_f:
        set_rho(a, b)
    set_rho('X1', 'canopy_pct')
    rho = lambda a, b: rho_d.get(a + '|' + b, rho_d.get(b + '|' + a))
    vif = {}
    for keys in (N_KEYS, F_KEYS):
        vary = [k for k in keys if sd_of(k) > 1e-9]
        for k, v in zip(vary, vif_of([column(k) for k in vary])):
            vif[k] = v
    # weights: CV guard then collinearity actions
    W = dict(CFG['W_N']); W.update(CFG['W_F'])
    cv_log, col_log, dropped = [], [], {}
    peers = lambda k: N_KEYS if k in N_KEYS else GROUPS[GROUP_OF[k]]

    def share(k, pts, exclude):
        others = [o for o in peers(k) if o != k and not dropped.get(o) and o not in exclude and W[o] > 0]
        tot = sum(W[o] for o in others)
        if tot <= 0:
            return False
        for o in others:
            W[o] += pts * W[o] / tot
        return True
    for k in PARAMS:
        m, sd = mean_of(k), sd_of(k)
        cv = sd / abs(m) if abs(m) > 1e-12 else (math.inf if sd > 0 else 0.0)
        if cv < CFG['CV_MIN'] and W[k] > 0:
            pts = W[k]; dropped[k] = True
            if share(k, pts, []):
                W[k] = 0
                cv_log.append('%s CV=%.4f -> %.2f pts shared in %s' % (k, cv, pts, 'RNI' if k in N_KEYS else 'group ' + GROUP_OF[k]))
            else:
                dropped[k] = False
                cv_log.append('%s CV=%.4f but no other parameter to share with — kept' % (k, cv))
    r12 = rho('F5', 'F10')
    if r12 is not None and abs(r12) >= CFG['RHO_MAX']:
        mv = min(2, W['F10']); W['F10'] -= mv; W['F11'] += mv
        col_log.append('FF-12 rho(F5,F10)=%.3f: F10 -%s pts, F11 +%s' % (r12, mv, mv))
    r13 = rho('N1', 'N5')
    if r13 is not None and abs(r13) >= CFG['RHO_MAX']:
        d13 = W['N1'] + W['N5']; comp = max(d13 - 5, 0)
        W['N1'] = W['N1'] * comp / d13; W['N5'] = W['N5'] * comp / d13; W['N3'] += d13 - comp
        col_log.append('FF-13 rho(N1,N5)=%.3f: merged into canopy-biomass deficit worth %.2f pts, N3 +%.2f' % (r13, comp, d13 - comp))
    for a, b in pairs_n + pairs_f:
        key = a + '|' + b
        if key in ('F5|F10', 'N1|N5'):
            continue
        r = rho_d.get(key)
        if r is None or abs(r) <= CFG['RHO_MAX']:
            continue
        same = (a in N_KEYS) or GROUP_OF[a] == GROUP_OF[b]
        if same and W[a] + W[b] > 0:
            hi = max(W[a], W[b]); s = W[a] + W[b]; freed = s - hi
            W[a] = W[a] * hi / s; W[b] = W[b] * hi / s
            if not share(a, freed, [b]):
                W[a] += freed * W[a] / hi; W[b] += freed * W[b] / hi
            col_log.append('FF-14 %s rho=%.3f: merged at the higher weight (%.2f pts)' % (key, r, hi))
        else:
            col_log.append('FF-14 %s rho=%.3f: different feasibility groups — REVIEW' % (key, r))
    for k, v in vif.items():
        if v > CFG['VIF_MAX']:
            col_log.append('FF-14 VIF(%s)=%s > %s: REVIEW' % (k, ('%.2f' % v) if math.isfinite(v) else 'singular', CFG['VIF_MAX']))
    assert abs(sum(W[k] for k in N_KEYS) - 100) < 1e-6
    for gk in G_KEYS:
        assert abs(sum(W[k] for k in GROUPS[gk]) - GP[gk]) < 1e-6
    cv_text = ' | '.join(cv_log) if cv_log else 'none'
    # indices
    em = 0.65 * GP['M'] / (GP['M'] + GP['S']); es = 0.65 * GP['S'] / (GP['M'] + GP['S'])

    def group_score(p, gk, swap=None):
        return sum(num(p, (swap or {}).get(k, k)) * W[k] for k in GROUPS[gk]) / GP[gk]

    def rfi_of(M, S, T, R):
        TR = (T * GP['T'] + R * GP['R']) / (GP['T'] + GP['R'])
        return math.pow(max(M, 0.01), em) * math.pow(max(S, 0.01), es) * (TR * 0.45 + 0.55)
    for p in P:
        p['M'] = M = group_score(p, 'M'); p['S'] = S = group_score(p, 'S')
        p['T'] = T = group_score(p, 'T'); p['R'] = R = group_score(p, 'R')
        p['S_opt'] = group_score(p, 'S', {'F5': 'F5_opt'}); p['S_pes'] = group_score(p, 'S', {'F5': 'F5_pes'})
        inm = int(num(p, 'excluded')) == 0
        p['RNI'] = sum(num(p, k) * W[k] for k in N_KEYS) / 100 if inm else -1
        p['RFI'] = rfi_of(M, S, T, R) if inm else -1
        p['RFI_core'] = math.pow(max(M, 0.01), em) * math.pow(max(S, 0.01), es)
        p['deg_factor'] = 1
    ret = sorted([p for p in P if int(num(p, 'excluded')) == 0], key=lambda p: p['block_id'])
    N = len(ret)
    cut = lambda q: max(math.ceil(N * q) - 1, 0)
    I = [cut(0.2), cut(0.4), cut(0.6), cut(0.8)]
    br_of = lambda a: [float(v) for v in np.sort(np.asarray(a, float))[I]]
    BR_RNI = br_of([p['RNI'] for p in ret]); BR_RFI = br_of([p['RFI'] for p in ret])
    cls5 = lambda v, b: 1 + sum(v >= x for x in b)
    for p in P:
        inm = int(num(p, 'excluded')) == 0
        tail = 6 if int(num(p, 'excluded_c1')) == 1 else 7
        nc = cls5(p['RNI'], BR_RNI) if inm else 0
        fc = cls5(p['RFI'], BR_RFI) if inm else 0
        ph = CFG['PHASE'][max(nc - 1, 0)][max(fc - 1, 0)] if inm else tail
        code = ph if inm else tail
        p.update(need_class=nc if inm else -1, need_class_name=CLASS5[nc] if inm else '',
                 feasibility_class=fc if inm else -1, feasibility_class_name=CLASS5[fc] if inm else '',
                 need_map=nc if inm else tail, feas_map=fc if inm else tail, phase_map=code,
                 phase_code=ph if inm else 0, phase=str(ph) if inm else '', priority_class=PHASE_ORDER[code - 1],
                 priority_code_map=code, class_code=code, phase_note=PHASE_TEXT[PHASE_ORDER[code - 1]],
                 RPS=p['RNI'] * 0.6 + p['RFI'] * 0.4 if inm else 0, class_method='quantile',
                 rni_breaks=', '.join('%.4f' % x for x in BR_RNI), rfi_breaks=', '.join('%.4f' % x for x in BR_RFI))
        # intervention (rule order 1..11)
        M, S, canopy = p['M'], p['S'], num(p, 'canopy_pct')
        if int(num(p, 'excluded_c1')) == 1: rx = 'PROTECT_DENSE'
        elif int(num(p, 'excluded')) == 1: rx = 'NOT_PLANTABLE'
        elif num(p, 'F13') < CFG['RX']['FIRE_F13']: rx = 'FIRE_PROTECTION_FIRST'
        elif yes(p, 'waterlogging_flag'): rx = 'HYDRO_COMPATIBLE_PLANTING'
        elif yes(p, 'X5') and S < CFG['RX']['STAB_S']: rx = 'SOIL_STABILISATION_FIRST'
        elif yes(p, 'X4'): rx = 'ROCKY_MICROSITE'
        elif num(p, 'N7') >= CFG['RX']['INVASIVE_N7']: rx = 'INVASIVE_CLEAR_THEN_PLANT'
        elif M < CFG['RX']['SMC_M'] or yes(p, 'X1_driest_quartile'): rx = 'SMC_DROUGHT_HARDY'
        elif (10 <= canopy < 40) or p['need_class'] == 1: rx = 'ANR_GAP_PLANTING'
        elif canopy < 10: rx = 'BLANK_AREA_PLANTATION'
        else: rx = 'MIXED_NATIVE_PLANTATION'
        smc = yes(p, 'X3') and (M < CFG['RX']['SMC_RESP_M'] or yes(p, 'X1_driest_half')) and rx in LATE_RX
        worst = min(M, S)
        if rx in ('ROCKY_MICROSITE', 'SMC_DROUGHT_HARDY'): sp = DROUGHT
        elif rx == 'HYDRO_COMPATIBLE_PLANTING': sp = 'Riparian: arjun, jambu, karanj'
        elif rx == 'SOIL_STABILISATION_FIRST': sp = 'Native grasses and shrubs first, then khair and ber'
        elif rx in ('PROTECT_DENSE', 'NOT_PLANTABLE'): sp = '-'
        elif worst < CFG['SITE_SPLITS'][0]: sp = DROUGHT
        elif worst < CFG['SITE_SPLITS'][1]: sp = MEDIUM
        else: sp = MOIST
        p.update(intervention=rx, rx_code=RX_ORDER.index(rx) + 1, smc_required='yes' if smc else 'no',
                 site_class='M-%s/S-%s' % (cls3(M), cls3(S)), species_group=sp,
                 v21_category=None, change_type='NOT_IN_V21', change_code=5)
    # Monte Carlo (array engine)
    NMAT = np.array([[num(p, k) for k in N_KEYS] for p in ret]); FMAT = np.array([[num(p, k) for k in F_KEYS] for p in ret])
    F5O = np.array([num(p, 'F5_opt') for p in ret]); F5P = np.array([num(p, 'F5_pes') for p in ret]); F5C = FMAT[:, F_KEYS.index('F5')]

    def groups_from(wF):
        out = {}
        for gk in G_KEYS:
            tot = sum(wF[k] for k in GROUPS[gk])
            v = np.array([wF[k] / tot if GROUP_OF[k] == gk and tot > 0 else 0 for k in F_KEYS])
            out[gk] = FMAT @ v
        return out
    BASEG = groups_from(W)
    dS = W['F5'] / GP['S']
    S_OPT = BASEG['S'] + (F5O - F5C) * dS
    S_PES = BASEG['S'] + (F5P - F5C) * dS
    PH = np.array(CFG['PHASE'])

    def phase_of(rni, rfi):
        bn = np.sort(rni)[I]; bf = np.sort(rfi)[I]
        nc = 1 + (rni[:, None] >= bn[None, :]).sum(1); fc = 1 + (rfi[:, None] >= bf[None, :]).sum(1)
        return PH[nc - 1, fc - 1]
    D = Draws(CFG['MC_SEED'])
    wN_base = [W[k] for k in N_KEYS]; g_base = [GP[gk] for gk in G_KEYS]
    draws = []
    for k0 in range(CFG['MC_K']):
        wn = D.dirichlet(wN_base); gw = D.dirichlet(g_base)
        gm, gs = gw[0], gw[1]
        D.rng(); D.rng(); D.rng(); D.rng(); D.rng(); D.rng(); D.rng(); D.rng()   # jitter(FIXED_BREAKS) x2: 8 draws, unused for quantile classes
        f5 = 'pessimistic' if D.rng() < 0.5 else 'optimistic'
        draws.append((wn, 0.65 * gm / (gm + gs), 0.65 * gs / (gm + gs), gw[2], gw[3], f5))
    K = CFG['MC_K']; KHALF = K // 2
    p12 = np.zeros(N); pmin = np.full(N, 5); pmax = np.full(N, 1); bdiff = np.zeros(N); ncount = {c: np.zeros(N) for c in range(1, 6)}
    half = 0.0
    for kk, (wn, em_d, es_d, gT, gR, f5) in enumerate(draws):
        rni = NMAT @ np.array(wn)
        TR = (BASEG['T'] * gT + BASEG['R'] * gR) / (gT + gR)
        rfiS = lambda Sv: np.power(np.maximum(BASEG['M'], 0.01), em_d) * np.power(np.maximum(Sv, 0.01), es_d) * (0.55 + TR * 0.45)
        pO = phase_of(rni, rfiS(S_OPT)); pP = phase_of(rni, rfiS(S_PES))
        pz = pP if f5 == 'pessimistic' else pO
        p12 += pz <= 2; pmin = np.minimum(pmin, pz); pmax = np.maximum(pmax, pz); bdiff += pO != pP
        for c in range(1, 6):
            ncount[c] += pz == c
        if kk == KHALF - 1:
            half = p12.sum() / (N * KHALF)
    stab = (p12 / K).astype(np.float32).astype(float)   # Earth Engine keeps these arrays in single precision
    best = ncount[1].copy(); modal = np.ones(N)
    for c in (2, 3, 4, 5):
        modal = modal + (ncount[c] > best) * (c - modal); best = np.maximum(best, ncount[c])
    bsens = (bdiff / K).astype(np.float32).astype(float)
    for i, p in enumerate(ret):
        lo, hi = int(pmin[i]), int(pmax[i])
        p.update(stability_p12=float(stab[i]), phase_modal=int(modal[i]), phase_range=str(lo) if lo == hi else '%d-%d' % (lo, hi),
                 b1_disagree_share=float(bsens[i]), b1_sensitive='yes' if bsens[i] > 0.20 else 'no')
    for p in P:
        if int(num(p, 'excluded')) == 1:
            p.update(stability_p12=0, phase_modal=0, phase_range=p['priority_class'], b1_disagree_share=0, b1_sensitive='no')
        p12f = 1 <= p['phase_code'] <= 2
        st = p['stability_p12']
        why = [w for w in [
            'Phase 1-2 with reliability < 0.80' if p12f and st < 0.80 else '',
            'G1 recent plantation?' if yes(p, 'recent_plantation_flag') else '',
            'G2 protected area' if yes(p, 'protected_area_flag') else '',
            'G3 soil pit' if p['b1_sensitive'] == 'yes' else '',
            'G4 waterlogging' if yes(p, 'waterlogging_flag') else '',
            'G5 grassland option (optional note; stays under plantation)' if int(num(p, 'grassland_option')) == 1 else '',
            'C6 cultivation inside forest (rights/encroachment)' if num(p, 'C6_frac') > 0 else '',
            'Phase 1-2 without degradation evidence' if p12f and int(num(p, 'degradation_evidence')) == 0 else ''] if w]
        p.update(stability_reading=('Robust' if st > 0.80 else ('Moderately stable' if st >= 0.50 else 'Marginal')) if p12f else '',
                 field_check='yes' if why else 'no', field_check_reason='; '.join(why),
                 fra_rights_check_required='yes' if p12f else 'no', cv_reweight_log=cv_text,
                 weights_used=json.dumps(W, separators=(',', ':')), model_version='FRPIM_v2.2')
    # range x phase table
    rp = defaultdict(lambda: [0, 0.0, 0.0])
    for p in P:
        r = rp[(p.get('range', ''), p['phase_map'])]
        r[0] += 1; r[1] += num(p, 'block_area_ha'); r[2] += num(p, 'net_plantable_ha')
    log = dict(n_all=n_all, n_excluded=sum(int(num(p, 'excluded')) for p in P), n_matrix=N, weights=W,
               cv_guard=cv_text, collinearity=col_log or 'none', exponents=[em, es], rni_breaks=BR_RNI, rfi_breaks=BR_RFI,
               stability_mean_full=float(p12.sum() / (N * K)), stability_mean_half=half,
               range_x_phase=[dict(range=k[0], phase_code=k[1], phase=PHASE_ORDER[k[1] - 1], blocks=v[0], gross_ha=round(v[1], 2), net_ha=round(v[2], 2))
                              for k, v in sorted(rp.items())])
    return log


def main():
    args = sys.argv[1:]
    cmp_path = None
    if '--compare' in args:
        i = args.index('--compare'); cmp_path = args[i + 1]; del args[i:i + 2]
    src, out = args[0], args[1]
    gj = json.load(open(src))
    log = score(gj['features'])
    json.dump(gj, open(out, 'w'))
    json.dump(log, open(out.rsplit('.', 1)[0] + '_log.json', 'w'), indent=1, default=float)
    print('blocks', log['n_all'], '| excluded', log['n_excluded'], '| in matrix', log['n_matrix'])
    print('weights', {k: round(v, 2) for k, v in log['weights'].items()})
    print('CV guard:', log['cv_guard']); print('collinearity:', log['collinearity'])
    print('RNI breaks', [round(x, 4) for x in log['rni_breaks']], '| RFI breaks', [round(x, 4) for x in log['rfi_breaks']])
    if cmp_path:
        ref = {f['properties']['block_id']: f['properties'] for f in json.load(open(cmp_path))['features']}
        mine = {f['properties']['block_id']: f['properties'] for f in gj['features']}
        common = sorted(set(ref) & set(mine))
        print('\ncompare with Earth Engine on', len(common), 'blocks')
        for k in ('RNI', 'RFI', 'M', 'S', 'T', 'R', 'RPS', 'stability_p12', 'b1_disagree_share'):
            d = [abs(float(ref[b][k]) - float(mine[b][k])) for b in common if ref[b].get(k) is not None]
            print('  %-18s max abs diff %.3g' % (k, max(d) if d else float('nan')))
        for k in ('need_map', 'feas_map', 'phase_map', 'intervention', 'smc_required', 'species_group', 'site_class',
                  'phase_modal', 'phase_range', 'b1_sensitive', 'field_check', 'stability_reading', 'rni_breaks', 'rfi_breaks'):
            bad = [b for b in common if str(ref[b].get(k)) != str(mine[b].get(k))]
            print('  %-18s mismatches %d%s' % (k, len(bad), ('  e.g. %s: EE=%s local=%s' % (bad[0], ref[bad[0]].get(k), mine[bad[0]].get(k))) if bad else ''))


if __name__ == '__main__':
    main()
