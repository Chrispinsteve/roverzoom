import { useEffect, useState } from 'react';
import DriverShell from '../DriverShell';
import RouteMap from '../components/RouteMap';

const EXPIRY_SECONDS = 15;

export default function NewRideRequest({ ride, onDecline, onAccept }) {
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
          <RouteMap
            pathD="M55 140 C 90 120, 70 95, 110 95 S 165 65, 155 42 S 220 30, 250 44"
            labels={[{ text: 'DOWNTOWN', top: '18%', left: '8%' }, { text: 'BRICKELL', top: '68%', left: '58%' }]}
            carPos={{ top: '74%', left: '15%' }}
            squarePos={{ top: '20%', left: '82%' }}
          />
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
