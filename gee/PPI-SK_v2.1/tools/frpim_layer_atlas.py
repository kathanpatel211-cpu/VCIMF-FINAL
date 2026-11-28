"""
FRPIM v2.2: Layer Atlas (every input and intermediate layer, mapped per 10 ha block).

One A3 page (300 dpi PNG + vector PDF) per layer: vegetation, degradation, erosion, moisture, terrain,
soil, biotic pressure, model components and outputs. There are also two summary pages that show all
indicator scores (N1-N8 and F1-F14), and one combined PDF atlas with a cover and an index.

Values are read from the block table the GEE script exported (FRPIM02_blocks_<range>.geojson),
so every page shows exactly what entered the model.

Usage : python frpim_layer_atlas.py blocks.geojson OUTPUT_DIR
Needs : matplotlib, shapely, pyproj, numpy, pymupdf (for the combined atlas)
"""
import json
import sys
from pathlib import Path

import numpy as np
import matplotlib.pyplot as plt
from matplotlib import colormaps
from matplotlib.colors import Normalize

sys.path.insert(0, str(Path(__file__).resolve().parent))
import frpim_layout_common as C  # noqa: E402

# ------------------------------------------------------------------ palettes (5 classes, low -> high)
GREEN = ["#f7fcb9", "#c2e699", "#78c679", "#31a354", "#006837"]
BROWN = ["#fff7bc", "#fee391", "#fec44f", "#d95f0e", "#993404"]
RED = ["#fee5d9", "#fcae91", "#fb6a4a", "#de2d26", "#a50f15"]
BLUE = ["#eff3ff", "#bdd7e7", "#6baed6", "#3182bd", "#08519c"]
PURPLE = ["#f2f0f7", "#cbc9e2", "#9e9ac8", "#756bb1", "#54278f"]
SLOPE = ["#1a9641", "#a6d96a", "#ffffbf", "#fdae61", "#d7191c"]
DIV_RG = ["#d7191c", "#fdae61", "#ffffbf", "#a6d96a", "#1a9641"]     # decline -> gain
DIV_BB = ["#8c510a", "#d8b365", "#f5f5f5", "#5ab4ac", "#01665e"]     # dry/convex -> wet/concave
SCORE = ["#d73027", "#fc8d59", "#fee08b", "#91cf60", "#1a9850"]      # poor -> good
NEED = ["#ffffcc", "#fed976", "#fd8d3c", "#e31a1c", "#800026"]
GREY = "#d9d9d9"

S2 = "Sentinel-2 L2A 10 m with Cloud Score+ masking (Google Earth Engine)"
LS = "Landsat 5/7/8/9 Collection 2 Level-2, 30 m (Google Earth Engine)"
DEM = "FABDEM v1-2 30 m (forest- and building-removed Copernicus DEM)"
SG = "SoilGrids 2.0, 250 m, ISRIC (0-30 cm thickness-weighted mean)"


def rev(p):
    return list(reversed(p))


def L(code, key, title, sub, value, unit, fmt, palette, about, data, use, breaks="q", names=None, section=""):
    return dict(kind="cont", code=code, key=key, title=title, sub=sub, value=value, unit=unit, fmt=fmt,
                palette=palette, about=about, data=data, use=use, breaks=breaks, names=names, section=section)


def CAT(code, key, title, sub, value, classes, about, data, use, section=""):
    """classes: list of (match_value, label, colour, description)."""
    return dict(kind="cat", code=code, key=key, title=title, sub=sub, value=value, classes=classes,
                about=about, data=data, use=use, section=section)


def g(k, mult=1.0):
    return lambda p: float(p[k]) * mult


LAYERS = [
    # ---------------------------------------------------------------- A. Vegetation and cover
    L("A1", "canopy", "Tree Canopy Cover", "Share of each block under tree crowns (trees >= 5 m tall)",
      g("canopy_pct"), "%", "{:.0f}", GREEN,
      "Canopy cover is the share of the block covered by tree crowns at least 5 m tall. Blocks at 40 % "
      "or more are dense forest: they are protected (C1) and never planted. Below 10 % a block is "
      "treated as a blank area.",
      "Meta / WRI Global Canopy Height 1 m; trees lost since 2019 (Hansen GFC) are removed.",
      "N1 Canopy deficit (need), constraint C1, and the ANR / blank-area intervention rules.",
      breaks=[1, 10, 25, 40], names=["Open (< 1 %)", "Very sparse", "Sparse", "Open forest", "Dense (C1)"],
      section="A. Vegetation and land cover"),
    L("A2", "fvc", "Vegetation Cover at Peak Greenness", "Fractional vegetation cover, mid-October to November 2021-2025",
      g("N2_fvc", 100), "%", "{:.0f}", GREEN,
      "How much of the ground is covered by green vegetation when the landscape is greenest (after the "
      "monsoon). Low values mean the soil stays exposed even in the best season.",
      S2 + "; NDVI scaled to fractional cover.",
      "N2 Bare soil at peak greenness (need).", section="A. Vegetation and land cover"),
    L("A3", "ndvi_now", "Current Greenness (NDVI)", "Landsat NDVI, September-November median, 2021-2025",
      g("DE4_ndvi_2021_25"), "NDVI", "{:.2f}", GREEN,
      "NDVI measures green leaf density from 0 (bare) to 1 (dense green). This is the post-monsoon "
      "median of five recent years, so a single wet or dry year does not dominate.",
      LS + ".", "Degradation evidence DE4 (compared with 2000-2005).", section="A. Vegetation and land cover"),
    L("A4", "biomass", "Above-Ground Biomass Deficit", "Score 0-1; 1 = lowest biomass in the landscape",
      g("N5"), "score", "{:.2f}", NEED,
      "Woody biomass compared with the landscape: a score near 1 means the block holds almost no woody "
      "biomass compared with the best-stocked natural vegetation of the range and its surroundings.",
      "ESA CCI Above-Ground Biomass v6.0, 2022, 100 m.", "N5 Biomass deficit (need).",
      section="A. Vegetation and land cover"),
    L("A5", "open", "Open Grass and Bare Land", "Share of the block mapped as grassland or bare (ESA WorldCover)",
      g("wc_open_frac", 100), "%", "{:.0f}", BROWN,
      "Share of the block that the 10 m global land-cover map classes as grassland or bare / sparse "
      "vegetation. High values mark open landscapes where the grassland note (G5) applies.",
      "ESA WorldCover v200 (2021), 10 m.", "Flag G5 grassland option (note only; never excludes a block).",
      section="A. Vegetation and land cover"),
    L("A6", "shrub", "Evergreen Shrub Invasion", "Share of the block with a dry-season-green, low-canopy signal",
      g("N7_raw", 100), "%", "{:.1f}", RED,
      "Pixels that stay green in April-May (NDVI 0.30-0.60) with little seasonal change and under 20 % "
      "tree canopy: the typical signature of invasive evergreen shrubs such as Prosopis or Lantana.",
      S2 + ", 2021-2025 dry and peak seasons.", "N7 Shrub invasion (need) and the INVASIVE_CLEAR_THEN_PLANT rule.",
      breaks=[0.1, 1, 3, 6], names=["None (< 0.1 %)", "Trace", "Low", "Moderate", "High"],
      section="A. Vegetation and land cover"),

    # ---------------------------------------------------------------- B. Degradation and erosion
    L("B1", "bsi", "Bare Soil Index", "Share of the block with exposed soil (BSI > 0) at peak greenness",
      g("N2_bsi_share", 100), "%", "{:.0f}", BROWN,
      "The Bare Soil Index contrasts shortwave-infrared and red against near-infrared and blue light. "
      "BSI above zero means soil dominates the pixel. Exposed soil in the greenest season is a direct "
      "sign of degradation.",
      S2 + ", peak-greenness median 2021-2025.", "N2 Bare soil at peak greenness (need).",
      section="B. Degradation, erosion and fire"),
    L("B2", "rusle", "Soil Erosion Risk (RUSLE)", "Estimated soil loss, tonnes per hectare per year",
      lambda p: 10 ** float(p["N4_raw"]) - 1, "t/ha/yr", "{:.0f}", BROWN,
      "Potential soil loss from the Revised Universal Soil Loss Equation, A = R x K x LS x C (P = 1). "
      "Classes follow common Indian practice: < 5 slight, 5-10 moderate, 10-20 high, > 20 very high.",
      "R: CHIRPS rainfall (Singh et al. 1981); K: SoilGrids texture and carbon; LS: MERIT Hydro; "
      "C: Sentinel-2 NDVI (Van der Knijff 1999).", "N4 Erosion (need) and SOIL_STABILISATION_FIRST.",
      breaks=[2, 5, 10, 20], names=["Very slight", "Slight", "Moderate", "High", "Very high"],
      section="B. Degradation, erosion and fire"),
    L("B3", "restrend", "Rainfall-Corrected Greenness Trend (RESTREND)", "NDVI residual trend 2013-2025, per year",
      g("N3_raw"), "NDVI/yr", "{:+.4f}", DIV_RG,
      "Greenness change after removing the effect of rainfall: each year's NDVI is compared with what that "
      "year's monsoon rain would predict, and the trend of the difference is measured (Sen's slope). "
      "Negative values mean human-induced decline; positive values mean recovery.",
      LS + "; CHIRPS June-September rainfall.", "N3 NDVI decline (need) and degradation evidence DE3.",
      breaks=[-0.002, 0, 0.005, 0.010], names=["Declining", "Slight decline", "Slight gain", "Gain", "Strong gain"],
      section="B. Degradation, erosion and fire"),
    L("B4", "trendneg", "Area with Declining Greenness", "Share of the block's pixels with a negative RESTREND trend",
      g("DE3_neg_share", 100), "%", "{:.0f}", RED,
      "Share of each block where the rainfall-corrected trend is negative. A block counts as degradation "
      "evidence DE3 when its mean trend is negative and at least 60 % of its pixels are declining.",
      LS + "; CHIRPS.", "Degradation evidence DE3 (confidence only; does not change scores).",
      breaks=[20, 40, 60, 80], section="B. Degradation, erosion and fire"),
    L("B5", "ndvichange", "Greenness Change Since 2000-2005", "NDVI 2021-2025 minus NDVI 2000-2005 (September-November)",
      lambda p: -float(p["DE4_ndvi_drop"]), "NDVI", "{:+.2f}", GREEN,
      "Change in post-monsoon greenness over about 20 years. Positive values mean the block is greener "
      "today than in 2000-2005. Note: Landsat 8/9 reads slightly higher NDVI than Landsat 5/7, so roughly "
      "+0.02 to +0.04 of the change can be sensor difference.",
      "Landsat 5/7 (2000-2005) and Landsat 8/9 (2021-2025), Collection 2 Level-2.",
      "Degradation evidence DE4 (a drop of 0.08 or more counts as evidence).",
      section="B. Degradation, erosion and fire"),
    L("B6", "tc2000", "Tree Cover in 2000", "Hansen Global Forest Change, block mean",
      g("DE1_treecover2000"), "%", "{:.1f}", GREEN,
      "Tree canopy cover in the year 2000. Blocks with 10 % or more in 2000 that have little today are "
      "evidence of past forest loss (DE1). Almost the whole range had very little tree cover in 2000.",
      "Hansen / UMD Global Forest Change v1.13, 30 m.", "Degradation evidence DE1.",
      breaks=[0.01, 0.5, 1, 10], names=["None", "< 0.5 %", "0.5-1 %", "1-10 %", ">= 10 % (DE1)"],
      section="B. Degradation, erosion and fire"),
    CAT("B7", "fire", "Fire Occurrence 2015-2025", "Number of years in which fire was detected in the block",
        lambda p: (lambda y: y if y < 2 else (2 if y < 5 else 5))(int(round(float(p["fire_years"])))),
        [(0, "No fire detected", "#fff5eb", "No active fire or burned area in 11 years"),
         (1, "Fire in 1 year", "#fd8d3c", "One fire year recorded"),
         (2, "Fire in 2-4 years", "#d94801", "Repeated fire"),
         (5, "Fire in 5+ years", "#7f2704", "Chronic fire: fire protection first")],
        "Fire detections from satellite active-fire and burned-area products, counted as the number of "
        "distinct years with fire. VIIRS had no data from January 2022 to September 2023, so MODIS burned "
        "area fills that gap.",
        "VIIRS 375 m active fire (2015-2021, 2023-2025) and MODIS MCD64A1 burned area 500 m.",
        "F13 Low fire frequency (feasibility) and FIRE_PROTECTION_FIRST.", section="B. Degradation, erosion and fire"),
    CAT("B8", "de", "Degradation Evidence (DE1-DE4)", "Independent satellite evidence that the block has declined",
        lambda p: "excl" if int(p["excluded"]) == 1 else min(int(p["degradation_evidence"]), 2),
        [(0, "No evidence", "#f0f0f0", "No DE1-DE4 signal"),
         (1, "1 line of evidence", "#fc9272", "e.g. DE3 declining trend"),
         (2, "2+ lines of evidence", "#a50f15", "Strong evidence of decline"),
         ("excl", "Protected / Excluded", GREY, "Not assessed")],
        "DE1 tree cover in 2000 >= 10 %; DE2 tree loss >= 5 % of the block; DE3 negative rainfall-corrected "
        "trend on >= 60 % of the block; DE4 NDVI drop >= 0.08 since 2000-2005. Evidence raises "
        "confidence; it never changes a score or a phase.",
        "Hansen GFC v1.13; Landsat 5-9; CHIRPS.", "Confidence column in the block table and field-check list.",
        section="B. Degradation, erosion and fire"),

    # ---------------------------------------------------------------- C. Moisture and water
    L("C1", "cti", "Topographic Wetness (CTI)", "Compound Topographic Index: where water collects in the landscape",
      g("F1_raw"), "index", "{:.1f}", BLUE,
      "CTI = ln(upslope area / tan slope). High values are valley floors and depressions that receive "
      "run-off and stay moist longer; low values are ridges and steep upper slopes that shed water.",
      "Hydrography90m CTI (Amatulli et al. 2022), 90 m.", "F1 Wetness (feasibility, 15 points).",
      section="C. Moisture and water"),
    L("C2", "awc", "Soil Available Water Capacity", "Water the top 30 cm of soil can hold for plants",
      g("F2_raw", 100), "vol %", "{:.1f}", BLUE,
      "Water held between field capacity (-33 kPa) and wilting point (-1500 kPa): the soil's own water "
      "store for seedlings through the dry season.",
      "SoilGrids 2.0 water retention (wv0033, wv1500), 250 m, 0-30 cm.", "F2 Soil water capacity (feasibility, 10 points).",
      section="C. Moisture and water"),
    L("C3", "wb", "Climatic Water Balance", "Mean annual rainfall minus potential evapotranspiration, 2005-2024",
      g("F3_raw"), "mm/yr", "{:,.0f}", BLUE,
      "The climatic water deficit. All values are negative (evaporative demand exceeds rainfall); "
      "less negative is wetter. The gradient across the range is small, so this layer carries 5 points.",
      "CHIRPS daily rainfall (~5.5 km) and MODIS MOD16A2GF potential evapotranspiration (500 m).",
      "F3 Climatic water balance (feasibility, 5 points).", section="C. Moisture and water"),
    L("C4", "moist", "Post-Monsoon Moisture Retention", "Change in NDMI from mid-October to mid-November",
      g("X1"), "dNDMI", "{:+.2f}", BLUE,
      "The Normalised Difference Moisture Index tracks water in leaves and the surface. Every block dries "
      "after the monsoon. Values closer to zero dry more slowly, so moisture stays available to seedlings "
      "for longer.",
      S2 + ", 2021-2025.", "SMC rules: driest quartile -> SMC_DROUGHT_HARDY; driest half -> SMC required. QC FF-11.",
      section="C. Moisture and water"),
    L("C5", "water", "Distance to Seasonal Water", "Distance to surface water present 3+ months a year",
      g("F4_raw"), "m", "{:,.0f}", rev(BLUE),
      "Distance from the block to the nearest seasonal water body, such as a tank, check dam pond or river "
      "pool. Near water means more moisture and easier watering of seedlings.",
      "JRC Global Surface Water v1.4 (seasonality >= 3 months), 30 m.", "F4 Near seasonal water (feasibility, 5 points).",
      section="C. Moisture and water"),

    # ---------------------------------------------------------------- D. Terrain and soil depth
    L("D1", "slope", "Slope", "Mean slope of the block, per cent",
      g("F10_raw"), "%", "{:.0f}", SLOPE,
      "Gentle slopes (5-20 %) are ideal for planting and soil-moisture conservation. Above 35 % work becomes "
      "difficult; above 45 % land is excluded (C4).",
      DEM + ".", "F10 Slope (feasibility, 8 points) and constraint C4.",
      breaks=[5, 10, 20, 35], names=["Flat-gentle", "Gentle", "Moderate", "Steep", "Very steep"],
      section="D. Terrain and soil depth"),
    L("D2", "hli", "Heat Load (Aspect)", "McCune-Keon heat load index: sun-exposed vs cool slopes",
      g("F11_raw"), "index", "{:.3f}", rev(SCORE),
      "Combines slope, aspect and latitude. South-west facing slopes receive the hottest afternoon sun and "
      "dry fastest; north-east slopes stay cooler and moister.",
      DEM + ".", "F11 Cool aspect (feasibility, 7 points).", section="D. Terrain and soil depth"),
    L("D3", "curv", "Slope Curvature", "Concave (water-gathering) vs convex (water-shedding) ground",
      g("F12_raw"), "index", "{:+.1f}", DIV_BB,
      "Laplacian curvature of the terrain. Concave ground (positive) collects water and soil; convex "
      "ground (negative), such as spurs and ridges, sheds them.",
      DEM + ".", "F12 Concave curvature (feasibility, 3 points).",
      breaks=[-2, -0.5, 0.5, 2], names=["Strongly convex", "Convex", "Straight", "Concave", "Strongly concave"],
      section="D. Terrain and soil depth"),
    L("D4", "tpi", "Topographic Position", "Elevation relative to the surrounding 300 m",
      g("F5_raw_tpi"), "m", "{:+.0f}", DIV_BB[::-1],
      "Negative values are valleys and foot-slopes where deeper colluvial soil accumulates. Positive "
      "values are ridges and hill tops with thin soil.",
      DEM + ".", "Part of F5 Soil depth proxy (feasibility).",
      breaks=[-5, -1, 1, 5], names=["Valley", "Lower slope", "Mid slope", "Upper slope", "Ridge"],
      section="D. Terrain and soil depth"),
    L("D5", "hand", "Height Above Nearest Drainage", "Vertical distance to the nearest stream channel",
      g("F5_raw_hand"), "m", "{:.0f}", rev(BLUE),
      "Low values are close to the drainage line, with shallow groundwater and deeper soil. High values "
      "sit far above the drains on dry upper slopes.",
      "MERIT Hydro v1.0.1, 90 m.", "Part of F5 Soil depth proxy (feasibility).", section="D. Terrain and soil depth"),
    L("D6", "soildepth", "Soil Depth Proxy", "Score 0-1 from slope, topographic position and HAND",
      g("F5"), "score", "{:.2f}", SCORE,
      "There is no field soil-depth map, so depth is estimated from the terrain: gentle, low-lying "
      "ground near drainage holds deeper soil. Weights: slope 0.40, position 0.30, HAND 0.30. Blocks "
      "whose class changes under other weightings are flagged G3 for a soil pit.",
      DEM + "; MERIT Hydro.", "F5 Soil depth (feasibility, 10.6 points after the CV guard).",
      section="D. Terrain and soil depth"),
    L("D7", "rough", "Rockiness (Surface Roughness)", "Local standard deviation of elevation (7 x 7 cells)",
      g("F6_raw"), "m", "{:.1f}", BROWN,
      "Rough, broken ground usually means rock outcrops and boulders with little soil between them. "
      "Smooth ground is easier to plant and holds soil.",
      DEM + ".", "F6 Low rockiness (feasibility) and the ROCKY_MICROSITE rule.", section="D. Terrain and soil depth"),

    # ---------------------------------------------------------------- E. Soil properties
    L("E1", "clay", "Soil Clay Content", "Clay %, 0-30 cm", g("F7_raw_clay"), "%", "{:.1f}", BROWN,
      "Clay holds water and nutrients; between about 18 and 35 % is best for most native species.",
      SG + ".", "F7 Texture (weight 0: almost no variation within the range).", section="E. Soil properties"),
    L("E2", "sand", "Soil Sand Content", "Sand %, 0-30 cm", g("F7_raw_sand"), "%", "{:.1f}", ["#fffbe6", "#fbeaa5", "#f2cf63", "#d9a521", "#a67300"],
      "Sandy soil drains quickly and holds little water. Above 70 % the texture score is halved.",
      SG + ".", "F7 Texture (weight 0: almost no variation within the range).", section="E. Soil properties"),
    L("E3", "cfvo", "Coarse Fragments (Gravel and Stones)", "Volume % of gravel and stones, 0-30 cm",
      g("F8_raw"), "vol %", "{:.0f}", BROWN,
      "Stony soil holds less water and is harder to dig pits in. This is the soil layer that varies most "
      "across Khedbrahma, so the CV guard gives it the largest soil weight.",
      SG + ".", "F8 Low coarse fragments (feasibility, 18.2 points after the CV guard).", section="E. Soil properties"),
    L("E4", "ph", "Soil pH", "pH in water, 0-30 cm", g("F9_raw"), "pH", "{:.2f}", PURPLE,
      "Soil reaction. Values of 6.0-7.5 are ideal; the range is uniformly near-neutral to slightly alkaline.",
      SG + ".", "F9 pH (weight 0: almost no variation within the range).", section="E. Soil properties"),
    L("E5", "soc", "Soil Organic Carbon", "g/kg, 0-30 cm", g("X2"), "g/kg", "{:.1f}", ["#f6eff7", "#d0d1e6", "#a6bddb", "#67a9cf", "#02818a"],
      "Organic carbon reflects soil health and biological activity. It is also an input to the RUSLE "
      "soil erodibility factor K.",
      SG + ".", "Erodibility K in N4 (RUSLE); reported for soil health.", section="E. Soil properties"),

    # ---------------------------------------------------------------- F. Biotic pressure and access
    L("F1", "builtdist", "Distance to Settlements", "Distance to the nearest built-up area",
      g("F14_raw_dist"), "m", "{:,.0f}", rev(PURPLE),
      "Blocks close to villages face more grazing, lopping and fuelwood collection. Darker colours "
      "mean closer to settlements and higher pressure.",
      "ESA WorldCover v200 built-up class, 10 m.", "F14 Low biotic pressure (60 % of the score).",
      section="F. Biotic pressure and access"),
    L("F2", "pop", "Population Pressure", "GHSL 2020 population within 2 km (relative units)",
      g("F14_raw_pop"), "relative", "{:.2f}", PURPLE,
      "Relative population pressure around each block from the Global Human Settlement Layer. Higher "
      "values mean more people within walking distance.",
      "JRC GHSL P2023A population 2020, 100 m.", "F14 Low biotic pressure (40 % of the score).",
      section="F. Biotic pressure and access"),
    L("F3", "road", "Distance to Road", "Distance to the nearest mapped road",
      g("access_m"), "m", "{:,.0f}", rev(PURPLE),
      "Road access matters for moving seedlings, water and staff. Very close blocks may also face more "
      "disturbance. This layer is advisory only and is not scored.",
      "GRIP4 global roads database.", "Advisory column advisory_access_km (not scored).",
      section="F. Biotic pressure and access"),
    L("F4", "dense", "Distance to Dense Forest", "Distance to the nearest forest with canopy >= 40 %",
      g("N8_raw"), "m", "{:,.0f}", rev(GREEN),
      "Blocks near intact dense forest receive seed from it and are part of a connected forest landscape.",
      "Meta Global Canopy Height 1 m (read at 4.8 m), with a 5 km search.", "N8 Proximity to dense forest (need).",
      section="F. Biotic pressure and access"),
    CAT("F5", "pa", "Protected Area Overlap", "Blocks inside a notified protected area (WDPA)",
        lambda p: int(round(float(p["pa"]))),
        [(1, "Inside protected area (G2)", "#41ab5d", "Wildlife rules apply to works"),
         (0, "Outside", "#f0f0f0", "")],
        "Blocks that overlap a protected area in the World Database on Protected Areas. Works inside need "
        "the approvals and species choices that suit the protected area's management plan.",
        "WDPA (UNEP-WCMC), current release.", "Flag G2 (field check; never excludes).",
        section="F. Biotic pressure and access"),

    # ---------------------------------------------------------------- G. Model components and outputs
    L("G1", "M", "Moisture Group Score (M)", "F1-F4 combined, 0-1", g("M"), "score", "{:.2f}", BLUE,
      "Weighted mean of wetness, soil water capacity, climatic water balance and nearness to water "
      "(35 points of RFI). It is multiplied with S, so a very dry site cannot be rescued by good soil.",
      "Derived from layers C1, C2, C3 and C5.", "RFI = M^0.325 x S^0.325 x (0.55 + 0.45 TR).",
      section="G. Model components and outputs"),
    L("G2", "S", "Soil Group Score (S)", "F5-F9 combined, 0-1", g("S"), "score", "{:.2f}", SCORE,
      "Weighted mean of soil depth, rockiness, texture, coarse fragments and pH (35 points of RFI).",
      "Derived from layers D6, D7 and E1-E4.", "RFI multiplicative core.", section="G. Model components and outputs"),
    L("G3", "T", "Terrain Group Score (T)", "F10-F12 combined, 0-1", g("T"), "score", "{:.2f}", SCORE,
      "Weighted mean of slope, heat load and curvature (18 points of RFI).",
      "Derived from layers D1-D3.", "TR term of RFI.", section="G. Model components and outputs"),
    L("G4", "R", "Risk Group Score (R)", "F13-F14 combined, 0-1 (1 = low risk)", g("R"), "score", "{:.2f}", SCORE,
      "Weighted mean of low fire frequency and low biotic pressure (12 points of RFI). Fire hardly varies "
      "in Khedbrahma, so biotic pressure carries this group.",
      "Derived from layers B7, F1 and F2.", "TR term of RFI.", section="G. Model components and outputs"),
    CAT("G5", "stab", "Reliability of Phase 1-2 Priority", "Monte Carlo: share of 500 weight draws keeping the block in Phase 1-2",
        lambda p: ("na" if int(p["excluded"]) == 1 or int(p["phase_code"]) > 2 else
                   ("r" if float(p["stability_p12"]) > 0.8 else ("m" if float(p["stability_p12"]) >= 0.5 else "x"))),
        [("r", "Robust (> 80 %)", "#1a9850", "Stays Phase 1-2 under almost any weighting"),
         ("m", "Moderately stable (50-80 %)", "#fee08b", "Check in the field before committing"),
         ("x", "Marginal (< 50 %)", "#d73027", "Priority depends on the weights"),
         ("na", "Phase 3-5, Protected or Excluded", "#f0f0f0", "Not a Phase 1-2 block")],
        "All weights were redrawn 500 times around their set values (Dirichlet, concentration 125), with "
        "class breaks recomputed each time. The map shows how often each Phase 1-2 block kept its Phase "
        "1-2 status.",
        "FRPIM Run 2 Monte Carlo (seed 2026).", "Column stability_p12; QC FF-22.", section="G. Model components and outputs"),
    CAT("G6", "rx", "Recommended Intervention", "First matching rule of the 11-rule engine",
        lambda p: p["intervention"],
        [("SMC_DROUGHT_HARDY", "SMC + drought-hardy planting", "#d95f02", "Low moisture: trenches first"),
         ("BLANK_AREA_PLANTATION", "Blank-area plantation", "#1b9e77", "Canopy < 10 %"),
         ("ANR_GAP_PLANTING", "ANR + gap planting", "#7570b3", "Canopy 10-40 % or need Very Low"),
         ("SOIL_STABILISATION_FIRST", "Soil stabilisation first", "#a6761d", "Erosion risk (X5) and soil score S < 0.45"),
         ("HYDRO_COMPATIBLE_PLANTING", "Hydro-compatible planting", "#1f78b4", "Waterlogging flag: riparian species"),
         ("INVASIVE_CLEAR_THEN_PLANT", "Clear invasives, then plant", "#e7298a", "Shrub invasion score N7 >= 0.30"),
         ("FIRE_PROTECTION_FIRST", "Fire protection first", "#e31a1c", "Frequent fire: F13 score < 0.55"),
         ("MIXED_NATIVE_PLANTATION", "Mixed native planting", "#66a61e", "None of the rules above"),
         ("PROTECT_DENSE", "Protect dense forest", "#006837", "C1, canopy >= 40 %"),
         ("NOT_PLANTABLE", "Not plantable", GREY, "Water, drains, rock, built-up, cropland, steep")],
        "Rules are checked in a fixed order: protect, not plantable, fire first, hydro-compatible, soil "
        "stabilisation, rocky microsite, invasive clearing, SMC + drought-hardy, ANR, blank area, mixed "
        "native. The legend lists only the rules that apply in this area.",
        "FRPIM Run 2 rule engine.", "Column intervention; area statement.", section="G. Model components and outputs"),
    CAT("G7", "species", "Recommended Species Group", "From the moisture and soil site class",
        lambda p: p["species_group"].split(":")[0],
        [("Drought-hardy", "Drought-hardy", "#e6ab02", "Khair, ber, desi babul, guggal, hingor"),
         ("Medium", "Medium", "#66a61e", "Teak, dhavdo, timru, khakhro, neem, sadad"),
         ("Moist/deep", "Moist / deep soil", "#1f78b4", "Mahudo, bamboo, jambu, karanj, amla"),
         ("Riparian", "Riparian", "#08519c", "Arjun, jambu, karanj (drainage lines)"),
         ("Native grasses and shrubs first, then khair and ber", "Grasses first", "#a6761d", "Soil stabilisation, then khair and ber"),
         ("-", "No planting", GREY, "Protected or excluded")],
        "Species group follows the block's moisture group score and soil depth. Final species choice "
        "rests with the range officer after the field visit and nursery availability.",
        "FRPIM Run 2 site class (M and S thirds).", "Column species_group.", section="G. Model components and outputs"),
    CAT("G8", "smc", "Soil-Moisture Conservation Required", "Blocks where SMC works should precede or accompany planting",
        lambda p: "excl" if int(p["excluded"]) == 1 else p["smc_required"],
        [("yes", "SMC required", "#8c510a", "Trenches, pits, gully plugs, earthen bunds"),
         ("no", "Not required", "#80cdc1", "Moisture adequate"),
         ("excl", "Protected / Excluded", GREY, "")],
        "SMC is added to a planting intervention when the site responds to water harvesting (X3) and either "
        "the moisture group score is below 0.50 or the block is in the driest half for post-monsoon moisture.",
        "FRPIM Run 2 (moisture group M and post-monsoon moisture response).", "Column smc_required.",
        section="G. Model components and outputs"),
    CAT("G9", "change", "Change from Earlier Model (PPI-SK v2.1)", "How each block's priority moved between versions",
        lambda p: p["change_type"],
        [("PRIORITY_RETAINED", "Priority retained", "#1a9850", "High priority in both versions"),
         ("NEWLY_PRIORITISED", "Newly prioritised", "#d73027", "High priority only in v2.2"),
         ("DEPRIORITISED", "Deprioritised", "#4575b4", "High priority only in v2.1"),
         ("NO_MAJOR_CHANGE", "No major change", "#f0f0f0", "Low priority in both")],
        "Comparison with the earlier PPI-SK v2.1 run on the same blocks. FRPIM v2.2 adds the "
        "feasibility index and RESTREND trend, so some blocks moved.",
        "PPI-SK v2.1 and FRPIM v2.2 final block tables.", "Column change_type; QC FF-27.",
        section="G. Model components and outputs"),
    CAT("G10", "excl", "Constraints: Protected and Excluded Land", "Why a block was removed from the priority matrix",
        lambda p: p["exclusion_reason"] or ("partial" if p["constraint_flag"] == "partial" else "ok"),
        [("ok", "No constraint", "#f7fcf5", "Fully available"),
         ("partial", "Partly constrained (< 30 %)", "#fdd0a2", "Retained; constrained part deducted"),
         ("C2-C7 > 30%", "Excluded (C2-C7 > 30 %)", "#969696", "Water, drains, steep, built-up, crop, rock"),
         ("C1", "Protected (C1)", "#006837", "Dense forest, canopy >= 40 %")],
        "C1 canopy >= 40 %; C2 water (occurrence >= 50 %); C3 drains; C4 slope > 45 %; C5 built-up; "
        "C6 cultivation; C7 bare rock. A block is excluded when C2-C7 cover more than 30 % of it.",
        "Meta CHM, JRC GSW, MERIT Hydro, FABDEM, WorldCover, Dynamic World, Sentinel-2.",
        "Columns exclusion_reason, constraint_reason, net_plantable_ha.", section="G. Model components and outputs"),
    CAT("G11", "g5", "Grassland Option (G5) and Recent Plantation (G1)", "Advisory field flags",
        lambda p: ("g1" if p["recent_plantation_flag"] == "yes" else
                   ("g5" if int(p["grassland_option"]) == 1 else ("excl" if int(p["excluded"]) == 1 else "none"))),
        [("g1", "G1 recent plantation?", "#e7298a", "Young plantation may look bare; verify"),
         ("g5", "G5 grassland option", "#d9ef8b", "Open grass/bare; stays under plantation"),
         ("none", "No flag", "#f7f7f7", ""),
         ("excl", "Protected / Excluded", GREY, "")],
        "G1 marks blocks that may hold a recent plantation not yet visible as canopy. G5 notes naturally open "
        "grass or bare blocks where a grassland option could be discussed; it never removes a block.",
        "Sentinel-2 NDVI change 2019-20 to 2024-25; ESA WorldCover.", "Columns recent_plantation_flag, grassland_option.",
        section="G. Model components and outputs"),
]


# ------------------------------------------------------------------ classification
def quantile_breaks(vals):
    v = np.asarray(vals, float)
    b = list(np.quantile(v, [0.2, 0.4, 0.6, 0.8]))
    if len(set(np.round(b, 12))) < 4:
        u = np.unique(v)
        b = list(np.quantile(u, [0.2, 0.4, 0.6, 0.8]))
    return b


def classify(v, b):
    for i, t in enumerate(b):
        if v < t:
            return i
    return len(b)


def range_labels(b, fmt, unit):
    u = "" if unit in ("score", "index", "NDVI", "relative", "pH", "dNDMI", "NDVI/yr") else " " + unit
    f = lambda x: fmt.format(x)
    return [f"< {f(b[0])}{u}"] + [f"{f(b[i])} – {f(b[i + 1])}{u}" for i in range(3)] + [f">= {f(b[3])}{u}"]


# ------------------------------------------------------------------ one page
def draw_page(blocks, union, lay, out_dir, meta):
    fig = C.new_page(lay["code"], lay["title"], lay["sub"])
    ax = C.map_axes(fig, union)
    rows = []                                                 # (colour, name, sub, n, ha)
    if lay["kind"] == "cont":
        vals = [lay["value"](p) for _, p in blocks]
        b = quantile_breaks(vals) if lay["breaks"] == "q" else lay["breaks"]
        cls = [classify(v, b) for v in vals]
        pal = lay["palette"]
        names = lay["names"] or ["Very low", "Low", "Medium", "High", "Very high"]
        subs = range_labels(b, lay["fmt"], lay["unit"])
        for k in range(5):
            idx = [i for i, c in enumerate(cls) if c == k]
            rows.append((pal[k], names[k], subs[k], len(idx), sum(float(blocks[i][1]["block_area_ha"]) for i in idx)))
        colors = [pal[c] for c in cls]
        stat = (f"Block values: min {lay['fmt'].format(min(vals))}, median {lay['fmt'].format(float(np.median(vals)))}, "
                f"max {lay['fmt'].format(max(vals))} ({lay['unit']}).")
        method = ("Classes are quintiles of the 829 blocks (about 20 % of blocks each)." if lay["breaks"] == "q"
                  else "Classes use fixed, meaningful thresholds.")
    else:
        vals = [lay["value"](p) for _, p in blocks]
        cmap = {c[0]: c for c in lay["classes"]}
        colors = []
        for v in vals:
            colors.append(cmap[v][2] if v in cmap else GREY)
        for key, name, col, sub in lay["classes"]:
            idx = [i for i, v in enumerate(vals) if v == key]
            rows.append((col, name, sub, len(idx), sum(float(blocks[i][1]["block_area_ha"]) for i in idx)))
        unknown = [i for i, v in enumerate(vals) if v not in cmap]
        assert not unknown, f"{lay['code']}: unmapped values {set(vals[i] for i in unknown)}"
        stat, method = "", ""
    for (gm, _), col in zip(blocks, colors):
        ax.add_patch(C.geom_to_patch(gm, facecolor=col, edgecolor="#ffffff", linewidth=0.35, zorder=2))
    ax.add_patch(C.geom_to_patch(union, facecolor="none", edgecolor=C.INK, linewidth=1.6, zorder=4))
    C.map_furniture(ax)

    # ---- legend
    lx, rx = C.LX, C.RX
    cN, cH = 0.900, rx
    y = 0.852
    fig.text(lx, y, "Legend", fontsize=15, fontweight="bold", color=C.INK, va="center")
    if lay["kind"] == "cont":
        fig.text(rx, y, f"Unit: {lay['unit']}", fontsize=9, color=C.MUTED, va="center", ha="right")
    y -= 0.034
    fig.text(lx + 0.034, y, "Class", fontsize=9, color=C.MUTED, va="center")
    fig.text(cN, y, "Blocks", fontsize=9, color=C.MUTED, va="center", ha="right")
    fig.text(cH, y, "Area ha", fontsize=9, color=C.MUTED, va="center", ha="right")
    y -= 0.014
    fig.add_artist(plt.Line2D([lx, rx], [y, y], color=C.RULE, lw=0.8))
    row_h = 0.043
    y -= row_h / 2 + 0.004
    for col, name, sub, n, ha in rows:
        C.swatch(fig, lx, y, col)
        fig.text(lx + 0.034, y + 0.0065, name, fontsize=10.5, fontweight="bold", color=C.INK, va="center")
        if sub:
            fig.text(lx + 0.034, y - 0.0095, sub, fontsize=8.2, color=C.MUTED, va="center")
        fig.text(cN, y + 0.0065, f"{n}", fontsize=10, color=C.INK, va="center", ha="right")
        fig.text(cH, y + 0.0065, f"{ha:,.1f}", fontsize=10, color=C.INK, va="center", ha="right")
        y -= row_h
    y += row_h / 2 - 0.002
    fig.add_artist(plt.Line2D([lx, rx], [y, y], color=C.INK, lw=0.9))
    y -= 0.018
    fig.text(lx + 0.034, y, "Total", fontsize=10.5, fontweight="bold", color=C.INK, va="center")
    fig.text(cN, y, f"{sum(r[3] for r in rows)}", fontsize=10, fontweight="bold", color=C.INK, va="center", ha="right")
    fig.text(cH, y, f"{sum(r[4] for r in rows):,.1f}", fontsize=10, fontweight="bold", color=C.INK, va="center", ha="right")
    y -= 0.034

    # ---- bar chart of area by class
    bh = 0.10
    bax = fig.add_axes([lx + 0.034, y - bh, rx - lx - 0.034, bh])
    areas = [r[4] for r in rows]
    bax.barh(range(len(rows)), areas, color=[r[0] for r in rows], edgecolor="#6b756e", linewidth=0.5, height=0.68)
    bax.invert_yaxis()
    bax.set_yticks(range(len(rows)))
    bax.set_yticklabels([r[1] if len(r[1]) < 22 else r[1][:21] + "…" for r in rows], fontsize=8, color=C.INK)
    vmax = max(areas) or 1
    for k, v in enumerate(areas):
        bax.text(v + vmax * 0.015, k, f"{v:,.0f} ha", va="center", fontsize=8, color=C.INK)
    bax.set_xlim(0, vmax * 1.25)
    bax.tick_params(axis="x", labelsize=7.5, colors=C.MUTED, length=2)
    bax.tick_params(axis="y", length=0)
    for sp in ("top", "right"):
        bax.spines[sp].set_visible(False)
    for sp in ("left", "bottom"):
        bax.spines[sp].set_color(C.RULE)
    bax.set_title("Area by class (ha)", fontsize=9.5, color=C.INK, loc="left", pad=4, fontweight="bold")
    y -= bh + 0.034

    body = lay["about"] + ("\n" + stat + " " + method if stat else "")
    y = C.text_block(fig, y, "What this map shows", body)
    y = C.info_rows(fig, y, [("Data", lay["data"]), ("Used in", lay["use"]),
                             ("Unit / grid", "10 ha blocks (316.23 m), UTM 43N (EPSG:32643)")])
    assert y > 0.062, f"{lay['code']}: right panel overflows (y={y:.3f})"
    C.footer(fig, f"FRPIM v2.2 Layer Atlas, {lay['section']}. Block values from the model run of "
                  f"{meta['run_date']} (Google Earth Engine). Areas are true hectares on the block polygons.")
    base = out_dir / f"FRPIM_v2.2_Khedbrahma_Layer_{lay['code']}_{lay['key']}"
    fig.savefig(str(base) + ".png", dpi=300, facecolor=C.PAPER)
    fig.savefig(str(base) + ".pdf", facecolor=C.PAPER)
    plt.close(fig)
    return base


# ------------------------------------------------------------------ indicator score summary pages
N_NAMES = {"N1": "Canopy deficit", "N2": "Bare soil at peak greenness", "N3": "NDVI decline (RESTREND)",
           "N4": "Erosion (RUSLE)", "N5": "Biomass deficit", "N6": "Unrecovered tree loss",
           "N7": "Evergreen shrub invasion", "N8": "Near dense forest"}
F_NAMES = {"F1": "Wetness (CTI)", "F2": "Soil water capacity", "F3": "Climatic water balance",
           "F4": "Near seasonal water", "F5": "Soil depth proxy", "F6": "Low rockiness", "F7": "Texture",
           "F8": "Low coarse fragments", "F9": "pH", "F10": "Slope", "F11": "Cool aspect (heat load)",
           "F12": "Concave curvature", "F13": "Low fire frequency", "F14": "Low biotic pressure"}


def draw_scores(blocks, union, which, out_dir, meta, weights):
    names = N_NAMES if which == "N" else F_NAMES
    keys = list(names)
    cols, rows_ = (4, 2) if which == "N" else (5, 3)
    title = ("Restoration Need Indicators N1-N8" if which == "N" else "Restoration Feasibility Indicators F1-F14")
    sub = ("Scores 0-1, higher = more need  ·  weights after the CV guard" if which == "N"
           else "Scores 0-1, higher = more feasible  ·  weights after the CV guard")
    fig = C.new_page("S1" if which == "N" else "S2", title, sub)
    cmap = colormaps["YlOrRd"] if which == "N" else colormaps["RdYlGn"]
    norm = Normalize(0, 1)
    x0, y0, x1, y1 = 0.030, 0.090, 0.970, 0.870
    gw, gh = (x1 - x0) / cols, (y1 - y0) / rows_
    for i, k in enumerate(keys):
        r, c = divmod(i, cols)
        rect = [x0 + c * gw + 0.006, y1 - (r + 1) * gh + 0.030, gw - 0.012, gh - 0.058]
        ax = C.map_axes(fig, union, rect=rect, pad_frac=0.03)
        for gm, p in blocks:
            col = cmap(norm(float(p[k])))
            ax.add_patch(C.geom_to_patch(gm, facecolor=col, edgecolor=col, linewidth=0.3, zorder=2))
        ax.add_patch(C.geom_to_patch(union, facecolor="none", edgecolor=C.INK, linewidth=0.8, zorder=4))
        C.map_furniture(ax, small=True)
        w = weights.get(k, 0)
        off = w == 0
        fig.text(rect[0], rect[1] + rect[3] + 0.024, f"{k}  {names[k]}", fontsize=10.5, fontweight="bold",
                 color=C.MUTED if off else C.INK, va="center")
        fig.text(rect[0], rect[1] + rect[3] + 0.008,
                 "weight 0 (no variation; points shared)" if off else f"weight {w:.2f} points",
                 fontsize=8.5, color="#b2182b" if off else C.MUTED, va="center")
    # colour bar in the free slot (feasibility page) or under the grid
    cax = fig.add_axes([0.70, 0.068, 0.25, 0.012]) if which == "N" else fig.add_axes([x0 + 4 * gw + 0.02, y0 + 0.11, gw - 0.04, 0.016])
    cb = plt.colorbar(plt.cm.ScalarMappable(norm=norm, cmap=cmap), cax=cax, orientation="horizontal")
    cb.ax.tick_params(labelsize=8)
    cb.set_label("Indicator score (0-1)", fontsize=9)
    if which == "F":
        fig.text(x0 + 4 * gw + 0.02, y0 + 0.17, "Groups: M moisture F1-F4 (35)\nS soil F5-F9 (35)\n"
                 "T terrain F10-F12 (18)\nR risk F13-F14 (12)", fontsize=9, color=C.INK, va="bottom", linespacing=1.4)
    C.footer(fig, f"FRPIM v2.2 Layer Atlas. Each indicator is scaled 0-1 between its 2nd and 98th percentile over "
                  f"natural vegetation of the range + 20 km. Run of {meta['run_date']}.")
    base = out_dir / f"FRPIM_v2.2_Khedbrahma_Layer_{'S1_need_indicators' if which == 'N' else 'S2_feasibility_indicators'}"
    fig.savefig(str(base) + ".png", dpi=300, facecolor=C.PAPER)
    fig.savefig(str(base) + ".pdf", facecolor=C.PAPER)
    plt.close(fig)
    return base


# ------------------------------------------------------------------ cover and index
def draw_cover(out_dir, entries, meta):
    fig = plt.figure(figsize=(C.W, C.H), facecolor=C.PAPER)
    fig.patches.append(plt.Rectangle((0, 0.74), 1, 0.26, transform=fig.transFigure, facecolor="#1B5E20"))
    fig.text(0.05, 0.89, "FRPIM v2.2 Layer Atlas", fontsize=36, fontweight="bold", color="white", va="center")
    fig.text(0.05, 0.825, "Every input and intermediate layer of the Forest Restoration Priority and Intervention Model",
             fontsize=15, color="white", va="center")
    fig.text(0.05, 0.778, f"{C.PLACE}   ·   829 blocks of 10 ha   ·   model run {meta['run_date']}",
             fontsize=12, color="#d9f0d3", va="center")
    fig.text(0.05, 0.70, "Contents", fontsize=18, fontweight="bold", color=C.INK, va="center")
    colw, x, y, sec = 0.31, 0.05, 0.655, None
    for code, title, section, page in entries:
        if section != sec:
            if y < 0.12:
                x, y = x + colw, 0.655
            fig.text(x, y, section, fontsize=10.5, fontweight="bold", color="#1B5E20", va="center")
            y -= 0.026
            sec = section
        fig.text(x + 0.005, y, f"{code}", fontsize=9, color=C.MUTED, va="center")
        fig.text(x + 0.035, y, title, fontsize=9, color=C.INK, va="center")
        fig.text(x + colw - 0.02, y, f"p. {page}", fontsize=9, color=C.MUTED, va="center", ha="right")
        y -= 0.0215
        if y < 0.07:
            x, y = x + colw, 0.655
    C.footer(fig, "All layers are block means of open satellite and geospatial data processed in Google Earth Engine. "
                  "Companion pages: Map 1 Need, Map 2 Feasibility, Map 3 Priority Phase.")
    base = out_dir / "FRPIM_v2.2_Khedbrahma_Layer_00_cover"
    fig.savefig(str(base) + ".png", dpi=200, facecolor=C.PAPER)
    fig.savefig(str(base) + ".pdf", facecolor=C.PAPER)
    plt.close(fig)
    return base


def main():
    src, out = Path(sys.argv[1]), Path(sys.argv[2])
    out.mkdir(parents=True, exist_ok=True)
    blocks = C.load_blocks(src)
    union = C.union_of(blocks)
    p0 = blocks[0][1]
    meta = {"run_date": p0.get("run_date", "-")}
    weights = json.loads(p0["weights_used"])
    pages = []
    for lay in LAYERS:
        pages.append((lay["code"], lay["title"], lay["section"], draw_page(blocks, union, lay, out, meta)))
        print("done", lay["code"], lay["title"])
    pages.append(("S1", "Need indicator scores N1-N8", "H. Indicator score summaries",
                  draw_scores(blocks, union, "N", out, meta, weights)))
    pages.append(("S2", "Feasibility indicator scores F1-F14", "H. Indicator score summaries",
                  draw_scores(blocks, union, "F", out, meta, weights)))
    entries = [(c, t, s, i + 2) for i, (c, t, s, _) in enumerate(pages)]
    cover = draw_cover(out, entries, meta)
    import fitz
    atlas = fitz.open()
    for b in [cover] + [p[3] for p in pages]:
        with fitz.open(str(b) + ".pdf") as d:
            atlas.insert_pdf(d)
    atlas.save(str(out / "FRPIM_v2.2_Khedbrahma_LAYER_ATLAS.pdf"), deflate=True, garbage=3)
    print("atlas pages:", atlas.page_count)


if __name__ == "__main__":
    main()
