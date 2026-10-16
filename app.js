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

  // Tier areas: tier 1 is the background; 2-4 get their own outline pattern (drawn inside the area) and fill strength
  const TIER_STYLE = {
    1: { fill: 0.0, weight: 0 },
    2: { fill: 0.08, weight: 1.25, color: "#d9d9d9", dash: [7, 5] },
    3: { fill: 0.15, weight: 1.5, color: "#ffffff", dash: [14, 4, 2, 4] },
    4: { fill: 0.3, weight: 2.25, color: "#ff6b6b", dash: [] },
  };

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
    fruit: { icon: "apple", shape: "dot", tone: "#7cc464", badge: 7 },
    berries: { icon: "cherry", shape: "dot", tone: "#b48ae6", badge: 7 },
  };
  const AREAS = {
    infected: { color: "#e66767", icon: "skull" },
    gas: { color: "#8bd450", icon: "biohazard" },
    gasevent: { color: "#8bd450", icon: "biohazard", dash: "6 5" },
    animals: { color: "#d8b36a", icon: "paw" },
  };
  const SPAWN_ORDER = ["vehicles", "helicrash", "convoy", "police", "watertruck", "containers", "crates", "trains", "supplies", "gasevent", "spawns"];
  const WORLD_ORDER = ["wells", "fruit", "berries", "animals", "infected", "gas"];
  const LABEL = { spawns: "Player spawns", wells: "Wells", fruit: "Fruit trees", berries: "Berry bushes", animals: "Animals",
                  infected: "Infected areas", gas: "Gas zones" };
  const MARKER_COLORS = ["#f2f2f2", "#ff4545", "#3987e5", "#c98500", "#199e70"];
  const MARKER_ICONS = ["map-pin", "home", "car", "key", "tent", "package", "flag", "star", "crosshair", "skull",
                        "droplet", "first-aid-kit", "campfire", "alert-triangle", "eye", "building-warehouse"];

  let maps = [], cfg = null, D = null, W = null, map = null, layers = {}, state = {}, wiki = null, tierGrid = null;
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

  // ------------------------------------------------------------------ canvas point layer
  // Points are drawn into map tiles rather than one Leaflet object each: tens of thousands stay smooth,
  // and a grid index finds the point under the cursor.
  const PointLayer = L.GridLayer.extend({
    options: { updateWhenZooming: false, keepBuffer: 3, noWrap: true },
    initialize(xs, zs, style, opts) {
      L.setOptions(this, opts);
      this.xs = xs; this.zs = zs; this.styleFn = style;
      const S = D.size, n = 64;
      this.cell = S / n; this.n = n;
      this.grid = new Map();
      for (let i = 0; i < xs.length; i++) {
        const k = clamp(Math.floor(xs[i] / this.cell), 0, n - 1) * n + clamp(Math.floor(zs[i] / this.cell), 0, n - 1);
        let a = this.grid.get(k); if (!a) this.grid.set(k, (a = [])); a.push(i);
      }
    },
    near(x0, x1, z0, z1, fn) {
      const n = this.n, c = this.cell;
      for (let cx = clamp(Math.floor(x0 / c), 0, n - 1); cx <= clamp(Math.floor(x1 / c), 0, n - 1); cx++) {
        for (let cz = clamp(Math.floor(z0 / c), 0, n - 1); cz <= clamp(Math.floor(z1 / c), 0, n - 1); cz++) {
          const a = this.grid.get(cx * n + cz);
          if (a) for (const i of a) fn(i);
        }
      }
    },
    createTile(c) {
      const t = document.createElement("canvas");
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      t.width = t.height = 256 * dpr;
      const ctx = t.getContext("2d");
      ctx.scale(dpr, dpr);
      const S = D.size, span = S / 2 ** c.z, k = 256 / span, x0 = c.x * span, zTop = S - c.y * span, pad = 26 / k;
      const list = [];
      this.near(x0 - pad, x0 + span + pad, zTop - span - pad, zTop + pad, (i) => {
        const st = this.styleFn(i, c.z);
        if (st) list.push([st, i]);
      });
      if (list.some(([st]) => st.o)) list.sort((a, b) => (a[0].o || 0) - (b[0].o || 0));
      for (const [st, i] of list) drawPoint(ctx, (this.xs[i] - x0) * k, (zTop - this.zs[i]) * k, st);
      return t;
    },
    // Leaflet's redraw() takes the unrounded zoom as tile zoom, which breaks with fractional zoom
    redraw() {
      if (this._map) { this._removeAllTiles(); this._update(); }
      return this;
    },
    // index of the point under a map position, or -1
    hit(latlng) {
      const z = Math.round(map.getZoom()), m = mpp(), x = latlng.lng, y = latlng.lat;
      let best = -1, bd = Infinity;
      this.near(x - 26 * m, x + 26 * m, y - 26 * m, y + 26 * m, (i) => {
        const st = this.styleFn(i, z);
        if (!st || st.ghost) return;
        const d = Math.hypot(this.xs[i] - x, this.zs[i] - y) / m;
        const reach = (st.icon ? st.r : st.r * 1.3) + 4;
        if (d <= reach && d < bd) { bd = d; best = i; }
      });
      return best;
    },
  });

  function drawPoint(ctx, px, py, st) {
    const r = st.r;
    ctx.globalAlpha = st.a ?? 1;
    if (st.icon) {
      ctx.beginPath(); ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fillStyle = "#0e0e0e"; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = st.ring || st.color; ctx.stroke();
      const s = (r * 1.5) / 24;
      ctx.save(); ctx.translate(px - 12 * s, py - 12 * s); ctx.scale(s, s);
      ctx.lineWidth = 2; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = st.color;
      ctx.stroke(iconPath(st.icon)); ctx.restore();
      ctx.globalAlpha = 1;
      return;
    }
    ctx.beginPath();
    switch (st.shape) {
      case "square":
        if (st.rot) {
          ctx.save(); ctx.translate(px, py); ctx.rotate(st.rot); ctx.rect(-r, -r, r * 2, r * 2); ctx.restore();
        } else ctx.rect(px - r, py - r, r * 2, r * 2);
        break;
      case "diamond": ctx.moveTo(px, py - r * 1.35); ctx.lineTo(px + r * 1.35, py); ctx.lineTo(px, py + r * 1.35); ctx.lineTo(px - r * 1.35, py); ctx.closePath(); break;
      case "triangle": ctx.moveTo(px, py - r * 1.3); ctx.lineTo(px + r * 1.2, py + r * 0.85); ctx.lineTo(px - r * 1.2, py + r * 0.85); ctx.closePath(); break;
      default: ctx.arc(px, py, r, 0, Math.PI * 2);
    }
    ctx.fillStyle = st.color; ctx.fill();
    if (st.outline) { ctx.lineWidth = st.outline; ctx.strokeStyle = "#0a0a0a"; ctx.stroke(); }
    ctx.globalAlpha = 1;
  }

  // Tier polygons: fill, then the outline drawn only on the inside so neighbouring tiers read as two lines
  const TierPolygon = L.Polygon.extend({
    _updatePath() {
      const r = this._renderer;
      if (!r._drawing || !this._parts.length) return;
      const ctx = r._ctx, o = this.options;
      ctx.beginPath();
      for (const ring of this._parts) {
        ring.forEach((p, j) => (j ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
        ctx.closePath();
      }
      if (o.fillOpacity) { ctx.globalAlpha = o.fillOpacity; ctx.fillStyle = "#d11a1a"; ctx.fill("evenodd"); }
      if (o.weight) {
        ctx.save(); ctx.clip("evenodd");
        ctx.globalAlpha = 0.9; ctx.lineWidth = o.weight * 2; ctx.strokeStyle = o.color;
        ctx.setLineDash(o.dash); ctx.lineCap = "butt"; ctx.stroke();
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    },
  });

  // ------------------------------------------------------------------ smooth wheel zoom
  // Leaflet zooms in fixed animated steps; this eases toward a target zoom and keeps the point under the cursor fixed.
  const SmoothWheel = L.Handler.extend({
    addHooks() { this._fn = (e) => this._wheel(e); this._map.getContainer().addEventListener("wheel", this._fn, { passive: false }); },
    removeHooks() { this._map.getContainer().removeEventListener("wheel", this._fn); },
    _wheel(e) {
      e.preventDefault();
      const m = this._map;
      const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 600 : 1;
      let dz = -e.deltaY * unit / (e.ctrlKey ? 90 : 240);   // ctrl = trackpad pinch
      dz = clamp(dz, -1, 1);
      if (!this._on) {
        this._on = true; m._stop(); m._moveStart(true, false);
        this._z = m.getZoom(); this._target = this._z;
        this._raf = requestAnimationFrame(() => this._step());
      }
      this._px = m.mouseEventToContainerPoint(e);
      this._anchor = m.containerPointToLatLng(this._px);
      this._target = clamp(this._target + dz, m.getMinZoom(), m.getMaxZoom());
    },
    _step() {
      const m = this._map, d = this._target - this._z;
      this._z = Math.abs(d) < 0.003 ? this._target : this._z + d * 0.28;
      const off = m.getSize().divideBy(2).subtract(this._px);
      const center = m.unproject(m.project(this._anchor, this._z).add(off), this._z);
      m._move(center, this._z, { pinch: true });
      if (this._z === this._target) {
        this._on = false; m._moveEnd(true);
        return;
      }
      this._raf = requestAnimationFrame(() => this._step());
    },
  });
  L.Map.addInitHook("addHandler", "smoothWheel", SmoothWheel);

  // ------------------------------------------------------------------ map setup
  async function loadMap(id) {
    cfg = maps.find((m) => m.id === id) || maps[0];
    state.map = cfg.id;
    $$("#map-tabs button").forEach((b) => b.setAttribute("aria-selected", b.dataset.id === cfg.id));
    D = cache[cfg.id] || (cache[cfg.id] = await (await fetch(`maps/${cfg.id}/data.json`)).json());
    W = cache[`w-${cfg.id}`] || null;
    tierGrid = null;
    loadTierGrid();
    const S = D.size;

    if (map) { map.remove(); map = null; }
    const crs = L.extend({}, L.CRS.Simple, { transformation: new L.Transformation(256 / S, 0, -256 / S, 256) });
    map = L.map("map", { crs, minZoom: 1, maxZoom: 8, zoomSnap: 0, zoomDelta: 0.5, scrollWheelZoom: false, smoothWheel: true,
                         attributionControl: false, zoomControl: false, preferCanvas: true, inertiaDeceleration: 2600,
                         maxBounds: [[-S * 0.25, -S * 0.25], [S * 1.25, S * 1.25]], doubleClickZoom: false, tapHold: true });
    L.control.zoom({ position: "topright" }).addTo(map);
    const bounds = [[0, 0], [S, S]];
    fitAll();
    map.createPane("base").style.zIndex = 150;
    map.createPane("tierPane").style.zIndex = 320;
    map.createPane("areas").style.zIndex = 380;
    map.createPane("points").style.zIndex = 420;
    map.createPane("spawnPoints").style.zIndex = 430;
    const baseRenderer = L.canvas({ pane: "base" });
    layers = {
      renderer: L.canvas({ padding: 0.4, tolerance: 4 }),
      areaRenderer: L.canvas({ pane: "areas", padding: 0.4, tolerance: 2 }),
      tierRenderer: L.canvas({ pane: "tierPane", padding: 0.4 }),
    };

    layers.base = {
      satellite: cfg.base.includes("satellite") ? L.tileLayer(`maps/${cfg.id}/tiles/satellite/{z}/{x}/{y}.webp`,
        { bounds, noWrap: true, maxNativeZoom: cfg.satelliteZoom || 3, maxZoom: 8, minZoom: 0, tileSize: 256, updateWhenZooming: false, keepBuffer: 3 }) : null,
      topographic: cfg.base.includes("topographic") ? L.tileLayer(`maps/${cfg.id}/tiles/topographic/{z}/{x}/{y}.webp`,
        { bounds, noWrap: true, maxNativeZoom: cfg.topoZoom || 5, maxZoom: 8, tileSize: 256, updateWhenZooming: false, keepBuffer: 3 }) : null,
      schematic: L.layerGroup([
        L.rectangle(bounds, { renderer: baseRenderer, pane: "base", stroke: true, color: "#2a2a2a", weight: 1, fill: true, fillColor: "#121416", fillOpacity: 1, interactive: false }),
        ...(D.overlays.water ? [L.imageOverlay(`maps/${cfg.id}/${D.overlays.water}`, bounds, { pane: "base", className: "water", opacity: 0.5, interactive: false })] : []),
      ]),
    };
    layers.grid = gridLayer(S);

    // tiers
    const tierLayers = [];
    for (const t of [1, 2, 3, 4]) {
      const st = TIER_STYLE[t];
      for (const poly of (D.tiers[t] || [])) {
        if (!st.fill && !st.weight) continue;
        tierLayers.push(new TierPolygon(poly.map((ring) => ring.map(([x, z]) => [z, x])), {
          renderer: layers.tierRenderer, pane: "tierPane", interactive: false, fillOpacity: st.fill, weight: st.weight, color: st.color, dash: st.dash,
        }));
      }
    }
    layers.tierLabels = D.tierLabels.map(([t, x, z, r]) => ({ r, tip: L.tooltip({ permanent: true, direction: "center", className: `tier-label t${t}`, interactive: false, pane: "tooltipPane" })
      .setLatLng(ll(x, z)).setContent(`Tier ${t}`) }));
    layers.tiers = L.layerGroup(tierLayers);

    // buildings
    const B = D.buildings;
    layers.buildings = new PointLayer(B.x, B.z, styleBuilding, { pane: "points", bounds });

    // spawn and world points
    for (const lid of Object.keys(D.events)) {
      if (lid === "gasevent") continue;
      const xs = [], zs = [], ref = [];
      D.events[lid].forEach((ev, e) => ev.p.forEach(([x, z]) => { xs.push(x); zs.push(z); ref.push(e); }));
      const L_ = new PointLayer(xs, zs, (i, z) => styleEvent(lid, ref[i], z), { pane: "spawnPoints", bounds });
      L_.ref = ref;
      layers[lid] = L_;
    }
    layers.spawns = new PointLayer(D.spawns.map((p) => p[0]), D.spawns.map((p) => p[1]), (i, z) => stylePlain("spawns", z), { pane: "spawnPoints", bounds });

    // place names: capitals and cities always, villages and locals as you zoom in
    layers.places = L.layerGroup((D.places || []).map(([n, rank, x, z]) =>
      L.tooltip({ permanent: true, direction: "center", className: `place r${rank}`, interactive: false })
        .setLatLng(ll(x, z)).setContent(esc(n))));
    if (D.places && D.places.length) layers.places.addTo(map);

    layers.markers = L.layerGroup().addTo(map);
    layers.measure = L.layerGroup().addTo(map);
    layers.hover = L.tooltip({ direction: "top", offset: [0, -10], className: "hover-tip" });

    buildPanel();
    await applyState();
    map.on("mousemove", onMove);
    map.on("mouseout", () => { $("#readout").textContent = ""; hideHover(); });
    map.on("zoomend", () => { stylePlaces(); styleTierLabels(); scalebar(); });
    map.on("moveend zoomend", writeHash);
    map.on("click", onMapClick);
    map.on("dblclick", () => tool === "measure" && finishMeasure());
    map.on("contextmenu", onContext);
    map.on("movestart zoomstart", closeContext);
    map.on("popupopen", (e) => wirePopup(e.popup));
    scalebar(); styleTierLabels();
    window.pz = { map, layers, D, state };  // for debugging in the console
  }

  async function loadWorld() {
    if (!W) W = cache[`w-${cfg.id}`] = await (await fetch(`maps/${cfg.id}/world.json`)).json();
    if (layers.wells) return W;
    const bounds = [[0, 0], [D.size, D.size]];
    for (const k of ["wells", "fruit", "berries"]) {
      const a = W[k], xs = [], zs = [], kind = [];
      for (let i = 0; i < a.length; i += k === "wells" ? 2 : 3) { xs.push(a[i]); zs.push(a[i + 1]); kind.push(a[i + 2]); }
      layers[k] = new PointLayer(xs, zs, (i, z) => stylePlain(k, z), { pane: "points", bounds });
      layers[k].kind = kind;
    }
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
    const wide = innerWidth > 760;
    map.fitBounds([[0, 0], [D.size, D.size]], { paddingTopLeft: [wide ? 310 : 10, 10], paddingBottomRight: [10, 10] });
  }

  function gridLayer(S) {
    const Grid = L.GridLayer.extend({
      createTile(c) {
        const t = document.createElement("canvas");
        t.width = t.height = 256;
        const ctx = t.getContext("2d");
        const span = S / 2 ** c.z;
        const step = span > 600 ? 1000 : 100;
        const x0 = c.x * span, z1 = S - c.y * span;
        ctx.lineWidth = 1;
        ctx.font = "600 10px Barlow, sans-serif";
        for (let m = Math.ceil(x0 / step) * step; m <= x0 + span; m += step) {
          const px = Math.round((m - x0) / span * 256) + 0.5;
          ctx.strokeStyle = m % 1000 === 0 ? "rgba(255,255,255,.16)" : "rgba(255,255,255,.07)";
          ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, 256); ctx.stroke();
          if (m % 1000 === 0 && span <= 4000) { ctx.fillStyle = "rgba(255,255,255,.45)"; ctx.fillText(String(m / 1000).padStart(2, "0"), px + 3, 11); }
        }
        for (let m = Math.floor(z1 / step) * step; m >= z1 - span; m -= step) {
          const py = Math.round((z1 - m) / span * 256) + 0.5;
          ctx.strokeStyle = m % 1000 === 0 ? "rgba(255,255,255,.16)" : "rgba(255,255,255,.07)";
          ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(256, py); ctx.stroke();
          if (m % 1000 === 0 && span <= 4000) { ctx.fillStyle = "rgba(255,255,255,.45)"; ctx.fillText(String(m / 1000).padStart(2, "0"), 3, py - 3); }
        }
        return t;
      },
    });
    return new Grid({ bounds: [[0, 0], [S, S]], noWrap: true, pane: "overlayPane", maxZoom: 8, updateWhenZooming: false });
  }

  // ------------------------------------------------------------------ styles
  const sizeAt = (z, steps) => steps[clamp(z, 1, 8) - 1];

  function styleBuilding(i, z) {
    const B = D.buildings, hits = state.hits;
    const r = sizeAt(z, [1.1, 1.5, 2.1, 2.9, 3.8, 5, 6.5, 8.5]);
    const rot = z >= 5 ? (B.a[i] * Math.PI) / 180 : 0;
    if (hits) {
      const p = hits[i];
      if (p > 0) return { shape: "square", r: r * 1.05 + Math.min(3, Math.sqrt(p) / 2) * (z < 3 ? 0.5 : 1), color: HIT, outline: z >= 3 ? 1 : 0, o: 1, rot };
      return z >= 4 ? { shape: "square", r: r * 0.85, color: "#6a6a6a", a: 0.45, ghost: !state.layers.has("buildings"), rot } : null;
    }
    if (!state.layers.has("buildings")) return null;
    const key = D.lootTypes[B.l[i]][0];
    if (state.lootOff.has(key)) return null;
    return { shape: "square", r, color: LOOT_COLOR[key], a: z <= 2 ? 0.85 : 1, rot };
  }

  function styleEvent(lid, e, z) {
    const st = POINTS[lid], ev = D.events[lid][e];
    if (lid === "vehicles" && state.vehOff.has(ev.cls)) return null;
    const ic = lid === "vehicles" ? VEHICLE_ICON[ev.cls] || "car" : st.icon;
    if (z >= st.badge) return { icon: ic, r: sizeAt(z, [7, 8, 9, 10, 11, 12, 13, 13]), color: "#f2f2f2", ring: st.tone, o: 2 };
    return { shape: st.shape, r: sizeAt(z, [2.6, 3.4, 4, 4.6, 5, 5, 5, 5]), color: st.tone, outline: 1.5, o: 2 };
  }

  function stylePlain(k, z) {
    const st = POINTS[k];
    if (z >= st.badge) return { icon: st.icon, r: sizeAt(z, [7, 8, 9, 10, 11, 12, 13, 13]), color: "#f2f2f2", ring: st.tone };
    if (st.shape === "dot") return { shape: "circle", r: sizeAt(z, [0.7, 0.9, 1.3, 1.8, 2.6, 3.6, 4, 4]), color: st.tone, a: z <= 3 ? 0.55 : 0.95, outline: z >= 5 ? 1 : 0 };
    return { shape: st.shape, r: sizeAt(z, [2.6, 3.2, 4, 4.6, 5, 5, 5, 5]), color: st.tone, outline: 1.5 };
  }

  function styleTierLabels() {
    if (!layers.tierLabels) return;
    const on = state.layers.has("tiers"), m = mpp();
    for (const { r, tip } of layers.tierLabels) {
      const show = on && r / m >= 34;
      if (show && !map.hasLayer(tip)) tip.addTo(map);
      else if (!show && map.hasLayer(tip)) map.removeLayer(tip);
    }
  }
  function stylePlaces() {
    const z = map.getZoom(), el = $("#map");
    for (let r = 0; r <= 3; r++) el.classList.toggle(`hide-r${r}`, z < [0, 1.5, 3, 4.5][r]);
  }

  // Area layers are built when first switched on
  function areaLayer(lid) {
    if (layers[lid]) return layers[lid];
    const ar = AREAS[lid], R = layers.areaRenderer;
    const circle = (x, z, r, extra) => L.circle(ll(x, z), { renderer: R, pane: "areas", radius: r, color: ar.color, weight: 1.25, opacity: 0.7, fillOpacity: 0.07, dashArray: ar.dash, ...extra });
    if (lid === "infected") {
      layers.infected = L.layerGroup(D.zones.map(([x, z, r, t, lo, hi]) =>
        circle(x, z, r, { weight: 1, opacity: 0.55, fillOpacity: 0.05 }).bindTooltip(`${esc(D.zoneTypes[t])} infected · ${lo}–${hi}`, { sticky: true, className: "hover-tip" })));
    } else if (lid === "gas") {
      layers.gas = L.layerGroup(D.gas.map(([x, z, r, n]) =>
        circle(x, z, r, { weight: 1.5, opacity: 0.9, fillOpacity: 0.18 }).bindTooltip(`Gas zone${n ? ` · ${esc(n.replace(/[-_]/g, " "))}` : ""}`, { sticky: true, className: "hover-tip" })));
    } else if (lid === "gasevent") {
      layers.gasevent = L.layerGroup((D.events.gasevent || []).flatMap((ev) => ev.p.map(([x, z]) =>
        circle(x, z, ev.r || 75, { weight: 1.5, opacity: 0.85, fillOpacity: 0.08 }).bindTooltip("Random gas zone", { sticky: true, className: "hover-tip" })
          .on("click", (e) => { L.DomEvent.stop(e); eventPopup("gasevent", ev, e.latlng); }))));
    } else if (lid === "animals") {
      layers.animals = L.layerGroup();
      layers.animalCircles = W.animals.map((a) => L.layerGroup(a.z.map(([x, z, r, t]) =>
        circle(x, z, r, { weight: 1, opacity: 0.75, fillOpacity: 0.06, dashArray: /rest/i.test(W.animalZones[t]) ? "3 4" : null })
          .bindTooltip(zoneLabel(a.n, W.animalZones[t]), { sticky: true, className: "hover-tip" }))));
    }
    return layers[lid];
  }

  // "HuntingGround" -> "Wolves · hunting ground"; generic names like "zone_hen" add nothing
  function zoneLabel(species, zone) {
    const z = zone.replace(/^zone_?/i, "").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase().trim();
    const generic = !z || /^zone_/i.test(zone);
    return esc(generic ? species : `${species} · ${z}`);
  }

  // ------------------------------------------------------------------ panel
  function row(lid, label, glyph, n) {
    const l = document.createElement("label");
    l.className = "row";
    l.innerHTML = `<input type="checkbox" data-layer="${lid}">${glyph}<span>${esc(label)}</span><b class="n">${fmt(n)}</b>`;
    return l;
  }
  function chip(key, label, attr, swatch, n) {
    return `<button type="button" class="chip" ${attr}="${esc(key)}" aria-pressed="true">${swatch || ""}<span>${esc(label)}</span>${n != null ? `<b>${fmt(n)}</b>` : ""}</button>`;
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
    $("#loot-types").innerHTML = D.lootTypes.map(([k, label], i) => counts[i] ? chip(k, label, "data-loot", `<i class="sw" style="background:${LOOT_COLOR[k]}"></i>`) : "").join("");
    $("#tier-key").innerHTML = [1, 2, 3, 4].filter((t) => t === 1 || (D.tiers[t] || []).length).map((t) => {
      const st = TIER_STYLE[t];
      const line = st.weight ? `<line x1="1" y1="5" x2="31" y2="5" stroke="${st.color}" stroke-width="${st.weight + 0.5}" stroke-dasharray="${st.dash.join(" ")}"/>` : "";
      return `<span><svg viewBox="0 0 32 10" aria-hidden="true"><rect x="0" y="0" width="32" height="10" fill="#d11a1a" fill-opacity="${st.fill + 0.04}"/>${line}</svg>Tier ${t}</span>`;
    }).join("");

    const sp = $("#spawn-layers");
    sp.replaceChildren();
    for (const lid of SPAWN_ORDER) {
      const n = lid === "spawns" ? D.spawns.length : eventCount(lid);
      if (!n) continue;
      const label = lid === "spawns" ? LABEL.spawns : D.eventLayers.find((l) => l[0] === lid)[1];
      const ic = (POINTS[lid] || AREAS[lid]).icon;
      sp.append(row(lid, label, icon(ic, "ic row-ic"), n));
      if (lid === "vehicles") {
        const sub = document.createElement("div");
        sub.className = "chips sub"; sub.dataset.for = "vehicles";
        sub.innerHTML = D.events.vehicles.map((ev) => chip(ev.cls, ev.type, "data-veh", icon(VEHICLE_ICON[ev.cls] || "car", "ic"), ev.p.length)).join("");
        sp.append(sub);
      }
    }
    const wl = $("#world-layers");
    wl.replaceChildren();
    const wc = { wells: D.world.wells, fruit: D.world.fruit, berries: D.world.berries,
                 animals: D.world.animals.reduce((s, a) => s + a[1], 0), infected: D.zones.length, gas: D.gas.length };
    for (const lid of WORLD_ORDER) {
      if (!wc[lid]) continue;
      wl.append(row(lid, LABEL[lid], icon((POINTS[lid] || AREAS[lid]).icon, "ic row-ic"), wc[lid]));
      if (lid === "animals") {
        const sub = document.createElement("div");
        sub.className = "chips sub"; sub.dataset.for = "animals";
        sub.innerHTML = D.world.animals.map(([n, c]) => chip(n, n, "data-animal", "", c)).join("");
        wl.append(sub);
      }
    }

    $$("#panel input[data-layer]").forEach((cb) => (cb.onchange = () => {
      cb.checked ? state.layers.add(cb.dataset.layer) : state.layers.delete(cb.dataset.layer);
      applyState();
    }));
    const toggler = (attr, set) => $$(`[${attr}]`).forEach((b) => (b.onclick = () => {
      const k = b.getAttribute(attr);
      set.has(k) ? set.delete(k) : set.add(k);
      applyState();
    }));
    toggler("data-loot", state.lootOff);
    toggler("data-veh", state.vehOff);
    toggler("data-animal", state.animalOff);
    $("#credit").textContent = cfg.credit || "";
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
    state.grid ? layers.grid.addTo(map) : map.removeLayer(layers.grid);

    const worldOn = ["wells", "fruit", "berries", "animals"].some((k) => state.layers.has(k));
    if (worldOn) await loadWorld();

    for (const cb of $$("#panel input[data-layer]")) {
      const lid = cb.dataset.layer, on = state.layers.has(lid);
      cb.checked = on;
      if (lid === "buildings") continue;
      const l = AREAS[lid] && on ? areaLayer(lid) : layers[lid];
      if (!l) continue;
      if (on && !map.hasLayer(l)) l.addTo(map); else if (!on && map.hasLayer(l)) map.removeLayer(l);
    }
    $$(".chips.sub").forEach((s) => (s.hidden = !state.layers.has(s.dataset.for)));
    $("#loot-types").hidden = !state.layers.has("buildings") || !!state.hits;
    $("#tier-key").hidden = !state.layers.has("tiers");
    $$("[data-loot]").forEach((b) => b.setAttribute("aria-pressed", !state.lootOff.has(b.dataset.loot)));
    $$("[data-veh]").forEach((b) => b.setAttribute("aria-pressed", !state.vehOff.has(b.dataset.veh)));
    $$("[data-animal]").forEach((b) => b.setAttribute("aria-pressed", !state.animalOff.has(b.dataset.animal)));
    if (layers.animals) {
      W.animals.forEach((a, i) => {
        const c = layers.animalCircles[i], on = !state.animalOff.has(a.n);
        if (on && !layers.animals.hasLayer(c)) layers.animals.addLayer(c); else if (!on && layers.animals.hasLayer(c)) layers.animals.removeLayer(c);
      });
    }

    // buildings show when switched on, or when a lookup has hits
    const bOn = state.layers.has("buildings") || !!state.hits;
    if (bOn && !map.hasLayer(layers.buildings)) layers.buildings.addTo(map);
    if (!bOn && map.hasLayer(layers.buildings)) map.removeLayer(layers.buildings);
    const sig = JSON.stringify([state.layers.has("buildings"), [...state.lootOff], state.item, state.type]);
    if (sig !== layers.bSig) { layers.bSig = sig; layers.buildings.redraw(); }
    const vsig = [...state.vehOff].join();
    if (layers.vehicles && vsig !== layers.vSig) { layers.vSig = vsig; layers.vehicles.redraw(); }

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
    state.vehOff = new Set(D.events.vehicles.map((e) => e.cls).filter((c) => c !== cls));
    applyState();
    const ev = D.events.vehicles.find((e) => e.cls === cls);
    if (ev) map.fitBounds(L.latLngBounds(ev.p.map(([x, z]) => [z, x])).pad(0.08), { maxZoom: 5, paddingTopLeft: [innerWidth > 760 ? 310 : 10, 10] });
  }
  function clearLookup() { state.item = null; state.type = null; state.hits = null; applyState(); }
  function fitHits() {
    const pts = [];
    state.hits.forEach((p, i) => p && pts.push([D.buildings.z[i], D.buildings.x[i]]));
    if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.08), { maxZoom: 5, paddingTopLeft: [innerWidth > 760 ? 310 : 10, 10] });
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
  const POINT_HIT_ORDER = () => [...SPAWN_ORDER, "wells", "fruit", "berries"].filter((k) => layers[k] instanceof PointLayer && map.hasLayer(layers[k]));
  function hitTest(latlng) {
    for (const k of POINT_HIT_ORDER()) {
      const i = layers[k].hit(latlng);
      if (i >= 0) return { k, i };
    }
    if (map.hasLayer(layers.buildings)) {
      const i = layers.buildings.hit(latlng);
      if (i >= 0) return { k: "buildings", i };
    }
    return null;
  }
  function hitLabel({ k, i }) {
    if (k === "buildings") {
      const B = D.buildings;
      return `${D.groups[B.g[i]].n}${state.hits && state.hits[i] ? ` · ${state.hits[i]} pts` : ""}`;
    }
    if (D.events[k]) { const ev = D.events[k][layers[k].ref[i]]; return ev.type || D.eventLayers.find((l) => l[0] === k)[1]; }
    if (k === "spawns") return "Player spawn";
    if (k === "wells") return "Well";
    return W.kinds[layers[k].kind[i]] + (k === "fruit" ? " tree" : " bush");
  }
  function hitPos({ k, i }) { const l = layers[k]; return ll(l.xs[i], l.zs[i]); }

  let moveRaf = 0, lastMove = null;
  function onMove(e) {
    lastMove = e.latlng;
    if (moveRaf) return;
    moveRaf = requestAnimationFrame(() => {
      moveRaf = 0;
      readout(lastMove);
      if (tool || map._animatingZoom) return hideHover();
      const h = hitTest(lastMove);
      if (!h) return hideHover();
      layers.hover.setLatLng(hitPos(h)).setContent(esc(hitLabel(h)));
      if (!map.hasLayer(layers.hover)) layers.hover.addTo(map);
      map.getContainer().classList.add("over-point");
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
    else if (D.events[h.k]) eventPopup(h.k, D.events[h.k][layers[h.k].ref[h.i]], hitPos(h));
    else simplePopup(h, hitPos(h));
  }

  const popup = (latlng, html, opts) => L.popup({ maxWidth: 330, autoPanPaddingTopLeft: [310, 70], ...opts }).setLatLng(latlng).setContent(html).openOn(map);

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
  function onContext(e) {
    if (tool === "measure") return finishMeasure();
    ctxAt = e.latlng;
    const { lng: x, lat: z } = e.latlng;
    if (x < 0 || z < 0 || x > D.size || z > D.size) return;
    const t = tierAt(x, z);
    const el = $("#ctx");
    el.innerHTML = `<p class="ctx-head">X ${fmt(x)} · Z ${fmt(z)}${t ? `<span>Tier ${t}</span>` : ""}</p>
      <button type="button" role="menuitem" data-act="copy">${icon("copy")}Copy coordinates</button>
      <button type="button" role="menuitem" data-act="marker">${icon("map-pin")}Add marker here</button>
      <button type="button" role="menuitem" data-act="measure">${icon("ruler-2")}Measure from here</button>
      <button type="button" role="menuitem" data-act="link">${icon("link")}Copy link to here</button>`;
    el.hidden = false;
    const p = e.containerPoint, r = map.getContainer().getBoundingClientRect();
    const w = el.offsetWidth, h = el.offsetHeight;
    el.style.left = `${clamp(r.left + p.x + 4, 8, innerWidth - w - 8)}px`;
    el.style.top = `${clamp(r.top + p.y + 4, 8, innerHeight - h - 8)}px`;
    $$("[data-act]", el).forEach((b) => (b.onclick = () => contextAction(b.dataset.act)));
    $("[data-act]", el).focus({ preventScroll: true });
  }
  function contextAction(act) {
    const p = ctxAt;
    closeContext();
    if (act === "copy") copy(coordText(p.lng, p.lat), "Coordinates copied");
    else if (act === "marker") addMarker(p.lng, p.lat, "", MARKER_COLORS[1], MARKER_ICONS[0], true);
    else if (act === "measure") { setTool("measure"); addMeasurePoint(p); }
    else if (act === "link") {
      const z = Math.max(map.getZoom(), 5);
      const params = hashParams(); params.set("x", Math.round(p.lng)); params.set("y", Math.round(p.lat)); params.set("z", z);
      copy(`${location.origin}${location.pathname}#${cfg.id}?${params}`, "Link copied");
    }
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
  const markerIcon = (m) => L.divIcon({ className: "mk", iconSize: [26, 26], iconAnchor: [13, 13],
    html: `<span style="--c:${m.c}">${icon(m.i || MARKER_ICONS[0])}</span>` });
  function drawMarkers() {
    layers.markers.clearLayers();
    const list = loadMarkers();
    list.forEach((m, i) => {
      const mk = L.marker(ll(m.x, m.z), { icon: markerIcon(m), draggable: true, keyboard: true, title: m.l || "Marker", riseOnHover: true })
        .addTo(layers.markers)
        .on("click", (e) => { if (!tool) markerPopup(i, e.latlng); })
        .on("dragend", (e) => {
          const l = loadMarkers(), p = e.target.getLatLng();
          if (l[i]) { l[i].x = Math.round(p.lng); l[i].z = Math.round(p.lat); saveMarkers(l); writeHash(); }
        });
      if (m.l) mk.bindTooltip(esc(m.l), { permanent: true, direction: "right", className: "map-label", offset: [12, 0] });
    });
    $("#clear-markers").hidden = !list.length;
  }
  function addMarker(x, z, label, color, ic, edit) {
    const list = loadMarkers();
    list.push({ x: Math.round(x), z: Math.round(z), l: label, c: color, i: ic });
    saveMarkers(list); drawMarkers(); writeHash();
    if (edit) markerPopup(list.length - 1, ll(x, z));
  }
  function markerPopup(i, latlng) {
    const list = loadMarkers(), m = list[i];
    const html = `<div class="pop mk-edit"><input type="text" maxlength="40" placeholder="Label" value="${esc(m.l || "")}" aria-label="Marker label">
      <div class="symbols">${MARKER_ICONS.map((n) => `<button type="button" data-i="${n}" aria-pressed="${n === (m.i || MARKER_ICONS[0])}" aria-label="${n.replace(/-/g, " ")}">${icon(n)}</button>`).join("")}</div>
      <div class="swatches">${MARKER_COLORS.map((c) => `<button type="button" style="background:${c}" data-c="${c}" aria-pressed="${c === m.c}" aria-label="Colour ${c}"></button>`).join("")}</div>
      <div class="mk-foot">${coordsHtml(m.x, m.z)}<button type="button" class="del">${icon("trash")}Delete</button></div></div>`;
    const p = popup(latlng, html, { offset: [0, -8] });
    const el = p.getElement();
    const input = $("input", el);
    setTimeout(() => input.focus(), 0);
    const update = (fn) => { const l = loadMarkers(); if (!l[i]) return; fn(l[i]); saveMarkers(l); drawMarkers(); writeHash(); };
    input.onchange = () => update((x) => (x.l = input.value.trim()));
    input.onkeydown = (e) => { if (e.key === "Enter") { update((x) => (x.l = input.value.trim())); map.closePopup(); } };
    $$("[data-c]", el).forEach((b) => (b.onclick = () => { update((x) => (x.c = b.dataset.c)); $$("[data-c]", el).forEach((x) => x.setAttribute("aria-pressed", x === b)); }));
    $$("[data-i]", el).forEach((b) => (b.onclick = () => { update((x) => (x.i = b.dataset.i)); $$("[data-i]", el).forEach((x) => x.setAttribute("aria-pressed", x === b)); }));
    $(".del", el).onclick = () => { const l = loadMarkers(); l.splice(i, 1); saveMarkers(l); drawMarkers(); map.closePopup(); writeHash(); };
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
    if (state.lootOff.size) p.set("lo", [...state.lootOff].join(","));
    if (state.item) p.set("i", state.item);
    const mk = loadMarkers();
    if (mk.length) p.set("m", mk.map((m) => [m.x, m.z, MARKER_COLORS.indexOf(m.c), encodeURIComponent(m.l || ""), Math.max(0, MARKER_ICONS.indexOf(m.i))].join("~")).join("|"));
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
    $("#map-tabs").replaceChildren(...maps.map((m) => {
      const b = document.createElement("button");
      b.type = "button"; b.role = "tab"; b.dataset.id = m.id; b.textContent = m.name;
      b.onclick = () => {
        if (m.id === cfg.id) return;
        const keep = state.layers;
        resetState(); state.layers = keep;
        loadMap(m.id).then(() => { drawMarkers(); fitAll(); });
      };
      return b;
    }));
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
        const [x, z, c, l, i] = s.split("~");
        return { x: +x, z: +z, c: MARKER_COLORS[+c] || MARKER_COLORS[1], l: decodeURIComponent(l || ""), i: MARKER_ICONS[+i] || MARKER_ICONS[0] };
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
              lootOff: new Set((p.get("lo") || "").split(",").filter(Boolean)), vehOff: new Set(), animalOff: new Set(),
              item: null, type: null, hits: null };
  }

  window.addEventListener("load", boot);
})();
