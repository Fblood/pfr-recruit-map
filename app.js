(function () {
  "use strict";

  // ---------------------------------------------------------------------
  // DATA HELPERS
  // ---------------------------------------------------------------------

  const D = PFR_DATA;

  // ringsOf/polygonBBox/clampAxis/makeShuffleBag now live in geometry.js
  // (loaded as a plain global script before this one, same convention as
  // data.js's PFR_DATA) -- pure math, no DOM/canvas dependency, shared
  // with the test suite. See geometry.test.js.

  function stationsByNumber() {
    const map = {};
    D.stations.features.forEach((f) => { map[f.properties.STATION] = f; });
    return map;
  }
  const STATIONS = stationsByNumber();
  const STATION_NUMBERS = Object.keys(STATIONS).sort((a, b) => +a - +b);

  // ---------------------------------------------------------------------
  // PROJECTION
  // ---------------------------------------------------------------------

  const bounds = { minLon: Infinity, minLat: Infinity, maxLon: -Infinity, maxLat: -Infinity };
  function extendBounds(lon, lat) {
    if (lon < bounds.minLon) bounds.minLon = lon;
    if (lon > bounds.maxLon) bounds.maxLon = lon;
    if (lat < bounds.minLat) bounds.minLat = lat;
    if (lat > bounds.maxLat) bounds.maxLat = lat;
  }
  [D.boundary, D.water].forEach((fc) => {
    fc.features.forEach((f) => {
      ringsOf(f.geometry).forEach((ring) => ring.forEach(([lon, lat]) => extendBounds(lon, lat)));
    });
  });
  D.stations.features.forEach((f) => extendBounds(f.geometry.coordinates[0], f.geometry.coordinates[1]));

  const centerLat = (bounds.minLat + bounds.maxLat) / 2;
  const latCorr = Math.cos((centerLat * Math.PI) / 180);

  function toWorld(lon, lat) {
    return { wx: (lon - bounds.minLon) * latCorr, wy: bounds.maxLat - lat };
  }
  const worldW = (bounds.maxLon - bounds.minLon) * latCorr;
  const worldH = bounds.maxLat - bounds.minLat;

  // ---------------------------------------------------------------------
  // CANVAS / VIEW STATE
  // ---------------------------------------------------------------------

  const canvas = document.getElementById("mapCanvas");
  const ctx = canvas.getContext("2d");
  const screenEl = document.getElementById("screen");
  const coordReadout = document.getElementById("coordReadout");

  let dpr = Math.max(1, window.devicePixelRatio || 1);
  let cw = 0, ch = 0;
  let fitScale = 1, fitOffX = 0, fitOffY = 0;
  const view = { zoom: 1, panX: 0, panY: 0 };

  function computeFit() {
    const pad = 24;
    const sx = (cw - pad * 2) / worldW;
    const sy = (ch - pad * 2) / worldH;
    fitScale = Math.min(sx, sy);
    fitOffX = (cw - worldW * fitScale) / 2;
    fitOffY = (ch - worldH * fitScale) / 2;
  }

  function toScreen(lon, lat) {
    const { wx, wy } = toWorld(lon, lat);
    const bx = wx * fitScale + fitOffX;
    const by = wy * fitScale + fitOffY;
    return { x: bx * view.zoom + view.panX, y: by * view.zoom + view.panY };
  }

  function toLonLat(sx, sy) {
    const bx = (sx - view.panX) / view.zoom;
    const by = (sy - view.panY) / view.zoom;
    const wx = (bx - fitOffX) / fitScale;
    const wy = (by - fitOffY) / fitScale;
    return { lon: bounds.minLon + wx / latCorr, lat: bounds.maxLat - wy };
  }

  function zoomAt(sx, sy, factor) {
    const newZoom = Math.min(40, Math.max(0.2, view.zoom * factor));
    const cxWorld = (sx - view.panX) / view.zoom;
    const cyWorld = (sy - view.panY) / view.zoom;
    view.panX = sx - cxWorld * newZoom;
    view.panY = sy - cyWorld * newZoom;
    view.zoom = newZoom;
    clampPan();
    render();
  }

  function resetView() {
    view.zoom = 1;
    view.panX = 0;
    view.panY = 0;
    clampPan();
    render();
  }

  // ---------------------------------------------------------------------
  // PAN CLAMP — the view can never be dragged/zoomed out of frame.
  // ---------------------------------------------------------------------
  // Hard-stop clamp (Mapbox `maxBounds` / Google `restriction` pattern),
  // not Leaflet's elastic "bounce back" — the ask was "not movable out of
  // frame" at all, not a soft edge. Clamps against either the full city
  // extent (`bounds`) or, while locked, a single sector's own extent.
  // `bx0/by0/bx1/by1` are the active extent's corners in the same
  // "fit-space" toScreen already composes through (`bx*zoom+panX`).

  let lockedSector = null; // { code, bx0, by0, bx1, by1 } | null

  function activeExtentBox() {
    if (lockedSector) return lockedSector;
    const bx0 = 0 * fitScale + fitOffX;
    const by0 = 0 * fitScale + fitOffY;
    const bx1 = worldW * fitScale + fitOffX;
    const by1 = worldH * fitScale + fitOffY;
    return { bx0, by0, bx1, by1 };
  }

  function clampPan() {
    const { bx0, by0, bx1, by1 } = activeExtentBox();
    view.panX = clampAxis(view.panX, view.zoom, bx0, bx1, cw);
    view.panY = clampAxis(view.panY, view.zoom, by0, by1, ch);
  }

  function resizeCanvas() {
    const rect = screenEl.getBoundingClientRect();
    dpr = Math.max(1, window.devicePixelRatio || 1);
    cw = rect.width;
    ch = rect.height;
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    computeFit();
    clampPan();
    render();
  }
  new ResizeObserver(resizeCanvas).observe(screenEl);

  // When embedded (e.g. in the Recruit Hub's iframe), report real content
  // height to the parent so it can size the iframe to exactly fit — no
  // guessed min-height, no inner scrollbar unless the parent window
  // itself is genuinely too short to show it.
  if (window.parent !== window) {
    const consoleEl = document.querySelector(".console");
    const reportHeight = () => {
      window.parent.postMessage(
        { type: "pfr-map:height", height: consoleEl.scrollHeight },
        "*"
      );
    };
    new ResizeObserver(reportHeight).observe(consoleEl);
    reportHeight();
  }

  // ---------------------------------------------------------------------
  // PAN / ZOOM INTERACTION
  // ---------------------------------------------------------------------

  let dragging = false, lastX = 0, lastY = 0, moved = false;

  canvas.addEventListener("pointerdown", (e) => {
    dragging = true; moved = false;
    lastX = e.clientX; lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener("pointermove", (e) => {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    const { lon, lat } = toLonLat(sx, sy);
    coordReadout.textContent = `LAT ${lat.toFixed(4)} · LON ${lon.toFixed(4)}`;
    if (!dragging) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved = true;
    view.panX += dx; view.panY += dy;
    clampPan();
    lastX = e.clientX; lastY = e.clientY;
    render();
  });
  window.addEventListener("pointerup", (e) => {
    if (!dragging) return;
    dragging = false;
    if (!moved) handleCanvasClick(e);
  });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    zoomAt(e.clientX - rect.left, e.clientY - rect.top, e.deltaY < 0 ? 1.15 : 1 / 1.15);
  }, { passive: false });

  let pinchDist = null;
  canvas.addEventListener("touchmove", (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const [a, b] = e.touches;
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      if (pinchDist) {
        const rect = canvas.getBoundingClientRect();
        const midX = (a.clientX + b.clientX) / 2 - rect.left;
        const midY = (a.clientY + b.clientY) / 2 - rect.top;
        zoomAt(midX, midY, d / pinchDist);
      }
      pinchDist = d;
    }
  }, { passive: false });
  canvas.addEventListener("touchend", () => { pinchDist = null; });

  document.getElementById("zoomIn").onclick = () => zoomAt(cw / 2, ch / 2, 1.3);
  document.getElementById("zoomOut").onclick = () => zoomAt(cw / 2, ch / 2, 1 / 1.3);
  document.getElementById("zoomReset").onclick = resetView;

  function frameStations(numbers, padPx) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    numbers.forEach((n) => {
      const f = STATIONS[n];
      const { wx, wy } = toWorld(f.geometry.coordinates[0], f.geometry.coordinates[1]);
      const bx = wx * fitScale + fitOffX, by = wy * fitScale + fitOffY;
      if (bx < minX) minX = bx; if (bx > maxX) maxX = bx;
      if (by < minY) minY = by; if (by > maxY) maxY = by;
    });
    const w = Math.max(maxX - minX, 1), h = Math.max(maxY - minY, 1);
    const pad = padPx || 90;
    const scale = Math.min((cw - pad * 2) / w, (ch - pad * 2) / h, 14);
    view.zoom = Math.max(1, scale);
    const cxWorld = (minX + maxX) / 2, cyWorld = (minY + maxY) / 2;
    view.panX = cw / 2 - cxWorld * view.zoom;
    view.panY = ch / 2 - cyWorld * view.zoom;
  }

  // ---------------------------------------------------------------------
  // LAYER TOGGLES
  // ---------------------------------------------------------------------

  const layerState = { water: true, boundary: true, firstDue: false, fdc: false, lockedGates: false, blockedStreets: false, sectors: false, neighborhoods: false, landmarks: false };
  document.querySelectorAll("#layerList input[data-layer]").forEach((input) => {
    input.addEventListener("change", () => {
      layerState[input.dataset.layer] = input.checked;
      if (input.dataset.layer === "sectors") updateSectorControlsVisibility();
      render();
    });
  });

  // ---------------------------------------------------------------------
  // SECTORS + LOCK-TO-SECTOR
  // ---------------------------------------------------------------------
  // Real Portland "Administrative Sextants" data (City of Portland ArcGIS,
  // see fetch_sectors.py) — 5 colloquial quadrants shipped (N/NE/NW/SE/SW;
  // South Portland deliberately dropped, docs/decisions.md). Drawn as
  // faint dashed lines, never color-only (each carries a visible label).

  const SECTOR_FULL_NAME = { N: "North", NE: "Northeast", NW: "Northwest", SE: "Southeast", SW: "Southwest" };

  function drawSectors() {
    const sectorColor = "rgba(79,143,99,0.55)"; // same civic hue as the city boundary, lower opacity
    D.sectors.features.forEach((f) => {
      ringsOf(f.geometry).forEach((ring) => drawLine(ring, sectorColor, 1.2, [6, 5]));
    });
    D.sectors.features.forEach((f) => {
      const { minLon, minLat, maxLon, maxLat } = polygonBBox(f);
      const { x, y } = toScreen((minLon + maxLon) / 2, (minLat + maxLat) / 2);
      const code = f.properties.PREFIX;
      ctx.font = "600 11px 'IBM Plex Mono', monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const label = code + (sectorLabelsExpanded ? ` — ${SECTOR_FULL_NAME[code]}` : "");
      const w = ctx.measureText(label).width;
      ctx.fillStyle = "rgba(10,14,15,0.6)";
      ctx.fillRect(x - w / 2 - 4, y - 8, w + 8, 16);
      ctx.fillStyle = "rgba(180,214,192,0.9)";
      ctx.fillText(label, x, y);
    });
  }

  let sectorLabelsExpanded = false; // short code by default; full name the first time the layer is shown
  let sectorsEverShown = false;

  function updateSectorControlsVisibility() {
    const on = layerState.sectors;
    sectorLockControls.hidden = !on;
    if (on && !sectorsEverShown) {
      sectorLabelsExpanded = true;
      sectorsEverShown = true;
      setTimeout(() => { sectorLabelsExpanded = false; render(); }, 4000);
    }
    if (!on) {
      lockToggleInput.checked = false;
      sectorButtons.hidden = true;
      unlockSector();
    }
  }

  const sectorLockControls = document.getElementById("sectorLockControls");
  const lockToggleInput = document.getElementById("lockToSector");
  const sectorButtons = document.getElementById("sectorButtons");

  function unlockSector() {
    lockedSector = null;
    resetView();
  }

  function lockToSectorCode(code) {
    const feature = D.sectors.features.find((f) => f.properties.PREFIX === code);
    if (!feature) return;
    const { minLon, minLat, maxLon, maxLat } = polygonBBox(feature);
    const c1 = toWorld(minLon, maxLat), c2 = toWorld(maxLon, minLat);
    const bx0 = Math.min(c1.wx, c2.wx) * fitScale + fitOffX;
    const bx1 = Math.max(c1.wx, c2.wx) * fitScale + fitOffX;
    const by0 = Math.min(c1.wy, c2.wy) * fitScale + fitOffY;
    const by1 = Math.max(c1.wy, c2.wy) * fitScale + fitOffY;
    const pad = 20;
    const scale = Math.min((cw - pad * 2) / (bx1 - bx0), (ch - pad * 2) / (by1 - by0), 40);
    view.zoom = Math.max(0.2, scale);
    view.panX = cw / 2 - ((bx0 + bx1) / 2) * view.zoom;
    view.panY = ch / 2 - ((by0 + by1) / 2) * view.zoom;
    lockedSector = { bx0, by0, bx1, by1 };
    clampPan();
    render();
    document.querySelectorAll("#sectorButtons button").forEach((b) => {
      const active = b.dataset.sector === code;
      b.classList.toggle("is-active", active);
      b.setAttribute("aria-pressed", String(active));
    });
  }

  lockToggleInput.addEventListener("change", () => {
    sectorButtons.hidden = !lockToggleInput.checked;
    if (!lockToggleInput.checked) unlockSector();
  });
  sectorButtons.querySelectorAll("button[data-sector]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (!lockToggleInput.checked) return;
      lockToSectorCode(btn.dataset.sector);
    });
  });

  // ---------------------------------------------------------------------
  // NEIGHBORHOODS + LANDMARKS
  // ---------------------------------------------------------------------
  // Real Portland data, same honesty standard as sectors: neighborhoods
  // from Public/Boundaries/MapServer/1 (125 official boundaries, see
  // fetch_neighborhoods.py); landmarks is hospitals only from
  // Public_Safety_Places/MapServer/2 (see fetch_landmarks.py's header
  // comment for why bridges were investigated and dropped). Both are
  // secondary reference layers, off by default, drawn at lower visual
  // weight than sectors (thinner lines, no expand-on-first-show) since
  // sectors already own the "primary geography" role.

  function drawNeighborhoods() {
    const lineColor = "rgba(140,150,200,0.35)";
    D.neighborhoods.features.forEach((f) => {
      ringsOf(f.geometry).forEach((ring) => drawLine(ring, lineColor, 0.8, [3, 4]));
    });
    D.neighborhoods.features.forEach((f) => {
      const { minLon, minLat, maxLon, maxLat } = polygonBBox(f);
      const { x, y } = toScreen((minLon + maxLon) / 2, (minLat + maxLat) / 2);
      const name = f.properties.NAME;
      if (!name) return;
      ctx.font = "500 9px 'IBM Plex Mono', monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(170,178,210,0.75)";
      ctx.fillText(name, x, y);
    });
  }

  function drawLandmarks() {
    D.landmarks.features.forEach((f) => {
      const [lon, lat] = f.geometry.coordinates;
      const { x, y } = toScreen(lon, lat);
      // Plus/cross glyph -- distinct shape from every other marker on the
      // map (stations/FDC/gates/blocked-streets all use different shapes
      // already; color + shape pairing, never color alone).
      ctx.strokeStyle = "#E85EA0";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - 4, y); ctx.lineTo(x + 4, y);
      ctx.moveTo(x, y - 4); ctx.lineTo(x, y + 4);
      ctx.stroke();
      if (f.properties.name) {
        ctx.font = "500 9px 'IBM Plex Mono', monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = "rgba(232,94,160,0.85)";
        ctx.fillText(f.properties.name, x, y + 6);
      }
    });
  }

  // ---------------------------------------------------------------------
  // RENDERING
  // ---------------------------------------------------------------------

  function hueColor(i, n, alpha) {
    const hue = Math.round((360 * i) / n);
    return `hsla(${hue}, 55%, 55%, ${alpha})`;
  }

  function drawPolygonLayer(fc, fill, stroke, lineWidth) {
    fc.features.forEach((f) => {
      ringsOf(f.geometry).forEach((ring) => {
        ctx.beginPath();
        ring.forEach(([lon, lat], i) => {
          const { x, y } = toScreen(lon, lat);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.closePath();
        if (fill) { ctx.fillStyle = fill; ctx.fill(); }
        if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth || 1; ctx.stroke(); }
      });
    });
  }

  function drawFirstDue() {
    D.firstDue.features.forEach((f) => {
      const idx = STATION_NUMBERS.indexOf(f.properties.STATION);
      const col = hueColor(idx, STATION_NUMBERS.length, 0.16);
      const colStroke = hueColor(idx, STATION_NUMBERS.length, 0.55);
      ringsOf(f.geometry).forEach((ring) => {
        ctx.beginPath();
        ring.forEach(([lon, lat], i) => {
          const { x, y } = toScreen(lon, lat);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.closePath();
        ctx.fillStyle = col; ctx.fill();
        ctx.strokeStyle = colStroke; ctx.lineWidth = 1; ctx.stroke();
      });
    });
  }

  function drawPointMarker(lon, lat, shape, color, size) {
    const { x, y } = toScreen(lon, lat);
    ctx.fillStyle = color;
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    ctx.lineWidth = 1;
    if (shape === "circle") {
      ctx.beginPath(); ctx.arc(x, y, size, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    } else if (shape === "triangle") {
      ctx.beginPath();
      ctx.moveTo(x, y - size); ctx.lineTo(x + size, y + size * 0.8); ctx.lineTo(x - size, y + size * 0.8);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    } else if (shape === "square") {
      ctx.fillRect(x - size, y - size, size * 2, size * 2);
      ctx.strokeRect(x - size, y - size, size * 2, size * 2);
    } else if (shape === "diamond") {
      ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4);
      ctx.fillRect(-size, -size, size * 2, size * 2);
      ctx.strokeRect(-size, -size, size * 2, size * 2);
      ctx.restore();
    } else if (shape === "house") {
      const w = size * 1.7, roofH = size * 1.1, wallH = size * 1.3;
      ctx.beginPath();
      ctx.moveTo(x, y - roofH - wallH / 2);
      ctx.lineTo(x + w / 2, y - wallH / 2);
      ctx.lineTo(x + w / 2, y + wallH / 2);
      ctx.lineTo(x - w / 2, y + wallH / 2);
      ctx.lineTo(x - w / 2, y - wallH / 2);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
    }
    return { x, y };
  }

  function drawPoints(fc, shape, color, size) {
    fc.features.forEach((f) => drawPointMarker(f.geometry.coordinates[0], f.geometry.coordinates[1], shape, color, size));
  }

  function drawLine(coords, color, width, dash) {
    ctx.save();
    ctx.setLineDash(dash || []);
    ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.beginPath();
    coords.forEach(([lon, lat], i) => {
      const { x, y } = toScreen(lon, lat);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
    ctx.restore();
  }

  function stationVisual(f) {
    const shared = f.properties.DISTRICT === "PORTLAND/GRESHAM - SHARED";
    return shared ? { shape: "house", color: "#E8933F" } : { shape: "house", color: "#E8503F" };
  }

  function drawStationNumber(lon, lat, text, color) {
    const { x, y } = toScreen(lon, lat);
    ctx.font = "600 10px " + "'IBM Plex Mono', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillStyle = "rgba(10,14,15,0.75)";
    const w = ctx.measureText(text).width;
    ctx.fillRect(x - w / 2 - 2, y - 15, w + 4, 11);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y - 5);
  }

  function drawStations(opts) {
    opts = opts || {};
    D.stations.features.forEach((f) => {
      const [lon, lat] = f.geometry.coordinates;
      if (opts.blind) {
        drawPointMarker(lon, lat, "circle", "#C7CFC9", 4);
        if (opts.showNumbers) drawStationNumber(lon, lat, f.properties.STATION, "#C7CFC9");
        return;
      }
      const v = stationVisual(f);
      let size = 5;
      let color = v.color;
      if (opts.highlight && opts.highlight.has(f.properties.STATION)) {
        size = 7;
        color = opts.highlight.get(f.properties.STATION);
      }
      drawPointMarker(lon, lat, v.shape, color, size);
    });
  }

  let currentRouteMode = "geographic";
  let currentLegIndex = 0;

  let renderScheduled = false;
  function render() {
    if (renderScheduled) return;
    renderScheduled = true;
    requestAnimationFrame(() => {
      renderScheduled = false;
      renderNow();
    });
  }

  function renderNow() {
    if (!cw || !ch) return;
    ctx.clearRect(0, 0, cw, ch);
    repositionPopup();

    if (layerState.water) drawPolygonLayer(D.water, "rgba(76,140,168,0.35)", "rgba(76,140,168,0.6)", 1);
    if (layerState.boundary) drawPolygonLayer(D.boundary, "rgba(79,143,99,0.06)", "rgba(79,143,99,0.8)", 1.4);
    if (layerState.neighborhoods) drawNeighborhoods();
    if (layerState.sectors) drawSectors();
    if (layerState.landmarks) drawLandmarks();
    if (layerState.firstDue) drawFirstDue();
    if (layerState.fdc) drawPoints(D.fdc, "square", "#1A9CA6", 3.4);
    if (layerState.lockedGates) drawPoints(D.lockedGates, "triangle", "#FFA82E", 3.6);
    if (layerState.blockedStreets) drawPoints(D.blockedStreets, "diamond", "#D6451E", 3.8);

    if (currentMode === "route") {
      const fc = currentRouteMode === "geographic" ? D.routeGeographic : D.routeNumeric;
      const legs = [...fc.features].sort((a, b) => a.properties.SEQ - b.properties.SEQ);
      legs.forEach((leg, i) => {
        const isCurrent = i === currentLegIndex;
        drawLine(leg.geometry.coordinates, isCurrent ? "#FFA82E" : "rgba(255,168,46,0.18)", isCurrent ? 2.6 : 1.2);
      });
      const active = legs[currentLegIndex];
      const highlight = new Map();
      if (active) {
        highlight.set(active.properties.FROM_STATION, "#3FBE72");
        highlight.set(active.properties.TO_STATION, "#FFA82E");
      }
      drawStations({ highlight });
    } else if (currentMode === "blind") {
      drawStations({ blind: true, showNumbers: blindShowNumbers });
      if (blindState.wrongPoint) {
        drawPointMarker(blindState.wrongPoint.lon, blindState.wrongPoint.lat, "circle", "#E8503F", 7);
      }
      if (blindState.revealNumber) {
        const f = STATIONS[blindState.revealNumber];
        const [lon, lat] = f.geometry.coordinates;
        drawPointMarker(lon, lat, "circle", "#3FBE72", 8);
      }
    } else if (currentMode === "flashcard") {
      const highlight = new Map();
      if (flashState.revealNumber) highlight.set(flashState.revealNumber, flashState.revealColor);
      drawStations({ highlight });
    } else {
      drawStations();
    }

    drawScaleBar();
    drawNorthArrow();
  }

  // ---------------------------------------------------------------------
  // SCALE BAR + NORTH ARROW
  // ---------------------------------------------------------------------
  // Always-on cartographic chrome (not a toggleable layer -- these are
  // wayfinding elements, not data). DESIGN_BRIEF.md requires both on any
  // exported view; the live interactive map had neither until now.
  // Bottom-left, stacked just above the existing DOM coord-readout pill
  // (styles.css .coord-readout, left:10px/bottom:10px) so they don't
  // overlap it.

  // "Nice" round distance (1/2/5 x a power of ten) closest to a target
  // real-world span, in miles -- standard scale-bar algorithm.
  function niceMiles(targetMiles) {
    if (targetMiles <= 0) return 0.1;
    const magnitude = Math.pow(10, Math.floor(Math.log10(targetMiles)));
    const steps = [1, 2, 5, 10];
    let best = steps[0] * magnitude;
    steps.forEach((s) => {
      if (Math.abs(s * magnitude - targetMiles) < Math.abs(best - targetMiles)) best = s * magnitude;
    });
    return best;
  }

  // World units here are latitude-degree-equivalents (toWorld's latCorr
  // normalizes longitude to the same scale as latitude) -- 1 degree of
  // latitude is ~69.0 statute miles, a constant good to a fraction of a
  // percent at any longitude once that correction's applied.
  const MILES_PER_WORLD_UNIT = 69.0;

  function drawScaleBar() {
    const pxPerWorldUnit = fitScale * view.zoom;
    const pxPerMile = pxPerWorldUnit / MILES_PER_WORLD_UNIT;
    if (!isFinite(pxPerMile) || pxPerMile <= 0) return;
    const targetPx = 90;
    const miles = niceMiles(targetPx / pxPerMile);
    const barPx = miles * pxPerMile;
    const label = miles < 1 ? `${(miles * 5280).toFixed(0)} ft` : `${miles} mi`;

    const x0 = 14, y = ch - 46;
    ctx.save();
    ctx.strokeStyle = "rgba(232,237,233,0.85)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x0, y); ctx.lineTo(x0 + barPx, y);
    ctx.moveTo(x0, y - 4); ctx.lineTo(x0, y + 4);
    ctx.moveTo(x0 + barPx, y - 4); ctx.lineTo(x0 + barPx, y + 4);
    ctx.stroke();
    ctx.font = "500 10px 'IBM Plex Mono', monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillStyle = "rgba(232,237,233,0.85)";
    ctx.fillText(label, x0, y - 6);
    ctx.restore();
  }

  // Projection is always north-up (no rotation anywhere in the pan/zoom
  // code), so this is a static glyph -- no bearing math needed.
  function drawNorthArrow() {
    const x = 14, yTop = ch - 100, yBottom = ch - 76;
    ctx.save();
    ctx.strokeStyle = "rgba(232,237,233,0.85)";
    ctx.fillStyle = "rgba(232,237,233,0.85)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, yBottom); ctx.lineTo(x, yTop + 6);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, yTop); ctx.lineTo(x - 4, yTop + 8); ctx.lineTo(x + 4, yTop + 8);
    ctx.closePath();
    ctx.fill();
    ctx.font = "600 10px 'IBM Plex Mono', monospace";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.fillText("N", x, yTop - 2);
    ctx.restore();
  }

  // ---------------------------------------------------------------------
  // STATION HIT TESTING + POPUP (map mode)
  // ---------------------------------------------------------------------

  const popup = document.createElement("div");
  popup.className = "popup";
  popup.style.display = "none";
  screenEl.appendChild(popup);

  const POPUP_TABS = [
    { id: "overview", label: "Overview" },
    { id: "info", label: "Station Info" },
    { id: "history", label: "History" },
  ];
  let popupTab = "overview";

  function listOrPlaceholder(items) {
    if (!items || !items.length) return `<p class="popup-empty">Not yet available.</p>`;
    return `<ul class="popup-list">${items.map((i) => `<li>${i}</li>`).join("")}</ul>`;
  }

  function crewList(crew) {
    if (crew == null) return null;
    if (typeof crew === "number") return [`${crew} total per shift`];
    if (typeof crew === "object") return Object.entries(crew).map(([unit, n]) => `${unit}: ${n} per shift`);
    return [String(crew)];
  }

  function sourcesHtml(profile) {
    if (!profile || !profile.sources || !profile.sources.length) return "";
    const links = profile.sources
      .map((url) => `<a href="${url}" target="_blank" rel="noopener">${new URL(url).hostname.replace(/^www\./, "")}</a>`)
      .join(", ");
    return `<p class="popup-sources">Sources: ${links}</p>`;
  }

  function popupPanelContent(hit, tab) {
    const p = hit.properties;
    const profile = p.profile || null;
    if (tab === "overview") {
      const [lon, lat] = hit.geometry.coordinates;
      const gmapsUrl = `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
      return `
        <span>${p.ADDRESS}</span>
        <a class="popup-gmaps" href="${gmapsUrl}" target="_blank" rel="noopener noreferrer">Open in Google Maps &rarr;</a>
      `;
    }
    if (tab === "info") {
      return `
        <p class="popup-field-label">Apparatus</p>
        ${listOrPlaceholder(profile && profile.apparatus)}
        <p class="popup-field-label">Crew per shift</p>
        ${listOrPlaceholder(crewList(profile && profile.crew_per_shift))}
        <p class="popup-field-label">Specialties</p>
        ${listOrPlaceholder(profile && profile.specialties)}
        ${profile && profile.notes ? `<p class="popup-note">${profile.notes}</p>` : ""}
        ${sourcesHtml(profile)}
      `;
    }
    if (tab === "history") {
      return `
        ${profile && profile.history
          ? `<p class="popup-history">${profile.history}</p>`
          : `<p class="popup-empty">Not yet available.</p>`}
        ${sourcesHtml(profile)}
      `;
    }
    return "";
  }

  function renderPopupTabs(hit) {
    const tabsHtml = POPUP_TABS.map((t) => `
      <button class="popup-tab${t.id === popupTab ? " is-active" : ""}" data-tab="${t.id}"
        role="tab" aria-selected="${t.id === popupTab}">${t.label}</button>
    `).join("");
    popup.innerHTML = `
      <div class="popup-head">
        <div>
          <span class="popup-station-eyebrow">Station</span>
          <span class="popup-station-num">${hit.properties.STATION}</span>
        </div>
        <button class="popup-close" aria-label="Close station card">&times;</button>
      </div>
      <div class="popup-tabs" role="tablist" aria-label="Station details">${tabsHtml}</div>
      <div class="popup-panel">${popupPanelContent(hit, popupTab)}</div>
    `;
  }

  function clampPopupToScreen() {
    const screenRect = screenEl.getBoundingClientRect();
    const popRect = popup.getBoundingClientRect();
    let dx = 0, dy = 0;
    if (popRect.left < screenRect.left) dx = screenRect.left - popRect.left;
    if (popRect.right > screenRect.right) dx = screenRect.right - popRect.right;
    if (popRect.top < screenRect.top) dy = screenRect.top - popRect.top;
    if (dx || dy) {
      const curLeft = parseFloat(popup.style.left) || 0;
      const curTop = parseFloat(popup.style.top) || 0;
      popup.style.left = (curLeft + dx) + "px";
      popup.style.top = (curTop + dy) + "px";
    }
  }

  let currentPopupHit = null;

  function openPopup(hit, x, y) {
    currentPopupHit = hit;
    popupTab = "overview";
    popup.style.left = x + "px";
    popup.style.top = y + "px";
    renderPopupTabs(hit);
    popup.style.display = "block";
    clampPopupToScreen();
  }

  function closePopup() {
    currentPopupHit = null;
    popup.style.display = "none";
  }

  function repositionPopup() {
    if (!currentPopupHit || popup.style.display === "none") return;
    const { x, y } = toScreen(currentPopupHit.geometry.coordinates[0], currentPopupHit.geometry.coordinates[1]);
    popup.style.left = x + "px";
    popup.style.top = y + "px";
    clampPopupToScreen();
  }

  popup.addEventListener("click", (e) => {
    const tabBtn = e.target.closest(".popup-tab");
    if (tabBtn) {
      popupTab = tabBtn.dataset.tab;
      renderPopupTabs(currentPopupHit);
      clampPopupToScreen();
      return;
    }
    if (e.target.closest(".popup-close")) { closePopup(); }
  });

  function nearestStation(sx, sy, tolerance) {
    let best = null, bestD = tolerance;
    D.stations.features.forEach((f) => {
      const { x, y } = toScreen(f.geometry.coordinates[0], f.geometry.coordinates[1]);
      const d = Math.hypot(x - sx, y - sy);
      if (d < bestD) { bestD = d; best = f; }
    });
    return best;
  }

  function handleCanvasClick(e) {
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;

    if (currentMode === "blind") { handleBlindClick(sx, sy); return; }
    if (currentMode !== "map") { closePopup(); return; }

    const hit = nearestStation(sx, sy, 22);
    if (!hit) { closePopup(); return; }
    const { x, y } = toScreen(hit.geometry.coordinates[0], hit.geometry.coordinates[1]);
    openPopup(hit, x, y);
  }

  // ---------------------------------------------------------------------
  // SCORE
  // ---------------------------------------------------------------------

  const scoreEls = {
    correct: document.getElementById("scoreCorrect"),
    attempts: document.getElementById("scoreAttempts"),
    streak: document.getElementById("scoreStreak"),
  };
  let score = { correct: 0, attempts: 0, streak: 0 };
  try {
    const saved = JSON.parse(localStorage.getItem("pfrmdt_score") || "null");
    if (saved) score = saved;
  } catch (e) { /* ignore corrupt storage */ }

  function paintScore() {
    scoreEls.correct.textContent = score.correct;
    scoreEls.attempts.textContent = score.attempts;
    scoreEls.streak.textContent = score.streak;
    try { localStorage.setItem("pfrmdt_score", JSON.stringify(score)); } catch (e) { /* ignore */ }
  }
  paintScore();

  document.getElementById("resetScore").onclick = () => {
    score = { correct: 0, attempts: 0, streak: 0 };
    paintScore();
  };

  function recordAnswer(isCorrect, stationId) {
    score.attempts += 1;
    if (isCorrect) { score.correct += 1; score.streak += 1; } else { score.streak = 0; }
    paintScore();
    // If embedded in the PFR Recruit Hub, report the answer so it can be
    // recorded against real per-student mastery tracking. No-ops (and
    // stays silent) when opened standalone — this site works fully on
    // its own either way.
    if (window.parent !== window && stationId != null) {
      try {
        window.parent.postMessage(
          { type: "pfr-map:answer", stationId: String(stationId), correct: !!isCorrect },
          "*"
        );
      } catch (e) { /* ignore — standalone or blocked, not fatal */ }
    }
  }

  // Shuffle bag (makeShuffleBag) now lives in geometry.js.

  // ---------------------------------------------------------------------
  // MODE: FLASHCARD
  // ---------------------------------------------------------------------

  const readoutEl = document.getElementById("readout");
  const flashBag = makeShuffleBag(STATION_NUMBERS);
  const flashState = { current: null, answered: false, revealNumber: null, revealColor: null };

  function flashChoices(correctNum) {
    const distractors = STATION_NUMBERS.filter((n) => n !== correctNum);
    for (let i = distractors.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [distractors[i], distractors[j]] = [distractors[j], distractors[i]];
    }
    const choices = [correctNum, ...distractors.slice(0, 3)];
    for (let i = choices.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [choices[i], choices[j]] = [choices[j], choices[i]];
    }
    return choices;
  }

  function renderFlashcard() {
    const num = flashState.current;
    const f = STATIONS[num];
    flashState.answered = false;
    flashState.revealNumber = null;
    const choices = flashChoices(num);

    readoutEl.innerHTML = `
      <div class="card">
        <div class="card-prompt">
          <p class="card-eyebrow">Which station is at this address?</p>
          <p class="card-main">${f.properties.ADDRESS}</p>
          <p class="feedback-line" id="fbLine" aria-live="polite">&nbsp;</p>
        </div>
        <div class="choices" id="fbChoices">
          ${choices.map((c) => `<button class="choice-btn" data-num="${c}">${c}</button>`).join("")}
        </div>
        <button class="next-btn" id="fbNext" disabled>Next &rarr;</button>
      </div>`;

    document.querySelectorAll("#fbChoices .choice-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (flashState.answered) return;
        flashState.answered = true;
        const chosen = btn.dataset.num;
        const correct = chosen === num;
        document.querySelectorAll("#fbChoices .choice-btn").forEach((b) => {
          b.disabled = true;
          if (b.dataset.num === num) b.classList.add("correct");
          else if (b === btn) b.classList.add("incorrect");
        });
        const fb = document.getElementById("fbLine");
        if (correct) {
          fb.textContent = `Correct — Station ${num}.`;
          fb.className = "feedback-line ok";
          flashState.revealNumber = num; flashState.revealColor = "#3FBE72";
        } else {
          fb.textContent = `Not quite — that's Station ${num}, not ${chosen}.`;
          fb.className = "feedback-line bad";
          flashState.revealNumber = num; flashState.revealColor = "#FFA82E";
        }
        recordAnswer(correct, num);
        render();
        document.getElementById("fbNext").disabled = false;
      });
    });
    document.getElementById("fbNext").addEventListener("click", nextFlashcard);
    render();
  }

  function nextFlashcard() {
    flashState.current = flashBag.next();
    renderFlashcard();
  }

  // ---------------------------------------------------------------------
  // MODE: ROUTE
  // ---------------------------------------------------------------------

  const routeControls = document.getElementById("routeControls");

  function renderRoute() {
    const fc = currentRouteMode === "geographic" ? D.routeGeographic : D.routeNumeric;
    const legs = [...fc.features].sort((a, b) => a.properties.SEQ - b.properties.SEQ);
    const leg = legs[currentLegIndex];

    readoutEl.innerHTML = `
      <div class="card">
        <div class="card-prompt">
          <p class="card-eyebrow">${currentRouteMode === "geographic" ? "Recommended drive order (approx.)" : "Numeric roster order"} — Leg ${leg.properties.SEQ} of ${legs.length}</p>
          <p class="card-main">Station ${leg.properties.FROM_STATION} &rarr; Station ${leg.properties.TO_STATION}</p>
          <p class="card-sub">${leg.properties.FROM_ADDR} &nbsp;→&nbsp; ${leg.properties.TO_ADDR}</p>
        </div>
        <div class="leg-nav">
          <button id="legPrev" aria-label="Previous leg">&larr;</button>
          <span class="leg-counter">${currentLegIndex + 1} / ${legs.length}</span>
          <button id="legNext" aria-label="Next leg">&rarr;</button>
        </div>
      </div>`;

    document.getElementById("legPrev").onclick = () => {
      currentLegIndex = (currentLegIndex - 1 + legs.length) % legs.length;
      frameStations([leg.properties.FROM_STATION, leg.properties.TO_STATION]);
      renderRoute();
    };
    document.getElementById("legNext").onclick = () => {
      currentLegIndex = (currentLegIndex + 1) % legs.length;
      frameStations([leg.properties.FROM_STATION, leg.properties.TO_STATION]);
      renderRoute();
    };
    frameStations([leg.properties.FROM_STATION, leg.properties.TO_STATION]);
    render();
  }

  // ---------------------------------------------------------------------
  // MODE: BLIND MAP
  // ---------------------------------------------------------------------

  const blindBag = makeShuffleBag(STATION_NUMBERS);
  const blindState = { current: null, answered: false, revealNumber: null, wrongPoint: null };
  const blindControls = document.getElementById("blindControls");
  const blindShowNumbersInput = document.getElementById("blindShowNumbers");
  let blindShowNumbers = false;
  blindShowNumbersInput.addEventListener("change", () => {
    blindShowNumbers = blindShowNumbersInput.checked;
    render();
  });

  function renderBlind() {
    const num = blindState.current;
    const f = STATIONS[num];
    blindState.answered = false;
    blindState.revealNumber = null;
    blindState.wrongPoint = null;

    readoutEl.innerHTML = `
      <div class="card">
        <div class="card-prompt">
          <p class="card-eyebrow">Click the map position for this station</p>
          <p class="card-main">Station ${num}</p>
          <p class="card-sub">${f.properties.ADDRESS}</p>
          <p class="feedback-line" id="blLine" aria-live="polite">&nbsp;</p>
        </div>
        <button class="next-btn" id="blNext" disabled>Next &rarr;</button>
      </div>`;
    document.getElementById("blNext").addEventListener("click", nextBlind);
    render();
  }

  function handleBlindClick(sx, sy) {
    if (blindState.answered) return;
    const target = STATIONS[blindState.current];
    const targetScreen = toScreen(target.geometry.coordinates[0], target.geometry.coordinates[1]);
    const d = Math.hypot(sx - targetScreen.x, sy - targetScreen.y);
    const correct = d < 22;
    blindState.answered = true;
    blindState.revealNumber = blindState.current;
    const fb = document.getElementById("blLine");
    if (correct) {
      fb.textContent = `Correct — that's Station ${blindState.current}.`;
      fb.className = "feedback-line ok";
    } else {
      const { lon, lat } = toLonLat(sx, sy);
      blindState.wrongPoint = { lon, lat };
      fb.textContent = `Not quite — your guess is in red, Station ${blindState.current}'s real spot is in green.`;
      fb.className = "feedback-line bad";
    }
    recordAnswer(correct, blindState.current);
    document.getElementById("blNext").disabled = false;
    render();
  }

  function nextBlind() {
    blindState.current = blindBag.next();
    renderBlind();
  }

  // ---------------------------------------------------------------------
  // MODE SWITCHING
  // ---------------------------------------------------------------------

  let currentMode = "map";
  const readoutIdle = `<div class="readout-idle"><p class="readout-hint">MAP MODE &mdash; pan, zoom, tap a station for its info card.</p></div>`;

  function setMode(mode) {
    currentMode = mode;
    document.querySelectorAll(".mode-btn[data-mode]").forEach((b) => {
      const active = b.dataset.mode === mode;
      b.classList.toggle("is-active", active);
      b.setAttribute("aria-selected", String(active));
    });
    routeControls.hidden = mode !== "route";
    blindControls.hidden = mode !== "blind";
    closePopup();
    resetView();

    if (mode === "flashcard") { nextFlashcard(); }
    else if (mode === "route") { currentLegIndex = 0; renderRoute(); }
    else if (mode === "blind") { nextBlind(); }
    else { readoutEl.innerHTML = readoutIdle; render(); }
  }

  document.querySelectorAll(".mode-btn[data-mode]").forEach((btn) => {
    btn.addEventListener("click", () => setMode(btn.dataset.mode));
  });
  document.querySelectorAll(".mode-btn[data-route]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".mode-btn[data-route]").forEach((b) => b.classList.toggle("is-active", b === btn));
      currentRouteMode = btn.dataset.route;
      currentLegIndex = 0;
      renderRoute();
    });
  });

  // ---------------------------------------------------------------------
  // CLOCK
  // ---------------------------------------------------------------------

  function tickClock() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    document.getElementById("clock").textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
  tickClock();
  setInterval(tickClock, 1000);

  // ---------------------------------------------------------------------
  // INIT
  // ---------------------------------------------------------------------

  resizeCanvas();
  render();
})();
