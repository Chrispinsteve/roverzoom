import { useState } from 'react';
import DriverShell from '../DriverShell';
import Icon from '../../components/Icon';
import NavMap from '../components/NavMap';
import { mapsUrl } from '../lib/maps';
import { addressLines, houseNumber } from '../lib/address';
import PassengerRow from '../components/PassengerRow';

export default function NavigateToPickup({ booking, driverPosition, onArrived, busy, error }) {
  const [route, setRoute] = useState({});
  return (
    <DriverShell rightSlot={
      <button className="drv-icon-btn" aria-label="Safety">
        <Icon name="shieldCheck" size={18} color="var(--ink)" />
      </button>
    }>
      <div className="body drv-nav-body">
        <div className="drv-nav-map">
          <NavMap
            driver={driverPosition}
            destination={{ lat: booking.pickup_lat, lng: booking.pickup_lng }}
            destinationLabel="PICKUP"
            destinationNumber={houseNumber(booking.pickup_address)}
            onRouteInfo={setRoute}
          />
        </div>

        <div className="drv-nav-card">
          <div className="drv-nav-stats">
            <div>
              <div className="drv-nav-stat-k">ETA</div>
              <div className="drv-nav-stat-v">{route.etaText || '—'}</div>
            </div>
            <div>
              <div className="drv-nav-stat-k">Distance</div>
              <div className="drv-nav-stat-v">{route.distanceText || `${booking.distance_miles} mi`}</div>
            </div>
          </div>

          {/* Reaching the rider matters most on the way to collect them —
              a wrong gate, a back entrance, or someone not yet outside. */}
          {booking.rider_name && (
            <PassengerRow name={booking.rider_name} phone={booking.rider_phone} compact />
          )}

          <div className="drv-nav-dest">
            <span className="drv-nav-dest-icon"><Icon name="arrowUp" size={15} color="var(--ink)" /></span>
            <div className="drv-nav-dest-main">
              <div className="drv-nav-dest-k">Pickup</div>
              {/* Street on its own line, city secondary. The street number is
                  the part a driver needs at the kerb, so it never shares a
                  line with anything that could push it into a truncation. */}
              <div className="drv-nav-dest-addr">{addressLines(booking.pickup_address).street}</div>
              {addressLines(booking.pickup_address).locality && (
                <div className="drv-nav-dest-sub">{addressLines(booking.pickup_address).locality}</div>
              )}
            </div>
            <a className="drv-nav-openmaps" href={mapsUrl(booking.pickup_lat, booking.pickup_lng, booking.pickup_address)} target="_blank" rel="noreferrer">
              Open in Maps <span aria-hidden="true">↗</span>
            </a>
          </div>

          {error && <p className="error-text center" style={{ margin: '0 0 10px' }}>{error}</p>}
          <button className="btn" onClick={onArrived} disabled={busy} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <Icon name="check" size={18} color="var(--accent-ink)" stroke={2.5} />
            {busy ? 'Saving…' : 'Arrived at Pickup'}
          </button>
        </div>
      </div>
    </DriverShell>
  );
}
