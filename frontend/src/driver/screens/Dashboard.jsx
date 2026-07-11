import { useEffect, useRef, useState } from 'react';
import DriverShell from '../DriverShell';
import Icon from '../../components/Icon';
import Avatar from '../components/Avatar';

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

function MenuButton({ onExit }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      {open && (
        <div className="rise" style={{
          position: 'absolute', top: 48, right: 0, minWidth: 190, zIndex: 10,
          background: 'var(--card)', border: '1.5px solid var(--line-2)',
          borderRadius: 'var(--r-md)', boxShadow: 'var(--shadow-pop)', padding: 6,
          animationDuration: '0.18s',
        }}>
          <button
            onClick={() => { setOpen(false); onExit(); }}
            style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 12px', borderRadius: 'var(--r-sm)', fontSize: 14.5, fontWeight: 500, color: 'var(--ink)', textAlign: 'left' }}
          >
            <Icon name="arrowLeft" size={17} color="var(--ink-2)" />
            Exit driver mode
          </button>
        </div>
      )}
      <button className="drv-icon-btn" aria-label="Menu" onClick={() => setOpen((v) => !v)}>
        <Icon name="menu" size={18} color="var(--ink)" />
      </button>
    </div>
  );
}

export default function Dashboard({ driver, online, earningsToday, ridesCompleted, payoutDate, onToggleOnline, onExit, onOpenSchedule }) {
  return (
    <DriverShell rightSlot={
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="drv-icon-btn" aria-label="Schedule" onClick={onOpenSchedule}>
          <Icon name="calendar" size={18} color="var(--ink)" />
        </button>
        <MenuButton onExit={onExit} />
      </div>
    }>
      <div className="body">
        <div className="drv-profile rise">
          <Avatar name={driver.name} size={56} />
          <div>
            <div className="drv-profile-name">{driver.name}</div>
            <div className="drv-profile-meta">
              <span>★ {driver.rating}</span>
              <span className="drv-verified"><Icon name="shieldCheck" size={13} color="var(--positive)" stroke={2} /> Verified Driver</span>
            </div>
          </div>
        </div>

        <StatCard icon="bars" label="Today's Earnings" value={`$${earningsToday.toFixed(2)}`} sub={`${ridesCompleted} rides completed`} />
        <StatCard icon="shieldCheck" label="Driver Score" value={`${driver.rating} ★`} sub="Excellent" />
        <StatCard icon="wallet" label="Next Payout" value={payoutDate} />

        <div className="spacer" />

        <button
          className={`btn drv-go-btn ${online ? 'btn-ghost' : ''}`}
          onClick={onToggleOnline}
          style={{ marginTop: 8 }}
        >
          <Icon name="power" size={19} color={online ? 'var(--ink-2)' : 'var(--accent-ink)'} stroke={2.2} />
          {online ? 'Go Offline' : 'Go Online'}
        </button>
        <p className="drv-go-caption">
          {online ? 'You’re online and will receive ride requests' : 'You will start receiving ride requests'}
        </p>
      </div>
    </DriverShell>
  );
}
