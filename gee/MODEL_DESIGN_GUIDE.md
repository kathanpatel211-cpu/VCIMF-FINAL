# Building a CAMPA Site-Prioritization Model from Scratch

A reference for designing a scientifically defensible, operationally reliable
GEE-based site-prioritization model — distilled from building and debugging
one for Sabarkantha Forest Division, Gujarat. Written as a guide you can reuse
for a new model, a new landscape, or a different treatment type.

---

## 1. Start with the decision, not the data

Before picking a single dataset, answer four questions — they determine
almost everything downstream:

1. **What operation is actually being planned?** New Plantation and ANR are
   different operations with different costs, different site requirements,
   and (as this project found) may not both be operationally available in a
   given state's CAMPA programme. Don't let the model recommend something the
   division can't execute.
2. **What spatial unit will someone act on?** A pixel is not a planning unit.
   Pick a block size a field team can actually be assigned to (e.g. ~9 ha /
   300 m grid) and do all decision-making at that unit, not per-pixel.
3. **What's the output someone actually needs?** Not "a ranking" — a ranking
   answers "what's next" for one budget cycle but leaves the rest of the
   landscape unaccounted for. A **whole-area classification** (every hectare
   assigned to a category, including "not applicable" with a reason) is what
   a Forest Department can actually plan a multi-year programme against.
4. **What scale is this really running at?** A Beat (~100 km²), a Range
   (~1,000 km²) and a Division (~10,000 km²) need different block sizes,
   different working scales, and will hit Earth Engine's memory limits very
   differently. Know this before writing CONFIG.

---

## 2. Separate constraints from factors (Eastman's MCDA framework)

This is the single most important structural decision.

- **Constraints** are Boolean pass/fail. A site that's too steep, already
  forested, underwater, or cropland is **not** "low priority" — it's not a
  candidate at all. Never let a good score elsewhere buy back a failed
  constraint.
- **Factors** are the things you actually score and weight — soil quality,
  climate exposure, carbon potential, etc.

Conflating the two is a common and serious modelling error: it lets, say,
excellent rainfall mathematically compensate for a site that's underwater.

**Design pattern:**
```
eligibleMask = (FSI canopy class is in the treatable band)
             AND (land cover is plantable: not crop/built/water)
             AND (slope <= max)
             AND (not waterlogged)
             AND (not rock/saline)
```
Score only inside `eligibleMask`. Everything outside it gets a **reason**, not
a low score (see §8).

---

## 3. Criterion catalog: what to measure and why

Organize criteria into clusters — it keeps the AHP weighting sane and makes
the "applied weights" table readable. A well-rounded model touches all of
these; not every landscape needs every criterion (an automatic audit, §7,
should decide that for you, not manual curation).

### Ecological Integrity
| Criterion | What it measures | Good GEE source | Method |
|---|---|---|---|
| Distance to existing forest | Seed source proximity, edge effects | Your own forest mask | Bounded distance transform |
| Hydrological connectivity | Proximity to surface water | Dynamic World / ESA WorldCover water class | Bounded distance transform |
| Degradation priority | How far below the canopy ceiling a site is | Your canopy layer | `1 - (canopy / eligibleCeiling)` |
| Structural connectivity *(optional, costly)* | Patch size + reach to other habitat | Your forest mask, `connectedPixelCount` | Coarse working scale — see §9 |

### Physical Site Suitability
| Criterion | What it measures | Good GEE source | Method |
|---|---|---|---|
| Soil suitability | Texture/pH/CEC/coarse-fragment fitness for the target species | `projects/soilgrids-isric/*_mean` (fallback: OpenLandMap) | FAO Land Evaluation, **limiting-factor rule** (min, not mean — one bad property shouldn't be averaged away) |
| Soil organic carbon | Establishment substrate quality | SoilGrids `soc_mean` | Percentile-normalized |
| Moisture availability | Site water balance | MERIT Hydro (TWI, HAND) + TerraClimate soil moisture | Composite of 2–3 signals |
| Workability | Can a crew and equipment actually work the site | Slope + rainfall | Simple weighted composite |

### Climate
| Criterion | What it measures | Good GEE source | Method |
|---|---|---|---|
| Climate exposure | Heat + drought stress at establishment | MODIS LST (p95, multi-year) + CHIRPS rainfall CV + TerraClimate CWD | Composite, inverted (low stress = high priority) |
| Land productivity trend *(optional, expensive)* | Actively degrading vs. stably poor — different interventions | Landsat, Theil–Sen slope on annual peak NDVI | Only if you can afford the compute; see §9 |

### Carbon & Restoration Value
| Criterion | What it measures | Good GEE source | Method |
|---|---|---|---|
| Carbon-gain potential | Headroom below a reference biomass | GEDI L4B **gridded** (not L4A footprints — see §6) → ESA CCI → NDVI proxy | `referenceAGB - currentAGB`, clamped ≥0 |
| Erosion risk | Soil loss rate | RUSLE from real inputs, not constants (see below) | `R × K × LS × C` |

### Risk & Feasibility
| Criterion | What it measures | Good GEE source | Method |
|---|---|---|---|
| Fire risk | Establishment risk to a young stand | MODIS MCD64A1 + FIRMS active fire | Multi-year frequency, direction is a **policy choice** (need vs. risk — see §5) |
| Invasion proxy | Clearance cost before planting | Sentinel-2 dry/wet seasonal NDVI amplitude | Phenological signature, not brightness — see below |

### Human Dimension
| Criterion | What it measures | Good GEE source | Method |
|---|---|---|---|
| Human dependency/accessibility | Logistics + community engagement potential | JRC GHSL population | **Inverted-U**: too remote is a logistics problem, too dense is an encroachment/grazing problem — neither extreme is best |

### Doing RUSLE properly (a common shortcut to avoid)
A fixed `K = 0.28` and `LS` from `slope.reduceNeighborhood(sum)` are not RUSLE
— they're a slope re-skin with no hydrological meaning. Do it properly, and
it costs almost nothing extra once you already have the soil and terrain
layers for other criteria:
- **K** (Williams 1995 EPIC equation) from sand/silt/clay/SOC — you already
  fetched these for soil suitability.
- **LS** (Desmet & Govers 1996) from *real* upstream drainage area
  (`MERIT/Hydro` band `upa`) — you already fetched this for TWI/HAND.

---

## 4. The canopy/land-cover trap (read this before choosing a base layer)

If your landscape is **dry-deciduous or thorn forest** (much of peninsular
India, the Aravalli tract, etc.), **Hansen GFC's `treecover2000`** will
under-report canopy badly. It's trained mainly on humid/evergreen forest, and
a real, moderately dense dry-deciduous canopy can come back reading near 0%.
This isn't a tuning issue — it silently corrupts every downstream decision
(FSI classification, eligibility, everything).

**Better approach**: build canopy from the same season the national forest
inventory methodology uses. In India, FSI's State of Forest Report interprets
**post-monsoon (Oct–Dec)** imagery — the one window where deciduous canopy is
fullest and most separable from bare ground. A Fractional Vegetation Cover
formula from post-monsoon NDVI (Carlson & Ripley 1997) is both cheap and far
more defensible:
```
FVC = ((NDVI - NDVI_soil) / (NDVI_veg - NDVI_soil))^2
```
Use fixed, literature-typical anchors for your forest type/season (not a
per-ROI stretch) so the percentage is comparable across Beats — and
field-verify a handful of plots before quoting the absolute number. The **FSI
class boundary** a site falls in is always more robust than the exact %.

---

## 5. Normalization and direction — decide these explicitly

- **Absolute anchors** (fixed lo/hi) where an external standard exists — FSI
  canopy classes, slope workability, RUSLE t/ha/yr. Comparable across sites.
- **Percentile anchors** (e.g. ROI 2nd–98th) where no external standard
  exists — relative comparison within the landscape being ranked.
- Mixing these up is a real, subtle bug: normalizing everything to a per-ROI
  percentile silently lets the **normalization choice**, not the AHP weight,
  decide how much a criterion actually influences the ranking. If you can,
  print a **realised influence** table (nominal weight × observed spread) next
  to the nominal weights — the two disagreeing is the signal something's off.
- **Direction** (does higher = higher priority, or the reverse?) is often a
  genuine **policy choice**, not a technical one. Fire history and invasion
  pressure can be read as "need" (act here) or "risk" (avoid a young stand
  failing here) — both are defensible, and they produce different maps. Make
  this an explicit, documented CONFIG flag, not a hardcoded assumption.

---

## 6. Pick data sources for reliability, not just resolution

- **GEDI L4A footprints** are sparse — over a single Beat in one year,
  `.mean()` leaves most pixels masked, which silently degrades to a flat
  neutral value while still consuming weight. Use the **gridded L4B** product
  (complete coverage) instead.
- **CHIRPS DAILY** for a 30-year variability signal means ~11,000 image
  operations for one criterion. **CHIRPS PENTAD** gives identical annual
  totals (to within rounding) for ~5× less work.
- Always have a **fallback chain**: SoilGrids → OpenLandMap; GEDI L4B → ESA
  CCI → NDVI proxy. Print which source was actually used — don't let it be
  silently substituted.

---

## 7. Build an automatic integrity audit — the single highest-leverage feature

Don't manually notice and remove a bad criterion after the fact (that's how
earlier iterations of this kind of model actually went — Soil Depth, then
Wildlife Corridor Proximity, each removed by hand after someone spotted the
problem). Make the model check **every criterion, every run**:

- **SPARSE** — valid data on <70% of eligible pixels/blocks. Catches
  data-availability gaps before they silently default to a neutral value.
- **INERT** — normalized spread across blocks is near-zero. A criterion that's
  effectively constant cannot change any ranking, no matter its weight — this
  is what a flat "0.5 fallback" looks like, and also what a very
  coarse-resolution layer (e.g. 25 km climate data) degenerates into over a
  small ROI.
- *(Optional)* **REDUNDANT** — two criteria correlate strongly (|r| > 0.8):
  they're one axis carrying two weights.

A dropped criterion has its weight **redistributed proportionally**, and the
drop is printed with its reason. This can be computed essentially for free if
it's derived from the same block-level aggregation your score needs — don't
add a separate sampling pass just for the audit (see §9).

---

## 8. Whole-area output design

A ranking of "top N sites" is not a plan. Design the output so:

1. **Every eligible block** gets a priority class (not only the ones that fit
   this year's budget) — quantile (each class ≈20% of blocks) is a safe
   default; equal-interval is an alternative when the score distribution
   itself matters.
2. **Every non-eligible hectare gets an explicit reason**, not a blank map or
   a fake "low priority" label. "Already forest", "cropland", "too steep",
   "waterlogged" are all real, useful information for a planner — computed in
   priority order so every excluded pixel gets exactly one reason.
3. **Priority hectares + Not-Applicable hectares should reconcile to the total
   ROI area.** Print this reconciliation — it's a cheap sanity check that
   catches area-accounting bugs immediately.
4. **Cost and carbon per class**, not just a score. A Forest Department can
   phase a multi-year programme directly off a table of (class → hectares →
   cost → tCO2e).

---

## 9. Earth Engine engineering — lessons that cost real debugging time

These aren't optional polish; each one caused a real failure in production
use of a model like this.

- **`unmask()` produces an unbounded (infinite-extent) image.** Any distance
  transform or focal operation run over it costs effectively unlimited work
  regardless of your ROI's real size. Always re-clip to `roi.bounds().buffer(...)`
  immediately after `unmask()`.
- **`reproject()` pins computation to that scale everywhere downstream**,
  overriding whatever scale a later reducer or sample asks for. Reprojecting
  anything to a fine scale forces its entire upstream chain to run at that
  scale. Set every `reproject()` at or near the source data's **native**
  resolution — never finer.
- **`mosaic()` discards projection.** Running `ee.Terrain.slope()` (or any
  terrain op) on a projection-less image returns nonsense — it has no pixel
  size to convert an elevation difference into a gradient. Prefer a DEM
  source that's a single, properly-projected `ee.Image` (e.g. SRTM); if using
  a mosaicked collection, call `setDefaultProjection()` before any terrain
  operation touches it.
- **`getInfo()` blocks the browser's UI thread.** A script with several
  blocking calls in sequence will freeze the Code Editor tab, independent of
  whether it's a memory problem. Use `.evaluate()` (async, callback-based)
  for anything heavy; keep only cheap validity probes (`limit(1).size()`, not
  `first().bandNames()` which scans an unfiltered collection) synchronous.
- **Don't aggregate all criteria in one call.** `ee.Image.cat` over many
  computation-heavy criteria makes Earth Engine materialize every chain
  simultaneously before selecting a single pixel — this fails regardless of
  how coarsely you sample afterward. **Group** criteria (e.g. 3 at a time)
  into separate `reduceRegions` calls over the same block grid, merge
  client-side on a stable block ID (never rely on array order across async
  calls), with automatic scale-coarsening and graceful per-criterion
  degradation on repeated failure — never let one expensive criterion take
  the whole run down.
- **Compute the audit from data you already have.** Sampling the ROI
  separately just to audit criteria costs a full pass over the data for
  nothing. If you're already aggregating to blocks for the score, the same
  aggregation gives you the audit's coverage and spread statistics for free.
- **Avoid duplicate computation chains.** If a criterion's raw value is also
  needed for a side calculation (e.g. cost surcharge logic), recover it from
  the aggregated mean you already computed — don't run the whole chain a
  second time.
- **Index by a stable key, never by array position**, once any filtering
  happens between two related arrays. A classic silent bug: `rows[b.id - 1]`
  where `rows` has been filtered — the position no longer corresponds to the
  original index once anything was skipped. Use a small `{key: row}` lookup
  object instead.

---

## 10. Optional enhancements — add only if there's a genuine need

Each of these is legitimate and can strengthen a model, but each also adds
real compute cost and output complexity. Add them deliberately, not by
default:

- **Multiple aggregation methods** (TOPSIS, Weighted Geometric Mean alongside
  WLC) with a "robust set" of blocks that rank well under all of them —
  useful when you need to demonstrate the ranking isn't an artifact of one
  method, at the cost of tripling what needs interrogating when something
  looks wrong.
- **Monte Carlo weight-sensitivity** — perturb weights across many draws and
  report each block's selection frequency. Good for showing how sensitive the
  plan is to the (usually provisional) AHP weights.
- **Budget-constrained selection alongside area-constrained** — greedy by
  score-per-rupee. Only worth it if a real budget ceiling, not just an area
  target, actually binds.
- **Spatial contiguity flagging** — scattered single blocks are often
  operationally worse than a compact cluster even at a slightly lower score.
- **Land productivity trend (UNCCD SDG 15.3.1 alignment)** — a Theil-Sen
  slope on many years of NDVI distinguishes *actively degrading* land from
  *stably poor* land, and completes the UNCCD's three-part degradation
  indicator alongside land cover and soil organic carbon. This is the single
  most expensive criterion to compute (a multi-decade, multi-sensor Landsat
  time series) — budget for it deliberately.
- **Satellite-only validation back-test** — find sites that measurably gained
  tree cover historically as pseudo-positives, and check whether the model
  would have ranked them highly (AUC). Genuinely strengthens the scientific
  claim, but needs care to exclude any criterion that's circular with how the
  positives were defined (e.g. don't validate a canopy-derived score against
  canopy-gain positives).
- **Future climate screening** (e.g. CMIP6 delta-downscaled to a fine
  baseline) — worth it for planning against a 10+ year investment horizon;
  usually too coarse to carry real signal over anything smaller than a Range,
  so expect an automatic INERT check (§7) to drop it at small scales.
- **Species-site matching** — pair the site-suitability outputs with
  published silvicultural envelopes for candidate species, turning a ranking
  tool into an actual decision-support system ("Block 42 → these 4 species").

---

## Suggested build order

1. Eligibility (constraints) + one clean canopy/land-cover source.
2. Three or four core criteria (soil, distance-to-forest, climate exposure,
   carbon) with a simple WLC score — get a whole-area, 5-class output working
   end to end, including the Not-Applicable accounting.
3. Add the automatic integrity audit.
4. Round out the criterion set (erosion, fire, invasion, human dependency)
   with real methods, not shortcuts.
5. Only then consider the §10 enhancements, one at a time, checking after
   each that the model still completes a run reliably.

A model that reliably finishes and covers the whole landscape with 8 solid
criteria is worth more, operationally, than one with 17 criteria and three
aggregation methods that occasionally fails to run.
