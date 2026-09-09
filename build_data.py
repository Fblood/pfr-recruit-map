# Builds a compact data.js bundle for the recruit study web app from the QGIS project's
# source GeoJSON files. Simplifies the heavy background layers (water, boundary, first-due)
# and strips unused fields so the whole bundle stays small and loads fast on GitHub Pages.
# Run with: C:\OSGeo4W\bin\python-qgis.bat build_data.py
import json
import os
import sys

sys.path.append(r"C:\OSGeo4W\apps\qgis\python\plugins")

from qgis.core import QgsApplication, QgsVectorLayer, QgsJsonExporter

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


def to_geojson_dict(layer, keep_fields, round_dp=6):
    exporter = QgsJsonExporter(layer)
    exporter.setIncludeGeometry(True)
    exporter.setIncludeAttributes(True)
    raw = json.loads(exporter.exportFeatures(list(layer.getFeatures())))

    def round_coords(coords):
        if isinstance(coords[0], (int, float)):
            return [round(c, round_dp) for c in coords]
        return [round_coords(c) for c in coords]

    features = []
    for feat in raw["features"]:
        props = {k: v for k, v in feat["properties"].items() if k in keep_fields}
        geom = feat["geometry"]
        geom["coordinates"] = round_coords(geom["coordinates"])
        features.append({"type": "Feature", "properties": props, "geometry": geom})
    return {"type": "FeatureCollection", "features": features}


bundle = {}

stations = load("stations.geojson")
bundle["stations"] = to_geojson_dict(stations, {"STATION", "ADDRESS", "DISTRICT"})

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
