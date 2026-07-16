import DriverShell from '../DriverShell';
import Icon from '../../components/Icon';
import PassengerRow from '../components/PassengerRow';
import InstructionBanner from '../components/InstructionBanner';
import { mapsUrl } from '../lib/maps';

function etaLabel(booking) {
  const start = booking.started_at ? new Date(booking.started_at).getTime() : Date.now();
  const eta = new Date(start + booking.duration_minutes * 60000);
  return eta.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export default function OnTrip({ booking, onEndTrip }) {
  return (
    <DriverShell rightSlot={
      <button className="drv-icon-btn" aria-label="Safety">
        <Icon name="shieldCheck" size={18} color="var(--ink)" />
      </button>
    }>
      <div className="body">
        <div className="rise">
          <InstructionBanner icon="flag" title="Head to dropoff" lines={[booking.dropoff_address]} />
        </div>

        <a
          className="btn btn-ghost rise-1"
          href={mapsUrl(booking.dropoff_lat, booking.dropoff_lng, booking.dropoff_address)}
          target="_blank" rel="noreferrer"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 16 }}
        >
          <Icon name="navArrow" size={18} color="var(--ink-2)" />
          Open in Maps
        </a>

        <div style={{ marginTop: 20 }}>
          <PassengerRow
            name={booking.rider_name}
            phone={booking.rider_phone}
            right={
              <div className="drv-passenger-right">
                <div className="eyebrow">ETA</div>
                <div className="drv-eta-value">{etaLabel(booking)}</div>
                <div className="drv-rail-meta">{booking.distance_miles} mi · {booking.duration_minutes} min</div>
              </div>
            }
          />
        </div>

        <div className="spacer" />

        <button className="btn drv-danger-btn rise-3" onClick={onEndTrip} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <Icon name="stop" size={16} color="var(--danger)" />
          End Trip
        </button>
      </div>
    </DriverShell>
  );
}
