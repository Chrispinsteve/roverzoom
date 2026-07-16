import { useEffect, useState } from 'react';
import Icon from '../../components/Icon';

const RESET_SECONDS = 45;

function fmtWhen(iso) {
  const d = new Date(iso);
  return d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function Confirm({ confirmedBooking, onReset }) {
  const [secondsLeft, setSecondsLeft] = useState(RESET_SECONDS);

  useEffect(() => {
    const id = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          clearInterval(id);
          onReset();
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!confirmedBooking) return null;

  return (
    <div className="kiosk-root">
      <section className="kiosk-screen k-confirm">
        <div className="k-confirm-wrap">
          <div className="k-check-ring">
            <Icon name="check" size={48} color="var(--paper)" stroke={2.5} />
          </div>
          <h1>You're all set</h1>
          {/* No SMS provider is wired up yet — this deliberately doesn't
              claim a text was sent. Keep your reference code handy instead. */}
          <p>Your ride is booked under {confirmedBooking.rider_phone}. Save your confirmation code below.</p>

          <div className="k-ticket">
            <div className="k-ticket-row">
              <span className="k">Confirmation</span>
              <span className="v">{confirmedBooking.reference}</span>
            </div>
            <div className="k-ticket-row">
              <span className="k">Pickup</span>
              <span className="v">{confirmedBooking.pickup_address}</span>
            </div>
            <div className="k-ticket-row">
              <span className="k">Destination</span>
              <span className="v">{confirmedBooking.dropoff_address}</span>
            </div>
            <div className="k-ticket-row">
              <span className="k">Date &amp; time</span>
              <span className="v">{fmtWhen(confirmedBooking.scheduled_at)}</span>
            </div>
            <div className="k-ticket-row">
              <span className="k">Payment</span>
              <span className="v">{confirmedBooking.payment_method === 'card' ? 'Card' : 'Cash'}</span>
            </div>
            <div className="k-ticket-row">
              <span className="k">Total</span>
              <span className="v">${Number(confirmedBooking.fare).toFixed(2)}</span>
            </div>
          </div>

          <div className="k-confirm-actions">
            <button className="k-ghost-btn" onClick={onReset}>Book another ride</button>
          </div>
          <span className="k-reset-note">This screen will reset in {secondsLeft}s for the next rider</span>
        </div>
      </section>
    </div>
  );
}
