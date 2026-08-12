import LiveMap from '../../components/LiveMap';

// ============================================================
// RouteMap — driver-facing trip map
// ============================================================
// REPLACED. This used to draw a stylised SVG with a hand-authored path
// ("M50 165 L110 165 L110 105 ...") and percentage-positioned car and
// destination markers. It looked convincing in a mockup and told a
// driver nothing — the same squiggle rendered for every trip in the
// world, and the car sat wherever the hardcoded percentage put it.
//
// It is now a thin adapter over LiveMap. Kept as its own file, rather
// than having every screen import LiveMap directly, because the driver
// screens all want the same thing: "show me this booking, and me on it".
// Centralising that mapping means the leg logic below lives in one place
// instead of being re-derived, slightly differently, on three screens.
//
// PROP CHANGE — the old pathD / labels / carPos / squarePos / fabs props
// are gone. Any remaining caller passing them will render an empty map,
// so callers must be updated (NavigateToPickup and OnTrip already are).
// ============================================================

/**
 * @param {object} props
 * @param {object} props.booking  a real booking row from the API
 * @param {{lat,lng,heading?}=} props.driverPosition  live device position
 * @param {number=} props.height
 * @param {boolean=} props.follow
 */
export default function RouteMap({ booking, driverPosition, height = 280, follow = true }) {
  if (!booking) {
    return (
      <div className="drv-map" style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13 }}>No trip loaded</span>
      </div>
    );
  }

  // A trip has two legs and a driver only ever needs the current one.
  // Before pickup, the relevant journey is driver -> pickup, and showing
  // the drop-off marker just zooms the map out to include somewhere they
  // are not going yet. After pickup it inverts: pickup is history and
  // drop-off is the target.
  const carryingPassenger = booking.status === 'in_progress';

  const pickup = booking.pickup_lat != null
    ? {
        lat: Number(booking.pickup_lat),
        lng: Number(booking.pickup_lng),
        label: carryingPassenger ? undefined : 'Pickup',
      }
    : null;

  const dropoff = booking.dropoff_lat != null
    ? {
        lat: Number(booking.dropoff_lat),
        lng: Number(booking.dropoff_lng),
        label: carryingPassenger ? 'Drop-off' : undefined,
      }
    : null;

  return (
    <LiveMap
      height={height}
      pickup={carryingPassenger ? null : pickup}
      dropoff={carryingPassenger ? dropoff : null}
      vehicle={driverPosition}
      // The cached polyline is the pickup -> drop-off route, so it is
      // only geometrically correct once the passenger is aboard. Drawing
      // it while the driver is still approaching pickup would show a
      // route starting somewhere they have not reached.
      routePolyline={carryingPassenger ? booking.route_polyline : null}
      // The driver's own device reports position continuously rather than
      // on a poll, so animation only has to bridge the ~5s sampling gap.
      updateIntervalMs={3000}
      follow={follow}
      theme="dark"
    />
  );
}
