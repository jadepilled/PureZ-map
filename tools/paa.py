"""Convert DayZ .paa textures to PNG.

    python pipeline/paa.py <file.paa | folder> [--out <folder>]

Supports DXT1/DXT3/DXT5 (LZO-compressed or raw), ARGB8888, ARGB4444, ARGB1555 and AI88.
Only the largest mipmap is decoded. Needs Pillow; uses python-lzo or liblzo2 when present
and falls back to a pure-Python LZO decoder.
"""
import ctypes, ctypes.util, os, struct, sys

from PIL import Image

FORMATS = {0xFF01: "DXT1", 0xFF02: "DXT2", 0xFF03: "DXT3", 0xFF04: "DXT4", 0xFF05: "DXT5",
           0x4444: "ARGB4444", 0x1555: "ARGB1555", 0x8080: "AI88", 0x8888: "ARGB8888"}


# ---------------------------------------------------------------------------- LZO1X
def lzo1x_decompress_py(src, out_len):
    """Pure-Python LZO1X decompressor (port of lzo1x_decompress)."""
    dst = bytearray()
    ip, n = 0, len(src)

    def copy_match(m_pos, length):
        for _ in range(length):
            dst.append(dst[m_pos])
            m_pos += 1

    t = src[ip]
    state = "loop"
    if t > 17:
        ip += 1
        t -= 17
        if t < 4:
            state = "match_next"
        else:
            dst += src[ip:ip + t]
            ip += t
            state = "first_literal_run"

    while True:
        if state == "loop":
            t = src[ip]
            ip += 1
            if t >= 16:
                state = "match"
                continue
            if t == 0:
                while src[ip] == 0:
                    t += 255
                    ip += 1
                t += 15 + src[ip]
                ip += 1
            dst += src[ip:ip + t + 3]
            ip += t + 3
            state = "first_literal_run"
            continue

        if state == "first_literal_run":
            t = src[ip]
            ip += 1
            if t >= 16:
                state = "match"
                continue
            m_pos = len(dst) - (1 + 0x0800) - (t >> 2) - (src[ip] << 2)
            ip += 1
            copy_match(m_pos, 3)
            state = "match_done"
            continue

        if state == "match":
            if t >= 64:
                m_pos = len(dst) - 1 - ((t >> 2) & 7) - (src[ip] << 3)
                ip += 1
                copy_match(m_pos, (t >> 5) - 1 + 2)
            elif t >= 32:
                t &= 31
                if t == 0:
                    while src[ip] == 0:
                        t += 255
                        ip += 1
                    t += 31 + src[ip]
                    ip += 1
                m_pos = len(dst) - 1 - ((src[ip] >> 2) + (src[ip + 1] << 6))
                ip += 2
                copy_match(m_pos, t + 2)
            elif t >= 16:
                m_pos = len(dst) - ((t & 8) << 11)
                t &= 7
                if t == 0:
                    while src[ip] == 0:
                        t += 255
                        ip += 1
                    t += 7 + src[ip]
                    ip += 1
                m_pos -= (src[ip] >> 2) + (src[ip + 1] << 6)
                ip += 2
                if m_pos == len(dst):
                    break  # end of stream
                m_pos -= 0x4000
                copy_match(m_pos, t + 2)
            else:
                m_pos = len(dst) - 1 - (t >> 2) - (src[ip] << 2)
                ip += 1
                copy_match(m_pos, 2)
            state = "match_done"
            continue

        if state == "match_done":
            t = src[ip - 2] & 3
            if t == 0:
                state = "loop"
                continue
            state = "match_next"
            continue

        if state == "match_next":
            dst += src[ip:ip + t]
            ip += t
            t = src[ip]
            ip += 1
            state = "match"
            continue

    if len(dst) != out_len:
        raise ValueError(f"LZO size mismatch: {len(dst)} != {out_len}")
    return bytes(dst), ip


_native = None


def _load_native():
    global _native
    if _native is not None:
        return _native
    _native = False
    try:
        import lzo  # python-lzo
        _native = ("module", lzo)
        return _native
    except ImportError:
        pass
    for name in (ctypes.util.find_library("lzo2"), "liblzo2.so.2", "lzo2.dll", "liblzo2.dylib"):
        if not name:
            continue
        try:
            lib = ctypes.CDLL(name)
            lib.lzo1x_decompress_safe.restype = ctypes.c_int
            _native = ("ctypes", lib)
            return _native
        except OSError:
            continue
    return _native


def lzo1x_decompress(src, out_len):
    """Returns (data, bytes consumed). Consumed size is needed because PAA stores no packed size."""
    native = _load_native()
    if native and native[0] == "ctypes":
        lib = native[1]
        out = ctypes.create_string_buffer(out_len)
        out_n = ctypes.c_ulong(out_len)
        # lzo1x_decompress_safe stops at the end marker; find consumed size with the Python decoder only if needed
        rc = lib.lzo1x_decompress_safe(src, ctypes.c_ulong(len(src)), out, ctypes.byref(out_n), None)
        if rc in (0, -8) and out_n.value == out_len:  # -8: input not consumed (trailing data), fine
            return out.raw, None
    return lzo1x_decompress_py(src, out_len)


# ---------------------------------------------------------------------------- PAA
def _dxt_size(w, h, fmt):
    blocks = max(1, (w + 3) // 4) * max(1, (h + 3) // 4)
    return blocks * (8 if fmt == "DXT1" else 16)


def read_paa(path):
    with open(path, "rb") as f:
        data = f.read()
    typ = struct.unpack_from("<H", data, 0)[0]
    fmt = FORMATS.get(typ)
    if not fmt:
        raise ValueError(f"unknown PAA type 0x{typ:04X}")
    p = 2
    while data[p:p + 4] == b"GGAT":
        size = struct.unpack_from("<I", data, p + 8)[0]
        p += 12 + size
    ncol = struct.unpack_from("<H", data, p)[0]
    p += 2 + ncol * 3
    w, h = struct.unpack_from("<HH", data, p)
    p += 4
    if w == 0 or h == 0:
        raise ValueError("no mipmaps")
    compressed = bool(w & 0x8000)
    w &= 0x7FFF
    size = data[p] | data[p + 1] << 8 | data[p + 2] << 16
    p += 3
    raw = data[p:p + size]

    if fmt.startswith("DXT"):
        expected = _dxt_size(w, h, fmt)
        if compressed or size < expected:
            raw, _ = lzo1x_decompress(raw, expected)
        n = {"DXT1": 1, "DXT2": 2, "DXT3": 2, "DXT4": 3, "DXT5": 3}[fmt]
        return Image.frombytes("RGBA", (w, h), raw, "bcn", n)

    bpp = 4 if fmt == "ARGB8888" else 2
    expected = w * h * bpp
    if size < expected:
        raw = lzss_decompress(raw, expected)
    if fmt == "ARGB8888":
        return Image.frombytes("RGBA", (w, h), raw, "raw", "BGRA")
    if fmt == "ARGB4444":
        return Image.frombytes("RGBA", (w, h), raw, "raw", "BGRA;4B")
    if fmt == "ARGB1555":
        return Image.frombytes("RGBA", (w, h), raw, "raw", "BGRA;15")
    if fmt == "AI88":
        img = Image.frombytes("LA", (w, h), raw, "raw", "LA")
        return img.convert("RGBA")
    raise ValueError(fmt)


def lzss_decompress(src, out_len):
    """BI LZSS (used by non-DXT PAA mips): 8 flag bits per group, 12-bit offset / 4-bit length."""
    out = bytearray()
    ip = 0
    while len(out) < out_len and ip < len(src):
        flags = src[ip]
        ip += 1
        for bit in range(8):
            if len(out) >= out_len:
                break
            if flags & (1 << bit):
                out.append(src[ip])
                ip += 1
            else:
                a, b = src[ip], src[ip + 1]
                ip += 2
                rpos = len(out) - (a | ((b & 0xF0) << 4))
                rlen = (b & 0x0F) + 3
                for _ in range(rlen):
                    out.append(out[rpos] if rpos >= 0 else 0x20)
                    rpos += 1
    return bytes(out[:out_len])


def convert(src, dst):
    img = read_paa(src)
    os.makedirs(os.path.dirname(dst) or ".", exist_ok=True)
    img.save(dst)
    return img.size


def main():
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("--out")
    a = ap.parse_args()
    paths = [a.src] if a.src.lower().endswith(".paa") else [
        os.path.join(r, f) for r, _, fs in os.walk(a.src) for f in fs if f.lower().endswith(".paa")]
    for p in paths:
        dst = os.path.join(a.out, os.path.splitext(os.path.basename(p))[0] + ".png") if a.out else os.path.splitext(p)[0] + ".png"
        try:
            print(p, "->", dst, convert(p, dst))
        except Exception as e:
            print(p, "failed:", e, file=sys.stderr)


if __name__ == "__main__":
    main()
