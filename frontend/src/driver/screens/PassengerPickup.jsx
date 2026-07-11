import DriverShell from '../DriverShell';
import Icon from '../../components/Icon';
import PassengerRow from '../components/PassengerRow';

export default function PassengerPickup({ ride, onStartTrip }) {
  return (
    <DriverShell rightSlot={
      <button className="drv-icon-btn" aria-label="Safety">
        <Icon name="shieldCheck" size={18} color="var(--ink)" />
      </button>
    }>
      <div className="body">
        <div style={{ textAlign: 'center', margin: '12px 0 24px' }}>
          <div className="drv-check-pop">
            <Icon name="check" size={32} color="#fff" stroke={2.5} />
          </div>
          <h1 className="title rise-1" style={{ fontSize: 24 }}>Passenger Picked Up</h1>
          <p className="subtitle rise-1" style={{ marginBottom: 0 }}>Start the trip when you’re ready</p>
        </div>

        <PassengerRow passenger={ride.passenger} />

        <div className="drv-instruction rise-2">
          <span className="drv-instruction-icon"><Icon name="flag" size={19} color="#0c0d0f" stroke={2.2} /></span>
          <div className="drv-instruction-body">
            <div className="drv-instruction-row">
              <span className="drv-instruction-title">{ride.dropoff.address}</span>
            </div>
            <div className="drv-instruction-line">{ride.distanceMiles} mi · ~{ride.durationMin} min</div>
          </div>
        </div>

        <div className="spacer" />

        <button className="btn rise-3" onClick={onStartTrip} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <Icon name="play" size={17} color="var(--accent-ink)" />
          Start Trip
        </button>
      </div>
    </DriverShell>
  );
}
