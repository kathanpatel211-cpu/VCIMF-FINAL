# Kuppanur Watershed — Proposed Intervention Map (Google Earth Engine)

`kuppanur_watershed_intervention_map.js` is a self-contained Earth Engine
Code Editor script that maps the 14 proposed gully-plugging / stream
engineering interventions surveyed at Kuppanur village (Tamil Nadu),
against Sentinel-2 imagery, DEM-derived hillshade/contours, a locally
derived drainage network, and the uploaded `gully_tr` gully-training asset.

## How to run

1. Open the [Earth Engine Code Editor](https://code.earth.google.com).
2. Create a new script and paste in the full contents of
   `kuppanur_watershed_intervention_map.js`.
3. Click **Run**.
4. Check the **Console** tab for the asset-inspection output (geometry type
   of `gully_tr`) and the printed intervention schedule.
5. Check the **Map** for the title block, layers, legend, and north arrow.
6. Check the **Tasks** tab for the queued exports (intervention points as
   SHP/CSV/GeoJSON, gully-training layer, and a composited map image) — each
   must be started manually by clicking **Run** next to it.

## What's editable

Everything a user should need to change lives in **Section 01 — PROJECT
CONFIGURATION** at the top of the script: DEM asset, contour interval,
drainage thresholds, date range for the Sentinel-2 composite, the
`gully_tr` asset ID, and the (currently unset) Catchment A boundary asset
ID. The 14 intervention records themselves live in **Section 02**.

## Data sources

- Intervention coordinates, types and elevations: `gully_plugging_treatment.kml`
  (GPS survey, Kuppanur village) — "I Series Points", 14 points (I5 is
  absent in the source; I4A and I9AP are additional points).
- Gully/stream-training layer: user-uploaded GEE asset
  `projects/raygadh-range/assets/gully_tr`.
- DEM: USGS SRTM GL1, 30 m (`USGS/SRTMGL1_003`).
- Satellite basemap: Sentinel-2 Surface Reflectance Harmonized, cloud-masked
  with Cloud Score+.

## Known limitations (by design)

- No priority, risk, suitability or ranking is computed or displayed.
- No structural dimensions (dam height, wall length, apron size, discharge,
  design flood, etc.) are fabricated — only surveyed coordinates and
  elevations are used.
- The drainage network (Section 08) is a simplified, locally computed D8
  flow-accumulation approximation for terrain *context*, not a certified
  hydrological model.
- Point labels (Section 12) depend on the community `users/gena/packages:text`
  module. If that module is unavailable, set `showLabels = false`; every
  other layer, the legend, and the table are unaffected.
- Title, legend, north arrow and the intervention table are Code Editor UI
  panels, not baked into the exported GeoTIFF. For a fully composited A3
  print layout, combine the exported image with those elements in a GIS or
  desktop-publishing tool, or export a screenshot of the annotated Map view.
- Catchment A is not drawn until `catchmentAssetId` in Section 01 is set to
  a real boundary asset.
