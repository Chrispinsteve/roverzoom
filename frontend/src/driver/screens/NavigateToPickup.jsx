import DriverShell from '../DriverShell';
import Icon from '../../components/Icon';
import PassengerRow from '../components/PassengerRow';
import InstructionBanner from '../components/InstructionBanner';
import { mapsUrl } from '../lib/maps';

export default function NavigateToPickup({ booking, onArrived }) {
  return (
    <DriverShell rightSlot={
      <button className="drv-icon-btn" aria-label="Safety">
        <Icon name="shieldCheck" size={18} color="var(--ink)" />
      </button>
    }>
      <div className="body">
        <div className="rise">
          <InstructionBanner
            icon="arrowUp"
            title="Head to pickup"
            lines={[booking.pickup_address, `${booking.distance_miles} mi · ~${booking.duration_minutes} min`]}
          />
        </div>

        <a
          className="btn btn-ghost rise-1"
          href={mapsUrl(booking.pickup_lat, booking.pickup_lng, booking.pickup_address)}
          target="_blank" rel="noreferrer"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 16 }}
        >
          <Icon name="navArrow" size={18} color="var(--ink-2)" />
          Open in Maps
        </a>

        <div style={{ marginTop: 20 }}>
          <PassengerRow name={booking.rider_name} phone={booking.rider_phone} />
        </div>

        <div className="spacer" />

        <button className="btn rise-3" onClick={onArrived} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <Icon name="check" size={18} color="var(--accent-ink)" stroke={2.5} />
          Arrived at Pickup
        </button>
      </div>
    </DriverShell>
  );
}
