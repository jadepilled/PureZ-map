"""Build map data from a DayZ mission folder.

    python tools/extract.py --id nasdara --name Nasdara --mission <PureZ mission> --areaflags <areaflags.map>
                            [--cetool <CETool map folder>] [--names <wiki _site/static/names.json>]

Writes maps/<id>/data.json (loot, tiers, spawns), maps/<id>/world.json (wells, fruit trees,
berry bushes, animal territories; loaded when those layers are switched on) and overlay images.
Everything comes from the mission files the server runs: buildings and their loot
points (mapgrouppos/mapgroupproto), loot rules (types.xml, cfglimitsdefinition),
tier and usage areas (areaflags.map), events, infected areas, gas zones and spawns.
"""
import argparse, json, math, os, re, struct, sys
import xml.etree.ElementTree as ET

import cv2
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
    ("watertruck", "Water trucks", r"^StaticWaterTruck"),
    ("containers", "Locked containers", r"^StaticContainerLocked"),
    ("crates", "Airdrop crates", r"^StaticAirplaneCrate"),
    ("trains", "Train wrecks", r"^StaticTrain"),
    ("supplies", "Planks and bricks", r"^Item(Planks|Bricks)"),
    ("gasevent", "Random gas zones", r"^StaticContaminatedArea"),
]
# Building loot type for colouring: the first matching usage wins, so a barn that is Farm and Industrial reads as Farm
LOOT_TYPES = [
    ("military", "Military", ["Military", "MilitaryEast", "MilitaryWest"]),
    ("police", "Police", ["Police", "Prison"]),
    ("medic", "Medical", ["Medic"]),
    ("fire", "Firefighter", ["Firefighter"]),
    ("hunting", "Hunting", ["Hunting"]),
    ("farm", "Farm", ["Farm"]),
    ("coast", "Coast", ["Coast"]),
    ("town", "Town", ["Town", "Office", "School", "Lunapark"]),
    ("industrial", "Industrial", ["Industrial"]),
    ("village", "Village", ["Village"]),
    ("other", "Other", []),
]
FRUIT = re.compile(r"^(Apple|Pear|Plum|Fig|Cherry|Peach)Tree")
BERRIES = re.compile(r"^(Sambucus|Canina)Bush")
# species label (singular) and map symbol, by territory name
ANIMALS = {"Cow": ("Cow", "cow"), "WildBoar": ("Wild boar", "boar"), "Sheep": ("Sheep", "sheep"), "Goat": ("Goat", "goat"),
           "Mouflon": ("Mouflon", "mouflon"), "Dog": ("Dog", "dog"), "Hen": ("Chicken", "chicken"), "Hare": ("Hare", "hare"),
           "Fox": ("Fox", "fox"), "Wolf": ("Wolf", "wolf"), "Bear": ("Bear", "bear"), "Deer": ("Red deer", "reddeer"),
           "RedDeer": ("Red deer", "reddeer"), "RoeDeer": ("Roe deer", "roedeer"), "Pig": ("Pig", "pig"),
           "Monitor": ("Monitor lizard", "lizard"), "Lizard": ("Lizard", "lizard")}
WATER = [("Well pump", re.compile(r"(?i)well_?pump|^Land_.*_Well\b|Land_Well")), ("Water station", re.compile(r"(?i)^Land_Water_Station"))]
ABBREV = {"Bttstck": "Buttstock", "Hndgrd": "Handguard"}


def xml(path):
    return ET.parse(path).getroot() if os.path.exists(path) else None


def humanize(cls):
    """Class name to words without breaking model codes: M4A1 stays M4A1, BoonieHat -> Boonie Hat."""
    s = re.sub(r"^Land_", "", cls)
    s = re.sub(r"_(?=[A-Z0-9])", " ", s)
    s = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", s)
    s = re.sub(r"(?<=[A-Z])(?=[A-Z][a-z])", " ", s)
    s = re.sub(r"(?<=[a-z]{2})(?=\d)", " ", s)
    s = s.replace("_", " ")
    for a, b in ABBREV.items():
        s = re.sub(rf"\b{a}\b", b, s)
    return re.sub(r"\s+", " ", s).strip()


def sentence(t):
    """Sentence case that keeps acronyms and model codes: 'Barbed Wire' -> 'Barbed wire', 'M4A1' stays."""
    words = t.split(" ")
    return " ".join(w if i == 0 or not re.fullmatch(r"[A-Z][a-z]+", w) else w.lower() for i, w in enumerate(words))


BUILDING_WORDS = {"Mil": "Military", "Misc": "", "Static": "", "Obj": "", "aban": "", "Aban": "", "hb": "Hatchback",
                  "sed": "Sedan", "Ind": "Industrial", "DE": "", "TK": "", "Takistan": "", "Enoch": ""}


def building_name(cls):
    words = humanize(re.sub(r"^(Land_|StaticObj_)", "", cls)).split(" ")
    words = [BUILDING_WORDS.get(w, w) for w in words]
    s = " ".join(w for w in words if w)
    s = re.sub(r"\bDam \d\b", "(damaged)", s)
    s = s[:1].upper() + s[1:]
    return sentence(re.sub(r"\s+", " ", s).strip())


COLOUR = re.compile(r"(?i)(black|white|blue|green|red|yellow|orange|brown|gr[ae]y|beige|pink|violet|purple|olive|khaki|tan|"
                    r"camo|desert|winter|woodland|autumn|summer|spring|navy|navyblue|lightblue|darkblue|lime|wine|"
                    r"flecktarn|flecktran|dubok|dpm|bdu|un|ttsko|ion|cmmg_\w+|\w*pattern|\w*checks?|stripes|"
                    r"darkbrown|darkgreen|lightgreen|cream|natural|gold|chernarus|livonia|bluebright|skyblue|"
                    r"flowers|polka|blackskull|skull|pig|chain|scarred|yellowscarred)")


def group_variants(items, names):
    """One entry per item family: colour variants (Hoodie_Blue, Hoodie_Red...) share an entry, and each
    entry keeps every distinct loot rule [usage, tier, category, tag] its members spawn by."""
    fams = {}
    for it in items:
        base, _, suffix = it["c"].rpartition("_")
        if not base or not COLOUR.fullmatch(suffix):
            base = it["c"]
        fams.setdefault(base, []).append(it)
    out = []
    for base, group in fams.items():
        first = group[0]
        rules = []
        for g in group:
            r = [g["u"], g["v"], g["k"], g["t"]]
            if r not in rules:
                rules.append(r)
        e = {"c": base if len(group) > 1 else first["c"], "n": first["n"], "q": sum(g["q"] for g in group), "r": rules}
        if len(group) > 1:
            e["n"] = names.get(base) or names.get(first["c"]) or sentence(humanize(base))
            e["vars"] = [[g["c"], humanize(g["c"][len(base) + 1:]) or g["c"]] for g in group]
        out.append(e)
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


def loot_type(mask_, usages):
    names = {u for i, u in enumerate(usages) if mask_ >> i & 1}
    for k, (_, _, us) in enumerate(LOOT_TYPES):
        if names & set(us):
            return k
    return len(LOOT_TYPES) - 1


def tier_shapes(af, min_cells=40):
    """Outline each loot tier area as polygons (metres), plus a label point inside each larger area.

    Returns ({tier: [[ring, hole, ...], ...]}, [[tier, x, z, area_m2], ...]) and writes nothing."""
    v = af["value"]
    cell = af["size"] / af["w"]
    tier = np.zeros(v.shape, np.uint8)
    for bit, t in ((1, 1), (2, 2), (4, 3), (8, 4)):
        tier[(v & bit) > 0] = t
    kernel = np.ones((3, 3), np.uint8)
    shapes, labels = {}, []
    for t in (1, 2, 3, 4):
        m = (tier == t).astype(np.uint8)
        m = cv2.morphologyEx(cv2.morphologyEx(m, cv2.MORPH_CLOSE, kernel), cv2.MORPH_OPEN, kernel)
        contours, hier = cv2.findContours(m, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_SIMPLE)
        if hier is None:
            continue
        hier = hier[0]
        polys = []
        def to_m(c):
            pts = cv2.approxPolyDP(c, 2.0, True).reshape(-1, 2).astype(np.float32)
            for _ in range(2):                                  # Chaikin corner cutting: rounds the pixel staircase
                nxt = np.roll(pts, -1, axis=0)
                pts = np.concatenate([pts * 0.75 + nxt * 0.25, pts * 0.25 + nxt * 0.75], axis=1).reshape(-1, 2)
            pts = cv2.approxPolyDP(pts.reshape(-1, 1, 2), 0.5, True).reshape(-1, 2)
            return [[round(float(x + 0.5) * cell, 1), round(float(y + 0.5) * cell, 1)] for x, y in pts]
        for i, c in enumerate(contours):
            if hier[i][3] != -1 or cv2.contourArea(c) < min_cells:
                continue
            rings = [to_m(c)]
            j = hier[i][2]
            while j != -1:
                if cv2.contourArea(contours[j]) >= min_cells:
                    rings.append(to_m(contours[j]))
                j = hier[j][0]
            if len(rings[0]) >= 3:
                polys.append(rings)
            # label at the point furthest from the edge
            x0, y0, w, h = cv2.boundingRect(c)
            sub = np.zeros((h + 2, w + 2), np.uint8)
            cv2.drawContours(sub, [c - [x0 - 1, y0 - 1]], -1, 1, -1)
            sub &= np.pad(m[y0:y0 + h, x0:x0 + w], 1)
            dist = cv2.distanceTransform(sub, cv2.DIST_L2, 3)
            _, dmax, _, (px, py) = cv2.minMaxLoc(dist)
            if dmax * cell >= 25:
                labels.append([t, round((x0 - 1 + px + 0.5) * cell), round((y0 - 1 + py + 0.5) * cell), round(dmax * cell)])
        shapes[t] = polys
    return shapes, labels


def tier_grid(af, out, px=1024):
    """Greyscale lookup image (tier x 60) so the map can show the tier under the cursor."""
    v = af["value"][::-1]
    tier = np.zeros(v.shape, np.uint8)
    for bit, t in ((1, 1), (2, 2), (4, 3), (8, 4)):
        tier[(v & bit) > 0] = t
    Image.fromarray(tier * 60, "L").resize((px, px), Image.NEAREST).save(out, optimize=True)


CYR = {"а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "e", "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k",
       "л": "l", "м": "m", "н": "n", "о": "o", "п": "p", "р": "r", "с": "s", "т": "t", "у": "u", "ф": "f", "х": "kh", "ц": "ts",
       "ч": "ch", "ш": "sh", "щ": "shch", "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya"}
PLACE_FIX = {"Нижнее": "Nizhnoye", "Солнечный": "Solnichniy", "Электрозаводск": "Elektrozavodsk", "Черногорск": "Chernogorsk",
             "Зеленогорск": "Zelenogorsk", "Северогорск": "Severograd", "Старое": "Staroye", "Новое": "Novoye", "Тисы": "Tisy"}


def latin(name):
    if name in PLACE_FIX:
        return PLACE_FIX[name]
    if not re.search("[\u0400-\u04FF]", name):
        return name
    out = []
    for i, ch in enumerate(name):
        low = ch.lower()
        if low == "е" and (i == 0 or name[i - 1].lower() in "аеёиоуыэюяь"):
            t = "ye"
        elif low == "ы" and i and name[i - 1].lower() == "ы":
            t = ""
        else:
            t = CYR.get(low, ch)
        out.append(t.capitalize() if ch.isupper() else t)
    s = "".join(out)
    s = re.sub(r"yy\b", "y", s)         # Старый -> Stary
    s = re.sub(r"iy\b", "y", s)         # Новый -> Novy
    return s


def hull(points):
    """Convex hull (monotone chain) of [x, z] points."""
    pts = sorted(set(map(tuple, points)))
    if len(pts) < 3:
        return [list(p) for p in pts]
    cross = lambda o, a, b: (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return [list(p) for p in lower[:-1] + upper[:-1]]


def territories(m):
    """Animal territories from cfgenvironment.xml. A herd (deer, boar, wolves...) spawns in one of its
    territory's zones and roams between them (graze, rest, water), so each zone becomes a circle of its
    real radius, grouped per territory. Ambient life (hares, hens, foxes) is spawned around the player
    near its zones, so those stay as points."""
    env = xml(os.path.join(m, "cfgenvironment.xml"))
    if env is None:
        return []
    files = {os.path.splitext(os.path.basename(f.get("path")))[0] for f in env.iter("file") if f.get("path")}
    out = []
    for t in env.iter("territory"):
        name = t.get("name")
        if not name or "zombie" in name.lower() or "infected" in name.lower():
            continue
        herd = (t.get("type") or "").lower() == "herd"
        areas, pts = [], []
        for f in t.findall("file"):
            u = f.get("usable")
            root = xml(os.path.join(m, "env", f"{u}.xml")) if u in files else None
            if root is None:
                continue
            for terr in root.iter("territory"):
                zones = [(float(z.get("x")), float(z.get("z")), float(z.get("r")), (z.get("name") or "").lower()) for z in terr.iter("zone")]
                if not zones:
                    continue
                if herd:
                    areas.append([[round(x), round(z), round(r), ZONE_KIND.get(k, 0)] for x, z, r, k in zones])
                else:
                    pts += [[round(x), round(z)] for x, z, _, _ in zones]
        if areas or pts:
            key = re.sub(r"^Ambient", "", name)
            label, ic = ANIMALS.get(key, (humanize(key), "paw"))
            prev = next((o for o in out if o["n"] == label), None)
            if prev:
                prev["areas"] += areas; prev["pts"] += pts
            else:
                out.append({"n": label, "i": ic, "c": name, "herd": herd, "areas": areas, "pts": pts})
    return out


ZONE_KIND = {"graze": 0, "huntingground": 0, "rest": 1, "water": 2}   # zone kinds, index into app's ZONE_NAMES


def layer_label(lid, label, events):
    """Name the supplies layer after what this map actually spawns (Chernarus: planks only; Nasdara: bricks only)."""
    if lid == "supplies":
        have = {e["cls"] for e in events}
        if have == {"ItemPlanks"}:
            return "Planks"
        if have == {"ItemBricks"}:
            return "Bricks"
    return label


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
    os.makedirs(out, exist_ok=True)
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
        groups.append({"n": building_name(g.get("name")), "cls": g.get("name"), "u": mask([x.get("name") for x in g.findall("usage")], lim["usages"]),
                       "v": mask([x.get("name") for x in g.findall("value")], lim["values"]), "c": conts})
    bx, bz, bg, bt, bu, ba, bl = [], [], [], [], [], [], []
    wells = []
    for b in xml(os.path.join(m, "mapgrouppos.xml")).findall("group"):
        wk = next((i for i, (_, rx) in enumerate(WATER) if rx.search(b.get("name"))), None)
        if wk is not None:
            x, _y, z = (float(v) for v in b.get("pos").split())
            wells.append([round(x), round(z), wk])
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
        bl.append(loot_type(groups[gi]["u"] or bu[-1], lim["usages"]))

    # ---- items that spawn in buildings
    items = []
    for t in xml(os.path.join(m, "db/types.xml")).findall("type"):
        nom = int(t.findtext("nominal") or 0)
        usage = [u.get("name") for u in t.findall("usage")]
        cat = t.find("category")
        if nom <= 0 or not usage or cat is None or cat.get("name") not in lim["categories"]:
            continue
        cls = t.get("name")
        items.append({"c": cls, "n": names.get(cls) or sentence(humanize(cls)), "u": mask(usage, lim["usages"]),
                      "v": mask([v.get("name") for v in t.findall("value")], lim["values"]),
                      "k": lim["categories"].index(cat.get("name")),
                      "t": mask([v.get("name") for v in t.findall("tag")], lim["tags"]), "q": nom})
    items = group_variants(items, names)
    items.sort(key=lambda i: i["n"].lower())

    # ---- events (only those active on this server)
    ev_cfg = {e.get("name"): e for e in xml(os.path.join(m, "db/events.xml")).findall("event")}
    spawns = xml(os.path.join(m, "cfgeventspawns.xml"))
    layers = {}
    for e in spawns.findall("event"):
        name = e.get("name")
        cfg = ev_cfg.get(name)
        lid = next((l for l, _, rx in EVENT_LAYERS if re.search(rx, name)), None)
        if cfg is None or cfg.findtext("active") != "1" or not lid:
            continue
        nominal = int(cfg.findtext("nominal") or 0)
        if nominal <= 0 and lid != "gasevent":  # dynamic gas runs on min/max with a nominal of 0
            continue
        pos = [[round(float(p.get("x"))), round(float(p.get("z")))] for p in e.findall("pos")]
        if not pos:
            continue
        label = VEHICLE_NAMES.get(name, humanize(name.replace("Vehicle", ""))) if lid == "vehicles" else None
        kids = sorted({c.get("type") for c in cfg.iter("child") if c.get("type")})
        ev = {"type": label, "cls": name, "count": nominal or int(cfg.findtext("max") or 0), "kids": kids, "p": pos}
        zone = e.find("zone")
        if lid == "gasevent" and zone is not None:
            ev["r"] = round(float(zone.get("r", 75)))
        layers.setdefault(lid, []).append(ev)

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
                    gas.append([round(x), round(z), round(ar["Data"].get("Radius", 50)), ar.get("AreaName", "")])
            break
    pspawn = xml(os.path.join(m, "cfgplayerspawnpoints.xml"))
    fresh = [[round(float(p.get("x"))), round(float(p.get("z")))] for p in pspawn.find("fresh").iter("pos")] if pspawn is not None else []

    # ---- overlays
    shapes, tier_labels = tier_shapes(af)
    tier_grid(af, os.path.join(out, "tiergrid.png"))
    if os.path.exists(os.path.join(out, "tiers.png")):
        os.remove(os.path.join(out, "tiers.png"))
    water = None
    if a.cetool and os.path.exists(os.path.join(a.cetool, "layers", "water-sea.tga")):
        sea = read_tga(os.path.join(a.cetool, "layers", "water-sea.tga")) > 0
        img = Image.fromarray(np.where(sea, 255, 0).astype(np.uint8), "L").resize((2048, 2048), Image.BILINEAR)
        img.save(os.path.join(out, "water.png"), optimize=True)
        water = "water.png"

    # ---- world layers: wells, fruit trees and berry bushes (cluster files), animal territories
    fruit, berries = [], []
    kinds = []
    for fn in sorted(os.listdir(m)):
        if not re.match(r"mapgroupcluster\d*\.xml$", fn):
            continue
        for g in ET.parse(os.path.join(m, fn)).getroot().iter("group"):
            n = g.get("name") or ""
            f, b = FRUIT.match(n), BERRIES.match(n)
            if not (f or b):
                continue
            k = (f or b).group(1)
            if k not in kinds:
                kinds.append(k)
            x, _y, z = (float(v) for v in g.get("pos").split())
            (fruit if f else berries).append([round(x), round(z), kinds.index(k)])
    animals = territories(m)
    flat = lambda pts: [v for p in pts for v in p]
    world = {"wells": flat(wells), "waterKinds": [k for k, _ in WATER], "fruit": flat(fruit), "berries": flat(berries), "kinds": kinds,
             "animals": animals}
    with open(os.path.join(out, "world.json"), "w", encoding="utf-8") as f:
        json.dump(world, f, separators=(",", ":"))

    places = []
    if a.configs and a.world:
        with open(a.configs, encoding="utf-8") as f:
            allp = json.load(f).get("places", {})
        world = next((v for k, v in allp.items() if k.lower() == a.world.lower()), [])
        rank = {"NameCityCapital": 0, "Capital": 0, "NameCity": 1, "City": 1, "NameVillage": 2, "Village": 2, "Airport": 2,
                "NameLocal": 3, "Local": 3, "NameMarine": 3, "Marine": 3, "Camp": 3, "Ruin": 3}
        places = [[latin(p["n"]), rank[p["t"]], p["x"], p["z"]] for p in world if p["t"] in rank]

    data = {
        "id": a.id, "places": places, "name": a.name, "size": size, "limits": lim,
        "groups": groups, "buildings": {"x": bx, "z": bz, "g": bg, "t": bt, "u": bu, "a": ba, "l": bl},
        "lootTypes": [[k, label] for k, label, _ in LOOT_TYPES],
        "tiers": shapes, "tierLabels": tier_labels,
        "world": {"wells": len(wells), "fruit": len(fruit), "berries": len(berries),
                  "animals": [[a["n"], len(a["areas"]) or len(a["pts"]), a["i"]] for a in animals]},
        "items": items, "events": layers, "eventLayers": [[l, layer_label(l, label, layers[l])] for l, label, _ in EVENT_LAYERS if l in layers],
        "zoneTypes": ztypes, "zones": zones, "gas": gas, "spawns": fresh,
        "overlays": {"tiergrid": "tiergrid.png", "water": water},
    }
    with open(os.path.join(out, "data.json"), "w", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"))
    print(f"{a.id}: {len(bx)} buildings, {len(groups)} building types, {len(items)} items,",
          {k: sum(len(e['p']) for e in v) for k, v in layers.items()}, f"{len(zones)} infected areas, {len(gas)} gas zones,",
          f"{len(fresh)} spawns, {len(wells)} wells, {len(fruit)} fruit trees, {len(berries)} bushes,",
          f"animals {[(a['n'], len(a['areas']) or len(a['pts'])) for a in animals]}, tier polygons {[(t, len(p)) for t, p in shapes.items()]}, {len(tier_labels)} tier labels")


if __name__ == "__main__":
    main()
