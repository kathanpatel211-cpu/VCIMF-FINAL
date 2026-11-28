"""Example treatment KMLs for the VanDrishti Sub-division 2 mock drill: per range one Phase 1-2 site (expected Green)
and one KML on dense forest / excluded land (expected Red), drawn on real FRPIM blocks.
Usage: python make_example_kmls.py SCORED_BLOCKS.geojson OUT_DIR"""
import json, random, sys
from shapely.geometry import shape
from shapely.ops import unary_union

src, out = sys.argv[1], sys.argv[2]
NAMES = {"Poshina": "Poshina", "Rdf Poshina": "RDF_Poshina", "Rdf Khedbrahma": "RDF_Khedbrahma", "Vadali": "Vadali"}
blocks = []
for f in json.load(open(src))["features"]:
    g = shape(f["geometry"])
    if g.geom_type == "GeometryCollection":
        g = unary_union([x for x in g.geoms if x.geom_type in ("Polygon", "MultiPolygon")])
    if not g.is_empty:
        blocks.append((g, f["properties"]))
random.seed(77)


def cluster(pool, allowed):
    seeds = [(g, p) for g, p in pool if int(p["phase_map"]) in allowed and float(p["block_area_ha"]) > 8]
    best, bs = None, -1
    for g, p in random.sample(seeds, min(150, len(seeds))):
        near = sorted([q for q, pp in pool if q.distance(g) < 0.0035 and int(pp["phase_map"]) in allowed], key=lambda q: q.distance(g))[:3] or [g]
        u = unary_union(near).buffer(0.0003).buffer(-0.0005).simplify(0.00008)
        if u.is_empty: continue
        if u.geom_type != "Polygon": u = max(u.geoms, key=lambda q: q.area)
        hit = [(q.intersection(u).area, int(pp["phase_map"])) for q, pp in pool if q.intersects(u)]
        share = sum(a for a, ph in hit if ph in allowed) / (sum(a for a, _ in hit) or 1)
        sc = share * min(1, u.area / 1.0e-5)
        if sc > bs: best, bs = u, sc
    return best


def kml(name, poly):
    co = " ".join(f"{x:.6f},{y:.6f},0" for x, y in poly.exterior.coords)
    return ('<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>' + name + '</name><Placemark><name>' + name +
            '</name><Polygon><outerBoundaryIs><LinearRing><coordinates>' + co + '</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark></Document></kml>\n')


for key, nm in NAMES.items():
    pool = [(g, p) for g, p in blocks if p["range"] == key]
    for tag, allowed in (("Green_Phase1-2", (1, 2)), ("Red_protected_or_excluded", (6, 7))):
        u = cluster(pool, allowed)
        if u is None:
            continue
        open(f"{out}/{nm}_{tag}.kml", "w").write(kml(f"{nm.replace('_', ' ')} example ({tag.split('_')[0]})", u))
        print(nm, tag, round(u.area * 1.1e10 / 1e4, 1), "ha approx")
