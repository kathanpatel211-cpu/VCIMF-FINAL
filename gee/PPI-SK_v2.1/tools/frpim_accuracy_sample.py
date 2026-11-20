"""
FRPIM v2.2 — accuracy-assessment sample for Maps 1, 2 and 3 (one field visit serves all three).

Sampling design (Olofsson et al. 2014; Stehman 2014):
  population      all 10 ha blocks of the range (829), including edge blocks
  sampling unit   the block; plot = 30 m radius circle (0.28 ha) at a random location inside the block,
                  at least 30 m from the block edge (plot stays inside the unit)
  strata          the 7 classes of Map 3: Phase 1-5, Protected (C1), Excluded (C2-C7)
  allocation      6 per phase stratum, 4 Protected, 4 Excluded  (= 38 main units)
  selection       simple random sampling without replacement within each stratum (seed 2026);
                  the next 2 random units per stratum are ordered reserves (replacement rule)
  quality control 4 main units (about 10 %) drawn at random for an independent second visit

Outputs (OUTPUT_DIR):
  field/   ACC_field_points.kml, ACC_field_points.gpx, ACC_field_form.csv   (blind: no model values)
  office/  ACC_office_sample.csv, ACC_office_points.kml, ACC_strata.csv      (model values, weights)

Usage: python frpim_accuracy_sample.py blocks.geojson OUTPUT_DIR
"""
import csv
import json
import sys
from pathlib import Path
from xml.sax.saxutils import escape

import numpy as np
import shapely
from pyproj import Transformer
from shapely.geometry import shape, Point

SEED = 2026
ALLOC = {1: 6, 2: 6, 3: 6, 4: 6, 5: 6, 6: 4, 7: 4}
N_RESERVE = 2
N_QC = 4
PLOT_R = 30.0                                   # m
STRATUM = {1: "Phase 1", 2: "Phase 2", 3: "Phase 3", 4: "Phase 4", 5: "Phase 5",
           6: "Protected (C1)", 7: "Excluded (C2-C7)"}
to_utm = Transformer.from_crs("EPSG:4326", "EPSG:32643", always_xy=True).transform
to_ll = Transformer.from_crs("EPSG:32643", "EPSG:4326", always_xy=True).transform


def utm(geom):
    return shapely.transform(geom, lambda xy: np.column_stack(to_utm(xy[:, 0], xy[:, 1])))


def dms(v, pos, neg):
    hemi = pos if v >= 0 else neg
    v = abs(v); d = int(v); m = int((v - d) * 60); s = (v - d - m / 60) * 3600
    return f"{d}°{m:02d}'{s:04.1f}\"{hemi}"


def random_plot_point(geom, rng):
    """Uniform random point inside the block, at least PLOT_R from its edge (else largest-inset fallback)."""
    core = geom.buffer(-PLOT_R)
    target, inset = (core, PLOT_R) if not core.is_empty else (geom.buffer(-PLOT_R / 2), PLOT_R / 2)
    if target.is_empty:
        return geom.representative_point(), 0.0
    minx, miny, maxx, maxy = target.bounds
    for _ in range(5000):
        p = Point(rng.uniform(minx, maxx), rng.uniform(miny, maxy))
        if target.contains(p):
            return p, inset
    return target.representative_point(), inset


def main():
    src, out = Path(sys.argv[1]), Path(sys.argv[2])
    (out / "field").mkdir(parents=True, exist_ok=True)
    (out / "office").mkdir(parents=True, exist_ok=True)
    feats = json.load(open(src))["features"]
    units = [(utm(shape(f["geometry"])), f["properties"]) for f in feats]
    units.sort(key=lambda u: u[1]["block_id"])                # deterministic order before sampling
    rng = np.random.default_rng(SEED)

    strata_rows, sample = [], []
    for h in range(1, 8):
        pop = [u for u in units if int(u[1]["phase_map"]) == h]
        N_h, n_h = len(pop), ALLOC[h]
        order = rng.permutation(N_h)                           # SRSWOR: first n_h main, next reserves
        strata_rows.append({"stratum": h, "stratum_name": STRATUM[h], "N_h_blocks": N_h, "n_h_main": n_h,
                            "area_ha": round(sum(float(u[1]["block_area_ha"]) for u in pop), 1),
                            "weight_N_h_over_n_h": round(N_h / n_h, 3)})
        for k, idx in enumerate(order[:n_h + N_RESERVE]):
            g, p = pop[idx]
            pt, inset = random_plot_point(g, rng)
            lon, lat = to_ll(pt.x, pt.y)
            sample.append({
                "stratum": h, "stratum_name": STRATUM[h], "draw_order": k + 1,
                "role": "main" if k < n_h else f"reserve {k - n_h + 1}",
                "block_id": p["block_id"], "block_area_ha": round(float(p["block_area_ha"]), 2),
                "lat": round(lat, 6), "lon": round(lon, 6), "lat_dms": dms(lat, "N", "S"), "lon_dms": dms(lon, "E", "W"),
                "utm_e": round(pt.x, 1), "utm_n": round(pt.y, 1), "plot_inset_m": inset,
                "road_km": round(float(p.get("advisory_access_km") or -1), 2),
                # model values (office only)
                "model_phase_map": int(p["phase_map"]), "model_need_class": int(p["need_map"]),
                "model_feas_class": int(p["feas_map"]),
                "model_RNI": round(float(p["RNI"]), 4), "model_RFI": round(float(p["RFI"]), 4),
                "model_canopy_pct": round(float(p.get("canopy_pct") or 0), 1),
                "model_bare_share_pct": round(100 * float(p.get("N2_bsi_share") or 0), 1),
                "model_slope_pct": round(float(p.get("F10_raw") or 0), 1),
                "model_cfvo_pct": round(float(p.get("F8_raw") or 0), 1),
                "model_constrained_frac": round(float(p.get("constrained_frac") or 0), 3),
                "model_constraint_reason": p.get("constraint_reason", ""),
                "model_intervention": p.get("intervention", ""),
                "_xy": (pt.x, pt.y),
            })
    # QC: independent second visit for N_QC random main units
    mains = [s for s in sample if s["role"] == "main"]
    for i in rng.choice(len(mains), size=N_QC, replace=False):
        mains[int(i)]["qc_second_visit"] = "yes"
    for s in sample:
        s.setdefault("qc_second_visit", "no")
    # neutral field IDs, north to south (main first)
    sample.sort(key=lambda s: (s["role"] != "main", -s["lat"]))
    nm = nr = 0
    for s in sample:
        if s["role"] == "main":
            nm += 1; s["field_id"] = f"AC-{nm:02d}"
        else:
            nr += 1; s["field_id"] = f"AC-R{nr:02d}"
    # reserves are used only within their own stratum and in draw order: tell the field team which main
    # point each reserve may replace, without revealing the stratum
    for s in sample:
        if s["role"] != "main":
            same = [m["field_id"] for m in sample if m["role"] == "main" and m["stratum"] == s["stratum"]]
            s["replaces_any_of"] = " ".join(same)
            s["reserve_rank"] = s["role"].split()[-1]
        else:
            s["replaces_any_of"] = ""
            s["reserve_rank"] = ""

    field_cols = (["field_id", "role", "reserve_rank", "replaces_any_of", "qc_second_visit", "block_id", "lat", "lon",
                   "lat_dms", "lon_dms", "utm_e", "utm_n", "road_km",
                   "visit_date", "team", "observer", "gps_lat_found", "gps_lon_found", "gps_error_m", "photo_ids",
                   "replaced_by", "reason_not_visited"]
                  + [f"canopy_hit_{i:02d}" for i in range(1, 21)]
                  + [f"ground_{i:02d}" for i in range(1, 21)]
                  + [f"invasive_{i:02d}" for i in range(1, 21)]
                  + ["erosion_0_4", "fire_0_2", "grazing_0_2", "cutting_0_2",
                     "soil_depth_cm_C", "soil_depth_cm_N", "soil_depth_cm_E", "soil_depth_cm_S", "soil_depth_cm_W",
                     "slope_pct", "aspect_deg", "landform", "texture",
                     "water_pct", "drain_pct", "rock_outcrop_pct", "built_pct", "crop_pct",
                     "remarks"])
    with open(out / "field" / "ACC_field_form.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=field_cols, extrasaction="ignore")
        w.writeheader()
        for s in sample:
            w.writerow(s)
    office_cols = ["field_id", "stratum", "stratum_name", "draw_order", "role", "qc_second_visit", "block_id",
                   "block_area_ha", "lat", "lon", "utm_e", "utm_n", "plot_inset_m",
                   "model_phase_map", "model_need_class", "model_feas_class", "model_RNI", "model_RFI",
                   "model_canopy_pct", "model_bare_share_pct", "model_slope_pct", "model_cfvo_pct",
                   "model_constrained_frac", "model_constraint_reason", "model_intervention"]
    with open(out / "office" / "ACC_office_sample.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=office_cols, extrasaction="ignore")
        w.writeheader()
        for s in sorted(sample, key=lambda s: (s["stratum"], s["draw_order"])):
            w.writerow(s)
    with open(out / "office" / "ACC_strata.csv", "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=list(strata_rows[0]))
        w.writeheader(); w.writerows(strata_rows)

    def kml(path, rows, office):
        pal = ["#a50026", "#f46d43", "#fdae61", "#fee08b", "#ffffbf", "#1a9850", "#bdbdbd"]
        def st(i, col):
            c = col.lstrip("#"); abgr = "ff" + c[4:6] + c[2:4] + c[0:2]
            return (f'<Style id="s{i}"><IconStyle><color>{abgr}</color><scale>1.1</scale><Icon><href>'
                    'http://maps.google.com/mapfiles/kml/paddle/wht-blank.png</href></Icon></IconStyle></Style>')
        styles = "".join(st(i + 1, c) for i, c in enumerate(pal)) + st(0, "#2b83ba") + st(9, "#9e9e9e")
        pms = []
        for s in rows:
            sid = f"s{s['stratum']}" if office else ("s0" if s["role"] == "main" else "s9")
            d = [f"{s['role']}" + (f" (may replace one of: {s['replaces_any_of']})" if s["role"] != "main" else ""),
                 f"Lat/Long {s['lat']}, {s['lon']}  ({s['lat_dms']} {s['lon_dms']})",
                 f"UTM 43N {s['utm_e']} E, {s['utm_n']} N", f"Second (QC) visit: {s['qc_second_visit']}"]
            if office:
                d += [f"Stratum: {s['stratum_name']}", f"Model need class {s['model_need_class']}, feasibility class "
                      f"{s['model_feas_class']}, RNI {s['model_RNI']}, RFI {s['model_RFI']}"]
            pms.append(f"<Placemark><name>{escape(s['field_id'])}</name><styleUrl>#{sid}</styleUrl><description>"
                       f"{escape('<br/>'.join(d))}</description><Point><coordinates>{s['lon']},{s['lat']},0"
                       "</coordinates></Point></Placemark>")
        Path(path).write_text('<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2">'
                              f"<Document><name>FRPIM accuracy points {'OFFICE' if office else 'FIELD'}</name>"
                              f"{styles}{''.join(pms)}</Document></kml>", encoding="utf-8")
    kml(out / "field" / "ACC_field_points.kml", sample, office=False)
    kml(out / "office" / "ACC_office_points.kml", sample, office=True)
    Path(out / "field" / "ACC_field_points.gpx").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="FRPIM v2.2" xmlns="http://www.topografix.com/GPX/1/1">'
        + "".join(f'<wpt lat="{s["lat"]}" lon="{s["lon"]}"><name>{s["field_id"]}</name><desc>{escape(s["role"])}</desc></wpt>'
                  for s in sample) + "</gpx>", encoding="utf-8")
    json.dump([{k: v for k, v in s.items()} for s in sample], open(out / "office" / "_sample.json", "w"), default=str)
    for r in strata_rows:
        print(r)
    print("main:", sum(s["role"] == "main" for s in sample), "reserves:", sum(s["role"] != "main" for s in sample),
          "QC:", sum(s["qc_second_visit"] == "yes" for s in sample))


if __name__ == "__main__":
    main()
