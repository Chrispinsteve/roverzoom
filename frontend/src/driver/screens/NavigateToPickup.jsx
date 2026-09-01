import { useState } from 'react';
import DriverShell from '../DriverShell';
import Icon from '../../components/Icon';
import NavMap from '../components/NavMap';
import { mapsUrl } from '../lib/maps';
import { addressLines, houseNumber } from '../lib/address';
import PassengerRow from '../components/PassengerRow';
import NavSheet from '../components/NavSheet';
import AirportBand from '../components/AirportBand';

export default function NavigateToPickup({ booking, driverPosition, onArrived, busy, error }) {
  const [route, setRoute] = useState({});
  // Same collapse as OnTrip, with one deliberate difference: "Arrived at
  // Pickup" stays visible. It is safe and reversible, and it is the action the
  // driver came to this screen to take — burying it would cost more than it
  // protects. Only the irreversible one (End Trip, on the next screen) is put
  // behind a deliberate expand.
  const [expanded, setExpanded] = useState(false);
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

        <div className={`drv-nav-card${expanded ? '' : ' drv-nav-card--collapsed'}`}>

          <NavSheet
            expanded={expanded}
            onToggle={setExpanded}
            label="Show or hide pickup details"
            header={(
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
            )}
          >
              {booking.rider_name && (
                <PassengerRow name={booking.rider_name} phone={booking.rider_phone} compact />
              )}

              <div className="drv-nav-dest">
                <span className="drv-nav-dest-icon"><Icon name="arrowUp" size={15} color="var(--ink)" /></span>
                <div className="drv-nav-dest-main">
                  <div className="drv-nav-dest-k">Pickup</div>
                  <div className="drv-nav-dest-addr">{addressLines(booking.pickup_address).street}</div>
                  {addressLines(booking.pickup_address).locality && (
                    <div className="drv-nav-dest-sub">{addressLines(booking.pickup_address).locality}</div>
                  )}
                </div>
                <a className="drv-nav-openmaps" href={mapsUrl(booking.pickup_lat, booking.pickup_lng, booking.pickup_address)} target="_blank" rel="noreferrer">
                  Open in Maps <span aria-hidden="true">↗</span>
                </a>
              </div>
          </NavSheet>

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
