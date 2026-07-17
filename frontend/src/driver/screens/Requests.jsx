import { useEffect, useRef, useState } from 'react';
import DriverShell from '../DriverShell';
import Icon from '../../components/Icon';
import { driverApi } from '../../lib/driverApi';
import { haversineMiles, getPositionOnce, overlaps } from '../lib/geo';

const POLL_MS = 5000;
const ACTIVE_MINE = ['driver_assigned', 'driver_en_route', 'arrived', 'in_progress'];

function timeLabel(iso) {
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// One request = one decision. Everything a driver weighs — pay, when, how far
// the pickup is from them right now, and whether it collides with a ride they
// already own — lives on the card. First to accept wins, so no artificial
// ranking: soonest first, all visible.
function RequestCard({ trip, fromYouMi, conflict, claiming, onAccept }) {
  return (
    <div className="summary rise-1" style={{ padding: '16px 18px', marginTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 10 }}>
        <span style={{ fontFamily: 'var(--font-display, inherit)', fontWeight: 650, fontSize: 24, color: 'var(--positive)' }}>
          ${trip.driver_payout.toFixed(2)}
        </span>
        <span style={{ fontSize: 13.5, fontWeight: 600, textAlign: 'right' }}>{timeLabel(trip.scheduled_at)}</span>
      </div>

      <div className="route-rail" style={{ marginTop: 10 }}>
        <div className="rail-track">
          <span className="rail-dot" />
          <span className="rail-line" />
          <span className="rail-square" />
        </div>
        <div className="rail-body">
          <div className="rail-slot top">
            <div className="rail-label">Pickup — exact</div>
            <div className="rail-value">{trip.pickup_address}</div>
          </div>
          <div className="rail-slot">
            <div className="rail-label">Dropoff area</div>
            <div className="rail-value">{trip.dropoff_address}</div>
            <div className="drv-rail-meta">Exact address unlocks after you accept</div>
          </div>
        </div>
      </div>

      <div className="drv-req-chips">
        <span className="drv-req-chip">{trip.distance_miles} mi trip</span>
        <span className="drv-req-chip">~{trip.duration_minutes} min</span>
        {fromYouMi != null && <span className="drv-req-chip">{fromYouMi.toFixed(1)} mi from you</span>}
        <span className="drv-req-chip">
          {trip.payment_method === 'cash' ? 'Rider pays cash'
            : trip.payment_method === 'zelle' ? 'Paid by Zelle'
            : 'Card — prepaid'}
        </span>
      </div>

      {conflict && (
        <div className="drv-conflict">
          <Icon name="shieldCheck" size={14} color="var(--warn, #8A6A1F)" />
          Overlaps a ride you already accepted ({conflict})
        </div>
      )}

      <button className="btn" style={{ marginTop: 14 }} disabled={claiming} onClick={onAccept}>
        {claiming ? 'Accepting…' : conflict ? 'Accept anyway' : 'Accept Ride'}
      </button>
    </div>
  );
}

export default function Requests({ driver, onClaimed, activeTab, onChangeTab }) {
  const [trips, setTrips] = useState(null);
  const [mine, setMine] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [claimingId, setClaimingId] = useState(null);
  const [pos, setPos] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);
  const timerRef = useRef(null);

  const profileComplete = !!driver.profile_completed_at;

  useEffect(() => {
    if (!profileComplete) return undefined;

    let cancelled = false;
    const poll = async () => {
      try {
        const [data, schedule] = await Promise.all([
          driverApi.getAvailableTrips(),
          driverApi.getSchedule().catch(() => []),
        ]);
        if (!cancelled) {
          setTrips(data);
          setMine((schedule || []).filter((b) => ACTIVE_MINE.includes(b.status)));
          setError('');
          setUpdatedAt(new Date());
        }
      } catch (e) {
        if (!cancelled) setError(e.message);
      }
    };
    poll();
    timerRef.current = setInterval(poll, POLL_MS);
    // Instant refresh when the driver returns to the app — the moment they
    // most expect fresh requests.
    const onVisible = () => { if (document.visibilityState === 'visible') poll(); };
    document.addEventListener('visibilitychange', onVisible);
    getPositionOnce().then((p) => { if (!cancelled) setPos(p); });
    return () => {
      cancelled = true;
      clearInterval(timerRef.current);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [profileComplete]);

  const accept = async (booking) => {
    setClaimingId(booking.id);
    setError('');
    setNotice('');
    try {
      const claimed = await driverApi.claimBooking(booking.id);
      onClaimed(claimed);
    } catch (e) {
      // Someone else won the race — say so plainly and move on.
      if (String(e.message).toLowerCase().includes('already claimed')) {
        setNotice('Another driver got that one — here\u2019s what\u2019s still open.');
      } else {
        setError(e.message);
      }
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

  const conflictFor = (trip) => {
    const hit = mine.find((m) => overlaps(m.scheduled_at, m.duration_minutes, trip.scheduled_at, trip.duration_minutes));
    if (!hit) return null;
    return new Date(hit.scheduled_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  };

  return (
    <DriverShell activeTab={activeTab} onChangeTab={onChangeTab}>
      <div className="body">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h1 className="title rise" style={{ fontSize: 26 }}>Requests</h1>
          {updatedAt && (
            <span className="drv-live"><span className="drv-live-dot" />Live</span>
          )}
        </div>
        <p className="subtitle rise-1">Every driver sees these — first to accept gets the ride</p>

        {error && <p className="error-text">{error}</p>}
        {notice && <p className="drv-notice rise">{notice}</p>}

        {trips === null && !error && <p className="muted center" style={{ marginTop: 40 }}>Loading…</p>}

        {trips && trips.length === 0 && (
          <div className="drv-empty-state rise-1">
            <Icon name="car" size={32} color="var(--ink-4)" />
            <p>No requests right now. New trips appear here the moment riders book.</p>
          </div>
        )}

        {trips && trips.map((trip) => (
          <RequestCard
            key={trip.id}
            trip={trip}
            claiming={claimingId === trip.id}
            conflict={conflictFor(trip)}
            fromYouMi={pos && trip.pickup_lat != null ? haversineMiles(pos.lat, pos.lng, Number(trip.pickup_lat), Number(trip.pickup_lng)) : null}
            onAccept={() => accept(trip)}
          />
        ))}
      </div>
    </DriverShell>
  );
}
