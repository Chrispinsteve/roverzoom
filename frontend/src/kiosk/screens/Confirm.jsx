import { useEffect, useState } from 'react';
import Icon from '../../components/Icon';
import QrCode from '../components/QrCode';
import { trackUrl } from '../../lib/publicUrl';

const RESET_SECONDS = 45;

function fmtWhen(iso) {
  const d = new Date(iso);
  return d.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function Confirm({ confirmedBooking, onTrack, onReset }) {
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

          {confirmedBooking.payment_method === 'zelle' && confirmedBooking.paymentsConfig?.zelle && (
            <div className="k-zelle-note">
              <b>Finish with Zelle:</b> send ${Number(confirmedBooking.fare).toFixed(2)} to{' '}
              <b>{confirmedBooking.paymentsConfig.zelle.recipient}</b>{' '}
              ({confirmedBooking.paymentsConfig.zelle.name}) and put{' '}
              <b>{confirmedBooking.reference}</b> in the memo so we can match it to your ride.
            </div>
          )}
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
              <span className="k">Payment</span>
              <span className="v">
                {confirmedBooking.payment_method === 'card' && (confirmedBooking.payment_status === 'paid' ? 'Paid by card \u2713' : 'Card \u2014 processing')}
                {confirmedBooking.payment_method === 'cash' && `Cash to driver \u00b7 $${Number(confirmedBooking.fare).toFixed(2)}`}
                {confirmedBooking.payment_method === 'zelle' && `Zelle \u00b7 $${Number(confirmedBooking.fare).toFixed(2)}`}
              </span>
            </div>
            <div className="k-ticket-row">
              <span className="k">Date &amp; time</span>
              <span className="v">{fmtWhen(confirmedBooking.scheduled_at)}</span>
            </div>
            <div className="k-ticket-row">
              <span className="k">Total</span>
              <span className="v">${Number(confirmedBooking.fare).toFixed(2)}</span>
            </div>
            {/* Rarely populated this early — a driver is usually matched well
                after this screen's 45s auto-reset window — but shown when
                available, e.g. if this reference is looked up later via My Rides. */}
            {confirmedBooking.driver && (
              <div className="k-ticket-row">
                <span className="k">Your driver</span>
                <span className="v">{confirmedBooking.driver.name} · {confirmedBooking.driver.vehicle_color} {confirmedBooking.driver.vehicle_make}</span>
              </div>
            )}
          </div>

          <div className="k-confirm-qr">
            <div className="k-qr-box">
              <QrCode value={trackUrl(confirmedBooking.id)} />
            </div>
            <div className="k-qr-text">
              <h2>Scan to track on your phone</h2>
              <p>Take your ride with you — watch your driver accept and arrive, live. We'll text this link too.</p>
            </div>
          </div>

          <div className="k-confirm-actions">
            <button className="k-next-btn" onClick={onTrack}>Track my ride</button>
            <button className="k-ghost-btn" onClick={onReset}>Book another ride</button>
          </div>
          <span className="k-reset-note">This screen will reset in {secondsLeft}s for the next rider</span>
        </div>
      </section>
    </div>
  );
}
