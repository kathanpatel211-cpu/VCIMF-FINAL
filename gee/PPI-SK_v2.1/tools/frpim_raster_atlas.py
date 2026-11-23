"""
FRPIM v2.2: Pixel Layer Atlas (A3 maps of the GeoTIFFs exported by FRPIM_v22_LAYER_MAPS_KHEDBRAHMA.js).

For every GeoTIFF in the input folder named FRPIM_v22_<Range>_<id>_<key>*.tif this tool makes one
A3 landscape page (300 dpi PNG + PDF) with the map, legend or colour bar, histogram or class areas,
an explanation, data source, scale bar, north arrow and lat/long grid. It also makes one combined
PDF atlas with a contents page. Titles, units, colours and texts come from src/layer_catalogue.json,
the same file the GEE script uses.

Usage : python frpim_raster_atlas.py GEOTIFF_DIR BOUNDARY.geojson OUTPUT_DIR [CATALOGUE.json]
        BOUNDARY: the exported FRPIM_v22_<Range>_range_boundary.geojson (or the block GeoJSON)
Needs : rasterio, matplotlib, shapely, pyproj, numpy, pymupdf
"""
import json
import re
import sys
from pathlib import Path

import numpy as np
import matplotlib.pyplot as plt
from matplotlib.colors import LinearSegmentedColormap, ListedColormap, BoundaryNorm, Normalize
import rasterio
from rasterio.features import geometry_mask
from rasterio.merge import merge as rio_merge
from shapely.geometry import mapping

sys.path.insert(0, str(Path(__file__).resolve().parent))
import frpim_layout_common as C  # noqa: E402


def read_layer(paths):
    """Read one layer (GEE may split a large export into tiles -> merge them)."""
    srcs = [rasterio.open(p) for p in paths]
    if len(srcs) == 1:
        s = srcs[0]
        arr, tr, nod = s.read(), s.transform, s.nodata
    else:
        arr, tr = rio_merge(srcs)
        nod = srcs[0].nodata
    crs = srcs[0].crs
    for s in srcs:
        s.close()
    assert crs and crs.to_epsg() == 32643, f"{paths[0].name}: expected EPSG:32643, got {crs}"
    return arr.astype("float64"), tr, nod


def page(L, paths, union, out_dir, run_label):
    arr, tr, nod = read_layer(paths)
    h, w = arr.shape[1:]
    outside = geometry_mask([mapping(union)], out_shape=(h, w), transform=tr, invert=False)
    extent = [tr.c, tr.c + tr.a * w, tr.f + tr.e * h, tr.f]
    px_ha = abs(tr.a * tr.e) / 1e4

    fig = C.new_page(L["id"], L["title"], L["sub"])
    ax = C.map_axes(fig, union)
    rows, stats_txt = [], ""
    if L["type"] == "rgb":
        rgb = np.moveaxis(arr[:3], 0, -1) / 255.0
        alpha = (~outside & (arr[:3].sum(0) > 0)).astype(float)
        ax.imshow(np.dstack([rgb, alpha]), extent=extent, interpolation="nearest", zorder=2)
    else:
        v = arr[0]
        bad = outside | ~np.isfinite(v)
        if nod is not None:
            bad |= v == nod
        if L["type"] == "cat":
            bad |= v <= 0
        vals = v[~bad]
        assert vals.size, f"{L['id']}: no valid pixels inside the range"
        data = np.ma.array(v, mask=bad)
        if L["type"] == "cat":
            n = len(L["classes"])
            cmap = ListedColormap(["#" + c[2] for c in L["classes"]])
            norm = BoundaryNorm(np.arange(0.5, n + 1.5), n)
            ax.imshow(data, extent=extent, cmap=cmap, norm=norm, interpolation="nearest", zorder=2)
            for code, name, col in L["classes"]:
                rows.append((col, name, float((vals == code).sum()) * px_ha))
            inside_ha = float((~outside).sum()) * px_ha
            rows.append(("ffffff", "Not in any class", inside_ha - sum(r[2] for r in rows)))
        else:
            lo, hi = L["min"], L["max"]
            stretched = lo is None or hi is None
            if stretched:
                lo, hi = (float(x) for x in np.percentile(vals, [2, 98]))
                if hi <= lo:
                    hi = lo + 1e-9
            cmap = LinearSegmentedColormap.from_list(L["key"], ["#" + c for c in L["palette"]])
            norm = Normalize(lo, hi, clip=True)
            ax.imshow(data, extent=extent, cmap=cmap, norm=norm, interpolation="nearest", zorder=2)
            q = np.percentile(vals, [0, 2, 50, 98, 100])
            stats_txt = (f"Pixel values inside the range: min {fmt(q[0])}, median {fmt(q[2])}, max {fmt(q[4])} "
                         f"({L['unit']}); mean {fmt(float(vals.mean()))}. "
                         + ("Colours are stretched between the 2nd and 98th percentile."
                            if stretched else f"Colour scale fixed at {fmt(lo)} to {fmt(hi)}."))
    ax.add_patch(C.geom_to_patch(union, facecolor="none", edgecolor=C.INK, linewidth=1.6, zorder=4))
    C.map_furniture(ax)

    # ---- right panel
    lx, rx = C.LX, C.RX
    y = 0.852
    fig.text(lx, y, "Legend", fontsize=15, fontweight="bold", color=C.INK, va="center")
    fig.text(rx, y, f"Unit: {L['unit']}", fontsize=9, color=C.MUTED, va="center", ha="right")
    y -= 0.040
    if L["type"] == "cont":
        cax = fig.add_axes([lx, y - 0.018, rx - lx, 0.022])
        cb = plt.colorbar(plt.cm.ScalarMappable(norm=norm, cmap=cmap), cax=cax, orientation="horizontal")
        cb.ax.tick_params(labelsize=8.5)
        cb.outline.set_edgecolor("#6b756e")
        y -= 0.075
        hax = fig.add_axes([lx + 0.01, y - 0.13, rx - lx - 0.01, 0.13])
        bins = np.linspace(lo, hi, 41)
        cnt, edges = np.histogram(np.clip(vals, lo, hi), bins=bins)
        mids = (edges[:-1] + edges[1:]) / 2
        hax.bar(mids, cnt * px_ha, width=edges[1] - edges[0], color=cmap(norm(mids)), edgecolor="none")
        hax.set_title("Area by value (ha)", fontsize=9.5, color=C.INK, loc="left", pad=4, fontweight="bold")
        hax.tick_params(labelsize=7.5, colors=C.MUTED, length=2)
        for sp in ("top", "right"):
            hax.spines[sp].set_visible(False)
        for sp in ("left", "bottom"):
            hax.spines[sp].set_color(C.RULE)
        y -= 0.13 + 0.045
    elif L["type"] == "cat":
        fig.text(rx, y, "Area ha", fontsize=9, color=C.MUTED, va="center", ha="right")
        y -= 0.030
        for col, name, ha in rows:
            C.swatch(fig, lx, y, "#" + col)
            fig.text(lx + 0.034, y, name, fontsize=10.5, fontweight="bold" if col != "ffffff" else "normal",
                     color=C.INK, va="center")
            fig.text(rx, y, f"{ha:,.1f}", fontsize=10, color=C.INK, va="center", ha="right")
            y -= 0.036
        y -= 0.010
    else:
        fig.text(lx, y, "Natural colour: red, green and blue bands as the eye sees them.", fontsize=9.5,
                 color=C.INK, va="center")
        y -= 0.040
    body = L["about"] + ("\n" + stats_txt if stats_txt else "")
    y = C.text_block(fig, y, "What this map shows", body)
    res = abs(tr.a)
    y = C.info_rows(fig, y, [("Data", L["data"]), ("Used in", L["used"]),
                             ("Pixel / grid", f"{res:g} m pixels, UTM 43N (EPSG:32643)")])
    assert y > 0.062, f"{L['id']}: right panel overflows (y={y:.3f})"
    C.footer(fig, f"FRPIM v2.2 Pixel Layer Atlas, {L['group']}. Computed in Google Earth Engine with the FRPIM "
                  f"library ({run_label}). Area figures are pixel counts inside the range boundary.")
    base = out_dir / f"FRPIM_v2.2_Khedbrahma_Pixel_{L['id']}_{L['key']}"
    fig.savefig(str(base) + ".png", dpi=300, facecolor=C.PAPER)
    fig.savefig(str(base) + ".pdf", facecolor=C.PAPER, dpi=200)
    plt.close(fig)
    return base


def fmt(x):
    a = abs(x)
    return f"{x:,.0f}" if a >= 100 else (f"{x:.1f}" if a >= 10 else (f"{x:.2f}" if a >= 1 else f"{x:.3f}" if a >= 0.01 else f"{x:.4f}"))


def cover(out_dir, entries, missing):
    fig = plt.figure(figsize=(C.W, C.H), facecolor=C.PAPER)
    fig.patches.append(plt.Rectangle((0, 0.74), 1, 0.26, transform=fig.transFigure, facecolor="#1B5E20"))
    fig.text(0.05, 0.89, "FRPIM v2.2 Pixel Layer Atlas", fontsize=36, fontweight="bold", color="white", va="center")
    fig.text(0.05, 0.825, "Satellite and geospatial input layers of the Forest Restoration Priority and Intervention Model",
             fontsize=15, color="white", va="center")
    fig.text(0.05, 0.778, f"{C.PLACE}   ·   full-resolution pixels clipped to the range", fontsize=12,
             color="#d9f0d3", va="center")
    fig.text(0.05, 0.70, "Contents", fontsize=18, fontweight="bold", color=C.INK, va="center")
    colw, x, y, sec = 0.31, 0.05, 0.655, None
    for code, title, section, pg in entries:
        if section != sec:
            if y < 0.12:
                x, y = x + colw, 0.655
            fig.text(x, y, section, fontsize=10.5, fontweight="bold", color="#1B5E20", va="center")
            y -= 0.026
            sec = section
        fig.text(x + 0.005, y, code, fontsize=9, color=C.MUTED, va="center")
        fig.text(x + 0.035, y, title, fontsize=9, color=C.INK, va="center")
        fig.text(x + colw - 0.02, y, f"p. {pg}", fontsize=9, color=C.MUTED, va="center", ha="right")
        y -= 0.0215
        if y < 0.07:
            x, y = x + colw, 0.655
    note = ("Layers not yet exported: " + ", ".join(missing)) if missing else "All catalogue layers included."
    C.footer(fig, note)
    base = out_dir / "FRPIM_v2.2_Khedbrahma_Pixel_00_cover"
    fig.savefig(str(base) + ".pdf", facecolor=C.PAPER)
    fig.savefig(str(base) + ".png", dpi=200, facecolor=C.PAPER)
    plt.close(fig)
    return base


def main():
    tif_dir, bnd, out = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
    cat_path = Path(sys.argv[4]) if len(sys.argv) > 4 else Path(__file__).resolve().parent.parent / "src" / "layer_catalogue.json"
    out.mkdir(parents=True, exist_ok=True)
    catalogue = json.load(open(cat_path))
    union = C.union_of(C.load_blocks(bnd))
    files = sorted(tif_dir.glob("*.tif"))
    pages, missing = [], []
    for L in catalogue:
        pat = re.compile(rf"^FRPIM_v22_[A-Za-z]+_{re.escape(L['id'])}_{re.escape(L['key'])}(-\d+-\d+)?\.tif$")
        paths = [f for f in files if pat.match(f.name)]
        if not paths:
            missing.append(L["id"])
            continue
        pages.append((L["id"], L["title"], L["group"], page(L, paths, union, out, "pixel export")))
        print("done", L["id"], L["title"], f"({len(paths)} file{'s' if len(paths) > 1 else ''})")
    entries = [(c, t, s, i + 2) for i, (c, t, s, _) in enumerate(pages)]
    cv = cover(out, entries, missing)
    import pymupdf
    atlas = pymupdf.open()
    for b in [cv] + [p[3] for p in pages]:
        with pymupdf.open(str(b) + ".pdf") as d:
            atlas.insert_pdf(d)
    atlas.save(str(out / "FRPIM_v2.2_Khedbrahma_PIXEL_LAYER_ATLAS.pdf"), deflate=True, garbage=3)
    print("atlas pages:", atlas.page_count, "| missing layers:", missing or "none")


if __name__ == "__main__":
    main()
