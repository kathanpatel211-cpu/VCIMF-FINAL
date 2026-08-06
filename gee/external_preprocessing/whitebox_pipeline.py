"""
Module 2 — external hydrological preprocessing (spec Part 2).

Google Earth Engine has no native flow direction, flow accumulation,
watershed delineation, or stream ordering. This script performs the steps
that GEE cannot do, using WhiteboxTools, and writes rasters/vectors ready to
upload as GEE assets. Run this OUTSIDE GEE, once, before any Module 2 script
in gee/module2_watershed_treatment/ can produce real output.

Prerequisites:
    pip install whitebox
    # WhiteboxTools binary is downloaded automatically on first use.

Inputs you must supply:
    DEM_PATH   - FABDEM (preferred, DTM) or Copernicus GLO-30 (DSM fallback)
                 for the FULL hydrological catchment extent (Part 1.3) —
                 NOT clipped to Sabarkantha district. Catchments feeding
                 Hathmati, Guhai and Harnav extend into Rajasthan.
    OUTPUT_DIR - working directory for intermediate and final rasters.

Calibration (spec Part 2.2): STREAM_THRESHOLD_CELLS starts at 1000 (90 ha).
Run once, check the size distribution of the resulting basins, and adjust
until the MEDIAN basin falls in the 500-1000 ha target band. Do not accept
the first run.

Validation (mandatory, spec Part 2.2/2.3): overlay the derived stream
network on Survey of India toposheets and high-resolution imagery in at
least 5 sub-catchments spanning hill (Khedbrahma, Vijaynagar) and piedmont
(Idar, Himatnagar) terrain before trusting anything downstream. If the
derived network does not match the real nala network, the conditioning is
wrong and every morphometric parameter, Cluster C, and all of Tier 2 is
invalid — this is not optional.
"""

import os
from whitebox.whitebox_tools import WhiteboxTools

DEM_PATH = "inputs/fabdem_full_catchment.tif"          # set to your DEM
OUTPUT_DIR = "outputs"
STREAM_THRESHOLD_CELLS = 1000                           # Part 2.2 — CALIBRATE, do not accept first run
POUR_POINTS_PATH = "inputs/pour_points.shp"             # sub-basin/reservoir pour points, if delineating named sub-catchments

wbt = WhiteboxTools()
wbt.set_working_dir(os.path.abspath(OUTPUT_DIR))
wbt.verbose = True


def run_pipeline():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    dem = os.path.abspath(DEM_PATH)

    # Step 2 — hydrological conditioning. Breach, NOT fill (spec: FillDepressions
    # creates flat areas -> parallel artificial flow paths -> distorted Dd).
    conditioned = "conditioned_dem.tif"
    wbt.breach_depressions_least_cost(
        dem=dem, output=conditioned, dist=100, fill=True, max_cost=None
    )

    # Step 3 — D8 flow direction
    flow_dir = "flow_direction_d8.tif"
    wbt.d8_pointer(dem=conditioned, output=flow_dir)

    # Step 4 — D8 flow accumulation
    flow_acc = "flow_accumulation_d8.tif"
    wbt.d8_flow_accumulation(i=conditioned, output=flow_acc, out_type="cells")

    # Step 5 — extract streams at the calibrated threshold
    streams_raster = "stream_network_raster.tif"
    wbt.extract_streams(flow_accum=flow_acc, output=streams_raster,
                         threshold=STREAM_THRESHOLD_CELLS)

    # Step 6 — Strahler stream order
    stream_order = "stream_order_strahler.tif"
    wbt.strahler_stream_order(d8_pntr=flow_dir, streams=streams_raster,
                               output=stream_order)

    # Step 7 — micro-watershed delineation at pour points.
    # If POUR_POINTS_PATH is not yet defined, use wbt.basins() first to get an
    # initial exhaustive sub-basin set, inspect the size histogram, then
    # generate pour points at the 500-1000 ha target and re-run watershed().
    basins_raster = "basins_all.tif"
    wbt.basins(d8_pntr=flow_dir, output=basins_raster)

    if os.path.exists(POUR_POINTS_PATH):
        microwatersheds_raster = "microwatersheds.tif"
        wbt.watershed(d8_pntr=flow_dir, pour_pts=POUR_POINTS_PATH,
                       output=microwatersheds_raster)
        microwatersheds_vector = "microwatersheds.shp"
        wbt.raster_to_vector_polygons(i=microwatersheds_raster,
                                       output=microwatersheds_vector)

    # Step 8 — flow path lengths (feeds W5 IC Ddn, W6 flow-path proximity)
    dist_to_stream = "downslope_dist_to_stream.tif"
    wbt.downslope_distance_to_stream(dem=conditioned, streams=streams_raster,
                                      output=dist_to_stream)
    flowpath_length = "downslope_flowpath_length.tif"
    wbt.downslope_flowpath_length(d8_pntr=flow_dir, output=flowpath_length)

    # Step 9 — LS factor (feeds W2 RUSLE, computed externally per spec)
    ls_factor = "ls_factor.tif"
    wbt.sediment_transport_index(sca=flow_acc, slope=None, output=ls_factor,
                                  sca_exponent=0.4, slope_exponent=1.3)
    # NOTE: sediment_transport_index requires a slope raster; generate one
    # from `conditioned` with wbt.slope() first and pass its path as `slope`.
    slope_raster = "slope_degrees.tif"
    wbt.slope(dem=conditioned, output=slope_raster, units="degrees")

    # Step 10 — vectorise stream network with order attribute
    stream_lines = "stream_lines.shp"
    wbt.raster_streams_to_vector(streams=streams_raster, d8_pntr=flow_dir,
                                  output=stream_lines)

    print("Pipeline complete. Upload the following to GEE Assets and update "
          "gee/module2_watershed_treatment/02_external_assets.js EXTERNAL{}:")
    print("  conditioned_dem.tif          -> CONDITIONED_DEM")
    print("  flow_direction_d8.tif        -> FLOW_DIRECTION_D8")
    print("  flow_accumulation_d8.tif     -> FLOW_ACCUMULATION_D8")
    print("  stream_network_raster.tif    -> STREAM_NETWORK_RASTER")
    print("  stream_order_strahler.tif    -> STREAM_ORDER_STRAHLER")
    print("  microwatersheds.shp          -> MICROWATERSHED_POLYGONS")
    print("  stream_lines.shp             -> STREAM_LINES")
    print("  downslope_dist_to_stream.tif -> DOWNSLOPE_DIST_TO_STREAM")
    print("  downslope_flowpath_length.tif-> DOWNSLOPE_FLOWPATH_LEN")
    print("  ls_factor.tif                -> LS_FACTOR")
    print("")
    print("MANDATORY before trusting any of this: overlay stream_lines.shp on "
          "Survey of India toposheets / high-res imagery in >=5 sub-catchments "
          "(hill + piedmont). Check the microwatershed size histogram — median "
          "should fall in 500-1000 ha. Re-run with an adjusted "
          "STREAM_THRESHOLD_CELLS if not.")


if __name__ == "__main__":
    run_pipeline()
