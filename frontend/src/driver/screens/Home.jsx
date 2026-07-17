import { useEffect, useRef, useState } from 'react';
import DriverShell from '../DriverShell';
import Icon from '../../components/Icon';
import Avatar from '../components/Avatar';
import { driverApi } from '../../lib/driverApi';
import { mapsUrl } from '../lib/maps';

const UPCOMING = ['driver_assigned', 'driver_en_route', 'arrived', 'in_progress'];

function countdownLabel(iso) {
  const ms = new Date(iso) - Date.now();
  if (ms <= 0) return 'now';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `in ${mins} min`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `in ${h}h ${mins % 60}m`;
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
}

// The one question a driver opens the app with: "when's my next ride?"
// Answered above the fold, with a live countdown and one-tap directions.
function NextRideCard({ booking, onOpenTab }) {
  const [, forceTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => forceTick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="drv-next rise">
      <div className="drv-next-top">
        <span className="drv-next-eyebrow">Next ride</span>
        <span className="drv-next-count">{countdownLabel(booking.scheduled_at)}</span>
      </div>
      <div className="drv-next-route">{booking.pickup_address} → {booking.dropoff_address}</div>
      <div className="drv-next-meta">
        {new Date(booking.scheduled_at).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
        {' · '}{booking.rider_name}{' · you earn $'}{booking.driver_payout.toFixed(2)}
      </div>
      <div className="drv-next-actions">
        <a className="drv-next-btn" target="_blank" rel="noopener noreferrer" href={mapsUrl(booking.pickup_lat, booking.pickup_lng, booking.pickup_address)}>
          <Icon name="car" size={15} color="var(--ink)" /> Directions
        </a>
        <button className="drv-next-btn" onClick={() => onOpenTab('schedule')}>View schedule</button>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, sub }) {
  return (
    <div className="drv-card rise">
      <div className="drv-card-top">
        <span className="drv-card-label">{label}</span>
        <span className="drv-card-icon"><Icon name={icon} size={17} color="var(--ink-3)" /></span>
      </div>
      <div className="drv-card-value">{value}</div>
      {sub && <div className="drv-card-sub">{sub}</div>}
    </div>
  );
}

function MenuButton({ onExit, onLogout }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const itemStyle = { display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 12px', borderRadius: 'var(--r-sm)', fontSize: 14.5, fontWeight: 500, color: 'var(--ink)', textAlign: 'left' };

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {open && (
        <div className="rise" style={{
          position: 'absolute', top: 48, right: 0, minWidth: 190, zIndex: 10,
          background: 'var(--card)', border: '1.5px solid var(--line-2)',
          borderRadius: 'var(--r-md)', boxShadow: 'var(--shadow-pop)', padding: 6,
          animationDuration: '0.18s',
        }}>
          <button onClick={() => { setOpen(false); onExit(); }} style={itemStyle}>
            <Icon name="arrowLeft" size={17} color="var(--ink-2)" />
            Exit driver mode
          </button>
          <button onClick={() => { setOpen(false); onLogout(); }} style={itemStyle}>
            <Icon name="power" size={17} color="var(--ink-2)" />
            Log out
          </button>
        </div>
      )}
      <button className="drv-icon-btn" aria-label="Menu" onClick={() => setOpen((v) => !v)}>
        <Icon name="menu" size={18} color="var(--ink)" />
      </button>
    </div>
  );
}

function ProfileGateBanner({ driver, onOpenTab }) {
  const items = [
    { key: 'photo', label: 'Profile photo', done: !!driver.photo_url },
    { key: 'license', label: "Driver's license", done: !!driver.license_photo_url },
    { key: 'insurance', label: 'Insurance', done: !!driver.insurance_photo_url },
  ];
  const doneCount = items.filter((i) => i.done).length;

  return (
    <button className="drv-gate-banner rise" onClick={() => onOpenTab('profile')}>
      <div className="drv-gate-banner-top">
        <span className="drv-gate-banner-title">Complete your profile to start accepting rides</span>
        <Icon name="arrowRight" size={18} color="var(--ink)" />
      </div>
      <p className="drv-gate-banner-sub">{doneCount} of 3 done — riders see your photo once you're matched.</p>
      <div className="drv-gate-checklist">
        {items.map((i) => (
          <span key={i.key} className={`drv-gate-chip ${i.done ? 'done' : ''}`}>
            {i.done && <Icon name="check" size={13} color="var(--positive)" stroke={3} />}
            {i.label}
          </span>
        ))}
      </div>
    </button>
  );
}

export default function Home({ driver, onExit, onLogout, onOpenTab, activeTab, onChangeTab }) {
  const [earnings, setEarnings] = useState(null);
  const [nextRide, setNextRide] = useState(null);

  useEffect(() => {
    driverApi.getEarnings().then(setEarnings).catch(() => setEarnings(null));
    driverApi.getSchedule().then((schedule) => {
      const upcoming = (schedule || [])
        .filter((b) => UPCOMING.includes(b.status) && new Date(b.scheduled_at) > new Date(Date.now() - 60 * 60000))
        .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
      setNextRide(upcoming[0] || null);
    }).catch(() => setNextRide(null));
  }, []);

  const profileComplete = !!driver.profile_completed_at;

  return (
    <DriverShell
      activeTab={activeTab}
      onChangeTab={onChangeTab}
      rightSlot={<MenuButton onExit={onExit} onLogout={onLogout} />}
    >
      <div className="body">
        <div className="drv-profile rise">
          <Avatar name={driver.name} photoUrl={driver.photo_url} size={56} />
          <div>
            <div className="drv-profile-name">{driver.name}</div>
            <div className="drv-profile-meta">
              <span>★ {driver.rating}</span>
              {profileComplete && (
                <span className="drv-verified"><Icon name="shieldCheck" size={13} color="var(--positive)" stroke={2} /> Verified Driver</span>
              )}
            </div>
          </div>
        </div>

        {!profileComplete && <ProfileGateBanner driver={driver} onOpenTab={onOpenTab} />}

        {nextRide && <NextRideCard booking={nextRide} onOpenTab={onOpenTab} />}

        <StatCard
          icon="bars"
          label="Today's Earnings"
          value={earnings ? `$${earnings.todayTotal.toFixed(2)}` : '—'}
          sub={earnings ? `${earnings.recent.filter((e) => e.type === 'fare').length} fare payouts recently` : undefined}
        />
        <StatCard icon="shieldCheck" label="Driver Score" value={`${driver.rating} ★`} sub={`${driver.rides_completed} rides completed`} />
        <StatCard icon="wallet" label="This Week" value={earnings ? `$${earnings.weekTotal.toFixed(2)}` : '—'} />

        <div className="spacer" />

        {profileComplete ? (
          <button className="btn rise-1" onClick={() => onOpenTab('requests')} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <Icon name="car" size={18} color="var(--accent-ink)" />
            View Ride Requests
          </button>
        ) : (
          <button className="btn rise-1" onClick={() => onOpenTab('profile')}>
            Complete Your Profile
          </button>
        )}
      </div>
    </DriverShell>
  );
}
