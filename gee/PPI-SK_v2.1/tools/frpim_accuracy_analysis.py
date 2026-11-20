"""
FRPIM v2.2 — accuracy analysis for Maps 1, 2 and 3 from the filled field form.

Usage: python frpim_accuracy_analysis.py ACC_field_form_FILLED.csv ACC_office_sample.csv ACC_strata.csv OUT_DIR

Implements the analysis design of the accuracy protocol:
  * field indices FNI (need) and FFI (feasibility) from the plot measurements (a priori formulas)
  * Map 1 / Map 2: Spearman rho (bootstrap 95 % CI), Kendall tau-b class trend (permutation p),
    design-weighted exact and +/-1 class agreement, quadratic-weighted kappa (bootstrap CI)
  * Map 3: 7 x 7 error matrix with the stratified estimator (Olofsson et al. 2014): overall, user's
    and producer's accuracy with standard errors, area-adjusted class areas with 95 % CI
  * component validation: field canopy, bare soil and slope against the model inputs (r, RMSE, bias)
  * quality control: agreement between the first and the independent second visits
"""
import csv
import math
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

RNG = np.random.default_rng(2026)
B = 2000                                              # bootstrap resamples
PHASE = [[5, 5, 5, 5, 4], [5, 4, 4, 4, 3], [4, 3, 3, 3, 2], [3, 2, 2, 2, 1], [2, 2, 1, 1, 1]]
CLASS7 = ["Phase 1", "Phase 2", "Phase 3", "Phase 4", "Phase 5", "Protected", "Excluded"]
LANDFORM = {"VALLEY": 1.0, "LOWER": 0.8, "FLAT": 0.6, "MID": 0.5, "UPPER": 0.25, "RIDGE": 0.0}
TEX_WATER = {"C": 0.7, "CL": 1.0, "L": 0.9, "SL": 0.6, "LS": 0.3, "S": 0.1}
TEX_SOIL = {"C": 0.6, "CL": 0.9, "L": 1.0, "SL": 0.7, "LS": 0.4, "S": 0.2}


def f(x, default=None):
    try:
        return float(x)
    except (TypeError, ValueError):
        return default


def piecewise(x, xs, ys):
    if x < xs[0]:
        return ys[0]
    for i in range(len(xs) - 1):
        if xs[i] <= x < xs[i + 1]:
            return ys[i] + (ys[i + 1] - ys[i]) * (x - xs[i]) / (xs[i + 1] - xs[i])
    return ys[-1]


def field_indices(r):
    hits = [f(r.get(f"canopy_hit_{i:02d}")) for i in range(1, 21)]
    hits = [h for h in hits if h is not None]
    ground = [str(r.get(f"ground_{i:02d}", "")).strip().upper() for i in range(1, 21)]
    ground = [g for g in ground if g]
    inv = [f(r.get(f"invasive_{i:02d}")) for i in range(1, 21)]
    inv = [v for v in inv if v is not None]
    canopy = 100 * sum(hits) / len(hits) if hits else None
    bare = 100 * sum(g == "B" for g in ground) / len(ground) if ground else None
    rock = 100 * sum(g == "R" for g in ground) / len(ground) if ground else None
    invp = 100 * sum(inv) / len(inv) if inv else 0.0
    eros = f(r.get("erosion_0_4"), 0); fire = f(r.get("fire_0_2"), 0)
    graz = f(r.get("grazing_0_2"), 0); cut = f(r.get("cutting_0_2"), 0)
    depths = [min(f(r.get(k), 0), 100) for k in ("soil_depth_cm_C", "soil_depth_cm_N", "soil_depth_cm_E",
                                                 "soil_depth_cm_S", "soil_depth_cm_W") if f(r.get(k)) is not None]
    depth = sum(depths) / len(depths) if depths else None
    slope = f(r.get("slope_pct")); aspect = f(r.get("aspect_deg"))
    lf = LANDFORM.get(str(r.get("landform", "")).strip().upper())
    tex = str(r.get("texture", "")).strip().upper()
    constr = sum(f(r.get(k), 0) for k in ("water_pct", "drain_pct", "rock_outcrop_pct", "built_pct", "crop_pct"))
    if canopy is None or bare is None:
        return None
    # Field Need Index (mirrors RNI: canopy deficit, bare soil, erosion, invasion, disturbance)
    fni = (0.35 * min(max((40 - canopy) / 40, 0), 1) + 0.20 * bare / 100 + 0.20 * eros / 4
           + 0.10 * min(invp / 30, 1) + 0.15 * (fire + graz + cut) / 6)
    # Field Feasibility Index (mirrors RFI: M x S geometric core, terrain and risk modifier)
    M = 0.6 * (lf if lf is not None else 0.5) + 0.4 * TEX_WATER.get(tex, 0.5)
    S = (0.5 * (depth if depth is not None else 30) / 100 + 0.3 * (1 - min((rock or 0) / 50, 1))
         + 0.2 * TEX_SOIL.get(tex, 0.5))
    sl = slope if slope is not None else 10
    slope_score = piecewise(sl, [2, 5, 20, 35, 45], [0.4, 1, 1, 0.4, 0.1])
    heat = 0.5 if aspect is None else 0.5 + 0.5 * math.cos(math.radians(aspect - 225)) * min(sl / 30, 1)
    T = 0.6 * slope_score + 0.4 * (1 - heat)
    R = 1 - (fire + graz) / 4
    TR = (18 * T + 12 * R) / 30
    ffi = max(M, 0.01) ** 0.325 * max(S, 0.01) ** 0.325 * (0.55 + 0.45 * TR)
    return {"canopy": canopy, "bare": bare, "rock": rock, "inv": invp, "depth": depth, "slope": slope,
            "constr": constr, "FNI": fni, "FFI": ffi}


def ranks(x):
    x = np.asarray(x, float); order = np.argsort(x, kind="mergesort"); r = np.empty(len(x)); i = 0
    while i < len(x):
        j = i
        while j + 1 < len(x) and x[order[j + 1]] == x[order[i]]:
            j += 1
        r[order[i:j + 1]] = (i + j) / 2 + 1; i = j + 1
    return r


def spearman(a, b):
    ra, rb = ranks(a), ranks(b)
    return float(np.corrcoef(ra, rb)[0, 1]) if np.std(ra) > 0 and np.std(rb) > 0 else float("nan")


def kendall_tau_b(x, y):
    n = len(x); c = d = tx = ty = 0
    for i in range(n):
        for j in range(i + 1, n):
            dx, dy = np.sign(x[i] - x[j]), np.sign(y[i] - y[j])
            if dx == 0 and dy == 0:
                continue
            if dx == 0:
                tx += 1
            elif dy == 0:
                ty += 1
            elif dx == dy:
                c += 1
            else:
                d += 1
    den = math.sqrt((c + d + tx) * (c + d + ty))
    return (c - d) / den if den else float("nan")


def weighted_quintile_classes(values, weights):
    order = np.argsort(values); cw = np.cumsum(np.asarray(weights)[order]) / np.sum(weights)
    cls = np.empty(len(values), int)
    for k, idx in enumerate(order):
        cls[idx] = min(5, int(math.floor(cw[k] * 5 - 1e-9)) + 1)
    return cls


def qw_kappa(a, b, k=5):
    O = np.zeros((k, k))
    for i, j in zip(a, b):
        O[i - 1, j - 1] += 1
    n = O.sum()
    if n == 0:
        return float("nan")
    W = np.array([[((i - j) ** 2) / ((k - 1) ** 2) for j in range(k)] for i in range(k)])
    E = np.outer(O.sum(1), O.sum(0)) / n
    den = (W * E).sum()
    return 1 - (W * O).sum() / den if den else float("nan")


def boot_ci(stat, *arrays):
    n = len(arrays[0]); vals = []
    for _ in range(B):
        idx = RNG.integers(0, n, n)
        v = stat(*[np.asarray(a)[idx] for a in arrays])
        if not math.isnan(v):
            vals.append(v)
    return (float(np.percentile(vals, 2.5)), float(np.percentile(vals, 97.5))) if vals else (float("nan"),) * 2


def main():
    form, office, strata, out = (Path(a) for a in sys.argv[1:5])
    out.mkdir(parents=True, exist_ok=True)
    F = {r["field_id"]: r for r in csv.DictReader(open(form, encoding="utf-8"))}
    O = {r["field_id"]: r for r in csv.DictReader(open(office, encoding="utf-8"))}
    S = {int(r["stratum"]): r for r in csv.DictReader(open(strata, encoding="utf-8"))}
    A_tot = sum(float(s["area_ha"]) for s in S.values())
    data, qc_pairs = [], []
    for fid, fr in F.items():
        ind = field_indices(fr)
        if ind is None:
            continue                                   # not visited / not filled
        o = O.get(fid) or O.get(fid[:-3] if fid.endswith("-QC") else fid)   # second visits reuse the office row
        if o is None:
            print(f"WARNING: {fid} not in the office sample - skipped"); continue
        rec = dict(ind, field_id=fid, stratum=int(o["stratum"]), qc=fr.get("qc_second_visit", "no"),
                   observer=fr.get("observer", ""), model_phase=int(o["model_phase_map"]),
                   model_need=int(o["model_need_class"]), model_feas=int(o["model_feas_class"]),
                   RNI=float(o["model_RNI"]), RFI=float(o["model_RFI"]), m_canopy=float(o["model_canopy_pct"]),
                   m_bare=float(o["model_bare_share_pct"]), m_slope=float(o["model_slope_pct"]))
        data.append(rec)
    # QC duplicates: rows whose field_id ends with "-QC" (second visit) pair with the first visit
    first = {d["field_id"]: d for d in data if not d["field_id"].endswith("-QC")}
    for d in data:
        if d["field_id"].endswith("-QC") and d["field_id"][:-3] in first:
            qc_pairs.append((first[d["field_id"][:-3]], d))
    data = list(first.values())
    n_h = defaultdict(int)
    for d in data:
        n_h[d["stratum"]] += 1
    for d in data:
        h = d["stratum"]
        d["w"] = int(S[h]["N_h_blocks"]) / n_h[h]                    # design weight N_h / n_h

    # field labels for Map 3 (precedence as the model: C1 dense canopy first, then C2-C7 > 30 %)
    in_m = [d for d in data if d["canopy"] < 40 and d["constr"] <= 30]
    fn_cls = weighted_quintile_classes([d["FNI"] for d in in_m], [d["w"] for d in in_m]) if in_m else []
    ff_cls = weighted_quintile_classes([d["FFI"] for d in in_m], [d["w"] for d in in_m]) if in_m else []
    for d, a, b in zip(in_m, fn_cls, ff_cls):
        d["field_need"], d["field_feas"] = int(a), int(b)
        d["field_phase"] = PHASE[a - 1][b - 1]
    for d in data:
        if d["canopy"] >= 40:
            d["field_phase"] = 6
        elif d["constr"] > 30:
            d["field_phase"] = 7

    lines = ["# FRPIM v2.2 — accuracy assessment results", "",
             f"Plots analysed: {len(data)} (QC pairs: {len(qc_pairs)}). Bootstrap resamples: {B}.", ""]
    tables = {}

    # ---------- component validation
    lines += ["## 1. Component validation (field measurement vs model input)", "",
              "| Variable | n | Pearson r | RMSE | Bias (model - field) |", "| --- | --- | --- | --- | --- |"]
    for name, fk, mk in (("Canopy cover %", "canopy", "m_canopy"), ("Bare soil %", "bare", "m_bare"),
                         ("Slope %", "slope", "m_slope")):
        pairs = [(d[fk], d[mk]) for d in data if d.get(fk) is not None]
        if len(pairs) >= 3:
            a = np.array(pairs)
            r = float(np.corrcoef(a[:, 0], a[:, 1])[0, 1]) if a[:, 0].std() > 0 and a[:, 1].std() > 0 else float("nan")
            rmse = float(np.sqrt(np.mean((a[:, 1] - a[:, 0]) ** 2))); bias = float(np.mean(a[:, 1] - a[:, 0]))
            lines.append(f"| {name} | {len(a)} | {r:.2f} | {rmse:.1f} | {bias:+.1f} |")
    lines.append("")

    # ---------- Map 1 and Map 2
    for title, idx, fidx, mcls, fcls in (("Map 1 — Restoration Need Index", "RNI", "FNI", "model_need", "field_need"),
                                         ("Map 2 — Restoration Feasibility Index", "RFI", "FFI", "model_feas", "field_feas")):
        sub = [d for d in data if d["model_phase"] <= 5]
        x = [d[idx] for d in sub]; y = [d[fidx] for d in sub]
        rho = spearman(x, y); ci = boot_ci(spearman, x, y)
        tau = kendall_tau_b([d[mcls] for d in sub], y)
        perm = [kendall_tau_b(list(RNG.permutation([d[mcls] for d in sub])), y) for _ in range(999)]
        p_tau = (1 + sum(abs(t) >= abs(tau) for t in perm)) / 1000
        both = [d for d in sub if fcls in d]
        w = np.array([d["w"] for d in both])
        exact = float(np.sum(w * np.array([d[mcls] == d[fcls] for d in both])) / w.sum()) if both else float("nan")
        within1 = float(np.sum(w * np.array([abs(d[mcls] - d[fcls]) <= 1 for d in both])) / w.sum()) if both else float("nan")
        kap = qw_kappa([d[mcls] for d in both], [d[fcls] for d in both])
        kci = boot_ci(lambda a, b: qw_kappa(list(a), list(b)), [d[mcls] for d in both], [d[fcls] for d in both])
        lines += [f"## {title}", "",
                  f"* Spearman rho({idx}, field {fidx}) = **{rho:.2f}** (95 % CI {ci[0]:.2f} to {ci[1]:.2f}; n = {len(sub)})",
                  f"* Kendall tau-b (model class vs field index) = {tau:.2f}, permutation p = {p_tau:.3f}",
                  f"* Design-weighted exact class agreement = {100 * exact:.1f} %; within one class = {100 * within1:.1f} %",
                  f"* Quadratic-weighted kappa = **{kap:.2f}** (95 % CI {kci[0]:.2f} to {kci[1]:.2f}; n = {len(both)})", ""]
        tables[idx] = {"rho": rho, "rho_ci": ci, "tau": tau, "p": p_tau, "exact": exact, "within1": within1,
                       "kappa": kap, "kappa_ci": kci}

    # ---------- Map 3: stratified estimator (strata = map classes), area weights
    K = 7
    n = np.zeros((K, K))
    for d in data:
        n[d["stratum"] - 1, d["field_phase"] - 1] += 1
    W = np.array([float(S[h]["area_ha"]) / A_tot for h in range(1, 8)])
    ni = n.sum(1)
    p = np.zeros((K, K))
    for i in range(K):
        if ni[i] > 0:
            p[i] = W[i] * n[i] / ni[i]
    OA = float(np.trace(p))
    UA = [p[i, i] / p[i].sum() if p[i].sum() > 0 else float("nan") for i in range(K)]
    PA = [p[j, j] / p[:, j].sum() if p[:, j].sum() > 0 else float("nan") for j in range(K)]
    var_OA = sum(W[i] ** 2 * UA[i] * (1 - UA[i]) / (ni[i] - 1) for i in range(K) if ni[i] > 1 and not math.isnan(UA[i]))
    se_UA = [math.sqrt(UA[i] * (1 - UA[i]) / (ni[i] - 1)) if ni[i] > 1 and not math.isnan(UA[i]) else float("nan")
             for i in range(K)]
    area_adj = p.sum(0) * A_tot
    se_area = []
    for j in range(K):
        # Olofsson et al. (2014) eq. 10: S(p_.j) = sqrt(sum_i W_i^2 * (n_ij/n_i)(1 - n_ij/n_i)/(n_i - 1))
        v = sum(W[i] ** 2 * (n[i, j] / ni[i]) * (1 - n[i, j] / ni[i]) / (ni[i] - 1) for i in range(K) if ni[i] > 1)
        se_area.append(math.sqrt(v) * A_tot)
    within1 = float(sum(p[i, j] for i in range(5) for j in range(5) if abs(i - j) <= 1) + p[5, 5] + p[6, 6])
    prio_map = [0, 1]; prio_hit = float(sum(p[i, j] for i in prio_map for j in prio_map))
    lines += ["## Map 3 — Restoration Priority (Phase 1-5, Protected, Excluded)", "",
              "Error matrix: rows = map class (strata), columns = field (reference) class; cells = sample counts.", "",
              "| Map \\ Field | " + " | ".join(CLASS7) + " | n |", "| --- |" + " --- |" * (K + 1)]
    for i in range(K):
        lines.append(f"| {CLASS7[i]} | " + " | ".join(str(int(v)) for v in n[i]) + f" | {int(ni[i])} |")
    lines += ["", f"* Overall accuracy (area-weighted, stratified estimator) = **{100 * OA:.1f} %** "
                  f"(95 % CI ± {196 * math.sqrt(var_OA):.1f} pp)",
              f"* Agreement within one phase (protected/excluded exact) = {100 * within1:.1f} %",
              f"* Phase 1-2 correctly mapped as Phase 1-2 (share of range area) = {100 * prio_hit:.1f} %", "",
              "| Class | User's accuracy | ± 95 % | Producer's accuracy | Mapped area (ha) | Adjusted area (ha) | ± 95 % (ha) |",
              "| --- | --- | --- | --- | --- | --- | --- |"]
    for i in range(K):
        ua = "-" if math.isnan(UA[i]) else f"{100 * UA[i]:.1f} %"
        sua = "-" if math.isnan(se_UA[i]) else f"{196 * se_UA[i]:.1f} pp"
        pa = "-" if math.isnan(PA[i]) else f"{100 * PA[i]:.1f} %"
        lines.append(f"| {CLASS7[i]} | {ua} | {sua} | {pa} | {float(S[i + 1]['area_ha']):,.1f} | "
                     f"{area_adj[i]:,.1f} | {1.96 * se_area[i]:,.1f} |")
    lines.append("")

    # ---------- QC
    if qc_pairs:
        dF = [abs(a["FNI"] - b["FNI"]) for a, b in qc_pairs]; dS = [abs(a["FFI"] - b["FFI"]) for a, b in qc_pairs]
        same = sum(a.get("field_phase") == b.get("field_phase") for a, b in qc_pairs)
        lines += ["## Quality control (independent second visits)", "",
                  f"* Pairs: {len(qc_pairs)}; mean |difference| FNI = {np.mean(dF):.3f}, FFI = {np.mean(dS):.3f}",
                  f"* Same field phase on both visits: {same} of {len(qc_pairs)}", ""]
    (out / "accuracy_results.md").write_text("\n".join(lines), encoding="utf-8")
    with open(out / "accuracy_plot_data.csv", "w", newline="", encoding="utf-8") as fh:
        keys = ["field_id", "stratum", "w", "model_phase", "field_phase", "model_need", "field_need", "model_feas",
                "field_feas", "RNI", "FNI", "RFI", "FFI", "canopy", "m_canopy", "bare", "m_bare", "slope", "m_slope",
                "depth", "rock", "inv", "constr"]
        wr = csv.DictWriter(fh, fieldnames=keys, extrasaction="ignore"); wr.writeheader(); wr.writerows(data)
    print("\n".join(lines))


if __name__ == "__main__":
    main()
