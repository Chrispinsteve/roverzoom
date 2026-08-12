import DriverShell from '../DriverShell';
import Icon from '../../components/Icon';
import RouteMap from '../components/RouteMap';
import PassengerRow from '../components/PassengerRow';
import InstructionBanner from '../components/InstructionBanner';

// Straight-line distance from the driver to the pickup. Deliberately not
// a routed distance: that would be a Google request every few seconds
// per driver, for a number whose only job is to tell them roughly how
// close they are. The routed ETA is computed server-side on a throttle
// and shown to the rider instead.
function milesAway(from, to) {
  if (!from || to?.lat == null) return null;
  const R = 3958.8;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(Number(to.lat) - from.lat);
  const dLng = toRad(Number(to.lng) - from.lng);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(from.lat)) * Math.cos(toRad(Number(to.lat))) * Math.sin(dLng / 2) ** 2;
  const miles = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return miles < 0.1 ? 'Arriving' : `${miles.toFixed(1)} mi away`;
}

export default function NavigateToPickup({ booking, passenger, driverPosition, locationError, onArrived, busy }) {
  const away = milesAway(driverPosition, { lat: booking?.pickup_lat, lng: booking?.pickup_lng });

  // Hand off to the phone's real navigation app. Turn-by-turn voice
  // guidance, lane guidance and live rerouting are what a driver needs
  // while moving, and rebuilding any of that in a web view would be
  // strictly worse than the app already on their home screen.
  const navUrl = booking?.pickup_lat != null
    ? `https://www.google.com/maps/dir/?api=1&destination=${booking.pickup_lat},${booking.pickup_lng}&travelmode=driving`
    : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(booking?.pickup_address || '')}&travelmode=driving`;

  return (
    <DriverShell rightSlot={
      <button className="drv-icon-btn" aria-label="Safety">
        <Icon name="shieldCheck" size={18} color="var(--ink)" />
      </button>
    }>
      <div className="body">
        <div className="rise">
          <InstructionBanner
            icon="arrowUp"
            title="Head to pickup"
            lines={[booking?.pickup_address, away].filter(Boolean)}
          />
        </div>

        <div className="rise-1">
          <RouteMap booking={booking} driverPosition={driverPosition} height={280} />
        </div>

        {locationError && (
          <p className="drv-loc-warning">
            <Icon name="pin" size={14} color="var(--danger)" />
            {locationError}
          </p>
        )}

        <PassengerRow passenger={passenger} />

        <div className="spacer" />

        <a className="btn btn-ghost" href={navUrl} target="_blank" rel="noreferrer"
           style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, textDecoration: 'none', marginBottom: 10 }}>
          <Icon name="navArrow" size={17} color="var(--ink)" />
          Open in Google Maps
        </a>

        <button className="btn rise-3" onClick={onArrived} disabled={busy}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <Icon name="check" size={18} color="var(--accent-ink)" stroke={2.5} />
          {busy ? 'Saving…' : 'Arrived at Pickup'}
        </button>
      </div>
    </DriverShell>
  );
}
