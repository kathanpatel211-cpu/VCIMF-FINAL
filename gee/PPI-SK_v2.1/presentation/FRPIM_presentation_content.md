# FRPIM v2.2 — Presentation Content (slide by slide)

**Deck title:** Forest Restoration Priority & Intervention Model (FRPIM v2.2)
**Sub-title:** A satellite-based, block-level restoration plan for Khedbrahma Range, Gujarat
**Audience:** PMO / senior Government review
**Length:** 24 slides (about 25–30 minutes, plus Q&A)
**Style note for Claude Design:** Use a clean government style with a white background, forest green (#1B5E20), earth brown (#6D4C41) and a single accent (#F9A825). Put one message on each slide, and show numbers large. Use the three maps exported from the model (PNG files in `maps/`) as full-bleed images on slides 16, 17 and 18.

---

## SLIDE INDEX

| # | Slide | Section |
|---|-------|---------|
| 1 | Title | Opening |
| 2 | The problem in one line | Opening |
| 3 | What FRPIM answers | Opening |
| 4 | Study area: Khedbrahma Range | Context |
| 5 | Model workflow (one picture) | Method |
| 6 | Satellite and geospatial data used (24 datasets) | Data |
| 7 | Planning unit: 10-hectare block grid | Method |
| 8 | Hard constraints (C1–C7) and flags (G1–G5) | Method |
| 9 | Restoration Need Index (RNI): 8 indicators and weights | Index 1 |
| 10 | Restoration Feasibility Index (RFI): 14 indicators and 4 groups | Index 2 |
| 11 | How indicators become scores (normalisation and formulas) | Method |
| 12 | Weight safety: CV guard and collinearity check | Science |
| 13 | Need × feasibility: the 5×5 phase matrix | Decision |
| 14 | Degradation evidence (DE1–DE4) | Science |
| 15 | Intervention rules: 11 prescriptions | Decision |
| 16 | MAP 1: Restoration Need | Results |
| 17 | MAP 2: Restoration Feasibility | Results |
| 18 | MAP 3: Restoration Priority Phase | Results |
| 19 | Area statement: what, where, how much | Results |
| 20 | Interventions and species plan | Results |
| 21 | Reliability: Monte Carlo uncertainty (500 runs) | Science |
| 22 | Quality control: 28 automatic checks | Science |
| 23 | Ground truthing and accuracy assessment plan | Validation |
| 24 | Limitations, scale-up and the ask | Close |

---

## SLIDE 1: Title

**Title:** Forest Restoration Priority & Intervention Model (FRPIM v2.2)
**Sub-title:** Where to restore first, and how, in every 10-hectare block of Khedbrahma Range
**Footer:** Khedbrahma Range, Gujarat Forest Department · Built on Google Earth Engine · 2026
**Visual:** A cropped strip of Map 3 (the priority phase map) as the background band.

**Speaker note:** This is a decision tool. It does not replace the forester. It tells us, block by block, where restoration is needed most, where it is most likely to succeed, in which order to work, and which treatment fits.

---

## SLIDE 2: The problem in one line

**Headline:** We plant every year. The open questions are where it is needed most, where it will survive, and in which order.

**Three points:**
- Restoration budgets are limited, and survival depends on soil, moisture, slope, fire and biotic pressure.
- Plantation sites today are often chosen by accessibility rather than by need or feasibility.
- Without a common, transparent method, results cannot be compared across beats, ranges or years.

**Visual:** Three icons: budget (₹), seedling with a question mark, and a map pin.

---

## SLIDE 3: What FRPIM answers

| Question | FRPIM output |
|---|---|
| How degraded is this land? | **Restoration Need Index (RNI)**, Map 1 |
| Will restoration succeed here? | **Restoration Feasibility Index (RFI)**, Map 2 |
| In which order should we work? | **Priority Phase 1–5**, Map 3 |
| What should we do on the ground? | **One of 11 interventions** per block |
| Which species? | **Species group** per block |
| How sure are we? | **Monte Carlo reliability** and **field accuracy** |

**Speaker note:** Every answer is at 10-hectare block level, so it can go straight into an annual plan of operations.

---

## SLIDE 4: Study area, Khedbrahma Range

**Key facts (large numbers):**
- **6,246.6 ha** total area modelled (gross)
- **829** planning blocks of 10 ha each
- **5,271.8 ha** net plantable area in retained blocks
- Landscape: dry-deciduous Aravalli foothills with open scrub. Mean canopy cover is **1.4 %** in retained blocks.

**Visual:** Locator map (India → Gujarat → Sabarkantha → Khedbrahma Range boundary).

**Speaker note:** The range boundary is the official asset `projects/khedbrahma-range/assets/khedbrahma`. Nothing outside it is scored. Only the reference values (anchors) use a 20 km buffer, so the scale is local but stable.

---

## SLIDE 5: Model workflow

**Flow diagram (left to right):**
1. **24 open datasets** (satellite, terrain, soil, climate, fire, people)
2. **Pre-processing** on Google Earth Engine: cloud masking (Cloud Score+), multi-year composites, UTM 43N (EPSG:32643)
3. **10-ha block grid** and **constraints C1–C7**
4. **22 indicators** (8 need + 14 feasibility), normalised 0–1 against local anchors
5. **RNI** and **RFI** indices, then quintile classes 1–5
6. **5×5 matrix** → **Priority Phase 1–5**
7. **Rule engine** → **11 interventions** + species group
8. **Uncertainty (500 Monte Carlo runs)** + **28 QC checks**
9. **3 maps + area statement + field-check list**

**Speaker note:** Two scripts run in sequence. Run 1 extracts all data to blocks; Run 2 scores, classifies, tests and publishes. The process is fully reproducible: same inputs, same seed (2026), same answer.

---

## SLIDE 6: Satellite and geospatial data used (24 datasets)

| ID | Dataset | Resolution | Used for |
|---|---|---|---|
| D01 | FABDEM (forest- and building-removed DEM) | 30 m | Slope, aspect, curvature, soil depth proxy |
| D02 | Copernicus GLO-30 DEM | 30 m | DEM cross-check |
| D03 | MERIT Hydro | 90 m | Height above drainage (HAND), drains |
| D04 | Hydrography90m CTI | 90 m | Wetness index (F1) |
| D05 | CHIRPS daily rainfall | ~5.5 km | Water balance, RESTREND, erosion |
| D06 | MODIS MOD16A2GF evapotranspiration | 500 m | Climatic water balance (F3) |
| D07 | Sentinel-2 L2A Surface Reflectance | 10 m | NDVI, bare soil, shrub invasion |
| D08 | Cloud Score+ for Sentinel-2 | 10 m | Cloud masking |
| D09 | Landsat 8 & 9 Collection 2 L2 | 30 m | Long-term NDVI trend |
| D10 | JRC Global Surface Water v1.4 | 30 m | Water exclusion, near seasonal water (F4) |
| D11 | SoilGrids 250 m (ISRIC) | 250 m | Texture, coarse fragments, pH |
| D12 | Meta Global Canopy Height | 1 m | Canopy cover, dense forest |
| D13 | Hansen Global Forest Change v1.13 (2000–2025) | 30 m | Tree loss, tree cover 2000 |
| D14 | Google Dynamic World | 10 m | Land-cover probability |
| D15 | ESA WorldCover v200 | 10 m | Built-up, cropland, rock, anchor mask |
| D16 | ESA CCI Above-Ground Biomass v6 | 100 m | Biomass deficit (N5) |
| D17 | MODIS MCD64A1 Burned Area | 500 m | Fire gap filler 2022–23 |
| D18 | VIIRS 375 m active fire (archive + LANCE NRT) | 375 m | Fire frequency 2015–2025 (F13) |
| D19 | JRC GHSL population | 100 m | Biotic pressure (F14) |
| D20 | WDPA protected areas | Vector | Protected-area flag (G2) |
| D21 | GRIP4 roads | Vector | Access and biotic pressure (F14) |
| D22 | FAO GAUL Level-1 | Vector | Administrative check |
| D23 | SoilGrids water retention (wv0033, wv1500) | 250 m | Available water capacity (F2) |
| D24 | Landsat 5 & 7 Collection 2 L2 | 30 m | 2000–2005 baseline NDVI (DE4, RESTREND) |

**Callout:** All datasets are free and open, with no purchased imagery. The model can be replicated in any range at zero data cost.

**Speaker note:** Satellite-only means consistent and repeatable. The model records the 2022–23 VIIRS archive gap and fills it with MODIS burned area. QC check FF-24 reports this gap openly.

---

## SLIDE 7: Planning unit, the 10-hectare block

- Regular square grid with a 316.23 m side (exactly 10 ha), in UTM zone 43N
- **829 blocks** cover the range. Edge blocks are clipped to the boundary.
- Each block carries **more than 170 attributes**: raw values, scores, indices, class, phase, intervention, flags and reliability.
- The output is GIS-ready (GeoJSON / Shapefile / GEE asset) and works directly in QGIS, the mobile app or a field GPS.

**Why 10 ha:** It is small enough to be one field unit for a plantation or SMC work, and large enough to average out pixel noise from 10–30 m imagery.

**Visual:** Zoomed grid over a satellite image with one block highlighted and its attribute card.

---

## SLIDE 8: Hard constraints and advisory flags

**Constraints (block removed from the matrix when the constraint covers more than 30 % of the block; C1 handled separately):**

| Code | Constraint | Result |
|---|---|---|
| C1 | Canopy ≥ 40 % (dense forest) | **PROTECTED**: protect only, no planting |
| C2 | Permanent / seasonal water | EXCLUDED |
| C3 | Drains / stream channels | EXCLUDED |
| C4 | Slope > 45 % | EXCLUDED |
| C5 | Built-up | EXCLUDED |
| C6 | Cropland / cultivation | EXCLUDED (rights / encroachment check) |
| C7 | Bare rock | EXCLUDED |

**Advisory flags (never remove a block; they inform the field team):**
- **G1** Recent plantation? (33 blocks)
- **G2** Inside a protected area (335 blocks)
- **G3** Soil-depth-sensitive block, so dig a soil pit (8 blocks)
- **G4** Waterlogging risk (0 blocks)
- **G5** Grassland option, optional note only (343 blocks; they stay under plantation)

**Result:** 54 blocks are PROTECTED (362.4 ha), 85 are EXCLUDED (444.0 ha), and **690 blocks enter the analysis**.

---

## SLIDE 9: Restoration Need Index (RNI): 8 indicators

**Question:** How degraded is the block? A higher value means more need.

| Code | Indicator | Data source | Spec weight | Final weight* |
|---|---|---|---|---|
| N1 | Canopy deficit | Meta canopy height (D12) | 25 | **27.78** |
| N2 | Bare soil at peak greenness (fractional vegetation cover + bare soil index) | Sentinel-2 (D07, D08) | 15 | **16.67** |
| N3 | NDVI decline after rainfall correction (RESTREND) | Landsat 5/7/8/9 + CHIRPS (D09, D24, D05) | 15 | **16.67** |
| N4 | Soil erosion risk (RUSLE) | DEM, CHIRPS, SoilGrids, Sentinel-2 | 15 | **16.67** |
| N5 | Biomass deficit | ESA CCI biomass (D16) | 10 | **11.11** |
| N6 | Unrecovered tree loss | Hansen GFC (D13) + canopy | 10 | **0** |
| N7 | Evergreen shrub invasion (dry-season greenness) | Sentinel-2 (D07) | 5 | **5.56** |
| N8 | Proximity to dense forest (seed source / restoration context) | Canopy height (D12) | 5 | **5.56** |
| | **Total** | | **100** | **100** |

\*Final weight after the CV guard (slide 12). N6 had zero variation in this range (no recorded loss-without-regrowth), so it carried no information. Its 10 points were shared in proportion among the other need indicators.

**Formula:** RNI = Σ (wᵢ × Nᵢ) / 100, range 0–1
**Khedbrahma result:** RNI from **0.341 to 0.799**

---

## SLIDE 10: Restoration Feasibility Index (RFI): 14 indicators in 4 groups

**Question:** If we restore here, will it succeed? A higher value means more likely success.

| Group (points) | Code | Indicator | Data source | Spec weight | Final weight* |
|---|---|---|---|---|---|
| **M: Moisture (35)** | F1 | Wetness (topographic CTI) | Hydrography90m (D04) | 15 | 15 |
| | F2 | Soil available water capacity | SoilGrids wv0033 / wv1500 (D23) | 10 | 10 |
| | F3 | Climatic water balance (rain − ET) | CHIRPS + MODIS ET (D05, D06) | 5 | 5 |
| | F4 | Near seasonal water | JRC GSW (D10) | 5 | 5 |
| **S: Soil (35)** | F5 | Soil depth proxy (slope, TPI, HAND) | FABDEM + MERIT (D01, D03) | 12 | **10.61** |
| | F6 | Low rockiness (surface roughness) | FABDEM (D01) | 7 | **6.19** |
| | F7 | Soil texture | SoilGrids (D11) | 6 | **0** |
| | F8 | Low coarse fragments | SoilGrids (D11) | 6 | **18.20** |
| | F9 | Soil pH | SoilGrids (D11) | 4 | **0** |
| **T: Terrain (18)** | F10 | Gentle slope | FABDEM (D01) | 8 | 8 |
| | F11 | Cool aspect (heat load index) | FABDEM (D01) | 7 | 7 |
| | F12 | Concave curvature (water-gathering) | FABDEM (D01) | 3 | 3 |
| **R: Risk (12)** | F13 | Low fire frequency 2015–2025 | VIIRS + MODIS (D17, D18) | 7 | **0** |
| | F14 | Low biotic pressure (people, roads) | GHSL + GRIP4 (D19, D21) | 5 | **12** |

\*After the CV guard. F7, F9 (SoilGrids is too coarse to vary within the range) and F13 (only 3 blocks burned in 11 years) were near-constant. Their points went to the other members of the **same group**, so group totals stay 35/35/18/12.

**Formula (non-compensatory):**
RFI = M^0.325 × S^0.325 × (0.55 + 0.45 × TR), where TR = (18·T + 12·R) / 30

**Why this form:** Good terrain cannot make up for no water or no soil. If moisture or soil is very poor, RFI falls sharply.
**Khedbrahma result:** RFI from **0.389 to 0.684**

---

## SLIDE 11: From pixels to scores

1. **Pixel to block:** each indicator is averaged (or summed as a share) over the 10-ha block. Constrained pixels are masked out.
2. **Local anchors:** each indicator is scaled 0–1 between its **2nd and 98th percentile** across the range plus a 20 km buffer, on natural vegetation classes only (WorldCover tree, shrub, grass, sparse). This gives a local benchmark, not a national one.
3. **Direction:** each indicator is oriented so that 1 = more need (RNI) or more feasible (RFI).
4. **Missing values:** filled with the beat mean and reported in QC check FF-06.
5. **Classes:** RNI and RFI are each split into **5 quintile classes** (Very Low → Very High), roughly 138 blocks per class.

**Class breaks (Khedbrahma):**
- RNI: 0.6109 | 0.6425 | 0.6754 | 0.7099
- RFI: 0.5339 | 0.5595 | 0.5794 | 0.6034

**Speaker note:** Quintiles are relative within the range. They rank blocks against each other, which is exactly what is needed to decide the order of work.

---

## SLIDE 12: Weight safety, the CV guard and collinearity checks

**CV guard (automatic):** An indicator that barely varies across the range (coefficient of variation < 0.05) cannot rank blocks. It only adds noise. FRPIM sets its weight to zero and shares its points within the same index or group, and logs the change.

| Removed | CV | Points moved to |
|---|---|---|
| N6 Unrecovered tree loss | 0.0000 | other RNI indicators (10 pts) |
| F7 Soil texture | 0.0000 | Soil group (6 pts) |
| F9 Soil pH | 0.0013 | Soil group (4.83 pts) |
| F13 Fire frequency | 0.0060 | Risk group (7 pts) |

**Collinearity checks:** Spearman correlation between every pair of indicators (threshold |ρ| ≤ 0.75) and the variance inflation factor (VIF ≤ 5). Known pairs (F5–F10, N1–N5) have automatic merge rules. Need and feasibility must stay independent (|ρ(RNI, RFI)| ≤ 0.60).

**Speaker note:** This is what makes the weighting defensible. Expert weights are used, but data that carry no information are never allowed to influence the ranking.

---

## SLIDE 13: The decision, a 5×5 need × feasibility matrix

**Rows = Need class (RNI); columns = Feasibility class (RFI). Cell = Priority Phase.**

| Need ↓ / Feasibility → | Very Low | Low | Medium | High | Very High |
|---|---|---|---|---|---|
| **Very High** | 2 | 2 | 1 | 1 | **1** |
| **High** | 3 | 2 | 2 | 2 | 1 |
| **Medium** | 4 | 3 | 3 | 3 | 2 |
| **Low** | 5 | 4 | 4 | 4 | 3 |
| **Very Low** | 5 | 5 | 5 | 5 | 4 |

**Rule:** Phase 1 = high need and high chance of success, so work there first. Phase 5 = low need, so do it last or let it recover naturally.

**Visual:** Colour the matrix dark green (Phase 1) to pale (Phase 5).

---

## SLIDE 14: Degradation evidence (DE1–DE4)

**Purpose:** An independent check that a block was once better and has declined. It raises confidence only; it does **not** change the score.

| Code | Evidence | Rule |
|---|---|---|
| DE1 | Had tree cover in 2000 | Hansen tree cover 2000 ≥ 10 % |
| DE2 | Recorded tree loss | Loss share ≥ 5 % of the block (2001–2025) |
| DE3 | Declining NDVI trend | RESTREND slope < 0 on ≥ 60 % of pixels |
| DE4 | NDVI dropped since 2000–05 | NDVI(2000–05) − NDVI(2021–25) ≥ 0.08 |

**Khedbrahma result:** 11 of 690 blocks show evidence (all DE3, a declining greenness trend). The other 679 show no historical decline signal.

**Interpretation for the audience:** Most of the range has been **persistently open scrub for 25 years**, not recently cleared forest. The main need is to establish cover on long-degraded land, with soil and moisture conservation, rather than to recover from recent loss. This is consistent with a mean canopy of 1.4 %.

---

## SLIDE 15: Intervention rule engine (11 prescriptions)

Rules are checked **in order**. The first matching rule is assigned to the block.

| # | Intervention | Trigger (simplified) |
|---|---|---|
| 1 | PROTECT_DENSE | C1, canopy ≥ 40 % |
| 2 | NOT_PLANTABLE | Excluded C2–C7 |
| 3 | FIRE_PROTECTION_FIRST | High fire frequency |
| 4 | HYDRO_COMPATIBLE_PLANTING | Waterlogging / very wet |
| 5 | SOIL_STABILISATION_FIRST | High erosion and steep slope |
| 6 | ROCKY_MICROSITE | Very rocky, shallow soil |
| 7 | INVASIVE_CLEAR_THEN_PLANT | Evergreen shrub invasion high |
| 8 | SMC_DROUGHT_HARDY | Low moisture: soil-moisture conservation + drought-hardy species |
| 9 | ANR_GAP_PLANTING | Canopy 10–40 % or need Very Low: assisted natural regeneration |
| 10 | BLANK_AREA_PLANTATION | Canopy < 10 % |
| 11 | MIXED_NATIVE_PLANTATION | Default |

**Plus, for every block:** SMC required (yes/no) and a recommended **species group**.

---

## SLIDE 16: MAP 1, Restoration Need Index

**Visual:** Full-bleed image `maps/FRPIM_v2.2_Khedbrahma_Map1_Restoration_Need_Index.png`

**Side panel:**

| Class | Blocks | Net area (ha) |
|---|---|---|
| Very High need | 139 | 1,169.3 |
| High | 138 | 1,065.4 |
| Medium | 138 | 1,098.7 |
| Low | 138 | 1,010.9 |
| Very Low | 137 | 927.5 |

**Message:** The highest-need blocks cluster where canopy is absent, bare soil is exposed and the erosion risk is high.

---

## SLIDE 17: MAP 2, Restoration Feasibility Index

**Visual:** Full-bleed image `maps/FRPIM_v2.2_Khedbrahma_Map2_Restoration_Feasibility_Index.png`

**Side panel (net ha):**
- Very High feasibility: 969.0
- High: 999.9
- Medium: 1,094.9
- Low: 1,102.6
- Very Low: 1,105.3

**Message:** Feasibility follows moisture and soil: valley bottoms, concave and cooler slopes, and low-fragment soils score highest. Ridge tops and rocky, sun-facing slopes score lowest.

---

## SLIDE 18: MAP 3, Restoration Priority Phase (the action map)

**Visual:** Full-bleed image `maps/FRPIM_v2.2_Khedbrahma_Map3_Restoration_Priority_Phase.png`

**Side panel (gross ha):**

| Phase | Area (ha) | Meaning |
|---|---|---|
| **Phase 1** | **789.5** | Start now |
| **Phase 2** | **1,505.6** | Next |
| Phase 3 | 1,201.8 | Medium term |
| Phase 4 | 999.1 | Later |
| Phase 5 | 944.2 | Last / natural recovery |
| Protected | 362.4 | Protect dense forest |
| Excluded | 444.0 | Not plantable |
| **Total** | **6,246.6** | |

**Headline number:** **Phase 1 + 2 = 2,295 ha**, the first five-year programme.

---

## SLIDE 19: Area statement

**Net plantable area by phase and intervention (ha):**

| Phase | SMC + drought-hardy | Blank-area plantation | ANR gap planting | Total |
|---|---|---|---|---|
| 1 | 409.7 | 351.0 | — | **760.7** |
| 2 | 1,016.7 | 449.6 | — | **1,466.3** |
| 3 | 766.1 | 404.6 | — | **1,170.7** |
| 4 | 477.7 | 263.9 | 227.5 | **969.1** |
| 5 | 376.7 | 85.8 | 442.3 | **904.8** |
| **Total** | **3,047.0** | **1,555.0** | **669.8** | **5,271.8** |

- Soil-moisture conservation is needed in **653 blocks (5,058.1 ha)**.
- Constrained area inside retained blocks (deducted): 168.4 ha.

**Speaker note:** This table can go directly into the working plan or a DPR. The suggested annual targets follow from the phase sequence.

---

## SLIDE 20: Interventions and species plan

**Interventions (blocks / ha):**
- SMC + drought-hardy planting: **375 blocks / 3,047.0 ha**
- Blank-area plantation: **211 blocks / 1,555.0 ha**
- ANR gap planting: **104 blocks / 669.8 ha**
- Protect dense forest: **54 blocks**
- Not plantable: **85 blocks**

**Species groups (net ha):**

| Group | Species | Area |
|---|---|---|
| Drought-hardy | Khair, ber, desi babul, guggal, hingor | 3,047.0 ha |
| Medium | Teak, dhavdo, timru, khakhro, neem, sadad | 2,202.9 ha |
| Moist / deep soil | Mahudo, bamboo, jambu, karanj, amla | 21.9 ha |

**Message:** Khedbrahma is a **water-limited** landscape. 58 % of the plantable area needs drought-hardy species with SMC, so trenching and water harvesting come before or alongside planting.

---

## SLIDE 21: How reliable is the ranking? Monte Carlo uncertainty

**Method:** The model was re-run **500 times**. Each run varied all weights randomly around their set values (Dirichlet distribution, concentration 125) and **recomputed the class breaks**. For each block we count how often it stays in Phase 1–2. This value is `stability_p12`.

**Result for the 281 Phase 1–2 blocks:**
- Mean stability: **0.948**
- **253 blocks** stable more than 80 % of the time
- 26 blocks: 50–80 %
- Only **2 blocks** below 50 %

**Also tested:** an optimistic and a pessimistic soil-depth variant. 8 blocks are sensitive to soil depth, and these are flagged G3 for a soil pit.

**Message:** The priority list does not depend on the exact choice of weights. About 95 % of the Phase 1–2 decision holds under any reasonable weighting.

**Visual:** Histogram of stability_p12, with most bars at 0.9–1.0.

---

## SLIDE 22: Quality control, 28 automatic checks

Every run prints a QC table with PASS / ACTION / FAIL / STOP for each check. Key checks:

| Area | Checks |
|---|---|
| Data integrity | Dataset availability, image scales, block size 10 ± 0.01 ha, null shares, beat IDs |
| Arithmetic | RNI weights = 100, RFI groups = 35/35/18/12, all scores in [0, 1] |
| Statistics | CV guard, Spearman pairs ≤ 0.75, VIF ≤ 5, need–feasibility independence ≤ 0.60 |
| Logic | Dense forest always Protected; burned blocks never score as fire-safe; G5 never excludes |
| Observation density | Clear Sentinel-2 observations per window, Landsat years available, 2000–05 baseline |
| Uncertainty | Monte Carlo convergence |
| Traceability | Fire data gap recorded; comparison with the earlier v2.1 model; dataset version watch |

**Honest note:** FF-20 (index spread p95 − p5 ≥ 0.30) reports a narrow spread, because the range is ecologically homogeneous. The ranking is still stable (slide 21), but differences between neighbouring classes are small. This is why field validation matters.

**Comparison with the earlier model (v2.1):** 178 blocks kept priority; 158 newly prioritised (1,353 ha); 98 deprioritised (619 ha); 395 no major change.

---

## SLIDE 23: Ground truthing and accuracy assessment

**Design:** Stratified random sampling, following Olofsson et al. (2014) and Stehman (2014), the standard in remote-sensing accuracy assessment.
- **38 field plots:** 6 per phase (×5), 4 Protected, 4 Excluded
- **14 reserve plots** for inaccessible sites; **4 repeat (QC) plots** to measure observer error
- Each plot is a random point at least 30 m inside its block. The crew does not know the map class (blind IDs).
- Plot method: point-intercept transects for canopy, bare soil, rock, shrubs, and soil depth and erosion signs.

**Field indices:** The field need index (FNI) and field feasibility index (FFI) are computed from plot data and compared with RNI and RFI.

**Statistics reported:**
- Spearman ρ and Kendall τ between map and field
- Quadratic-weighted kappa for classes
- Error matrix with overall, user's and producer's accuracy
- Area-adjusted estimates with 95 % confidence intervals (bootstrap)

**Effort:** a small field team can complete it within the protocol in the field manual.

**Visual:** Map 3 with the 38 plot points overlaid, and a photo of a field crew with a tablet.

---

## SLIDE 24: Limitations, scale-up and the ask

**Limitations (stated openly):**
- SoilGrids (250 m) is too coarse within a single range, so soil depth uses a terrain proxy, with soil pits on G3 blocks.
- The index spread is narrow in a homogeneous landscape. Classes are relative and need field confirmation.
- The VIIRS fire archive has a gap in 2022–23, filled with MODIS.
- Recent plantations (G1) can look like bare land and are flagged for verification.

**Why it can scale:**
- 100 % open data, **zero data cost**
- One script; replace the range boundary asset to run any range, division or state
- Reproducible (fixed seed), auditable (QC table), and updated each year as new imagery arrives
- Each block has an ID that can link to plantation records, the mobile app and survival monitoring

**Recommendations / the ask:**
1. Approve **Phase 1 (789.5 ha)** as the first-year pilot, with SMC-first treatment.
2. Carry out the **38-plot accuracy assessment** and publish the results.
3. Scale FRPIM to all ranges of the division, then the state, as a **standard planning layer**.
4. Link plantation survival monitoring to FRPIM blocks so the model learns from outcomes.

**Closing line:** *Restore the right land, in the right order, with the right method, and prove it with data.*

---

## APPENDIX SLIDES (optional, for questions)

- **A1. Full formula sheet:** normalisation, RNI, RFI, TR, the phase matrix and the rule order.
- **A2. Final weights JSON:** N1 27.78, N2 16.67, N3 16.67, N4 16.67, N5 11.11, N6 0, N7 5.56, N8 5.56 | F1 15, F2 10, F3 5, F4 5, F5 10.61, F6 6.19, F7 0, F8 18.20, F9 0, F10 8, F11 7, F12 3, F13 0, F14 12.
- **A3. QC table** printed from Run 2 (all 28 checks).
- **A4. Field-check list:** 680 blocks carry at least one field note, mostly the optional G5 grassland note.
- **A5. References:** Olofsson et al. 2014 (*Remote Sensing of Environment* 148: 42–57); Stehman 2014 (*International Journal of Remote Sensing* 35: 4923–4939); Wessels et al. 2007 (RESTREND); Renard et al. 1997 (RUSLE); Hansen et al. 2013 (*Science* 342: 850–853).
