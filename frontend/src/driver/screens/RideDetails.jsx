import DriverShell from '../DriverShell';
import Icon from '../../components/Icon';
import PassengerRow from '../components/PassengerRow';

export default function RideDetails({ ride, onBack, onStartNavigation }) {
  return (
    <DriverShell onBack={onBack}>
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
                <div className="rail-value">{ride.pickup.address}</div>
                <div className="drv-rail-meta">{ride.pickup.detail}</div>
              </div>
              <div className="rail-slot">
                <div className="rail-label">Dropoff</div>
                <div className="rail-value">{ride.dropoff.address}</div>
                <div className="drv-rail-meta">{ride.dropoff.detail}</div>
              </div>
            </div>
          </div>
        </div>

        <div className="stat-strip rise-2">
          <div className="stat"><div className="k">Distance</div><div className="v">{ride.distanceMiles} mi</div></div>
          <div className="stat"><div className="k">Duration</div><div className="v">~{ride.durationMin} min</div></div>
          <div className="stat"><div className="k">Fare</div><div className="v">${ride.fare.toFixed(2)}</div></div>
        </div>

        <PassengerRow passenger={ride.passenger} />

        <div className="stat-strip rise-3" style={{ marginTop: 0, gridTemplateColumns: 'repeat(2, 1fr)' }}>
          <div className="stat" style={{ textAlign: 'left', padding: '14px 16px' }}>
            <div className="k">Ride Preferences</div>
            <div className="v" style={{ fontSize: 15 }}>{ride.ridePreference}</div>
          </div>
          <div className="stat" style={{ textAlign: 'left', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div className="k">Payment Method</div>
            <div className="v" style={{ fontSize: 15, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="card" size={15} color="var(--ink-3)" />{ride.paymentMethod}
            </div>
          </div>
        </div>

        <div className="spacer" />

        <button className="btn rise-3" onClick={onStartNavigation} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <Icon name="navArrow" size={18} color="var(--accent-ink)" />
          Start Navigation
        </button>
      </div>
    </DriverShell>
  );
}
