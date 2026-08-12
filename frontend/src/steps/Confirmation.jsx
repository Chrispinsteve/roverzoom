import { useState } from 'react';
import Shell from '../components/Shell';
import Icon from '../components/Icon';
import RouteRail from '../components/RouteRail';

function fmtDur(min) {
  const m = Number(min);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} hr ${r} min` : `${h} hr`;
}

export default function Confirmation({ booking, onNewBooking }) {
  const [copied, setCopied] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  const when = new Date(booking.scheduled_at);
  const dateStr = when.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const timeStr = when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  // Absolute URL, because this is meant to be shared — pasted into a
  // text to whoever is meeting the rider at the airport, or kept for
  // later. A relative path would be useless outside this tab.
  const trackUrl = booking.track_token
    ? `${window.location.origin}/track/${booking.track_token}`
    : null;

  const shareTracking = async () => {
    if (!trackUrl) return;
    // Prefer the native share sheet on mobile — it lets the rider send
    // the link straight into Messages or WhatsApp, which is what they
    // actually want to do with it. Falls back to clipboard on desktop,
    // where no share sheet exists.
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Track my RoverZoom ride', url: trackUrl });
        return;
      } catch {
        // User dismissed the sheet, or share was blocked — fall through
        // to copying rather than leaving the tap doing nothing.
      }
    }
    try {
      await navigator.clipboard.writeText(trackUrl);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1600);
    } catch { /* clipboard may be blocked; ignore */ }
  };

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(booking.reference);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* clipboard may be blocked; ignore */ }
  };

  return (
    <Shell step={0} totalSteps={0}>
      <div className="body">
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <div style={{ width: 68, height: 68, borderRadius: '50%', background: 'var(--positive)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 18, animation: 'rz-pop 0.5s var(--ease-spring) both' }}>
            <Icon name="check" size={34} color="#fff" stroke={2.5} />
          </div>
          <h1 className="title rise-1" style={{ fontSize: 27 }}>Your ride is booked</h1>
          <p className="subtitle rise-1" style={{ marginBottom: 0 }}>
            We’ll see you on {dateStr} at {timeStr}.
          </p>
        </div>

        <div className="id-chip rise-2" style={{ marginBottom: 16 }}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 4 }}>Booking ID</div>
            <div className="id-val">{booking.reference}</div>
          </div>
          <button className="copy-btn" onClick={copyId} aria-label="Copy booking ID"
            style={{ background: copied ? 'var(--positive)' : 'var(--card)', borderColor: copied ? 'var(--positive)' : 'var(--line-2)' }}>
            <Icon name={copied ? 'check' : 'copy'} size={18} color={copied ? '#fff' : 'var(--ink-2)'} stroke={2} />
          </button>
        </div>

        <div className="summary rise-2" style={{ padding: '18px 20px' }}>
          <RouteRail pickup={booking.pickup_address} dropoff={booking.dropoff_address} />
        </div>

        {trackUrl && (
          <div className="summary rise-2" style={{ padding: '16px 18px', marginTop: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: 'block', fontWeight: 600, fontSize: 14 }}>Track your ride</span>
                <span style={{ display: 'block', fontSize: 12.5, color: 'var(--ink-3)', marginTop: 2 }}>
                  Watch your driver approach in real time.
                </span>
              </span>
              <button className="btn btn-ghost" onClick={shareTracking}
                style={{ width: 'auto', padding: '9px 14px', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 7 }}>
                <Icon name={linkCopied ? 'check' : 'send'} size={16}
                  color={linkCopied ? 'var(--positive)' : 'var(--ink)'} />
                {linkCopied ? 'Copied' : 'Share'}
              </button>
            </div>
            <a href={`/track/${booking.track_token}`}
               className="btn" style={{ marginTop: 12, textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
              <Icon name="pin" size={16} color="var(--accent-ink)" />
              Open live map
            </a>
          </div>
        )}

        <div className="stat-strip rise-3">
          <div className="stat"><div className="k">Date</div><div className="v" style={{ fontSize: 14 }}>{dateStr}</div></div>
          <div className="stat"><div className="k">Time</div><div className="v" style={{ fontSize: 14 }}>{timeStr}</div></div>
          <div className="stat"><div className="k">Duration</div><div className="v" style={{ fontSize: 14 }}>{fmtDur(booking.duration_minutes)}</div></div>
        </div>

        <div className="summary rise-3" style={{ marginTop: 4 }}>
          <div className="summary-row">
            <span className="summary-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Icon name={booking.payment_method === 'cash' ? 'cash' : 'card'} size={18} color="var(--ink-3)" />
              <span style={{ textTransform: 'capitalize' }}>{booking.payment_method}</span>
            </span>
            <span className="summary-value big">${Number(booking.fare).toFixed(2)}</span>
          </div>
        </div>

        <TrustPanel />

        <div className="btn-row" style={{ marginTop: 20 }}>
          <button className="btn btn-ghost" onClick={onNewBooking} style={{ flex: 1 }}>Book another</button>
          <button className="btn" onClick={onNewBooking} style={{ flex: 1 }}>Done</button>
        </div>
      </div>
    </Shell>
  );
}

function TrustPanel() {
  const items = [
    { icon: 'badge', title: 'Professional drivers', sub: 'Experienced and verified' },
    { icon: 'clockCheck', title: 'On-time guarantee', sub: 'We value your time' },
    { icon: 'shieldCheck', title: 'Safe and secure', sub: 'Your safety is our priority' },
    { icon: 'headset', title: '24/7 support', sub: 'We’re here to help' },
  ];
  return (
    <div className="rise-4" style={{ background: '#0c0d0f', borderRadius: 'var(--r-lg)', padding: '22px 22px 20px', marginTop: 20, boxShadow: 'var(--shadow-float)', overflow: 'hidden', position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
        <img src="/logo-wordmark-white.png" alt="RoverZoom" style={{ height: 18, width: 'auto' }} />
      </div>
      <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 13.5, margin: '0 0 16px' }}>Scheduled rides, on your time.</p>
      <div>
        {items.map((it) => (
          <div className="trust-row" key={it.title}>
            <span className="t-ic"><Icon name={it.icon} size={20} color="#fff" stroke={1.7} /></span>
            <span>
              <span className="t-title" style={{ display: 'block' }}>{it.title}</span>
              <span className="t-sub" style={{ display: 'block' }}>{it.sub}</span>
            </span>
          </div>
        ))}
      </div>
      <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', marginTop: 14, paddingTop: 16 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, color: '#fff', marginBottom: 4 }}>Need help?</div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.55)' }}>Contact our support team</div>
        <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.85)', marginTop: 2 }}>support@roverzoom.com</div>
      </div>
    </div>
  );
}
