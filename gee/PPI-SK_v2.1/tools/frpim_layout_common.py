"""
Shared A3 page furniture for FRPIM v2.2 presentation maps: header, map frame with lat/long graticule,
north arrow, scale bar, legend rows, wrapped text blocks and footer. Used by
frpim_layer_atlas.py (block layers) and frpim_raster_atlas.py (pixel layers exported from GEE).
"""
import json
import math
import textwrap

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.patches import PathPatch, Rectangle, Polygon as MplPolygon, FancyBboxPatch
from matplotlib.path import Path as MplPath
from pyproj import Transformer
import shapely
from shapely.geometry import shape
from shapely.ops import unary_union

plt.rcParams.update({"font.family": "DejaVu Sans", "pdf.fonttype": 42, "svg.fonttype": "none"})
INK, MUTED, RULE, PAPER, MAP_BG = "#1f2a24", "#55625a", "#c9d1cb", "#ffffff", "#f3f5f2"
W, H = 16.54, 11.69                                    # A3 landscape, inches
MAP_RECT = [0.030, 0.085, 0.630, 0.785]
LX, RX = 0.685, 0.970                                  # right panel
PLACE = "Khedbrahma Range, Sabarkantha, Gujarat"


def load_blocks(path):
    data = json.load(open(path))
    to_utm = Transformer.from_crs("EPSG:4326", "EPSG:32643", always_xy=True).transform
    out = []
    for f in data["features"]:
        g = shapely.transform(shape(f["geometry"]), lambda xy: np.column_stack(to_utm(xy[:, 0], xy[:, 1])))
        out.append((g, f["properties"]))
    return out


def geom_to_patch(geom, **kw):
    verts, codes = [], []
    polys = [geom] if geom.geom_type == "Polygon" else [g for g in geom.geoms if g.geom_type == "Polygon"]
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


def new_page(code, title, subtitle):
    fig = plt.figure(figsize=(W, H), facecolor=PAPER)
    head = f"{code}  |  {title}" if code else title
    size = 24 if len(head) < 62 else (21 if len(head) < 74 else 18)
    fig.text(0.030, 0.950, head, fontsize=size, fontweight="bold", color=INK, va="center")
    fig.text(0.030, 0.912, f"{PLACE}   ·   {subtitle}", fontsize=13, color=MUTED, va="center")
    fig.text(0.970, 0.950, "FRPIM v2.2", fontsize=13, fontweight="bold", color=INK, ha="right", va="center")
    fig.text(0.970, 0.915, "Forest Restoration Priority and\nIntervention Model", fontsize=9.5, color=MUTED,
             ha="right", va="center", linespacing=1.2)
    fig.add_artist(plt.Line2D([0.030, 0.970], [0.885, 0.885], color=INK, lw=1.4))
    return fig


def footer(fig, text):
    fig.add_artist(plt.Line2D([0.030, 0.970], [0.055, 0.055], color=RULE, lw=0.8))
    fig.text(0.030, 0.035, text, fontsize=8, color=MUTED, va="center")


def map_axes(fig, union, rect=MAP_RECT, pad_frac=0.06):
    ax = fig.add_axes(rect)
    ax.set_facecolor(MAP_BG)
    minx, miny, maxx, maxy = union.bounds
    pad = pad_frac * max(maxx - minx, maxy - miny)
    fw, fh = rect[2] * W, rect[3] * H
    cx, cy = (minx + maxx) / 2, (miny + maxy) / 2
    half_w = max((maxx - minx) / 2 + pad, ((maxy - miny) / 2 + pad) * fw / fh)
    half_h = half_w * fh / fw
    ax.set_xlim(cx - half_w, cx + half_w)
    ax.set_ylim(cy - half_h, cy + half_h)
    ax.set_aspect("equal")
    ax.set_xticks([]); ax.set_yticks([])
    for s in ax.spines.values():
        s.set_color(INK); s.set_linewidth(1.2)
    return ax


def map_furniture(ax, small=False):
    """Graticule with degree-minute labels, north arrow and scale bar (UTM 43N metres)."""
    to_ll = Transformer.from_crs("EPSG:32643", "EPSG:4326", always_xy=True).transform
    to_xy = Transformer.from_crs("EPSG:4326", "EPSG:32643", always_xy=True).transform
    x0, x1 = ax.get_xlim()
    y0, y1 = ax.get_ylim()
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    fs = 6.5 if small else 8.5
    if not small:
        lons = [to_ll(x, y)[0] for x in (x0, x1) for y in (y0, y1)]
        lats = [to_ll(x, y)[1] for x in (x0, x1) for y in (y0, y1)]
        span = max(max(lons) - min(lons), max(lats) - min(lats))
        step = 0.05 if span <= 0.6 else (0.1 if span <= 1.2 else 0.25)
        lon_t = [round(math.ceil(min(lons) / step) * step + i * step, 6) for i in range(int((max(lons) - min(lons)) / step) + 2)]
        lat_t = [round(math.ceil(min(lats) / step) * step + i * step, 6) for i in range(int((max(lats) - min(lats)) / step) + 2)]
        for lo in lon_t:
            pts = [to_xy(lo, min(lats) + t * (max(lats) - min(lats)) / 50) for t in range(51)]
            ax.plot([q[0] for q in pts], [q[1] for q in pts], color="#9aa69e", lw=0.4, ls=(0, (4, 4)), zorder=7)
            xb = to_xy(lo, to_ll(cx, y0)[1])[0]
            if x0 < xb < x1:
                ax.text(xb, y0 - 0.008 * (y1 - y0), dms(lo, "E", "W"), fontsize=fs, color=MUTED, ha="center", va="top",
                        clip_on=False)
        for la in lat_t:
            pts = [to_xy(min(lons) + t * (max(lons) - min(lons)) / 50, la) for t in range(51)]
            ax.plot([q[0] for q in pts], [q[1] for q in pts], color="#9aa69e", lw=0.4, ls=(0, (4, 4)), zorder=7)
            yb = to_xy(to_ll(x0, cy)[0], la)[1]
            if y0 < yb < y1:
                ax.text(x0 - 0.006 * (x1 - x0), yb, dms(la, "N", "S"), fontsize=fs, color=MUTED, ha="right",
                        va="center", rotation=90, clip_on=False)
        ax.set_xlim(x0, x1); ax.set_ylim(y0, y1)
    # north arrow
    nx, ny = x1 - 0.06 * (x1 - x0), y1 - (0.16 if small else 0.13) * (y1 - y0)
    h = (0.10 if small else 0.075) * (y1 - y0); w = h * 0.45
    ax.add_patch(MplPolygon([(nx, ny + h), (nx - w / 2, ny), (nx, ny + h * 0.28)], closed=True,
                            facecolor=INK, edgecolor=INK, lw=0.8, zorder=9))
    ax.add_patch(MplPolygon([(nx, ny + h), (nx + w / 2, ny), (nx, ny + h * 0.28)], closed=True,
                            facecolor="#ffffff", edgecolor=INK, lw=0.8, zorder=9))
    ax.text(nx, ny + h * 1.08, "N", fontsize=9 if small else 16, fontweight="bold", color=INK, ha="center",
            va="bottom", zorder=9)
    if small:
        return
    # scale bar
    target = (x1 - x0) / 5.0
    L = next((v for v in [500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000] if v >= target), 50000)
    sx, sy = x0 + 0.04 * (x1 - x0), y0 + 0.05 * (y1 - y0)
    bh = 0.012 * (y1 - y0)
    ax.add_patch(Rectangle((sx - 0.012 * (x1 - x0), sy - 2.6 * bh), L + 0.035 * (x1 - x0), 5.4 * bh,
                           facecolor="#ffffff", edgecolor="none", alpha=0.85, zorder=8))
    for i in range(4):
        ax.add_patch(Rectangle((sx + i * L / 4, sy), L / 4, bh, facecolor=INK if i % 2 == 0 else "#ffffff",
                               edgecolor=INK, lw=0.8, zorder=9))
    for t in [0, L / 4, L / 2, 3 * L / 4, L]:
        ax.text(sx + t, sy + bh * 1.5, f"{t / 1000:g}", fontsize=8.5, color=INK, ha="center", va="bottom", zorder=9)
    ax.text(sx + L / 2, sy - bh * 0.9, "kilometres", fontsize=8.5, color=MUTED, ha="center", va="top", zorder=9)


def swatch(fig, x, y, color, hatch=None):
    fig.patches.append(FancyBboxPatch((x, y - 0.0135), 0.024, 0.027, boxstyle="round,pad=0,rounding_size=0.002",
                                      transform=fig.transFigure, facecolor=color, edgecolor="#6b756e", lw=0.6,
                                      hatch=hatch))


def text_block(fig, y, heading, body, width=78, size=8.2):
    """Heading + wrapped paragraph in the right panel; returns the new y."""
    fig.add_artist(plt.Line2D([LX, RX], [y + 0.012, y + 0.012], color=RULE, lw=0.8))
    fig.text(LX, y, heading, fontsize=10.5, fontweight="bold", color=INK, va="top")
    wrapped = "\n".join(textwrap.fill(p, width) for p in body.split("\n"))
    fig.text(LX, y - 0.022, wrapped, fontsize=size, color=INK, va="top", linespacing=1.32)
    return y - 0.022 - 0.0145 * (wrapped.count("\n") + 1) - 0.016


def info_rows(fig, y, rows, width=60):
    for k, v in rows:
        txt = textwrap.fill(v, width)
        fig.text(LX, y, k, fontsize=8, fontweight="bold", color=INK, va="top")
        fig.text(LX + 0.068, y, txt, fontsize=8, color=INK, va="top", linespacing=1.3)
        y -= 0.0145 * (txt.count("\n") + 1) + 0.004
    return y


def union_of(blocks):
    return unary_union([g for g, _ in blocks])
