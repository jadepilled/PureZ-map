"""Sharpen a low-resolution map image and crisp its coastline with a sea mask, then cut web tiles.

    python tools/enhance.py <image> <map id> [--sea <water-sea.tga>] [--size 4096]

A stopgap for maps whose only imagery is the CE tool's 2048 px preview: the image is upscaled with
Lanczos, lightly sharpened, and sea pixels (from the mask) are smoothed so the coast reads cleanly.
Replace with tools/satellite.py once the terrain's own satellite layers are available.
"""
import argparse, os, subprocess, sys

import numpy as np
from PIL import Image, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from tga import read_tga  # noqa: E402

Image.MAX_IMAGE_PIXELS = None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("id")
    ap.add_argument("--sea")
    ap.add_argument("--size", type=int, default=4096)
    a = ap.parse_args()
    img = Image.open(a.image).convert("RGB").resize((a.size, a.size), Image.LANCZOS)
    img = img.filter(ImageFilter.UnsharpMask(radius=1.6, percent=55, threshold=2))
    if a.sea:
        sea = read_tga(a.sea) > 0
        sea = np.asarray(Image.fromarray(sea.astype(np.uint8) * 255, "L").resize((a.size, a.size), Image.BILINEAR)) / 255.0
        arr = np.asarray(img, np.float32)
        deep = arr[sea > 0.9].mean(axis=0)                      # the image's own water tone
        smooth = np.asarray(img.filter(ImageFilter.GaussianBlur(3)), np.float32)
        water = smooth * 0.6 + deep * 0.4
        m = sea[..., None]
        arr = arr * (1 - m) + water * m
        img = Image.fromarray(arr.clip(0, 255).astype(np.uint8), "RGB")
    out = os.path.join(HERE, "..", "maps", a.id, "tiles", "satellite")
    tmp = os.path.join(HERE, "..", "maps", a.id, "_enhanced.png")
    img.save(tmp)
    subprocess.run([sys.executable, os.path.join(HERE, "tiles.py"), tmp, out, "--quality", "84"], check=True)
    os.remove(tmp)


if __name__ == "__main__":
    main()
