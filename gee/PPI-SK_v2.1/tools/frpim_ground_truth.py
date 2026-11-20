"""
FRPIM v2.2 — ground-truth sample for Map 1 (Restoration Need Index).

Stratified random sample, reproducible (seed 2026):
  * 6 main points + 2 reserve points per RNI class (Very Low ... Very High) = 30 + 10
  * only full 10 ha interior blocks that are not excluded or protected
  * blocks whose RNI lies clearly inside its class (upper 60 % of distance to the class breaks)
  * spread across the range (max-min distance selection)

Outputs (OUTPUT_DIR):
  FIELD set (blind - no model class shown):
    GT_RNI_field_points.kml   open in Google Earth / Google Maps / Avenza on a phone
    GT_RNI_field_points.gpx   load into a handheld GPS
    GT_RNI_field_form.csv     one row per point; staff fill the score columns
    GT_RNI_field_sheet.pdf    printable: locator map, coordinates, scoring guide
  OFFICE set (model answers, keep with the office):
    GT_RNI_office_points.csv  model class, RNI and need indicators per point
    GT_RNI_office_points.kml  points coloured by model class

Usage: python frpim_ground_truth.py blocks.geojson OUTPUT_DIR
"""
import csv
import json
import math
import random
import sys
import textwrap
from pathlib import Path
from xml.sax.saxutils import escape

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages
from matplotlib.patches import PathPatch, Rectangle, Polygon as MplPolygon
from matplotlib.path import Path as MplPath
import numpy as np
import shapely
from pyproj import Transformer
from shapely.geometry import shape
from shapely.ops import unary_union

SEED = 2026
N_MAIN, N_RESERVE = 6, 2
CLASS_NAMES = ["Very Low", "Low", "Moderate", "High", "Very High"]
CLASS_CODE = ["VL", "L", "M", "H", "VH"]
CLASS_COL = ["#ffffcc", "#fed976", "#fd8d3c", "#e31a1c", "#800026"]
INK, MUTED, RULE = "#1f2a24", "#55625a", "#c9d1cb"
plt.rcParams.update({"font.family": "DejaVu Sans", "pdf.fonttype": 42})

to_utm = Transformer.from_crs("EPSG:4326", "EPSG:32643", always_xy=True).transform
to_ll = Transformer.from_crs("EPSG:32643", "EPSG:4326", always_xy=True).transform


def utm(geom):
    return shapely.transform(geom, lambda xy: np.column_stack(to_utm(xy[:, 0], xy[:, 1])))


def dms(v, pos, neg):
    hemi = pos if v >= 0 else neg
    v = abs(v)
    d = int(v)
    m = int((v - d) * 60)
    s = (v - d - m / 60) * 3600
    return f"{d}°{m:02d}'{s:04.1f}\"{hemi}"


def load(path):
    data = json.load(open(path))
    out = []
    for f in data["features"]:
        p = f["properties"]
        g = utm(shape(f["geometry"]))
        out.append((g, p))
    return out


def select(blocks, rng):
    breaks = [float(x) for x in next(p for _, p in blocks if p["excluded"] == 0)["rni_breaks"].split(",")]
    lows = [-math.inf] + breaks
    highs = breaks + [math.inf]
    chosen = []
    for c in range(1, 6):
        cand = [(g, p) for g, p in blocks
                if p["excluded"] == 0 and int(p["need_class"]) == c and float(p["block_area_ha"]) >= 9.9]
        lo, hi = lows[c - 1], highs[c - 1]
        def margin(p):
            r = float(p["RNI"])
            return min(r - lo, hi - r)
        cand.sort(key=lambda gp: margin(gp[1]), reverse=True)
        keep = cand[:max(N_MAIN + N_RESERVE + 4, int(math.ceil(0.6 * len(cand))))]
        rng.shuffle(keep)
        pts = [gp[0].centroid if gp[0].contains(gp[0].centroid) else gp[0].representative_point() for gp in keep]
        picked = [0]
        while len(picked) < min(N_MAIN + N_RESERVE, len(keep)):
            best, best_d = None, -1
            for i in range(len(keep)):
                if i in picked:
                    continue
                d = min(pts[i].distance(pts[j]) for j in picked)
                if d > best_d:
                    best, best_d = i, d
            picked.append(best)
        for n, i in enumerate(picked):
            g, p = keep[i]
            pt = pts[i]
            lon, lat = to_ll(pt.x, pt.y)
            main = n < N_MAIN
            pid = f"RNI-{CLASS_CODE[c - 1]}-{n + 1:02d}" if main else f"RNI-{CLASS_CODE[c - 1]}-R{n - N_MAIN + 1}"
            chosen.append({
                "point_id": pid, "role": "main" if main else "reserve", "block_id": p["block_id"],
                "beat_id": p.get("beat_id", ""), "lat": round(lat, 6), "lon": round(lon, 6),
                "lat_dms": dms(lat, "N", "S"), "lon_dms": dms(lon, "E", "W"),
                "utm_e": round(pt.x, 1), "utm_n": round(pt.y, 1),
                "road_km": round(float(p.get("advisory_access_km") or -1), 2),
                "model_class": CLASS_NAMES[c - 1], "model_class_code": c, "RNI": round(float(p["RNI"]), 4),
                "canopy_pct_model": round(float(p.get("canopy_pct") or 0), 1),
                "veg_cover_peak_pct_model": round(100 * float(p.get("N2_fvc") or 0), 1),
                "bare_soil_share_model_pct": round(100 * float(p.get("N2_bsi_share") or 0), 1),
                "erosion_score_N4": round(float(p.get("N4") or 0), 3),
                "invasive_share_N7_pct": round(100 * float(p.get("N7_raw") or 0), 1),
                "degradation_evidence": p.get("degradation_evidence"),
                "intervention": p.get("intervention"), "phase": p.get("phase_code"),
                "_xy": (pt.x, pt.y),
            })
    return chosen, breaks


FIELD_COLS = ["point_id", "role", "block_id", "lat", "lon", "lat_dms", "lon_dms", "utm_e", "utm_n", "road_km",
              "visit_date", "team", "gps_lat_found", "gps_lon_found", "photo_N_E_S_W_ids",
              "canopy_score_0_4", "bare_soil_score_0_4", "erosion_score_0_4", "invasive_score_0_4",
              "disturbance_score_0_4", "field_need_class_VL_L_M_H_VH", "remarks"]
GUIDE = [
    ("Canopy cover (trees >= 5 m)", "0: >= 30 %   1: 20-30 %   2: 10-20 %   3: 5-10 %   4: < 5 %"),
    ("Bare soil (ground not covered)", "0: < 10 %   1: 10-25 %   2: 25-50 %   3: 50-75 %   4: > 75 %"),
    ("Soil erosion", "0: none   1: sheet wash   2: rills   3: rills + small gullies   4: active gullies"),
    ("Invasive shrubs (Lantana / Prosopis)", "0: none   1: few plants   2: scattered patches   3: > 25 % cover   4: dense thicket"),
    ("Cutting, lopping, grazing, fire", "0: none   1: light   2: moderate   3: heavy   4: very heavy / recent fire"),
]


def write_csv(path, rows, cols):
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow(r)


def kml(path, rows, office):
    def style(i, col):
        c = col.lstrip("#")
        abgr = "ff" + c[4:6] + c[2:4] + c[0:2]
        return (f'<Style id="s{i}"><IconStyle><color>{abgr}</color><scale>1.1</scale>'
                '<Icon><href>http://maps.google.com/mapfiles/kml/paddle/wht-blank.png</href></Icon></IconStyle>'
                '<LabelStyle><scale>0.8</scale></LabelStyle></Style>')
    styles = "".join(style(i + 1, c) for i, c in enumerate(CLASS_COL)) + style(0, "#2b83ba") + style(9, "#999999")
    pms = []
    for r in rows:
        sid = (f"s{r['model_class_code']}" if office else ("s0" if r["role"] == "main" else "s9"))
        desc = [f"Block {r['block_id']} ({r['role']} point)", f"Lat/Long: {r['lat']}, {r['lon']}",
                f"{r['lat_dms']}  {r['lon_dms']}", f"UTM 43N: {r['utm_e']} E, {r['utm_n']} N",
                f"Nearest mapped road: about {r['road_km']} km"]
        if office:
            desc += [f"MODEL class: {r['model_class']} (RNI {r['RNI']})", f"Canopy (model): {r['canopy_pct_model']} %",
                     f"Bare-soil share (model): {r['bare_soil_share_model_pct']} %", f"Erosion score N4: {r['erosion_score_N4']}",
                     f"Invasive share N7: {r['invasive_share_N7_pct']} %"]
        else:
            desc += ["Score: canopy, bare soil, erosion, invasive shrubs, disturbance (0-4 each).",
                     "Take 4 photos (N, E, S, W) from the point."]
        pms.append(f"<Placemark><name>{escape(r['point_id'])}</name><styleUrl>#{sid}</styleUrl>"
                   f"<description>{escape('<br/>'.join(desc))}</description>"
                   f"<Point><coordinates>{r['lon']},{r['lat']},0</coordinates></Point></Placemark>")
    name = "FRPIM RNI ground truth - OFFICE (model classes)" if office else "FRPIM RNI ground truth - FIELD"
    Path(path).write_text('<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document>'
                          f"<name>{escape(name)}</name>{styles}{''.join(pms)}</Document></kml>", encoding="utf-8")


def gpx(path, rows):
    wps = "".join(f'<wpt lat="{r["lat"]}" lon="{r["lon"]}"><name>{escape(r["point_id"])}</name>'
                  f'<desc>{escape("Block " + r["block_id"] + " - " + r["role"])}</desc><sym>Flag, Blue</sym></wpt>'
                  for r in rows)
    Path(path).write_text('<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="FRPIM v2.2" '
                          'xmlns="http://www.topografix.com/GPX/1/1">' + wps + "</gpx>", encoding="utf-8")


def geom_patch(geom, **kw):
    verts, codes = [], []
    polys = [geom] if geom.geom_type == "Polygon" else list(geom.geoms)
    for poly in polys:
        for ring in [poly.exterior] + list(poly.interiors):
            xy = list(ring.coords)
            verts.extend(xy)
            codes.extend([MplPath.MOVETO] + [MplPath.LINETO] * (len(xy) - 2) + [MplPath.CLOSEPOLY])
    return PathPatch(MplPath(verts, codes), **kw)


def locator(ax, blocks, rows, office):
    union = unary_union([g for g, _ in blocks])
    minx, miny, maxx, maxy = union.bounds
    pad = 0.05 * max(maxx - minx, maxy - miny)
    ax.set_xlim(minx - pad, maxx + pad); ax.set_ylim(miny - pad, maxy + pad); ax.set_aspect("equal")
    ax.set_facecolor("#f3f5f2")
    for g, p in blocks:
        if office and p["excluded"] == 0:
            fc = CLASS_COL[int(p["need_class"]) - 1]
        else:
            fc = "#dfe5e0" if p["excluded"] == 0 else "#c2c2c2"
        ax.add_patch(geom_patch(g, facecolor=fc, edgecolor="#ffffff", lw=0.25, zorder=2))
    ax.add_patch(geom_patch(union, facecolor="none", edgecolor=INK, lw=1.2, zorder=3))
    for r in rows:
        x, y = r["_xy"]
        mk = "o" if r["role"] == "main" else "s"
        ax.plot(x, y, mk, ms=7.5, mfc="#2b83ba" if not office else "#ffffff", mec=INK, mew=1.0, zorder=5)
        ax.annotate(r["point_id"].replace("RNI-", "").replace("GT-", ""), (x, y), xytext=(4, 4), textcoords="offset points",
                    fontsize=6.6, color=INK, zorder=6,
                    bbox=dict(boxstyle="round,pad=0.12", fc="white", ec="none", alpha=0.8))
    x0, x1 = ax.get_xlim(); y0, y1 = ax.get_ylim()
    L = 5000
    sx, sy = x0 + 0.04 * (x1 - x0), y0 + 0.04 * (y1 - y0)
    for i in range(4):
        ax.add_patch(Rectangle((sx + i * L / 4, sy), L / 4, 0.01 * (y1 - y0), facecolor=INK if i % 2 == 0 else "white",
                               edgecolor=INK, lw=0.6, zorder=6))
    ax.text(sx + L / 2, sy + 0.02 * (y1 - y0), "0 - 5 km", fontsize=7.5, ha="center", color=INK, zorder=6)
    nx, ny, h = x1 - 0.05 * (x1 - x0), y1 - 0.12 * (y1 - y0), 0.06 * (y1 - y0)
    ax.add_patch(MplPolygon([(nx, ny + h), (nx - h * 0.22, ny), (nx, ny + h * 0.3)], closed=True, fc=INK, ec=INK, zorder=6))
    ax.add_patch(MplPolygon([(nx, ny + h), (nx + h * 0.22, ny), (nx, ny + h * 0.3)], closed=True, fc="white", ec=INK, zorder=6))
    ax.text(nx, ny + h * 1.08, "N", fontsize=12, fontweight="bold", ha="center", va="bottom", color=INK, zorder=6)
    ax.set_xticks([]); ax.set_yticks([])


def field_pdf(path, blocks, rows):
    with PdfPages(path) as pdf:
        # page 1: locator map
        fig = plt.figure(figsize=(16.54, 11.69))
        fig.text(0.03, 0.95, "Ground-truth points — Map 1 Restoration Need (field sheet)", fontsize=20, fontweight="bold", color=INK)
        fig.text(0.03, 0.915, f"Khedbrahma Range · {sum(r['role'] == 'main' for r in rows)} main points (circles) + "
                 f"{sum(r['role'] == 'reserve' for r in rows)} reserve points (squares). Visit a reserve point only if a "
                 "main point cannot be reached; note why.", fontsize=11, color=MUTED)
        ax = fig.add_axes([0.03, 0.06, 0.94, 0.83])
        locator(ax, blocks, rows, office=False)
        fig.text(0.03, 0.03, "Points are at the centre of full 10 ha blocks. Coordinates: WGS 84. "
                 "This field sheet deliberately does not show the model's class (blind check).", fontsize=8.5, color=MUTED)
        pdf.savefig(fig); plt.close(fig)
        # pages 2+: coordinate table
        per = 22
        for k in range(0, len(rows), per):
            fig = plt.figure(figsize=(16.54, 11.69))
            fig.text(0.03, 0.95, "Point list — coordinates", fontsize=16, fontweight="bold", color=INK)
            cols = ["Point", "Role", "Block ID", "Latitude", "Longitude", "Lat (DMS)", "Long (DMS)", "Road km",
                    "Can.", "Bare", "Eros.", "Inv.", "Dist.", "Remarks"]
            xs = [0.03, 0.115, 0.165, 0.29, 0.36, 0.435, 0.53, 0.625, 0.672, 0.712, 0.752, 0.792, 0.832, 0.872]
            y = 0.90
            for x, c in zip(xs, cols):
                fig.text(x, y, c, fontsize=9.5, fontweight="bold", color=INK)
            fig.add_artist(plt.Line2D([0.03, 0.97], [y - 0.012, y - 0.012], color=INK, lw=0.8))
            y -= 0.036
            for r in rows[k:k + per]:
                vals = [r["point_id"], r["role"], r["block_id"], f"{r['lat']:.6f}", f"{r['lon']:.6f}", r["lat_dms"],
                        r["lon_dms"], f"{r['road_km']:.1f}" if r["road_km"] >= 0 else "-", "", "", "", "", "", ""]
                for x, v in zip(xs, vals):
                    fig.text(x, y, v, fontsize=9.2, color=INK)
                for x in xs[8:13]:
                    fig.patches.append(Rectangle((x - 0.003, y - 0.008), 0.032, 0.026, transform=fig.transFigure,
                                                 fill=False, ec=RULE, lw=0.8))
                fig.add_artist(plt.Line2D([0.03, 0.97], [y - 0.012, y - 0.012], color=RULE, lw=0.5))
                y -= 0.037
            fig.text(0.03, 0.03, "Can. = canopy, Bare = bare soil, Eros. = erosion, Inv. = invasive shrubs, "
                     "Dist. = cutting/grazing/fire — each scored 0-4 (see scoring guide).", fontsize=8.5, color=MUTED)
            pdf.savefig(fig); plt.close(fig)
        # last page: scoring guide and procedure
        fig = plt.figure(figsize=(16.54, 11.69))
        fig.text(0.03, 0.95, "Scoring guide and field procedure", fontsize=16, fontweight="bold", color=INK)
        y = 0.89
        for name, rule in GUIDE:
            fig.text(0.03, y, name, fontsize=11.5, fontweight="bold", color=INK)
            fig.text(0.30, y, rule, fontsize=11.5, color=INK)
            y -= 0.05
        y -= 0.02
        proc = [
            "1. Navigate to the point with GPS (KML in Google Earth / Avenza, or GPX in a handheld GPS). Record the coordinates where you stand.",
            "2. Assess a circle of about 50 m radius (about 0.8 ha) around the point, and walk the block if possible.",
            "3. Score each of the five indicators 0-4 using the guide above. Score what you see, not what you expect.",
            "4. Give your overall judgement of restoration need: Very Low, Low, Moderate, High or Very High (compared with the other points you visit).",
            "5. Take four photos from the point facing North, East, South and West; write the photo numbers on the sheet.",
            "6. If the point is unsafe or unreachable, write why and visit the reserve point of the same group.",
            "7. Return the completed field form (CSV or this sheet). The office compares it with the model (blind check).",
        ]
        for line in proc:
            fig.text(0.03, y, textwrap.fill(line, 150), fontsize=11, color=INK, va="top")
            y -= 0.05
        fig.text(0.03, 0.08, "How the result is reported: field degradation score = mean of the five indicator scores (0-4). "
                 "The office reports (a) Spearman rank correlation between field score and model RNI, and (b) whether "
                 "the mean field score rises from Very Low to Very High model class.", fontsize=10, color=MUTED)
        pdf.savefig(fig); plt.close(fig)


def main():
    src, out = Path(sys.argv[1]), Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    blocks = load(src)
    rows, breaks = select(blocks, random.Random(SEED))
    rows.sort(key=lambda r: (r["model_class_code"], r["role"] != "main", r["point_id"]))
    # Field IDs are neutral (GT-01 ... north to south) so nothing in the field set reveals the model class.
    field_rows = sorted(rows, key=lambda r: (r["role"] != "main", -r["lat"]))
    nm = nr = 0
    for r in field_rows:
        if r["role"] == "main":
            nm += 1; r["field_id"] = f"GT-{nm:02d}"
        else:
            nr += 1; r["field_id"] = f"GT-R{nr:02d}"
    blind = [dict(r, point_id=r["field_id"]) for r in field_rows]
    write_csv(out / "GT_RNI_field_form.csv", blind, FIELD_COLS)
    write_csv(out / "GT_RNI_office_points.csv", rows,
              ["field_id", "point_id", "role", "block_id", "lat", "lon", "lat_dms", "lon_dms", "utm_e", "utm_n", "road_km",
               "model_class", "model_class_code", "RNI", "canopy_pct_model", "veg_cover_peak_pct_model",
               "bare_soil_share_model_pct", "erosion_score_N4", "invasive_share_N7_pct", "degradation_evidence",
               "intervention", "phase"])
    kml(out / "GT_RNI_field_points.kml", blind, office=False)
    kml(out / "GT_RNI_office_points.kml", [dict(r, point_id=r["field_id"] + " (" + r["point_id"] + ")") for r in rows], office=True)
    gpx(out / "GT_RNI_field_points.gpx", blind)
    field_pdf(out / "GT_RNI_field_sheet.pdf", blocks, blind)
    print("RNI breaks:", breaks)
    for r in rows:
        print(f"{r['field_id']:<7} {r['point_id']:<12} {r['role']:<8} {r['model_class']:<9} RNI {r['RNI']:.4f}  {r['lat']:.6f}, {r['lon']:.6f}  road {r['road_km']} km")


if __name__ == "__main__":
    main()
