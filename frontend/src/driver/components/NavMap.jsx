import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GoogleMap, OverlayViewF, OverlayView, PolylineF } from '@react-google-maps/api';
import { useGoogleMaps } from '../../lib/GoogleMapsProvider';
import { useAnimatedPosition, usePrefersReducedMotion } from '../../lib/useAnimatedPosition';
import { NavController, RequestGuard } from '../lib/navController';
import { parseNavRoute } from '../lib/navRoute';
import { mapOptionsFor, stylesFor, NAV_TILT_DEG } from '../lib/mapStyle';
import { traceWeights } from '../lib/navMath';
import { driverApi } from '../../lib/driverApi';

// ============================================================
// NavMap — thin React/Google shell over the tested NavController
// ============================================================
// All navigation decisions (progress, current step, deviation/reroute, camera
// mode, heading) live in ../lib/navController.js and are unit-tested against a
// simulated GPS stream. This file only: fetches routes (with a race guard so a
// stale response can't overwrite a newer route), feeds GPS in, applies the
// camera imperatively, and renders the Trace Lane + markers + maneuver banner.
//
// ROUTES COME FROM THE SERVER, NOT THE BROWSER.
// This file used to call google.maps.DirectionsService directly. That call
// returns REQUEST_DENIED for this project — reproduced against the live origin
// with the production browser key — and the failure was swallowed by an early
// `return`, so the map silently drew no route, ever. Geometry now comes from
// /api/driver/nav-route on the Routes API, which is the engine that already
// prices rides. A failure is now STATE the driver can see, not a dropped
// promise.
// ============================================================

const MINT = '#3EE0A0';
const MINT_CASING = '#1FA574';

// ---- Trace Lane palette --------------------------------------------------
// The lane is BLUE, not brand mint. Deliberate, and the one place brand loses.
//
// Mint is Roverzoom's colour and it is used everywhere else — the pickup pin,
// the maneuver arrow, the controls. On the map that became a problem: a green
// route over a grey-green base map shares a hue with the thing it is drawn on,
// and the two compete at exactly the moment they must not. Blue has no
// neighbour on this map. It is also the colour every driver already reads as
// "the route" from Apple Maps and Google Maps, and a navigation screen is the
// wrong place to teach someone a new convention.
//
// Green stays for the DESTINATION, so path and target never blur together.
const ROUTE_BLUE = '#0A84FF';       // iOS system blue
const ROUTE_BLUE_EDGE = '#0B57C4';  // deeper edge, holds the colour off the grey
const TRACE_NOW = ROUTE_BLUE;
const TRACE_AHEAD = '#7CBEFF';      // still to drive: present, not competing
const TRACE_EDGE = ROUTE_BLUE_EDGE;
const TRACE_DONE = '#C3BBB0';       // behind you: recedes, warm to match the ground

// Framing insets, in CSS pixels. Named because fitBounds pads around
// COORDINATES while the driver sees MARKERS, and the difference between the
// two is exactly how a destination ends up half off the screen.
const CARD_OVERLAP_PX = 20;   // .drv-nav-card's negative top margin
const DEST_LABEL_H = 30;      // pin + label, drawn ABOVE the coordinate
const DEST_LABEL_HALF_W = 58; // half the widest label ("DROPOFF") plus slack
const MARKER_HALO = 18;       // breathing room so nothing sits on the edge

// Said in the driver's terms, not the API's. Each one implies a different
// action: wait, check the address, or stop trying and use Maps.
const ROUTE_ERROR_TEXT = {
  network: 'Can’t reach routing',
  timeout: 'Routing timed out',
  no_geometry: 'No driving route to this address',
  bad_coordinates: 'This drop-off has no valid location',
  no_api_key: 'Navigation is not configured',
  unavailable: 'Route unavailable',
};

// Vector rendering is opt-in via env. Empty string = raster + NAV_STYLES,
// which is the shipped behaviour. See mapStyle.js for why this is a switch and
// not a default: a mapId silently disables the entire styles array.
const MAP_ID = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID || '';
const IS_VECTOR = Boolean(MAP_ID);
const MAP_OPTIONS = mapOptionsFor(MAP_ID);

function maneuverGlyph(m) {
  switch (m) {
    case 'turn-left': case 'ramp-left': case 'fork-left': case 'keep-left': case 'roundabout-left': return '↰';
    case 'turn-right': case 'ramp-right': case 'fork-right': case 'keep-right': case 'roundabout-right': return '↱';
    case 'turn-slight-left': return '↖';
    case 'turn-slight-right': return '↗';
    case 'turn-sharp-left': return '⬅';
    case 'turn-sharp-right': return '➡';
    case 'uturn-left': case 'uturn-right': return '⤺';
    case 'merge': return '⇗';
    default: return '↑';
  }
}

// Returns null when there is no usable route yet, so the screens fall through
// to their own placeholders ("—" and the booking's own distance).
//
// This previously always returned a formatted string. With no route the
// remaining distance is 0, and the ETA is floored at Math.max(1, ...) — so a
// failed or still-pending route rendered as a confident "0.0 mi / 1 min"
// instead of an honest dash. A driver reads that as "you have arrived" and
// stops looking for the turn.
function fmtRemaining(rem) {
  if (!rem || !Number.isFinite(rem.distM) || !Number.isFinite(rem.sec)) return null;
  // A real route always has SOME length. Zero means we have not got one.
  if (rem.distM <= 0) return null;
  const mi = rem.distM / 1609.34;
  // Under a tenth of a mile, miles round to "0.0" — which a driver reads as
  // "arrived" and stops looking for the turn, while they may still have two
  // city blocks to go. Feet are both meaningful and available at that range:
  // the number comes from route geometry minus measured progress, not from an
  // estimate. Rounded to 50ft so it does not imply survey precision.
  let distanceText;
  if (mi < 0.1) {
    const ft = Math.max(50, Math.round((rem.distM * 3.28084) / 50) * 50);
    distanceText = `${ft} ft`;
  } else {
    distanceText = mi >= 10 ? `${Math.round(mi)} mi` : `${mi.toFixed(1)} mi`;
  }
  const etaText = `${Math.max(1, Math.round(rem.sec / 60))} min`;
  return { etaText, distanceText };
}

// Lane advice, drawn only when Google actually gave some.
//
// A real lane diagram — the row showing every lane on the road with the valid
// ones lit — needs the road's total lane count, which the web APIs never
// return. Drawing five slots and lighting two would be inventing the road's
// width, and a driver reading it at speed would believe it. So this renders
// exactly what is known and no more: how many lanes, and which side.
//
// When there is no lane advice, the component renders nothing. Absent data
// must look absent, not like a road with no lane restrictions.
function LaneHint({ lane }) {
  if (!lane) return null;
  const arrow = lane.side === 'left' ? '\u2196' : lane.side === 'right' ? '\u2197' : '\u2191';
  const label = lane.count
    ? `${lane.side === 'middle' ? 'Middle' : lane.side === 'left' ? 'Left' : 'Right'} ${lane.count} lane${lane.count > 1 ? 's' : ''}`
    : `Keep ${lane.side}`;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
      <span style={{ display: 'flex', gap: 2 }} aria-hidden="true">
        {Array.from({ length: lane.count || 1 }).map((_, i) => (
          <span key={i} style={{ fontSize: 13, lineHeight: 1, color: MINT, background: 'rgba(45,212,167,0.14)', borderRadius: 4, padding: '2px 3px' }}>{arrow}</span>
        ))}
      </span>
      <span style={{ fontSize: 12, fontWeight: 700, color: MINT, letterSpacing: '-0.01em' }}>{label}</span>
    </div>
  );
}

function VehicleMarker({ position, intervalMs }) {
  const reduced = usePrefersReducedMotion();
  const animated = useAnimatedPosition(position, { durationMs: intervalMs, enabled: !reduced });
  if (!animated) return null;
  return (
    <OverlayViewF position={{ lat: animated.lat, lng: animated.lng }} mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}>
      {/* Three concentric layers, which is what makes this read as a physical
          object on the map rather than an icon pasted over it:

            halo   soft blue, breathing — "this is live", not a dropped pin
            ring   opaque WHITE — separates the puck from any road colour
                   underneath, at any brightness, without a black outline
            disc   blue, carrying a white chevron that points where the car is
                   actually going

          The white ring is the part that is easy to skip and the part that does
          the work: without it the puck sits ON the route and the two blues
          merge, so the driver loses their own position in the line. */}
      <div style={{ transform: 'translate(-50%,-50%)', width: 46, height: 46, position: 'relative' }}>
        <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'rgba(10,132,255,0.20)', animation: 'rz-map-pulse 3s ease-out infinite' }} />
        <span style={{ position: 'absolute', inset: 7, borderRadius: '50%', background: '#fff', boxShadow: '0 2px 9px rgba(0,0,0,0.32)' }} />
        <span style={{
          position: 'absolute', inset: 10, borderRadius: '50%', background: ROUTE_BLUE,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          // Rotated only here, so the halo and the ring stay perfectly circular
          // and no edge appears to wobble as the heading changes.
          transform: `rotate(${animated.heading || 0}deg)`,
        }}>
          <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 4.2 L18.4 19.2 L12 15.6 L5.6 19.2 Z" fill="#fff" />
          </svg>
        </span>
      </div>
    </OverlayViewF>
  );
}

function DestMarker({ position, label, number = '', uncertain = false }) {
  const isPickup = String(label).toUpperCase().startsWith('PICK');
  const ring = uncertain ? '#F5B301' : MINT;
  return (
    <OverlayViewF position={position} mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}>
      {/* ANCHORING.
          translate(-50%,-100%) puts the BOTTOM of this box on the coordinate,
          so whatever is last in the column is what touches the map. The label
          used to be last, which meant the coordinate sat under the bottom of
          the LABEL and the pin tip floated about 25px above it — roughly 30m
          of visual error at navigation zoom, on top of whatever the geocoder
          was already wrong by.

          Label first, pin last: the tip is now exactly on the coordinate, and
          the label sits ABOVE the pin where it cannot cover the road the
          driver still has to drive to reach it. */}
      <div style={{ transform: 'translate(-50%,-100%)', display: 'flex', flexDirection: 'column', alignItems: 'center', pointerEvents: 'none' }}>
        <span style={{
          fontSize: 10.5, fontWeight: 800, letterSpacing: '0.08em',
          color: '#0e1512', background: ring, padding: '3px 8px', borderRadius: 6,
          whiteSpace: 'nowrap', boxShadow: '0 2px 6px rgba(0,0,0,0.22)', marginBottom: 5,
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <span>{label}</span>
          {/* The house number, carried in the pin because the pin covers the
              map's own label for that roof. Separated by a hairline rather than
              a bullet so it reads as a second field, not part of the word. */}
          {number && (
            <>
              <span style={{ width: 1, height: 9, background: 'rgba(14,21,18,0.28)' }} />
              <span style={{ fontWeight: 900, letterSpacing: '0.02em' }}>{number}</span>
            </>
          )}
        </span>
        {/* Only when we genuinely do not know: the address point is far from
            any road a vehicle can stop on, so the pin is a best guess. Saying
            so beats a confident pin on the wrong side of a complex. */}
        {uncertain && (
          <span style={{
            fontSize: 9.5, fontWeight: 700, letterSpacing: '0.04em', color: '#0e1512',
            background: 'rgba(245,179,1,0.92)', padding: '2px 7px', borderRadius: 5,
            whiteSpace: 'nowrap', marginBottom: 5,
          }}>APPROXIMATE — CONFIRM WITH RIDER</span>
        )}
        <span style={{
          width: 30, height: 30, borderRadius: '50% 50% 50% 0',
          background: ring, border: '3px solid #fff', boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
          transform: 'rotate(-45deg)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {/* Counter-rotated so the glyph sits upright inside the tilted pin. */}
          <span style={{ transform: 'rotate(45deg)', display: 'flex' }}>
            {isPickup ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="#0e1512">
                <circle cx="12" cy="8" r="3.6" />
                <path d="M4.8 20c0-3.6 3.2-6 7.2-6s7.2 2.4 7.2 6z" />
              </svg>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#0e1512" strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round">
                <path d="M4 11l8-6 8 6" />
                <path d="M6.5 10v9h11v-9" />
              </svg>
            )}
          </span>
        </span>
      </div>
    </OverlayViewF>
  );
}

export default function NavMap({ driver, destination, destinationLabel = 'PICKUP', destinationNumber = '', onRouteInfo, updateIntervalMs = 5000 }) {
  const { isLoaded, hasApiKey, loadError } = useGoogleMaps();
  const mapRef = useRef(null);
  const ctrlRef = useRef(null);
  if (!ctrlRef.current) ctrlRef.current = new NavController();
  const guardRef = useRef(new RequestGuard());
  const programmatic = useRef(false);
  const overviewTimer = useRef(null);
  // Read by the bounds fallback. Held as refs rather than dependencies so
  // fitToRoute stays stable across GPS fixes.
  const lastDriverRef = useRef(null);
  const destRef = useRef(null);

  const [ready, setReady] = useState(false);
  const [lanes, setLanes] = useState({ donePast: [], doneNow: [], now: [], ahead: [] });
  // Why there is no line, when there is no line. Previously a failed route was
  // an early `return` and the driver got an empty map with no explanation.
  const [routeError, setRouteError] = useState(null);
  // Stroke weights are screen pixels, so the lane has to be re-weighted as the
  // driver zooms or it becomes a ribbon close in and a thread far out.
  const [zoom, setZoom] = useState(17);
  // Where the driver actually stops, and whether we trust it.
  const [access, setAccess] = useState({ point: null, offsetM: null, needsVerification: false });
  // Which style set is currently applied, so the map is only re-styled when it
  // actually crosses the threshold rather than on every idle event.
  const styleRef = useRef(null);
  // Measured, not guessed: the banner's real height decides how much of the
  // top of the map is covered and therefore unusable for framing.
  const bannerRef = useRef(null);
  // donePast and ahead span most of the route and change only when the driver
  // finishes a maneuver. Handing the Maps API a fresh array for them on every
  // GPS fix would re-tessellate thousands of points a few times a minute for no
  // visual change, so they are cached BY IDENTITY on (route, step) — React and
  // the Maps binding both skip the update when the reference is unchanged.
  const laneCache = useRef({ key: null, donePast: [], ahead: [] });
  // Render snapshot mirrored from the controller.
  const [view, setView] = useState({ mode: 'overview', step: null, next: null, heading: 0 });

  const hasDriver = driver && driver.lat != null;
  const destPt = useMemo(
    () => (destination && destination.lat != null ? { lat: Number(destination.lat), lng: Number(destination.lng) } : null),
    [destination?.lat, destination?.lng]
  );
  destRef.current = destPt;

  const snapshot = useCallback(() => {
    const c = ctrlRef.current;
    setView({
      mode: c.mode, step: c.currentStep(), next: c.nextStep(), heading: c.stableHeading,
      visual: c.visualPosition(), phase: c.approachPhase(), connector: c.routeConnector(),
      side: c.arrivalSide(destRef.current),
    });
    const l = c.traceLanes();
    const key = `${c.routeVersion}:${c.stepIndex}`;
    if (laneCache.current.key !== key) laneCache.current = { key, donePast: l.donePast, ahead: l.ahead };
    setLanes({ ...l, donePast: laneCache.current.donePast, ahead: laneCache.current.ahead });
    if (onRouteInfo) onRouteInfo(fmtRemaining(c.remaining()) || {});
  }, [onRouteInfo]);

  const applyCamera = useCallback((cam) => {
    const map = mapRef.current;
    if (!map || !cam) return;
    programmatic.current = true;
    if (map.getZoom() !== cam.zoom) map.setZoom(cam.zoom);
    map.panTo(cam.center);

    // Vector maps only — a raster map ignores both of these outright.
    if (IS_VECTOR) {
      // HEADING-UP. Rotating the map so travel direction is screen-up is what
      // finally puts the vehicle in the lower third for EVERY heading. On a
      // north-up map the look-ahead offset points geographically ahead, so it
      // only reads as "below centre" when the driver happens to be going north;
      // heading east it pushed them to the left edge instead.
      if (Number.isFinite(cam.heading)) map.setHeading(cam.heading);
      // Tilt flattens on arrival. Perspective helps read a street you are
      // travelling along; it hurts when the task is picking out which of four
      // doors to stop at, where a plan view is strictly better.
      const tilt = cam.phase === 'arriving' ? 0 : NAV_TILT_DEG;
      if (map.getTilt() !== tilt) map.setTilt(tilt);
    }

    window.clearTimeout(applyCamera._t);
    applyCamera._t = window.setTimeout(() => { programmatic.current = false; }, 420);
  }, []);

  // Frame the journey inside the part of the map that is actually VISIBLE.
  //
  // fitBounds pads in pixels around the raw coordinates, which is not the same
  // as keeping the markers on screen: the destination pin is drawn 30px wide
  // with a label under it, so a coordinate sitting exactly on the padding edge
  // still has half its pin and all of its label off-screen. That is why the
  // dropoff was clipped against the left edge.
  //
  // Every inset below is either measured from the DOM or derived from a marker
  // that is actually drawn, rather than guessed. The old bottom inset of 176px
  // was guessing at a card that in fact overlaps the map by 20px, so it threw
  // away a third of the viewport and forced the camera to zoom out to
  // compensate — which is why the screen showed half of Boca Raton.
  const fitToRoute = useCallback(() => {
    const map = mapRef.current;
    const c = ctrlRef.current;
    if (!map || !window.google) return;
    const bounds = new window.google.maps.LatLngBounds();
    if (c.path.length) {
      c.path.forEach((p) => bounds.extend(p));
    } else {
      // No route — a failed request, or one still in flight. Fit the driver and
      // the destination anyway, so the screen still answers "where am I and
      // where am I going" instead of sitting at a default zoom.
      const pts = [lastDriverRef.current, destRef.current].filter(Boolean);
      if (pts.length < 2) return;
      pts.forEach((pt) => bounds.extend(pt));
    }
    const bannerH = bannerRef.current?.offsetHeight || 0;
    programmatic.current = true;
    // Overview frames the whole journey, which only reads correctly flat and
    // north-up: fitBounds computes a bounding box in geographic space and does
    // not account for a rotated or tilted viewport, so a tilted overview cuts
    // the far end of the route off the screen.
    if (IS_VECTOR) { map.setTilt(0); map.setHeading(0); }
    map.fitBounds(bounds, {
      // Banner sits at top:12 and covers the map completely.
      // The pin and its label are drawn upward from the coordinate, so a
      // destination near the top needs room for both, not just for the banner.
      top: (bannerH ? bannerH + 12 : 0) + DEST_LABEL_H + MARKER_HALO,
      // The card overlaps the map by its negative margin only.
      bottom: CARD_OVERLAP_PX + MARKER_HALO,
      // Half the widest marker label, so a pin near the edge stays whole.
      left: DEST_LABEL_HALF_W,
      right: DEST_LABEL_HALF_W,
    });
    window.clearTimeout(fitToRoute._t);
    fitToRoute._t = window.setTimeout(() => { programmatic.current = false; }, 520);
  }, []);

  // mode: undefined (first route) | 'candidate' (a periodic look for a faster
  // road, adopted only if materially better).
  const fetchRoute = useCallback(async (origin, isReroute, mode) => {
    if (!destPt || !origin) return;
    const token = guardRef.current.begin();
    let data;
    try {
      data = await driverApi.navRoute({
        olat: origin.lat, olng: origin.lng, dlat: destPt.lat, dlng: destPt.lng,
      });
    } catch (err) {
      if (guardRef.current.isCurrent(token)) setRouteError('network');
      return;
    }
    // Race guard: ignore a response that a newer request has superseded.
    if (!guardRef.current.isCurrent(token)) return;

    if (!data?.ok) { setRouteError(data?.reason || 'unavailable'); return; }
    const parsed = parseNavRoute(data, window.google?.maps?.geometry?.encoding?.decodePath);
    // Two points is the minimum that can be drawn as a line. Below that there
    // is no route, and saying so beats rendering an empty map.
    // parseNavRoute returns null unless it produced a drawable line.
    if (!parsed) { setRouteError('no_geometry'); return; }
    setRouteError(null);

    // A periodic look for a faster road. Adopted only when it beats what is
    // left of the current route by a margin worth the disruption of changing
    // the line and the next turn under the driver.
    if (mode === 'candidate') {
      if (!ctrlRef.current.isWorthSwitching(parsed.totalDurSec)) return;
      ctrlRef.current.setRoute(parsed, { reroute: true });
      snapshot();
      return;
    }

    setAccess({ point: parsed.accessPoint, offsetM: parsed.accessOffsetM, needsVerification: parsed.needsVerification });
    ctrlRef.current.setRoute(parsed, { reroute: !!isReroute });
    // First route → show the whole journey briefly, then hand to follow.
    if (!isReroute) {
      requestAnimationFrame(fitToRoute);
      window.clearTimeout(overviewTimer.current);
      overviewTimer.current = window.setTimeout(() => { ctrlRef.current.startFollowing(); snapshot(); }, 2500);
    }
    snapshot();
  }, [destPt, fitToRoute, snapshot]);

  const onZoom = useCallback(() => {
    const map = mapRef.current;
    const z = map?.getZoom();
    if (!Number.isFinite(z)) return;
    setZoom((prev) => (Math.abs(prev - z) < 0.01 ? prev : z));
    // House numbers appear as the driver gets close. Skipped entirely on a
    // vector map, where a mapId means the styles array is ignored and the
    // equivalent has to be configured as a cloud style instead.
    if (IS_VECTOR) return;
    const next = stylesFor({ zoom: z, phase: ctrlRef.current.approachPhase() });
    if (styleRef.current !== next) {
      styleRef.current = next;
      map.setOptions({ styles: next });
    }
  }, []);

  const onLoad = useCallback((map) => {
    mapRef.current = map;
    const h = map.getDiv()?.offsetHeight;
    if (h) ctrlRef.current.setViewport(h);
    const z = map.getZoom();
    if (Number.isFinite(z)) setZoom(z);
    setReady(true);
  }, []);
  const onUnmount = useCallback(() => { mapRef.current = null; setReady(false); }, []);

  // Initial route: once the map, driver and destination are all available.
  useEffect(() => {
    if (ready && isLoaded && hasDriver && destPt && ctrlRef.current.path.length === 0 && !routeError) {
      fetchRoute({ lat: Number(driver.lat), lng: Number(driver.lng) }, false);
    }
  }, [ready, isLoaded, hasDriver, destPt, fetchRoute, driver, routeError]);

  // Every GPS fix flows through the controller; we just apply its output.
  useEffect(() => {
    if (!ready || !hasDriver) return;
    const c = ctrlRef.current;
    if (c.viewportH < 100) { const h = mapRef.current?.getDiv()?.offsetHeight; if (h) c.setViewport(h); }
    lastDriverRef.current = { lat: Number(driver.lat), lng: Number(driver.lng) };
    const res = c.onPosition({ lat: Number(driver.lat), lng: Number(driver.lng), heading: driver.heading, speedMph: driver.speedMph });
    if (res.camera) applyCamera(res.camera);
    if (res.needsReroute && res.rerouteOrigin) fetchRoute(res.rerouteOrigin, true);
    snapshot();
  }, [ready, hasDriver, driver?.lat, driver?.lng, driver?.heading, applyCamera, fetchRoute, snapshot, driver]);

  useEffect(() => () => { window.clearTimeout(overviewTimer.current); }, []);

  // Look for a faster route while driving. Rerouting previously only happened
  // when the driver LEFT the route, which misses the case navigation is most
  // useful for: the road ahead has gone wrong and a better one exists. The
  // controller gates how often this runs (and refuses in the final minutes,
  // where a switch cannot save enough to justify redrawing the journey);
  // isWorthSwitching decides whether the answer is worth acting on.
  useEffect(() => {
    if (!ready || !hasDriver) return undefined;
    const t = window.setInterval(() => {
      const c = ctrlRef.current;
      if (!c || !c.lastPos || !c.shouldCheckAlternate()) return;
      c.markAlternateChecked();
      fetchRoute(c.lastPos, true, 'candidate');
    }, 30000);
    return () => window.clearInterval(t);
  }, [ready, hasDriver, fetchRoute]);

  const onGesture = useCallback(() => {
    if (programmatic.current) return;
    ctrlRef.current.onUserGesture();
    setView((v) => ({ ...v, mode: ctrlRef.current.mode }));
  }, []);

  // Clearing the error re-arms the initial-route effect, which fires again as
  // soon as a driver position and destination are both present.
  const retryRoute = useCallback(() => { setRouteError(null); }, []);

  const recenter = useCallback(() => {
    const cam = ctrlRef.current.recenter();
    if (cam) applyCamera(cam);
    setView((v) => ({ ...v, mode: 'follow' }));
  }, [applyCamera]);

  const initialCenter = useMemo(() => {
    if (hasDriver) return { lat: Number(driver.lat), lng: Number(driver.lng) };
    if (destPt) return destPt;
    return { lat: 26.7153, lng: -80.0534 };
  }, [hasDriver, destPt, driver]);

  if (loadError || !hasApiKey) {
    return <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F1EEE9', color: '#6E675E', fontSize: 13, textAlign: 'center', padding: 20 }}>Map unavailable — use “Open in Maps” to navigate.</div>;
  }
  if (!isLoaded) {
    return <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#F1EEE9', color: '#9A9186', fontSize: 13 }}>Loading map…</div>;
  }

  const step = view.step;
  const weights = traceWeights(zoom);

  // Draw the vehicle where the controller says to, which inside the corridor is
  // on the road rather than at the raw fix. Falls back to the raw coordinate
  // before the first route arrives, when there is no line to be on.
  const vehiclePos = {
    lat: view.visual ? view.visual.lat : Number(driver?.lat),
    lng: view.visual ? view.visual.lng : Number(driver?.lng),
    heading: view.heading ?? driver?.heading ?? 0,
  };

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
      <GoogleMap
        mapContainerStyle={{ width: '100%', height: '100%' }}
        center={initialCenter}
        zoom={15}
        options={MAP_OPTIONS}
        onLoad={onLoad}
        onUnmount={onUnmount}
        onDragStart={onGesture}
        onZoomChanged={onGesture}
        onIdle={onZoom}
      >
        {/* ---- Trace Lane ------------------------------------------------
            Drawn back to front: what is done, then the road still to drive,
            then the maneuver in hand. Progress is a property of the ROUTE
            here, not a number in a card — the driver reads how far along they
            are from the line itself, without looking away from it.

            Each state is two polylines (a long cached one and a short live
            one) sharing a colour and width, so they read as a single lane. */}
        {lanes.donePast.length > 1 && (
          <PolylineF path={lanes.donePast} options={{ strokeColor: TRACE_DONE, strokeOpacity: 0.85, strokeWeight: weights.done, zIndex: 1 }} />
        )}
        {lanes.doneNow.length > 1 && (
          <PolylineF path={lanes.doneNow} options={{ strokeColor: TRACE_DONE, strokeOpacity: 0.85, strokeWeight: weights.done, zIndex: 1 }} />
        )}
        {lanes.ahead.length > 1 && (
          <PolylineF path={lanes.ahead} options={{ strokeColor: TRACE_EDGE, strokeOpacity: 1, strokeWeight: weights.casing, zIndex: 2 }} />
        )}
        {lanes.now.length > 1 && (
          <PolylineF path={lanes.now} options={{ strokeColor: TRACE_EDGE, strokeOpacity: 1, strokeWeight: weights.casing, zIndex: 2 }} />
        )}
        {lanes.ahead.length > 1 && (
          <PolylineF path={lanes.ahead} options={{ strokeColor: TRACE_AHEAD, strokeOpacity: 1, strokeWeight: weights.core, zIndex: 3 }} />
        )}
        {lanes.now.length > 1 && (
          <PolylineF path={lanes.now} options={{ strokeColor: TRACE_NOW, strokeOpacity: 1, strokeWeight: weights.core, zIndex: 4 }} />
        )}
        {/* Anchored on the access point — where a vehicle can actually stop —
            rather than the address coordinate, which may be a rooftop or a
            parcel centroid the driver cannot park on. Falls back to the address
            point before a route exists. */}
        {/* The driver is off the line — say so honestly with a dashed link
            rather than leaving the car floating unexplained. */}
        {view.connector && (
          <PolylineF
            path={view.connector}
            options={{
              strokeOpacity: 0, zIndex: 3,
              icons: [{
                icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.85, strokeColor: TRACE_EDGE, strokeWeight: 3, scale: 3 },
                offset: '0', repeat: '11px',
              }],
            }}
          />
        )}
        {(access.point || destPt) && (
          <DestMarker position={access.point || destPt} label={destinationLabel} number={destinationNumber} uncertain={access.needsVerification} />
        )}
        {hasDriver && <VehicleMarker position={vehiclePos} intervalMs={updateIntervalMs} />}
      </GoogleMap>

      {/* Maneuver banner — trusted ACTION (large) + road (secondary).
          Driven by the controller's forward-only step index, so it is the step
          the driver is ON, never steps[0]. */}
      {step && (
        <div ref={bannerRef} style={{ position: 'absolute', top: 12, left: 12, right: 12, zIndex: 6, background: '#0e1512', color: '#fff', borderRadius: 16, boxShadow: '0 6px 20px rgba(0,0,0,0.28)', padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 28, lineHeight: 1, color: MINT, flexShrink: 0 }}>{maneuverGlyph(step.maneuver)}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 800, lineHeight: 1.15, letterSpacing: '-0.01em' }}>{step.action}</div>
            {step.road && <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.72)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{step.road}</div>}
            <LaneHint lane={step.lane} />
            {/* Which side to pull over on, once that is the live question.
                Replaces the next-turn preview during the approach, because at
                that point there is no next turn worth previewing. */}
            {view.phase !== 'cruise' && view.side && (
              <div style={{ fontSize: 12.5, fontWeight: 700, color: MINT, marginTop: 3 }}>
                {String(destinationLabel).toUpperCase().startsWith('PICK') ? 'Pickup' : 'Drop-off'} on your {view.side}
              </div>
            )}
            {view.phase === 'cruise' && view.next && <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>then {maneuverGlyph(view.next.maneuver)} {view.next.action}{view.next.road ? ` · ${view.next.road}` : ''}</div>}
          </div>
        </div>
      )}

      {/* No route, and why. A blank map with no line teaches the driver the
          feature is broken; this is something they can act on and report. */}
      {routeError && !step && (
        <div ref={bannerRef} style={{ position: 'absolute', top: 12, left: 12, right: 12, zIndex: 6, background: '#0e1512', color: '#fff', borderRadius: 16, boxShadow: '0 6px 20px rgba(0,0,0,0.28)', padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 22, lineHeight: 1, color: '#F5B301', flexShrink: 0 }} aria-hidden="true">!</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: '-0.01em' }}>{ROUTE_ERROR_TEXT[routeError] || ROUTE_ERROR_TEXT.unavailable}</div>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.6)', marginTop: 2 }}>The map still shows you and the destination.</div>
          </div>
          <button type="button" onClick={retryRoute} style={{ flexShrink: 0, background: 'transparent', border: `1.5px solid ${MINT}`, color: MINT, borderRadius: 999, padding: '6px 12px', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>Retry</button>
        </div>
      )}

      {view.mode === 'free' && (
        <button type="button" onClick={recenter} aria-label="Re-centre" style={{ position: 'absolute', bottom: 14, right: 14, width: 44, height: 44, borderRadius: '50%', background: '#0e1512', border: `1.5px solid ${MINT}`, color: MINT, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 3px 10px rgba(0,0,0,0.25)', zIndex: 6 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={MINT} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /><circle cx="12" cy="12" r="5" /></svg>
        </button>
      )}
    </div>
  );
}
