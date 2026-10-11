// Checks the Place It game against the REAL bundled data (data.js), so a data rebuild can't quietly
// break it: every station needs an area, and pinning a station on its own marker must be graded right.
const assert = require("node:assert");
const fs = require("node:fs");
const { ringsOf } = require("./geometry.js");
const { createPinGame, pinPlace, pinCheck, pinSummary, pointInRings } = require("./place-logic.js");

const D = new Function(fs.readFileSync(__dirname + "/data.js", "utf8") + "; return PFR_DATA;")();
const numbers = D.stations.features.map((f) => f.properties.STATION).sort((a, b) => a - b);
const truth = Object.fromEntries(D.stations.features.map((f) => [f.properties.STATION, f.geometry.coordinates]));
const areas = Object.fromEntries(D.firstDue.features.map((f) => [f.properties.STATION, ringsOf(f.geometry)]));

assert.strictEqual(numbers.length, 31);
numbers.forEach((n) => assert.ok(areas[n] && areas[n].length > 0, `station ${n} has an area`));
console.log("PASS: all 31 stations have an area with geometry");

// pin each station exactly on its marker -> every one must count as inside its own area
const g = createPinGame(numbers, truth, null, areas);
numbers.forEach((n) => pinPlace(g, n, truth[n][0], truth[n][1], 0));
const results = pinCheck(g, 1);
const notSpot = results.filter((r) => r.grade !== "spot").map((r) => r.num);
assert.deepStrictEqual(notSpot, [], `stations pinned on their own marker but not graded in-area: ${notSpot}`);
assert.strictEqual(pinSummary(g).spot, 31);
console.log("PASS: pinning every station on its own marker grades all 31 as in the right area");

// the areas tile the city: a random city point is inside exactly one area (borders aside)
let one = 0, tried = 0;
for (let i = 0; i < 300; i++) {
  const lon = -122.84 + ((i * 7919) % 1000) / 1000 * 0.35, lat = 45.43 + ((i * 104729) % 1000) / 1000 * 0.22;
  const owners = numbers.filter((n) => pointInRings(lon, lat, areas[n]));
  if (owners.length === 0) continue;       // outside the city
  tried++;
  if (owners.length === 1) one++;
}
assert.ok(tried > 50, "sampled enough points inside the city");
assert.ok(one / tried > 0.98, `areas overlap too much: ${one}/${tried} points had exactly one owner`);
console.log("PASS: areas don't overlap (each city point belongs to one station)");

console.log("\nAll place-data checks passed.");
