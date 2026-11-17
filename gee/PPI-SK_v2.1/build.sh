#!/usr/bin/env bash
# Assembles the copy-paste-ready GEE scripts from src/.
# Scripts 00 and 01 embed the SAME shared library (src/lib.js), so the state
# anchors and the range scores are always built by identical code.
set -euo pipefail
cd "$(dirname "$0")"
out=scripts
mkdir -p "$out"
cat src/00_header.js src/lib.js src/00_main.js > "$out/00_state_anchors.js"
cat src/01_header.js src/lib.js src/01_main.js > "$out/01_range_layers.js"
cp src/02_scoring.js "$out/02_scoring.js"
cp src/03_validation.js "$out/03_validation.js"
for f in "$out"/*.js; do node --check "$f"; echo "syntax OK: $f ($(wc -l < "$f") lines)"; done
python3 build_all_in_one.py && node --check scripts/PPI_SK_v21_ALL_IN_ONE.js && echo "syntax OK: all-in-one"
