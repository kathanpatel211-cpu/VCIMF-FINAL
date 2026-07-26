# Google Earth Engine — Data & Processing Specification
## MODULE 2 — Watershed Treatment & Soil-Moisture Conservation (SMC) Prioritisation
### Sabarkantha District, Gujarat — Sabarmati Basin
### Objective: **Catchment Area Treatment (CAT) — sediment control & reservoir protection**
**Companion to:** Module 1 (Plantation Suitability). Shared layers are noted throughout; the two modules must be run against the same DEM, projection and land-cover base or their outputs cannot be cross-read.
**Asset ID status:** ✅ = verified against the live Earth Engine catalog. ⚠️ = community-catalog or external asset, verify with `print()` before use. All ⚠️ items have a stated fallback.

> This document is the source of truth for the code in
> `gee/module2_watershed_treatment/`. Code comments cite section numbers
> from here (e.g. "Part 0.2", "spec W5") — read the relevant section before
> changing the logic it backs.

---
# PART 0 — READ THIS BEFORE ANYTHING ELSE
## 0.1 This module cannot be built the way Module 1 was
Module 1 scores **pixels**. A watershed treatment model that scores pixels is methodologically wrong and will not survive appraisal. Watershed treatment in Indian practice is prioritised at **micro-watershed** level and only then are individual structures sited within the prioritised units.
**This model therefore has two tiers:**
| Tier | Unit | Question answered | Output |
|---|---|---|---|
| **Tier 1** | Micro-watershed (500–1000 ha) | *Which watersheds do we treat, and in what order?* | Ranked watershed table + priority map |
| **Tier 2** | Pixel / stream segment | *Within a prioritised watershed, which structure goes where?* | Structure siting layers + quantities |
Tier 2 runs **only inside** watersheds selected by Tier 1. Running Tier 2 district-wide produces a map of theoretical structure locations that nobody will ever build and that dilutes the credibility of the whole exercise.
## 0.2 Ridge-to-valley is a hard constraint, not a weight
This is the oldest rule in Indian watershed management and it is the one most often violated in practice.
**Drainage line treatment must not precede ridge area treatment in the same catchment.** A check dam constructed below an untreated ravine system will fill with sediment within two to three monsoons, and the entire capital cost is lost. This is not a preference to be traded off against other criteria — it is a sequencing rule that the model must enforce as a **hard constraint on the output ordering**.
The Tier 2 output must therefore be a **treatment sequence**, not merely a set of locations:
```
Zone 1 (ridge/upper)   → Year 1–2  → must be substantially complete before
Zone 2 (middle/gully)  → Year 2–3  → must be substantially complete before
Zone 3 (valley/storage)→ Year 3–4
```
Any structure proposed in Zone 3 must carry a flag identifying which Zone 1 and Zone 2 works are its prerequisites.
## 0.3 ⚠️ The central conflict in a CAT plan — state it openly
A CAT plan for Hathmati, Guhai or Dharoi has two objectives that **partially oppose each other**:
1. Reduce sediment inflow to the reservoir (build structures upstream)
2. Preserve inflow volume to the reservoir (structures intercept water)
Every upstream storage structure that traps silt also traps water that would otherwise reach the reservoir. Gujarat has extensive experience of large-scale decentralised water harvesting, and the effect of cumulative upstream storage on downstream reservoir inflows is a documented and contested subject in Indian water resources literature.
**Requirement:** the model must compute a **water balance check** — total proposed storage capacity against mean annual runoff volume per sub-catchment — and flag sub-catchments where cumulative proposed storage exceeds a stated fraction of mean annual runoff. Set that fraction from the CAT plan's own terms of reference; it is a policy parameter, not a technical constant, and it must be declared explicitly rather than left implicit.
A CAT plan that proposes storage without this accounting is incomplete, and a reviewer at the appraising authority will ask for it.
## 0.4 Gross erosion is not sediment yield
The single most common error in CAT planning is ranking watersheds on RUSLE soil loss alone.
RUSLE estimates **gross erosion on the slope**. What silts a reservoir is **sediment delivered to the outlet**. A steeply eroding watershed separated from the reservoir by a wide alluvial floodplain may deliver very little; a moderately eroding watershed hanging directly above the reservoir with a steep, confined channel delivers nearly everything.
This is why **Cluster B (Sediment Delivery & Connectivity) carries 22%** in the weighting below. It is the difference between a CAT plan that reduces reservoir siltation and one that treats the wrong watersheds thoroughly.

---
# PART 1 — GLOBAL ANALYSIS PARAMETERS
| Parameter | Value | Reason |
|---|---|---|
| **Projection** | `EPSG:32643` (WGS 84 / UTM 43N) | Same as Module 1. Mandatory for slope, flow length, area and RUSLE LS. |
| **Analysis scale** | **30 m** | Matches DEM and Module 1. |
| **Tier 1 unit** | DEM-delineated micro-watershed, target **500–1000 ha** | Matches the SLUSI micro-watershed convention — see 1.2. |
| **Tier 2 unit** | 30 m pixel + stream segment | |
| **Hydrological base** | **FABDEM** (preferred) or GLO-30, hydrologically conditioned | See 1.1 — this choice matters more than most people assume. |
| **Study extent** | Sabarmati sub-basins draining to Hathmati, Guhai, Harnav, Majum, Meshwo reservoirs + Dharoi contributing area within Sabarkantha | Define by **watershed boundary, not district boundary** — see 1.3. |
## 1.1 ⚠️ DEM selection — do not route flow over a surface model
| Option | Asset | Type | Verdict |
|---|---|---|---|
| **FABDEM** | `projects/sat-io/open-datasets/FABDEM` ⚠️ | **DTM**, 30 m | **Preferred.** Forests And Buildings removed from Copernicus DEM. |
| Copernicus GLO-30 | `COPERNICUS/DEM/GLO30` ✅ | **DSM**, 30 m | Acceptable fallback. |
| MERIT Hydro | `MERIT/Hydro/v1_0_1` ✅ | Conditioned DTM, ~90 m | Too coarse for 500–1000 ha delineation; excellent as a cross-check and for `hnd`. |
| AW3D30 | `JAXA/ALOS/AW3D30/V3_2` ✅ | DSM, 30 m | Cross-check only. |
**Why this matters:** `COPERNICUS/DEM/GLO30` is a **Digital Surface Model** — it includes tree canopy and buildings. Routing flow across a DSM in the forested Aravalli tracts of Vijaynagar, Polo and Khedbrahma creates **artificial ridges along forest edges** that divert modelled flow paths away from real drainage lines. Your micro-watershed boundaries will be wrong in exactly the terrain that matters most to this project.
FABDEM is GLO-30 with canopy and buildings removed and is the correct base for hydrological routing at this scale. If FABDEM cannot be sourced, use GLO-30 but apply aggressive hydrological conditioning (breaching rather than filling) and inspect the derived stream network against Survey of India toposheets or satellite imagery in at least five forested sub-catchments before accepting it.
## 1.2 On the reporting unit — a recommendation alongside your choice
You have specified **DEM-delineated micro-watersheds**, which is technically sound and gives you full control over the delineation.
**Additional recommendation:** once delineated, **map each unit to its SLUSI Watershed Atlas code** (the Soil and Land Use Survey of India six-level codification: Water Resources Region → Basin → Catchment → Sub-catchment → Watershed → Sub-watershed → Micro-watershed).
Reason: this costs almost nothing and it means your output is directly comparable with — and citable against — the official national watershed hierarchy that any appraising authority, state watershed agency or CAT plan reviewer works in. A DPR that reports results in an ad-hoc delineation invites the question "how does this relate to the official micro-watersheds?" A DPR that reports both answers it before it is asked.
## 1.3 ⚠️ Extent must be hydrological, not administrative
**Do not clip the study area to the Sabarkantha district boundary.**
Watersheds do not respect revenue boundaries. The catchments feeding Hathmati, Guhai and Harnav extend **north into Rajasthan** (Sirohi and Udaipur districts) and across into neighbouring Gujarat districts. If you clip to the district, you will:
- Truncate upper catchments and compute wrong contributing areas
- Compute wrong morphometric parameters (drainage density, relief ratio, form factor are all area-dependent and all become meaningless on a truncated watershed)
- Under-estimate sediment delivery from the upper catchment, which in an Aravalli system is where most of it originates
**Correct approach:** delineate the **full hydrological catchment** of each target reservoir, compute everything on the complete catchment, and only at the reporting stage flag which micro-watersheds fall within Sabarkantha (and therefore within your implementing jurisdiction). Watersheds outside jurisdiction still need to appear in the analysis — they explain the sediment budget even where you cannot treat them, and a CAT plan that silently omits half the catchment is not a CAT plan.

---
# PART 2 — ⚠️ WHAT GEE CANNOT DO, AND THE EXTERNAL WORKFLOW
**Google Earth Engine has no native flow direction, flow accumulation, watershed delineation, or stream ordering.** This is a hard platform limitation, not an oversight in this specification. There is no workaround inside GEE that is worth the effort at this scale.
## 2.1 Required external pre-processing
Perform these steps **outside GEE**, then upload the results as GEE assets. Recommended toolchain: **WhiteboxTools** (best hydrological implementation, scriptable via Python), or SAGA GIS, or QGIS with GRASS `r.watershed`.
| Step | Tool operation | Output | Upload to GEE as |
|---|---|---|---|
| 1 | Acquire FABDEM / GLO-30 for the full catchment extent | Raw DEM | — |
| 2 | **Hydrological conditioning** — `BreachDepressionsLeastCost` (preferred over `FillDepressions`) | Conditioned DEM | Image |
| 3 | `D8Pointer` | Flow direction | Image |
| 4 | `D8FlowAccumulation` | Flow accumulation | **Image** |
| 5 | `ExtractStreams` at threshold (see 2.2) | Stream network raster | Image |
| 6 | `StrahlerStreamOrder` | Stream order raster | **Image** |
| 7 | `Watershed` / `Basins` at selected pour points | Micro-watershed polygons | **FeatureCollection** |
| 8 | `DownslopeDistanceToStream`, `DownslopeFlowpathLength` | Flow path lengths | Image |
| 9 | `SedimentTransportIndex` / LS factor | LS raster | Image |
| 10 | Vectorise stream network | Stream lines with order attribute | **FeatureCollection** |
**Use breaching, not filling.** `FillDepressions` creates flat areas that produce parallel artificial flow paths and distort drainage density — one of the most common sources of wrong morphometric parameters in published watershed studies. `BreachDepressionsLeastCost` preserves the drainage structure.
## 2.2 Stream initiation threshold — calibrate, do not guess
At 30 m resolution, one cell = 900 m².
| Threshold (cells) | Contributing area | Effect |
|---|---|---|
| 500 | 45 ha | Dense network, small watersheds |
| 1000 | 90 ha | **Recommended starting point** |
| 2000 | 180 ha | Sparse network, large watersheds |
**Procedure:** start at 1000 cells, delineate, then check the resulting micro-watershed **size distribution**. Adjust until the median unit falls in the **500–1000 ha** target band. Do not accept the first run.
**Validation — mandatory:** overlay the derived stream network on Survey of India toposheets and on high-resolution imagery in at least five sub-catchments spanning both hill (Khedbrahma, Vijaynagar) and piedmont (Idar, Himatnagar) terrain. The derived network must match the real nala network. If it does not, the DEM conditioning is wrong and **every downstream morphometric parameter, the entire Cluster C, and all of Tier 2 is invalid.** This check is not optional and it takes an afternoon.
## 2.3 What GEE then does
GEE handles everything raster-attribute and zonal:
- Rainfall, erosivity, land cover, NDVI, soil property extraction
- RUSLE factor rasters (given the externally computed LS)
- SCS-CN runoff computation
- Degradation trend analysis
- Water body and existing structure detection
- **Zonal statistics** of every layer onto the uploaded micro-watershed polygons
- Final weighted scoring and export
This is a sensible division of labour — the topology in Whitebox, the imagery and time series in GEE.

---
# PART 3 — TIER 1: MICRO-WATERSHED PRIORITISATION
## 3.1 Weighting vector — CAT / sediment-control objective
| Cluster | Weight | Rationale |
|---|---|---|
| **A — Sediment Production** | **42%** | The direct measure of what the CAT plan exists to reduce |
| **B — Sediment Delivery & Connectivity** | **22%** | What actually reaches the reservoir — see 0.4 |
| **C — Runoff Generation & Morphometry** | **18%** | The transport mechanism, and the classical Indian prioritisation method |
| **D — Treatment Feasibility & Response** | **18%** | A watershed that cannot be treated should not be ranked first |
| # | Criterion | Weight | Direction |
|---|---|---|---|
| **A — Sediment Production (42%)** | | | |
| W1 | Sediment Yield Index (SYI) | **16%** | ↑ |
| W2 | RUSLE gross soil loss | **12%** | ↑ |
| W3 | Gully & ravine erosion severity | **8%** | ↑ |
| W4 | Land degradation trend (10-year) | **6%** | ↑ |
| **B — Sediment Delivery (22%)** | | | |
| W5 | Index of Connectivity (IC) | **11%** | ↑ |
| W6 | Flow-path proximity to reservoir | **7%** | ↓ (distance) |
| W7 | Intervening sediment trapping | **4%** | ↓ |
| **C — Runoff & Morphometry (18%)** | | | |
| W8 | SCS-CN runoff depth | **7%** | ↑ |
| W9 | Morphometric compound parameter | **7%** | ↑ (see 3.5 — direction is subtle) |
| W10 | Rainfall erosivity | **4%** | ↑ |
| **D — Feasibility & Response (18%)** | | | |
| W11 | Treatable area availability | **6%** | ↑ |
| W12 | Structure siting feasibility | **5%** | ↑ |
| W13 | Recharge co-benefit | **4%** | ↑ |
| W14 | Existing treatment saturation | **3%** | ↓ |
**Total: 100%**
### Why this vector and not another
**This weighting is conditional on the CAT objective you selected.** It is not a general-purpose watershed vector. Clusters A and B together carry **64%** because reservoir protection is the stated purpose — sediment is the product being managed. Groundwater recharge appears at only **4%** (W13) as a **co-benefit**, not a driver.
**Had the objective been groundwater recharge,** the vector would look materially different — recharge potential and groundwater stress would carry 25–30% between them, connectivity to reservoir would drop to near zero, and structure siting feasibility would rise. If the objective shifts during the project, the weight vector must be re-derived, not nudged. Keep the config structure from Module 1 (Part 9, item 10) so this is a one-line change.

---
## W1 — Sediment Yield Index (SYI) — **16%** — ↑
### This is the official method — use it, and say you used it
For a Catchment Area Treatment plan, the **Sediment Yield Index** developed by the All India Soil & Land Use Survey (AIS&LUS, now **SLUSI**) is the methodology the appraising authority expects. RUSLE is a supporting analysis; SYI is the standard.
**Formula:**
```
SYI = [ Σ (Ai × Wi × Di) ] / Aw × 100
```
| Term | Meaning |
|---|---|
| `Ai` | Area of the i-th Erosion Intensity Mapping Unit (EIMU) |
| `Wi` | Weightage value assigned to that EIMU |
| `Di` | Delivery ratio for that unit |
| `Aw` | Total watershed area |
**EIMU delineation** — each unique combination of the following becomes one mapping unit:
| Input | Source | Resolution |
|---|---|---|
| Slope class | Conditioned DEM | 30 m |
| Soil texture | `projects/soilgrids-isric/sand_mean`, `clay_mean`, `silt_mean` ⚠️ | 250 m |
| Soil depth | Module 1 C6 composite depth index | 30 m |
| Land use / land cover | `ESA/WorldCover/v200` ✅ + `GOOGLE/DYNAMICWORLD/V1` ✅ | 10 m |
| Observed erosion status | W3 gully severity layer | 30 m |
### ⚠️ The weightage table must be sourced, not invented
`Wi` values and the SYI priority class thresholds (Very High / High / Medium / Low / Very Low) come from the **SLUSI / AIS&LUS standard weightage table**. I am not going to state numeric values for these from memory, because a CAT plan carrying invented weightage values is worse than one carrying none.
**Action:** obtain the current weightage table and class thresholds from SLUSI, the Gujarat State Land Use Board, or the Watershed Atlas methodology documentation, and hard-code them into the script **with the source cited in a comment**. This is a phone call and an email, and it is the difference between a defensible CAT plan and an indefensible one.
Until the table is obtained, the script should run SYI with a placeholder table, **print a prominent warning**, and exclude SYI from the final composite rather than silently using placeholder values.

---
## W2 — RUSLE Gross Soil Loss — **12%** — ↑
Shares all components with Module 1 C11. Compute once, use in both modules.
```
A = R × K × LS × C × P    (t/ha/yr)
```
| Factor | Source | Notes |
|---|---|---|
| **R** | `UCSB-CHG/CHIRPS/DAILY` ✅ | Apply a **published Indian regional regression** and cite it in a code comment. Do not invent coefficients. |
| **K** | `projects/soilgrids-isric/` sand, silt, clay, soc ⚠️ | Williams (EPIC) equation |
| **LS** | **Externally computed** (Part 2, step 9) | Use the Whitebox LS or Sediment Transport Index output |
| **C** | `ESA/WorldCover/v200` ✅ lookup, or NDVI-exponential | State which method; cite the lookup table |
| **P** | 1.0 | Unless conservation structures are mapped — they are not, at present |
**Aggregate to watershed:** area-weighted mean soil loss (t/ha/yr) per micro-watershed, plus total soil loss (t/yr) as a separate reported attribute. Rank on the **mean rate** for prioritisation; report the **total** for budgeting, because a large watershed with a moderate rate may still be the largest single sediment contributor.
**Reporting caveat:** absolute t/ha/yr values from global inputs are indicative. Use them for **relative ranking** and label them as such. Do not put an unvalidated absolute tonnage into a funding document — see Part 7 on reservoir survey calibration, which is how you earn the right to quote absolute numbers.

---
## W3 — Gully & Ravine Erosion Severity — **8%** — ↑
No global gully dataset exists at usable resolution. This must be derived.
| Component | Method | Source |
|---|---|---|
| Drainage incision | High **local relief** in a 100–200 m window along low-order streams | Conditioned DEM |
| Channel confinement | Low width-to-depth ratio from cross-sections | DEM + stream network |
| Bare soil exposure on channel banks | Dry-season bare soil index within a 60 m buffer of the stream network | `COPERNICUS/S2_SR_HARMONIZED` ✅ |
| Ravine morphology | High **terrain roughness** (SD of elevation, 100 m window) combined with low NDVI | DEM + S2 |
| Drainage density anomaly | Local Dd substantially above the watershed mean | Stream network |
**Bare Soil Index (dry season, Feb–May composite):**
```
BSI = ((B11 + B4) − (B8 + B2)) / ((B11 + B4) + (B8 + B2))
```
**Interpretation:** high roughness + high BSI + high drainage density + steep local relief along low-order channels = active gully system.
**Validation:** digitise 20–30 known gully systems from high-resolution imagery and check the index responds. This layer is a derived proxy and should be labelled as such.

---
## W4 — Land Degradation Trend — **6%** — ↑
**Purpose:** distinguish watersheds that are *actively degrading* from those that are already degraded and stable. A watershed on a declining trajectory warrants earlier intervention — the same treatment cost buys more avoided loss.
| | |
|---|---|
| **Asset** | `LANDSAT/LC08/C02/T1_L2` ✅ + `LANDSAT/LE07/C02/T1_L2` ✅ (for the earlier period) |
| **Alternative** | `MODIS/061/MOD13Q1` ✅ — 250 m, 16-day NDVI, consistent long record |
| **Period** | 2015–2025, annual peak-season (Sep–Nov) NDVI |
| **Method** | Per-pixel **Theil–Sen slope** of annual peak NDVI, with Mann–Kendall significance |
**Why Theil–Sen and not ordinary least squares:** Theil–Sen is robust to outliers, which in a monsoon-driven NDVI series (one drought year, one cloud-contaminated composite) matters a great deal. OLS on a 10-point series with one bad year gives a misleading trend.
**Aggregate:** proportion of the watershed showing a statistically significant negative NDVI trend (p < 0.05).
**Mandatory mask:** exclude cropland before computing. Agricultural NDVI trends track cropping pattern, irrigation availability and market prices, not land degradation, and the Sabarmati valley agricultural belt will otherwise dominate this layer.

---
## W5 — Index of Connectivity — **11%** — ↑
**This is the criterion that makes the difference between a CAT plan that works and one that treats the wrong watersheds.**
### Method: Borselli / Cavalli Index of Connectivity
```
IC = log10( Dup / Ddn )
```
**Upslope component:**
```
Dup = W̄ × S̄ × √A
```
- `W̄` = mean weighting factor of the upslope contributing area (use the RUSLE **C-factor** as the roughness/impedance weight)
- `S̄` = mean slope gradient of the upslope contributing area (m/m)
- `A` = upslope contributing area (m²)
**Downslope component:**
```
Ddn = Σ ( di / (Wi × Si) )
```
- `di` = length of the flow path through cell *i* toward the outlet
- `Wi`, `Si` = weight and slope of cell *i*
**Computation:** requires flow routing — compute externally alongside the Part 2 workflow (WhiteboxTools has the required flow-path length primitives; the IC itself is straightforward raster algebra once `Dup` and `Ddn` are available).
**Aggregate:** mean IC per micro-watershed, and the proportion of watershed area above a high-connectivity threshold.
### Simpler fallback — empirical Sediment Delivery Ratio
If IC proves impractical in the pilot timeframe, use an empirical SDR as an interim:
```
SDR = a × A^(−b)        (A = watershed area in km²)
```
Several published forms exist (Vanoni and various regional Indian relations). **Select one, cite it explicitly, and state the coefficients used.** Do not use an SDR relation calibrated on a different physiographic region without saying so.
`Sediment Yield = RUSLE gross erosion × SDR`
**Why IC is better:** empirical SDR is a function of watershed *area alone* — it cannot distinguish two watersheds of identical size where one drains directly into the reservoir down a steep confined channel and the other passes through 3 km of flat alluvium. IC captures exactly that difference, which is the whole point of the criterion.

---
## W6 — Flow-Path Proximity to Reservoir — **7%** — ↓ (distance)
| | |
|---|---|
| **Method** | **Flow-path distance** along the drainage network from watershed outlet to reservoir, not straight-line distance |
| **Source** | Externally computed flow-path length (Part 2, step 8) |
| **Reservoirs** | Hathmati, Guhai, Harnav, Majum, Meshwo + Dharoi |
| **Reservoir extents** | `JRC/GSW1_4/GlobalSurfaceWater` ✅ band `occurrence` ≥ 75, cross-checked against `ESA/WorldCover/v200` ✅ class 80 |
**Use routed distance, not Euclidean distance.** Two watersheds 10 km from a reservoir in a straight line may be 12 km and 40 km apart along the drainage. Sediment travels along channels.
**Additional attribute:** for each micro-watershed, record **which reservoir it drains to**. This is essential for a CAT plan — the treatment budget is usually allocated per reservoir, and a watershed's priority depends on the siltation status of *its own* receiving reservoir, not the district average.

---
## W7 — Intervening Sediment Trapping — **4%** — ↓
**Purpose:** a watershed whose sediment must pass through three existing tanks before reaching the reservoir delivers less than one with a clear channel. Discount accordingly.
### ⚠️ You have no structure inventory — derive one from satellite
This is achievable and worth doing properly. Existing check dams, nala bunds and percolation tanks in this landscape have a distinctive signature.
| Method | Detail |
|---|---|
| **Seasonal water persistence** | `COPERNICUS/S2_SR_HARMONIZED` ✅ — MNDWI = (B3 − B11)/(B3 + B11). Monthly composites Oct → May. A check dam or percolation tank **holds water in Oct–Dec and dries by Mar–May.** Natural pools and reservoirs behave differently. |
| **JRC seasonality** | `JRC/GSW1_4/GlobalSurfaceWater` ✅ band `seasonality` — values indicating a few months of water per year, located **on** the stream network |
| **Radar confirmation** | `COPERNICUS/S1_GRD` ✅ — VV backscatter drop confirms open water independent of cloud |
| **Geometric filter** | Small (0.1–10 ha), **intersecting the derived stream network**, elongated across the channel |
| **Manual verification** | Digitise detections on high-resolution basemap imagery — expect to confirm/reject a few hundred candidates. A few days of work. |
**Output:** a structure inventory FeatureCollection. **This layer has value far beyond W7** — it feeds W14 (saturation), the Tier 2 siting exclusions, and the water balance check in 0.3. Build it properly.
**Aggregate for W7:** cumulative trapping capacity on the flow path between each micro-watershed outlet and its receiving reservoir.

---
## W8 — SCS-CN Runoff Depth — **7%** — ↑
**Method:** USDA Soil Conservation Service Curve Number.
```
S  = (25400 / CN) − 254                    (mm)
Ia = λ × S                                  (λ = 0.2 standard)
Q  = (P − Ia)² / (P − Ia + S)               for P > Ia;  Q = 0 otherwise
```
| Input | Source | Notes |
|---|---|---|
| **Rainfall (P)** | `UCSB-CHG/CHIRPS/DAILY` ✅ | Daily, 1981–2025. Also compute the 1-day maximum for design events. |
| **Hydrologic Soil Group** | HYSOGs250m ⚠️ (ORNL DAAC — external download, upload to GEE) | See warning below |
| **HSG fallback** | Derive directly from SoilGrids texture + Module 1 depth composite using USDA HSG criteria | **Recommended for this terrain** |
| **Curve Number lookup** | HSG × land cover, standard SCS tables | Cite the table used |
| **Global CN alternative** | GCN250 (Jaafar et al.) ⚠️ | Verify availability; useful cross-check |
### ⚠️ Global HSG products misclassify hard-rock terrain
HYSOGs250m derives HSG partly from **SoilGrids depth-to-bedrock** — the same product we established in Module 1 does not exist in SoilGrids 2.0 and was unreliable over Indian crystalline terrain in v0.5.
In the Aravalli, thin soils over fractured but largely impermeable gneiss and quartzite should classify predominantly as **HSG C and D** (moderately high to high runoff potential). If the global product returns large areas of A or B in the hill tracts, it is wrong, and your runoff estimates will be substantially too low.
**Check this explicitly.** Print the HSG distribution over the hill talukas before proceeding. If it looks implausible, derive HSG directly from texture and depth using the USDA criteria and document the derivation.
### Antecedent Moisture Condition
Convert the AMC-II curve number as required:
```
CN(I)   = 4.2 × CN(II) / (10 − 0.058 × CN(II))
CN(III) = 23  × CN(II) / (10 + 0.13  × CN(II))
```
- **AMC-II** for seasonal water balance and the storage check in 0.3
- **AMC-III** for peak-event and design-storm analysis (mid-monsoon saturated conditions)
### On the initial abstraction ratio
λ = 0.2 is the standard value. A body of literature — including work on Indian watersheds — has argued for lower values, and λ = 0.3 is also used in some Indian practice. **State the value used explicitly and justify it.** If the model is sensitive to this choice, run both and report the range. Silently adopting 0.2 without comment is acceptable practice; adopting it without knowing it is a choice is not.

---
## W9 — Morphometric Compound Parameter — **7%** — ↑ priority (see direction note)
This is the classical Indian watershed prioritisation method (Biswas, Nooka Ratnam, Javed and the wider literature). It is computed **entirely from the externally derived stream network and watershed polygons** — no additional data required.
### Parameters
| Parameter | Formula | Relation to erosion | Rank 1 assigned to |
|---|---|---|---|
| Drainage density `Dd` | ΣL / A | Direct | **Highest** |
| Stream frequency `Fs` | ΣN / A | Direct | **Highest** |
| Bifurcation ratio `Rb` | Nu / Nu+1 | Direct | **Highest** |
| Drainage texture `T` | ΣN / P | Direct | **Highest** |
| Length of overland flow `Lo` | 1 / (2 × Dd) | **Inverse** | **Lowest** ⚠️ |
| Relief ratio `Rh` | H / Lb | Direct | **Highest** |
| Ruggedness number `Rn` | H × Dd | Direct | **Highest** |
| Form factor `Rf` | A / Lb² | **Inverse** | **Lowest** |
| Circularity ratio `Rc` | 4πA / P² | **Inverse** | **Lowest** |
| Elongation ratio `Re` | (2/Lb) × √(A/π) | **Inverse** | **Lowest** |
| Compactness coefficient `Cc` | 0.2821 × P / √A | **Inverse** | **Lowest** |
**Compound Parameter:** `Cp = Σ(ranks) / n`. **Lowest Cp = highest priority.** Invert before combining with the other criteria, which are all scored high-is-priority.
### ⚠️ Two errors that are common in the published literature — do not repeat them
**1. Length of overland flow is frequently ranked in the wrong direction.** `Lo = 1/(2Dd)`. Since high drainage density indicates high erosion risk, and `Lo` is its reciprocal, **low `Lo` indicates high risk**. Many published studies group `Lo` with the "linear parameters" and assign rank 1 to the highest value, which is physically backwards. Assign rank 1 to the **lowest** `Lo`.
**2. The compound parameter treats correlated variables as independent.** `Dd`, `Fs`, `T` and `Lo` are all near-deterministic functions of drainage network density — they are close to the same variable measured four times. `Rf`, `Rc`, `Re` and `Cc` are four descriptions of watershed shape. Averaging all eleven ranks equally means shape is counted four times and density four times, while relief is counted twice.
**Recommended fix — run a PCA on the eleven parameters and either:**
- (a) use the leading principal components in place of raw ranks, or
- (b) select **one representative parameter per correlated cluster** (e.g. `Dd` for density, `Rc` for shape, `Rn` for relief) and average only those.
Option (b) is simpler and easier to defend in a DPR. **Report the correlation matrix either way** — it demonstrates you knew the issue existed, which is worth more to a reviewer than the choice itself.

---
## W10 — Rainfall Erosivity — **4%** — ↑
| | |
|---|---|
| **Asset** | `UCSB-CHG/CHIRPS/DAILY` ✅ — 5566 m, 1981–2025 |
| **Cross-check** | `NASA/GPM_L3/IMERG_MONTHLY_V07` ✅ — ~11 km, better sub-daily intensity characterisation |
**Compute:**
- Mean annual R-factor (shared with W2)
- **Monsoon concentration index** — fraction of annual rainfall falling in Jun–Sep (expect ~90% in this belt)
- **Erosive event frequency** — count of days exceeding an erosivity threshold (commonly 12.7 mm/day as the standard erosive-event cutoff; state the threshold used)
### Honest limitation — the same one as Module 1
CHIRPS pixels are ~5.5 km. Across the Sabarmati catchments in Sabarkantha this is a few hundred pixels. **Erosivity will vary as a smooth regional gradient with essentially no micro-watershed-scale detail.** Adjacent micro-watersheds will frequently share an identical value.
This is precisely why the weight is **4%** and not higher. The criterion captures a real orographic gradient — rainfall rises northward into the hills — and nothing finer. Do not raise this weight, and do not present the erosivity layer as though it resolves at watershed scale.

---
## W11 — Treatable Area Availability — **6%** — ↑
**Purpose:** a watershed with severe erosion but no treatable land is a poor investment. Prioritise where treatment can actually be executed.
**Treatable = total watershed area minus:**
| Exclusion | Source |
|---|---|
| Existing dense forest (already protected) | Hansen `treecover2000` ≥ 40% minus loss ✅ |
| Water bodies | `JRC/GSW1_4/GlobalSurfaceWater` ✅ + WorldCover 80/90 ✅ |
| Built-up | `ESA/WorldCover/v200` ✅ class 50 + `GOOGLE/DYNAMICWORLD/V1` ✅ |
| Rock outcrop | Module 1 C6 bare-rock index |
| Slope > 35° | Conditioned DEM |
| Private irrigated cropland | WorldCover class 40 + irrigation signal |
**Report as:** treatable hectares, and treatable area as a proportion of total watershed area. **Use the proportion for scoring** and carry the absolute hectarage into the budget table.
**Note on cropland:** agricultural land is treatable in principle (contour bunding, farm ponds, field bunding under MGNREGA convergence) but not under a Forest Department programme on forest land. Since your programme appears confined to forest land, exclude cropland from the treatable area but **report it separately** — it identifies where convergence with the Rural Development Department or watershed agency would be needed to treat the catchment completely. A CAT plan that stops at the forest boundary while half the sediment originates on agricultural land should say so explicitly.

---
## W12 — Structure Siting Feasibility — **5%** — ↑
**Purpose:** does the watershed physically contain sites where structures can be built?
| Component | Criterion | Source |
|---|---|---|
| Suitable trench terrain | Area in the 15–33% slope band | DEM |
| Suitable gully-plug sites | Length of 1st/2nd order stream with adequate incision | Stream network + DEM |
| Suitable check dam sites | Length of 3rd/4th order stream with bed slope < 3% and channel width < 20 m | Stream network + DEM |
| Percolation tank potential | Presence of gentle valley floors with permeable substrate | DEM + soil |
| Material availability | Boulder/stone availability proxy from the bare-rock index | S2 |
**Aggregate:** a composite feasibility score. Detail is developed fully in Tier 2 (Part 4); at Tier 1 this is a coarse yes/no-ish screen so that watersheds with nowhere to build anything do not rank first.

---
## W13 — Recharge Co-benefit — **4%** — ↑
**Weight kept low deliberately.** Under a CAT objective, recharge is a genuine co-benefit worth capturing in the DPR narrative and worth breaking ties between otherwise equivalent watersheds — but it is **not** what this programme is being funded to achieve. Were the objective groundwater, this criterion would be decomposed into three or four criteria carrying 25–30% between them.
| Component | Source | Notes |
|---|---|---|
| Weathered zone / regolith proxy | Slope + TPI + Module 1 depth composite | In hard rock, recharge capacity ≈ weathered zone thickness |
| Lineament density | Derived from DEM hillshade (multi-directional) + S2 edge detection | Fractures are the primary hard-rock recharge and transmission pathway |
| Slope | DEM | Gentler slope = longer residence time = more infiltration |
| Existing groundwater stress | ⚠️ **CGWB block category not available** | See below |
### ⚠️ On the missing groundwater data
You have no CGWB data, which is the correct and honest position to start from — but it does constrain what this criterion can claim.
**Available substitutes, in descending order of usefulness:**
1. **CGWB Dynamic Groundwater Resource Assessment** — published, block-level (Safe / Semi-critical / Critical / Over-exploited), freely available from CGWB and India-WRIS. **This is a download, not a research project.** Strongly recommended before the model runs — it is one table joined to block boundaries and it upgrades the criterion from a proxy to a measurement.
2. **India-WRIS well hydrograph data** — observation well water-level trends
3. `NASA/GRACE/MASS_GRIDS_V04/LAND` ⚠️ — GRACE terrestrial water storage anomaly. **Resolution is ~1–3°, i.e. hundreds of kilometres.** Valid as regional narrative context for North Gujarat. It **cannot** discriminate between micro-watersheds and must not be used as a scoring input at this scale. Include it in the report text, not the model.
**Until CGWB data is obtained, W13 runs on physical recharge potential only** — the model can say "this watershed has good recharge capacity" but not "this watershed needs recharge most." State that limitation on the output.

---
## W14 — Existing Treatment Saturation — **3%** — ↓
**Purpose:** avoid re-treating watersheds already covered by earlier programmes, and prevent the cumulative over-storage problem described in 0.3.
**Source:** the satellite-derived structure inventory from W7.
**Compute per micro-watershed:**
- Number of existing structures
- Existing structures per km²
- Existing structures per km of drainage length
- Estimated cumulative existing storage (from surface area, with a stated depth assumption)
**Direction:** higher existing saturation → **lower** priority for new construction.
**But — an important qualification.** High existing structure density combined with high sediment yield may indicate **structures that have already silted up and need desilting**, not that the watershed is adequately treated. Desilting is a legitimate and often highly cost-effective CAT intervention that restores capacity at a fraction of new-construction cost.
**Therefore:** where a watershed shows high structure density **and** high W1/W2 sediment scores, do not simply down-rank it — flag it with a **"desilting candidate"** tag and route it to a separate intervention track. Losing these watersheds to a naive saturation penalty would be a significant missed opportunity.

---
# PART 4 — TIER 2: STRUCTURE SITING & TREATMENT PRESCRIPTION
Runs **only within** micro-watersheds selected by Tier 1.
## 4.1 Zonation — the ridge-to-valley framework
Every pixel in a prioritised watershed is assigned to exactly one zone:
| Zone | Criteria | Treatment family | Sequence |
|---|---|---|---|
| **Zone 1 — Ridge / Upper** | Stream order 0–1; slope > 15%; high HAND; upper third of relief | Area treatment — trenches, bunds, vegetative | **Year 1–2** |
| **Zone 2 — Middle / Gully** | Stream order 2–3; slope 5–15%; middle relief | Drainage line treatment — gully plugs, LBCD, gabions | **Year 2–3** |
| **Zone 3 — Valley / Storage** | Stream order 3–5; slope < 5%; low HAND | Storage & recharge — check dams, percolation tanks, nala bunds | **Year 3–4** |
**Inputs:** Strahler stream order (external), slope (DEM), HAND (`MERIT/Hydro/v1_0_1` ✅ band `hnd`), relief position (TPI).
## 4.2 Structure decision matrix
| Structure | Zone | Slope | Stream order | Catchment | Additional siting criteria |
|---|---|---|---|---|---|
| **Continuous Contour Trench (CCT)** | 1 | 15–33% | — | — | Rainfall < 800 mm; stable soils; soil depth adequate for excavation |
| **Staggered Contour Trench (SCT)** | 1 | 15–33% | — | — | Rainfall > 800 mm, or unstable/shallow soils, or slip risk |
| **Water Absorption Trench** | 1 | 5–15% | — | — | Gentler upper slopes |
| **Gradoni / bench terrace** | 1 | 15–30% | — | — | Where plantation or horticulture is intended — **links to Module 1** |
| **Vegetative / live barrier** | 1–2 | 5–25% | — | — | Supplementary to mechanical measures; low cost |
| **Gully plug** | 2 | — | 1 | < 10 ha | Gully depth < 1 m |
| **Loose Boulder Check Dam** | 2 | — | 1–2 | < 40 ha | Gully depth < 1 m; **boulder available locally** |
| **Gabion structure** | 2 | — | 2–3 | 40–100 ha | Higher discharge; where LBCD would wash out |
| **Earthen check dam / nala bund** | 3 | < 5% | 3–4 | 40–200 ha | Stable banks; suitable foundation |
| **Masonry / cement check dam** | 3 | < 3% bed slope | 3–4 | 100–400 ha | Channel width < 20 m; sound foundation |
| **Percolation tank** | 3 | < 3% | 3–4 | **2.5–4 km²** | **Permeable bed essential** — see 4.4 |
| **Farm pond** | 3 | < 5% | — | — | On or adjacent to treatable land |
| **Subsurface dyke** | 3 | < 3% | 3–4 | — | Weathered zone 5–15 m over fresh rock; across nala |
| **Desilting (existing)** | 2–3 | — | — | — | Existing structure with high upstream sediment yield |
**These ranges are indicative planning norms.** Confirm every one against the **Gujarat Forest Department / Gujarat Water Resources Department technical manual and Schedule of Rates**, and against relevant IS codes and the MoRD/NABARD watershed manuals, before they enter a BoQ. Ranges in the literature vary by region and by agency, and the state's own manual governs.
## 4.3 Spacing and quantity computation
These are derivable and can be computed directly in the script.
**Contour trench spacing** — a commonly used Indian vertical-interval norm:
```
VI (m) = (S/3 + 2) × 0.3        where S = slope in %
Horizontal spacing (m) = VI / (S/100)
```
⚠️ Confirm this formula against the state technical manual — several variants are in use for bunding versus trenching.
**Trench quantity per hectare:**
```
Running metres per ha = 10,000 / horizontal spacing (m)
Earthwork volume (m³) = running metres × trench cross-sectional area (m²)
```
For staggered trenches, multiply by the trench-length-to-gap ratio.
**Check dam spacing** — so that the toe of the upper structure meets the crest of the lower:
```
Spacing (m) = effective structure height (m) / channel bed slope (m/m)
```
Example: 0.5 m effective height on a 2% bed slope → 25 m spacing → 40 structures per km of channel.
**The script can compute all of these from the DEM and stream network and output a quantity table per micro-watershed.** Rates come from the state Schedule of Rates and must be applied separately — **do not hard-code rupee figures into the model.**
## 4.4 ⚠️ Percolation tank siting — the most commonly wasted structure
A percolation tank on impermeable substrate is not a recharge structure. It is an evaporation pond, and in Gujarat — where pan evaporation substantially exceeds annual rainfall — it will lose most of its stored volume to the atmosphere without recharging anything.
**Mandatory siting conditions:**
| Condition | Why |
|---|---|
| **Permeable bed** — weathered/fractured zone, not fresh rock or clay | Without permeability there is no recharge |
| Adequate weathered zone thickness | Storage in a hard-rock aquifer resides in the regolith |
| Beneficiary wells within ~3–5 km downstream | Recharge with no abstraction point is recharge with no benefit |
| Submergence area on low-value land | Avoids acquisition and conflict |
| Catchment yield sufficient to fill it | Check against W8 runoff — an unfilled tank is a total loss |
| **Geophysical confirmation before construction** | Resistivity survey at each proposed site |
**The remote-sensing model can identify *candidate* sites. It cannot confirm subsurface permeability.** Every percolation tank site in the output must carry a mandatory **"geophysical survey required"** flag. This is the single most expensive structure type to get wrong, and satellite data cannot see the thing that determines whether it works.
## 4.5 The water balance check — enforce it
Per sub-catchment:
```
Mean annual runoff volume  =  SCS-CN runoff depth (W8) × catchment area
Proposed storage           =  Σ storage capacity of all proposed structures
Existing storage           =  Σ capacity from the W7 inventory
Storage ratio              =  (Proposed + Existing) / Mean annual runoff volume
```
**Flag any sub-catchment where the storage ratio exceeds the threshold declared in the CAT plan's terms of reference.** Structures beyond that point compete with the reservoir they are meant to protect — which is the internal contradiction described in 0.3, made quantitative.
Report the storage ratio for **every** sub-catchment, whether or not it breaches the threshold. Demonstrating the accounting was done is as valuable as the result.

---
# PART 5 — NORMALISATION & SCORING
**Because Tier 1 operates on polygons rather than pixels, the normalisation differs from Module 1.**
| Aspect | Method |
|---|---|
| Zonal statistics | `reduceRegions()` over the micro-watershed FeatureCollection, `scale: 30`, `tileScale: 8` |
| Normalisation | Percentile stretch (2nd–98th) **across the watershed population**, not across pixels |
| Sample size | Expect 200–600 micro-watersheds — a small enough population that **rank-based scoring is also defensible** and less sensitive to outliers |
| Aggregation | Weighted linear sum, **plus** a geometric-mean variant for comparison |
| Direction | Applied in **one place**, driven by a config flag — same discipline as Module 1 |
**Recommendation:** compute both the weighted-sum score and a **straight rank-sum score**, and compare the resulting top-20 watershed lists. If the two methods disagree substantially, the result is being driven by the distributional shape of one or two criteria rather than by the underlying signal, and that needs investigating before anything is published.

---
# PART 6 — ⚠️ CORRELATION & DOUBLE-COUNTING
**As in Module 1, this is the most important methodological check, and here it is more severe.**
## Slope enters at least six criteria
| Criterion | Route |
|---|---|
| W1 SYI | Slope class is a primary EIMU input |
| W2 RUSLE | LS factor |
| W5 Index of Connectivity | Both Dup and Ddn are slope functions |
| W9 Morphometry | Relief ratio, ruggedness number |
| W11 Treatable area | Slope > 35° exclusion |
| W12 Siting feasibility | Slope bands throughout |
## Erosion is measured three times
W1 (SYI), W2 (RUSLE) and W3 (gully severity) are three measures of the same physical process, sharing inputs — SYI's EIMUs are built from the same slope, soil and land-cover layers that drive RUSLE. Their combined nominal weight is **36%**; their effective weight, given the overlap, is the dominant term in the model.
**This may well be appropriate for a CAT plan** — sediment is the objective. But it must be a **stated design decision**, not an accident discovered by a reviewer.
## Drainage network enters four criteria
W3 (drainage density anomaly), W5 (connectivity), W9 (Dd, Fs, T, Lo), W12 (channel-length feasibility).
## Rainfall enters four criteria
W2 (R factor), W8 (CN runoff), W10 (erosivity), W13 (recharge).
## Required diagnostic
Compute the **Pearson and Spearman correlation matrices across all 14 criteria over the full micro-watershed population** and export as CSV.
| Result | Action |
|---|---|
| \|r\| > 0.85 | Effectively the same variable. Merge, drop one, or explicitly document the doubled weight. |
| \|r\| 0.65–0.85 | Substantial overlap — disclose in the methodology section. |
| Variance ≈ 0 | Criterion is constant across the population and contributes nothing while absorbing weight. Drop or replace. |
**Expected:** W1–W2 correlation will be high (likely > 0.8). Decide in advance what you will do about it. The defensible options are to merge them into a single 28% sediment-production criterion, or to keep both and state that sediment production is deliberately weighted at 28% through two complementary methods — the official SYI and the physically-based RUSLE. Both are respectable. Discovering the correlation after publication is not.

---
# PART 7 — VALIDATION
## 7.1 The validation that matters most — reservoir sedimentation surveys
**This is the single highest-value validation available, and it is the reason to pursue it before anything else.**
Hydrographic capacity surveys of Hathmati, Guhai, Harnav and Dharoi give **measured sediment deposition volumes** over known periods. Sources:
- Gujarat Water Resources Department / Narmada, Water Resources, Water Supply and Kalpsar Department
- Central Water Commission — periodic compendia on reservoir sedimentation in India
- Sardar Sarovar Narmada Nigam / state irrigation circle records
- Reservoir capacity survey reports held by the concerned irrigation division
**What this gives you:** a measured total sediment yield for the entire catchment over a known period. Your model produces a predicted sediment yield for the same catchment. **Compare them.**
If the model predicts within a plausible factor of the measured deposition, you have earned the right to quote absolute numbers. If it does not, you have learned something important before publication rather than after — most likely that the SDR/IC calibration or the R-factor regression needs adjustment.
**Without this, the model produces a relative ranking only, and the report must say so plainly.**
## 7.2 Additional checks
| Check | Method |
|---|---|
| **Stream network** | Overlay on toposheets and imagery — 5+ sub-catchments across hill and piedmont. **Non-negotiable** (Part 2.3). |
| **Watershed size distribution** | Histogram — median in the 500–1000 ha band |
| **Area closure** | Σ micro-watershed areas = total catchment area. Gaps or overlaps mean the delineation failed. |
| **Field verification** | 15–20 micro-watersheds visited; check erosion severity and gully presence against the model |
| **Existing structure inventory** | Confirm a sample of detections on the ground; report producer's and user's accuracy |
| **Criterion histograms** | All 14 — flat, spiky, or near-constant distributions indicate broken inputs |
| **Sensitivity analysis** | Perturb each weight ±20%; map rank stability of the top 20% of watersheds |
| **Known-watershed sanity check** | Take watersheds you know well; where the model disagrees with field judgement, find out which criterion is responsible before adjusting anything |

---
# PART 8 — INTEGRATION WITH MODULE 1
**These two modules are not independent, and the DPR is materially stronger if it says so.**
## 8.1 Shared layers — compute once
DEM and derivatives · slope · SoilGrids properties · CHIRPS rainfall and R-factor · WorldCover and Dynamic World · Sentinel-2 composites · HAND · RUSLE K, C and LS factors · bare-rock index
**Build these in a shared module and import into both scripts.** Divergent versions of the same layer between the two modules is the most likely source of an embarrassing inconsistency at review.
## 8.2 The reinforcing loop — and it runs both ways
| Direction | Mechanism |
|---|---|
| **SMC → Plantation** | Contour trenches, gully plugs and check dams raise soil moisture and reduce first-summer mortality. In a 700–800 mm monsoon-concentrated regime this is often the difference between a surviving plantation and a replanted one. |
| **Plantation → SMC** | Vegetative cover is itself a soil conservation measure — it reduces the RUSLE **C-factor**, and mature cover reduces it far more than any mechanical structure. Mechanical works buy time; vegetation provides the permanent solution. |
## 8.3 The convergence map — the most valuable single output
**Cross-tabulate Module 1 plantation suitability against Module 2 watershed priority:**
| Module 2 priority | Module 1 suitability | Prescription |
|---|---|---|
| **High** | **High** | **Integrated treatment — SMC works + plantation together.** Highest return per rupee. Execute first. |
| High | Low | SMC works only — mechanical treatment, minimal planting |
| Low | High | Plantation with basic moisture conservation only |
| Low | Low | Defer |
**The high-high category is the strongest thing either module produces.** It identifies where a single mobilisation delivers sediment control, groundwater recharge, carbon, biodiversity and plantation survival simultaneously — and it is exactly the kind of integrated justification that funding committees respond to.
**Sequencing note that must appear in the DPR:** within a convergence block, SMC works **precede or accompany** planting. Trenches dug in the same season, before or with the monsoon planting, capture that year's runoff for the saplings. Trenches dug two years later have already lost two establishment seasons.

---
# PART 9 — EXPORTS
| Output | Format | Purpose |
|---|---|---|
| `microwatersheds_prioritised` | **Shapefile / GeoJSON + CSV** | The primary deliverable — ranked table with all 14 criteria as attributes |
| `priority_class_map` | Shapefile | 5 classes (Very High → Very Low) — the map that goes in the DPR |
| `criterion_WXX_normalised` × 14 | CSV columns | **Audit trail.** Without these nobody can check what drove a rank. |
| `SYI_by_watershed` | CSV | Reported separately — this is the official CAT metric |
| `dominant_criterion` | CSV column | Which criterion drove each watershed's rank |
| `treatment_zones` | GeoTIFF, 30 m | Zone 1 / 2 / 3 — ridge-to-valley |
| `structure_sites` | GeoJSON | Point/line locations by structure type, with prerequisite flags |
| `quantity_estimates` | CSV | Trench running metres, earthwork m³, structure counts per watershed |
| `water_balance_check` | CSV | Storage ratio per sub-catchment, with threshold breaches flagged |
| `existing_structures` | GeoJSON | The derived inventory — valuable well beyond this model |
| `desilting_candidates` | GeoJSON | High-saturation + high-sediment watersheds |
| `convergence_map` | Shapefile | Module 1 × Module 2 cross-tabulation |
| `correlation_matrix` | CSV | Methodology annex |
| `sensitivity_results` | CSV | Methodology annex |
**Export settings:** `crs: 'EPSG:32643'`, `scale: 30`, `maxPixels: 1e13`

---
# PART 10 — WHAT THIS MODEL MUST NOT CLAIM
State these limitations explicitly in the report. A CAT plan that declares its own limits is more credible, not less — and a reviewer who finds an undeclared limitation will discount everything else in the document.
1. **Absolute sediment yield figures are unvalidated** until compared against reservoir survey data (7.1). Until then the output is a **relative ranking**.
2. **Subsurface conditions are invisible to satellite.** Percolation tank and subsurface dyke siting requires geophysical survey. Every such site carries a mandatory survey flag.
3. **Rainfall resolves at ~5.5 km.** Erosivity and runoff carry no micro-watershed-scale rainfall detail.
4. **Soil depth is proxied, not measured** (Module 1 C6). It propagates into SYI, HSG and RUSLE K.
5. **The existing structure inventory is remote-sensing derived** and will miss dry, silted or vegetated structures — precisely the ones most in need of desilting.
6. **Groundwater stress is not represented** pending CGWB data. W13 reflects physical recharge *capacity*, not recharge *need*.
7. **Micro-watershed delineation depends entirely on DEM conditioning quality.** If the network validation in 2.3 was not performed, nothing downstream can be relied upon.
8. **The model does not represent channel processes** — bank erosion, bed scour, sediment routing and remobilisation of stored sediment are outside its scope. In an incised Aravalli drainage system these can be a significant fraction of total yield.

---
# PART 11 — WHAT TO DO FIRST
In priority order.
1. **Delineate and validate the stream network and micro-watersheds** (Part 2). Everything else depends on this, and if it is wrong, everything else is wrong. Budget a week including the field/toposheet validation.
2. **Obtain the SLUSI weightage table** for SYI (W1). Without it, the officially expected 16% of the model cannot run. This is a phone call.
3. **Obtain reservoir sedimentation survey data** (7.1). This is the only route from a relative ranking to a quantified sediment budget, and it converts the pilot from a mapping exercise into a calibrated model.
4. **Download the CGWB block groundwater categorisation.** Free, published, and upgrades W13 from proxy to measurement.
5. **Build the existing structure inventory** (W7). Feeds four separate parts of the model and the water balance check.
6. **Run the correlation matrix and sensitivity analysis** before any map is presented. The erosion cluster overlap (Part 6) needs a declared position, not a discovered one.

---
## Closing note on the two modules together
Module 1 tells you **where trees will survive**. Module 2 tells you **where soil and water are being lost**. Neither is complete alone — a plantation on an untreated catchment loses its soil, and a treated catchment without vegetation loses its treatment when the structures silt up.
The convergence analysis in Part 8.3 is where the pilot earns its keep. Everything before it is preparation for that map.

---
## Appendix — jurisdiction boundary asset

An asset reference accompanied this specification: `projects/raygadh-range/assets/BEAT`
(registry ID `6IXSOSZDKGFHEZMX2X7SK6PJ`). It is wired into
`00_config.js` as `JURISDICTION_BOUNDARY_ASSET` and used only for the Part
1.3 reporting-stage jurisdiction flag and the Forest-land framing of W11
("since your programme appears confined to forest land"). Verify this asset
with `print()` before relying on it (see `getJurisdictionBoundary()` in
`02_external_assets.js`) — it has not been independently confirmed to exist
or to contain the expected beat-boundary geometry.
