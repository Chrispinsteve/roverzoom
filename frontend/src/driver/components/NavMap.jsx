import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GoogleMap, OverlayViewF, OverlayView, PolylineF } from '@react-google-maps/api';
import { useGoogleMaps } from '../../lib/GoogleMapsProvider';
import { useAnimatedPosition, usePrefersReducedMotion } from '../../lib/useAnimatedPosition';

// ============================================================
// NavMap — the driver's navigation surface
// ============================================================
// Not a generic map with a dot on it. The ROUTE is the subject: a real
// road-following Google Directions line in RoverZoom mint, on a light,
// de-cluttered navigation basemap, with the vehicle marker driver-centred
// and the camera framing the road ahead. Turn-by-turn text comes straight
// from the Directions steps — no faked "in 437 ft" precision the browser
// can't stand behind.
//
// Native-grade nav (road-snapping, voice, hard reroute) needs the Google
// Navigation SDK, which is Android/iOS only — so this is the best a web
// PWA can honestly be, and "Open in Maps" stays as the real-nav fallback.
// ============================================================

const MINT = '#3EE0A0';
const MINT_CASING = '#1FA574';

// Light, navigation-oriented basemap. Route must be the strongest thing on
// screen, so everything else is muted: POIs off, labels quiet, roads a soft
// hierarchy (highways darkest → locals lightest).
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
  disableDefaultUI: true,
  clickableIcons: false,
  gestureHandling: 'greedy',
  keyboardShortcuts: false,
  styles: NAV_STYLES,
  backgroundColor: '#f3f5f2',
  minZoom: 4,
  maxZoom: 19,
};

// --- geo helpers (self-contained; no geometry lib dependency) --------------
const R_EARTH = 6378137;
const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

function distanceMeters(a, b) {
  if (!a || !b) return Infinity;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R_EARTH * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function bearing(a, b) {
  const φ1 = toRad(a.lat), φ2 = toRad(b.lat), Δλ = toRad(b.lng - a.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// A point `dist` metres from origin along `brng` degrees.
function offsetPoint(origin, brng, dist) {
  const δ = dist / R_EARTH;
  const θ = toRad(brng);
  const φ1 = toRad(origin.lat), λ1 = toRad(origin.lng);
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: toDeg(φ2), lng: toDeg(λ2) };
}

function metersPerPixel(lat, zoom) {
  return (156543.03392 * Math.cos(toRad(lat))) / 2 ** zoom;
}

// Tighter as the driver nears the destination — route overview far out,
// street-level for the final approach.
function zoomForDistance(m) {
  if (m > 4000) return 13;
  if (m > 2000) return 14;
  if (m > 900) return 15;
  if (m > 350) return 16;
  if (m > 140) return 17;
  return 18;
}

function stripHtml(s) {
  if (!s) return '';
  const div = typeof document !== 'undefined' ? document.createElement('div') : null;
  if (!div) return s.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  div.innerHTML = s;
  return (div.textContent || div.innerText || '').replace(/\s+/g, ' ').trim();
}

// A directional glyph for the step's maneuver — kept simple and honest.
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

// ------------------------------------------------------------
// Vehicle marker — driver-centred, rotates to heading.
// ------------------------------------------------------------
function VehicleMarker({ position, intervalMs }) {
  const reduced = usePrefersReducedMotion();
  const animated = useAnimatedPosition(position, { durationMs: intervalMs, enabled: !reduced });
  if (!animated) return null;
  return (
    <OverlayViewF position={{ lat: animated.lat, lng: animated.lng }} mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}>
      <div style={{ transform: 'translate(-50%,-50%)', width: 46, height: 46, position: 'relative' }}>
        <span style={{
          position: 'absolute', inset: 0, borderRadius: '50%',
          background: 'rgba(62,224,160,0.25)', animation: 'rz-map-pulse 2.4s ease-out infinite',
        }} />
        <span style={{
          position: 'absolute', inset: 9, borderRadius: '50%', background: '#0e1512',
          border: `2.5px solid ${MINT}`, boxShadow: '0 3px 10px rgba(0,0,0,0.35)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transform: `rotate(${animated.heading || 0}deg)`,
        }}>
          {/* Forward chevron = "you, facing this way" */}
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={MINT} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 4l7 15-7-4-7 4z" fill={MINT} stroke={MINT} />
          </svg>
        </span>
      </div>
    </OverlayViewF>
  );
}

// ------------------------------------------------------------
// Destination marker — the objective. Big, mint, labelled.
// ------------------------------------------------------------
function DestMarker({ position, label }) {
  return (
    <OverlayViewF position={position} mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}>
      <div style={{ transform: 'translate(-50%,-100%)', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <span style={{
          fontSize: 10.5, fontWeight: 800, letterSpacing: '0.08em', color: '#0e1512',
          background: MINT, padding: '3px 8px', borderRadius: 6, marginBottom: 4, whiteSpace: 'nowrap',
          boxShadow: '0 2px 6px rgba(0,0,0,0.18)',
        }}>{label}</span>
        <span style={{
          width: 20, height: 20, borderRadius: '50% 50% 50% 0', background: MINT,
          border: '3px solid #fff', boxShadow: '0 3px 8px rgba(0,0,0,0.3)',
          transform: 'rotate(45deg)',
        }} />
      </div>
    </OverlayViewF>
  );
}

// ============================================================
// NavMap
// ============================================================
/**
 * @param {{lat,lng,heading?}|null} driver   live driver position
 * @param {{lat,lng}} destination            where the route ends (pickup or dropoff)
 * @param {string} destinationLabel          'PICKUP' | 'DROPOFF'
 * @param {(info:{etaText,distanceText,step})=>void} onRouteInfo
 * @param {number} updateIntervalMs
 */
export default function NavMap({ driver, destination, destinationLabel = 'PICKUP', onRouteInfo, updateIntervalMs = 5000 }) {
  const { isLoaded, hasApiKey, loadError } = useGoogleMaps();
  const mapRef = useRef(null);
  const [ready, setReady] = useState(false);

  const [routePath, setRoutePath] = useState(null);
  const [steps, setSteps] = useState([]);
  const lastFetchRef = useRef({ origin: null, at: 0 });

  const [userMoved, setUserMoved] = useState(false);
  const programmatic = useRef(false);

  const hasDriver = driver && driver.lat != null;
  const hasDest = destination && destination.lat != null;

  // --- Route computation (Directions) --------------------------------------
  // Recomputed as the driver moves — a light "reroute": always drawn from
  // roughly where they are now, so the first step stays the current guidance.
  useEffect(() => {
    if (!isLoaded || !hasDriver || !hasDest || !window.google?.maps) return;
    const origin = { lat: Number(driver.lat), lng: Number(driver.lng) };
    const dest = { lat: Number(destination.lat), lng: Number(destination.lng) };

    const { origin: lastOrigin, at } = lastFetchRef.current;
    const movedFar = !lastOrigin || distanceMeters(lastOrigin, origin) > 200;
    const longEnough = Date.now() - at > 15000;
    if (routePath && !(movedFar && longEnough)) return; // throttle Directions calls

    lastFetchRef.current = { origin, at: Date.now() };
    const svc = new window.google.maps.DirectionsService();
    svc.route(
      { origin, destination: dest, travelMode: window.google.maps.TravelMode.DRIVING },
      (res, status) => {
        if (status !== 'OK' || !res?.routes?.[0]) return;
        const route = res.routes[0];
        const leg = route.legs?.[0];
        setRoutePath(route.overview_path.map((p) => ({ lat: p.lat(), lng: p.lng() })));
        const parsed = (leg?.steps || []).map((s) => ({
          instruction: stripHtml(s.instructions),
          maneuver: s.maneuver || null,
          distanceText: s.distance?.text || '',
          end: { lat: s.end_location.lat(), lng: s.end_location.lng() },
        }));
        setSteps(parsed);
        onRouteInfo?.({
          etaText: leg?.duration?.text || null,
          distanceText: leg?.distance?.text || null,
          step: parsed[0] || null,
        });
      }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, hasDriver, hasDest, driver?.lat, driver?.lng, destination?.lat, destination?.lng]);

  const onLoad = useCallback((map) => { mapRef.current = map; setReady(true); }, []);
  const onUnmount = useCallback(() => { mapRef.current = null; setReady(false); }, []);

  const fitToRoute = useCallback(() => {
    const map = mapRef.current;
    if (!map || !window.google) return;
    const bounds = new window.google.maps.LatLngBounds();
    if (routePath?.length) routePath.forEach((p) => bounds.extend(p));
    else {
      if (hasDriver) bounds.extend({ lat: Number(driver.lat), lng: Number(driver.lng) });
      if (hasDest) bounds.extend({ lat: Number(destination.lat), lng: Number(destination.lng) });
    }
    if (bounds.isEmpty()) return;
    programmatic.current = true;
    map.fitBounds(bounds, { top: 90, bottom: 150, left: 50, right: 50 });
    setUserMoved(false);
    setTimeout(() => { programmatic.current = false; }, 450);
  }, [routePath, hasDriver, hasDest, driver, destination]);

  // First framing: route overview.
  useEffect(() => {
    if (ready && routePath) fitToRoute();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, !!routePath]);

  // Follow the driver: centre ahead of the vehicle (so it sits lower on
  // screen with the road ahead visible) and zoom by proximity to the goal.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || userMoved || !hasDriver) return;
    const d = { lat: Number(driver.lat), lng: Number(driver.lng) };
    const toDest = hasDest ? distanceMeters(d, { lat: Number(destination.lat), lng: Number(destination.lng) }) : 1000;
    const zoom = zoomForDistance(toDest);

    // Look-ahead: shift the centre ~26% of the viewport ahead of the driver,
    // along their heading (or toward the destination if heading is unknown),
    // which places the marker in the lower third with the route ahead.
    const brng = (driver.heading != null && !Number.isNaN(driver.heading))
      ? driver.heading
      : (hasDest ? bearing(d, { lat: Number(destination.lat), lng: Number(destination.lng) }) : 0);
    const div = map.getDiv();
    const viewportH = (div && div.offsetHeight) || 320;
    const aheadM = metersPerPixel(d.lat, zoom) * viewportH * 0.26;
    const center = offsetPoint(d, brng, aheadM);

    programmatic.current = true;
    map.setZoom(zoom);
    map.panTo(center);
    const t = setTimeout(() => { programmatic.current = false; }, 350);
    return () => clearTimeout(t);
  }, [ready, userMoved, hasDriver, driver?.lat, driver?.lng, driver?.heading, hasDest, destination]);

  const onGesture = useCallback(() => { if (!programmatic.current) setUserMoved(true); }, []);

  const center = useMemo(() => {
    if (hasDriver) return { lat: Number(driver.lat), lng: Number(driver.lng) };
    if (hasDest) return { lat: Number(destination.lat), lng: Number(destination.lng) };
    return { lat: 26.7153, lng: -80.0534 };
  }, [hasDriver, hasDest, driver, destination]);

  if (loadError || !hasApiKey) {
    return (
      <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f3f5f2', color: '#5b615c', fontSize: 13, textAlign: 'center', padding: 20 }}>
        Map unavailable — tap “Open in Maps” to navigate.
      </div>
    );
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
        {hasDest && <DestMarker position={{ lat: Number(destination.lat), lng: Number(destination.lng) }} label={destinationLabel} />}
        {hasDriver && (
          <VehicleMarker position={{ lat: Number(driver.lat), lng: Number(driver.lng), heading: driver.heading ?? 0 }} intervalMs={updateIntervalMs} />
        )}
      </GoogleMap>

      {/* Next-maneuver banner — Google's own step text for the current
          position (route is recomputed as they move), plus a muted "then".
          No invented distances: we show only the step distance Google gives. */}
      {steps[0] && (
        <div style={{
          position: 'absolute', top: 12, left: 12, right: 12, zIndex: 6,
          background: '#0e1512', color: '#fff', borderRadius: 16,
          boxShadow: '0 6px 20px rgba(0,0,0,0.28)', padding: '12px 14px',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span style={{ fontSize: 26, lineHeight: 1, color: MINT, flexShrink: 0 }}>{maneuverGlyph(steps[0].maneuver)}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15.5, fontWeight: 700, lineHeight: 1.25, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
              {steps[0].instruction}
            </div>
            {steps[1] && (
              <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.6)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                then {maneuverGlyph(steps[1].maneuver)} {steps[1].instruction}
              </div>
            )}
          </div>
          {steps[0].distanceText && (
            <span style={{ fontSize: 13.5, fontWeight: 700, color: MINT, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{steps[0].distanceText}</span>
          )}
        </div>
      )}

      {/* Re-centre control — only once the driver has panned away. */}
      {userMoved && (
        <button
          type="button"
          onClick={fitToRoute}
          aria-label="Re-centre"
          style={{
            position: 'absolute', bottom: 14, right: 14, width: 42, height: 42, borderRadius: '50%',
            background: '#0e1512', border: `1.5px solid ${MINT}`, color: MINT, cursor: 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 3px 10px rgba(0,0,0,0.25)', zIndex: 5,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={MINT} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 2v3M12 19v3M2 12h3M19 12h3" /><circle cx="12" cy="12" r="5" />
          </svg>
        </button>
      )}
    </div>
  );
}
