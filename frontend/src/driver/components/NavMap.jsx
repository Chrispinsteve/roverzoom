import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GoogleMap, OverlayViewF, OverlayView, PolylineF } from '@react-google-maps/api';
import { useGoogleMaps } from '../../lib/GoogleMapsProvider';
import { useAnimatedPosition, usePrefersReducedMotion } from '../../lib/useAnimatedPosition';
import { NavController, RequestGuard } from '../lib/navController';
import { parseManeuver } from '../lib/navMath';

// ============================================================
// NavMap — thin React/Google shell over the tested NavController
// ============================================================
// All navigation decisions (progress, current step, deviation/reroute, camera
// mode, heading) live in ../lib/navController.js and are unit-tested against a
// simulated GPS stream. This file only: fetches routes from Google (with a
// race guard so a stale response can't overwrite a newer route), feeds GPS in,
// applies the camera imperatively, and renders the mint route + markers +
// maneuver banner. No faked native-nav behaviour.
// ============================================================

const MINT = '#3EE0A0';
const MINT_CASING = '#1FA574';

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

function stripHtml(s) {
  if (!s) return '';
  if (typeof document === 'undefined') return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const div = document.createElement('div');
  div.innerHTML = s;
  return (div.textContent || div.innerText || '').replace(/\s+/g, ' ').trim();
}

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
  const distanceText = mi >= 10 ? `${Math.round(mi)} mi` : `${mi.toFixed(1)} mi`;
  const etaText = `${Math.max(1, Math.round(rem.sec / 60))} min`;
  return { etaText, distanceText };
}

// Turn Directions' route into the controller's shape: a detailed path with each
// vertex tagged by its step, plus parsed { action, road } maneuvers.
function parseDirections(route) {
  const leg = route.legs?.[0];
  const path = [];
  const steps = [];
  (leg?.steps || []).forEach((s, si) => {
    steps.push(parseManeuver({
      maneuver: s.maneuver || null,
      instruction: stripHtml(s.instructions),
      // Carried per step so remaining time can be SUMMED rather than
      // interpolated. Interpolating total duration by distance assumes every
      // mile takes the same time, so a route that is mostly highway then city
      // reports nonsense the moment the driver leaves the highway.
      distM: s.distance?.value ?? 0,
      durSec: s.duration?.value ?? 0,
    }));
    const pts = s.path || [];
    pts.forEach((pt) => path.push({ lat: pt.lat(), lng: pt.lng(), step: si }));
  });
  return {
    path,
    steps,
    totalDistM: leg?.distance?.value || 0,
    // duration_in_traffic is present only when drivingOptions was sent and
    // Google has data for the road. Prefer it; fall back to free-flow.
    totalDurSec: leg?.duration_in_traffic?.value || leg?.duration?.value || 0,
    trafficAware: Boolean(leg?.duration_in_traffic?.value),
  };
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
  const [routePath, setRoutePath] = useState(null);
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
    setView({ mode: c.mode, step: c.currentStep(), next: c.nextStep(), heading: c.stableHeading });
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

  const fitToRoute = useCallback(() => {
    const map = mapRef.current;
    const c = ctrlRef.current;
    if (!map || !window.google) return;
    const bounds = new window.google.maps.LatLngBounds();
    if (c.path.length) {
      c.path.forEach((p) => bounds.extend(p));
    } else {
      // No route — a failed Directions call, or one still in flight. Fit the
      // driver and the destination anyway, so the screen still answers "where
      // am I and where am I going" instead of sitting at a default zoom with
      // the destination off the edge.
      const pts = [lastDriverRef.current, destRef.current].filter(Boolean);
      if (pts.length < 2) return;
      pts.forEach((pt) => bounds.extend(pt));
    }
    programmatic.current = true;
    // Padding leaves room for the maneuver banner (top) and the bottom card so
    // the route/destination are never hidden behind the UI overlays.
    map.fitBounds(bounds, { top: 96, bottom: 176, left: 44, right: 44 });
    window.clearTimeout(fitToRoute._t);
    fitToRoute._t = window.setTimeout(() => { programmatic.current = false; }, 520);
  }, []);

  // mode: undefined (first route) | 'candidate' (a periodic look for a faster
  // road, adopted only if materially better).
  const fetchRoute = useCallback((origin, isReroute, mode) => {
    if (!window.google?.maps || !destPt || !origin) return;
    const token = guardRef.current.begin();
    const svc = new window.google.maps.DirectionsService();
    svc.route(
      {
        origin,
        destination: destPt,
        travelMode: window.google.maps.TravelMode.DRIVING,
        // Without drivingOptions the Directions API returns FREE-FLOW time —
        // the road as if empty. On I-95 at 5pm that is fiction, and it was
        // what the driver's ETA had always been built on.
        drivingOptions: {
          departureTime: new Date(),
          trafficModel: window.google.maps.TrafficModel.BEST_GUESS,
        },
      },
      (res, status) => {
        // Race guard: ignore a response that a newer request has superseded.
        if (!guardRef.current.isCurrent(token)) return;
        if (status !== 'OK' || !res?.routes?.[0]) return;
        const parsed = parseDirections(res.routes[0]);
        if (parsed.path.length < 2) return;

        // A periodic look for a faster road. Adopted only when it beats what
        // is left of the current route by a margin worth the disruption of
        // changing the line and the next turn under the driver.
        if (mode === 'candidate') {
          if (!ctrlRef.current.isWorthSwitching(parsed.totalDurSec)) return;
          ctrlRef.current.setRoute(parsed, { reroute: true });
          setRoutePath(parsed.path);
          snapshot();
          return;
        }

        ctrlRef.current.setRoute(parsed, { reroute: !!isReroute });
        setRoutePath(parsed.path);
        // First route → show overview, then hand to follow.
        if (!isReroute) {
          requestAnimationFrame(fitToRoute);
          window.clearTimeout(overviewTimer.current);
          overviewTimer.current = window.setTimeout(() => { ctrlRef.current.startFollowing(); snapshot(); }, 2500);
        }
        snapshot();
      }
    );
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
    if (ready && isLoaded && hasDriver && destPt && ctrlRef.current.path.length === 0) {
      fetchRoute({ lat: Number(driver.lat), lng: Number(driver.lng) }, false);
    }
  }, [ready, isLoaded, hasDriver, destPt, fetchRoute, driver]);

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
        {routePath && (
          <>
            <PolylineF path={routePath} options={{ strokeColor: MINT_CASING, strokeOpacity: 1, strokeWeight: 14, zIndex: 1 }} />
            <PolylineF path={routePath} options={{ strokeColor: MINT, strokeOpacity: 1, strokeWeight: 9, zIndex: 2 }} />
          </>
        )}
        {destPt && <DestMarker position={destPt} label={destinationLabel} />}
        {hasDriver && <VehicleMarker position={{ lat: Number(driver.lat), lng: Number(driver.lng), heading: view.heading ?? driver.heading ?? 0 }} intervalMs={updateIntervalMs} />}
      </GoogleMap>

      {/* Maneuver banner — trusted ACTION (large) + road (secondary). */}
      {step && (
        <div style={{ position: 'absolute', top: 12, left: 12, right: 12, zIndex: 6, background: '#0e1512', color: '#fff', borderRadius: 16, boxShadow: '0 6px 20px rgba(0,0,0,0.28)', padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 28, lineHeight: 1, color: MINT, flexShrink: 0 }}>{maneuverGlyph(step.maneuver)}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 17, fontWeight: 800, lineHeight: 1.15, letterSpacing: '-0.01em' }}>{step.action}</div>
            {step.road && <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.72)', marginTop: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{step.road}</div>}
            {view.next && <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.5)', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>then {maneuverGlyph(view.next.maneuver)} {view.next.action}{view.next.road ? ` · ${view.next.road}` : ''}</div>}
          </div>
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
