import { useEffect, useMemo, useState } from 'react';
import Shell from '../components/Shell';
import Icon from '../components/Icon';
import LiveMap from '../components/LiveMap';
import RouteRail from '../components/RouteRail';
import { useTracking } from '../lib/useTracking';
import { GoogleMapsProvider } from '../lib/GoogleMapsProvider';

// ============================================================
// TrackRide — the rider's live view of their trip
// ============================================================
// Reached from /track/<token>, normally by tapping a link in a
// confirmation SMS. No login, no account — see routes/track.js for why
// the token is what it is.
// ============================================================

// Copy per lifecycle stage. Written from the RIDER's point of view, not
// the system's: they care what is happening to them, not what row state
// the booking is in. "Driver assigned" is internal vocabulary; "Ahmed is
// your driver" is the same fact in a form a passenger can use.
const STATUS_COPY = {
  confirmed:        { title: 'Ride booked',        sub: 'We’ll assign your driver shortly.' },
  dispatching:      { title: 'Finding your driver', sub: 'Matching you with a nearby driver.' },
  driver_assigned:  { title: 'Driver assigned',     sub: 'Your driver will set off in time for pickup.' },
  driver_en_route:  { title: 'Driver on the way',   sub: 'Heading to your pickup point.' },
  arrived:          { title: 'Your driver is here', sub: 'Look for the vehicle below.' },
  in_progress:      { title: 'On the way',          sub: 'Enjoy the ride.' },
  completed:        { title: 'Trip complete',       sub: 'Thanks for riding with RoverZoom.' },
  canceled:         { title: 'Trip canceled',       sub: 'This ride is no longer scheduled.' },
  manual_dispatch_required: { title: 'Confirming your ride', sub: 'Our team is finalising your driver.' },
};

// A position older than this is treated as lost signal rather than
// current. Two minutes is well past the 20-second upload cycle, so it
// only trips on a genuine problem — not on a normal gap between batches.
const STALE_AFTER_SECONDS = 120;

function formatEta(seconds) {
  if (seconds == null) return null;
  if (seconds < 60) return 'Less than a minute';
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m ? `${h} hr ${m} min` : `${h} hr`;
}

function EtaBadge({ seconds, status }) {
  // Count down locally between the server's refreshes so the number
  // moves every second instead of sitting still and then jumping. The
  // server recomputes the true ETA roughly once a minute; this fills the
  // gap without pretending to more precision than exists.
  const [remaining, setRemaining] = useState(seconds);

  useEffect(() => { setRemaining(seconds); }, [seconds]);

  useEffect(() => {
    if (remaining == null) return;
    const t = setInterval(() => setRemaining((v) => (v == null ? v : Math.max(0, v - 1))), 1000);
    return () => clearInterval(t);
  }, [remaining == null]);

  const label = formatEta(remaining);
  if (!label) return null;

  const prefix = status === 'in_progress' ? 'Arriving in' : 'Pickup in';

  return (
    <div style={{ textAlign: 'right' }}>
      <div className="eyebrow" style={{ marginBottom: 2 }}>{prefix}</div>
      <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
        {label}
      </div>
    </div>
  );
}

function DriverCard({ driver, stale }) {
  if (!driver) return null;
  const v = driver.vehicle || {};
  const vehicleLine = [v.color, v.make, v.model].filter(Boolean).join(' ');

  return (
    <div className="summary" style={{ padding: '16px 18px', marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <span
          style={{
            width: 46, height: 46, borderRadius: '50%', background: 'var(--canvas-2)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}
        >
          <Icon name="user" size={22} color="var(--ink-3)" />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span style={{ fontWeight: 600, fontSize: 15 }}>{driver.name || 'Your driver'}</span>
            {driver.rating != null && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 12.5, color: 'var(--ink-3)' }}>
                <Icon name="star" size={13} color="var(--ink-3)" />
                {driver.rating.toFixed(2)}
              </span>
            )}
          </div>
          {vehicleLine && (
            <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 2 }}>{vehicleLine}</div>
          )}
        </div>
        {v.plate && (
          // The plate is how a passenger actually identifies the right
          // car at a busy kerb, so it gets the visual weight of a
          // licence plate rather than being buried in a detail line.
          <span
            style={{
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 13.5, fontWeight: 700, letterSpacing: '0.06em',
              border: '1.5px solid var(--line-2)', borderRadius: 6,
              padding: '5px 9px', whiteSpace: 'nowrap',
            }}
          >
            {v.plate}
          </span>
        )}
      </div>

      {stale && (
        // Said plainly rather than hidden. A rider who can see the app
        // has lost the driver's signal will wait; one shown a confidently
        // frozen car assumes the driver stopped and starts calling.
        <p style={{ fontSize: 12.5, color: 'var(--ink-3)', margin: '12px 0 0', display: 'flex', alignItems: 'center', gap: 6 }}>
          <Icon name="clock" size={14} color="var(--ink-4)" />
          Weak signal — the location may be a little behind.
        </p>
      )}
    </div>
  );
}

function Timeline({ status, timeline }) {
  const steps = [
    { key: 'acceptedAt', label: 'Driver assigned', at: timeline.acceptedAt },
    { key: 'enRouteAt',  label: 'On the way to you', at: timeline.enRouteAt },
    { key: 'arrivedAt',  label: 'Arrived at pickup', at: timeline.arrivedAt },
    { key: 'startedAt',  label: 'Trip started',      at: timeline.startedAt },
    { key: 'completedAt', label: 'Trip complete',    at: timeline.completedAt },
  ];

  if (status === 'canceled') return null;

  return (
    <div className="summary" style={{ padding: '16px 18px', marginTop: 12 }}>
      {steps.map((s, i) => {
        const done = !!s.at;
        return (
          <div key={s.key} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
              <span
                style={{
                  width: 10, height: 10, borderRadius: '50%', marginTop: 5,
                  background: done ? 'var(--positive)' : 'var(--line-2)',
                }}
              />
              {i < steps.length - 1 && (
                <span style={{ width: 2, flex: 1, minHeight: 18, background: done ? 'var(--positive)' : 'var(--line)', opacity: done ? 0.4 : 1 }} />
              )}
            </div>
            <div style={{ paddingBottom: i < steps.length - 1 ? 10 : 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: done ? 600 : 400, color: done ? 'var(--ink)' : 'var(--ink-4)' }}>
                {s.label}
              </div>
              {s.at && (
                <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 1 }}>
                  {new Date(s.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TrackRideInner({ token, onExit }) {
  const { data, error, loading } = useTracking(token);

  const vehicle = data?.driver?.location || null;
  const stale = vehicle?.ageSeconds != null && vehicle.ageSeconds > STALE_AFTER_SECONDS;

  const copy = useMemo(
    () => STATUS_COPY[data?.status] || { title: 'Your ride', sub: '' },
    [data?.status]
  );

  if (loading && !data) {
    return (
      <Shell step={0} totalSteps={0}>
        <div className="body">
          <p className="muted center" style={{ marginTop: 60 }}>Loading your ride…</p>
        </div>
      </Shell>
    );
  }

  if (error && !data) {
    const expired = error.status === 410;
    return (
      <Shell step={0} totalSteps={0}>
        <div className="body">
          <div style={{ textAlign: 'center', marginTop: 48 }}>
            <Icon name="pin" size={36} color="var(--ink-4)" />
            <h1 className="title" style={{ fontSize: 21, marginTop: 14 }}>
              {expired ? 'This link has expired' : 'Tracking link not found'}
            </h1>
            <p className="subtitle">
              {expired
                ? 'Tracking closes a couple of hours after a trip ends.'
                : 'Double-check the link from your confirmation message.'}
            </p>
            {onExit && (
              <button className="btn btn-ghost" onClick={onExit} style={{ marginTop: 18 }}>
                Book a ride
              </button>
            )}
          </div>
        </div>
      </Shell>
    );
  }

  const showEta = ['driver_en_route', 'arrived', 'in_progress'].includes(data.status);

  return (
    <Shell step={0} totalSteps={0}>
      <div className="body">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 14 }}>
          <div style={{ minWidth: 0 }}>
            <h1 className="title" style={{ fontSize: 23, marginBottom: 3 }}>{copy.title}</h1>
            <p className="subtitle" style={{ marginBottom: 0 }}>{copy.sub}</p>
          </div>
          {showEta && <EtaBadge seconds={data.etaSeconds} status={data.status} />}
        </div>

        <LiveMap
          height={300}
          pickup={{ ...data.pickup, label: data.status === 'in_progress' ? undefined : 'Pickup' }}
          dropoff={data.dropoff}
          vehicle={vehicle}
          routePolyline={data.trip.routePolyline}
          // Matches the server-advertised poll cadence, so the marker's
          // animation finishes right about when the next fix lands. Too
          // short and the car stops and waits; too long and it lags.
          updateIntervalMs={data.pollIntervalMs || 5000}
          vehicleStale={stale}
          follow
          theme="dark"
        />

        <DriverCard driver={data.driver} stale={stale} />

        <div className="summary" style={{ padding: '18px 20px', marginTop: 12 }}>
          <RouteRail pickup={data.pickup.address} dropoff={data.dropoff.address} />
        </div>

        <div className="stat-strip">
          <div className="stat">
            <div className="k">Booking</div>
            <div className="v" style={{ fontSize: 14 }}>{data.reference}</div>
          </div>
          <div className="stat">
            <div className="k">Fare</div>
            <div className="v" style={{ fontSize: 14 }}>${Number(data.trip.fare).toFixed(2)}</div>
          </div>
          <div className="stat">
            <div className="k">Payment</div>
            <div className="v" style={{ fontSize: 14, textTransform: 'capitalize' }}>{data.trip.paymentMethod}</div>
          </div>
        </div>

        <Timeline status={data.status} timeline={data.timeline} />

        <p style={{ fontSize: 12.5, color: 'var(--ink-3)', textAlign: 'center', marginTop: 18 }}>
          Need help? support@roverzoom.com
        </p>
      </div>
    </Shell>
  );
}

// See main.jsx — the maps provider lives inside the lazy-loaded subtrees
// that actually render a map, not at the app root.
export default function TrackRide(props) {
  return (
    <GoogleMapsProvider>
      <TrackRideInner {...props} />
    </GoogleMapsProvider>
  );
}
