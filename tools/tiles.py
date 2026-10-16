"""Cut a square map image into a WebP tile pyramid for the web map.

    python tools/tiles.py <image> maps/<id>/tiles/<layer> [--quality 82]

The image must cover the whole map with north at the top. Zoom 0 is one 256 px tile;
the deepest zoom is the first level at or above the image's own resolution.
Images over 16384 px (stitched satellite) are handled by reading them once with Pillow.
"""
import argparse, math, os

from PIL import Image

Image.MAX_IMAGE_PIXELS = None
TILE = 256


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("image")
    ap.add_argument("out")
    ap.add_argument("--quality", type=int, default=82)
    a = ap.parse_args()
    img = Image.open(a.image).convert("RGB")
    if img.width != img.height:
        raise SystemExit("image must be square")
    max_z = math.ceil(math.log2(img.width / TILE))
    count = 0
    for z in range(max_z + 1):
        n = 2 ** z
        level = img.resize((n * TILE, n * TILE), Image.LANCZOS) if n * TILE != img.width else img
        for x in range(n):
            d = os.path.join(a.out, str(z), str(x))
            os.makedirs(d, exist_ok=True)
            for y in range(n):
                level.crop((x * TILE, y * TILE, (x + 1) * TILE, (y + 1) * TILE)).save(
                    os.path.join(d, f"{y}.webp"), "WEBP", quality=a.quality, method=6)
                count += 1
    print(f"{count} tiles, zoom 0-{max_z} -> {a.out}")


if __name__ == "__main__":
    main()
