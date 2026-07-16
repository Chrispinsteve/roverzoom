import { useEffect, useState } from 'react';
import Icon from '../../components/Icon';
import QrCode from '../components/QrCode';

export default function Attract({ onBookHere, onMyRides }) {
  const [time, setTime] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setTime(new Date()), 15000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="kiosk-root">
      <section className="kiosk-screen k-kiosk">
        <div className="k-kiosk-wrap">
          <div className="k-kiosk-top">
            <img src="/logo-wordmark-white.png" alt="RoverZoom" className="k-brand-img" />
            <span className="k-clock">{time.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
          </div>

          <div className="k-hero">
            <h1>Book a <span className="k-lock-word">scheduled</span> ride, right here.</h1>
            <p>Reserve a chauffeured ride in a minute. Scan the code to continue on your phone, or tap below to book on this screen.</p>
          </div>

          <div className="k-paths">
            <div className="k-path-card">
              <span className="k-path-label">Scan to continue</span>
              <div className="k-qr-row">
                <div className="k-qr-box">
                  <QrCode value={window.location.origin} size={120} />
                </div>
                <div className="k-qr-text">
                  <h2>Use your phone</h2>
                  <p>Scan with your camera to book from your own device.</p>
                </div>
              </div>
            </div>

            <div className="k-path-card k-tablet-path">
              <span className="k-path-label">Or book here</span>
              <h2>Tap to start booking on this screen</h2>
              <p>Takes about a minute. We'll clear the screen for the next rider when you're done.</p>
              <button className="k-big-cta" onClick={onBookHere}>
                Book a ride <Icon name="arrowRight" size={20} color="var(--paper)" />
              </button>
            </div>
          </div>

          <div className="k-kiosk-foot">
            <span>RoverZoom · Scheduled chauffeur service</span>
            <button onClick={onMyRides}>Already booked? Find your ride</button>
          </div>
        </div>
      </section>
    </div>
  );
}
