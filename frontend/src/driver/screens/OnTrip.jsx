import { useState } from 'react';
import DriverShell from '../DriverShell';
import Icon from '../../components/Icon';
import NavMap from '../components/NavMap';
import { mapsUrl } from '../lib/maps';
import { shortAddress } from '../lib/address';
import PassengerRow from '../components/PassengerRow';

export default function OnTrip({ booking, driverPosition, onEndTrip, busy, error }) {
  const [route, setRoute] = useState({});
  // Ending a trip is irreversible from the driver's side: complete_booking()
  // flips the status, writes the earnings row and increments rides_completed
  // in one transaction. A single mistaken tap while holding the phone is not
  // an acceptable way to trigger that, so it takes two.
  const [confirming, setConfirming] = useState(false);
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
            {/* The driver's own cut, not the rider's fare. driver_payout comes
                from the API (57.5% of the standard fare); falling back to the
                fare would overstate what they take home. */}
            {booking.driver_payout != null && (
              <div>
                <div className="drv-nav-stat-k">You earn</div>
                <div className="drv-nav-stat-v">${Number(booking.driver_payout).toFixed(2)}</div>
              </div>
            )}
          </div>

          {/* Who is in the car, with one tap to call or text. A dropoff like
              an office park or a hospital has several entrances, and the driver
              had no way to ask which one without leaving the screen. Uses the
              same row as the pickup and ride-detail screens rather than a
              bespoke variant. */}
          {booking.rider_name && (
            <PassengerRow name={booking.rider_name} phone={booking.rider_phone} compact />
          )}

          <div className="drv-nav-dest">
            <span className="drv-nav-dest-icon"><Icon name="flag" size={15} color="var(--ink)" /></span>
            {/* Wraps to two lines rather than truncating. A clipped
                "6001 Broken Sound Parkway Northwes…" loses the suite or
                building number, which is the part that matters on arrival. */}
            <span className="drv-nav-dest-addr">{shortAddress(booking.dropoff_address)}</span>
            <a className="drv-nav-openmaps" href={mapsUrl(booking.dropoff_lat, booking.dropoff_lng, booking.dropoff_address)} target="_blank" rel="noreferrer">Open in Maps</a>
          </div>

          {error && <p className="error-text center" style={{ margin: '0 0 10px' }}>{error}</p>}

          {confirming ? (
            <div className="drv-confirm">
              <p className="drv-confirm-q">End the trip and record your earnings?</p>
              <div className="drv-confirm-row">
                <button className="btn drv-confirm-no" onClick={() => setConfirming(false)} disabled={busy}>
                  Not yet
                </button>
                <button className="btn drv-danger-btn drv-confirm-yes" onClick={onEndTrip} disabled={busy}>
                  {busy ? 'Ending…' : 'Yes, end trip'}
                </button>
              </div>
            </div>
          ) : (
            <button className="btn drv-danger-btn" onClick={() => setConfirming(true)} disabled={busy}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <Icon name="stop" size={16} color="var(--danger)" />
              End Trip
            </button>
          )}
        </div>
      </div>
    </DriverShell>
  );
}
