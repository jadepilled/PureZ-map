"""Stitch a terrain's satellite layer tiles into one image, then cut web tiles.

    python tools/satellite.py <layers folder> <map id> [--size 16384]

<layers folder> holds the terrain's s_XXX_YYY_lco.paa (or .png) tiles from the unpacked game or
mod (for example DZ/worlds/chernarusplus/data/layers). Neighbouring tiles overlap; the overlap is
measured from the tiles themselves. The result is resized to --size (default: the map size in
maps/<id>/data.json rounded to a power of two) and cut into maps/<id>/tiles/satellite.
"""
import argparse, json, math, os, re, subprocess, sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import paa  # noqa: E402

Image.MAX_IMAGE_PIXELS = None
NAME = re.compile(r"s_(\d{3})_(\d{3})_lco\.(paa|png)$", re.I)


def load(path):
    return (paa.read_paa(path) if path.lower().endswith(".paa") else Image.open(path)).convert("RGB")


def overlap(a, b, axis, max_px=128):
    """Pixels shared by neighbours a|b (axis 1) or a over b (axis 0), by best edge match."""
    a, b = np.asarray(a, np.float32), np.asarray(b, np.float32)
    best, best_err = 0, float("inf")
    for o in range(1, max_px + 1):
        ea = a[:, -o:] if axis == 1 else a[-o:, :]
        eb = b[:, :o] if axis == 1 else b[:o, :]
        err = float(np.mean((ea - eb) ** 2))
        if err < best_err:
            best, best_err = o, err
    return best


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("layers")
    ap.add_argument("map_id")
    ap.add_argument("--size", type=int)
    ap.add_argument("--flip", action="store_true", help="tile rows start at the south edge")
    a = ap.parse_args()
    tiles = {}
    for f in os.listdir(a.layers):
        m = NAME.search(f)
        if m:
            tiles[(int(m.group(1)), int(m.group(2)))] = os.path.join(a.layers, f)
    if not tiles:
        sys.exit("no s_XXX_YYY_lco tiles found")
    cols = max(x for x, _ in tiles) + 1
    rows = max(y for _, y in tiles) + 1
    first = load(tiles[(0, 0)])
    tile = first.width
    ov = overlap(first, load(tiles[(1, 0)]), 1) if (1, 0) in tiles else 0
    step = tile - ov
    print(f"{cols}x{rows} tiles of {tile}px, overlap {ov}px")
    full = Image.new("RGB", (cols * step, rows * step))
    for (x, y), path in tiles.items():
        img = load(path).crop((ov // 2, ov // 2, ov // 2 + step, ov // 2 + step))
        yy = rows - 1 - y if a.flip else y
        full.paste(img, (x * step, yy * step))
    with open(os.path.join(os.path.dirname(HERE), "maps", a.map_id, "data.json"), encoding="utf-8") as f:
        size = a.size or 2 ** math.ceil(math.log2(json.load(f)["size"]))
    full = full.resize((size, size), Image.LANCZOS)
    out = os.path.join(os.path.dirname(HERE), "maps", a.map_id, "satellite.png")
    full.save(out)
    print(f"stitched {full.size} -> {out}")
    subprocess.run([sys.executable, os.path.join(HERE, "tiles.py"), out,
                    os.path.join(os.path.dirname(HERE), "maps", a.map_id, "tiles", "satellite")], check=True)
    os.remove(out)


if __name__ == "__main__":
    main()
