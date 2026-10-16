"""Minimal TGA reader (raw and RLE, 8/24/32-bit) for CE tool layers, which Pillow cannot decode."""
import numpy as np, struct
def read_tga(path):
    d = open(path, "rb").read()
    idlen, cmtype, itype = d[0], d[1], d[2]
    w, h = struct.unpack_from("<HH", d, 12); bpp, desc = d[16], d[17]
    p = 18 + idlen
    bp = bpp // 8
    n = w * h
    if itype in (2, 3):
        arr = np.frombuffer(d, np.uint8, n * bp, p)
    else:
        out = np.empty(n * bp, np.uint8); o = 0
        while o < n * bp:
            hdr = d[p]; p += 1
            cnt = (hdr & 0x7F) + 1
            if hdr & 0x80:
                out[o:o + cnt * bp] = np.tile(np.frombuffer(d, np.uint8, bp, p), cnt); p += bp
            else:
                out[o:o + cnt * bp] = np.frombuffer(d, np.uint8, cnt * bp, p); p += cnt * bp
            o += cnt * bp
        arr = out
    img = arr.reshape(h, w, bp)[..., 0] if bp > 1 else arr.reshape(h, w)
    if not (desc & 0x20):  # bottom-left origin
        img = img[::-1]
    return img
