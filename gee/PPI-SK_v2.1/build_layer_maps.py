"""Builds scripts/FRPIM_v22_LAYER_MAPS_KHEDBRAHMA.js = header + shared library + layer catalogue + body."""
import json
import pathlib
src = pathlib.Path('src')
cat = json.loads((src / 'layer_catalogue.json').read_text())
out = (src / 'layer_maps_header.js').read_text() + (src / 'lib.js').read_text()
out += ('\n/* ---------- Layer catalogue (titles, units, colours, export scale) ---------- */\nvar CATALOGUE = ' +
        json.dumps(cat, indent=1, ensure_ascii=True) + ';\n\n')
out += (src / '04_layer_maps.js').read_text()
pathlib.Path('scripts/FRPIM_v22_LAYER_MAPS_KHEDBRAHMA.js').write_text(out)
print('lines:', out.count('\n'))
