#!/usr/bin/env python3
"""Analisi pixel REALE di uno screenshot: serve a provare che il rendering 3D
ha davvero prodotto oggetti visibili (niente frame nero/vuoto). Stampare JSON."""
import json, sys
from PIL import Image

p = sys.argv[1]
im = Image.open(p).convert("RGB")
w, h = im.size
piccoli = im.resize((min(w, 200), min(h, 200)))
px = list(piccoli.getdata())
tot = len(px)
non_neri = sum(1 for r, g, b in px if r + g + b > 36)
unici = len(set(px))
# campioni in zone tipiche (centro, alto, basso)
cw, ch = w // 2, h // 2
centro = im.getpixel((cw, ch))
alto = im.getpixel((cw, h // 5))
basso = im.getpixel((cw, 4 * h // 5))
print(json.dumps({
    "dimensione": f"{w}x{h}",
    "nonNeriPct": round(100 * non_neri / tot, 1),
    "coloriUnici": unici,
    "campioni": {"centro": centro, "alto": alto, "basso": basso},
}))
