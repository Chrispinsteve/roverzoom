import DriverShell from '../DriverShell';
import Icon from '../../components/Icon';
import RouteMap from '../components/RouteMap';
import PassengerRow from '../components/PassengerRow';
import InstructionBanner from '../components/InstructionBanner';

export default function NavigateToPickup({ ride, onArrived }) {
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
            lines={[ride.pickup.address, ride.pickup.distanceAway]}
          />
        </div>

        <div className="rise-1">
          <RouteMap
            height={280}
            pathD="M50 165 L110 165 L110 105 L190 105 L190 45 L240 45"
            labels={[{ text: 'DOWNTOWN', top: '20%', left: '18%' }]}
            carPos={{ top: '91.7%', left: '16.7%' }}
            squarePos={{ top: '25%', left: '80%' }}
            fabs={['navArrow', 'shieldCheck']}
          />
        </div>

        <PassengerRow passenger={ride.passenger} />

        <div className="spacer" />

        <button className="btn rise-3" onClick={onArrived} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <Icon name="check" size={18} color="var(--accent-ink)" stroke={2.5} />
          Arrived at Pickup
        </button>
      </div>
    </DriverShell>
  );
}
