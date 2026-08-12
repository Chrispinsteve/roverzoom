import { useEffect, useState } from 'react';
import DriverShell from '../DriverShell';
import RouteMap from '../components/RouteMap';

const EXPIRY_SECONDS = 15;

export default function NewRideRequest({ ride, booking, onDecline, onAccept }) {
  const [secondsLeft, setSecondsLeft] = useState(EXPIRY_SECONDS);

  useEffect(() => {
    if (secondsLeft <= 0) { onDecline(); return; }
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [secondsLeft, onDecline]);

  return (
    <DriverShell onBack={onDecline}>
      <div className="body">
        <h1 className="title rise" style={{ fontSize: 26 }}>New Ride Request</h1>
        <p className="subtitle rise-1">You have a new ride request</p>

        <div className="rise-1">
          {/* Offer preview: pickup and drop-off only. No driver marker —
              the driver has not accepted yet, so there is no trip to
              track, and the decision they are making is "is this route
              worth it", which the two endpoints answer. follow={false}
              keeps the whole route framed rather than chasing a car. */}
          <RouteMap booking={booking} height={200} follow={false} />
        </div>

        <div className="route-rail rise-2" style={{ margin: '18px 0' }}>
          <div className="rail-track">
            <span className="rail-dot" />
            <span className="rail-line" />
            <span className="rail-square" />
          </div>
          <div className="rail-body">
            <div className="rail-slot top">
              <div className="rail-value">{ride.pickup.address}</div>
              <div className="drv-rail-meta">{ride.pickup.distanceAway}</div>
            </div>
            <div className="rail-slot">
              <div className="rail-value">{ride.dropoff.address}</div>
              <div className="drv-rail-meta">{ride.distanceMiles} mi · ~{ride.durationMin} min trip</div>
            </div>
          </div>
        </div>

        <div className="summary rise-2" style={{ padding: '4px 18px' }}>
          <div className="summary-row">
            <div>
              <span className="eyebrow" style={{ marginBottom: 4 }}>Estimated Fare</span>
              <div className="summary-value big">${ride.fare.toFixed(2)}</div>
            </div>
            <button className="btn btn-ghost" style={{ width: 'auto', padding: '10px 18px', minHeight: 40 }} onClick={onAccept}>
              View Details
            </button>
          </div>
        </div>

        <div className="spacer" />

        <div className="btn-row rise-3">
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onDecline}>Decline</button>
          <button className="btn" style={{ flex: 1 }} onClick={onAccept}>Accept</button>
        </div>
        <p className="center muted rise-3" style={{ fontSize: 13, marginTop: 12 }}>
          Request expires in {secondsLeft} sec
        </p>
      </div>
    </DriverShell>
  );
}
