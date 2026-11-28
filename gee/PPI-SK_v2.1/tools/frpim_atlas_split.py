"""Split the full atlas into 4 parts, each opening with its own 3D cover (from frpim_atlas_cover.py) and the contents page.
Usage: python frpim_atlas_split.py FULL_ATLAS.pdf COVER_DIR OUT_DIR PREFIX"""
import sys, os
import pymupdf

PARTS = [("part1", "Part1_Results_and_Range_Maps", 1, 18), ("part2", "Part2_Vegetation_Degradation_Moisture", 19, 40),
         ("part3", "Part3_Terrain_Soil_Pressure", 41, 60), ("part4", "Part4_Model_Outputs_Scores_Methods", 61, 74)]
full, covers, out, prefix = sys.argv[1:5]
src = pymupdf.open(full)
for key, name, a, b in PARTS:
    d = pymupdf.open()
    d.insert_pdf(pymupdf.open(os.path.join(covers, f"cover_{key}.pdf")))
    d.insert_pdf(src, from_page=1, to_page=1)                       # contents
    d.insert_pdf(src, from_page=max(a - 1, 2), to_page=b - 1)
    f = os.path.join(out, f"{prefix}_{name}.pdf")
    d.save(f, garbage=4, deflate=True)
    print(name, d.page_count, "pages", round(os.path.getsize(f) / 1e6, 1), "MB")
d = pymupdf.open()
d.insert_pdf(pymupdf.open(os.path.join(covers, "cover_part1.pdf")))
d.insert_pdf(src, from_page=1)
d.save(os.path.join(out, os.path.basename(full)), garbage=4, deflate=True)
