const assert = require("node:assert");
const {
  createPlaceGame, placeAttempt, placeSelect, placeSummary, formatElapsed,
  SPOT_MILES, CLOSE_MILES, distanceMiles, gradeMiles,
  createPinGame, pinsRemaining, pinPlace, pinLift, pinSelect, pinReady, pinCheck, pinSummary, pinRetryOffs, pinScore,
} = require("./place-logic.js");

const nums = ["1", "2", "3", "4"];

// --- a correct drop places the number and counts as a first-try ---
let g = createPlaceGame(nums);
let r = placeAttempt(g, "2", "2", 1000);
assert.strictEqual(r.status, "correct");
assert.ok(r.firstTry && !r.finished);
assert.ok(g.placed.has("2"));
assert.strictEqual(placeSummary(g).left, 3);
console.log("PASS: correct drop places the number as a first try");

// --- a wrong drop is a miss, reveals the marker, and doesn't place anything ---
r = placeAttempt(g, "1", "3", 2000);
assert.strictEqual(r.status, "wrong");
assert.strictEqual(r.station, "3", "reports which station the marker really is");
assert.strictEqual(g.misses, 1);
assert.ok(!g.placed.has("1") && !g.placed.has("3"));
console.log("PASS: wrong drop counts a miss and places nothing");

// --- a number that missed first is placed, but not as a first try ---
r = placeAttempt(g, "1", "1", 3000);
assert.strictEqual(r.status, "correct");
assert.strictEqual(r.firstTry, false);
assert.strictEqual(g.firstTry, 1, "only station 2 was a first try so far");
console.log("PASS: a number that missed first doesn't count as first-try");

// --- dropping on an already-filled marker is free ---
const before = g.misses;
r = placeAttempt(g, "4", "2", 3500);
assert.strictEqual(r.status, "already");
assert.strictEqual(g.misses, before, "no penalty for hitting a filled marker");
console.log("PASS: dropping on a filled marker costs nothing");

// --- hint ring appears after N misses on the same number, and clears when placed ---
g = createPlaceGame(nums, 3);
placeAttempt(g, "4", "1", 0); placeAttempt(g, "4", "2", 0);
assert.strictEqual(g.hint, null, "not yet");
r = placeAttempt(g, "4", "3", 0);
assert.strictEqual(g.hint, "4");
assert.ok(r.hint);
placeAttempt(g, "4", "4", 0);
assert.strictEqual(g.hint, null, "hint clears once the number is placed");
console.log("PASS: hint after repeated misses, cleared on success");

// --- selection toggles, and a placed number can't be re-selected ---
g = createPlaceGame(nums);
assert.strictEqual(placeSelect(g, "2"), "2");
assert.strictEqual(placeSelect(g, "2"), null, "picking the held number again puts it back");
placeSelect(g, "3");
placeAttempt(g, "3", "3", 0);
assert.strictEqual(g.selected, null, "placing the held number clears the selection");
assert.strictEqual(placeSelect(g, "3"), null, "already placed");
console.log("PASS: selection toggles and clears on placement");

// --- finishing: last placement flips done, freezes the clock, summary adds up ---
g = createPlaceGame(["1", "2"]);
placeAttempt(g, "1", "2", 1000);            // miss (marker 2 is still empty)
placeAttempt(g, "1", "1", 4000);
r = placeAttempt(g, "2", "2", 66000);
assert.ok(r.finished);
const s = placeSummary(g);
assert.deepStrictEqual(
  { done: s.done, total: s.total, placed: s.placed, firstTry: s.firstTry, misses: s.misses, elapsedMs: s.elapsedMs },
  { done: true, total: 2, placed: 2, firstTry: 1, misses: 1, elapsedMs: 65000 } // "1" missed first; "2" was clean
);
assert.strictEqual(placeAttempt(g, "1", "1", 99999).status, "done", "no more moves after finishing");
assert.strictEqual(placeSummary(g).elapsedMs, 65000, "clock frozen at finish");
console.log("PASS: finishing freezes the summary");

// --- the clock starts on the first drop, not on creation ---
g = createPlaceGame(nums);
assert.strictEqual(placeSummary(g).elapsedMs, 0);
console.log("PASS: clock hasn't started before the first drop");

// --- all 31 real station numbers can be completed, with exact accounting ---
const all = Array.from({ length: 31 }, (_, i) => String(i + 1));
g = createPlaceGame(all);
all.forEach((n, i) => {
  // A deliberate miss on every 5th number (1, 6, 11, 16, 21, 26). Number 31 would have to
  // miss onto an already-filled marker, which is free, so it is a clean first try.
  if (i % 5 === 0 && n !== "31") placeAttempt(g, n, String(+n + 1), 0);
  placeAttempt(g, n, n, 0);
});
const t = placeSummary(g);
assert.ok(t.done && t.placed === 31, "finishes even when the clock reads 0");
assert.strictEqual(t.misses, 6);
assert.strictEqual(t.firstTry, 31 - 6);
console.log("PASS: full 31-station game accounts for misses and first tries");

assert.strictEqual(formatElapsed(0), "0:00");
assert.strictEqual(formatElapsed(65000), "1:05");
assert.strictEqual(formatElapsed(600000), "10:00");
console.log("PASS: elapsed time formats as m:ss");


// =====================  Intermediate: Pin & Check  =====================

// --- distance: known geometry ---
assert.strictEqual(distanceMiles(-122.6, 45.5, -122.6, 45.5), 0);
assert.ok(Math.abs(distanceMiles(-122, 45, -122, 46) - 69.1) < 0.3, "1 degree of latitude is about 69 miles");
assert.ok(Math.abs(distanceMiles(-122, 45.5, -121, 45.5) - 48.4) < 0.4, "1 degree of longitude at Portland's latitude is about 48 miles");
assert.ok(Math.abs(distanceMiles(-122.6, 45.5, -122.5, 45.6) - distanceMiles(-122.5, 45.6, -122.6, 45.5)) < 1e-9, "symmetric");
console.log("PASS: distanceMiles matches known geometry");

// --- grade bands, including the exact boundaries ---
assert.strictEqual(gradeMiles(0), "spot");
assert.strictEqual(gradeMiles(SPOT_MILES), "spot");
assert.strictEqual(gradeMiles(SPOT_MILES + 0.001), "close");
assert.strictEqual(gradeMiles(CLOSE_MILES), "close");
assert.strictEqual(gradeMiles(CLOSE_MILES + 0.001), "off");
console.log("PASS: grade bands and boundaries");

// Synthetic map: stations on a line of latitude; "north(m)" offsets a pin by m miles.
const truth = { "1": [-122.65, 45.5], "2": [-122.6, 45.5], "3": [-122.55, 45.5] };
const north = (lon, lat, miles) => [lon, lat + miles / 69.09];
let pg = createPinGame(["1", "2", "3"], truth);

// --- pinning: place, move, lift, select ---
assert.ok(pinPlace(pg, "1", ...north(...truth["1"], 0), 1000));
assert.strictEqual(pg.startedAt, 1000, "clock starts on the first pin");
assert.deepStrictEqual(pinsRemaining(pg), ["2", "3"]);
assert.ok(!pinPlace(pg, "99", 0, 0, 1), "can't pin a number that isn't in the round");
pinPlace(pg, "1", ...north(...truth["1"], 0.2), 1500);
assert.strictEqual(pinsRemaining(pg).length, 2, "moving a pin doesn't add one");
assert.ok(pinLift(pg, "1"));
assert.strictEqual(pg.selected, "1", "a lifted pin becomes the held number");
assert.strictEqual(pinsRemaining(pg).length, 3);
assert.strictEqual(pinSelect(pg, "2"), "2");
assert.strictEqual(pinSelect(pg, "2"), null, "selecting again puts it back");
console.log("PASS: pins can be placed, moved, lifted and selected");

// --- can't check until every number is down ---
pinPlace(pg, "1", ...north(...truth["1"], 0), 2000);
pinPlace(pg, "2", ...north(...truth["2"], 0.7), 2100);
assert.ok(!pinReady(pg));
assert.strictEqual(pinCheck(pg, 9000), null, "check refuses while a number is missing");
pinPlace(pg, "3", ...north(...truth["3"], 3), 3000);
assert.ok(pinReady(pg));
console.log("PASS: check waits for every number");

// --- check: grades, summary, clock ---
const res = pinCheck(pg, 63000);
assert.deepStrictEqual(res.map((r) => r.grade), ["spot", "close", "off"]);
let sm = pinSummary(pg);
assert.deepStrictEqual({ spot: sm.spot, close: sm.close, off: sm.off, total: sm.total, elapsedMs: sm.elapsedMs, checked: sm.checked },
  { spot: 1, close: 1, off: 1, total: 3, elapsedMs: 62000, checked: true });
assert.ok(Math.abs(sm.avgMiles - (0 + 0.7 + 3) / 3) < 0.02);
assert.strictEqual(sm.worst.num, "3");
assert.ok(!pinPlace(pg, "1", 0, 0, 70000), "pins are frozen after Check");
assert.ok(!pinLift(pg, "1"));
console.log("PASS: check grades by real distance and freezes the round");

// --- retry: only the 'off' numbers return; good pins are locked and still count ---
const retry = pinRetryOffs(pg);
assert.deepStrictEqual(retry.numbers, ["3"]);
assert.deepStrictEqual(Object.keys(retry.locked).sort(), ["1", "2"]);
assert.strictEqual(pinSummary(retry).total, 3, "locked pins still count toward the total");
pinPlace(retry, "3", ...north(...truth["3"], 0.1), 1);
pinCheck(retry, 2);
sm = pinSummary(retry);
assert.deepStrictEqual({ spot: sm.spot, close: sm.close, off: sm.off }, { spot: 3, close: 0, off: 0 }, "locked pins counted as good");
assert.strictEqual(pinRetryOffs(retry), null, "nothing left to retry");
console.log("PASS: retry brings back only the misses");

// --- a perfect round has nothing to retry; scoring prefers more spot-ons, then lower error ---
const perfect = createPinGame(["1"], truth); pinPlace(perfect, "1", ...truth["1"], 0); pinCheck(perfect, 1);
assert.strictEqual(pinRetryOffs(perfect), null);
const A = { spot: 5, close: 0, avgMiles: 2 }, B = { spot: 4, close: 6, avgMiles: 0.5 }, C = { spot: 5, close: 0, avgMiles: 1 };
assert.ok(pinScore(A) > pinScore(B), "spot-ons outrank close ones");
assert.ok(pinScore(C) > pinScore(A), "same grades: lower average miss wins");
console.log("PASS: scoring order");

// --- the real 31 stations as a pin round: pinning every station exactly gives a perfect score ---
const realTruth = Object.fromEntries(Array.from({ length: 31 }, (_, i) => [String(i + 1), [-122.7 + i * 0.004, 45.45 + i * 0.003]]));
const full = createPinGame(Object.keys(realTruth), realTruth);
Object.entries(realTruth).forEach(([n, [lo, la]]) => pinPlace(full, n, lo, la, 5));
pinCheck(full, 10);
assert.deepStrictEqual({ spot: pinSummary(full).spot, off: pinSummary(full).off, total: pinSummary(full).total }, { spot: 31, off: 0, total: 31 });
console.log("PASS: a full 31-pin round can be perfect");

console.log("\nAll place-game checks passed.");
