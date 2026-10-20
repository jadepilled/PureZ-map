// PureZ Map. Data: maps/<id>/data.json and world.json, built from the server's mission files by tools/extract.py.
(() => {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const fmt = (n) => Math.round(n).toLocaleString("en-US");
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const ICONS = window.PZ_ICONS;
  const icon = (name, cls = "ic") => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[name]}"/></svg>`;
  const path2d = {};
  const iconPath = (name) => path2d[name] || (path2d[name] = new Path2D(ICONS[name]));

  const TIERS = ["Tier1", "Tier2", "Tier3", "Tier4", "Unique"];
  const TIER_LABEL = { Tier1: "Tier 1", Tier2: "Tier 2", Tier3: "Tier 3", Tier4: "Tier 4", Unique: "Unique" };
  const HIT = "#ff4545";

  // Building loot types. Hues follow the validated categorical order; town and village stay neutral.
  const LOOT_COLOR = { police: "#3987e5", fire: "#d95926", farm: "#199e70", industrial: "#c98500", medic: "#d55181",
                       hunting: "#008300", coast: "#9085e9", military: "#e66767", town: "#d2d2d2", village: "#858585", other: "#555" };

  // Tier areas: tier 1 is the background; 2-4 each get their own hue, a light tint and a thin outline
  const TIER_STYLE = {
    2: { color: "#4ea1ff", fill: 0.16 },
    3: { color: "#f2b134", fill: 0.2 },
    4: { color: "#ff4d4d", fill: 0.26 },
  };
  const TIER_DEFAULTS = { 2: "#4ea1ff", 3: "#f2b134", 4: "#ff4d4d" };
  const loadTierColors = () => { try { const c = JSON.parse(localStorage.getItem("pz-tier-colors") || "{}"); for (const t of [2, 3, 4]) TIER_STYLE[t].color = c[t] || TIER_DEFAULTS[t]; } catch { /* private mode */ } };
  const saveTierColors = () => { try { localStorage.setItem("pz-tier-colors", JSON.stringify({ 2: TIER_STYLE[2].color, 3: TIER_STYLE[3].color, 4: TIER_STYLE[4].color })); } catch { /* private mode */ } };
  loadTierColors();

  // Point layers. Shape is used at overview zoom, the icon badge from `badge` zoom on.
  const VEHICLE_ICON = { VehicleTruck01: "truck", VehicleMotorbike: "motorbike", VehicleBoat: "sailboat",
                         VehicleOffroadHatchback: "car-suv", VehicleOffroad02: "car-suv" };
  const POINTS = {
    vehicles: { icon: "car", shape: "diamond", tone: "#f2f2f2", badge: 3 },
    helicrash: { icon: "helicopter", shape: "triangle", tone: "#f2f2f2", badge: 3 },
    convoy: { icon: "tank", shape: "square", tone: "#f2f2f2", badge: 3 },
    police: { icon: "urgent", shape: "circle", tone: "#f2f2f2", badge: 3 },
    watertruck: { icon: "truck", shape: "circle", tone: "#f2f2f2", badge: 3 },
    containers: { icon: "lock", shape: "square", tone: "#f2f2f2", badge: 3 },
    crates: { icon: "parachute", shape: "triangle", tone: "#f2f2f2", badge: 3 },
    trains: { icon: "train", shape: "square", tone: "#f2f2f2", badge: 3 },
    supplies: { icon: "stack-2", shape: "circle", tone: "#bdbdbd", badge: 4 },
    spawns: { icon: "user", shape: "circle", tone: "#f2f2f2", badge: 3 },
    wells: { icon: "droplet", shape: "circle", tone: "#4ea1ff", badge: 3 },
    animalPts: { shape: "circle", tone: "#d8b36a", badge: 4.5 },
    animalHerds: { shape: "circle", tone: "#d8b36a", badge: 2.5 },
    fruit: { icon: "apple", shape: "dot", tone: "#7cc464", badge: 7 },
    berries: { icon: "cherry", shape: "dot", tone: "#b48ae6", badge: 7 },
  };
  const AREAS = {
    infected: { color: "#e66767", icon: "skull", width: 1, alpha: 0.55, fill: 0.05 },
    gas: { color: "#8bd450", icon: "biohazard", width: 1.5, alpha: 0.9, fill: 0.18 },
    gasevent: { color: "#8bd450", icon: "biohazard", width: 1.5, alpha: 0.85, fill: 0.08, dash: [6, 5] },
    animals: { color: "#d8b36a", icon: "paw", width: 1.25, alpha: 0.8, fill: 0.08 },
  };
  const SPAWN_ORDER = ["vehicles", "helicrash", "convoy", "police", "watertruck", "containers", "crates", "trains", "supplies", "gasevent", "spawns"];
  const WORLD_ORDER = ["wells", "fruit", "berries", "animals", "infected", "gas"];
  const LABEL = { spawns: "Player spawns", wells: "Water sources", fruit: "Fruit trees", berries: "Berry bushes", animals: "Animals",
                  infected: "Infected areas", gas: "Gas zones" };
  const MOBILE = () => innerWidth <= 760;
  const isOff = (lid, key) => state.off.has(`${lid}:${key}`);
  // "StaticObj_Wreck_Mi24_TK_DE" -> "Mi-24"; what an event spawns, for its filter chip
  const KID_NAMES = { Mi8: "Mi-8", Mi24: "Mi-24", UH1Y: "UH-1Y", Chinook: "Chinook", UAZ: "UAZ", Truck01: "Truck", C130J: "C-130J" };
  const kidName = (k) => {
    const t = k.replace(/^(StaticObj_|Land_|Wreck_)+/, "").replace(/_(Crashed|DE|TK|Aban\d|Police|Cistern|Green|Locked)/g, "").replace(/^Wreck_?/, "");
    const head = t.split("_")[0];
    return KID_NAMES[head] || cap(t.replace(/_/g, " "));
  };
  const eventLabel = (lid, ev) => ev.type || [...new Set(ev.kids.map(kidName))].join(" / ") || cap(ev.cls.replace(/^Static/, "").replace(/([a-z])([A-Z])/g, "$1 $2"));
  const MARKER_COLORS = ["#f2f2f2", "#ff4545", "#ff8a3d", "#f2c94c", "#199e70", "#3987e5", "#9085e9", "#d55181", "#8c8c8c"];
  const MARKER_ICONS = ["map-pin", "home", "car", "key", "tent", "package", "flag", "star", "crosshair", "skull",
                        "droplet", "first-aid-kit", "campfire", "alert-triangle", "eye", "building-warehouse"];

  let groupPts = [];
  let maps = [], cfg = null, D = null, W = null, map = null, layers = {}, sets = {}, areas = {}, state = {}, wiki = null, tierGrid = null;
  const cache = {};

  // ------------------------------------------------------------------ helpers
  const bits = (mask, names) => names.filter((_, i) => mask & (1 << i));
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const ll = (x, z) => L.latLng(z, x);
  const mpp = (z = map.getZoom()) => D.size / (256 * 2 ** z);   // metres per screen pixel
  const toast = (msg) => {
    const t = $("#toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 1800);
  };
  const copy = async (text, msg) => {
    try { await navigator.clipboard.writeText(text); toast(msg || "Copied"); } catch { toast(text); }
  };
  const coordText = (x, z) => `${Math.round(x)} / ${Math.round(z)}`;
  const coordsHtml = (x, z) => `<button type="button" class="coords" data-copy="${coordText(x, z)}" title="Copy coordinates">X ${fmt(x)} · Z ${fmt(z)}</button>`;
  const clsHtml = (c) => `<button type="button" class="cls" data-copy="${esc(c)}" title="Copy class name">${esc(c)}</button>`;
  const tierOf = (mask) => {
    const t = bits(mask, TIERS);
    return t.length ? t.map((x) => TIER_LABEL[x]).join(", ") : "None";
  };
  const eventCount = (lid) => (D.events[lid] || []).reduce((s, e) => s + e.p.length, 0);
  const panelPad = () => [MOBILE() ? 10 : 310, 10];

  // ------------------------------------------------------------------ loot rules
  // An item can spawn at a building if one of its rules matches: usage against the building's usage (or the
  // area's, when the building type has none), tier against the area's tier (items without tiers spawn
  // anywhere), and a container in the building that accepts its category and, for tagged items, its tag.
  function findItem(cls) {
    return cls && D.items.find((x) => x.c === cls || (x.vars && x.vars.some((v) => v[0] === cls)));
  }
  function itemPoints(item, i) {
    const B = D.buildings, g = D.groups[B.g[i]];
    const usage = g.u || B.u[i], tier = g.v || B.t[i];
    const rules = item.r.filter(([u, v]) => (usage & u) && (!v || (tier & v)));
    if (!rules.length) return 0;
    let pts = 0;
    for (const [cat, tag, n] of g.c) {
      if (rules.some(([, , k, t]) => ((cat >> k) & 1) && (!t || (tag & t)))) pts += n;
    }
    return pts;
  }
  const itemsAt = (i) => D.items.map((it) => [it, itemPoints(it, i)]).filter(([, p]) => p > 0);
  const itemMask = (item, key) => item.r.reduce((m, r) => m | r[key], 0);

  // ------------------------------------------------------------------ point sets
  // Every point layer is drawn on one canvas, at the exact current zoom, on every frame of a pan or zoom.
  // A grid index keeps drawing and hit testing to what is near the view.
  class PointSet {
    constructor(xs, zs, style, extra) {
      Object.assign(this, extra);
      this.xs = xs; this.zs = zs; this.style = style;
      const n = (this.n = 64);
      this.cell = D.size / n;
      this.grid = new Map();
      for (let i = 0; i < xs.length; i++) {
        const k = clamp(Math.floor(xs[i] / this.cell), 0, n - 1) * n + clamp(Math.floor(zs[i] / this.cell), 0, n - 1);
        let a = this.grid.get(k); if (!a) this.grid.set(k, (a = [])); a.push(i);
      }
    }
    near(x0, x1, z0, z1, fn) {
      const n = this.n, c = this.cell;
      const cx1 = clamp(Math.floor(x1 / c), 0, n - 1), cz0 = clamp(Math.floor(z0 / c), 0, n - 1), cz1 = clamp(Math.floor(z1 / c), 0, n - 1);
      for (let cx = clamp(Math.floor(x0 / c), 0, n - 1); cx <= cx1; cx++) {
        for (let cz = cz0; cz <= cz1; cz++) {
          const a = this.grid.get(cx * n + cz);
          if (a) for (let j = 0; j < a.length; j++) fn(a[j]);
        }
      }
    }
    hit(latlng) {
      const z = map.getZoom(), m = mpp(), x = latlng.lng, y = latlng.lat;
      let best = -1, bd = Infinity;
      this.near(x - 30 * m, x + 30 * m, y - 30 * m, y + 30 * m, (i) => {
        const st = this.style(i, z);
        if (!st || st.ghost) return;
        const d = Math.hypot(this.xs[i] - x, this.zs[i] - y) / m;
        const reach = (st.icon ? st.r : st.r * 1.3) + 4;
        if (d <= reach && d < bd) { bd = d; best = i; }
      });
      return best;
    }
  }

  function addShape(p, px, py, st) {
    const r = st.r;
    switch (st.shape) {
      case "rsquare": {
        const c = r * 0.3;
        if (p.roundRect) { p.roundRect(px - r, py - r, r * 2, r * 2, c); break; }
        p.rect(px - r, py - r, r * 2, r * 2); break;
      }
      case "square":
        if (st.rot) {
          const c = Math.cos(st.rot) * r, s = Math.sin(st.rot) * r;
          p.moveTo(px - c + s, py - s - c); p.lineTo(px + c + s, py + s - c); p.lineTo(px + c - s, py + s + c); p.lineTo(px - c - s, py - s + c); p.closePath();
        } else p.rect(px - r, py - r, r * 2, r * 2);
        break;
      case "diamond": p.moveTo(px, py - r * 1.35); p.lineTo(px + r * 1.35, py); p.lineTo(px, py + r * 1.35); p.lineTo(px - r * 1.35, py); p.closePath(); break;
      case "triangle": p.moveTo(px, py - r * 1.3); p.lineTo(px + r * 1.2, py + r * 0.85); p.lineTo(px - r * 1.2, py + r * 0.85); p.closePath(); break;
      default: p.moveTo(px + r, py); p.arc(px, py, r, 0, Math.PI * 2);
    }
  }
  function drawBadge(ctx, px, py, st) {
    const r = st.r;
    ctx.globalAlpha = st.a ?? 1;
    ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fillStyle = "#0e0e0e"; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = st.ring || st.color; ctx.stroke();
    const s = (r * 1.5) / 24;
    ctx.save(); ctx.translate(px - 12 * s, py - 12 * s); ctx.scale(s, s);
    ctx.lineWidth = 2; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = st.color;
    ctx.stroke(iconPath(st.icon)); ctx.restore();
    ctx.globalAlpha = 1;
  }

  // ------------------------------------------------------------------ the scene: one canvas for everything drawn from data
  const Scene = L.Layer.extend({
    onAdd(m) {
      this._c = L.DomUtil.create("canvas", "scene");
      m.getPane("scene").appendChild(this._c);
      this._ctx = this._c.getContext("2d");
      m.on("move resize viewreset moveend zoomend", this.draw, this);
      this.draw();
    },
    onRemove(m) { m.off("move resize viewreset moveend zoomend", this.draw, this); this._c.remove(); },
    draw() {
      const m = this._map;
      if (!m || !D) return;
      const size = m.getSize(), dpr = Math.min(2, window.devicePixelRatio || 1), c = this._c;
      if (c.width !== Math.round(size.x * dpr) || c.height !== Math.round(size.y * dpr)) {
        c.width = Math.round(size.x * dpr); c.height = Math.round(size.y * dpr);
        c.style.width = `${size.x}px`; c.style.height = `${size.y}px`;
      }
      L.DomUtil.setPosition(c, m.containerPointToLayerPoint([0, 0]));
      const ctx = this._ctx, S = D.size, z = m.getZoom(), k = (256 * 2 ** z) / S;
      const o = m.latLngToContainerPoint(L.latLng(S, 0));   // north-west corner of the map
      const v = { z, k, ox: o.x, oy: o.y, S, w: size.x, h: size.y, dpr,
                  x0: -o.x / k, x1: (size.x - o.x) / k, zTop: S + o.y / k, zBot: S - (size.y - o.y) / k };
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      // world coordinates (metres, z up) for areas
      const world = () => ctx.setTransform(dpr * k, 0, 0, -dpr * k, dpr * o.x, dpr * (o.y + S * k));
      if (state.layers.has("tiers")) { world(); drawTiers(ctx, v); }
      world();
      for (const lid of ["animals", "infected", "gasevent", "gas"]) if (state.layers.has(lid) && areas[lid]) drawAreas(ctx, v, lid);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (state.grid) drawGrid(ctx, v);
      if (state.layers.has("buildings") || state.hits) drawSet(ctx, v, sets.buildings);
      for (const k2 of ["fruit", "berries", "wells", "animalPts", "animalHerds"]) if (state.layers.has(k2.startsWith("animal") ? "animals" : k2) && sets[k2]) drawSet(ctx, v, sets[k2]);
      for (const k2 of SPAWN_ORDER) if (state.layers.has(k2) && sets[k2]) drawSet(ctx, v, sets[k2]);
    },
  });

  function drawSet(ctx, v, set) {
    const pad = 30 / v.k, batches = new Map(), badges = [];
    // at overview zoom many marks land on the same pixels: keep the first per 2px cell
    const cellPx = 2, cols = Math.ceil(v.w / cellPx) + 2, taken = set.xs.length > 2000 ? new Uint8Array(cols * (Math.ceil(v.h / cellPx) + 2)) : null;
    const occupied = (px, py) => {
      if (!taken || px < 0 || py < 0 || px > v.w || py > v.h) return false;
      const i = Math.floor(py / cellPx) * cols + Math.floor(px / cellPx);
      if (taken[i]) return true;
      taken[i] = 1; return false;
    };
    const first = set.uniform && (() => { for (let i = 0; i < set.xs.length; i++) { const st = set.style(i, v.z); if (st) return st; } return null; })();
    if (first) {   // same style for every drawn point: tiny dots go down as plain squares
      const st = first;
      // dense layers at overview zoom: draw once per half zoom step into a whole-map image, then just place it
      if (!st.icon && v.z < 3.5 && set.xs.length > 5000) {
        const cz = Math.round(v.z * 2) / 2, cst = st, key = `${cz}|${cst.color}|${cst.a}|${[...state.off].join()}`;
        if (set.cacheKey !== key) {
          const n = Math.round(256 * 2 ** cz), kc = n / D.size, r = cst.r, d = r * 2;
          const c = set.cache || (set.cache = document.createElement("canvas"));
          c.width = c.height = n;
          const cx = c.getContext("2d");
          cx.fillStyle = cst.color;
          for (let i = 0; i < set.xs.length; i++) if (set.style(i, cz)) cx.fillRect(set.xs[i] * kc - r, (D.size - set.zs[i]) * kc - r, d, d);
          set.cacheKey = key;
        }
        ctx.globalAlpha = cst.a ?? 1;
        ctx.drawImage(set.cache, v.ox, v.oy, v.S * v.k, v.S * v.k);
        ctx.globalAlpha = 1;
        return;
      }
      if (!st.icon && st.r < 2.2) {
        const r = st.r, d = r * 2, xs = set.xs, zs = set.zs, k = v.k, ox = v.ox, oy = v.oy, S = v.S, w = v.w, h = v.h;
        ctx.globalAlpha = st.a ?? 1; ctx.fillStyle = st.color;
        set.near(v.x0 - pad, v.x1 + pad, v.zBot - pad, v.zTop + pad, (i) => {
          if (!set.style(i, v.z)) return;
          const px = ox + xs[i] * k, py = oy + (S - zs[i]) * k;
          if (px > -4 && py > -4 && px < w + 4 && py < h + 4 && !occupied(px, py)) ctx.fillRect(px - r, py - r, d, d);
        });
        ctx.globalAlpha = 1;
        return;
      }
    }
    set.near(v.x0 - pad, v.x1 + pad, v.zBot - pad, v.zTop + pad, (i) => {
      const st = set.style(i, v.z);
      if (!st) return;
      const px = v.ox + set.xs[i] * v.k, py = v.oy + (v.S - set.zs[i]) * v.k;
      if (px < -30 || py < -30 || px > v.w + 30 || py > v.h + 30) return;
      if (st.icon) { badges.push([px, py, st]); return; }
      if (st.r <= 2.4 && occupied(px, py)) return;
      const key = `${st.color}|${st.a ?? 1}|${st.outline || 0}|${st.o || 0}`;
      let b = batches.get(key);
      if (!b) batches.set(key, (b = { st, p: new Path2D() }));
      addShape(b.p, px, py, st);
    });
    // outline first, fill on top: overlapping marks merge into one shape with a single outer edge
    const list = [...batches.values()].sort((a, b) => (a.st.o || 0) - (b.st.o || 0));
    for (const { st, p } of list) {
      ctx.globalAlpha = st.a ?? 1;
      if (st.outline) { ctx.lineWidth = st.outline * 2; ctx.lineJoin = "round"; ctx.strokeStyle = "rgba(0,0,0,0.8)"; ctx.stroke(p); }
      ctx.fillStyle = st.color; ctx.fill(p);
    }
    ctx.globalAlpha = 1;
    for (const [px, py, st] of badges) drawBadge(ctx, px, py, st);
  }

  // Tier areas: tint, plus an outline kept inside the area so neighbouring tiers read as two clean edges
  function drawTiers(ctx, v) {
    if (!layers.tierPaths) {
      layers.tierPaths = {};
      for (const t of [2, 3, 4]) {
        const p = new Path2D();
        for (const poly of D.tiers[t] || []) for (const ring of poly) {
          ring.forEach(([x, z], j) => (j ? p.lineTo(x, z) : p.moveTo(x, z)));
          p.closePath();
        }
        layers.tierPaths[t] = p;
      }
    }
    for (const t of [2, 3, 4]) {
      const st = TIER_STYLE[t], p = layers.tierPaths[t];
      if (!(D.tiers[t] || []).length) continue;
      ctx.globalAlpha = st.fill; ctx.fillStyle = st.color; ctx.fill(p, "evenodd");
      ctx.save(); ctx.clip(p, "evenodd");
      ctx.globalAlpha = 0.95; ctx.strokeStyle = st.color; ctx.lineWidth = 3 / v.k; ctx.lineJoin = "round"; ctx.lineCap = "round";
      ctx.stroke(p);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function drawAreas(ctx, v, lid) {
    const st = AREAS[lid];
    for (const g of areas[lid].paths()) {
      ctx.globalAlpha = st.fill; ctx.fillStyle = st.color; ctx.fill(g.p);
      ctx.globalAlpha = st.alpha; ctx.strokeStyle = st.color; ctx.lineWidth = st.width / v.k;
      const dash = g.dash || st.dash;
      ctx.setLineDash(dash ? dash.map((d) => d / v.k) : []);
      ctx.stroke(g.p);
    }
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  function drawGrid(ctx, v) {
    ctx.save();
    ctx.beginPath(); ctx.rect(v.ox, v.oy, v.S * v.k, v.S * v.k); ctx.clip();   // never outside the map
    const step = 100 * v.k >= 36 ? 100 : 1000;
    ctx.lineWidth = 1; ctx.font = "600 10px Barlow, sans-serif";
    const label = 1000 * v.k >= 60;
    for (let m = Math.max(0, Math.ceil(v.x0 / step) * step); m <= Math.min(v.S, v.x1); m += step) {
      const px = Math.round(v.ox + m * v.k) + 0.5;
      ctx.strokeStyle = m % 1000 === 0 ? "rgba(255,255,255,.18)" : "rgba(255,255,255,.07)";
      ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, v.h); ctx.stroke();
      if (label && m % 1000 === 0) { ctx.fillStyle = "rgba(255,255,255,.5)"; ctx.fillText(String(m / 1000).padStart(2, "0"), px + 3, Math.max(12, v.oy + 12)); }
    }
    for (let m = Math.max(0, Math.ceil(v.zBot / step) * step); m <= Math.min(v.S, v.zTop); m += step) {
      const py = Math.round(v.oy + (v.S - m) * v.k) + 0.5;
      ctx.strokeStyle = m % 1000 === 0 ? "rgba(255,255,255,.18)" : "rgba(255,255,255,.07)";
      ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(v.w, py); ctx.stroke();
      if (label && m % 1000 === 0) { ctx.fillStyle = "rgba(255,255,255,.5)"; ctx.fillText(String(m / 1000).padStart(2, "0"), Math.max(4, v.ox + 4), py - 4); }
    }
    ctx.restore();
  }

  // Circle areas: [x, z, r, label, extra]; paths are built once in world units
  class AreaSet {
    constructor(items, groupOf) { this.items = items; this.groupOf = groupOf || (() => ""); this._paths = null; }
    paths() {
      if (!this._paths) {
        const g = new Map();
        this.items.forEach((it, i) => {
          const key = this.groupOf(it, i);
          if (key === null) return;
          let e = g.get(key);
          if (!e) g.set(key, (e = { p: new Path2D(), dash: it.dash }));
          if (it.ring) { it.ring.forEach(([x, z], j) => (j ? e.p.lineTo(x, z) : e.p.moveTo(x, z))); e.p.closePath(); }
          else { e.p.moveTo(it.x + it.r, it.z); e.p.arc(it.x, it.z, it.r, 0, Math.PI * 2); }
        });
        this._paths = [...g.values()];
      }
      return this._paths;
    }
    invalidate() { this._paths = null; }
    hit(x, z) {
      let best = null;
      for (const it of this.items) {
        if (this.groupOf(it) === null) continue;
        if (it.ring) { if (inRing(it.ring, x, z) && (!best || it.r < best.r)) best = it; continue; }
        const d = Math.hypot(it.x - x, it.z - z);
        if (d <= it.r && (!best || it.r < best.r)) best = it;
      }
      return best;
    }
  }

  function inRing(ring, x, z) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, zi] = ring[i], [xj, zj] = ring[j];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  }
  const ringCentre = (ring) => ring.reduce((c, [x, z]) => [c[0] + x / ring.length, c[1] + z / ring.length], [0, 0]);
  const ZONE_NAMES = ["grazing zone", "resting zone", "watering zone"];

  function buildAreas(lid) {
    if (areas[lid]) return areas[lid];
    if (lid === "infected") {
      areas.infected = new AreaSet(D.zones.map(([x, z, r, t, lo, hi]) => ({ x, z, r, zt: D.zoneTypes[t], label: `${D.zoneTypes[t]} infected · ${lo}–${hi}` })),
        (it) => (isOff("infected", it.zt) ? null : "zone"));
    } else if (lid === "gas") {
      areas.gas = new AreaSet(D.gas.map(([x, z, r, n]) => ({ x, z, r, site: gasSite(n), label: `Gas zone${n ? ` · ${n.replace(/[-_]/g, " ")}` : ""}` })),
        (it) => (isOff("gas", it.site) ? null : "zone"));
    } else if (lid === "gasevent") {
      areas.gasevent = new AreaSet((D.events.gasevent || []).flatMap((ev) => ev.p.map(([x, z]) => ({ x, z, r: ev.r || 75, label: "Random gas zone", ev }))));
    } else if (lid === "animals") {
      // one circle per zone a herd uses; zones of one territory share a badge at their centre
      areas.animals = new AreaSet(W.animals.flatMap((a) => a.areas.flatMap((zones) => zones.map(([x, z, r, k]) => ({
        x, z, r, species: a.n, label: `${a.n} · ${ZONE_NAMES[k] || "zone"}` })))),
        (it) => (isOff("animals", it.species) ? null : "herd"));
    }
    return areas[lid];
  }

  // ------------------------------------------------------------------ smooth zoom
  // Leaflet zooms in fixed animated steps; this eases toward a target zoom (or a target view) frame by frame.
  // The scene redraws on every frame, so nothing is ever shown scaled from an old zoom.
  const SmoothZoom = L.Handler.extend({
    addHooks() { this._fn = (e) => this._wheel(e); this._map.getContainer().addEventListener("wheel", this._fn, { passive: false }); },
    removeHooks() { this._map.getContainer().removeEventListener("wheel", this._fn); },
    _begin() {
      const m = this._map;
      if (!this._on) { this._on = true; m._stop(); m._moveStart(true, false); this._z = m.getZoom(); this._raf = requestAnimationFrame(() => this._step()); }
    },
    _wheel(e) {
      e.preventDefault();
      const m = this._map;
      const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 600 : 1;
      const dz = clamp(-e.deltaY * unit / (e.ctrlKey ? 90 : 220), -1, 1);   // ctrl = trackpad pinch
      this.zoomAround(m.mouseEventToContainerPoint(e), dz);
    },
    zoomAround(px, dz) {
      const m = this._map;
      if (this._fly) this._fly = null;
      const start = !this._on;
      this._begin();
      if (start || this._target == null) this._target = this._z;
      this._px = px;
      this._anchor = m.containerPointToLatLng(px);
      this._target = clamp(this._target + dz, m.getMinZoom(), m.getMaxZoom());
    },
    flyTo(center, zoom) {
      const m = this._map;
      this._begin();
      this._target = null;
      this._fly = { c0: m.getCenter(), z0: this._z, c1: L.latLng(center), z1: clamp(zoom, m.getMinZoom(), m.getMaxZoom()), t0: performance.now(), dur: 420 };
    },
    _step() {
      const m = this._map;
      let center, done;
      if (this._fly) {
        const f = this._fly, t = clamp((performance.now() - f.t0) / f.dur, 0, 1), e = 1 - (1 - t) ** 3;
        this._z = f.z0 + (f.z1 - f.z0) * e;
        center = L.latLng(f.c0.lat + (f.c1.lat - f.c0.lat) * e, f.c0.lng + (f.c1.lng - f.c0.lng) * e);
        done = t >= 1;
        if (done) this._fly = null;
      } else {
        const d = this._target - this._z;
        this._z = Math.abs(d) < 0.002 ? this._target : this._z + d * 0.3;
        const off = m.getSize().divideBy(2).subtract(this._px);
        center = m.unproject(m.project(this._anchor, this._z).add(off), this._z);
        done = this._z === this._target;
      }
      m._move(center, this._z, { pinch: true });
      if (done) {
        this._on = false; this._target = null;
        m._moveEnd(true);
        return;
      }
      this._raf = requestAnimationFrame(() => this._step());
    },
  });
  L.Map.addInitHook("addHandler", "smoothZoom", SmoothZoom);

  function flyToBounds(bounds, maxZoom = 5) {
    const t = map._getBoundsCenterZoom(L.latLngBounds(bounds), { paddingTopLeft: panelPad(), paddingBottomRight: [10, 10], maxZoom });
    map.smoothZoom.flyTo(t.center, t.zoom);
  }

  // ------------------------------------------------------------------ map setup
  async function loadMap(id) {
    cfg = maps.find((m) => m.id === id) || maps[0];
    state.map = cfg.id;
    $("#map-pick").value = cfg.id;
    D = cache[cfg.id] || (cache[cfg.id] = await (await fetch(`maps/${cfg.id}/data.json`)).json());
    W = cache[`w-${cfg.id}`] || null;
    sets = {}; areas = {};
    tierGrid = null;
    loadTierGrid();
    const S = D.size;

    if (map) { map.remove(); map = null; }
    const crs = L.extend({}, L.CRS.Simple, { transformation: new L.Transformation(256 / S, 0, -256 / S, 256) });
    map = L.map("map", { crs, minZoom: 1, maxZoom: 8, zoomSnap: 0, zoomDelta: 0.5, scrollWheelZoom: false, smoothZoom: true,
                         zoomAnimation: false, attributionControl: false, zoomControl: false, inertiaDeceleration: 2600,
                         maxBounds: [[-S * 0.25, -S * 0.25], [S * 1.25, S * 1.25]], doubleClickZoom: false, tapHold: true });
    zoomButtons().addTo(map);
    const bounds = [[0, 0], [S, S]];
    fitAll();
    map.createPane("base").style.zIndex = 150;
    map.createPane("scene").style.zIndex = 400;
    const baseRenderer = L.canvas({ pane: "base" });
    layers = { renderer: L.canvas({ padding: 0.4, tolerance: 4 }) };

    layers.base = {
      satellite: cfg.base.includes("satellite") ? L.tileLayer(`maps/${cfg.id}/tiles/satellite/{z}/{x}/{y}.webp`,
        { bounds, noWrap: true, maxNativeZoom: cfg.satelliteZoom || 3, maxZoom: 8, minZoom: 0, tileSize: 256, keepBuffer: 4 }) : null,
      topographic: cfg.base.includes("topographic") ? L.tileLayer(`maps/${cfg.id}/tiles/topographic/{z}/{x}/{y}.webp`,
        { bounds, noWrap: true, maxNativeZoom: cfg.topoZoom || 5, maxZoom: 8, tileSize: 256, keepBuffer: 4 }) : null,
      schematic: L.layerGroup([
        L.rectangle(bounds, { renderer: baseRenderer, pane: "base", stroke: true, color: "#2a2a2a", weight: 1, fill: true, fillColor: "#121416", fillOpacity: 1, interactive: false }),
        ...(D.overlays.water ? [L.imageOverlay(`maps/${cfg.id}/${D.overlays.water}`, bounds, { pane: "base", className: "water", opacity: 0.5, interactive: false })] : []),
      ]),
    };

    layers.tierLabels = D.tierLabels.map(([t, x, z, r]) => ({ r, t, tip: L.tooltip({ permanent: true, direction: "center", className: `tier-label t${t}`, interactive: false })
      .setLatLng(ll(x, z)).setContent(`Tier ${t}`) }));

    // point sets
    const B = D.buildings;
    groupPts = D.groups.map((g) => g.c.reduce((s, c) => s + c[2], 0));
    sets.buildings = new PointSet(B.x, B.z, styleBuilding);
    for (const lid of Object.keys(D.events)) {
      if (lid === "gasevent") continue;
      const xs = [], zs = [], ref = [];
      D.events[lid].forEach((ev, e) => ev.p.forEach(([x, z]) => { xs.push(x); zs.push(z); ref.push(e); }));
      sets[lid] = new PointSet(xs, zs, (i, z) => styleEvent(lid, ref[i], z), { ref });
    }
    sets.spawns = new PointSet(D.spawns.map((p) => p[0]), D.spawns.map((p) => p[1]), (i, z) => stylePlain("spawns", z), { uniform: true });
    if (W) makeWorldSets();

    // place names: capitals and cities always, villages and locals as you zoom in
    layers.places = L.layerGroup((D.places || []).map(([n, rank, x, z]) =>
      L.tooltip({ permanent: true, direction: "center", className: `place r${rank}`, interactive: false })
        .setLatLng(ll(x, z)).setContent(esc(n))));
    if (D.places && D.places.length) layers.places.addTo(map);

    layers.scene = new Scene().addTo(map);
    layers.markers = L.layerGroup().addTo(map);
    layers.measure = L.layerGroup().addTo(map);
    layers.hover = L.tooltip({ direction: "top", offset: [0, -10], className: "hover-tip" });

    buildPanel();
    await applyState();
    map.on("mousemove", onMove);
    map.on("mouseout", () => { $("#readout").textContent = ""; hideHover(); });
    map.on("zoom", () => { if (layers.measure.getLayers().length) layers.renderer._reset(); scalebar(); });
    map.on("zoomend", () => { stylePlaces(); styleTierLabels(); scalebar(); });
    map.on("moveend zoomend", writeHash);
    map.on("click", onMapClick);
    map.on("dblclick", () => tool === "measure" && finishMeasure());
    map.on("contextmenu", onContext);
    map.on("movestart zoomstart", () => { closeContext(); hideHover(); });
    map.on("popupopen", (e) => wirePopup(e.popup));
    scalebar(); styleTierLabels();
    window.pz = { map, layers, sets, areas, D, state };  // for debugging in the console
  }

  function zoomButtons() {
    const C = L.Control.extend({
      options: { position: "topright" },
      onAdd(m) {
        const el = L.DomUtil.create("div", "leaflet-control-zoom leaflet-bar");
        const btn = (label, title, dz) => {
          const a = L.DomUtil.create("a", dz > 0 ? "leaflet-control-zoom-in" : "leaflet-control-zoom-out", el);
          a.href = "#"; a.role = "button"; a.title = title; a.setAttribute("aria-label", title); a.innerHTML = label;
          L.DomEvent.disableClickPropagation(a);
          L.DomEvent.on(a, "click", (e) => { L.DomEvent.preventDefault(e); m.smoothZoom.zoomAround(m.getSize().divideBy(2), dz); });
        };
        btn("+", "Zoom in", 1); btn("&#x2212;", "Zoom out", -1);
        return el;
      },
    });
    return new C();
  }

  function makeWorldSets() {
    for (const k of ["wells", "fruit", "berries"]) {
      const a = W[k], xs = [], zs = [], kind = [], names = k === "wells" ? W.waterKinds : W.kinds;
      for (let i = 0; i < a.length; i += 3) { xs.push(a[i]); zs.push(a[i + 1]); kind.push(a[i + 2]); }
      sets[k] = new PointSet(xs, zs, (i, z) => (isOff(k, names[kind[i]]) ? null : stylePlain(k, z)), { kind, names, uniform: true });
    }
    // herds: one species badge per territory; ambient life (hares, hens, foxes): a point per spawn zone
    const hx = [], hz = [], hs = [], xs = [], zs = [], sp = [];
    W.animals.forEach((a, ai) => {
      a.areas.forEach((zones) => { const [x, z] = ringCentre(zones); hx.push(x); hz.push(z); hs.push(ai); });
      a.pts.forEach(([x, z]) => { xs.push(x); zs.push(z); sp.push(ai); });
    });
    sets.animalHerds = new PointSet(hx, hz, (i, z) => {
      const a = W.animals[hs[i]];
      if (isOff("animals", a.n) || z < POINTS.animalHerds.badge) return null;
      return { icon: a.i, r: badgeR(z), color: "#f2f2f2", ring: POINTS.animalHerds.tone };
    }, { species: hs });
    sets.animalPts = new PointSet(xs, zs, (i, z) => {
      const a = W.animals[sp[i]];
      if (isOff("animals", a.n) || z < 3) return null;   // ambient life is everywhere: only worth showing close up
      if (z >= POINTS.animalPts.badge) return { icon: a.i, r: badgeR(z) * 0.85, color: "#f2f2f2", ring: POINTS.animalPts.tone };
      return { shape: "circle", r: sizeAt(z, [1, 1.3, 1.8, 2.4, 3, 3, 3, 3]), color: POINTS.animalPts.tone, a: 0.85, outline: 1 };
    }, { species: sp });
  }
  async function loadWorld() {
    if (!W) W = cache[`w-${cfg.id}`] = await (await fetch(`maps/${cfg.id}/world.json`)).json();
    if (!sets.wells) makeWorldSets();
    return W;
  }

  function loadTierGrid() {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.width; c.height = img.height;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      tierGrid = { w: img.width, data: ctx.getImageData(0, 0, img.width, img.height).data };
    };
    img.src = `maps/${cfg.id}/${D.overlays.tiergrid}`;
  }
  function tierAt(x, z) {
    if (!tierGrid) return 0;
    const w = tierGrid.w, col = clamp(Math.floor(x / D.size * w), 0, w - 1), row = clamp(Math.floor((1 - z / D.size) * w), 0, w - 1);
    return Math.round(tierGrid.data[(row * w + col) * 4] / 60);
  }

  // Fit the whole map into the area the panel doesn't cover
  function fitAll() {
    map.fitBounds([[0, 0], [D.size, D.size]], { paddingTopLeft: panelPad(), paddingBottomRight: [10, 10], animate: false });
  }

  // ------------------------------------------------------------------ styles
  // Sizes grow continuously with zoom (steps are per whole zoom level, 1-8)
  const sizeAt = (z, steps) => {
    const i = clamp(z, 1, 8) - 1, lo = Math.floor(i), f = i - lo;
    return steps[lo] + (steps[Math.min(lo + 1, steps.length - 1)] - steps[lo]) * f;
  };
  const redraw = () => layers.scene && layers.scene.draw();

  function styleBuilding(i, z) {
    const B = D.buildings, hits = state.hits;
    // bigger loot buildings draw a little larger from mid zoom on
    const weight = z >= 3 ? 0.78 + 0.3 * Math.min(1, Math.sqrt(groupPts[B.g[i]]) / 5) : 1;
    const r = sizeAt(z, [1.1, 1.5, 2.2, 3.1, 4, 5.2, 6.8, 8.8]) * weight;
    const shape = z >= 3 ? "rsquare" : "square", outline = z >= 3 ? 1 : 0;
    if (hits) {
      const p = hits[i];
      if (p > 0) return { shape, r: r * 1.05 + Math.min(3, Math.sqrt(p) / 2) * clamp(z - 2, 0.5, 1), color: HIT, outline, o: 1 };
      return z >= 4 ? { shape, r: r * 0.85, color: "#6a6a6a", a: 0.45, ghost: !state.layers.has("buildings") } : null;
    }
    const key = D.lootTypes[B.l[i]][0];
    if (isOff("buildings", key)) return null;
    return { shape, r, color: LOOT_COLOR[key], a: z <= 2 ? 0.85 : 1, outline };
  }

  const badgeR = (z) => sizeAt(z, [7, 8, 9, 10, 11, 12, 13, 13]);
  function styleEvent(lid, e, z) {
    const st = POINTS[lid], ev = D.events[lid][e];
    if (isOff(lid, ev.cls)) return null;
    const ic = lid === "vehicles" ? VEHICLE_ICON[ev.cls] || "car" : st.icon;
    if (z >= st.badge) return { icon: ic, r: badgeR(z), color: "#f2f2f2", ring: st.tone, o: 2 };
    return { shape: st.shape, r: sizeAt(z, [2.6, 3.4, 4, 4.6, 5, 5, 5, 5]), color: st.tone, outline: 1.5, o: 2 };
  }

  function stylePlain(k, z) {
    const st = POINTS[k];
    if (z >= st.badge) return { icon: st.icon, r: badgeR(z), color: "#f2f2f2", ring: st.tone };
    if (st.shape === "dot") return { shape: "circle", r: sizeAt(z, [0.7, 0.9, 1.3, 1.8, 2.6, 3.6, 4, 4]), color: st.tone, a: z <= 3 ? 0.55 : 0.95, outline: z >= 5 ? 1 : 0 };
    return { shape: st.shape, r: sizeAt(z, [2.6, 3.2, 4, 4.6, 5, 5, 5, 5]), color: st.tone, outline: 1.5 };
  }

  function styleTierLabels() {
    if (!layers.tierLabels) return;
    const on = state.layers.has("tiers"), m = mpp();
    for (const { r, t, tip } of layers.tierLabels) {
      const show = on && r / m >= 34;
      if (show && !map.hasLayer(tip)) tip.addTo(map);
      else if (!show && map.hasLayer(tip)) map.removeLayer(tip);
      if (show && t > 1) tip.getElement().style.borderColor = TIER_STYLE[t].color;
    }
  }
  function stylePlaces() {
    const z = map.getZoom(), el = $("#map");
    for (let r = 0; r <= 3; r++) el.classList.toggle(`hide-r${r}`, z < [0, 1.5, 3, 4.5][r]);
  }

  // ------------------------------------------------------------------ panel
  function row(lid, label, glyph, n) {
    const l = document.createElement("label");
    l.className = "row";
    l.innerHTML = `<input type="checkbox" data-layer="${lid}">${glyph}<span>${esc(label)}</span><b class="n">${fmt(n)}</b>`;
    return l;
  }
  function chip(lid, key, label, swatch, n) {
    return `<button type="button" class="chip" data-sub="${esc(lid)}" data-key="${esc(key)}" aria-pressed="${!isOff(lid, key)}">${swatch || ""}<span>${esc(label)}</span>${n != null ? `<b>${fmt(n)}</b>` : ""}</button>`;
  }
  // chips under a layer row, when the layer has more than one kind of thing
  function subChips(lid, entries) {
    const sub = document.createElement("div");
    sub.className = "chips sub"; sub.dataset.for = lid;
    sub.innerHTML = entries.length > 1 ? entries.map((e) => chip(lid, e.k, e.label, e.icon ? icon(e.icon, "ic") : "", e.n)).join("") : "";
    return sub;
  }
  function worldEntries(k) {
    const counts = {};
    sets[k].kind.forEach((ki) => (counts[ki] = (counts[ki] || 0) + 1));
    return Object.keys(counts).map((ki) => ({ k: sets[k].names[ki], label: sets[k].names[ki], n: counts[ki] }));
  }
  const gasSite = (n) => (n || "").split(/[-_ ]/)[0] || "Zone";

  // Tier key: each swatch is a colour picker; a reset link appears once a colour is changed
  function renderTierKey() {
    const changed = [2, 3, 4].some((t) => TIER_STYLE[t].color !== TIER_DEFAULTS[t]);
    $("#tier-key").innerHTML = `<span><i class="tk"></i>Tier 1</span>` + [2, 3, 4].filter((t) => (D.tiers[t] || []).length)
      .map((t) => `<label title="Change colour"><i class="tk" style="--c:${TIER_STYLE[t].color}"></i>Tier ${t}<input type="color" value="${TIER_STYLE[t].color}" data-tier="${t}" aria-label="Tier ${t} colour"></label>`).join("")
      + (changed ? `<button type="button" class="link" id="tier-reset">Reset colours</button>` : "");
    $$("#tier-key input").forEach((inp) => (inp.oninput = () => {
      TIER_STYLE[+inp.dataset.tier].color = inp.value;
      inp.previousElementSibling.style.setProperty("--c", inp.value);
      saveTierColors(); redraw(); styleTierLabels();
      if (!$("#tier-reset")) renderTierKey();
    }));
    const reset = $("#tier-reset");
    if (reset) reset.onclick = () => { for (const t of [2, 3, 4]) TIER_STYLE[t].color = TIER_DEFAULTS[t]; saveTierColors(); renderTierKey(); redraw(); styleTierLabels(); };
  }

  function buildPanel() {
    const base = $("#base");
    base.replaceChildren(...["satellite", "topographic", "schematic"].map((k) => {
      const b = document.createElement("button");
      b.type = "button"; b.dataset.base = k;
      b.textContent = { satellite: "Satellite", topographic: "Topo", schematic: "Plain" }[k];
      if (!layers.base[k]) { b.disabled = true; b.title = "Not available for this map yet"; }
      b.onclick = () => { state.base = k; applyState(); };
      return b;
    }));

    $('[data-count="buildings"]').textContent = fmt(D.buildings.x.length);
    const counts = {};
    D.buildings.l.forEach((l) => (counts[l] = (counts[l] || 0) + 1));
    $("#loot-types").innerHTML = D.lootTypes.map(([k, label], i) => counts[i] ? chip("buildings", k, label, `<i class="sw" style="background:${LOOT_COLOR[k]}"></i>`) : "").join("");
    renderTierKey();

    const sp = $("#spawn-layers");
    sp.replaceChildren();
    for (const lid of SPAWN_ORDER) {
      const n = lid === "spawns" ? D.spawns.length : eventCount(lid);
      if (!n) continue;
      const label = lid === "spawns" ? LABEL.spawns : D.eventLayers.find((l) => l[0] === lid)[1];
      const ic = (POINTS[lid] || AREAS[lid]).icon;
      sp.append(row(lid, label, icon(ic, "ic row-ic"), n));
      if (D.events[lid]) {
        sp.append(subChips(lid, D.events[lid].map((ev) => ({ k: ev.cls, label: eventLabel(lid, ev), icon: lid === "vehicles" ? VEHICLE_ICON[ev.cls] || "car" : null, n: ev.p.length }))));
      }
    }
    const wl = $("#world-layers");
    wl.replaceChildren();
    const wc = { wells: D.world.wells, fruit: D.world.fruit, berries: D.world.berries,
                 animals: D.world.animals.reduce((s, a) => s + a[1], 0), infected: D.zones.length, gas: D.gas.length };
    for (const lid of WORLD_ORDER) {
      if (!wc[lid]) continue;
      wl.append(row(lid, LABEL[lid], icon((POINTS[lid] || AREAS[lid]).icon, "ic row-ic"), wc[lid]));
      if (lid === "animals") wl.append(subChips("animals", D.world.animals.map(([n, c, ic]) => ({ k: n, label: n, icon: ic, n: c }))));
      else if (lid === "infected") {
        const zc = {};
        D.zones.forEach((z) => (zc[z[3]] = (zc[z[3]] || 0) + 1));
        wl.append(subChips("infected", D.zoneTypes.map((t, i) => ({ k: t, label: t, n: zc[i] || 0 })).filter((e) => e.n)));
      } else if (lid === "gas") {
        const gc = {};
        D.gas.forEach((g) => (gc[gasSite(g[3])] = (gc[gasSite(g[3])] || 0) + 1));
        wl.append(subChips("gas", Object.keys(gc).map((k) => ({ k, label: k, n: gc[k] }))));
      } else if (["fruit", "berries", "wells"].includes(lid)) wl.append(subChips(lid, W ? worldEntries(lid) : []));   // filled once world.json is loaded
    }

    $$("#panel input[data-layer]").forEach((cb) => (cb.onchange = () => {
      cb.checked ? state.layers.add(cb.dataset.layer) : state.layers.delete(cb.dataset.layer);
      applyState();
    }));
    wireChips();
    $("#credit").textContent = cfg.credit || "";
  }
  function wireChips() {
    $$("[data-sub]").forEach((b) => (b.onclick = () => {
      const key = `${b.dataset.sub}:${b.dataset.key}`;
      state.off.has(key) ? state.off.delete(key) : state.off.add(key);
      applyState();
    }));
  }

  let applying = Promise.resolve();
  function applyState() { return (applying = applying.then(applyNow).catch((e) => console.error(e))); }
  async function applyNow() {
    if (!layers.base[state.base]) state.base = cfg.base[0];
    for (const [k, l] of Object.entries(layers.base)) {
      if (!l) continue;
      if (k === state.base) { if (!map.hasLayer(l)) l.addTo(map); } else if (map.hasLayer(l)) map.removeLayer(l);
    }
    $$("#base [data-base]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.base === state.base));
    $("#grid-toggle").setAttribute("aria-pressed", !!state.grid);

    if (["wells", "fruit", "berries", "animals"].some((k) => state.layers.has(k))) {
      await loadWorld();
      for (const k of ["fruit", "berries", "wells"]) {
        const sub = $(`.chips.sub[data-for="${k}"]`);
        if (sub && !sub.dataset.filled) { sub.dataset.filled = "1"; sub.replaceWith(subChips(k, worldEntries(k))); wireChips(); }
      }
    }
    for (const lid of Object.keys(AREAS)) if (state.layers.has(lid)) buildAreas(lid);
    const offSig = [...state.off].join();
    for (const lid of ["animals", "infected", "gas"]) if (areas[lid] && areas[lid].sig !== offSig) { areas[lid].sig = offSig; areas[lid].invalidate(); }

    for (const cb of $$("#panel input[data-layer]")) cb.checked = state.layers.has(cb.dataset.layer);
    $$(".chips.sub").forEach((s) => (s.hidden = !state.layers.has(s.dataset.for) || !s.children.length));
    $("#loot-types").hidden = !state.layers.has("buildings") || !!state.hits;
    $("#tier-key").hidden = !state.layers.has("tiers");
    $$("[data-sub]").forEach((b) => b.setAttribute("aria-pressed", !isOff(b.dataset.sub, b.dataset.key)));

    redraw();
    styleTierLabels();
    stylePlaces();
    renderLookup();
    writeHash();
  }

  // ------------------------------------------------------------------ lookup
  function selectItem(item) {
    state.item = item ? item.c : null;
    state.type = null;
    state.hits = item ? Float32Array.from(D.buildings.x, (_, i) => itemPoints(item, i)) : null;
    applyState().then(() => item && fitHits());
  }
  function selectType(gi) {
    state.type = gi; state.item = null;
    state.hits = Float32Array.from(D.buildings.g, (g) => (g === gi ? 1 : 0));
    applyState().then(fitHits);
  }
  function selectVehicle(cls) {
    state.layers.add("vehicles");
    for (const e of D.events.vehicles) state.off[e.cls === cls ? "delete" : "add"](`vehicles:${e.cls}`);
    applyState();
    const ev = D.events.vehicles.find((e) => e.cls === cls);
    if (ev) flyToBounds(L.latLngBounds(ev.p.map(([x, z]) => [z, x])).pad(0.08));
  }
  function clearLookup() { state.item = null; state.type = null; state.hits = null; applyState(); }
  function fitHits() {
    const pts = [];
    state.hits.forEach((p, i) => p && pts.push([D.buildings.z[i], D.buildings.x[i]]));
    if (pts.length) flyToBounds(L.latLngBounds(pts).pad(0.08));
  }

  function renderLookup() {
    const card = $("#lookup");
    if (!state.item && state.type == null) { card.hidden = true; return; }
    let html = "";
    const nb = state.hits ? state.hits.reduce((s, p) => s + (p > 0), 0) : 0;
    if (state.item) {
      const it = findItem(state.item);
      if (!it) { card.hidden = true; return; }
      const pts = state.hits.reduce((s, p) => s + p, 0);
      const tiers = bits(itemMask(it, 1), D.limits.values);
      const classes = it.vars ? it.vars.map((v) => v[0]) : [it.c];
      const page = wiki && wiki.find((w) => classes.includes(w.c));
      const cats = [...new Set(it.r.map((r) => cap(D.limits.categories[r[2]])))].join(", ");
      html = `<div class="card-head"><h3>${esc(it.n)}</h3><button type="button" class="x" data-clear aria-label="Clear">${icon("x")}</button></div>
        <div class="classes">${classes.map(clsHtml).join("")}</div>
        <div class="chips static">${(tiers.length ? tiers : ["Any tier"]).map((t) => `<span class="chip t">${esc(TIER_LABEL[t] || t)}</span>`).join("")}
        ${bits(itemMask(it, 0), D.limits.usages).map((u) => `<span class="chip">${esc(u.replace(/([a-z])([A-Z])/g, "$1 $2"))}</span>`).join("")}</div>
        <dl class="facts"><div><dt>On the map</dt><dd>${fmt(it.q)}</dd></div><div><dt>Buildings</dt><dd>${fmt(nb)}</dd></div>
        <div><dt>Loot points</dt><dd>${fmt(pts)}</dd></div><div><dt>Category</dt><dd>${esc(cats)}</dd></div></dl>
        ${page ? `<a class="wiki-link" href="https://wiki.purez.gg${page.u}" target="_blank" rel="noopener">Wiki page</a>` : ""}`;
    } else {
      const g = D.groups[state.type];
      html = `<div class="card-head"><h3>${esc(g.n)}</h3><button type="button" class="x" data-clear aria-label="Clear">${icon("x")}</button></div>
        <div class="classes">${clsHtml(g.cls)}</div>
        <div class="chips static">${bits(g.u, D.limits.usages).map((u) => `<span class="chip">${esc(u)}</span>`).join("")}</div>
        <dl class="facts"><div><dt>On the map</dt><dd>${fmt(nb)}</dd></div><div><dt>Loot points</dt><dd>${fmt(g.c.reduce((s, c) => s + c[2], 0))}</dd></div></dl>`;
    }
    const wasHidden = card.hidden;
    card.innerHTML = html;
    card.hidden = false;
    if (wasHidden) $("#panel").scrollTop = 0;
    $("[data-clear]", card).onclick = clearLookup;
    $$("[data-copy]", card).forEach((c) => (c.onclick = () => copy(c.dataset.copy, "Class name copied")));
  }

  // ------------------------------------------------------------------ hover, click, popups
  function hitTest(latlng) {
    for (const k of [...SPAWN_ORDER, "wells", "animalHerds", "animalPts", "fruit", "berries"]) {
      if (!state.layers.has(k.startsWith("animal") ? "animals" : k) || !sets[k]) continue;
      const i = sets[k].hit(latlng);
      if (i >= 0) return { k, i };
    }
    if (state.layers.has("buildings") || state.hits) {
      const i = sets.buildings.hit(latlng);
      if (i >= 0) return { k: "buildings", i };
    }
    let best = null;
    for (const lid of ["gas", "gasevent", "animals", "infected"]) {
      if (!state.layers.has(lid) || !areas[lid]) continue;
      const a = areas[lid].hit(latlng.lng, latlng.lat);
      if (a && (!best || a.r < best.a.r)) best = { k: lid, a };
    }
    return best;
  }
  function hitLabel({ k, i, a }) {
    if (a) return a.label;
    if (k === "buildings") {
      const B = D.buildings;
      return `${D.groups[B.g[i]].n}${state.hits && state.hits[i] ? ` · ${state.hits[i]} pts` : ""}`;
    }
    if (D.events[k]) { const ev = D.events[k][sets[k].ref[i]]; return D.events[k].length > 1 ? eventLabel(k, ev) : D.eventLayers.find((l) => l[0] === k)[1]; }
    if (k === "spawns") return "Player spawn";
    if (k === "wells") return sets.wells.names[sets.wells.kind[i]];
    if (k === "animalPts") return W.animals[sets.animalPts.species[i]].n;
    if (k === "animalHerds") return `${W.animals[sets.animalHerds.species[i]].n} territory`;
    return W.kinds[sets[k].kind[i]] + (k === "fruit" ? " tree" : " bush");
  }
  function hitPos({ i, k, a }, cursor) { return a ? cursor : ll(sets[k].xs[i], sets[k].zs[i]); }

  let moveRaf = 0, lastMove = null;
  function onMove(e) {
    lastMove = e.latlng;
    if (moveRaf) return;
    moveRaf = requestAnimationFrame(() => {
      moveRaf = 0;
      readout(lastMove);
      if (tool || map.smoothZoom._on) return hideHover();
      const h = hitTest(lastMove);
      if (!h) return hideHover();
      layers.hover.options.offset = h.a ? [0, -14] : [0, -10];
      layers.hover.setLatLng(hitPos(h, lastMove)).setContent(esc(hitLabel(h)));
      if (!map.hasLayer(layers.hover)) layers.hover.addTo(map);
      map.getContainer().classList.toggle("over-point", !h.a || h.k === "gasevent");
    });
  }
  function hideHover() {
    if (map && layers.hover && map.hasLayer(layers.hover)) map.removeLayer(layers.hover);
    map && map.getContainer().classList.remove("over-point");
  }

  function onMapClick(e) {
    closeContext();
    if (tool === "measure") return addMeasurePoint(e.latlng);
    if (tool === "marker") { addMarker(e.latlng.lng, e.latlng.lat, "", MARKER_COLORS[1], MARKER_ICONS[0], true); setTool(null); return; }
    const h = hitTest(e.latlng);
    if (!h) return;
    hideHover();
    if (h.k === "buildings") buildingPopup(h.i, hitPos(h));
    else if (h.k === "gasevent") eventPopup("gasevent", h.a.ev, ll(h.a.x, h.a.z));
    else if (h.a) return;
    else if (D.events[h.k]) eventPopup(h.k, D.events[h.k][sets[h.k].ref[h.i]], hitPos(h));
    else simplePopup(h, hitPos(h));
  }

  // On phones the point is brought to the lower middle of the screen first, so the popup sits above it in full view
  function popup(latlng, html, opts = {}) {
    if (MOBILE()) {
      $("#panel").classList.remove("open"); $(".panel-toggle").setAttribute("aria-expanded", "false");
      const size = map.getSize(), z = map.getZoom();
      const target = map.unproject(map.project(latlng, z).subtract([0, size.y * 0.3]), z);   // point at 80% height
      map.panTo(target, { animate: true, duration: 0.25 });
      return L.popup({ maxWidth: Math.min(330, innerWidth - 32), autoPan: false, ...opts }).setLatLng(latlng).setContent(html).openOn(map);
    }
    return L.popup({ maxWidth: 330, autoPanPaddingTopLeft: [310, 70], ...opts }).setLatLng(latlng).setContent(html).openOn(map);
  }

  function buildingPopup(i, latlng) {
    const B = D.buildings, g = D.groups[B.g[i]];
    const usage = bits(g.u || B.u[i], D.limits.usages);
    const lt = D.lootTypes[B.l[i]];
    const items = itemsAt(i).sort((a, b) => a[0].n.localeCompare(b[0].n));
    popup(latlng, `<div class="pop"><h4><i class="sw" style="background:${LOOT_COLOR[lt[0]]}"></i>${esc(g.n)}</h4>${clsHtml(g.cls)}
      <dl class="kv"><dt>Loot</dt><dd>${esc(usage.join(", ") || "None")}</dd><dt>Tier</dt><dd>${esc(tierOf(g.v || B.t[i]))}</dd>
      <dt>Loot points</dt><dd>${g.c.reduce((s, c) => s + c[2], 0)}</dd>
      <dt>Same building</dt><dd><a href="#" data-type="${B.g[i]}">${fmt(B.g.filter((x) => x === B.g[i]).length)} on the map</a></dd></dl>
      ${items.length ? `<div class="list"><input type="search" placeholder="Filter ${items.length} items" aria-label="Filter items">
      <ul>${items.map(([it, p]) => `<li data-item="${esc(it.c)}"><span>${esc(it.n)}<code>${esc(it.c)}</code></span><small>${p} pts</small></li>`).join("")}</ul></div>` : ""}
      ${coordsHtml(B.x[i], B.z[i])}</div>`);
  }
  function eventPopup(lid, ev, latlng) {
    const label = ev.type || D.eventLayers.find((l) => l[0] === lid)[1];
    const kids = ev.kids.length ? `<div class="list"><p class="sub">Spawns as</p><div class="classes">${ev.kids.map(clsHtml).join("")}</div></div>` : "";
    popup(latlng, `<div class="pop"><h4>${esc(label)}</h4>${clsHtml(ev.cls)}
      <dl class="kv"><dt>${lid === "gasevent" ? "Active at once" : "On the map"}</dt><dd>${fmt(ev.count)}</dd><dt>Possible spots</dt><dd>${fmt(ev.p.length)}</dd>
      ${ev.r ? `<dt>Radius</dt><dd>${ev.r} m</dd>` : ""}</dl>${kids}
      ${coordsHtml(latlng.lng, latlng.lat)}</div>`);
  }
  function simplePopup(h, latlng) {
    popup(latlng, `<div class="pop"><h4>${esc(hitLabel(h))}</h4>${coordsHtml(latlng.lng, latlng.lat)}</div>`);
  }
  function wirePopup(p) {
    const el = p.getElement();
    if (!el) return;
    $$("[data-copy]", el).forEach((c) => (c.onclick = () => copy(c.dataset.copy, c.classList.contains("cls") ? "Class name copied" : "Coordinates copied")));
    $$("[data-item]", el).forEach((li) => (li.onclick = () => { map.closePopup(); selectItem(findItem(li.dataset.item)); }));
    $$("[data-type]", el).forEach((a) => (a.onclick = (e) => { e.preventDefault(); map.closePopup(); selectType(+a.dataset.type); }));
    const f = $(".list input", el);
    if (f) f.oninput = () => { const w = f.value.toLowerCase(); $$("li", el).forEach((li) => (li.hidden = w && !li.textContent.toLowerCase().includes(w))); };
  }

  // ------------------------------------------------------------------ right-click menu
  let ctxAt = null;
  function showContext(e, head, items, onAct) {
    const el = $("#ctx");
    el.innerHTML = `<p class="ctx-head">${head}</p>` + items.map(([act, ic, label]) => `<button type="button" role="menuitem" data-act="${act}">${icon(ic)}${esc(label)}</button>`).join("");
    el.hidden = false;
    const p = e.containerPoint, r = map.getContainer().getBoundingClientRect();
    const w = el.offsetWidth, h = el.offsetHeight;
    el.style.left = `${clamp(r.left + p.x + 4, 8, innerWidth - w - 8)}px`;
    el.style.top = `${clamp(r.top + p.y + 4, 8, innerHeight - h - 8)}px`;
    $$("[data-act]", el).forEach((b) => (b.onclick = () => { closeContext(); onAct(b.dataset.act); }));
    $("[data-act]", el).focus({ preventScroll: true });
  }
  function onContext(e) {
    if (e.originalEvent && e.originalEvent._stopped) return;
    if (tool === "measure") return finishMeasure();
    ctxAt = e.latlng;
    const { lng: x, lat: z } = e.latlng;
    if (x < 0 || z < 0 || x > D.size || z > D.size) return;
    const t = tierAt(x, z);
    showContext(e, `X ${fmt(x)} · Z ${fmt(z)}${t ? `<span>Tier ${t}</span>` : ""}`, [
      ["copy", "copy", "Copy coordinates"], ["marker", "map-pin", "Add marker here"],
      ["measure", "ruler-2", "Measure from here"], ["link", "link", "Copy link to here"],
    ], contextAction);
  }
  function contextAction(act) {
    const p = ctxAt;
    if (act === "copy") copy(coordText(p.lng, p.lat), "Coordinates copied");
    else if (act === "marker") addMarker(p.lng, p.lat, "", MARKER_COLORS[1], MARKER_ICONS[0], true);
    else if (act === "measure") { setTool("measure"); addMeasurePoint(p); }
    else if (act === "link") {
      const z = Math.max(map.getZoom(), 5);
      const params = hashParams(); params.set("x", Math.round(p.lng)); params.set("y", Math.round(p.lat)); params.set("z", z);
      copy(`${location.origin}${location.pathname}#${cfg.id}?${params}`, "Link copied");
    }
  }
  function markerContext(i, e) {
    const m = loadMarkers()[i];
    if (!m) return;
    showContext(e, `${esc(m.l || "Marker")}<span>${coordText(m.x, m.z)}</span>`, [
      m.k ? ["unlock", "lock-open", "Unlock marker"] : ["lock", "lock", "Lock marker"],
      ["edit", "pencil", "Edit marker"], ["copy", "copy", "Copy coordinates"], ["delete", "trash", "Delete marker"],
    ], (act) => {
      if (act === "lock" || act === "unlock") { updateMarker(i, (x) => (x.k = act === "lock")); toast(act === "lock" ? "Marker locked" : "Marker unlocked"); }
      else if (act === "edit") markerPopup(i, ll(m.x, m.z));
      else if (act === "copy") copy(coordText(m.x, m.z), "Coordinates copied");
      else if (act === "delete") { const l = loadMarkers(); l.splice(i, 1); saveMarkers(l); drawMarkers(); writeHash(); }
    });
  }
  function closeContext() { $("#ctx").hidden = true; }

  // ------------------------------------------------------------------ search
  function searchIndex() {
    if (cache[`idx-${cfg.id}`]) return cache[`idx-${cfg.id}`];
    const counts = {};
    D.buildings.g.forEach((g) => (counts[g] = (counts[g] || 0) + 1));
    const idx = [
      ...D.items.map((it) => ({ t: it.n, c: [it.c, ...(it.vars || []).map((v) => v[0])].join(" "), k: cap(D.limits.categories[it.r[0][2]]), go: () => selectItem(it) })),
      ...(D.events.vehicles || []).map((ev) => ({ t: ev.type, c: [ev.cls, ...ev.kids].join(" "), k: `Vehicle · ${ev.p.length} spots`, go: () => selectVehicle(ev.cls) })),
      ...D.groups.map((g, gi) => counts[gi] && { t: g.n, c: g.cls, k: `Building · ${counts[gi]}`, go: () => selectType(gi) }).filter(Boolean),
    ];
    return (cache[`idx-${cfg.id}`] = idx);
  }
  function setupSearch() {
    const q = $("#q"), res = $("#results");
    let sel = 0, hits = [];
    const render = () => {
      const terms = q.value.toLowerCase().split(/\s+/).filter(Boolean);
      if (!terms.length) { res.hidden = true; return; }
      hits = searchIndex().map((e) => {
        const t = e.t.toLowerCase(), c = e.c.toLowerCase();
        let s = 0;
        for (const w of terms) {
          if (t.startsWith(w) || c.startsWith(w)) s += 3;
          else if (t.includes(` ${w}`) || c.includes(` ${w}`) || c.includes(`_${w}`)) s += 2;
          else if (t.includes(w) || c.includes(w)) s += 1;
          else return null;
        }
        return [s - t.length / 200, e];
      }).filter(Boolean).sort((a, b) => b[0] - a[0]).slice(0, 14).map((x) => x[1]);
      sel = 0;
      res.innerHTML = hits.length ? hits.map((e, i) => `<li role="option" aria-selected="${i === 0}" data-i="${i}"><span>${esc(e.t)}</span><small>${esc(e.k)}</small></li>`).join("")
                                  : `<li aria-disabled="true"><span class="muted">No matches</span></li>`;
      $$("li[data-i]", res).forEach((li) => (li.onclick = () => pick(+li.dataset.i)));
      res.hidden = false;
    };
    const pick = (i) => {
      if (!hits[i]) return;
      hits[i].go(); q.value = hits[i].t; res.hidden = true; q.blur();
      if (innerWidth <= 760) $("#panel").classList.add("open");
    };
    q.addEventListener("input", render);
    q.addEventListener("focus", () => q.value && render());
    q.addEventListener("keydown", (e) => {
      const lis = $$("li[data-i]", res);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault(); if (!lis.length) return;
        sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + lis.length) % lis.length;
        lis.forEach((li, i) => li.setAttribute("aria-selected", i === sel));
        lis[sel].scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter") pick(sel);
      else if (e.key === "Escape") { res.hidden = true; q.blur(); }
    });
    document.addEventListener("click", (e) => { if (!e.target.closest(".search")) res.hidden = true; });
  }

  // ------------------------------------------------------------------ tools
  let tool = null, measurePts = [];
  function setTool(t) {
    tool = tool === t ? null : t;
    $$("[data-tool]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.tool === tool));
    document.body.classList.toggle("tool-active", !!tool);
    if (tool === "measure") { layers.measure.clearLayers(); measurePts = []; }
    if (tool) { map.closePopup(); hideHover(); }
  }
  function finishMeasure() { if (tool === "measure") setTool(null); }
  function addMeasurePoint(p) {
    measurePts.push(p);
    layers.measure.clearLayers();
    L.polyline(measurePts, { renderer: layers.renderer, color: HIT, weight: 2, dashArray: "6 5", interactive: false }).addTo(layers.measure);
    let total = 0;
    measurePts.forEach((pt, i) => {
      if (i) total += map.distance(pt, measurePts[i - 1]);  // flat map metres
      L.circleMarker(pt, { renderer: layers.renderer, radius: 3.5, color: "#0a0a0a", weight: 1.5, fillColor: HIT, fillOpacity: 1, interactive: false }).addTo(layers.measure);
    });
    if (measurePts.length > 1) {
      const a = measurePts[measurePts.length - 2], b = measurePts[measurePts.length - 1];
      const bearing = (Math.atan2(b.lng - a.lng, b.lat - a.lat) * 180 / Math.PI + 360) % 360;
      const d = total >= 1000 ? `${(total / 1000).toFixed(2)} km` : `${Math.round(total)} m`;
      L.tooltip({ permanent: true, direction: "right", className: "measure-label", offset: [8, 0] })
        .setLatLng(b).setContent(`${d} · ${Math.round(bearing)}°`).addTo(layers.measure);
    }
  }

  // markers: saved per map in this browser, and included in share links
  const markerKey = () => `pz-markers-${cfg.id}`;
  const loadMarkers = () => { try { return JSON.parse(localStorage.getItem(markerKey()) || "[]"); } catch { return []; } };
  const saveMarkers = (list) => { try { localStorage.setItem(markerKey(), JSON.stringify(list)); } catch { /* private mode */ } };
  const markerIcon = (m, locked) => L.divIcon({ className: "mk" + (locked ? " locked" : ""), iconSize: [26, 26], iconAnchor: [13, 13],
    html: `<span style="--c:${m.c}">${icon(locked ? "lock" : m.i || MARKER_ICONS[0])}</span>` });
  const updateMarker = (i, fn) => { const l = loadMarkers(); if (!l[i]) return; fn(l[i]); saveMarkers(l); drawMarkers(); writeHash(); };
  function drawMarkers() {
    layers.markers.clearLayers();
    const list = loadMarkers();
    list.forEach((m, i) => {
      const mk = L.marker(ll(m.x, m.z), { icon: markerIcon(m), draggable: !m.k, keyboard: true, title: m.l || "Marker", riseOnHover: true })
        .addTo(layers.markers)
        .on("click", (e) => {
          if (tool === "measure") { L.DomEvent.stop(e.originalEvent); addMeasurePoint(mk.getLatLng()); }
          else if (!tool) markerPopup(i, e.latlng);
        })
        .on("contextmenu", (e) => { L.DomEvent.stop(e.originalEvent); hideHover(); markerContext(i, e); })
        .on("dragend", (e) => {
          const l = loadMarkers(), p = e.target.getLatLng();
          if (l[i]) { l[i].x = Math.round(p.lng); l[i].z = Math.round(p.lat); saveMarkers(l); writeHash(); }
        });
      if (m.l) mk.bindTooltip(esc(m.l), { permanent: true, direction: "right", className: "map-label", offset: [12, 0] });
      if (m.k) watchLockedDrag(mk, m);
    });
    $("#clear-markers").hidden = !list.length;
  }
  // A locked marker can't be dragged; trying shows a padlock and "Locked" for a moment
  function watchLockedDrag(mk, m) {
    const el = mk.getElement();
    let start = null, timer = 0;
    const show = () => {
      start = null;
      if (timer) return;
      mk.setIcon(markerIcon(m, true));
      const tip = mk.getTooltip();
      if (tip) tip.setContent("Locked"); else mk.bindTooltip("Locked", { permanent: true, direction: "right", className: "map-label", offset: [12, 0] });
      timer = setTimeout(() => {
        timer = 0;
        mk.setIcon(markerIcon(m));
        if (m.l) mk.getTooltip().setContent(esc(m.l)); else mk.unbindTooltip();
      }, 1200);
    };
    const move = (e) => { if (start && Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 4) show(); };
    const end = () => { start = null; map.dragging.enable(); document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", end); };
    L.DomEvent.on(el, "pointerdown", (e) => {
      if (e.button) return;
      L.DomEvent.stopPropagation(e);          // the map must not start panning from a locked marker
      map.dragging.disable();
      start = [e.clientX, e.clientY];
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", end);
    });
    L.DomEvent.on(el, "mousedown touchstart", L.DomEvent.stopPropagation);
  }
  function addMarker(x, z, label, color, ic, edit) {
    const list = loadMarkers();
    list.push({ x: Math.round(x), z: Math.round(z), l: label, c: color, i: ic, k: false });
    saveMarkers(list); drawMarkers(); writeHash();
    if (edit) markerPopup(list.length - 1, ll(x, z));
  }
  function markerPopup(i, latlng) {
    const list = loadMarkers(), m = list[i];
    const html = `<div class="pop mk-edit"><input type="text" maxlength="40" placeholder="Label" value="${esc(m.l || "")}" aria-label="Marker label">
      <div class="symbols">${MARKER_ICONS.map((n) => `<button type="button" data-i="${n}" aria-pressed="${n === (m.i || MARKER_ICONS[0])}" aria-label="${n.replace(/-/g, " ")}">${icon(n)}</button>`).join("")}</div>
      <div class="swatches">${MARKER_COLORS.map((c) => `<button type="button" style="background:${c}" data-c="${c}" aria-pressed="${c === m.c}" aria-label="Colour ${c}"></button>`).join("")}</div>
      <div class="mk-foot">${coordsHtml(m.x, m.z)}<span><button type="button" class="del lock-btn">${icon(m.k ? "lock-open" : "lock")}${m.k ? "Unlock" : "Lock"}</button><button type="button" class="del">${icon("trash")}Delete</button></span></div></div>`;
    const p = popup(latlng, html, { offset: [0, -8] });
    const el = p.getElement();
    const input = $("input", el);
    setTimeout(() => input.focus(), 0);
    const update = (fn) => updateMarker(i, fn);
    input.onchange = () => update((x) => (x.l = input.value.trim()));
    input.onkeydown = (e) => { if (e.key === "Enter") { update((x) => (x.l = input.value.trim())); map.closePopup(); } };
    $$("[data-c]", el).forEach((b) => (b.onclick = () => { update((x) => (x.c = b.dataset.c)); $$("[data-c]", el).forEach((x) => x.setAttribute("aria-pressed", x === b)); }));
    $$("[data-i]", el).forEach((b) => (b.onclick = () => { update((x) => (x.i = b.dataset.i)); $$("[data-i]", el).forEach((x) => x.setAttribute("aria-pressed", x === b)); }));
    $(".lock-btn", el).onclick = () => { update((x) => (x.k = !x.k)); map.closePopup(); toast(loadMarkers()[i].k ? "Marker locked" : "Marker unlocked"); };
    $(".del:not(.lock-btn)", el).onclick = () => { const l = loadMarkers(); l.splice(i, 1); saveMarkers(l); drawMarkers(); map.closePopup(); writeHash(); };
  }

  // ------------------------------------------------------------------ readouts
  function readout(p) {
    if (!p || p.lng < 0 || p.lat < 0 || p.lng > D.size || p.lat > D.size) { $("#readout").textContent = ""; return; }
    const t = tierAt(p.lng, p.lat);
    $("#readout").textContent = `X ${fmt(p.lng)}  Z ${fmt(p.lat)}${t ? `  ·  Tier ${t}` : ""}`;
  }
  function scalebar() {
    const m = mpp();
    const len = [5000, 2000, 1000, 500, 200, 100, 50, 20, 10].find((v) => v / m <= 130) || 10;
    $("#scalebar span").style.width = `${len / m}px`;
    $("#scalebar b").textContent = len >= 1000 ? `${len / 1000} km` : `${len} m`;
  }

  // ------------------------------------------------------------------ URL state
  function hashParams() {
    const c = map.getCenter();
    const p = new URLSearchParams();
    p.set("z", +map.getZoom().toFixed(2)); p.set("x", Math.round(c.lng)); p.set("y", Math.round(c.lat));
    p.set("b", state.base);
    p.set("l", [...state.layers].join(","));
    if (state.grid) p.set("g", "1");
    if (state.off.size) p.set("o", [...state.off].join(","));
    if (state.item) p.set("i", state.item);
    const mk = loadMarkers();
    if (mk.length) p.set("m", mk.map((m) => [m.x, m.z, MARKER_COLORS.indexOf(m.c), encodeURIComponent(m.l || ""), Math.max(0, MARKER_ICONS.indexOf(m.i)), m.k ? 1 : 0].join("~")).join("|"));
    return p;
  }
  function writeHash() {
    if (!map) return;
    history.replaceState(null, "", `#${cfg.id}?${hashParams().toString()}`);
  }
  function readHash() {
    const [id, qs] = location.hash.slice(1).split("?");
    return { id, p: new URLSearchParams(qs || "") };
  }

  // ------------------------------------------------------------------ boot
  async function boot() {
    maps = await (await fetch("maps.json")).json();
    const pick = $("#map-pick");
    pick.replaceChildren(...maps.map((m) => new Option(m.name, m.id)));
    pick.onchange = () => {
      if (pick.value === cfg.id) return;
      const keep = state.layers;
      resetState(); state.layers = keep;
      loadMap(pick.value).then(() => { drawMarkers(); fitAll(); });
    };
    $("#hint").textContent = matchMedia("(pointer: coarse)").matches ? "Press and hold the map for coordinates." : "Right-click the map for coordinates.";
    fetch("https://wiki.purez.gg/static/search.json").then((r) => r.json()).then((w) => (wiki = w)).catch(() => {});
    setupSearch();
    const toolIcons = { measure: ["ruler-2", "Measure"], marker: ["map-pin", "Marker"] };
    $$("[data-tool]").forEach((b) => {
      const [ic, label] = toolIcons[b.dataset.tool];
      b.innerHTML = `${icon(ic)}<span>${label}</span>`;
      b.onclick = () => setTool(b.dataset.tool);
    });
    $("#share").innerHTML = `${icon("link")}<span>Share</span>`;
    $("#share").onclick = () => { writeHash(); copy(location.href, "Link copied"); };
    $("#grid-toggle").onclick = () => { state.grid = !state.grid; applyState(); };
    $("#clear-markers").onclick = () => { saveMarkers([]); drawMarkers(); writeHash(); };
    $(".panel-toggle").onclick = (e) => {
      const open = $("#panel").classList.toggle("open");
      e.currentTarget.setAttribute("aria-expanded", open);
    };
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { closeContext(); setTool(null); map && map.closePopup(); }
      if (/input|select|textarea/i.test(document.activeElement.tagName)) return;
      if (e.key === "/") { e.preventDefault(); $("#q").focus(); }
      else if (e.key.toLowerCase() === "r" && !e.ctrlKey && !e.metaKey) setTool("measure");
      else if (e.key.toLowerCase() === "m" && !e.ctrlKey && !e.metaKey) setTool("marker");
    });
    document.addEventListener("pointerdown", (e) => { if (!e.target.closest("#ctx")) closeContext(); });

    const { id, p } = readHash();
    resetState(p);
    await loadMap(id || maps[0].id);
    const shared = p.get("m");
    if (shared && !loadMarkers().length) {
      saveMarkers(shared.split("|").map((s) => {
        const [x, z, c, l, i, k] = s.split("~");
        return { x: +x, z: +z, c: MARKER_COLORS[+c] || MARKER_COLORS[1], l: decodeURIComponent(l || ""), i: MARKER_ICONS[+i] || MARKER_ICONS[0], k: k === "1" };
      }));
    }
    drawMarkers();
    if (p.get("x")) map.setView(ll(+p.get("x"), +p.get("y")), +p.get("z") || 2, { animate: false });
    else fitAll();
    if (p.get("i")) {
      const it = findItem(p.get("i"));
      if (it) {
        state.item = it.c;
        state.hits = Float32Array.from(D.buildings.x, (_, i) => itemPoints(it, i));
        await applyState();
        if (!p.get("x")) fitHits();
      }
    }
  }
  function resetState(p) {
    p = p || new URLSearchParams();
    state = { base: p.get("b") || "satellite", grid: p.get("g") === "1",
              layers: new Set((p.get("l") ?? "buildings,vehicles").split(",").filter(Boolean)),
              off: new Set([...(p.get("o") || "").split(","), ...(p.get("lo") || "").split(",").map((k) => k && `buildings:${k}`)].filter(Boolean)),
              item: null, type: null, hits: null };
  }

  window.addEventListener("load", boot);
})();
