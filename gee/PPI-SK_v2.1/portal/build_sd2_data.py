"""Data for the VanDrishti Sub-division 2 portal from the scored FRPIM blocks.
Usage: python build_sd2_data.py SCORED_BLOCKS.geojson OUT_DIR
Writes blocks.json (one record per line), ranges.json (outlines + stats), samples.json (example work polygons)."""
import json, sys, random
from collections import defaultdict
from shapely.geometry import shape, mapping, Polygon, MultiPolygon
from shapely.ops import unary_union

RANGES = [("Poshina", "POS", "Poshina"), ("Rdf Poshina", "RPO", "RDF Poshina"), ("Rdf Khedbrahma", "RKB", "RDF Khedbrahma"), ("Vadali", "VAD", "Vadali")]
RXC = {"SMC_DROUGHT_HARDY": "S", "BLANK_AREA_PLANTATION": "B", "ANR_GAP_PLANTING": "A", "PROTECT_DENSE": "P", "NOT_PLANTABLE": "X",
       "SOIL_STABILISATION_FIRST": "T", "HYDRO_COMPATIBLE_PLANTING": "H", "INVASIVE_CLEAR_THEN_PLANT": "I", "FIRE_PROTECTION_FIRST": "F",
       "MIXED_NATIVE_PLANTATION": "M", "ROCKY_MICROSITE": "R"}
SGC = {"Drought-hardy": "D", "Medium": "M", "Moist/deep": "W", "Riparian": "R", "Native grasses and shrubs first, then khair and ber": "G", "-": "-"}
src, out = sys.argv[1], sys.argv[2]
feats = json.load(open(src))["features"]
ridx = {r[0]: i for i, r in enumerate(RANGES)}

def rnd(geom, nd=5):
    def ring(r): 
        pts = [[round(x, nd), round(y, nd)] for x, y in r.coords]
        dedup = [pts[0]] + [p for a, p in zip(pts, pts[1:]) if p != a]
        return dedup
    polys = [geom] if geom.geom_type == "Polygon" else list(geom.geoms)
    cc = [[ring(p.exterior)] + [ring(i) for i in p.interiors] for p in polys if p.geom_type == "Polygon" and not p.is_empty]
    return ("P", cc[0]) if len(cc) == 1 else ("M", cc)

recs, geoms = [], []
for f in feats:
    p = f["properties"]
    g = shape(f["geometry"])
    if g.geom_type == "GeometryCollection":
        g = unary_union([x for x in g.geoms if x.geom_type in ("Polygon", "MultiPolygon")])
    if g.is_empty: continue
    g = g.simplify(0.00002, preserve_topology=True)
    t, c = rnd(g)
    c0 = g.centroid
    ex = int(p["excluded"])
    recs.append({"id": p["block_id"], "r": ridx[p["range"]], "bt": p.get("beat") or "-", "p": int(p["phase_map"]), "n": int(p["need_map"]), "f": int(p["feas_map"]),
                 "rni": round(float(p["RNI"]), 4) if not ex else 0, "rfi": round(float(p["RFI"]), 4) if not ex else 0,
                 "rx": RXC[p["intervention"]], "sg": SGC.get(p["species_group"].split(":")[0], "-"), "smc": 1 if p["smc_required"] == "yes" else 0,
                 "ha": round(float(p["net_plantable_ha"] or 0), 2), "ga": round(float(p["block_area_ha"] or 0), 2), "cp": round(float(p.get("canopy_pct") or 0), 1),
                 "st": round(float(p.get("stability_p12") or 0), 3), "x": round(c0.x, 5), "y": round(c0.y, 5), "t": t, "c": c})
    geoms.append((ridx[p["range"]], g, p))
with open(f"{out}/blocks.json", "w") as fh:
    fh.write("[\n" + ",\n".join(json.dumps(r, separators=(",", ":")) for r in recs) + "\n]\n")

rng_out = []
for i, (key, code, name) in enumerate(RANGES):
    gs = [g for r, g, _ in geoms if r == i]
    ps = [p for r, _, p in geoms if r == i]
    u = unary_union([g.buffer(0.0009) for g in gs]).buffer(-0.0009).simplify(0.0004)
    polys = [u] if u.geom_type == "Polygon" else list(u.geoms)
    outline = MultiPolygon([Polygon(q.exterior) for q in polys if q.area > 2e-6])
    big = max(polys, key=lambda q: q.area)
    lab = big.representative_point()
    net = lambda l: sum(float(p["net_plantable_ha"] or 0) for p in l)
    ret = [p for p in ps if int(p["excluded"]) == 0]
    ph = {k: round(net([p for p in ret if int(p["phase_map"]) == k]), 1) for k in range(1, 6)}
    beats = defaultdict(float)
    for p in ret:
        if int(p["phase_code"]) in (1, 2): beats[p.get("beat") or "-"] += float(p["net_plantable_ha"] or 0)
    rng_out.append({"key": key, "code": code, "name": name, "blocks": len(ps), "gross": round(sum(float(p["block_area_ha"] or 0) for p in ps), 1),
                    "net": round(net(ret), 1), "phase": ph, "prot": round(sum(float(p["block_area_ha"] or 0) for p in ps if int(p["phase_map"]) == 6), 1),
                    "excl": round(sum(float(p["block_area_ha"] or 0) for p in ps if int(p["phase_map"]) == 7), 1),
                    "robust": sum(1 for p in ret if int(p["phase_code"]) in (1, 2) and float(p["stability_p12"]) > 0.8),
                    "p12n": sum(1 for p in ret if int(p["phase_code"]) in (1, 2)),
                    "beats": [[b, round(v, 1)] for b, v in sorted(beats.items(), key=lambda kv: -kv[1])[:6]],
                    "allBeats": sorted({p.get("beat") or "-" for p in ps}),
                    "label": [round(lab.x, 5), round(lab.y, 5)], "outline": json.loads(json.dumps(mapping(outline)))})
json.dump(rng_out, open(f"{out}/ranges.json", "w"), separators=(",", ":"))

# example works: per range a compact cluster of blocks of a given phase mix
random.seed(2026)
samples = []
plan = {0: [(1, "Plantation with SMC", "PLANT_SMC"), (4, "Gap planting", "ANR")],
        1: [(2, "Blank-area plantation", "BLANK"), (5, "Plantation on low-priority land", "PLANT_SMC")],
        2: [(1, "Plantation with SMC", "PLANT_SMC"), (3, "ANR and gap planting", "ANR")],
        3: [(2, "SMC and drought-hardy planting", "PLANT_SMC"), (5, "Catchment SMC", "SMC")]}
for i, jobs in plan.items():
    pool = [(g, p) for r, g, p in geoms if r == i]
    for target, title, treat in jobs:
        allowed = (1, 2) if target <= 2 else (3,) if target == 3 else (4, 5) if target <= 5 else (6,)
        seeds = [(g, p) for g, p in pool if int(p["phase_map"]) in allowed and float(p["block_area_ha"]) > 8] or [(g, p) for g, p in pool if int(p["phase_map"]) <= 5]
        best, bscore = None, -1
        for g, p in random.sample(seeds, min(120, len(seeds))):
            near = sorted([q for q, pp in pool if q.distance(g) < 0.0035 and int(pp["phase_map"]) in allowed], key=lambda q: q.distance(g))[:4] or [g]
            u = unary_union(near).buffer(0.0004).buffer(-0.0006).simplify(0.00008)
            if u.is_empty: continue
            if u.geom_type != "Polygon": u = max(u.geoms, key=lambda q: q.area)
            hit = [(q.intersection(u).area, int(pp["phase_map"])) for q, pp in pool if q.intersects(u)]
            tot = sum(a for a, _ in hit) or 1
            share = sum(a for a, ph in hit if ph in allowed) / tot
            score = share * min(1.0, u.area / 1.2e-5)
            if score > bscore: best, bscore = u, score
        u = best
        beat = max(((pp.get("beat") or "-", q.intersection(u).area) for q, pp in pool if q.intersects(u)), key=lambda t: t[1])[0]
        samples.append({"r": i, "name": f"{title}, {beat}", "beat": beat, "treat": treat,
                        "coords": [[round(x, 6), round(y, 6)] for x, y in u.exterior.coords]})
json.dump(samples, open(f"{out}/samples.json", "w"), separators=(",", ":"))
print(len(recs), "blocks;", [(r["name"], r["blocks"], r["net"]) for r in rng_out]); print(len(samples), "samples")
