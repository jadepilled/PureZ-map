"""Render a dark topographic map from a heightmap, then cut web tiles.

    python tools/topo.py <heightmap> <map id> [--out-px 8192] [--sea 0]

<heightmap> can be an ESRI ASCII grid (.asc, as exported by Terrain Builder), a .npy array,
or a 16-bit PNG with --min/--max giving the metres for black and white. North is the first row.
Draws hillshade, elevation tint, water and contours (10 m, every 50 m stronger).
"""
import argparse, os, subprocess, sys

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
Image.MAX_IMAGE_PIXELS = None


def read_heights(path, lo=None, hi=None):
    if path.endswith(".npy"):
        return np.load(path).astype(np.float32)
    if path.endswith(".asc"):
        with open(path) as f:
            head = {}
            for _ in range(6):
                k, v = f.readline().split()
                head[k.lower()] = float(v)
            h = np.loadtxt(f, dtype=np.float32)
        nd = head.get("nodata_value")
        if nd is not None:
            h[h == nd] = np.nan
        return h
    img = np.asarray(Image.open(path)).astype(np.float32)
    if img.ndim == 3:
        img = img[..., 0]
    top = 65535.0 if img.max() > 255 else 255.0
    return (lo or 0) + img / top * ((hi or top) - (lo or 0))


def render(h, px, metres, sea):
    img = Image.fromarray(np.nan_to_num(h, nan=float(np.nanmin(h)))).resize((px, px), Image.BILINEAR)
    h = np.asarray(img, np.float32)
    cell = metres / px
    gy, gx = np.gradient(h, cell)
    slope = np.pi / 2 - np.arctan(np.hypot(gx, gy))
    aspect = np.arctan2(-gx, gy)
    az, alt = np.radians(315), np.radians(45)
    shade = np.clip(np.sin(alt) * np.sin(slope) + np.cos(alt) * np.cos(slope) * np.cos(az - aspect), 0, 1)

    land = h > sea
    t = np.clip((h - sea) / max(float(np.nanmax(h) - sea), 1), 0, 1)
    low, high = np.array([24, 28, 26], np.float32), np.array([62, 60, 54], np.float32)
    rgb = low + (high - low) * t[..., None]
    rgb = rgb * (0.55 + 0.65 * shade[..., None])
    rgb[~land] = np.array([14, 24, 31], np.float32)

    def lines(step):
        band = np.floor(h / step)
        edge = np.zeros(h.shape, bool)
        edge[:-1] |= band[:-1] != band[1:]
        edge[:, :-1] |= band[:, :-1] != band[:, 1:]
        return edge & land
    minor = lines(10)
    rgb[minor] = rgb[minor] * 0.55 + np.array([210, 205, 190]) * 0.45 * 0.6
    major = lines(50)
    rgb[major] = rgb[major] * 0.35 + np.array([230, 225, 210]) * 0.65 * 0.55
    coast = np.zeros(h.shape, bool)
    coast[:-1] |= land[:-1] != land[1:]
    coast[:, :-1] |= land[:, :-1] != land[:, 1:]
    rgb[coast] = [120, 140, 150]
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("heightmap")
    ap.add_argument("map_id")
    ap.add_argument("--out-px", type=int, default=8192)
    ap.add_argument("--sea", type=float, default=0.0)
    ap.add_argument("--min", type=float)
    ap.add_argument("--max", type=float)
    a = ap.parse_args()
    import json
    root = os.path.dirname(HERE)
    with open(os.path.join(root, "maps", a.map_id, "data.json"), encoding="utf-8") as f:
        metres = json.load(f)["size"]
    img = render(read_heights(a.heightmap, a.min, a.max), a.out_px, metres, a.sea)
    out = os.path.join(root, "maps", a.map_id, "topo.png")
    img.save(out)
    subprocess.run([sys.executable, os.path.join(HERE, "tiles.py"), out, os.path.join(root, "maps", a.map_id, "tiles", "topographic")], check=True)
    os.remove(out)
    print("add \"topographic\" to this map's base list in maps.json")


if __name__ == "__main__":
    main()
