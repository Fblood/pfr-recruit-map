// Merges station_official.json onto data.js's stations in place, for when the
// QGIS build (build_data.py) isn't available. build_data.py applies the same
// file, so both paths produce identical output. Run: node apply_official.js
const fs = require("fs");
const official = JSON.parse(fs.readFileSync(__dirname + "/station_official.json", "utf8"));
const src = fs.readFileSync(__dirname + "/data.js", "utf8");
const D = JSON.parse(src.replace(/^const PFR_DATA = /, "").replace(/;\s*$/, ""));
let n = 0;
D.stations.features.forEach((f) => {
  const o = official[f.properties.STATION];
  if (!o) return;
  const [c1, c2] = o.cross_streets;
  const old = f.properties.crossStreets || {};
  f.properties.crossStreets = { on_street: old.on_street || null, cross_street_1: c1 || null, cross_street_2: c2 || null };
  f.properties.battalion = o.battalion;
  f.properties.neighborhood = o.neighborhood;
  f.properties.profile = Object.assign({}, f.properties.profile, { units: o.units });
  n++;
});
fs.writeFileSync(__dirname + "/data.js", "const PFR_DATA = " + JSON.stringify(D) + ";\n");
console.log(`patched ${n} stations`);
