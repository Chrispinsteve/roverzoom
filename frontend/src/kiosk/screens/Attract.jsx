import { useEffect, useRef, useState } from 'react';
import Icon from '../../components/Icon';
import QrCode from '../components/QrCode';
import VoiceOrb from '../../components/VoiceOrb';
import { PUBLIC_ORIGIN } from '../../lib/publicUrl';

// Rotating attract headlines — the marquee cycles through these while the kiosk
// idles. Each has a title and an optional subtext (a few are title-only).
const HEADLINES = [
  { t: 'What is RoverZoom?' },
  { t: 'The smarter way to schedule rides.', s: 'Avoid last-minute stress.' },
  { t: 'Schedule rides in advance.' },
  { t: 'Up to 25% less than Uber.', s: 'Even less in the early morning.' },
  { t: 'Wake up knowing your ride is booked.', s: 'Perfect for work, flights and appointments.' },
  { t: "Book tomorrow's ride today.", s: 'It only takes one minute.' },
  { t: 'Plan your trip here. Get rewarded.', s: 'Every scheduled ride can save you money.' },
  { t: 'Your driver is booked before you wake up.', s: 'Waiting at your door.' },
];

const CASES = [
  { icon: '✈️', title: 'Airport Ride', line: 'Never miss an early flight.' },
  { icon: '🏢', title: 'Work Commute', line: 'Leave on time every morning.' },
  { icon: '🏥', title: 'Medical Appointment', line: 'One less thing to worry about.' },
  { icon: '🎉', title: 'Events', line: 'Enjoy the night — your ride home is ready.' },
];

export default function Attract({ onBookHere, onMyRides, onTalk, onDriverMode }) {
  const [time, setTime] = useState(() => new Date());
  const [hi, setHi] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 15000);
    return () => clearInterval(id);
  }, []);

  // Advance the headline marquee. ~4.6s each is long enough to read the pair.
  useEffect(() => {
    const id = setInterval(() => setHi((i) => (i + 1) % HEADLINES.length), 4600);
    return () => clearInterval(id);
  }, []);

  // Close the gear menu on an outside tap or Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onDoc = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('pointerdown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [menuOpen]);

  const h = HEADLINES[hi];

  return (
    <div className="kiosk-root">
      <section className="kiosk-screen k-kiosk k-attract">
        <div className="k-kiosk-wrap">
          <div className="k-kiosk-top">
            <img src="/logo-wordmark-white.png" alt="RoverZoom" className="k-brand-img" />
            <div className="k-top-right">
              {onTalk && (
                <button className="k-talk-orb" onClick={onTalk} aria-label="Talk to book a ride">
                  <span className="k-talk-orb-viz"><VoiceOrb state="idle" size={40} /></span>
                  <span className="k-talk-orb-label">Talk to book</span>
                </button>
              )}
              <span className="k-clock">{time.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
              {/* Subtle utility menu — keeps "Find my ride" tucked away so the
                  entrance stays uncluttered and the body has more room. */}
              <div className="k-gear-wrap" ref={menuRef}>
                <button
                  className="k-gear"
                  onClick={() => setMenuOpen((o) => !o)}
                  aria-label="Menu"
                  aria-haspopup="true"
                  aria-expanded={menuOpen}
                >
                  <Icon name="gear" size={20} color="currentColor" />
                </button>
                {menuOpen && (
                  <div className="k-gear-menu" role="menu">
                    <button className="k-gear-item" role="menuitem" onClick={() => { setMenuOpen(false); onMyRides(); }}>
                      <Icon name="search" size={18} color="currentColor" />
                      Find my ride
                    </button>
                    {onDriverMode && (
                      <button className="k-gear-item" role="menuitem" onClick={() => { setMenuOpen(false); onDriverMode(); }}>
                        <Icon name="car" size={18} color="currentColor" />
                        Driver mode
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Rotating headline marquee — the key on each element re-triggers the
              rise-in animation as the copy changes. */}
          <div className="k-rotator" aria-live="polite">
            <h1 key={`t${hi}`} className="k-rotator-title">{h.t}</h1>
            {h.s && <p key={`s${hi}`} className="k-rotator-sub">{h.s}</p>}
          </div>

          <div className="k-attract-main">
            <div className="k-qr-panel">
              <div className="k-qr-box"><QrCode value={PUBLIC_ORIGIN} /></div>
              <div className="k-qr-panel-cap">
                <h2>Continue on your phone</h2>
                <p>Scan to book — no app to install.</p>
              </div>
            </div>

            <div className="k-cases">
              {CASES.map((c) => (
                <button key={c.title} className="k-case" onClick={onBookHere}>
                  <span className="k-case-ic" aria-hidden="true">{c.icon}</span>
                  <span className="k-case-tx">
                    <span className="k-case-title">{c.title}</span>
                    <span className="k-case-line">{c.line}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="k-attract-cta">
            <button className="k-book-cta" onClick={onBookHere}>
              Book my ride <Icon name="arrowRight" size={22} color="var(--ink)" />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
