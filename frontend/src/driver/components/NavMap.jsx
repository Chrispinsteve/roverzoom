import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GoogleMap, OverlayViewF, OverlayView, PolylineF } from '@react-google-maps/api';
import { useGoogleMaps } from '../../lib/GoogleMapsProvider';
import { useAnimatedPosition, usePrefersReducedMotion } from '../../lib/useAnimatedPosition';
import { NavController, RequestGuard } from '../lib/navController';
import { parseNavRoute } from '../lib/navRoute';
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
// Three states, ranked by how much of the driver's attention they deserve.
// The ranking is carried by VALUE (light/dark) as much as hue, so it survives
// glare, a dirty windscreen, and colour-vision deficiency — none of which a
// hue-only scheme survives.
//
//   TRACE_DONE     behind you        — grey. Recedes. Carries no instruction.
//   TRACE_AHEAD    the rest of it    — pale mint. Present, not competing.
//   TRACE_NOW      this maneuver     — full mint. The one thing to act on.
//
// One casing runs under both live states so the road reads as a single
// continuous lane; the brightness step rides on top of it instead of chopping
// the lane into two objects with a joint the eye catches on.
const TRACE_EDGE = '#0E7A57';
const TRACE_NOW = MINT;
const TRACE_AHEAD = '#8FE8C6';
const TRACE_DONE = '#BCC6C1';

// Framing insets, in CSS pixels. Named because fitBounds pads around
// COORDINATES while the driver sees MARKERS, and the difference between the
// two is exactly how a destination ends up half off the screen.
const CARD_OVERLAP_PX = 20;   // .drv-nav-card's negative top margin
const DEST_LABEL_H = 26;      // pin label, drawn below the coordinate
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

const NAV_STYLES = [
  { elementType: 'geometry', stylers: [{ color: '#f3f5f2' }] },
  { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#5b615c' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#f3f5f2' }, { weight: 2 }] },
  { featureType: 'administrative', elementType: 'geometry', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
  { featureType: 'administrative.neighborhood', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ color: '#eceeea' }] },
  { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: '#eef1ec' }] },
  { featureType: 'road', elementType: 'labels', stylers: [{ visibility: 'simplified' }] },
  { featureType: 'road.local', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
  { featureType: 'road.local', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#e6e8e4' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#d3d7d1' }] },
  { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: '#c2c7bf' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#cfe0dc' }] },
  { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: '#93a5a0' }] },
];

const MAP_OPTIONS = {
  disableDefaultUI: true, clickableIcons: false, gestureHandling: 'greedy',
  keyboardShortcuts: false, styles: NAV_STYLES, backgroundColor: '#f3f5f2',
  minZoom: 4, maxZoom: 19,
};

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
      <div style={{ transform: 'translate(-50%,-50%)', width: 44, height: 44, position: 'relative' }}>
        <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'rgba(62,224,160,0.18)', animation: 'rz-map-pulse 3s ease-out infinite' }} />
        <span style={{ position: 'absolute', inset: 9, borderRadius: '50%', background: '#0e1512', border: `2.5px solid ${MINT}`, boxShadow: '0 3px 10px rgba(0,0,0,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', transform: `rotate(${animated.heading || 0}deg)` }}>
          <svg width="16" height="16" viewBox="0 0 24 24"><path d="M12 3l7 16-7-4-7 4z" fill={MINT} stroke={MINT} strokeWidth="1.5" strokeLinejoin="round" /></svg>
        </span>
      </div>
    </OverlayViewF>
  );
}

function DestMarker({ position, label }) {
  const isPickup = String(label).toUpperCase() === 'PICKUP';
  return (
    <OverlayViewF position={position} mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}>
      {/* translate(-50%,-100%) keeps the pin TIP on the coordinate, which is
          why the label sits underneath rather than above: a label on top pushes
          the marker up and the tip stops pointing at anything. */}
      <div style={{ transform: 'translate(-50%,-100%)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <span style={{
          width: 30, height: 30, borderRadius: '50% 50% 50% 0',
          background: MINT, border: '3px solid #fff', boxShadow: '0 4px 12px rgba(0,0,0,0.35)',
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
        <span style={{
          marginTop: 5, fontSize: 10.5, fontWeight: 800, letterSpacing: '0.08em',
          color: '#0e1512', background: MINT, padding: '3px 8px', borderRadius: 6,
          whiteSpace: 'nowrap', boxShadow: '0 2px 6px rgba(0,0,0,0.2)',
        }}>{label}</span>
      </div>
    </OverlayViewF>
  );
}

export default function NavMap({ driver, destination, destinationLabel = 'PICKUP', onRouteInfo, updateIntervalMs = 5000 }) {
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
      visual: c.visualPosition(),
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
    map.fitBounds(bounds, {
      // Banner sits at top:12 and covers the map completely.
      top: (bannerH ? bannerH + 12 : 0) + MARKER_HALO,
      // The card overlaps the map by its negative margin only; the rest of the
      // inset is the destination pin's own label, drawn BELOW its coordinate.
      bottom: CARD_OVERLAP_PX + DEST_LABEL_H + MARKER_HALO,
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

    ctrlRef.current.setRoute(parsed, { reroute: !!isReroute });
    // First route → show the whole journey briefly, then hand to follow.
    if (!isReroute) {
      requestAnimationFrame(fitToRoute);
      window.clearTimeout(overviewTimer.current);
      overviewTimer.current = window.setTimeout(() => { ctrlRef.current.startFollowing(); snapshot(); }, 2500);
    }
    snapshot();
  }, [destPt, fitToRoute, snapshot]);

  const onLoad = useCallback((map) => {
    mapRef.current = map;
    const h = map.getDiv()?.offsetHeight;
    if (h) ctrlRef.current.setViewport(h);
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
    return <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f3f5f2', color: '#5b615c', fontSize: 13, textAlign: 'center', padding: 20 }}>Map unavailable — use “Open in Maps” to navigate.</div>;
  }
  if (!isLoaded) {
    return <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f3f5f2', color: '#93a5a0', fontSize: 13 }}>Loading map…</div>;
  }

  const step = view.step;

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
      >
        {/* ---- Trace Lane ------------------------------------------------
            Drawn back to front: what is done, then the road still to drive,
            then the maneuver in hand. Progress is a property of the ROUTE
            here, not a number in a card — the driver reads how far along they
            are from the line itself, without looking away from it.

            Each state is two polylines (a long cached one and a short live
            one) sharing a colour and width, so they read as a single lane. */}
        {lanes.donePast.length > 1 && (
          <PolylineF path={lanes.donePast} options={{ strokeColor: TRACE_DONE, strokeOpacity: 0.85, strokeWeight: 8, zIndex: 1 }} />
        )}
        {lanes.doneNow.length > 1 && (
          <PolylineF path={lanes.doneNow} options={{ strokeColor: TRACE_DONE, strokeOpacity: 0.85, strokeWeight: 8, zIndex: 1 }} />
        )}
        {lanes.ahead.length > 1 && (
          <PolylineF path={lanes.ahead} options={{ strokeColor: TRACE_EDGE, strokeOpacity: 1, strokeWeight: 15, zIndex: 2 }} />
        )}
        {lanes.now.length > 1 && (
          <PolylineF path={lanes.now} options={{ strokeColor: TRACE_EDGE, strokeOpacity: 1, strokeWeight: 15, zIndex: 2 }} />
        )}
        {lanes.ahead.length > 1 && (
          <PolylineF path={lanes.ahead} options={{ strokeColor: TRACE_AHEAD, strokeOpacity: 1, strokeWeight: 9.5, zIndex: 3 }} />
        )}
        {lanes.now.length > 1 && (
          <PolylineF path={lanes.now} options={{ strokeColor: TRACE_NOW, strokeOpacity: 1, strokeWeight: 9.5, zIndex: 4 }} />
        )}
        {destPt && <DestMarker position={destPt} label={destinationLabel} />}
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
            {view.next && <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>then {maneuverGlyph(view.next.maneuver)} {view.next.action}{view.next.road ? ` · ${view.next.road}` : ''}</div>}
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
