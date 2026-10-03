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
  if (o.photo) f.properties.photo = o.photo; else delete f.properties.photo;
  if (o.address_note) f.properties.addressNote = o.address_note; else delete f.properties.addressNote;
  // Unit codes + notes replace the older free-text apparatus list so the
  // popup shows one table, not two overlapping lists. Anything the sheet
  // doesn't carry (reserve units, historic boats) lives in other_apparatus.
  const profile = Object.assign({}, f.properties.profile, { units: o.units });
  delete profile.apparatus;
  if (o.unit_notes) profile.unitNotes = o.unit_notes; else delete profile.unitNotes;
  if (o.other_apparatus) profile.otherApparatus = o.other_apparatus; else delete profile.otherApparatus;
  f.properties.profile = profile;
  n++;
});
fs.writeFileSync(__dirname + "/data.js", "const PFR_DATA = " + JSON.stringify(D) + ";\n");
console.log(`patched ${n} stations`);
