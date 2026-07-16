import DriverShell from '../DriverShell';
import Icon from '../../components/Icon';
import PassengerRow from '../components/PassengerRow';
import { mapsUrl } from '../lib/maps';

// Post-claim only — the exact dropoff (redacted to city/area pre-claim on
// the Requests screen) is unlocked here, along with the real "Open in Maps"
// link and the driver's real 60% payout.
export default function RideDetails({ booking, onStartNavigation }) {
  return (
    <DriverShell>
      <div className="body">
        <h1 className="title rise" style={{ fontSize: 26 }}>Ride Details</h1>

        <div className="summary rise-1" style={{ padding: '18px 20px', marginTop: 8 }}>
          <div className="route-rail">
            <div className="rail-track">
              <span className="rail-dot" />
              <span className="rail-line" />
              <span className="rail-square" />
            </div>
            <div className="rail-body">
              <div className="rail-slot top">
                <div className="rail-label">Pickup</div>
                <div className="rail-value">{booking.pickup_address}</div>
              </div>
              <div className="rail-slot">
                <div className="rail-label">Dropoff</div>
                <div className="rail-value">{booking.dropoff_address}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="stat-strip rise-2">
          <div className="stat"><div className="k">Distance</div><div className="v">{booking.distance_miles} mi</div></div>
          <div className="stat"><div className="k">Duration</div><div className="v">~{booking.duration_minutes} min</div></div>
          <div className="stat"><div className="k">You Earn</div><div className="v">${booking.driver_payout.toFixed(2)}</div></div>
        </div>

        <PassengerRow name={booking.rider_name} phone={booking.rider_phone} />

        <div className="stat-strip rise-3" style={{ marginTop: 0, gridTemplateColumns: 'repeat(2, 1fr)' }}>
          <div className="stat" style={{ textAlign: 'left', padding: '14px 16px' }}>
            <div className="k">Pickup Time</div>
            <div className="v" style={{ fontSize: 15 }}>
              {new Date(booking.scheduled_at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}
            </div>
          </div>
          <div className="stat" style={{ textAlign: 'left', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="k">Payment Method</div>
            <div className="v" style={{ fontSize: 15, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="card" size={15} color="var(--ink-3)" />{booking.payment_method === 'card' ? 'Card' : 'Cash'}
            </div>
          </div>
        </div>

        <div className="spacer" />

        <a
          className="btn btn-ghost rise-3"
          href={mapsUrl(booking.pickup_lat, booking.pickup_lng, booking.pickup_address)}
          target="_blank" rel="noreferrer"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 10 }}
        >
          <Icon name="navArrow" size={18} color="var(--ink-2)" />
          Open in Maps
        </a>
        <button className="btn rise-3" onClick={onStartNavigation} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          Start Navigation
        </button>
      </div>
    </DriverShell>
  );
}
