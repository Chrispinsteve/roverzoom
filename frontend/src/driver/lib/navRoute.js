// Turns the server's Routes API payload into the shape NavController consumes.
//
// Lives outside NavMap so the visual pipeline can be tested end to end without
// a browser: server response -> decoded geometry -> route state -> projection
// -> rendered lanes. That chain had a silent break in it for the whole life of
// the driver map (the browser's DirectionsService returns REQUEST_DENIED for
// this project), and a break anywhere along it shows up as an empty map with
// no error — so it is now covered by a test that runs on real captured data.
//
// `decode` is injected rather than imported: the browser passes Google's
// geometry library, the test passes a plain implementation of the same
// algorithm, and neither needs the other to exist.

import { parseManeuver } from './navMath.js';

// Google's decodePath yields LatLng objects with lat()/lng() methods; a plain
// decoder yields {lat,lng}. Accept either so the same parser serves both.
function asPoint(ll) {
  return typeof ll.lat === 'function' ? { lat: ll.lat(), lng: ll.lng() } : { lat: ll.lat, lng: ll.lng };
}

// Turn the server's Routes API payload into the controller's shape: a detailed
// path with each vertex tagged by its step, plus parsed maneuvers.
//
// Geometry arrives as encoded polylines and is decoded here with the geometry
// library the map already loads. Per-step polylines are concatenated rather
// than using the route-level one, because the controller needs to know which
// step each vertex belongs to — that mapping is what drives the maneuver
// banner and the Trace Lane's current-step highlight.
export function parseNavRoute(data, decode) {
  if (typeof decode !== 'function') return null;
  const path = [];
  const steps = [];
  const push = (pt, si) => {
    const last = path[path.length - 1];
    // Consecutive steps share an endpoint. Left in, every step boundary would
    // be a zero-length segment in the cumulative-distance table.
    if (last && Math.abs(last.lat - pt.lat) < 1e-9 && Math.abs(last.lng - pt.lng) < 1e-9) return;
    path.push({ lat: pt.lat, lng: pt.lng, step: si });
  };
  (data.steps || []).forEach((st, si) => {
    steps.push(parseManeuver({
      maneuver: st.maneuver,
      instruction: st.instruction,
      distM: st.distanceMeters ?? 0,
      durSec: st.durationSec ?? 0,
    }));
    if (!st.polyline) return;
    decode(st.polyline).forEach((ll) => push(asPoint(ll), si));
  });
  // If steps carried no geometry, fall back to the route-level polyline. The
  // line is then drawn correctly but every vertex belongs to step 0, so the
  // current-step highlight degrades to "the whole route" rather than lying.
  if (path.length < 2 && data.polyline) {
    decode(data.polyline).forEach((ll) => push(asPoint(ll), 0));
  }
  // Fewer than two points cannot be drawn as a line. Returning the empty shell
  // would push the decision onto every caller; returning nothing makes the
  // contract "a drawable route, or nothing" and keeps the error path in one
  // place — which is where this whole class of silent failure came from.
  if (path.length < 2) return null;
  return {
    path,
    steps,
    totalDistM: data.distanceMeters || 0,
    // TRAFFIC_AWARE: this is the road as it is now, not as it would be empty.
    totalDurSec: data.durationSec || 0,
    trafficAware: true,
  };
}
