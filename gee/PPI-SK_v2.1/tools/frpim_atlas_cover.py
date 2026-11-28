"""
FRPIM atlas covers: A3 portrait, deep colour gradient, the area drawn as a 3D field of pixel columns
(one column per 10 ha block, height = priority) with pixels lifting off the highest-priority blocks.

Usage : python frpim_atlas_cover.py SCORED_BLOCKS.geojson OUT_DIR --fonts FONT_DIR [cover options, see COVERS]
Output: OUT_DIR/cover_part1.pdf ... cover_part4.pdf and cover_full.pdf (same as part 1)
"""
import json
import sys
from pathlib import Path

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.collections import PolyCollection
from matplotlib.colors import to_rgb, LinearSegmentedColormap

sys.path.insert(0, str(Path(__file__).resolve().parent))
import frpim_atlas as FA                # noqa: E402  fonts, loader, T()
import frpim_layer_atlas as LA          # noqa: E402

W, H = FA.W, FA.H
CELL = 316.23

PHASE = ["#d7263d", "#f46036", "#fbb13c", "#ffe066", "#fff6c2", "#2bb673", "#6f7f76"]
NEED = ["#fff3b0", "#fcc45c", "#f9844a", "#e63946", "#9d0208"]
FEAS = ["#a0522d", "#e0b36a", "#d9f0e3", "#56c1a7", "#1f78c8"]
RX = {c[0]: c[2] for c in next(l for l in LA.LAYERS if l["code"] == "G6")["classes"]}
RX.update({"SMC_DROUGHT_HARDY": "#f08a24", "BLANK_AREA_PLANTATION": "#2ec4a0", "ANR_GAP_PLANTING": "#8f7cf0",
           "PROTECT_DENSE": "#1f8a4c", "NOT_PLANTABLE": "#5d6b63"})


def phase_style(p):
    c = int(p["phase_map"])
    return PHASE[c - 1], {1: 1.0, 2: 0.78, 3: 0.56, 4: 0.38, 5: 0.24, 6: 0.30, 7: 0.03}[c]


def need_style(p):
    if int(p["excluded"]):
        return "#5d6b63", 0.03
    k = int(p["need_map"]) - 1
    return NEED[k], 0.12 + 0.88 * float(p["RNI"]) ** 2 / 0.75 ** 2 if float(p["RNI"]) < 0.75 else 1.0


def feas_style(p):
    if int(p["excluded"]):
        return "#5d6b63", 0.03
    k = int(p["feas_map"]) - 1
    return FEAS[k], 0.10 + 0.90 * min(1.0, max(0.0, (float(p["RFI"]) - 0.35) / 0.35))


def rx_style(p):
    return RX.get(p["intervention"], "#8a8a8a"), (0.03 if int(p["excluded"]) else 0.15 + 0.85 * float(p.get("stability_p12") or 0) * (
        1 if int(p["phase_code"] or 9) <= 2 else 0.5))


COVERS = [
    dict(key="part1", num="01", style=phase_style, part="Results and range maps",
         lead="The three decision maps for the whole sub-division and for each of its four ranges.",
         grad=["#03140d", "#0b3a26", "#12573a"], glow="#f46036",
         legend=[(PHASE[0], "Phase 1"), (PHASE[1], "Phase 2"), (PHASE[2], "Phase 3"), (PHASE[3], "Phase 4"),
                 (PHASE[4], "Phase 5"), (PHASE[5], "Protected"), (PHASE[6], "Excluded")],
         legend_title="Column colour: priority phase  ·  height: priority"),
    dict(key="part2", num="02", style=need_style, part="Vegetation, degradation and moisture",
         lead="What grows on the land, how it has declined, and how long it stays moist: sections A, B and C.",
         grad=["#140606", "#3d1410", "#6a2a14"], glow="#f9844a",
         legend=[(NEED[0], "Very low"), (NEED[1], "Low"), (NEED[2], "Moderate"), (NEED[3], "High"), (NEED[4], "Very high")],
         legend_title="Column colour: restoration need (RNI)  ·  height: need"),
    dict(key="part3", num="03", style=feas_style, part="Terrain, soil and pressure",
         lead="Slope, landscape position, soil and the pressure of people and roads on each block: sections D, E and F.",
         grad=["#030d17", "#0b2a40", "#134a63"], glow="#56c1a7",
         legend=[(FEAS[0], "Very low"), (FEAS[1], "Low"), (FEAS[2], "Moderate"), (FEAS[3], "High"), (FEAS[4], "Very high")],
         legend_title="Column colour: restoration feasibility (RFI)  ·  height: feasibility"),
    dict(key="part4", num="04", style=rx_style, part="Model outputs, scores and methods",
         lead="Group scores, reliability, treatments, species and SMC, every indicator score, and how the model works.",
         grad=["#0b0716", "#21183f", "#36296a"], glow="#8f7cf0",
         legend=[(RX["BLANK_AREA_PLANTATION"], "Blank-area plantation"), (RX["SMC_DROUGHT_HARDY"], "SMC + drought-hardy"),
                 (RX["ANR_GAP_PLANTING"], "ANR + gap planting"), (RX["SOIL_STABILISATION_FIRST"], "Soil stabilisation first"),
                 (RX["PROTECT_DENSE"], "Protect dense forest"), (RX["NOT_PLANTABLE"], "Not plantable")],
         legend_title="Column colour: recommended treatment  ·  height: reliability of priority"),
]


# ------------------------------------------------------------------ 3D projection
class Proj:
    def __init__(self, pts, theta_deg=-28, tilt=0.58, zscale=1.0):
        self.c = pts.mean(axis=0)
        t = np.radians(theta_deg)
        self.R = np.array([[np.cos(t), -np.sin(t)], [np.sin(t), np.cos(t)]])
        self.tilt, self.zs = tilt, zscale

    def xy(self, P, z=0.0):
        q = (np.asarray(P) - self.c) @ self.R.T / 1000.0
        return np.column_stack([q[:, 0], q[:, 1] * self.tilt + z * self.zs])

    def depth(self, P):
        return ((np.asarray(P) - self.c) @ self.R.T)[:, 1]


def shade(col, f):
    r, g, b = to_rgb(col)
    return (r * f, g * f, b * f)


def column_polys(proj, cx, cy, half, h, col, alpha=1.0):
    """Faces of one square column (base z=0 .. top z=h): visible sides then top."""
    sq = np.array([[cx - half, cy - half], [cx + half, cy - half], [cx + half, cy + half], [cx - half, cy + half]])
    base, top = proj.xy(sq, 0.0), proj.xy(sq, h)
    polys, cols = [], []
    if h > 0.01:
        dep = proj.depth(sq)
        for i in range(4):
            j = (i + 1) % 4
            mid = (dep[i] + dep[j]) / 2
            if mid < proj.depth(np.array([[cx, cy]]))[0]:          # edge on the viewer's side
                ex = base[j, 0] - base[i, 0]
                f = 0.62 if ex > 0 else 0.80
                polys.append([base[i], base[j], top[j], top[i]])
                cols.append(shade(col, f) + (alpha,))
    polys.append(list(top))
    cols.append(to_rgb(col) + (alpha,))
    return polys, cols


def gradient_bg(fig, stops, glow, gx=0.66, gy=0.40):
    ny, nx = 900, 640
    yy, xx = np.mgrid[0:1:ny * 1j, 0:1:nx * 1j]
    cmap = LinearSegmentedColormap.from_list("g", stops[::-1])
    t = (0.75 * yy + 0.25 * (1 - xx))
    img = cmap(t)[:, :, :3]
    d = np.sqrt(((xx - gx) * W / H) ** 2 + (yy - gy) ** 2)
    g = np.exp(-(d / 0.32) ** 2)[:, :, None] * 0.30
    img = img * (1 - g) + np.array(to_rgb(glow)) * g
    vign = 1 - 0.35 * np.clip(np.sqrt((xx - 0.5) ** 2 + (yy - 0.5) ** 2) * 1.4 - 0.3, 0, 1)[:, :, None]
    img = np.clip(img * vign, 0, 1)
    ax = fig.add_axes([0, 0, 1, 1], zorder=-10)
    ax.imshow(img, extent=[0, 1, 0, 1], origin="lower", aspect="auto", interpolation="bicubic")
    ax.set_axis_off()
    # fine diagonal hairlines for texture
    for k in np.linspace(-1, 1.4, 34):
        fig.add_artist(plt.Line2D([k, k + 0.6], [0, 1], color="white", alpha=0.025, lw=0.6))


def draw_field(fig, rect, blocks, style, glow, seed=7):
    pts = np.array([[g.centroid.x, g.centroid.y] for g, _ in blocks])
    proj = Proj(pts)
    hmax = 2.6                                        # km at full height (vertical exaggeration)
    order = np.argsort(-proj.depth(pts))              # far -> near
    polys, cols = [], []
    shadow = []
    for i in order:
        g, p = blocks[i]
        col, hv = style(p)
        a = float(p.get("block_area_ha") or 10)
        half = CELL / 2 * min(1.0, np.sqrt(a / 10.0)) * 0.86
        cx, cy = pts[i]
        h = hmax * hv
        ps, cs = column_polys(proj, cx, cy, half, h, col)
        polys += ps; cols += cs
        sq = np.array([[cx - half, cy - half], [cx + half, cy - half], [cx + half, cy + half], [cx - half, cy + half]])
        shadow.append(proj.xy(sq) + np.array([0.35 + h * 0.35, -0.25 - h * 0.12]))
    ax = fig.add_axes(rect)
    ax.set_axis_off()
    sh = PolyCollection(shadow, facecolors=(0, 0, 0, 0.30), edgecolors="none")
    sh.set_rasterized(True); ax.add_collection(sh)
    pc = PolyCollection(polys, facecolors=cols, edgecolors=[(0, 0, 0, 0.18)] * len(cols), linewidths=0.08)
    pc.set_rasterized(True); ax.add_collection(pc)
    # floating pixels above the tallest columns
    rng = np.random.default_rng(seed)
    hv_all = np.array([style(p)[1] for _, p in blocks])
    top = np.argsort(-hv_all)[:400]
    pick = rng.choice(top, size=46, replace=False)
    fl_p, fl_c = [], []
    items = []
    for i in pick:
        col, hv = style(blocks[i][1])
        base = hmax * hv
        n = rng.integers(1, 4)
        for j in range(n):
            s = CELL / 2 * 0.86 * rng.uniform(1.4, 3.2) * (0.70 ** j)
            z0 = base + 1.2 + j * 2.4 + rng.uniform(0, 2.5)
            items.append((proj.depth(pts[i:i + 1])[0], z0, i, s, col, 0.95 - 0.22 * j))
    for dep, z0, i, s, col, al in sorted(items, key=lambda t: (-t[0], t[1])):
        cx, cy = pts[i]
        sq = np.array([[cx - s, cy - s], [cx + s, cy - s], [cx + s, cy + s], [cx - s, cy + s]])
        base, topf = proj.xy(sq, z0), proj.xy(sq, z0 + 2 * s / 1000)
        d = proj.depth(sq); dc = proj.depth(np.array([[cx, cy]]))[0]
        for a_ in range(4):
            b_ = (a_ + 1) % 4
            if (d[a_] + d[b_]) / 2 < dc:
                f = 0.62 if base[b_, 0] - base[a_, 0] > 0 else 0.80
                fl_p.append([base[a_], base[b_], topf[b_], topf[a_]]); fl_c.append(shade(col, f) + (al,))
        fl_p.append(list(topf)); fl_c.append(to_rgb(col) + (al,))
    fc = PolyCollection(fl_p, facecolors=fl_c, edgecolors=[(1, 1, 1, 0.35)] * len(fl_c), linewidths=0.3)
    fc.set_rasterized(True); ax.add_collection(fc)
    allp = np.vstack([np.array(q) for q in polys])
    x0, y0 = allp.min(axis=0); x1, y1 = allp.max(axis=0)
    fw, fh = rect[2] * W, rect[3] * H
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2 + 2
    hw = max((x1 - x0) / 2, (y1 - y0) / 2 * fw / fh) * 1.04
    ax.set_xlim(cx - hw, cx + hw); ax.set_ylim(cy - hw * fh / fw, cy + hw * fh / fw)
    ax.set_aspect("equal")
    return ax


def make_cover(blocks, cfg, opt, stats, out):
    fig = plt.figure(figsize=(W, H))
    gradient_bg(fig, cfg["grad"], cfg["glow"])
    draw_field(fig, [0.0, 0.07, 1.0, 0.60], blocks, cfg["style"], cfg["glow"])
    T, S = FA.T, FA.SERIF
    soft, gold = "#cfe2d6", "#f6c46a"
    T(fig, 0.07, 0.950, opt["kicker"].upper(), 9.5, gold, "bold")
    fig.add_artist(plt.Line2D([0.07, 0.93], [0.938, 0.938], color="white", alpha=0.18, lw=0.8))
    # part number, outlined
    import matplotlib.patheffects as pe
    T(fig, 0.93, 0.905, cfg["num"], 92, cfg["glow"], "bold", family=S, ha="right", va="top", alpha=0.9)
    T(fig, 0.93, 0.800, "PART " + cfg["num"][-1] + " OF 4", 9, cfg["glow"], "bold", ha="right")
    T(fig, 0.07, 0.885, opt["name"], 52, "white", "bold", family=S, va="center")
    light = tuple(0.45 * a + 0.55 for a in to_rgb(cfg["glow"]))
    T(fig, 0.07, 0.830, "Restoration Atlas", 52, light, "bold", family=S, va="center")
    fig.add_artist(plt.Line2D([0.07, 0.13], [0.790, 0.790], color=cfg["glow"], lw=3))
    T(fig, 0.07, 0.770, cfg["part"], 19, "white", "semibold", family=S, va="center")
    T(fig, 0.07, 0.745, cfg["lead"], 10.5, soft, va="center")
    # stats strip
    x = 0.07
    for v, l in stats:
        T(fig, x, 0.700, v, 20, "white", "bold", family=S, va="center")
        T(fig, x, 0.680, l, 8.5, soft, va="center", alpha=0.85)
        x += 0.17
    # legend (bottom left)
    y = 0.615
    T(fig, 0.07, y + 0.022, cfg["legend_title"], 8.5, soft, "semibold")
    for k, (c, l) in enumerate(cfg["legend"]):
        yy = y - k * 0.017
        fig.patches.append(plt.Rectangle((0.07, yy - 0.004), 0.012, 0.0085, transform=fig.transFigure, facecolor=c,
                                         edgecolor="white", lw=0.3))
        T(fig, 0.088, yy, l, 8.5, "white", va="center")
    T(fig, 0.07, 0.055, opt["tagline"], 15, gold, "semibold", family=S, va="center")
    T(fig, 0.07, 0.033, opt["subtitle"] + "  ·  " + opt["date"], 8.5, soft, va="center", alpha=0.8)
    T(fig, 0.93, 0.033, "FRPIM v2.2  ·  Forest Restoration Priority and Intervention Model", 8.5, soft, ha="right",
      va="center", alpha=0.8)
    fig.savefig(str(out), dpi=260)
    plt.close(fig)


def main():
    args = sys.argv[1:]
    opt = {"fonts": None, "name": "Forest", "kicker": "", "subtitle": "", "tagline": "", "date": "", "range_field": "range",
           "only": ""}
    for k in ("fonts", "name", "kicker", "subtitle", "tagline", "date", "range-field", "only"):
        if "--" + k in args:
            i = args.index("--" + k); opt[k.replace("-", "_")] = args[i + 1]; del args[i:i + 2]
    src, out = Path(args[0]), Path(args[1])
    out.mkdir(parents=True, exist_ok=True)
    FA.setup_fonts(opt["fonts"])
    blocks, _, ranges = FA.load(src, opt["range_field"])
    P = [p for _, p in blocks]
    ret = [p for p in P if int(p["excluded"]) == 0]
    stats = [(f"{sum(float(p.get('block_area_ha') or 0) for p in P):,.0f}", "ha of forest mapped"),
             (f"{len(P):,}", "blocks of 10 ha"),
             (f"{sum(float(p['net_plantable_ha']) for p in ret):,.0f}", "ha net plantable"),
             (f"{sum(float(p['net_plantable_ha']) for p in ret if int(p['phase_code']) in (1, 2)):,.0f}", "ha in Phase 1-2"),
             (str(len(ranges)), "ranges")]
    for cfg in COVERS:
        if opt["only"] and cfg["key"] not in opt["only"].split(","):
            continue
        make_cover(blocks, cfg, opt, stats, out / f"cover_{cfg['key']}.pdf")
        print("cover", cfg["key"])


if __name__ == "__main__":
    main()
