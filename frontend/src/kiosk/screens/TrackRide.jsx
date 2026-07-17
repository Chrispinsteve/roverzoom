import { useEffect, useRef, useState } from 'react';
import FlowShell from '../components/FlowShell';
import Icon from '../../components/Icon';
import { api } from '../../lib/api';
import { TRACK_STEPS, currentStep, statusHeadline, isTerminal } from '../lib/rideStatus';

const POLL_MS = 5000;

function fmtWhen(iso) {
  return new Date(iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// Live ride tracking — the moment after booking where the rider watches their
// driver come to life. Polls the booking by reference every few seconds and
// renders the lifecycle as a milestone timeline; the driver card materializes
// the instant a driver claims the ride. Reuses the already-tested booking
// status lifecycle end to end — no new backend surface.
export default function TrackRide({ reference, initialBooking, onBack, onNewRide }) {
  const [booking, setBooking] = useState(initialBooking || null);
  const [error, setError] = useState('');
  const timerRef = useRef(null);

  useEffect(() => {
    if (!reference) return undefined;
    let cancelled = false;

    const tick = async () => {
      try {
        const fresh = await api.getBooking(reference);
        if (cancelled) return;
        setBooking(fresh);
        setError('');
        if (isTerminal(fresh.status)) {
          clearInterval(timerRef.current);
        }
      } catch (e) {
        if (!cancelled) setError(e.message || 'Lost connection — retrying…');
      }
    };

    tick();
    timerRef.current = setInterval(tick, POLL_MS);
    return () => { cancelled = true; clearInterval(timerRef.current); };
  }, [reference]);

  const status = booking?.status || 'confirmed';
  const step = currentStep(status);
  const head = statusHeadline(status);
  const driver = booking?.driver || null;
  const canceled = status === 'canceled';

  const footer = (
    <div className="k-footer-bar">
      <div className="k-footer-inner">
        <button className="k-next-btn" onClick={onNewRide}>Book another ride</button>
      </div>
    </div>
  );

  return (
    <FlowShell title="Your ride" step={0} totalSteps={0} onBack={onBack} footer={footer}>
      <div className={`k-track-hero k-track-${head.tone}`}>
        <span className="k-track-title">{head.title}</span>
        {head.sub && <span className="k-track-sub">{head.sub}</span>}
        {booking && !canceled && !isTerminal(status) && (
          <span className="k-track-live"><span className="k-track-live-dot" />Live</span>
        )}
      </div>

      {error && <span className="k-price-wait" role="status">{error}</span>}

      {driver && (
        <div className="k-track-driver">
          <img
            src={driver.photo_url}
            alt={driver.name}
            className="k-ride-driver-photo"
            onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
          />
          <div className="k-ride-driver-info">
            <div className="k-ride-driver-name">{driver.name}</div>
            <div className="k-ride-driver-meta">
              &#9733; {driver.rating} &middot; {driver.vehicle_color} {driver.vehicle_make} {driver.vehicle_model}
            </div>
          </div>
          <span className="k-track-driver-badge">Your driver</span>
        </div>
      )}

      {!canceled && (
        <ol className="k-track-steps">
          {TRACK_STEPS.map((s, i) => {
            const state = step > i ? 'done' : step === i ? 'active' : 'todo';
            return (
              <li key={s.key} className={`k-track-step ${state}`}>
                <span className="k-track-node">
                  {state === 'done'
                    ? <Icon name="check" size={13} color="var(--paper)" stroke={3} />
                    : <span className="k-track-node-dot" />}
                </span>
                <span className="k-track-step-label">{s.label}</span>
              </li>
            );
          })}
        </ol>
      )}

      {booking && (
        <div className="k-ticket k-track-ticket">
          <div className="k-ticket-row">
            <span className="k">Confirmation</span>
            <span className="v">{booking.reference}</span>
          </div>
          <div className="k-ticket-row">
            <span className="k">Pickup</span>
            <span className="v">{booking.pickup_address}</span>
          </div>
          <div className="k-ticket-row">
            <span className="k">Destination</span>
            <span className="v">{booking.dropoff_address}</span>
          </div>
          <div className="k-ticket-row">
            <span className="k">When</span>
            <span className="v">{fmtWhen(booking.scheduled_at)}</span>
          </div>
          <div className="k-ticket-row">
            <span className="k">Total</span>
            <span className="v">${Number(booking.fare).toFixed(2)}</span>
          </div>
        </div>
      )}
    </FlowShell>
  );
}
