# Builds a compact data.js bundle for the recruit study web app from the QGIS project's
# source GeoJSON files. Simplifies the heavy background layers (water, boundary, first-due)
# and strips unused fields so the whole bundle stays small and loads fast on GitHub Pages.
# Run with: C:\OSGeo4W\bin\python-qgis.bat build_data.py
import json
import os
import sys

sys.path.append(r"C:\OSGeo4W\apps\qgis\python\plugins")

from qgis.core import QgsApplication, QgsVectorLayer, QgsJsonExporter, QgsFeature

qgs = QgsApplication([], False)
qgs.initQgis()

import processing  # noqa: E402
from processing.core.Processing import Processing  # noqa: E402

Processing.initialize()

SRC_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SRC_DIR)
OUT_PATH = os.path.join(SRC_DIR, "data.js")


def src(name):
    return os.path.join(PROJECT_DIR, name)


def load(name):
    layer = QgsVectorLayer(src(name), name, "ogr")
    if not layer.isValid():
        raise RuntimeError(f"Failed to load {name}")
    return layer


def simplify(layer, tolerance_deg):
    return processing.run(
        "native:simplifygeometries",
        {"INPUT": layer, "METHOD": 0, "TOLERANCE": tolerance_deg, "OUTPUT": "memory:simplified"},
    )["OUTPUT"]


def round_coords(coords, round_dp=6):
    if isinstance(coords[0], (int, float)):
        return [round(c, round_dp) for c in coords]
    return [round_coords(c, round_dp) for c in coords]


def to_geojson_dict(layer, keep_fields, round_dp=6):
    exporter = QgsJsonExporter(layer)
    exporter.setIncludeGeometry(True)
    exporter.setIncludeAttributes(True)
    raw = json.loads(exporter.exportFeatures(list(layer.getFeatures())))

    features = []
    for feat in raw["features"]:
        props = {k: v for k, v in feat["properties"].items() if k in keep_fields}
        geom = feat["geometry"]
        geom["coordinates"] = round_coords(geom["coordinates"], round_dp)
        features.append({"type": "Feature", "properties": props, "geometry": geom})
    return {"type": "FeatureCollection", "features": features}


def named_streets_dict(layer, name_map, round_dp=6):
    # Pulls just the named segments in name_map (FULLNAME -> {name, axis}) out
    # of a big centerline layer -- e.g. Burnside is ~240 separate block-length
    # segments in the source data. Dissolving them by name first collapses
    # each street down to one MultiLineString feature instead of shipping
    # hundreds of tiny GeoJSON Feature wrappers (which was most of this
    # layer's size: ~60KB for 299 raw segments vs a few KB dissolved).
    matches = [f for f in layer.getFeatures() if f["FULLNAME"] in name_map]
    if not matches:
        return {"type": "FeatureCollection", "features": []}

    mem = QgsVectorLayer(
        f"LineString?crs={layer.crs().authid()}&field=streetName:string&field=axis:string",
        "tmp_named", "memory",
    )
    new_feats = []
    for f in matches:
        info = name_map[f["FULLNAME"]]
        nf = QgsFeature(mem.fields())
        nf.setGeometry(f.geometry())
        nf.setAttributes([info["name"], info["axis"]])
        new_feats.append(nf)
    mem.dataProvider().addFeatures(new_feats)

    dissolved = processing.run(
        "native:dissolve", {"INPUT": mem, "FIELD": ["streetName"], "OUTPUT": "memory:dissolved"}
    )["OUTPUT"]

    exporter = QgsJsonExporter(dissolved)
    exporter.setIncludeGeometry(True)
    exporter.setIncludeAttributes(True)
    raw = json.loads(exporter.exportFeatures(list(dissolved.getFeatures())))

    features = []
    for feat in raw["features"]:
        props = {"name": feat["properties"]["streetName"], "axis": feat["properties"]["axis"]}
        geom = feat["geometry"]
        geom["coordinates"] = round_coords(geom["coordinates"], round_dp)
        features.append({"type": "Feature", "properties": props, "geometry": geom})
    return {"type": "FeatureCollection", "features": features}


bundle = {}

# Per-station Info/History content (station_profiles.json, sourced from PF&R's
# own official station-N pages) and cross streets (cross_streets.json, computed
# against the city's real street centerline data by compute_cross_streets.py) are
# both kept as separate files -- not baked into stations.geojson -- so the raw
# ArcGIS geometry stays untouched and this researched/computed content stays
# independently traceable and editable. Merged onto each feature's properties here.
with open(os.path.join(PROJECT_DIR, "station_profiles.json"), encoding="utf-8") as f:
    station_profiles = {k: v for k, v in json.load(f).items() if not k.startswith("_")}
with open(os.path.join(PROJECT_DIR, "cross_streets.json"), encoding="utf-8") as f:
    cross_streets = json.load(f)

# Official PF&R station sheet (Updated 6/8/26) + district map: cross streets, unit
# codes, battalion, neighborhood. Overrides the computed cross streets above. Lives
# in this repo (station_official.json); apply_official.js applies the same merge
# without QGIS.
with open(os.path.join(SRC_DIR, "station_official.json"), encoding="utf-8") as f:
    official = {k: v for k, v in json.load(f).items() if not k.startswith("_")}

stations = load("stations.geojson")
stations_fc = to_geojson_dict(stations, {"STATION", "ADDRESS", "DISTRICT"})
for feat in stations_fc["features"]:
    num = feat["properties"]["STATION"]
    if num in station_profiles:
        feat["properties"]["profile"] = station_profiles[num]
    if num in cross_streets:
        feat["properties"]["crossStreets"] = cross_streets[num]
    if num in official:
        o = official[num]
        cs = o["cross_streets"]
        feat["properties"]["crossStreets"] = {
            "on_street": feat["properties"].get("crossStreets", {}).get("on_street"),
            "cross_street_1": cs[0] if cs else None,
            "cross_street_2": cs[1] if len(cs) > 1 else None,
        }
        feat["properties"]["battalion"] = o["battalion"]
        feat["properties"]["neighborhood"] = o["neighborhood"]
        profile = feat["properties"].setdefault("profile", {})
        profile["units"] = o["units"]
        profile.pop("apparatus", None)  # replaced by units + unitNotes + otherApparatus
        if o.get("unit_notes"):
            profile["unitNotes"] = o["unit_notes"]
        if o.get("other_apparatus"):
            profile["otherApparatus"] = o["other_apparatus"]
bundle["stations"] = stations_fc

route_geo = load("study_route_geographic.geojson")
bundle["routeGeographic"] = to_geojson_dict(
    route_geo, {"SEQ", "FROM_STATION", "TO_STATION", "FROM_ADDR", "TO_ADDR"}
)

route_num = load("study_route_numeric.geojson")
bundle["routeNumeric"] = to_geojson_dict(
    route_num, {"SEQ", "FROM_STATION", "TO_STATION", "FROM_ADDR", "TO_ADDR"}
)

gates = load("locked_gates.geojson")
bundle["lockedGates"] = to_geojson_dict(gates, {"OBJECTID"})

blocked = load("blocked_streets.geojson")
bundle["blockedStreets"] = to_geojson_dict(blocked, {"OBJECTID"})

fdc = load("fire_dept_connections.geojson")
bundle["fdc"] = to_geojson_dict(fdc, {"StructureName"})

# Heavy background layers: simplify geometry before export. Tolerance is in degrees
# (source CRS is WGS84) -- ~0.0003deg is roughly 25-30m at Portland's latitude, plenty
# for a background reference shape at study-app zoom levels.
boundary = simplify(load("city_boundary.geojson"), 0.0002)
bundle["boundary"] = to_geojson_dict(boundary, {"CITYNAME"})

water = simplify(load("water_bodies.geojson"), 0.0003)
bundle["water"] = to_geojson_dict(water, {"GNIS_Name"})

first_due = simplify(load("first_due_voronoi.geojson"), 0.0002)
bundle["firstDue"] = to_geojson_dict(first_due, {"STATION"})

# Portland's real "Administrative Sextants" layer (City of Portland ArcGIS,
# Public/Boundaries/MapServer/10 -- see fetch_sectors.py). 6 simple polygons,
# no simplification needed. Ships only the 5 colloquial quadrants recruits
# actually use day to day -- South Portland (PREFIX "S") is dropped here
# deliberately (Francisco's call, design sprint 2026-09-17): it has zero PF&R
# stations and isn't part of the "NW/NE/SE/SW/N" culture this layer is for.
# Don't "fix" it back in without checking docs/decisions.md first.
sectors = load("sectors.geojson")
sectors_fc = to_geojson_dict(sectors, {"PREFIX"})
sectors_fc["features"] = [f for f in sectors_fc["features"] if f["properties"].get("PREFIX") != "S"]
bundle["sectors"] = sectors_fc

# Portland's official neighborhood boundaries (Public/Boundaries/MapServer/1,
# see fetch_neighborhoods.py). 125 polygons -- simplified like the other
# background layers, same tolerance as boundary/first-due.
neighborhoods = simplify(load("neighborhoods.geojson"), 0.0002)
bundle["neighborhoods"] = to_geojson_dict(neighborhoods, {"NAME"})

# Hospitals only (see fetch_landmarks.py's header comment for why bridges
# were dropped: PBOT's public bridge layer is a minor-structure maintenance
# inventory, not the named Willamette River crossings a recruit would
# recognize -- those are County/ODOT-owned and not in any Public/ endpoint
# found this session). Points, no simplification needed.
landmarks = load("landmarks.geojson")
bundle["landmarks"] = to_geojson_dict(landmarks, {"kind", "name"})

# Portland's real quadrant-dividing streets (see docs/decisions.md 2026-09-25):
# Burnside splits North from South, Williams Avenue splits North from
# Northeast. Pulled directly from the city's own street centerline data
# (streets.geojson, same source compute_cross_streets.py uses) by exact
# FULLNAME match -- not simplified or redrawn, the real segments as mapped.
# "axis" tags which of the two highlight tones the renderer uses (see
# app.js's drawDividingStreets): streets running north-south vs east-west.
# Shown only when the Sectors layer is on -- these streets ARE several of
# the sector boundaries, made visible as the real streets they are.
DIVIDING_STREETS = {
    "E BURNSIDE ST": {"name": "Burnside Street", "axis": "ew"},
    "W BURNSIDE ST": {"name": "Burnside Street", "axis": "ew"},
    "N WILLIAMS AVE": {"name": "Williams Avenue", "axis": "ns"},
}
streets = load("streets.geojson")
bundle["dividingStreets"] = named_streets_dict(streets, DIVIDING_STREETS)

js = "const PFR_DATA = " + json.dumps(bundle, separators=(",", ":")) + ";\n"
with open(OUT_PATH, "w", encoding="utf-8") as f:
    f.write(js)

sizes = {k: len(json.dumps(v)) for k, v in bundle.items()}
total_kb = sum(sizes.values()) / 1024
print("Bundle sizes (KB):")
for k, v in sizes.items():
    print(f"  {k}: {v/1024:.1f}")
print(f"Total: {total_kb:.1f} KB -> {OUT_PATH}")

qgs.exitQgis()
