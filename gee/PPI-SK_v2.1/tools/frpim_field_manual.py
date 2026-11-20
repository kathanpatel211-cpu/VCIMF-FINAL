"""
FRPIM v2.2 — printable field manual for the accuracy assessment (blind: no model values).

Usage: python frpim_field_manual.py blocks.geojson ACC_field_form.csv OUTPUT.pdf
Pages: locator map · point list · plot layout · recording codes · one datasheet per main/reserve point
"""
import csv
import json
import sys
import textwrap

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages
from matplotlib.patches import Circle, PathPatch, Rectangle, Polygon as MplPolygon
from matplotlib.path import Path as MplPath
import numpy as np
import shapely
from pyproj import Transformer
from shapely.geometry import shape
from shapely.ops import unary_union

INK, MUTED, RULE = "#1f2a24", "#55625a", "#c9d1cb"
plt.rcParams.update({"font.family": "DejaVu Sans", "pdf.fonttype": 42})
A3 = (16.54, 11.69); A4 = (8.27, 11.69)
to_utm = Transformer.from_crs("EPSG:4326", "EPSG:32643", always_xy=True).transform


def utm(geom):
    return shapely.transform(geom, lambda xy: np.column_stack(to_utm(xy[:, 0], xy[:, 1])))


def patch(geom, **kw):
    verts, codes = [], []
    for poly in ([geom] if geom.geom_type == "Polygon" else list(geom.geoms)):
        for ring in [poly.exterior] + list(poly.interiors):
            xy = list(ring.coords); verts += xy
            codes += [MplPath.MOVETO] + [MplPath.LINETO] * (len(xy) - 2) + [MplPath.CLOSEPOLY]
    return PathPatch(MplPath(verts, codes), **kw)


def header(fig, title, sub=None):
    fig.text(0.04, 0.955, title, fontsize=17, fontweight="bold", color=INK)
    if sub:
        fig.text(0.04, 0.93, sub, fontsize=9.5, color=MUTED)
    fig.add_artist(plt.Line2D([0.04, 0.96], [0.918, 0.918], color=INK, lw=1))


def main():
    gj, form, outp = sys.argv[1:4]
    blocks = [utm(shape(f["geometry"])) for f in json.load(open(gj))["features"]]
    rows = list(csv.DictReader(open(form, encoding="utf-8")))
    mains = [r for r in rows if r["role"] == "main"]; res = [r for r in rows if r["role"] != "main"]
    with PdfPages(outp) as pdf:
        # ---- 1. locator map
        fig = plt.figure(figsize=A3)
        header(fig, "FRPIM v2.2 accuracy assessment — Khedbrahma Range: field manual",
               f"{len(mains)} main plots (circles), {len(res)} reserve plots (squares), "
               f"{sum(r['qc_second_visit'] == 'yes' for r in rows)} plots for an independent second visit (ringed). "
               "Coordinates WGS 84. This manual is blind: it shows no model results.")
        ax = fig.add_axes([0.04, 0.05, 0.92, 0.85]); ax.set_aspect("equal"); ax.set_facecolor("#f3f5f2")
        u = unary_union(blocks)
        for g in blocks:
            ax.add_patch(patch(g, facecolor="#dfe5e0", edgecolor="white", lw=0.25))
        ax.add_patch(patch(u, facecolor="none", edgecolor=INK, lw=1.1))
        minx, miny, maxx, maxy = u.bounds; pad = 0.04 * max(maxx - minx, maxy - miny)
        ax.set_xlim(minx - pad, maxx + pad); ax.set_ylim(miny - pad, maxy + pad)
        for r in rows:
            x, y = float(r["utm_e"]), float(r["utm_n"]); main = r["role"] == "main"
            ax.plot(x, y, "o" if main else "s", ms=7 if main else 6, mfc="#2b83ba" if main else "#9e9e9e", mec=INK, mew=0.8, zorder=5)
            if r["qc_second_visit"] == "yes":
                ax.plot(x, y, "o", ms=14, mfc="none", mec="#d7301f", mew=1.6, zorder=6)
            ax.annotate(r["field_id"][3:], (x, y), xytext=(4, 4), textcoords="offset points", fontsize=6.8, zorder=7,
                        bbox=dict(boxstyle="round,pad=0.1", fc="white", ec="none", alpha=0.85))
        x0, x1 = ax.get_xlim(); y0, y1 = ax.get_ylim(); L = 5000; sx, sy = x0 + 0.03 * (x1 - x0), y0 + 0.03 * (y1 - y0)
        for i in range(4):
            ax.add_patch(Rectangle((sx + i * L / 4, sy), L / 4, 0.008 * (y1 - y0), fc=INK if i % 2 == 0 else "white", ec=INK, lw=0.6))
        ax.text(sx + L / 2, sy + 0.015 * (y1 - y0), "0 - 5 km", fontsize=8, ha="center")
        nx, ny, h = x1 - 0.04 * (x1 - x0), y1 - 0.11 * (y1 - y0), 0.06 * (y1 - y0)
        ax.add_patch(MplPolygon([(nx, ny + h), (nx - h * .22, ny), (nx, ny + h * .3)], closed=True, fc=INK))
        ax.add_patch(MplPolygon([(nx, ny + h), (nx + h * .22, ny), (nx, ny + h * .3)], closed=True, fc="white", ec=INK))
        ax.text(nx, ny + h * 1.06, "N", fontsize=12, fontweight="bold", ha="center")
        ax.set_xticks([]); ax.set_yticks([])
        pdf.savefig(fig); plt.close(fig)

        # ---- 2. point list
        per = 26
        for k in range(0, len(rows), per):
            fig = plt.figure(figsize=A3)
            header(fig, "Point list", "Visit main plots first. Use a reserve only for a main plot that cannot be reached, "
                   "in reserve-rank order (1 before 2), and only for the main plots listed in 'May replace'.")
            cols = [("Plot", .04), ("Role", .10), ("May replace", .17), ("QC 2nd", .30), ("Latitude", .35),
                    ("Longitude", .42), ("Lat (DMS)", .50), ("Long (DMS)", .60), ("Road km", .70),
                    ("Date", .75), ("Team", .81), ("Done", .87), ("Remarks", .91)]
            y = 0.885
            for c, x in cols:
                fig.text(x, y, c, fontsize=9.5, fontweight="bold", color=INK)
            fig.add_artist(plt.Line2D([0.04, 0.96], [y - 0.01, y - 0.01], color=INK, lw=0.8)); y -= 0.032
            for r in rows[k:k + per]:
                role = "main" if r["role"] == "main" else f"reserve {r['reserve_rank']}"
                vals = [r["field_id"], role, r["replaces_any_of"].replace("AC-", ""), r["qc_second_visit"], r["lat"],
                        r["lon"], r["lat_dms"], r["lon_dms"], r["road_km"], "", "", "", ""]
                for (c, x), v in zip(cols, vals):
                    fig.text(x, y, v, fontsize=8.8, color=INK)
                fig.add_artist(plt.Line2D([0.04, 0.96], [y - 0.01, y - 0.01], color=RULE, lw=0.5)); y -= 0.031
            pdf.savefig(fig); plt.close(fig)

        # ---- 3. plot layout
        fig = plt.figure(figsize=A4)
        header(fig, "Plot layout (all plots identical)")
        ax = fig.add_axes([0.12, 0.40, 0.76, 0.50]); ax.set_aspect("equal"); ax.set_xlim(-38, 38); ax.set_ylim(-38, 38)
        ax.add_patch(Circle((0, 0), 30, fc="#eef3ef", ec=INK, lw=1.2))
        for ang, lab in ((90, "N"), (0, "E"), (270, "S"), (180, "W")):
            dx, dy = np.cos(np.radians(ang)), np.sin(np.radians(ang))
            ax.plot([0, 30 * dx], [0, 30 * dy], color=INK, lw=1)
            ax.text(34 * dx, 34 * dy, lab, ha="center", va="center", fontsize=12, fontweight="bold")
            for d in (3, 9, 15, 21, 27):
                ax.plot(d * dx, d * dy, "o", ms=6, mfc="#2b83ba", mec=INK)
            ax.plot(20 * dx, 20 * dy, "^", ms=9, mfc="#d95f02", mec=INK)
        ax.plot(0, 0, "^", ms=11, mfc="#d95f02", mec=INK); ax.plot(0, 0, "+", ms=16, color=INK)
        ax.set_xticks([]); ax.set_yticks([]); [s.set_visible(False) for s in ax.spines.values()]
        txt = ("Plot centre = the given coordinate (navigate to within 5 m; record the GPS reading and its accuracy).\n"
               "Plot = 30 m radius circle (0.28 ha). Lay a 30 m tape from the centre towards N, E, S and W.\n\n"
               "Blue circles - 20 observation points at 3, 9, 15, 21 and 27 m on each line (numbered 1-5 N, 6-10 E, "
               "11-15 S, 16-20 W). At each point record:\n"
               "   canopy hit (1 = crown of a tree >= 5 m tall directly overhead, 0 = open sky),\n"
               "   ground code (B bare soil, R rock/stones, L litter, G grass/herb, S shrub),\n"
               "   invasive (1 = Lantana or Prosopis within 1 m, else 0).\n\n"
               "Orange triangles - soil depth: drive a crowbar or auger at the centre and at 20 m N, E, S, W; record "
               "depth to refusal in cm (stop at 100 cm).\n\n"
               "Whole plot - slope % (clinometer or phone, steepest direction through the centre), aspect (compass, "
               "degrees, direction the slope faces), landform, soil texture by feel, erosion, fire, grazing, cutting, "
               "and the % of the plot that is water, drain, rock outcrop, built-up or crop.\n\n"
               "Photos - five per plot: N, E, S, W from the centre, and one straight up. Write the photo numbers.")
        txt = "\n".join(textwrap.fill(par, 98, subsequent_indent="   " if par.startswith("   ") else "")
                        if par.strip() else "" for par in txt.split("\n"))
        fig.text(0.08, 0.37, txt, fontsize=8.4, color=INK, va="top", linespacing=1.4)
        pdf.savefig(fig); plt.close(fig)

        # ---- 4. recording codes
        fig = plt.figure(figsize=A4)
        header(fig, "Recording codes")
        codes = [
            ("Erosion (0-4)", "0 none · 1 sheet wash (exposed roots, pedestals) · 2 rills · 3 rills + small gullies (< 50 cm) · 4 active gullies"),
            ("Fire (0-2)", "0 no evidence · 1 old scars or charcoal · 2 burnt in the last season"),
            ("Grazing (0-2)", "0 none · 1 moderate (dung, browse) · 2 heavy (trampling, bare paths, browse lines)"),
            ("Cutting / lopping (0-2)", "0 none · 1 some stumps or lopped trees · 2 widespread cutting"),
            ("Landform", "RIDGE · UPPER (upper slope) · MID (mid slope) · LOWER (lower slope / foot slope) · VALLEY (valley floor, near drainage) · FLAT"),
            ("Texture by feel", "S sand · LS loamy sand · SL sandy loam · L loam · CL clay loam · C clay  (moisten a soil ball; "
                                "sand feels gritty and will not hold shape, clay is sticky and forms a long ribbon)"),
            ("Ground code", "B bare soil · R rock or stones · L litter · G grass / herb · S shrub"),
            ("Constraint %", "share of the 30 m plot that is open water, drainage channel, rock outcrop, built-up or crop"),
            ("If not reachable", "write the reason (no access, unsafe, private crop inside forest, etc.) and go to the reserve plot"),
            ("Blind rule", "do not look up the model maps before or during the visit; score only what you observe"),
        ]
        y = 0.88
        for k, v in codes:
            fig.text(0.06, y, k, fontsize=9.5, fontweight="bold", color=INK, va="top")
            w = textwrap.fill(v, 70)
            fig.text(0.32, y, w, fontsize=9, color=INK, va="top", linespacing=1.35)
            y -= 0.022 * (w.count("\n") + 1) + 0.025
        pdf.savefig(fig); plt.close(fig)

        # ---- 5. datasheet per plot
        for r in rows:
            fig = plt.figure(figsize=A4)
            header(fig, f"Datasheet - plot {r['field_id']}  ({'main' if r['role'] == 'main' else 'reserve ' + r['reserve_rank']}"
                   f"{', QC second visit' if r['qc_second_visit'] == 'yes' else ''})",
                   f"Lat {r['lat']}  Long {r['lon']}   ({r['lat_dms']}  {r['lon_dms']})   UTM 43N {r['utm_e']} E {r['utm_n']} N")
            y = 0.885
            for lab in ("Date", "Team / observer", "GPS at centre (lat, long, accuracy m)", "Photo numbers (N E S W up)"):
                fig.text(0.06, y, lab, fontsize=9, color=INK); fig.add_artist(plt.Line2D([0.38, 0.94], [y - 0.004, y - 0.004], color=RULE))
                y -= 0.03
            y -= 0.01
            fig.text(0.06, y, "Pt", fontsize=8.5, fontweight="bold"); fig.text(0.13, y, "Line, distance", fontsize=8.5, fontweight="bold")
            for x, lab in ((0.40, "Canopy 0/1"), (0.55, "Ground B R L G S"), (0.75, "Invasive 0/1")):
                fig.text(x, y, lab, fontsize=8.5, fontweight="bold")
            y -= 0.022
            for i in range(20):
                line = "NESW"[i // 5]; dist = [3, 9, 15, 21, 27][i % 5]
                fig.text(0.06, y, f"{i + 1}", fontsize=8.5); fig.text(0.13, y, f"{line} {dist} m", fontsize=8.5)
                for x in (0.40, 0.55, 0.75):
                    fig.patches.append(Rectangle((x, y - 0.004), 0.08, 0.016, transform=fig.transFigure, fill=False, ec=RULE))
                y -= 0.0205
            y -= 0.01
            items = ["Soil depth cm: centre ___  N ___  E ___  S ___  W ___",
                     "Slope % ____    Aspect (deg) ____    Landform ________    Texture ____",
                     "Erosion 0-4 ___   Fire 0-2 ___   Grazing 0-2 ___   Cutting 0-2 ___",
                     "Plot %: water ___ drain ___ rock outcrop ___ built ___ crop ___",
                     "Visited? yes / no.  If no, reason and reserve used: ______________________________",
                     "Remarks: ___________________________________________________________________"]
            for t in items:
                fig.text(0.06, y, t, fontsize=9.2, color=INK); y -= 0.028
            pdf.savefig(fig); plt.close(fig)
    print("pages written:", 1 + -(-len(rows) // 26) + 2 + len(rows))


if __name__ == "__main__":
    main()
