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

if (typeof module !== "undefined" && module.exports) {
  module.exports = { ringsOf, polygonBBox, clampAxis, makeShuffleBag };
}
