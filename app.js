(function () {
  "use strict";

  // ---------------------------------------------------------------------
  // DATA HELPERS
  // ---------------------------------------------------------------------

  const D = PFR_DATA;

  function ringsOf(geometry) {
    if (!geometry) return [];
    if (geometry.type === "Polygon") return geometry.coordinates;
    if (geometry.type === "MultiPolygon") return geometry.coordinates.flat();
    return [];
  }

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
    const newZoom = Math.min(40, Math.max(0.6, view.zoom * factor));
    const cxWorld = (sx - view.panX) / view.zoom;
    const cyWorld = (sy - view.panY) / view.zoom;
    view.panX = sx - cxWorld * newZoom;
    view.panY = sy - cyWorld * newZoom;
    view.zoom = newZoom;
    render();
  }

  function resetView() {
    view.zoom = 1;
    view.panX = 0;
    view.panY = 0;
    render();
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
    render();
  }
  new ResizeObserver(resizeCanvas).observe(screenEl);

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

  const layerState = { water: true, boundary: true, firstDue: false, fdc: false, lockedGates: false, blockedStreets: false };
  document.querySelectorAll("#layerList input[data-layer]").forEach((input) => {
    input.addEventListener("change", () => {
      layerState[input.dataset.layer] = input.checked;
      render();
    });
  });

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
    return shared ? { shape: "triangle", color: "#E8933F" } : { shape: "circle", color: "#E8503F" };
  }

  function drawStations(opts) {
    opts = opts || {};
    D.stations.features.forEach((f) => {
      const [lon, lat] = f.geometry.coordinates;
      if (opts.blind) {
        drawPointMarker(lon, lat, "circle", "#C7CFC9", 4);
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

  function render() {
    if (!cw || !ch) return;
    ctx.clearRect(0, 0, cw, ch);

    if (layerState.water) drawPolygonLayer(D.water, "rgba(76,140,168,0.35)", "rgba(76,140,168,0.6)", 1);
    if (layerState.boundary) drawPolygonLayer(D.boundary, "rgba(79,143,99,0.06)", "rgba(79,143,99,0.8)", 1.4);
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
      drawStations({ blind: true });
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

  function popupPanelContent(hit, tab) {
    const p = hit.properties;
    const profile = p.profile || null;
    if (tab === "overview") {
      return `<span>${p.ADDRESS}</span>`;
    }
    if (tab === "info") {
      const crew = profile && profile.crew_per_shift
        ? Object.entries(profile.crew_per_shift).map(([unit, n]) => `${unit}: ${n} per shift`)
        : null;
      return `
        <p class="popup-field-label">Apparatus</p>
        ${listOrPlaceholder(profile && profile.apparatus)}
        <p class="popup-field-label">Crew per shift</p>
        ${listOrPlaceholder(crew)}
        <p class="popup-field-label">Specialties</p>
        ${listOrPlaceholder(profile && profile.specialties)}
      `;
    }
    if (tab === "history") {
      return profile && profile.history
        ? `<p class="popup-history">${profile.history}</p>`
        : `<p class="popup-empty">Not yet available.</p>`;
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
        <b>Station ${hit.properties.STATION}</b>
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

  popup.addEventListener("click", (e) => {
    const tabBtn = e.target.closest(".popup-tab");
    if (tabBtn) {
      popupTab = tabBtn.dataset.tab;
      renderPopupTabs(currentPopupHit);
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

    const hit = nearestStation(sx, sy, 16);
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

  // ---------------------------------------------------------------------
  // SHUFFLE BAG
  // ---------------------------------------------------------------------

  function makeBag(items) {
    let pool = [];
    function refill() {
      pool = [...items];
      for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
    }
    refill();
    return { next() { if (pool.length === 0) refill(); return pool.pop(); } };
  }

  // ---------------------------------------------------------------------
  // MODE: FLASHCARD
  // ---------------------------------------------------------------------

  const readoutEl = document.getElementById("readout");
  const flashBag = makeBag(STATION_NUMBERS);
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
          <p class="feedback-line" id="fbLine">&nbsp;</p>
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

  const blindBag = makeBag(STATION_NUMBERS);
  const blindState = { current: null, answered: false, revealNumber: null, wrongPoint: null };

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
          <p class="feedback-line" id="blLine">&nbsp;</p>
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
