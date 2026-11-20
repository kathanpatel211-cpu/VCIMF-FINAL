"""
FRPIM v2.2 — accuracy-assessment protocol and reporting template (Word document).

Usage: python frpim_accuracy_protocol_docx.py ACC_strata.csv OUTPUT.docx
"""
import csv
import math
import sys

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor, Cm


def shade(cell, hex_fill):
    tcPr = cell._tc.get_or_add_tcPr(); s = OxmlElement("w:shd")
    s.set(qn("w:val"), "clear"); s.set(qn("w:color"), "auto"); s.set(qn("w:fill"), hex_fill); tcPr.append(s)


def table(doc, header, rows, widths=None, caption=None):
    if caption:
        p = doc.add_paragraph(); r = p.add_run(caption); r.bold = True; r.font.size = Pt(9.5)
    t = doc.add_table(rows=1 + len(rows), cols=len(header)); t.style = "Table Grid"; t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for j, h in enumerate(header):
        c = t.rows[0].cells[j]; c.text = ""; run = c.paragraphs[0].add_run(h); run.bold = True; run.font.size = Pt(8.5)
        shade(c, "E3EAE4")
    for i, row in enumerate(rows):
        for j, v in enumerate(row):
            c = t.rows[i + 1].cells[j]; c.text = ""; run = c.paragraphs[0].add_run(str(v)); run.font.size = Pt(8.5)
    if widths:
        for row in t.rows:
            for j, w in enumerate(widths):
                row.cells[j].width = Cm(w)
    doc.add_paragraph()
    return t


def para(doc, text, bold_lead=None, size=10):
    p = doc.add_paragraph()
    if bold_lead:
        r = p.add_run(bold_lead + " "); r.bold = True; r.font.size = Pt(size)
    r = p.add_run(text); r.font.size = Pt(size)
    p.paragraph_format.space_after = Pt(4)
    return p


def bullets(doc, items, size=10):
    for it in items:
        p = doc.add_paragraph(style="List Bullet"); r = p.add_run(it); r.font.size = Pt(size)


def main():
    strata_csv, outp = sys.argv[1:3]
    S = list(csv.DictReader(open(strata_csv, encoding="utf-8")))
    N = sum(int(s["N_h_blocks"]) for s in S); A = sum(float(s["area_ha"]) for s in S); n = sum(int(s["n_h_main"]) for s in S)
    n_in = sum(int(s["n_h_main"]) for s in S if int(s["stratum"]) <= 5)
    z = (1.959964 + 0.841621) / math.atanh(0.5); n_rho = math.ceil(z * z + 3)

    doc = Document()
    st = doc.styles["Normal"]; st.font.name = "Calibri"; st.font.size = Pt(10)
    for sec in doc.sections:
        sec.left_margin = sec.right_margin = Cm(2.2); sec.top_margin = sec.bottom_margin = Cm(2.0)

    h = doc.add_heading("Field accuracy assessment of the FRPIM v2.2 restoration maps, Khedbrahma Range", 0)
    para(doc, "Protocol, field procedure and reporting template for Map 1 (Restoration Need Index), Map 2 "
              "(Restoration Feasibility Index) and Map 3 (Restoration Priority, Phase 1-5). Sabarkantha Forest "
              "Division, Gujarat. Model run 2026-11-19; anchors LOCAL_Khedbrahma+20km.", size=9.5)

    doc.add_heading("1. Objective", 1)
    para(doc, "To estimate, with a probability sample and design-based estimators, how well the three FRPIM maps "
              "agree with independent field observations, and to report the agreement with confidence intervals. "
              "One field visit per sampled block collects the measurements for all three maps.")

    doc.add_heading("2. Sampling design", 1)
    para(doc, f"All {N} blocks of the range ({A:,.1f} ha), including edge blocks of 2-10 ha. Edge blocks hold "
              "57 % of the area in this fragmented range, so excluding them would bias the assessment.", "Population and frame.")
    para(doc, "The 10 ha block, which is the mapping unit of all three maps.", "Sampling unit.")
    para(doc, "A 30 m radius circle (0.28 ha) centred on a uniformly random location inside the selected block "
              "and at least 30 m from its edge, so that the plot lies wholly inside the unit.", "Plot (response unit).")
    para(doc, "Stratified random sampling with the seven classes of Map 3 as strata (Phase 1-5, Protected C1, "
              "Excluded C2-C7), the design recommended for map accuracy and area estimation (Olofsson et al. 2014). "
              "Maps 1 and 2 are assessed from the same sample with estimators for strata that differ from the map "
              "classes (Stehman 2014).", "Stratification.")
    para(doc, "Simple random sampling without replacement within each stratum, drawn by a scripted, seeded random "
              "generator (seed 2026; script frpim_accuracy_sample.py), so the draw is reproducible and auditable. "
              "The next two units drawn in each stratum are ordered reserves.", "Selection.")
    rows = [[s["stratum_name"], s["N_h_blocks"], f"{float(s['area_ha']):,.1f}", s["n_h_main"], "2",
             f"{float(s['weight_N_h_over_n_h']):.2f}"] for s in S]
    rows.append(["Total", str(N), f"{A:,.1f}", str(n), str(2 * len(S)), "-"])
    table(doc, ["Stratum (Map 3 class)", "Blocks N_h", "Area (ha)", "Sample n_h", "Reserves", "Weight N_h/n_h"], rows,
          caption="Table 1. Sample allocation.")
    para(doc, f"Equal allocation of six units to each phase stratum ({n_in} plots) gives every phase the same precision "
              "for user's accuracy. Four units each in the Protected and Excluded strata verify the constraint rules. "
              f"For the rank correlation between map index and field index, n = {n_rho} detects rho = 0.5 with 80 % "
              f"power at alpha = 0.05 (Fisher z), so the {n_in} plots inside the decision matrix meet this requirement. "
              f"With n = {n} the 95 % confidence interval on overall accuracy is about +/- 15 percentage points; this "
              "precision, set by field capacity (about 10 plots per day), is stated as a limitation.",
         "Sample size.")
    para(doc, "A main plot that cannot be reached (no access, unsafe, standing crop) is replaced by the first unused "
              "reserve of the same stratum, in draw order. Every replacement and its reason is recorded and reported.",
         "Replacement rule.")
    para(doc, "Four main plots (about 10 %), drawn at random, are visited a second time by a different team that "
              "has not seen the first record, to measure observer agreement.", "Quality-control subsample.")
    para(doc, "Field teams receive coordinates and neutral plot numbers only (AC-01 ...). Model classes and values "
              "stay in the office file until all visits are complete.", "Blind assessment.")

    doc.add_heading("3. Response design (field measurements)", 1)
    table(doc, ["Measurement", "Method", "Used for"], [
        ["Canopy cover %", "Point intercept: 20 points at 3, 9, 15, 21, 27 m on N, E, S, W lines; hit = crown of tree >= 5 m overhead (Jennings et al. 1999)", "Map 1 (N1, N5); C1 check; component validation"],
        ["Ground cover", "Same 20 points: bare soil, rock, litter, grass/herb, shrub (line-point intercept, Herrick et al. 2017)", "Map 1 (N2); Map 2 (S)"],
        ["Invasive shrubs", "Lantana / Prosopis within 1 m of each point", "Map 1 (N7)"],
        ["Erosion 0-4", "Sheet, rill and gully classes over the plot", "Map 1 (N4)"],
        ["Fire, grazing, cutting 0-2", "Visual evidence over the plot", "Map 1 (disturbance); Map 2 (R)"],
        ["Soil depth (cm)", "Crowbar or auger to refusal at centre and 20 m N, E, S, W (max 100 cm)", "Map 2 (S, F5)"],
        ["Slope %, aspect", "Clinometer and compass at the centre", "Map 2 (T); component validation"],
        ["Landform, texture", "Position class; texture by feel (S to C)", "Map 2 (M, S)"],
        ["Constraint %", "Share of plot that is water, drain, rock outcrop, built-up or crop", "Map 3 (Excluded check)"],
        ["Photos, GPS", "N, E, S, W and vertical; GPS position and accuracy", "Audit trail"],
    ], caption="Table 2. Plot measurements (about 40-50 minutes per plot for a team of two).")

    doc.add_heading("4. Reference (field) labels", 1)
    para(doc, "Field Need Index FNI = 0.35 x canopy deficit + 0.20 x bare-soil share + 0.20 x erosion/4 + "
              "0.10 x min(invasive % / 30, 1) + 0.15 x (fire + grazing + cutting)/6, where canopy deficit = "
              "(40 - canopy %)/40 clamped to [0, 1].", "Map 1.")
    para(doc, "Field Feasibility Index FFI = M^0.325 x S^0.325 x (0.55 + 0.45 TR), mirroring the RFI structure: "
              "M from landform and texture, S from soil depth, rock share and texture, T from slope (same optimum "
              "curve as F10) and aspect heat load, R from fire and grazing; TR = (18 T + 12 R)/30.", "Map 2.")
    para(doc, "Plots with field canopy >= 40 % are labelled Protected; plots with more than 30 % constrained area "
              "are labelled Excluded; all others receive field need and feasibility classes (design-weighted quintiles "
              "of FNI and FFI, matching the map's quintile method) and a field phase from the same 5 x 5 matrix as the "
              "map.", "Map 3.")
    para(doc, "The field index formulas and weights are fixed before the field visits (this protocol) and are not "
              "tuned to the results.", "Pre-registration.")

    doc.add_heading("5. Analysis design", 1)
    bullets(doc, [
        "Component validation: Pearson r, RMSE and bias between field and model canopy cover, bare-soil share and slope.",
        "Maps 1 and 2: Spearman rank correlation between the map index (RNI, RFI) and the field index (FNI, FFI) with a "
        "2,000-resample bootstrap 95 % CI; Kendall tau-b between map class and field index with a permutation test; "
        "design-weighted exact and within-one-class agreement; quadratic-weighted kappa (Cohen 1968) with bootstrap CI.",
        "Map 3: 7 x 7 error matrix; overall, user's and producer's accuracy with standard errors, and area-adjusted "
        "class areas with 95 % CI, using the stratified estimators of Olofsson et al. (2014) with area weights; "
        "agreement within one phase; accuracy of the Phase 1-2 (priority) decision.",
        "Quality control: agreement of FNI, FFI and field phase between first and second visits.",
        "Software: Python script frpim_accuracy_analysis.py (reproducible; inputs are the filled field form and the "
        "office sample file).",
    ])
    para(doc, "Strength of rank correlation is described with Cohen (1988) (0.1 small, 0.3 medium, 0.5 large) and "
              "kappa with Landis and Koch (1977). No pass/fail threshold is imposed; estimates are reported with "
              "their confidence intervals.", "Interpretation.")

    doc.add_heading("6. Reporting tables (fill after the analysis)", 1)
    table(doc, ["Variable", "n", "Pearson r", "RMSE", "Bias (model - field)"],
          [["Canopy cover %", "", "", "", ""], ["Bare-soil share %", "", "", "", ""], ["Slope %", "", "", "", ""]],
          caption="Table 3. Component validation.")
    table(doc, ["Map", "Spearman rho (95 % CI)", "Kendall tau-b (p)", "Exact class agreement", "Within one class",
                "Weighted kappa (95 % CI)"],
          [["Map 1 - RNI", "", "", "", "", ""], ["Map 2 - RFI", "", "", "", "", ""]],
          caption="Table 4. Agreement of Maps 1 and 2 with field indices.")
    classes = ["Phase 1", "Phase 2", "Phase 3", "Phase 4", "Phase 5", "Protected", "Excluded"]
    table(doc, ["Map \\ Field"] + classes + ["n"], [[c] + [""] * 8 for c in classes],
          caption="Table 5. Map 3 error matrix (sample counts; rows = map class, columns = field class).")
    table(doc, ["Class", "User's acc. (± 95 %)", "Producer's acc.", "Mapped area (ha)", "Adjusted area (± 95 %, ha)"],
          [[c, "", "", f"{float(S[i]['area_ha']):,.1f}", ""] for i, c in enumerate(classes)] +
          [["Overall accuracy", "", "", "", ""]], caption="Table 6. Map 3 accuracy and area estimates.")

    doc.add_heading("7. Methods text for the report or paper", 1)
    para(doc, f"Map accuracy was assessed with a stratified random sample of {n} blocks (strata = the seven classes "
              "of the priority map; six blocks per phase and four each for the protected and excluded classes), "
              "selected by seeded simple random sampling without replacement within strata, with ordered reserve "
              "units for inaccessible blocks (Olofsson et al. 2014). In each block a 30 m radius plot was located at "
              "a random position at least 30 m from the block edge. Canopy cover and ground cover were recorded by "
              "point intercept at 20 points along four 30 m radial lines; soil depth was probed at five points; "
              "slope, aspect, landform, texture, erosion, disturbance and constrained area were recorded for the "
              "plot. Field teams were blind to the map classes. Field need and feasibility indices were computed with "
              "formulas fixed before the survey and classified with design-weighted quintiles; field priority phase "
              "followed the map's 5 x 5 decision matrix. Agreement of the need and feasibility maps was evaluated with "
              "Spearman's rho and quadratic-weighted kappa (bootstrap 95 % confidence intervals), and the priority "
              "map with an area-weighted error matrix, user's and producer's accuracies and area-adjusted class "
              "estimates (Olofsson et al. 2014; Stehman 2014). Four plots were independently re-surveyed to quantify "
              "observer agreement.", size=9.5)

    doc.add_heading("8. Field logistics", 1)
    bullets(doc, [
        "Teams: two teams of two (one measures, one records). About 10 plots per team-day including travel; "
        f"{n} main plots + 4 quality-control re-visits ~ 4-5 team-days.",
        "Timing: complete all visits within one season (preferably before the end of the post-monsoon green period), "
        "because the model uses Sep-Nov imagery.",
        "Equipment: GPS or phone (load the KML / GPX), 30 m tape, compass, clinometer (or phone app), crowbar or "
        "1 m auger, camera, printed field manual and datasheets, pencil, flagging tape.",
        "Data entry: copy each datasheet into ACC_field_form.csv (one row per plot). For a second (QC) visit, add a "
        "new row with the same plot number followed by -QC (e.g. AC-04-QC).",
        "Return the filled CSV and photos to the office; the analysis script produces Tables 3-6.",
    ])

    doc.add_heading("9. Limitations to state", 1)
    bullets(doc, [
        "The sample size is set by field capacity; confidence intervals are therefore wide for individual classes.",
        "Maps 1 and 2 use relative (quintile) classes, so class agreement is assessed against field quintiles; rank "
        "correlation is the primary measure for these two maps.",
        "Field indices are proxies built from plot observations; they are independent of the satellite data but "
        "not identical to the model parameters.",
        "Soil depth by crowbar refusal can under-read on stony soils.",
    ])

    doc.add_heading("References", 1)
    for ref in [
        "Cohen, J. (1968). Weighted kappa: nominal scale agreement with provision for scaled disagreement or partial credit. Psychological Bulletin, 70(4), 213-220.",
        "Cohen, J. (1988). Statistical Power Analysis for the Behavioral Sciences (2nd ed.). Lawrence Erlbaum.",
        "Congalton, R. G., & Green, K. (2019). Assessing the Accuracy of Remotely Sensed Data: Principles and Practices (3rd ed.). CRC Press.",
        "Efron, B., & Tibshirani, R. J. (1993). An Introduction to the Bootstrap. Chapman & Hall.",
        "Herrick, J. E., Van Zee, J. W., McCord, S. E., Courtright, E. M., Karl, J. W., & Burkett, L. M. (2017). Monitoring Manual for Grassland, Shrubland, and Savanna Ecosystems (2nd ed.), Vol. 1. USDA-ARS Jornada Experimental Range.",
        "Jennings, S. B., Brown, N. D., & Sheil, D. (1999). Assessing forest canopies and understorey illumination: canopy closure, canopy cover and other measures. Forestry, 72(1), 59-74.",
        "Landis, J. R., & Koch, G. G. (1977). The measurement of observer agreement for categorical data. Biometrics, 33(1), 159-174.",
        "Olofsson, P., Foody, G. M., Herold, M., Stehman, S. V., Woodcock, C. E., & Wulder, M. A. (2014). Good practices for estimating area and assessing accuracy of land change. Remote Sensing of Environment, 148, 42-57.",
        "Stehman, S. V. (2009). Sampling designs for accuracy assessment of land cover. International Journal of Remote Sensing, 30(20), 5243-5272.",
        "Stehman, S. V. (2014). Estimating area and map accuracy for stratified random sampling when the strata are different from the map classes. International Journal of Remote Sensing, 35(13), 4923-4939.",
    ]:
        p = doc.add_paragraph(ref); p.paragraph_format.left_indent = Cm(0.6); p.paragraph_format.first_line_indent = Cm(-0.6)
        for r in p.runs:
            r.font.size = Pt(9)
    doc.save(outp)
    print("saved", outp)


if __name__ == "__main__":
    main()
