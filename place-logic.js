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

// truth: { "26": [lon, lat], ... } for every number that can appear.
// locked: pins carried over from an earlier check (already good), shown but not in play.
function createPinGame(numbers, truth, locked) {
  return {
    kind: "pins",
    numbers: [...numbers],
    truth,
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
    avgMiles: r.length ? r.reduce((a, x) => a + x.miles, 0) / r.length : 0,
    worst: r.length ? r.reduce((a, x) => (x.miles > a.miles ? x : a)) : null,
    elapsedMs: game.startedAt == null ? 0 : (game.checkedAt != null ? game.checkedAt : game.startedAt) - game.startedAt,
    checked: game.checkedAt != null,
  };
}

// A follow-up round with only the numbers that were "off"; the good pins stay put, locked.
function pinRetryOffs(game) {
  if (!game.results) return null;
  const offs = game.results.filter((x) => x.grade === "off").map((x) => x.num);
  if (!offs.length) return null;
  const locked = { ...game.locked };
  game.results.filter((x) => x.grade !== "off").forEach((x) => { locked[x.num] = game.pins[x.num]; });
  return createPinGame(offs, game.truth, locked);
}

// Better result = more "spot on", then more "close", then lower average miss.
function pinScore(sum) {
  return sum.spot * 1000 + sum.close * 10 - Math.min(9, sum.avgMiles);
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    createPlaceGame, placeAttempt, placeSelect, placeSummary, formatElapsed,
    SPOT_MILES, CLOSE_MILES, distanceMiles, gradeMiles,
    createPinGame, pinsRemaining, pinPlace, pinLift, pinSelect, pinReady, pinCheck, pinSummary, pinRetryOffs, pinScore,
  };
}
