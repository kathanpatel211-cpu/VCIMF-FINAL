# Step-by-Step Guide — Module 2 (Watershed Treatment / CAT Plan)
### Written for: ArcGIS 10.8 user, USGS EarthExplorer data source
### Goal: take you from "nothing" to "ranked watershed list + structure maps ready for the DPR"

---

## 0. The one-paragraph version

You will do the **map-drawing work in ArcGIS 10.8** (because Google Earth
Engine cannot draw watershed boundaries or streams — it simply has no
button for it). Once ArcGIS has produced a small set of output files
(elevation grid, streams, watershed boundaries), you **upload those files
into Google Earth Engine**, plug their names into the code, and press Run.
Google Earth Engine then does the heavy number-crunching (rainfall, soil,
satellite images, scoring, ranking) automatically. The final output is a
ranked table of watersheds telling you exactly where to build what, in what
order, and why.

---

## 1. Before you start — what you need

| Item | Where to get it | Cost |
|---|---|---|
| ArcGIS 10.8 with **Spatial Analyst extension** enabled | You already have this | — |
| A USGS EarthExplorer account | https://earthexplorer.usgs.gov — click "Register" top right | Free |
| A Google account | Gmail | Free |
| A Google Earth Engine account, signed up for a project | https://code.earthengine.google.com — first visit prompts you to create a project | Free |
| (Optional, better DEM) An OpenTopography account | https://opentopography.org — click "Login/Register" | Free |

**Check Spatial Analyst is switched on:** In ArcMap, go to
`Customize > Extensions...` and tick the box next to **Spatial Analyst**.
If you skip this, none of the hydrology tools below will even appear in
the toolbox.

---

## 2. PHASE 1 — Get the elevation data (the "DEM")

The DEM (Digital Elevation Model) is just a grid where every cell stores
the ground height. Everything else — slope, water flow direction,
streams, watersheds — is calculated FROM this one file. Get this wrong
and everything downstream is wrong.

### 2.1 Download from USGS EarthExplorer (the method you already know)

1. Go to **earthexplorer.usgs.gov** and log in.
2. **Search Criteria tab** → under "Enter Search Criteria", draw a polygon
   or type coordinates covering the **entire catchment area** — this must
   extend north into Rajasthan (Sirohi/Udaipur) because the Hathmati,
   Guhai and Harnav rivers start there. Do NOT limit your box to
   Sabarkantha district — you will get the wrong watershed shapes if you do.
3. **Data Sets tab** → expand **Digital Elevation** → tick
   **SRTM 1 Arc-Second Global**.
4. **Results tab** → click the download (↓) icon on each tile → choose
   **GeoTIFF**.
5. You'll get one or more `.tif` tiles. If more than one, mosaic them:
   `ArcToolbox > Data Management Tools > Raster > Raster Dataset > Mosaic To New Raster`.

**Why SRTM and not something fancier:** SRTM is free, on USGS (a source
you already trust), and good enough at 30 m. Its one weakness — it
includes tree canopy height, so forested ridges look slightly higher and
"steeper" than they really are — matters mainly in the thick-forest
Aravalli patches (Vijaynagar, Polo, Khedbrahma). If you want to fix this,
see 2.2. Otherwise, proceed with SRTM and just double-check your derived
streams against real imagery later (Step 3.10) — that check catches the
problem either way.

### 2.2 (Optional, recommended) Better DEM with canopy removed

If you can spare 20 minutes: go to **opentopography.org**, log in, search
**"FABDEM"** in their Global DEM section, draw the same catchment box, and
download. FABDEM is SRTM/Copernicus elevation with forest canopy and
buildings digitally "removed," so the ground surface is more accurate in
forested hills. Use this instead of SRTM if you get it; otherwise SRTM is fine.

### 2.3 Set up your ArcMap project correctly

1. Open a new ArcMap document. Add your DEM (`Add Data`).
2. Set the **data frame's coordinate system** to
   **WGS 1984 UTM Zone 43N (EPSG:32643)**:
   `View > Data Frame Properties > Coordinate System` → search "UTM Zone 43N".
3. **Reproject the DEM itself** (don't just set the display projection —
   actually reproject the raster, because slope/area calculations must be
   done in metres, not degrees):
   `ArcToolbox > Data Management Tools > Projections and Transformations > Raster > Project Raster`
   → Input: your DEM → Output Coordinate System: WGS 1984 UTM Zone 43N →
   Output cell size: 30 → Resampling: BILINEAR.

**Why UTM 43N specifically:** it's a projection where distances are in
metres. Slope, area, and stream length calculations only make physical
sense in metres — degrees (the DEM's original coordinate system) distort
distance depending on latitude. Every later step assumes this projection.

---

## 3. PHASE 1 continued — ArcGIS hydrology processing (button by button)

Do these **in order** — each tool needs the output of the one before it.
All tools below live in `ArcToolbox > Spatial Analyst Tools > Hydrology`
unless stated otherwise.

### 3.1 Fill

`Hydrology > Fill` → Input surface raster: your projected DEM → Output: `dem_fill`

**Why:** Raw elevation data has tiny pits/errors where water would get
"stuck" instead of flowing downhill in real life. Fill patches these so
water can flow all the way to the outlet. *(Note: ArcGIS 10.8's Fill
"flattens" small depressions rather than cutting a channel through them —
this is a known weakness in flat, sandy terrain. If your derived streams
look wrong in Step 3.10, ArcGIS 10.8 alone can't fix this — you'd need the
free **WhiteboxTools for ArcGIS** add-in's "Breach Depressions" tool for
just that one step. Try plain Fill first; only bother with this if the
stream-check in 3.10 fails.)*

### 3.2 Flow Direction

`Hydrology > Flow Direction` → Input: `dem_fill` → Output: `flow_dir`

**Why:** tells each cell which one of its 8 neighbours is downhill —
this is literally "which way does the water go from here."

### 3.3 Flow Accumulation

`Hydrology > Flow Accumulation` → Input flow direction: `flow_dir` → Output: `flow_acc`

**Why:** for every cell, counts how many upstream cells drain through it.
A cell with a high number has a lot of catchment area above it — that's
how we recognise "this is a stream, not a hillside."

### 3.4 Turn flow accumulation into a stream network

`Spatial Analyst Tools > Map Algebra > Raster Calculator`:
```
Con("flow_acc" > 1000, 1)
```
Output: `streams_raw`

**Why 1000:** at 30 m resolution, one cell = 900 m² ≈ 0.09 ha. A threshold
of 1000 cells means "a stream starts once ~90 ha of land drains into that
point." This is a starting guess, not a final answer — you will check and
adjust it in Step 3.9.

### 3.5 Stream Link

`Hydrology > Stream Link` → Input stream raster: `streams_raw` → Input
flow direction: `flow_dir` → Output: `stream_link`

**Why:** breaks the stream network into individual numbered segments
(reaches) between confluences — needed for the next two steps.

### 3.6 Stream Order

`Hydrology > Stream Order` → Input stream raster: `streams_raw` → Input
flow direction: `flow_dir` → Method: **Strahler** → Output: `stream_order`

**Why:** classifies every stream segment by size/importance (1 = smallest
headwater trickle, going up to 4-5 for the main river near the reservoir).
This number decides which structure type is even allowed at a location —
you don't put a masonry check dam on a 1st-order trickle, and you don't
put a gully plug on the main river.

### 3.7 Convert streams to a line map, with order attached

`Hydrology > Stream to Feature` → Input stream raster: `stream_order` →
Input flow direction: `flow_dir` → Output: `stream_lines.shp` → Simplify
polylines: **NO**

**Why NO simplify:** simplifying smooths out real bends in the channel,
which quietly changes stream length and distorts the drainage-density
numbers calculated later. Keep every point as generated. The output line
file's `GRID_CODE` field is the Strahler order.

### 3.8 Slope

`Spatial Analyst Tools > Surface > Slope` → Input: `dem_fill` → Output measurement: **PERCENT_RISE** → Output: `slope_pct`
Repeat once more with Output measurement: **DEGREE** → Output: `slope_deg`

**Why both:** the spec's zone rules and structure rules are written in
percent slope; the LS-factor formula in Step 3.11 needs degrees. Keep both.

### 3.9 Delineate the micro-watersheds (500–1000 ha units)

This is the step that creates the actual "Tier 1" units the whole model
ranks. Two pour-point sets, two purposes:

**(a) Automatic micro-watersheds (what gets ranked):**
`Hydrology > Watershed` → Input flow direction: `flow_dir` → Input pour
point data: **use `stream_link` itself as the pour point raster** (this
automatically creates one small watershed per stream segment — no manual
digitizing needed) → Output: `microwatersheds_raster`

Then convert to polygons:
`Conversion Tools > From Raster > Raster to Polygon` → Input: `microwatersheds_raster` → Output: `microwatersheds.shp`

**Check the size distribution:** open the attribute table, add a field
`area_ha`, calculate geometry (area in hectares), and look at the median.
- Median too small (a lot of tiny slivers)? Go back to Step 3.4 and raise
  the threshold (try 2000).
- Median too big? Lower the threshold (try 500).
- Repeat until the **median falls between 500 and 1000 ha**. This is
  expected to take 2-3 tries — don't accept the first attempt.

**(b) Reservoir outlet points (for the "distance to reservoir" criterion):**
Using the Editor toolbar, create a new point shapefile `reservoir_outlets.shp`
and place one point at each dam location: Hathmati, Guhai, Harnav, Majum,
Meshwo, Dharoi (you can find these visually — the dam wall is obvious on
satellite imagery in ArcMap's basemap). Snap each point onto the stream
line first: `Hydrology > Snap Pour Point` → Input point data:
`reservoir_outlets.shp` → Input accumulation raster: `flow_acc` → Snap
distance: 3 (cells) → Output: `outlets_snapped`.

### 3.10 ⚠️ MANDATORY CHECK — do not skip this

Turn on a satellite/topo basemap in ArcMap. Zoom into **5 different
locations** — at least 2 in the hills (Khedbrahma, Vijaynagar) and 2 in the
flatter piedmont (Idar, Himatnagar). Visually compare `stream_lines.shp`
against the real nalas/rivers you can see in the imagery.

**If they match** (lines sit on top of real streams): proceed.
**If they don't match** (lines cut across hillsides, miss real streams,
or show a grid-like artificial pattern in forest areas): your DEM Fill in
Step 3.1 has smoothed over real terrain, usually where dense forest
confused the elevation data. Fix options, in order of effort: (a) redo
with the FABDEM DEM from Step 2.2 if you haven't already, (b) install the
free WhiteboxTools-for-ArcGIS add-in and replace Step 3.1's Fill with its
"Breach Depressions Least Cost" tool, then redo Steps 3.2 onward.

**Why this matters so much:** every single number from here on (drainage
density, all the shape formulas, the whole Tier 2 structure-siting map) is
built on top of this stream network. If it's wrong here, it's wrong
everywhere downstream, and there is no later step that fixes it.

### 3.11 Flow-length layers (for "distance to reservoir" and connectivity)

`Hydrology > Flow Length` → Input flow direction: `flow_dir` →
Direction of measurement: **DOWNSTREAM** → Output: `flow_length_downstream`

**Why:** for every cell, gives the along-channel distance to the outlet —
NOT straight-line distance. Sediment travels along the channel, not as
the crow flies, so this is the correct distance to use.

### 3.12 LS factor (soil-loss slope-length factor, needed for RUSLE/W2)

`Spatial Analyst Tools > Map Algebra > Raster Calculator`:
```
Power(("flow_acc" * 30 / 22.13), 0.4) * Power((Sin("slope_deg" * 0.01745) / 0.0896), 1.3)
```
Output: `ls_factor`

**Why these numbers aren't invented:** this is the standard Moore & Burch
(1986) / Desmet & Govers (1996) formula used worldwide to estimate the
RUSLE "LS factor" (how much a location's position on a slope — length and
steepness — multiplies soil loss) directly from flow accumulation and
slope, which is exactly why it's the common substitute when you don't have
specialised hydrology software. `30` is your cell size in metres; `22.13`
and `0.0896` are fixed reference constants from that published equation,
not something you tune.

### 3.13 Export everything in the right format

Make sure every output is:
- **Projected in EPSG:32643 (UTM 43N)** — check with `Define Projection` if unsure
- Rasters saved as **GeoTIFF** (`.tif`) via `Data Management Tools > Raster > Raster Dataset > Copy Raster`
- Vectors saved as **Shapefile** (`.shp` + its `.shx`/`.dbf`/`.prj` friends)

Your final Phase-1 output folder should contain:

| File | From step |
|---|---|
| `dem_fill.tif` | 3.1 |
| `flow_dir.tif` | 3.2 |
| `flow_acc.tif` | 3.3 |
| `stream_order.tif` | 3.6 |
| `stream_lines.shp` | 3.7 |
| `microwatersheds.shp` | 3.9(a) |
| `outlets_snapped.shp` | 3.9(b) |
| `flow_length_downstream.tif` | 3.11 |
| `ls_factor.tif` | 3.12 |

**This is the entire external job. Once this folder is ready and checked
(Step 3.10 passed), you never open ArcGIS again for this model.**

---

## 4. PHASE 2 — Upload these files into Google Earth Engine

1. Go to **code.earthengine.google.com** and sign in.
2. Click the **Assets** tab (left panel, next to Scripts/Docs).
3. Click **NEW** (top left of the Assets panel) → choose:
   - **"Image Upload"** for every `.tif` raster file
   - **"Shape files"** (under Table Upload) for every `.shp` (select all
     its sibling files — `.shp .shx .dbf .prj` — together, or zip them first)
4. For each upload: click **SELECT**, browse to the file, give it an
   **Asset ID** (a short name, e.g. `stream_lines`, `microwatersheds`,
   `ls_factor`), then click **UPLOAD**.
5. Wait — uploads run as background tasks; watch the **Tasks** tab (bell
   icon) until each shows a green checkmark. Large rasters can take a
   few minutes.
6. Once done, click on each asset in the Assets tab and copy its full ID
   (it looks like `projects/your-project-name/assets/stream_lines`).

**Why upload instead of just referencing the ArcGIS file:** Earth Engine
is a cloud system — it can only see files that live inside its own storage
("Assets"), not files sitting on your laptop.

---

## 5. PHASE 3 — Tell the code where you uploaded everything

Open this repository's files (in a text editor, or directly on GitHub) and edit:

### 5.1 `gee/module2_watershed_treatment/02_external_assets.js`

Find the block that starts with `var EXTERNAL = {` and replace each
placeholder path with the real asset ID you copied in Step 4.6. Example:

```js
// before
STREAM_LINES: 'projects/YOUR_PROJECT/assets/m2_stream_lines',
// after
STREAM_LINES: 'projects/your-actual-project/assets/stream_lines',
```

Do this for: `FLOW_ACCUMULATION_D8`, `STREAM_ORDER_STRAHLER`,
`STREAM_NETWORK_RASTER`, `MICROWATERSHED_POLYGONS`, `STREAM_LINES`,
`DOWNSLOPE_DIST_TO_STREAM` (use `flow_length_downstream` for this),
`LS_FACTOR`, `CONDITIONED_DEM` (use `dem_fill`).

### 5.2 Every file's `require(...)` lines

Every `.js` file in `gee/module2_watershed_treatment/` starts with lines like:
```js
var config = require('users/<you>/VCIMF-FINAL:gee/module2_watershed_treatment/00_config.js');
```
Replace `<you>` with your actual GEE username in **every file** (find-and-replace across the folder). Your username is shown top-right of the Code Editor.

### 5.3 Link this GitHub repository to the Code Editor

In the Code Editor, click the **Scripts** tab → the little folder/gear
icon → **"Add a repository"** (wording may say "Git Repository" or similar
depending on your version) → paste this repo's GitHub URL. Once linked,
all the `.js` files appear as scripts you can open and run directly.

### 5.4 The one phone call you still need to make

Contact **SLUSI** (Soil and Land Use Survey of India) or the **Gujarat
State Land Use Board** and ask for the official **SYI weightage table**
(a standard scoring table used nationwide for watershed prioritisation).
Until you have it, one part of the score (16%) stays switched off — the
code will print a warning and keep running without it, it just won't be
as complete. When you get the table, enter its numbers in
`10_cluster_a_sediment_production.js` where you see
`SYI_PLACEHOLDER_WEIGHTAGE`.

---

## 6. PHASE 4 — Run it

1. In the Code Editor, open `gee/module2_watershed_treatment/main.js`.
2. At the very bottom, find the line:
   ```js
   // Uncomment to execute once external assets (Part 2) are in place:
   // run();
   ```
   Delete the `//` in front of `run();` so it actually executes.
3. Click **Run** (top of the editor).
4. Watch the **Console** tab (bottom right) — every line starting with
   ⚠ is a warning telling you something is still missing or approximate;
   read them, they are there on purpose, not bugs.
5. Watch the **Tasks** tab — every export (the ranked table, the maps) sits
   there as a task. Click **RUN** on each one to actually generate the file
   into your Google Drive.

---

## 7. What you get at the end, and why it matters to you as a Forest Officer

| Output file | What it actually is | Why you need it |
|---|---|---|
| `microwatersheds_prioritised` (table + map) | Every micro-watershed, ranked highest to lowest priority, with all 14 scoring factors shown | This is your **evidence-based priority list** — instead of "we think this area needs work," you can show a reviewer the exact numbers behind every ranking |
| `priority_class_map` | A 5-colour map (Very High to Very Low) | The single map that goes straight into your DPR/presentation |
| `treatment_zones` | Ridge / Middle / Valley zones inside your top watersheds | Enforces the **golden rule**: never build a check dam downstream before the ridge above it is treated, or it silts up in 2-3 monsoons and the money is wasted |
| `structure_sites` + `quantity_estimates` | Exact recommended locations and how many trenches/check dams/etc., with running-metres and earthwork volumes | This becomes the basis of your **Bill of Quantities (BoQ)** — you still apply your Schedule of Rates for the rupee figures, but the quantities are already computed |
| `water_balance_check` | Whether your proposed structures would trap so much water that the reservoir itself starts getting starved | Protects you from a real, documented problem in Gujarat — too many upstream structures can reduce reservoir inflow, and this table proves you checked for it |
| `existing_structures` | A satellite-detected list of check dams/tanks already built | Tells you where NOT to rebuild, and which old structures might just need **desilting** (cheaper than a new structure) |
| `correlation_matrix` / `sensitivity_results` | Technical appendix showing you tested the model for double-counting and stability | This is what makes the DPR **defensible** in front of a technical reviewer, instead of "trust us" |

**In plain terms:** instead of spending your treatment budget on the
watersheds someone visited most recently or that look eroded from the
road, you get a ranked, numbers-backed order of which micro-watersheds to
treat first, what to build where, in what sequence, and proof that you
checked the plan doesn't accidentally starve the reservoir it's meant to
protect. That is exactly the kind of justification a funding/appraising
authority asks for and frequently does not receive.

---

## 8. Quick troubleshooting

| Problem | Likely cause | Fix |
|---|---|---|
| Watershed tool gives one giant polygon, not many small ones | Used a single manual pour point instead of the Stream Link raster | Redo Step 3.9(a) using `stream_link` as the pour point input |
| Streams look like a grid / straight artificial lines in forest | DSM canopy effect on Fill | Use FABDEM (2.2) or breach depressions instead of Fill |
| GEE upload stuck/fails | Shapefile missing a sibling file, or file too large | Re-select all `.shp/.shx/.dbf/.prj` together, or zip them; split huge rasters into tiles |
| Script errors "MISSING EXTERNAL ASSET" | Asset path in `02_external_assets.js` not updated yet, or `<you>` not replaced | Recheck Steps 5.1 and 5.2 |
| Median watershed size stuck too big or small | Threshold in Step 3.4 needs adjusting | Redo 3.4 → 3.9 with a new threshold value |

---

## 9. One-page checklist

- [ ] DEM downloaded (USGS EarthExplorer or OpenTopography), reprojected to EPSG:32643
- [ ] Fill → Flow Direction → Flow Accumulation done
- [ ] Streams extracted, Stream Link, Stream Order, Stream to Feature done
- [ ] Micro-watersheds delineated, median size checked (500–1000 ha)
- [ ] Reservoir outlet points created and snapped
- [ ] Stream network visually checked against imagery in 5 locations — passed
- [ ] Flow length + LS factor computed
- [ ] All outputs reprojected/exported as GeoTIFF/Shapefile in EPSG:32643
- [ ] Everything uploaded to GEE Assets, IDs copied
- [ ] `02_external_assets.js` EXTERNAL paths updated
- [ ] `<you>` replaced in every `require()` line
- [ ] Repo linked as a GEE script repository
- [ ] SLUSI SYI table requested (call/email sent)
- [ ] `main.js` → `run();` uncommented and executed
- [ ] Export tasks run from the Tasks tab
- [ ] Output table/maps opened and sanity-checked against 2-3 watersheds you know personally
