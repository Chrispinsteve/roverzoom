import { useEffect, useRef, useState } from 'react';
import DriverShell from '../DriverShell';
import Icon from '../../components/Icon';
import { driverApi } from '../../lib/driverApi';

const POLL_MS = 5000;

function timeLabel(iso) {
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function Requests({ driver, onClaimed, activeTab, onChangeTab }) {
  const [trips, setTrips] = useState(null);
  const [error, setError] = useState('');
  const [claimingId, setClaimingId] = useState(null);
  const timerRef = useRef(null);

  const profileComplete = !!driver.profile_completed_at;

  useEffect(() => {
    if (!profileComplete) return undefined;

    let cancelled = false;
    const poll = async () => {
      try {
        const data = await driverApi.getAvailableTrips();
        if (!cancelled) { setTrips(data); setError(''); }
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    };
    poll();
    timerRef.current = setInterval(poll, POLL_MS);
    return () => { cancelled = true; clearInterval(timerRef.current); };
  }, [profileComplete]);

  const accept = async (booking) => {
    setClaimingId(booking.id);
    setError('');
    try {
      const claimed = await driverApi.claimBooking(booking.id);
      onClaimed(claimed);
    } catch (e) {
      setError(e.message);
      setTrips((prev) => (prev || []).filter((t) => t.id !== booking.id));
    } finally {
      setClaimingId(null);
    }
  };

  if (!profileComplete) {
    return (
      <DriverShell activeTab={activeTab} onChangeTab={onChangeTab}>
        <div className="body">
          <h1 className="title rise" style={{ fontSize: 26 }}>Requests</h1>
          <div className="drv-empty-state rise-1">
            <Icon name="shieldCheck" size={32} color="var(--ink-4)" />
            <p>Complete your profile to start seeing ride requests.</p>
            <button className="btn" style={{ marginTop: 16 }} onClick={() => onChangeTab('profile')}>
              Complete Profile
            </button>
          </div>
        </div>
      </DriverShell>
    );
  }

  const next = trips && trips[0];

  return (
    <DriverShell activeTab={activeTab} onChangeTab={onChangeTab}>
      <div className="body">
        <h1 className="title rise" style={{ fontSize: 26 }}>Requests</h1>
        <p className="subtitle rise-1">First to accept gets the ride</p>

        {error && <p className="error-text">{error}</p>}

        {trips === null && !error && <p className="muted center" style={{ marginTop: 40 }}>Loading…</p>}

        {trips && trips.length === 0 && (
          <div className="drv-empty-state rise-1">
            <Icon name="car" size={32} color="var(--ink-4)" />
            <p>No requests right now. New trips appear here the moment they're posted.</p>
          </div>
        )}

        {next && (
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
                  <div className="rail-value">{next.pickup_address}</div>
                </div>
                <div className="rail-slot">
                  <div className="rail-label">Dropoff area</div>
                  <div className="rail-value">{next.dropoff_address}</div>
                  <div className="drv-rail-meta">Exact address unlocks after you accept</div>
                </div>
              </div>
            </div>

            <div className="stat-strip" style={{ marginTop: 16 }}>
              <div className="stat"><div className="k">Distance</div><div className="v">{next.distance_miles} mi</div></div>
              <div className="stat"><div className="k">Pickup time</div><div className="v" style={{ fontSize: 13 }}>{timeLabel(next.scheduled_at)}</div></div>
              <div className="stat"><div className="k">You earn</div><div className="v">${next.driver_payout.toFixed(2)}</div></div>
            </div>

            <button
              className="btn"
              style={{ marginTop: 18 }}
              disabled={claimingId === next.id}
              onClick={() => accept(next)}
            >
              {claimingId === next.id ? 'Accepting…' : 'Accept Ride'}
            </button>
          </div>
        )}

        {trips && trips.length > 1 && (
          <p className="muted center" style={{ marginTop: 14, fontSize: 13 }}>
            +{trips.length - 1} more available — see all in Schedule
          </p>
        )}
      </div>
    </DriverShell>
  );
}
