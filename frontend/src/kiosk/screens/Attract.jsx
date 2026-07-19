import { useEffect, useState } from 'react';
import Icon from '../../components/Icon';
import QrCode from '../components/QrCode';
import { PUBLIC_ORIGIN } from '../../lib/publicUrl';

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
            <h1>Need a ride later? Book it now — it'll be there.</h1>
            <p><span className="k-lock-word">Price locked</span> the moment you book. Driver guaranteed. No surge, no waiting on a curb — even at 2 AM.</p>
          </div>

          <div className="k-paths">
            <div className="k-path-card k-qr-card">
              <span className="k-path-label">On your phone</span>
              <div className="k-qr-fill">
                <div className="k-qr-box">
                  <QrCode value={PUBLIC_ORIGIN} />
                </div>
              </div>
              <div className="k-qr-caption-block">
                <h2>Scan to book</h2>
                <p>Opens instantly — no app to install. Your price carries over.</p>
              </div>
            </div>

            <div className="k-path-card k-tablet-path">
              <span className="k-path-label">Right here, right now</span>
              <h2>Book on this tablet in under a minute</h2>
              {/* "Confirmation lands on your phone by text" is the mockup's original
                  copy — softened here since no SMS provider is wired up yet. */}
              <p>Three taps and your number. This screen forgets everything when you're done.</p>
              <button className="k-big-cta" onClick={onBookHere}>
                Book my ride <Icon name="arrowRight" size={20} color="var(--paper)" />
              </button>
            </div>
          </div>

          <div className="k-kiosk-foot">
            {/* Mockup's original copy names Stripe specifically — softened since
                payment is a visual stub, not a real Stripe integration. */}
            <span>Pay by card or cash to your driver</span>
            <button onClick={onMyRides}>Already booked? Find your ride</button>
          </div>
        </div>
      </section>
    </div>
  );
}
