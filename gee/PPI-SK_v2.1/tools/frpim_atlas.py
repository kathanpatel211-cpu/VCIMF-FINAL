"""
FRPIM v2.2 — Restoration Atlas (A3 portrait, print quality), for a range, sub-division or division.

Pages: cover, contents, at-a-glance, the three decision maps for the whole area and zoomed to every range,
section openers, one page per input / intermediate layer (sections A-G of frpim_layer_atlas.LAYERS),
indicator score summaries, and a methods page. Each map page: the map at full page height on the left;
legend, hectares, bar chart, a range-by-range comparison and notes in the right column.

Usage : python frpim_atlas.py SCORED_BLOCKS.geojson OUT_DIR --title "Sub-division 2" --place "..."
                 --prefix NAME --fonts FONT_DIR [--range-field range] [--date "November 2026"]
Needs : matplotlib, shapely, pyproj, numpy, pymupdf; Inter and Sora TTF files in FONT_DIR (optional)
"""
import json
import math
import sys
import textwrap
from collections import defaultdict, OrderedDict
from pathlib import Path

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib import font_manager
from matplotlib.collections import PathCollection
from matplotlib.patches import PathPatch, Rectangle, Polygon as MplPolygon, FancyBboxPatch
from matplotlib.path import Path as MPath
import matplotlib.patheffects as pe
import shapely
from shapely.geometry import shape, Polygon
from shapely.geometry.polygon import orient
from shapely.ops import unary_union
from pyproj import Transformer

sys.path.insert(0, str(Path(__file__).resolve().parent))
import frpim_layer_atlas as LA          # noqa: E402  (layer definitions, texts and class rules)
import frpim_map_layouts as ML          # noqa: E402  (Map 1-3 definitions)

# ------------------------------------------------------------------ design tokens
W, H = 11.69, 16.54                     # A3 portrait, inches
FOREST, CANOPY, OCHRE = "#0f3d2a", "#1d6b47", "#c8860a"
INK, MUTED, RULE, SOFT, PAPER, MAPBG = "#16211a", "#5b6b60", "#d5ddd6", "#eef3ee", "#ffffff", "#f3f5f1"
NODATA = "#e4e4e4"
SERIF = "Sora"; SANS = "Inter"
ML_X0, ML_X1 = 0.50 / W, 6.95 / W        # map frame (fractions of page)
MAP_Y0, MAP_Y1 = 0.80 / H, (H - 1.85) / H
RX0, RX1 = 7.30 / W, (W - 0.50) / W      # right column
TO_UTM = Transformer.from_crs(4326, 32643, always_xy=True).transform
TO_LL = Transformer.from_crs(32643, 4326, always_xy=True).transform


def setup_fonts(font_dir):
    global SERIF, SANS
    if font_dir and Path(font_dir).exists():
        for f in Path(font_dir).glob("*.ttf"):
            font_manager.fontManager.addfont(str(f))
    names = {f.name for f in font_manager.fontManager.ttflist}
    SERIF = "Sora" if "Sora" in names else "DejaVu Sans"
    SANS = "Inter" if "Inter" in names else "DejaVu Sans"
    plt.rcParams.update({"font.family": SANS, "pdf.fonttype": 42, "svg.fonttype": "none"})


def T(fig, x, y, s, size=10, color=INK, weight="normal", family=None, **kw):
    return fig.text(x, y, s, fontsize=size, color=color, fontweight=weight, family=family or SANS, **kw)


# ------------------------------------------------------------------ data
def load(path, range_field):
    data = json.load(open(path))
    blocks = []
    for f in data["features"]:
        g = shape(f["geometry"])
        if g.geom_type == "GeometryCollection":
            parts = [x for x in g.geoms if x.geom_type in ("Polygon", "MultiPolygon")]
            g = unary_union(parts) if parts else None
        if g is None or g.is_empty:
            continue
        g = shapely.transform(g, lambda xy: np.column_stack(TO_UTM(xy[:, 0], xy[:, 1])))
        blocks.append((g, f["properties"]))
    paths = [path_of(g) for g, _ in blocks]
    ranges = OrderedDict()
    if range_field:
        for i, (_, p) in enumerate(blocks):
            ranges.setdefault(p.get(range_field) or "-", []).append(i)
    return blocks, paths, ranges


def path_of(g):
    polys = [g] if g.geom_type == "Polygon" else [q for q in g.geoms if q.geom_type == "Polygon"]
    verts, codes = [], []
    for q in polys:
        q = orient(q, 1.0)
        for r in [q.exterior] + list(q.interiors):
            xy = list(r.coords)
            verts.extend(xy); codes.extend([MPath.MOVETO] + [MPath.LINETO] * (len(xy) - 2) + [MPath.CLOSEPOLY])
    return MPath(verts, codes)


def patch_of(g, **kw):
    return PathPatch(path_of(g), **kw)


def outer(g, smooth):
    if smooth:
        g = g.buffer(smooth).buffer(-smooth)
    polys = [g] if g.geom_type == "Polygon" else [q for q in getattr(g, "geoms", []) if q.geom_type == "Polygon"]
    return unary_union([Polygon(q.exterior) for q in polys if not q.is_empty])


# ------------------------------------------------------------------ page furniture
class Atlas:
    def __init__(self, blocks, paths, ranges, opt):
        self.blocks, self.paths, self.ranges, self.opt = blocks, paths, ranges, opt
        self.union = unary_union([g for g, _ in blocks])
        self.edge = outer(self.union, 80).simplify(20)
        self.range_geom = OrderedDict((r, outer(unary_union([blocks[i][0] for i in idx]), 150).simplify(25))
                                      for r, idx in ranges.items())
        self.pages = []                   # (kind, payload) in order; numbered at render time
        self.toc = []                     # (section, title, page)

    # -- header / footer
    def header(self, fig, section, code, title, sub, page):
        fig.patches.append(Rectangle((0, 1 - 0.34 / H), 1, 0.34 / H, transform=fig.transFigure, facecolor=FOREST, zorder=0))
        T(fig, 0.50 / W, 1 - 0.17 / H, (self.opt["name"] + " Restoration Atlas  ·  " + self.opt["title"]).upper(), 8.5, "#d8e8dc", "semibold", va="center")
        T(fig, 1 - 0.50 / W, 1 - 0.17 / H, "FRPIM v2.2  ·  " + self.opt["date"], 8.5, "#d8e8dc", ha="right", va="center")
        y = 1 - 0.68 / H
        if section:
            T(fig, 0.50 / W, y, section.upper(), 9, OCHRE, "bold", va="center")
        y -= 0.40 / H
        if code:
            fig.patches.append(FancyBboxPatch((0.50 / W, y - 0.17 / H), 0.62 / W, 0.36 / H, boxstyle="round,pad=0,rounding_size=0.006",
                                              transform=fig.transFigure, facecolor=CANOPY, edgecolor="none"))
            T(fig, 0.81 / W, y + 0.01 / H, code, 12, "white", "bold", family=SERIF, ha="center", va="center")
            tx = 1.28 / W
        else:
            tx = 0.50 / W
        T(fig, tx, y, title, 21 if len(title) < 48 else 17, INK, "bold", family=SERIF, va="center")
        T(fig, tx, y - 0.36 / H, sub, 11, MUTED, va="center")
        fig.add_artist(plt.Line2D([0.50 / W, 1 - 0.50 / W], [1 - 1.66 / H] * 2, color=INK, lw=1.0))
        self.footer(fig, page)

    def footer(self, fig, page, dark=False):
        c = "#9fb8a8" if dark else MUTED
        fig.add_artist(plt.Line2D([0.50 / W, 1 - 0.50 / W], [0.48 / H] * 2, color="#2c4a3a" if dark else RULE, lw=0.8))
        T(fig, 0.50 / W, 0.30 / H, self.opt["place"] + "  ·  FRPIM v2.2 decision support: the final decision rests with the ACF and the DCF",
          7.5, c, va="center")
        T(fig, 1 - 0.50 / W, 0.30 / H, str(page), 10, c, "bold", ha="right", va="center")

    # -- map frame
    def frame(self, fig, rect, extent, pad=0.04):
        ax = fig.add_axes(rect)
        ax.set_facecolor(MAPBG)
        x0, y0, x1, y1 = extent
        fw, fh = rect[2] * W, rect[3] * H
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        p = pad * max(x1 - x0, y1 - y0)
        hw = max((x1 - x0) / 2 + p, ((y1 - y0) / 2 + p) * fw / fh)
        hh = hw * fh / fw
        ax.set_xlim(cx - hw, cx + hw); ax.set_ylim(cy - hh, cy + hh); ax.set_aspect("equal")
        ax.set_xticks([]); ax.set_yticks([])
        for s in ax.spines.values():
            s.set_color(INK); s.set_linewidth(0.9)
        return ax

    def draw_blocks(self, ax, colors, idx=None, faded=None):
        if faded is not None:
            pc = PathCollection([self.paths[i] for i in faded], facecolors="#dfe5df", edgecolors="none", zorder=1)
            pc.set_rasterized(True); ax.add_collection(pc)
        sel = range(len(self.paths)) if idx is None else idx
        pc = PathCollection([self.paths[i] for i in sel], facecolors=[colors[i] for i in sel],
                            edgecolors=[colors[i] for i in sel], linewidths=0.15, zorder=2)
        pc.set_rasterized(True)
        ax.add_collection(pc)

    def overlays(self, ax, focus=None, small=False):
        ax.add_patch(PathPatch(path_of(self.edge), facecolor="none", edgecolor=INK, linewidth=0.5, zorder=4))
        for r, g in self.range_geom.items():
            on = focus is None or r == focus
            ax.add_patch(PathPatch(path_of(g), facecolor="none", edgecolor="#1f2a24" if on else "#9aa69e",
                                   linewidth=1.1 if on else 0.6, linestyle=(0, (5, 2)), zorder=5))
            if small or (focus is not None and r != focus):
                continue
            big = max(g.geoms, key=lambda q: q.area) if g.geom_type == "MultiPolygon" else g
            pt = big.representative_point()
            ax.text(pt.x, pt.y, r, fontsize=12 if focus is None else 14, fontweight="bold", family=SERIF, color=INK, ha="center",
                    va="center", zorder=9, path_effects=[pe.withStroke(linewidth=4, foreground="white")])

    def furniture(self, ax, small=False):
        x0, x1 = ax.get_xlim(); y0, y1 = ax.get_ylim()
        if not small:
            lons = [TO_LL(x, y)[0] for x in (x0, x1) for y in (y0, y1)]
            lats = [TO_LL(x, y)[1] for x in (x0, x1) for y in (y0, y1)]
            span = max(max(lons) - min(lons), max(lats) - min(lats))
            step = 0.05 if span <= 0.5 else (0.1 if span <= 1.2 else 0.25)
            for lo in np.arange(math.ceil(min(lons) / step) * step, max(lons), step):
                pts = [TO_UTM(lo, min(lats) + t * (max(lats) - min(lats)) / 60) for t in range(61)]
                ax.plot([q[0] for q in pts], [q[1] for q in pts], color="#aab5ad", lw=0.35, ls=(0, (3, 4)), zorder=6)
                xb = TO_UTM(lo, TO_LL((x0 + x1) / 2, y0)[1])[0]
                if x0 < xb < x1:
                    ax.text(xb, y0 - 0.006 * (y1 - y0), ML.dms(lo, "E", "W"), fontsize=7.5, color=MUTED, ha="center", va="top", clip_on=False)
            for la in np.arange(math.ceil(min(lats) / step) * step, max(lats), step):
                pts = [TO_UTM(min(lons) + t * (max(lons) - min(lons)) / 60, la) for t in range(61)]
                ax.plot([q[0] for q in pts], [q[1] for q in pts], color="#aab5ad", lw=0.35, ls=(0, (3, 4)), zorder=6)
                yb = TO_UTM(TO_LL(x0, (y0 + y1) / 2)[0], la)[1]
                if y0 < yb < y1:
                    ax.text(x0 - 0.010 * (x1 - x0), yb, ML.dms(la, "N", "S"), fontsize=7.5, color=MUTED, ha="right", va="center",
                            rotation=90, clip_on=False)
            ax.set_xlim(x0, x1); ax.set_ylim(y0, y1)
        # north arrow
        hgt = (0.06 if not small else 0.10) * (y1 - y0) * (0.55 if not small else 1)
        nx, ny = x1 - 0.08 * (x1 - x0), y1 - 0.03 * (y1 - y0) - hgt * 1.4
        w = hgt * 0.45
        ax.add_patch(MplPolygon([(nx, ny + hgt), (nx - w / 2, ny), (nx, ny + hgt * 0.28)], closed=True, facecolor=INK, edgecolor=INK, lw=0.6, zorder=9))
        ax.add_patch(MplPolygon([(nx, ny + hgt), (nx + w / 2, ny), (nx, ny + hgt * 0.28)], closed=True, facecolor="white", edgecolor=INK, lw=0.6, zorder=9))
        ax.text(nx, ny + hgt * 1.06, "N", fontsize=13 if not small else 8, fontweight="bold", family=SERIF, color=INK, ha="center", va="bottom", zorder=9)
        if small:
            return
        target = (x1 - x0) / 3.2
        L = next((v for v in [1000, 2000, 2500, 5000, 10000, 20000, 25000] if v >= target), 25000)
        sx, sy = x0 + 0.06 * (x1 - x0), y0 + 0.03 * (y1 - y0)
        bh = 0.006 * (y1 - y0)
        ax.add_patch(Rectangle((sx - 0.02 * (x1 - x0), sy - 3.2 * bh), L + 0.06 * (x1 - x0), 7.0 * bh, facecolor="white",
                               edgecolor="none", alpha=0.9, zorder=8))
        for i in range(4):
            ax.add_patch(Rectangle((sx + i * L / 4, sy), L / 4, bh, facecolor=INK if i % 2 == 0 else "white", edgecolor=INK, lw=0.6, zorder=9))
        for t in (0, L / 2, L):
            ax.text(sx + t, sy + bh * 1.7, f"{t / 1000:g}", fontsize=7.5, color=INK, ha="center", va="bottom", zorder=9)
        ax.text(sx + L / 2, sy - bh * 1.0, "kilometres", fontsize=7.5, color=MUTED, ha="center", va="top", zorder=9)

    # -- right column pieces
    def legend(self, fig, y, rows, unit=None, title="Legend"):
        T(fig, RX0, y, title, 14, INK, "bold", family=SERIF, va="center")
        if unit:
            T(fig, RX1, y, "Unit: " + unit, 8.5, MUTED, ha="right", va="center")
        y -= 0.42 / H
        T(fig, RX0 + 0.42 / W, y, "Class", 8, MUTED, "semibold", va="center")
        T(fig, RX1 - 0.95 / W, y, "Blocks", 8, MUTED, "semibold", ha="right", va="center")
        T(fig, RX1, y, "Area ha", 8, MUTED, "semibold", ha="right", va="center")
        y -= 0.14 / H
        fig.add_artist(plt.Line2D([RX0, RX1], [y, y], color=RULE, lw=0.8))
        y -= 0.30 / H
        for col, name, sub, n, ha in rows:
            fig.patches.append(FancyBboxPatch((RX0, y - 0.13 / H), 0.30 / W, 0.26 / H, boxstyle="round,pad=0,rounding_size=0.004",
                                              transform=fig.transFigure, facecolor=col, edgecolor="#7d8a80", lw=0.5))
            T(fig, RX0 + 0.42 / W, y + 0.05 / H, name, 9.5, INK, "semibold", va="center")
            if sub:
                T(fig, RX0 + 0.42 / W, y - 0.11 / H, sub, 7.5, MUTED, va="center")
            T(fig, RX1 - 0.95 / W, y + 0.05 / H, f"{n:,}", 9, INK, ha="right", va="center")
            T(fig, RX1, y + 0.05 / H, f"{ha:,.1f}", 9, INK, ha="right", va="center")
            y -= 0.40 / H
        y += 0.20 / H
        fig.add_artist(plt.Line2D([RX0, RX1], [y, y], color=INK, lw=0.8))
        y -= 0.20 / H
        T(fig, RX0 + 0.42 / W, y, "Total", 9.5, INK, "bold", va="center")
        T(fig, RX1 - 0.95 / W, y, f"{sum(r[3] for r in rows):,}", 9, INK, "bold", ha="right", va="center")
        T(fig, RX1, y, f"{sum(r[4] for r in rows):,.1f}", 9, INK, "bold", ha="right", va="center")
        return y - 0.40 / H

    def bars(self, fig, y, rows, title="Area by class (ha)"):
        T(fig, RX0, y, title, 10, INK, "bold", va="center")
        h = 0.20 / H * len(rows) + 0.15 / H
        ax = fig.add_axes([RX0 + 1.05 / W, y - 0.18 / H - h, RX1 - RX0 - 1.05 / W, h])
        vals = [r[4] for r in rows]
        ax.barh(range(len(rows)), vals, color=[r[0] for r in rows], edgecolor="#7d8a80", linewidth=0.4, height=0.7)
        ax.invert_yaxis(); ax.set_yticks(range(len(rows)))
        ax.set_yticklabels([r[1] if len(r[1]) < 19 else r[1][:18] + "…" for r in rows], fontsize=7.5, color=INK)
        vmax = max(vals) or 1
        for k, v in enumerate(vals):
            ax.text(v + vmax * 0.02, k, f"{v:,.0f}", va="center", fontsize=7, color=INK)
        ax.set_xlim(0, vmax * 1.28); ax.set_xticks([])
        for sp in ("top", "right", "bottom"):
            ax.spines[sp].set_visible(False)
        ax.spines["left"].set_color(RULE); ax.tick_params(axis="y", length=0)
        return y - 0.18 / H - h - 0.35 / H

    def by_range(self, fig, y, cls_of_block, colors_by_class, order, value_of=None, fmt=None):
        """100 % stacked bar of area per class for every range (+ median value for continuous layers)."""
        if len(self.ranges) < 2:
            return y
        T(fig, RX0, y, "By range", 10, INK, "bold", va="center")
        y -= 0.30 / H
        for r, idx in self.ranges.items():
            area = defaultdict(float)
            for i in idx:
                area[cls_of_block[i]] += float(self.blocks[i][1].get("block_area_ha") or 0)
            tot = sum(area.values()) or 1
            T(fig, RX0, y, r, 8.5, INK, "semibold", va="center")
            if value_of is not None:
                vals = [v for v in (value_of(self.blocks[i][1]) for i in idx) if v is not None]
                if vals:
                    T(fig, RX1, y, "median " + fmt.format(float(np.median(vals))), 7.5, MUTED, ha="right", va="center")
            bx, bw = RX0, RX1 - RX0
            yb = y - 0.20 / H
            x = bx
            for c in order:
                if area.get(c, 0) <= 0:
                    continue
                wdt = bw * area[c] / tot
                fig.patches.append(Rectangle((x, yb - 0.07 / H), wdt, 0.14 / H, transform=fig.transFigure,
                                             facecolor=colors_by_class[c], edgecolor="white", lw=0.3))
                x += wdt
            y -= 0.52 / H
        return y - 0.10 / H

    def text_block(self, fig, y, head, body, width=62, size=8.5):
        fig.add_artist(plt.Line2D([RX0, RX1], [y + 0.12 / H] * 2, color=RULE, lw=0.8))
        T(fig, RX0, y - 0.05 / H, head, 10, INK, "bold", va="top")
        wrapped = "\n".join(textwrap.fill(p, width) for p in body.split("\n"))
        T(fig, RX0, y - 0.32 / H, wrapped, size, INK, va="top", linespacing=1.38)
        return y - 0.32 / H - (wrapped.count("\n") + 1) * size * 1.38 * 1.2 / 72 / H - 0.22 / H

    def info(self, fig, y, rows, width=46):
        for k, v in rows:
            txt = textwrap.fill(v, width)
            T(fig, RX0, y, k, 7.8, INK, "bold", va="top")
            T(fig, RX0 + 1.00 / W, y, txt, 7.8, INK, va="top", linespacing=1.3)
            y -= (txt.count("\n") + 1) * 7.8 * 1.3 * 1.2 / 72 / H + 0.06 / H
        return y

    # ------------------------------------------------------------------ pages
    def save(self, fig, name, dpi=220):
        out = self.opt["out"] / "pages"
        out.mkdir(parents=True, exist_ok=True)
        f = out / (name + ".pdf")
        fig.savefig(str(f), facecolor=fig.get_facecolor(), dpi=dpi)
        if name in self.opt.get("png_pages", set()):
            fig.savefig(str(self.opt["out"] / (self.opt["prefix"] + "_" + name + ".png")), facecolor=fig.get_facecolor(), dpi=300)
        plt.close(fig)
        return f

    def extent_of(self, idx=None):
        if idx is None:
            return self.union.bounds
        return unary_union([self.blocks[i][0] for i in idx]).bounds

    def map_page(self, page, section, code, title, sub, colors, rows, unit, cls_of_block, colors_by_class, order,
                 about, data, used, focus=None, value_of=None, fmt=None, extra=None):
        fig = plt.figure(figsize=(W, H), facecolor=PAPER)
        self.header(fig, section, code, title, sub, page)
        idx = self.ranges[focus] if focus else None
        faded = [i for i in range(len(self.blocks)) if focus and i not in set(idx)] if focus else None
        ax = self.frame(fig, [ML_X0, MAP_Y0, ML_X1 - ML_X0, MAP_Y1 - MAP_Y0], self.extent_of(idx))
        self.draw_blocks(ax, colors, idx, faded)
        self.overlays(ax, focus)
        self.furniture(ax)
        y = MAP_Y1 - 0.05 / H
        y = self.legend(fig, y, rows, unit)
        y = self.bars(fig, y, rows)
        if focus is None:
            y = self.by_range(fig, y, cls_of_block, colors_by_class, order, value_of, fmt)
        if extra:
            y = extra(fig, y)
        y = self.text_block(fig, y, "What this map shows", about)
        y = self.info(fig, y, [("Data", data), ("Used in", used),
                               ("Grid", "10 ha blocks (316.23 m), WGS 84 / UTM 43N; dashed lines: range boundaries")])
        assert y > MAP_Y0 - 0.2 / H, f"page {page}: right column overflows ({y * H:.2f} in)"
        return fig

    # -- sections
    def section_page(self, page, letter, title, intro, items):
        fig = plt.figure(figsize=(W, H), facecolor=FOREST)
        ax = fig.add_axes([0.40, 0.10, 0.56, 0.62])
        ax.set_axis_off()
        cols = ["#1f5a40"] * len(self.paths)
        pc = PathCollection(self.paths, facecolors="#24654a", edgecolors="#24654a", linewidths=0.1)
        pc.set_rasterized(True); ax.add_collection(pc)
        b = self.union.bounds
        ax.set_xlim(b[0], b[2]); ax.set_ylim(b[1], b[3]); ax.set_aspect("equal")
        T(fig, 0.06, 0.86, letter, 120, OCHRE, "bold", family=SERIF, va="center")
        T(fig, 0.06, 0.78, title, 30, "white", "bold", family=SERIF, va="center")
        wrapped = textwrap.fill(intro, 52)
        T(fig, 0.06, 0.745, wrapped, 12, "#cfe2d6", va="top", linespacing=1.45)
        y = 0.745 - (wrapped.count("\n") + 1) * 12 * 1.45 / 72 / H - 0.03
        for code, name, pg in items:
            T(fig, 0.06, y, code, 10.5, OCHRE, "bold", va="center")
            T(fig, 0.11, y, name, 10.5, "white", va="center")
            T(fig, 0.36, y, str(pg), 10.5, "#9fb8a8", ha="right", va="center")
            y -= 0.022
        self.footer(fig, page, dark=True)
        return fig


# ------------------------------------------------------------------ layer -> classes
def classes_for(atlas, lay):
    """Return colors per block, legend rows, class per block, colour per class, class order, unit, value fn, fmt."""
    P = [p for _, p in atlas.blocks]
    area = lambda i: float(P[i].get("block_area_ha") or 0)
    if lay["kind"] == "cont":
        vals = []
        for p in P:
            try:
                vals.append(lay["value"](p))
            except (TypeError, ValueError):
                vals.append(None)
        ok = [v for v in vals if v is not None]
        b = LA.quantile_breaks(ok) if lay["breaks"] == "q" else lay["breaks"]
        names = lay["names"] or ["Very low", "Low", "Medium", "High", "Very high"]
        subs = LA.range_labels(b, lay["fmt"], lay["unit"])
        cls = [LA.classify(v, b) if v is not None else "nd" for v in vals]
        pal = lay["palette"]
        cmap = {k: pal[k] for k in range(5)}; cmap["nd"] = NODATA
        rows = [(pal[k], names[k], subs[k], sum(1 for c in cls if c == k), sum(area(i) for i, c in enumerate(cls) if c == k)) for k in range(5)]
        if any(c == "nd" for c in cls):
            rows.append((NODATA, "No data", "value not available (score gap-filled)", sum(1 for c in cls if c == "nd"),
                         sum(area(i) for i, c in enumerate(cls) if c == "nd")))
        order = list(range(5)) + ["nd"]
        value_of = lambda p: (lambda v: v)(_safe(lay["value"], p))
        method = ("Classes are quintiles of the blocks (about 20 % each)." if lay["breaks"] == "q" else "Classes use fixed, meaningful thresholds.")
        stat = (f"Block values: min {lay['fmt'].format(min(ok))}, median {lay['fmt'].format(float(np.median(ok)))}, "
                f"max {lay['fmt'].format(max(ok))} ({lay['unit']}). " + method)
        return [cmap[c] for c in cls], rows, cls, cmap, order, lay["unit"], value_of, lay["fmt"], stat
    vals = [lay["value"](p) for p in P]
    cm = {c[0]: c for c in lay["classes"]}
    present = [c for c in lay["classes"] if any(v == c[0] for v in vals)]
    cls = vals
    cmap = {c[0]: c[2] for c in lay["classes"]}
    rows = [(c[2], c[1], c[3], sum(1 for v in vals if v == c[0]), sum(area(i) for i, v in enumerate(vals) if v == c[0])) for c in present]
    unknown = {v for v in vals if v not in cm}
    assert not unknown, (lay["code"], unknown)
    return [cmap[v] for v in vals], rows, cls, cmap, [c[0] for c in lay["classes"]], None, None, None, ""


def _safe(fn, p):
    try:
        return fn(p)
    except (TypeError, ValueError):
        return None


def map_classes(atlas, key):
    cfg = ML.MAPS[key]
    pal = cfg["palette"] + ML.TAIL_COLORS
    labels = cfg["classes"] + ML.TAIL_LABELS
    P = [p for _, p in atlas.blocks]
    cls = [int(p[cfg["field"]]) for p in P]
    if cfg["breaks"]:
        rng = ML.class_ranges(P[next(i for i, p in enumerate(P) if int(p["excluded"]) == 0)][cfg["breaks"]])
        subs = [f"{cfg['index']} {r}" for r in rng]
    else:
        subs = cfg["descr"]
    subs = subs + ML.TAIL_DESCR
    return cfg, pal, labels, subs, cls


# ------------------------------------------------------------------ build
def build(src, opt):
    blocks, paths, ranges = load(src, opt.get("range_field"))
    A = Atlas(blocks, paths, ranges, opt)
    P = [p for _, p in blocks]
    retained = [p for p in P if int(p["excluded"]) == 0]
    n_ranges = len(ranges)
    rng_names = list(ranges)
    plan = []                     # (section, code, title, builder)

    # results
    for key, code in (("need", "1"), ("feas", "2"), ("phase", "3")):
        plan.append(("Results", "M" + code, ML.MAPS[key]["title"], ("map", key, None)))
    for r in rng_names:
        for key, code in (("phase", "3"), ("need", "1"), ("feas", "2")):
            plan.append(("Results by range", "M" + code, ML.MAPS[key]["title"] + " — " + r, ("map", key, r)))
    # layer sections (G9 change-from-v2.1 needs a v2.1 table, not available here)
    sections = OrderedDict()
    for lay in LA.LAYERS:
        if lay["code"] == "G9":
            continue
        sections.setdefault(lay["section"], []).append(lay)
    for sec, lays in sections.items():
        plan.append((sec, "", sec, ("section", sec, lays)))
        for lay in lays:
            plan.append((sec, lay["code"], lay["title"], ("layer", lay)))
    plan.append(("H. Indicator score summaries", "S1", "Need indicators N1-N8", ("scores", "N")))
    plan.append(("H. Indicator score summaries", "S2", "Feasibility indicators F1-F14", ("scores", "F")))
    plan.append(("Methods", "", "Methods, data and notes", ("methods",)))
    first = 4                                         # cover 1, contents 2, at a glance 3
    pages = [(first + i, p) for i, p in enumerate(plan)]
    page_of = {}
    for pg, (sec, code, title, spec) in pages:
        if spec[0] == "section":
            page_of[("section", spec[1])] = pg
        if spec[0] == "layer":
            page_of[spec[1]["code"]] = pg

    files = []
    files.append(cover(A, opt, retained))
    files.append(contents(A, opt, pages))
    files.append(glance(A, opt, P, retained))
    weights = json.loads(retained[0]["weights_used"])
    for pg, (sec, code, title, spec) in pages:
        kind = spec[0]
        if kind == "map":
            key, focus = spec[1], spec[2]
            cfg, pal, labels, subs, cls = map_classes(A, key)
            colors = [pal[c - 1] for c in cls]
            sel = range(len(P)) if focus is None else ranges[focus]
            rows = []
            for c in range(1, 8):
                ids = [i for i in sel if cls[i] == c]
                if ids or c <= 5:
                    rows.append((pal[c - 1], labels[c - 1], subs[c - 1], len(ids), sum(float(P[i].get("block_area_ha") or 0) for i in ids)))
            extra = top_beats(A, focus) if (focus and key == "phase") else None
            fig = A.map_page(pg, sec, code, cfg["title"] + ("" if not focus else " — " + focus),
                             (opt["title"] if not focus else focus + " range") + "  ·  " + cfg["subtitle"],
                             colors, rows, None, cls, {c: pal[c - 1] for c in range(1, 8)}, list(range(1, 8)),
                             cfg["explain"] + (" Class breaks are the quintiles of all " + f"{len(retained):,}" +
                                               " plantable blocks of the area." if cfg["breaks"] else ""),
                             "FRPIM v2.2 model (22 satellite indicators, Google Earth Engine)",
                             "Annual plan of operations, estimates and field verification",
                             focus=focus, extra=extra)
            files.append(A.save(fig, f"p{pg:03d}_{key}_{focus or 'all'}".replace(" ", "_")))
        elif kind == "section":
            sec_name, lays = spec[1], spec[2]
            intro = SECTION_INTRO.get(sec_name[0], "")
            items = [(l["code"], l["title"], page_of[l["code"]]) for l in lays]
            fig = A.section_page(pg, sec_name[0], sec_name[3:], intro, items)
            files.append(A.save(fig, f"p{pg:03d}_section_{sec_name[0]}"))
        elif kind == "layer":
            lay = spec[1]
            colors, rows, cls, cmap, order, unit, value_of, fmt, stat = classes_for(A, lay)
            fig = A.map_page(pg, sec, lay["code"], lay["title"], opt["title"] + "  ·  " + lay["sub"], colors, rows, unit,
                             cls, cmap, order, lay["about"] + ("\n" + stat if stat else ""), lay["data"], lay["use"],
                             value_of=value_of, fmt=fmt)
            files.append(A.save(fig, f"p{pg:03d}_{lay['code']}_{lay['key']}"))
        elif kind == "scores":
            files.append(scores_page(A, pg, sec, code, title, spec[1], weights))
        elif kind == "methods":
            files.append(methods_page(A, pg, retained, weights))
        print("page", pg, code, title)
    return A, files


SECTION_INTRO = {
    "A": "What grows on the land today: canopy, green cover, biomass, open grass and invasive shrubs.",
    "B": "Signs of decline: exposed soil, erosion risk, the rainfall-corrected greenness trend, change since 2000, fire and the independent degradation evidence.",
    "C": "Where water collects and how long the land stays moist: the moisture group that, with soil, decides whether planting can succeed.",
    "D": "Slope, aspect, curvature, landscape position and rockiness: the terrain that shapes soil depth, moisture and the work possible on site.",
    "E": "Texture, stones, pH and organic carbon of the top 30 cm from SoilGrids (250 m): coarse, so read them as context.",
    "F": "Settlements, people, roads, nearby dense forest and protected areas: the pressure on and the context of each block.",
    "G": "The model's own components and outputs: group scores, reliability, interventions, species, SMC, constraints and field flags.",
}


def top_beats(A, focus):
    def draw(fig, y):
        acc = defaultdict(float)
        for i in A.ranges[focus]:
            p = A.blocks[i][1]
            if int(p.get("phase_code") or 0) in (1, 2):
                acc[p.get("beat") or p.get("beat_id") or "-"] += float(p.get("net_plantable_ha") or 0)
        top = sorted(acc.items(), key=lambda kv: -kv[1])[:8]
        if not top:
            return y
        T(fig, RX0, y, "Beats with most Phase 1-2 land (net ha)", 10, INK, "bold", va="center")
        y -= 0.30 / H
        mx = top[0][1] or 1
        for b, v in top:
            T(fig, RX0, y, b, 8.2, INK, va="center")
            fig.patches.append(Rectangle((RX0 + 1.45 / W, y - 0.06 / H), (RX1 - RX0 - 2.05 / W) * v / mx, 0.12 / H,
                                         transform=fig.transFigure, facecolor="#f46d43", edgecolor="none"))
            T(fig, RX1, y, f"{v:,.0f}", 8.2, INK, ha="right", va="center")
            y -= 0.22 / H
        return y - 0.20 / H
    return draw


def cover(A, opt, retained):
    fig = plt.figure(figsize=(W, H), facecolor=FOREST)
    ax = fig.add_axes([0.30, 0.04, 0.68, 0.74])
    ax.set_axis_off()
    pal = ML.MAPS["phase"]["palette"] + ML.TAIL_COLORS
    cols = [pal[int(p["phase_map"]) - 1] for _, p in A.blocks]
    pc = PathCollection(A.paths, facecolors=cols, edgecolors=cols, linewidths=0.1)
    pc.set_rasterized(True); ax.add_collection(pc)
    for r, g in A.range_geom.items():
        ax.add_patch(PathPatch(path_of(g), facecolor="none", edgecolor="#f6c46a", linewidth=0.8, linestyle=(0, (5, 2))))
    b = A.union.bounds
    ax.set_xlim(b[0] - 2000, b[2] + 2000); ax.set_ylim(b[1] - 2000, b[3] + 2000); ax.set_aspect("equal")
    T(fig, 0.07, 0.945, opt["kicker"].upper(), 10, "#f6c46a", "bold")
    fig.add_artist(plt.Line2D([0.07, 0.93], [0.932, 0.932], color="#2f6b4f", lw=0.8))
    T(fig, 0.07, 0.885, opt["name"], 50, "white", "bold", family=SERIF, va="center")
    T(fig, 0.07, 0.832, "Restoration Atlas", 50, "#9be3b6", "bold", family=SERIF, va="center")
    T(fig, 0.07, 0.788, opt["subtitle"], 13, "#cfe2d6", va="center")
    T(fig, 0.07, 0.768, "FRPIM v2.2  ·  Forest Restoration Priority and Intervention Model", 9.5, "#9fb8a8", va="center")
    y = 0.705
    stats = [(f"{sum(float(p.get('block_area_ha') or 0) for _, p in A.blocks):,.0f}", "ha of forest mapped"),
             (f"{len(A.blocks):,}", "blocks of 10 ha"),
             (f"{sum(float(p['net_plantable_ha']) for p in retained):,.0f}", "ha net plantable"),
             (f"{sum(float(p['net_plantable_ha']) for p in retained if int(p['phase_code']) in (1, 2)):,.0f}", "ha in Phase 1-2"),
             (str(len(A.ranges)), "ranges")]
    for v, l in stats:
        T(fig, 0.07, y, v, 26, "white", "bold", family=SERIF, va="center")
        T(fig, 0.07, y - 0.022, l, 10, "#9fb8a8", va="center")
        y -= 0.075
    T(fig, 0.07, 0.30, "Ranges", 10, "#f6c46a", "bold")
    for k, r in enumerate(A.ranges):
        T(fig, 0.07, 0.28 - k * 0.020, r, 12, "white")
    T(fig, 0.07, 0.125, opt["tagline"], 15, "#f6c46a", "semibold", family=SERIF)
    if opt.get("prepared"):
        T(fig, 0.07, 0.098, opt["prepared"], 10, "white")
    T(fig, 0.07, 0.078, opt["date"] + "  ·  map colours: priority phase (Map 3)", 9, "#9fb8a8")
    return A.save(fig, "p001_cover")


def contents(A, opt, pages):
    fig = plt.figure(figsize=(W, H), facecolor=PAPER)
    A.header(fig, "", "", "Contents", opt["name"] + " Restoration Atlas  ·  " + opt["place"], 2)
    x, y, colw = 0.50 / W, 1 - 2.05 / H, (W - 1.0) / 2 / W
    sec = None
    entries = [("", "", "At a glance", 3)] + [(s, c, t, pg) for pg, (s, c, t, spec) in pages if spec[0] != "section"]
    for s, c, t, pg in entries:
        if s != sec and s:
            if y < 1.2 / H:
                x, y = x + colw, 1 - 2.05 / H
            y -= 0.10 / H
            T(fig, x, y, s.upper(), 8.5, OCHRE, "bold", va="center")
            y -= 0.26 / H
            sec = s
        T(fig, x, y, c, 8.5, MUTED, "semibold", va="center")
        T(fig, x + 0.45 / W, y, t if len(t) < 52 else t[:50] + "…", 8.5, INK, va="center")
        T(fig, x + colw - 0.25 / W, y, str(pg), 8.5, MUTED, ha="right", va="center")
        y -= 0.205 / H
        if y < 1.0 / H:
            x, y = x + colw, 1 - 2.05 / H
    return A.save(fig, "p002_contents")


def glance(A, opt, P, retained):
    fig = plt.figure(figsize=(W, H), facecolor=PAPER)
    A.header(fig, "", "", "At a glance", opt["title"] + "  ·  what the three maps say", 3)
    ha = lambda ps: sum(float(p.get("block_area_ha") or 0) for p in ps)
    net = lambda ps: sum(float(p.get("net_plantable_ha") or 0) for p in ps)
    p12 = [p for p in retained if int(p["phase_code"]) in (1, 2)]
    stab = [float(p["stability_p12"]) for p in p12]
    tiles = [(f"{ha(P):,.0f}", "ha mapped", f"{len(P):,} blocks of 10 ha"),
             (f"{net(retained):,.0f}", "ha net plantable", f"{len(retained):,} blocks in the matrix"),
             (f"{net(p12):,.0f}", "ha in Phase 1-2", f"{len(p12):,} blocks: first priority"),
             (f"{100 * sum(s > 0.8 for s in stab) / max(len(stab), 1):.0f} %", "robust", "Phase 1-2 blocks kept in > 80 % of 500 draws")]
    tw = (W - 1.0 - 0.3 * 3) / 4
    for k, (v, l, s) in enumerate(tiles):
        x = 0.50 + k * (tw + 0.3)
        fig.patches.append(FancyBboxPatch((x / W, 1 - 3.55 / H), tw / W, 1.55 / H, boxstyle="round,pad=0,rounding_size=0.008",
                                          transform=fig.transFigure, facecolor=SOFT, edgecolor="none"))
        T(fig, (x + 0.2) / W, 1 - 2.45 / H, v, 24, FOREST, "bold", family=SERIF, va="center")
        T(fig, (x + 0.2) / W, 1 - 2.87 / H, l, 10, INK, "semibold", va="center")
        T(fig, (x + 0.2) / W, 1 - 3.17 / H, s, 7.8, MUTED, va="center")
    # range x phase table
    y = 1 - 4.15 / H
    T(fig, 0.50 / W, y, "Priority phase by range (net plantable ha; Protected and Excluded gross ha)", 13, INK, "bold", family=SERIF, va="center")
    y -= 0.45 / H
    pal = ML.MAPS["phase"]["palette"] + ML.TAIL_COLORS
    heads = ["Range", "Phase 1", "Phase 2", "Phase 3", "Phase 4", "Phase 5", "Protected", "Excluded", "Net plantable", "Total"]
    xs = [0.50, 2.45, 3.45, 4.45, 5.45, 6.45, 7.45, 8.45, 9.70, W - 0.50]
    for i, h in enumerate(heads):
        T(fig, xs[i] / W, y, h, 8.5, MUTED, "semibold", ha="left" if i == 0 else "right", va="center")
        if 1 <= i <= 7:
            fig.patches.append(Rectangle(((xs[i] - 0.82) / W, y - 0.20 / H), 0.82 / W, 0.05 / H, transform=fig.transFigure, facecolor=pal[i - 1]))
    y -= 0.18 / H
    fig.add_artist(plt.Line2D([0.50 / W, 1 - 0.50 / W], [y, y], color=INK, lw=0.8))
    groups = list(A.ranges.items()) + [("Total", list(range(len(P))))]
    for r, idx in groups:
        y -= 0.34 / H
        ps = [P[i] for i in idx]
        vals = [net([p for p in ps if int(p["phase_map"]) == c]) for c in range(1, 6)] + [ha([p for p in ps if int(p["phase_map"]) == c]) for c in (6, 7)]
        row = [r] + [f"{v:,.0f}" for v in vals] + [f"{net(ps):,.0f}", f"{ha(ps):,.0f}"]
        bold = r == "Total"
        if bold:
            fig.add_artist(plt.Line2D([0.50 / W, 1 - 0.50 / W], [y + 0.17 / H] * 2, color=INK, lw=0.6))
        for i, v in enumerate(row):
            T(fig, xs[i] / W, y, v, 9.5, INK, "bold" if bold or i == 0 else "normal", ha="left" if i == 0 else "right", va="center")
    # stacked bars per range
    y -= 0.75 / H
    T(fig, 0.50 / W, y, "Share of each range's area by priority phase", 13, INK, "bold", family=SERIF, va="center")
    y -= 0.40 / H
    for r, idx in A.ranges.items():
        ps = [P[i] for i in idx]
        tot = ha(ps) or 1
        T(fig, 0.50 / W, y, r, 9.5, INK, "semibold", va="center")
        x = 2.45
        for c in range(1, 8):
            a = ha([p for p in ps if int(p["phase_map"]) == c])
            wdt = (W - 0.50 - 2.45) * a / tot
            fig.patches.append(Rectangle((x / W, y - 0.13 / H), wdt / W, 0.26 / H, transform=fig.transFigure, facecolor=pal[c - 1], edgecolor="white", lw=0.4))
            if wdt > 0.45:
                T(fig, (x + wdt / 2) / W, y, f"{100 * a / tot:.0f}%", 7.5, "white" if c in (1, 2, 6) else INK, ha="center", va="center")
            x += wdt
        y -= 0.42 / H
    lx = 2.45
    for c, l in enumerate(["Phase 1", "Phase 2", "Phase 3", "Phase 4", "Phase 5", "Protected", "Excluded"]):
        fig.patches.append(Rectangle((lx / W, y - 0.07 / H), 0.16 / W, 0.14 / H, transform=fig.transFigure, facecolor=pal[c], edgecolor="#7d8a80", lw=0.4))
        T(fig, (lx + 0.22) / W, y, l, 8, MUTED, va="center")
        lx += 1.15
    # interventions
    y -= 0.70 / H
    T(fig, 0.50 / W, y, "Recommended treatment (net plantable ha)", 13, INK, "bold", family=SERIF, va="center")
    y -= 0.30 / H
    rx = defaultdict(float)
    for p in retained:
        rx[p["intervention"]] += float(p["net_plantable_ha"])
    rows = sorted(rx.items(), key=lambda kv: -kv[1])
    g6 = next(l for l in LA.LAYERS if l["code"] == "G6")
    lab = {c[0]: c[1] for c in g6.get("classes", [])}
    mx = rows[0][1] if rows else 1
    for k, v in rows:
        T(fig, 0.50 / W, y, lab.get(k, k.replace("_", " ").capitalize()), 9.5, INK, va="center")
        fig.patches.append(Rectangle((3.60 / W, y - 0.09 / H), (W - 0.50 - 3.60 - 1.1) * v / mx / W, 0.18 / H, transform=fig.transFigure, facecolor=CANOPY))
        T(fig, 1 - 0.50 / W, y, f"{v:,.0f} ha", 9.5, INK, ha="right", va="center")
        y -= 0.30 / H
    # how to read
    y -= 0.35 / H
    T(fig, 0.50 / W, y, "How to read this atlas", 13, INK, "bold", family=SERIF, va="center")
    y -= 0.25 / H
    txt = ("Every map shows the same 10-hectare blocks. Map 1 shows how degraded each block is (need), Map 2 how likely restoration "
           "is to succeed (feasibility) and Map 3 the order of work (Phase 1 first), from a 5 x 5 need x feasibility matrix. "
           "Dense forest is Protected; water, drains, rock, built-up land, cropland and very steep land are Excluded. "
           "Pages for each range zoom in on the three maps and list the beats with most Phase 1-2 land. Sections A to G show every "
           "satellite layer behind the model. Dashed lines are range boundaries; colours in each legend are explained with hectares. "
           "FRPIM is decision support: field staff verify every block before it enters an estimate.")
    T(fig, 0.50 / W, y, textwrap.fill(txt, 125), 9.5, INK, va="top", linespacing=1.5)
    return A.save(fig, "p003_at_a_glance")


def scores_page(A, pg, sec, code, title, which, weights):
    fig = plt.figure(figsize=(W, H), facecolor=PAPER)
    names = LA.N_NAMES if which == "N" else LA.F_NAMES
    A.header(fig, sec, code, title, "Indicator scores 0-1 (" + ("higher = more need" if which == "N" else "higher = more feasible") +
             ")  ·  weights after the CV guard", pg)
    from matplotlib import colormaps
    from matplotlib.colors import Normalize
    cmap = colormaps["YlOrRd"] if which == "N" else colormaps["RdYlGn"]
    norm = Normalize(0, 1)
    keys = list(names)
    ncol = 4 if which == "N" else 5
    nrow = math.ceil(len(keys) / ncol)
    top, bot = 1 - 2.00 / H, 1.30 / H
    gw, gh = (1 - 1.0 / W) / ncol, (top - bot) / nrow
    for i, k in enumerate(keys):
        r, c = divmod(i, ncol)
        rect = [0.50 / W + c * gw + 0.004, top - (r + 1) * gh + 0.010, gw - 0.008, gh - 0.034]
        ax = A.frame(fig, rect, A.union.bounds, pad=0.02)
        cols = [cmap(norm(float(p.get(k) or 0))) for _, p in A.blocks]
        pc = PathCollection(A.paths, facecolors=cols, edgecolors=cols, linewidths=0.08)
        pc.set_rasterized(True); ax.add_collection(pc)
        ax.add_patch(PathPatch(path_of(A.edge), facecolor="none", edgecolor=INK, linewidth=0.3))
        w = weights.get(k, 0)
        T(fig, rect[0], rect[1] + rect[3] + 0.016, f"{k}  {names[k]}", 9, INK if w else MUTED, "bold", va="center")
        T(fig, rect[0], rect[1] + rect[3] + 0.006, "weight 0 (no variation)" if not w else f"weight {w:.2f} points",
          7.5, "#b2182b" if not w else MUTED, va="center")
    cax = fig.add_axes([0.62, 0.85 / H, 0.33, 0.12 / H])
    cb = plt.colorbar(plt.cm.ScalarMappable(norm=norm, cmap=cmap), cax=cax, orientation="horizontal")
    cb.ax.tick_params(labelsize=7.5); cb.outline.set_edgecolor("#7d8a80")
    T(fig, 0.62, 1.07 / H, "Indicator score (0-1)", 8, MUTED, va="bottom")
    return A.save(fig, f"p{pg:03d}_scores_{which}")


def methods_page(A, pg, retained, weights):
    fig = plt.figure(figsize=(W, H), facecolor=PAPER)
    A.header(fig, "Methods", "", "Methods, data and notes", "How the maps in this atlas were made", pg)
    p0 = retained[0]
    secs = [
        ("Planning unit", "A 10-hectare grid (316.23 m squares, UTM 43N) cut to the forest boundary; blocks of 2 ha and more are kept. "
         "Each block holds about 170 attributes."),
        ("Twenty-two indicators", "Restoration Need (RNI): canopy deficit, bare soil at peak greenness, rainfall-corrected NDVI trend, "
         "erosion (RUSLE), biomass deficit, unrecovered tree loss, evergreen shrub invasion and nearness to dense forest (100 points). "
         "Restoration Feasibility (RFI): moisture (35), soil (35), terrain (18) and risk (12) groups of 14 indicators."),
        ("Scoring scale", f"Each indicator is scaled 0-1 between its 2nd and 98th percentile over natural vegetation of the area + 20 km "
         f"(anchor {p0.get('anchor_id', '-')}). RFI = M^0.325 x S^0.325 x (0.55 + 0.45 TR): water and soil are multiplied, terrain and risk adjust."),
        ("Weights used", "CV guard: " + str(p0.get("cv_reweight_log", "-")) + ". Final points: " +
         ", ".join(f"{k} {v:.1f}" for k, v in weights.items()) + "."),
        ("Classes and phases", f"Five classes per index at the 20th, 40th, 60th and 80th percentiles of the plantable blocks (RNI {p0['rni_breaks']}; "
         f"RFI {p0['rfi_breaks']}). A 5 x 5 matrix of need x feasibility gives Phase 1-5. Canopy of 40 % or more is Protected; more than 30 % "
         "water, drains, slope > 45 %, built-up, cropland or rock is Excluded."),
        ("Reliability", "All weights redrawn 500 times (Dirichlet, concentration 125, seed 2026) with class breaks recomputed each time; "
         "stability_p12 is the share of draws in which a block stays in Phase 1-2."),
        ("Data", "Sentinel-2 L2A with Cloud Score+, Landsat 5/7/8/9, FABDEM, Copernicus GLO-30, MERIT Hydro, Hydrography90m, CHIRPS, "
         "MODIS MOD16 and MCD64A1, VIIRS active fire, JRC Global Surface Water, SoilGrids 2.0, Meta canopy height, Hansen GFC v1.13, "
         "ESA WorldCover and CCI biomass, Dynamic World, GHSL, GRIP4 and WDPA, processed in Google Earth Engine."),
        ("Processing", "RUN 1 (all layers per block) ran in Google Earth Engine. RUN 2 scoring was computed with a line-by-line port of the "
         "Earth Engine code that reproduces Earth Engine's own results exactly (0 differences on all 829 Khedbrahma blocks)."),
        ("Limits", "SoilGrids is coarse (250 m); soil depth is a terrain proxy, with soil pits for G3 blocks. Classes are relative within this "
         "area. Recent plantations may look bare (G1). Rights, encroachment and legal status are checked in the field before any work."),
    ]
    y = 1 - 2.05 / H
    for head, body in secs:
        T(fig, 0.50 / W, y, head, 11, FOREST, "bold", family=SERIF, va="top")
        wrapped = textwrap.fill(body, 118)
        T(fig, 0.50 / W, y - 0.28 / H, wrapped, 9.5, INK, va="top", linespacing=1.45)
        y -= 0.28 / H + (wrapped.count("\n") + 1) * 9.5 * 1.45 / 72 / H + 0.30 / H
    return A.save(fig, f"p{pg:03d}_methods")


def main():
    args = sys.argv[1:]
    opt = {"title": "Restoration area", "place": "", "prefix": "FRPIM", "range_field": None, "date": "", "fonts": None, "name": "Forest", "kicker": "", "subtitle": "", "tagline": "", "prepared": ""}
    for k in ("title", "place", "prefix", "range-field", "date", "fonts", "name", "kicker", "subtitle", "tagline", "prepared"):
        if "--" + k in args:
            i = args.index("--" + k); opt[k.replace("-", "_")] = args[i + 1]; del args[i:i + 2]
    src, out = Path(args[0]), Path(args[1])
    out.mkdir(parents=True, exist_ok=True)
    opt["out"] = out
    setup_fonts(opt["fonts"])
    opt["png_pages"] = set()
    A, files = build(src, opt)
    import pymupdf
    doc = pymupdf.open()
    for f in files:
        with pymupdf.open(str(f)) as d:
            doc.insert_pdf(d)
    target = out / f"{opt['prefix']}_Restoration_Atlas.pdf"
    doc.save(str(target), deflate=True, garbage=3)
    print("atlas:", target, doc.page_count, "pages")


if __name__ == "__main__":
    main()
