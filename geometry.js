// Pure geometry/math helpers shared by app.js (loaded as a plain global
// script, same convention as data.js's PFR_DATA) and the test suite
// (loaded via require() under Node). No DOM/canvas dependency in this
// file on purpose -- that's the whole point of splitting it out.

function ringsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return geometry.coordinates;
  if (geometry.type === "MultiPolygon") return geometry.coordinates.flat();
  return [];
}

// Coordinate arrays of any LineString/MultiLineString geometry, one array
// per line (a MultiLineString's parts stay separate so callers can stroke
// each one -- unlike a polygon ring, joining them would draw a spurious
// segment across the gap between disconnected parts).
function lineStringsOf(geometry) {
  if (!geometry) return [];
  if (geometry.type === "LineString") return [geometry.coordinates];
  if (geometry.type === "MultiLineString") return geometry.coordinates;
  return [];
}

// Bounding box (lon/lat) of any Polygon/MultiPolygon feature. Used for
// sector/neighborhood centroid labels and for fitting the view to a
// locked sector.
function polygonBBox(feature) {
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  ringsOf(feature.geometry).forEach((ring) => ring.forEach(([lon, lat]) => {
    if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
  }));
  return { minLon, minLat, maxLon, maxLat };
}

// One axis of the pan-clamp: given the current pan/zoom and an extent's
// "fit-space" bounds [b0,b1] on this axis, return the clamped pan value.
// If the zoomed content is narrower than the canvas on this axis, centers
// it instead of leaving it free -- see webapp/app.js's clampPan() for how
// this composes across both axes and the locked-vs-full-city extent choice.
function clampAxis(pan, zoom, b0, b1, extent) {
  const span = (b1 - b0) * zoom;
  if (span <= extent) {
    return (extent - span) / 2 - b0 * zoom;
  }
  const min = extent - b1 * zoom;
  const max = -b0 * zoom;
  return Math.min(max, Math.max(min, pan));
}

// Fisher-Yates shuffle bag: draws without repetition until exhausted, then
// reshuffles. Used by Flashcard and Blind Map modes.
function makeShuffleBag(items) {
  let pool = [];
  function refill() {
    pool = [...items];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
  }
  refill();
  return {
    next() {
      if (pool.length === 0) refill();
      return pool.pop();
    },
  };
}

// True if two {x,y,w,h} boxes overlap, treating each as `pad` px larger.
function boxesOverlap(a, b, pad = 0) {
  return a.x < b.x + b.w + pad && a.x + a.w + pad > b.x &&
         a.y < b.y + b.h + pad && a.y + a.h + pad > b.y;
}

// Priority-based label collision, the technique map renderers use to hide
// clutter: place labels from highest to lowest priority and drop any label
// whose box overlaps one already placed. As the view zooms in there is more
// room, so more labels win a spot -- with no per-label zoom thresholds.
//   candidates: [{ priority, box:{x,y,w,h}, ignoreObstacles? }]
//   obstacles:  [{x,y,w,h}] fixed things labels must avoid (markers)
// Ties keep input order, so the result is stable frame to frame (no flicker
// while panning). Returns the accepted candidates, highest priority first.
function placeLabels(candidates, obstacles = [], pad = 2) {
  const placed = [];
  candidates
    .map((c, i) => ({ c, i }))
    .sort((a, b) => b.c.priority - a.c.priority || a.i - b.i)
    .forEach(({ c }) => {
      if (placed.some((p) => boxesOverlap(c.box, p.box, pad))) return;
      if (!c.ignoreObstacles && obstacles.some((o) => boxesOverlap(c.box, o, pad))) return;
      placed.push(c);
    });
  return placed;
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { ringsOf, lineStringsOf, polygonBBox, clampAxis, makeShuffleBag, boxesOverlap, placeLabels };
}
