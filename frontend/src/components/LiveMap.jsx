import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GoogleMap, OverlayViewF, OverlayView, PolylineF } from '@react-google-maps/api';
import { useGoogleMaps } from '../lib/GoogleMapsProvider';
import { useAnimatedPosition, usePrefersReducedMotion } from '../lib/useAnimatedPosition';
import Icon from './Icon';

// ============================================================
// LiveMap — the one real map component
// ============================================================
// Used by the driver navigation screens, the rider tracking screen and
// (later) the admin dashboard. Everything it renders is optional, so the
// same component covers "here is the route" and "here is a car moving
// along it" without three near-identical copies drifting apart.
//
// Replaces the previous RouteMap, which drew a hand-authored SVG path
// with hardcoded percentage offsets — a picture of a route rather than a
// route.
// ============================================================

// Dark map styling to match the driver shell, which is always dark. Kept
// close to Bibior's map treatment in spirit — suppress noise, let the
// route and the vehicle be the only things that read as important — but
// inverted for a dark UI and tuned for navigation rather than browsing:
// road geometry stays legible instead of being flattened away, because
// on this map roads are the content.
const DARK_STYLES = [
  { elementType: 'geometry', stylers: [{ color: '#1a1c20' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#1a1c20' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#7a7d85' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2a2d33' }] },
  { featureType: 'road', elementType: 'labels', stylers: [{ visibility: 'simplified' }] },
  { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#33363d' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#3d414a' }] },
  { featureType: 'road.local', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0f1114' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#33363d' }] },
  { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ color: '#212429' }] },
];

const LIGHT_STYLES = [
  { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'water', elementType: 'geometry.fill', stylers: [{ color: '#dceaf2' }] },
  { featureType: 'road.local', elementType: 'labels', stylers: [{ visibility: 'off' }] },
  { featureType: 'landscape.natural', elementType: 'geometry.fill', stylers: [{ color: '#f4f4f5' }] },
];

const BASE_OPTIONS = {
  disableDefaultUI: true,
  zoomControl: false,
  mapTypeControl: false,
  streetViewControl: false,
  fullscreenControl: false,
  clickableIcons: false,
  gestureHandling: 'greedy',
  minZoom: 4,
  maxZoom: 19,
};

// ------------------------------------------------------------
// Vehicle marker
//
// Isolated into its own component on purpose. useAnimatedPosition sets
// state on every animation frame; keeping that inside a leaf means ~60
// re-renders a second touch this component alone rather than the map,
// the polyline and every sibling marker.
// ------------------------------------------------------------
function VehicleMarker({ position, intervalMs, stale }) {
  const reducedMotion = usePrefersReducedMotion();
  const animated = useAnimatedPosition(position, {
    durationMs: intervalMs,
    enabled: !reducedMotion,
  });

  if (!animated) return null;

  return (
    <OverlayViewF
      position={{ lat: animated.lat, lng: animated.lng }}
      mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}
    >
      <div
        style={{
          transform: 'translate(-50%, -50%)',
          position: 'relative',
          width: 40,
          height: 40,
          // A stale position is faded rather than hidden. Removing the
          // car entirely reads as "the trip ended"; a dimmed car with a
          // "last seen" label elsewhere reads correctly as "we have
          // temporarily lost the signal", which is what has happened.
          opacity: stale ? 0.45 : 1,
          transition: 'opacity 400ms ease',
        }}
      >
        {!stale && (
          <span
            aria-hidden="true"
            style={{
              position: 'absolute', inset: 0, borderRadius: '50%',
              background: 'rgba(59,130,246,0.28)',
              animation: 'rz-map-pulse 2s ease-out infinite',
            }}
          />
        )}
        <span
          style={{
            position: 'absolute', inset: 6,
            borderRadius: '50%', background: '#fff',
            boxShadow: '0 2px 10px rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            // Rotate the icon, not the wrapper — rotating the wrapper
            // would spin the pulse ring and the shadow with it.
            transform: `rotate(${animated.heading}deg)`,
          }}
        >
          <Icon name="navArrow" size={16} color="#0c0d0f" stroke={2.4} />
        </span>
      </div>
    </OverlayViewF>
  );
}

// ------------------------------------------------------------
// Endpoint markers
// ------------------------------------------------------------
function PointMarker({ position, kind, label }) {
  const isPickup = kind === 'pickup';
  return (
    <OverlayViewF position={position} mapPaneName={OverlayView.OVERLAY_MOUSE_TARGET}>
      <div style={{ transform: 'translate(-50%, -50%)', display: 'flex', alignItems: 'center', gap: 8 }}>
        <span
          style={{
            width: isPickup ? 14 : 16,
            height: isPickup ? 14 : 16,
            borderRadius: isPickup ? '50%' : 4,
            background: isPickup ? '#22c55e' : '#fff',
            border: '2.5px solid rgba(0,0,0,0.55)',
            boxShadow: '0 0 0 4px rgba(255,255,255,0.18)',
            flexShrink: 0,
          }}
        />
        {label && (
          <span
            style={{
              fontSize: 11, fontWeight: 600, whiteSpace: 'nowrap',
              color: '#fff', background: 'rgba(12,13,15,0.78)',
              padding: '3px 8px', borderRadius: 999,
              backdropFilter: 'blur(6px)',
              maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis',
            }}
          >
            {label}
          </span>
        )}
      </div>
    </OverlayViewF>
  );
}

// ------------------------------------------------------------
// Fallback when no map can be shown
//
// Never renders an empty box. If the API key is missing or the network
// blocked Google, the addresses are still the useful part.
// ------------------------------------------------------------
function MapFallback({ height, pickup, dropoff, reason }) {
  return (
    <div
      className="drv-map"
      style={{ height, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: 20, gap: 10 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#22c55e', flexShrink: 0 }} />
        <span style={{ color: 'rgba(255,255,255,0.9)', fontSize: 13 }}>
          {pickup?.address || 'Pickup'}
        </span>
      </div>
      <div style={{ width: 2, height: 18, background: 'rgba(255,255,255,0.25)', marginLeft: 4 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ width: 10, height: 10, borderRadius: 2, background: '#fff', flexShrink: 0 }} />
        <span style={{ color: 'rgba(255,255,255,0.9)', fontSize: 13 }}>
          {dropoff?.address || 'Drop-off'}
        </span>
      </div>
      <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11.5, margin: '6px 0 0' }}>{reason}</p>
    </div>
  );
}

// ============================================================
// LiveMap
// ============================================================
/**
 * @param {object}  props
 * @param {{lat,lng,address?}=} props.pickup
 * @param {{lat,lng,address?}=} props.dropoff
 * @param {{lat,lng,heading?}=} props.vehicle       live driver position
 * @param {string=} props.routePolyline             encoded polyline from the API
 * @param {Array<{lat,lng}>=} props.trail           breadcrumb history (admin replay)
 * @param {number=} props.height
 * @param {boolean=} props.follow                   keep the vehicle in view
 * @param {number=} props.updateIntervalMs          expected gap between fixes
 * @param {boolean=} props.vehicleStale
 * @param {'dark'|'light'=} props.theme
 * @param {React.ReactNode=} props.overlay          floating UI above the map
 */
export default function LiveMap({
  pickup,
  dropoff,
  vehicle,
  routePolyline,
  trail,
  height = 280,
  follow = true,
  updateIntervalMs = 5000,
  vehicleStale = false,
  theme = 'dark',
  overlay,
}) {
  const { isLoaded, hasApiKey, loadError } = useGoogleMaps();
  const mapRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);

  // Once the user pans or zooms, stop moving the map for them. Fighting
  // a user who is deliberately looking at something else is one of the
  // most irritating things a live map can do — the driver checking the
  // road ahead should not be yanked back to their own dot every five
  // seconds. Re-centring is offered as a button instead.
  const [userMoved, setUserMoved] = useState(false);
  const programmaticMove = useRef(false);

  const hasPickup = pickup?.lat != null;
  const hasDropoff = dropoff?.lat != null;
  const hasVehicle = vehicle?.lat != null;

  // Decode the stored encoded polyline into map coordinates. Depends on
  // the `geometry` library being loaded — see GoogleMapsProvider.
  const routePath = useMemo(() => {
    if (!isLoaded || !routePolyline || !window.google?.maps?.geometry?.encoding) return null;
    try {
      return window.google.maps.geometry.encoding
        .decodePath(routePolyline)
        .map((p) => ({ lat: p.lat(), lng: p.lng() }));
    } catch (err) {
      console.warn('[LiveMap] could not decode route polyline:', err);
      return null;
    }
  }, [isLoaded, routePolyline]);

  // With no real route geometry, connect the endpoints with a straight
  // line so the map still communicates direction and rough distance.
  // Rendered dashed rather than solid precisely so it does not
  // misrepresent itself as an actual driving route.
  const fallbackPath = useMemo(() => {
    if (routePath || !hasPickup || !hasDropoff) return null;
    return [
      { lat: Number(pickup.lat), lng: Number(pickup.lng) },
      { lat: Number(dropoff.lat), lng: Number(dropoff.lng) },
    ];
  }, [routePath, hasPickup, hasDropoff, pickup, dropoff]);

  const center = useMemo(() => {
    if (hasVehicle) return { lat: Number(vehicle.lat), lng: Number(vehicle.lng) };
    if (hasPickup) return { lat: Number(pickup.lat), lng: Number(pickup.lng) };
    if (hasDropoff) return { lat: Number(dropoff.lat), lng: Number(dropoff.lng) };
    return { lat: 26.7153, lng: -80.0534 }; // West Palm Beach
  }, [hasVehicle, hasPickup, hasDropoff, vehicle, pickup, dropoff]);

  const fitToContent = useCallback(() => {
    const map = mapRef.current;
    if (!map || !window.google) return;

    const bounds = new window.google.maps.LatLngBounds();
    let n = 0;
    if (hasPickup) { bounds.extend({ lat: Number(pickup.lat), lng: Number(pickup.lng) }); n++; }
    if (hasDropoff) { bounds.extend({ lat: Number(dropoff.lat), lng: Number(dropoff.lng) }); n++; }
    if (hasVehicle) { bounds.extend({ lat: Number(vehicle.lat), lng: Number(vehicle.lng) }); n++; }
    if (n === 0) return;

    programmaticMove.current = true;
    if (n === 1) {
      map.setCenter(bounds.getCenter());
      map.setZoom(15);
    } else {
      map.fitBounds(bounds, { top: 60, bottom: 60, left: 50, right: 50 });
    }
    setUserMoved(false);
    // Cleared on a timer rather than synchronously: fitBounds triggers
    // the map's own drag/zoom events asynchronously, and clearing the
    // flag straight away would let the app's own camera move register as
    // a user gesture and immediately disable following.
    setTimeout(() => { programmaticMove.current = false; }, 400);
  }, [hasPickup, hasDropoff, hasVehicle, pickup, dropoff, vehicle]);

  const onLoad = useCallback((map) => {
    mapRef.current = map;
    setMapReady(true);
  }, []);

  const onUnmount = useCallback(() => {
    mapRef.current = null;
    setMapReady(false);
  }, []);

  // Initial framing, once.
  useEffect(() => {
    if (mapReady) fitToContent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapReady]);

  // Follow the vehicle — but only while the user has not taken over.
  useEffect(() => {
    if (!mapReady || !follow || userMoved || !hasVehicle) return;
    const map = mapRef.current;
    if (!map) return;
    programmaticMove.current = true;
    // panTo, not setCenter: it animates, so the map glides with the car
    // instead of cutting.
    map.panTo({ lat: Number(vehicle.lat), lng: Number(vehicle.lng) });
    const t = setTimeout(() => { programmaticMove.current = false; }, 400);
    return () => clearTimeout(t);
  }, [mapReady, follow, userMoved, hasVehicle, vehicle?.lat, vehicle?.lng]);

  const handleUserGesture = useCallback(() => {
    if (programmaticMove.current) return;
    setUserMoved(true);
  }, []);

  const options = useMemo(() => ({
    ...BASE_OPTIONS,
    styles: theme === 'dark' ? DARK_STYLES : LIGHT_STYLES,
    backgroundColor: theme === 'dark' ? '#1a1c20' : '#f4f4f5',
  }), [theme]);

  if (loadError) {
    return <MapFallback height={height} pickup={pickup} dropoff={dropoff} reason="Map could not be loaded." />;
  }
  if (!hasApiKey) {
    return <MapFallback height={height} pickup={pickup} dropoff={dropoff} reason="Map unavailable — VITE_GOOGLE_MAPS_API_KEY is not set." />;
  }
  if (!isLoaded) {
    return (
      <div className="drv-map" style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 13 }}>Loading map…</span>
      </div>
    );
  }

  return (
    <div className="drv-map" style={{ height, position: 'relative' }}>
      <GoogleMap
        mapContainerStyle={{ width: '100%', height: '100%' }}
        center={center}
        zoom={14}
        options={options}
        onLoad={onLoad}
        onUnmount={onUnmount}
        onDragStart={handleUserGesture}
        onZoomChanged={handleUserGesture}
      >
        {/* Casing beneath the route, drawn first so the coloured line
            sits on top of it. Without it a bright route line vanishes
            against pale roads at high zoom. */}
        {routePath && (
          <>
            <PolylineF
              path={routePath}
              options={{ strokeColor: '#000000', strokeOpacity: 0.55, strokeWeight: 8, zIndex: 1 }}
            />
            <PolylineF
              path={routePath}
              options={{ strokeColor: '#3b82f6', strokeOpacity: 0.95, strokeWeight: 4.5, zIndex: 2 }}
            />
          </>
        )}

        {fallbackPath && (
          <PolylineF
            path={fallbackPath}
            options={{
              strokeColor: '#6b7280',
              strokeOpacity: 0,
              zIndex: 1,
              // Dashed via repeated dots — the documented way to draw a
              // dashed line in the Maps JS API, which has no dash array.
              icons: [{
                icon: { path: 'M 0,-1 0,1', strokeOpacity: 0.8, strokeWeight: 3, scale: 3 },
                offset: '0',
                repeat: '14px',
              }],
            }}
          />
        )}

        {/* Actual path travelled, for admin replay. Deliberately a
            different colour from the planned route so the two can be
            compared at a glance — that comparison is the entire point of
            the replay view. */}
        {trail && trail.length > 1 && (
          <PolylineF
            path={trail}
            options={{ strokeColor: '#f59e0b', strokeOpacity: 0.9, strokeWeight: 3, zIndex: 3 }}
          />
        )}

        {hasPickup && (
          <PointMarker
            position={{ lat: Number(pickup.lat), lng: Number(pickup.lng) }}
            kind="pickup"
            label={pickup.label}
          />
        )}
        {hasDropoff && (
          <PointMarker
            position={{ lat: Number(dropoff.lat), lng: Number(dropoff.lng) }}
            kind="dropoff"
            label={dropoff.label}
          />
        )}

        {hasVehicle && (
          <VehicleMarker
            position={{
              lat: Number(vehicle.lat),
              lng: Number(vehicle.lng),
              heading: vehicle.heading ?? null,
            }}
            intervalMs={updateIntervalMs}
            stale={vehicleStale}
          />
        )}
      </GoogleMap>

      {/* Re-centre control, shown only once the user has panned away —
          it has nothing to do until then. */}
      {userMoved && (
        <button
          type="button"
          onClick={fitToContent}
          aria-label="Re-centre map"
          style={{
            position: 'absolute', bottom: 14, right: 14,
            width: 38, height: 38, borderRadius: '50%',
            background: 'rgba(12,13,15,0.75)', border: '1px solid rgba(255,255,255,0.18)',
            backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', zIndex: 5,
          }}
        >
          <Icon name="navArrow" size={17} color="#fff" stroke={2} />
        </button>
      )}

      {overlay}
    </div>
  );
}
