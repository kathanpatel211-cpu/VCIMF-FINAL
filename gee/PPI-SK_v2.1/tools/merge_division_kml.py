"""
Merge forest polygons of a division KML by Division, Range, Round and Beat.

Reads a KML whose placemarks carry SimpleData fields RANGE, ROUND, BEAT, DIVISION (as in
Forest_Sabarkantha.kml), repairs invalid geometry, and writes for each level:
  <prefix>_by_<Level>.kml   one styled multi-part feature per unit, attributes + area table
  <prefix>_by_<Level>.zip   the same as an ESRI shapefile (WGS 84) for Google Earth Engine
plus the cleaned original polygons (<prefix>_polygons_clean.kml / .zip), a summary CSV and
an overview map PNG.

Areas are true hectares in WGS 84 / UTM 43N (EPSG:32643).
Usage : python merge_division_kml.py INPUT.kml OUTPUT_DIR [PREFIX] [--division "NAME"] [--range-map "Old=New,Old2=New"]
        --division sets one division name for every polygon; --range-map renames / merges ranges.
        The original values are kept in ORIG_DIV and ORIG_RANGE.
Needs : shapely>=2, pyproj, numpy, pyshp, matplotlib
"""
import collections
import csv
import io
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

import numpy as np
import shapely
from shapely.geometry import Polygon, MultiPolygon
from pyproj import Transformer
import shapefile  # pyshp

NS = "{http://www.opengis.net/kml/2.2}"
TO_UTM = Transformer.from_crs(4326, 32643, always_xy=True).transform
PRJ_WGS84 = ('GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],'
             'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]')
PALETTE = ["#1b9e77", "#d95f02", "#7570b3", "#e7298a", "#66a61e", "#e6ab02", "#a6761d", "#1f78b4", "#b2df8a",
           "#fb9a99", "#cab2d6", "#ff7f00", "#6a3d9a", "#b15928", "#33a02c", "#e31a1c", "#a6cee3", "#fdbf6f"]


def ring(txt):
    return [tuple(map(float, t.split(",")[:2])) for t in txt.split()]


def polygons_only(g):
    if g.is_empty:
        return g
    if g.geom_type in ("Polygon", "MultiPolygon"):
        return g
    parts = [p for p in getattr(g, "geoms", []) if p.geom_type in ("Polygon", "MultiPolygon")]
    return shapely.union_all(parts) if parts else Polygon()


def read(path):
    root = ET.parse(path).getroot()
    recs = []
    for pm in root.iter(NS + "Placemark"):
        a = {sd.get("name"): (sd.text or "").strip() for sd in pm.iter(NS + "SimpleData")}
        polys = []
        for pg in pm.iter(NS + "Polygon"):
            ob = pg.find(f"{NS}outerBoundaryIs/{NS}LinearRing/{NS}coordinates")
            holes = [ring(h.text) for h in pg.findall(f"{NS}innerBoundaryIs/{NS}LinearRing/{NS}coordinates")]
            polys.append(Polygon(ring(ob.text), holes))
        g = MultiPolygon(polys) if len(polys) > 1 else polys[0]
        fixed = not g.is_valid
        g = polygons_only(shapely.make_valid(g)) if fixed else g
        recs.append({"a": a, "g": g, "fixed": fixed})
    return recs


def utm_area_ha(g):
    return shapely.transform(g, lambda xy: np.column_stack(TO_UTM(xy[:, 0], xy[:, 1]))).area / 1e4


def kml_color(hexcol, alpha):
    h = hexcol.lstrip("#")
    return f"{alpha:02x}{h[4:6]}{h[2:4]}{h[0:2]}"


def coords_txt(r):
    return " ".join(f"{x:.7f},{y:.7f},0" for x, y in r.coords)


def geom_kml(g):
    parts = [g] if g.geom_type == "Polygon" else list(g.geoms)
    out = ["<MultiGeometry>"] if len(parts) > 1 else []
    for p in parts:
        out.append("<Polygon><outerBoundaryIs><LinearRing><coordinates>" + coords_txt(p.exterior) + "</coordinates></LinearRing></outerBoundaryIs>")
        for h in p.interiors:
            out.append("<innerBoundaryIs><LinearRing><coordinates>" + coords_txt(h) + "</coordinates></LinearRing></innerBoundaryIs>")
        out.append("</Polygon>")
    if len(parts) > 1:
        out.append("</MultiGeometry>")
    return "".join(out)


def write_kml(path, title, units, fields, folder_key=None, colour_key=None):
    """units: list of dicts with 'name', 'geom', and the attribute fields."""
    keys = sorted({u[colour_key] for u in units}) if colour_key else [u["name"] for u in units]
    col = {k: PALETTE[i % len(PALETTE)] for i, k in enumerate(keys)}
    L = ['<?xml version="1.0" encoding="UTF-8"?>', '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>',
         f"<name>{escape(title)}</name>"]
    for k, c in col.items():
        sid = "s" + str(keys.index(k))
        L.append(f'<Style id="{sid}"><LineStyle><color>{kml_color(c, 255)}</color><width>2</width></LineStyle>'
                 f'<PolyStyle><color>{kml_color(c, 110)}</color></PolyStyle></Style>')
    groups = collections.OrderedDict()
    for u in units:
        groups.setdefault(u[folder_key] if folder_key else "", []).append(u)
    for gname, us in groups.items():
        if folder_key:
            L.append(f"<Folder><name>{escape(gname)}</name>")
        for u in us:
            k = u[colour_key] if colour_key else u["name"]
            rows = "".join(f"<tr><th align='left'>{escape(f)}</th><td>{escape(str(u[f]))}</td></tr>" for f in fields)
            L.append(f"<Placemark><name>{escape(u['name'])}</name><styleUrl>#s{keys.index(k)}</styleUrl>"
                     f"<description><![CDATA[<table>{rows}</table>]]></description><ExtendedData>"
                     + "".join(f'<Data name="{escape(f)}"><value>{escape(str(u[f]))}</value></Data>' for f in fields)
                     + "</ExtendedData>" + geom_kml(u["geom"]) + "</Placemark>")
        if folder_key:
            L.append("</Folder>")
    L.append("</Document></kml>")
    Path(path).write_text("\n".join(L), encoding="utf-8")


def write_shp_zip(path, units, fields, types):
    shp, shx, dbf = io.BytesIO(), io.BytesIO(), io.BytesIO()
    w = shapefile.Writer(shp=shp, shx=shx, dbf=dbf, shapeType=shapefile.POLYGON)
    for f in fields:
        t = types.get(f, "C")
        if t == "N":
            w.field(f[:10], "N", 14, 3)
        elif t == "I":
            w.field(f[:10], "N", 9, 0)
        else:
            w.field(f[:10], "C", 120)
    for u in units:
        g = u["geom"]
        parts = []
        for p in ([g] if g.geom_type == "Polygon" else g.geoms):
            ext = shapely.geometry.polygon.orient(p, sign=-1.0)   # shapefile: outer ring clockwise
            parts.append(list(ext.exterior.coords))
            parts.extend(list(h.coords) for h in ext.interiors)
        w.poly(parts)
        w.record(*[u[f] for f in fields])
    w.close()
    stem = Path(path).stem
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(stem + ".shp", shp.getvalue()); z.writestr(stem + ".shx", shx.getvalue())
        z.writestr(stem + ".dbf", dbf.getvalue()); z.writestr(stem + ".prj", PRJ_WGS84)
        z.writestr(stem + ".cpg", "UTF-8")


def merge(recs, keyfn, namefn):
    groups = collections.OrderedDict()
    for r in sorted(recs, key=lambda r: keyfn(r["a"])):
        groups.setdefault(keyfn(r["a"]), []).append(r)
    units = []
    for k, rs in groups.items():
        g = polygons_only(shapely.make_valid(shapely.union_all([r["g"] for r in rs])))
        a0 = rs[0]["a"]
        units.append({"key": k, "name": namefn(a0), "geom": g, "n_polygons": len(rs),
                      "parts": 1 if g.geom_type == "Polygon" else len(g.geoms), "area_ha": round(utm_area_ha(g), 2),
                      "DIVISION": a0.get("DIVISION", ""), "RANGE": a0.get("RANGE", ""), "ORIG_RANGE": ", ".join(sorted({r["a"].get("ORIG_RANGE", "") for r in rs})),
                      "ROUND": a0.get("ROUND", "") or "Unassigned", "BEAT": a0.get("BEAT", "") or "Unassigned",
                      "n_rounds": len({r["a"].get("ROUND", "") or "Unassigned" for r in rs}),
                      "n_beats": len({(r["a"].get("ROUND", ""), r["a"].get("BEAT", "") or "Unassigned") for r in rs})})
    return units


def overview_png(path, ranges, title):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.patches import PathPatch
    from matplotlib.path import Path as MPath
    fig, ax = plt.subplots(figsize=(11.69, 8.27), dpi=200)
    for i, u in enumerate(ranges):
        g = shapely.transform(u["geom"], lambda xy: np.column_stack(TO_UTM(xy[:, 0], xy[:, 1])))
        for p in ([g] if g.geom_type == "Polygon" else g.geoms):
            v, c = [], []
            for r in [p.exterior] + list(p.interiors):
                xy = list(r.coords); v += xy; c += [MPath.MOVETO] + [MPath.LINETO] * (len(xy) - 2) + [MPath.CLOSEPOLY]
            ax.add_patch(PathPatch(MPath(v, c), facecolor=PALETTE[i % len(PALETTE)], edgecolor="#333", lw=0.25))
        ax.plot([], [], "s", color=PALETTE[i % len(PALETTE)], label=f"{u['name']}  ({u['area_ha']:,.0f} ha)")
    ax.autoscale(); ax.set_aspect("equal"); ax.set_xticks([]); ax.set_yticks([])
    ax.set_title(title, fontsize=13, fontweight="bold", loc="left")
    ax.legend(loc="center left", bbox_to_anchor=(1.01, 0.5), frameon=False, fontsize=9)
    fig.tight_layout(); fig.savefig(path); plt.close(fig)


def main():
    args, opts = [], {}
    it = iter(sys.argv[1:])
    for x in it:
        if x.startswith("--"):
            opts[x[2:]] = next(it)
        else:
            args.append(x)
    src, out = Path(args[0]), Path(args[1])
    prefix = args[2] if len(args) > 2 else "Division"
    out.mkdir(parents=True, exist_ok=True)
    recs = read(src)
    print(f"{len(recs)} polygons read, {sum(r['fixed'] for r in recs)} repaired")
    rmap = dict(kv.split("=", 1) for kv in opts.get("range-map", "").split(",") if "=" in kv)
    for r in recs:
        a = r["a"]
        a["ORIG_DIV"], a["ORIG_RANGE"] = a.get("DIVISION", ""), a.get("RANGE", "")
        if "division" in opts:
            a["DIVISION"] = opts["division"]
        a["RANGE"] = rmap.get(a.get("RANGE", ""), a.get("RANGE", ""))
    if rmap or "division" in opts:
        print("ranges now:", sorted({r["a"]["RANGE"] for r in recs}), "| divisions:", sorted({r["a"]["DIVISION"] for r in recs}))
    levels = [
        ("Division", lambda a: (a.get("DIVISION", ""),), lambda a: a.get("DIVISION", ""), None, ["DIVISION", "n_polygons", "parts", "area_ha"]),
        ("Range", lambda a: (a.get("DIVISION", ""), a.get("RANGE", "")), lambda a: a.get("RANGE", ""), "DIVISION",
         ["RANGE", "DIVISION", "ORIG_RANGE", "n_polygons", "parts", "n_rounds", "n_beats", "area_ha"]),
        ("Round", lambda a: (a.get("DIVISION", ""), a.get("RANGE", ""), a.get("ROUND", "") or "Unassigned"),
         lambda a: a.get("ROUND", "") or "Unassigned", "RANGE", ["ROUND", "RANGE", "ORIG_RANGE", "DIVISION", "n_polygons", "parts", "n_beats", "area_ha"]),
        ("Beat", lambda a: (a.get("DIVISION", ""), a.get("RANGE", ""), a.get("ROUND", "") or "Unassigned", a.get("BEAT", "") or "Unassigned"),
         lambda a: a.get("BEAT", "") or "Unassigned", "RANGE", ["BEAT", "ROUND", "RANGE", "ORIG_RANGE", "DIVISION", "n_polygons", "parts", "area_ha"]),
    ]
    types = {"n_polygons": "I", "parts": "I", "n_rounds": "I", "n_beats": "I", "area_ha": "N"}
    result = {}
    for lvl, keyfn, namefn, folder, fields in levels:
        units = merge(recs, keyfn, namefn)
        result[lvl] = units
        write_kml(out / f"{prefix}_by_{lvl}.kml", f"{prefix} forest by {lvl.lower()}", units, fields, folder_key=folder,
                  colour_key="RANGE" if lvl in ("Round", "Beat") else None)
        write_shp_zip(out / f"{prefix}_by_{lvl}.zip", units, fields, types)
        print(f"{lvl}: {len(units)} features, {sum(u['area_ha'] for u in units):,.1f} ha")
    # cleaned original polygons, standard fields, for Earth Engine
    keep = ["SNO", "F_SNO", "VNAME", "TNAME", "F_TYPE", "SECTION", "COMPARTMEN", "FG_AREA_Ha"]
    clean = []
    for i, r in enumerate(recs):
        a = r["a"]
        u = {"name": f"{a.get('RANGE', '')} / {a.get('BEAT', '') or 'Unassigned'} / {a.get('F_SNO', '') or i + 1}", "geom": r["g"],
             "POLY_ID": i + 1, "DIVISION": a.get("DIVISION", ""), "RANGE": a.get("RANGE", ""), "ORIG_RANGE": a.get("ORIG_RANGE", ""), "ORIG_DIV": a.get("ORIG_DIV", ""), "ROUND": a.get("ROUND", "") or "Unassigned",
             "BEAT": a.get("BEAT", "") or "Unassigned", "area_ha": round(utm_area_ha(r["g"]), 3), "repaired": "yes" if r["fixed"] else "no"}
        for k in keep:
            u[k] = a.get(k, "")
        clean.append(u)
    cf = ["POLY_ID", "DIVISION", "RANGE", "ROUND", "BEAT", "ORIG_RANGE", "ORIG_DIV"] + keep + ["area_ha", "repaired"]
    write_kml(out / f"{prefix}_polygons_clean.kml", f"{prefix} forest polygons (cleaned)", clean, cf, folder_key="RANGE", colour_key="RANGE")
    write_shp_zip(out / f"{prefix}_polygons_clean.zip", clean, cf, dict(types, POLY_ID="I"))
    with open(out / f"{prefix}_summary.csv", "w", newline="", encoding="utf-8-sig") as f:
        w = csv.writer(f)
        w.writerow(["Level", "Division", "Range", "Round", "Beat", "Included former ranges", "Polygons", "Separate parts", "Area (ha)"])
        for lvl in ("Division", "Range", "Round", "Beat"):
            for u in result[lvl]:
                w.writerow([lvl, u["DIVISION"], u["RANGE"] if lvl != "Division" else "", u["ROUND"] if lvl in ("Round", "Beat") else "",
                            u["BEAT"] if lvl == "Beat" else "", u["ORIG_RANGE"] if lvl != "Division" else "", u["n_polygons"], u["parts"], u["area_ha"]])
    overview_png(out / f"{prefix}_ranges_overview.png", result["Range"], f"{prefix}: forest area by range")
    return result


if __name__ == "__main__":
    main()
