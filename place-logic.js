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

if (typeof module !== "undefined" && module.exports) {
  module.exports = { createPlaceGame, placeAttempt, placeSelect, placeSummary, formatElapsed };
}
