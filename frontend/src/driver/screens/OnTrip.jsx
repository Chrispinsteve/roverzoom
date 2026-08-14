import DriverShell from '../DriverShell';
import Icon from '../../components/Icon';
import LiveMap from '../../components/LiveMap';
import { mapsUrl } from '../lib/maps';
import { shortAddress } from '../lib/address';

function etaLabel(booking) {
  const start = booking.started_at ? new Date(booking.started_at).getTime() : Date.now();
  const eta = new Date(start + booking.duration_minutes * 60000);
  return eta.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export default function OnTrip({ booking, driverPosition, onEndTrip, busy, error }) {
  return (
    <DriverShell rightSlot={
      <button className="drv-icon-btn" aria-label="Safety">
        <Icon name="shieldCheck" size={18} color="var(--ink)" />
      </button>
    }>
      <div className="body drv-trip-body">
        {/* Map hero — grows to fill the space so there's no dead gap */}
        <div className="drv-trip-map rise">
          <LiveMap
            height="100%"
            pickup={{ lat: booking.pickup_lat, lng: booking.pickup_lng }}
            dropoff={{ lat: booking.dropoff_lat, lng: booking.dropoff_lng, address: booking.dropoff_address, label: 'Dropoff' }}
            vehicle={driverPosition}
            follow
            theme="dark"
          />
        </div>

        {/* One cohesive info card: destination + passenger + ETA */}
        <div className="drv-trip-card rise-1">
          <div className="drv-trip-dest">
            <span className="drv-trip-dest-icon"><Icon name="flag" size={16} color="var(--ink)" /></span>
            <div style={{ minWidth: 0 }}>
              <div className="drv-trip-eyebrow">Head to dropoff</div>
              <div className="drv-trip-addr">{shortAddress(booking.dropoff_address)}</div>
            </div>
          </div>
          <div className="drv-trip-divider" />
          <div className="drv-trip-meta">
            <div className="drv-trip-pax">
              <span className="drv-trip-avatar">{(booking.rider_name || '?').charAt(0)}</span>
              <span className="drv-trip-name">{booking.rider_name}</span>
            </div>
            <div className="drv-trip-eta">
              <span className="drv-trip-eyebrow">ETA {etaLabel(booking)}</span>
              <span className="drv-trip-dist">{booking.distance_miles} mi · {booking.duration_minutes} min</span>
            </div>
          </div>
        </div>

        {error && <p className="error-text center rise-1" style={{ margin: '10px 0 0' }}>{error}</p>}

        <div className="drv-trip-actions rise-2">
          <a
            className="btn btn-ghost"
            href={mapsUrl(booking.dropoff_lat, booking.dropoff_lng, booking.dropoff_address)}
            target="_blank" rel="noreferrer"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          >
            <Icon name="navArrow" size={17} color="var(--ink-2)" />
            Open in Maps
          </a>
          <button
            className="btn drv-danger-btn"
            onClick={onEndTrip}
            disabled={busy}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          >
            <Icon name="stop" size={16} color="var(--danger)" />
            {busy ? 'Ending…' : 'End Trip'}
          </button>
        </div>
      </div>
    </DriverShell>
  );
}
