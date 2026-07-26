# BGDSS Module 2 — Plantation / Eco-Restoration Suitability Model
## Methodology Reference — Data Sources, Weights & Scoring Logic

**Study area:** Beat asset `projects/raygadh-range/assets/BEAT`, Raygadh Range, Sabarkantha Forest Division, Gujarat
**Projection:** EPSG:32643 (UTM Zone 43N) · **Analysis resolution:** 30 m · **Reporting unit:** ~1 ha planning blocks
**Script:** `BGDSS_Module2_CAMPASitePrioritization.js` (standalone Google Earth Engine script)

---

## 1. What the Priority Score means

Every pixel of land is first tested against a **candidate mask** — only land that passes ALL of the following is scored at all:

- Not already well-stocked forest (≥40% canopy, undisturbed since 2000)
- Not water, wetland, built-up area, or cropland
- Not bare rock/hardpan (detected from satellite imagery)
- Not steeper than 35° (beyond practical planting/trenching limits)
- *(If a notified-forest boundary is supplied: not outside it)*

Land that fails any of these is **excluded outright** — it never gets a score, and shows with no color on the map.

For land that **passes** (the "candidate area"), each of the 14 criteria below is:
1. Computed as a raw physical value (meters, percent, tonnes/ha, etc.)
2. Stretched to a 0–1 scale using the **2nd–98th percentile of that criterion's own real values within the candidate area** (not a fixed guessed range — this is what makes the score reflect this specific beat's actual conditions, not a generic assumption)
3. Flipped if needed, so **1 always means "favorable/high-priority" and 0 always means "unfavorable/low-priority"**, regardless of whether the raw criterion naturally runs the other way (e.g., distance — where being *closer* is good — is inverted so *closer* still scores high)

The **Priority Score** is the weighted sum of all 14 (0–1 scale, displayed 0–1 or ×100 for %). **A higher score means: better restoration opportunity, considering all 14 factors at once, weighted by how much your team judged each factor matters.**

It is only meaningful **relative to other land within this same beat** — it is not an absolute, universal suitability rating.

---

## 2. The 14 Criteria — Data, Weight, and Logic

| # | Criterion | Weight | Direction | Data Source | Logic |
|---|---|---|---|---|---|
| 1 | **Distance to Existing Forest** | 10% | Closer = better | Hansen Global Forest Change canopy ≥25% (undisturbed since 2000) + ESA WorldCover tree class → distance transform | Land near real existing forest has a natural seed source; regeneration/plantation succeeds better close to it. |
| 2 | **Hydrological Connectivity** | 8% | Closer/lower = better | ESA WorldCover water/wetland classes + MERIT Hydro drainage area (`upa`) + Height Above Nearest Drainage (`hnd`) | Restoration near water, streams, or in low-lying valley positions (higher soil moisture) gives greater ecosystem-service payoff and better survival odds. |
| 3 | **Fragmentation Index** | 10% | More surrounding forest = better | Same forest mask as #1, local forest proportion in a ~300 m radius | Prioritizes land that consolidates/expands an existing forest patch over isolated restoration that creates a new, disconnected island. |
| 4 | **Wildlife Corridor Proximity** | 8% | Closer = better | *Optional* — your wildlife corridor layer (not yet supplied → running on neutral default) | Buffer-zone restoration near a corridor improves effective corridor width/quality. **Kept separate** from the Connectivity Constraint flag (direct overlap = caution, not a score input). |
| 5 | **Soil Texture (Plant-Available Water Capacity)** | 7% | Higher AWC = better | ISRIC SoilGrids v2 (field capacity − wilting point, depth-weighted 0–60 cm) | Direct physical measure of how much water the soil can hold for a plant — the actual mechanism texture class is normally used as a rough proxy for. |
| 6 | **Soil Depth** | 15% *(largest single weight)* | Deeper = better | Composite: coarse-fragment content + terrain position (valley vs. ridge) + Height Above Nearest Drainage + slope + a bare-rock index from satellite imagery | No reliable single global "depth to bedrock" dataset exists for this region, so depth is inferred from five converging physical indicators. **This is the model's single best candidate for field validation** (see Section 5). |
| 7 | **Soil Organic Carbon** | 6% | Higher = better | ISRIC SoilGrids organic carbon density | Higher organic carbon = better site fertility and restoration potential. |
| 8 | **Workability (Slope & Rainfall)** | 7% | Gentler slope + more rain = better | Copernicus GLO-30 DEM (slope) + CHIRPS rainfall (5-yr mean) | Gentler slope and adequate rainfall = cheaper, more reliable establishment. Slope scoring bands are calibrated to actual Aravalli field practice (staggered contour trenching is standard up to 30–35°, not excluded). |
| 9 | **Climate Exposure** | 5% | Lower heat/drought stress = better | MODIS Aqua LST (pre-monsoon peak heat) + Landsat 8 thermal (fine detail) + CHIRPS 5-yr rainfall variability + a McCune & Keon (2002) slope-aspect heat-load index | Hotter, more drought-variable, sun-exposed (south/southwest-facing) sites are riskier bets for establishment. |
| 10 | **Carbon-Gain Potential** | 6% | Bigger gap = better | GEDI L4A spaceborne lidar biomass (primary) vs. a **local** reference benchmark — the 90th percentile of biomass measured within this beat's own best-preserved forest | The bigger the gap between a site's current biomass and what healthy forest nearby actually carries, the more carbon upside from restoring it. |
| 11 | **Soil Erosion Risk (RUSLE)** | 5% | Higher modeled loss = better (higher priority) | CHIRPS rainfall (Indian CSWCRTI erosivity formula) × soil erodibility × slope/drainage-area factor × land-cover cover factor | Higher modeled soil loss = higher priority for the Soil & Water Conservation co-benefit of restoration. Reported as a **relative ranking**, not an absolute measured tonnage. |
| 12 | **Invasive Species Severity** | 7% | Higher = flagged | Sentinel-2: NDVI amplitude (peak-monsoon greenness minus pre-monsoon/leaf-off greenness) | *Lantana camara* (this region's dominant invasive) stays green through the dry season when native trees are bare — low seasonal amplitude is its signature. **This is a satellite proxy, not a confirmed survey — field-verify before costing clearance.** Flagged sites get a "+ Lantana Clearance" cost/treatment tag. |
| 13 | **Biotic Pressure & Access** | 3% | Farther from settlement + closer to road = better | *Optional* — your village/road layers (not yet supplied → running on partial/coarse default) | Farther from villages = less free-grazing pressure (this is an eco-restoration programme, not community-managed JFM, so proximity means risk, not stewardship). Closer roads = lower cost (fencing, watering, transport). |
| 14 | **Fire Frequency History** | 3% | Lower history = better | MODIS Burned Area, 10-year look-back, cropland excluded (to avoid counting crop-residue burning as forest fire) | Fire-prone land is a riskier restoration investment; flagged sites get a "+ Fireline" cost tag rather than being excluded outright. |

**Weights sum to exactly 100%** (the script verifies this automatically and refuses to run otherwise).

---

## 3. What comes out the other end

- **Recommended Treatment** (separate from the Priority Score): **New Plantation** (scrub, <10% canopy), **ANR** — Assisted Natural Regeneration (open forest, 10–40% canopy — the official FSI/ISFR classification), or **Not Prioritized** (already well-stocked, or excluded by the candidate mask)
- **Connectivity Constraint**: a separate caution flag for any site overlapping a wildlife corridor or protected area — shown alongside the priority ranking, never subtracted from it
- **Ranked block list**: every ~1 ha block, sorted best-to-worst, with cumulative area — so the top-ranked blocks up to your funded target hectares are the ones actually proposed

---

## 4. What's running on a placeholder right now

Two of the 14 criteria are on neutral defaults because their optional input layers haven't been supplied yet:

| Criterion | Weight affected | What would fix it |
|---|---|---|
| Wildlife Corridor Proximity | 8% | Supply a wildlife corridor boundary/line layer |
| Biotic Pressure & Access | 3% (partially) | Supply village point + road line layers |

Combined, that's **11% of the model's weight** currently running on neutral assumptions rather than real local data — the single biggest accuracy improvement available without any new methodology, just data you may already have.

---

## 5. Recommended next step for credibility

**Soil Depth carries the largest weight (15%) and is the least directly measured criterion** (a 5-factor terrain/satellite composite, not a direct measurement). The single highest-return fix available: record 30–50 GPS-located soil-pit depths across the beat, and this composite can be replaced with a locally-calibrated model trained on your own field data — turning your weakest input into your most defensible one.

---

*Generated from `BGDSS_Module2_CAMPASitePrioritization.js`. If the script's CONFIG.weights or criteria change, regenerate this table to keep it in sync.*
