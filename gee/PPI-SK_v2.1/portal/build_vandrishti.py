"""Builds vandrishti.html from vandrishti.src.html + shared code kept from works.src.html + Leaflet CSS + sample plots.
Usage: python build_vandrishti.py LEAFLET_CSS SAMPLES_JSON"""
import json, re, sys
old = open('works.src.html').read()
def seg(start, end):
    i, j = old.index(start), old.index(end)
    assert i < j, (start, end)
    return old[i:j]
A = seg('/* ---------------- helpers ---------------- */', '/* ---------------- session and routing ---------------- */')
avatar_line = re.search(r'^function avatar\(role, cls\).*\n', A, flags=re.M).group(0)
A = A.replace(avatar_line, '')
old_fig = 'wrap.append(el("figure", null, el("figcaption", { text: t }), svgEl(mapSVG(geom, k)), legendRow(tbl, keys))));'
assert A.count(old_fig) == 1
A = A.replace(old_fig, 'wrap.append(el("figure", null, el("figcaption", { text: t }), el("div", { class: "mapbox" }, svgEl(mapSVG(geom, k))), legendRow(tbl, keys))));')
B = seg('function confirmButton(', '/* ---------------- division map ---------------- */')
C = seg('/* ---------------- exports ---------------- */', 'async function saveReport(')
css = open(sys.argv[1]).read()
css = re.sub(r'url\([^)]*\)', 'none', css); css = re.sub(r'/\*.*?\*/', '', css, flags=re.S); css = re.sub(r'\s+', ' ', css)
s = open('vandrishti.src.html').read()
for k, v in (('/*@@KEEP_A@@*/', A), ('/*@@KEEP_B@@*/', B), ('/*@@KEEP_C@@*/', C)):
    assert s.count(k) == 1, k
    s = s.replace(k, v)
s = s.replace('/*LEAFLET_CSS*/', '/* Leaflet 1.9.4 (BSD-2-Clause), image references removed */\n' + css)
s = s.replace('/*SAMPLES*/[]', json.dumps(json.load(open(sys.argv[2])), separators=(',', ':')))
open('vandrishti.html', 'w').write(s)
print('vandrishti.html', len(s))
