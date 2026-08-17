import { useState } from 'react';
import DriverShell from '../DriverShell';
import Icon from '../../components/Icon';
import NavMap from '../components/NavMap';
import { mapsUrl } from '../lib/maps';
import { shortAddress } from '../lib/address';

export default function OnTrip({ booking, driverPosition, onEndTrip, busy, error }) {
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
            destination={{ lat: booking.dropoff_lat, lng: booking.dropoff_lng }}
            destinationLabel="DROPOFF"
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

          <div className="drv-nav-dest">
            <span className="drv-nav-dest-icon"><Icon name="flag" size={15} color="var(--ink)" /></span>
            <span className="drv-nav-dest-addr">{shortAddress(booking.dropoff_address)}</span>
            <a className="drv-nav-openmaps" href={mapsUrl(booking.dropoff_lat, booking.dropoff_lng, booking.dropoff_address)} target="_blank" rel="noreferrer">Open in Maps</a>
          </div>

          {error && <p className="error-text center" style={{ margin: '0 0 10px' }}>{error}</p>}
          <button className="btn drv-danger-btn" onClick={onEndTrip} disabled={busy} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <Icon name="stop" size={16} color="var(--danger)" />
            {busy ? 'Ending…' : 'End Trip'}
          </button>
        </div>
      </div>
    </DriverShell>
  );
}
