# VCIMF-FINAL

Scientifically defensible, source-traceable **spatial runoff coefficient
(C) model** for the upstream contributing catchment (14.07 ha) of a proposed
check dam in India — the C-only development phase (no Q, rainfall, Tc, or
check-dam hydraulics).

## Contents

- [`gee/runoff_coefficient_model.js`](gee/runoff_coefficient_model.js) —
  the full Google Earth Engine (JavaScript) model, organized into 19
  numbered sections (Config → Study area → Datasets → Land cover → Soil →
  DEM/Slope → Surface condition → WAPCOS C → IRC C → Provenance →
  Confidence → Reason → Coverage QA → Area-weighted C → Sensitivity → Field
  validation → Maps → UI → Export).
- [`docs/METHODOLOGY.md`](docs/METHODOLOGY.md) — full methodology,
  coefficient tables, classification hierarchy, data-source resolution
  notes, and known limitations.

## How to run

1. Open [code.earthengine.google.com](https://code.earthengine.google.com).
2. Create a new script and paste in the full contents of
   `gee/runoff_coefficient_model.js`.
3. Confirm you have read access to the catchment asset
   `projects/raygadh-range/assets/catchmentarea` (asset ID
   `YXMV4HWVQVTVKURIZ6H42NBF`).
4. Run the script. Watch the **Console** for the area-reconciliation prints
   after each major section (4, 5, 6, 13, 14, 15) — each stage's areas must
   reconcile to ~14.07 ha before the final weighted C can be trusted.
5. Use the **Layers** panel to toggle the C value / C source / C confidence
   / surface-condition / unresolved-reason maps.
6. Use the top-right UI panel for the printed weighted C, coverage QC flag,
   and optional field-validation override tool (draw a geometry, enter an
   expert C, apply).
7. Run the two tasks in the **Tasks** tab to export the multi-band 30 m
   GeoTIFF and the CSV summary table.

If the catchment's UTM zone differs from EPSG:32643, update the `crs`
parameter in the `Export.image.toDrive` call in Section 19 before exporting.

This script has been authored and reviewed for methodological correctness
but has not been executed against a live Earth Engine account in this
environment — verify the reconciliation prints on first run.
