import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GoogleMap, OverlayViewF, OverlayView, PolylineF } from '@react-google-maps/api';
import { useGoogleMaps } from '../../lib/GoogleMapsProvider';
import { useAnimatedPosition, usePrefersReducedMotion } from '../../lib/useAnimatedPosition';
import {
  distanceToPath, advanceStepIndex, shouldReroute, shouldRepan, followCamera,
} from '../lib/navMath';

// ============================================================
// NavMap — the driver's navigation surface
// ============================================================
// The ROUTE is the subject: a real road-following Google Directions line in
// RoverZoom mint on a light, de-cluttered basemap; the vehicle marker is
// driver-centred with the road ahead; guidance is Google's own step text.
//
// Deliberately NOT faking native Navigation SDK behaviour (road-snapping,
// voice, hard reroute, live "in 437 ft"). Camera/route/step decisions all
// live in ../lib/navMath.js so they can be unit-tested against simulated
// movement. "Open in Maps" stays as the real-nav fallback.
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
    case 'turn-left': case 'ramp-left': case 'fork-left': case 'roundabout-left': return '↰';
    case 'turn-right': case 'ramp-right': case 'fork-right': case 'roundabout-right': return '↱';
    case 'turn-slight-left': return '↖';
    case 'turn-slight-right': return '↗';
    case 'turn-sharp-left': return '⬅';
    case 'turn-sharp-right': return '➡';
    case 'uturn-left': case 'uturn-right': return '⤺';
    case 'merge': return '⇗';
    default: return '↑';
  }
}

// Fixed screen-space size (OverlayView) so it never becomes microscopic at any
// zoom. Rotates to heading; heading is smoothed by useAnimatedPosition.
function VehicleMarker({ position, intervalMs }) {
  const reduced = usePrefersReducedMotion();
  const animated = useAnimatedPosition(position, { durationMs: intervalMs, enabled: !reduced });
  if (!animated) return null;
  return (
    <OverlayViewF position={{ lat: animated.lat, lng: animated.lng }} mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}>
      <div style={{ transform: 'translate(-50%,-50%)', width: 44, height: 44, position: 'relative' }}>
        <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', background: 'rgba(62,224,160,0.18)', animation: 'rz-map-pulse 3s ease-out infinite' }} />
        <span style={{
          position: 'absolute', inset: 9, borderRadius: '50%', background: '#0e1512',
          border: `2.5px solid ${MINT}`, boxShadow: '0 3px 10px rgba(0,0,0,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transform: `rotate(${animated.heading || 0}deg)`,
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24"><path d="M12 3l7 16-7-4-7 4z" fill={MINT} stroke={MINT} strokeWidth="1.5" strokeLinejoin="round" /></svg>
        </span>
      </div>
    </OverlayViewF>
  );
}

function DestMarker({ position, label }) {
  return (
    <OverlayViewF position={position} mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}>
      <div style={{ transform: 'translate(-50%,-100%)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <span style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.08em', color: '#0e1512', background: MINT, padding: '3px 8px', borderRadius: 6, marginBottom: 4, whiteSpace: 'nowrap', boxShadow: '0 2px 6px rgba(0,0,0,0.2)' }}>{label}</span>
        <span style={{ width: 20, height: 20, borderRadius: '50% 50% 50% 0', background: MINT, border: '3px solid #fff', boxShadow: '0 3px 8px rgba(0,0,0,0.3)', transform: 'rotate(45deg)' }} />
      </div>
    </OverlayViewF>
  );
}

export default function NavMap({ driver, destination, destinationLabel = 'PICKUP', onRouteInfo, updateIntervalMs = 5000 }) {
  const { isLoaded, hasApiKey, loadError } = useGoogleMaps();
  const mapRef = useRef(null);
  const [ready, setReady] = useState(false);

  const [routePath, setRoutePath] = useState(null);
  const [steps, setSteps] = useState([]);
  const [stepIdx, setStepIdx] = useState(0);
  const [mode, setMode] = useState('overview'); // 'overview' | 'follow' | 'free'

  const fetchState = useRef({ inFlight: false, lastRerouteAt: 0 });
  const lastCenterRef = useRef(null);
  const programmatic = useRef(false);

  const hasDriver = driver && driver.lat != null;
  const destPt = useMemo(
    () => (destination && destination.lat != null ? { lat: Number(destination.lat), lng: Number(destination.lng) } : null),
    [destination?.lat, destination?.lng]
  );

  const fetchRoute = useCallback((originPt) => {
    if (!window.google?.maps || !destPt || !originPt || fetchState.current.inFlight) return;
    fetchState.current.inFlight = true;
    fetchState.current.lastRerouteAt = Date.now();
    const svc = new window.google.maps.DirectionsService();
    svc.route(
      { origin: originPt, destination: destPt, travelMode: window.google.maps.TravelMode.DRIVING },
      (res, status) => {
        fetchState.current.inFlight = false;
        if (status !== 'OK' || !res?.routes?.[0]) return;
        const route = res.routes[0];
        const leg = route.legs?.[0];
        setRoutePath(route.overview_path.map((p) => ({ lat: p.lat(), lng: p.lng() })));
        const parsed = (leg?.steps || []).map((s) => ({
          instruction: stripHtml(s.instructions),
          maneuver: s.maneuver || null,
          end: { lat: s.end_location.lat(), lng: s.end_location.lng() },
        }));
        setSteps(parsed);
        setStepIdx(0);
        onRouteInfo?.({ etaText: leg?.duration?.text || null, distanceText: leg?.distance?.text || null });
      }
    );
  }, [destPt, onRouteInfo]);

  // Initial route only. Subsequent recomputes happen on genuine deviation below.
  useEffect(() => {
    if (isLoaded && hasDriver && destPt && !routePath) {
      fetchRoute({ lat: Number(driver.lat), lng: Number(driver.lng) });
    }
  }, [isLoaded, hasDriver, destPt, routePath, fetchRoute, driver]);

  const onLoad = useCallback((m) => { mapRef.current = m; setReady(true); }, []);
  const onUnmount = useCallback(() => { mapRef.current = null; setReady(false); }, []);

  const fitToRoute = useCallback(() => {
    const map = mapRef.current;
    if (!map || !window.google) return;
    const bounds = new window.google.maps.LatLngBounds();
    if (routePath?.length) routePath.forEach((p) => bounds.extend(p));
    else {
      if (hasDriver) bounds.extend({ lat: Number(driver.lat), lng: Number(driver.lng) });
      if (destPt) bounds.extend(destPt);
    }
    if (bounds.isEmpty()) return;
    programmatic.current = true;
    map.fitBounds(bounds, { top: 96, bottom: 150, left: 48, right: 48 });
    setTimeout(() => { programmatic.current = false; }, 500);
  }, [routePath, hasDriver, destPt, driver]);

  // Pan the follow camera to a driver position (used by the driver effect and
  // by explicit recenter).
  const panFollow = useCallback((d) => {
    const map = mapRef.current;
    if (!map) return;
    const div = map.getDiv();
    const vh = (div && div.offsetHeight) || 320;
    const { center, zoom } = followCamera(d, destPt, vh);
    programmatic.current = true;
    if (map.getZoom() !== zoom) map.setZoom(zoom);
    map.panTo(center);
    lastCenterRef.current = d;
    setTimeout(() => { programmatic.current = false; }, 400);
  }, [destPt]);

  // Initial framing = route overview, then hand off to follow after a beat.
  useEffect(() => {
    if (ready && routePath && mode === 'overview') {
      fitToRoute();
      const t = setTimeout(() => setMode('follow'), 2500);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [ready, routePath, mode, fitToRoute]);

  // Driver moved: advance the maneuver step, reroute only on real deviation,
  // and follow the camera (throttled so GPS noise can't shake the map).
  useEffect(() => {
    if (!hasDriver) return;
    const d = { lat: Number(driver.lat), lng: Number(driver.lng), heading: driver.heading };

    if (steps.length) setStepIdx((i) => advanceStepIndex(i, steps, d));

    if (routePath) {
      const dev = distanceToPath(d, routePath);
      if (shouldReroute({ noRoute: false, deviationM: dev, lastRerouteAt: fetchState.current.lastRerouteAt, now: Date.now() })) {
        fetchRoute(d);
      }
    }

    if (ready && mode === 'follow' && shouldRepan(lastCenterRef.current, d)) {
      panFollow(d);
    }
  }, [driver?.lat, driver?.lng, driver?.heading, steps, routePath, ready, mode, fetchRoute, panFollow, hasDriver, driver]);

  // User panned/zoomed → drop out of follow so we never fight them.
  const onGesture = useCallback(() => {
    if (!programmatic.current) setMode((m) => (m === 'follow' ? 'free' : m));
  }, []);

  // Explicit recenter → resume following immediately.
  const recenter = useCallback(() => {
    lastCenterRef.current = null;
    setMode('follow');
    if (hasDriver) panFollow({ lat: Number(driver.lat), lng: Number(driver.lng), heading: driver.heading });
  }, [hasDriver, driver, panFollow]);

  const center = useMemo(() => {
    if (hasDriver) return { lat: Number(driver.lat), lng: Number(driver.lng) };
    if (destPt) return destPt;
    return { lat: 26.7153, lng: -80.0534 };
  }, [hasDriver, destPt, driver]);

  const currentStep = steps[stepIdx] || null;
  const nextStep = steps[stepIdx + 1] || null;

  if (loadError || !hasApiKey) {
    return <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f3f5f2', color: '#5b615c', fontSize: 13, textAlign: 'center', padding: 20 }}>Map unavailable — use “Open in Maps” to navigate.</div>;
  }
  if (!isLoaded) {
    return <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f3f5f2', color: '#93a5a0', fontSize: 13 }}>Loading map…</div>;
  }

  return (
    <div style={{ position: 'relative', height: '100%', width: '100%' }}>
      <GoogleMap
        mapContainerStyle={{ width: '100%', height: '100%' }}
        center={center}
        zoom={15}
        options={MAP_OPTIONS}
        onLoad={onLoad}
        onUnmount={onUnmount}
        onDragStart={onGesture}
        onZoomChanged={onGesture}
      >
        {routePath && (
          <>
            <PolylineF path={routePath} options={{ strokeColor: MINT_CASING, strokeOpacity: 1, strokeWeight: 10, zIndex: 1 }} />
            <PolylineF path={routePath} options={{ strokeColor: MINT, strokeOpacity: 1, strokeWeight: 6, zIndex: 2 }} />
          </>
        )}
        {destPt && <DestMarker position={destPt} label={destinationLabel} />}
        {hasDriver && <VehicleMarker position={{ lat: Number(driver.lat), lng: Number(driver.lng), heading: driver.heading ?? 0 }} intervalMs={updateIntervalMs} />}
      </GoogleMap>

      {/* Next-maneuver banner — Google's step text; no invented live distances. */}
      {currentStep && (
        <div style={{ position: 'absolute', top: 12, left: 12, right: 12, zIndex: 6, background: '#0e1512', color: '#fff', borderRadius: 16, boxShadow: '0 6px 20px rgba(0,0,0,0.28)', padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 26, lineHeight: 1, color: MINT, flexShrink: 0 }}>{maneuverGlyph(currentStep.maneuver)}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15.5, fontWeight: 700, lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{currentStep.instruction}</div>
            {nextStep && (
              <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.6)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>then {maneuverGlyph(nextStep.maneuver)} {nextStep.instruction}</div>
            )}
          </div>
        </div>
      )}

      {/* Re-centre — only when the driver has taken over the camera. */}
      {mode === 'free' && (
        <button type="button" onClick={recenter} aria-label="Re-centre" style={{ position: 'absolute', bottom: 14, right: 14, width: 44, height: 44, borderRadius: '50%', background: '#0e1512', border: `1.5px solid ${MINT}`, color: MINT, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 3px 10px rgba(0,0,0,0.25)', zIndex: 6 }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={MINT} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /><circle cx="12" cy="12" r="5" /></svg>
        </button>
      )}
    </div>
  );
}
