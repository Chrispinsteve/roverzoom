import { useState } from 'react';
import DriverShell from '../DriverShell';
import Icon from '../../components/Icon';
import NavMap from '../components/NavMap';
import { mapsUrl } from '../lib/maps';
import { addressLines, houseNumber } from '../lib/address';
import PassengerRow from '../components/PassengerRow';
import NavSheet from '../components/NavSheet';

export default function OnTrip({ booking, driverPosition, onEndTrip, busy, error }) {
  const [route, setRoute] = useState({});
  // The card starts COLLAPSED and the map gets the screen.
  //
  // Everything below the fold — the rider's name, the address, Open in Maps —
  // is reference material. A driver mid-trip needs the road and two numbers;
  // the rest was taking half the display to answer questions nobody was asking
  // at 40mph.
  //
  // It also puts End Trip behind a deliberate action. That button ends the ride
  // irreversibly, and it was sitting under the driver's thumb for the whole
  // journey. Now reaching it takes an expand plus a confirm.
  const [expanded, setExpanded] = useState(false);
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
            destinationNumber={houseNumber(booking.dropoff_address)}
            onRouteInfo={setRoute}
          />
        </div>

        <div className={`drv-nav-card${expanded ? '' : ' drv-nav-card--collapsed'}`}>

          <NavSheet
            expanded={expanded}
            onToggle={setExpanded}
            label="Show or hide trip details"
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
              {/* No earnings here, deliberately. The figure is the driver's
                  private business and the back seat can read this screen; it also
                  keeps them doing arithmetic instead of driving. It is shown on
                  TripComplete, where it is the point rather than a distraction. */}
            </div>
            )}
          >
              {booking.rider_name && (
                <PassengerRow name={booking.rider_name} phone={booking.rider_phone} compact />
              )}

              <div className="drv-nav-dest">
                <span className="drv-nav-dest-icon"><Icon name="flag" size={15} color="var(--ink)" /></span>
                <div className="drv-nav-dest-main">
                  <div className="drv-nav-dest-k">Drop-off</div>
                  <div className="drv-nav-dest-addr">{addressLines(booking.dropoff_address).street}</div>
                  {addressLines(booking.dropoff_address).locality && (
                    <div className="drv-nav-dest-sub">{addressLines(booking.dropoff_address).locality}</div>
                  )}
                </div>
                <a className="drv-nav-openmaps" href={mapsUrl(booking.dropoff_lat, booking.dropoff_lng, booking.dropoff_address)} target="_blank" rel="noreferrer">
                  Open in Maps <span aria-hidden="true">↗</span>
                </a>
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
          </NavSheet>

          {/* An error must never be hidden behind a collapsed card. */}
          {!expanded && error && <p className="error-text center" style={{ margin: '8px 0 0' }}>{error}</p>}
        </div>
      </div>
    </DriverShell>
  );
}
