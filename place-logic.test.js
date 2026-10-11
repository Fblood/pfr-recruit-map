const assert = require("node:assert");
const { createPlaceGame, placeAttempt, placeSelect, placeSummary, formatElapsed } = require("./place-logic.js");

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

console.log("\nAll place-game checks passed.");
