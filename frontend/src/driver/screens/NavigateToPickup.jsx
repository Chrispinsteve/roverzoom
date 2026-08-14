import DriverShell from '../DriverShell';
import Icon from '../../components/Icon';
import LiveMap from '../../components/LiveMap';
import { mapsUrl } from '../lib/maps';
import { shortAddress } from '../lib/address';

export default function NavigateToPickup({ booking, driverPosition, onArrived, busy, error }) {
  return (
    <DriverShell rightSlot={
      <button className="drv-icon-btn" aria-label="Safety">
        <Icon name="shieldCheck" size={18} color="var(--ink)" />
      </button>
    }>
      <div className="body drv-trip-body">
        <div className="drv-trip-map rise">
          <LiveMap
            height="100%"
            pickup={{ lat: booking.pickup_lat, lng: booking.pickup_lng, address: booking.pickup_address, label: 'Pickup' }}
            vehicle={driverPosition}
            follow
            theme="dark"
          />
        </div>

        <div className="drv-trip-card rise-1">
          <div className="drv-trip-dest">
            <span className="drv-trip-dest-icon"><Icon name="arrowUp" size={16} color="var(--ink)" /></span>
            <div style={{ minWidth: 0 }}>
              <div className="drv-trip-eyebrow">Head to pickup</div>
              <div className="drv-trip-addr">{shortAddress(booking.pickup_address)}</div>
            </div>
          </div>
          <div className="drv-trip-divider" />
          <div className="drv-trip-meta">
            <div className="drv-trip-pax">
              <span className="drv-trip-avatar">{(booking.rider_name || '?').charAt(0)}</span>
              <span className="drv-trip-name">{booking.rider_name}</span>
            </div>
            <div className="drv-trip-eta">
              <span className="drv-trip-dist">{booking.distance_miles} mi · ~{booking.duration_minutes} min</span>
            </div>
          </div>
        </div>

        {error && <p className="error-text center rise-1" style={{ margin: '10px 0 0' }}>{error}</p>}

        <div className="drv-trip-actions rise-2">
          <a
            className="btn btn-ghost"
            href={mapsUrl(booking.pickup_lat, booking.pickup_lng, booking.pickup_address)}
            target="_blank" rel="noreferrer"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          >
            <Icon name="navArrow" size={17} color="var(--ink-2)" />
            Open in Maps
          </a>
          <button className="btn" onClick={onArrived} disabled={busy} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <Icon name="check" size={18} color="var(--accent-ink)" stroke={2.5} />
            {busy ? 'Saving…' : 'Arrived at Pickup'}
          </button>
        </div>
      </div>
    </DriverShell>
  );
}
