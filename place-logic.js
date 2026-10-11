// Pure rules for the "Place It" game (drag/tap a station number onto its
// station). Same convention as geometry.js: loaded as a plain global script
// by the page, require()'d by the test suite, no DOM in here -- the board,
// pool and drag handling live in app.js and just call into these.
//
// A game is one plain object. "num" is the number the player is holding,
// "station" is the marker they dropped it on; both are station-number strings
// ("26"), matching how PFR_DATA carries them.

function createPlaceGame(numbers, hintAfter) {
  return {
    numbers: [...numbers],
    hintAfter: hintAfter || 3,   // misses on one number before a hint ring is shown
    placed: new Set(),
    selected: null,
    misses: 0,
    missesFor: {},               // num -> misses on that number
    firstTry: 0,                 // numbers placed correctly with no earlier miss
    hint: null,                  // the number whose target should be ringed, or null
    startedAt: null,
    finishedAt: null,
  };
}

// One drop. Returns { status, ... }:
//   "already" -- that marker is already filled (no penalty, nothing changes)
//   "wrong"   -- counts a miss; reveals which station the marker really is
//   "correct" -- places the number; "finished: true" when it was the last one
function placeAttempt(game, num, station, now) {
  if (game.finishedAt != null) return { status: "done" };
  if (game.placed.has(station)) return { status: "already", station };
  if (game.startedAt == null) game.startedAt = now;

  if (num !== station) {
    game.misses += 1;
    game.missesFor[num] = (game.missesFor[num] || 0) + 1;
    if (game.missesFor[num] >= game.hintAfter) game.hint = num;
    return { status: "wrong", num, station, missesForNum: game.missesFor[num], hint: game.hint === num };
  }

  game.placed.add(num);
  if (!game.missesFor[num]) game.firstTry += 1;
  if (game.selected === num) game.selected = null;
  if (game.hint === num) game.hint = null;
  const finished = game.placed.size === game.numbers.length;
  if (finished) game.finishedAt = now;
  return { status: "correct", num, firstTry: !game.missesFor[num], finished };
}

// Toggle the held number: picking the held one again puts it back.
function placeSelect(game, num) {
  if (game.finishedAt != null || game.placed.has(num)) return game.selected;
  game.selected = game.selected === num ? null : num;
  return game.selected;
}

function placeSummary(game) {
  const total = game.numbers.length;
  return {
    total,
    placed: game.placed.size,
    left: total - game.placed.size,
    firstTry: game.firstTry,
    misses: game.misses,
    done: game.finishedAt != null,
    elapsedMs: game.startedAt == null ? 0 : (game.finishedAt != null ? game.finishedAt : game.startedAt) - game.startedAt,
  };
}

function formatElapsed(ms) {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}


// ---------------------------------------------------------------------------
// Intermediate level: "Pin & Check". No stations are shown. The player drops a
// pin for each number wherever they think the station is, can move or lift
// pins freely, and presses Check once every number is down. Grading is by real
// distance, not screen pixels, so it means the same at any zoom.
// ---------------------------------------------------------------------------

const SPOT_MILES = 0.5;   // "spot on": roughly the right block cluster
const CLOSE_MILES = 1.0;  // "close": right neighborhood; anything further is "off"

// Great-circle distance in miles (haversine).
function distanceMiles(lon1, lat1, lon2, lat2) {
  const R = 3958.8;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function gradeMiles(miles) {
  if (miles <= SPOT_MILES) return "spot";
  if (miles <= CLOSE_MILES) return "close";
  return "off";
}


// ---------------------------------------------------------------------------
// Advanced level: "Response Areas". The player drops each number inside the
// area its station covers (nearest-station zones from the First-Due layer data,
// an approximation of real first-due boxes). A pin inside its area is "spot";
// just outside its edge is "close"; further is "off".
// ---------------------------------------------------------------------------

const AREA_CLOSE_MILES = 0.5;          // outside the area, but this near its edge
const AREA_STATION_SLACK_MILES = 0.25; // a pin this near the station itself counts as inside its area
                                       // (the areas are clipped to the city, so a station at the edge,
                                       // like 27, can sit just outside its own clipped area)

// Even-odd point-in-polygon over a flat list of rings ([[lon,lat],...]); holes and the separate
// parts of a MultiPolygon both work because every ring flips the answer.
function pointInRings(lon, lat, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

// Miles from a point to the nearest edge of the rings; 0 when inside. Local flat-earth maths is fine at
// city scale.
function distanceToRingsMiles(lon, lat, rings) {
  if (pointInRings(lon, lat, rings)) return 0;
  const kx = 69.17 * Math.cos((lat * Math.PI) / 180), ky = 69.09;
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const ax = (ring[j][0] - lon) * kx, ay = (ring[j][1] - lat) * ky;
      const bx = (ring[i][0] - lon) * kx, by = (ring[i][1] - lat) * ky;
      const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
      best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
    }
  }
  return best;
}

function gradeAreaMiles(miles) {
  if (miles <= 0) return "spot";
  if (miles <= AREA_CLOSE_MILES) return "close";
  return "off";
}

// truth: { "26": [lon, lat], ... } for every number that can appear.
// locked: pins carried over from an earlier check (already good), shown but not in play.
function createPinGame(numbers, truth, locked, areas) {
  return {
    kind: "pins",
    numbers: [...numbers],
    truth,
    areas: areas || null,         // optional: { num: rings } -- grade by area instead of by distance to the point
    pins: {},                    // num -> [lon, lat], only for numbers still in play
    locked: locked || {},        // num -> [lon, lat]
    selected: null,
    results: null,               // filled by pinCheck
    startedAt: null,
    checkedAt: null,
  };
}

function pinsRemaining(game) {
  return game.numbers.filter((n) => !game.pins[n]);
}

// Drop or move a pin. Ignored after Check.
function pinPlace(game, num, lon, lat, now) {
  if (game.checkedAt != null || !game.numbers.includes(num)) return false;
  if (game.startedAt == null) game.startedAt = now;
  game.pins[num] = [lon, lat];
  if (game.selected === num) game.selected = null;
  return true;
}

// Lift a pin back into the pool (it becomes the held number).
function pinLift(game, num) {
  if (game.checkedAt != null || !game.pins[num]) return false;
  delete game.pins[num];
  game.selected = num;
  return true;
}

function pinSelect(game, num) {
  if (game.checkedAt != null || game.pins[num] || !game.numbers.includes(num)) return game.selected;
  game.selected = game.selected === num ? null : num;
  return game.selected;
}

function pinReady(game) {
  return game.checkedAt == null && game.numbers.length > 0 && pinsRemaining(game).length === 0;
}

// Grade every pin. Only valid once all numbers are down.
function pinCheck(game, now) {
  if (!pinReady(game)) return null;
  game.checkedAt = now;
  const results = game.numbers.map((num) => {
    const [plon, plat] = game.pins[num];
    const [tlon, tlat] = game.truth[num];
    if (game.areas) {
      let miles = distanceToRingsMiles(plon, plat, game.areas[num]);
      if (miles > 0 && distanceMiles(plon, plat, tlon, tlat) <= AREA_STATION_SLACK_MILES) miles = 0;
      return { num, miles, grade: gradeAreaMiles(miles) };
    }
    const miles = distanceMiles(plon, plat, tlon, tlat);
    return { num, miles, grade: gradeMiles(miles) };
  });
  game.results = results;
  return results;
}

function pinSummary(game) {
  const r = game.results || [];
  const count = (g) => r.filter((x) => x.grade === g).length;
  const total = game.numbers.length + Object.keys(game.locked).length;
  const lockedCount = Object.keys(game.locked).length;
  return {
    total,
    inPlay: game.numbers.length,
    placed: game.numbers.length - pinsRemaining(game).length,
    spot: count("spot") + lockedCount,    // carried-over pins were good already
    close: count("close"),
    off: count("off"),
    retry: count("off") + (game.areas ? count("close") : 0),   // how many Retry would bring back
    avgMiles: r.length ? r.reduce((a, x) => a + x.miles, 0) / r.length : 0,
    worst: r.length ? r.reduce((a, x) => (x.miles > a.miles ? x : a)) : null,
    elapsedMs: game.startedAt == null ? 0 : (game.checkedAt != null ? game.checkedAt : game.startedAt) - game.startedAt,
    checked: game.checkedAt != null,
  };
}

// A follow-up round with only the numbers that were "off"; the good pins stay put, locked.
function pinRetryOffs(game) {
  if (!game.results) return null;
  // Distance rounds retry only the "off" ones ("close" passed). Area rounds retry everything that isn't
  // inside its area -- "near" is only partial credit, and the headline counts "in the right area".
  const needsRetry = (x) => (game.areas ? x.grade !== "spot" : x.grade === "off");
  const offs = game.results.filter(needsRetry).map((x) => x.num);
  if (!offs.length) return null;
  const locked = { ...game.locked };
  game.results.filter((x) => !needsRetry(x)).forEach((x) => { locked[x.num] = game.pins[x.num]; });
  return createPinGame(offs, game.truth, locked, game.areas);
}

// Did this graded pin count as right? Distance rounds: within a mile. Area rounds: inside the area.
function pinCorrect(game, result) {
  return game.areas ? result.grade === "spot" : result.grade !== "off";
}

// Better result = more "spot on", then more "close", then lower average miss.
function pinScore(sum) {
  return sum.spot * 1000 + sum.close * 10 - Math.min(9, sum.avgMiles);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    createPlaceGame, placeAttempt, placeSelect, placeSummary, formatElapsed,
    SPOT_MILES, CLOSE_MILES, distanceMiles, gradeMiles,
    AREA_CLOSE_MILES, AREA_STATION_SLACK_MILES, pointInRings, distanceToRingsMiles, gradeAreaMiles,
    createPinGame, pinsRemaining, pinPlace, pinLift, pinSelect, pinReady, pinCheck, pinSummary, pinRetryOffs, pinScore, pinCorrect,
  };
}
