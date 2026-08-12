import { useState } from 'react';
import Shell from '../components/Shell';
import Icon from '../components/Icon';
import { api } from '../lib/api';

// After the AI resolves a draft (pickup/dropoff/time/fare), we still need
// payment method + minimal contact info to complete the booking.
export default function AICheckout({ draft, onBack, onComplete }) {
  const [stepIdx, setStepIdx] = useState(0);
  const [payment, setPayment] = useState('card');
  const [rider, setRider] = useState({ name: '', phone: '', email: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setSubmitting(true);
    setError('');
    try {
      const booking = await api.createBooking({
        pickup: draft.pickup,
        dropoff: draft.dropoff,
        scheduledAt: draft.scheduledAt,
        paymentMethod: payment,
        rider,
        source: 'ai',
      });
      onComplete(booking);
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const detailsValid = rider.name.trim() && rider.phone.trim();

  return (
    <Shell step={stepIdx + 1} totalSteps={2}>
      <div className="body">
        {stepIdx === 0 ? (
          <>
            <h1 className="title">How would you like to pay?</h1>
            <p className="subtitle">You’re only charged after the ride is complete.</p>
            <button className={`option ${payment === 'card' ? 'selected' : ''}`} onClick={() => setPayment('card')}>
              <span className="option-icon"><Icon name="card" size={22} color="var(--ink)" /></span>
              <span className="option-body"><span className="option-title">Card</span>
                <span className="option-sub">Pay securely by card (Stripe)</span></span>
              <span className="option-check">{payment === 'card' && <Icon name="check" size={15} color="#fff" stroke={3} />}</span>
            </button>
            <button className={`option ${payment === 'cash' ? 'selected' : ''}`} onClick={() => setPayment('cash')}>
              <span className="option-icon"><Icon name="cash" size={22} color="var(--ink)" /></span>
              <span className="option-body"><span className="option-title">Cash</span>
                <span className="option-sub">Pay your chauffeur directly</span></span>
              <span className="option-check">{payment === 'cash' && <Icon name="check" size={15} color="#fff" stroke={3} />}</span>
            </button>
            <div className="btn-row">
              <button className="btn btn-back" onClick={onBack} aria-label="Back"><Icon name="arrowLeft" size={20} color="var(--ink-2)" /></button>
              <button className="btn" onClick={() => setStepIdx(1)}>Continue</button>
            </div>
          </>
        ) : (
          <>
            <h1 className="title">Almost there</h1>
            <p className="subtitle">Just your contact details to confirm the booking.</p>
            <div className="field">
              <label className="label">Full name</label>
              <input className="input" placeholder="Alex Rivera" value={rider.name}
                onChange={(e) => setRider({ ...rider, name: e.target.value })} />
            </div>
            <div className="field">
              <label className="label">Phone number</label>
              <input className="input" type="tel" placeholder="(555) 000-0000" value={rider.phone}
                onChange={(e) => setRider({ ...rider, phone: e.target.value })} />
            </div>
            <div className="field">
              <label className="label">Email <span className="muted" style={{ fontWeight: 400 }}>(optional)</span></label>
              <input className="input" type="email" placeholder="alex@email.com" value={rider.email}
                onChange={(e) => setRider({ ...rider, email: e.target.value })} />
            </div>
            {error && <p className="error-text">{error}</p>}
            <div className="btn-row">
              <button className="btn btn-back" onClick={() => setStepIdx(0)} aria-label="Back"><Icon name="arrowLeft" size={20} color="var(--ink-2)" /></button>
              <button className="btn" disabled={!detailsValid || submitting} onClick={submit}>
                {submitting ? 'Confirming…' : 'Confirm booking'}
              </button>
            </div>
          </>
        )}
      </div>
    </Shell>
  );
}
