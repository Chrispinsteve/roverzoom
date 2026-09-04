import { useEffect, useRef, useState } from 'react';
import DriverShell from '../DriverShell';
import Icon from '../../components/Icon';
import Avatar from '../components/Avatar';
import { driverApi } from '../../lib/driverApi';
import { pushStatus, enablePush, disablePush } from '../../lib/push';
import { mapsUrl } from '../lib/maps';
import { shortAddress } from '../lib/address';

// Ride-request alerts. Two independent channels, and a driver needs at least
// one of them or they simply never hear about a ride.
//
// PUSH is the good one: instant, free, works with the app closed. On iPhone it
// requires the app be added to the Home Screen first, which many drivers have
// not done.
//
// TEXT is the fallback, and it now requires explicit consent — the A2P opt-in
// added at signup. Every driver who registered before that has none, and had no
// way to give it: the checkbox only exists on the signup form they already
// passed. So the toggle is here too, or they are unreachable forever.
//
// The comment this replaces said "the server texts drivers who don't have it
// on", which stopped being true the moment consent was enforced.
function NotificationToggle({ driver, onDriverUpdate }) {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [smsBusy, setSmsBusy] = useState(false);
  const smsOn = Boolean(driver?.sms_consent_at);
  // Either channel is enough. Neither means ride requests arrive and the driver
  // never learns of them.
  const reachable = Boolean(state?.enabled) || smsOn;

  useEffect(() => { pushStatus().then(setState).catch(() => setState({ supported: false })); }, []);

  // Granted and withdrawn by the driver themselves. Setting this for them would
  // fabricate the consent record the A2P rejection was about.
  const toggleSms = async () => {
    setSmsBusy(true); setMsg('');
    try {
      await driverApi.setSmsConsent(!smsOn);
      // A whole object, not a functional update: driverOverride starts as null,
      // so spreading the previous value would replace the entire driver record
      // with a two-field stub and blank the rest of the screen.
      if (onDriverUpdate) onDriverUpdate({ ...driver, sms_consent_at: smsOn ? null : new Date().toISOString() });
      setMsg(smsOn ? 'Text alerts off.' : 'Text alerts on — used only when push cannot reach you.');
    } catch (e) { setMsg(e.message || 'Could not change text alerts.'); }
    finally { setSmsBusy(false); }
  };

  const turnOn = async () => {
    setBusy(true); setMsg('');
    try {
      await enablePush();
      setState((s) => ({ ...(s || {}), supported: true, enabled: true }));
      setMsg('Alerts on — you’ll be pinged the moment a ride is requested.');
    } catch (e) { setMsg(e.message || 'Could not turn on alerts.'); }
    finally { setBusy(false); }
  };

  const turnOff = async () => {
    setBusy(true); setMsg('');
    try { await disablePush(); setState((s) => ({ ...(s || {}), enabled: false })); }
    finally { setBusy(false); }
  };

  if (!state) return null;

  return (
    <div className="drv-card rise" style={{ marginTop: 4 }}>
      <div className="drv-card-top">
        {/* One dot for the only question a driver actually has: will a ride
            request reach me? Green when SOMETHING can — push or text. Amber when
            nothing can, which is a state they need to notice, not a neutral
            default. Both channels being off is silence, and silence looks
            identical to no rides being available. */}
        <span className="drv-card-label" style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{
            width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
            background: reachable ? 'var(--positive)' : 'var(--warn, #F5B301)',
            boxShadow: reachable ? '0 0 0 3px rgba(52,199,89,0.18)' : 'none',
          }} />
          Ride request alerts
        </span>
        <span className="drv-card-icon"><Icon name="car" size={17} color="var(--ink-3)" /></span>
      </div>
      {state.enabled ? (
        <>
          <div className="drv-card-value" style={{ fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name="check" size={16} color="var(--positive)" stroke={3} /> On
          </div>
          <button className="btn btn-ghost" onClick={turnOff} disabled={busy} style={{ width: '100%', marginTop: 10 }}>
            {busy ? '…' : 'Turn off'}
          </button>
        </>
      ) : (
        <>
          <p className="drv-card-sub" style={{ marginBottom: 10 }}>
            Get pinged the moment a new ride is requested — even when the app is closed.
          </p>
          <button className="btn btn-ghost" onClick={turnOn} disabled={busy} style={{ width: '100%' }}>
            {busy ? 'Enabling…' : 'Turn on alerts'}
          </button>
        </>
      )}
      {/* The text fallback, as its own control. A driver who cannot use push —
          an iPhone that is not installed to the Home Screen, notifications
          denied — has nothing at all without this. */}
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--line-2)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {/* State and action are separated on purpose. A single button reading
                "On" is ambiguous — it looks like an instruction to turn something
                on, not a report that it already is. The STATE is a coloured label;
                the BUTTON always says what tapping it will do. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>Text me as backup</span>
              <span style={{
                fontSize: 10.5, fontWeight: 800, letterSpacing: '0.07em',
                padding: '2px 7px', borderRadius: 999,
                color: smsOn ? '#fff' : 'var(--ink-3)',
                background: smsOn ? 'var(--positive)' : 'var(--canvas-2)',
              }}><span style={{ width: 6, height: 6, borderRadius: '50%', display: 'inline-block', marginRight: 5, verticalAlign: 'middle', background: smsOn ? '#fff' : 'var(--ink-3)' }} />{smsOn ? 'ON' : 'OFF'}</span>
            </div>
            <div className="drv-card-sub" style={{ marginTop: 2 }}>
              Only when push can’t reach you. Msg &amp; data rates may apply. Reply STOP to opt out.
            </div>
          </div>
          <button
            className="btn btn-ghost"
            onClick={toggleSms}
            disabled={smsBusy}
            // .btn is width:100% by default — every other button in this card
            // is full-width and wants to be. Beside text it has to be sized to
            // its label instead, or it claims the whole row and the text column
            // collapses to one word per line.
            style={{ width: 'auto', flexShrink: 0, minWidth: 92, padding: '12px 16px', minHeight: 44, fontSize: 14 }}
          >
            {smsBusy ? '…' : smsOn ? 'Turn off' : 'Turn on'}
          </button>
        </div>
      </div>

      {msg && <p className="drv-card-sub" style={{ marginTop: 8, lineHeight: 1.5 }}>{msg}</p>}
    </div>
  );
}

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
      <div className="drv-next-route">{shortAddress(booking.pickup_address)} → {shortAddress(booking.dropoff_address)}</div>
      <div className="drv-next-meta">
        {new Date(booking.scheduled_at).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
        {' · '}{booking.rider_name}{' · you earn $'}{booking.driver_payout.toFixed(2)}
      </div>
      <div className="drv-next-actions">
        <a className="drv-next-btn" target="_blank" rel="noopener noreferrer" href={mapsUrl(booking.pickup_lat, booking.pickup_lng, booking.pickup_address)}>
          <Icon name="car" size={15} color="#fff" /> Directions
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

export default function Home({ driver, onExit, onLogout, onOpenTab, activeTab, onChangeTab, onDriverUpdate }) {
  const [earnings, setEarnings] = useState(null);
  const [nextRide, setNextRide] = useState(null);

  // Refresh on an interval and whenever the driver returns to the app, so a
  // ride the rider cancels drops off "Next Ride" on its own instead of lingering
  // until the driver navigates away and back.
  useEffect(() => {
    let stopped = false;
    const load = () => {
      driverApi.getEarnings().then((d) => { if (!stopped) setEarnings(d); }).catch(() => {});
      driverApi.getSchedule().then((schedule) => {
        if (stopped) return;
        const upcoming = (schedule || [])
          .filter((b) => UPCOMING.includes(b.status) && new Date(b.scheduled_at) > new Date(Date.now() - 60 * 60000))
          .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
        setNextRide(upcoming[0] || null);
      }).catch(() => {});
    };
    load();
    const t = setInterval(load, 15000);
    const onVisible = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { stopped = true; clearInterval(t); document.removeEventListener('visibilitychange', onVisible); };
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

        {profileComplete && <NotificationToggle driver={driver} onDriverUpdate={onDriverUpdate} />}

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
