// PureZ Map. Data: maps/<id>/data.json, built from the server's mission files by tools/extract.py.
(() => {
  "use strict";
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
  const fmt = (n) => Math.round(n).toLocaleString("en-US");
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const TIERS = ["Tier1", "Tier2", "Tier3", "Tier4", "Unique"];
  const TIER_LABEL = { Tier1: "Tier 1", Tier2: "Tier 2", Tier3: "Tier 3", Tier4: "Tier 4", Unique: "Unique" };

  // Spawn layers: colour + distinct shape (shape carries identity for colour-blind readers)
  const SPAWN_STYLE = {
    vehicles: { shape: "diamond", color: "--c-vehicles", r: 5 },
    helicrash: { shape: "triangle", color: "--c-helicrash", r: 6 },
    convoy: { shape: "square", color: "--c-convoy", r: 4.5 },
    police: { shape: "square", color: "--c-police", r: 4.5 },
    containers: { shape: "square", color: "--c-containers", r: 4.5 },
    trains: { shape: "square", color: "--c-trains", r: 4.5 },
    spawns: { shape: "circle", color: "--c-spawns", r: 3.5 },
  };
  const AREA_LAYERS = [["infected", "Infected areas", "ring", "--c-infected"], ["gas", "Gas zones", "ring", "--c-gas"],
                       ["spawns", "Player spawns", "circle", "--c-spawns"]];
  const MARKER_COLORS = ["#f2f2f2", "#e66767", "#3987e5", "#c98500", "#199e70"];

  let maps = [], cfg = null, D = null, map = null, layers = {}, state = {}, wiki = null;
  const cache = {};

  // ------------------------------------------------------------------ shapes on Leaflet's canvas renderer
  const Shape = L.CircleMarker.extend({
    options: { shape: "circle" },
    _updatePath() {
      const r = this._renderer;
      if (!r._drawing || this._empty()) return;
      const ctx = r._ctx, p = this._point, s = this._radius;
      ctx.beginPath();
      switch (this.options.shape) {
        case "square": ctx.rect(p.x - s, p.y - s, s * 2, s * 2); break;
        case "diamond": ctx.moveTo(p.x, p.y - s * 1.35); ctx.lineTo(p.x + s * 1.35, p.y); ctx.lineTo(p.x, p.y + s * 1.35); ctx.lineTo(p.x - s * 1.35, p.y); ctx.closePath(); break;
        case "triangle": ctx.moveTo(p.x, p.y - s * 1.3); ctx.lineTo(p.x + s * 1.2, p.y + s * 0.85); ctx.lineTo(p.x - s * 1.2, p.y + s * 0.85); ctx.closePath(); break;
        case "pin": ctx.arc(p.x, p.y, s, 0, Math.PI * 2); ctx.moveTo(p.x + s * 0.35, p.y); ctx.arc(p.x, p.y, s * 0.35, 0, Math.PI * 2, true); break;
        default: ctx.arc(p.x, p.y, s, 0, Math.PI * 2);
      }
      r._fillStroke(ctx, this);
    },
  });
  const glyph = (shape, color) => {
    const c = css(color) || color;
    const paths = {
      diamond: `<path d="M7 1.5 12.5 7 7 12.5 1.5 7Z" fill="${c}"/>`,
      triangle: `<path d="M7 1.5 12.8 12H1.2Z" fill="${c}"/>`,
      square: `<rect x="2.5" y="2.5" width="9" height="9" fill="${c}"/>`,
      circle: `<circle cx="7" cy="7" r="4" fill="${c}"/>`,
      ring: `<circle cx="7" cy="7" r="5" fill="${c}" fill-opacity=".18" stroke="${c}" stroke-width="1.5"/>`,
    };
    return `<svg class="glyph" viewBox="0 0 14 14" aria-hidden="true">${paths[shape]}</svg>`;
  };

  // ------------------------------------------------------------------ helpers
  const bits = (mask, names) => names.filter((_, i) => mask & (1 << i));
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const ll = (x, z) => L.latLng(z, x);
  const toast = (msg) => {
    const t = $("#toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 1800);
  };
  const copy = async (text, msg) => {
    try { await navigator.clipboard.writeText(text); toast(msg || "Copied"); } catch { toast(text); }
  };
  const coordsHtml = (x, z) => `<p class="coords" data-copy="${Math.round(x)} ${Math.round(z)}" title="Copy">X ${fmt(x)} · Z ${fmt(z)}</p>`;
  const tierOf = (mask) => {
    const t = bits(mask, TIERS);
    return t.length ? t.map((x) => TIER_LABEL[x]).join(", ") : "None";
  };

  // ------------------------------------------------------------------ loot rules
  // An item can spawn at a building if: its usage matches the building's usage (or the area's, when the
  // building type has none), its tier matches the area's tier (items without tiers spawn anywhere), and
  // a container in the building accepts its category and, for tagged items, its tag.
  function findItem(cls) {
    return cls && D.items.find((x) => x.c === cls || (x.vars && x.vars.some((v) => (Array.isArray(v) ? v[0] : v) === cls)));
  }

  function itemPoints(item, i) {
    const B = D.buildings, g = D.groups[B.g[i]];
    if (!((g.u || B.u[i]) & item.u)) return 0;
    if (item.v && !((g.v || B.t[i]) & item.v)) return 0;
    let pts = 0;
    for (const [cat, tag, n] of g.c) {
      if (((cat >> item.k) & 1) && (!item.t || (tag & item.t))) pts += n;
    }
    return pts;
  }
  const itemsAt = (i) => D.items.map((it) => [it, itemPoints(it, i)]).filter(([, p]) => p > 0);

  // ------------------------------------------------------------------ map setup
  async function loadMap(id) {
    cfg = maps.find((m) => m.id === id) || maps[0];
    state.map = cfg.id;
    $$("#map-tabs button").forEach((b) => b.setAttribute("aria-selected", b.dataset.id === cfg.id));
    D = cache[cfg.id] || (cache[cfg.id] = await (await fetch(`maps/${cfg.id}/data.json`)).json());
    const S = D.size;

    if (map) { map.remove(); map = null; }
    const crs = L.extend({}, L.CRS.Simple, { transformation: new L.Transformation(256 / S, 0, -256 / S, 256) });
    map = L.map("map", { crs, minZoom: 1, maxZoom: 8, zoomSnap: 0.5, zoomDelta: 0.5, wheelPxPerZoomLevel: 90,
                         attributionControl: false, zoomControl: false, preferCanvas: true,
                         maxBounds: [[-S * 0.25, -S * 0.25], [S * 1.25, S * 1.25]], doubleClickZoom: false });
    L.control.zoom({ position: "topright" }).addTo(map);
    const bounds = [[0, 0], [S, S]];
    fitAll();
    const renderer = L.canvas({ padding: 0.4, tolerance: 4 });
    map.createPane("base").style.zIndex = 150;
    const baseRenderer = L.canvas({ pane: "base" });
    layers = { renderer };

    // base layers
    layers.base = {
      satellite: cfg.base.includes("satellite") ? L.tileLayer(`maps/${cfg.id}/tiles/satellite/{z}/{x}/{y}.webp`,
        { bounds, noWrap: true, maxNativeZoom: cfg.satelliteZoom || 3, maxZoom: 8, minZoom: 0, tileSize: 256 }) : null,
      topographic: cfg.base.includes("topographic") ? L.tileLayer(`maps/${cfg.id}/tiles/topographic/{z}/{x}/{y}.webp`,
        { bounds, noWrap: true, maxNativeZoom: cfg.topoZoom || 5, maxZoom: 8, tileSize: 256 }) : null,
      schematic: L.layerGroup([
        L.rectangle(bounds, { renderer: baseRenderer, pane: "base", stroke: true, color: "#2a2a2a", weight: 1, fill: true, fillColor: "#121416", fillOpacity: 1, interactive: false }),
        ...(D.overlays.water ? [L.imageOverlay(`maps/${cfg.id}/${D.overlays.water}`, bounds, { pane: "base", className: "water", opacity: 0.5, interactive: false })] : []),
      ]),
    };
    layers.grid = gridLayer(S);

    // loot overlays
    layers.tiers = L.imageOverlay(`maps/${cfg.id}/${D.overlays.tiers}`, bounds, { interactive: false, opacity: 1 });
    layers.usage = null;

    // buildings
    const B = D.buildings;
    layers.buildingMarkers = B.x.map((x, i) => new Shape(ll(x, B.z[i]), {
      renderer, radius: 2.5, shape: "square", stroke: false, fillColor: "#bdbdbd", fillOpacity: 0.75, idx: i,
    }).on("click", (e) => buildingPopup(i, e.latlng)));
    layers.buildings = L.layerGroup(layers.buildingMarkers);

    // spawns and events
    for (const [lid] of D.eventLayers) {
      const st = SPAWN_STYLE[lid];
      const ms = [];
      for (const ev of D.events[lid]) {
        for (const [x, z] of ev.p) {
          ms.push(new Shape(ll(x, z), { renderer, radius: st.r, shape: st.shape, color: "#0a0a0a", weight: 1.5,
                                         fillColor: css(st.color), fillOpacity: 1 })
            .bindTooltip(ev.type || D.eventLayers.find((l) => l[0] === lid)[1], { direction: "top", offset: [0, -6] })
            .on("click", (e) => eventPopup(lid, ev, e.latlng)));
        }
      }
      layers[lid] = L.layerGroup(ms);
    }
    layers.infected = L.layerGroup(D.zones.map(([x, z, r, t, lo, hi]) =>
      L.circle(ll(x, z), { renderer, radius: r, color: css("--c-infected"), weight: 1, opacity: 0.55, fillOpacity: 0.06 })
        .bindTooltip(`${D.zoneTypes[t]} infected · ${lo}–${hi}`, { sticky: true })));
    layers.gas = L.layerGroup(D.gas.map(([x, z, r]) =>
      L.circle(ll(x, z), { renderer, radius: r, color: css("--c-gas"), weight: 1.5, fillOpacity: 0.18 })
        .bindTooltip(`Gas zone · ${r} m radius`, { sticky: true })));
    layers.spawns = L.layerGroup(D.spawns.map(([x, z]) =>
      new Shape(ll(x, z), { renderer, radius: SPAWN_STYLE.spawns.r, shape: "circle", color: "#0a0a0a", weight: 1.5,
                            fillColor: css("--c-spawns"), fillOpacity: 1 }).bindTooltip("Player spawn", { direction: "top" })));

    // place names: capitals and cities always, villages and locals as you zoom in
    layers.places = L.layerGroup((D.places || []).map(([n, rank, x, z]) =>
      L.tooltip({ permanent: true, direction: "center", className: `place r${rank}`, interactive: false })
        .setLatLng(ll(x, z)).setContent(esc(n))));
    if (D.places && D.places.length) layers.places.addTo(map);

    layers.markers = L.layerGroup().addTo(map);
    layers.measure = L.layerGroup().addTo(map);

    buildPanel();
    applyState();
    map.on("mousemove", (e) => readout(e.latlng));
    map.on("mouseout", () => ($("#readout").textContent = ""));
    map.on("zoomend", () => { styleBuildings(); styleSpawns(); stylePlaces(); scalebar(); });
    map.on("moveend zoomend", writeHash);
    map.on("click", onMapClick);
    map.on("dblclick", () => tool === "measure" && finishMeasure());
    map.on("contextmenu", () => tool === "measure" && finishMeasure());
    map.on("popupopen", (e) => wirePopup(e.popup));
    scalebar();
    window.pz = { map, layers, D };  // for debugging in the console
  }

  // Fit the whole map into the area the panel doesn't cover
  function fitAll() {
    const wide = innerWidth > 760;
    map.fitBounds([[0, 0], [D.size, D.size]], { paddingTopLeft: [wide ? 300 : 10, 10], paddingBottomRight: [10, 10] });
  }

  function gridLayer(S) {
    const Grid = L.GridLayer.extend({
      createTile(c) {
        const t = document.createElement("canvas");
        t.width = t.height = 256;
        const ctx = t.getContext("2d");
        const span = S / 2 ** c.z;             // metres per tile
        const step = span > 2500 ? 1000 : span > 600 ? 1000 : 100;
        const x0 = c.x * span, z1 = S - c.y * span;
        ctx.lineWidth = 1;
        for (let m = Math.ceil(x0 / step) * step; m <= x0 + span; m += step) {
          const px = Math.round((m - x0) / span * 256) + 0.5;
          ctx.strokeStyle = m % 1000 === 0 ? "rgba(255,255,255,.16)" : "rgba(255,255,255,.07)";
          ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, 256); ctx.stroke();
          if (m % 1000 === 0 && span <= 4000) {
            ctx.fillStyle = "rgba(255,255,255,.45)"; ctx.font = "600 10px Barlow, sans-serif";
            ctx.fillText(String(m / 1000).padStart(2, "0"), px + 3, 11);
          }
        }
        for (let m = Math.floor(z1 / step) * step; m >= z1 - span; m -= step) {
          const py = Math.round((z1 - m) / span * 256) + 0.5;
          ctx.strokeStyle = m % 1000 === 0 ? "rgba(255,255,255,.16)" : "rgba(255,255,255,.07)";
          ctx.beginPath(); ctx.moveTo(0, py); ctx.lineTo(256, py); ctx.stroke();
          if (m % 1000 === 0 && span <= 4000) {
            ctx.fillStyle = "rgba(255,255,255,.45)"; ctx.font = "600 10px Barlow, sans-serif";
            ctx.fillText(String(m / 1000).padStart(2, "0"), 3, py - 3);
          }
        }
        return t;
      },
    });
    return new Grid({ bounds: [[0, 0], [S, S]], noWrap: true, pane: "overlayPane", maxZoom: 8 });
  }

  // ------------------------------------------------------------------ panel
  function buildPanel() {
    const base = $("#base");
    base.replaceChildren(...["satellite", "topographic", "schematic"].map((k) => {
      const b = document.createElement("button");
      b.type = "button"; b.dataset.base = k; b.textContent = k[0].toUpperCase() + k.slice(1, 5) + (k === "satellite" ? "" : "");
      b.textContent = { satellite: "Satellite", topographic: "Topo", schematic: "Plain" }[k];
      if (!layers.base[k]) { b.disabled = true; b.title = "Not available for this map yet"; }
      b.onclick = () => { state.base = k; applyState(); };
      return b;
    }));
    const g = document.createElement("button");
    g.type = "button"; g.dataset.grid = "1"; g.textContent = "Grid";
    g.onclick = () => { state.grid = !state.grid; applyState(); };
    base.append(g);

    $('[data-count="buildings"]').textContent = fmt(D.buildings.x.length);
    const sel = $("#usage");
    sel.replaceChildren(new Option("None", ""), ...D.overlays.usage.map((u) => new Option(u.replace(/([a-z])([A-Z])/g, "$1 $2"), u)));
    sel.onchange = () => { state.usage = sel.value; applyState(); };

    const sp = $("#spawn-layers");
    const rows = D.eventLayers.map(([lid, label]) => [lid, label, SPAWN_STYLE[lid].shape, SPAWN_STYLE[lid].color,
                                                      D.events[lid].reduce((s, e) => s + e.p.length, 0)]);
    for (const [lid, label, shape, color] of AREA_LAYERS) {
      const n = lid === "infected" ? D.zones.length : lid === "gas" ? D.gas.length : D.spawns.length;
      if (n) rows.push([lid, label, shape, color, n]);
    }
    sp.replaceChildren(...rows.map(([lid, label, shape, color, n]) => {
      const l = document.createElement("label");
      l.className = "row";
      l.innerHTML = `<input type="checkbox" data-layer="${lid}">${glyph(shape, color)}<span>${esc(label)}</span><b class="n">${fmt(n)}</b>`;
      return l;
    }));
    $$("#panel input[data-layer]").forEach((cb) => (cb.onchange = () => {
      state.layers = new Set($$("#panel input[data-layer]:checked").map((c) => c.dataset.layer));
      applyState();
    }));
    $("#credit").textContent = cfg.credit || "";
  }

  function applyState() {
    if (!layers.base[state.base]) state.base = cfg.base[0];
    for (const [k, l] of Object.entries(layers.base)) {
      if (!l) continue;
      if (k === state.base) { if (!map.hasLayer(l)) l.addTo(map).bringToBack?.(); } else if (map.hasLayer(l)) map.removeLayer(l);
    }
    $$("#base [data-base]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.base === state.base));
    $("#base [data-grid]").setAttribute("aria-pressed", !!state.grid);
    state.grid ? layers.grid.addTo(map) : map.removeLayer(layers.grid);

    for (const cb of $$("#panel input[data-layer]")) {
      const on = state.layers.has(cb.dataset.layer);
      cb.checked = on;
      const l = layers[cb.dataset.layer];
      if (!l) continue;
      if (on && !map.hasLayer(l)) l.addTo(map); else if (!on && map.hasLayer(l)) map.removeLayer(l);
    }
    if (layers.usage) { map.removeLayer(layers.usage); layers.usage = null; }
    $("#usage").value = state.usage || "";
    if (state.usage) {
      layers.usage = L.imageOverlay(`maps/${cfg.id}/usage/${state.usage}.png`, [[0, 0], [D.size, D.size]], { interactive: false, opacity: 0.55 }).addTo(map);
    }
    styleBuildings();
    styleSpawns();
    stylePlaces();
    renderLookup();
    writeHash();
  }

  // ------------------------------------------------------------------ buildings and lookup
  function styleBuildings() {
    if (!map || !layers.buildingMarkers) return;
    const z = map.getZoom();
    const hit = state.hits;
    const usageBit = state.usage ? D.limits.usages.indexOf(state.usage) : -1;
    const base = z < 2.5 ? 1.2 : z < 3.5 ? 1.8 : z < 4.5 ? 2.6 : z < 5.5 ? 3.4 : 4.4;
    const show = state.layers.has("buildings");
    for (const m of layers.buildingMarkers) {
      const i = m.options.idx;
      let r = base, color = "#bdbdbd", op = z < 2.5 ? 0.45 : 0.75;
      if (hit) {
        const p = hit[i];
        if (p) { color = css("--hit"); op = 1; r = base * 0.9 + Math.min(2.5, Math.sqrt(p) / 2) * (z < 3 ? 0.5 : 1); }
        else { op = z >= 4 ? 0.18 : 0; }
      } else if (usageBit >= 0) {
        const g = D.groups[D.buildings.g[i]];
        const u = g.u || D.buildings.u[i];
        if (!(u & (1 << usageBit))) op = z >= 4 ? 0.15 : 0.06;
      }
      if (!show && !(hit && hit[i])) op = 0;
      m.setStyle({ fillColor: color, fillOpacity: op, interactive: op > 0.1 });
      m.setRadius(r);
    }
    const anyOn = show || hit;
    if (anyOn && !map.hasLayer(layers.buildings)) layers.buildings.addTo(map);
    if (!anyOn && map.hasLayer(layers.buildings)) map.removeLayer(layers.buildings);
  }

  function stylePlaces() {
    const z = map.getZoom(), el = $("#map");
    for (let r = 0; r <= 3; r++) el.classList.toggle(`hide-r${r}`, z < [0, 1.5, 3, 4.5][r]);
  }

  // Spawn markers shrink at overview zooms so the map stays readable
  function styleSpawns() {
    const z = map.getZoom(), k = z < 2 ? 0.55 : z < 3 ? 0.75 : z < 4 ? 0.9 : 1;
    for (const [lid] of D.eventLayers) layers[lid].eachLayer((m) => m.setRadius(SPAWN_STYLE[lid].r * k));
    layers.spawns.eachLayer((m) => m.setRadius(SPAWN_STYLE.spawns.r * k));
  }

  function selectItem(item) {
    state.item = item ? item.c : null;
    state.type = null;
    state.hits = item ? Float32Array.from(D.buildings.x, (_, i) => itemPoints(item, i)) : null;
    applyState();
    if (item) fitHits();
  }
  function selectType(gi) {
    state.type = gi; state.item = null;
    state.hits = Float32Array.from(D.buildings.g, (g) => (g === gi ? 1 : 0));
    applyState();
    fitHits();
  }
  function fitHits() {
    const pts = [];
    state.hits.forEach((p, i) => p && pts.push([D.buildings.z[i], D.buildings.x[i]]));
    if (pts.length) map.fitBounds(L.latLngBounds(pts).pad(0.08), { maxZoom: 5, paddingTopLeft: [innerWidth > 760 ? 300 : 10, 10] });
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
      const tiers = bits(it.v, D.limits.values);
      const classes = it.vars ? it.vars.map((v) => v[0]) : [it.c];
      const page = wiki && wiki.find((w) => classes.includes(w.c));
      html = `<h3>${esc(it.n)}</h3><p class="cls">${esc(it.vars ? `${it.vars.length} colours: ${it.vars.map((v) => v[1]).join(", ")}` : it.c)}</p>
        <div class="chips">${(tiers.length ? tiers : ["Any tier"]).map((t) => `<span class="chip t">${esc(TIER_LABEL[t] || t)}</span>`).join("")}
        ${bits(it.u, D.limits.usages).map((u) => `<span class="chip">${esc(u)}</span>`).join("")}</div>
        <dl class="facts"><div><dt>On the map</dt><dd>${fmt(it.q)}</dd></div><div><dt>Buildings</dt><dd>${fmt(nb)}</dd></div>
        <div><dt>Loot points</dt><dd>${fmt(pts)}</dd></div><div><dt>Category</dt><dd>${esc(cap(D.limits.categories[it.k]))}</dd></div></dl>
        <div class="actions">${page ? `<a href="https://wiki.purez.gg${page.u}" target="_blank" rel="noopener">Wiki page</a>` : "<span></span>"}<button type="button" data-clear>Clear</button></div>`;
    } else {
      const g = D.groups[state.type];
      html = `<h3>${esc(g.n)}</h3><p class="cls">Building</p>
        <div class="chips">${bits(g.u, D.limits.usages).map((u) => `<span class="chip">${esc(u)}</span>`).join("")}</div>
        <dl class="facts"><div><dt>On the map</dt><dd>${fmt(nb)}</dd></div><div><dt>Loot points</dt><dd>${fmt(g.c.reduce((s, c) => s + c[2], 0))}</dd></div></dl>
        <div class="actions"><span></span><button type="button" data-clear>Clear</button></div>`;
    }
    card.innerHTML = html;
    card.hidden = false;
    $("[data-clear]", card).onclick = () => { state.item = null; state.type = null; state.hits = null; applyState(); };
  }

  // ------------------------------------------------------------------ popups
  function buildingPopup(i, latlng) {
    if (tool) return;
    const B = D.buildings, g = D.groups[B.g[i]];
    const usage = bits(g.u || B.u[i], D.limits.usages);
    const items = itemsAt(i).sort((a, b) => a[0].n.localeCompare(b[0].n));
    const html = `<div class="pop"><h4>${esc(g.n)}</h4><p class="sub">${esc(usage.join(", ") || "No loot type")}</p>
      <dl class="kv"><dt>Tier</dt><dd>${esc(tierOf(g.v || B.t[i]))}</dd><dt>Loot points</dt><dd>${g.c.reduce((s, c) => s + c[2], 0)}</dd>
      <dt>Same building</dt><dd><a href="#" data-type="${B.g[i]}">${fmt(B.g.filter((x) => x === B.g[i]).length)} on map</a></dd></dl>
      <div class="list"><input type="search" placeholder="${items.length} items can spawn here" aria-label="Filter items">
      <ul>${items.map(([it, p]) => `<li data-item="${esc(it.c)}"><span>${esc(it.n)}</span><small>${p} pts</small></li>`).join("")}</ul></div>
      ${coordsHtml(B.x[i], B.z[i])}</div>`;
    L.popup({ maxWidth: 320, autoPanPaddingTopLeft: [300, 70] }).setLatLng(latlng).setContent(html).openOn(map);
  }
  function eventPopup(lid, ev, latlng) {
    if (tool) return;
    const label = ev.type || D.eventLayers.find((l) => l[0] === lid)[1];
    L.popup({ autoPanPaddingTopLeft: [300, 70] }).setLatLng(latlng).setContent(`<div class="pop"><h4>${esc(label)}</h4>
      <dl class="kv"><dt>On the map</dt><dd>${fmt(ev.count)}</dd><dt>Spawn points</dt><dd>${fmt(ev.p.length)}</dd></dl>
      ${coordsHtml(latlng.lng, latlng.lat)}</div>`).openOn(map);
  }
  function wirePopup(popup) {
    const el = popup.getElement();
    if (!el) return;
    $$("[data-copy]", el).forEach((c) => (c.onclick = () => copy(c.dataset.copy, "Coordinates copied")));
    $$("[data-item]", el).forEach((li) => (li.onclick = () => { map.closePopup(); selectItem(findItem(li.dataset.item)); }));
    $$("[data-type]", el).forEach((a) => (a.onclick = (e) => { e.preventDefault(); map.closePopup(); selectType(+a.dataset.type); }));
    const f = $(".list input", el);
    if (f) f.oninput = () => { const w = f.value.toLowerCase(); $$("li", el).forEach((li) => (li.hidden = w && !li.textContent.toLowerCase().includes(w))); };
  }

  // ------------------------------------------------------------------ search
  function searchIndex() {
    if (cache[`idx-${cfg.id}`]) return cache[`idx-${cfg.id}`];
    const counts = {};
    D.buildings.g.forEach((g) => (counts[g] = (counts[g] || 0) + 1));
    const idx = [
      ...D.items.map((it) => ({ t: it.n, c: it.c, k: cap(D.limits.categories[it.k]), go: () => selectItem(it) })),
      ...D.groups.map((g, gi) => counts[gi] && { t: g.n, c: "", k: `Building · ${counts[gi]}`, go: () => selectType(gi) }).filter(Boolean),
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
        for (const w of terms) { if (t.startsWith(w) || c.startsWith(w)) s += 3; else if (t.includes(w) || c.includes(w)) s += 1; else return null; }
        return [s - t.length / 200, e];
      }).filter(Boolean).sort((a, b) => b[0] - a[0]).slice(0, 14).map((x) => x[1]);
      sel = 0;
      res.innerHTML = hits.length ? hits.map((e, i) => `<li role="option" aria-selected="${i === 0}" data-i="${i}"><span>${esc(e.t)}</span><small>${esc(e.k)}</small></li>`).join("")
                                  : `<li aria-disabled="true"><span class="muted">No matches</span></li>`;
      $$("li[data-i]", res).forEach((li) => (li.onclick = () => pick(+li.dataset.i)));
      res.hidden = false;
    };
    const pick = (i) => { if (!hits[i]) return; hits[i].go(); q.value = hits[i].t; res.hidden = true; q.blur(); };
    q.addEventListener("input", render);
    q.addEventListener("keydown", (e) => {
      const lis = $$("li[data-i]", res);
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault(); if (!lis.length) return;
        sel = (sel + (e.key === "ArrowDown" ? 1 : -1) + lis.length) % lis.length;
        lis.forEach((li, i) => li.setAttribute("aria-selected", i === sel));
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
    if (tool) map.closePopup();
  }
  function finishMeasure() { if (tool === "measure") setTool(null); }
  function onMapClick(e) {
    if (tool === "measure") return addMeasurePoint(e.latlng);
    if (tool === "marker") { addMarker(e.latlng.lng, e.latlng.lat, "", MARKER_COLORS[1], true); setTool(null); }
  }
  function addMeasurePoint(p) {
    measurePts.push(p);
    layers.measure.clearLayers();
    const line = L.polyline(measurePts, { renderer: layers.renderer, color: css("--hit"), weight: 2, dashArray: "6 5" }).addTo(layers.measure);
    let total = 0;
    measurePts.forEach((pt, i) => {
      if (i) total += map.distance(pt, measurePts[i - 1]);  // flat map metres
      new Shape(pt, { renderer: layers.renderer, radius: 3.5, color: "#0a0a0a", weight: 1.5, fillColor: css("--hit"), fillOpacity: 1, interactive: false }).addTo(layers.measure);
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
  function drawMarkers() {
    layers.markers.clearLayers();
    const list = loadMarkers();
    list.forEach((m, i) => {
      const s = new Shape(ll(m.x, m.z), { renderer: layers.renderer, radius: 7, shape: "pin", color: "#0a0a0a", weight: 2, fillColor: m.c, fillOpacity: 1 })
        .addTo(layers.markers).on("click", (e) => { if (!tool) markerPopup(i, e.latlng); });
      if (m.l) s.bindTooltip(m.l, { permanent: true, direction: "right", className: "map-label", offset: [10, 0] });
    });
    $("#clear-markers").hidden = !list.length;
  }
  function addMarker(x, z, label, color, edit) {
    const list = loadMarkers();
    list.push({ x: Math.round(x), z: Math.round(z), l: label, c: color });
    saveMarkers(list); drawMarkers(); writeHash();
    if (edit) markerPopup(list.length - 1, ll(x, z));
  }
  function markerPopup(i, latlng) {
    const list = loadMarkers(), m = list[i];
    const html = `<div class="pop mk"><h4>Marker</h4><input type="text" maxlength="40" placeholder="Label" value="${esc(m.l || "")}">
      <div class="swatches">${MARKER_COLORS.map((c) => `<button type="button" style="background:${c}" data-c="${c}" aria-pressed="${c === m.c}" aria-label="Colour"></button>`).join("")}</div>
      ${coordsHtml(m.x, m.z)}<button type="button" class="del">Delete</button></div>`;
    const p = L.popup({ autoPanPaddingTopLeft: [300, 70] }).setLatLng(latlng).setContent(html).openOn(map);
    const el = p.getElement();
    const input = $("input", el);
    input.focus();
    const commit = () => { const l = loadMarkers(); if (l[i]) { l[i].l = input.value.trim(); saveMarkers(l); drawMarkers(); writeHash(); } };
    input.onchange = commit;
    input.onkeydown = (e) => { if (e.key === "Enter") { commit(); map.closePopup(); } };
    $$("[data-c]", el).forEach((b) => (b.onclick = () => { const l = loadMarkers(); l[i].c = b.dataset.c; saveMarkers(l); drawMarkers(); writeHash(); $$("[data-c]", el).forEach((x) => x.setAttribute("aria-pressed", x === b)); }));
    $(".del", el).onclick = () => { const l = loadMarkers(); l.splice(i, 1); saveMarkers(l); drawMarkers(); map.closePopup(); writeHash(); };
  }

  // ------------------------------------------------------------------ readouts
  function readout(p) {
    if (p.lng < 0 || p.lat < 0 || p.lng > D.size || p.lat > D.size) { $("#readout").textContent = ""; return; }
    $("#readout").textContent = `X ${fmt(p.lng)}  Z ${fmt(p.lat)}`;
  }
  function scalebar() {
    const mpp = D.size / (256 * 2 ** map.getZoom());
    const nice = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
    const len = nice.reverse().find((m) => m / mpp <= 130) || 10;
    nice.reverse();
    $("#scalebar span").style.width = `${len / mpp}px`;
    $("#scalebar b").textContent = len >= 1000 ? `${len / 1000} km` : `${len} m`;
  }

  // ------------------------------------------------------------------ URL state
  function writeHash() {
    if (!map) return;
    const c = map.getCenter();
    const p = new URLSearchParams();
    p.set("z", map.getZoom()); p.set("x", Math.round(c.lng)); p.set("y", Math.round(c.lat));
    p.set("b", state.base);
    if (state.layers.size) p.set("l", [...state.layers].join(","));
    if (state.grid) p.set("g", "1");
    if (state.usage) p.set("u", state.usage);
    if (state.item) p.set("i", state.item);
    const mk = loadMarkers();
    if (mk.length) p.set("m", mk.map((m) => [m.x, m.z, MARKER_COLORS.indexOf(m.c), encodeURIComponent(m.l || "")].join("~")).join("|"));
    history.replaceState(null, "", `#${cfg.id}?${p.toString()}`);
  }
  function readHash() {
    const [id, qs] = location.hash.slice(1).split("?");
    const p = new URLSearchParams(qs || "");
    return { id, p };
  }

  // ------------------------------------------------------------------ boot
  async function boot() {
    maps = await (await fetch("maps.json")).json();
    $("#map-tabs").replaceChildren(...maps.map((m) => {
      const b = document.createElement("button");
      b.type = "button"; b.role = "tab"; b.dataset.id = m.id; b.textContent = m.name;
      b.onclick = () => { if (m.id !== cfg.id) { resetState(); loadMap(m.id).then(() => { drawMarkers(); fitAll(); }); } };
      return b;
    }));
    fetch("https://wiki.purez.gg/static/search.json").then((r) => r.json()).then((w) => (wiki = w)).catch(() => {});
    setupSearch();
    $$("[data-tool]").forEach((b) => (b.onclick = () => setTool(b.dataset.tool)));
    $("#share").onclick = () => { writeHash(); copy(location.href, "Link copied"); };
    $("#clear-markers").onclick = () => { saveMarkers([]); drawMarkers(); writeHash(); };
    $(".panel-toggle").onclick = (e) => {
      const open = $("#panel").classList.toggle("open");
      e.currentTarget.setAttribute("aria-expanded", open);
    };
    document.addEventListener("keydown", (e) => {
      if (/input|select|textarea/i.test(document.activeElement.tagName)) return;
      if (e.key === "/") { e.preventDefault(); $("#q").focus(); }
      else if (e.key === "Escape") { setTool(null); map.closePopup(); }
      else if (e.key.toLowerCase() === "r") setTool("measure");
      else if (e.key.toLowerCase() === "m") setTool("marker");
    });

    const { id, p } = readHash();
    resetState(p);
    await loadMap(id || maps[0].id);
    const sharedMarkers = p.get("m");
    if (sharedMarkers && !loadMarkers().length) {
      saveMarkers(sharedMarkers.split("|").map((s) => { const [x, z, c, l] = s.split("~"); return { x: +x, z: +z, c: MARKER_COLORS[+c] || MARKER_COLORS[1], l: decodeURIComponent(l || "") }; }));
    }
    drawMarkers();
    if (p.get("x")) map.setView(ll(+p.get("x"), +p.get("y")), +p.get("z") || 2);
    else fitAll();
    if (p.get("i")) { const it = findItem(p.get("i")); if (it) { selectItem(it); if (p.get("x")) map.setView(ll(+p.get("x"), +p.get("y")), +p.get("z")); } }
  }
  function resetState(p) {
    p = p || new URLSearchParams();
    state = { base: p.get("b") || "satellite", grid: p.get("g") === "1", usage: p.get("u") || "",
              layers: new Set((p.get("l") ?? "buildings,vehicles").split(",").filter(Boolean)), item: null, type: null, hits: null };
  }

  window.addEventListener("load", boot);
})();
