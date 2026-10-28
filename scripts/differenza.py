#!/usr/bin/env python3
"""Differenza pixel tra due screenshot: prova AUTOMATICA che la scena si muove.
Uso: differenza.py a.png b.png  →  JSON con percentuale pixel diversi."""
import json, sys
from PIL import Image, ImageChops

a = Image.open(sys.argv[1]).convert("RGB")
b = Image.open(sys.argv[2]).convert("RGB")
if a.size != b.size:
    b = b.resize(a.size)
d = ImageChops.difference(a, b).convert("L")
px = list(d.getdata())
tot = len(px)
diversi = sum(1 for v in px if v > 24)  # soglia anti-rumore/JPEG
print(json.dumps({
    "pixelDiversiPct": round(100 * diversi / tot, 2),
    "soglia": "> 24/255 per pixel (rumore escluso)",
    "dimensione": f"{a.size[0]}x{a.size[1]}",
}))
