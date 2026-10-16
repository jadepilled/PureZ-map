"""Build map data from a DayZ mission folder.

    python tools/extract.py --id nasdara --name Nasdara --mission <PureZ mission> --areaflags <areaflags.map>
                            [--cetool <CETool map folder>] [--names <names.json>]

Writes maps/<id>/data.json plus overlay images (loot tiers, usage areas, water).
Everything comes from the mission files the server runs: buildings and their loot
points (mapgrouppos/mapgroupproto), loot rules (types.xml, cfglimitsdefinition),
tier and usage areas (areaflags.map), events, infected areas, gas zones and spawns.
"""
import argparse, json, os, re, struct, sys
import xml.etree.ElementTree as ET

import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(os.path.dirname(HERE), "maps")
sys.path.insert(0, HERE)
from tga import read_tga  # noqa: E402

VEHICLE_NAMES = {"VehicleCivilianSedan": "Olga 24", "VehicleHatchback02": "Gunter 2", "VehicleSedan02": "Sarka 120",
                 "VehicleOffroadHatchback": "Ada 4x4", "VehicleOffroad02": "M1025", "VehicleTruck01": "M3S",
                 "VehicleMotorbike": "Motorbike", "VehicleBoat": "Boat"}
EVENT_LAYERS = [  # (layer id, label, event name pattern)
    ("vehicles", "Vehicles", r"^Vehicle"),
    ("helicrash", "Heli crashes", r"^StaticHeliCrash"),
    ("convoy", "Military convoys", r"^StaticMilitaryConvoy"),
    ("police", "Police wrecks", r"^StaticPolice"),
    ("containers", "Locked containers", r"^StaticContainerLocked"),
    ("trains", "Train wrecks", r"^StaticTrain"),
]
TIER_ALPHA = [0, 0.10, 0.22, 0.36, 0.52]  # by highest tier bit; red ramp
ABBREV = {"Bttstck": "Buttstock", "Hndgrd": "Handguard", "Rnd": " rnd", "Mag": "Magazine"}


def xml(path):
    return ET.parse(path).getroot() if os.path.exists(path) else None


def humanize(cls):
    s = re.sub(r"^Land_", "", cls)
    s = re.sub(r"_(?=[A-Z0-9])", " ", s)
    s = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", s)
    s = re.sub(r"(?<=[A-Za-z])(?=\d)", " ", s)
    s = s.replace("_", " ")
    for a, b in ABBREV.items():
        s = re.sub(rf"\b{a}\b", b, s)
    return re.sub(r"\s+", " ", s).strip()


COLOUR = re.compile(r"(?i)(black|white|blue|green|red|yellow|orange|brown|gr[ae]y|beige|pink|violet|purple|olive|khaki|tan|"
                    r"camo|desert|winter|woodland|autumn|summer|spring|navy|navyblue|lightblue|darkblue|lime|wine|"
                    r"flecktarn|flecktran|dubok|dpm|bdu|un|ttsko|ion|cmmg_\w+|\w*pattern|\w*checks?|stripes|"
                    r"darkbrown|darkgreen|lightgreen|cream|natural|gold|chernarus|livonia|bluebright|skyblue|"
                    r"flowers|polka|blackskull|skull|pig|chain|scarred|yellowscarred)")


def group_variants(items):
    """Merge colour variants (Hoodie_Blue, Hoodie_Red...) that follow identical loot rules into one entry."""
    fams = {}
    for it in items:
        base, _, suffix = it["c"].rpartition("_")
        if not base or not COLOUR.fullmatch(suffix):
            base = it["c"]
        fams.setdefault((base, it["u"], it["v"], it["k"], it["t"]), []).append(it)
    out = []
    for (base, *_), group in fams.items():
        if len(group) == 1:
            out.append(group[0])
            continue
        first = group[0]
        name = humanize(base)
        out.append({**first, "c": base, "n": name, "q": sum(g["q"] for g in group),
                    "vars": [[g["c"], g["n"].replace(name, "").strip() or g["c"]] for g in group]})
    return out


def limits(mission):
    root = xml(os.path.join(mission, "cfglimitsdefinition.xml"))
    names = lambda sec, tag: [e.get("name") for e in root.find(sec).findall(tag)]
    return {"categories": names("categories", "category"), "tags": names("tags", "tag"),
            "usages": names("usageflags", "usage"), "values": names("valueflags", "value")}


def mask(names, order):
    m = 0
    for n in names:
        if n in order:
            m |= 1 << order.index(n)
    return m


def read_areaflags(path):
    with open(path, "rb") as f:
        w, h, sx, sz, _bits, _ = struct.unpack("<6I", f.read(24))
        raw = np.frombuffer(f.read(), dtype=np.uint8)
    n = w * h
    usage = raw[:n * 4].view("<u4").reshape(h, w)   # row 0 is the south edge
    value = raw[n * 4:n * 5].reshape(h, w)
    return {"w": w, "h": h, "size": sx, "usage": usage, "value": value}


def overlay_tiers(af, out, px=2048):
    v = af["value"][::-1]  # north at the top
    tier = np.zeros(v.shape, np.uint8)
    for bit, t in ((1, 1), (2, 2), (4, 3), (8, 4)):
        tier[(v & bit) > 0] = t
    alpha = (np.array(TIER_ALPHA)[tier] * 255).astype(np.uint8)
    rgba = np.zeros(v.shape + (4,), np.uint8)
    rgba[..., 0], rgba[..., 1], rgba[..., 2], rgba[..., 3] = 209, 26, 26, alpha
    Image.fromarray(rgba, "RGBA").resize((px, px), Image.NEAREST).save(out, optimize=True)


def overlay_usage(af, bit, out, px=1024):
    m = ((af["usage"][::-1] >> bit) & 1).astype(np.uint8) * 255
    img = Image.fromarray(m, "L").resize((px, px), Image.NEAREST)
    if not img.getbbox():
        return False
    rgba = Image.new("RGBA", img.size, (255, 255, 255, 0))
    rgba.putalpha(img.point(lambda a: 120 if a else 0))
    rgba.save(out, optimize=True)
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--id", required=True)
    ap.add_argument("--name", required=True)
    ap.add_argument("--mission", required=True)
    ap.add_argument("--areaflags", required=True)
    ap.add_argument("--cetool", help="CE tool folder with map.png and layers/ (optional)")
    ap.add_argument("--names", help="JSON {class: display name} (e.g. from the wiki)")
    ap.add_argument("--configs", help="wiki data/configs.json, for place names")
    ap.add_argument("--world", help="CfgWorlds class name, e.g. ChernarusPlus")
    a = ap.parse_args()
    out = os.path.join(OUT, a.id)
    os.makedirs(os.path.join(out, "usage"), exist_ok=True)
    m = a.mission
    lim = limits(m)
    af = read_areaflags(a.areaflags)
    size = af["size"]
    cell = size / af["w"]
    names = json.load(open(a.names)) if a.names else {}

    # ---- buildings and their loot containers
    proto = xml(os.path.join(m, "mapgroupproto.xml"))
    groups, gindex = [], {}
    for g in proto.findall("group"):
        conts = []
        for c in g.findall("container"):
            pts = len(c.findall("point"))
            if not pts:
                continue
            conts.append([mask([x.get("name") for x in c.findall("category")], lim["categories"]),
                          mask([x.get("name") for x in c.findall("tag")], lim["tags"]), pts])
        if not conts:
            continue
        gindex[g.get("name")] = len(groups)
        groups.append({"n": humanize(g.get("name")), "u": mask([x.get("name") for x in g.findall("usage")], lim["usages"]),
                       "v": mask([x.get("name") for x in g.findall("value")], lim["values"]), "c": conts})
    bx, bz, bg, bt, bu, ba = [], [], [], [], [], []
    for b in xml(os.path.join(m, "mapgrouppos.xml")).findall("group"):
        gi = gindex.get(b.get("name"))
        if gi is None:
            continue
        x, _y, z = (float(v) for v in b.get("pos").split())
        col, row = min(int(x / cell), af["w"] - 1), min(int(z / cell), af["h"] - 1)
        if col < 0 or row < 0:
            continue
        bx.append(round(x)), bz.append(round(z)), bg.append(gi)
        bt.append(int(af["value"][row, col])), bu.append(int(af["usage"][row, col]))
        ba.append(round(float(b.get("a", 0))))

    # ---- items that spawn in buildings
    items = []
    for t in xml(os.path.join(m, "db/types.xml")).findall("type"):
        nom = int(t.findtext("nominal") or 0)
        usage = [u.get("name") for u in t.findall("usage")]
        cat = t.find("category")
        if nom <= 0 or not usage or cat is None or cat.get("name") not in lim["categories"]:
            continue
        cls = t.get("name")
        items.append({"c": cls, "n": names.get(cls) or humanize(cls), "u": mask(usage, lim["usages"]),
                      "v": mask([v.get("name") for v in t.findall("value")], lim["values"]),
                      "k": lim["categories"].index(cat.get("name")),
                      "t": mask([v.get("name") for v in t.findall("tag")], lim["tags"]), "q": nom})
    items = group_variants(items)
    items.sort(key=lambda i: i["n"].lower())

    # ---- events (only those active on this server)
    ev_cfg = {e.get("name"): e for e in xml(os.path.join(m, "db/events.xml")).findall("event")}
    spawns = xml(os.path.join(m, "cfgeventspawns.xml"))
    layers = {}
    for e in spawns.findall("event"):
        name = e.get("name")
        cfg = ev_cfg.get(name)
        if cfg is None or cfg.findtext("active") != "1" or int(cfg.findtext("nominal") or 0) <= 0:
            continue
        lid = next((l for l, _, rx in EVENT_LAYERS if re.search(rx, name)), None)
        pos = [[round(float(p.get("x"))), round(float(p.get("z")))] for p in e.findall("pos")]
        if not lid or not pos:
            continue
        label = VEHICLE_NAMES.get(name, humanize(name.replace("Vehicle", ""))) if lid == "vehicles" else None
        layers.setdefault(lid, []).append({"type": label, "count": int(cfg.findtext("nominal")), "p": pos})

    # ---- infected areas
    zt = xml(os.path.join(m, "env/zombie_territories.xml"))
    ztypes, zones = [], []
    for z in zt.iter("zone"):
        n = z.get("name").replace("Infedcted", "Infected")
        label = humanize(n.replace("Infected", "")) or "Generic"
        if label not in ztypes:
            ztypes.append(label)
        if int(z.get("dmax", 0)) > 0:
            zones.append([round(float(z.get("x"))), round(float(z.get("z"))), round(float(z.get("r"))),
                          ztypes.index(label), int(z.get("dmin", 0)), int(z.get("dmax", 0))])

    # ---- gas and player spawns
    gas = []
    for fn in ("cfgeffectarea.json", "cfgEffectArea.json"):
        p = os.path.join(m, fn)
        if os.path.exists(p):
            for ar in json.load(open(p)).get("Areas", []):
                if "Contaminated" in ar.get("Type", "") and ar.get("Data", {}).get("Pos"):
                    x, _, z = ar["Data"]["Pos"]
                    gas.append([round(x), round(z), round(ar["Data"].get("Radius", 50))])
            break
    pspawn = xml(os.path.join(m, "cfgplayerspawnpoints.xml"))
    fresh = [[round(float(p.get("x"))), round(float(p.get("z")))] for p in pspawn.find("fresh").iter("pos")] if pspawn is not None else []

    # ---- overlays
    overlay_tiers(af, os.path.join(out, "tiers.png"))
    usage_layers = [u for i, u in enumerate(lim["usages"]) if overlay_usage(af, i, os.path.join(out, "usage", f"{u}.png"))]
    water = None
    if a.cetool and os.path.exists(os.path.join(a.cetool, "layers", "water-sea.tga")):
        sea = read_tga(os.path.join(a.cetool, "layers", "water-sea.tga")) > 0
        img = Image.fromarray(np.where(sea, 255, 0).astype(np.uint8), "L").resize((2048, 2048), Image.BILINEAR)
        img.save(os.path.join(out, "water.png"), optimize=True)
        water = "water.png"

    places = []
    if a.configs and a.world:
        with open(a.configs, encoding="utf-8") as f:
            allp = json.load(f).get("places", {})
        world = next((v for k, v in allp.items() if k.lower() == a.world.lower()), [])
        rank = {"NameCityCapital": 0, "NameCity": 1, "NameVillage": 2, "Airport": 2, "NameLocal": 3, "NameMarine": 3, "Hill": 4}
        places = [[p["n"], rank.get(p["t"], 3), p["x"], p["z"]] for p in world if p["t"] in rank and p["t"] != "Hill"]

    data = {
        "id": a.id, "places": places, "name": a.name, "size": size, "limits": lim,
        "groups": groups, "buildings": {"x": bx, "z": bz, "g": bg, "t": bt, "u": bu, "a": ba},
        "items": items, "events": layers, "eventLayers": [[l, label] for l, label, _ in EVENT_LAYERS if l in layers],
        "zoneTypes": ztypes, "zones": zones, "gas": gas, "spawns": fresh,
        "overlays": {"tiers": "tiers.png", "usage": usage_layers, "water": water},
    }
    with open(os.path.join(out, "data.json"), "w", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"))
    print(f"{a.id}: {len(bx)} buildings, {len(groups)} building types, {len(items)} items,",
          {k: sum(len(e['p']) for e in v) for k, v in layers.items()}, f"{len(zones)} infected areas, {len(gas)} gas zones,",
          f"{len(fresh)} spawns, usage overlays {usage_layers}")


if __name__ == "__main__":
    main()
