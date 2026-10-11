const assert = require("node:assert");
const {
  createPlaceGame, placeAttempt, placeSelect, placeSummary, formatElapsed,
  SPOT_MILES, CLOSE_MILES, distanceMiles, gradeMiles,
  AREA_CLOSE_MILES, AREA_STATION_SLACK_MILES, pointInRings, distanceToRingsMiles, gradeAreaMiles,
  createPinGame, pinsRemaining, pinPlace, pinLift, pinSelect, pinReady, pinCheck, pinSummary, pinRetryOffs, pinScore, pinCorrect,
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


// =====================  Advanced: Response Areas  =====================

// AREA 0.1 x 0.1 degree square (about 4.8 x 6.9 miles) and a bigger one with a hole in the middle.
const sq = (lon, lat, size) => [[lon, lat], [lon + size, lat], [lon + size, lat + size], [lon, lat + size], [lon, lat]];
const AREA = [sq(-122.6, 45.5, 0.1)];
const mi = (m) => m / 69.09;   // miles of latitude -> degrees

assert.ok(pointInRings(-122.55, 45.55, AREA));
assert.ok(!pointInRings(-122.7, 45.55, AREA));
assert.ok(!pointInRings(-122.55, 45.7, AREA));
console.log("PASS: point-in-area inside/outside");

// holes and multi-part areas (a MultiPolygon is just more rings)
const donut = [sq(-122.6, 45.5, 0.1), sq(-122.57, 45.53, 0.04)];
assert.ok(pointInRings(-122.59, 45.51, donut), "in the ring of the donut");
assert.ok(!pointInRings(-122.55, 45.55, donut), "inside the hole is outside the area");
const twoParts = [sq(-122.6, 45.5, 0.05), sq(-122.4, 45.5, 0.05)];
assert.ok(pointInRings(-122.575, 45.525, twoParts) && pointInRings(-122.375, 45.525, twoParts));
assert.ok(!pointInRings(-122.5, 45.525, twoParts), "the gap between the parts is outside");
console.log("PASS: holes and multi-part areas");

// distance to the edge: 0 inside, otherwise the gap in miles
assert.strictEqual(distanceToRingsMiles(-122.55, 45.55, AREA), 0);
assert.ok(Math.abs(distanceToRingsMiles(-122.55, 45.6 + mi(0.3), AREA) - 0.3) < 0.01, "0.3 mi north of the north edge");
assert.ok(Math.abs(distanceToRingsMiles(-122.55, 45.5 - mi(2), AREA) - 2) < 0.02, "2 mi south of the south edge");
const corner = distanceToRingsMiles(-122.6 - mi(0.3) / 0.7, 45.5 - mi(0.4), AREA);   // off the SW corner: 3-4-5 triangle (x scaled by cos lat)
assert.ok(Math.abs(corner - 0.5) < 0.02, "distance to a corner is the straight-line distance");
console.log("PASS: distance to an area's edge");

// grade bands for areas, including the exact boundary
assert.strictEqual(gradeAreaMiles(0), "spot");
assert.strictEqual(gradeAreaMiles(0.001), "close");
assert.strictEqual(gradeAreaMiles(AREA_CLOSE_MILES), "close");
assert.strictEqual(gradeAreaMiles(AREA_CLOSE_MILES + 0.001), "off");
console.log("PASS: area grade bands");

// a full area-graded round: in, just outside, far outside
const stationPt = { "1": [-122.55, 45.55], "2": [-122.55, 45.55], "3": [-122.55, 45.55] };
const areas = { "1": AREA, "2": AREA, "3": AREA };
let ag = createPinGame(["1", "2", "3"], stationPt, null, areas);
pinPlace(ag, "1", -122.57, 45.52, 0);                       // inside
pinPlace(ag, "2", -122.55, 45.6 + mi(0.3), 0);               // 0.3 mi outside the edge
pinPlace(ag, "3", -122.55, 45.6 + mi(3), 0);                 // 3 mi outside
const ar = pinCheck(ag, 1);
assert.deepStrictEqual(ar.map((r) => r.grade), ["spot", "close", "off"]);
const asum = pinSummary(ag);
assert.deepStrictEqual({ spot: asum.spot, close: asum.close, off: asum.off }, { spot: 1, close: 1, off: 1 });
console.log("PASS: a round graded by area");

// retry keeps grading by area, and brings back everything not inside its area ("near" included)
assert.strictEqual(asum.retry, 2, "summary counts the near and the off pins as retries");
const ar2 = pinRetryOffs(ag);
assert.ok(ar2.areas, "the retry round still has its areas");
assert.deepStrictEqual(ar2.numbers, ["2", "3"], "area rounds retry near AND off");
assert.deepStrictEqual(Object.keys(ar2.locked), ["1"]);
pinPlace(ar2, "2", -122.58, 45.53, 0);
pinPlace(ar2, "3", -122.58, 45.54, 0);
assert.ok(pinCheck(ar2, 2).every((r) => r.grade === "spot"));
assert.strictEqual(pinSummary(ar2).spot, 3, "the locked pin still counts");
console.log("PASS: retry rounds stay area-graded and retry everything outside its area");

// distance rounds are unchanged: only "off" is retried, and close still counts as correct
assert.strictEqual(pinSummary(pg).retry, 1, "distance round: only the off pin is retried");
assert.ok(pinCorrect(pg, { grade: "close" }), "distance round: close counts as correct");
assert.ok(!pinCorrect(ag, { grade: "close" }), "area round: only inside the area counts as correct");
assert.ok(pinCorrect(ag, { grade: "spot" }));
console.log("PASS: what counts as correct depends on the round type");

// a station at the city edge can sit just outside its own clipped area (Station 27): pins right on the
// station still count as inside, but a pin merely near the station's neighborhood does not get a free pass
const edgeStation = { "27": [-122.6 - mi(0.1) / 0.7, 45.55] };   // ~0.1 mi west of the area's west edge
let eg = createPinGame(["27"], edgeStation, null, { "27": AREA });
pinPlace(eg, "27", ...edgeStation["27"], 0);
assert.strictEqual(pinCheck(eg, 1)[0].grade, "spot", "a pin on the station itself is inside its area");
let eg2 = createPinGame(["27"], edgeStation, null, { "27": AREA });
pinPlace(eg2, "27", -122.6 - mi(0.4) / 0.7, 45.55, 0);           // 0.4 mi from the edge, 0.3 mi from the station
assert.strictEqual(pinCheck(eg2, 1)[0].grade, "close", "outside the slack: graded by distance to the edge");
assert.ok(AREA_STATION_SLACK_MILES < AREA_CLOSE_MILES);
console.log("PASS: a station at the city edge isn't marked wrong for being on itself");

console.log("\nAll place-game checks passed.");
