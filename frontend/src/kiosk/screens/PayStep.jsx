import { useState } from 'react';
import FlowShell from '../components/FlowShell';
import PaymentCards from '../components/PaymentCards';
import { api } from '../../lib/api';
import { combineDayTime } from '../lib/datetime';

export default function PayStep({ booking, onChange, onConfirmed, onBack }) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!booking.payment || submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const scheduledAt = combineDayTime(booking.dayIso, booking.timeLabel).toISOString();
      const result = await api.createBooking({
        pickup: booking.pickup,
        dropoff: booking.dropoff,
        scheduledAt,
        paymentMethod: booking.payment,
        rider: { name: booking.name, phone: booking.phone },
      });
      onConfirmed(result);
    } catch (err) {
      setError(err.message || 'Could not confirm your booking. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <FlowShell title="Payment" step={3} totalSteps={3} onBack={onBack}>
      <span className="k-q">How would you like to pay?</span>
      <span className="k-q-sub">
        {booking.quote ? `$${booking.quote.fare.toFixed(2)} · ${booking.quote.durationLabel} drive` : ''}
      </span>

      <PaymentCards method={booking.payment} onSelect={(m) => onChange({ payment: m })} />

      {error && <span className="k-price-wait">{error}</span>}

      <div className="k-footer-bar">
        <div className="k-footer-inner">
          <button className="k-next-btn" disabled={!booking.payment || submitting} onClick={submit}>
            {submitting ? 'Confirming…' : 'Confirm booking'}
          </button>
        </div>
      </div>
    </FlowShell>
  );
}
