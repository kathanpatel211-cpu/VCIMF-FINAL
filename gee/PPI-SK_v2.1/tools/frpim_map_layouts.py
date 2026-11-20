"""
FRPIM v2.2 — presentation map layouts (A3 landscape, 300 dpi PNG + vector PDF).

Makes the three maps of spec Section 13.3, each with its own legend:
  Map 1  Restoration Need Index (5 classes)
  Map 2  Restoration Feasibility Index (5 classes)
  Map 3  Restoration Priority (Phase 1-5, Protected, Excluded)

Input : the block GeoJSON exported by the GEE script (FRPIM02_blocks_<range>.geojson)
Usage : python frpim_map_layouts.py blocks.geojson OUTPUT_DIR
Needs : matplotlib, shapely, pyproj
"""
import json
import math
import sys
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import PathPatch, Rectangle, Polygon as MplPolygon, FancyBboxPatch
from matplotlib.path import Path as MplPath
from pyproj import Transformer
from shapely.geometry import shape, mapping
from shapely.ops import unary_union
import shapely

# ---------------------------------------------------------------- style
FONT = "DejaVu Sans"
plt.rcParams.update({"font.family": FONT, "pdf.fonttype": 42, "svg.fonttype": "none"})
INK = "#1f2a24"          # text
MUTED = "#55625a"
RULE = "#c9d1cb"
PAPER = "#ffffff"
MAP_BG = "#f3f5f2"       # land outside the range
TAIL_COLORS = ["#1a9850", "#bdbdbd"]          # Protected, Excluded (same on all maps, spec 13.3)

MAPS = {
    "need": {
        "number": "Map 1",
        "title": "Restoration Need Index (RNI)",
        "subtitle": "How degraded each 10 ha block is — five classes",
        "field": "need_map",
        "index": "RNI",
        "breaks": "rni_breaks",
        "palette": ["#ffffcc", "#fed976", "#fd8d3c", "#e31a1c", "#800026"],
        "classes": ["Very Low", "Low", "Moderate", "High", "Very High"],
        "explain": ("Need combines canopy deficit, bare soil at peak greenness, rainfall-corrected "
                    "NDVI decline, erosion, biomass deficit, unrecovered loss, shrub invasion and "
                    "distance to dense forest (N1-N8, 100 points)."),
        "file": "Map1_Restoration_Need_Index",
    },
    "feas": {
        "number": "Map 2",
        "title": "Restoration Feasibility Index (RFI)",
        "subtitle": "What each 10 ha block's site can support — five classes",
        "field": "feas_map",
        "index": "RFI",
        "breaks": "rfi_breaks",
        "palette": ["#8c510a", "#d8b365", "#c7eae5", "#5ab4ac", "#2166ac"],
        "classes": ["Very Low", "Low", "Moderate", "High", "Very High"],
        "explain": ("Feasibility uses inherent site properties only: moisture potential, soil, "
                    "terrain and protection risk (F1-F14, groups 35/35/18/12). Moisture and soil "
                    "are multiplied, so neither can be compensated."),
        "file": "Map2_Restoration_Feasibility_Index",
    },
    "phase": {
        "number": "Map 3",
        "title": "Restoration Priority — Phase 1 to 5",
        "subtitle": "Need class x feasibility class (5 x 5 decision matrix)",
        "field": "phase_map",
        "index": None,
        "breaks": None,
        "palette": ["#a50026", "#f46d43", "#fdae61", "#fee08b", "#ffffbf"],
        "classes": ["Phase 1", "Phase 2", "Phase 3", "Phase 4", "Phase 5"],
        "descr": ["Highest priority; first plantation season", "Next season; most blocks need SMC alongside",
                  "Third tranche of the annual target", "Fourth tranche; lower need or difficult sites",
                  "Lowest priority; mostly ANR / gap planting"],
        "explain": ("Need dominates: feasibility moves a block by one or two phases at most. "
                    "Blocks within a phase are ordered by RPS = 0.6 RNI + 0.4 RFI."),
        "file": "Map3_Restoration_Priority_Phase",
    },
}
TAIL_LABELS = ["Protected", "Excluded"]
TAIL_DESCR = ["Dense forest, canopy >= 40 % (C1)", "Water, drains, rock, built-up, cropland, slope > 45 %"]


def fmt_ha(x):
    return f"{x:,.1f}"


def nice_scale_length(map_width_m):
    target = map_width_m / 5.0
    for v in [500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000]:
        if v >= target:
            return v
    return 50000


def geom_to_patch(geom, **kw):
    """Shapely (Multi)Polygon -> one matplotlib PathPatch (holes handled)."""
    verts, codes = [], []
    polys = [geom] if geom.geom_type == "Polygon" else list(geom.geoms)
    for poly in polys:
        for ring in [poly.exterior] + list(poly.interiors):
            xy = list(ring.coords)
            verts.extend(xy)
            codes.extend([MplPath.MOVETO] + [MplPath.LINETO] * (len(xy) - 2) + [MplPath.CLOSEPOLY])
    return PathPatch(MplPath(verts, codes), **kw)


def dms(v, pos, neg):
    hemi = pos if v >= 0 else neg
    v = abs(v)
    d = int(v)
    m = round((v - d) * 60)
    if m == 60:
        d, m = d + 1, 0
    return f"{d}°{m:02d}′{hemi}"


def load(path):
    data = json.load(open(path))
    to_utm = Transformer.from_crs("EPSG:4326", "EPSG:32643", always_xy=True).transform
    blocks = []
    for f in data["features"]:
        g = shapely.transform(shape(f["geometry"]), lambda xy: __import__('numpy').column_stack(to_utm(xy[:, 0], xy[:, 1])))
        blocks.append((g, f["properties"]))
    return blocks


def area_stats(blocks, field):
    st = {c: {"n": 0, "gross": 0.0, "net": 0.0} for c in range(1, 8)}
    for _, p in blocks:
        c = int(p[field])
        st[c]["n"] += 1
        st[c]["gross"] += float(p.get("block_area_ha") or 0)
        st[c]["net"] += float(p.get("net_plantable_ha") or 0)
    return st


def class_ranges(breaks_text):
    b = [float(x) for x in breaks_text.split(",")]
    return [f"< {b[0]:.3f}", f"{b[0]:.3f} – {b[1]:.3f}", f"{b[1]:.3f} – {b[2]:.3f}",
            f"{b[2]:.3f} – {b[3]:.3f}", f">= {b[3]:.3f}"]


def draw_layout(blocks, key, meta, out_dir):
    cfg = MAPS[key]
    field = cfg["field"]
    stats = area_stats(blocks, field)
    colors = cfg["palette"] + TAIL_COLORS
    labels = cfg["classes"] + TAIL_LABELS

    W, H = 16.54, 11.69                                   # A3 landscape, inches
    fig = plt.figure(figsize=(W, H), facecolor=PAPER)

    # ---- header
    fig.text(0.030, 0.950, f"{cfg['number']}  |  {cfg['title']}", fontsize=24, fontweight="bold", color=INK, va="center")
    fig.text(0.030, 0.912, f"Khedbrahma Range, Sabarkantha Forest Division, Gujarat   ·   {cfg['subtitle']}",
             fontsize=13, color=MUTED, va="center")
    fig.text(0.970, 0.950, "FRPIM v2.2", fontsize=13, fontweight="bold", color=INK, ha="right", va="center")
    fig.text(0.970, 0.915, "Forest Restoration Priority and\nIntervention Model", fontsize=9.5, color=MUTED,
             ha="right", va="center", linespacing=1.2)
    fig.add_artist(plt.Line2D([0.030, 0.970], [0.885, 0.885], color=INK, lw=1.4))

    # ---- map frame
    ax = fig.add_axes([0.030, 0.085, 0.630, 0.785])
    ax.set_facecolor(MAP_BG)
    union = unary_union([g for g, _ in blocks])
    minx, miny, maxx, maxy = union.bounds
    pad = 0.06 * max(maxx - minx, maxy - miny)
    # keep the frame aspect = axes aspect so nothing is distorted
    fw, fh = 0.630 * W, 0.785 * H
    cx, cy = (minx + maxx) / 2, (miny + maxy) / 2
    half_w = max((maxx - minx) / 2 + pad, ((maxy - miny) / 2 + pad) * fw / fh)
    half_h = half_w * fh / fw
    ax.set_xlim(cx - half_w, cx + half_w)
    ax.set_ylim(cy - half_h, cy + half_h)
    ax.set_aspect("equal")

    for g, p in blocks:
        c = int(p[field])
        ax.add_patch(geom_to_patch(g, facecolor=colors[c - 1], edgecolor="#ffffff", linewidth=0.35, zorder=2))
    ax.add_patch(geom_to_patch(union, facecolor="none", edgecolor=INK, linewidth=1.6, zorder=4))

    # graticule (lat/long) with degree-minute labels
    to_ll = Transformer.from_crs("EPSG:32643", "EPSG:4326", always_xy=True).transform
    to_xy = Transformer.from_crs("EPSG:4326", "EPSG:32643", always_xy=True).transform
    x0, x1 = ax.get_xlim()
    y0, y1 = ax.get_ylim()
    lons = [to_ll(x, y)[0] for x in (x0, x1) for y in (y0, y1)]
    lats = [to_ll(x, y)[1] for x in (x0, x1) for y in (y0, y1)]
    step = 0.05                                           # 3 minutes
    span = max(max(lons) - min(lons), max(lats) - min(lats))
    if span > 0.6:
        step = 0.1
    if span > 1.2:
        step = 0.25
    lon_ticks = [round(math.ceil(min(lons) / step) * step + i * step, 6)
                 for i in range(int((max(lons) - min(lons)) / step) + 2)]
    lat_ticks = [round(math.ceil(min(lats) / step) * step + i * step, 6)
                 for i in range(int((max(lats) - min(lats)) / step) + 2)]
    for lo in lon_ticks:
        pts = [to_xy(lo, min(lats) + t * (max(lats) - min(lats)) / 50) for t in range(51)]
        ax.plot([q[0] for q in pts], [q[1] for q in pts], color="#9aa69e", lw=0.4, ls=(0, (4, 4)), zorder=1)
        xb = to_xy(lo, to_ll(cx, y0)[1])[0]
        if x0 < xb < x1:
            ax.text(xb, y0, dms(lo, "E", "W"), fontsize=8.5, color=MUTED, ha="center", va="top",
                    transform=ax.transData, clip_on=False).set_y(y0 - 0.008 * (y1 - y0))
    for la in lat_ticks:
        pts = [to_xy(min(lons) + t * (max(lons) - min(lons)) / 50, la) for t in range(51)]
        ax.plot([q[0] for q in pts], [q[1] for q in pts], color="#9aa69e", lw=0.4, ls=(0, (4, 4)), zorder=1)
        yb = to_xy(to_ll(x0, cy)[0], la)[1]
        if y0 < yb < y1:
            ax.text(x0 - 0.006 * (x1 - x0), yb, dms(la, "N", "S"), fontsize=8.5, color=MUTED, ha="right",
                    va="center", rotation=90, clip_on=False)
    ax.set_xticks([]); ax.set_yticks([])
    for s in ax.spines.values():
        s.set_color(INK); s.set_linewidth(1.2)

    # north arrow (top right inside the frame)
    nx, ny = x1 - 0.06 * (x1 - x0), y1 - 0.13 * (y1 - y0)
    h = 0.075 * (y1 - y0); w = h * 0.45
    ax.add_patch(MplPolygon([(nx, ny + h), (nx - w / 2, ny), (nx, ny + h * 0.28)], closed=True,
                            facecolor=INK, edgecolor=INK, lw=0.8, zorder=6))
    ax.add_patch(MplPolygon([(nx, ny + h), (nx + w / 2, ny), (nx, ny + h * 0.28)], closed=True,
                            facecolor="#ffffff", edgecolor=INK, lw=0.8, zorder=6))
    ax.text(nx, ny + h * 1.08, "N", fontsize=16, fontweight="bold", color=INK, ha="center", va="bottom", zorder=6)

    # scale bar (bottom left inside the frame), true metres in UTM 43N
    L = nice_scale_length(x1 - x0)
    sx, sy = x0 + 0.04 * (x1 - x0), y0 + 0.05 * (y1 - y0)
    bh = 0.012 * (y1 - y0)
    ax.add_patch(Rectangle((sx - 0.012 * (x1 - x0), sy - 2.6 * bh), L + 0.035 * (x1 - x0), 5.4 * bh,
                           facecolor="#ffffff", edgecolor="none", alpha=0.85, zorder=5))
    for i in range(4):
        ax.add_patch(Rectangle((sx + i * L / 4, sy), L / 4, bh, facecolor=INK if i % 2 == 0 else "#ffffff",
                               edgecolor=INK, lw=0.8, zorder=6))
    for i, t in enumerate([0, L / 4, L / 2, 3 * L / 4, L]):
        lab = f"{t / 1000:g}"
        ax.text(sx + t, sy + bh * 1.5, lab, fontsize=8.5, color=INK, ha="center", va="bottom", zorder=6)
    ax.text(sx + L / 2, sy - bh * 0.9, "kilometres", fontsize=8.5, color=MUTED, ha="center", va="top", zorder=6)

    # ---- right panel: legend table, bar chart, notes (top-down flow)
    import textwrap
    lx, rx = 0.685, 0.970
    cN, cG, cH = 0.862, 0.917, rx                     # right edges of number columns
    y = 0.852
    fig.text(lx, y, "Legend", fontsize=15, fontweight="bold", color=INK, va="center")
    y -= 0.034
    fig.text(lx + 0.034, y, "Class", fontsize=9, color=MUTED, va="center")
    for xc, t in ((cN, "Blocks"), (cG, "Gross ha"), (cH, "Net ha")):
        fig.text(xc, y, t, fontsize=9, color=MUTED, va="center", ha="right")
    y -= 0.014
    fig.add_artist(plt.Line2D([lx, rx], [y, y], color=RULE, lw=0.8))
    ranges = class_ranges(meta[cfg["breaks"]]) if cfg["breaks"] else None
    descr = cfg.get("descr")
    row_h = 0.043
    y -= row_h / 2 + 0.004
    for c in range(1, 8):
        fig.patches.append(FancyBboxPatch((lx, y - 0.0135), 0.024, 0.027, boxstyle="round,pad=0,rounding_size=0.002",
                                          transform=fig.transFigure, facecolor=colors[c - 1],
                                          edgecolor="#6b756e", lw=0.6))
        if c <= 5:
            name = labels[c - 1]
            sub = (f"{cfg['index']} {ranges[c - 1]}" if ranges else descr[c - 1])
        else:
            name, sub = TAIL_LABELS[c - 6], TAIL_DESCR[c - 6]
        fig.text(lx + 0.034, y + 0.0065, name, fontsize=10.5, fontweight="bold", color=INK, va="center")
        fig.text(lx + 0.034, y - 0.0095, sub, fontsize=8.2, color=MUTED, va="center")
        s_ = stats[c]
        ny = y + 0.0065                               # numbers on the class-name line
        fig.text(cN, ny, f"{s_['n']}", fontsize=10, color=INK, va="center", ha="right")
        fig.text(cG, ny, fmt_ha(s_["gross"]), fontsize=10, color=INK, va="center", ha="right")
        fig.text(cH, ny, fmt_ha(s_["net"]) if c <= 5 else "0.0", fontsize=10, color=INK, va="center", ha="right")
        y -= row_h
    tot_n = sum(stats[c]["n"] for c in stats)
    tot_g = sum(stats[c]["gross"] for c in stats)
    tot_net = sum(stats[c]["net"] for c in range(1, 6))
    y += row_h / 2 - 0.002
    fig.add_artist(plt.Line2D([lx, rx], [y, y], color=INK, lw=0.9))
    y -= 0.018
    fig.text(lx + 0.034, y, "Total", fontsize=10.5, fontweight="bold", color=INK, va="center")
    fig.text(cN, y, f"{tot_n}", fontsize=10, fontweight="bold", color=INK, va="center", ha="right")
    fig.text(cG, y, fmt_ha(tot_g), fontsize=10, fontweight="bold", color=INK, va="center", ha="right")
    fig.text(cH, y, fmt_ha(tot_net), fontsize=10, fontweight="bold", color=INK, va="center", ha="right")
    inside = sum(float(p["block_area_ha"]) - float(p["net_plantable_ha"]) for _, p in blocks if int(p["excluded"]) == 0)
    y -= 0.020
    fig.text(lx + 0.034, y, f"Blocks >= 2 ha. Constrained land inside retained blocks: {fmt_ha(inside)} ha.",
             fontsize=7.8, color=MUTED, va="center")

    # bar chart: net plantable hectares by class
    y -= 0.030
    bh_fig = 0.105
    bax = fig.add_axes([lx + 0.034, y - bh_fig, rx - lx - 0.034, bh_fig])
    vals = [stats[c]["net"] for c in range(1, 6)]
    names = labels[:5]
    bax.barh(range(5), vals, color=colors[:5], edgecolor="#6b756e", linewidth=0.5, height=0.68)
    bax.invert_yaxis()
    bax.set_yticks(range(5)); bax.set_yticklabels(names, fontsize=8.5, color=INK)
    vmax = max(vals) or 1
    for k, v in enumerate(vals):
        bax.text(v + vmax * 0.015, k, f"{v:,.0f} ha", va="center", fontsize=8.2, color=INK)
    bax.set_xlim(0, vmax * 1.22)
    bax.tick_params(axis="x", labelsize=7.5, colors=MUTED, length=2)
    bax.tick_params(axis="y", length=0)
    for sp in ("top", "right"):
        bax.spines[sp].set_visible(False)
    for sp in ("left", "bottom"):
        bax.spines[sp].set_color(RULE)
    bax.set_title("Net plantable area by class (ha)", fontsize=9.5, color=INK, loc="left", pad=4, fontweight="bold")
    y -= bh_fig + 0.032

    # about this map
    fig.add_artist(plt.Line2D([lx, rx], [y + 0.012, y + 0.012], color=RULE, lw=0.8))
    fig.text(lx, y, "About this map", fontsize=10.5, fontweight="bold", color=INK, va="top")
    method = ("Class breaks are the 20th, 40th, 60th and 80th percentiles (quintiles) of the 690 retained blocks, "
              "so each class holds about 20 % of them."
              if meta.get("class_method") == "quantile" else "Class breaks are equal 0.2 intervals.")
    body = cfg["explain"] + (" " + method if cfg["breaks"] else "")
    wrapped = textwrap.fill(body, 78)
    fig.text(lx, y - 0.022, wrapped, fontsize=8.2, color=INK, va="top", linespacing=1.32)
    y -= 0.022 + 0.0145 * (wrapped.count("\n") + 1) + 0.016

    # map information
    info = [
        ("Unit", "10 ha blocks (316.23 m squares)"),
        ("Projection", "WGS 84 / UTM zone 43N (EPSG:32643)"),
        ("Scoring scale", f"{meta.get('anchor_id', '-')}"),
        ("Data", "Sentinel-2, Landsat 5-9, FABDEM, MERIT Hydro, SoilGrids 2.0, Meta canopy height, Hansen GFC, "
                 "ESA WorldCover, Dynamic World, CHIRPS, MODIS, VIIRS (Google Earth Engine)"),
    ]
    for k, v in info:
        txt = textwrap.fill(v, 60)
        fig.text(lx, y, k, fontsize=8, fontweight="bold", color=INK, va="top")
        fig.text(lx + 0.068, y, txt, fontsize=8, color=INK, va="top", linespacing=1.3)
        y -= 0.0145 * (txt.count("\n") + 1) + 0.004

    # ---- footer
    fig.add_artist(plt.Line2D([0.030, 0.970], [0.055, 0.055], color=RULE, lw=0.8))
    fig.text(0.030, 0.035, "Model and maps: FRPIM v2.2 in Google Earth Engine (run " + str(meta.get("run_date", "-")) +
             "). Area figures are true hectares measured on the block polygons. Rights, encroachment and legal "
             "status are verified by field staff before any block enters an estimate.", fontsize=8, color=MUTED, va="center")
    # guard: the right panel must end above the footer rule
    assert y > 0.062, f"right panel overflows into the footer (y={y:.3f})"

    out_dir.mkdir(parents=True, exist_ok=True)
    base = out_dir / f"FRPIM_v2.2_Khedbrahma_{cfg['file']}"
    fig.savefig(str(base) + ".png", dpi=300, facecolor=PAPER)
    fig.savefig(str(base) + ".pdf", facecolor=PAPER)
    plt.close(fig)
    return base, stats


def main():
    src, out = Path(sys.argv[1]), Path(sys.argv[2])
    blocks = load(src)
    retained = [p for _, p in blocks if int(p["excluded"]) == 0]
    meta = {k: retained[0].get(k) for k in ("rni_breaks", "rfi_breaks", "class_method", "anchor_id", "run_date")}
    for key in ("need", "feas", "phase"):
        base, stats = draw_layout(blocks, key, meta, out)
        print(base.name, {c: (s["n"], round(s["gross"], 1), round(s["net"], 1)) for c, s in stats.items()})


if __name__ == "__main__":
    main()
