const assert = require("node:assert");
const { ringsOf, polygonBBox, clampAxis, makeShuffleBag } = require("./geometry.js");

// --- ringsOf: Polygon vs MultiPolygon vs missing geometry ---
const polyRing = [[[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]]];
assert.deepStrictEqual(ringsOf({ type: "Polygon", coordinates: polyRing }), polyRing);

const multi = [[[[0, 0], [0, 1], [1, 1]]], [[[2, 2], [2, 3], [3, 3]]]];
assert.strictEqual(ringsOf({ type: "MultiPolygon", coordinates: multi }).length, 2);

assert.deepStrictEqual(ringsOf(null), []);
assert.deepStrictEqual(ringsOf({ type: "Point", coordinates: [0, 0] }), []);
console.log("PASS: ringsOf handles Polygon/MultiPolygon/missing geometry");

// --- polygonBBox: simple square, and a MultiPolygon spanning two rings ---
const square = { geometry: { type: "Polygon", coordinates: [[[-122.7, 45.5], [-122.7, 45.6], [-122.6, 45.6], [-122.6, 45.5], [-122.7, 45.5]]] } };
const bbox = polygonBBox(square);
assert.deepStrictEqual(bbox, { minLon: -122.7, minLat: 45.5, maxLon: -122.6, maxLat: 45.6 });

const spanning = { geometry: { type: "MultiPolygon", coordinates: [[[[-122.9, 45.4], [-122.9, 45.45]]], [[[-122.5, 45.7], [-122.5, 45.75]]]] } };
const spanBbox = polygonBBox(spanning);
assert.strictEqual(spanBbox.minLon, -122.9);
assert.strictEqual(spanBbox.maxLon, -122.5);
assert.strictEqual(spanBbox.minLat, 45.4);
assert.strictEqual(spanBbox.maxLat, 45.75);
console.log("PASS: polygonBBox computes correct min/max across rings and MultiPolygon parts");

// --- clampAxis: the pan-clamp math underlying "never draggable out of frame" ---
// Content wider than the canvas at this zoom -> real clamping range applies.
// Extent (canvas) = 800px, content span in fit-space = [0, 1000] at zoom 1 -> span 1000 > 800.
assert.strictEqual(clampAxis(-50, 1, 0, 1000, 800), -50, "within-range pan is untouched");
// b0=0 here, so the max bound is mathematically -0*zoom -- IEEE754 negative
// zero, not a bug (canvas renders -0 and 0 identically); Object.is-based
// assert.strictEqual would fail on strict -0/0, so compare loosely here.
assert.ok(clampAxis(500, 1, 0, 1000, 800) === 0, "pan clamps to the max (left edge) bound");
assert.strictEqual(clampAxis(-500, 1, 0, 1000, 800), -200, "pan clamps to the min (right edge) bound");

// Content narrower than the canvas (zoomed out past fit) -> centers, ignores requested pan entirely.
// span = 400 < extent 800 -> center: (800-400)/2 - 0*1 = 200
assert.strictEqual(clampAxis(9999, 1, 0, 400, 800), 200, "narrower-than-canvas content centers regardless of requested pan");
assert.strictEqual(clampAxis(-9999, 1, 0, 400, 800), 200, "...in either direction");
console.log("PASS: clampAxis clamps within range and centers when content is narrower than the canvas");

// --- makeShuffleBag: no repeats until the bag is exhausted, then reshuffles ---
const items = ["a", "b", "c", "d"];
const bag = makeShuffleBag(items);
const firstPass = new Set();
for (let i = 0; i < items.length; i++) firstPass.add(bag.next());
assert.deepStrictEqual([...firstPass].sort(), [...items].sort(), "first pass draws every item exactly once");

// Second pass (post-reshuffle) also covers every item exactly once.
const secondPass = new Set();
for (let i = 0; i < items.length; i++) secondPass.add(bag.next());
assert.deepStrictEqual([...secondPass].sort(), [...items].sort(), "second pass (after reshuffle) also covers every item exactly once");
console.log("PASS: makeShuffleBag draws without repetition until exhausted, then reshuffles");

console.log("\nAll geometry checks passed.");
