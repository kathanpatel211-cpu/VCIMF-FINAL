# Kuppanur Watershed — Proposed Interventions (Google Earth Engine)

`kuppanur_watershed_intervention_map.js` is a lightweight Earth Engine Code
Editor script that shows only the 14 proposed gully-plugging / stream
engineering intervention locations surveyed at Kuppanur village (Tamil
Nadu), each marked by type and labelled with its ID, on Google's HYBRID
basemap. There is no satellite composite, hillshade, contours, drainage
network, or gully-training asset layer — those were removed because they
pushed the Code Editor's per-tile computation past Earth Engine's memory
limit ("Tile error: Earth Engine memory capacity exceeded"), most notably
the label layer, which previously had no bound on its computation extent.

## How to run

1. Open the [Earth Engine Code Editor](https://code.earth.google.com).
2. Create a new script and paste in the full contents of
   `kuppanur_watershed_intervention_map.js`.
3. Click **Run**.
4. Check the **Console** tab for the validation output and the printed
   intervention schedule.
5. Check the **Map** for the title block, marker layers, legend, and north
   arrow.
6. Check the **Tasks** tab for the queued intervention exports (SHP, CSV,
   GeoJSON) — each must be started manually by clicking **Run** next to it.

## What's editable

Everything a user should need to change lives in **Section 01 — PROJECT
CONFIGURATION** at the top of the script: titles, basemap style, and the
label rendering settings. The 14 intervention records live in **Section
02**.

## Data sources

- Intervention coordinates, types and elevations: `gully_plugging_treatment.kml`
  (GPS survey, Kuppanur village) — "I Series Points", 14 points (I5 is
  absent in the source; I4A and I9AP are additional points).

## Known limitations (by design)

- No priority, risk, suitability or ranking is computed or displayed.
- No structural dimensions (dam height, wall length, apron size, discharge,
  design flood, etc.) are fabricated — only surveyed coordinates and
  elevations are used.
- Point ID labels (Section 05) depend on the community
  `users/gena/packages:text` module, now tightly clipped per-point and
  reprojected to a fixed grid so it renders cheaply at any zoom. If it ever
  causes trouble again, set `showLabels = false` — every other layer
  (symbols, legend, table, exports) is unaffected.
- Title, legend, north arrow and the intervention table are Code Editor UI
  panels, not part of any exported file.
- The satellite/hillshade/contour/drainage/gully-training layers from the
  earlier version of this script are removed. If you want them back, ask —
  they should be re-added as separate, individually toggled layers so a
  problem in one can't take down the whole map again.
