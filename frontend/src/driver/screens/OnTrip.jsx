import DriverShell from '../DriverShell';
import Icon from '../../components/Icon';
import RouteMap from '../components/RouteMap';
import PassengerRow from '../components/PassengerRow';
import InstructionBanner from '../components/InstructionBanner';

function etaLabel(minutesFromNow) {
  if (minutesFromNow == null) return '—';
  const d = new Date(Date.now() + minutesFromNow * 60000);
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export default function OnTrip({ booking, passenger, driverPosition, locationError, onEndTrip, busy }) {
  const navUrl = booking?.dropoff_lat != null
    ? `https://www.google.com/maps/dir/?api=1&destination=${booking.dropoff_lat},${booking.dropoff_lng}&travelmode=driving`
    : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(booking?.dropoff_address || '')}&travelmode=driving`;

  const durationMin = booking?.duration_minutes ?? null;
  const distanceMi = booking?.distance_miles != null ? Number(booking.distance_miles) : null;

  return (
    <DriverShell rightSlot={
      <button className="drv-icon-btn" aria-label="Safety">
        <Icon name="shieldCheck" size={18} color="var(--ink)" />
      </button>
    }>
      <div className="body">
        <div className="rise">
          <InstructionBanner
            icon="flag"
            title="Heading to drop-off"
            lines={[booking?.dropoff_address].filter(Boolean)}
          />
        </div>

        <div className="rise-1">
          <RouteMap booking={booking} driverPosition={driverPosition} height={280} />
        </div>

        {locationError && (
          <p className="drv-loc-warning">
            <Icon name="pin" size={14} color="var(--danger)" />
            {locationError}
          </p>
        )}

        <PassengerRow
          passenger={passenger}
          right={
            <div className="drv-passenger-right">
              <div className="eyebrow">ETA</div>
              <div className="drv-eta-value">{etaLabel(durationMin)}</div>
              <div className="drv-rail-meta">
                {distanceMi != null ? `${distanceMi} mi` : '—'}
                {durationMin != null ? ` · ${durationMin} min` : ''}
              </div>
            </div>
          }
        />

        <div className="spacer" />

        <a className="btn btn-ghost" href={navUrl} target="_blank" rel="noreferrer"
           style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, textDecoration: 'none', marginBottom: 10 }}>
          <Icon name="navArrow" size={17} color="var(--ink)" />
          Open in Google Maps
        </a>

        <button className="btn drv-danger-btn rise-3" onClick={onEndTrip} disabled={busy}
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
          <Icon name="stop" size={16} color="var(--danger)" />
          {busy ? 'Saving…' : 'End Trip'}
        </button>
      </div>
    </DriverShell>
  );
}
