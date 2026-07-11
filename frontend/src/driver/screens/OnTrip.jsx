import DriverShell from '../DriverShell';
import Icon from '../../components/Icon';
import RouteMap from '../components/RouteMap';
import PassengerRow from '../components/PassengerRow';
import InstructionBanner from '../components/InstructionBanner';

function etaLabel(minutesFromNow) {
  const d = new Date(Date.now() + minutesFromNow * 60000);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export default function OnTrip({ ride, onEndTrip }) {
  return (
    <DriverShell rightSlot={
      <button className="drv-icon-btn" aria-label="Safety">
        <Icon name="shieldCheck" size={18} color="var(--ink)" />
      </button>
    }>
      <div className="body">
        <div className="rise">
          <InstructionBanner icon="arrowUp" title="Continue straight" meta="12.4 mi" lines={['I-95 S']} />
        </div>

        <div className="rise-1">
          <RouteMap
            height={280}
            pathD="M45 30 C 90 55, 70 90, 130 100 S 195 125, 185 150 S 235 158, 250 160"
            labels={[{ text: 'WYNWOOD', top: '12%', left: '16%' }, { text: 'VIRGINIA KEY', top: '88%', left: '68%' }]}
            carPos={{ top: '56%', left: '43%' }}
            squarePos={{ top: '89%', left: '83%' }}
            fabs={['volume', 'navArrow', 'shieldCheck']}
          />
        </div>

        <PassengerRow
          passenger={ride.passenger}
          right={
            <div className="drv-passenger-right">
              <div className="eyebrow">ETA</div>
              <div className="drv-eta-value">{etaLabel(ride.durationMin)}</div>
              <div className="drv-rail-meta">{ride.distanceMiles} mi · {ride.durationMin} min</div>
            </div>
          }
        />

        <div className="spacer" />

        <button className="btn drv-danger-btn rise-3" onClick={onEndTrip} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <Icon name="stop" size={16} color="var(--danger)" />
          End Trip
        </button>
      </div>
    </DriverShell>
  );
}
