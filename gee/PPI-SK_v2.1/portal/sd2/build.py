"""Builds vandrishti_sd2.html from vandrishti_sd2.src.html + Leaflet CSS (image references removed).
Usage: python build.py LEAFLET_CSS"""
import re, sys
css = open(sys.argv[1]).read()
css = re.sub(r'url\([^)]*\)', 'none', css); css = re.sub(r'/\*.*?\*/', '', css, flags=re.S); css = re.sub(r'\s+', ' ', css)
s = open('vandrishti_sd2.src.html').read()
assert s.count('/*LEAFLET_CSS*/') == 1
s = s.replace('/*LEAFLET_CSS*/', '/* Leaflet 1.9.4 (BSD-2-Clause) */\n' + css)
open('vandrishti_sd2.html', 'w').write(s)
print('vandrishti_sd2.html', len(s))
