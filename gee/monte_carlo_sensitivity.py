"""
PPI-SK v2 — Monte Carlo rank stability, OAT sensitivity, collinearity screening.

Implements Spec Sections 9 and 10 (FF-07 to FF-11) on the block table exported
by gee/PPI_SK_v2.js (PPI_SK_v2_block_table.csv, Drive folder PPI_SK_v2).

Spec Section 9.2 explicitly recommends running the Monte Carlo in Python/pandas
on the already-reduced block table rather than in GEE, since 500 full-resolution
reruns exceed GEE compute limits. This script is that step.

Usage:
    pip install pandas numpy scipy
    python monte_carlo_sensitivity.py --input PPI_SK_v2_block_table.csv --outdir out/

Outputs (Section 11.3 products 7-9, plus the collinearity matrix):
    out/stability_table.csv       block_id, stability_cat12, category_modal,
                                   category_range, b1_sensitive
    out/sensitivity_report.csv    OAT results, ranked by % blocks changed
    out/collinearity_matrix.csv   Spearman rho for every parameter pair
    out/ff_checks.json            pass/fail for FF-07..FF-11
"""

import argparse
import json
import os

import numpy as np
import pandas as pd
from scipy.stats import spearmanr

# ----------------------------------------------------------------------------
# Model constants (must mirror gee/PPI_SK_v2.js Sections 5 and 8)
# ----------------------------------------------------------------------------

THEME_WEIGHTS = {'A': 26, 'B': 24, 'C': 14, 'D': 22, 'E': 14}

SUBWEIGHTS = {
    'A': {'A1_norm': 9, 'A2_norm': 4, 'A3n_norm': 7, 'A4_norm': 3, 'A5_norm': 3},
    'B': {'B1_norm': 4, 'B2_norm': 5, 'B3_norm': 4, 'B4_norm': 4, 'B5_norm': 3,
          'B6_norm': 2, 'B7_norm': 2},
    'C': {'C1s_norm': 6, 'C2s_norm': 4, 'C3s_norm': 2, 'C4s_norm': 2},
    'D': {'D1_norm': 6, 'D2_norm': 5, 'D3_norm': 4, 'D4_lossfrac': 4, 'D5_norm': 3},
    'E': {'E1_norm': 6, 'E2_norm': 4, 'E4_norm': 4},
}

CATEGORY_BREAKS = [(80, 1), (60, 2), (40, 3), (20, 4), (0, 5)]

# Collinearity checks required by Section 10 (FF-07 to FF-11)
COLLINEARITY_CHECKS = [
    ('FF-07', 'A3n_ndmi', 'D4_lossfrac', 0.60, 'Mask A3n to exclude blocks with Hansen loss in last 3 yrs'),
    ('FF-08', 'A2_rain', 'A4_deficit', 0.75, 'Collapse A4 into A2, move 3 pts to A3n (A3n -> 10)'),
    ('FF-09', 'B1_norm', 'C1s_norm', 0.75, 'Reduce C1s to 4, move 2 to C2s'),
    ('FF-10', 'E2_norm', 'pop_2km', None, 'Drop the weaker component of the E2 composite (VIF < 5 target)'),
    ('FF-11', 'D2_trend', 'D3_agb', 0.75, 'Merge worst pair into composite; halve combined weight'),
]


# ----------------------------------------------------------------------------
# Core score computation — mirrors gee/PPI_SK_v2.js Sections 8.1-8.2
# ----------------------------------------------------------------------------

def theme_score(df, theme, subweights):
    total = sum(subweights[theme].values())
    s = pd.Series(0.0, index=df.index)
    for col, w in subweights[theme].items():
        s = s + df[col].fillna(0) * w
    return s / total


def compute_ppi(df, theme_weights, subweights, b1_col='B1_norm', constrained_col='constrained_frac'):
    """Recompute A-E theme scores and PPI_absolute for an arbitrary weight set.
    theme_weights: dict A..E summing to 100 (need not be the AHP defaults).
    b1_col: which B1 column feeds the B theme score for this run
    ('B1_norm', 'B1_optimistic' or 'B1_pessimistic').
    """
    work = df.copy()
    sw = {k: dict(v) for k, v in subweights.items()}

    b_weights = sw['B']
    b1_weight = b_weights['B1_norm']
    b_total = sum(b_weights.values())
    b_score = work[b1_col].fillna(0) * b1_weight
    for col, w in b_weights.items():
        if col == 'B1_norm':
            continue
        b_score = b_score + work[col].fillna(0) * w
    b_score = b_score / b_total

    a_score = theme_score(work, 'A', sw)
    c_score = theme_score(work, 'C', sw)
    d_score = theme_score(work, 'D', sw)
    e_score = theme_score(work, 'E', sw)

    wA, wB, wC, wD, wE = (theme_weights['A'], theme_weights['B'], theme_weights['C'],
                          theme_weights['D'], theme_weights['E'])
    exp_total = 0.65  # sum of 0.35 + 0.30 in the spec's approved core [DO NOT ALTER structure]
    exp_a = exp_total * wA / (wA + wB)
    exp_b = exp_total * wB / (wA + wB)

    cde = (c_score * wC + d_score * wD + e_score * wE) / (wC + wD + wE)

    a_safe = a_score.clip(lower=0.01)
    b_safe = b_score.clip(lower=0.01)
    core = (a_safe ** exp_a) * (b_safe ** exp_b)
    modifier = 0.55 + 0.45 * cde
    ppi_raw = core * modifier

    excluded = df[constrained_col] > 0.30
    ppi_final = ppi_raw.where(~excluded, 0.0)
    return ppi_final, a_score, b_score, c_score, d_score, e_score


def classify(ppi, excluded):
    pct = ppi.rank(pct=True) * 100
    pct = pct.where(~excluded, 0.0)
    cat = pd.Series(5, index=ppi.index)
    for threshold, c in CATEGORY_BREAKS:
        cat = cat.where(~((pct >= threshold) & (~excluded)), c)
    cat = cat.where(~excluded, 5)
    return cat, pct


# ----------------------------------------------------------------------------
# Section 9.2 — Monte Carlo rank stability
# ----------------------------------------------------------------------------

def run_monte_carlo(df, n_iter=500, alpha_concentration=50, seed=42):
    rng = np.random.default_rng(seed)
    excluded = df['constrained_frac'] > 0.30

    theme_names = ['A', 'B', 'C', 'D', 'E']
    p0 = np.array([THEME_WEIGHTS[t] for t in theme_names], dtype=float) / 100.0
    alpha = p0 * alpha_concentration

    cat_runs = np.zeros((n_iter, len(df)), dtype=int)
    cat_runs_opt = np.zeros((n_iter, len(df)), dtype=int)
    cat_runs_pess = np.zeros((n_iter, len(df)), dtype=int)

    for i in range(n_iter):
        draw = rng.dirichlet(alpha) * 100.0
        tw = dict(zip(theme_names, draw))
        b1_choice = 'B1_optimistic' if rng.random() < 0.5 else 'B1_pessimistic'

        ppi, *_ = compute_ppi(df, tw, SUBWEIGHTS, b1_col=b1_choice)
        cat, _ = classify(ppi, excluded)
        cat_runs[i, :] = cat.values

        # Same theme-weight draw, both B1 variants, to test b1_sensitive (Sec 9.2)
        ppi_opt, *_ = compute_ppi(df, tw, SUBWEIGHTS, b1_col='B1_optimistic')
        cat_opt, _ = classify(ppi_opt, excluded)
        cat_runs_opt[i, :] = cat_opt.values

        ppi_pess, *_ = compute_ppi(df, tw, SUBWEIGHTS, b1_col='B1_pessimistic')
        cat_pess, _ = classify(ppi_pess, excluded)
        cat_runs_pess[i, :] = cat_pess.values

    stability_cat12 = np.mean((cat_runs == 1) | (cat_runs == 2), axis=0)
    modal = pd.DataFrame(cat_runs).mode(axis=0).iloc[0].values
    cat_min = cat_runs.min(axis=0)
    cat_max = cat_runs.max(axis=0)
    category_range = [f'{lo}-{hi}' if lo != hi else f'{lo}' for lo, hi in zip(cat_min, cat_max)]
    b1_sensitive = np.mean(cat_runs_opt != cat_runs_pess, axis=0) > 0.20

    out = pd.DataFrame({
        'block_id': df['block_id'].values,
        'stability_cat12': stability_cat12,
        'category_modal': modal,
        'category_range': category_range,
        'b1_sensitive': b1_sensitive,
    })

    # FF-19: convergence check between n=250 and n=500
    half = n_iter // 2
    stab_250 = np.mean((cat_runs[:half] == 1) | (cat_runs[:half] == 2), axis=0)
    convergence_delta = float(np.mean(np.abs(stability_cat12 - stab_250)))
    return out, convergence_delta


# ----------------------------------------------------------------------------
# Section 9.3 — One-at-a-time sensitivity
# ----------------------------------------------------------------------------

def run_oat_sensitivity(df):
    excluded = df['constrained_frac'] > 0.30
    baseline_ppi, *_ = compute_ppi(df, THEME_WEIGHTS, SUBWEIGHTS)
    baseline_cat, _ = classify(baseline_ppi, excluded)

    rows = []
    for theme, params in SUBWEIGHTS.items():
        for param, w in params.items():
            for direction, factor in [('+20%', 1.2), ('-20%', 0.8)]:
                perturbed = {k: dict(v) for k, v in SUBWEIGHTS.items()}
                perturbed[theme][param] = w * factor
                ppi_p, *_ = compute_ppi(df, THEME_WEIGHTS, perturbed)
                cat_p, _ = classify(ppi_p, excluded)
                changed = (cat_p != baseline_cat).mean() * 100
                rows.append({
                    'theme': theme, 'parameter': param, 'base_subweight': w,
                    'direction': direction, 'pct_blocks_category_changed': changed,
                    'flag_over_influential': changed > 15
                })
    report = pd.DataFrame(rows).sort_values('pct_blocks_category_changed', ascending=False)
    return report


# ----------------------------------------------------------------------------
# Section 10 — collinearity screening (FF-07 to FF-11)
# ----------------------------------------------------------------------------

def variance_inflation_factor(df, cols):
    """VIF via OLS R^2 (numpy lstsq), no statsmodels dependency."""
    X = df[cols].fillna(df[cols].mean()).values
    vifs = {}
    n, k = X.shape
    for j, col in enumerate(cols):
        y = X[:, j]
        others = np.delete(X, j, axis=1)
        others_design = np.column_stack([np.ones(n), others])
        coef, *_ = np.linalg.lstsq(others_design, y, rcond=None)
        pred = others_design @ coef
        ss_res = np.sum((y - pred) ** 2)
        ss_tot = np.sum((y - y.mean()) ** 2)
        r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0
        vifs[col] = 1 / (1 - r2) if r2 < 0.999999 else np.inf
    return vifs


def run_collinearity_screen(df, sample_n=5000, seed=42):
    sample = df if len(df) <= sample_n else df.sample(sample_n, random_state=seed)

    numeric_cols = [c for c in df.columns if pd.api.types.is_numeric_dtype(df[c])]
    corr_matrix = sample[numeric_cols].corr(method='spearman')

    ff_results = {}
    for ff_id, col_a, col_b, threshold, action in COLLINEARITY_CHECKS:
        if col_a not in sample.columns or col_b not in sample.columns:
            ff_results[ff_id] = {'status': 'SKIPPED', 'reason': f'{col_a} or {col_b} missing from export'}
            continue
        rho, pval = spearmanr(sample[col_a], sample[col_b], nan_policy='omit')
        if ff_id == 'FF-10':
            vifs = variance_inflation_factor(sample.dropna(subset=[col_a, col_b]), [col_a, col_b])
            passed = all(v < 5 for v in vifs.values())
            ff_results[ff_id] = {
                'pair': [col_a, col_b], 'rho': float(rho), 'vif': {k: float(v) for k, v in vifs.items()},
                'status': 'PASS' if passed else 'FAIL', 'action_if_fail': action
            }
        else:
            passed = abs(rho) < threshold
            ff_results[ff_id] = {
                'pair': [col_a, col_b], 'rho': float(rho), 'threshold': threshold,
                'status': 'PASS' if passed else 'FAIL', 'action_if_fail': action
            }
    return corr_matrix, ff_results


# ----------------------------------------------------------------------------
# Main
# ----------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--input', required=True, help='PPI_SK_v2_block_table.csv from the GEE export')
    ap.add_argument('--outdir', default='out')
    ap.add_argument('--n-iter', type=int, default=500)
    args = ap.parse_args()

    os.makedirs(args.outdir, exist_ok=True)
    df = pd.read_csv(args.input)

    print(f'Loaded {len(df)} blocks.')

    print('Running Section 10 collinearity screen (FF-07..FF-11)...')
    corr_matrix, ff_results = run_collinearity_screen(df)
    corr_matrix.to_csv(os.path.join(args.outdir, 'collinearity_matrix.csv'))
    with open(os.path.join(args.outdir, 'ff_checks.json'), 'w') as f:
        json.dump(ff_results, f, indent=2)
    for ff_id, res in ff_results.items():
        print(f"  {ff_id}: {res['status']}"
              + (f" (rho={res.get('rho'):.3f})" if 'rho' in res else ''))

    print(f'Running Monte Carlo (n={args.n_iter})...')
    stability, convergence_delta = run_monte_carlo(df, n_iter=args.n_iter)
    stability.to_csv(os.path.join(args.outdir, 'stability_table.csv'), index=False)
    print(f'  FF-19 convergence delta (n/2 vs n): {convergence_delta:.4f} '
          f'({"OK" if convergence_delta < 0.02 else "increase n_iter to 1000"})')
    print(f"  Mean stability_cat12: {stability['stability_cat12'].mean():.3f}")
    print(f"  b1_sensitive blocks: {stability['b1_sensitive'].sum()} "
          f"({100 * stability['b1_sensitive'].mean():.1f}%)")

    print('Running Section 9.3 OAT sensitivity...')
    sensitivity = run_oat_sensitivity(df)
    sensitivity.to_csv(os.path.join(args.outdir, 'sensitivity_report.csv'), index=False)
    over_influential = sensitivity[sensitivity['flag_over_influential']]
    if len(over_influential):
        print('  Over-influential parameters (>15% of blocks change category on +-20%):')
        for _, row in over_influential.iterrows():
            print(f"    {row['parameter']} ({row['direction']}): "
                  f"{row['pct_blocks_category_changed']:.1f}%")
    else:
        print('  No over-influential parameters found.')

    print(f'Done. Outputs written to {args.outdir}/')


if __name__ == '__main__':
    main()
